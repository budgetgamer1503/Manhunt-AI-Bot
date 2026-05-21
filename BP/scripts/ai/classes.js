/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

export const HUNTER_CLASSES = {
    default: {
        id: "default",
        name: "Default Hunter",
        kit: "balanced_hunter",
        speedModifier: 0.0,
        modifyProfile(baseProfile) {
            return { ...baseProfile };
        }
    },
    knight: {
        id: "knight",
        name: "Knight (Melee Tank)",
        kit: "knight_starter",
        speedModifier: -0.02,
        modifyProfile(baseProfile) {
            return {
                ...baseProfile,
                attackRange: baseProfile.attackRange + 0.1,
                comboRange: baseProfile.comboRange + 0.2,
                shieldBlockChance: Math.min(0.95, baseProfile.shieldBlockChance + 0.25),
                cdShield: Math.max(8, Math.floor(baseProfile.cdShield * 0.7)),
                critChance: baseProfile.critChance + 0.1,
                critMultiplier: baseProfile.critMultiplier + 0.15
            };
        }
    },
    archer: {
        id: "archer",
        name: "Archer (Ranged Support)",
        kit: "archer_starter",
        speedModifier: 0.05,
        modifyProfile(baseProfile) {
            return {
                ...baseProfile,
                attackRange: 16.0, // Long-range combat target
                comboRange: 3.0,
                strafeRange: 12.0, // High-range strafing
                shieldBlockChance: Math.max(0.1, baseProfile.shieldBlockChance - 0.2),
                critChance: baseProfile.critChance - 0.1,
                retreatHp: baseProfile.retreatHp + 2 // Retreats sooner if caught
            };
        }
    },
    saboteur: {
        id: "saboteur",
        name: "Saboteur (Tactician)",
        kit: "saboteur_starter",
        speedModifier: 0.02, // Tactical agility
        modifyProfile(baseProfile) {
            return {
                ...baseProfile,
                lavaPourRange: baseProfile.lavaPourRange + 1.5,
                cdPlace: Math.max(1, Math.floor(baseProfile.cdPlace * 0.65)), // Faster placing of cobwebs/fire
                prepGatherRadius: baseProfile.prepGatherRadius + 1 // Smarter prep searches
            };
        }
    }
};

export function getClass(classId) {
    return HUNTER_CLASSES[classId] ?? HUNTER_CLASSES.default;
}

export function getClassProfile(classId, baseProfile) {
    const classData = getClass(classId);
    return classData.modifyProfile(baseProfile);
}
