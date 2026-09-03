import { EntityDamageCause, system } from "@minecraft/server";
import {
  equipBestAxe,
  equipBestSword,
  getAxeTier,
  getSwordTier
} from "./gathering.js";
import {
  countItem,
  equipMainhand,
  equipOffhand,
  removeItem,
  runnerHasShield
} from "./inventory.js";
import {
  adjacentHazardCount,
  distance,
  floorLocation,
  hasLineOfSight,
  hasStandingSpace,
  normalizeXZ,
  safeApplyImpulse,
  safeLookAt,
  safeTrigger
} from "./utils.js";

function shieldReady(hunter) {
  try { return hunter.getDynamicProperty("manhunt:has_shield") === true; } catch { return false; }
}

function bowReady(hunter) {
  try { return hunter.getDynamicProperty("manhunt:has_bow") === true && countItem(hunter, "minecraft:arrow") > 0; } catch { return false; }
}

function stageOf(brain) {
  return Math.max(0, Math.min(8, Math.trunc(brain?.difficultyStage ?? 0)));
}

// Per-tier combat feel. Nightmare is near-frame-perfect; Easy hesitates like a
// player who is still learning the fight.
const COMBAT_TUNING = Object.freeze({
  reaction: [12, 6, 3, 2],
  defensiveDuration: [18, 14, 10, 9],
  defenseCooldown: [100, 70, 45, 36],
  bowCooldown: [48, 34, 24, 20],
  bowLead: [3, 6, 9, 11],
  bowSpeed: [1.55, 1.75, 2.0, 2.15],
  // Vertical aim error in blocks per shot. Human hands are not perfect.
  aimError: [1.5, 0.7, 0.28, 0.12],
  sidestepStrength: [0.018, 0.026, 0.034, 0.04]
});

function tuningValue(config, key) {
  const level = Math.max(0, Math.min(3, config?.aiLevel ?? 1));
  return COMBAT_TUNING[key][level];
}

function reactionTicks(config, brain) {
  return Math.max(1, COMBAT_TUNING.reaction[Math.max(0, Math.min(3, config.aiLevel ?? 1))] - stageOf(brain));
}

function defensiveDuration(config, brain) {
  return Math.max(8, COMBAT_TUNING.defensiveDuration[Math.max(0, Math.min(3, config.aiLevel ?? 1))] - Math.floor(stageOf(brain) / 2));
}

function defenseCooldown(config, brain) {
  return Math.max(30, COMBAT_TUNING.defenseCooldown[Math.max(0, Math.min(3, config.aiLevel ?? 1))] - stageOf(brain) * 6);
}

function bowCooldown(config, brain) {
  return Math.max(20, COMBAT_TUNING.bowCooldown[Math.max(0, Math.min(3, config.aiLevel ?? 1))] - stageOf(brain) * 3);
}

function chooseMeleeWeapon(hunter, runner, perception) {
  const shield = perception.runnerHasShield || runnerHasShield(runner);
  if (shield && getAxeTier(hunter) > 0) return equipBestAxe(hunter);
  return equipBestSword(hunter);
}

function setShield(hunter, brain, enabled, config) {
  if (!shieldReady(hunter)) return false;
  if (enabled) {
    equipOffhand(hunter, "minecraft:shield");
    safeTrigger(hunter, "manhunt:defend");
    if ((brain.shieldUntilTick ?? 0) <= system.currentTick) {
      brain.shieldUntilTick = system.currentTick + defensiveDuration(config, brain);
    }
  } else {
    safeTrigger(hunter, "manhunt:chase");
    brain.shieldUntilTick = 0;
  }
  return true;
}

function shouldDefend(brain, config, perception) {
  if (!shieldReady(perception?.hunter ?? {})) return false;
  if (!perception.sameDimension || perception.runnerDistance > 6.2) return false;
  if (system.currentTick - (brain.lastDamagedTick ?? -9999) <= reactionTicks(config, brain) + 5) return true;
  if (perception.runnerWeapon?.includes("sword") || perception.runnerWeapon?.includes("axe") || perception.runnerWeapon?.includes("bow") || perception.runnerWeapon?.includes("crossbow")) {
    const sinceHit = system.currentTick - (brain.lastSuccessfulHitTick ?? -9999);
    return sinceHit > 10 && Math.random() < [0.15, 0.27, 0.4, 0.5][Math.max(0, Math.min(3, config.aiLevel ?? 1))];
  }
  return false;
}

function aimPoint(runner, brain, config) {
  const head = runner.getHeadLocation ? runner.getHeadLocation() : { x: runner.location.x, y: runner.location.y + 1.55, z: runner.location.z };
  const lead = tuningValue(config, "bowLead");
  // Human hands drift: add a small random offset so even Nightmare misses
  // occasionally, while Easy sprays like a panicked player.
  const errorScale = config?.humanMistakes === false ? tuningValue(config, "aimError") * 0.35 : tuningValue(config, "aimError");
  return {
    x: head.x + (brain.runnerVelocity?.x ?? 0) * lead + (Math.random() - 0.5) * errorScale,
    y: head.y + (brain.runnerVelocity?.y ?? 0) * lead + (Math.random() - 0.5) * errorScale,
    z: head.z + (brain.runnerVelocity?.z ?? 0) * lead + (Math.random() - 0.5) * errorScale
  };
}

function fireArrow(hunter, runner, brain, config, perception) {
  if (!bowReady(hunter) || !perception.runnerVisible || perception.runnerDistance < 7 || perception.runnerDistance > 30) return false;
  if (system.currentTick - (brain.lastBowTick ?? -9999) < bowCooldown(config, brain)) return false;
  const from = hunter.getHeadLocation ? hunter.getHeadLocation() : { x: hunter.location.x, y: hunter.location.y + 1.55, z: hunter.location.z };
  const target = aimPoint(runner, brain, config);
  if (!hasLineOfSight(hunter.dimension, from, target, 36)) return false;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const horizontal = Math.max(0.01, Math.hypot(dx, dz));
  const speed = tuningValue(config, "bowSpeed");
  const flightTime = horizontal / speed;
  const velocity = {
    x: dx / horizontal * speed,
    y: dy / Math.max(1, flightTime) * 0.55 + Math.min(0.38, horizontal * 0.012),
    z: dz / horizontal * speed
  };
  let arrow;
  try {
    arrow = hunter.dimension.spawnEntity("minecraft:arrow", from);
    const projectile = arrow.getComponent("minecraft:projectile");
    if (!projectile) { arrow.remove(); return false; }
    projectile.owner = hunter;
    projectile.shoot(velocity);
  } catch (error) {
    try { arrow?.remove(); } catch { /* ignore */ }
    brain.lastError = `bow shot: ${error}`;
    brain.lastErrorTick = system.currentTick;
    return false;
  }
  if (!removeItem(hunter, "minecraft:arrow", 1)) {
    try { arrow.remove(); } catch { /* ignore */ }
    return false;
  }
  equipMainhand(hunter, "minecraft:bow");
  safeLookAt(hunter, target);
  brain.lastBowTick = system.currentTick;
  brain.lastAttackTick = system.currentTick;
  brain.lastSuccessfulAction = "fired a predicted bow shot";
  return true;
}

function postHitSprintReset(hunter, runner, brain, config, perception) {
  if ((brain.lastSuccessfulHitTick ?? -1) <= (brain.lastProcessedHitTick ?? -1)) return false;
  brain.lastProcessedHitTick = brain.lastSuccessfulHitTick;
  if (perception.inWater || !perception.onGround || perception.hazardNear) return false;
  const away = normalizeXZ({ x: hunter.location.x - runner.location.x, y: 0, z: hunter.location.z - runner.location.z });
  const strength = tuningValue(config, "sidestepStrength");
  safeApplyImpulse(hunter, { x: away.x * strength, y: 0, z: away.z * strength });
  return true;
}

// A real player misclicks: swings at nothing right as the target strafes.
// This is purely cosmetic — no damage, no engine calls beyond an animation.
export function tickWhiffSwing(hunter, brain, config, perception) {
  if (!config?.humanMistakes || perception.runnerDistance > 4.2) return false;
  if (system.currentTick < (brain.lastWhiffTick ?? -9999) + (config.aiLevel >= 2 ? 140 : 70)) return false;
  if (Math.random() > (config.aiLevel === 0 ? 0.16 : config.aiLevel === 3 ? 0.04 : 0.09)) return false;
  brain.lastWhiffTick = system.currentTick;
  try { hunter.playAnimation("animation.humanoid.attack.rotations", { blendOutTime: 0.12 }); } catch { /* cosmetic */ }
  brain.lastSuccessfulAction = "swung early on a strafe read";
  return true;
}

function safeSidestep(hunter, runner, perception, brain) {
  if (!perception.hazardNear || perception.runnerDistance > 6) return false;
  const toward = normalizeXZ({ x: runner.location.x - hunter.location.x, y: 0, z: runner.location.z - hunter.location.z });
  const directions = [
    { x: -toward.z, z: toward.x },
    { x: toward.z, z: -toward.x }
  ];
  if ((system.currentTick + brain.squadIndex) % 2 !== 0) directions.reverse();
  const base = floorLocation(hunter.location);
  const candidates = directions.map((direction) => ({
    direction,
    location: { x: base.x + direction.x * 1.2, y: base.y, z: base.z + direction.z * 1.2 }
  })).filter((candidate) => hasStandingSpace(hunter.dimension, candidate.location, false));
  candidates.sort((a, b) => adjacentHazardCount(hunter.dimension, a.location) - adjacentHazardCount(hunter.dimension, b.location));
  const selected = candidates.find((candidate) => adjacentHazardCount(hunter.dimension, candidate.location) === 0);
  if (!selected) return false;
  safeApplyImpulse(hunter, { x: selected.direction.x * 0.045, y: 0.01, z: selected.direction.z * 0.045 });
  brain.lastSuccessfulAction = "sidestepped onto verified safe ground";
  return true;
}

function naturalCriticalState(perception) {
  return !perception.onGround && perception.falling && perception.velocity.y < -0.08 && !perception.inWater;
}

export function tickCombat(hunter, runner, brain, config, perception) {
  perception.hunter = hunter;
  if (!perception.sameDimension) return "runner is in another dimension";
  const from = hunter.getHeadLocation ? hunter.getHeadLocation() : hunter.location;
  const target = aimPoint(runner, brain, config);
  const visible = perception.runnerVisible || (perception.runnerDistance < 3.1 && hasLineOfSight(hunter.dimension, from, target, 8));
  if (!visible) {
    safeTrigger(hunter, "manhunt:chase");
    return "reacquiring line of sight instead of attacking through blocks";
  }

  if (brain.shieldUntilTick > system.currentTick) {
    setShield(hunter, brain, true, config);
    safeLookAt(hunter, target);
    return "blocking the runner's attack with a shield";
  }
  if (brain.shieldUntilTick && brain.shieldUntilTick <= system.currentTick) setShield(hunter, brain, false, config);

  if (shouldDefend(brain, config, perception) && system.currentTick - (brain.lastDefenseTick ?? -9999) >= defenseCooldown(config, brain)) {
    brain.lastDefenseTick = system.currentTick;
    setShield(hunter, brain, true, config);
    safeLookAt(hunter, target);
    return "raising shield during the runner's attack window";
  }

  if (fireArrow(hunter, runner, brain, config, perception)) return "firing a ranged prediction shot";

  chooseMeleeWeapon(hunter, runner, perception);
  safeTrigger(hunter, "manhunt:chase");
  safeLookAt(hunter, target);
  safeSidestep(hunter, runner, perception, brain);
  postHitSprintReset(hunter, runner, brain, config, perception);

  if (perception.runnerDistance > 4.1) return "sprinting into legal melee reach";
  if (perception.runnerDistance < 1.15) return "creating a small spacing window before the next hit";
  tickWhiffSwing(hunter, brain, config, perception);
  if (naturalCriticalState(perception)) return "using a naturally timed falling critical attack";
  if (perception.runnerHasShield && getAxeTier(hunter) > 0) return "pressuring the raised shield with an axe";
  return "timing the next weapon cooldown inside melee reach";
}

export function tickBlockingHostileCombat(hunter, brain, config, perception) {
  const hostile = perception?.nearbyHostile;
  if (!hostile || perception.nearbyHostileDistance > 3.1) return false;
  if (perception.sameDimension && perception.runnerDistance < 7 && brain.lastDamagerType !== hostile.typeId) return false;
  if (system.currentTick - (brain.lastHostileAttackTick ?? -9999) < [24, 18, 12, 10][Math.max(0, Math.min(3, config.aiLevel ?? 1))]) return true;
  equipBestSword(hunter);
  safeLookAt(hunter, hostile.getHeadLocation ? hostile.getHeadLocation() : hostile.location);
  try {
    const damage = getSwordTier(hunter) >= 3 ? 6 : getSwordTier(hunter) === 2 ? 5 : getSwordTier(hunter) === 1 ? 4 : 2;
    hostile.applyDamage(damage, { cause: EntityDamageCause.EntityAttack, damagingEntity: hunter });
    brain.lastHostileAttackTick = system.currentTick;
    brain.lastSuccessfulAction = `cleared blocking ${hostile.typeId.replace("minecraft:", "")}`;
    return true;
  } catch {
    return false;
  }
}

export function onHunterDamaged(hunter, brain, config, cause = "unknown", damagerType = "unknown") {
  if (!brain) return;
  brain.lastDamagedTick = system.currentTick;
  brain.lastDamageCause = cause;
  brain.lastDamagerType = damagerType;
  if (!shieldReady(hunter)) return;
  if (system.currentTick - (brain.lastDefenseTick ?? -9999) < defenseCooldown(config, brain) / 2) return;
  brain.lastDefenseTick = system.currentTick;
  setShield(hunter, brain, true, config);
}

export function onHunterHitRunner(brain) {
  if (!brain) return;
  brain.lastSuccessfulHitTick = system.currentTick;
  brain.lastAttackTick = system.currentTick;
}

export function combatStatus(brain) {
  return {
    lastAttackAgo: Math.max(0, system.currentTick - (brain?.lastAttackTick ?? -9999)),
    lastBowAgo: Math.max(0, system.currentTick - (brain?.lastBowTick ?? -9999)),
    shielding: (brain?.shieldUntilTick ?? 0) > system.currentTick,
    lastDamager: brain?.lastDamagerType ?? "none"
  };
}
