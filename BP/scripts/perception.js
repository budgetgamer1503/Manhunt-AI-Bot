import { EquipmentSlot, system } from "@minecraft/server";
import { getEquipment, getSelectedItem, runnerHasShield } from "./inventory.js";
import {
  recordFall,
  rememberTerrain,
  rememberWaterTrap,
  rememberPosition
} from "./memory.js";
import {
  rememberDanger,
  rememberPortal,
  updateRunnerKnowledge
} from "./squad.js";
import {
  adjacentHazardCount,
  adjacentLavaCount,
  distance,
  floorLocation,
  hasLineOfSight,
  horizontalDistance,
  isAirBlock,
  isBreakableBlock,
  isHazardBlock,
  isLavaBlock,
  isPassableBlock,
  isPortalBlock,
  isSolidSupport,
  isWaterBlock,
  safeGetBlock,
  supportDepth
} from "./utils.js";

const CARDINALS = Object.freeze([
  { x: 1, y: 0, z: 0, name: "east" },
  { x: -1, y: 0, z: 0, name: "west" },
  { x: 0, y: 0, z: 1, name: "south" },
  { x: 0, y: 0, z: -1, name: "north" }
]);

const HOSTILE_TYPES = new Set([
  "minecraft:zombie", "minecraft:husk", "minecraft:drowned", "minecraft:skeleton",
  "minecraft:stray", "minecraft:bogged", "minecraft:spider", "minecraft:cave_spider",
  "minecraft:creeper", "minecraft:witch", "minecraft:pillager", "minecraft:vindicator",
  "minecraft:evocation_illager", "minecraft:ravager", "minecraft:blaze", "minecraft:ghast",
  "minecraft:hoglin", "minecraft:piglin_brute", "minecraft:warden", "minecraft:enderman",
  "minecraft:endermite", "minecraft:shulker", "minecraft:phantom", "minecraft:slime",
  "minecraft:magma_cube", "minecraft:silverfish"
]);

function safeBoolean(entity, propertyName, fallback = false) {
  try { return entity?.[propertyName] === true; } catch { return fallback; }
}

function healthValues(entity) {
  try {
    const component = entity.getComponent("minecraft:health");
    return {
      current: component?.currentValue ?? 20,
      maximum: component?.effectiveMax ?? component?.defaultValue ?? 20
    };
  } catch {
    return { current: 20, maximum: 20 };
  }
}

function velocityOf(entity) {
  try {
    const value = entity.getVelocity();
    return { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 };
  } catch {
    return { x: 0, y: 0, z: 0 };
  }
}

function onFire(entity) {
  try { return entity.hasComponent("minecraft:onfire"); } catch { return false; }
}

function groundDistanceBelow(dimension, location, maximum = 20) {
  const x = Math.floor(location.x);
  const z = Math.floor(location.z);
  const startY = Math.floor(location.y) - 1;
  for (let depth = 0; depth <= maximum; depth++) {
    const block = safeGetBlock(dimension, { x, y: startY - depth, z });
    if (isSolidSupport(block) || isWaterBlock(block)) return depth + 1;
  }
  return maximum + 1;
}

function countBlockedSides(dimension, base, allowWater = true) {
  let count = 0;
  for (const offset of CARDINALS) {
    const feet = safeGetBlock(dimension, { x: base.x + offset.x, y: base.y, z: base.z + offset.z });
    const head = safeGetBlock(dimension, { x: base.x + offset.x, y: base.y + 1, z: base.z + offset.z });
    if (!isPassableBlock(feet, allowWater) || !isPassableBlock(head, allowWater)) count++;
  }
  return count;
}

function runnerWeapon(player) {
  const selected = getSelectedItem(player);
  if (selected) return selected.typeId;
  const mainhand = getEquipment(player, EquipmentSlot.Mainhand);
  return mainhand?.typeId;
}

function narrowSupport(dimension, base) {
  const below = safeGetBlock(dimension, { x: base.x, y: base.y - 1, z: base.z });
  if (!isSolidSupport(below)) return false;
  let open = 0;
  for (const offset of CARDINALS) {
    const sideBelow = safeGetBlock(dimension, { x: base.x + offset.x, y: base.y - 1, z: base.z + offset.z });
    if (!isSolidSupport(sideBelow)) open++;
  }
  return open >= 3;
}

function pillarColumn(dimension, base, maximum = 24) {
  const first = safeGetBlock(dimension, { x: base.x, y: base.y - 1, z: base.z });
  if (!first || !isSolidSupport(first)) return { height: 0, typeId: undefined, bottom: undefined };
  const typeId = first.typeId;
  let height = 0;
  let bottom;
  for (let y = base.y - 1; y >= base.y - maximum; y--) {
    const block = safeGetBlock(dimension, { x: base.x, y, z: base.z });
    if (!block || block.typeId !== typeId) break;
    height++;
    bottom = { x: base.x, y, z: base.z };
  }
  return { height, typeId, bottom };
}

function runnerBridgeInfo(dimension, base, velocity) {
  const below = safeGetBlock(dimension, { x: base.x, y: base.y - 1, z: base.z });
  if (!isSolidSupport(below)) return undefined;
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude < 0.02) return undefined;
  const direction = {
    x: Math.abs(velocity.x) > Math.abs(velocity.z) ? Math.sign(velocity.x) : 0,
    y: 0,
    z: Math.abs(velocity.z) >= Math.abs(velocity.x) ? Math.sign(velocity.z) : 0
  };
  const sides = direction.x !== 0
    ? [{ x: 0, z: 1 }, { x: 0, z: -1 }]
    : [{ x: 1, z: 0 }, { x: -1, z: 0 }];
  const sideDepths = sides.map((side) => supportDepth(dimension, { x: base.x + side.x, y: base.y, z: base.z + side.z }, 8));
  const openSides = sideDepths.filter((depth) => depth > 3).length;
  if (openSides < 1 || !narrowSupport(dimension, base)) return undefined;
  return { direction, depth: Math.max(...sideDepths), openSides };
}

function runnerTunnelInfo(dimension, base) {
  const feetOpen = isPassableBlock(safeGetBlock(dimension, base), true);
  const headOpen = isPassableBlock(safeGetBlock(dimension, { x: base.x, y: base.y + 1, z: base.z }), true);
  if (!feetOpen || !headOpen) return undefined;
  const blocked = [];
  const open = [];
  for (const offset of CARDINALS) {
    const feet = safeGetBlock(dimension, { x: base.x + offset.x, y: base.y, z: base.z + offset.z });
    const head = safeGetBlock(dimension, { x: base.x + offset.x, y: base.y + 1, z: base.z + offset.z });
    const passable = isPassableBlock(feet, true) && isPassableBlock(head, true);
    (passable ? open : blocked).push(offset);
  }
  if (blocked.length < 2 || open.length > 2) return undefined;
  return { blocked: blocked.map((entry) => entry.name), open: open.map((entry) => entry.name) };
}

function runnerTreeCamp(dimension, base) {
  const below = safeGetBlock(dimension, { x: base.x, y: base.y - 1, z: base.z });
  const id = below?.typeId ?? "";
  if (!id.includes("log") && !id.includes("stem") && !id.includes("leaves")) return false;
  let woody = 0;
  for (let y = base.y - 1; y >= base.y - 8; y--) {
    const block = safeGetBlock(dimension, { x: base.x, y, z: base.z });
    const typeId = block?.typeId ?? "";
    if (typeId.includes("log") || typeId.includes("stem") || typeId.includes("leaves")) woody++;
  }
  return woody >= 2;
}

function nearbyPortal(dimension, origin, radius = 5) {
  const base = floorLocation(origin);
  for (let y = -3; y <= 3; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        if (Math.abs(x) + Math.abs(z) > radius + 2) continue;
        const location = { x: base.x + x, y: base.y + y, z: base.z + z };
        const block = safeGetBlock(dimension, location);
        if (isPortalBlock(block)) return { location, typeId: block.typeId };
      }
    }
  }
  return undefined;
}

function nearbyAirPocket(dimension, origin, radius = 5) {
  const base = floorLocation(origin);
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = 0; y <= radius + 2; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const location = { x: base.x + x, y: base.y + y, z: base.z + z };
        const feet = safeGetBlock(dimension, location);
        const head = safeGetBlock(dimension, { x: location.x, y: location.y + 1, z: location.z });
        if (!isAirBlock(feet) || !isAirBlock(head)) continue;
        const below = safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z });
        const score = x * x + z * z + y * y * 0.55 + (isSolidSupport(below) ? -3 : 0);
        if (score < bestScore) { bestScore = score; best = location; }
      }
    }
  }
  return best;
}

function nearbyShore(dimension, origin, radius = 8) {
  const base = floorLocation(origin);
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      for (let y = -2; y <= 4; y++) {
        const location = { x: base.x + x, y: base.y + y, z: base.z + z };
        const feet = safeGetBlock(dimension, location);
        const head = safeGetBlock(dimension, { x: location.x, y: location.y + 1, z: location.z });
        const below = safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z });
        if (!isPassableBlock(feet, false) || !isPassableBlock(head, false) || !isSolidSupport(below)) continue;
        const score = x * x + z * z + y * y * 1.5 + adjacentHazardCount(dimension, location) * 30;
        if (score < bestScore) { bestScore = score; best = location; }
      }
    }
  }
  return best;
}

function nearbyHostile(dimension, origin, hunterId, runnerId) {
  let entities = [];
  try { entities = dimension.getEntities({ location: origin, maxDistance: 10 }); } catch { return undefined; }
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    if (!entity || entity.id === hunterId || entity.id === runnerId || !HOSTILE_TYPES.has(entity.typeId)) continue;
    const d = distance(origin, entity.location);
    if (d < bestDistance) { bestDistance = d; best = entity; }
  }
  return best ? { entity: best, distance: bestDistance } : undefined;
}

// In the End the runner heals or bombs the dragon with placed crystals. A
// player hunter shoots those on sight; the AI does the same.
function nearbyEndCrystal(dimension, origin, maxDistance = 24) {
  let entities = [];
  try { entities = dimension.getEntities({ location: origin, maxDistance }); } catch { return undefined; }
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    if (!entity || entity.typeId !== "minecraft:end_crystal") continue;
    const d = distance(origin, entity.location);
    if (d < bestDistance) { bestDistance = d; best = entity; }
  }
  return best ? { entity: best, distance: bestDistance } : undefined;
}

// Loaded-chunk scan for a real end portal. Deliberately coarse (strided x/z/y
// and a small radius) so the worst case stays a couple hundred block reads.
function scanForEndPortal(dimension, origin, radius = 10) {
  const base = floorLocation(origin);
  for (let y = -4; y <= 4; y += 2) {
    for (let x = -radius; x <= radius; x += 2) {
      for (let z = -radius; z <= radius; z += 2) {
        const block = safeGetBlock(dimension, { x: base.x + x, y: base.y + y, z: base.z + z });
        if (block?.typeId === "minecraft:end_portal") {
          return { x: base.x + x + 0.5, y: base.y + y, z: base.z + z + 0.5 };
        }
      }
    }
  }
  return undefined;
}

function detectRunnerPattern(runner, dimension, brain, runnerLocation, runnerVelocity, verticalDifference, horizontalDistanceToHunter) {
  const base = floorLocation(runnerLocation);
  const previous = brain.lastRunnerLocation;
  const verticalGain = previous ? runnerLocation.y - previous.y : 0;
  const narrow = narrowSupport(dimension, base);
  const pillar = pillarColumn(dimension, base);
  const bridge = runnerBridgeInfo(dimension, base, runnerVelocity);
  const tunnel = runnerTunnelInfo(dimension, base);
  const treeCamp = runnerTreeCamp(dimension, base);
  const inCobweb = safeGetBlock(dimension, base)?.typeId === "minecraft:cobweb";
  let boat;
  try {
    boat = dimension.getEntities({ location: runnerLocation, maxDistance: 2.5 })
      .find((entity) => entity.typeId === "minecraft:boat" || entity.typeId.includes("_boat") || entity.typeId === "minecraft:chest_boat");
  } catch { boat = undefined; }

  if ((verticalGain > 0.42 || verticalDifference > 3.5) && narrow && horizontalDistanceToHunter < 18) {
    return { type: "towering", pillar, narrow, confidence: Math.min(1, 0.55 + pillar.height * 0.08) };
  }
  if (bridge) return { type: "bridging", bridge, confidence: 0.72 };
  if (tunnel) return { type: "two_block_tunnel", tunnel, confidence: 0.7 };
  if (treeCamp) return { type: "tree_camp", confidence: 0.74 };
  if (inCobweb) return { type: "cobweb", confidence: 0.9 };
  if (boat) return { type: "boat_escape", boatId: boat.id, confidence: 0.9 };
  if (safeBoolean(runner, "isFalling", false) && velocityOf(runner).y < -0.48) return { type: "cliff_jump", confidence: 0.82 };
  return { type: "normal", confidence: 0.3 };
}

function recordLocalTerrain(hunter, brain, base) {
  const dimension = hunter.dimension;
  for (const offset of CARDINALS) {
    const target = { x: base.x + offset.x * 2, y: base.y, z: base.z + offset.z * 2 };
    const feet = safeGetBlock(dimension, target);
    const head = safeGetBlock(dimension, { x: target.x, y: target.y + 1, z: target.z });
    const below = safeGetBlock(dimension, { x: target.x, y: target.y - 1, z: target.z });
    if (isPassableBlock(feet, true) && isPassableBlock(head, true) && isSolidSupport(below)) {
      rememberTerrain(brain, dimension.id, target, adjacentHazardCount(dimension, target) ? "danger" : "safe_route", adjacentHazardCount(dimension, target) ? -2 : 2);
    }
  }
}

export function senseWorld(hunter, runner, brain, config) {
  const hunterLocation = { ...hunter.location };
  const hunterBlock = floorLocation(hunterLocation);
  const dimension = hunter.dimension;
  const feetBlock = safeGetBlock(dimension, hunterBlock);
  const headBlock = safeGetBlock(dimension, { x: hunterBlock.x, y: hunterBlock.y + 1, z: hunterBlock.z });
  const belowBlock = safeGetBlock(dimension, { x: hunterBlock.x, y: hunterBlock.y - 1, z: hunterBlock.z });
  const sameDimension = Boolean(runner && runner.dimension.id === dimension.id);
  const hunterHealth = healthValues(hunter);
  const velocity = velocityOf(hunter);

  let runnerDistance = Number.POSITIVE_INFINITY;
  let runnerHorizontalDistance = Number.POSITIVE_INFINITY;
  let runnerVisible = false;
  let runnerSneaking = false;
  let runnerLocation;
  let runnerVelocity = { x: 0, y: 0, z: 0 };
  let verticalDifference = 0;
  let trackingHidden = false;
  let runnerPattern = { type: "dimension_mismatch", confidence: 1 };
  let runnerPortal;

  if (sameDimension) {
    runnerLocation = { ...runner.location };
    runnerDistance = distance(hunterLocation, runnerLocation);
    runnerHorizontalDistance = horizontalDistance(hunterLocation, runnerLocation);
    verticalDifference = runnerLocation.y - hunterLocation.y;
    runnerSneaking = safeBoolean(runner, "isSneaking", false);
    const from = hunter.getHeadLocation ? hunter.getHeadLocation() : { ...hunterLocation, y: hunterLocation.y + 1.5 };
    const to = runner.getHeadLocation ? runner.getHeadLocation() : { ...runnerLocation, y: runnerLocation.y + 1.5 };
    runnerVisible = runnerDistance <= 48 && hasLineOfSight(dimension, from, to, 48);

    if (brain.lastRunnerLocation && brain.lastRunnerDimension === dimension.id) {
      const ticks = Math.max(1, system.currentTick - (brain.lastRunnerTick ?? system.currentTick - 1));
      runnerVelocity = {
        x: (runnerLocation.x - brain.lastRunnerLocation.x) / ticks,
        y: (runnerLocation.y - brain.lastRunnerLocation.y) / ticks,
        z: (runnerLocation.z - brain.lastRunnerLocation.z) / ticks
      };
      brain.runnerVelocity = runnerVelocity;
    }

    runnerPattern = detectRunnerPattern(runner, dimension, brain, runnerLocation, runnerVelocity, verticalDifference, runnerHorizontalDistance);
    brain.runnerPattern = runnerPattern.type;
    brain.runnerTowerStart = runnerPattern.type === "towering" ? (brain.runnerTowerStart ?? { ...runnerLocation }) : undefined;
    brain.runnerBridgeDirection = runnerPattern.bridge?.direction;

    trackingHidden = config.stealthTracking && runnerSneaking && runnerDistance > 18 && !runnerVisible;
    if (!trackingHidden) {
      brain.lastSeenLocation = runnerLocation;
      brain.lastSeenDimension = dimension.id;
      brain.lastSeenTick = system.currentTick;
    } else if (system.currentTick - brain.lastSeenTick > 20 * 75) {
      brain.lastSeenLocation = undefined;
      brain.lastSeenDimension = undefined;
    }

    runnerPortal = nearbyPortal(dimension, runnerLocation, 4);
    if (runnerPortal) rememberPortal(dimension.id, runnerPortal.location);
    updateRunnerKnowledge(runner, brain.lastRunnerLocation);
    brain.lastRunnerLocation = runnerLocation;
    brain.lastRunnerDimension = dimension.id;
    brain.lastRunnerTick = system.currentTick;
  }

  brain.runnerVisible = runnerVisible;
  const currentStepType = brain.actionPlan?.steps?.[brain.actionPlan.cursor]?.type;
  const verticalTraversalActive = Boolean(brain.verticalPlan || brain.pillarTask || ["pillar", "place", "move"].includes(currentStepType) && String(brain.actionPlan?.type ?? "").includes("vertical")) || system.currentTick < (brain.verticalTraversalUntil ?? 0);
  if (system.currentTick - brain.lastMoveCheckTick >= 20) {
    const elapsedMoveTicks = system.currentTick - brain.lastMoveCheckTick;
    const moved = distance(hunterLocation, brain.lastHunterLocation);
    const verticalMoved = hunterLocation.y - brain.lastHunterLocation.y;
    const expectedToMove = !["idle", "eat", "craft", "smelt", "defend"].includes(brain.currentGoal);

    if (verticalTraversalActive) {
      const bestY = brain.verticalBestY ?? brain.lastHunterLocation.y;
      if (verticalMoved > 0.16 || hunterLocation.y > bestY + 0.16) {
        brain.verticalBestY = Math.max(bestY, hunterLocation.y);
        brain.lastVerticalProgressTick = system.currentTick;
        brain.stuckTicks = 0;
      } else if (system.currentTick - (brain.lastVerticalProgressTick ?? system.currentTick) < 90) {
        brain.stuckTicks = Math.max(0, brain.stuckTicks - elapsedMoveTicks);
      } else if (expectedToMove && moved < 0.25) {
        brain.stuckTicks += elapsedMoveTicks;
      } else {
        brain.stuckTicks = Math.max(0, brain.stuckTicks - elapsedMoveTicks);
      }
    } else if (expectedToMove && moved < 0.34) {
      brain.stuckTicks += elapsedMoveTicks;
    } else {
      brain.stuckTicks = Math.max(0, brain.stuckTicks - elapsedMoveTicks * 2);
    }

    if (brain.lastHunterLocation && hunterLocation.y < brain.lastHunterLocation.y - 3.5 && safeBoolean(hunter, "isFalling", false)) {
      recordFall(brain, dimension.id, brain.lastHunterLocation, "route caused a dangerous fall");
    }
    brain.lastHunterLocation = hunterLocation;
    brain.lastMoveCheckTick = system.currentTick;
    rememberPosition(brain, hunterLocation);
    recordLocalTerrain(hunter, brain, hunterBlock);
  }

  const inWater = safeBoolean(hunter, "isInWater", false) || isWaterBlock(feetBlock);
  const submerged = isWaterBlock(headBlock);
  const inLava = isLavaBlock(feetBlock) || isLavaBlock(headBlock);
  const fire = onFire(hunter);
  const onGround = safeBoolean(hunter, "isOnGround", isSolidSupport(belowBlock));
  const falling = safeBoolean(hunter, "isFalling", false);
  const blockedSides = countBlockedSides(dimension, hunterBlock, true);
  const dryBlockedSides = countBlockedSides(dimension, hunterBlock, false);
  const headBlocked = !isPassableBlock(headBlock, true);
  const inCobweb = feetBlock?.typeId === "minecraft:cobweb" || headBlock?.typeId === "minecraft:cobweb";
  const inPowderSnow = feetBlock?.typeId === "minecraft:powder_snow" || headBlock?.typeId === "minecraft:powder_snow";
  const movementLocked = brain.stuckTicks >= 45;
  const enclosed = inCobweb || inPowderSnow || (blockedSides >= 3 && (headBlocked || submerged || movementLocked));
  const trapType = inCobweb
    ? "cobweb"
    : inPowderSnow
      ? "powder snow"
      : submerged && dryBlockedSides >= 3
        ? "water enclosure"
        : headBlocked && blockedSides >= 3
          ? "sealed box"
          : blockedSides >= 3 && movementLocked
            ? "blocked pit or shaft"
            : blockedSides >= 3
              ? "pit or shaft"
              : "none";

  const perceptionDelta = Math.max(1, Math.min(40, system.currentTick - (brain.lastPerceptionTick ?? system.currentTick - 1)));
  brain.underwaterTicks = submerged ? brain.underwaterTicks + perceptionDelta : Math.max(0, brain.underwaterTicks - perceptionDelta * 2);
  brain.lavaTicks = (inLava || fire) ? brain.lavaTicks + perceptionDelta : 0;
  brain.enclosedTicks = enclosed ? brain.enclosedTicks + perceptionDelta : Math.max(0, brain.enclosedTicks - perceptionDelta * 2);
  if (submerged && dryBlockedSides >= 3) rememberWaterTrap(brain, dimension.id, hunterBlock);

  const hazardCount = adjacentHazardCount(dimension, hunterBlock) + (isHazardBlock(feetBlock) ? 2 : 0) + (isHazardBlock(belowBlock) ? 1 : 0);
  const lavaCount = adjacentLavaCount(dimension, hunterBlock) + (inLava ? 2 : 0);
  if (hazardCount > 0) rememberDanger(dimension.id, hunterBlock, inLava ? "lava" : "hazard", hazardCount);

  let nearbyBoat;
  if (config.destroyBoats || brain.role === "Chaser") {
    try {
      nearbyBoat = dimension.getEntities({ location: hunterLocation, maxDistance: 5 })
        .find((entity) => entity.typeId === "minecraft:boat" || entity.typeId.includes("_boat") || entity.typeId === "minecraft:chest_boat");
    } catch { nearbyBoat = undefined; }
  }

  const hunterPortal = nearbyPortal(dimension, hunterLocation, 5);
  if (hunterPortal) rememberPortal(dimension.id, hunterPortal.location);
  const airPocket = submerged ? nearbyAirPocket(dimension, hunterLocation, 5) : undefined;
  const shore = inWater ? nearbyShore(dimension, hunterLocation, 8) : undefined;
  const hostile = nearbyHostile(dimension, hunterLocation, hunter.id, runner?.id);
  const endCrystal = dimension.id.includes("the_end") ? nearbyEndCrystal(dimension, hunterLocation) : undefined;
  let endPortalNearby;
  if (config.endPursuit !== false && !sameDimension && !dimension.id.includes("the_end")) {
    if (system.currentTick - (brain.lastEndPortalScanTick ?? -9999) >= 60) {
      brain.lastEndPortalScanTick = system.currentTick;
      brain.nearbyEndPortal = scanForEndPortal(dimension, hunterLocation);
    }
    endPortalNearby = brain.nearbyEndPortal;
  }

  const result = {
    tick: system.currentTick,
    hunterLocation,
    hunterBlock,
    dimension,
    dimensionId: dimension.id,
    feetBlock,
    headBlock,
    belowBlock,
    health: hunterHealth.current,
    maxHealth: hunterHealth.maximum,
    healthRatio: hunterHealth.maximum > 0 ? hunterHealth.current / hunterHealth.maximum : 1,
    sameDimension,
    runnerLocation: trackingHidden ? undefined : runnerLocation,
    trueRunnerLocation: runnerLocation,
    runnerDistance: trackingHidden ? Number.POSITIVE_INFINITY : runnerDistance,
    runnerHorizontalDistance: trackingHidden ? Number.POSITIVE_INFINITY : runnerHorizontalDistance,
    actualRunnerDistance: runnerDistance,
    verticalDifference: trackingHidden ? 0 : verticalDifference,
    runnerVelocity,
    trackingHidden,
    runnerVisible,
    runnerSneaking,
    runnerHasShield: sameDimension ? runnerHasShield(runner) : false,
    runnerWeapon: sameDimension ? runnerWeapon(runner) : undefined,
    runnerPattern: runnerPattern.type,
    runnerPatternInfo: runnerPattern,
    runnerPillar: runnerPattern.pillar,
    runnerBridge: runnerPattern.bridge,
    runnerPortal,
    hunterPortal,
    inWater,
    submerged,
    inLava,
    onFire: fire,
    inPowderSnow,
    onGround,
    falling,
    velocity,
    groundDistance: falling || velocity.y < -0.42 ? groundDistanceBelow(dimension, hunterLocation, 20) : 0,
    blockedSides,
    dryBlockedSides,
    headBlocked,
    enclosed,
    trapType,
    nearbyBoat,
    nearbyHostile: hostile?.entity,
    nearbyHostileDistance: hostile?.distance ?? Number.POSITIVE_INFINITY,
    nearbyEndCrystal: endCrystal?.entity,
    nearbyEndCrystalDistance: endCrystal?.distance ?? Number.POSITIVE_INFINITY,
    endPortalNearby,
    hazardNear: hazardCount > 0,
    hazardCount,
    lavaCount,
    airPocket,
    shore,
    stuckTicks: brain.stuckTicks,
    verticalTraversalActive,
    verticalMode: brain.verticalMode ?? "none",
    lastSeenLocation: brain.lastSeenLocation,
    lastSeenDimension: brain.lastSeenDimension,
    lastSeenAge: Math.max(0, system.currentTick - brain.lastSeenTick),
    standingOnSolid: isSolidSupport(belowBlock),
    feetOpen: isAirBlock(feetBlock) || isWaterBlock(feetBlock),
    canBreakHead: isBreakableBlock(headBlock),
    supportDepth: supportDepth(dimension, hunterLocation, 12)
  };
  brain.perception = result;
  return result;
}

export function markHunterDamaged(brain, cause = "unknown", damagerType = "unknown") {
  if (!brain) return;
  brain.lastDamagedTick = system.currentTick;
  brain.lastDamageCause = cause;
  brain.lastDamagerType = damagerType;
}

export function markHunterHitRunner(brain) {
  if (!brain) return;
  brain.lastSuccessfulHitTick = system.currentTick;
  brain.lastAttackTick = system.currentTick;
}


export function senseImmediateHazards(hunter, brain = undefined) {
  const dimension = hunter.dimension;
  const location = { ...hunter.location };
  const base = floorLocation(location);
  const feetBlock = safeGetBlock(dimension, base);
  const headBlock = safeGetBlock(dimension, { x: base.x, y: base.y + 1, z: base.z });
  const velocity = velocityOf(hunter);
  const falling = safeBoolean(hunter, "isFalling", false) || velocity.y < -0.28;
  const inWater = safeBoolean(hunter, "isInWater", false) || isWaterBlock(feetBlock);
  const submerged = isWaterBlock(headBlock);
  const inLava = isLavaBlock(feetBlock) || isLavaBlock(headBlock);
  return {
    ...(brain?.perception ?? {}),
    falling,
    velocity,
    groundDistance: falling ? groundDistanceBelow(dimension, location, 64) : 0,
    inWater,
    submerged,
    inLava,
    onFire: onFire(hunter),
    hunterLocation: location
  };
}
