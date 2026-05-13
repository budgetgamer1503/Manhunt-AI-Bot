/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { world } from "@minecraft/server";
const DEBUG_PROP = "manhunt:debug_enabled";
export function isDebugEnabled() {
    try {
        return world.getDynamicProperty(DEBUG_PROP) === true;
    } catch (_) {
        return false;
    }
}
export function setDebugEnabled(enabled) {
    try {
        world.setDynamicProperty(DEBUG_PROP, !!enabled);
    } catch (_) { }
}
export function info(module, message, data = null) {
    const prefix = `[Manhunt:${module}]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}
export function debug(module, message, data = null) {
    if (!isDebugEnabled()) return;
    const prefix = `[Manhunt:${module}:DEBUG]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}
export function error(module, message, err = null) {
    const prefix = `[Manhunt:${module}:ERROR]`;
    if (err !== null) {
        console.error(`${prefix} ${message}`, err);
    } else {
        console.error(`${prefix} ${message}`);
    }
}
export function warn(module, message, data = null) {
    const prefix = `[Manhunt:${module}:WARN]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}