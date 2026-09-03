import { system } from "@minecraft/server";
import { GOALS, PROFILE_SETTINGS } from "./constants.js";
import { getHunterRole, releaseReservations } from "./squad.js";
import { isEntityValid, locationKey, safeDynamicSet } from "./utils.js";
import { planSummary } from "./planner.js";

const brains = new Map();

function emptyResourceMemory() {
  return {
    wood: [], stone: [], blocks: [], coal: [], iron: [], gold: [], diamond: [],
    debris: [], flint: [], portal: [], food: []
  };
}

function createBrain(hunter) {
  const location = { ...hunter.location };
  let squadIndex = 0;
  try {
    squadIndex = Number(hunter.getDynamicProperty("manhunt:squad_index")) || 0;
  } catch {
    // Default role/index is fine.
  }
  return {
    hunterId: hunter.id,
    squadIndex,
    role: getHunterRole(hunter),
    createdTick: system.currentTick,
    currentGoal: GOALS.IDLE,
    goalReason: "waiting for a decision",
    subAction: "none",
    goalSinceTick: system.currentTick,
    goalScore: 0,
    goalLockUntil: 0,
    goalLockReason: "none",
    lastExecutedGoal: GOALS.IDLE,
    lastGoalExecutorTick: -9999,
    lastCandidates: [],
    lastDecisionTick: -9999,
    lastPerceptionTick: -9999,
    lastStatusWriteTick: -9999,
    lastRunnerLocation: undefined,
    lastRunnerDimension: undefined,
    lastSeenLocation: undefined,
    lastSeenDimension: undefined,
    lastSeenTick: -999999,
    runnerVelocity: { x: 0, y: 0, z: 0 },
    runnerVisible: false,
    runnerPattern: "normal",
    runnerTowerStart: undefined,
    runnerBridgeDirection: undefined,
    lastHunterLocation: location,
    lastMoveCheckTick: system.currentTick,
    stuckTicks: 0,
    routeFailures: 0,
    routeBlacklist: new Map(),
    routeMemory: new Map(),
    successfulPaths: new Map(),
    fallMemory: new Map(),
    failedPillars: new Map(),
    waterTraps: new Map(),
    terrainMemory: new Map(),
    placementHistory: new Map(),
    routeAction: "vanilla navigation",
    routeTarget: undefined,
    routeStart: undefined,
    routeStartedTick: 0,
    routeExpiresTick: 0,
    routeMode: undefined,
    routeKey: undefined,
    waypointId: "",
    waypointTargetKey: "",
    waypointSearch: false,
    lastWaypointTriggerTick: -9999,
    lastJumpTick: -9999,
    lastPlaceTick: -9999,
    lastBreakTick: -9999,
    lastBacktrackTick: -9999,
    lastEmergencyTick: -99999,
    lastAttackTick: -9999,
    lastSuccessfulHitTick: -9999,
    lastDamagedTick: -9999,
    lastDamageCause: "none",
    lastDamagerType: "none",
    lastEatTick: -9999,
    lastCraftTick: -9999,
    lastSmeltTick: -9999,
    lastTauntTick: -99999,
    lastBowTick: -99999,
    lastWhiffTick: -99999,
    chatMemory: new Map(),
    lastPersonaChatTick: -99999,
    lastPersonaAmbientTick: -99999,
    nearbyEndPortal: undefined,
    lastEndPortalScanTick: -9999,
    shieldUntilTick: 0,
    underwaterTicks: 0,
    lavaTicks: 0,
    enclosedTicks: 0,
    dimensionWaitTicks: 0,
    dimensionMismatchSince: 0,
    lastFallSaveTick: -99999,
    lastFallSaveAttemptTick: -99999,
    lastImmediateSafetyTick: -99999,
    mlgWater: undefined,
    mlgTarget: undefined,
    lastMlgAdjustTick: -99999,
    lastBoatBreakTick: -99999,
    lastBoatScanTick: -99999,
    activeBoatId: "",
    lastBoatDeployTick: -99999,
    boatNoProgressTicks: 0,
    difficultyStage: 0,
    resourceMemory: emptyResourceMemory(),
    resourceBlacklist: new Map(),
    resourceScan: { category: undefined, originKey: undefined, cursor: 0, offsets: undefined },
    resourceScans: {},
    resourceTarget: undefined,
    resourceApproach: undefined,
    resourceTargetCategory: undefined,
    resourceTargetSinceTick: 0,
    resourceTargetBestDistance: Number.POSITIVE_INFINITY,
    resourceReservationKey: undefined,
    mineTask: undefined,
    smeltTask: undefined,
    pillarTask: undefined,
    verticalPlan: undefined,
    descentPlan: undefined,
    verticalTraversalUntil: 0,
    lastVerticalProgressTick: system.currentTick,
    verticalBestY: location.y,
    verticalMode: "none",
    verticalBlockRequirement: 0,
    placedBlocks: new Set(),
    placedBlockMeta: new Map(),
    pendingPlacement: undefined,
    recentPositions: [],
    recentWaypoints: [],
    lastDebugMessage: "",
    lastDebugTick: -9999,
    lastEquipmentSyncTick: -9999,
    equipmentContext: "none",
    progressSnapshot: undefined,
    lastProgressSnapshotTick: -9999,
    holdMainhandItem: undefined,
    holdMainhandUntilTick: 0,
    lastVisibleMainhand: undefined,
    lastVisibleMainhandUntilTick: 0,
    lastError: "none",
    lastErrorTick: -9999,
    pendingCombatStep: undefined,
    needsBuildingBlocksUntil: 0,
    needsBuildingBlocksReason: "",
    lastPursuitHeartbeatTick: -9999,
    lastNativeAssistTick: -9999,
    actionPlan: undefined,
    completedPlanOutcome: undefined,
    failedPlanOutcome: undefined,
    lastPlannedAction: "none",
    lastSuccessfulAction: "none",
    lastFailedAction: "none",
    lastWorkTick: system.currentTick,
    workload: { operations: 0, scans: 0, plans: 0, placements: 0, breaks: 0 },
    workloadRateTick: system.currentTick,
    workloadRateBaseline: { operations: 0, scans: 0, plans: 0, placements: 0, breaks: 0 },
    workloadPerSecond: { operations: 0, scans: 0, plans: 0, placements: 0, breaks: 0 },
    perception: undefined,
    lastMemoryPruneTick: system.currentTick
  };
}

function pruneExpiringCache(map, maximum) {
  if (!(map instanceof Map)) return;
  for (const [key, expiry] of map) {
    if (!Number.isFinite(expiry) || expiry <= system.currentTick) map.delete(key);
  }
  while (map.size > maximum) map.delete(map.keys().next().value);
}

function pruneBrainCaches(brain) {
  if (!brain || system.currentTick - (brain.lastMemoryPruneTick ?? -9999) < 100) return;
  brain.lastMemoryPruneTick = system.currentTick;
  pruneExpiringCache(brain.routeBlacklist, 128);
  pruneExpiringCache(brain.resourceBlacklist, 96);
}

export function getBrain(hunter) {
  if (!isEntityValid(hunter)) return undefined;
  let brain = brains.get(hunter.id);
  if (!brain) {
    brain = createBrain(hunter);
    brains.set(hunter.id, brain);
  }
  pruneBrainCaches(brain);
  brain.role = getHunterRole(hunter, brain.role);
  return brain;
}

export function getAllBrains() {
  return [...brains.values()];
}

export function clearBrain(hunterOrId) {
  const id = typeof hunterOrId === "string" ? hunterOrId : hunterOrId?.id;
  if (!id) return;
  releaseReservations(id);
  brains.delete(id);
}

export function clearAllBrains() {
  for (const id of brains.keys()) releaseReservations(id);
  brains.clear();
}

export function pruneBrains(activeHunterIds = []) {
  const active = new Set(Array.isArray(activeHunterIds) ? activeHunterIds : [activeHunterIds].filter(Boolean));
  for (const id of brains.keys()) if (!active.has(id)) clearBrain(id);
}

export function setGoal(hunter, brain, goal, reason, subAction = "none") {
  if (!brain) return;
  const nextReason = reason || "no reason recorded";
  const nextAction = subAction || "none";
  const changed = brain.currentGoal !== goal || brain.goalReason !== nextReason || brain.subAction !== nextAction;
  if (brain.currentGoal !== goal) {
    brain.currentGoal = goal;
    brain.goalSinceTick = system.currentTick;
  }
  brain.goalReason = nextReason;
  brain.subAction = nextAction;
  if (!changed && system.currentTick - brain.lastStatusWriteTick < 40) return;
  brain.lastStatusWriteTick = system.currentTick;
  safeDynamicSet(hunter, "manhunt:brain_goal", brain.currentGoal);
  safeDynamicSet(hunter, "manhunt:brain_reason", brain.goalReason.slice(0, 240));
  safeDynamicSet(hunter, "manhunt:brain_action", brain.subAction.slice(0, 160));
}

export function setRouteStatus(hunter, brain, action, target = undefined, mode = undefined) {
  if (!brain) return;
  const nextAction = action || "vanilla navigation";
  const changed = brain.routeAction !== nextAction || brain.routeMode !== mode;
  brain.routeAction = nextAction;
  brain.routeTarget = target ? { ...target } : undefined;
  brain.routeMode = mode;
  if (!changed && system.currentTick - (brain.lastRouteStatusWriteTick ?? -9999) < 40) return;
  brain.lastRouteStatusWriteTick = system.currentTick;
  safeDynamicSet(hunter, "manhunt:route_action", brain.routeAction.slice(0, 160));
}

function pruneMap(map, maximum, expiryTick = undefined) {
  const now = system.currentTick;
  if (Number.isFinite(expiryTick)) {
    for (const [key, value] of map) {
      const tick = typeof value === "number" ? value : value?.tick;
      if (Number.isFinite(tick) && now - tick > expiryTick) map.delete(key);
    }
  }
  while (map.size > maximum) map.delete(map.keys().next().value);
}

export function routeMemoryPenalty(brain, key) {
  if (!brain || !key) return 0;
  const matching = [];
  const exact = brain.routeMemory.get(key);
  if (exact) matching.push([key, exact]);
  for (const pair of brain.routeMemory) {
    if (pair[0] !== key && pair[0].startsWith(`${key}|`)) matching.push(pair);
  }
  if (!matching.length) return 0;
  let penalty = 0;
  for (const [entryKey, entry] of matching) {
    const age = system.currentTick - entry.lastUsedTick;
    if (age > 20 * 180) {
      brain.routeMemory.delete(entryKey);
      brain.successfulPaths.delete(entryKey);
      continue;
    }
    penalty += entry.failures * 28 + entry.falls * 60 + entry.danger * 12 - entry.successes * 14;
  }
  // Successful remembered routes receive a bounded preference, while repeated
  // failures still make the lane unattractive or blacklisted.
  return Math.max(-42, penalty);
}

export function recordRouteOutcome(brain, key, action, success, details = {}) {
  if (!brain || !key) return;
  const entry = brain.routeMemory.get(key) ?? {
    action,
    successes: 0,
    failures: 0,
    falls: 0,
    danger: 0,
    lastUsedTick: system.currentTick,
    lastReason: "none"
  };
  entry.action = action ?? entry.action;
  entry.lastUsedTick = system.currentTick;
  entry.lastReason = details.reason ?? entry.lastReason;
  if (success) entry.successes++;
  else entry.failures++;
  if (details.fell) entry.falls++;
  if (Number.isFinite(details.danger)) entry.danger = Math.min(20, entry.danger + details.danger);
  brain.routeMemory.set(key, entry);
  if (success) {
    brain.successfulPaths.set(key, {
      action: entry.action,
      successes: entry.successes,
      lastUsedTick: system.currentTick,
      lastReason: entry.lastReason
    });
  } else if (entry.failures >= 2 && entry.failures > entry.successes) {
    brain.successfulPaths.delete(key);
  }
  const maximum = PROFILE_SETTINGS[1].maxRouteMemory;
  pruneMap(brain.successfulPaths, maximum, 20 * 300);
  pruneMap(brain.routeMemory, maximum, 20 * 300);
  if (entry.failures >= 2 && entry.failures > entry.successes) brain.routeBlacklist.set(key, system.currentTick + 20 * 30);
}

export function recordFall(brain, dimensionId, location, reason = "fell") {
  if (!brain || !location) return;
  const key = locationKey(location, dimensionId);
  const entry = brain.fallMemory.get(key) ?? { count: 0, tick: 0, reason };
  entry.count++;
  entry.tick = system.currentTick;
  entry.reason = reason;
  brain.fallMemory.set(key, entry);
  recordRouteOutcome(brain, key, "fall", false, { fell: true, danger: 3, reason });
  pruneMap(brain.fallMemory, 64, 20 * 300);
}

export function recordFailedPillar(brain, dimensionId, location, reason = "failed pillar") {
  if (!brain || !location) return;
  const key = locationKey(location, dimensionId);
  const entry = brain.failedPillars.get(key) ?? { count: 0, tick: 0, reason };
  entry.count++;
  entry.tick = system.currentTick;
  entry.reason = reason;
  brain.failedPillars.set(key, entry);
  if (entry.count >= 2) brain.routeBlacklist.set(key, system.currentTick + 20 * 60);
  pruneMap(brain.failedPillars, 48, 20 * 300);
}

export function pillarFailureCount(brain, dimensionId, location) {
  return brain?.failedPillars.get(locationKey(location, dimensionId))?.count ?? 0;
}

export function recordPlacementAttempt(brain, dimensionId, location, success, reason = "") {
  if (!brain || !location) return;
  const key = locationKey(location, dimensionId);
  const entry = brain.placementHistory.get(key) ?? { successes: 0, failures: 0, tick: 0, reason: "" };
  if (success) entry.successes++;
  else entry.failures++;
  entry.tick = system.currentTick;
  entry.reason = reason;
  brain.placementHistory.set(key, entry);
  pruneMap(brain.placementHistory, 160, 20 * 300);
}

export function placementFailureCount(brain, dimensionId, location) {
  return brain?.placementHistory.get(locationKey(location, dimensionId))?.failures ?? 0;
}

export function rememberTerrain(brain, dimensionId, location, type, score = 1) {
  if (!brain || !location) return;
  const key = locationKey(location, dimensionId);
  brain.terrainMemory.set(key, { dimensionId, location: { ...location }, type, score, tick: system.currentTick });
  pruneMap(brain.terrainMemory, 96, 20 * 300);
}

export function rememberWaterTrap(brain, dimensionId, location) {
  if (!brain || !location) return;
  const key = locationKey(location, dimensionId);
  const previous = brain.waterTraps.get(key) ?? { count: 0, tick: 0 };
  previous.count++;
  previous.tick = system.currentTick;
  brain.waterTraps.set(key, previous);
  pruneMap(brain.waterTraps, 48, 20 * 300);
}

export function markPlacedBlock(brain, key, metadata = {}) {
  if (!brain || !key) return;
  if (brain.placedBlocks.size > 512) {
    const first = brain.placedBlocks.values().next().value;
    if (first) {
      brain.placedBlocks.delete(first);
      brain.placedBlockMeta.delete(first);
    }
  }
  brain.placedBlocks.add(key);
  brain.placedBlockMeta.set(key, { ...metadata, tick: system.currentTick });
}

export function rememberPosition(brain, location) {
  if (!brain || !location) return;
  brain.recentPositions.push({ ...location, tick: system.currentTick });
  if (brain.recentPositions.length > 24) brain.recentPositions.shift();
}

export function recordWork(brain, kind, amount = 1) {
  if (!brain) return;
  brain.workload.operations += amount;
  if (kind === "scan") brain.workload.scans += amount;
  if (kind === "plan") brain.workload.plans += amount;
  if (kind === "placement") brain.workload.placements += amount;
  if (kind === "break") brain.workload.breaks += amount;
  brain.lastWorkTick = system.currentTick;
}

function refreshWorkloadRate(brain) {
  const elapsed = Math.max(0, system.currentTick - (brain.workloadRateTick ?? system.currentTick));
  if (elapsed < 20) return;
  const baseline = brain.workloadRateBaseline ?? { operations: 0, scans: 0, plans: 0, placements: 0, breaks: 0 };
  const rate = {};
  for (const key of ["operations", "scans", "plans", "placements", "breaks"]) {
    const current = Number(brain.workload?.[key] ?? 0);
    const previous = Number(baseline[key] ?? 0);
    rate[key] = Math.max(0, Math.round(((current - previous) * 20 / elapsed) * 10) / 10);
  }
  brain.workloadPerSecond = rate;
  brain.workloadRateBaseline = { ...brain.workload };
  brain.workloadRateTick = system.currentTick;
}

export function getBrainSnapshot(brain) {
  if (!brain) return undefined;
  refreshWorkloadRate(brain);
  return {
    role: brain.role,
    squadIndex: brain.squadIndex,
    goal: brain.currentGoal,
    reason: brain.goalReason,
    subAction: brain.subAction,
    goalScore: brain.goalScore ?? 0,
    goalLockTicks: Math.max(0, (brain.goalLockUntil ?? 0) - system.currentTick),
    goalLockReason: brain.goalLockReason ?? "none",
    lastExecutedGoal: brain.lastExecutedGoal ?? GOALS.IDLE,
    difficultyStage: brain.difficultyStage ?? 0,
    candidates: Array.isArray(brain.lastCandidates) ? brain.lastCandidates.map((entry) => ({ ...entry })) : [],
    goalTicks: Math.max(0, system.currentTick - brain.goalSinceTick),
    runnerVisible: brain.runnerVisible,
    runnerPattern: brain.runnerPattern,
    lastSeenLocation: brain.lastSeenLocation ? { ...brain.lastSeenLocation } : undefined,
    lastSeenDimension: brain.lastSeenDimension,
    lastSeenAgo: Math.max(0, system.currentTick - brain.lastSeenTick),
    stuckTicks: brain.stuckTicks,
    routeFailures: brain.routeFailures,
    routeBlacklistCount: brain.routeBlacklist.size,
    routeMemoryCount: brain.routeMemory.size,
    successfulPathCount: brain.successfulPaths.size,
    failedPillarCount: brain.failedPillars.size,
    fallMemoryCount: brain.fallMemory.size,
    routeAction: brain.routeAction,
    routeTarget: brain.routeTarget ? { ...brain.routeTarget } : undefined,
    resourceTarget: brain.resourceTarget ? { ...brain.resourceTarget } : undefined,
    resourceApproach: brain.resourceApproach ? { ...brain.resourceApproach } : undefined,
    resourceTargetCategory: brain.resourceTargetCategory,
    blacklistCount: brain.resourceBlacklist.size,
    placedBlockCount: brain.placedBlocks.size,
    activeBoat: Boolean(brain.activeBoatId),
    underwaterTicks: brain.underwaterTicks,
    lavaTicks: brain.lavaTicks,
    mineTask: brain.mineTask ? { ...brain.mineTask } : undefined,
    smeltTask: brain.smeltTask ? { ...brain.smeltTask } : undefined,
    pillarTask: brain.pillarTask ? { ...brain.pillarTask } : undefined,
    verticalTraversalActive: Boolean(brain.verticalPlan || brain.pillarTask) || system.currentTick < (brain.verticalTraversalUntil ?? 0),
    verticalMode: brain.verticalMode ?? "none",
    verticalBlockRequirement: brain.verticalBlockRequirement ?? 0,
    lastVerticalProgressAgo: Math.max(0, system.currentTick - (brain.lastVerticalProgressTick ?? -9999)),
    activePlan: planSummary(brain),
    lastPlannedAction: brain.lastPlannedAction,
    lastSuccessfulAction: brain.lastSuccessfulAction,
    lastFailedAction: brain.lastFailedAction,
    lastError: brain.lastError ?? "none",
    lastErrorAgo: Math.max(0, system.currentTick - (brain.lastErrorTick ?? -9999)),
    lastDamageCause: brain.lastDamageCause ?? "none",
    lastDamagerType: brain.lastDamagerType ?? "none",
    lastDamagedAgo: Math.max(0, system.currentTick - (brain.lastDamagedTick ?? -9999)),
    workload: { ...brain.workload },
    workloadPerSecond: { ...(brain.workloadPerSecond ?? {}) }
  };
}
