/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation, system } from "@minecraft/server";
import { getProfile } from "./profiles.js";

const DANGER_BLOCKS = ["minecraft:lava", "minecraft:fire", "minecraft:soul_fire"];
const FALLING_TAG = "falling";
const WATER_SAVE_CHANCE = 0.75;
const FALL_DISTANCE_THRESHOLD = 7;

export class SurvivalSystem {
    constructor(brain) {
        this.brain = brain;
        this.fallTicks = 0;
        this._fallStartY = null;
    }

    get hunter() { return this.brain.hunter; }
    get target() { return this.brain.target; }
    get inventory() { return this.brain.inventory; }
    get cooldowns() { return this.brain.cooldowns; }
    get profile() { return this.brain.profile; }

    reset() {
        this.fallTicks = 0;
        this._fallStartY = null;
    }

    updateFallTicks() {
        const h = this.hunter;
        if (!h) return;
        try {
            const vel = h.getVelocity();
            const isFalling = vel.y < -0.5;

            if (vel.y < -0.5) this.fallTicks++;
            else this.fallTicks = 0;

            if (isFalling && !h.hasTag(FALLING_TAG)) {
                h.addTag(FALLING_TAG);
                this._fallStartY = h.location.y;
            } else if (!isFalling && h.hasTag(FALLING_TAG)) {
                h.removeTag(FALLING_TAG);
                this._tryFallWaterSave(h);
            }
        } catch (_) { }
    }

    _tryFallWaterSave(hunter) {
        if (this._fallStartY === null) return;
        const fallDistance = this._fallStartY - hunter.location.y;
        this._fallStartY = null;

        if (fallDistance > FALL_DISTANCE_THRESHOLD && Math.random() < WATER_SAVE_CHANCE) {
            try {
                const loc = hunter.location;
                const dim = hunter.dimension;
                const fx = Math.floor(loc.x), fz = Math.floor(loc.z);

                const groundY = this._findGroundBelow(dim, { x: fx, y: loc.y, z: fz }, 64);
                if (groundY === null) return;

                const waterY = groundY;
                dim.runCommand(`setblock ${fx} ${waterY} ${fz} water`);
                system.runTimeout(() => {
                    try { dim.runCommand(`setblock ${fx} ${waterY} ${fz} air`); } catch (_) { }
                }, 20);
            } catch (_) { }
        }
    }

    checkSurvival() {
        const h = this.hunter;
        const inv = this.inventory;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !inv) return null;

        // Nether: Equip gold armor if available and not wearing any gold armor
        this._checkNetherGoldArmor(h, inv);

        // End: Avoid Endermen aggro / handle Endermen
        const enderAction = this._checkEndermanThreat(h, inv);
        if (enderAction) return enderAction;

        // Hazards: sweet berry bushes, magma, powder snow
        const hazardAction = this._checkHazards(h, inv);
        if (hazardAction) return hazardAction;

        const lava = this._checkLavaEscape(h, inv);
        if (lava) return lava;

        const mlg = this._checkWaterMLG(h, inv);
        if (mlg) return mlg;

        if (cd.isReady("place")) {
            const clutch = this._checkBlockClutch(h, inv);
            if (clutch) { cd.set("place", p.cdPlace); return clutch; }
        }

        if (cd.isReady("place")) {
            const cave = this._checkCaveEscape(h, inv);
            if (cave) {
                this.brain.stuckTicks = 0;
                return cave;
            }
        }

        return null;
    }

    _hasLeatherBoots(hunter) {
        try {
            const equippable = hunter.getComponent("minecraft:equippable");
            if (equippable) {
                const feet = equippable.getEquipment("Feet");
                return feet?.typeId === "minecraft:leather_boots";
            }
        } catch (_) {}
        return false;
    }

    _hasFireResistance(hunter) {
        try {
            const comp = hunter.getComponent("minecraft:effects");
            if (comp) {
                return hunter.getEffect("fire_resistance") !== undefined;
            }
        } catch (_) {}
        return false;
    }

    _checkHazards(hunter, inventory) {
        try {
            const pos = hunter.location;
            const dim = hunter.dimension;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
            
            const feetBlock = dim.getBlock({ x: fx, y: fy, z: fz });
            const belowBlock = dim.getBlock({ x: fx, y: fy - 1, z: fz });
            
            // Sweet berry bushes avoidance
            if (feetBlock?.typeId === "minecraft:sweet_berry_bush" || belowBlock?.typeId === "minecraft:sweet_berry_bush") {
                return {
                    type: "impulse",
                    x: (Math.random() - 0.5) * 0.5,
                    y: 0.38,
                    z: (Math.random() - 0.5) * 0.5
                };
            }
            
            // Powder snow avoidance
            if (feetBlock?.typeId === "minecraft:powder_snow" || belowBlock?.typeId === "minecraft:powder_snow") {
                if (!this._hasLeatherBoots(hunter)) {
                    if (inventory.hasWaterBucket()) {
                        return { type: "place_water", blockPos: { x: fx, y: fy, z: fz }, showItem: "minecraft:water_bucket", tempWater: true };
                    }
                    const block = inventory.getBridgeBlock();
                    if (block) {
                        return { type: "place_block", blockPos: { x: fx, y: fy, z: fz }, blockType: block, showItem: block, stopMovement: true };
                    }
                    return { type: "impulse", x: (Math.random() - 0.5) * 0.6, y: 0.45, z: (Math.random() - 0.5) * 0.6 };
                }
            }
            
            // Magma block avoidance
            if (belowBlock?.typeId === "minecraft:magma") {
                if (!this._hasFireResistance(hunter)) {
                    const block = inventory.getBridgeBlock();
                    if (block) {
                        return { type: "place_block", blockPos: { x: fx, y: fy - 1, z: fz }, blockType: block, showItem: block };
                    }
                    return { type: "impulse", x: (Math.random() - 0.5) * 0.6, y: 0.38, z: (Math.random() - 0.5) * 0.6 };
                }
            }
        } catch (_) {}
        return null;
    }

    _checkNetherGoldArmor(hunter, inventory) {
        try {
            if (hunter.dimension.id !== "minecraft:nether") return;
            
            const equippable = hunter.getComponent("minecraft:equippable");
            if (!equippable) return;
            
            const goldHelmet = equippable.getEquipment("Head")?.typeId === "minecraft:golden_helmet";
            const goldChest = equippable.getEquipment("Chest")?.typeId === "minecraft:golden_chestplate";
            const goldLegs = equippable.getEquipment("Legs")?.typeId === "minecraft:golden_leggings";
            const goldBoots = equippable.getEquipment("Feet")?.typeId === "minecraft:golden_boots";
            
            if (goldHelmet || goldChest || goldLegs || goldBoots) return;
            
            const goldArmor = [
                { id: "minecraft:golden_helmet", slot: "Head" },
                { id: "minecraft:golden_chestplate", slot: "Chest" },
                { id: "minecraft:golden_leggings", slot: "Legs" },
                { id: "minecraft:golden_boots", slot: "Feet" }
            ];
            
            for (const item of goldArmor) {
                if (inventory.hasItem(item.id)) {
                    hunter.runCommand(`replaceitem entity @s slot.armor.${item.slot.toLowerCase()} 0 ${item.id} 1`);
                    break;
                }
            }
        } catch (_) {}
    }

    _checkEndermanThreat(hunter, inventory) {
        try {
            if (hunter.dimension.id !== "minecraft:the_end") return null;
            
            const endermen = hunter.dimension.getEntities({
                type: "minecraft:enderman",
                location: hunter.location,
                maxDistance: 8
            });
            
            if (endermen.length === 0) return null;
            
            let hostileEnderman = false;
            for (const enderman of endermen) {
                try {
                    const vel = enderman.getVelocity();
                    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                    if (speed > 0.12) {
                        hostileEnderman = true;
                        break;
                    }
                } catch (_) {}
            }
            
            if (hostileEnderman && inventory.hasWaterBucket()) {
                const pos = hunter.location;
                const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
                return {
                    type: "place_water",
                    blockPos: { x: fx, y: fy, z: fz },
                    showItem: "minecraft:water_bucket",
                    tempWater: true
                };
            }
        } catch (_) {}
        return null;
    }

    checkAntiTrap() {
        const h = this.hunter;
        if (!h) return;

        try {
            const loc = h.location;
            const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
            const dim = h.dimension;

            const headBlock = dim.getBlock({ x, y: y + 1, z });
            const feetBlock = dim.getBlock({ x, y, z });

            const feetSolid = feetBlock && feetBlock.typeId !== "minecraft:air";
            const headSolid = headBlock && headBlock.typeId !== "minecraft:air";

            if (feetSolid && headSolid) {
                dim.runCommand(`setblock ${x} ${y + 1} ${z} air destroy`);
                dim.runCommand(`setblock ${x} ${y} ${z} air destroy`);
                system.runTimeout(() => {
                    if (h.isValid) {
                        h.applyImpulse({ x: 0, y: 0.5, z: 0 });
                    }
                }, 5);
                return;
            }

            const belowBlock = dim.getBlock({ x, y: y - 1, z });
            if (belowBlock && DANGER_BLOCKS.includes(belowBlock.typeId)) {
                dim.runCommand(`setblock ${x} ${y - 1} ${z} cobblestone`);
                if (h.isValid) {
                    h.applyImpulse({ x: (Math.random() - 0.5) * 0.8, y: 0.4, z: (Math.random() - 0.5) * 0.8 });
                }
            }
        } catch (_) { }
    }

    tickRetreat() {
        const h = this.hunter;
        const t = this.target;
        const inv = this.inventory;
        if (!h || !t || !inv) return;

        try {
            const hPos = h.location;
            const tPos = t.location;
            const dx = hPos.x - tPos.x;
            const dz = hPos.z - tPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < 10 && dist > 0.5) {
                h.applyImpulse({ x: (dx / dist) * 0.06, y: 0, z: (dz / dist) * 0.06 });
            }
        } catch (_) { }
    }

    checkHealthState() {
        try {
            const hp = this.hunter.getComponent("minecraft:health");
            const p = this.profile;
            if (hp) {
                if (hp.currentValue <= p.retreatHp) return "retreat";
                if (hp.currentValue > p.retreatHealHp) return "chase";
            }
        } catch (_) { }
        return null;
    }

    cleanTempWater() {
        const now = system.currentTick;
        const tw = this.brain.tempWaterBlocks;
        const mlg = this.brain.mlgWaterBlocks;
        const h = this.hunter;
        const inv = this.inventory;

        if (mlg.length > 0 && inv) {
            try {
                const vel = h.getVelocity();
                const pos = h.location;
                const landed = Math.abs(vel.y) < 0.15 && Math.abs(vel.x) < 0.3 && Math.abs(vel.z) < 0.3;
                if (landed) {
                    for (let i = mlg.length - 1; i >= 0; i--) {
                        const e = mlg[i];
                        const dx = Math.abs(Math.floor(pos.x) - e.pos.x);
                        const dz = Math.abs(Math.floor(pos.z) - e.pos.z);
                        const dy = Math.abs(Math.floor(pos.y) - e.pos.y);
                        if (dx <= 2 && dz <= 2 && dy <= 3) {
                            try {
                                const dim = h.dimension;
                                const b = dim.getBlock(e.pos);
                                if (b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water")) {
                                    b.setPermutation(BlockPermutation.resolve("minecraft:air"));
                                    inv.removeItem("minecraft:bucket", 1);
                                    inv.addItem("minecraft:water_bucket", 1);
                                    inv.equipWeapon(h);
                                }
                            } catch (_) { }
                            const idx = tw.findIndex(x => x.pos.x === e.pos.x && x.pos.y === e.pos.y && x.pos.z === e.pos.z);
                            if (idx !== -1) tw.splice(idx, 1);
                            mlg.splice(i, 1);
                        }
                    }
                }
            } catch (_) { }
        }

        for (let i = tw.length - 1; i >= 0; i--) {
            if (now >= tw[i].removeTick) {
                try {
                    const dim = h.dimension;
                    const b = dim.getBlock(tw[i].pos);
                    if (b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water" || b.typeId === "minecraft:lava")) {
                        b.setPermutation(BlockPermutation.resolve("minecraft:air"));
                    }
                } catch (_) { }
                tw.splice(i, 1);
            }
        }
    }

    _checkLavaEscape(hunter, inventory) {
        try {
            const pos = hunter.location;
            const dim = hunter.dimension;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
            const atFeet = dim.getBlock({ x: fx, y: fy, z: fz });
            const below = dim.getBlock({ x: fx, y: fy - 1, z: fz });
            const atLegs = dim.getBlock({ x: fx, y: fy + 1, z: fz });
            const inLava = (atFeet?.typeId === "minecraft:lava") || (below?.typeId === "minecraft:lava") || (atLegs?.typeId === "minecraft:lava");
            if (!inLava) return null;

            if (inventory.hasWaterBucket()) {
                const wb = dim.getBlock({ x: fx, y: fy, z: fz });
                if (wb && (wb.typeId === "minecraft:lava" || wb.typeId === "minecraft:air")) {
                    return { type: "place_water", blockPos: { x: fx, y: fy, z: fz }, showItem: "minecraft:water_bucket", tempWater: true };
                }
            }
            const block = inventory.getLavaSafeBlock();
            if (!block) return null;
            return { type: "lava_bridge", impulse: { x: 0, y: 0.5, z: 0 }, placeBelow: true, blockType: block, showItem: block };
        } catch (_) { }
        return null;
    }

    _checkWaterMLG(hunter, inventory) {
        if (!inventory.hasWaterBucket()) return null;
        if (this.fallTicks < 5) return null;
        try {
            const pos = hunter.location;
            const vel = hunter.getVelocity();
            const dim = hunter.dimension;
            if (vel.y > -0.5) return null;
            const groundY = this._findGroundBelow(dim, pos, 64);
            if (groundY === null) return null;
            const dist = pos.y - groundY;
            if (dist < 3 || dist > 4) return null;
            const wp = { x: Math.floor(pos.x), y: groundY, z: Math.floor(pos.z) };
            const block = dim.getBlock(wp);
            if (block && this._isReplaceable(block.typeId)) {
                return { type: "place_water", blockPos: wp, showItem: "minecraft:water_bucket", tempWater: true };
            }
        } catch (_) { }
        return null;
    }

    _checkBlockClutch(hunter, inventory) {
        try {
            const pos = hunter.location;
            const vel = hunter.getVelocity();
            const dim = hunter.dimension;
            if (vel.y > -0.5) return null;
            if (inventory.hasWaterBucket()) return null;
            const block = inventory.getBridgeBlock();
            if (!block) return null;
            const fx = Math.floor(pos.x), fy = Math.floor(pos.y) - 1, fz = Math.floor(pos.z);
            const below = dim.getBlock({ x: fx, y: fy, z: fz });
            if (!below || below.typeId !== "minecraft:air") return null;
            const offsets = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
            for (const off of offsets) {
                const adj = dim.getBlock({ x: fx + off.x, y: fy, z: fz + off.z });
                if (adj && adj.typeId !== "minecraft:air" && adj.typeId !== "minecraft:water" && adj.typeId !== "minecraft:lava") {
                    return { type: "place_block", blockPos: { x: fx, y: fy, z: fz }, blockType: block, showItem: block, stopMovement: true };
                }
            }
        } catch (_) { }
        return null;
    }

    _checkCaveEscape(hunter, inventory) {
        if (this.brain.stuckTicks < 60) return null;
        try {
            const pos = hunter.location;
            const dim = hunter.dimension;
            const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
            let ceiling = false;
            for (let y = cy + 2; y <= cy + 4; y++) {
                const b = dim.getBlock({ x: cx, y, z: cz });
                if (b && b.typeId !== "minecraft:air") { ceiling = true; break; }
            }
            let sides = 0;
            const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
            for (const s of dirs) {
                const b = dim.getBlock({ x: cx + s.x, y: cy, z: cz + s.z });
                if (b && b.typeId !== "minecraft:air") sides++;
            }
            if (!ceiling && sides < 3) return null;
            const above = dim.getBlock({ x: cx, y: cy + 2, z: cz });
            if (above && above.typeId !== "minecraft:air") {
                return { type: "break_block", blockPos: { x: cx, y: cy + 2, z: cz }, showTool: inventory.getBestPickaxe() };
            }
            const bridgeBlock = inventory.getBridgeBlock();
            if (bridgeBlock) {
                return { type: "pillar_step", phase: "jump", blockPos: { x: cx, y: cy, z: cz }, blockType: bridgeBlock, showItem: bridgeBlock };
            }
        } catch (_) { }
        return null;
    }

    _findGroundBelow(dim, pos, maxDist = 50) {
        try {
            for (let y = Math.floor(pos.y) - 1; y >= Math.max(Math.floor(pos.y) - maxDist, -64); y--) {
                const b = dim.getBlock({ x: Math.floor(pos.x), y, z: Math.floor(pos.z) });
                if (b && b.typeId !== "minecraft:air") return y + 1;
            }
        } catch (_) { }
        return null;
    }

    _isReplaceable(typeId) {
        return typeId === "minecraft:air" || typeId === "minecraft:short_grass" || typeId === "minecraft:tall_grass" || typeId === "minecraft:dead_bush";
    }
}