/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { world, system } from "@minecraft/server";
export const WIN_CONDITIONS = [
    { id: "infinite", name: "Infinite Respawns", description: "Hunter respawns forever — no win condition." },
    { id: "limited_lives", name: "Limited Lives", description: "Hunter has a set number of lives. Runner wins when all are exhausted." },
    { id: "time_limit", name: "Time Limit", description: "Runner must survive for a set duration. Runner wins when time expires." },
    { id: "kill_count", name: "Kill Count", description: "Runner must kill the hunter N times to win." }
];
const HUNT_STATE_PROP = "manhunt:hunt_state";
let huntState = {
    active: false,
    winCondition: "infinite",
    maxLives: 3,
    timeLimitMinutes: 30,
    killTarget: 3,
    hunterDeaths: 0,
    huntStartTick: 0,
    winner: null,
    endReason: ""
};
export function startHunt(config = {}) {
    huntState = {
        active: true,
        winCondition: config.winCondition || "infinite",
        maxLives: config.maxLives || 3,
        timeLimitMinutes: config.timeLimitMinutes || 30,
        killTarget: config.killTarget || 3,
        hunterDeaths: 0,
        huntStartTick: system.currentTick,
        winner: null,
        endReason: ""
    };
    saveHuntState();
}
export function endHunt(winner, reason) {
    huntState.active = false;
    huntState.winner = winner;
    huntState.endReason = reason;
    saveHuntState();
}
export function recordHunterDeath() {
    if (!huntState.active) return { huntOver: false, winner: null, reason: "" };
    huntState.hunterDeaths++;
    saveHuntState();
    if (huntState.winCondition === "limited_lives" && huntState.hunterDeaths >= huntState.maxLives) {
        endHunt("runner", `Hunter exhausted all ${huntState.maxLives} lives.`);
        return { huntOver: true, winner: "runner", reason: huntState.endReason };
    }
    if (huntState.winCondition === "kill_count" && huntState.hunterDeaths >= huntState.killTarget) {
        endHunt("runner", `Runner killed the hunter ${huntState.killTarget} times.`);
        return { huntOver: true, winner: "runner", reason: huntState.endReason };
    }
    return { huntOver: false, winner: null, reason: "" };
}
export function recordRunnerDeath(runnerName) {
    if (!huntState.active) return { huntOver: false, winner: null, reason: "" };
    endHunt("hunter", `${runnerName} was killed by the hunter.`);
    return { huntOver: true, winner: "hunter", reason: huntState.endReason };
}
export function checkTimeLimit() {
    if (!huntState.active) return { huntOver: false, winner: null, reason: "" };
    if (huntState.winCondition !== "time_limit") return { huntOver: false, winner: null, reason: "" };
    const elapsedTicks = system.currentTick - huntState.huntStartTick;
    const elapsedMinutes = elapsedTicks / 1200; 
    if (elapsedMinutes >= huntState.timeLimitMinutes) {
        endHunt("runner", `Runner survived for ${huntState.timeLimitMinutes} minutes.`);
        return { huntOver: true, winner: "runner", reason: huntState.endReason };
    }
    return { huntOver: false, winner: null, reason: "" };
}
export function getRemainingTimeMinutes() {
    if (huntState.winCondition !== "time_limit" || !huntState.active) return -1;
    const elapsedTicks = system.currentTick - huntState.huntStartTick;
    const elapsedMinutes = elapsedTicks / 1200;
    return Math.max(0, huntState.timeLimitMinutes - elapsedMinutes);
}
export function getRemainingLives() {
    if (huntState.winCondition !== "limited_lives" || !huntState.active) return -1;
    return Math.max(0, huntState.maxLives - huntState.hunterDeaths);
}
export function getRemainingKills() {
    if (huntState.winCondition !== "kill_count" || !huntState.active) return -1;
    return Math.max(0, huntState.killTarget - huntState.hunterDeaths);
}
export function isHuntActive() {
    return huntState.active;
}
export function getHuntState() {
    return { ...huntState };
}
export function getWinCondition() {
    return huntState.winCondition;
}
export function getHunterDeaths() {
    return huntState.hunterDeaths;
}
function saveHuntState() {
    try {
        world.setDynamicProperty(HUNT_STATE_PROP, JSON.stringify(huntState));
    } catch (_) { }
}
export function loadHuntState() {
    try {
        const raw = world.getDynamicProperty(HUNT_STATE_PROP);
        if (raw) {
            const parsed = JSON.parse(raw);
            huntState = { ...huntState, ...parsed };
        }
    } catch (_) { }
}