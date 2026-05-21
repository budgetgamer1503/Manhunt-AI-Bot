/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system } from "@minecraft/server";
import {
    getHunters, getTarget, getInventory, despawn,
    getEnableTaunts, getBoatHandling, getAILevel
} from "./entity_manager.js";
import { AIBrain } from "./ai/brain.js";

const brains = new Map();
let centralTickId = null;

function startTickingLoop() {
    if (centralTickId !== null) return;
    centralTickId = system.runInterval(() => {
        try {
            const hunters = getHunters();
            const target = getTarget();
            hunters.forEach((h, i) => {
                if (h.entity) {
                    const brain = brains.get(h.entity.id);
                    if (brain) {
                        let tickInterval = 4;
                        
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
                                        tickInterval = 40; // Extremely far: tick once every 2 seconds
                                    } else if (distSq > 48 * 48) {
                                        tickInterval = 20; // Far: tick once every 1 second
                                    } else if (distSq > 24 * 24) {
                                        tickInterval = 10; // Medium-far: tick once every 0.5 seconds
                                    } else if (distSq > 12 * 12) {
                                        tickInterval = 6;  // Medium-close: tick once every 0.3 seconds
                                    }
                                } else {
                                    tickInterval = 40; // Different dimension: tick rarely (every 2 seconds)
                                }
                            } catch (_) {}
                        }

                        const offset = i * 2;
                        if ((system.currentTick + offset) % tickInterval === 0) {
                            try { brain._tick(); } catch (_) {}
                        }
                    }
                }
            });
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
        if (!h.entity) continue;
        let brain = brains.get(h.entity.id);
        if (!brain) {
            brain = new AIBrain();
            brains.set(h.entity.id, brain);
        } else if (brain.state !== "idle") {
            brain.hunter = h.entity;
            brain.target = target;
            brain.inventory = h.inventory;
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