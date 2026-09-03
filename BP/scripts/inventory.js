import { EquipmentSlot, ItemStack, system } from "@minecraft/server";
import { BUILDING_ITEMS, FOOD_HEAL, FOOD_ITEMS } from "./constants.js";
import { isEntityValid, safeDynamicGet, safeDynamicSet } from "./utils.js";

// Per-tick inventory count cache. Keyed by entity ID; each entry stores the
// tick it was built so stale data is never used across brain intervals.
// LRU eviction: when the map exceeds MAX_CACHE_SIZE the oldest entry is
// removed instead of clearing the entire cache (which would force every
// hunter to rebuild counts on the same tick and spike CPU).
const countCache = new Map();
const MAX_CACHE_SIZE = 32;

// Hoisted to module scope so setEquipment never allocates a new Map per call.
const SLOT_COMMAND_NAMES = new Map([
  [EquipmentSlot.Mainhand, "slot.weapon.mainhand"],
  [EquipmentSlot.Offhand,  "slot.weapon.offhand"],
  [EquipmentSlot.Head,     "slot.armor.head"],
  [EquipmentSlot.Chest,    "slot.armor.chest"],
  [EquipmentSlot.Legs,     "slot.armor.legs"],
  [EquipmentSlot.Feet,     "slot.armor.feet"]
]);

const EQUIPMENT_TRACK_KEYS = new Map([
  [EquipmentSlot.Mainhand, "manhunt:equipped_mainhand"],
  [EquipmentSlot.Offhand,  "manhunt:equipped_offhand"],
  [EquipmentSlot.Head,     "manhunt:equipped_head"],
  [EquipmentSlot.Chest,    "manhunt:equipped_chest"],
  [EquipmentSlot.Legs,     "manhunt:equipped_legs"],
  [EquipmentSlot.Feet,     "manhunt:equipped_feet"]
]);

// Slot order used by equipmentSnapshot / clearEquipment – defined once.
const ALL_EQUIPMENT_SLOTS = Object.freeze([
  EquipmentSlot.Mainhand,
  EquipmentSlot.Offhand,
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet
]);

const EQUIPMENT_SLOT_NAMES = Object.freeze([
  ["mainhand", EquipmentSlot.Mainhand],
  ["offhand",  EquipmentSlot.Offhand],
  ["head",     EquipmentSlot.Head],
  ["chest",    EquipmentSlot.Chest],
  ["legs",     EquipmentSlot.Legs],
  ["feet",     EquipmentSlot.Feet]
]);

function trackedEquipment(entity, slot) {
  const key = EQUIPMENT_TRACK_KEYS.get(slot);
  if (!key) return undefined;
  const value = safeDynamicGet(entity, key, "");
  return typeof value === "string" && value ? value : undefined;
}

function entityKey(entity) {
  try {
    return entity.id;
  } catch {
    return undefined;
  }
}

export function invalidateInventory(entity) {
  const key = entityKey(entity);
  if (key) countCache.delete(key);
}

export function getContainer(entity) {
  if (!isEntityValid(entity)) return undefined;
  try {
    return entity.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

function captureInventorySlots(entity) {
  const container = getContainer(entity);
  if (!container) return undefined;
  // Store raw ItemStack references for the snapshot. We only clone on restore,
  // which avoids allocating a clone object for every slot on every transaction.
  const slots = [];
  for (let slot = 0; slot < container.size; slot++) {
    try {
      slots.push(container.getItem(slot) ?? undefined);
    } catch {
      slots.push(undefined);
    }
  }
  return slots;
}

function restoreInventorySlots(entity, slots) {
  const container = getContainer(entity);
  if (!container || !Array.isArray(slots) || slots.length !== container.size) return false;
  let success = true;
  for (let slot = 0; slot < container.size; slot++) {
    try {
      const item = slots[slot];
      container.setItem(slot, item?.clone?.() ?? item);
    } catch {
      success = false;
    }
  }
  invalidateInventory(entity);
  return success;
}

export function runInventoryTransaction(entity, operation) {
  const snapshot = captureInventorySlots(entity);
  if (!snapshot || typeof operation !== "function") return false;
  try {
    if (operation() === true) {
      invalidateInventory(entity);
      return true;
    }
  } catch {
    // Restore the exact slot layout below.
  }
  restoreInventorySlots(entity, snapshot);
  return false;
}

function runInventoryPairTransaction(source, target, operation) {
  if (!isEntityValid(source) || !isEntityValid(target) || typeof operation !== "function") return false;
  if (source.id === target.id) return runInventoryTransaction(source, operation);
  const sourceSnapshot = captureInventorySlots(source);
  const targetSnapshot = captureInventorySlots(target);
  if (!sourceSnapshot || !targetSnapshot) return false;
  try {
    if (operation() === true) {
      invalidateInventory(source);
      invalidateInventory(target);
      return true;
    }
  } catch {
    // Restore both inventories below.
  }
  restoreInventorySlots(source, sourceSnapshot);
  restoreInventorySlots(target, targetSnapshot);
  return false;
}

function buildCounts(entity) {
  const key = entityKey(entity);
  const cached = key ? countCache.get(key) : undefined;
  if (cached && cached.tick === system.currentTick) return cached.counts;

  const counts = new Map();
  const container = getContainer(entity);
  if (container) {
    for (let slot = 0; slot < container.size; slot++) {
      let item;
      try {
        item = container.getItem(slot);
      } catch {
        continue;
      }
      if (!item) continue;
      counts.set(item.typeId, (counts.get(item.typeId) ?? 0) + item.amount);
    }
  }

  if (key) {
    // LRU eviction: remove the oldest entry rather than nuking the whole cache.
    // Clearing all entries forces every hunter to rebuild on the same tick,
    // which creates a CPU spike proportional to squad size.
    if (countCache.size >= MAX_CACHE_SIZE) {
      countCache.delete(countCache.keys().next().value);
    }
    countCache.set(key, { tick: system.currentTick, counts });
  }
  return counts;
}

export function countItem(entity, typeId) {
  return buildCounts(entity).get(typeId) ?? 0;
}

export function countAny(entity, typeIds) {
  const set = typeIds instanceof Set ? typeIds : new Set(typeIds);
  const counts = buildCounts(entity);
  let total = 0;
  for (const typeId of set) total += counts.get(typeId) ?? 0;
  return total;
}

export function hasItem(entity, typeId, amount = 1) {
  return countItem(entity, typeId) >= Math.max(1, Math.trunc(amount));
}

export function listInventory(entity) {
  const result = {};
  for (const [typeId, amount] of buildCounts(entity)) result[typeId] = amount;
  return result;
}

export function addItem(entity, typeId, amount = 1) {
  let remaining = Math.max(0, Math.trunc(Number(amount) || 0));
  if (!typeId || remaining <= 0 || !isEntityValid(entity)) return false;

  while (remaining > 0) {
    try {
      // ItemStack clamps to the real maximum stack size. Subtract the amount
      // actually represented by the stack, not the requested batch size. The
      // old code silently added one boat/bucket/armor item while claiming that
      // an entire multi-item request succeeded.
      const stack = new ItemStack(typeId, Math.min(remaining, 255));
      const offered = Math.max(1, Math.trunc(Number(stack.amount) || 1));
      const leftover = entity.addItem(stack);
      const left = leftover ? Math.max(0, Math.trunc(Number(leftover.amount) || 0)) : 0;
      const inserted = Math.max(0, offered - left);
      remaining -= inserted;
      // Guard: if nothing was inserted and there is no leftover the inventory
      // is full. Break immediately to avoid an infinite loop.
      if (inserted <= 0 || leftover) {
        invalidateInventory(entity);
        return remaining <= 0;
      }
    } catch {
      invalidateInventory(entity);
      return false;
    }
  }
  invalidateInventory(entity);
  return true;
}

export function removeItem(entity, typeId, amount = 1) {
  const needed = Math.max(0, Math.trunc(Number(amount) || 0));
  if (needed <= 0) return true;
  if (countItem(entity, typeId) < needed) return false;
  const container = getContainer(entity);
  if (!container) return false;

  let remaining = needed;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    let item;
    try {
      item = container.getItem(slot);
    } catch {
      continue;
    }
    if (!item || item.typeId !== typeId) continue;
    try {
      if (item.amount <= remaining) {
        remaining -= item.amount;
        container.setItem(slot, undefined);
      } else {
        const replacement = item.clone();
        replacement.amount = item.amount - remaining;
        container.setItem(slot, replacement);
        remaining = 0;
      }
    } catch {
      invalidateInventory(entity);
      return false;
    }
  }
  invalidateInventory(entity);
  return remaining === 0;
}

export function removeAny(entity, typeIds, amount = 1) {
  const set = typeIds instanceof Set ? typeIds : new Set(typeIds);
  const needed = Math.max(0, Math.trunc(Number(amount) || 0));
  if (needed <= 0) return true;
  if (countAny(entity, set) < needed) return false;
  const container = getContainer(entity);
  if (!container) return false;

  let remaining = needed;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    let item;
    try {
      item = container.getItem(slot);
    } catch {
      continue;
    }
    if (!item || !set.has(item.typeId)) continue;
    try {
      if (item.amount <= remaining) {
        remaining -= item.amount;
        container.setItem(slot, undefined);
      } else {
        const replacement = item.clone();
        replacement.amount = item.amount - remaining;
        container.setItem(slot, replacement);
        remaining = 0;
      }
    } catch {
      invalidateInventory(entity);
      return false;
    }
  }
  invalidateInventory(entity);
  return remaining === 0;
}

export function clearInventory(entity) {
  const container = getContainer(entity);
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    try {
      container.setItem(slot, undefined);
    } catch {
      // Continue clearing other slots.
    }
  }
  invalidateInventory(entity);
  return true;
}

function getEquippable(entity) {
  if (!isEntityValid(entity)) return undefined;
  try {
    return entity.getComponent("minecraft:equippable");
  } catch {
    return undefined;
  }
}

function equipmentMatches(equippable, slot, typeId) {
  if (!equippable) return false;
  try {
    const current = equippable.getEquipment(slot);
    return typeId ? current?.typeId === typeId : !current;
  } catch {
    return false;
  }
}

export function setEquipment(entity, slot, typeId = undefined) {
  if (!isEntityValid(entity)) return false;
  const equippable = getEquippable(entity);
  const stack = typeId ? new ItemStack(typeId, 1) : undefined;
  let success = false;

  if (equippable) {
    try {
      equippable.setEquipment(slot, stack);
      success = equipmentMatches(equippable, slot, typeId);
    } catch {
      // Continue to the direct slot and command fallbacks.
    }

    // Some custom humanoid entities expose the slot but do not refresh the
    // client attachable after setEquipment. Writing the ContainerSlot directly
    // forces the equipment replication used by held items and armor.
    if (!success) {
      try {
        const equipmentSlot = equippable.getEquipmentSlot(slot);
        equipmentSlot.setItem(stack);
        success = equipmentMatches(equippable, slot, typeId);
      } catch {
        // Command fallback below covers runtimes without writable slots.
      }
    }
  }

  // SLOT_COMMAND_NAMES is module-scoped; no allocation per call.
  const commandSlot = SLOT_COMMAND_NAMES.get(slot);
  if (commandSlot && !success) {
    try {
      const result = entity.runCommand(`replaceitem entity @s ${commandSlot} 0 ${typeId ?? "air"} 1`);
      if (result?.successCount === undefined || result.successCount > 0) {
        // Command success is authoritative even when the equipment component
        // does not expose the changed slot until the following engine tick.
        success = true;
      }
    } catch {
      // Keep the verified API result if commands are unavailable.
    }
  }

  if (success) {
    const trackKey = EQUIPMENT_TRACK_KEYS.get(slot);
    if (trackKey) safeDynamicSet(entity, trackKey, typeId ?? "");
  }
  return success;
}

export function getEquipment(entity, slot) {
  const equippable = getEquippable(entity);
  if (!equippable) return undefined;
  try {
    return equippable.getEquipment(slot);
  } catch {
    return undefined;
  }
}

export function equipMainhand(entity, typeId) {
  return setEquipment(entity, EquipmentSlot.Mainhand, typeId);
}

export function equipOffhand(entity, typeId) {
  return setEquipment(entity, EquipmentSlot.Offhand, typeId);
}

export function clearEquipment(entity) {
  for (const slot of ALL_EQUIPMENT_SLOTS) setEquipment(entity, slot, undefined);
}

export function clearHunterLoadout(entity) {
  clearInventory(entity);
  clearEquipment(entity);
}

export function getSelectedItem(player) {
  const container = getContainer(player);
  if (!container) return undefined;
  try {
    return container.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

export function getBestFood(entity) {
  // Use the already-built count map so we pay one container scan instead of
  // one per food type. FOOD_ITEMS is ordered best-to-worst, so the first hit
  // is always the highest-value food the hunter owns.
  const counts = buildCounts(entity);
  for (const typeId of FOOD_ITEMS) {
    if ((counts.get(typeId) ?? 0) > 0) return { typeId, heal: FOOD_HEAL[typeId] ?? 2 };
  }
  return undefined;
}

export function getBuildingItem(entity) {
  const counts = buildCounts(entity);
  for (const typeId of BUILDING_ITEMS) {
    if ((counts.get(typeId) ?? 0) > 0) return typeId;
  }
  return undefined;
}

export function consumeBuildingItem(entity) {
  const typeId = getBuildingItem(entity);
  if (!typeId) return undefined;
  return removeItem(entity, typeId, 1) ? typeId : undefined;
}

export function takeInventorySnapshot(entity) {
  return listInventory(entity);
}

export function restoreInventorySnapshot(entity, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  // Clear first so a double-restore (e.g. respawn + config reload) does not
  // duplicate items. The caller is responsible for ensuring the entity is in
  // a clean state before calling this, but clearing here is a safe guard.
  clearInventory(entity);
  for (const [typeId, amount] of Object.entries(snapshot)) addItem(entity, typeId, amount);
}

export function runnerHasShield(player) {
  const offhand = getEquipment(player, EquipmentSlot.Offhand);
  if (offhand?.typeId === "minecraft:shield") return true;
  const selected = getSelectedItem(player);
  return selected?.typeId === "minecraft:shield";
}

export function removeAnyDetailed(entity, typeIds, amount = 1) {
  const set = typeIds instanceof Set ? typeIds : new Set(typeIds);
  const needed = Math.max(0, Math.trunc(Number(amount) || 0));
  if (needed <= 0) return {};
  if (countAny(entity, set) < needed) return undefined;
  const container = getContainer(entity);
  if (!container) return undefined;
  const removed = {};
  let remaining = needed;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    let item;
    try { item = container.getItem(slot); } catch { continue; }
    if (!item || !set.has(item.typeId)) continue;
    const taken = Math.min(item.amount, remaining);
    try {
      if (taken === item.amount) container.setItem(slot, undefined);
      else {
        const replacement = item.clone();
        replacement.amount = item.amount - taken;
        container.setItem(slot, replacement);
      }
    } catch {
      invalidateInventory(entity);
      for (const [typeId, count] of Object.entries(removed)) addItem(entity, typeId, count);
      return undefined;
    }
    removed[item.typeId] = (removed[item.typeId] ?? 0) + taken;
    remaining -= taken;
  }
  invalidateInventory(entity);
  return remaining === 0 ? removed : undefined;
}

export function transferAny(source, target, typeIds, amount = 1) {
  const requested = Math.max(0, Math.trunc(Number(amount) || 0));
  let transferred = 0;
  const success = runInventoryPairTransaction(source, target, () => {
    const removed = removeAnyDetailed(source, typeIds, requested);
    if (!removed) return false;
    for (const [typeId, count] of Object.entries(removed)) {
      if (!addItem(target, typeId, count)) return false;
      transferred += count;
    }
    return transferred === requested;
  });
  return success ? transferred : 0;
}

export function inventorySummary(entity, limit = 12) {
  return Object.entries(listInventory(entity))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([typeId, amount]) => `${typeId.replace("minecraft:", "")} x${amount}`)
    .join(", ");
}


export function equipmentSnapshot(entity) {
  // EQUIPMENT_SLOT_NAMES is module-scoped; no array allocation per call.
  const result = {};
  for (const [name, slot] of EQUIPMENT_SLOT_NAMES) {
    const item = getEquipment(entity, slot);
    result[name] = item?.typeId ?? trackedEquipment(entity, slot);
  }
  return result;
}

export function equipmentSummary(entity) {
  const equipment = equipmentSnapshot(entity);
  return Object.entries(equipment)
    .map(([slot, typeId]) => `${slot}=${typeId ? typeId.replace("minecraft:", "") : "empty"}`)
    .join(", ");
}

const VALID_ARMOR_TIERS = new Set(["iron", "diamond", "netherite"]);

export function equipArmorSet(entity, tier = "iron") {
  const prefix = VALID_ARMOR_TIERS.has(tier) ? tier : "iron";
  // Track whether at least one piece was applied so callers can detect
  // partial failures (e.g. entity has no equippable component).
  let any = false;
  if (setEquipment(entity, EquipmentSlot.Head,  `minecraft:${prefix}_helmet`))      any = true;
  if (setEquipment(entity, EquipmentSlot.Chest, `minecraft:${prefix}_chestplate`))  any = true;
  if (setEquipment(entity, EquipmentSlot.Legs,  `minecraft:${prefix}_leggings`))    any = true;
  if (setEquipment(entity, EquipmentSlot.Feet,  `minecraft:${prefix}_boots`))       any = true;
  return any;
}
