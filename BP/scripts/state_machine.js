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
            hunters.forEach((h, i) => {
                if (h.entity) {
                    // Stagger ticking round-robin style (ticks every 2 ticks per brain)
                    if ((system.currentTick + i) % 2 === 0) {
                        const brain = brains.get(h.entity.id);
                        if (brain) {
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
            // Refresh references without wiping brain state
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
            true // tickExternally = true
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