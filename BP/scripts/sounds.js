/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Sound System (v0.7.0).
 * Provides audio feedback for hunter actions using vanilla Minecraft sounds.
 */

import { system, world } from "@minecraft/server";

/**
 * Play a footstep sound based on the block the hunter is standing on.
 */
export function playFootstep(hunter) {
    try {
        const pos = hunter.location;
        const dim = hunter.dimension;
        const blockBelow = dim.getBlock({
            x: Math.floor(pos.x),
            y: Math.floor(pos.y) - 1,
            z: Math.floor(pos.z)
        });

        let sound = "step.stone";
        if (blockBelow) {
            const typeId = blockBelow.typeId;
            if (typeId.includes("grass") || typeId.includes("dirt")) sound = "step.grass";
            else if (typeId.includes("sand") || typeId.includes("gravel")) sound = "step.sand";
            else if (typeId.includes("wood") || typeId.includes("log") || typeId.includes("plank")) sound = "step.wood";
            else if (typeId.includes("stone") || typeId.includes("cobble")) sound = "step.stone";
            else if (typeId.includes("wool") || typeId.includes("carpet")) sound = "step.cloth";
            else if (typeId.includes("snow")) sound = "step.snow";
            else if (typeId.includes("ice")) sound = "step.stone";
        }

        dim.playSound(sound, pos, { volume: 0.3, pitch: 0.9 + Math.random() * 0.2 });
    } catch (_) { }
}

/**
 * Play a proximity heartbeat sound when the hunter is close to the target.
 */
export function playProximityHeartbeat(target, distance) {
    if (distance > 30) return;
    try {
        const volume = Math.max(0.1, 1.0 - (distance / 30));
        const pitch = 0.8 + (1.0 - distance / 30) * 0.4;
        target.playSound("random.orb", { volume, pitch });
    } catch (_) { }
}

/**
 * Play the hunter's attack sound.
 */
export function playAttackSound(hunter) {
    try {
        hunter.dimension.playSound("mob.player.attack", hunter.location, { volume: 0.6, pitch: 1.0 });
    } catch (_) { }
}

/**
 * Play the hunter's death sound.
 */
export function playDeathSound(dimension, location) {
    try {
        dimension.playSound("mob.player.death", location, { volume: 0.8, pitch: 1.0 });
    } catch (_) { }
}

/**
 * Play the hunter's respawn sound (thunder).
 */
export function playRespawnSound(dimension, location) {
    try {
        dimension.playSound("ambient.weather.thunder", location, { volume: 0.7, pitch: 0.8 });
    } catch (_) { }
}

/**
 * Play a taunt sound.
 */
export function playTauntSound(target) {
    try {
        target.playSound("random.orb", { volume: 0.4, pitch: 1.5 });
    } catch (_) { }
}

/**
 * Play the hunt start sound.
 */
export function playHuntStartSound(player) {
    try {
        player.playSound("mob.enderdragon.growl", { volume: 0.6, pitch: 0.5 });
    } catch (_) { }
}

/**
 * Play the hunt end sound (victory or defeat).
 */
export function playHuntEndSound(player, winner) {
    try {
        if (winner === "runner") {
            player.playSound("random.levelup", { volume: 0.8, pitch: 1.0 });
        } else {
            player.playSound("mob.enderdragon.death", { volume: 0.7, pitch: 0.6 });
        }
    } catch (_) { }
}

/**
 * Play the countdown tick sound.
 */
export function playCountdownSound(player) {
    try {
        player.playSound("random.click", { volume: 0.8, pitch: 1.2 });
    } catch (_) { }
}

/**
 * Play a block place sound.
 */
export function playBlockPlaceSound(hunter) {
    try {
        hunter.dimension.playSound("dig.stone", hunter.location, { volume: 0.4, pitch: 0.8 });
    } catch (_) { }
}

/**
 * Play a block break sound.
 */
export function playBlockBreakSound(hunter) {
    try {
        hunter.dimension.playSound("dig.stone", hunter.location, { volume: 0.5, pitch: 1.2 });
    } catch (_) { }
}

/**
 * Play an eating sound.
 */
export function playEatSound(hunter) {
    try {
        hunter.dimension.playSound("random.eat", hunter.location, { volume: 0.5, pitch: 1.0 });
    } catch (_) { }
}