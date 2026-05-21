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
    get profile() { return this.brain.profile; }

    reset() {
        this.miningTarget = null;
        this.smeltTimers.clear();
        this.prepTicks = 0;
    }

    tickMining() {
        if (!this.miningTarget) return;

        // Sensory Mining Feedback: particle & sound
        try {
            const h = this.hunter;
            if (h) {
                const dim = h.dimension;
                const pos = this.miningTarget.pos;
                const blockType = this.miningTarget.typeId;
                dim.spawnParticle("minecraft:block_destroy", pos, { block: blockType });
                const hitSound = blockType.includes("log") ? "hit.wood" : "hit.stone";
                dim.playSound(hitSound, pos, { volume: 0.3, pitch: 1.0 });
            }
        } catch (_) {}

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

        // Smart Resource Auditing
        if (cd.isReady("place_crafting") && !inv.hasItem("minecraft:crafting_table")) {
            const hasLogs = inv.hasItem("minecraft:oak_log") || inv.hasItem("minecraft:birch_log") || inv.hasItem("minecraft:spruce_log");
            if (hasLogs && !this._isUtilityPlacedNearby(h, "minecraft:crafting_table")) {
                if (this._placeUtility(h, "minecraft:crafting_table")) {
                    cd.set("place_crafting", 200);
                }
            }
        }

        if (cd.isReady("place_furnace") && !inv.hasItem("minecraft:furnace")) {
            const hasRawIron = inv.hasItem("minecraft:raw_iron");
            const hasCobble = inv.countItem("minecraft:cobblestone") >= 8;
            const hasFuel = inv.hasItem("minecraft:coal") || inv.hasItem("minecraft:oak_log") || inv.hasItem("minecraft:oak_planks");
            
            if (hasRawIron && hasCobble && hasFuel && !this._isUtilityPlacedNearby(h, "minecraft:furnace")) {
                const furnacePos = this._placeUtilityWithDigIn(h, "minecraft:furnace", inv);
                if (furnacePos) {
                    cd.set("place_furnace", 300);
                }
            }
        }

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
            const tool = inventory.getBestPickaxe(); // Use best pickaxe helper
            if (tool && typeId.includes("ore")) inventory.showItemInHand(hunter, tool, "mining", duration + 5);
            else {
                const axe = inventory.getBestAxe();
                if (axe && typeId.includes("log")) inventory.showItemInHand(hunter, axe, "mining", duration + 5);
                else try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
            }
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
                
                // Breaking sound sensory feedback
                const breakSound = mt.typeId.includes("log") ? "break.wood" : "break.stone";
                dim.playSound(breakSound, mt.pos);
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
                if (b?.typeId === "minecraft:air") {
                    b.setPermutation(BlockPermutation.resolve(blockType));
                    return p;
                }
            }
        } catch (_) { }
        return null;
    }

    _isUtilityPlacedNearby(hunter, typeId) {
        try {
            const dim = hunter.dimension;
            const pos = hunter.location;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
            for (let x = -5; x <= 5; x++) {
                for (let y = -2; y <= 2; y++) {
                    for (let z = -5; z <= 5; z++) {
                        const block = dim.getBlock({ x: fx + x, y: fy + y, z: fz + z });
                        if (block?.typeId === typeId) return true;
                    }
                }
            }
        } catch (_) {}
        return false;
    }

    _placeUtilityWithDigIn(hunter, blockType, inventory) {
        try {
            const dim = hunter.dimension;
            const pos = hunter.location;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
            const offsets = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
            
            for (const off of offsets) {
                const p = { x: fx + off.x, y: fy, z: fz + off.z };
                const b = dim.getBlock(p);
                if (b?.typeId === "minecraft:air") {
                    b.setPermutation(BlockPermutation.resolve(blockType));
                    
                    // Cover Smelting / Dig-In Check
                    const runner = this.target;
                    let runnerDist = 999;
                    if (runner) {
                        try {
                            const rPos = runner.location;
                            runnerDist = Math.sqrt((rPos.x - pos.x) ** 2 + (rPos.z - pos.z) ** 2);
                        } catch (_) {}
                    }
                    
                    if (runnerDist <= 30) {
                        const shieldBlock = inventory.hasItem("minecraft:cobblestone") ? "minecraft:cobblestone" : (inventory.hasItem("minecraft:dirt") ? "minecraft:dirt" : null);
                        if (shieldBlock) {
                            let placed = 0;
                            const coverOffsets = [
                                { x: off.x + 1, z: off.z },
                                { x: off.x - 1, z: off.z },
                                { x: off.x, z: off.z + 1 },
                                { x: off.x, z: off.z - 1 }
                            ];
                            for (const cOff of coverOffsets) {
                                if (placed >= 3) break;
                                const cp = { x: fx + cOff.x, y: fy, z: fz + cOff.z };
                                const cb = dim.getBlock(cp);
                                if (cb?.typeId === "minecraft:air") {
                                    cb.setPermutation(BlockPermutation.resolve(shieldBlock));
                                    inventory.removeItem(shieldBlock, 1);
                                    this.brain.tempWaterBlocks.push({
                                        pos: cp,
                                        removeTick: system.currentTick + 600
                                    });
                                    placed++;
                                }
                            }
                        }
                    }
                    return p;
                }
            }
        } catch (_) {}
        return null;
    }
}