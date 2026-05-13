/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * Gathering and mining behaviors for the hunter AI.
 * Extracted from state_machine.js for v0.7.0 modular refactor.
 */

import { BlockPermutation } from "@minecraft/server";

/**
 * Start mining a block at the given position.
 */
export function startMining(hunter, inventory, blockPos) {
    try {
        const dim = hunter.dimension;
        const block = dim.getBlock(blockPos);
        if (!block || block.typeId === "minecraft:air") return null;

        const typeId = block.typeId;
        const duration = inventory.getMiningDuration(typeId);
        if (duration <= 0) return null;

        const tool = inventory.getMiningTool(typeId);
        if (tool) {
            inventory.showItemInHand(hunter, tool, "mining", duration + 5);
        } else {
            try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
        }

        return {
            pos: { x: blockPos.x, y: blockPos.y, z: blockPos.z },
            typeId: typeId,
            ticksLeft: duration
        };
    } catch (_) { }
    return null;
}

/**
 * Finish mining — break the block and collect drops.
 */
export function finishMining(hunter, inventory, miningTarget) {
    if (!miningTarget) return;

    try {
        const dim = hunter.dimension;
        const block = dim.getBlock(miningTarget.pos);
        if (block && block.typeId === miningTarget.typeId) {
            block.setPermutation(BlockPermutation.resolve("minecraft:air"));
            const drop = inventory.getMiningDrop(miningTarget.typeId);
            if (drop) {
                inventory.addItem(drop.typeId, drop.amount);
            }
        }
    } catch (_) { }

    try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
}

/**
 * Find a gathering target in prep mode based on what the hunter needs.
 */
export function findPrepGatherTarget(hunter, inventory, profile) {
    try {
        const pos = hunter.location;
        const dim = hunter.dimension;
        const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
        const feetY = fy - 1;

        const logCount = inventory.countItem("minecraft:oak_log") + inventory.countItem("minecraft:oak_planks") / 4;
        const stoneCount = inventory.countItem("minecraft:cobblestone");
        const ironCount = inventory.countItem("minecraft:raw_iron") + inventory.countItem("minecraft:iron_ingot");

        let targetBlocks = [];
        if (logCount < profile.prepLogTarget) {
            targetBlocks.push(
                "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
                "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
                "minecraft:mangrove_log", "minecraft:cherry_log"
            );
        }
        if (stoneCount < profile.prepStoneTarget) {
            targetBlocks.push("minecraft:stone", "minecraft:cobblestone");
        }
        if (ironCount < profile.prepIronTarget) {
            targetBlocks.push("minecraft:iron_ore", "minecraft:deepslate_iron_ore");
        }
        if (inventory.getBridgeBlockCount() < 32) {
            targetBlocks.push("minecraft:dirt", "minecraft:grass_block", "minecraft:gravel", "minecraft:sand");
        }

        if (targetBlocks.length === 0) return null;

        let closest = null;
        let closestDist = Infinity;

        for (let x = -profile.prepGatherRadius; x <= profile.prepGatherRadius; x++) {
            for (let y = -2; y <= 3; y++) {
                for (let z = -profile.prepGatherRadius; z <= profile.prepGatherRadius; z++) {
                    const bx = fx + x;
                    const by = fy + y;
                    const bz = fz + z;

                    if (by === feetY && bx === fx && bz === fz) continue;

                    try {
                        const block = dim.getBlock({ x: bx, y: by, z: bz });
                        if (block && targetBlocks.includes(block.typeId)) {
                            const dist = Math.abs(x) + Math.abs(y) + Math.abs(z);
                            if (dist < closestDist) {
                                closestDist = dist;
                                closest = { block, typeId: block.typeId, pos: { x: bx, y: by, z: bz } };
                            }
                        }
                    } catch (_) { }
                }
            }
        }
        return closest;
    } catch (_) { }
    return null;
}

/**
 * Place a utility block (crafting table, furnace) near the hunter.
 */
export function placeUtility(hunter, blockType) {
    try {
        const dim = hunter.dimension;
        const pos = hunter.location;
        const offsets = [
            { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
        ];
        for (const off of offsets) {
            const p = {
                x: Math.floor(pos.x) + off.x,
                y: Math.floor(pos.y),
                z: Math.floor(pos.z) + off.z
            };
            const b = dim.getBlock(p);
            if (b?.typeId === "minecraft:air") {
                b.setPermutation(BlockPermutation.resolve(blockType));
                return;
            }
        }
    } catch (_) { }
}