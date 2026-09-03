import { system } from "@minecraft/server";
import { HAZARD_BLOCKS, UNBREAKABLE_BLOCKS } from "./constants.js";

const triggerCache = new Map();

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function finiteInteger(value, minimum, maximum, fallback) {
  return Math.trunc(clamp(finiteNumber(value, fallback), minimum, maximum));
}

export function steppedInteger(value, minimum, maximum, step, fallback) {
  const number = finiteNumber(value, fallback);
  const clamped = clamp(number, minimum, maximum);
  return clamp(Math.round(clamped / step) * step, minimum, maximum);
}

export function safeIndex(value, options, fallback = 0) {
  return finiteInteger(value, 0, Math.max(0, options.length - 1), fallback);
}

export function cleanName(value, fallback = "Hunter") {
  const text = typeof value === "string" ? value.replace(/[\n\r\u00A7]/g, "").trim() : "";
  return (text || fallback).slice(0, 24);
}

export function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a, b) {
  return Math.sqrt(distanceSquared(a, b));
}

export function horizontalDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function horizontalDistance(a, b) {
  return Math.sqrt(horizontalDistanceSquared(a, b));
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function multiply(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

export function normalizeXZ(vector) {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length < 0.0001) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: 0, z: vector.z / length };
}

export function rotateXZ(vector, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine - vector.z * sine,
    y: vector.y,
    z: vector.x * sine + vector.z * cosine
  };
}

export function floorLocation(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
}

export function centerBlock(location) {
  return {
    x: Math.floor(location.x) + 0.5,
    y: Math.floor(location.y),
    z: Math.floor(location.z) + 0.5
  };
}

export function locationKey(location, dimensionId = "") {
  const block = floorLocation(location);
  return `${dimensionId}|${block.x}|${block.y}|${block.z}`;
}

export function parseLocationKey(key) {
  if (typeof key !== "string") return undefined;
  const parts = key.split("|");
  if (parts.length !== 4) return undefined;
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const z = Number(parts[3]);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { dimensionId: parts[0], location: { x, y, z } };
}

export function isEntityValid(entity) {
  if (!entity) return false;
  try {
    return entity.isValid !== false;
  } catch {
    return false;
  }
}

export function safeGetBlock(dimension, location) {
  try {
    return dimension.getBlock(floorLocation(location));
  } catch {
    return undefined;
  }
}

export function blockType(block) {
  try {
    return block?.typeId;
  } catch {
    return undefined;
  }
}

export function isAirBlock(block) {
  if (!block) return false;
  try {
    return block.isAir === true || block.typeId === "minecraft:air";
  } catch {
    return false;
  }
}

export function isWaterBlock(block) {
  const typeId = blockType(block);
  return typeId === "minecraft:water" || typeId === "minecraft:flowing_water";
}

export function isLavaBlock(block) {
  const typeId = blockType(block);
  return typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava";
}

export function isLiquidBlock(block) {
  if (!block) return false;
  try {
    return block.isLiquid === true || isWaterBlock(block) || isLavaBlock(block);
  } catch {
    return isWaterBlock(block) || isLavaBlock(block);
  }
}

export function isPassableBlock(block, allowWater = true) {
  if (!block) return false;
  if (isAirBlock(block)) return true;
  if (allowWater && isWaterBlock(block)) return true;
  const typeId = blockType(block);
  return typeId === "minecraft:tall_grass" ||
    typeId === "minecraft:short_grass" ||
    typeId === "minecraft:fern" ||
    typeId === "minecraft:large_fern" ||
    typeId === "minecraft:snow_layer" ||
    typeId === "minecraft:vine" ||
    typeId === "minecraft:light_block";
}

export function isHazardBlock(block) {
  const typeId = blockType(block);
  return !!typeId && HAZARD_BLOCKS.has(typeId);
}

export function isSolidSupport(block) {
  if (!block || isPassableBlock(block, false) || isLiquidBlock(block)) return false;
  return !isHazardBlock(block);
}

export function isBreakableBlock(block) {
  const typeId = blockType(block);
  if (!typeId || isAirBlock(block) || isLiquidBlock(block)) return false;
  return !UNBREAKABLE_BLOCKS.has(typeId);
}

export function hasStandingSpace(dimension, location, allowWater = false) {
  const feet = safeGetBlock(dimension, location);
  const head = safeGetBlock(dimension, { x: location.x, y: location.y + 1, z: location.z });
  const below = safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z });
  return isPassableBlock(feet, allowWater) && isPassableBlock(head, allowWater) && isSolidSupport(below);
}

export function supportDepth(dimension, location, maximumDepth = 6) {
  for (let depth = 1; depth <= maximumDepth; depth++) {
    const block = safeGetBlock(dimension, { x: location.x, y: location.y - depth, z: location.z });
    if (!block) return maximumDepth + 1;
    if (isHazardBlock(block) || isLavaBlock(block)) return maximumDepth + 2;
    if (isSolidSupport(block)) return depth;
  }
  return maximumDepth + 1;
}

export function hasLineOfSight(dimension, from, to, maximumDistance = 32) {
  const totalDistance = distance(from, to);
  if (totalDistance > maximumDistance) return false;
  const steps = Math.max(1, Math.ceil(totalDistance * 2));
  for (let index = 1; index < steps; index++) {
    const t = index / steps;
    const point = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t
    };
    const block = safeGetBlock(dimension, point);
    if (!isPassableBlock(block, true)) return false;
  }
  return true;
}

export function safeLookAt(entity, location) {
  try {
    entity.lookAt(location);
    return true;
  } catch {
    return false;
  }
}

export function safePlayAnimation(entity, animation, options = undefined) {
  try {
    entity.playAnimation(animation, options);
    return true;
  } catch {
    return false;
  }
}

export function safeDynamicGet(entity, key, fallback = undefined) {
  try {
    const value = entity.getDynamicProperty(key);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function safeDynamicSet(entity, key, value) {
  try {
    entity.setDynamicProperty(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeTrigger(entity, eventName) {
  try {
    const id = entity.id;
    const previous = triggerCache.get(id);
    const routeEvent = String(eventName).startsWith("manhunt:route_") || String(eventName).startsWith("manhunt:search_");
    const duplicateWindow = routeEvent ? 100 : 20;
    if (previous?.eventName === eventName && system.currentTick - previous.tick < duplicateWindow) return true;
    entity.triggerEvent(eventName);
    if (triggerCache.size > 64) triggerCache.clear();
    triggerCache.set(id, { eventName, tick: system.currentTick });
    return true;
  } catch {
    return false;
  }
}

export function dimensionShortName(dimensionId) {
  return String(dimensionId || "unknown").replace("minecraft:", "");
}

export function formatLocation(location) {
  if (!location) return "unknown";
  return `${Math.floor(location.x)}, ${Math.floor(location.y)}, ${Math.floor(location.z)}`;
}

export function cardinalDirection(vector) {
  const normalized = normalizeXZ(vector);
  if (Math.abs(normalized.x) > Math.abs(normalized.z)) return normalized.x >= 0 ? "east" : "west";
  return normalized.z >= 0 ? "south" : "north";
}

export function weightedChoice(entries) {
  let total = 0;
  for (const entry of entries) total += Math.max(0, entry.weight ?? 0);
  if (total <= 0) return entries[0]?.value;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight ?? 0);
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]?.value;
}

export function isFallingBlock(block) {
  const typeId = blockType(block);
  return typeId === "minecraft:sand" || typeId === "minecraft:red_sand" || typeId === "minecraft:gravel" || String(typeId).includes("concrete_powder");
}

export function adjacentBlocks(dimension, location) {
  return [
    { offset: { x: 1, y: 0, z: 0 }, block: safeGetBlock(dimension, { x: location.x + 1, y: location.y, z: location.z }) },
    { offset: { x: -1, y: 0, z: 0 }, block: safeGetBlock(dimension, { x: location.x - 1, y: location.y, z: location.z }) },
    { offset: { x: 0, y: 1, z: 0 }, block: safeGetBlock(dimension, { x: location.x, y: location.y + 1, z: location.z }) },
    { offset: { x: 0, y: -1, z: 0 }, block: safeGetBlock(dimension, { x: location.x, y: location.y - 1, z: location.z }) },
    { offset: { x: 0, y: 0, z: 1 }, block: safeGetBlock(dimension, { x: location.x, y: location.y, z: location.z + 1 }) },
    { offset: { x: 0, y: 0, z: -1 }, block: safeGetBlock(dimension, { x: location.x, y: location.y, z: location.z - 1 }) }
  ];
}

export function adjacentHazardCount(dimension, location) {
  let count = 0;
  for (const entry of adjacentBlocks(dimension, floorLocation(location))) if (isHazardBlock(entry.block) || isLavaBlock(entry.block)) count++;
  return count;
}

export function adjacentLavaCount(dimension, location) {
  let count = 0;
  for (const entry of adjacentBlocks(dimension, floorLocation(location))) if (isLavaBlock(entry.block)) count++;
  return count;
}

export function isPortalBlock(block) {
  return blockType(block) === "minecraft:portal" || blockType(block) === "minecraft:nether_portal" || blockType(block) === "minecraft:end_portal";
}

export function getLightAt(dimension, location, fallback = 15) {
  try {
    if (typeof dimension.getLightLevel === "function") return dimension.getLightLevel(floorLocation(location));
  } catch {
    // Fall back to the block API.
  }
  try {
    const block = safeGetBlock(dimension, location);
    if (block && typeof block.getLightLevel === "function") return block.getLightLevel();
  } catch {
    // Use the fallback.
  }
  return fallback;
}

export function safeSetBlockType(dimension, location, typeId) {
  const block = safeGetBlock(dimension, location);
  if (!block) return false;
  try {
    block.setType(typeId);
    return true;
  } catch {
    return false;
  }
}

export function blockIntersectsEntity(entity, blockLocation, horizontal = 0.72, vertical = 1.15) {
  if (!isEntityValid(entity)) return false;
  const x = blockLocation.x + 0.5;
  const y = blockLocation.y + 0.5;
  const z = blockLocation.z + 0.5;
  return Math.abs(entity.location.x - x) < horizontal &&
    Math.abs((entity.location.y + 0.9) - y) < vertical &&
    Math.abs(entity.location.z - z) < horizontal;
}

export function safeApplyImpulse(entity, impulse) {
  try {
    entity.applyImpulse(impulse);
    return true;
  } catch {
    return false;
  }
}

export function withinBlockReach(entity, location, range = 3.2) {
  return distance(entity.location, { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }) <= range;
}
