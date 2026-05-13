/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system } from "@minecraft/server";
import {
    getHunter, getTarget, getInventory, despawn,
    getEnableTaunts, getBoatHandling, getAILevel
} from "./entity_manager.js";
import { AIBrain } from "./ai/brain.js";

const brain = new AIBrain();

export function getAIState() {
    return brain.state;
}

export function startAI() {
    const hunter = getHunter();
    const target = getTarget();
    const inventory = getInventory();
    if (!hunter || !target) return;

    brain.start(
        hunter,
        target,
        inventory,
        getAILevel(),
        getEnableTaunts(),
        getBoatHandling()
    );
}

export function stopAI() {
    brain.stop();
}

export function forceChaseMode() {
    brain.forceChase();
}

export function triggerAttack(hunter) {
    brain.combat._triggerAttack(hunter);
}

export function rollCrit(hunter) {
    return brain.combat.rollCrit(hunter);
}

export function handleDamage(hunter, inventory, cause, attacker) {
    brain.combat.handleDamage(hunter, cause, attacker);
}