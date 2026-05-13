/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation, system } from "@minecraft/server";

const TRAVEL_TIME_PROP = "manhunt:travel_time";
const TRAVEL_DISTANCE_PROP = "manhunt:travel_distance";
const TRAVEL_START_POS = "manhunt:travel_start_pos";
const TRAVEL_START_TIME = "manhunt:travel_start_time";

export function initTravelTime(hunter, distance, travelTime) {
    try {
        hunter.setDynamicProperty(TRAVEL_TIME_PROP, travelTime);
        hunter.setDynamicProperty(TRAVEL_DISTANCE_PROP, distance);
        hunter.setDynamicProperty(TRAVEL_START_POS, hunter.location);
        hunter.setDynamicProperty(TRAVEL_START_TIME, system.currentTick);
    } catch (_) { }
}

export function getRemainingTravelTime(hunter) {
    try {
        const startTime = hunter.getDynamicProperty(TRAVEL_START_TIME);
        const travelTime = hunter.getDynamicProperty(TRAVEL_TIME_PROP);
        if (!startTime || !travelTime) return 0;

        const elapsed = system.currentTick - startTime;
        return Math.max(0, travelTime - elapsed);
    } catch (_) {
        return 0;
    }
}

export function getTravelDistance(hunter) {
    try {
        return hunter.getDynamicProperty(TRAVEL_DISTANCE_PROP) || 0;
    } catch (_) {
        return 0;
    }
}


export function adjustMovementSpeed(hunter, target) {
    try {
        const travelTime = getRemainingTravelTime(hunter);
        const totalDistance = getTravelDistance(hunter);

        if (travelTime <= 0 || totalDistance <= 0) return 1.0;

        const currentPos = hunter.location;
        const targetPos = target.location;
        const distanceToTarget = Math.sqrt(
            Math.pow(targetPos.x - currentPos.x, 2) +
            Math.pow(targetPos.z - currentPos.z, 2)
        );

        const progress = 1 - (distanceToTarget / totalDistance);
        const baseSpeed = Math.min(1.0, Math.max(0.2, progress * 1.5));

        const terrainMod = getTerrainSpeedModifier(hunter);

        return baseSpeed * terrainMod;
    } catch (e) {
        console.error("Speed adjustment error: " + e);
        return 1.0;
    }
}

function getTerrainSpeedModifier(hunter) {
    try {
        const pos = hunter.location;
        const dim = hunter.dimension;
        const floorX = Math.floor(pos.x);
        const floorY = Math.floor(pos.y);
        const floorZ = Math.floor(pos.z);

        const blockBelow = dim.getBlock({ x: floorX, y: floorY - 1, z: floorZ });

        const blockAtSelf = dim.getBlock({ x: floorX, y: floorY, z: floorZ });

        if (blockAtSelf?.typeId === "minecraft:water") {
            return 1.0;
        }

        if (blockAtSelf?.typeId === "minecraft:lava") {
            return 0.5;
        }

        if (!blockBelow) return 1.0;

        switch (blockBelow.typeId) {
            case "minecraft:ice":
            case "minecraft:packed_ice":
            case "minecraft:blue_ice":
                return 1.3;
            case "minecraft:soul_sand":
                return 0.5;
            case "minecraft:water":
                return 0.8;
            case "minecraft:lava":
                return 0.7;
            case "minecraft:cobweb":
                return 0.3;
            default:
                return 1.0;
        }
    } catch (_) {
        return 1.0;
    }
}

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

export function checkPillarUp(hunter, inventory, target) {
    try {
        const pos = hunter.location;
        const tPos = target.location;
        const vel = hunter.getVelocity();
        const dim = hunter.dimension;

        const dy = tPos.y - pos.y;
        const horizDist = Math.sqrt((tPos.x - pos.x) ** 2 + (tPos.z - pos.z) ** 2);

        if (dy < 2 || horizDist > 8) return null;
        if (vel.y > 0.1 || vel.y < -0.3) return null;

        const bridgeBlock = inventory.getBridgeBlock();
        if (!bridgeBlock) return null;

        const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
        const below = dim.getBlock({ x: fx, y: fy - 1, z: fz });
        if (!below || below.typeId === "minecraft:air") return null;

        const direction = getSnappedDirection(tPos.x - pos.x, tPos.z - pos.z);

        return {
            type: "pillar_step",
            phase: "jump",
            blockPos: { x: fx, y: fy, z: fz },
            blockType: bridgeBlock,
            showItem: bridgeBlock,
            lookDirection: direction
        };
    } catch (_) { }
    return null;
}

export function checkParkourJump(hunter) {
    try {
        const pos = hunter.location;
        const vel = hunter.getVelocity();
        const dim = hunter.dimension;

        if (vel.y > 0.1 || vel.y < -0.1) return null;
        const speed = Math.sqrt(vel.x ** 2 + vel.z ** 2);
        if (speed < 0.05) return null;

        const nx = vel.x / speed;
        const nz = vel.z / speed;

        const floor = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) });
        if (!floor || floor.typeId === "minecraft:air") return null;

        const ahead = dim.getBlock({
            x: Math.floor(pos.x + nx * 1.5),
            y: Math.floor(pos.y) - 1,
            z: Math.floor(pos.z + nz * 1.5)
        });
        if (ahead?.typeId !== "minecraft:air") return null;

        for (let dist = 2; dist <= 4; dist++) {
            const land = dim.getBlock({
                x: Math.floor(pos.x + nx * dist),
                y: Math.floor(pos.y) - 1,
                z: Math.floor(pos.z + nz * dist)
            });
            if (land && land.typeId !== "minecraft:air") {
                const force = dist >= 3 ? 0.25 : 0.18;
                const jump = dist >= 4 ? 0.44 : 0.42;
                return {
                    type: "parkour_jump",
                    sprint: { x: nx * force, y: 0, z: nz * force },
                    jump: { x: nx * 0.08, y: jump, z: nz * 0.08 },
                    jumpDelay: 3
                };
            }
        }
    } catch (_) { }
    return null;
}

export function checkBridging(hunter, inventory, target, stuckTicks) {
    if (stuckTicks < 15) return null;

    try {
        const pos = hunter.location;
        const tPos = target.location;
        const dim = hunter.dimension;

        const dx = tPos.x - pos.x;
        const dz = tPos.z - pos.z;
        const dist = Math.sqrt(dx ** 2 + dz ** 2);

        if (dist > 50) return null;

        const snappedDirection = getSnappedDirection(dx, dz);
        const nx = snappedDirection.x;
        const nz = snappedDirection.z;

        let gapSize = 0;
        for (let d = 1; d <= 6; d++) {
            const b = dim.getBlock({
                x: Math.floor(pos.x + nx * d),
                y: Math.floor(pos.y) - 1,
                z: Math.floor(pos.z + nz * d)
            });
            if (!b || b.typeId === "minecraft:air" || b.typeId === "minecraft:lava" || b.typeId === "minecraft:water") {
                gapSize++;
            } else {
                break;
            }
        }

        if (gapSize > 0 && gapSize <= 3) {
            const force = gapSize >= 3 ? 0.25 : 0.18;
            const jump = gapSize >= 3 ? 0.44 : 0.42;
            return {
                type: "parkour_jump",
                sprint: { x: nx * force, y: 0, z: nz * force },
                jump: { x: nx * 0.06, y: jump, z: nz * 0.06 },
                jumpDelay: 3
            };
        }

        if (gapSize >= 4) {
            const bridgeBlock = inventory.getBridgeBlock();
            if (!bridgeBlock) return null;

            return {
                type: "bridge_step",
                phase: "stop",
                direction: snappedDirection,
                blockType: bridgeBlock,
                showItem: bridgeBlock,
                gapSize: gapSize
            };
        }
    } catch (_) { }
    return null;
}

export function executeAction(hunter, inventory, action) {
    if (!action) return;

    try {
        const dim = hunter.dimension;

        switch (action.type) {
            case "impulse":
                hunter.applyImpulse({ x: action.x, y: action.y, z: action.z });
                break;

            case "place_water": {
                const block = dim.getBlock(action.blockPos);
                if (block && (block.typeId === "minecraft:air" || block.typeId === "minecraft:lava" ||
                    isReplaceable(block.typeId))) {
                    inventory.forceShowItemInHand(hunter, "minecraft:water_bucket", "placing", 20);
                    block.setPermutation(BlockPermutation.resolve("minecraft:water"));
                    inventory.removeItem("minecraft:water_bucket", 1);
                    inventory.addItem("minecraft:bucket", 1);
                }
                break;
            }

            case "place_block": {
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
                break;
            }

            case "lava_bridge": {
                try { hunter.applyImpulse(action.impulse); } catch (_) { }
                break;
            }

            case "pillar_step": {
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
                break;
            }

            case "bridge_step": {
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
                break;
            }

            case "break_block": {
                const bBlock = dim.getBlock(action.blockPos);
                if (bBlock && bBlock.typeId !== "minecraft:air") {
                    if (action.showTool) {
                        inventory.showItemInHand(hunter, action.showTool, "mining", 15);
                    } else {
                        try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
                    }
                }
                break;
            }

            case "parkour_jump": {
                try { hunter.applyImpulse(action.sprint); } catch (_) { }
                break;
            }
        }
    } catch (_) { }
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

function getSnappedDirection(dx, dz) {
    if (Math.abs(dx) >= Math.abs(dz)) {
        return { x: Math.sign(dx) || 1, z: 0 };
    }
    return { x: 0, z: Math.sign(dz) || 1 };
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
