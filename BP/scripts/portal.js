import { BlockPermutation, system, world } from "@minecraft/server";
import { PORTAL_FRAME_OFFSETS } from "./constants.js";
import { addItem, countItem, removeItem } from "./inventory.js";
import {
  advanceActionStep,
  authorizePlacement,
  createActionPlan,
  failActionStep,
  getCurrentStep
} from "./planner.js";
import {
  getSquadKnowledge,
  nearestRememberedPortal,
  rememberPortal
} from "./squad.js";
import {
  blockIntersectsEntity,
  distance,
  floorLocation,
  hasStandingSpace,
  isAirBlock,
  isPortalBlock,
  isSolidSupport,
  safeGetBlock,
  safeLookAt,
  safeSetBlockType
} from "./utils.js";

function targetDimensionId(dimensionId) {
  if (dimensionId === "minecraft:overworld" || dimensionId === "overworld") return "nether";
  if (dimensionId === "minecraft:nether" || dimensionId === "nether") return "overworld";
  return "the_end";
}

function canonicalDimension(id) {
  const value = String(id ?? "overworld").replace("minecraft:", "");
  return value === "the_end" ? "the_end" : value === "nether" ? "nether" : "overworld";
}

function convertCoordinates(location, fromId, toId) {
  const from = canonicalDimension(fromId);
  const to = canonicalDimension(toId);
  if (from === "overworld" && to === "nether") return { x: location.x / 8, y: location.y, z: location.z / 8 };
  if (from === "nether" && to === "overworld") return { x: location.x * 8, y: location.y, z: location.z * 8 };
  return { ...location };
}

function findSafe(dimension, location, radius = 8) {
  const base = floorLocation(location);
  for (let ring = 0; ring <= radius; ring++) {
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const angle = ring === 0 ? 0 : (i / (ring * 8)) * Math.PI * 2;
      const x = base.x + Math.round(Math.cos(angle) * ring);
      const z = base.z + Math.round(Math.sin(angle) * ring);
      for (let y = Math.min(310, base.y + 8); y >= Math.max(-60, base.y - 12); y--) {
        const candidate = { x: x + 0.5, y, z: z + 0.5 };
        if (hasStandingSpace(dimension, candidate, false)) return candidate;
      }
    }
  }
  return { x: base.x + 0.5, y: base.y + 2, z: base.z + 0.5 };
}

function portalTouching(entity) {
  const base = floorLocation(entity.location);
  for (let y = 0; y <= 1; y++) {
    for (const offset of [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
      const block = safeGetBlock(entity.dimension, { x: base.x + offset.x, y: base.y + y, z: base.z + offset.z });
      if (isPortalBlock(block)) return { x: base.x + offset.x, y: base.y + y, z: base.z + offset.z, typeId: block.typeId };
    }
  }
  return undefined;
}

function safePortalBase(hunter) {
  const base = floorLocation(hunter.location);
  const candidates = [];
  for (const direction of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
    const origin = { x: base.x + direction.x * 3, y: base.y, z: base.z + direction.z * 3 };
    let valid = true;
    for (let x = 0; x <= 3 && valid; x++) {
      for (let y = 0; y <= 4 && valid; y++) {
        const location = direction.x !== 0
          ? { x: origin.x, y: origin.y + y, z: origin.z + x }
          : { x: origin.x + x, y: origin.y + y, z: origin.z };
        const block = safeGetBlock(hunter.dimension, location);
        if (!block || (!isAirBlock(block) && !isPortalBlock(block))) valid = false;
      }
    }
    const axis = direction.x !== 0 ? "z" : "x";
    if (valid) {
      for (let x = 0; x <= 3; x++) {
        const supportLocation = axis === "x"
          ? { x: origin.x + x, y: origin.y - 1, z: origin.z }
          : { x: origin.x, y: origin.y - 1, z: origin.z + x };
        if (!isSolidSupport(safeGetBlock(hunter.dimension, supportLocation))) {
          valid = false;
          break;
        }
      }
    }
    if (valid) candidates.push({ origin, axis, direction });
  }
  return candidates[0];
}

function transformOffset(base, offset, axis) {
  return axis === "x"
    ? { x: base.x + offset.x, y: base.y + offset.y, z: base.z }
    : { x: base.x, y: base.y + offset.y, z: base.z + offset.x };
}

export function rememberNearbyPortal(hunter, perception) {
  const portal = perception?.hunterPortal;
  if (!portal) return;
  rememberPortal(hunter.dimension.id, portal.location);
}

export function createPortalBuildPlan(hunter, brain) {
  if (countItem(hunter, "minecraft:obsidian") < 14 || countItem(hunter, "minecraft:flint_and_steel") < 1) return false;
  const selected = safePortalBase(hunter);
  if (!selected) {
    brain.lastFailedAction = "portal: no safe 4x5 construction space";
    return false;
  }
  const steps = PORTAL_FRAME_OFFSETS.map((offset) => ({
    type: "place",
    location: transformOffset(selected.origin, offset, selected.axis),
    item: "minecraft:obsidian",
    reason: "construct the portal frame",
    maxTicks: 180,
    metadata: { purpose: "portal_frame", axis: selected.axis }
  }));
  steps.push({
    type: "activate_portal",
    location: { ...selected.origin },
    reason: "ignite the completed portal",
    maxTicks: 100,
    metadata: { purpose: "portal_ignition", axis: selected.axis }
  });
  createActionPlan(brain, "build_portal", "construct a real portal because no remembered portal is reachable", steps, {
    origin: selected.origin,
    axis: selected.axis
  }, 20 * 180);
  brain.portalBuild = { ...selected, createdTick: system.currentTick };
  return true;
}

function placeFrameBlock(hunter, runner, brain, step) {
  const location = step.location;
  if (!authorizePlacement(brain, location, "portal_frame")) return { active: false, failed: true };
  if (distance(hunter.location, { x: location.x + 0.5, y: location.y, z: location.z + 0.5 }) > 4.4) return { active: true, target: location };
  if (blockIntersectsEntity(hunter, location) || (runner?.dimension.id === hunter.dimension.id && blockIntersectsEntity(runner, location, 0.9, 1.8))) {
    failActionStep(brain, "portal frame would intersect an entity");
    return { active: false, failed: true };
  }
  const block = safeGetBlock(hunter.dimension, location);
  if (block?.typeId === "minecraft:obsidian") {
    advanceActionStep(brain, "existing obsidian reused");
    return { active: true };
  }
  if (!isAirBlock(block) || countItem(hunter, "minecraft:obsidian") < 1) {
    failActionStep(brain, "portal frame destination is blocked or obsidian ran out");
    return { active: false, failed: true };
  }
  safeLookAt(hunter, { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 });
  if (!removeItem(hunter, "minecraft:obsidian", 1)) return { active: false, failed: true };
  if (!safeSetBlockType(hunter.dimension, location, "minecraft:obsidian")) {
    addItem(hunter, "minecraft:obsidian", 1);
    failActionStep(brain, "portal frame block placement failed");
    return { active: false, failed: true };
  }
  advanceActionStep(brain, "portal frame block placed");
  return { active: true };
}

function activatePortal(hunter, brain, step) {
  if (countItem(hunter, "minecraft:flint_and_steel") < 1) {
    failActionStep(brain, "flint and steel is missing");
    return false;
  }
  const origin = brain.actionPlan?.metadata?.origin ?? step.location;
  const axis = brain.actionPlan?.metadata?.axis ?? step.metadata?.axis ?? "x";
  for (let x = 1; x <= 2; x++) {
    for (let y = 1; y <= 3; y++) {
      const location = transformOffset(origin, { x, y, z: 0 }, axis);
      const block = safeGetBlock(hunter.dimension, location);
      if (!isAirBlock(block) && !isPortalBlock(block)) {
        failActionStep(brain, "portal interior became blocked");
        return false;
      }
    }
  }
  const activated = [];
  for (let x = 1; x <= 2; x++) {
    for (let y = 1; y <= 3; y++) {
      const location = transformOffset(origin, { x, y, z: 0 }, axis);
      const block = safeGetBlock(hunter.dimension, location);
      if (!block) {
        for (const placed of activated) safeSetBlockType(hunter.dimension, placed, "minecraft:air");
        failActionStep(brain, "portal ignition chunk or block was unavailable");
        return false;
      }
      if (isPortalBlock(block)) continue;
      let placed = false;
      try {
        const permutation = BlockPermutation.resolve("minecraft:portal", { portal_axis: axis });
        block.setPermutation(permutation);
        placed = true;
      } catch {
        placed = safeSetBlockType(hunter.dimension, location, "minecraft:portal");
      }
      if (!placed) {
        for (const previous of activated) safeSetBlockType(hunter.dimension, previous, "minecraft:air");
        failActionStep(brain, "portal ignition failed and partial portal blocks were rolled back");
        return false;
      }
      activated.push({ ...location });
    }
  }
  rememberPortal(hunter.dimension.id, transformOffset(origin, { x: 1, y: 1, z: 0 }, axis));
  advanceActionStep(brain, "portal activated");
  return true;
}

export function tickPortalBuild(hunter, runner, brain) {
  const step = getCurrentStep(brain);
  if (!step || brain.actionPlan?.type !== "build_portal") return { active: false };
  if (step.type === "place") return placeFrameBlock(hunter, runner, brain, step);
  if (step.type === "activate_portal") return { active: activatePortal(hunter, brain, step) };
  failActionStep(brain, `unsupported portal step ${step.type}`);
  return { active: false, failed: true };
}

export function portalTargetForHunter(hunter, runner, brain, config) {
  if (!runner || runner.dimension.id === hunter.dimension.id) return undefined;
  const knowledge = getSquadKnowledge();
  const destinationId = canonicalDimension(runner.dimension.id);
  const hunterDim = canonicalDimension(hunter.dimension.id);

  if (destinationId === "the_end" && config.endPursuit !== false) {
    // The End requires a real end portal. Prefer one already discovered nearby,
    // then any linked remembered portal, otherwise let the caller fall back to
    // "stronghold sense" navigation toward the runner's last overworld trail.
    if (brain.nearbyEndPortal) return { ...brain.nearbyEndPortal, source: "scanned end portal" };
    const linkedEnd = [...knowledge.portals.values()]
      .filter((entry) => canonicalDimension(entry.dimensionId) === hunterDim)
      .filter((entry) => canonicalDimension(entry.destinationDimension ?? "") === "the_end")
      .sort((a, b) => distance(hunter.location, a.location) - distance(hunter.location, b.location))[0];
    if (linkedEnd) return { ...linkedEnd.location, source: "remembered end portal" };
    if (hunterDim === "nether") {
      // No direct route: hop home through the nearest Nether-side portal first.
      const homeward = [...knowledge.portals.values()]
        .filter((entry) => canonicalDimension(entry.dimensionId) === "nether")
        .sort((a, b) => distance(hunter.location, a.location) - distance(hunter.location, b.location))[0];
      if (homeward) return { ...homeward.location, source: "chain route to the End" };
    }
    return undefined;
  }

  const matching = [...knowledge.portals.values()]
    .filter((entry) => canonicalDimension(entry.dimensionId) === canonicalDimension(hunter.dimension.id))
    .filter((entry) => !entry.destinationDimension || canonicalDimension(entry.destinationDimension) === destinationId)
    .sort((a, b) => {
      const aLinked = a.destinationDimension ? 0 : 1;
      const bLinked = b.destinationDimension ? 0 : 1;
      return aLinked - bLinked || distance(hunter.location, a.location) - distance(hunter.location, b.location);
    })[0];
  const remembered = matching ?? nearestRememberedPortal(hunter.dimension.id, hunter.location);
  if (remembered) return { ...remembered.location, source: remembered.destinationDimension ? "linked remembered" : "remembered" };
  const portal = portalTouching(hunter);
  if (portal) return { ...portal, source: "touching" };
  if (config.portalIntelligence && countItem(hunter, "minecraft:obsidian") >= 14 && countItem(hunter, "minecraft:flint_and_steel") >= 1) {
    if (!brain.actionPlan || brain.actionPlan.type !== "build_portal") createPortalBuildPlan(hunter, brain);
  }
  return undefined;
}

export function tickPortalTransit(hunter, runner, brain, config) {
  if (!runner || runner.dimension.id === hunter.dimension.id) {
    brain.portalContactSince = 0;
    return false;
  }
  const touching = portalTouching(hunter);
  if (!touching) {
    brain.portalContactSince = 0;
    return false;
  }
  if (!brain.portalContactSince) brain.portalContactSince = system.currentTick;
  if (system.currentTick - brain.portalContactSince < 50) return true;

  const sourceDimensionId = hunter.dimension.id;
  const sourcePortal = { ...touching };
  const targetId = canonicalDimension(runner.dimension.id);
  let targetDimension;
  try { targetDimension = world.getDimension(targetId); } catch { return false; }
  const enteringEnd = targetId === "the_end";
  const expected = enteringEnd
    ? { x: runner.location.x, y: runner.location.y, z: runner.location.z }
    : convertCoordinates(hunter.location, hunter.dimension.id, targetDimension.id);
  const knowledge = getSquadKnowledge();
  const destinationPortal = [...knowledge.portals.values()]
    .filter((entry) => canonicalDimension(entry.dimensionId) === targetId)
    .sort((a, b) => distance(expected, a.location) - distance(expected, b.location))[0];
  // End islands are scattered; anchor to the runner's actual island when no
  // remembered End-side location exists.
  const destination = findSafe(targetDimension, destinationPortal?.location ?? expected, 10);
  try {
    hunter.teleport(destination, { dimension: targetDimension, facingLocation: runner.location, checkForBlocks: true });
    brain.portalContactSince = 0;
    brain.lastSuccessfulAction = `used a portal to ${targetId}`;
    rememberPortal(targetDimension.id, destination, sourceDimensionId, sourcePortal);
    return true;
  } catch (error) {
    brain.lastError = `portal transit: ${error}`;
    brain.lastErrorTick = system.currentTick;
    return false;
  }
}

export function portalStatus(brain) {
  const plan = brain?.actionPlan?.type === "build_portal" ? brain.actionPlan : undefined;
  return {
    building: Boolean(plan),
    progress: plan ? `${plan.cursor}/${plan.steps.length}` : "none",
    contactTicks: brain?.portalContactSince ? system.currentTick - brain.portalContactSince : 0
  };
}
