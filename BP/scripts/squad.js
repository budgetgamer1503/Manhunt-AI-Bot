import { system } from "@minecraft/server";
import { BUILDING_ITEMS, FOOD_ITEMS, HUNTER_ROLES } from "./constants.js";
import { addItem, countAny, countItem, removeItem, transferAny } from "./inventory.js";
import { distance, isEntityValid, locationKey, safeDynamicSet } from "./utils.js";

const blackboard = {
  huntSerial: 0,
  runnerLastKnown: undefined,
  runnerDimension: undefined,
  runnerDirection: { x: 0, y: 0, z: 0 },
  runnerLastSeenTick: -999999,
  resources: {
    wood: new Map(), stone: new Map(), blocks: new Map(), coal: new Map(), iron: new Map(),
    gold: new Map(), diamond: new Map(), debris: new Map(), flint: new Map(), portal: new Map(), food: new Map()
  },
  bridges: new Map(),
  portals: new Map(),
  dangerZones: new Map(),
  reservations: new Map(),
  messages: [],
  workload: { tick: 0, operations: 0, scans: 0, plans: 0, placements: 0 }
};

export function resetSquadMemory(huntSerial = 0) {
  blackboard.huntSerial = huntSerial;
  blackboard.runnerLastKnown = undefined;
  blackboard.runnerDimension = undefined;
  blackboard.runnerDirection = { x: 0, y: 0, z: 0 };
  blackboard.runnerLastSeenTick = -999999;
  for (const memory of Object.values(blackboard.resources)) memory.clear();
  blackboard.bridges.clear();
  blackboard.portals.clear();
  blackboard.dangerZones.clear();
  blackboard.reservations.clear();
  blackboard.messages.length = 0;
  blackboard.workload = { tick: system.currentTick, operations: 0, scans: 0, plans: 0, placements: 0 };
}

export function roleForIndex(index, config) {
  const count = Math.max(1, Math.min(4, Number(config?.hunterCount) || 1));
  if (count === 1 || config?.squadPreset === 0) return HUNTER_ROLES[0];
  const balanced = ["Chaser", "Gatherer", "Builder", "Archer"];
  const pressure = ["Chaser", "Chaser", "Builder", "Archer"];
  return (config?.squadPreset === 2 ? pressure : balanced)[Math.max(0, Math.min(count - 1, index))] ?? "Chaser";
}

export function registerHunterRole(hunter, index, config) {
  const role = roleForIndex(index, config);
  safeDynamicSet(hunter, "manhunt:squad_index", index);
  safeDynamicSet(hunter, "manhunt:role", role);
  try {
    for (const existingRole of HUNTER_ROLES) hunter.removeTag(`manhunt_role_${existingRole.toLowerCase()}`);
    for (let existingIndex = 0; existingIndex < 4; existingIndex++) hunter.removeTag(`manhunt_squad_${existingIndex}`);
    hunter.addTag(`manhunt_role_${role.toLowerCase()}`);
    hunter.addTag(`manhunt_squad_${index}`);
  } catch {
    // Tags are cosmetic helpers.
  }
  return role;
}

export function getHunterRole(hunter, fallback = "Chaser") {
  try {
    const role = hunter.getDynamicProperty("manhunt:role");
    return typeof role === "string" && HUNTER_ROLES.includes(role) ? role : fallback;
  } catch {
    return fallback;
  }
}

export function updateRunnerKnowledge(runner, previousLocation = undefined) {
  if (!isEntityValid(runner)) return;
  const location = { ...runner.location };
  blackboard.runnerDirection = previousLocation ? {
    x: location.x - previousLocation.x,
    y: location.y - previousLocation.y,
    z: location.z - previousLocation.z
  } : blackboard.runnerDirection;
  blackboard.runnerLastKnown = location;
  blackboard.runnerDimension = runner.dimension.id;
  blackboard.runnerLastSeenTick = system.currentTick;
  blackboard.workload.operations++;
}

export function getSquadKnowledge() {
  return blackboard;
}

export function shareResource(category, dimensionId, location, typeId, score = 0) {
  const memory = blackboard.resources[category];
  if (!memory || !location) return;
  const key = locationKey(location, dimensionId);
  memory.set(key, { dimensionId, location: { ...location }, typeId, score, tick: system.currentTick });
  while (memory.size > 160) memory.delete(memory.keys().next().value);
}

export function forgetResource(category, dimensionId, location) {
  blackboard.resources[category]?.delete(locationKey(location, dimensionId));
}

export function getSharedResources(category, dimensionId) {
  const memory = blackboard.resources[category];
  if (!memory) return [];
  const now = system.currentTick;
  const result = [];
  for (const [key, entry] of memory) {
    if (now - entry.tick > 20 * 180) {
      memory.delete(key);
      continue;
    }
    if (entry.dimensionId === dimensionId) result.push(entry);
  }
  return result;
}

export function rememberBridge(dimensionId, blocks, successful = false) {
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  const key = `${dimensionId}|${blocks.map((block) => `${block.x},${block.y},${block.z}`).join(";")}`;
  blackboard.bridges.set(key, {
    dimensionId,
    blocks: blocks.map((block) => ({ ...block })),
    successful,
    successes: successful ? 1 : 0,
    failures: 0,
    tick: system.currentTick
  });
  while (blackboard.bridges.size > 80) blackboard.bridges.delete(blackboard.bridges.keys().next().value);
}

export function updateBridgeResult(dimensionId, blocks, success) {
  const matching = [...blackboard.bridges.values()].find((entry) => entry.dimensionId === dimensionId && entry.blocks.length === blocks.length && entry.blocks.every((block, index) => locationKey(block) === locationKey(blocks[index])));
  if (!matching) {
    rememberBridge(dimensionId, blocks, success);
    return;
  }
  if (success) matching.successes++;
  else matching.failures++;
  matching.successful = matching.successes > matching.failures;
  matching.tick = system.currentTick;
}

export function rememberPortal(dimensionId, location, destinationDimension = undefined, destination = undefined) {
  if (!location) return;
  const key = locationKey(location, dimensionId);
  blackboard.portals.set(key, {
    dimensionId,
    location: { ...location },
    destinationDimension,
    destination: destination ? { ...destination } : undefined,
    uses: (blackboard.portals.get(key)?.uses ?? 0) + 1,
    tick: system.currentTick
  });
  while (blackboard.portals.size > 32) blackboard.portals.delete(blackboard.portals.keys().next().value);
}

export function nearestRememberedPortal(dimensionId, location) {
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const portal of blackboard.portals.values()) {
    if (portal.dimensionId !== dimensionId) continue;
    const current = distance(location, portal.location);
    if (current < bestDistance) {
      bestDistance = current;
      best = portal;
    }
  }
  return best;
}

export function rememberDanger(dimensionId, location, reason, weight = 1) {
  if (!location) return;
  const key = locationKey(location, dimensionId);
  const previous = blackboard.dangerZones.get(key);
  blackboard.dangerZones.set(key, {
    dimensionId,
    location: { ...location },
    reason,
    weight: Math.min(100, (previous?.weight ?? 0) + weight),
    tick: system.currentTick
  });
  while (blackboard.dangerZones.size > 128) blackboard.dangerZones.delete(blackboard.dangerZones.keys().next().value);
}

export function dangerPenalty(dimensionId, location) {
  const entry = blackboard.dangerZones.get(locationKey(location, dimensionId));
  if (!entry) return 0;
  const age = system.currentTick - entry.tick;
  if (age > 20 * 180) {
    blackboard.dangerZones.delete(locationKey(location, dimensionId));
    return 0;
  }
  return Math.max(0, entry.weight - age / 100);
}

export function reserveTarget(key, hunterId, duration = 160) {
  if (!key || !hunterId) return false;
  const existing = blackboard.reservations.get(key);
  if (existing && existing.hunterId !== hunterId && existing.expiry > system.currentTick) return false;
  blackboard.reservations.set(key, { hunterId, expiry: system.currentTick + duration });
  return true;
}

export function releaseReservations(hunterId) {
  for (const [key, value] of blackboard.reservations) {
    if (value.hunterId === hunterId || value.expiry <= system.currentTick) blackboard.reservations.delete(key);
  }
}


export function releaseTarget(key, hunterId = undefined) {
  if (!key) return false;
  const existing = blackboard.reservations.get(key);
  if (!existing) return false;
  if (hunterId && existing.hunterId !== hunterId && existing.expiry > system.currentTick) return false;
  blackboard.reservations.delete(key);
  return true;
}

function transfer(source, target, typeIds, amount) {
  return transferAny(source, target, typeIds, amount);

}


export function findShareTarget(source, hunters = []) {
  if (!isEntityValid(source) || !Array.isArray(hunters)) return undefined;
  const sourceRole = getHunterRole(source);
  if (sourceRole !== "Gatherer" && sourceRole !== "Builder") return undefined;
  const candidates = [];
  for (const target of hunters) {
    if (!isEntityValid(target) || target.id === source.id || target.dimension.id !== source.dimension.id) continue;
    const targetRole = getHunterRole(target);
    if (targetRole !== "Chaser" && targetRole !== "Archer") continue;
    let need = 0;
    if (countAny(source, BUILDING_ITEMS) > 24 && countAny(target, BUILDING_ITEMS) < 12) need += 3;
    if (countAny(source, FOOD_ITEMS) > 8 && countAny(target, FOOD_ITEMS) < 3) need += 2;
    if (targetRole === "Archer" && countItem(source, "minecraft:arrow") > 24 && countItem(target, "minecraft:arrow") < 12) need += 2;
    if (need > 0) candidates.push({ target, need, distance: distance(source.location, target.location) });
  }
  candidates.sort((a, b) => b.need - a.need || a.distance - b.distance);
  return candidates[0]?.target;
}

export function tickResourceSharing(hunters) {
  if (system.currentTick % 40 !== 0 || !Array.isArray(hunters) || hunters.length < 2) return;
  const valid = hunters.filter(isEntityValid);
  for (const source of valid) {
    const sourceRole = getHunterRole(source);
    if (sourceRole !== "Gatherer" && sourceRole !== "Builder") continue;
    for (const target of valid) {
      if (source.id === target.id || source.dimension.id !== target.dimension.id || distance(source.location, target.location) > 3.2) continue;
      const targetRole = getHunterRole(target);
      if (targetRole === "Chaser" || targetRole === "Archer") {
        if (countAny(source, BUILDING_ITEMS) > 24 && countAny(target, BUILDING_ITEMS) < 12) transfer(source, target, BUILDING_ITEMS, 8);
        if (countAny(source, FOOD_ITEMS) > 8 && countAny(target, FOOD_ITEMS) < 3) transfer(source, target, FOOD_ITEMS, 2);
        if (countItem(source, "minecraft:arrow") > 24 && targetRole === "Archer") {
          const amount = Math.min(12, countItem(source, "minecraft:arrow") - 12);
          if (amount > 0) transfer(source, target, new Set(["minecraft:arrow"]), amount);
        }
      }
    }
  }
}

export function recordWork(kind, amount = 1) {
  if (blackboard.workload.tick !== system.currentTick) blackboard.workload.tick = system.currentTick;
  blackboard.workload.operations += amount;
  if (kind === "scan") blackboard.workload.scans += amount;
  if (kind === "plan") blackboard.workload.plans += amount;
  if (kind === "placement") blackboard.workload.placements += amount;
}

export function getSquadStatus(hunters = []) {
  for (const [key, value] of blackboard.reservations) {
    if (value.expiry <= system.currentTick) blackboard.reservations.delete(key);
  }
  return {
    count: hunters.filter(isEntityValid).length,
    roles: hunters.filter(isEntityValid).map((hunter) => `${hunter.nameTag || "Hunter"}: ${getHunterRole(hunter)}`),
    runnerLastKnown: blackboard.runnerLastKnown ? { ...blackboard.runnerLastKnown } : undefined,
    runnerDimension: blackboard.runnerDimension,
    portals: blackboard.portals.size,
    bridges: blackboard.bridges.size,
    sharedResources: Object.values(blackboard.resources).reduce((total, memory) => total + memory.size, 0),
    dangers: blackboard.dangerZones.size,
    reservations: blackboard.reservations.size,
    workload: { ...blackboard.workload }
  };
}
