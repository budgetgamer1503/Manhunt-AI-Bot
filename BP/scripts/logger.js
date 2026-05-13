/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Centralized debug logger for the Manhunt Bot.
 * All modules should use this instead of console.warn/console.error directly.
 * Controlled via the `manhunt:debug_enabled` world dynamic property.
 */

import { world } from "@minecraft/server";

const DEBUG_PROP = "manhunt:debug_enabled";

/**
 * Check if debug mode is enabled globally.
 */
export function isDebugEnabled() {
    try {
        return world.getDynamicProperty(DEBUG_PROP) === true;
    } catch (_) {
        return false;
    }
}

/**
 * Enable or disable debug logging globally.
 */
export function setDebugEnabled(enabled) {
    try {
        world.setDynamicProperty(DEBUG_PROP, !!enabled);
    } catch (_) { }
}

/**
 * Log an informational message (always shown).
 */
export function info(module, message, data = null) {
    const prefix = `[Manhunt:${module}]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}

/**
 * Log a debug message (only shown when debug is enabled).
 */
export function debug(module, message, data = null) {
    if (!isDebugEnabled()) return;
    const prefix = `[Manhunt:${module}:DEBUG]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}

/**
 * Log an error message (always shown).
 */
export function error(module, message, err = null) {
    const prefix = `[Manhunt:${module}:ERROR]`;
    if (err !== null) {
        console.error(`${prefix} ${message}`, err);
    } else {
        console.error(`${prefix} ${message}`);
    }
}

/**
 * Log a warning message (always shown).
 */
export function warn(module, message, data = null) {
    const prefix = `[Manhunt:${module}:WARN]`;
    if (data !== null) {
        console.warn(`${prefix} ${message}`, data);
    } else {
        console.warn(`${prefix} ${message}`);
    }
}