/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, BlockPermutation, world } from "@minecraft/server";
import { getProfile, randomTaunt } from "./profiles.js";
import { getEnableTaunts } from "../entity_manager.js";

const CLOSE_RANGE = 4;
const MID_RANGE = 12;
const STRAFE_STEP_STRENGTH = 0.24;
const STRAFE_STEP_COUNT_MIN = 5;
const STRAFE_STEP_COUNT_MAX = 9;
const STRAFE_STEP_INTERVAL = 3;
const CIRCLE_STRAFE_STRENGTH = 0.18;
const W_TAP_CHANCE = 0.3;
const W_TAP_FORWARD_STRENGTH = 0.4;
const W_TAP_COOLDOWN = 40;
const SHIELD_KNOCKBACK_STRENGTH = 1.0;
const SHIELD_VERTICAL = 0.2;
const PARRY_KNOCKBACK_MULT = 1.8;
const PARRY_VERTICAL_MULT = 1.5;

const PRIORITY_FOOD = {
    "minecraft:enchanted_golden_apple": { weight: 50, maxHp: 8, combatOnly: true, effects: "regeneration 2 36|absorption 3 120|fire_resistance 0 300|resistance 0 300" },
    "minecraft:golden_apple":          { weight: 49, maxHp: 8, combatOnly: true, effects: "regeneration 2 8|absorption 0 120" },
    "minecraft:golden_carrot":         { weight: 46, maxHp: 20, combatOnly: false, effects: "regeneration 2 10" },
    "minecraft:cooked_beef":           { weight: 45, maxHp: 20, combatOnly: false, effects: "regeneration 2 8" },
    "minecraft:cooked_porkchop":       { weight: 44, maxHp: 20, combatOnly: false, effects: "regeneration 2 8" },
    "minecraft:cooked_mutton":         { weight: 38, maxHp: 20, combatOnly: false, effects: "regeneration 2 6" },
    "minecraft:cooked_chicken":        { weight: 37, maxHp: 20, combatOnly: false, effects: "regeneration 2 6" },
    "minecraft:cooked_salmon":         { weight: 36, maxHp: 20, combatOnly: false, effects: "regeneration 2 6" },
    "minecraft:baked_potato":          { weight: 35, maxHp: 20, combatOnly: false, effects: "regeneration 2 5" },
    "minecraft:bread":                 { weight: 34, maxHp: 20, combatOnly: false, effects: "regeneration 2 5" },
    "minecraft:cooked_cod":            { weight: 33, maxHp: 20, combatOnly: false, effects: "regeneration 2 5" },
    "minecraft:apple":                 { weight: 31, maxHp: 20, combatOnly: false, effects: "regeneration 2 4" },
    "minecraft:golden_apple":          { weight: 49, maxHp: 8, combatOnly: true, effects: "regeneration 2 8|absorption 0 120" },
    "minecraft:cooked_rabbit":         { weight: 32, maxHp: 20, combatOnly: false, effects: "regeneration 2 5" },
    "minecraft:mushroom_stew":         { weight: 41, maxHp: 20, combatOnly: false, effects: "regeneration 2 7" },
    "minecraft:beetroot_soup":         { weight: 42, maxHp: 20, combatOnly: false, effects: "regeneration 2 7" },
    "minecraft:pumpkin_pie":           { weight: 43, maxHp: 20, combatOnly: false, effects: "regeneration 2 7" },
    "minecraft:cookie":                { weight: 24, maxHp: 20, combatOnly: false, effects: "regeneration 2 2" },
    "minecraft:melon_slice":           { weight: 25, maxHp: 20, combatOnly: false, effects: "regeneration 2 2" },
    "minecraft:sweet_berries":         { weight: 29, maxHp: 20, combatOnly: false, effects: "regeneration 2 2" },
    "minecraft:dried_kelp":            { weight: 23, maxHp: 20, combatOnly: false, effects: "regeneration 2 2" },
    "minecraft:carrot":                { weight: 30, maxHp: 20, combatOnly: false, effects: "regeneration 2 3" },
    "minecraft:beetroot":              { weight: 22, maxHp: 20, combatOnly: false, effects: "regeneration 2 2" },
    "minecraft:honey_bottle":          { weight: 39, maxHp: 20, combatOnly: false, effects: "regeneration 2 6" },
    "minecraft:chorus_fruit":          { weight: 48, maxHp: 8, combatOnly: true, effects: "regeneration 2 6" }
};

export class CombatSystem {
    constructor(brain) {
        this.brain = brain;
        this.comboHits = 0;
        this.strafeDir = 1;
        this.shieldTimerId = null;
        this.shieldActive = false;
        this._strafeState = { isStrafing: false, lastWTapTick: 0 };
    }

    get hunter() { return this.brain.hunter; }
    get target() { return this.brain.target; }
    get inventory() { return this.brain.inventory; }
    get cooldowns() { return this.brain.cooldowns; }
    get profile() { return getProfile(this.brain.aiLevel); }

    reset() {
        this.comboHits = 0;
        this.strafeDir = 1;
        this.clearShield();
        this._strafeState = { isStrafing: false, lastWTapTick: 0 };
    }

    tick() {
        const h = this.hunter;
        const t = this.target;
        const inv = this.inventory;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !t || !inv) return;

        if (!inv.isTempEquipActive()) {
            inv.equipWeapon(h);
        }

        const combatTarget = this._getCombatTarget(h, t);
        const cPos = combatTarget.location;
        const cdx = cPos.x - h.location.x;
        const cdz = cPos.z - h.location.z;
        const cDist = Math.sqrt(cdx * cdx + cdz * cdz);

        if (cd.isReady("eat")) {
            if (this._tryEat(h, inv, p.eatBelowHp)) {
                cd.set("eat", p.cdEat * 2);
            } else {
                cd.set("eat", p.cdEat);
            }
        }

        if (cd.isReady("shield") && cDist < p.attackRange + 1 && inv.hasShield() && !this.shieldActive) {
            this._equipShield(h, 20);
            cd.set("shield", p.cdShield);
        }

        if (cd.isReady("strafe") && cDist <= p.strafeRange && cDist >= 1.5) {
            this._doDistanceStrafe(h, combatTarget, cDist);
            cd.set("strafe", p.cdStrafe);
        }

        if (cd.isReady("combo") && cDist <= p.comboRange && this.comboHits > 0) {
            this._triggerAttack(h);
            this.comboHits--;
            cd.set("combo", p.cdCombo);
            try {
                const nx = cdx / cDist;
                const nz = cdz / cDist;
                h.applyImpulse({ x: nx * 0.12, y: 0, z: nz * 0.12 });
            } catch (_) { }
        }

        if (cd.isReady("jumpAttack") && cDist >= p.jumpAttackMin && cDist <= p.jumpAttackMax) {
            if (Math.random() < p.jumpAttackChance) {
                if (this._doJumpAttack(h, combatTarget, cDist)) {
                    this._triggerAttack(h);
                    this.comboHits = 3;
                }
                cd.set("jumpAttack", p.cdJumpAttack);
            }
        }

        if (cd.isReady("sprintJump") && cDist > p.sprintJumpMin && cDist < p.sprintJumpMax) {
            if (this._doSprintJump(h, combatTarget)) {
                cd.set("sprintJump", p.cdSprintJump);
            }
        }

        if (cDist <= p.lavaPourRange && inv.hasItem("minecraft:lava_bucket")) {
            this._tryPourLava(h, combatTarget, inv);
        }

        if (cd.isReady("taunt") && cDist < 50) {
            this._sendTaunt(combatTarget);
            cd.set("taunt", cDist < 15 ? p.cdTauntClose : p.cdTaunt);
        }
    }

    handleDamage(hunter, cause, attacker) {
        const inv = this.inventory;
        const p = this.profile;

        if (this.shieldActive && inv.hasShield() && Math.random() < p.shieldBlockChance) {
            try {
                const hp = hunter.getComponent("minecraft:health");
                if (hp) {
                    const heal = Math.min(2, hp.effectiveMax - hp.currentValue);
                    if (heal > 0) hp.setCurrentValue(hp.currentValue + heal);
                }
            } catch (_) { }
            this._applyShieldKnockback(hunter, attacker, false);
            return;
        }

        if (inv.isTempEquipActive()) {
            inv.finishTempEquip(hunter);
        }
        inv.equipWeapon(hunter);

        if ((cause === "projectile" || cause === "entityAttack") && inv.hasShield()) {
            this._equipShield(hunter, 40);
        }
    }

    rollCrit(hunter) {
        const p = this.profile;
        try {
            const vel = hunter.getVelocity();
            if (vel.y < -0.08 || Math.random() < p.critChance) {
                return { isCrit: true, multiplier: p.critMultiplier };
            }
        } catch (_) { }
        return { isCrit: false, multiplier: 1.0 };
    }

    _triggerAttack(hunter) {
        try {
            hunter.triggerEvent("manhunt:set_action_attacking");
            system.runTimeout(() => {
                try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
            }, 8);
        } catch (_) { }
    }

    _doDistanceStrafe(hunter, target, dist) {
        if (this._strafeState.isStrafing || !hunter.isOnGround || hunter.isInWater || hunter.isFalling) return;

        this._strafeState.isStrafing = true;

        system.runTimeout(() => {
            if (!hunter.isValid || !hunter.target || !hunter.isOnGround || hunter.isInWater || hunter.isFalling) {
                this._strafeState.isStrafing = false;
                return;
            }

            let direction;
            let strength = STRAFE_STEP_STRENGTH;

            if (dist < CLOSE_RANGE) {
                const toTargetX = target.location.x - hunter.location.x;
                const toTargetZ = target.location.z - hunter.location.z;
                const d = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ) || 1;
                const side = Math.random() < 0.5 ? 1 : -1;
                direction = { x: (-toTargetZ / d) * side, z: (toTargetX / d) * side };
                strength = CIRCLE_STRAFE_STRENGTH;
            } else if (dist < MID_RANGE) {
                direction = { x: Math.random() * 2 - 1, z: Math.random() * 2 - 1 };
            } else {
                const toTargetX = target.location.x - hunter.location.x;
                const toTargetZ = target.location.z - hunter.location.z;
                const d = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ) || 1;
                direction = {
                    x: (toTargetX / d) + (Math.random() * 0.6 - 0.3),
                    z: (toTargetZ / d) + (Math.random() * 0.6 - 0.3)
                };
            }

            const totalSteps = STRAFE_STEP_COUNT_MIN + ((Math.random() * (STRAFE_STEP_COUNT_MAX - STRAFE_STEP_COUNT_MIN + 1)) | 0);
            this._performStrafeSteps(hunter, direction, strength, totalSteps);

            const currentTick = system.currentTick;
            if (dist < MID_RANGE && Math.random() < W_TAP_CHANCE && currentTick > (this._strafeState.lastWTapTick || 0) + W_TAP_COOLDOWN) {
                system.runTimeout(() => {
                    if (!hunter.isValid || !hunter.target || !hunter.isOnGround) return;
                    const tgt = hunter.target;
                    const fwdX = tgt.location.x - hunter.location.x;
                    const fwdZ = tgt.location.z - hunter.location.z;
                    const fwdDist = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
                    hunter.applyImpulse({
                        x: (fwdX / fwdDist) * W_TAP_FORWARD_STRENGTH,
                        y: 0,
                        z: (fwdZ / fwdDist) * W_TAP_FORWARD_STRENGTH
                    });
                    this._strafeState.lastWTapTick = currentTick;
                }, (totalSteps * STRAFE_STEP_INTERVAL) + 2);
            }
        }, 2);
    }

    _performStrafeSteps(hunter, direction, strength, stepsRemaining) {
        if (stepsRemaining <= 0 || !hunter.isValid || !hunter.target || !hunter.isOnGround || hunter.isInWater || hunter.isFalling) {
            this._strafeState.isStrafing = false;
            return;
        }

        hunter.applyImpulse({ x: direction.x * strength, y: 0, z: direction.z * strength });

        system.runTimeout(() => {
            this._performStrafeSteps(hunter, direction, strength, stepsRemaining - 1);
        }, STRAFE_STEP_INTERVAL);
    }

    _applyShieldKnockback(hunter, attacker, isParry) {
        if (!attacker) return;
        try {
            const rot = hunter.getRotation();
            const yawRad = (rot.y + 90) * (Math.PI / 180);
            const dirX = Math.cos(yawRad);
            const dirZ = Math.sin(yawRad);
            const kb = isParry ? SHIELD_KNOCKBACK_STRENGTH * PARRY_KNOCKBACK_MULT : SHIELD_KNOCKBACK_STRENGTH;
            const vert = isParry ? SHIELD_VERTICAL * PARRY_VERTICAL_MULT : SHIELD_VERTICAL;

            attacker.applyImpulse({ x: -dirX * kb, y: vert, z: -dirZ * kb });

            if (isParry) {
                try { attacker.runCommand("effect @s slowness 1 2 true"); } catch (_) { }
            }
        } catch (_) { }
    }

    _doJumpAttack(hunter, target, dist) {
        try {
            const vel = hunter.getVelocity();
            if (vel.y > 0.05 || vel.y < -0.3) return false;
            const hPos = hunter.location;
            const tPos = target.location;
            const nx = (tPos.x - hPos.x) / dist;
            const nz = (tPos.z - hPos.z) / dist;
            hunter.applyImpulse({ x: nx * 0.45, y: 0.45, z: nz * 0.45 });
            return true;
        } catch (_) { }
        return false;
    }

    _doSprintJump(hunter, target) {
        try {
            const vel = hunter.getVelocity();
            if (vel.y > 0.05 || vel.y < -0.1) return false;
            if (Math.sqrt(vel.x ** 2 + vel.z ** 2) < 0.1) return false;
            const hPos = hunter.location;
            const tPos = target.location;
            const dx = tPos.x - hPos.x;
            const dz = tPos.z - hPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            hunter.applyImpulse({ x: (dx / dist) * 0.15, y: 0.38, z: (dz / dist) * 0.15 });
            return true;
        } catch (_) { }
        return false;
    }

    _tryEat(hunter, inventory, eatBelowHp) {
        if (inventory.isTempEquipActive()) return false;
        try {
            const hp = hunter.getComponent("minecraft:health");
            if (!hp || hp.currentValue >= eatBelowHp) return false;

            const isInCombat = hunter.target !== undefined;
            let bestFood = null;
            let highestWeight = -1;

            for (const slot of inventory.slots) {
                if (!slot || slot.amount <= 0) continue;
                const cfg = PRIORITY_FOOD[slot.typeId];
                if (!cfg) continue;
                if (hp.currentValue > cfg.maxHp) continue;
                if (cfg.combatOnly && !isInCombat) continue;
                if (cfg.weight > highestWeight) {
                    highestWeight = cfg.weight;
                    bestFood = slot.typeId;
                }
            }

            if (!bestFood) return false;

            const foodCfg = PRIORITY_FOOD[bestFood];
            inventory.showItemInHand(hunter, bestFood, "eating", 32);

            system.runTimeout(() => {
                try {
                    inventory.removeItem(bestFood, 1);
                    if (foodCfg.effects) {
                        for (const effStr of foodCfg.effects.split("|")) {
                            const parts = effStr.trim().split(/\s+/);
                            if (parts.length >= 3) {
                                try {
                                    hunter.runCommand(`effect @s ${parts[0]} ${parts[2]} ${parts[1]}`);
                                } catch (_) { }
                            }
                        }
                    }
                } catch (_) { }
            }, 32);

            return true;
        } catch (_) { }
        return false;
    }

    _tryPourLava(hunter, target, inventory) {
        try {
            const tPos = target.location;
            const lavaPos = { x: Math.floor(tPos.x), y: Math.floor(tPos.y), z: Math.floor(tPos.z) };
            const block = hunter.dimension.getBlock(lavaPos);
            if (block?.typeId === "minecraft:air") {
                inventory.showItemInHand(hunter, "minecraft:lava_bucket", "placing", 15);
                block.setPermutation(BlockPermutation.resolve("minecraft:lava"));
                inventory.removeItem("minecraft:lava_bucket", 1);
                inventory.addItem("minecraft:bucket", 1);
                this.brain.tempWaterBlocks.push({
                    pos: { ...lavaPos },
                    removeTick: system.currentTick + 60
                });
            }
        } catch (_) { }
    }

    _equipShield(hunter, duration) {
        try {
            hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 minecraft:shield 1`);
            this.shieldActive = true;
            if (this.shieldTimerId !== null) {
                try { system.clearRun(this.shieldTimerId); } catch (_) { }
            }
            this.shieldTimerId = system.runTimeout(() => {
                try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
                this.shieldTimerId = null;
                this.shieldActive = false;
            }, duration);
        } catch (_) { }
    }

    clearShield() {
        if (this.shieldTimerId !== null) {
            try { system.clearRun(this.shieldTimerId); } catch (_) { }
            this.shieldTimerId = null;
        }
        this.shieldActive = false;
        const h = this.hunter;
        if (h) {
            try { h.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
        }
    }

    _sendTaunt(target) {
        try {
            if (!getEnableTaunts()) return;
            target.sendMessage(randomTaunt());
        } catch (_) { }
    }

    _getCombatTarget(hunter, primary) {
        try {
            const players = world.getAllPlayers();
            const hPos = hunter.location;
            let closest = primary;
            let closestDist = this._dist2D(hPos, primary.location);
            for (const p of players) {
                if (p.id === primary.id) continue;
                if (p.dimension.id !== hunter.dimension.id) continue;
                const d = this._dist2D(hPos, p.location);
                if (d <= 8 && d < closestDist + 1) {
                    closest = p;
                    closestDist = d;
                }
            }
            return closest;
        } catch (_) { }
        return primary;
    }

    _dist2D(a, b) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}