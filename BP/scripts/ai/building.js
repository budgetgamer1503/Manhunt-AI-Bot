/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation } from "@minecraft/server";
export function executeBridgeStep(hunter, inventory, action, dim) {
    if (action.phase === "stop") {
        cancelVelocity(hunter);
        if (action.direction) {
            orientHunter(hunter, action.direction);
        }
        inventory.showItemInHand(hunter, action.blockType, "placing", 12);
    } else if (action.phase === "place") {
        cancelVelocity(hunter);
        if (action.direction) {
            orientHunter(hunter, action.direction);
        }
        const block = dim.getBlock(action.blockPos);
        if (block && isReplaceable(block.typeId)) {
            block.setPermutation(BlockPermutation.resolve(action.blockType));
            inventory.removeItem(action.blockType, 1);
        }
    } else if (action.phase === "walk") {
        if (action.direction) {
            orientHunter(hunter, action.direction);
        }
        try {
            hunter.applyImpulse({
                x: action.direction.x * 0.15,
                y: 0,
                z: action.direction.z * 0.15
            });
        } catch (_) { }
    }
}
export function executePillarStep(hunter, inventory, action, dim) {
    if (action.phase === "jump") {
        cancelVelocity(hunter);
        if (action.lookDirection) {
            orientHunter(hunter, action.lookDirection);
        }
        inventory.showItemInHand(hunter, action.blockType, "placing", 12);
        try {
            hunter.applyImpulse({ x: 0, y: 0.5, z: 0 });
        } catch (_) { }
    } else if (action.phase === "place") {
        if (action.lookDirection) {
            orientHunter(hunter, action.lookDirection);
        }
        cancelVelocity(hunter);
        const pBlock = dim.getBlock(action.blockPos);
        if (pBlock && isReplaceable(pBlock.typeId)) {
            pBlock.setPermutation(BlockPermutation.resolve(action.blockType));
            inventory.removeItem(action.blockType, 1);
        }
    }
}
export function executePlaceWater(hunter, inventory, action, dim) {
    const block = dim.getBlock(action.blockPos);
    if (block && (block.typeId === "minecraft:air" || block.typeId === "minecraft:lava" ||
        isReplaceable(block.typeId))) {
        inventory.forceShowItemInHand(hunter, "minecraft:water_bucket", "placing", 20);
        block.setPermutation(BlockPermutation.resolve("minecraft:water"));
        inventory.removeItem("minecraft:water_bucket", 1);
        inventory.addItem("minecraft:bucket", 1);
    }
}
export function executePlaceBlock(hunter, inventory, action, dim) {
    if (action.stopMovement) {
        try { hunter.applyImpulse({ x: 0, y: 0, z: 0 }); } catch (_) { }
        cancelVelocity(hunter);
    }
    const block = dim.getBlock(action.blockPos);
    if (block && (block.typeId === "minecraft:air" || block.typeId === "minecraft:lava")) {
        inventory.showItemInHand(hunter, action.blockType, "placing", 8);
        block.setPermutation(BlockPermutation.resolve(action.blockType));
        inventory.removeItem(action.blockType, 1);
    }
}
export function executeBreakBlock(hunter, inventory, action, dim) {
    const bBlock = dim.getBlock(action.blockPos);
    if (bBlock && bBlock.typeId !== "minecraft:air") {
        if (action.showTool) {
            inventory.showItemInHand(hunter, action.showTool, "mining", 15);
        } else {
            try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
        }
    }
}
function cancelVelocity(hunter) {
    try {
        const vel = hunter.getVelocity();
        hunter.applyImpulse({
            x: -vel.x * 0.8,
            y: 0,
            z: -vel.z * 0.8
        });
    } catch (_) { }
}
function orientHunter(hunter, direction) {
    try {
        const pos = hunter.location;
        hunter.teleport(pos, {
            facingLocation: {
                x: pos.x + direction.x,
                y: pos.y,
                z: pos.z + direction.z
            }
        });
    } catch (_) { }
}
function isReplaceable(typeId) {
    return typeId === "minecraft:air" || typeId === "minecraft:short_grass" ||
        typeId === "minecraft:tall_grass" || typeId === "minecraft:dead_bush";
}