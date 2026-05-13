/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation, system } from "@minecraft/server";
import { getProfile } from "./profiles.js";

export class SurvivalSystem {
    constructor(brain) {
        this.brain = brain;
        this.fallTicks = 0;
    }

    get hunter() { return this.brain.hunter; }
    get target() { return this.brain.target; }
    get inventory() { return this.brain.inventory; }
    get cooldowns() { return this.brain.cooldowns; }
    get profile() { return getProfile(this.brain.aiLevel); }

    reset() {
        this.fallTicks = 0;
    }

    updateFallTicks() {
        try {
            const vel = this.hunter.getVelocity();
            if (vel.y < -0.5) this.fallTicks++;
            else this.fallTicks = 0;
        } catch (_) { }
    }

    checkSurvival() {
        const h = this.hunter;
        const inv = this.inventory;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !inv) return null;

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