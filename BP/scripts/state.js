import { system, world } from "@minecraft/server";
import {
  AI_LEVELS,
  DEFAULT_CONFIG,
  PERFORMANCE_PROFILES,
  PREP_MODES,
  RISK_PROFILES,
  SKINS,
  SQUAD_PRESETS,
  WIN_MODES
} from "./constants.js";
import {
  cleanName,
  finiteInteger,
  isEntityValid,
  safeIndex,
  steppedInteger
} from "./utils.js";

const CONFIG_KEY = "manhunt:config";
const RUNTIME_KEY = "manhunt:runtime_v100";
const PREVIOUS_RUNTIME_KEYS = ["manhunt:runtime_v110", "manhunt:runtime_v100_beta"];

const OLD_KEYS = Object.freeze({
  active: "manhunt:active",
  runnerId: "manhunt:runner_id",
  hunterId: "manhunt:hunter_id",
  startTick: "manhunt:start_tick",
  hunterDeaths: "manhunt:hunter_deaths",
  respawning: "manhunt:respawning"
});

const DEFAULT_RUNTIME = Object.freeze({
  schema: 6,
  active: false,
  runnerId: "",
  hunterId: "",
  hunterIds: [],
  phase: "idle",
  hunterDeaths: 0,
  deathMap: {},
  elapsedTicks: 0,
  sessionStartTick: 0,
  dueTick: 0,
  respawnQueue: [],
  pendingSnapshots: {},
  huntSerial: 0
});

let initialized = false;
let configCache = { ...DEFAULT_CONFIG };
let runtimeCache = { ...DEFAULT_RUNTIME };
let runnerCache;
const hunterCache = new Map();
let lastElapsedCheckpoint = 0;

function boolValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function normalizeConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    schema: 9,
    hunterName: cleanName(source.hunterName, DEFAULT_CONFIG.hunterName),
    skin: safeIndex(source.skin, SKINS, DEFAULT_CONFIG.skin),
    aiLevel: safeIndex(source.aiLevel, AI_LEVELS, DEFAULT_CONFIG.aiLevel),
    winMode: safeIndex(source.winMode, WIN_MODES, DEFAULT_CONFIG.winMode),
    livesOrKills: finiteInteger(source.livesOrKills, 1, 40, DEFAULT_CONFIG.livesOrKills),
    timeMinutes: steppedInteger(source.timeMinutes, 5, 240, 5, DEFAULT_CONFIG.timeMinutes),
    prepMode: safeIndex(source.prepMode, PREP_MODES, DEFAULT_CONFIG.prepMode),
    gathering: boolValue(source.gathering, DEFAULT_CONFIG.gathering),
    difficultyScaling: boolValue(source.difficultyScaling, DEFAULT_CONFIG.difficultyScaling),
    equipmentPersistence: boolValue(source.equipmentPersistence, DEFAULT_CONFIG.equipmentPersistence),
    taunts: boolValue(source.taunts, DEFAULT_CONFIG.taunts),
    performanceProfile: safeIndex(source.performanceProfile, PERFORMANCE_PROFILES, DEFAULT_CONFIG.performanceProfile),
    riskProfile: safeIndex(source.riskProfile, RISK_PROFILES, DEFAULT_CONFIG.riskProfile),
    stealthTracking: boolValue(source.stealthTracking, DEFAULT_CONFIG.stealthTracking),
    humanMistakes: boolValue(source.humanMistakes, DEFAULT_CONFIG.humanMistakes),
    debugMode: boolValue(source.debugMode, DEFAULT_CONFIG.debugMode),
    routeParticles: boolValue(source.routeParticles, DEFAULT_CONFIG.routeParticles),
    cleanupPlacedBlocks: boolValue(source.cleanupPlacedBlocks, DEFAULT_CONFIG.cleanupPlacedBlocks),
    emergencyRecovery: boolValue(source.emergencyRecovery, DEFAULT_CONFIG.emergencyRecovery),
    destroyBoats: boolValue(source.destroyBoats, DEFAULT_CONFIG.destroyBoats),
    hunterCount: finiteInteger(source.hunterCount, 1, 4, DEFAULT_CONFIG.hunterCount),
    squadPreset: safeIndex(source.squadPreset, SQUAD_PRESETS, DEFAULT_CONFIG.squadPreset),
    portalIntelligence: boolValue(source.portalIntelligence, DEFAULT_CONFIG.portalIntelligence),
    advancedMining: boolValue(source.advancedMining, DEFAULT_CONFIG.advancedMining),
    safeBuilding: boolValue(source.safeBuilding, DEFAULT_CONFIG.safeBuilding),
    netheriteProgression: boolValue(source.netheriteProgression, DEFAULT_CONFIG.netheriteProgression),
    endPursuit: boolValue(source.endPursuit, DEFAULT_CONFIG.endPursuit),
    chatPersonality: boolValue(source.chatPersonality, DEFAULT_CONFIG.chatPersonality)
  };
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const inventory = {};
  if (value.inventory && typeof value.inventory === "object") {
    for (const [typeId, amount] of Object.entries(value.inventory)) {
      const count = finiteInteger(amount, 0, 4096, 0);
      if (typeof typeId === "string" && count > 0) inventory[typeId] = count;
    }
  }
  return {
    statsOnly: value.statsOnly === true,
    inventory,
    pickTier: finiteInteger(value.pickTier, 0, 5, 0),
    swordTier: finiteInteger(value.swordTier, 0, 5, 0),
    axeTier: finiteInteger(value.axeTier, 0, 5, 0),
    shovelTier: finiteInteger(value.shovelTier, 0, 5, 0),
    armorTier: finiteInteger(value.armorTier, 0, 5, 0),
    ironHelmet: value.ironHelmet === true,
    ironChestplate: value.ironChestplate === true,
    ironLeggings: value.ironLeggings === true,
    ironBoots: value.ironBoots === true,
    diamondHelmet: value.diamondHelmet === true,
    diamondChestplate: value.diamondChestplate === true,
    diamondLeggings: value.diamondLeggings === true,
    diamondBoots: value.diamondBoots === true,
    netheriteHelmet: value.netheriteHelmet === true,
    netheriteChestplate: value.netheriteChestplate === true,
    netheriteLeggings: value.netheriteLeggings === true,
    netheriteBoots: value.netheriteBoots === true,
    hasCraftingTable: value.hasCraftingTable === true,
    hasFurnace: value.hasFurnace === true,
    hasShield: value.hasShield === true,
    hasBow: value.hasBow === true,
    prepComplete: value.prepComplete === true,
    fuelCharges: finiteInteger(value.fuelCharges, 0, 128, 0),
    blocksMined: finiteInteger(value.blocksMined, 0, 10000000, 0),
    recipesCrafted: finiteInteger(value.recipesCrafted, 0, 10000000, 0),
    itemsProduced: finiteInteger(value.itemsProduced, 0, 10000000, 0),
    itemsSmelted: finiteInteger(value.itemsSmelted, 0, 10000000, 0),
    routeJumps: finiteInteger(value.routeJumps, 0, 10000000, 0),
    routeBlocksPlaced: finiteInteger(value.routeBlocksPlaced, 0, 10000000, 0),
    routeBlocksBroken: finiteInteger(value.routeBlocksBroken, 0, 10000000, 0),
    mlgSaves: finiteInteger(value.mlgSaves, 0, 10000000, 0),
    blockClutches: finiteInteger(value.blockClutches, 0, 10000000, 0),
    boatsDestroyed: finiteInteger(value.boatsDestroyed, 0, 10000000, 0),
    boatsUsed: finiteInteger(value.boatsUsed, 0, 10000000, 0)
  };
}

function normalizeRespawnEntry(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    index: finiteInteger(value.index, 0, 3, 0),
    role: typeof value.role === "string" ? value.role.slice(0, 24) : "Chaser",
    dueTick: finiteInteger(value.dueTick, 0, 2147480000, system.currentTick + 100),
    snapshot: normalizeSnapshot(value.snapshot)
  };
}

function normalizeRuntime(input) {
  const source = input && typeof input === "object" ? input : {};
  const phase = ["idle", "countdown", "running"].includes(source.phase) ? source.phase : "idle";
  const ids = Array.isArray(source.hunterIds)
    ? source.hunterIds.filter((id) => typeof id === "string" && id.length > 0).slice(0, 4)
    : (typeof source.hunterId === "string" && source.hunterId ? [source.hunterId] : []);
  const deathMap = {};
  if (source.deathMap && typeof source.deathMap === "object") {
    for (const [key, value] of Object.entries(source.deathMap)) deathMap[key] = finiteInteger(value, 0, 1000000, 0);
  }
  const pendingSnapshots = {};
  if (source.pendingSnapshots && typeof source.pendingSnapshots === "object") {
    for (const [key, value] of Object.entries(source.pendingSnapshots)) {
      const snapshot = normalizeSnapshot(value);
      if (snapshot) pendingSnapshots[key] = snapshot;
    }
  } else if (source.pendingSnapshot) {
    const snapshot = normalizeSnapshot(source.pendingSnapshot);
    if (snapshot) pendingSnapshots["0"] = snapshot;
  }
  const respawnQueue = Array.isArray(source.respawnQueue)
    ? source.respawnQueue.map(normalizeRespawnEntry).filter(Boolean).slice(0, 8)
    : [];
  return {
    schema: 6,
    active: source.active === true,
    runnerId: typeof source.runnerId === "string" ? source.runnerId : "",
    hunterId: ids[0] ?? "",
    hunterIds: ids,
    phase,
    hunterDeaths: finiteInteger(source.hunterDeaths, 0, 1000000, 0),
    deathMap,
    elapsedTicks: finiteInteger(source.elapsedTicks, 0, 2147480000, 0),
    sessionStartTick: finiteInteger(source.sessionStartTick, 0, 2147480000, 0),
    dueTick: finiteInteger(source.dueTick, 0, 2147480000, 0),
    respawnQueue,
    pendingSnapshots,
    huntSerial: finiteInteger(source.huntSerial, 0, 1000000, 0)
  };
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function persistConfig() {
  world.setDynamicProperty(CONFIG_KEY, JSON.stringify(configCache));
}

function persistRuntime() {
  world.setDynamicProperty(RUNTIME_KEY, JSON.stringify(runtimeCache));
}

function readPreviousRuntime() {
  for (const key of PREVIOUS_RUNTIME_KEYS) {
    try {
      const value = world.getDynamicProperty(key);
      if (typeof value === "string" && value.length > 0) return parseJson(value, undefined);
    } catch {
      // Try another migration source.
    }
  }
  return undefined;
}

function migrateOldRuntime() {
  let oldActive = false;
  let runnerId = "";
  let hunterId = "";
  let hunterDeaths = 0;
  try {
    oldActive = world.getDynamicProperty(OLD_KEYS.active) === true;
    const runner = world.getDynamicProperty(OLD_KEYS.runnerId);
    const hunter = world.getDynamicProperty(OLD_KEYS.hunterId);
    const deaths = world.getDynamicProperty(OLD_KEYS.hunterDeaths);
    runnerId = typeof runner === "string" ? runner : "";
    hunterId = typeof hunter === "string" ? hunter : "";
    hunterDeaths = typeof deaths === "number" && Number.isFinite(deaths) ? Math.max(0, Math.trunc(deaths)) : 0;
  } catch {
    return { ...DEFAULT_RUNTIME };
  }
  return {
    ...DEFAULT_RUNTIME,
    active: oldActive,
    runnerId,
    hunterId,
    hunterIds: hunterId ? [hunterId] : [],
    hunterDeaths,
    phase: oldActive ? "running" : "idle"
  };
}

export function initializeState() {
  if (initialized) return true;
  const rawConfig = world.getDynamicProperty(CONFIG_KEY);
  configCache = normalizeConfig({ ...DEFAULT_CONFIG, ...parseJson(rawConfig, {}) });
  persistConfig();

  const rawRuntime = world.getDynamicProperty(RUNTIME_KEY);
  const parsedRuntime = typeof rawRuntime === "string" ? parseJson(rawRuntime, undefined) : undefined;
  runtimeCache = normalizeRuntime(parsedRuntime ?? readPreviousRuntime() ?? migrateOldRuntime());
  const previousSessionTick = runtimeCache.sessionStartTick;
  if (runtimeCache.active && runtimeCache.respawnQueue.length) {
    runtimeCache.respawnQueue = runtimeCache.respawnQueue.map((entry) => {
      const estimatedRemaining = previousSessionTick > 0 ? entry.dueTick - previousSessionTick : 40;
      const remaining = Math.max(1, Math.min(200, Number.isFinite(estimatedRemaining) ? estimatedRemaining : 40));
      return { ...entry, dueTick: system.currentTick + remaining };
    });
  }
  runtimeCache.sessionStartTick = system.currentTick;
  if (runtimeCache.active && runtimeCache.phase === "countdown") runtimeCache.dueTick = system.currentTick + 40;
  if (!runtimeCache.active) runtimeCache = { ...DEFAULT_RUNTIME, sessionStartTick: system.currentTick };

  initialized = true;
  lastElapsedCheckpoint = system.currentTick;
  persistRuntime();
  return true;
}

export function isStateReady() {
  return initialized;
}

function requireReady() {
  if (!initialized) throw new Error("Manhunt state is not initialized yet.");
}

export function getConfig() {
  requireReady();
  return { ...configCache };
}

export function saveConfig(value) {
  requireReady();
  configCache = normalizeConfig({ ...configCache, ...(value ?? {}) });
  persistConfig();
  return { ...configCache };
}

export function resetConfig() {
  requireReady();
  configCache = { ...DEFAULT_CONFIG };
  persistConfig();
  return { ...configCache };
}

function legacyIndex(value, values, fallback) {
  const index = values.indexOf(value);
  return index >= 0 ? index : fallback;
}

export function migrateLegacyPlayerConfig(player) {
  requireReady();
  if (!player || typeof player.id !== "string") return false;
  const markerKey = `manhunt:v070_config_migrated_${player.id}`;
  try {
    if (world.getDynamicProperty(markerKey) === true) return false;
    const raw = world.getDynamicProperty(`manhunt:last_config_${player.id}`);
    if (typeof raw !== "string" || raw.length === 0) return false;
    const legacy = JSON.parse(raw);
    if (!legacy || typeof legacy !== "object") return false;
    const winMode = legacyIndex(legacy.winCondition, ["limited_lives", "time_limit", "kill_count", "infinite"], DEFAULT_CONFIG.winMode);
    const aiLevel = legacyIndex(legacy.aiLevel, ["easy", "normal", "expert"], DEFAULT_CONFIG.aiLevel);
    const prepMode = legacyIndex(legacy.prepBehavior, ["hybrid", "pure_chase", "aggressive"], DEFAULT_CONFIG.prepMode);
    configCache = normalizeConfig({
      ...configCache,
      hunterName: legacy.name,
      skin: legacy.skinId,
      aiLevel,
      winMode,
      livesOrKills: winMode === 2 ? legacy.killTarget : legacy.maxLives,
      timeMinutes: legacy.timeLimitMinutes,
      prepMode,
      gathering: legacy.prepBehavior !== "pure_chase",
      difficultyScaling: legacy.difficultyScaling,
      equipmentPersistence: legacy.equipmentPersistence,
      taunts: legacy.enableTaunts,
      destroyBoats: legacy.boatHandling !== "ignore",
      debugMode: legacy.respawnDebug
    });
    persistConfig();
    world.setDynamicProperty(markerKey, true);
    return true;
  } catch {
    return false;
  }
}

export function getRuntime() {
  requireReady();
  return normalizeRuntime(runtimeCache);
}

export function updateRuntime(patch, persist = true) {
  requireReady();
  const previousRunnerId = runtimeCache.runnerId;
  const previousIds = runtimeCache.hunterIds.join("|");
  runtimeCache = normalizeRuntime({ ...runtimeCache, ...(patch ?? {}) });
  if (runtimeCache.runnerId !== previousRunnerId) runnerCache = undefined;
  if (runtimeCache.hunterIds.join("|") !== previousIds) hunterCache.clear();
  if (persist) persistRuntime();
  return getRuntime();
}

export function beginNewHunt(runnerId, countdownTicks = 200) {
  requireReady();
  runtimeCache = {
    ...DEFAULT_RUNTIME,
    active: true,
    runnerId: typeof runnerId === "string" ? runnerId : "",
    phase: "countdown",
    elapsedTicks: 0,
    sessionStartTick: system.currentTick,
    dueTick: system.currentTick + Math.max(1, Math.trunc(countdownTicks)),
    huntSerial: (runtimeCache.huntSerial ?? 0) + 1
  };
  runnerCache = undefined;
  hunterCache.clear();
  lastElapsedCheckpoint = system.currentTick;
  persistRuntime();
}

export function clearRuntimeState() {
  requireReady();
  runtimeCache = { ...DEFAULT_RUNTIME, sessionStartTick: system.currentTick, huntSerial: runtimeCache.huntSerial ?? 0 };
  runnerCache = undefined;
  hunterCache.clear();
  lastElapsedCheckpoint = system.currentTick;
  persistRuntime();
}

export function isHuntActive() {
  requireReady();
  return runtimeCache.active === true;
}

export function getElapsedTicks() {
  requireReady();
  if (!runtimeCache.active) return 0;
  if (runtimeCache.phase !== "running") return Math.max(0, runtimeCache.elapsedTicks);
  return Math.max(0, runtimeCache.elapsedTicks + (system.currentTick - runtimeCache.sessionStartTick));
}

export function checkpointElapsed(force = false) {
  requireReady();
  if (!runtimeCache.active) return;
  if (!force && system.currentTick - lastElapsedCheckpoint < 100) return;
  if (runtimeCache.phase === "running") {
    runtimeCache.elapsedTicks = getElapsedTicks();
    runtimeCache.sessionStartTick = system.currentTick;
  }
  lastElapsedCheckpoint = system.currentTick;
  persistRuntime();
}

export function getRunner() {
  requireReady();
  const id = runtimeCache.runnerId;
  if (!id) return undefined;
  if (isEntityValid(runnerCache) && runnerCache.id === id) return runnerCache;
  try {
    runnerCache = world.getPlayers().find((player) => player.id === id);
  } catch {
    runnerCache = undefined;
  }
  return runnerCache;
}

function resolveHunter(id) {
  if (!id) return undefined;
  const cached = hunterCache.get(id);
  if (isEntityValid(cached)) return cached;
  try {
    const entity = world.getEntity(id);
    if (isEntityValid(entity)) {
      hunterCache.set(id, entity);
      return entity;
    }
  } catch {
    // Entity is unloaded or invalid.
  }
  hunterCache.delete(id);
  return undefined;
}

export function getHunters() {
  requireReady();
  const hunters = [];
  for (const id of runtimeCache.hunterIds) {
    const hunter = resolveHunter(id);
    if (hunter) hunters.push(hunter);
  }
  return hunters;
}

export function getHunter() {
  return getHunters()[0];
}

export function setHunterIds(ids) {
  const next = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id).slice(0, 4) : [];
  return updateRuntime({ hunterIds: next, hunterId: next[0] ?? "" });
}

export function addHunterId(id) {
  if (typeof id !== "string" || !id) return getRuntime();
  const ids = runtimeCache.hunterIds.filter((entry) => entry !== id);
  ids.push(id);
  return setHunterIds(ids);
}

export function removeHunterId(id) {
  return setHunterIds(runtimeCache.hunterIds.filter((entry) => entry !== id));
}

export function setPhase(phase, dueTick = 0) {
  requireReady();
  const nextPhase = ["idle", "countdown", "running"].includes(phase) ? phase : "idle";
  const patch = { phase: nextPhase, dueTick };
  if (nextPhase === "running" && runtimeCache.phase !== "running") {
    patch.elapsedTicks = runtimeCache.phase === "countdown" ? 0 : runtimeCache.elapsedTicks;
    patch.sessionStartTick = system.currentTick;
    lastElapsedCheckpoint = system.currentTick;
  }
  updateRuntime(patch);
}

export function setHunterDeaths(value) {
  updateRuntime({ hunterDeaths: finiteInteger(value, 0, 1000000, 0) });
}

export function incrementHunterDeaths(index = 0) {
  const key = String(finiteInteger(index, 0, 3, 0));
  const deathMap = { ...runtimeCache.deathMap, [key]: (runtimeCache.deathMap[key] ?? 0) + 1 };
  updateRuntime({ hunterDeaths: runtimeCache.hunterDeaths + 1, deathMap });
}

export function queueRespawn(entry) {
  const normalized = normalizeRespawnEntry(entry);
  if (!normalized) return;
  const queue = runtimeCache.respawnQueue.filter((item) => item.index !== normalized.index);
  queue.push(normalized);
  updateRuntime({ respawnQueue: queue });
}

export function removeRespawnIndex(index) {
  updateRuntime({ respawnQueue: runtimeCache.respawnQueue.filter((entry) => entry.index !== index) });
}

export function setPendingSnapshot(index, snapshot) {
  const key = String(finiteInteger(index, 0, 3, 0));
  const pendingSnapshots = { ...runtimeCache.pendingSnapshots };
  const normalized = normalizeSnapshot(snapshot);
  if (normalized) pendingSnapshots[key] = normalized;
  else delete pendingSnapshots[key];
  updateRuntime({ pendingSnapshots });
}

export function getPendingSnapshot(index) {
  return normalizeSnapshot(runtimeCache.pendingSnapshots[String(index)]);
}

export function clearPendingSnapshot(index) {
  setPendingSnapshot(index, undefined);
}
