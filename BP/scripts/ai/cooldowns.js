/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system } from "@minecraft/server";

export class CooldownManager {
    constructor() {
        this._cooldowns = new Map();
    }

    set(name, ticks) {
        this._cooldowns.set(name, system.currentTick + ticks);
    }

    isReady(name) {
        const expiry = this._cooldowns.get(name);
        if (expiry === undefined) return true;
        return system.currentTick >= expiry;
    }

    remaining(name) {
        const expiry = this._cooldowns.get(name);
        if (expiry === undefined) return 0;
        return Math.max(0, expiry - system.currentTick);
    }

    tickAll() {
    }

    resetAll() {
        this._cooldowns.clear();
    }
}