import { system, world } from "@minecraft/server";
import { BUILDING_ITEMS, GOALS, WAYPOINT_IDS } from "./constants.js";
import {
  addItem,
  consumeBuildingItem,
  countAny,
  countItem,
  getBuildingItem,
  equipMainhand,
  removeItem
} from "./inventory.js";
import {
  beginMiningTask,
  canMineBlock,
  craftEmergencyBoat,
  equipBestPickaxe,
  getGatheringStatus,
  tickMiningTask,
  tickTorchPlacement
} from "./gathering.js";
import {
  markPlacedBlock,
  pillarFailureCount,
  placementFailureCount,
  recordFailedPillar,
  recordFall,
  recordPlacementAttempt,
  recordRouteOutcome,
  recordWork,
  routeMemoryPenalty,
  setRouteStatus
} from "./memory.js";
import {
  advanceActionStep,
  authorizeAction,
  authorizePlacement,
  clearActionPlan,
  createActionPlan,
  failActionStep,
  getCurrentStep,
  retryActionStep
} from "./planner.js";
import {
  dangerPenalty,
  rememberBridge,
  updateBridgeResult
} from "./squad.js";
import {
  add,
  adjacentHazardCount,
  adjacentLavaCount,
  blockIntersectsEntity,
  centerBlock,
  distance,
  floorLocation,
  hasStandingSpace,
  horizontalDistance,
  isAirBlock,
  isBreakableBlock,
  isEntityValid,
  isFallingBlock,
  isHazardBlock,
  isLavaBlock,
  isPassableBlock,
  isSolidSupport,
  isWaterBlock,
  locationKey,
  parseLocationKey,
  normalizeXZ,
  safeApplyImpulse,
  safeDynamicGet,
  safeDynamicSet,
  safeGetBlock,
  safeLookAt,
  safeSetBlockType,
  safeTrigger,
  supportDepth,
  withinBlockReach
} from "./utils.js";

const CARDINALS = Object.freeze([
  { x: 1, y: 0, z: 0, name: "east" },
  { x: -1, y: 0, z: 0, name: "west" },
  { x: 0, y: 0, z: 1, name: "south" },
  { x: 0, y: 0, z: -1, name: "north" }
]);

const DIAGONALS = Object.freeze([
  { x: 1, y: 0, z: 1, name: "southeast" },
  { x: 1, y: 0, z: -1, name: "northeast" },
  { x: -1, y: 0, z: 1, name: "southwest" },
  { x: -1, y: 0, z: -1, name: "northwest" }
]);

function waypointType(brain) {
  const index = Math.max(0, Math.min(WAYPOINT_IDS.length - 1, Math.trunc(brain?.squadIndex ?? 0)));
  return WAYPOINT_IDS[index];
}

function routeEvent(brain, search = false) {
  const index = Math.max(0, Math.min(3, Math.trunc(brain?.squadIndex ?? 0)));
  return search ? `manhunt:search_${index}` : `manhunt:route_${index}`;
}

function incrementStat(hunter, key, amount = 1) {
  const value = Number(safeDynamicGet(hunter, key, 0));
  safeDynamicSet(hunter, key, (Number.isFinite(value) ? value : 0) + amount);
}

function emitRouteParticle(hunter, brain, location, particle = "minecraft:basic_flame_particle") {
  if (!hunter || !brain?.configRouteParticles || !location) return;
  try { hunter.dimension.spawnParticle(particle, { x: location.x + 0.5, y: location.y + 0.35, z: location.z + 0.5 }); } catch {}
}

function getKnownDimensions(reference) {
  const result = [];
  if (reference?.dimension) result.push(reference.dimension);
  for (const id of ["overworld", "nether", "the_end"]) {
    try {
      const dimension = world.getDimension(id);
      if (!result.some((entry) => entry.id === dimension.id)) result.push(dimension);
    } catch {
      // Ignore unavailable dimensions.
    }
  }
  return result;
}

function getWaypoint(brain) {
  if (!brain?.waypointId) return undefined;
  try { return world.getEntity(brain.waypointId); } catch { return undefined; }
}

function removeWaypoint(brain) {
  const waypoint = getWaypoint(brain);
  try { waypoint?.remove(); } catch { /* already gone */ }
  if (brain) {
    brain.waypointId = "";
    brain.waypointTargetKey = "";
    brain.waypointSearch = false;
  }
}

export function clearWaypoint(brain = undefined) {
  if (brain) {
    removeWaypoint(brain);
    return;
  }
  for (const dimension of getKnownDimensions()) {
    for (const type of WAYPOINT_IDS) {
      let entities = [];
      try { entities = dimension.getEntities({ type }); } catch { continue; }
      for (const entity of entities) try { entity.remove(); } catch { /* ignore */ }
    }
  }
}

function setWaypoint(hunter, brain, location, action, search = false, ttl = 120) {
  if (!isEntityValid(hunter) || !brain || !location) return undefined;
  const target = { x: location.x + (Number.isInteger(location.x) ? 0.5 : 0), y: location.y, z: location.z + (Number.isInteger(location.z) ? 0.5 : 0) };
  const targetKey = locationKey(target, hunter.dimension.id);
  let waypoint = getWaypoint(brain);
  let created = false;
  const targetChanged = brain.waypointTargetKey !== targetKey || brain.waypointSearch !== search;
  if (!isEntityValid(waypoint) || waypoint.dimension.id !== hunter.dimension.id || waypoint.typeId !== waypointType(brain)) {
    try { waypoint?.remove(); } catch { /* ignore */ }
    try {
      waypoint = hunter.dimension.spawnEntity(waypointType(brain), target);
      brain.waypointId = waypoint.id;
      created = true;
      try { waypoint.addTag(`manhunt_waypoint_${brain.squadIndex}`); } catch { /* optional */ }
    } catch (error) {
      brain.lastError = `waypoint spawn: ${error}`;
      brain.lastErrorTick = system.currentTick;
      return undefined;
    }
  } else if (targetChanged && distance(waypoint.location, target) > 0.2) {
    // Teleporting the same marker every brain tick repeatedly invalidates the
    // native path. Move it only when the actual block target changes.
    try { waypoint.teleport(target, { dimension: hunter.dimension, checkForBlocks: false }); } catch { /* keep old location */ }
  }
  // Claim route ownership on every executor pass. safeTrigger suppresses
  // duplicate route events for a long window, but immediately reapplies the
  // route if another goal temporarily switched the component group.
  safeTrigger(hunter, routeEvent(brain, search));
  brain.lastWaypointTriggerTick = system.currentTick;
  brain.waypointTargetKey = targetKey;
  brain.waypointSearch = search;
  setRouteStatus(hunter, brain, action, target, search ? "search" : "route");
  if (created || targetChanged) emitRouteParticle(hunter, brain, floorLocation(target), search ? "minecraft:blue_flame_particle" : "minecraft:basic_flame_particle");
  brain.routeExpiresTick = system.currentTick + Math.max(20, ttl);
  return waypoint;
}

export function returnToChase(hunter, brain) {
  removeWaypoint(brain);
  safeTrigger(hunter, "manhunt:chase");
  setRouteStatus(hunter, brain, "native pursuit", undefined, "chase");
}

function directionToward(from, target) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  if (Math.abs(dx) > Math.abs(dz) * 1.7) return { x: Math.sign(dx), y: 0, z: 0 };
  if (Math.abs(dz) > Math.abs(dx) * 1.7) return { x: 0, y: 0, z: Math.sign(dz) };
  return { x: Math.sign(dx), y: 0, z: Math.sign(dz) };
}

function cardinalToward(from, target) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  return Math.abs(dx) >= Math.abs(dz)
    ? { x: Math.sign(dx) || 1, y: 0, z: 0 }
    : { x: 0, y: 0, z: Math.sign(dz) || 1 };
}

function candidateStanding(dimension, location, allowWater = false) {
  return hasStandingSpace(dimension, { x: location.x, y: location.y, z: location.z }, allowWater);
}

function candidateCost(hunter, brain, location, target, action = "walk") {
  const dimension = hunter.dimension;
  const key = locationKey(location, dimension.id);
  if ((brain.routeBlacklist.get(key) ?? 0) > system.currentTick) return Number.POSITIVE_INFINITY;
  const feet = safeGetBlock(dimension, location);
  const head = safeGetBlock(dimension, { x: location.x, y: location.y + 1, z: location.z });
  const below = safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z });
  let cost = horizontalDistance(location, target) * 4 + Math.abs(location.y - target.y) * 3;
  cost += routeMemoryPenalty(brain, key);
  cost += dangerPenalty(dimension.id, location) * 30;
  cost += adjacentHazardCount(dimension, location) * 45;
  if (isLavaBlock(feet) || isLavaBlock(head) || isLavaBlock(below)) return Number.POSITIVE_INFINITY;
  if (isWaterBlock(feet)) cost += 12;
  if (!isPassableBlock(feet, true)) cost += isBreakableBlock(feet) ? 22 : 1000;
  if (!isPassableBlock(head, true)) cost += isBreakableBlock(head) ? 26 : 1000;
  const depth = supportDepth(dimension, location, 7);
  if (depth > 1) cost += depth * 12;
  if (action === "jump") cost += 5;
  if (action === "break") cost += 18;
  if (action === "place") cost += 20;
  return cost;
}

function nearbySafeLane(hunter, brain, target, radius = 2) {
  const base = floorLocation(hunter.location);
  const candidates = [];
  for (const direction of [...CARDINALS, ...DIAGONALS]) {
    for (let step = 1; step <= radius; step++) {
      const location = { x: base.x + direction.x * step, y: base.y, z: base.z + direction.z * step };
      if (!candidateStanding(hunter.dimension, location, true)) continue;
      candidates.push({ location, cost: candidateCost(hunter, brain, location, target), direction });
      break;
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

function routeKey(brain, dimensionId, location, action) {
  return `${locationKey(location, dimensionId)}|${action}|${brain.squadIndex}`;
}

function placementSupport(dimension, location, purpose) {
  const below = safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z });
  if (isSolidSupport(below)) return true;
  for (const offset of CARDINALS) {
    const side = safeGetBlock(dimension, { x: location.x + offset.x, y: location.y, z: location.z + offset.z });
    if (isSolidSupport(side)) return true;
  }
  // A planned rising staircase may attach to the upper edge of the previous
  // step. Script placement has no player crosshair, so accept the solid block
  // one block down and one block sideways only for staircase plans.
  if (purpose === "stair" || purpose === "spiral") {
    for (const offset of CARDINALS) {
      const lowerSide = safeGetBlock(dimension, { x: location.x + offset.x, y: location.y - 1, z: location.z + offset.z });
      if (isSolidSupport(lowerSide)) return true;
    }
  }
  if (purpose === "pillar") return isSolidSupport(below);
  return false;
}

function placementWouldTrap(hunter, runner, location, purpose) {
  if (purpose === "pillar") {
    const feet = floorLocation(hunter.location);
    const sameColumn = feet.x === location.x && feet.z === location.z;
    if (sameColumn && location.y <= Math.floor(hunter.location.y)) return false;
  }
  if (blockIntersectsEntity(hunter, location, 0.73, 1.02)) return true;
  if (runner && runner.dimension.id === hunter.dimension.id && blockIntersectsEntity(runner, location, 0.9, 1.75)) return true;
  const hunterFeet = floorLocation(hunter.location);
  if (location.x === hunterFeet.x && location.z === hunterFeet.z && location.y === hunterFeet.y + 1) return true;
  return false;
}

function placementAdvancesRoute(hunter, brain, step) {
  const target = step.metadata?.routeTarget;
  if (!target) return true;
  if (step.metadata?.purpose === "stair" || step.metadata?.purpose === "spiral" || step.metadata?.purpose === "pillar") {
    return (step.expectedY ?? step.location.y + 1) > hunter.location.y + 0.15;
  }
  const blockCenter = { x: step.location.x + 0.5, y: step.location.y + 1, z: step.location.z + 0.5 };
  return horizontalDistance(blockCenter, target) <= horizontalDistance(hunter.location, target) + 1.25;
}

function processPlanOutcomes(hunter, brain) {
  if (!brain) return;
  const completed = brain.completedPlanOutcome;
  if (completed) {
    const metadata = completed.metadata ?? {};
    if (metadata.routeKey) {
      recordRouteOutcome(brain, metadata.routeKey, completed.type, true, {
        reason: completed.result || "planned route completed"
      });
    }
    if (completed.type === "bridge" && Array.isArray(metadata.blocks)) {
      updateBridgeResult(hunter.dimension.id, metadata.blocks, true);
    }
    if (completed.type?.startsWith("vertical_")) {
      brain.routeFailures = Math.max(0, (brain.routeFailures ?? 0) - 1);
      brain.lastVerticalProgressTick = system.currentTick;
      brain.verticalBestY = Math.max(brain.verticalBestY ?? hunter.location.y, hunter.location.y);
    }
    brain.completedPlanOutcome = undefined;
  }

  const failed = brain.failedPlanOutcome;
  if (failed) {
    const metadata = failed.metadata ?? {};
    if (metadata.routeKey) {
      recordRouteOutcome(brain, metadata.routeKey, failed.type, false, {
        reason: failed.reason || "planned route failed",
        danger: failed.type?.startsWith("vertical_") ? 1 : 0.5
      });
    }
    if (failed.type === "bridge" && Array.isArray(metadata.blocks)) {
      updateBridgeResult(hunter.dimension.id, metadata.blocks, false);
    }
    if (failed.type === "vertical_pillar" && metadata.column) {
      recordFailedPillar(brain, hunter.dimension.id, metadata.column, failed.reason || "pillar plan failed");
    }
    if (["bridge", "vertical_diagonal", "vertical_spiral", "vertical_pillar", "safe_descent", "clear_obstacle"].includes(failed.type)) {
      brain.routeFailures = (brain.routeFailures ?? 0) + 1;
    }
    brain.failedPlanOutcome = undefined;
  }
}

function verifyPendingPlacement(hunter, brain) {
  const pending = brain.pendingPlacement;
  if (!pending || system.currentTick < pending.verifyTick) return;
  const block = safeGetBlock(hunter.dimension, pending.location);
  const exists = block && block.typeId === pending.typeId;
  const movedUp = hunter.location.y > pending.beforeY + 0.2;
  const movedCloser = pending.target ? horizontalDistance(hunter.location, pending.target) < pending.beforeDistance - 0.15 : false;
  const exemptFromProgressCheck = ["bridge", "portal_frame", "clutch"].includes(pending.purpose);
  const success = exists && (exemptFromProgressCheck || movedUp || movedCloser);

  // Native pathfinding can need more than fourteen ticks to step onto a newly
  // built stair. Give one additional verification window before declaring the
  // placement useless; this avoids both premature removal and permanent random
  // block litter.
  if (exists && !success && (pending.verificationPasses ?? 0) < 1) {
    pending.verificationPasses = 1;
    pending.verifyTick = system.currentTick + 16;
    return;
  }

  recordPlacementAttempt(brain, hunter.dimension.id, pending.location, success, success ? "verified" : "no route progress after two checks");
  if (success) {
    recordRouteOutcome(brain, pending.routeKey, pending.purpose, true, { reason: "placement created usable terrain" });
  } else if (exists) {
    recordRouteOutcome(brain, pending.routeKey, pending.purpose, false, { danger: 0.75, reason: "placement did not improve movement" });
    const feet = floorLocation(hunter.location);
    const supportsHunter = pending.location.x === feet.x && pending.location.z === feet.z && pending.location.y === feet.y - 1;
    if (!supportsHunter && !exemptFromProgressCheck && safeSetBlockType(hunter.dimension, pending.location, "minecraft:air")) {
      addItem(hunter, pending.typeId, 1);
      const key = locationKey(pending.location, hunter.dimension.id);
      brain.placedBlocks.delete(key);
      brain.placedBlockMeta.delete(key);
      const count = Number(safeDynamicGet(hunter, "manhunt:route_blocks_placed", 0)) || 0;
      safeDynamicSet(hunter, "manhunt:route_blocks_placed", Math.max(0, count - 1));
      brain.lastFailedAction = `${pending.purpose} placement was removed because it did not advance the route`;
      if (brain.actionPlan) clearActionPlan(brain, "verified placement failed to advance route");
    }
  }
  brain.pendingPlacement = undefined;
}

function tickPlannedPlacement(hunter, runner, brain, config, step) {
  const purpose = step.metadata?.purpose ?? "route";
  if (!authorizePlacement(brain, step.location, purpose)) {
    failActionStep(brain, "placement was not authorized by the active route plan");
    return { active: false, failed: true };
  }
  if (!config.safeBuilding) {
    failActionStep(brain, "safe building is disabled");
    return { active: false, failed: true };
  }
  if (system.currentTick - brain.lastPlaceTick < (purpose === "pillar" ? 8 : 6)) return { active: true };
  const airbornePlacement = purpose === "pillar" || purpose === "clutch";
  if (hunter.isInWater || (hunter.isFalling && purpose !== "clutch") || (!hunter.isOnGround && !airbornePlacement)) return { active: true, waiting: true };
  if (placementFailureCount(brain, hunter.dimension.id, step.location) >= 2) {
    failActionStep(brain, "this placement failed twice and is now avoided");
    return { active: false, failed: true };
  }
  const block = safeGetBlock(hunter.dimension, step.location);
  if (!block) return { active: true };
  if (!isAirBlock(block)) {
    if (isSolidSupport(block)) {
      advanceActionStep(brain, "existing route block reused");
      return { active: true, completed: true };
    }
    failActionStep(brain, `placement destination contains ${block.typeId}`);
    return { active: false, failed: true };
  }
  if (!placementSupport(hunter.dimension, step.location, purpose)) {
    failActionStep(brain, "placement lacks a legal support face");
    return { active: false, failed: true };
  }
  if (placementWouldTrap(hunter, runner, step.location, purpose)) {
    failActionStep(brain, "placement would intersect or trap an entity");
    return { active: false, failed: true };
  }
  if (!placementAdvancesRoute(hunter, brain, step)) {
    failActionStep(brain, "placement would not advance the selected route");
    return { active: false, failed: true };
  }

  const staging = step.metadata?.staging;
  if (staging && distance(hunter.location, staging) > 1.35) {
    setWaypoint(hunter, brain, staging, `positioning for ${purpose}`);
    return { active: true, target: staging };
  }
  if (!withinBlockReach(hunter, step.location, purpose === "pillar" ? 3.8 : 3.45)) {
    const approach = staging ?? { x: step.location.x + 0.5, y: step.location.y + 1, z: step.location.z + 0.5 };
    setWaypoint(hunter, brain, approach, `approaching planned ${purpose} placement`);
    return { active: true, target: approach };
  }

  const typeId = consumeBuildingItem(hunter);
  if (!typeId) {
    brain.needsBuildingBlocksUntil = system.currentTick + 20 * 30;
    brain.needsBuildingBlocksReason = `${purpose} route ran out of blocks`;
    failActionStep(brain, "no building blocks remain");
    return { active: false, needBlocks: true };
  }
  brain.holdMainhandItem = typeId;
  brain.holdMainhandUntilTick = system.currentTick + 8;
  equipMainhand(hunter, typeId);
  safeLookAt(hunter, { x: step.location.x + 0.5, y: step.location.y + 0.5, z: step.location.z + 0.5 });
  if (!safeSetBlockType(hunter.dimension, step.location, typeId)) {
    addItem(hunter, typeId, 1);
    recordPlacementAttempt(brain, hunter.dimension.id, step.location, false, "engine rejected block placement");
    retryActionStep(brain, "engine rejected block placement");
    return { active: true, failed: true };
  }

  emitRouteParticle(hunter, brain, step.location, "minecraft:villager_happy");
  const key = locationKey(step.location, hunter.dimension.id);
  const rKey = brain.routeKey ?? routeKey(brain, hunter.dimension.id, step.location, purpose);
  markPlacedBlock(brain, key, { typeId, purpose, routeKey: rKey });
  recordWork(brain, "placement", 1);
  incrementStat(hunter, "manhunt:route_blocks_placed", 1);
  brain.lastPlaceTick = system.currentTick;
  brain.pendingPlacement = {
    location: { ...step.location },
    typeId,
    purpose,
    routeKey: rKey,
    beforeY: hunter.location.y,
    beforeDistance: step.metadata?.routeTarget ? horizontalDistance(hunter.location, step.metadata.routeTarget) : 0,
    target: step.metadata?.routeTarget ? { ...step.metadata.routeTarget } : undefined,
    verifyTick: system.currentTick + 14
  };
  if (purpose === "bridge") rememberBridge(hunter.dimension.id, [{ ...step.location }], false);
  advanceActionStep(brain, `${purpose} block placed`);
  return { active: true, completed: true };
}

function tickMoveStep(hunter, brain, step, search = false) {
  const target = step.location ?? step.target;
  if (!target) {
    failActionStep(brain, "move step has no target");
    return { active: false, failed: true };
  }
  const threshold = step.metadata?.threshold ?? 0.9;
  if (horizontalDistance(hunter.location, target) <= threshold && Math.abs(hunter.location.y - target.y) <= 1.6) {
    advanceActionStep(brain, "waypoint reached");
    return { active: true, completed: true };
  }
  setWaypoint(hunter, brain, target, step.reason ?? "following planned route", search);
  return { active: true, target };
}

function tickBreakStep(hunter, brain, step) {
  if (!brain.mineTask) {
    const started = beginMiningTask(hunter, brain, step.location, undefined, step.metadata?.emergency === true, {
      allowBelow: step.metadata?.allowBelow === true,
      allowFallingBlock: step.metadata?.allowFallingBlock === true,
      allowLava: step.metadata?.allowLava === true
    });
    if (!started) {
      failActionStep(brain, "planned obstruction cannot be mined safely with current tools");
      return { active: false, failed: true };
    }
  }
  const task = tickMiningTask(hunter, brain);
  if (task.approaching) setWaypoint(hunter, brain, step.metadata?.staging ?? step.location, "approaching planned block break");
  return { active: task.active || task.completed, completed: task.completed, failed: task.wrongTool || task.unsafe };
}

function tickPillarStep(hunter, runner, brain, config, step) {
  const purpose = "pillar";
  if (!authorizePlacement(brain, step.location, purpose)) {
    failActionStep(brain, "pillar block was not authorized");
    return { active: false, failed: true };
  }
  const feet = floorLocation(hunter.location);
  const column = step.metadata?.column ?? { x: step.location.x, z: step.location.z };
  if (feet.x !== column.x || feet.z !== column.z) {
    const staging = { x: column.x + 0.5, y: hunter.location.y, z: column.z + 0.5 };
    setWaypoint(hunter, brain, staging, "centering on the planned pillar column");
    return { active: true, target: staging };
  }
  const expectedY = step.expectedY ?? step.location.y + 1;
  if (hunter.location.y >= expectedY - 0.2 && isSolidSupport(safeGetBlock(hunter.dimension, step.location))) {
    advanceActionStep(brain, "pillar level completed");
    brain.lastVerticalProgressTick = system.currentTick;
    brain.verticalBestY = Math.max(brain.verticalBestY ?? hunter.location.y, hunter.location.y);
    return { active: true, completed: true };
  }
  if (!step.metadata.jumpTick) {
    if (!hunter.isOnGround) return { active: true, waiting: true };
    safeApplyImpulse(hunter, { x: 0, y: 0.43, z: 0 });
    step.metadata.jumpTick = system.currentTick;
    brain.verticalTraversalUntil = system.currentTick + 90;
    brain.verticalMode = "pillar";
    return { active: true, jumping: true };
  }
  if (system.currentTick - step.metadata.jumpTick < 4 || hunter.location.y < step.location.y + 0.78) return { active: true, waiting: true };
  const result = tickPlannedPlacement(hunter, runner, brain, config, step);
  if (result.completed) {
    brain.lastVerticalProgressTick = system.currentTick;
    brain.verticalBestY = Math.max(brain.verticalBestY ?? hunter.location.y, expectedY);
  }
  return result;
}

function tickWaitStep(brain, step) {
  if (!step.metadata.untilTick) step.metadata.untilTick = system.currentTick + (step.metadata.ticks ?? 10);
  if (system.currentTick >= step.metadata.untilTick) advanceActionStep(brain, "wait completed");
  return { active: true };
}

export function tickActionPlan(hunter, runner, brain, config) {
  processPlanOutcomes(hunter, brain);
  verifyPendingPlacement(hunter, brain);
  if (tickTorchPlacement(hunter, brain)) return { active: true, action: "placing a planned torch" };
  const step = getCurrentStep(brain);
  if (!step) return { active: false };
  if (system.currentTick < (step.retryAfterTick ?? 0)) {
    return { active: true, waiting: true, action: `waiting to retry ${step.type}` };
  }
  if (brain.actionPlan?.type === "build_portal") return { active: false, portalPlan: true };
  if (step.type === "move") return { ...tickMoveStep(hunter, brain, step, brain.actionPlan?.type === "search"), action: step.reason };
  if (step.type === "place") return { ...tickPlannedPlacement(hunter, runner, brain, config, step), action: step.reason };
  if (step.type === "pillar") return { ...tickPillarStep(hunter, runner, brain, config, step), action: step.reason };
  if (step.type === "break") return { ...tickBreakStep(hunter, brain, step), action: step.reason };
  if (step.type === "jump") {
    if (hunter.isOnGround && system.currentTick - brain.lastJumpTick >= 10) {
      const target = step.location ?? step.target;
      const direction = target ? normalizeXZ({ x: target.x - hunter.location.x, y: 0, z: target.z - hunter.location.z }) : { x: 0, z: 0 };
      safeApplyImpulse(hunter, { x: direction.x * 0.075, y: 0.34, z: direction.z * 0.075 });
      brain.lastJumpTick = system.currentTick;
      incrementStat(hunter, "manhunt:route_jumps", 1);
      advanceActionStep(brain, "planned jump started");
    }
    return { active: true, action: "jumping along the route" };
  }
  if (step.type === "wait") return { ...tickWaitStep(brain, step), action: "waiting for safe timing" };
  // These steps are owned by their specialist systems. Keeping them active
  // here prevents the staggered scheduler from incorrectly failing a valid
  // water, boat, obsidian, or portal action on the ticks between specialist
  // updates.
  if (["place_water", "use_boat", "craft_boat", "form_obsidian", "activate_portal"].includes(step.type)) {
    return { active: true, external: true, action: step.reason ?? step.type };
  }
  failActionStep(brain, `unsupported route step ${step.type}`);
  return { active: false, failed: true };
}

function bridgeGapLocations(hunter, target, maximum = 7) {
  const base = floorLocation(hunter.location);
  const direction = cardinalToward(base, target);
  const locations = [];
  for (let step = 1; step <= maximum; step++) {
    const feet = { x: base.x + direction.x * step, y: base.y, z: base.z + direction.z * step };
    const below = { x: feet.x, y: feet.y - 1, z: feet.z };
    const feetBlock = safeGetBlock(hunter.dimension, feet);
    const headBlock = safeGetBlock(hunter.dimension, { x: feet.x, y: feet.y + 1, z: feet.z });
    const belowBlock = safeGetBlock(hunter.dimension, below);
    if (!isPassableBlock(feetBlock, false) || !isPassableBlock(headBlock, false)) return undefined;
    if (isSolidSupport(belowBlock)) return locations.length ? { locations, direction, landing: feet } : undefined;
    if (isWaterBlock(belowBlock) || isLavaBlock(belowBlock) || isHazardBlock(belowBlock)) return undefined;
    locations.push({ block: below, feet });
  }
  return undefined;
}

export function createBridgePlan(hunter, brain, target) {
  const gap = bridgeGapLocations(hunter, target, 7);
  if (!gap || gap.locations.length < 1) return false;
  const blocks = countAny(hunter, BUILDING_ITEMS);
  if (blocks < gap.locations.length) {
    brain.needsBuildingBlocksUntil = system.currentTick + 20 * 45;
    brain.needsBuildingBlocksReason = `bridge needs ${gap.locations.length} blocks but only ${blocks} are available`;
    return false;
  }
  const steps = [];
  let previousFeet = { ...floorLocation(hunter.location), x: Math.floor(hunter.location.x), z: Math.floor(hunter.location.z) };
  for (const entry of gap.locations) {
    steps.push({
      type: "place",
      location: entry.block,
      reason: "place the next verified bridge block",
      maxTicks: 120,
      expectedDistance: horizontalDistance(entry.feet, target),
      metadata: {
        purpose: "bridge",
        staging: { x: previousFeet.x + 0.5, y: baseY(previousFeet), z: previousFeet.z + 0.5 },
        routeTarget: { ...target }
      }
    });
    steps.push({
      type: "move",
      location: { x: entry.feet.x + 0.5, y: entry.feet.y, z: entry.feet.z + 0.5 },
      reason: "step onto the verified bridge block",
      maxTicks: 100,
      metadata: { threshold: 0.75 }
    });
    previousFeet = entry.feet;
  }
  const key = routeKey(brain, hunter.dimension.id, gap.locations[0].block, "bridge");
  brain.routeKey = key;
  createActionPlan(brain, "bridge", `cross ${gap.locations.length}-block air gap`, steps, {
    routeKey: key,
    target: { ...target },
    blocks: gap.locations.map((entry) => entry.block)
  }, 20 * 45);
  rememberBridge(hunter.dimension.id, gap.locations.map((entry) => entry.block), false);
  recordWork(brain, "plan", 1);
  return true;
}

function baseY(location) {
  return Number.isFinite(location.y) ? location.y : 0;
}

function chooseStairDirection(hunter, brain, target, levels) {
  const base = floorLocation(hunter.location);
  const preferred = cardinalToward(base, target);
  const directions = [preferred, ...CARDINALS.filter((entry) => entry.x !== preferred.x || entry.z !== preferred.z)];
  const candidates = [];
  for (const direction of directions) {
    let score = 0;
    for (let index = 0; index < levels; index++) {
      const blockLocation = { x: base.x + direction.x * (index + 1), y: base.y + index, z: base.z + direction.z * (index + 1) };
      const block = safeGetBlock(hunter.dimension, blockLocation);
      const feet = safeGetBlock(hunter.dimension, { x: blockLocation.x, y: blockLocation.y + 1, z: blockLocation.z });
      const head = safeGetBlock(hunter.dimension, { x: blockLocation.x, y: blockLocation.y + 2, z: blockLocation.z });
      if ((!isAirBlock(block) && !isSolidSupport(block)) || !isPassableBlock(feet, false) || !isPassableBlock(head, false)) { score = Number.POSITIVE_INFINITY; break; }
      score += adjacentHazardCount(hunter.dimension, blockLocation) * 60;
      score += routeMemoryPenalty(brain, locationKey(blockLocation, hunter.dimension.id));
    }
    if (Number.isFinite(score)) candidates.push({ direction, score: score + (direction.x === preferred.x && direction.z === preferred.z ? -10 : 0) });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.direction;
}

export function createDiagonalStairPlan(hunter, brain, target, heightDifference) {
  const levels = Math.max(1, Math.min(16, Math.ceil(heightDifference)));
  const blocks = countAny(hunter, BUILDING_ITEMS);
  const reserve = 4;
  brain.verticalBlockRequirement = levels + reserve;
  if (blocks < levels + reserve) {
    brain.needsBuildingBlocksUntil = system.currentTick + 20 * 60;
    brain.needsBuildingBlocksReason = `vertical route needs ${levels + reserve} blocks but only ${blocks} are available`;
    return false;
  }
  const base = floorLocation(hunter.location);
  const direction = chooseStairDirection(hunter, brain, target, levels);
  if (!direction) return false;
  const steps = [];
  let staging = { x: base.x + 0.5, y: base.y, z: base.z + 0.5 };
  const placed = [];
  for (let index = 0; index < levels; index++) {
    const blockLocation = { x: base.x + direction.x * (index + 1), y: base.y + index, z: base.z + direction.z * (index + 1) };
    const feetLocation = { x: blockLocation.x + 0.5, y: blockLocation.y + 1, z: blockLocation.z + 0.5 };
    if (!isSolidSupport(safeGetBlock(hunter.dimension, blockLocation))) {
      steps.push({
        type: "place",
        location: blockLocation,
        expectedY: feetLocation.y,
        reason: "place the next diagonal staircase block",
        maxTicks: 160,
        metadata: { purpose: "stair", staging, routeTarget: { ...target } }
      });
      placed.push(blockLocation);
    }
    steps.push({ type: "move", location: feetLocation, reason: "climb onto the diagonal staircase", maxTicks: 140, metadata: { threshold: 0.8 } });
    staging = feetLocation;
  }
  const key = routeKey(brain, hunter.dimension.id, placed[0] ?? base, "diagonal_stair");
  if ((brain.routeBlacklist.get(key) ?? 0) > system.currentTick) return false;
  brain.routeKey = key;
  brain.verticalMode = "diagonal staircase";
  brain.verticalTraversalUntil = system.currentTick + 20 * 120;
  brain.verticalBestY = hunter.location.y;
  brain.lastVerticalProgressTick = system.currentTick;
  brain.verticalPlan = { type: "diagonal", direction, levels, blocks: placed, target: { ...target } };
  createActionPlan(brain, "vertical_diagonal", `climb ${levels} blocks using a diagonal staircase`, steps, { routeKey: key, placed }, 20 * 120);
  recordWork(brain, "plan", 1);
  return true;
}

export function createSpiralStairPlan(hunter, brain, target, heightDifference) {
  const levels = Math.max(2, Math.min(20, Math.ceil(heightDifference)));
  const blocks = countAny(hunter, BUILDING_ITEMS);
  const reserve = 5;
  brain.verticalBlockRequirement = levels + reserve;
  if (blocks < levels + reserve) {
    brain.needsBuildingBlocksUntil = system.currentTick + 20 * 60;
    brain.needsBuildingBlocksReason = `spiral route needs ${levels + reserve} blocks but only ${blocks} are available`;
    return false;
  }
  const base = floorLocation(hunter.location);
  const sequence = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
  let position = { x: base.x, z: base.z };
  let staging = { x: base.x + 0.5, y: base.y, z: base.z + 0.5 };
  const steps = [];
  const placed = [];
  for (let index = 0; index < levels; index++) {
    const direction = sequence[index % sequence.length];
    position = { x: position.x + direction.x, z: position.z + direction.z };
    const blockLocation = { x: position.x, y: base.y + index, z: position.z };
    const feet = safeGetBlock(hunter.dimension, { x: blockLocation.x, y: blockLocation.y + 1, z: blockLocation.z });
    const head = safeGetBlock(hunter.dimension, { x: blockLocation.x, y: blockLocation.y + 2, z: blockLocation.z });
    const destination = safeGetBlock(hunter.dimension, blockLocation);
    if (!isPassableBlock(feet, false) || !isPassableBlock(head, false) || (!isAirBlock(destination) && !isSolidSupport(destination))) return false;
    const feetLocation = { x: blockLocation.x + 0.5, y: blockLocation.y + 1, z: blockLocation.z + 0.5 };
    if (!isSolidSupport(destination)) {
      steps.push({ type: "place", location: blockLocation, expectedY: feetLocation.y, reason: "place the next spiral staircase block", maxTicks: 170, metadata: { purpose: "spiral", staging, routeTarget: { ...target } } });
      placed.push(blockLocation);
    }
    steps.push({ type: "move", location: feetLocation, reason: "turn around the spiral staircase", maxTicks: 150, metadata: { threshold: 0.8 } });
    staging = feetLocation;
  }
  const key = routeKey(brain, hunter.dimension.id, placed[0] ?? base, "spiral_stair");
  if ((brain.routeBlacklist.get(key) ?? 0) > system.currentTick) return false;
  brain.routeKey = key;
  brain.verticalMode = "spiral staircase";
  brain.verticalTraversalUntil = system.currentTick + 20 * 150;
  brain.verticalBestY = hunter.location.y;
  brain.lastVerticalProgressTick = system.currentTick;
  brain.verticalPlan = { type: "spiral", levels, blocks: placed, target: { ...target } };
  createActionPlan(brain, "vertical_spiral", `climb ${levels} blocks using a compact spiral staircase`, steps, { routeKey: key, placed }, 20 * 150);
  recordWork(brain, "plan", 1);
  return true;
}

function safePillarColumn(hunter, runner, brain, target) {
  const base = floorLocation(hunter.location);
  const away = normalizeXZ({ x: hunter.location.x - target.x, y: 0, z: hunter.location.z - target.z });
  const preferred = { x: Math.round(away.x * 2), z: Math.round(away.z * 2) };
  const offsets = [
    ...(preferred.x !== 0 || preferred.z !== 0 ? [preferred] : []),
    { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 }
  ];
  for (const offset of offsets) {
    const column = { x: base.x + offset.x, y: base.y, z: base.z + offset.z };
    if (pillarFailureCount(brain, hunter.dimension.id, column) >= 2) continue;
    if (!hasStandingSpace(hunter.dimension, column, false)) continue;
    if (runner && runner.dimension.id === hunter.dimension.id && horizontalDistance(column, runner.location) < 1.8) continue;
    if (adjacentLavaCount(hunter.dimension, column) > 0) continue;
    return column;
  }
  return undefined;
}

export function createPillarPlan(hunter, runner, brain, target, heightDifference) {
  const levels = Math.max(1, Math.min(18, Math.ceil(heightDifference)));
  const blocks = countAny(hunter, BUILDING_ITEMS);
  const reserve = 4;
  brain.verticalBlockRequirement = levels + reserve;
  if (blocks < levels + reserve) {
    brain.needsBuildingBlocksUntil = system.currentTick + 20 * 60;
    brain.needsBuildingBlocksReason = `last-resort pillar needs ${levels + reserve} blocks but only ${blocks} are available`;
    return false;
  }
  const column = safePillarColumn(hunter, runner, brain, target);
  if (!column) return false;
  const steps = [{ type: "move", location: { x: column.x + 0.5, y: column.y, z: column.z + 0.5 }, reason: "move sideways before pillaring", maxTicks: 160, metadata: { threshold: 0.55 } }];
  const placed = [];
  for (let index = 0; index < levels; index++) {
    const location = { x: column.x, y: column.y + index, z: column.z };
    steps.push({
      type: "pillar",
      location,
      expectedY: column.y + index + 1,
      reason: "jump and place one verified block beneath the hunter",
      maxTicks: 160,
      metadata: { purpose: "pillar", column: { x: column.x, z: column.z }, routeTarget: { ...target } }
    });
    placed.push(location);
  }
  const key = routeKey(brain, hunter.dimension.id, column, "pillar");
  brain.routeKey = key;
  brain.verticalMode = "last-resort pillar";
  brain.verticalTraversalUntil = system.currentTick + 20 * 150;
  brain.verticalBestY = hunter.location.y;
  brain.lastVerticalProgressTick = system.currentTick;
  brain.pillarTask = { column, levels, placed, target: { ...target } };
  createActionPlan(brain, "vertical_pillar", `climb ${levels} blocks after safer routes failed`, steps, { routeKey: key, placed, column }, 20 * 150);
  recordWork(brain, "plan", 1);
  return true;
}

export function createBreakRunnerPillarPlan(hunter, runner, brain, perception) {
  const info = perception?.runnerPillar;
  if (!info?.height || !perception.trueRunnerLocation) return false;
  const column = floorLocation(perception.trueRunnerLocation);
  const baseY = Math.max(Math.floor(hunter.location.y), column.y - info.height);
  let selected;
  for (let y = baseY; y < column.y; y++) {
    const location = { x: column.x, y, z: column.z };
    const block = safeGetBlock(hunter.dimension, location);
    if (!isBreakableBlock(block) || isFallingBlock(block) || !canMineBlock(hunter, block.typeId, true)) continue;
    if (distance(hunter.location, location) > 8) continue;
    selected = location;
    break;
  }
  if (!selected) return false;
  const away = normalizeXZ({ x: hunter.location.x - column.x, y: 0, z: hunter.location.z - column.z });
  const staging = { x: selected.x + (Math.round(away.x) || 1) + 0.5, y: hunter.location.y, z: selected.z + Math.round(away.z) + 0.5 };
  if (!hasStandingSpace(hunter.dimension, staging, false)) return false;
  createActionPlan(brain, "break_runner_pillar", "remove the runner's narrow tower from a safe side position", [
    { type: "move", location: staging, reason: "stand aside from falling blocks and the runner", maxTicks: 180, metadata: { threshold: 0.7 } },
    { type: "break", location: selected, reason: "mine the lowest safe pillar block", maxTicks: 300, metadata: { emergency: true, allowBelow: false, staging } }
  ], { column, selected }, 20 * 60);
  brain.verticalMode = "breaking runner pillar";
  brain.verticalTraversalUntil = system.currentTick + 20 * 40;
  return true;
}

function rememberedDescentPath(hunter, brain) {
  if (!brain?.placedBlocks?.size) return [];
  const current = hunter.location;
  const candidates = [];
  for (const key of brain.placedBlocks) {
    const parsed = parseLocationKey(key);
    if (!parsed || parsed.dimensionId !== hunter.dimension.id) continue;
    const meta = brain.placedBlockMeta.get(key);
    if (!["stair", "spiral", "pillar", "bridge"].includes(meta?.purpose)) continue;
    const feet = { x: parsed.location.x + 0.5, y: parsed.location.y + 1, z: parsed.location.z + 0.5 };
    if (feet.y > current.y + 0.7 || feet.y < current.y - 24) continue;
    if (horizontalDistance(current, feet) > 18) continue;
    if (!hasStandingSpace(hunter.dimension, feet, false)) continue;
    candidates.push(feet);
  }
  candidates.sort((a, b) => b.y - a.y || horizontalDistance(current, a) - horizontalDistance(current, b));
  const path = [];
  let previous = current;
  for (const candidate of candidates) {
    const dy = previous.y - candidate.y;
    const dxz = horizontalDistance(previous, candidate);
    if (dy < -0.2 || dy > 1.6 || dxz > 2.2) continue;
    path.push(candidate);
    previous = candidate;
    if (path.length >= 18) break;
  }
  return path;
}

function safeDescentTarget(hunter, brain, target) {
  const base = floorLocation(hunter.location);
  const candidates = [];
  for (const direction of [...CARDINALS, ...DIAGONALS]) {
    for (let step = 1; step <= 5; step++) {
      for (let drop = 1; drop <= 4; drop++) {
        const location = { x: base.x + direction.x * step, y: base.y - drop, z: base.z + direction.z * step };
        if (!hasStandingSpace(hunter.dimension, location, false)) continue;
        const key = locationKey(location, hunter.dimension.id);
        const cost = drop * 12 + step * 4 + routeMemoryPenalty(brain, key) + adjacentHazardCount(hunter.dimension, location) * 50 + horizontalDistance(location, target);
        candidates.push({ location, cost });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0]?.location;
}

export function createDescentPlan(hunter, brain, target) {
  const remembered = rememberedDescentPath(hunter, brain);
  if (remembered.length >= 2) {
    const steps = remembered.map((location) => ({
      type: "move",
      location,
      reason: "reverse the remembered hunter-built staircase",
      maxTicks: 180,
      metadata: { threshold: 0.82 }
    }));
    createActionPlan(brain, "safe_descent", "reuse the successful ascent route in reverse", steps, { target: { ...target }, reusedRoute: true }, 20 * 70);
    brain.verticalMode = "reverse staircase descent";
    brain.descentPlan = { target: remembered[remembered.length - 1], startedTick: system.currentTick };
    return true;
  }
  const safe = safeDescentTarget(hunter, brain, target);
  if (!safe) return false;
  const drop = Math.max(1, Math.floor(hunter.location.y - safe.y));
  if (drop > 3) return false;
  createActionPlan(brain, "safe_descent", "leave the high route without a lethal fall", [
    { type: "move", location: { x: safe.x + 0.5, y: safe.y, z: safe.z + 0.5 }, reason: "descend through a verified safe slope", maxTicks: 220, metadata: { threshold: 0.9 } }
  ], { target: { ...target } }, 20 * 40);
  brain.verticalMode = "safe slope descent";
  brain.descentPlan = { target: safe, startedTick: system.currentTick };
  return true;
}

function naturalClimbTarget(hunter, brain, target) {
  const base = floorLocation(hunter.location);
  const candidates = [];
  const directions = [...CARDINALS, ...DIAGONALS];
  for (const direction of directions) {
    for (let step = 1; step <= 4; step++) {
      for (const rise of [1, 0, 2, -1]) {
        const location = { x: base.x + direction.x * step, y: base.y + rise, z: base.z + direction.z * step };
        if (!hasStandingSpace(hunter.dimension, location, false)) continue;
        const below = safeGetBlock(hunter.dimension, { x: location.x, y: location.y - 1, z: location.z });
        if (!isSolidSupport(below) || isHazardBlock(below) || adjacentHazardCount(hunter.dimension, location) > 0) continue;
        const key = locationKey(location, hunter.dimension.id);
        if ((brain.routeBlacklist.get(key) ?? 0) > system.currentTick) continue;
        const progress = horizontalDistance(base, target) - horizontalDistance(location, target);
        const verticalProgress = location.y - base.y;
        const cost = step * 4 - progress * 7 - verticalProgress * 10 + routeMemoryPenalty(brain, key);
        candidates.push({ location, cost, key });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

export function tickVerticalPursuit(hunter, runner, brain, config, perception, target) {
  const active = tickActionPlan(hunter, runner, brain, config);
  if (active.active) return active;
  const height = Math.max(0, Math.ceil(perception.verticalDifference));
  if (height < 2) return { active: false };

  // Natural terrain and remembered safe routes always win over construction.
  // This prevents the old behavior where any uphill runner caused random
  // blocks to appear even though a hill or staircase was already reachable.
  const natural = naturalClimbTarget(hunter, brain, target);
  if (natural && natural.location.y >= Math.floor(hunter.location.y) + 1) {
    brain.routeKey = natural.key;
    brain.verticalMode = "natural hill / remembered route";
    setWaypoint(hunter, brain, { x: natural.location.x + 0.5, y: natural.location.y, z: natural.location.z + 0.5 }, "using natural terrain before building");
    return { active: true, action: "using a natural climb route" };
  }

  const antiCheeseVertical = perception.runnerPattern === "towering" || perception.runnerPattern === "tree_camp";
  // Give native pathfinding time to find a longer hill route. Building is
  // activated only for a detected tower/tree camp or a verified path failure.
  if (!antiCheeseVertical && perception.stuckTicks < 35) return { active: false };
  if (perception.runnerHorizontalDistance > 14) return { active: false };

  if (perception.runnerPattern === "towering" && perception.runnerPillar?.height >= 3 && horizontalDistance(hunter.location, perception.trueRunnerLocation) < 7) {
    if (createBreakRunnerPillarPlan(hunter, runner, brain, perception)) return { active: true, action: "breaking the runner's pillar" };
  }
  if (createDiagonalStairPlan(hunter, brain, target, height)) return { active: true, action: "building a diagonal staircase" };
  if (createSpiralStairPlan(hunter, brain, target, height)) return { active: true, action: "building a spiral staircase" };
  if (createPillarPlan(hunter, runner, brain, target, height)) return { active: true, action: "using a last-resort offset pillar" };
  brain.needsBuildingBlocksUntil = system.currentTick + 20 * 45;
  brain.needsBuildingBlocksReason = `no safe vertical route; gather ${height + 4} blocks and replan`;
  return { active: false, needBlocks: true };
}

export function tickDescent(hunter, runner, brain, config, perception, target) {
  const active = tickActionPlan(hunter, runner, brain, config);
  if (active.active) return active;
  if (createDescentPlan(hunter, brain, target)) return { active: true, action: "planning a safe descent" };
  return { active: false };
}

export function tickBreakPillar(hunter, runner, brain, config, perception) {
  const active = tickActionPlan(hunter, runner, brain, config);
  if (active.active) return active;
  if (createBreakRunnerPillarPlan(hunter, runner, brain, perception)) return { active: true, action: "breaking the runner's pillar" };
  return { active: false };
}

function obstacleAhead(hunter, target, distanceBlocks = 1) {
  const base = floorLocation(hunter.location);
  const direction = cardinalToward(base, target);
  const location = { x: base.x + direction.x * distanceBlocks, y: base.y, z: base.z + direction.z * distanceBlocks };
  return {
    direction,
    location,
    feet: safeGetBlock(hunter.dimension, location),
    head: safeGetBlock(hunter.dimension, { x: location.x, y: location.y + 1, z: location.z }),
    above: safeGetBlock(hunter.dimension, { x: location.x, y: location.y + 2, z: location.z }),
    below: safeGetBlock(hunter.dimension, { x: location.x, y: location.y - 1, z: location.z })
  };
}

function createObstacleBreakPlan(hunter, brain, target) {
  const obstacle = obstacleAhead(hunter, target);
  let blockLocation;
  if (!isPassableBlock(obstacle.feet, true) && isBreakableBlock(obstacle.feet)) blockLocation = obstacle.location;
  else if (!isPassableBlock(obstacle.head, true) && isBreakableBlock(obstacle.head)) blockLocation = { x: obstacle.location.x, y: obstacle.location.y + 1, z: obstacle.location.z };
  if (!blockLocation) return false;
  const block = safeGetBlock(hunter.dimension, blockLocation);
  if (!canMineBlock(hunter, block.typeId, true)) return false;
  createActionPlan(brain, "clear_obstacle", "mine a two-block-high route instead of placing random blocks", [
    { type: "break", location: blockLocation, reason: "clear the first blocking block", maxTicks: 260, metadata: { emergency: true } },
    ...(!isPassableBlock(obstacle.head, true) && blockLocation.y === obstacle.location.y ? [{ type: "break", location: { x: obstacle.location.x, y: obstacle.location.y + 1, z: obstacle.location.z }, reason: "clear head space for a two-block tunnel", maxTicks: 260, metadata: { emergency: true } }] : [])
  ], { target: { ...target } }, 20 * 45);
  return true;
}

function tryStepJump(hunter, brain, target) {
  const obstacle = obstacleAhead(hunter, target);
  if (!isSolidSupport(obstacle.feet) || !isPassableBlock(obstacle.head, false) || !isPassableBlock(obstacle.above, false)) return false;
  if (!hunter.isOnGround || system.currentTick - brain.lastJumpTick < 14) return false;
  const direction = normalizeXZ({ x: target.x - hunter.location.x, y: 0, z: target.z - hunter.location.z });
  safeApplyImpulse(hunter, { x: direction.x * 0.09, y: 0.33, z: direction.z * 0.09 });
  brain.lastJumpTick = system.currentTick;
  incrementStat(hunter, "manhunt:route_jumps", 1);
  setRouteStatus(hunter, brain, "jumping over a one-block obstacle", target, "jump");
  return true;
}

function isNetherDimension(dimension) {
  return String(dimension?.id ?? "").includes("nether");
}

function estimateFallTicks(distanceToGround, initialVelocityY) {
  const distanceRemaining = Math.max(0, Number(distanceToGround) || 0);
  let travelled = 0;
  let velocityY = Number.isFinite(initialVelocityY) ? initialVelocityY : -0.3;
  for (let tick = 1; tick <= 40; tick++) {
    // Close approximation of vanilla entity fall acceleration and drag. The
    // final landing block is rescanned every server tick, so small differences
    // cannot accumulate into a late MLG.
    velocityY = (velocityY - 0.08) * 0.98;
    travelled += Math.max(0, -velocityY);
    if (travelled >= distanceRemaining) return tick;
  }
  return 40;
}

function projectedHorizontal(hunter, velocity, ticks, fraction = 1) {
  let x = hunter.location.x;
  let z = hunter.location.z;
  let vx = Number(velocity?.x) || 0;
  let vz = Number(velocity?.z) || 0;
  const steps = Math.max(0, Math.round(ticks * fraction));
  for (let tick = 0; tick < steps; tick++) {
    x += vx;
    z += vz;
    vx *= 0.91;
    vz *= 0.91;
  }
  return { x, z };
}

function landingInColumn(hunter, x, z, maximumDepth = 80) {
  const blockX = Math.floor(x);
  const blockZ = Math.floor(z);
  const startY = Math.floor(hunter.location.y) - 1;
  for (let depth = 0; depth <= maximumDepth; depth++) {
    const supportLocation = { x: blockX, y: startY - depth, z: blockZ };
    const support = safeGetBlock(hunter.dimension, supportLocation);
    if (!support) continue;
    if (isLavaBlock(support) || isHazardBlock(support)) return undefined;
    if (!isSolidSupport(support)) continue;
    const landing = { x: blockX, y: supportLocation.y + 1, z: blockZ };
    const feet = safeGetBlock(hunter.dimension, landing);
    const head = safeGetBlock(hunter.dimension, { x: blockX, y: landing.y + 1, z: blockZ });
    if ((isAirBlock(feet) || isWaterBlock(feet)) && isPassableBlock(head, true)) return landing;
    return undefined;
  }
  return undefined;
}

function predictedLandingLocation(hunter, perception, velocity) {
  const impactTicks = estimateFallTicks(perception.groundDistance, velocity?.y);
  const projected = projectedHorizontal(hunter, velocity, impactTicks, 1);
  const columns = [];
  const addColumn = (position) => {
    const key = `${Math.floor(position.x)}|${Math.floor(position.z)}`;
    if (!columns.some((entry) => entry.key === key)) columns.push({ key, x: position.x, z: position.z });
  };
  addColumn(projected);
  addColumn(projectedHorizontal(hunter, velocity, impactTicks, 0.72));
  addColumn(projectedHorizontal(hunter, velocity, impactTicks, 0.42));
  addColumn(hunter.location);
  for (const offset of CARDINALS) addColumn({ x: projected.x + offset.x, z: projected.z + offset.z });

  const candidates = [];
  const maximumDepth = Math.max(12, Math.min(80, Math.ceil(Math.max(0, perception.groundDistance)) + 22));
  for (const column of columns) {
    const landing = landingInColumn(hunter, column.x, column.z, maximumDepth);
    if (!landing) continue;
    const center = { x: landing.x + 0.5, y: landing.y, z: landing.z + 0.5 };
    const score = horizontalDistance(center, projected) + horizontalDistance(center, hunter.location) * 0.03;
    candidates.push({ landing, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.landing;
}

function sameBlockLocation(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.z === b.z);
}

function placeOrMoveMlgWater(hunter, brain, landing) {
  if (!landing || isNetherDimension(hunter.dimension)) return false;
  const targetBlock = safeGetBlock(hunter.dimension, landing);
  if (!targetBlock || (!isAirBlock(targetBlock) && !isWaterBlock(targetBlock))) return false;

  const existing = brain.mlgWater;
  if (existing?.dimensionId === hunter.dimension.id) {
    const oldBlock = safeGetBlock(hunter.dimension, existing.location);
    const oldIsWater = isWaterBlock(oldBlock);
    if (sameBlockLocation(existing.location, landing) && oldIsWater) return true;
    if (system.currentTick - (brain.lastMlgAdjustTick ?? -99999) < 1) return oldIsWater;
    brain.lastMlgAdjustTick = system.currentTick;

    // Natural water is world terrain, not a source the hunter owns. Never
    // remove it while correcting a later landing prediction.
    if (existing.natural === true) {
      if (isWaterBlock(targetBlock)) {
        brain.mlgWater = { dimensionId: hunter.dimension.id, location: { ...landing }, placedTick: existing.placedTick ?? system.currentTick, natural: true };
        brain.mlgTarget = { ...landing };
        return true;
      }
      brain.mlgWater = undefined;
      brain.mlgTarget = undefined;
      return placeOrMoveMlgWater(hunter, brain, landing);
    }

    if (oldIsWater) safeSetBlockType(hunter.dimension, existing.location, "minecraft:air");
    if (isWaterBlock(targetBlock) || safeSetBlockType(hunter.dimension, landing, "minecraft:water")) {
      brain.mlgWater = { ...existing, location: { ...landing }, placedTick: existing.placedTick ?? system.currentTick };
      brain.mlgTarget = { ...landing };
      return true;
    }
    if (oldIsWater) safeSetBlockType(hunter.dimension, existing.location, "minecraft:water");
    return false;
  }

  if (isWaterBlock(targetBlock)) {
    brain.mlgWater = { dimensionId: hunter.dimension.id, location: { ...landing }, placedTick: system.currentTick, natural: true };
    brain.mlgTarget = { ...landing };
    return true;
  }
  if (countItem(hunter, "minecraft:water_bucket") < 1 || !removeItem(hunter, "minecraft:water_bucket", 1)) return false;
  if (!safeSetBlockType(hunter.dimension, landing, "minecraft:water")) {
    addItem(hunter, "minecraft:water_bucket", 1);
    return false;
  }
  addItem(hunter, "minecraft:bucket", 1);
  brain.mlgWater = { dimensionId: hunter.dimension.id, location: { ...landing }, placedTick: system.currentTick, natural: false };
  brain.mlgTarget = { ...landing };
  return true;
}

export function tickFallWaterRecovery(hunter, brain) {
  const placed = brain?.mlgWater;
  if (!placed) return false;
  if (system.currentTick - (placed.placedTick ?? 0) > 20 * 20) {
    brain.mlgWater = undefined;
    return false;
  }
  if (placed.dimensionId !== hunter.dimension.id || hunter.isFalling) return false;
  if (distance(hunter.location, placed.location) > 5.5) return false;
  const block = safeGetBlock(hunter.dimension, placed.location);
  if (!isWaterBlock(block)) {
    brain.mlgWater = undefined;
    return false;
  }
  if (placed.natural === true) {
    brain.mlgWater = undefined;
    brain.mlgTarget = undefined;
    return true;
  }
  if (countItem(hunter, "minecraft:bucket") < 1) return false;
  if (!removeItem(hunter, "minecraft:bucket", 1)) return false;
  if (!safeSetBlockType(hunter.dimension, placed.location, "minecraft:air")) {
    addItem(hunter, "minecraft:bucket", 1);
    return false;
  }
  if (!addItem(hunter, "minecraft:water_bucket", 1)) {
    safeSetBlockType(hunter.dimension, placed.location, "minecraft:water");
    addItem(hunter, "minecraft:bucket", 1);
    return false;
  }
  brain.mlgWater = undefined;
  brain.mlgTarget = undefined;
  brain.holdMainhandItem = "minecraft:water_bucket";
  brain.holdMainhandUntilTick = system.currentTick + 10;
  equipMainhand(hunter, "minecraft:water_bucket");
  brain.lastSuccessfulAction = "recovered the water bucket after the MLG";
  return true;
}

export function tickFallSafety(hunter, runner, brain, config, perception) {
  if (!perception.falling || perception.groundDistance < 2) return false;
  const activeWater = brain.mlgWater?.dimensionId === hunter.dimension.id;
  if (!activeWater && system.currentTick - (brain.lastFallSaveTick ?? -99999) < 24) return false;
  if (system.currentTick === (brain.lastFallSaveAttemptTick ?? -99999)) return false;
  brain.lastFallSaveAttemptTick = system.currentTick;

  const base = floorLocation(hunter.location);
  let velocity = perception.velocity;
  if (!velocity) {
    try { velocity = hunter.getVelocity(); } catch { velocity = { x: 0, y: -0.3, z: 0 }; }
  }
  const impactTicks = estimateFallTicks(perception.groundDistance, velocity.y);
  let landing = predictedLandingLocation(hunter, perception, velocity);
  if (!landing && perception.groundDistance <= 3.5) landing = landingInColumn(hunter, hunter.location.x, hunter.location.z, 8);

  if (!isNetherDimension(hunter.dimension) && landing && (activeWater || countItem(hunter, "minecraft:water_bucket") > 0)) {
    brain.holdMainhandItem = activeWater ? "minecraft:bucket" : "minecraft:water_bucket";
    brain.holdMainhandUntilTick = system.currentTick + 30;
    equipMainhand(hunter, brain.holdMainhandItem);

    // Wait until the fall is close enough for an accurate player-like clutch,
    // then keep correcting the water source every tick if horizontal momentum
    // changes the landing column.
    if (activeWater || impactTicks <= 16 || perception.groundDistance <= 20) {
      if (placeOrMoveMlgWater(hunter, brain, landing)) {
        brain.holdMainhandItem = brain.mlgWater?.natural ? "minecraft:water_bucket" : "minecraft:bucket";
        brain.holdMainhandUntilTick = system.currentTick + 30;
        equipMainhand(hunter, brain.holdMainhandItem);
        if (!activeWater) {
          incrementStat(hunter, "manhunt:mlg_saves", 1);
          brain.lastSuccessfulAction = "placed water before impact and began tracking the landing column";
        } else {
          brain.lastSuccessfulAction = "adjusted MLG water under the current fall trajectory";
        }
        brain.lastFallSaveTick = system.currentTick;
        clearActionPlan(brain, "fall water actively tracked");
        return true;
      }
    }
  }

  if (!activeWater && countAny(hunter, BUILDING_ITEMS) > 0 && perception.groundDistance <= 9) {
    const travelTicks = Math.max(1, Math.min(5, Math.ceil(Math.max(0, perception.groundDistance) / 2.5)));
    const projectedX = Math.floor(hunter.location.x + (velocity.x ?? 0) * travelTicks);
    const projectedZ = Math.floor(hunter.location.z + (velocity.z ?? 0) * travelTicks);
    const clutchCandidates = [];
    for (let depth = 2; depth <= 5; depth++) {
      clutchCandidates.push({ x: projectedX, y: Math.floor(hunter.location.y) - depth, z: projectedZ });
      clutchCandidates.push({ x: base.x, y: Math.floor(hunter.location.y) - depth, z: base.z });
    }
    const clutch = clutchCandidates.find((location) => {
      const block = safeGetBlock(hunter.dimension, location);
      return isAirBlock(block) && placementSupport(hunter.dimension, location, "clutch") && !placementWouldTrap(hunter, runner, location, "clutch");
    });
    if (clutch) {
      createActionPlan(brain, "fall_clutch", "place one emergency block below the projected fall path", [
        { type: "place", location: clutch, reason: "block clutch", maxTicks: 25, metadata: { purpose: "clutch", routeTarget: clutch } }
      ], {}, 30);
      const step = getCurrentStep(brain);
      const result = tickPlannedPlacement(hunter, runner, brain, config, step);
      if (result.completed) {
        brain.lastFallSaveTick = system.currentTick;
        incrementStat(hunter, "manhunt:block_clutches", 1);
        return true;
      }
    }
  }
  if (!activeWater) recordFall(brain, hunter.dimension.id, hunter.location, "no safe fall-save route was available");
  return false;
}

function bestWaterExit(perception) {
  return perception.airPocket ?? perception.shore;
}

export function tickWaterEscape(hunter, runner, brain, config, perception) {
  if (brain.actionPlan && brain.actionPlan.type !== "escape_water") {
    clearActionPlan(brain, "water escape overrides incompatible construction");
    brain.mineTask = undefined;
  }
  brain.verticalMode = "water escape";
  setRouteStatus(hunter, brain, "escaping water without placing solid blocks", perception.airPocket ?? perception.shore, "water");
  const exit = bestWaterExit(perception);
  if (exit) {
    setWaypoint(hunter, brain, { x: exit.x + 0.5, y: exit.y, z: exit.z + 0.5 }, perception.airPocket ? "swimming toward an air pocket" : "swimming toward shore");
    const direction = normalizeXZ({ x: exit.x - hunter.location.x, y: 0, z: exit.z - hunter.location.z });
    safeApplyImpulse(hunter, { x: direction.x * 0.035, y: perception.submerged ? 0.075 : 0.025, z: direction.z * 0.035 });
    return true;
  }
  const base = floorLocation(hunter.location);
  const options = [
    { x: base.x, y: base.y + 1, z: base.z },
    ...CARDINALS.map((offset) => ({ x: base.x + offset.x, y: base.y, z: base.z + offset.z })),
    ...CARDINALS.map((offset) => ({ x: base.x + offset.x, y: base.y + 1, z: base.z + offset.z }))
  ];
  const breakTarget = options.find((location) => {
    const block = safeGetBlock(hunter.dimension, location);
    return isBreakableBlock(block) && canMineBlock(hunter, block.typeId, true) && !isFallingBlock(safeGetBlock(hunter.dimension, { x: location.x, y: location.y + 1, z: location.z }));
  });
  if (breakTarget) {
    createActionPlan(brain, "escape_water", "open one controlled exit from the water enclosure", [
      { type: "break", location: breakTarget, reason: "mine the nearest safe air route", maxTicks: 300, metadata: { emergency: true, allowBelow: false } }
    ], {}, 20 * 30);
    tickActionPlan(hunter, runner, brain, config);
    return true;
  }
  safeApplyImpulse(hunter, { x: 0, y: 0.11, z: 0 });
  if (brain.underwaterTicks > 20 * 18 && config.emergencyRecovery) {
    const safe = perception.lastSeenLocation && hasStandingSpace(hunter.dimension, perception.lastSeenLocation, false) ? perception.lastSeenLocation : undefined;
    if (safe && distance(hunter.location, safe) < 24) {
      try { hunter.tryTeleport(safe, { dimension: hunter.dimension, checkForBlocks: true }); } catch { /* final fallback */ }
    }
  }
  return true;
}

export function tickLavaEscape(hunter, runner, brain, config, perception) {
  clearActionPlan(brain, "lava escape overrides the previous route");
  setRouteStatus(hunter, brain, "escaping lava or fire", perception.shore, "lava");
  if (countItem(hunter, "minecraft:water_bucket") > 0 && hunter.dimension.id !== "minecraft:nether") {
    const base = floorLocation(hunter.location);
    const candidates = [base, ...CARDINALS.map((offset) => ({ x: base.x + offset.x, y: base.y, z: base.z + offset.z }))];
    const location = candidates.find((entry) => isAirBlock(safeGetBlock(hunter.dimension, entry)) || isLavaBlock(safeGetBlock(hunter.dimension, entry)));
    if (location) {
      createActionPlan(brain, "escape_lava", "extinguish fire and solidify a safe route", [
        { type: "place_water", location, reason: "use the water bucket", maxTicks: 30, metadata: { purpose: "lava_water" } }
      ], {}, 40);
      let removedWater = false;
      if (authorizeAction(brain, "place_water", location)) {
        removedWater = removeItem(hunter, "minecraft:water_bucket", 1);
        if (removedWater && safeSetBlockType(hunter.dimension, location, "minecraft:water")) {
          addItem(hunter, "minecraft:bucket", 1);
          clearActionPlan(brain, "water extinguished lava hazard");
          try { hunter.extinguishFire(true); } catch { /* optional */ }
          return true;
        }
      }
      if (removedWater) addItem(hunter, "minecraft:water_bucket", 1);
      clearActionPlan(brain, "water placement failed");
    }
  }
  const target = perception.shore ?? nearbySafeLane(hunter, brain, perception.trueRunnerLocation ?? hunter.location, 4)?.location;
  if (target) {
    setWaypoint(hunter, brain, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }, "moving away from lava");
    const direction = normalizeXZ({ x: target.x - hunter.location.x, y: 0, z: target.z - hunter.location.z });
    safeApplyImpulse(hunter, { x: direction.x * 0.065, y: 0.05, z: direction.z * 0.065 });
    return true;
  }
  return true;
}

export function tickTrapEscape(hunter, brain, config, perception) {
  if (perception.trapType === "water enclosure") return false;
  const active = tickActionPlan(hunter, undefined, brain, config);
  if (active.active) return true;
  const base = floorLocation(hunter.location);
  const candidates = [];
  for (const offset of [{ x: 0, y: 1, z: 0 }, ...CARDINALS, ...CARDINALS.map((entry) => ({ x: entry.x, y: 1, z: entry.z }))]) {
    const location = { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
    const block = safeGetBlock(hunter.dimension, location);
    if (!isBreakableBlock(block) || !canMineBlock(hunter, block.typeId, true)) continue;
    if (isFallingBlock(safeGetBlock(hunter.dimension, { x: location.x, y: location.y + 1, z: location.z }))) continue;
    const score = adjacentLavaCount(hunter.dimension, location) * 100 + (location.y > base.y ? -12 : 0);
    candidates.push({ location, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const selected = candidates[0]?.location;
  if (!selected) return false;
  createActionPlan(brain, "escape_trap", `escape ${perception.trapType}`, [
    { type: "break", location: selected, reason: "mine the weakest safe exit", maxTicks: 320, metadata: { emergency: true, allowBelow: false } }
  ], {}, 20 * 35);
  tickActionPlan(hunter, undefined, brain, config);
  return true;
}

export function tickStuckRecovery(hunter, runner, brain, config, perception, target) {
  if (perception.verticalTraversalActive && system.currentTick - (brain.lastVerticalProgressTick ?? system.currentTick) < 100) return false;
  if (brain.actionPlan) {
    const failedKey = brain.routeKey;
    if (failedKey) recordRouteOutcome(brain, failedKey, brain.actionPlan.type, false, { reason: "stuck during active plan", danger: 1 });
    clearActionPlan(brain, "stuck recovery requested a different route");
    brain.routeFailures++;
  }
  const recent = brain.recentPositions.filter((entry) => system.currentTick - entry.tick < 20 * 20);
  const backtrack = [...recent].reverse().find((entry) => distance(entry, hunter.location) > 2 && hasStandingSpace(hunter.dimension, entry, false));
  if (backtrack && system.currentTick - brain.lastBacktrackTick > 80) {
    brain.lastBacktrackTick = system.currentTick;
    setWaypoint(hunter, brain, backtrack, "backtracking to the last successful route point");
    brain.stuckTicks = Math.max(0, brain.stuckTicks - 50);
    return true;
  }
  if (createObstacleBreakPlan(hunter, brain, target)) {
    tickActionPlan(hunter, runner, brain, config);
    return true;
  }
  const lane = nearbySafeLane(hunter, brain, target, 4);
  if (lane) {
    setWaypoint(hunter, brain, lane.location, `trying alternate ${lane.direction.name} route after repeated failure`);
    brain.stuckTicks = Math.max(0, brain.stuckTicks - 40);
    return true;
  }
  if (perception.stuckTicks > 20 * 18 && config.emergencyRecovery && system.currentTick - brain.lastEmergencyTick > 20 * 30) {
    brain.lastEmergencyTick = system.currentTick;
    const near = nearbySafeLane(hunter, brain, target, 6)?.location;
    if (near) try { hunter.tryTeleport({ x: near.x + 0.5, y: near.y, z: near.z + 0.5 }, { dimension: hunter.dimension, checkForBlocks: true, facingLocation: target }); } catch { /* final fallback */ }
  }
  return false;
}

function resourceApproachLocation(hunter, blockTarget) {
  const base = floorLocation(blockTarget);
  const candidates = [
    ...CARDINALS.map((offset) => ({ x: base.x + offset.x, y: base.y, z: base.z + offset.z })),
    ...DIAGONALS.map((offset) => ({ x: base.x + offset.x, y: base.y, z: base.z + offset.z })),
    ...CARDINALS.map((offset) => ({ x: base.x + offset.x, y: base.y + 1, z: base.z + offset.z }))
  ];
  const valid = candidates
    .filter((location) => hasStandingSpace(hunter.dimension, location, false))
    .sort((a, b) => distance(hunter.location, a) - distance(hunter.location, b));
  const chosen = valid[0];
  return chosen ? { x: chosen.x + 0.5, y: chosen.y, z: chosen.z + 0.5 } : { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 };
}

export function tickResourceNavigation(hunter, runner, brain, config, perception, blockTarget, category) {
  if (!blockTarget) return false;
  const distanceTo = distance(hunter.location, blockTarget);
  if (distanceTo <= 3.1) return false;
  // The old implementation briefly activated a generic move_to_block goal
  // before spawning the exact waypoint. On busy terrain that native goal could
  // acquire a different log/ore and pull the hunter away from the brain-owned
  // target. The waypoint is now the sole movement owner for scripted resource
  // work.
  const approach = brain.resourceApproach ?? resourceApproachLocation(hunter, blockTarget);
  setWaypoint(hunter, brain, approach, `approaching the exact planned ${category} target`);
  return true;
}

function activeBoat(brain) {
  if (!brain?.activeBoatId) return undefined;
  try { return world.getEntity(brain.activeBoatId); } catch { return undefined; }
}

function waterPlacementNear(hunter) {
  const base = floorLocation(hunter.location);
  const offsets = [
    { x: 0, z: 0 },
    ...CARDINALS.map(({ x, z }) => ({ x, z })),
    ...DIAGONALS.map(({ x, z }) => ({ x, z })),
    ...CARDINALS.map(({ x, z }) => ({ x: x * 2, z: z * 2 }))
  ];
  for (const offset of offsets) {
    const water = { x: base.x + offset.x, y: base.y - (perceptionWaterLevel(hunter) ? 0 : 1), z: base.z + offset.z };
    const block = safeGetBlock(hunter.dimension, water);
    const above = safeGetBlock(hunter.dimension, { x: water.x, y: water.y + 1, z: water.z });
    if (isWaterBlock(block) && isPassableBlock(above, true) && adjacentLavaCount(hunter.dimension, water) === 0) {
      return { x: water.x + 0.5, y: water.y + 1.05, z: water.z + 0.5 };
    }
  }
  return undefined;
}

function perceptionWaterLevel(hunter) {
  const feet = safeGetBlock(hunter.dimension, floorLocation(hunter.location));
  return isWaterBlock(feet);
}

function dismountBoat(hunter, brain, boat, removeBoat = false) {
  try { boat?.getComponent("minecraft:rideable")?.ejectRider(hunter); } catch { /* optional */ }
  if (removeBoat) { try { boat?.remove(); } catch { /* already gone */ } }
  brain.activeBoatId = "";
  brain.boatNoProgressTicks = 0;
}

function driveBoat(hunter, runner, brain, boat, perception) {
  if (!isEntityValid(boat) || boat.dimension.id !== hunter.dimension.id) {
    brain.activeBoatId = "";
    return false;
  }
  try {
    const riders = boat.getComponent("minecraft:rideable")?.getRiders?.() ?? [];
    if (!riders.some((entity) => entity.id === hunter.id)) {
      brain.activeBoatId = "";
      brain.boatNoProgressTicks = 0;
      return false;
    }
  } catch {
    brain.activeBoatId = "";
    return false;
  }
  const target = perception?.runnerLocation ?? brain.lastSeenLocation ?? runner?.location;
  if (!target) return true;
  const toTarget = normalizeXZ({ x: target.x - boat.location.x, y: 0, z: target.z - boat.location.z });
  const before = brain.lastBoatLocation;
  const moved = before ? horizontalDistance(before, boat.location) : 1;
  brain.boatNoProgressTicks = moved < 0.03 ? (brain.boatNoProgressTicks ?? 0) + 5 : 0;
  brain.lastBoatLocation = { ...boat.location };
  const strength = brain.boatNoProgressTicks > 40 ? 0.11 : 0.072;
  safeApplyImpulse(boat, { x: toTarget.x * strength, y: 0, z: toTarget.z * strength });
  try { boat.setRotation({ x: 0, y: Math.atan2(-toTarget.x, toTarget.z) * 180 / Math.PI }); } catch { /* visual only */ }
  brain.lastSuccessfulAction = "steered a boat toward the runner's expected shore";

  const distanceToRunner = runner && runner.dimension.id === hunter.dimension.id ? distance(boat.location, runner.location) : Number.POSITIVE_INFINITY;
  const below = safeGetBlock(hunter.dimension, { x: Math.floor(boat.location.x), y: Math.floor(boat.location.y) - 1, z: Math.floor(boat.location.z) });
  const shoreReached = !isWaterBlock(below) && distanceToRunner < 10;
  if (distanceToRunner < 5 || shoreReached || brain.boatNoProgressTicks > 100) {
    dismountBoat(hunter, brain, boat, false);
    safeTrigger(hunter, "manhunt:chase");
  }
  return true;
}

export function tickBoatHandling(hunter, runner, brain, config, perception, allowPlanning = false) {
  const ownBoat = activeBoat(brain);
  if (ownBoat && driveBoat(hunter, runner, brain, ownBoat, perception)) return true;
  if (brain.activeBoatId && !ownBoat) {
    brain.activeBoatId = "";
    brain.boatNoProgressTicks = 0;
    brain.lastBoatLocation = undefined;
  }
  if (!allowPlanning) return false;

  // Counter an occupied runner boat only when configured. Do not randomly
  // destroy every nearby boat; the target must match the detected escape plan.
  const nearby = perception?.nearbyBoat;
  if (nearby && config.destroyBoats && perception.runnerPattern === "boat_escape" && system.currentTick - brain.lastBoatBreakTick >= 40) {
    try {
      const riders = nearby.getComponent("minecraft:rideable")?.getRiders?.() ?? [];
      if (riders.some((entity) => entity.id === runner?.id) && distance(hunter.location, nearby.location) <= 3.2) {
        nearby.kill();
        brain.lastBoatBreakTick = system.currentTick;
        incrementStat(hunter, "manhunt:boats_destroyed", 1);
        return true;
      }
    } catch { /* use a personal boat instead */ }
  }

  if (perception?.runnerPattern !== "boat_escape" || system.currentTick - brain.lastBoatDeployTick < 40) return false;
  if (countItem(hunter, "minecraft:oak_boat") < 1) {
    const current = getCurrentStep(brain);
    if (!current || current.type !== "craft_boat") {
      createActionPlan(brain, "craft_boat", "craft a boat specifically for the detected ocean escape", [
        { type: "craft_boat", reason: "consume verified plank resources for one boat", maxTicks: 80 }
      ], {}, 100);
    }
    if (!authorizeAction(brain, "craft_boat")) return false;
    if (!craftEmergencyBoat(hunter)) {
      failActionStep(brain, "not enough processed planks or no crafting table for a boat");
      return false;
    }
    advanceActionStep(brain, "boat crafted for the active water route");
    return true;
  }
  const location = waterPlacementNear(hunter);
  if (!location) return false;
  const blockLocation = floorLocation(location);
  const current = getCurrentStep(brain);
  if (!current || current.type !== "use_boat" || locationKey(current.location) !== locationKey(blockLocation)) {
    createActionPlan(brain, "use_boat", "cross a large water route instead of swimming indefinitely", [
      { type: "use_boat", location: blockLocation, reason: "deploy and enter a boat on verified water", maxTicks: 100 }
    ], { target: perception.runnerLocation ?? brain.lastSeenLocation }, 120);
  }
  if (!authorizeAction(brain, "use_boat", blockLocation) || !withinBlockReach(hunter, blockLocation, 3.5)) return false;

  let boat;
  try {
    boat = hunter.dimension.spawnEntity("minecraft:boat", location);
    const rideable = boat.getComponent("minecraft:rideable");
    if (!rideable || !rideable.addRider(hunter)) throw new Error("boat rejected the hunter rider");
  } catch (error) {
    try { boat?.remove(); } catch { /* ignore */ }
    retryActionStep(brain, `boat deployment failed: ${error}`, 12);
    return false;
  }
  if (!removeItem(hunter, "minecraft:oak_boat", 1)) {
    dismountBoat(hunter, brain, boat, true);
    failActionStep(brain, "boat item disappeared before deployment");
    return false;
  }
  brain.activeBoatId = boat.id;
  brain.lastBoatDeployTick = system.currentTick;
  brain.lastBoatLocation = { ...boat.location };
  advanceActionStep(brain, "boat deployed and mounted");
  incrementStat(hunter, "manhunt:boats_used", 1);
  return true;
}

export function tickSearchRoute(hunter, brain, target) {
  if (!target) return false;
  if (distance(hunter.location, target) < 2.2) {
    removeWaypoint(brain);
    return false;
  }
  setWaypoint(hunter, brain, target, "searching the runner's last known route", true);
  return true;
}

export function tickRetreatRoute(hunter, runner, brain, perception) {
  const away = normalizeXZ({ x: hunter.location.x - runner.location.x, y: 0, z: hunter.location.z - runner.location.z });
  const base = floorLocation(hunter.location);
  const candidates = [];
  for (let step = 5; step >= 2; step--) {
    const location = { x: base.x + Math.round(away.x * step), y: base.y, z: base.z + Math.round(away.z * step) };
    if (hasStandingSpace(hunter.dimension, location, false) && adjacentHazardCount(hunter.dimension, location) === 0) candidates.push(location);
  }
  const target = candidates[0];
  if (!target) return false;
  setWaypoint(hunter, brain, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }, "retreating to eat safely");
  return true;
}

export function tickLongDistanceRoute(hunter, brain, target, action = "following the runner's trail") {
  if (!target) return false;
  if (horizontalDistance(hunter.location, target) < 1.8 && Math.abs(hunter.location.y - target.y) < 2.2) {
    removeWaypoint(brain);
    safeTrigger(hunter, "manhunt:idle");
    return false;
  }
  // Work goals must retain movement ownership. Falling back to native chase here
  // makes the hunter ignore the selected resource, portal, or exploration goal.
  const waypoint = setWaypoint(hunter, brain, target, action);
  if (!waypoint) {
    safeTrigger(hunter, "manhunt:idle");
    return false;
  }
  return true;
}

function nativeTerrainAssist(hunter, brain, perception, target) {
  if (!target || !perception?.onGround || perception.inWater || perception.inLava || perception.hazardNear) return false;
  if (system.currentTick - (brain.lastNativeAssistTick ?? -9999) < 4) return false;
  let velocity = { x: 0, y: 0, z: 0 };
  try { velocity = hunter.getVelocity(); } catch { /* use zero */ }
  const horizontalSpeed = Math.hypot(velocity.x ?? 0, velocity.z ?? 0);
  const obstacle = obstacleAhead(hunter, target);
  if (isSolidSupport(obstacle.feet) && isPassableBlock(obstacle.head, false) && isPassableBlock(obstacle.above, false)) {
    if (system.currentTick - brain.lastJumpTick >= 9) {
      const direction = normalizeXZ({ x: target.x - hunter.location.x, y: 0, z: target.z - hunter.location.z });
      safeApplyImpulse(hunter, { x: direction.x * 0.105, y: 0.36, z: direction.z * 0.105 });
      brain.lastJumpTick = system.currentTick;
      brain.lastNativeAssistTick = system.currentTick;
      return true;
    }
  }
  if (perception.actualRunnerDistance > 12 && horizontalSpeed < 0.075 && perception.stuckTicks >= 10 &&
      isPassableBlock(obstacle.feet, true) && isPassableBlock(obstacle.head, true) && isSolidSupport(obstacle.below)) {
    const direction = normalizeXZ({ x: target.x - hunter.location.x, y: 0, z: target.z - hunter.location.z });
    safeApplyImpulse(hunter, { x: direction.x * 0.045, y: 0.01, z: direction.z * 0.045 });
    brain.lastNativeAssistTick = system.currentTick;
    return true;
  }
  return false;
}

export function tickLocalNavigation(hunter, runner, brain, config, perception, target) {
  if (!target || !perception.sameDimension) return false;
  const active = tickActionPlan(hunter, runner, brain, config);
  if (active.active) return true;
  if (perception.inWater || perception.inLava || perception.enclosed) return false;

  nativeTerrainAssist(hunter, brain, perception, target);

  // Native target navigation is substantially faster across hills, leaves and
  // irregular terrain than repeatedly replacing it with short marker routes.
  // Give it a real progress window before invoking construction or detours.
  const confirmedTower = ["towering", "tree_camp"].includes(perception.runnerPattern);
  if (perception.verticalDifference > 2.8 && perception.runnerHorizontalDistance < 9 &&
      (confirmedTower || perception.stuckTicks >= 25)) {
    const vertical = tickVerticalPursuit(hunter, runner, brain, config, perception, target);
    if (vertical.active || vertical.needBlocks) return true;
  }
  if (perception.verticalDifference < -5 && horizontalDistance(hunter.location, target) < 12 && perception.stuckTicks >= 18) {
    const descent = tickDescent(hunter, runner, brain, config, perception, target);
    if (descent.active) return true;
  }

  const obstacle = obstacleAhead(hunter, target);
  const directFeetOpen = isPassableBlock(obstacle.feet, true);
  const directHeadOpen = isPassableBlock(obstacle.head, true);
  const directSupport = isSolidSupport(obstacle.below);
  if (directFeetOpen && directHeadOpen && directSupport && !isHazardBlock(obstacle.below)) {
    returnToChase(hunter, brain);
    return false;
  }

  if (tryStepJump(hunter, brain, target)) return true;

  // While the runner is far away, do not let a leaf, log or one awkward hill
  // replace the long-distance chase with a six-second local marker route.
  if (perception.actualRunnerDistance > 12 && perception.stuckTicks < 28) {
    returnToChase(hunter, brain);
    return false;
  }

  if (directFeetOpen && directHeadOpen && !directSupport && perception.stuckTicks >= 12) {
    if (createBridgePlan(hunter, brain, target)) {
      tickActionPlan(hunter, runner, brain, config);
      return true;
    }
  }
  if (perception.stuckTicks >= 24 && createObstacleBreakPlan(hunter, brain, target)) {
    tickActionPlan(hunter, runner, brain, config);
    return true;
  }
  if (perception.stuckTicks >= 30) {
    const lane = nearbySafeLane(hunter, brain, target, 3);
    if (lane && Number.isFinite(lane.cost)) {
      setWaypoint(hunter, brain, lane.location, `taking the safer ${lane.direction.name} route`, false, 36);
      return true;
    }
  }
  returnToChase(hunter, brain);
  return false;
}


function goalUsesNativeChase(goal) {
  return new Set([GOALS.CHASE, GOALS.ATTACK, GOALS.RANGED_ATTACK, GOALS.DEFEND, GOALS.IDLE]).has(goal);
}

export function tickWaypointLifecycle(hunter, brain) {
  processPlanOutcomes(hunter, brain);
  verifyPendingPlacement(hunter, brain);
  const waypoint = getWaypoint(brain);
  if (!waypoint) return;
  const reached = horizontalDistance(hunter.location, waypoint.location) <= 0.85 && Math.abs(hunter.location.y - waypoint.location.y) <= 1.6;
  if (reached || waypoint.dimension.id !== hunter.dimension.id || system.currentTick > (brain.routeExpiresTick ?? 0) || distance(hunter.location, waypoint.location) > 180) {
    removeWaypoint(brain);
    if (!brain.actionPlan) {
      if (goalUsesNativeChase(brain.currentGoal)) safeTrigger(hunter, "manhunt:chase");
      else safeTrigger(hunter, "manhunt:idle");
    }
  }
}

export function cleanupPlacedBlocks(brain) {
  if (!brain) return 0;
  let removed = 0;
  for (const key of [...brain.placedBlocks]) {
    const parsed = parseLocationKey(key);
    if (!parsed) continue;
    let dimension;
    try { dimension = world.getDimension(String(parsed.dimensionId || "overworld").replace("minecraft:", "")); } catch { continue; }
    const location = { ...parsed.location };
    const block = safeGetBlock(dimension, location);
    const meta = brain.placedBlockMeta.get(key);
    if (block && meta?.typeId === block.typeId && safeSetBlockType(dimension, location, "minecraft:air")) removed++;
    brain.placedBlocks.delete(key);
    brain.placedBlockMeta.delete(key);
  }
  return removed;
}

export function forceReplan(hunter, brain, reason = "developer forced replan") {
  if (!brain) return;
  if (brain.routeKey) recordRouteOutcome(brain, brain.routeKey, brain.actionPlan?.type ?? "route", false, { reason });
  clearActionPlan(brain, reason);
  removeWaypoint(brain);
  brain.mineTask = undefined;
  brain.pendingCombatStep = undefined;
  brain.routeFailures++;
  brain.stuckTicks = 0;
  brain.verticalPlan = undefined;
  brain.pillarTask = undefined;
  brain.descentPlan = undefined;
  brain.verticalMode = "none";
  if (hunter) {
    if (goalUsesNativeChase(brain.currentGoal)) returnToChase(hunter, brain);
    else safeTrigger(hunter, "manhunt:idle");
  }
}

export function getNavigationStatus(hunter, brain) {
  return {
    action: brain?.routeAction ?? "none",
    target: brain?.routeTarget,
    mode: brain?.routeMode ?? "none",
    activePlan: brain?.actionPlan ? `${brain.actionPlan.type} ${brain.actionPlan.cursor + 1}/${brain.actionPlan.steps.length}` : "none",
    lastSuccessfulAction: brain?.lastSuccessfulAction ?? "none",
    lastFailedAction: brain?.lastFailedAction ?? "none",
    stuckTicks: brain?.stuckTicks ?? 0,
    routeFailures: brain?.routeFailures ?? 0,
    routeMemory: brain?.routeMemory?.size ?? 0,
    failedPillars: brain?.failedPillars?.size ?? 0,
    fallsRemembered: brain?.fallMemory?.size ?? 0,
    verticalMode: brain?.verticalMode ?? "none",
    verticalBlocksRequired: brain?.verticalBlockRequirement ?? 0,
    jumps: Number(safeDynamicGet(hunter, "manhunt:route_jumps", 0)) || 0,
    blocksPlaced: Number(safeDynamicGet(hunter, "manhunt:route_blocks_placed", 0)) || 0,
    blocksBroken: Number(safeDynamicGet(hunter, "manhunt:route_blocks_broken", 0)) || 0,
    mlgSaves: Number(safeDynamicGet(hunter, "manhunt:mlg_saves", 0)) || 0,
    blockClutches: Number(safeDynamicGet(hunter, "manhunt:block_clutches", 0)) || 0,
    waypointId: brain?.waypointId ?? ""
  };
}
