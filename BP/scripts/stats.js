/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, world } from "@minecraft/server";
const STATS_PROP = "manhunt:hunt_stats";
let stats = {
    huntStartTick: 0,
    huntEndTick: 0,
    hunterDamageDealt: 0,
    hunterDamageTaken: 0,
    hunterBlocksTraveled: 0,
    hunterDeaths: 0,
    hunterItemsCrafted: 0,
    hunterBlocksMined: 0,
    runnerDeaths: 0,
    winner: null,
    endReason: ""
};
export function startStats() {
    stats = {
        huntStartTick: system.currentTick,
        huntEndTick: 0,
        hunterDamageDealt: 0,
        hunterDamageTaken: 0,
        hunterBlocksTraveled: 0,
        hunterDeaths: 0,
        hunterItemsCrafted: 0,
        hunterBlocksMined: 0,
        runnerDeaths: 0,
        winner: null,
        endReason: ""
    };
}
export function endStats(winner, reason) {
    stats.huntEndTick = system.currentTick;
    stats.winner = winner;
    stats.endReason = reason;
    saveStats();
}
export function recordDamageDealt(amount) {
    stats.hunterDamageDealt += amount;
}
export function recordDamageTaken(amount) {
    stats.hunterDamageTaken += amount;
}
export function recordBlocksTraveled(amount) {
    stats.hunterBlocksTraveled += amount;
}
export function recordHunterDeath() {
    stats.hunterDeaths++;
}
export function recordRunnerDeath() {
    stats.runnerDeaths++;
}
export function recordItemCrafted() {
    stats.hunterItemsCrafted++;
}
export function recordBlockMined() {
    stats.hunterBlocksMined++;
}
export function getStats() {
    return { ...stats };
}
export function getStatsSummary() {
    const durationTicks = (stats.huntEndTick || system.currentTick) - stats.huntStartTick;
    const durationMinutes = Math.floor(durationTicks / 1200);
    const durationSeconds = Math.floor((durationTicks % 1200) / 20);
    return [
        `§l§6=== HUNT STATS ===`,
        `§fDuration: §e${durationMinutes}m ${durationSeconds}s`,
        `§fHunter Damage Dealt: §c${stats.hunterDamageDealt.toFixed(1)}`,
        `§fHunter Damage Taken: §a${stats.hunterDamageTaken.toFixed(1)}`,
        `§fHunter Blocks Traveled: §b${Math.floor(stats.hunterBlocksTraveled)}`,
        `§fHunter Deaths: §c${stats.hunterDeaths}`,
        `§fRunner Deaths: §c${stats.runnerDeaths}`,
        `§fItems Crafted: §e${stats.hunterItemsCrafted}`,
        `§fBlocks Mined: §e${stats.hunterBlocksMined}`,
        `§fWinner: §6${stats.winner === "runner" ? "Runner" : stats.winner === "hunter" ? "Hunter" : "None"}`,
        `§fReason: §7${stats.endReason || "N/A"}`
    ].join("\n");
}
function saveStats() {
    try {
        world.setDynamicProperty(STATS_PROP, JSON.stringify(stats));
    } catch (_) { }
}
export function loadStats() {
    try {
        const raw = world.getDynamicProperty(STATS_PROP);
        if (raw) {
            const parsed = JSON.parse(raw);
            stats = { ...stats, ...parsed };
        }
    } catch (_) { }
}