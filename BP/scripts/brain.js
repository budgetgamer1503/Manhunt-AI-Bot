import { system, EntityDamageCause } from "@minecraft/server";
import { GOALS, PROFILE_SETTINGS } from "./constants.js";
import {
  combatStatus,
  tickBlockingHostileCombat,
  tickCombat
} from "./combat.js";
import {
  canSmelt,
  clearResourceTarget,
  consumeFood,
  equipBestSword,
  getCraftPlan,
  getGatheringStatus,
  getResourceNeeds,
  isPreparationComplete,
  performCraftStep,
  selectFoodForEating,
  tickResourceGathering,
  tickSmelting,
  syncHunterEquipment,
  tryFillWaterBucket
} from "./gathering.js";
import { equipMainhand } from "./inventory.js";
import { getBrain, getBrainSnapshot, setGoal } from "./memory.js";
import { clearActionPlan } from "./planner.js";
import {
  notifyCrystalBreak,
  notifyCraftMilestone,
  notifyDimensionEnter
} from "./persona.js";
import {
  forceReplan,
  getNavigationStatus,
  returnToChase,
  tickActionPlan,
  tickBoatHandling,
  tickBreakPillar,
  tickDescent,
  tickFallSafety,
  tickFallWaterRecovery,
  tickLavaEscape,
  tickLocalNavigation,
  tickLongDistanceRoute,
  tickResourceNavigation,
  tickRetreatRoute,
  tickSearchRoute,
  tickStuckRecovery,
  tickTrapEscape,
  tickVerticalPursuit,
  tickWaterEscape,
  tickWaypointLifecycle
} from "./navigation.js";
import { senseImmediateHazards, senseWorld } from "./perception.js";
import {
  createPortalBuildPlan,
  portalStatus,
  portalTargetForHunter,
  rememberNearbyPortal,
  tickPortalBuild,
  tickPortalTransit
} from "./portal.js";
import {
  findShareTarget,
  getHunterRole,
  getSquadKnowledge,
  getSquadStatus
} from "./squad.js";
import { getElapsedTicks, getHunters } from "./state.js";
import {
  distance,
  floorLocation,
  hasStandingSpace,
  isEntityValid,
  safeDynamicGet,
  safeDynamicSet,
  safeLookAt,
  safeTrigger
} from "./utils.js";


function safeDynamicGetBoolean(entity, key) {
  try { return safeDynamicGet(entity, key, false) === true; } catch { return false; }
}

const RESOURCE_GOAL = Object.freeze({
  wood: GOALS.GATHER_WOOD,
  stone: GOALS.GATHER_STONE,
  blocks: GOALS.GATHER_BLOCKS,
  coal: GOALS.GATHER_COAL,
  iron: GOALS.GATHER_IRON,
  gold: GOALS.GATHER_GOLD,
  diamond: GOALS.GATHER_DIAMOND,
  debris: GOALS.GATHER_DEBRIS,
  flint: GOALS.GATHER_FLINT,
  portal: GOALS.GATHER_OBSIDIAN,
  food: GOALS.GATHER_FOOD,
  combat: GOALS.GATHER_COMBAT_MATERIALS
});

const GOAL_RESOURCE = Object.freeze({
  [GOALS.GATHER_WOOD]: "wood",
  [GOALS.GATHER_STONE]: "stone",
  [GOALS.GATHER_BLOCKS]: "blocks",
  [GOALS.GATHER_COAL]: "coal",
  [GOALS.GATHER_IRON]: "iron",
  [GOALS.GATHER_GOLD]: "gold",
  [GOALS.GATHER_DIAMOND]: "diamond",
  [GOALS.GATHER_DEBRIS]: "debris",
  [GOALS.GATHER_FLINT]: "flint",
  [GOALS.GATHER_OBSIDIAN]: "portal",
  [GOALS.GATHER_FOOD]: "food",
  [GOALS.GATHER_COMBAT_MATERIALS]: "combat"
});

const NATIVE_CHASE_GOALS = new Set([GOALS.CHASE, GOALS.ATTACK, GOALS.RANGED_ATTACK, GOALS.DEFEND, GOALS.IDLE]);
const COMMITTED_WORK_GOALS = new Set([
  GOALS.CRAFT, GOALS.SMELT, GOALS.EAT, GOALS.VERTICAL_PURSUIT, GOALS.BREAK_PILLAR, GOALS.DESCEND,
  GOALS.FOLLOW_DIMENSION, GOALS.SEARCH, GOALS.USE_BOAT, GOALS.DESTROY_CRYSTALS, ...Object.keys(GOAL_RESOURCE)
]);
const GOAL_LOCK_DURATION = Object.freeze({
  [GOALS.CRAFT]: 45, [GOALS.SMELT]: 100, [GOALS.EAT]: 38,
  [GOALS.VERTICAL_PURSUIT]: 140, [GOALS.BREAK_PILLAR]: 120, [GOALS.DESCEND]: 100,
  [GOALS.FOLLOW_DIMENSION]: 160, [GOALS.SEARCH]: 100, [GOALS.USE_BOAT]: 120, [GOALS.DESTROY_CRYSTALS]: 100,
  [GOALS.GATHER_WOOD]: 120, [GOALS.GATHER_STONE]: 120, [GOALS.GATHER_BLOCKS]: 140,
  [GOALS.GATHER_COAL]: 120, [GOALS.GATHER_IRON]: 140, [GOALS.GATHER_GOLD]: 140,
  [GOALS.GATHER_DIAMOND]: 160, [GOALS.GATHER_DEBRIS]: 200, [GOALS.GATHER_FLINT]: 100, [GOALS.GATHER_OBSIDIAN]: 180,
  [GOALS.GATHER_FOOD]: 100, [GOALS.GATHER_COMBAT_MATERIALS]: 120
});

function lockSelectedGoal(brain, goal, reason) {
  if (!COMMITTED_WORK_GOALS.has(goal)) {
    brain.goalLockUntil = 0;
    brain.goalLockReason = "native chase goal";
    return;
  }
  brain.goalLockUntil = Math.max(brain.goalLockUntil ?? 0, system.currentTick + (GOAL_LOCK_DURATION[goal] ?? 80));
  brain.goalLockReason = reason || "finish the selected action before returning to chase";
}

function planCompatibleWithGoal(plan, goal) {
  if (!plan) return true;
  if (plan.ownerGoal === goal) return true;
  const resourceGoals = new Set(Object.keys(GOAL_RESOURCE));
  if ((plan.type.startsWith("mine_") || plan.type === "mine_route" || plan.type === "form_obsidian" || plan.type === "light_tunnel") &&
      (resourceGoals.has(goal) || goal === GOALS.FOLLOW_DIMENSION)) return true;
  if (["bridge", "clear_obstacle"].includes(plan.type) && [GOALS.CHASE, GOALS.SEARCH, GOALS.VERTICAL_PURSUIT].includes(goal)) return true;
  if (plan.type.startsWith("vertical_") && goal === GOALS.VERTICAL_PURSUIT) return true;
  if (plan.type === "break_runner_pillar" && [GOALS.BREAK_PILLAR, GOALS.VERTICAL_PURSUIT].includes(goal)) return true;
  if (plan.type === "safe_descent" && goal === GOALS.DESCEND) return true;
  if (["fall_save", "fall_clutch"].includes(plan.type) && goal === GOALS.FALL_SAVE) return true;
  if (plan.type === "escape_water" && [GOALS.ESCAPE_WATER, GOALS.ESCAPE_TRAP].includes(goal)) return true;
  if (plan.type === "escape_lava" && goal === GOALS.ESCAPE_LAVA) return true;
  if (plan.type === "escape_trap" && [GOALS.ESCAPE_TRAP, GOALS.RECOVER_STUCK].includes(goal)) return true;
  if (plan.type === "build_portal" && [GOALS.FOLLOW_DIMENSION, GOALS.BUILD_PORTAL, GOALS.FIND_PORTAL].includes(goal)) return true;
  if (["craft_boat", "use_boat"].includes(plan.type) && goal === GOALS.USE_BOAT) return true;
  return false;
}

function addCandidate(candidates, goal, score, reason, subAction = "none", metadata = {}) {
  if (!Number.isFinite(score)) return;
  candidates.push({ goal, score, reason, subAction, metadata });
}

function roleWeights(role) {
  if (role === "Gatherer") return { chase: -85, gather: 120, craft: 75, build: -25, ranged: -20 };
  if (role === "Builder") return { chase: -35, gather: 55, craft: 25, build: 125, ranged: -20 };
  if (role === "Archer") return { chase: -15, gather: 30, craft: 40, build: -15, ranged: 130 };
  return { chase: 100, gather: -20, craft: -15, build: 35, ranged: 15 };
}

function decisionDelay(config, brain) {
  const profile = PROFILE_SETTINGS[config.performanceProfile] ?? PROFILE_SETTINGS[1];
  const baseReaction = config.aiLevel >= 3 ? 2 : config.aiLevel === 2 ? 3 : config.aiLevel === 0 ? 12 : 6;
  const stage = Math.max(0, Math.trunc(brain?.difficultyStage ?? 0));
  // Progressive difficulty improves reaction time and planning frequency only.
  // It never increases raw damage, health, or movement speed.
  const reaction = Math.max(1, baseReaction - stage);
  return Math.max(reaction, Math.max(2, profile.decisionInterval - Math.floor(stage / 2)));
}

// Decision "noise" makes lower tiers occasionally pick a slightly worse goal,
// exactly like a distracted player. Nightmare stays nearly deterministic.
const DECISION_NOISE = Object.freeze([18, 6, 1.5, 0.4]);

function runnerClose(perception, range) {
  return perception.sameDimension && perception.actualRunnerDistance <= range;
}

function verticalBlockNeed(perception) {
  return Math.max(0, Math.ceil(perception.verticalDifference)) + 4;
}

function scoreAntiCheese(candidates, hunter, brain, config, perception, weights, gathering) {
  const pattern = perception.runnerPattern;
  if (!perception.sameDimension) return;
  if (pattern === "towering") {
    const required = verticalBlockNeed(perception);
    brain.verticalBlockRequirement = required;
    if (perception.runnerPillar?.height >= 3 && perception.runnerHorizontalDistance < 7) {
      addCandidate(candidates, GOALS.BREAK_PILLAR, 880 + weights.build, "the runner is standing on a narrow pillar that can be removed from below", "move aside and mine the lowest safe support");
    }
    if (gathering.buildingBlocks < required) {
      addCandidate(candidates, GOALS.GATHER_BLOCKS, 860 + weights.gather + weights.build, `the runner is ${Math.ceil(perception.verticalDifference)} blocks above and the hunter needs ${required} route blocks`, "collect dirt or stone before climbing");
    } else {
      addCandidate(candidates, GOALS.VERTICAL_PURSUIT, 850 + weights.build, "the runner towered above normal pathfinding range", "try natural slope, diagonal stairs, spiral stairs, then offset pillar");
    }
  } else if (pattern === "bridging") {
    addCandidate(candidates, GOALS.CHASE, 730 + weights.chase, "the runner is crossing a narrow bridge; reuse it or build only the missing gap", "follow the verified bridge line");
  } else if (pattern === "two_block_tunnel") {
    addCandidate(candidates, GOALS.CHASE, 760 + weights.chase, "the runner entered a two-block tunnel", "mine a two-block-high corridor instead of placing blocks");
  } else if (pattern === "tree_camp") {
    if (gathering.buildingBlocks < 8) addCandidate(candidates, GOALS.GATHER_BLOCKS, 800 + weights.gather, "the runner is camping above the ground in a tree and the hunter lacks climbing blocks", "gather blocks or cut the tree");
    else addCandidate(candidates, GOALS.VERTICAL_PURSUIT, 810 + weights.build, "the runner is camping in a tree", "cut logs or build a controlled staircase");
  } else if (pattern === "boat_escape") {
    addCandidate(candidates, GOALS.USE_BOAT, 780 + weights.chase, "the runner is escaping by boat", "destroy, intercept, or craft a boat for the crossing");
  } else if (pattern === "cliff_jump") {
    addCandidate(candidates, GOALS.DESCEND, 805 + weights.chase, "the runner jumped from a cliff", "find a safe descent instead of stepping into a lethal fall");
  }

  // A normal hill or jungle canopy must not be mistaken for a player tower.
  // Native pathfinding gets time to use terrain first. Generic vertical
  // construction is allowed only after the hunter has genuinely stopped
  // progressing and the runner is close to the blocked column.
  const confirmedVerticalBlock = perception.verticalDifference >= 5.5 &&
    perception.runnerHorizontalDistance <= 8 && perception.stuckTicks >= 30;
  if (confirmedVerticalBlock) {
    const required = Math.max(8, verticalBlockNeed(perception) + 2);
    brain.verticalBlockRequirement = required;
    if (gathering.buildingBlocks < required) {
      addCandidate(candidates, GOALS.GATHER_BLOCKS, 975 + weights.gather + weights.build, `the runner is ${Math.ceil(perception.verticalDifference)} blocks above a confirmed blocked route and ${required} route blocks are required`, "gather the full climb reserve before trying again");
    } else {
      addCandidate(candidates, GOALS.VERTICAL_PURSUIT, 955 + weights.build, "native terrain routing failed below a nearby elevated runner", "commit to diagonal stairs, spiral stairs, then offset pillar");
    }
  }
}

function scoreGoals(hunter, runner, brain, config, perception, elapsedTicks) {
  const candidates = [];
  const role = getHunterRole(hunter, brain.role);
  const weights = roleWeights(role);
  const gathering = getGatheringStatus(hunter);

  if (perception.falling && perception.groundDistance >= 6) addCandidate(candidates, GOALS.FALL_SAVE, 1200, "a dangerous fall requires an immediate water or block clutch", "predict the landing block");
  if (perception.inLava || perception.onFire) addCandidate(candidates, GOALS.ESCAPE_LAVA, 1160, "lava or fire is causing immediate danger", "water, extinguish, or find solid ground");
  if (perception.submerged || (perception.inWater && brain.underwaterTicks > 20)) addCandidate(candidates, GOALS.ESCAPE_WATER, 1120, "the hunter is submerged or unable to reach shore", "seek air, shore, or open one side exit");
  if (perception.inPowderSnow || perception.enclosed || brain.enclosedTicks > 20) addCandidate(candidates, GOALS.ESCAPE_TRAP, 1080, `${perception.trapType} prevents normal movement`, "mine one controlled safe exit");
  if (!perception.verticalTraversalActive && perception.stuckTicks >= 90) addCandidate(candidates, GOALS.RECOVER_STUCK, 1010, "the active route stopped making progress", "blacklist it, backtrack, and try another direction");

  const food = selectFoodForEating(hunter);
  const eatThreshold = config.riskProfile === 0 ? 0.7 : config.riskProfile === 2 ? 0.42 : 0.56;
  if (food && perception.healthRatio < 0.32 && runnerClose(perception, 10)) addCandidate(candidates, GOALS.RETREAT, 980, "health is critical and the runner is too close to eat", "create safe distance");
  if (food && perception.healthRatio < eatThreshold && (!perception.sameDimension || perception.runnerDistance > 4.5)) addCandidate(candidates, GOALS.EAT, 920, "health is low and food is available", `eat ${food.typeId.replace("minecraft:", "")}`);
  const dangerousClimb = ["towering", "tree_camp"].includes(perception.runnerPattern) || perception.verticalDifference >= 6;
  if (food && dangerousClimb && perception.healthRatio < 0.82 && (!perception.sameDimension || perception.runnerDistance > 4.5)) {
    addCandidate(candidates, GOALS.EAT, 938, "a dangerous vertical pursuit is about to begin and the hunter should heal first", `eat ${food.typeId.replace("minecraft:", "")} before climbing`);
  }

  if (perception.nearbyHostile && perception.nearbyHostileDistance < 3.1 && (brain.lastDamagerType === perception.nearbyHostile.typeId || !runnerClose(perception, 7))) {
    addCandidate(candidates, GOALS.DEFEND, 895, "a hostile mob is actively blocking or damaging the hunter", "clear the immediate threat only");
  }

  if (!perception.sameDimension) {
    addCandidate(candidates, GOALS.FOLLOW_DIMENSION, 950, "the runner entered another dimension", "use a remembered portal or construct one");
  }

  scoreAntiCheese(candidates, hunter, brain, config, perception, weights, gathering);

  if (perception.sameDimension && String(perception.dimensionId ?? "").includes("the_end") && config.endPursuit !== false && isEntityValid(perception.nearbyEndCrystal)) {
    addCandidate(candidates, GOALS.DESTROY_CRYSTALS, 880 + weights.build, "a placed end crystal threatens the hunt", "destroy the crystal before it heals the dragon or explodes");
  }

  if (perception.sameDimension && perception.runnerVisible && perception.runnerDistance >= 7 && perception.runnerDistance <= 30 && gathering.hasBow && gathering.arrows > 0) {
    addCandidate(candidates, GOALS.RANGED_ATTACK, 805 + weights.ranged, "the runner is visible at bow distance", "predict movement and fire only with line of sight");
  }
  if (perception.sameDimension && perception.runnerDistance <= 4.8 && (perception.runnerVisible || perception.runnerDistance <= 2.4)) {
    // A committed mining/crafting lock must not make a hunter ignore a runner
    // who is already close enough to land hits. Very-close melee becomes an
    // emergency override; at the edge of reach, role preference still matters.
    const immediateMelee = perception.runnerDistance <= 3.2;
    const combatScore = immediateMelee ? 1090 : 885 + Math.round(weights.chase * 0.35);
    addCandidate(candidates, GOALS.ATTACK, combatScore, "the runner is inside legal melee range", "time weapon cooldown, shield, axe, and sprint reset");
  }

  const routeRequestedBlocks = (brain.needsBuildingBlocksUntil ?? 0) > system.currentTick;
  if (config.gathering && routeRequestedBlocks && gathering.buildingBlocks < Math.max(8, brain.verticalBlockRequirement ?? 0)) {
    addCandidate(candidates, GOALS.GATHER_BLOCKS, 970 + weights.gather + weights.build, brain.needsBuildingBlocksReason || "the planned route needs more blocks", "gather a calculated block reserve");
  } else if (gathering.buildingBlocks >= Math.max(8, brain.verticalBlockRequirement ?? 0)) {
    brain.needsBuildingBlocksUntil = 0;
    brain.needsBuildingBlocksReason = "";
  }

  const workDistance = role === "Chaser" ? 34 : config.riskProfile === 2 ? 18 : 24;
  const safeToWork = !perception.sameDimension || perception.runnerDistance > workDistance;
  const craftPlan = getCraftPlan(hunter);
  if (craftPlan && safeToWork) addCandidate(candidates, GOALS.CRAFT, 690 + weights.craft, `materials are ready to ${craftPlan}`, craftPlan);
  if (brain.smeltTask) {
    addCandidate(candidates, GOALS.SMELT, (safeToWork ? 900 : 520) + weights.craft, "an already-started furnace operation must be monitored to completion", `finish smelting ${brain.smeltTask.input.replace("minecraft:", "")}`);
  } else if (canSmelt(hunter) && safeToWork) {
    addCandidate(candidates, GOALS.SMELT, 650 + weights.craft, "the furnace has useful input and fuel", "smelt one reserved item over time");
  }

  const prepComplete = isPreparationComplete(hunter, config, elapsedTicks);
  for (const need of getResourceNeeds(hunter, config, perception, elapsedTicks)) {
    let score = need.score + weights.gather;
    if (!prepComplete) score += role === "Chaser" ? 25 : 90;
    if (perception.sameDimension && perception.runnerDistance < 24) score -= role === "Chaser" ? 270 : 130;
    if (perception.sameDimension && perception.runnerDistance < 9) score -= 260;
    if (need.category === "blocks") score += weights.build;
    if (need.category === "combat") score += weights.ranged;
    addCandidate(candidates, RESOURCE_GOAL[need.category], score, need.reason, `find reachable ${need.category}`);
  }

  if (perception.sameDimension) {
    const stealthHidden = config.stealthTracking && perception.trackingHidden && brain.lastSeenLocation;
    if (stealthHidden) addCandidate(candidates, GOALS.SEARCH, 720 + weights.chase, "the sneaking runner broke visual tracking", "search the last known movement direction");
    const chaseScore = (prepComplete ? 710 : 635) + weights.chase + (perception.runnerDistance < 20 ? 55 : 0);
    addCandidate(candidates, GOALS.CHASE, chaseScore, role === "Chaser" ? "maintain permanent pressure on the runner" : "keep the runner tracked while role work remains safe", "native chase with local planning only at obstacles");
  }

  if (role !== "Chaser" && !runnerClose(perception, 20)) addCandidate(candidates, GOALS.SHARE_RESOURCES, 470, `${role} can share surplus resources with the squad`, "approach a teammate with a resource shortage");
  addCandidate(candidates, GOALS.IDLE, 10, "no higher-priority action is available", "observe and maintain the pursuit heartbeat");

  for (const candidate of candidates) {
    if (candidate.goal === brain.currentGoal) candidate.score += 24;
    if (config.humanMistakes && candidate.score < 900) {
      const noise = DECISION_NOISE[Math.min(config.aiLevel ?? 1, DECISION_NOISE.length - 1)];
      candidate.score += (Math.random() - 0.5) * noise;
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function chooseGoal(brain, config, candidates) {
  const best = candidates[0];
  const emergencyOverride = (best?.score ?? 0) >= 1040;
  const current = candidates.find((entry) => entry.goal === brain.currentGoal);
  if (!emergencyOverride && current && system.currentTick < (brain.goalLockUntil ?? 0)) return current;
  const urgent = (best?.score ?? 0) >= 900;
  if (!urgent && system.currentTick - brain.lastDecisionTick < decisionDelay(config, brain)) {
    if (current && current.score >= (best?.score ?? 0) - 80) return current;
  }
  brain.lastDecisionTick = system.currentTick;
  return best;
}

function startEating(hunter, brain, food) {
  if (!food) return false;
  if (!brain.eatTask) {
    brain.eatTask = { typeId: food.typeId, heal: food.heal, startTick: system.currentTick, completeTick: system.currentTick + 30 };
    equipMainhand(hunter, food.typeId);
    safeTrigger(hunter, "manhunt:idle");
  }
  return true;
}

function tickEating(hunter, brain) {
  const task = brain.eatTask;
  if (!task) return false;
  if (brain.lastDamagedTick > task.startTick && system.currentTick - brain.lastDamagedTick < 10) {
    brain.eatTask = undefined;
    equipBestSword(hunter);
    return false;
  }
  if (system.currentTick < task.completeTick) return true;
  if (consumeFood(hunter, task.typeId)) {
    try {
      hunter.addEffect("regeneration", Math.max(45, task.heal * 11), { amplifier: task.heal >= 8 ? 1 : 0, showParticles: false });
      if (task.typeId === "minecraft:golden_apple") {
        hunter.addEffect("absorption", 1200, { amplifier: 0, showParticles: false });
        hunter.addEffect("resistance", 100, { amplifier: 0, showParticles: false });
      }
    } catch {
      // The food still leaves inventory; combat can continue.
    }
  }
  brain.lastEatTick = system.currentTick;
  brain.eatTask = undefined;
  equipBestSword(hunter);
  return true;
}

function explorationTarget(hunter, brain, category) {
  if (!brain.exploreTarget || system.currentTick >= (brain.exploreTargetExpires ?? 0) || distance(hunter.location, brain.exploreTarget) < 2.5 || !hasStandingSpace(hunter.dimension, brain.exploreTarget, false)) {
    const base = floorLocation(hunter.location);
    const initialAngle = (brain.squadIndex * 1.7) + (system.currentTick / 80) + category.length * 0.31;
    const candidates = [];
    for (let ring = 7; ring <= 15; ring += 2) {
      for (let lane = 0; lane < 8; lane++) {
        const angle = initialAngle + lane * Math.PI / 4;
        const x = base.x + Math.round(Math.cos(angle) * ring);
        const z = base.z + Math.round(Math.sin(angle) * ring);
        for (const yOffset of [0, 1, -1, 2, -2, 3, -3]) {
          const location = { x, y: base.y + yOffset, z };
          if (!hasStandingSpace(hunter.dimension, location, false)) continue;
          const blacklistUntil = brain.routeBlacklist.get(`${hunter.dimension.id}|${x}|${location.y}|${z}`) ?? 0;
          if (blacklistUntil > system.currentTick) continue;
          candidates.push({ x: x + 0.5, y: location.y, z: z + 0.5 });
          break;
        }
      }
      if (candidates.length) break;
    }
    brain.exploreTarget = candidates[0] ?? { ...hunter.location };
    brain.exploreTargetExpires = system.currentTick + 140;
  }
  return brain.exploreTarget;
}

function debugMessage(hunter, config, brain) {
  if (!config.debugMode || system.currentTick - brain.lastDebugTick < 20) return;
  brain.lastDebugTick = system.currentTick;
  const text = `§8[${brain.role}] §f${brain.currentGoal} §7| ${brain.subAction} §8| plan ${brain.actionPlan?.type ?? "none"}`;
  try { safeDynamicSet(hunter, "manhunt:debug_line", text.slice(0, 240)); } catch {}
}

function executeResourceGoal(hunter, runner, brain, config, perception, category) {
  let result = tickResourceGathering(hunter, brain, category, config);

  // Building-block acquisition owns its complete dependency chain. If the
  // terrain offers only stone and the hunter has no pickaxe yet, do not stare
  // at an unmineable block or abandon the committed climb goal. Craft from
  // carried wood, or gather wood first, then return to blocks automatically.
  if (category === "blocks" && (result.state === "missing" || result.state === "searching" || result.state === "wrong_tool_or_unsafe")) {
    const status = getGatheringStatus(hunter);
    if (status.pickTier < 1) {
      const requiredPlanks = status.hasCraftingTable ? 5 : 9;
      const availablePlankEquivalent = status.planks + status.logs * 4;
      if (availablePlankEquivalent >= requiredPlanks) {
        safeTrigger(hunter, "manhunt:idle");
        const crafted = performCraftStep(hunter, brain);
        syncHunterEquipment(hunter, brain, perception, true);
        return crafted ? "crafting the pickaxe dependency for climb blocks" : "waiting for the next wooden-tool crafting step";
      }
      result = tickResourceGathering(hunter, brain, "wood", config);
      if (result.target) tickResourceNavigation(hunter, runner, brain, config, perception, result.target, "wood");
      else {
        const target = explorationTarget(hunter, brain, "wood");
        tickLongDistanceRoute(hunter, brain, target, "searching for wood needed to mine climb blocks");
      }
      return `gathering wood dependency for climb blocks: ${result.state ?? "searching"}`;
    }
  }

  if (result.target) tickResourceNavigation(hunter, runner, brain, config, perception, result.target, category);
  else if (result.state === "missing" || result.state === "searching") {
    const target = explorationTarget(hunter, brain, category);
    tickLongDistanceRoute(hunter, brain, target, `exploring for ${category}`);
  }
  return result.state ?? `gathering ${category}`;
}

function executeGoal(hunter, runner, brain, config, perception, selected) {
  const target = perception.runnerLocation ?? brain.lastSeenLocation ?? runner?.location;

  switch (selected.goal) {
    case GOALS.FALL_SAVE:
      tickFallSafety(hunter, runner, brain, config, perception);
      return "performing fall safety";
    case GOALS.ESCAPE_LAVA:
      tickLavaEscape(hunter, runner, brain, config, perception);
      return "escaping lava or fire";
    case GOALS.ESCAPE_WATER:
      tickWaterEscape(hunter, runner, brain, config, perception);
      return "seeking air or shore";
    case GOALS.ESCAPE_TRAP:
      if (perception.trapType === "water enclosure") tickWaterEscape(hunter, runner, brain, config, perception);
      else tickTrapEscape(hunter, brain, config, perception);
      return `escaping ${perception.trapType}`;
    case GOALS.RECOVER_STUCK:
      tickStuckRecovery(hunter, runner, brain, config, perception, target ?? hunter.location);
      return "replanning after route failure";
    case GOALS.RETREAT:
      tickRetreatRoute(hunter, runner, brain, perception);
      return "retreating to eat";
    case GOALS.EAT: {
      const food = selectFoodForEating(hunter);
      startEating(hunter, brain, food);
      tickEating(hunter, brain);
      return food ? `eating ${food.typeId.replace("minecraft:", "")}` : "no food available";
    }
    case GOALS.ATTACK:
    case GOALS.RANGED_ATTACK:
      return tickCombat(hunter, runner, brain, config, perception);
    case GOALS.DEFEND:
      if (tickBlockingHostileCombat(hunter, brain, config, perception)) return "clearing an immediate hostile threat";
      return tickCombat(hunter, runner, brain, config, perception);
    case GOALS.CRAFT: {
      safeTrigger(hunter, "manhunt:idle");
      const step = getCraftPlan(hunter);
      const crafted = step ? performCraftStep(hunter, brain) : false;
      if (crafted) notifyCraftMilestone(runner, hunter, brain, step);
      return crafted ? "completed one dependency-aware recipe" : "waiting for a valid recipe dependency";
    }
    case GOALS.SMELT:
      safeTrigger(hunter, "manhunt:idle");
      tickSmelting(hunter, brain);
      return brain.smeltTask ? `smelting ${brain.smeltTask.input.replace("minecraft:", "")}` : "completed smelting";
    case GOALS.VERTICAL_PURSUIT:
      tickVerticalPursuit(hunter, runner, brain, config, perception, target);
      return brain.verticalMode;
    case GOALS.BREAK_PILLAR:
      tickBreakPillar(hunter, runner, brain, config, perception);
      return "breaking the runner's pillar";
    case GOALS.DESTROY_CRYSTALS: {
      const crystal = perception.nearbyEndCrystal;
      if (!isEntityValid(crystal)) return "the crystal is already gone";
      if (distance(hunter.location, crystal.location) > 3.6) {
        tickLongDistanceRoute(hunter, brain, floorLocation(crystal.location), "approaching the end crystal");
        return "approaching the end crystal";
      }
      safeTrigger(hunter, "manhunt:idle");
      safeLookAt(hunter, { x: crystal.location.x, y: crystal.location.y + 0.5, z: crystal.location.z });
      try {
        crystal.applyDamage(20, { cause: EntityDamageCause.EntityAttack, damagingEntity: hunter });
        notifyCrystalBreak(runner, hunter, brain);
        return "destroyed an end crystal";
      } catch {
        return "crystal attack failed";
      }
    }
    case GOALS.DESCEND:
      tickDescent(hunter, runner, brain, config, perception, target);
      return "finding a safe descent";
    case GOALS.USE_BOAT:
      if (tickBoatHandling(hunter, runner, brain, config, perception, true)) return "using or countering a boat route";
      return executeResourceGoal(hunter, runner, brain, config, perception, "wood");
    case GOALS.FOLLOW_DIMENSION: {
      const dimensionBeforeTransit = hunter.dimension.id;
      if (tickPortalTransit(hunter, runner, brain, config)) {
        if (hunter.dimension.id !== dimensionBeforeTransit) notifyDimensionEnter(runner, hunter, brain, hunter.dimension.id);
        return "passing through the portal after a real contact delay";
      }
      const portalTarget = portalTargetForHunter(hunter, runner, brain, config);
      const portalPlan = tickPortalBuild(hunter, runner, brain);
      if (portalPlan.active) {
        if (portalPlan.target) tickLongDistanceRoute(hunter, brain, portalPlan.target, "approaching the next portal-frame block");
        return "constructing a portal";
      }
      if (portalTarget) {
        tickLongDistanceRoute(hunter, brain, portalTarget, "moving to a remembered portal");
        return "following a remembered portal route";
      }
      if (String(runner?.dimension.id ?? "").includes("the_end") && config.endPursuit !== false) {
        // Stronghold sense: a real player knows where they last saw the runner.
        // Navigate that trail while the budgeted perception scan keeps looking
        // for a genuine end portal in loaded chunks.
        const trail = brain.lastSeenLocation ?? getSquadKnowledge().runnerLastKnown;
        if (trail && !hunter.dimension.id.includes("the_end")) {
          tickLongDistanceRoute(hunter, brain, trail, "stronghold sense: retracing the runner's overworld trail");
          return "following the stronghold signal";
        }
      }
      if (!brain.actionPlan && config.portalIntelligence) createPortalBuildPlan(hunter, brain);
      return "searching for or preparing a portal";
    }
    case GOALS.SEARCH:
      tickSearchRoute(hunter, brain, brain.lastSeenLocation);
      return "searching the last known runner position";
    case GOALS.CHASE:
      safeTrigger(hunter, "manhunt:chase");
      if (target && !tickLocalNavigation(hunter, runner, brain, config, perception, target)) returnToChase(hunter, brain);
      return "maintaining native chase with local obstacle planning";
    case GOALS.SHARE_RESOURCES: {
      const teammate = findShareTarget(hunter, getHunters());
      if (!teammate) {
        returnToChase(hunter, brain);
        return "no teammate currently needs the hunter's surplus";
      }
      if (distance(hunter.location, teammate.location) > 3.0) {
        tickLongDistanceRoute(hunter, brain, teammate.location, `approaching ${teammate.nameTag || "teammate"} to share resources`);
        return `approaching ${teammate.nameTag || "teammate"} to share resources`;
      }
      safeTrigger(hunter, "manhunt:idle");
      return `sharing resources with ${teammate.nameTag || "teammate"}`;
    }
    case GOALS.IDLE:
    default:
      safeTrigger(hunter, "manhunt:chase");
      return "keeping the pursuit heartbeat active";
  }
}

function resourceGoalCategory(goal) {
  return GOAL_RESOURCE[goal];
}

export function tickBrain(hunter, runner, config, deaths = 0) {
  const brain = getBrain(hunter);
  if (!brain || !runner) return undefined;
  if (safeDynamicGetBoolean(hunter, "manhunt:ai_paused")) {
    safeTrigger(hunter, "manhunt:idle");
    brain.subAction = "AI paused by developer";
    return brain.perception;
  }
  brain.role = getHunterRole(hunter, brain.role);
  brain.configRouteParticles = config.routeParticles === true;

  // Immediate safety is evaluated every server tick. A five- or ten-tick brain
  // interval is too slow for water-bucket MLG and block-clutch timing.
  const immediate = senseImmediateHazards(hunter, brain);
  tickFallWaterRecovery(hunter, brain);
  syncHunterEquipment(hunter, brain, immediate);
  if (immediate.falling && immediate.groundDistance >= 2) {
    tickFallSafety(hunter, runner, brain, config, immediate);
  }

  const profile = PROFILE_SETTINGS[config.performanceProfile] ?? PROFILE_SETTINGS[1];
  const stagger = (brain.squadIndex * profile.squadStagger) % Math.max(1, profile.brainInterval);
  if ((system.currentTick + stagger) % profile.brainInterval !== 0 && brain.perception) {
    tickWaypointLifecycle(hunter, brain);
    if (brain.actionPlan && brain.actionPlan.type !== "build_portal") tickActionPlan(hunter, runner, brain, config);
    return brain.perception;
  }

  let perception;
  try {
    perception = senseWorld(hunter, runner, brain, config);
    brain.lastPerceptionTick = system.currentTick;
  } catch (error) {
    brain.lastError = `perception: ${error}`;
    brain.lastErrorTick = system.currentTick;
    safeTrigger(hunter, "manhunt:chase");
    return brain.perception;
  }

  tickWaypointLifecycle(hunter, brain);
  tickBoatHandling(hunter, runner, brain, config, perception, false);
  tryFillWaterBucket(hunter, perception);
  rememberNearbyPortal(hunter, perception);
  if (brain.smeltTask) tickSmelting(hunter, brain);
  const elapsed = getElapsedTicks();
  brain.difficultyStage = config.difficultyScaling
    ? Math.max(0, Math.min(6, Math.floor(elapsed / (5 * 60 * 20)) + Math.max(0, Math.trunc(deaths))))
    : 0;
  const candidates = scoreGoals(hunter, runner, brain, config, perception, elapsed);
  brain.lastCandidates = candidates.slice(0, 8).map((entry) => ({ goal: entry.goal, score: Math.round(entry.score), reason: entry.reason }));
  const selected = chooseGoal(brain, config, candidates) ?? candidates[0];
  brain.goalScore = selected?.score ?? 0;
  if (selected) {
    const previousGoal = brain.currentGoal;
    const changedGoal = previousGoal !== selected.goal;
    if (changedGoal && brain.actionPlan && !planCompatibleWithGoal(brain.actionPlan, selected.goal)) {
      clearActionPlan(brain, `goal changed from ${previousGoal} to ${selected.goal}`);
      brain.mineTask = undefined;
    }
    const previousResourceCategory = resourceGoalCategory(previousGoal);
    const nextResourceCategory = resourceGoalCategory(selected.goal);
    if (changedGoal && brain.resourceTarget && previousResourceCategory !== nextResourceCategory) {
      clearResourceTarget(brain);
      brain.mineTask = undefined;
    }
    setGoal(hunter, brain, selected.goal, selected.reason, selected.subAction);
    if (changedGoal || system.currentTick >= (brain.goalLockUntil ?? 0)) lockSelectedGoal(brain, selected.goal, selected.reason);
  }

  let action = "none";
  try {
    const category = resourceGoalCategory(selected?.goal);
    action = category
      ? executeResourceGoal(hunter, runner, brain, config, perception, category)
      : executeGoal(hunter, runner, brain, config, perception, selected ?? { goal: GOALS.CHASE });
    brain.subAction = action || selected?.subAction || "none";
    brain.lastExecutedGoal = selected?.goal ?? brain.currentGoal;
    brain.lastGoalExecutorTick = system.currentTick;
    syncHunterEquipment(hunter, brain, perception, true);
    safeDynamicSet(hunter, "manhunt:brain_action", String(brain.subAction).slice(0, 160));
  } catch (error) {
    brain.lastError = `${selected?.goal ?? "unknown"}: ${error}`;
    brain.lastErrorTick = system.currentTick;
    forceReplan(hunter, brain, "caught AI action error");
    if (NATIVE_CHASE_GOALS.has(brain.currentGoal)) safeTrigger(hunter, "manhunt:chase");
    else safeTrigger(hunter, "manhunt:idle");
  }

  // A permanent heartbeat keeps the native target goal alive. It never disables
  // scripted intelligence; it only repairs component-group desynchronization.
  if (system.currentTick - brain.lastPursuitHeartbeatTick >= 40 && NATIVE_CHASE_GOALS.has(brain.currentGoal)) {
    brain.lastPursuitHeartbeatTick = system.currentTick;
    if (!brain.actionPlan || brain.actionPlan.type === "build_portal") safeTrigger(hunter, "manhunt:chase");
  }

  debugMessage(hunter, config, brain);
  return perception;
}

export function getBrainStatus(hunter) {
  const brain = getBrain(hunter);
  if (!brain) return undefined;
  const snapshot = getBrainSnapshot(brain);
  return {
    ...snapshot,
    perception: brain.perception ? {
      runnerPattern: brain.perception.runnerPattern,
      trapType: brain.perception.trapType,
      submerged: brain.perception.submerged,
      inLava: brain.perception.inLava,
      hazardCount: brain.perception.hazardCount,
      verticalDifference: brain.perception.verticalDifference,
      actualRunnerDistance: brain.perception.actualRunnerDistance
    } : undefined,
    gathering: getGatheringStatus(hunter),
    navigation: getNavigationStatus(hunter, brain),
    combat: combatStatus(brain),
    portal: portalStatus(brain),
    difficultyStage: brain.difficultyStage ?? 0,
    squad: getSquadStatus(getHunters()),
    sharedRunner: getSquadKnowledge().runner
  };
}
