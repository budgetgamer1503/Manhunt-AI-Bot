/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, BlockPermutation, world } from "@minecraft/server";
import { getProfile, randomTaunt } from "./profiles.js";
import { getEnableTaunts } from "../entity_manager.js";

export class CombatSystem {
    constructor(brain) {
        this.brain = brain;
        this.comboHits = 0;
        this.strafeDir = 1;
        this.shieldTimerId = null;
        this.shieldActive = false;
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
            this.strafeDir = this._doStrafe(h, combatTarget, cDist, this.strafeDir);
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

    _doStrafe(hunter, target, dist, dir) {
        try {
            const vel = hunter.getVelocity();
            if (Math.abs(vel.y) > 0.05) return dir;

            const hPos = hunter.location;
            const tPos = target.location;
            const dx = tPos.x - hPos.x;
            const dz = tPos.z - hPos.z;

            let d = dir;
            if (Math.random() < 0.15) d *= -1;

            const perpX = -dz / dist * d;
            const perpZ = dx / dist * d;
            const fwdX = (dx / dist) * 0.1;
            const fwdZ = (dz / dist) * 0.1;

            const dim = hunter.dimension;
            const cx = Math.floor(hPos.x + perpX * 1.5);
            const cz = Math.floor(hPos.z + perpZ * 1.5);
            const cy = Math.floor(hPos.y) - 1;

            const below = dim.getBlock({ x: cx, y: cy, z: cz });
            const at = dim.getBlock({ x: cx, y: cy + 1, z: cz });

            if (!below || below.typeId === "minecraft:air" || below.typeId === "minecraft:water" || below.typeId === "minecraft:lava") return d;
            if (at && at.typeId !== "minecraft:air" && at.typeId !== "minecraft:tall_grass" && at.typeId !== "minecraft:short_grass") return d;

            hunter.applyImpulse({ x: perpX * 0.12 + fwdX, y: 0, z: perpZ * 0.12 + fwdZ });
            return d;
        } catch (_) { }
        return dir;
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
            const food = inventory.getBestFood();
            if (!food) return false;
            inventory.showItemInHand(hunter, food, "eating", 32);
            system.runTimeout(() => {
                try {
                    const hunger = inventory.getFoodHunger(food);
                    inventory.removeItem(food, 1);
                    const h = hunter.getComponent("minecraft:health");
                    if (h) {
                        const heal = Math.min(hunger, h.effectiveMax - h.currentValue);
                        if (heal > 0) h.setCurrentValue(h.currentValue + heal);
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