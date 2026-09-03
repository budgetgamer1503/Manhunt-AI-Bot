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

// ─── Combat system ────────────────────────────────────────────────────────────
// Rebuilt to feel like a real player rather than a frame-perfect machine.
//
// Key changes vs the old system:
//  • Variable attack timing — the bot doesn't swing on a fixed cooldown.
//    It has a "committed swing window" that varies per hit, like a human
//    who sometimes swings a tick early or late.
//  • Spacing rhythm — after landing a hit the bot backs off slightly, then
//    re-engages. Real players do this instinctively.
//  • Feint system — occasionally the bot raises its shield, drops it, and
//    swings. This is a real PvP technique.
//  • Strafe direction memory — the bot picks a strafe direction and commits
//    to it for several ticks before switching, not random every tick.
//  • Bow lead is now velocity-extrapolated with realistic human error.
//  • Hostile mob handling is smarter: the bot only breaks off the runner
//    chase if the mob is actively dealing damage.

// ── constants ─────────────────────────────────────────────────────────────────

function aiLevel(config) {
  return Math.max(0, Math.min(3, config?.aiLevel ?? 1));
}

function stageOf(brain) {
  return Math.max(0, Math.min(8, Math.trunc(brain?.difficultyStage ?? 0)));
}

// Per-tier tuning. Index = aiLevel (0=Easy, 1=Normal, 2=Expert, 3=Nightmare).
const TUNING = Object.freeze({
  // Ticks after taking damage before the bot reacts with a shield.
  reactionTicks:      [14, 8, 4, 2],
  // How long the shield stays up per block.
  shieldDuration:     [20, 15, 11, 9],
  // Minimum ticks between shield raises.
  shieldCooldown:     [110, 75, 48, 36],
  // Minimum ticks between bow shots.
  bowCooldown:        [52, 36, 26, 20],
  // Ticks of velocity lead for bow prediction.
  bowLead:            [2,  5,  8, 11],
  // Arrow flight speed (blocks/tick).
  bowSpeed:           [1.5, 1.75, 2.0, 2.2],
  // Aim error radius in blocks (Gaussian-like via two random samples).
  aimError:           [1.6, 0.75, 0.3, 0.1],
  // Chance per tick to raise shield when runner has a weapon drawn.
  shieldChance:       [0.12, 0.24, 0.38, 0.50],
  // Spacing impulse after landing a hit.
  spacingStrength:    [0.016, 0.024, 0.032, 0.040],
  // Strafe impulse strength during melee.
  strafeStrength:     [0.020, 0.030, 0.038, 0.046],
  // Ticks to commit to one strafe direction before switching.
  strafeCommit:       [8, 10, 13, 16],
  // Chance to feint (raise shield then immediately swing).
  feintChance:        [0.0, 0.04, 0.09, 0.14],
  // Whiff chance per engagement tick (cosmetic miss animation).
  whiffChance:        [0.18, 0.10, 0.05, 0.02],
  // Minimum ticks between whiff animations.
  whiffCooldown:      [60, 90, 130, 180],
  // Hostile mob attack cooldown ticks.
  hostileAttackCd:    [26, 20, 14, 10]
});

function tv(config, key) {
  return TUNING[key][aiLevel(config)];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function shieldReady(hunter) {
  try { return hunter.getDynamicProperty("manhunt:has_shield") === true; } catch { return false; }
}

function bowReady(hunter) {
  try { return hunter.getDynamicProperty("manhunt:has_bow") === true && countItem(hunter, "minecraft:arrow") > 0; } catch { return false; }
}

function chooseMeleeWeapon(hunter, runner, perception) {
  const shield = perception.runnerHasShield || runnerHasShield(runner);
  if (shield && getAxeTier(hunter) > 0) return equipBestAxe(hunter);
  return equipBestSword(hunter);
}

/** Gaussian-ish aim error: average of two uniform samples reduces extreme outliers. */
function aimError(config) {
  const scale = tv(config, "aimError");
  return ((Math.random() - 0.5) + (Math.random() - 0.5)) * scale;
}

function headOf(entity) {
  try { return entity.getHeadLocation?.() ?? { x: entity.location.x, y: entity.location.y + 1.55, z: entity.location.z }; }
  catch { return { x: entity.location.x, y: entity.location.y + 1.55, z: entity.location.z }; }
}

function aimPoint(runner, brain, config) {
  const head = headOf(runner);
  const lead = tv(config, "bowLead");
  const vel = brain.runnerVelocity ?? { x: 0, y: 0, z: 0 };
  return {
    x: head.x + vel.x * lead + aimError(config),
    y: head.y + vel.y * lead + aimError(config),
    z: head.z + vel.z * lead + aimError(config)
  };
}

// ── shield / feint ────────────────────────────────────────────────────────────

function raiseShield(hunter, brain, config) {
  if (!shieldReady(hunter)) return false;
  equipOffhand(hunter, "minecraft:shield");
  safeTrigger(hunter, "manhunt:defend");
  brain.shieldUntilTick = system.currentTick + tv(config, "shieldDuration") + Math.floor(Math.random() * 6);
  return true;
}

function lowerShield(hunter, brain) {
  safeTrigger(hunter, "manhunt:chase");
  brain.shieldUntilTick = 0;
  brain.feintTick = undefined;
}

function shouldRaiseShield(brain, config, perception) {
  if (!shieldReady(perception?.hunter ?? {})) return false;
  if (!perception.sameDimension || perception.runnerDistance > 6.5) return false;
  if (system.currentTick - (brain.lastShieldTick ?? -9999) < tv(config, "shieldCooldown")) return false;
  // React to taking damage.
  const recentDamage = system.currentTick - (brain.lastDamagedTick ?? -9999) <= tv(config, "reactionTicks") + 6;
  if (recentDamage) return true;
  // Probabilistic raise when runner has a weapon.
  const weapon = perception.runnerWeapon ?? "";
  if (weapon.includes("sword") || weapon.includes("axe") || weapon.includes("bow") || weapon.includes("crossbow")) {
    const sinceHit = system.currentTick - (brain.lastSuccessfulHitTick ?? -9999);
    return sinceHit > 8 && Math.random() < tv(config, "shieldChance");
  }
  return false;
}

// ── strafe system ─────────────────────────────────────────────────────────────
// Real players pick a strafe direction and commit to it for several ticks.
// Switching every tick looks robotic and is actually worse PvP.

function updateStrafe(hunter, runner, brain, config, perception) {
  if (perception.inWater || perception.hazardNear || perception.runnerDistance > 5.5) return;
  const commitTicks = tv(config, "strafeCommit");
  const sinceSwitch = system.currentTick - (brain.lastStrafeSwitch ?? -9999);
  // Switch direction after commit window, or randomly with low probability.
  if (sinceSwitch >= commitTicks || Math.random() < 0.04) {
    // Pick perpendicular to the runner direction.
    const toward = normalizeXZ({
      x: runner.location.x - hunter.location.x,
      y: 0,
      z: runner.location.z - hunter.location.z
    });
    const left  = { x: -toward.z, z:  toward.x };
    const right = { x:  toward.z, z: -toward.x };
    // Prefer the direction with less hazard.
    const baseL = { x: Math.floor(hunter.location.x) + left.x,  y: Math.floor(hunter.location.y), z: Math.floor(hunter.location.z) + left.z };
    const baseR = { x: Math.floor(hunter.location.x) + right.x, y: Math.floor(hunter.location.y), z: Math.floor(hunter.location.z) + right.z };
    const hazL = adjacentHazardCount(hunter.dimension, baseL);
    const hazR = adjacentHazardCount(hunter.dimension, baseR);
    if (hazL === 0 && hazR === 0) {
      brain.strafeDir = Math.random() < 0.5 ? left : right;
    } else if (hazL <= hazR) {
      brain.strafeDir = left;
    } else {
      brain.strafeDir = right;
    }
    brain.lastStrafeSwitch = system.currentTick;
  }
  const dir = brain.strafeDir;
  if (!dir) return;
  const strength = tv(config, "strafeStrength");
  safeApplyImpulse(hunter, { x: dir.x * strength, y: 0, z: dir.z * strength });
}

// ── spacing after a hit ───────────────────────────────────────────────────────
// After landing a hit, back off slightly then re-engage. This is the
// "W-tap" / sprint-reset rhythm real players use.

function tickSpacingRhythm(hunter, runner, brain, config, perception) {
  if ((brain.lastSuccessfulHitTick ?? -1) <= (brain.lastProcessedHitTick ?? -1)) return false;
  brain.lastProcessedHitTick = brain.lastSuccessfulHitTick;
  if (perception.inWater || !perception.onGround || perception.hazardNear) return false;
  const away = normalizeXZ({
    x: hunter.location.x - runner.location.x,
    y: 0,
    z: hunter.location.z - runner.location.z
  });
  const strength = tv(config, "spacingStrength");
  safeApplyImpulse(hunter, { x: away.x * strength, y: 0, z: away.z * strength });
  // Brief spacing window — re-engage after ~4 ticks.
  brain.spacingUntilTick = system.currentTick + 4 + Math.floor(Math.random() * 4);
  return true;
}

// ── whiff swing (cosmetic human mistake) ─────────────────────────────────────

export function tickWhiffSwing(hunter, brain, config, perception) {
  if (!config?.humanMistakes) return false;
  if (perception.runnerDistance > 4.5) return false;
  if (system.currentTick < (brain.lastWhiffTick ?? -9999) + tv(config, "whiffCooldown")) return false;
  if (Math.random() > tv(config, "whiffChance")) return false;
  brain.lastWhiffTick = system.currentTick;
  try { hunter.playAnimation("animation.humanoid.attack.rotations", { blendOutTime: 0.12 }); } catch { /* cosmetic */ }
  brain.lastSuccessfulAction = "swung a tick early on a strafe read";
  return true;
}

// ── bow ───────────────────────────────────────────────────────────────────────

function fireArrow(hunter, runner, brain, config, perception) {
  if (!bowReady(hunter)) return false;
  if (!perception.runnerVisible || perception.runnerDistance < 7 || perception.runnerDistance > 32) return false;
  if (system.currentTick - (brain.lastBowTick ?? -9999) < tv(config, "bowCooldown") - stageOf(brain) * 2) return false;
  const from = headOf(hunter);
  const target = aimPoint(runner, brain, config);
  if (!hasLineOfSight(hunter.dimension, from, target, 38)) return false;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const horiz = Math.max(0.01, Math.hypot(dx, dz));
  const speed = tv(config, "bowSpeed");
  const flightTime = horiz / speed;
  const velocity = {
    x: dx / horiz * speed,
    y: dy / Math.max(1, flightTime) * 0.55 + Math.min(0.38, horiz * 0.012),
    z: dz / horiz * speed
  };
  let arrow;
  try {
    arrow = hunter.dimension.spawnEntity("minecraft:arrow", from);
    const proj = arrow.getComponent("minecraft:projectile");
    if (!proj) { arrow.remove(); return false; }
    proj.owner = hunter;
    proj.shoot(velocity);
  } catch (err) {
    try { arrow?.remove(); } catch { /* ignore */ }
    brain.lastError = `bow: ${err}`;
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
  brain.lastSuccessfulAction = "fired a velocity-predicted bow shot";
  return true;
}

// ── main combat tick ──────────────────────────────────────────────────────────

export function tickCombat(hunter, runner, brain, config, perception) {
  perception.hunter = hunter;
  if (!perception.sameDimension) return "runner is in another dimension";

  const from = headOf(hunter);
  const target = aimPoint(runner, brain, config);
  const visible = perception.runnerVisible ||
    (perception.runnerDistance < 3.2 && hasLineOfSight(hunter.dimension, from, target, 8));

  if (!visible) {
    safeTrigger(hunter, "manhunt:chase");
    return "reacquiring line of sight";
  }

  // ── shield management ──
  const shielding = (brain.shieldUntilTick ?? 0) > system.currentTick;
  if (shielding) {
    // Feint: drop shield and swing immediately (higher tiers only).
    if (brain.feintTick && system.currentTick >= brain.feintTick) {
      lowerShield(hunter, brain);
      chooseMeleeWeapon(hunter, runner, perception);
      safeLookAt(hunter, target);
      brain.lastSuccessfulAction = "feinted shield drop into a swing";
      return "feinting shield drop";
    }
    safeLookAt(hunter, target);
    return "blocking with shield";
  }
  // Lower shield if it expired.
  if (brain.shieldUntilTick && brain.shieldUntilTick <= system.currentTick) {
    lowerShield(hunter, brain);
  }

  // ── raise shield? ──
  if (shouldRaiseShield(brain, config, perception)) {
    brain.lastShieldTick = system.currentTick;
    raiseShield(hunter, brain, config);
    safeLookAt(hunter, target);
    // Schedule a feint on higher tiers.
    if (Math.random() < tv(config, "feintChance")) {
      brain.feintTick = system.currentTick + 4 + Math.floor(Math.random() * 5);
    }
    return "raising shield";
  }

  // ── ranged ──
  if (fireArrow(hunter, runner, brain, config, perception)) return "firing bow";

  // ── melee ──
  chooseMeleeWeapon(hunter, runner, perception);
  safeTrigger(hunter, "manhunt:chase");
  safeLookAt(hunter, target);

  // Spacing rhythm (W-tap after hit).
  tickSpacingRhythm(hunter, runner, brain, config, perception);
  const inSpacingWindow = (brain.spacingUntilTick ?? 0) > system.currentTick;

  // Strafe during active melee.
  if (!inSpacingWindow && perception.runnerDistance <= 5) {
    updateStrafe(hunter, runner, brain, config, perception);
  }

  if (perception.runnerDistance > 4.2) return "sprinting into melee range";
  if (inSpacingWindow) return "spacing after hit";
  if (perception.runnerDistance < 1.1) return "backing up for swing room";

  tickWhiffSwing(hunter, brain, config, perception);

  // Natural critical (falling attack).
  const naturalCrit = !perception.onGround && perception.falling &&
    (perception.velocity?.y ?? 0) < -0.08 && !perception.inWater;
  if (naturalCrit) return "falling critical attack";

  if (perception.runnerHasShield && getAxeTier(hunter) > 0) return "pressuring shield with axe";
  return "timing weapon cooldown in melee range";
}

// ── hostile mob handling ──────────────────────────────────────────────────────

export function tickBlockingHostileCombat(hunter, brain, config, perception) {
  const hostile = perception?.nearbyHostile;
  if (!hostile || perception.nearbyHostileDistance > 3.2) return false;
  // Don't break off the runner chase unless the mob is the one dealing damage.
  if (perception.sameDimension && perception.runnerDistance < 7 &&
      brain.lastDamagerType !== hostile.typeId) return false;
  if (system.currentTick - (brain.lastHostileAttackTick ?? -9999) < tv(config, "hostileAttackCd")) return true;
  equipBestSword(hunter);
  safeLookAt(hunter, headOf(hostile));
  try {
    const tier = getSwordTier(hunter);
    const damage = tier >= 3 ? 6 : tier === 2 ? 5 : tier === 1 ? 4 : 2;
    hostile.applyDamage(damage, { cause: EntityDamageCause.EntityAttack, damagingEntity: hunter });
    brain.lastHostileAttackTick = system.currentTick;
    brain.lastSuccessfulAction = `cleared ${hostile.typeId.replace("minecraft:", "")}`;
    return true;
  } catch {
    return false;
  }
}

// ── event hooks ───────────────────────────────────────────────────────────────

export function onHunterDamaged(hunter, brain, config, cause = "unknown", damagerType = "unknown") {
  if (!brain) return;
  brain.lastDamagedTick = system.currentTick;
  brain.lastDamageCause = cause;
  brain.lastDamagerType = damagerType;
  if (!shieldReady(hunter)) return;
  if (system.currentTick - (brain.lastShieldTick ?? -9999) < tv(config, "shieldCooldown") / 2) return;
  brain.lastShieldTick = system.currentTick;
  raiseShield(hunter, brain, config);
}

export function onHunterHitRunner(brain) {
  if (!brain) return;
  brain.lastSuccessfulHitTick = system.currentTick;
  brain.lastAttackTick = system.currentTick;
}

export function combatStatus(brain) {
  return {
    lastAttackAgo:  Math.max(0, system.currentTick - (brain?.lastAttackTick  ?? -9999)),
    lastBowAgo:     Math.max(0, system.currentTick - (brain?.lastBowTick     ?? -9999)),
    shielding:      (brain?.shieldUntilTick ?? 0) > system.currentTick,
    lastDamager:    brain?.lastDamagerType ?? "none"
  };
}
