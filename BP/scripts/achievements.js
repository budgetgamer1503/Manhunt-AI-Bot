/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { world, system } from "@minecraft/server";

const ACHIEVEMENTS_PROP = "manhunt:achievements";

export const ACHIEVEMENTS = [
    { id: "escape", name: "The Great Escape", description: "Survive a hunt on Expert difficulty with less than 2 hearts remaining." },
    { id: "squad_slayer", name: "Squad Slayer", description: "Defeat a Duo, Trio, or Quad squad of hunters." },
    { id: "sniper_avoided", name: "Sniper Avoided", description: "Dodge 10 archer arrow shots in a single hunt." },
    { id: "untouchable", name: "Untouchable", description: "Complete a 10-minute hunt without taking any damage from the hunters." },
    { id: "bed_breaker", name: "Bed Breaker", description: "Find and destroy a hunter's bed." }
];

let currentHuntProgress = {
    arrowDodges: 0,
    tookDamage: false,
    startTick: 0
};

export function resetHuntProgress() {
    currentHuntProgress = {
        arrowDodges: 0,
        tookDamage: false,
        startTick: system.currentTick
    };
}

export function recordHunterDamageTaken() {
    currentHuntProgress.tookDamage = true;
}

export function incrementArrowDodge(player) {
    currentHuntProgress.arrowDodges++;
    if (currentHuntProgress.arrowDodges >= 10) {
        unlockAchievement(player, "sniper_avoided");
    }
}

export function getUnlockedAchievements(player) {
    if (!player) return [];
    try {
        const raw = player.getDynamicProperty(ACHIEVEMENTS_PROP);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (_) {}
    return [];
}

export function unlockAchievement(player, achievementId) {
    if (!player) return;
    const unlocked = getUnlockedAchievements(player);
    if (unlocked.includes(achievementId)) return;

    unlocked.push(achievementId);
    try {
        player.setDynamicProperty(ACHIEVEMENTS_PROP, JSON.stringify(unlocked));
    } catch (_) {}

    const ach = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (ach) {
        try {
            player.sendMessage(`§6§l🏆 ACHIEVEMENT UNLOCKED! §r§e${ach.name} §7- ${ach.description}`);
            player.onScreenDisplay.setTitle("§6§l🏆 UNLOCKED! §r", {
                fadeInDuration: 5, fadeOutDuration: 20, stayDuration: 40,
                subtitle: `§e${ach.name}`
            });
            player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 0.6 });
        } catch (_) {}
    }
}

export function checkEndOfHuntAchievements(player, winner, squadSize, difficulty) {
    if (!player) return;
    
    const elapsedMinutes = (system.currentTick - currentHuntProgress.startTick) / 1200;

    if (winner === "runner") {
        if (squadSize >= 2) {
            unlockAchievement(player, "squad_slayer");
        }

        const health = player.getComponent("minecraft:health")?.currentValue;
        if (difficulty === "expert" && health !== undefined && health < 4) {
            unlockAchievement(player, "escape");
        }

        if (!currentHuntProgress.tookDamage && elapsedMinutes >= 10) {
            unlockAchievement(player, "untouchable");
        }
    }
}

world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const block = event.block;
    if (block && block.typeId.includes("bed")) {
        const player = event.player;
        if (player) {
            unlockAchievement(player, "bed_breaker");
        }
    }
});

world.afterEvents.projectileHitBlock.subscribe((event) => {
    const projectile = event.projectile;
    if (projectile && projectile.typeId === "minecraft:arrow") {
        const owner = projectile.getComponent("minecraft:projectile")?.owner;
        const finalOwner = owner || event.source;
        if (finalOwner && finalOwner.typeId === "manhunt:hunter") {
            const hitLoc = event.location;
            const players = world.getAllPlayers();
            for (const p of players) {
                try {
                    const pLoc = p.location;
                    const dx = pLoc.x - hitLoc.x;
                    const dy = pLoc.y - hitLoc.y;
                    const dz = pLoc.z - hitLoc.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < 4.5) {
                        incrementArrowDodge(p);
                    }
                } catch (_) {}
            }
        }
    }
});
