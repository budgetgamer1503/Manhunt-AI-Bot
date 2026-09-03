import { ItemStack, system, world } from "@minecraft/server";
import {
  COMPASS_ID,
  HUNTER_ID,
  HUNTER_ROLES,
  PERFORMANCE_PROFILES,
  RISK_PROFILES,
  SKINS,
  VERSION,
  WAYPOINT_IDS,
  WIN_MODES
} from "./constants.js";
import { getBrainStatus, tickBrain } from "./brain.js";
import { onHunterDamaged, onHunterHitRunner } from "./combat.js";
import {
  addMobDrop,
  getGatheringStatus,
  getProgressSnapshot,
  initializeProgress
} from "./gathering.js";
import {
  addItem,
  clearHunterLoadout,
  equipmentSummary,
  getSelectedItem,
  inventorySummary
} from "./inventory.js";
import {
  clearAllBrains,
  clearBrain,
  getAllBrains,
  getBrain,
  pruneBrains
} from "./memory.js";
import {
  cleanupPlacedBlocks,
  clearWaypoint,
  forceReplan,
  getNavigationStatus
} from "./navigation.js";
import {
  notifyDragonRaceStart,
  notifyHuntEnd,
  notifyHitRunner,
  notifyKilledByRunner,
  notifyTookDamage,
  huntGreet,
  tickAmbientChat
} from "./persona.js";
import {
  getSquadStatus,
  registerHunterRole,
  resetSquadMemory,
  roleForIndex,
  tickResourceSharing
} from "./squad.js";
import {
  addHunterId,
  beginNewHunt,
  checkpointElapsed,
  clearPendingSnapshot,
  clearRuntimeState,
  getConfig,
  getElapsedTicks,
  getHunters,
  getPendingSnapshot,
  getRunner,
  getRuntime,
  incrementHunterDeaths,
  initializeState,
  isHuntActive,
  isStateReady,
  queueRespawn,
  removeHunterId,
  removeRespawnIndex,
  setHunterIds,
  setPhase,
  setPendingSnapshot,
  updateRuntime
} from "./state.js";
import {
  distance,
  dimensionShortName,
  formatLocation,
  hasStandingSpace,
  isEntityValid,
  safeDynamicGet,
  safeDynamicSet,
  safeIndex,
  safeTrigger
} from "./utils.js";

let lastDedupTick = -99999;
let lastReconcileTick = -99999;

function getKnownDimensions(reference) {
  const dimensions = [];
  if (reference?.dimension) dimensions.push(reference.dimension);
  for (const id of ["overworld", "nether", "the_end"]) {
    try {
      const dimension = world.getDimension(id);
      if (!dimensions.some((entry) => entry.id === dimension.id)) dimensions.push(dimension);
    } catch {
      // Ignore unavailable dimensions.
    }
  }
  return dimensions;
}

function squadIndex(entity) {
  const value = Number(safeDynamicGet(entity, "manhunt:squad_index", 0));
  return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 0;
}

function roleOf(entity) {
  const value = safeDynamicGet(entity, "manhunt:role", "Chaser");
  return HUNTER_ROLES.includes(value) ? value : "Chaser";
}

function movementSpeedOf(entity) {
  try {
    const movement = entity.getComponent("minecraft:movement");
    const value = Number(movement?.currentValue ?? movement?.effectiveMax ?? movement?.defaultValue ?? 0.39);
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0.39;
  } catch {
    return 0.39;
  }
}

function meleeCooldownOf(status) {
  if (status?.goal === "defend") return 0.63;
  if (status?.navigation?.activePlan !== "none" || status?.navigation?.mode === "route") return 0.60;
  return 0.58;
}

function sortHunters(hunters) {
  return [...hunters].sort((a, b) => squadIndex(a) - squadIndex(b));
}

function findSafeNear(player, index = 0, minimumRadius = 9, maximumRadius = 20) {
  const base = player.location;
  const phase = (index / 4) * Math.PI * 2;
  for (let ring = minimumRadius + index * 2; ring <= maximumRadius + index * 2; ring++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = phase + (attempt / 24) * Math.PI * 2 + ring * 0.19;
      const x = Math.floor(base.x + Math.cos(angle) * ring);
      const z = Math.floor(base.z + Math.sin(angle) * ring);
      for (let y = Math.floor(base.y) + 7; y >= Math.floor(base.y) - 10; y--) {
        const location = { x, y, z };
        if (hasStandingSpace(player.dimension, location, false)) return { x: x + 0.5, y, z: z + 0.5 };
      }
    }
  }
  return { x: base.x + 10 + index * 2, y: base.y + 1, z: base.z + 10 };
}

function loadedHunters(reference) {
  const result = [];
  for (const dimension of getKnownDimensions(reference)) {
    try {
      for (const entity of dimension.getEntities({ type: HUNTER_ID })) if (isEntityValid(entity)) result.push(entity);
    } catch {
      // Continue through dimensions.
    }
  }
  return result;
}

function removeAllAddonEntities(reference) {
  for (const dimension of getKnownDimensions(reference)) {
    for (const type of [HUNTER_ID, ...WAYPOINT_IDS]) {
      let entities = [];
      try { entities = dimension.getEntities({ type }); } catch { continue; }
      for (const entity of entities) try { entity.remove(); } catch { /* already invalid */ }
    }
  }
  setHunterIds([]);
  clearAllBrains();
  resetSquadMemory(getRuntime().huntSerial);
}

function removeAllWaypoints(reference) {
  let removed = 0;
  for (const dimension of getKnownDimensions(reference)) {
    for (const type of WAYPOINT_IDS) {
      let entities = [];
      try { entities = dimension.getEntities({ type }); } catch { continue; }
      for (const entity of entities) {
        try { entity.remove(); removed++; } catch { /* already invalid */ }
      }
    }
  }
  return removed;
}

function removeLoadedDuplicates(reference, desiredCount) {
  const currentSerial = getRuntime().huntSerial;
  const candidates = loadedHunters(reference).sort((a, b) => {
    const aSerial = Number(safeDynamicGet(a, "manhunt:hunt_serial", -1));
    const bSerial = Number(safeDynamicGet(b, "manhunt:hunt_serial", -1));
    const aCurrent = aSerial === currentSerial ? 1 : 0;
    const bCurrent = bSerial === currentSerial ? 1 : 0;
    return bCurrent - aCurrent;
  });
  const keepByIndex = new Map();
  for (const hunter of candidates) {
    const index = squadIndex(hunter);
    if (index >= desiredCount || keepByIndex.has(index)) {
      const duplicateBrain = getBrain(hunter);
      clearWaypoint(duplicateBrain);
      clearBrain(hunter.id);
      try { hunter.remove(); } catch { /* ignore */ }
      continue;
    }
    keepByIndex.set(index, hunter);
  }
  const ids = [...keepByIndex.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1].id);
  setHunterIds(ids);
  pruneBrains(ids);
  return [...keepByIndex.values()];
}

function hunterDisplayName(config, index, role) {
  const base = (config.hunterName || "Hunter").slice(0, 18);
  if (config.hunterCount <= 1) return base;
  return `${base} ${index + 1} [${role.slice(0, 3)}]`.slice(0, 24);
}

function configureHunter(hunter, runner, config, index, snapshot = undefined, preserveExisting = false) {
  const role = roleForIndex(index, config);
  try { hunter.nameTag = hunterDisplayName(config, index, role); } catch { /* cosmetic */ }
  try {
    hunter.addTag("manhunt_active");
    hunter.addTag(`manhunt_hunter_${index}`);
  } catch {
    // Tags are a recovery aid.
  }
  safeDynamicSet(hunter, "manhunt:runner_id", runner.id);
  safeDynamicSet(hunter, "manhunt:squad_index", index);
  safeDynamicSet(hunter, "manhunt:role", role);
  safeDynamicSet(hunter, "manhunt:route_jumps", snapshot?.routeJumps ?? 0);
  safeDynamicSet(hunter, "manhunt:route_blocks_placed", snapshot?.routeBlocksPlaced ?? 0);
  safeDynamicSet(hunter, "manhunt:route_blocks_broken", snapshot?.routeBlocksBroken ?? 0);
  safeDynamicSet(hunter, "manhunt:mlg_saves", snapshot?.mlgSaves ?? 0);
  safeDynamicSet(hunter, "manhunt:block_clutches", snapshot?.blockClutches ?? 0);
  safeDynamicSet(hunter, "manhunt:boats_destroyed", snapshot?.boatsDestroyed ?? 0);
  safeDynamicSet(hunter, "manhunt:boats_used", snapshot?.boatsUsed ?? 0);
  safeDynamicSet(hunter, "manhunt:distance_travelled", 0);
  safeDynamicSet(hunter, "manhunt:last_location", hunter.location);
  safeDynamicSet(hunter, "manhunt:last_config_version", VERSION);
  safeDynamicSet(hunter, "manhunt:hunt_serial", getRuntime().huntSerial);
  try {
    const skin = safeIndex(config.skin + index, SKINS, config.skin);
    hunter.setProperty("manhunt:skin_id", skin);
  } catch {
    // The base skin remains active.
  }
  if (!preserveExisting || snapshot) initializeProgress(hunter, config, snapshot);
  registerHunterRole(hunter, index, config);
  const brain = getBrain(hunter);
  if (brain) {
    brain.squadIndex = index;
    brain.role = role;
    brain.lastSeenLocation = { ...runner.location };
    brain.lastSeenDimension = runner.dimension.id;
    brain.lastSeenTick = system.currentTick;
    try {
      brain.progressSnapshot = getProgressSnapshot(hunter);
      brain.lastProgressSnapshotTick = system.currentTick;
    } catch {
      brain.progressSnapshot = snapshot;
    }
  }
  const restoredProgression = snapshot && snapshot.statsOnly !== true && config.equipmentPersistence;
  if (config.gathering && config.prepMode !== 1 && !restoredProgression) {
    // Do not let the generic entity move_to_block goal choose a random first
    // log before the script brain has selected and reserved an exact target.
    safeTrigger(hunter, "manhunt:idle");
  } else safeTrigger(hunter, "manhunt:chase");
  addHunterId(hunter.id);
  clearPendingSnapshot(index);
  removeRespawnIndex(index);
  return hunter;
}

function spawnHunter(runner, index, snapshot = undefined, announce = true) {
  if (!isHuntActive()) return undefined;
  const config = getConfig();
  let hunter;
  try { hunter = runner.dimension.spawnEntity(HUNTER_ID, findSafeNear(runner, index)); }
  catch (error) {
    try { runner.sendMessage(`§cHunter ${index + 1} spawn failed: ${error}`); } catch { /* runner left */ }
    queueRespawn({ index, role: roleForIndex(index, config), dueTick: system.currentTick + 60, snapshot });
    return undefined;
  }
  configureHunter(hunter, runner, config, index, snapshot);
  if (announce) world.sendMessage(`§c${hunter.nameTag || `Hunter ${index + 1}`} joined the hunt as ${roleForIndex(index, config)}.`);
  return hunter;
}

function spawnSquad(runner, announce = true) {
  const config = getConfig();
  const existing = new Map(sortHunters(getHunters()).map((hunter) => [squadIndex(hunter), hunter]));
  const spawned = [];
  for (let index = 0; index < config.hunterCount; index++) {
    const hunter = existing.get(index) ?? spawnHunter(runner, index, getPendingSnapshot(index), announce);
    if (hunter) spawned.push(hunter);
  }
  setHunterIds(sortHunters(spawned).map((hunter) => hunter.id));
  setPhase("running", 0);
  if (announce && spawned.length > 0) {
    try {
      runner.onScreenDisplay.setTitle("§4THE HUNT BEGINS", {
        subtitle: config.winMode === 4
          ? `§dRACE TO THE DRAGON §8- §c${spawned.length} hunter${spawned.length === 1 ? "" : "s"} want the egg too`
          : `§c${spawned.length} adaptive hunter${spawned.length === 1 ? "" : "s"}`,
        fadeInDuration: 5,
        stayDuration: 45,
        fadeOutDuration: 10
      });
    } catch {
      // Cosmetic only.
    }
    if (config.winMode === 4) notifyDragonRaceStart(runner, spawned);
    else huntGreet(runner, spawned, config);
  }
  return spawned;
}

function applyRunnerStartBuffs(player) {
  try {
    player.addEffect("regeneration", 10 * 20, { amplifier: 19, showParticles: false });
    player.addEffect("saturation", 60 * 20, { amplifier: 4, showParticles: false });
    player.sendMessage("§aHead start: Regeneration 20 for 10 seconds and Saturation 5 for 60 seconds.");
  } catch (error) {
    console.warn(`[Manhunt AI Bot] Could not apply runner buffs: ${error}`);
  }
}

export function startHunt(player) {
  if (!isStateReady()) {
    player.sendMessage("§eManhunt AI Bot is still initializing. Reopen the compass in one second.");
    return;
  }
  if (isHuntActive()) {
    player.sendMessage("§cA hunt is already active.");
    return;
  }
  removeAllAddonEntities(player);
  beginNewHunt(player.id, 200);
  resetSquadMemory(getRuntime().huntSerial);
  try { player.addTag("manhunt_runner"); } catch { /* retry in tick */ }
  applyRunnerStartBuffs(player);
  player.sendMessage(`§6Manhunt v${VERSION} begins in 10 seconds. Run!`);
  for (let second = 10; second >= 1; second--) {
    system.runTimeout(() => {
      if (!isStateReady() || !isHuntActive() || getRuntime().phase !== "countdown") return;
      try { player.onScreenDisplay.setActionBar(`§cHunter squad spawns in ${second}...`); } catch { /* left */ }
    }, (10 - second) * 20);
  }
}

export function stopHunt(player) {
  if (!isStateReady() || !isHuntActive()) {
    player?.sendMessage("§7No hunt is active.");
    return;
  }
  endHunt("§eThe hunt was stopped.");
}

function removeRunnerTag(runner) {
  try { runner?.removeTag("manhunt_runner"); } catch { /* ignore */ }
}

export function endHunt(message, outcome = "farewell") {
  if (!isStateReady()) return;
  const config = getConfig();
  const runner = getRunner();
  const hunters = sortHunters(getHunters());
  // Name tags are captured before entities are removed below.
  const hunterNames = hunters.map((hunter) => { try { return hunter.nameTag || "Hunter"; } catch { return "Hunter"; } });
  const elapsed = getElapsedTicks();
  let totalMined = 0;
  let totalCrafted = 0;
  let totalSmelted = 0;
  let totalPlaced = 0;
  const countedIndices = new Set();
  for (const hunter of hunters) {
    try {
      const index = squadIndex(hunter);
      const progress = getGatheringStatus(hunter);
      const brain = getBrain(hunter);
      const navigation = getNavigationStatus(hunter, brain);
      totalMined += progress.blocksMined;
      totalCrafted += progress.recipesCrafted;
      totalSmelted += progress.itemsSmelted;
      totalPlaced += navigation.blocksPlaced;
      countedIndices.add(index);
      if (config.cleanupPlacedBlocks) cleanupPlacedBlocks(brain);
      clearWaypoint(brain);
      hunter.remove();
    } catch {
      // Entity may have died during the end sequence.
    }
  }
  const runtime = getRuntime();
  for (let index = 0; index < config.hunterCount; index++) {
    if (countedIndices.has(index)) continue;
    const snapshot = runtime.pendingSnapshots?.[String(index)];
    if (!snapshot) continue;
    totalMined += Number(snapshot.blocksMined) || 0;
    totalCrafted += Number(snapshot.recipesCrafted) || 0;
    totalSmelted += Number(snapshot.itemsSmelted) || 0;
    totalPlaced += Number(snapshot.routeBlocksPlaced) || 0;
  }
  removeRunnerTag(runner);
  clearAllBrains();
  resetSquadMemory(getRuntime().huntSerial);
  world.sendMessage(message);
  notifyHuntEnd(runner, outcome, hunterNames);
  if (runner) {
    const seconds = Math.floor(elapsed / 20);
    runner.sendMessage(`§6Duration: §f${Math.floor(seconds / 60)}m ${seconds % 60}s`);
    runner.sendMessage(`§6Squad work: §f${totalMined} blocks mined, ${totalCrafted} recipes, ${totalSmelted} items smelted, ${totalPlaced} route blocks.`);
  }
  clearRuntimeState();
}

function deathWins(config, deaths) {
  if (config.winMode === 0 || config.winMode === 2) return deaths >= config.livesOrKills;
  return false;
}

function respawnDelay(config, index) {
  const base = config.aiLevel === 2 ? 70 : config.aiLevel === 0 ? 120 : 95;
  return base + index * 8;
}

function statisticsOnlySnapshot(snapshot = {}) {
  return {
    statsOnly: true,
    inventory: {},
    pickTier: 0, swordTier: 0, axeTier: 0, shovelTier: 0, armorTier: 0,
    hasCraftingTable: false, hasFurnace: false, hasShield: false, hasBow: false,
    ironHelmet: false, ironChestplate: false, ironLeggings: false, ironBoots: false,
    prepComplete: false, fuelCharges: 0,
    blocksMined: snapshot.blocksMined ?? 0,
    recipesCrafted: snapshot.recipesCrafted ?? 0,
    itemsProduced: snapshot.itemsProduced ?? 0,
    itemsSmelted: snapshot.itemsSmelted ?? 0,
    routeJumps: snapshot.routeJumps ?? 0,
    routeBlocksPlaced: snapshot.routeBlocksPlaced ?? 0,
    routeBlocksBroken: snapshot.routeBlocksBroken ?? 0,
    mlgSaves: snapshot.mlgSaves ?? 0,
    blockClutches: snapshot.blockClutches ?? 0,
    boatsDestroyed: snapshot.boatsDestroyed ?? 0,
    boatsUsed: snapshot.boatsUsed ?? 0
  };
}

export function handleEntityDeath(event) {
  if (!isStateReady() || !isHuntActive()) return;
  const dead = event.deadEntity;
  const runner = getRunner();
  const damaging = event.damageSource?.damagingEntity;
  if (damaging?.typeId === HUNTER_ID && dead?.typeId !== HUNTER_ID) addMobDrop(damaging, dead);

  // Race to the Dragon: the first side to slay the Ender Dragon decides the
  // hunt immediately, regardless of lives or timers. endHunt itself delivers
  // the closing personality line.
  if (dead?.typeId === "minecraft:ender_dragon") {
    const config = getConfig();
    if (config.winMode === 4) {
      const hunterKill = damaging?.typeId === HUNTER_ID;
      if (hunterKill) endHunt("§4HUNTERS WIN THE RACE - the squad slayed the Ender Dragon first!", "hunters_win_dragon");
      else endHunt("§aRUNNER WINS THE RACE - you slayed the Ender Dragon before the squad!", "runner_wins_dragon");
      return;
    }
  }

  if (runner && dead?.id === runner.id) {
    endHunt("§cHunter squad wins - the runner was eliminated!", "hunters_win_kill");
    return;
  }
  if (dead?.typeId !== HUNTER_ID) return;

  const config = getConfig();
  const index = squadIndex(dead);
  const role = roleOf(dead);
  const deadBrain = getBrain(dead);
  notifyKilledByRunner(runner, dead, deadBrain);
  let snapshot;
  try { snapshot = getProgressSnapshot(dead); }
  catch { snapshot = deadBrain?.progressSnapshot; }
  if (!snapshot) snapshot = deadBrain?.progressSnapshot;
  if (snapshot && !config.equipmentPersistence) snapshot = statisticsOnlySnapshot(snapshot);
  // Waypoints are persistent entities. If the owner dies before its brain is
  // cleared, remove the marker or the respawned hunter may follow a stale route.
  clearWaypoint(deadBrain);
  clearBrain(dead.id);
  removeHunterId(dead.id);
  incrementHunterDeaths(index);
  if (snapshot) setPendingSnapshot(index, snapshot);
  const runtime = getRuntime();
  if (deathWins(config, runtime.hunterDeaths)) {
    endHunt(config.winMode === 2 ? "§aRunner wins - kill target reached!" : "§aRunner wins - all configured hunter lives were exhausted!", "runner_survives");
    return;
  }
  queueRespawn({ index, role, dueTick: system.currentTick + respawnDelay(config, index), snapshot });
  if (config.winMode === 3) world.sendMessage(`§e${dead.nameTag || `Hunter ${index + 1}`} was defeated. §bInfinite mode: unlimited respawns.`);
  else world.sendMessage(`§e${dead.nameTag || `Hunter ${index + 1}`} was defeated and will respawn.`);
}

export function handleEntityHurt(event) {
  if (!isStateReady() || !isHuntActive()) return;
  const hurt = event.hurtEntity;
  const damaging = event.damageSource?.damagingEntity;
  const config = getConfig();
  if (hurt?.typeId === HUNTER_ID) {
    const brain = getBrain(hurt);
    const cause = String(event.damageSource?.cause ?? "unknown");
    const damagerType = damaging?.typeId ?? "environment";
    onHunterDamaged(hurt, brain, config, cause, damagerType);
    notifyTookDamage(getRunner(), hurt, brain);
    safeDynamicSet(hurt, "manhunt:damage_taken", (Number(safeDynamicGet(hurt, "manhunt:damage_taken", 0)) || 0) + (event.damage ?? 0));
  }
  const runner = getRunner();
  if (runner && hurt?.id === runner.id && damaging?.typeId === HUNTER_ID) {
    onHunterHitRunner(getBrain(damaging));
    notifyHitRunner(runner, damaging, getBrain(damaging));
    safeDynamicSet(damaging, "manhunt:damage_dealt", (Number(safeDynamicGet(damaging, "manhunt:damage_dealt", 0)) || 0) + (event.damage ?? 0));
  }
}

function reconcileRunnerTag(runner) {
  try { if (!runner.hasTag("manhunt_runner")) runner.addTag("manhunt_runner"); } catch { /* later */ }
}

function orphanByIndex(runner) {
  const map = new Map();
  for (const hunter of loadedHunters(runner)) {
    const index = squadIndex(hunter);
    if (!map.has(index)) map.set(index, hunter);
  }
  return map;
}

export function reconcileHunt() {
  if (!isStateReady() || !isHuntActive()) return;
  const runner = getRunner();
  if (!runner) return;
  reconcileRunnerTag(runner);
  const config = getConfig();
  if (getRuntime().phase !== "running") return;
  const loaded = orphanByIndex(runner);
  const current = sortHunters(getHunters());
  const ids = [];
  for (let index = 0; index < config.hunterCount; index++) {
    const existing = current.find((entry) => squadIndex(entry) === index);
    if (existing) {
      registerHunterRole(existing, index, config);
      ids.push(existing.id);
      continue;
    }
    const orphan = loaded.get(index);
    if (orphan) {
      configureHunter(orphan, runner, config, index, getPendingSnapshot(index), true);
      ids.push(orphan.id);
      continue;
    }
    const alreadyQueued = getRuntime().respawnQueue.some((entry) => entry.index === index);
    if (!alreadyQueued) queueRespawn({ index, role: roleForIndex(index, config), dueTick: system.currentTick + 50, snapshot: getPendingSnapshot(index) });
  }
  setHunterIds(ids);
}

function processRespawns(runner) {
  const runtime = getRuntime();
  for (const entry of runtime.respawnQueue) {
    if (entry.dueTick > system.currentTick) continue;
    if (getHunters().some((hunter) => squadIndex(hunter) === entry.index)) {
      removeRespawnIndex(entry.index);
      continue;
    }
    spawnHunter(runner, entry.index, entry.snapshot ?? getPendingSnapshot(entry.index), true);
  }
}

function maybeTaunt(runner, hunter, brain, config, perception) {
  // v2.0: the looping taunt soundboard became a contextual personality system.
  tickAmbientChat(runner, hunter, brain, config, perception);
}

function updateTravelStats(hunter) {
  const previous = safeDynamicGet(hunter, "manhunt:last_location", undefined);
  if (previous && typeof previous === "object") {
    const travelled = distance(previous, hunter.location);
    if (travelled < 20) safeDynamicSet(hunter, "manhunt:distance_travelled", (Number(safeDynamicGet(hunter, "manhunt:distance_travelled", 0)) || 0) + travelled);
  }
  safeDynamicSet(hunter, "manhunt:last_location", hunter.location);
}

function winProgress(config, runtime, elapsed) {
  if (config.winMode === 4) return `dragon race • first dragon kill wins`;
  if (config.winMode === 0) return `${Math.max(0, config.livesOrKills - runtime.hunterDeaths)}/${config.livesOrKills} team lives remaining`;
  if (config.winMode === 1) {
    const remaining = Math.max(0, config.timeMinutes * 60 * 20 - elapsed);
    const seconds = Math.ceil(remaining / 20);
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s remaining`;
  }
  if (config.winMode === 2) return `${runtime.hunterDeaths}/${config.livesOrKills} hunter kills`;
  return `∞ lives • ${runtime.hunterDeaths} total hunter deaths`;
}

function nearestHunter(runner, hunters) {
  const same = hunters.filter((hunter) => hunter.dimension.id === runner.dimension.id);
  if (same.length) return same.sort((a, b) => distance(runner.location, a.location) - distance(runner.location, b.location))[0];
  return hunters[0];
}

function updateCompassHud(runner, hunters, config) {
  const selected = getSelectedItem(runner);
  if (selected?.typeId !== COMPASS_ID && !config.debugMode) return;
  const hunter = nearestHunter(runner, hunters);
  if (!hunter) return;
  let text;
  if (runner.dimension.id !== hunter.dimension.id) text = `§5Nearest hunter: ${dimensionShortName(hunter.dimension.id)}`;
  else {
    const dx = hunter.location.x - runner.location.x;
    const dz = hunter.location.z - runner.location.z;
    const targetAngle = Math.atan2(-dx, dz) * 180 / Math.PI;
    const yaw = runner.getRotation().y;
    const relative = ((targetAngle - yaw + 540) % 360) - 180;
    const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
    const index = Math.round(((relative + 360) % 360) / 45) % 8;
    const meters = Math.floor(distance(runner.location, hunter.location));
    const color = meters > 80 ? "§a" : meters > 30 ? "§e" : "§c";
    text = `${color}${arrows[index]} ${hunter.nameTag || "Hunter"}: ${meters}m`;
  }
  if (config.debugMode) {
    const brain = getBrain(hunter);
    text += ` §8| ${brain?.currentGoal ?? "none"}: ${brain?.subAction ?? "none"}`;
  }
  try { runner.onScreenDisplay.setActionBar(text); } catch { /* left */ }
}

function checkTimeLimit(config) {
  if (config.winMode !== 1 && config.winMode !== 4) return false;
  if (getElapsedTicks() >= config.timeMinutes * 60 * 20) {
    endHunt(
      config.winMode === 4
        ? "§eThe dragon race timed out - nobody slayed the Ender Dragon. It's a draw!"
        : "§aRunner wins - the configured time limit expired!",
      config.winMode === 4 ? "farewell" : "runner_survives"
    );
    return true;
  }
  return false;
}

export function tickHunt() {
  if (!isStateReady() || !isHuntActive()) return;
  const runner = getRunner();
  if (!runner) {
    endHunt("§cHunt ended because the runner left the world.");
    return;
  }
  reconcileRunnerTag(runner);
  const runtime = getRuntime();
  if (runtime.phase === "countdown") {
    if (system.currentTick >= runtime.dueTick) spawnSquad(runner, true);
    checkpointElapsed();
    return;
  }
  if (runtime.phase !== "running") setPhase("running", 0);

  processRespawns(runner);
  const config = getConfig();
  let hunters = sortHunters(getHunters());
  if (system.currentTick - lastReconcileTick >= 60) {
    lastReconcileTick = system.currentTick;
    reconcileHunt();
    hunters = sortHunters(getHunters());
  }
  if (system.currentTick - lastDedupTick >= 120) {
    lastDedupTick = system.currentTick;
    hunters = sortHunters(removeLoadedDuplicates(runner, config.hunterCount));
  }

  for (const hunter of hunters) {
    if (!isEntityValid(hunter)) continue;
    try {
      const brain = getBrain(hunter);
      const perception = tickBrain(hunter, runner, config, runtime.deathMap[String(squadIndex(hunter))] ?? 0);
      if (brain && system.currentTick - brain.lastProgressSnapshotTick >= 40) {
        try {
          brain.progressSnapshot = getProgressSnapshot(hunter);
          brain.lastProgressSnapshotTick = system.currentTick;
        } catch {
          // Keep the last valid snapshot for death/reload recovery.
        }
      }
      maybeTaunt(runner, hunter, brain, config, perception);
      if (system.currentTick % 20 === squadIndex(hunter) * 3) updateTravelStats(hunter);
    } catch (error) {
      // One invalid or temporarily broken hunter must not cancel the remaining
      // squad members' AI for this server tick. Throttle repeated diagnostics
      // so one bad entity cannot flood the Content Log every server tick.
      let shouldLog = true;
      try {
        const brain = getBrain(hunter);
        if (brain) {
          shouldLog = system.currentTick - (brain.lastErrorTick ?? -9999) >= 40 || !String(brain.lastError ?? "").startsWith("isolated hunter tick:");
          brain.lastError = `isolated hunter tick: ${error}`;
          brain.lastErrorTick = system.currentTick;
        }
      } catch { /* entity became invalid */ }
      if (shouldLog) console.warn(`[Manhunt AI Bot] Isolated hunter tick error: ${error}`);
    }
  }
  tickResourceSharing(hunters);
  updateCompassHud(runner, hunters, config);
  checkpointElapsed();
  checkTimeLimit(config);
}

export function ensureCompass(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    try { if (inventory.getItem(slot)?.typeId === COMPASS_ID) return; } catch { /* continue */ }
  }
  try { player.addItem(new ItemStack(COMPASS_ID, 1)); } catch { /* unavailable */ }
}

export function resetHunterForTesting(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  const config = getConfig();
  const runner = getRunner();
  const brain = getBrain(hunter);
  clearWaypoint(brain);
  clearBrain(hunter.id);
  clearHunterLoadout(hunter);
  initializeProgress(hunter, config, undefined);
  try { hunter.teleport(findSafeNear(runner ?? player, index), { dimension: (runner ?? player).dimension, checkForBlocks: true, facingLocation: (runner ?? player).location }); } catch { /* ignore */ }
  configureHunter(hunter, runner ?? player, config, index, undefined, true);
  player?.sendMessage(`§aReset ${hunter.nameTag || `Hunter ${index + 1}`}.`);
  return true;
}

export function forceHunterReplan(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  forceReplan(hunter, getBrain(hunter), "developer force-replan button");
  player?.sendMessage(`§aForced ${hunter.nameTag || "hunter"} to abandon its route and replan.`);
  return true;
}

export function teleportHunterForTesting(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  const destination = findSafeNear(player, index, 5, 9);
  try {
    hunter.teleport(destination, { dimension: player.dimension, checkForBlocks: true, facingLocation: player.location });
    forceReplan(hunter, getBrain(hunter), "developer teleported hunter");
    player.sendMessage(`§aTeleported ${hunter.nameTag || "hunter"} to a safe test position.`);
    return true;
  } catch (error) {
    player.sendMessage(`§cTeleport failed: ${error}`);
    return false;
  }
}

export function giveHunterTestResources(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  for (const [typeId, amount] of [
    ["minecraft:oak_log", 16], ["minecraft:cobblestone", 64], ["minecraft:coal", 16],
    ["minecraft:iron_ingot", 32], ["minecraft:string", 8], ["minecraft:feather", 16],
    ["minecraft:flint", 8], ["minecraft:bread", 16], ["minecraft:water_bucket", 1],
    ["minecraft:obsidian", 14], ["minecraft:diamond", 24], ["minecraft:ancient_debris", 12],
    ["minecraft:netherite_scrap", 16], ["minecraft:netherite_ingot", 8], ["minecraft:gold_ingot", 32]
  ]) addItem(hunter, typeId, amount);
  player?.sendMessage(`§aGave test resources to ${hunter.nameTag || "hunter"}.`);
  return true;
}


export function resetHunterRouteMemory(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  const brain = getBrain(hunter);
  for (const mapName of ["routeMemory", "successfulPaths", "fallMemory", "failedPillars", "waterTraps", "terrainMemory", "placementHistory", "routeBlacklist"]) {
    brain?.[mapName]?.clear?.();
  }
  forceReplan(hunter, brain, "developer reset route memory");
  player?.sendMessage(`§aCleared route memory for ${hunter.nameTag || "hunter"}.`);
  return true;
}

export function toggleHunterPause(player, index = 0) {
  const hunter = sortHunters(getHunters()).find((entry) => squadIndex(entry) === index);
  if (!hunter) { player?.sendMessage("§cHunter not found."); return false; }
  const paused = safeDynamicGet(hunter, "manhunt:ai_paused", false) === true;
  safeDynamicSet(hunter, "manhunt:ai_paused", !paused);
  if (!paused) safeTrigger(hunter, "manhunt:idle");
  else safeTrigger(hunter, "manhunt:chase");
  player?.sendMessage(`${!paused ? "§ePaused" : "§aResumed"} ${hunter.nameTag || "hunter"}.`);
  return !paused;
}

export function exportDebugReport(player) {
  const runtime = getRuntime();
  const config = getConfig();
  const hunters = sortHunters(getHunters());
  const lines = [
    `§6Manhunt AI Bot v${VERSION} debug report`,
    `§7Active=${runtime.active} phase=${runtime.phase} elapsed=${getElapsedTicks()} deaths=${runtime.hunterDeaths}`,
    `§7Mode=${WIN_MODES[config.winMode]} hunters=${config.hunterCount} profile=${PERFORMANCE_PROFILES[config.performanceProfile]} risk=${RISK_PROFILES[config.riskProfile]}`
  ];
  for (const hunter of hunters) {
    const status = getBrainStatus(hunter);
    lines.push(`§b#${squadIndex(hunter) + 1} ${roleOf(hunter)} §f${status.goal} / ${status.subAction}`);
    lines.push(`§8Reason: ${status.reason}`);
    lines.push(`§8Plan: ${status.activePlan} | Route: ${status.navigation.action} | Stuck: ${status.stuckTicks}`);
    lines.push(`§8Target: ${formatLocation(status.resourceTarget ?? status.navigation.target)} | Vertical blocks: ${status.navigation.verticalBlocksRequired}`);
    lines.push(`§8Movement: ${movementSpeedOf(hunter)} | Melee cooldown: ${meleeCooldownOf(status).toFixed(2)}s`);
    lines.push(`§8Equipment: ${equipmentSummary(hunter)}`);
    lines.push(`§8Inventory: ${inventorySummary(hunter, 14) || "empty"}`);
    lines.push(`§8AI/s: ${status.workloadPerSecond?.operations ?? 0} ops, ${status.workloadPerSecond?.scans ?? 0} scans, ${status.workloadPerSecond?.plans ?? 0} plans`);
    lines.push(`§8Last success: ${status.lastSuccessfulAction} | Last failure: ${status.lastFailedAction} | Error: ${status.lastError}`);
  }
  const squad = getSquadStatus(hunters);
  lines.push(`§7Shared: resources=${squad.sharedResources} bridges=${squad.bridges} portals=${squad.portals} dangers=${squad.dangers}`);
  for (const line of lines) try { player.sendMessage(line.slice(0, 1000)); } catch { /* stop */ }
  return lines.join("\n");
}

export function getStatusText() {
  if (!isStateReady()) return "§eManhunt AI Bot is initializing.";
  if (!isHuntActive()) return "§7No hunt is active.";
  const runtime = getRuntime();
  const config = getConfig();
  const runner = getRunner();
  const hunters = sortHunters(getHunters());
  const elapsed = getElapsedTicks();
  const seconds = Math.floor(elapsed / 20);
  const lines = [
    `§6Version: §f${VERSION}`,
    `§6Runner: §f${runner?.name ?? "Unknown"}`,
    `§6Mode: §f${WIN_MODES[config.winMode]}`,
    `§6Win progress: §f${winProgress(config, runtime, elapsed)}`,
    `§6Squad: §f${hunters.length}/${config.hunterCount} active`,
    `§6Performance: §f${PERFORMANCE_PROFILES[config.performanceProfile]} | Risk: ${RISK_PROFILES[config.riskProfile]}`,
    `§6Time: §f${Math.floor(seconds / 60)}m ${seconds % 60}s`
  ];
  if (!hunters.length) lines.push("§eHunters are spawning, respawning, or being recovered.");
  for (const hunter of hunters) {
    const status = getBrainStatus(hunter);
    const same = runner && runner.dimension.id === hunter.dimension.id;
    lines.push(`\n§c${hunter.nameTag || "Hunter"} §7(${roleOf(hunter)})`);
    lines.push(`§fGoal: ${status.goal} §8(${Math.round(status.goalScore ?? 0)})`);
    lines.push(`§fReason: ${status.reason}`);
    lines.push(`§fAction: ${status.subAction}`);
    lines.push(`§bPattern: §f${status.perception?.runnerPattern ?? "unknown"} | Route: ${status.navigation.action}`);
    lines.push(`§bPlan: §f${status.activePlan} | Vertical: ${status.navigation.verticalMode}`);
    lines.push(`§bTarget: §f${formatLocation(status.resourceTarget ?? status.navigation.target)} | Height gap: ${Math.round(status.perception?.verticalDifference ?? 0)} | Vertical reserve: ${status.navigation.verticalBlocksRequired}`);
    lines.push(`§bMovement: §f${movementSpeedOf(hunter)} | Melee cooldown: ${meleeCooldownOf(status).toFixed(2)}s`);
    lines.push(`§bDifficulty stage: §f${status.difficultyStage ?? 0} | Boat: ${status.activeBoat ? "active" : "none"}`);
    lines.push(`§bStuck: §f${Math.round(status.stuckTicks / 2) / 10}s | failures ${status.routeFailures} | memory ${status.routeMemoryCount}`);
    lines.push(`§8AI/s: ${status.workloadPerSecond?.operations ?? 0} ops, ${status.workloadPerSecond?.scans ?? 0} scans, ${status.workloadPerSecond?.plans ?? 0} plans, ${status.workloadPerSecond?.placements ?? 0} placements`);
    lines.push(`§aTools: §fP${status.gathering.pickTier} S${status.gathering.swordTier} A${status.gathering.axeTier} Sh${status.gathering.shovelTier} Armor${status.gathering.armorTier}`);
    lines.push(`§aResources: §f${status.gathering.food} food, ${status.gathering.buildingBlocks} blocks, ${status.gathering.iron} iron, ${status.gathering.arrows} arrows, ${status.gathering.obsidian} obsidian`);
    lines.push(`§8Equipment: ${equipmentSummary(hunter)}`);
    lines.push(`§8Inventory: ${inventorySummary(hunter, 10) || "empty"}`);
    lines.push(`§8Last success: ${status.lastSuccessfulAction} | failure: ${status.lastFailedAction}`);
    lines.push(`§8Last error: ${status.lastError}`);
    lines.push(`§6Distance: §f${same ? `${Math.floor(distance(runner.location, hunter.location))}m` : dimensionShortName(hunter.dimension.id)} | Last known ${formatLocation(status.lastSeenLocation)}`);
  }
  return lines.join("\n");
}

export function initializeHuntRuntime() {
  if (!isStateReady()) initializeState();
  // In-memory brains do not survive a world/script reload, but persistent path
  // nodes do. Purge those orphan markers before rebuilding route state.
  removeAllWaypoints(getRunner());
  reconcileHunt();
}
