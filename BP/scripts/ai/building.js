/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { BlockPermutation } from "@minecraft/server";
import { getProfile } from "./profiles.js";

export class BuildingSystem {
    constructor(brain) {
        this.brain = brain;
        this.bridgeState = null;
        this.pillarState = null;
        this.parkourJumpAction = null;
        this.parkourJumpDelay = 0;
        this.isBuilding = false;
    }

    get hunter() { return this.brain.hunter; }
    get target() { return this.brain.target; }
    get inventory() { return this.brain.inventory; }
    get cooldowns() { return this.brain.cooldowns; }
    get profile() { return getProfile(this.brain.aiLevel); }

    reset() {
        this.bridgeState = null;
        this.pillarState = null;
        this.parkourJumpAction = null;
        this.parkourJumpDelay = 0;
        this.isBuilding = false;
    }

    isActive() { return this.isBuilding || this.bridgeState !== null || this.pillarState !== null || this.parkourJumpAction !== null; }

    tickBridge() {
        const bs = this.bridgeState;
        const h = this.hunter;
        const inv = this.inventory;
        if (!bs || !inv) { this.bridgeState = null; return; }

        bs.phaseTicksLeft--;

        if (bs.phase === "stop") {
            if (bs.phaseTicksLeft <= 0) {
                bs.phase = "place";
                bs.phaseTicksLeft = 1;
                try {
                    const pos = h.location;
                    const bx = Math.floor(pos.x + bs.direction.x * 1.0);
                    const bz = Math.floor(pos.z + bs.direction.z * 1.0);
                    const by = Math.floor(pos.y) - 1;
                    this._execBridgeStep(h, inv, { phase: "place", blockPos: { x: bx, y: by, z: bz }, blockType: bs.blockType, direction: bs.direction });
                    bs.blocksPlaced++;
                } catch (_) { this.bridgeState = null; }
            } else {
                this._execBridgeStep(h, inv, { phase: "stop", blockType: bs.blockType });
            }
        } else if (bs.phase === "place") {
            if (bs.phaseTicksLeft <= 0) {
                bs.phase = "walk";
                bs.phaseTicksLeft = 3;
                this._execBridgeStep(h, inv, { phase: "walk", direction: bs.direction });
            }
        } else if (bs.phase === "walk") {
            if (bs.phaseTicksLeft <= 0) {
                if (bs.blocksPlaced < bs.gapSize && inv.hasItem(bs.blockType)) {
                    bs.phase = "stop";
                    bs.phaseTicksLeft = 1;
                    this._execBridgeStep(h, inv, { phase: "stop", blockType: bs.blockType });
                } else {
                    this.bridgeState = null;
                    this.brain.stuckTicks = 0;
                    this._exitBuilding();
                    try { h.triggerEvent("manhunt:set_action_none"); } catch (_) { }
                    if (inv) inv.equipWeapon(h);
                }
            } else {
                this._execBridgeStep(h, inv, { phase: "walk", direction: bs.direction });
            }
        }
    }

    tickPillar() {
        const ps = this.pillarState;
        const h = this.hunter;
        const inv = this.inventory;
        if (!ps || !inv) { this.pillarState = null; return; }

        ps.phaseTicksLeft--;

        if (ps.phase === "jump") {
            if (ps.phaseTicksLeft <= 0) {
                try {
                    const vel = h.getVelocity();
                    const pos = h.location;
                    ps.jumpTicks++;
                    if (pos.y > ps.originalY + 0.35 || vel.y <= 0.18 || ps.jumpTicks >= 4) {
                        ps.phase = "place";
                        ps.phaseTicksLeft = 1;
                        const fx = Math.floor(pos.x), fy = ps.originalY, fz = Math.floor(pos.z);
                        this._execPillarStep(h, inv, { phase: "place", blockType: ps.blockType, blockPos: { x: fx, y: fy, z: fz }, lookDirection: ps.lookDirection });
                    } else {
                        ps.phaseTicksLeft = 1;
                    }
                } catch (_) { this.pillarState = null; }
            }
        } else if (ps.phase === "place") {
            this.pillarState = null;
            this.brain.stuckTicks = 0;
            this._exitBuilding();
        }
    }

    tickParkourJump() {
        if (!this.parkourJumpAction || this.parkourJumpDelay <= 0) return;
        this.parkourJumpDelay--;
        if (this.parkourJumpDelay <= 0) {
            try {
                const vel = this.hunter.getVelocity();
                if (vel.y >= -0.08 && vel.y <= 0.08) {
                    this.hunter.applyImpulse(this.parkourJumpAction);
                }
            } catch (_) { }
            this.parkourJumpAction = null;
            this._exitBuilding();
        }
    }

    startBridge(action) {
        this._enterBuilding();
        this.bridgeState = {
            phase: "stop",
            direction: action.direction,
            blockType: action.blockType,
            blocksPlaced: 0,
            gapSize: action.gapSize || 6,
            phaseTicksLeft: 2
        };
        this._execBridgeStep(this.hunter, this.inventory, { phase: "stop", blockType: action.blockType });
    }

    startPillar(action) {
        try {
            this._enterBuilding();
            this.pillarState = {
                phase: "jump",
                blockType: action.blockType,
                originalY: Math.floor(this.hunter.location.y),
                phaseTicksLeft: 1,
                jumpTicks: 0,
                lookDirection: action.lookDirection || { x: 1, z: 0 }
            };
            this._execPillarStep(this.hunter, this.inventory, { phase: "jump", blockType: action.blockType, blockPos: action.blockPos, lookDirection: this.pillarState.lookDirection });
        } catch (_) {
            this.pillarState = null;
            this._exitBuilding();
        }
    }

    startParkourJump(jumpAction, delay) {
        this._enterBuilding();
        this.parkourJumpAction = jumpAction;
        this.parkourJumpDelay = delay || 2;
    }

    executeAction(action) {
        if (!action) return;
        const h = this.hunter;
        const inv = this.inventory;
        const dim = h.dimension;

        try {
            switch (action.type) {
                case "impulse":
                    h.applyImpulse({ x: action.x, y: action.y, z: action.z });
                    break;
                case "place_water": {
                    const block = dim.getBlock(action.blockPos);
                    if (block && (block.typeId === "minecraft:air" || block.typeId === "minecraft:lava" || this._isReplaceable(block.typeId))) {
                        inv.forceShowItemInHand(h, "minecraft:water_bucket", "placing", 20);
                        block.setPermutation(BlockPermutation.resolve("minecraft:water"));
                        inv.removeItem("minecraft:water_bucket", 1);
                        inv.addItem("minecraft:bucket", 1);
                    }
                    break;
                }
                case "place_block": {
                    if (action.stopMovement) {
                        try { h.applyImpulse({ x: 0, y: 0, z: 0 }); } catch (_) { }
                        this._cancelVelocity(h);
                    }
                    const block = dim.getBlock(action.blockPos);
                    if (block && (block.typeId === "minecraft:air" || block.typeId === "minecraft:lava")) {
                        inv.showItemInHand(h, action.blockType, "placing", 8);
                        block.setPermutation(BlockPermutation.resolve(action.blockType));
                        inv.removeItem(action.blockType, 1);
                    }
                    break;
                }
                case "lava_bridge":
                    try { h.applyImpulse(action.impulse); } catch (_) { }
                    break;
                case "pillar_step":
                    this._execPillarStep(h, inv, action);
                    break;
                case "bridge_step":
                    this._execBridgeStep(h, inv, action);
                    break;
                case "break_block": {
                    const bBlock = dim.getBlock(action.blockPos);
                    if (bBlock && bBlock.typeId !== "minecraft:air") {
                        if (action.showTool) inv.showItemInHand(h, action.showTool, "mining", 15);
                        else try { h.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
                    }
                    break;
                }
                case "parkour_jump":
                    try { h.applyImpulse(action.sprint); } catch (_) { }
                    break;
            }
        } catch (_) { }
    }

    _execBridgeStep(hunter, inventory, action) {
        const dim = hunter.dimension;
        if (action.phase === "stop") {
            this._cancelVelocity(hunter);
            if (action.direction) this._orientHunter(hunter, action.direction);
            inventory.showItemInHand(hunter, action.blockType, "placing", 12);
        } else if (action.phase === "place") {
            this._cancelVelocity(hunter);
            if (action.direction) this._orientHunter(hunter, action.direction);
            const block = dim.getBlock(action.blockPos);
            if (block && this._isReplaceable(block.typeId)) {
                block.setPermutation(BlockPermutation.resolve(action.blockType));
                inventory.removeItem(action.blockType, 1);
            }
        } else if (action.phase === "walk") {
            if (action.direction) this._orientHunter(hunter, action.direction);
            try { hunter.applyImpulse({ x: action.direction.x * 0.15, y: 0, z: action.direction.z * 0.15 }); } catch (_) { }
        }
    }

    _execPillarStep(hunter, inventory, action) {
        const dim = hunter.dimension;
        if (action.phase === "jump") {
            this._cancelVelocity(hunter);
            if (action.lookDirection) this._orientHunter(hunter, action.lookDirection);
            inventory.showItemInHand(hunter, action.blockType, "placing", 12);
            try { hunter.applyImpulse({ x: 0, y: 0.5, z: 0 }); } catch (_) { }
        } else if (action.phase === "place") {
            if (action.lookDirection) this._orientHunter(hunter, action.lookDirection);
            this._cancelVelocity(hunter);
            const block = dim.getBlock(action.blockPos);
            if (block && this._isReplaceable(block.typeId)) {
                block.setPermutation(BlockPermutation.resolve(action.blockType));
                inventory.removeItem(action.blockType, 1);
            }
        }
    }

    _enterBuilding() {
        if (this.isBuilding) return;
        this.isBuilding = true;
        try { this.hunter.triggerEvent("manhunt:enter_building"); } catch (_) { }
    }

    _exitBuilding() {
        if (!this.isBuilding) return;
        this.isBuilding = false;
        try { this.hunter.triggerEvent("manhunt:enter_chase"); } catch (_) { }
    }

    forceExit() {
        if (this.isBuilding) this._exitBuilding();
        this.bridgeState = null;
        this.pillarState = null;
        this.parkourJumpAction = null;
    }

    _cancelVelocity(hunter) {
        try {
            const vel = hunter.getVelocity();
            hunter.applyImpulse({ x: -vel.x * 0.8, y: 0, z: -vel.z * 0.8 });
        } catch (_) { }
    }

    _orientHunter(hunter, direction) {
        try {
            const pos = hunter.location;
            hunter.teleport(pos, { facingLocation: { x: pos.x + direction.x, y: pos.y, z: pos.z + direction.z } });
        } catch (_) { }
    }

    _isReplaceable(typeId) {
        return typeId === "minecraft:air" || typeId === "minecraft:short_grass" || typeId === "minecraft:tall_grass" || typeId === "minecraft:dead_bush";
    }
}