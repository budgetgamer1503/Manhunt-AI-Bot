/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation, system } from "@minecraft/server";
import { getProfile } from "./profiles.js";

export class GatheringSystem {
    constructor(brain) {
        this.brain = brain;
        this.miningTarget = null;
        this.smeltTimers = new Map();
        this.prepTicks = 0;
    }

    get hunter() { return this.brain.hunter; }
    get target() { return this.brain.target; }
    get inventory() { return this.brain.inventory; }
    get cooldowns() { return this.brain.cooldowns; }
    get profile() { return getProfile(this.brain.aiLevel); }

    reset() {
        this.miningTarget = null;
        this.smeltTimers.clear();
        this.prepTicks = 0;
    }

    tickMining() {
        if (!this.miningTarget) return;
        this.miningTarget.ticksLeft -= 2;
        if (this.miningTarget.ticksLeft <= 0) {
            this._finishMining();
        }
    }

    tickPrep() {
        const h = this.hunter;
        const t = this.target;
        const inv = this.inventory;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !t || !inv) return;

        this.prepTicks += 2;

        const hPos = h.location;
        const tPos = t.location;
        const dist = Math.sqrt((tPos.x - hPos.x) ** 2 + (tPos.z - hPos.z) ** 2);

        if (dist < p.prepExitDist) {
            return "exit_prep";
        }

        if (cd.isReady("mining") && !this.miningTarget) {
            const target = this._findPrepGatherTarget(h, inv, p);
            if (target) {
                this._startMining(h, inv, target.pos);
                cd.set("mining", p.cdMining);
            }
        }

        if (!this.miningTarget) {
            let crafted = inv.attemptCraft();
            if (crafted) {
                inv.attemptCraft();
                inv.equipBest(h);
            }
        }

        inv.attemptSmelt(system.currentTick, this.smeltTimers);

        if (this.prepTicks === 6) this._placeUtility(h, "minecraft:crafting_table");
        if (this.prepTicks === 12) this._placeUtility(h, "minecraft:furnace");

        if (cd.isReady("eat")) {
            this._tryEatPrep(h, inv, p.eatBelowHp);
            cd.set("eat", p.cdEat);
        }

        if (this.prepTicks >= p.prepDuration || inv.hasGoodGear()) {
            inv.equipBest(h);
            return "exit_prep";
        }

        return null;
    }

    findGatherTarget() {
        const h = this.hunter;
        const inv = this.inventory;
        const p = this.profile;
        if (!h || !inv) return null;
        if (inv.getBridgeBlockCount() >= 4) return null;
        return inv.findGatherTarget(h, p.gatherSearchRadius);
    }

    startMiningFromResult(result) {
        if (!result) return;
        this._startMining(this.hunter, this.inventory, result.pos);
    }

    _startMining(hunter, inventory, blockPos) {
        try {
            const dim = hunter.dimension;
            const block = dim.getBlock(blockPos);
            if (!block || block.typeId === "minecraft:air") return;
            const typeId = block.typeId;
            const duration = inventory.getMiningDuration(typeId);
            if (duration <= 0) return;
            const tool = inventory.getMiningTool(typeId);
            if (tool) inventory.showItemInHand(hunter, tool, "mining", duration + 5);
            else try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
            this.miningTarget = { pos: { x: blockPos.x, y: blockPos.y, z: blockPos.z }, typeId, ticksLeft: duration };
        } catch (_) { }
    }

    _finishMining() {
        const mt = this.miningTarget;
        const h = this.hunter;
        const inv = this.inventory;
        if (!mt) return;
        try {
            const dim = h.dimension;
            const block = dim.getBlock(mt.pos);
            if (block && block.typeId === mt.typeId) {
                block.setPermutation(BlockPermutation.resolve("minecraft:air"));
                const drop = inv.getMiningDrop(mt.typeId);
                if (drop) inv.addItem(drop.typeId, drop.amount);
            }
        } catch (_) { }
        try { h.triggerEvent("manhunt:set_action_none"); } catch (_) { }
        this.miningTarget = null;
    }

    _findPrepGatherTarget(hunter, inventory, profile) {
        try {
            const pos = hunter.location;
            const dim = hunter.dimension;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
            const feetY = fy - 1;
            const logCount = inventory.countItem("minecraft:oak_log") + inventory.countItem("minecraft:oak_planks") / 4;
            const stoneCount = inventory.countItem("minecraft:cobblestone");
            const ironCount = inventory.countItem("minecraft:raw_iron") + inventory.countItem("minecraft:iron_ingot");

            let targets = [];
            if (logCount < profile.prepLogTarget) targets.push("minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log", "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log", "minecraft:mangrove_log", "minecraft:cherry_log");
            if (stoneCount < profile.prepStoneTarget) targets.push("minecraft:stone", "minecraft:cobblestone");
            if (ironCount < profile.prepIronTarget) targets.push("minecraft:iron_ore", "minecraft:deepslate_iron_ore");
            if (inventory.getBridgeBlockCount() < 32) targets.push("minecraft:dirt", "minecraft:grass_block", "minecraft:gravel", "minecraft:sand");
            if (targets.length === 0) return null;

            let closest = null, closestDist = Infinity;
            for (let x = -profile.prepGatherRadius; x <= profile.prepGatherRadius; x++) {
                for (let y = -2; y <= 3; y++) {
                    for (let z = -profile.prepGatherRadius; z <= profile.prepGatherRadius; z++) {
                        const bx = fx + x, by = fy + y, bz = fz + z;
                        if (by === feetY && bx === fx && bz === fz) continue;
                        try {
                            const block = dim.getBlock({ x: bx, y: by, z: bz });
                            if (block && targets.includes(block.typeId)) {
                                const dist = Math.abs(x) + Math.abs(y) + Math.abs(z);
                                if (dist < closestDist) { closestDist = dist; closest = { block, typeId: block.typeId, pos: { x: bx, y: by, z: bz } }; }
                            }
                        } catch (_) { }
                    }
                }
            }
            return closest;
        } catch (_) { }
        return null;
    }

    _tryEatPrep(hunter, inventory, eatBelowHp) {
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
                    if (h) { const heal = Math.min(hunger, h.effectiveMax - h.currentValue); if (heal > 0) h.setCurrentValue(h.currentValue + heal); }
                } catch (_) { }
            }, 32);
            return true;
        } catch (_) { }
        return false;
    }

    _placeUtility(hunter, blockType) {
        try {
            const dim = hunter.dimension;
            const pos = hunter.location;
            const offsets = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
            for (const off of offsets) {
                const p = { x: Math.floor(pos.x) + off.x, y: Math.floor(pos.y), z: Math.floor(pos.z) + off.z };
                const b = dim.getBlock(p);
                if (b?.typeId === "minecraft:air") { b.setPermutation(BlockPermutation.resolve(blockType)); return; }
            }
        } catch (_) { }
    }
}