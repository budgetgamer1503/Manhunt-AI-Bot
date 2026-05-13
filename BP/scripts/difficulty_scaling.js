/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Difficulty Scaling System (v0.7.0).
 * Progressively increases hunter difficulty based on time elapsed and hunter deaths.
 */

import { system } from "@minecraft/server";
import { AI_PROFILES } from "./ai/profiles.js";

/**
 * Scaling configuration.
 */
const SCALING_CONFIG = {
    // Time-based scaling: every N minutes, increase difficulty tier
    timeIntervalMinutes: 5,
    // Death-based scaling: each death makes hunter slightly more aggressive
    deathAggressionBoost: 0.05, // +5% per death to crit chance, jump attack chance
    deathCooldownReduction: 0.05, // -5% per death to cooldowns
    // Max scaling caps
    maxCritChance: 0.75,
    maxJumpAttackChance: 0.9,
    minCooldownMultiplier: 0.4
};

/**
 * Get the AI profile with difficulty scaling applied.
 * @param {string} baseLevel - "easy", "normal", or "expert"
 * @param {number} hunterDeaths - Number of times the hunter has died
 * @param {number} huntStartTick - Tick when the hunt started
 * @returns {object} Scaled AI profile
 */
export function getDifficultyScaledProfile(baseLevel, hunterDeaths = 0, huntStartTick = 0) {
    const base = AI_PROFILES[baseLevel] ?? AI_PROFILES.normal;
    const scaled = { ...base };

    // Time-based scaling
    if (huntStartTick > 0) {
        const elapsedTicks = system.currentTick - huntStartTick;
        const elapsedMinutes = elapsedTicks / 1200;
        const timeTiers = Math.floor(elapsedMinutes / SCALING_CONFIG.timeIntervalMinutes);

        if (timeTiers > 0) {
            // Each tier: reduce cooldowns, increase aggression
            const timeMultiplier = 1 - (timeTiers * 0.08);
            const cooldownMult = Math.max(SCALING_CONFIG.minCooldownMultiplier, timeMultiplier);

            scaled.cdCombo = Math.max(1, Math.floor(scaled.cdCombo * cooldownMult));
            scaled.cdJumpAttack = Math.max(3, Math.floor(scaled.cdJumpAttack * cooldownMult));
            scaled.cdStrafe = Math.max(2, Math.floor(scaled.cdStrafe * cooldownMult));
            scaled.cdSprintJump = Math.max(3, Math.floor(scaled.cdSprintJump * cooldownMult));
            scaled.cdCatchup = Math.max(10, Math.floor(scaled.cdCatchup * cooldownMult));
            scaled.cdMining = Math.max(3, Math.floor(scaled.cdMining * cooldownMult));
            scaled.cdParkour = Math.max(2, Math.floor(scaled.cdParkour * cooldownMult));
            scaled.cdPlace = Math.max(1, Math.floor(scaled.cdPlace * cooldownMult));
            scaled.cdShield = Math.max(4, Math.floor(scaled.cdShield * cooldownMult));
            scaled.cdEat = Math.max(3, Math.floor(scaled.cdEat * cooldownMult));

            scaled.critChance = Math.min(SCALING_CONFIG.maxCritChance, scaled.critChance + timeTiers * 0.03);
            scaled.jumpAttackChance = Math.min(SCALING_CONFIG.maxJumpAttackChance, scaled.jumpAttackChance + timeTiers * 0.04);
            scaled.shieldBlockChance = Math.min(0.9, scaled.shieldBlockChance + timeTiers * 0.02);

            // Reduce retreat threshold over time
            scaled.retreatHp = Math.max(1, scaled.retreatHp - timeTiers);
            scaled.retreatHealHp = Math.max(3, scaled.retreatHealHp - timeTiers * 2);
        }
    }

    // Death-based scaling
    if (hunterDeaths > 0) {
        scaled.critChance = Math.min(SCALING_CONFIG.maxCritChance,
            scaled.critChance + hunterDeaths * SCALING_CONFIG.deathAggressionBoost);
        scaled.jumpAttackChance = Math.min(SCALING_CONFIG.maxJumpAttackChance,
            scaled.jumpAttackChance + hunterDeaths * SCALING_CONFIG.deathAggressionBoost);

        const deathCooldownMult = Math.max(SCALING_CONFIG.minCooldownMultiplier,
            1 - hunterDeaths * SCALING_CONFIG.deathCooldownReduction);
        scaled.cdCombo = Math.max(1, Math.floor(scaled.cdCombo * deathCooldownMult));
        scaled.cdJumpAttack = Math.max(3, Math.floor(scaled.cdJumpAttack * deathCooldownMult));
        scaled.cdStrafe = Math.max(2, Math.floor(scaled.cdStrafe * deathCooldownMult));
    }

    return scaled;
}

/**
 * Get a human-readable description of current scaling.
 */
export function getScalingDescription(baseLevel, hunterDeaths, huntStartTick) {
    if (huntStartTick <= 0) return "No scaling active";

    const elapsedTicks = system.currentTick - huntStartTick;
    const elapsedMinutes = Math.floor(elapsedTicks / 1200);
    const timeTiers = Math.floor(elapsedMinutes / SCALING_CONFIG.timeIntervalMinutes);

    const parts = [];
    if (timeTiers > 0) {
        parts.push(`Time Tier ${timeTiers} (${elapsedMinutes}m elapsed)`);
    }
    if (hunterDeaths > 0) {
        parts.push(`${hunterDeaths} death${hunterDeaths > 1 ? 's' : ''}`);
    }

    return parts.length > 0 ? parts.join(", ") : "No scaling active";
}