/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Survival behaviors for the hunter AI — retreat, lava escape, water MLG, block clutch.
 * Extracted from state_machine.js for v0.7.0 modular refactor.
 */

import { BlockPermutation, system } from "@minecraft/server";

/**
 * Check if the hunter is in lava and needs to escape.
 */
export function checkLavaEscape(hunter, inventory) {
    try {
        const pos = hunter.location;
        const dim = hunter.dimension;
        const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);

        const atFeet = dim.getBlock({ x: fx, y: fy, z: fz });
        const below = dim.getBlock({ x: fx, y: fy - 1, z: fz });
        const atLegs = dim.getBlock({ x: fx, y: fy + 1, z: fz });

        const inLava = (atFeet?.typeId === "minecraft:lava") ||
            (below?.typeId === "minecraft:lava") ||
            (atLegs?.typeId === "minecraft:lava");

        if (!inLava) return null;

        if (inventory.hasWaterBucket()) {
            const waterBlock = dim.getBlock({ x: fx, y: fy, z: fz });
            if (waterBlock && (waterBlock.typeId === "minecraft:lava" || waterBlock.typeId === "minecraft:air")) {
                return {
                    type: "place_water",
                    blockPos: { x: fx, y: fy, z: fz },
                    showItem: "minecraft:water_bucket",
                    tempWater: true
                };
            }
        }

        const block = inventory.getLavaSafeBlock();
        if (!block) return null;

        return {
            type: "lava_bridge",
            impulse: { x: 0, y: 0.5, z: 0 },
            placeBelow: true,
            blockType: block,
            showItem: block
        };
    } catch (_) { }
    return null;
}

/**
 * Check if the hunter should perform a water bucket MLG.
 */
export function checkWaterMLG(hunter, inventory, fallTicks) {
    if (!inventory.hasWaterBucket()) return null;
    if (fallTicks < 5) return null;

    try {
        const pos = hunter.location;
        const vel = hunter.getVelocity();
        const dim = hunter.dimension;

        if (vel.y > -0.5) return null;

        const groundY = findGroundBelow(dim, pos, 64);
        if (groundY === null) return null;

        const distToGround = pos.y - groundY;
        if (distToGround < 3 || distToGround > 4) return null;

        const waterPos = { x: Math.floor(pos.x), y: groundY, z: Math.floor(pos.z) };
        const block = dim.getBlock(waterPos);

        if (block && isReplaceable(block.typeId)) {
            return {
                type: "place_water",
                blockPos: waterPos,
                showItem: "minecraft:water_bucket",
                tempWater: true
            };
        }
    } catch (_) { }
    return null;
}

/**
 * Check if the hunter should perform a block clutch (place block below while falling).
 */
export function checkBlockClutch(hunter, inventory) {
    try {
        const pos = hunter.location;
        const vel = hunter.getVelocity();
        const dim = hunter.dimension;

        if (vel.y > -0.5) return null;
        if (inventory.hasWaterBucket()) return null;

        const block = inventory.getBridgeBlock();
        if (!block) return null;

        const fx = Math.floor(pos.x), fy = Math.floor(pos.y) - 1, fz = Math.floor(pos.z);

        const belowBlock = dim.getBlock({ x: fx, y: fy, z: fz });
        if (!belowBlock || belowBlock.typeId !== "minecraft:air") return null;

        const offsets = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
        for (const off of offsets) {
            const adj = dim.getBlock({ x: fx + off.x, y: fy, z: fz + off.z });
            if (adj && adj.typeId !== "minecraft:air" && adj.typeId !== "minecraft:water" && adj.typeId !== "minecraft:lava") {
                return {
                    type: "place_block",
                    blockPos: { x: fx, y: fy, z: fz },
                    blockType: block,
                    showItem: block,
                    stopMovement: true
                };
            }
        }
    } catch (_) { }
    return null;
}

/**
 * Check if the hunter is stuck in a cave and needs to escape.
 */
export function checkCaveEscape(hunter, inventory, stuckTicks) {
    if (stuckTicks < 60) return null;

    try {
        const pos = hunter.location;
        const dim = hunter.dimension;
        const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);

        let ceilingFound = false;
        for (let y = cy + 2; y <= cy + 4; y++) {
            const b = dim.getBlock({ x: cx, y, z: cz });
            if (b && b.typeId !== "minecraft:air") { ceilingFound = true; break; }
        }

        let sidesBlocked = 0;
        const sides = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
        for (const s of sides) {
            const b = dim.getBlock({ x: cx + s.x, y: cy, z: cz + s.z });
            if (b && b.typeId !== "minecraft:air") sidesBlocked++;
        }

        if (!ceilingFound && sidesBlocked < 3) return null;

        const aboveHead = dim.getBlock({ x: cx, y: cy + 2, z: cz });
        if (aboveHead && aboveHead.typeId !== "minecraft:air") {
            return {
                type: "break_block",
                blockPos: { x: cx, y: cy + 2, z: cz },
                showTool: inventory.getBestPickaxe()
            };
        }

        const bridgeBlock = inventory.getBridgeBlock();
        if (bridgeBlock) {
            return {
                type: "pillar_step",
                phase: "jump",
                blockPos: { x: cx, y: cy, z: cz },
                blockType: bridgeBlock,
                showItem: bridgeBlock
            };
        }
    } catch (_) { }
    return null;
}

/**
 * Perform retreat behavior — move away from the target.
 */
export function tickRetreat(hunter, target, inventory) {
    if (!inventory) return;

    try {
        const hPos = hunter.location;
        const tPos = target.location;
        const dx = hPos.x - tPos.x;
        const dz = hPos.z - tPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 10 && dist > 0.5) {
            const nx = dx / dist;
            const nz = dz / dist;
            hunter.applyImpulse({ x: nx * 0.06, y: 0, z: nz * 0.06 });
        }
    } catch (_) { }
}

/**
 * Clean up temporary water/lava blocks that have expired.
 */
export function cleanTempWater(hunter, tempWaterBlocks, mlgWaterBlocks, inventory) {
    const now = system.currentTick;

    if (mlgWaterBlocks.length > 0 && inventory) {
        try {
            const vel = hunter.getVelocity();
            const pos = hunter.location;
            const landed = Math.abs(vel.y) < 0.15 && Math.abs(vel.x) < 0.3 && Math.abs(vel.z) < 0.3;

            if (landed) {
                for (let i = mlgWaterBlocks.length - 1; i >= 0; i--) {
                    const entry = mlgWaterBlocks[i];
                    const dx = Math.abs(Math.floor(pos.x) - entry.pos.x);
                    const dz = Math.abs(Math.floor(pos.z) - entry.pos.z);
                    const dy = Math.abs(Math.floor(pos.y) - entry.pos.y);
                    if (dx <= 2 && dz <= 2 && dy <= 3) {
                        try {
                            const dim = hunter.dimension;
                            const b = dim.getBlock(entry.pos);
                            if (b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water")) {
                                b.setPermutation(BlockPermutation.resolve("minecraft:air"));
                                inventory.removeItem("minecraft:bucket", 1);
                                inventory.addItem("minecraft:water_bucket", 1);
                                inventory.equipWeapon(hunter);
                            }
                        } catch (_) { }
                        const idx = tempWaterBlocks.findIndex(e => e.pos.x === entry.pos.x && e.pos.y === entry.pos.y && e.pos.z === entry.pos.z);
                        if (idx !== -1) tempWaterBlocks.splice(idx, 1);
                        mlgWaterBlocks.splice(i, 1);
                    }
                }
            }
        } catch (_) { }
    }

    for (let i = tempWaterBlocks.length - 1; i >= 0; i--) {
        if (now >= tempWaterBlocks[i].removeTick) {
            try {
                const dim = hunter.dimension;
                const b = dim.getBlock(tempWaterBlocks[i].pos);
                if (b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water" || b.typeId === "minecraft:lava")) {
                    b.setPermutation(BlockPermutation.resolve("minecraft:air"));
                }
            } catch (_) { }
            tempWaterBlocks.splice(i, 1);
        }
    }
}

function findGroundBelow(dim, pos, maxDist = 50) {
    try {
        for (let y = Math.floor(pos.y) - 1; y >= Math.max(Math.floor(pos.y) - maxDist, -64); y--) {
            const block = dim.getBlock({ x: Math.floor(pos.x), y, z: Math.floor(pos.z) });
            if (block && block.typeId !== "minecraft:air") return y + 1;
        }
    } catch (_) { }
    return null;
}

function isReplaceable(typeId) {
    return typeId === "minecraft:air" || typeId === "minecraft:short_grass" ||
        typeId === "minecraft:tall_grass" || typeId === "minecraft:dead_bush";
}