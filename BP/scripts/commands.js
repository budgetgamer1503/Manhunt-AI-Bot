/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Chat Commands System (v0.7.0).
 * Provides /manhunt commands for managing the hunt via chat.
 */

import { world, system } from "@minecraft/server";
import { isDebugEnabled, setDebugEnabled } from "./logger.js";
import {
    getHunter, getTarget, isActive, isRespawning, getDeathCount,
    getAILevel, despawn, getCurrentConfigSnapshot
} from "./entity_manager.js";
import { getAIState, stopAI } from "./state_machine.js";
import { getHuntState, getRemainingTimeMinutes, getRemainingLives, getRemainingKills } from "./win_conditions.js";
import { getStats, getStatsSummary } from "./stats.js";
import { getScalingDescription } from "./difficulty_scaling.js";

/**
 * Register the /manhunt command prefix handler.
 * Call this once during world initialization.
 */
export function registerCommands() {
    world.beforeEvents.chatSend.subscribe((event) => {
        const message = event.message.trim();
        if (!message.startsWith("/manhunt") && !message.startsWith("!manhunt")) return;

        event.cancel = true;

        const player = event.sender;
        const args = message.split(/\s+/);
        const subcommand = args[1]?.toLowerCase() || "help";

        system.run(() => {
            handleCommand(player, subcommand, args.slice(2));
        });
    });
}

function handleCommand(player, subcommand, args) {
    switch (subcommand) {
        case "help":
            showHelp(player);
            break;
        case "status":
            showStatus(player);
            break;
        case "stats":
            showStats(player);
            break;
        case "debug":
            toggleDebug(player);
            break;
        case "despawn":
            handleDespawn(player);
            break;
        case "info":
            showInfo(player);
            break;
        default:
            player.sendMessage(`§cUnknown subcommand: §7${subcommand}. Use §e/manhunt help §7for available commands.`);
            break;
    }
}

function showHelp(player) {
    player.sendMessage([
        `§l§6=== MANHUNT BOT COMMANDS ===`,
        `§e/manhunt help §7- Show this help`,
        `§e/manhunt status §7- Show current hunt status`,
        `§e/manhunt stats §7- Show hunt statistics`,
        `§e/manhunt info §7- Show hunter configuration`,
        `§e/manhunt debug §7- Toggle debug logging`,
        `§e/manhunt despawn §7- Despawn the active hunter`
    ].join("\n"));
}

function showStatus(player) {
    const huntState = getHuntState();
    const hunter = getHunter();
    const target = getTarget();

    const lines = [
        `§l§6=== HUNT STATUS ===`,
        `§fActive: ${huntState.active ? "§aYes" : "§cNo"}`,
        `§fAI State: §b${getAIState()}`,
        `§fAI Level: §6${getAILevel()}`,
        `§fHunter: ${hunter ? "§aAlive" : "§cDead/None"}`,
        `§fTarget: ${target ? `§e${target.name}` : "§7None"}`,
        `§fRespawning: ${isRespawning() ? "§eYes" : "§7No"}`,
        `§fDeaths: §c${getDeathCount()}`,
        `§fWin Condition: §6${huntState.winCondition}`,
    ];

    if (huntState.winCondition === "time_limit") {
        const remaining = getRemainingTimeMinutes();
        lines.push(`§fTime Remaining: §e${remaining.toFixed(1)}m`);
    } else if (huntState.winCondition === "limited_lives") {
        const remaining = getRemainingLives();
        lines.push(`§fLives Remaining: §c${remaining}`);
    } else if (huntState.winCondition === "kill_count") {
        const remaining = getRemainingKills();
        lines.push(`§fKills Needed: §c${remaining}`);
    }

    lines.push(`§fScaling: §7${getScalingDescription(getAILevel(), getDeathCount(), huntState.huntStartTick)}`);

    player.sendMessage(lines.join("\n"));
}

function showStats(player) {
    player.sendMessage(getStatsSummary());
}

function toggleDebug(player) {
    const enabled = !isDebugEnabled();
    setDebugEnabled(enabled);
    player.sendMessage(`§eDebug logging: ${enabled ? "§aEnabled" : "§cDisabled"}`);
}

function handleDespawn(player) {
    if (!isActive() && !isRespawning()) {
        player.sendMessage("§7No active hunter to despawn.");
        return;
    }

    stopAI();
    despawn(true);
    player.sendMessage("§7The hunter has been despawned.");
}

function showInfo(player) {
    const config = getCurrentConfigSnapshot();
    const hunter = getHunter();

    player.sendMessage([
        `§l§6=== HUNTER INFO ===`,
        `§fName: §e${config.name}`,
        `§fSkin: §b${config.skinId}`,
        `§fAI Level: §6${config.aiLevel}`,
        `§fInventory Mode: §b${config.inventoryMode}`,
        `§fTaunts: ${config.enableTaunts ? "§aOn" : "§cOff"}`,
        `§fBoat Handling: ${config.boatHandling === "destroy" ? "§cDestroy" : "§7Ignore"}`,
        `§fEquipment: ${config.equipmentPersistence ? "§aKeep" : "§cDrop"}`,
        `§fPrep Behavior: §b${config.prepBehavior}`,
        `§fLocation: ${hunter ? `§a${hunter.dimension.id.replace("minecraft:", "")} @ ${Math.floor(hunter.location.x)} ${Math.floor(hunter.location.y)} ${Math.floor(hunter.location.z)}` : "§7None"}`
    ].join("\n"));
}