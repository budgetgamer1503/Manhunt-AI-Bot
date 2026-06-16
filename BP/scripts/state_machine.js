/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system } from "@minecraft/server";
import {
    getHunters, getTarget,
    getEnableTaunts, getBoatHandling, getAILevel
} from "./entity_manager.js";
import { AIBrain } from "./ai/brain.js";

const brains = new Map();
let centralTickId = null;
const AI_TICK_INTERVALS = {
    differentDimension: 40,
    extremelyFar: 40,
    far: 20,
    mediumFar: 10,
    mediumClose: 6,
    close: 4
};

function isEntityUsable(entity) {
    if (!entity) return false;
    try {
        const _ = entity.location;
        return true;
    } catch (_) {
        return false;
    }
}

function bindBrainToHunter(brain, hunterData, target) {
    brain.hunter = hunterData.entity;
    brain.target = target;
    brain.inventory = hunterData.inventory;
    brain.aiLevel = hunterData.aiLevel || getAILevel();
    brain.enableTaunts = hunterData.enableTaunts !== undefined ? hunterData.enableTaunts : getEnableTaunts();
    brain.boatHandling = hunterData.boatHandling || getBoatHandling();
    brain.classId = hunterData.classId || "default";
}

function startBrainForHunter(hunterData, target) {
    const brain = new AIBrain();
    brains.set(hunterData.entity.id, brain);
    brain.start(
        hunterData.entity,
        target,
        hunterData.inventory,
        hunterData.aiLevel || getAILevel(),
        hunterData.enableTaunts !== undefined ? hunterData.enableTaunts : getEnableTaunts(),
        hunterData.boatHandling || getBoatHandling(),
        hunterData.classId || "default",
        true
    );
    return brain;
}

function pruneStaleBrains(activeEntityIds) {
    for (const [entityId, brain] of brains) {
        if (activeEntityIds.has(entityId)) continue;
        try { brain.stop(); } catch (_) {}
        brains.delete(entityId);
    }
}

function startTickingLoop() {
    if (centralTickId !== null) return;
    centralTickId = system.runInterval(() => {
        try {
            const hunters = getHunters();
            const target = getTarget();
            const activeEntityIds = new Set();
            hunters.forEach((h, i) => {
                if (!isEntityUsable(h.entity)) return;
                activeEntityIds.add(h.entity.id);

                let brain = brains.get(h.entity.id);
                if (!brain && target) {
                    brain = startBrainForHunter(h, target);
                } else if (brain && target) {
                    bindBrainToHunter(brain, h, target);
                }

                if (!brain) return;

                let tickInterval = AI_TICK_INTERVALS.close;

                if (target) {
                    try {
                        if (h.entity.dimension.id === target.dimension.id) {
                            const hLoc = h.entity.location;
                            const tLoc = target.location;
                            const dx = tLoc.x - hLoc.x;
                            const dy = tLoc.y - hLoc.y;
                            const dz = tLoc.z - hLoc.z;
                            const distSq = dx * dx + dy * dy + dz * dz;

                            if (distSq > 96 * 96) {
                                tickInterval = AI_TICK_INTERVALS.extremelyFar;
                            } else if (distSq > 48 * 48) {
                                tickInterval = AI_TICK_INTERVALS.far;
                            } else if (distSq > 24 * 24) {
                                tickInterval = AI_TICK_INTERVALS.mediumFar;
                            } else if (distSq > 12 * 12) {
                                tickInterval = AI_TICK_INTERVALS.mediumClose;
                            }
                        } else {
                            tickInterval = AI_TICK_INTERVALS.differentDimension;
                        }
                    } catch (_) {}
                }

                const offset = i * 2;
                if ((system.currentTick + offset) % tickInterval === 0) {
                    try { brain._tick(); } catch (_) {}
                }
            });
            pruneStaleBrains(activeEntityIds);
        } catch (_) {}
    }, 1);
}

function stopTickingLoop() {
    if (centralTickId !== null) {
        system.clearRun(centralTickId);
        centralTickId = null;
    }
}

export function getAIState(hunter) {
    if (!hunter) {
        for (const brain of brains.values()) {
            return brain.state;
        }
        return "idle";
    }
    return brains.get(hunter.id)?.state ?? "idle";
}

export function startAI() {
    const hunters = getHunters();
    const target = getTarget();
    if (hunters.length === 0 || !target) return;

    for (const h of hunters) {
        if (!isEntityUsable(h.entity)) continue;
        let brain = brains.get(h.entity.id);
        if (!brain) {
            startBrainForHunter(h, target);
            continue;
        } else if (brain.state !== "idle") {
            bindBrainToHunter(brain, h, target);
            continue;
        }
        brain.start(
            h.entity,
            target,
            h.inventory,
            h.aiLevel || getAILevel(),
            h.enableTaunts !== undefined ? h.enableTaunts : getEnableTaunts(),
            h.boatHandling || getBoatHandling(),
            h.classId || "default",
            true
        );
    }
    startTickingLoop();
}

export function stopAI() {
    stopTickingLoop();
    for (const brain of brains.values()) {
        try { brain.stop(); } catch (_) {}
    }
    brains.clear();
}

export function stopHunterAI(hunter) {
    if (!hunter) return;
    const brain = brains.get(hunter.id);
    if (brain) {
        try { brain.stop(); } catch (_) {}
        brains.delete(hunter.id);
    }
    if (brains.size === 0) {
        stopTickingLoop();
    }
}

export function forceChaseMode() {
    for (const brain of brains.values()) {
        try { brain.forceChase(); } catch (_) {}
    }
}

export function triggerAttack(hunter) {
    if (!hunter) return;
    brains.get(hunter.id)?.combat._triggerAttack(hunter);
}

export function rollCrit(hunter) {
    if (!hunter) return { isCrit: false, multiplier: 1.0 };
    return brains.get(hunter.id)?.combat.rollCrit(hunter) ?? { isCrit: false, multiplier: 1.0 };
}

export function handleDamage(hunter, inventory, cause, attacker) {
    if (!hunter) return;
    brains.get(hunter.id)?.combat.handleDamage(hunter, cause, attacker);
}
