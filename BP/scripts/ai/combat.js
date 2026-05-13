/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Combat behaviors for the hunter AI.
 * Extracted from state_machine.js for v0.7.0 modular refactor.
 */

import { system, BlockPermutation } from "@minecraft/server";
import { getProfile } from "./profiles.js";
import { getInventory } from "../entity_manager.js";

/**
 * Trigger the attack animation on the hunter.
 */
export function triggerAttack(hunter, cdAttackAnim) {
    if (cdAttackAnim > 0) return;
    try {
        hunter.triggerEvent("manhunt:set_action_attacking");
        const profile = getProfile();
        const animCd = profile.cdAttackAnim;
        system.runTimeout(() => {
            try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
        }, 8);
        return animCd;
    } catch (_) { }
    return 0;
}

/**
 * Roll for a critical hit based on velocity and profile crit chance.
 */
export function rollCrit(hunter) {
    const profile = getProfile();
    try {
        const vel = hunter.getVelocity();
        if (vel.y < -0.08 || Math.random() < profile.critChance) {
            return { isCrit: true, multiplier: profile.critMultiplier };
        }
    } catch (_) { }
    return { isCrit: false, multiplier: 1.0 };
}

/**
 * Perform a strafe movement around the target.
 */
export function doStrafe(hunter, target, dist, strafeDir) {
    try {
        const vel = hunter.getVelocity();
        if (Math.abs(vel.y) > 0.05) return strafeDir;

        const hPos = hunter.location;
        const tPos = target.location;
        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;

        let dir = strafeDir;
        if (Math.random() < 0.15) dir *= -1;

        const perpX = -dz / dist * dir;
        const perpZ = dx / dist * dir;

        const fwdX = (dx / dist) * 0.1;
        const fwdZ = (dz / dist) * 0.1;

        const dim = hunter.dimension;
        const checkX = Math.floor(hPos.x + perpX * 1.5);
        const checkZ = Math.floor(hPos.z + perpZ * 1.5);
        const checkY = Math.floor(hPos.y) - 1;

        const blockBelow = dim.getBlock({ x: checkX, y: checkY, z: checkZ });
        const blockAt = dim.getBlock({ x: checkX, y: checkY + 1, z: checkZ });

        if (!blockBelow || blockBelow.typeId === "minecraft:air" ||
            blockBelow.typeId === "minecraft:water" || blockBelow.typeId === "minecraft:lava") {
            return dir;
        }

        if (blockAt && blockAt.typeId !== "minecraft:air" &&
            blockAt.typeId !== "minecraft:tall_grass" && blockAt.typeId !== "minecraft:short_grass") {
            return dir;
        }

        hunter.applyImpulse({ x: perpX * 0.12 + fwdX, y: 0, z: perpZ * 0.12 + fwdZ });
        return dir;
    } catch (_) { }
    return strafeDir;
}

/**
 * Perform a jump attack toward the target.
 */
export function doJumpAttack(hunter, target, dist) {
    try {
        const hPos = hunter.location;
        const tPos = target.location;
        const vel = hunter.getVelocity();

        if (vel.y > 0.05 || vel.y < -0.3) return false;

        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const nx = dx / dist;
        const nz = dz / dist;

        hunter.applyImpulse({ x: nx * 0.45, y: 0.45, z: nz * 0.45 });
        return true;
    } catch (_) { }
    return false;
}

/**
 * Perform a sprint jump toward the target.
 */
export function doSprintJump(hunter, target) {
    try {
        const hPos = hunter.location;
        const tPos = target.location;
        const vel = hunter.getVelocity();

        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (vel.y > 0.05 || vel.y < -0.1) return false;
        if (Math.sqrt(vel.x ** 2 + vel.z ** 2) < 0.1) return false;

        const nx = dx / dist;
        const nz = dz / dist;

        hunter.applyImpulse({ x: nx * 0.15, y: 0.38, z: nz * 0.15 });
        return true;
    } catch (_) { }
    return false;
}

/**
 * Try to pour lava on the target.
 */
export function tryPourLava(hunter, target, inventory) {
    if (!inventory.hasItem("minecraft:lava_bucket")) return;
    try {
        const tPos = target.location;
        const lavaPos = { x: Math.floor(tPos.x), y: Math.floor(tPos.y), z: Math.floor(tPos.z) };
        const block = hunter.dimension.getBlock(lavaPos);
        if (block?.typeId === "minecraft:air") {
            inventory.showItemInHand(hunter, "minecraft:lava_bucket", "placing", 15);
            block.setPermutation(BlockPermutation.resolve("minecraft:lava"));
            inventory.removeItem("minecraft:lava_bucket", 1);
            inventory.addItem("minecraft:bucket", 1);
            return {
                pos: { ...lavaPos },
                removeTick: system.currentTick + 60
            };
        }
    } catch (_) { }
    return null;
}

/**
 * Try to eat food to heal.
 */
export function tryEat(hunter, inventory, eatBelowHp) {
    if (inventory.isTempEquipActive()) return false;
    try {
        const hp = hunter.getComponent("minecraft:health");
        if (!hp || hp.currentValue >= eatBelowHp) return false;

        const food = inventory.getBestFood();
        if (!food) return false;

        inventory.showItemInHand(hunter, food, "eating", 32);

        system.runTimeout(() => {
            try {
                const hunger = inventory.getFoodHunger(food);
                inventory.removeItem(food, 1);
                const h = hunter.getComponent("minecraft:health");
                if (h) {
                    const heal = Math.min(hunger, h.effectiveMax - h.currentValue);
                    if (heal > 0) h.setCurrentValue(h.currentValue + heal);
                }
            } catch (_) { }
        }, 32);

        return true;
    } catch (_) { }
    return false;
}

/**
 * Equip shield in offhand for a duration.
 */
export function equipShield(hunter, duration = 20) {
    const inventory = getInventory();
    if (!inventory || !inventory.hasShield()) return null;

    try {
        hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 minecraft:shield 1`);

        const timerId = system.runTimeout(() => {
            try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
        }, duration);

        return timerId;
    } catch (_) { }
    return null;
}

/**
 * Clear the shield from the hunter's offhand.
 */
export function clearShield(hunter, shieldTimerId) {
    if (shieldTimerId !== null) {
        try { system.clearRun(shieldTimerId); } catch (_) { }
    }
    if (hunter) {
        try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
    }
}

/**
 * Handle damage taken by the hunter — equip shield if available.
 */
export function handleDamage(hunter, inventory, cause, shieldBlockChance, shieldActive) {
    if (shieldActive && inventory.hasShield() && Math.random() < shieldBlockChance) {
        try {
            const hp = hunter.getComponent("minecraft:health");
            if (hp) {
                const heal = Math.min(2, hp.effectiveMax - hp.currentValue);
                if (heal > 0) hp.setCurrentValue(hp.currentValue + heal);
            }
        } catch (_) { }
        return { shouldEquipShield: false };
    }

    if (inventory.isTempEquipActive()) {
        inventory.finishTempEquip(hunter);
    }
    inventory.equipWeapon(hunter);

    const shouldEquip = (cause === "projectile" || cause === "entityAttack") && inventory.hasShield();
    return { shouldEquipShield: shouldEquip };
}

/**
 * Get the closest combat target (could be a different player within 8 blocks).
 */
export function getCombatTarget(hunter, primaryTarget) {
    try {
        const { world } = require("@minecraft/server");
        const players = world.getAllPlayers();
        const hunterPos = hunter.location;
        let closest = primaryTarget;
        let closestDist = distance2D(hunterPos, primaryTarget.location);

        for (const player of players) {
            if (player.id === primaryTarget.id) continue;
            if (player.dimension.id !== hunter.dimension.id) continue;

            const dist = distance2D(hunterPos, player.location);
            if (dist <= 8 && dist < closestDist + 1) {
                closest = player;
                closestDist = dist;
            }
        }

        return closest;
    } catch (_) { }
    return primaryTarget;
}

export function distance2D(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}