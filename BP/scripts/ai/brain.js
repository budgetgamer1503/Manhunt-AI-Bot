/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, world } from "@minecraft/server";
import { CooldownManager } from "./cooldowns.js";
import { getProfile } from "./profiles.js";
import { CombatSystem } from "./combat.js";
import { SurvivalSystem } from "./survival.js";
import { BuildingSystem } from "./building.js";
import { GatheringSystem } from "./gathering.js";
import {
    checkLavaEscape, checkWaterMLG, checkBlockClutch, checkCaveEscape,
    checkPillarUp, checkParkourJump, checkBridging, executeAction,
    checkWeatherShelter
} from "../movement.js";

const TICK_RATE = 2;

export class AIBrain {
    constructor() {
        this.state = "idle";
        this.cooldowns = new CooldownManager();
        this.combat = new CombatSystem(this);
        this.survival = new SurvivalSystem(this);
        this.building = new BuildingSystem(this);
        this.gathering = new GatheringSystem(this);

        this.hunter = null;
        this.target = null;
        this.inventory = null;
        this.aiLevel = "normal";
        this.enableTaunts = true;
        this.boatHandling = "destroy";

        this.lastX = 0;
        this.lastZ = 0;
        this.blocksTraveled = 0;
        this.stuckTicks = 0;

        this.tempWaterBlocks = [];
        this.mlgWaterBlocks = [];

        this._intervalId = null;
    }

    get profile() { return getProfile(this.aiLevel); }

    start(hunter, target, inventory, aiLevel, enableTaunts, boatHandling) {
        if (this._intervalId !== null) return;

        this.hunter = hunter;
        this.target = target;
        this.inventory = inventory;
        this.aiLevel = aiLevel || "normal";
        this.enableTaunts = enableTaunts !== undefined ? enableTaunts : true;
        this.boatHandling = boatHandling || "destroy";

        this.state = "chase";
        this.blocksTraveled = 0;
        this.stuckTicks = 0;
        this.tempWaterBlocks = [];
        this.mlgWaterBlocks = [];

        this.cooldowns.resetAll();
        this.combat.reset();
        this.survival.reset();
        this.building.reset();
        this.gathering.reset();

        try {
            const p = hunter.location;
            this.lastX = p.x;
            this.lastZ = p.z;
        } catch (_) { }

        try { hunter.triggerEvent("manhunt:enter_chase"); } catch (_) { }
        if (inventory) try { inventory.equipBest(hunter); } catch (_) { }

        this._intervalId = system.runInterval(() => {
            try { this._tick(); } catch (_) { }
        }, TICK_RATE);
    }

    stop() {
        if (this._intervalId !== null) {
            system.clearRun(this._intervalId);
            this._intervalId = null;
        }
        this.state = "idle";
        this.cooldowns.resetAll();
        this.combat.reset();
        this.survival.reset();
        this.building.reset();
        this.gathering.reset();
        this.tempWaterBlocks = [];
        this.mlgWaterBlocks = [];

        if (this.inventory) this.inventory.resetTempEquip();
    }

    forceChase() {
        this.building.forceExit();
        if (this.state !== "chase") {
            this._switchToChase();
        } else {
            try { this.hunter.triggerEvent("manhunt:enter_chase"); } catch (_) { }
        }
    }

    _tick() {
        const h = this.hunter;
        const t = this.target;
        const inv = this.inventory;

        if (!h || !t) {
            if (!h && t) this.stop();
            return;
        }

        if (inv) inv.tickTempEquip(h);

        this._updateMovement();
        this.survival.updateFallTicks();
        this.survival.checkAntiTrap();
        this.survival.cleanTempWater();
        this._handleNearbyBoats();

        if (this.building.bridgeState) {
            this.building.tickBridge();
            return;
        }
        if (this.building.pillarState) {
            this.building.tickPillar();
            return;
        }
        if (this.building.parkourJumpAction) {
            this.building.tickParkourJump();
            return;
        }

        const survivalAction = this._checkSurvival();
        if (survivalAction) {
            if (survivalAction.type === "bridge_step") {
                this.building.startBridge(survivalAction);
                return;
            }
            if (survivalAction.type === "pillar_step") {
                this.building.startPillar(survivalAction);
                return;
            }

            this.building.executeAction(survivalAction);

            if (survivalAction.type === "place_water") {
                const entry = { pos: { ...survivalAction.blockPos }, removeTick: system.currentTick + 60 };
                if (survivalAction.tempWater) this.mlgWaterBlocks.push(entry);
                this.tempWaterBlocks.push(entry);
            }
            if (survivalAction.type === "parkour_jump") {
                this.building.startParkourJump(survivalAction.jump, survivalAction.jumpDelay || 2);
            }
            return;
        }

        if (this.gathering.miningTarget) {
            this.gathering.tickMining();
            return;
        }

        const healthChange = this.survival.checkHealthState();
        if (healthChange === "retreat" && this.state !== "retreat") {
            this._switchToRetreat();
        } else if (healthChange === "chase" && this.state === "retreat") {
            this._switchToChase();
        }

        switch (this.state) {
            case "chase":
                this._tickChase();
                break;
            case "prep":
                this._tickPrep();
                break;
            case "retreat":
                this.survival.tickRetreat();
                break;
            default:
                this._switchToChase();
                break;
        }
    }

    _tickChase() {
        const h = this.hunter;
        const t = this.target;
        const inv = this.inventory;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !t || !inv) return;

        const hPos = h.location;
        const tPos = t.location;
        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > p.catchupDistance && cd.isReady("catchup")) {
            const nx = dx / dist;
            const nz = dz / dist;
            const newX = tPos.x - nx * p.catchupPlaceDist;
            const newZ = tPos.z - nz * p.catchupPlaceDist;
            try {
                const dim = h.dimension;
                let newY = tPos.y;
                for (let y = Math.floor(tPos.y) + 5; y >= Math.max(tPos.y - 10, -64); y--) {
                    const b = dim.getBlock({ x: Math.floor(newX), y, z: Math.floor(newZ) });
                    if (b && b.typeId !== "minecraft:air" && b.typeId !== "minecraft:water") { newY = y + 1; break; }
                }
                h.teleport({ x: newX, y: newY, z: newZ });
                cd.set("catchup", p.cdCatchup);
            } catch (_) { }
        }

        this.combat.tick();

        if (inv && inv.getBridgeBlockCount() < 4 && cd.isReady("mining") && !this.gathering.miningTarget && dist > 15) {
            const result = this.gathering.findGatherTarget();
            if (result) {
                this.gathering.startMiningFromResult(result);
                cd.set("mining", p.cdMining);
            }
        }

        if (this.blocksTraveled >= p.prepTravelBlocks && dist > p.prepEnterDist) {
            this._switchToPrep();
        }
    }

    _tickPrep() {
        const result = this.gathering.tickPrep();
        if (result === "exit_prep") {
            this.blocksTraveled = 0;
            this._switchToChase();
        }
    }

    _checkSurvival() {
        const h = this.hunter;
        const inv = this.inventory;
        const t = this.target;
        const cd = this.cooldowns;
        const p = this.profile;

        if (!h || !inv) return null;

        const survival = this.survival.checkSurvival();
        if (survival) {
            if (survival.type === "break_block") {
                this.gathering.startMiningFromResult({ pos: survival.blockPos });
            }
            return survival;
        }

        if (cd.isReady("parkour")) {
            const park = checkParkourJump(h);
            if (park) { cd.set("parkour", p.cdParkour); return park; }
        }

        if (t && cd.isReady("place")) {
            const pillar = checkPillarUp(h, inv, t);
            if (pillar) { cd.set("place", p.cdPlace * 4); return pillar; }
        }

        if (t && cd.isReady("place") && this.stuckTicks >= 15) {
            const bridge = checkBridging(h, inv, t, this.stuckTicks);
            if (bridge) {
                cd.set("place", p.cdPlace);
                if (bridge.type === "parkour_jump") cd.set("parkour", p.cdParkour);
                this.stuckTicks = Math.max(0, this.stuckTicks - 5);
                return bridge;
            }
        }

        return null;
    }

    _updateMovement() {
        try {
            const pos = this.hunter.location;
            const dx = pos.x - this.lastX;
            const dz = pos.z - this.lastZ;
            const moved = Math.sqrt(dx * dx + dz * dz);
            this.blocksTraveled += moved;
            if (moved < 0.05) this.stuckTicks++;
            else this.stuckTicks = 0;
            this.lastX = pos.x;
            this.lastZ = pos.z;
        } catch (_) { }
    }

    _handleNearbyBoats() {
        if (this.boatHandling === "ignore") return;
        try {
            const dim = this.hunter.dimension;
            const pos = this.hunter.location;
            try { this.hunter.runCommand("ride @e[type=minecraft:boat,r=3] dismount"); } catch (_) { }
            const boats = dim.getEntities({ type: "minecraft:boat", location: pos, maxDistance: 10 });
            for (const boat of boats) {
                try {
                    boat.kill();
                    dim.playSound("random.break", boat.location, { volume: 0.5, pitch: 1.0 });
                    dim.spawnParticle("minecraft:block_destroy", boat.location, { block: "minecraft:oak_planks" });
                } catch (_) { }
            }
        } catch (_) { }
    }

    _switchToChase() {
        this.state = "chase";
        this.gathering.prepTicks = 0;
        this.combat.comboHits = 0;
        this.building.reset();
        this.gathering.miningTarget = null;
        try { this.hunter.triggerEvent("manhunt:enter_chase"); } catch (_) { }
        if (this.inventory) {
            this.inventory.resetTempEquip();
            try { this.inventory.equipBest(this.hunter); } catch (_) { }
        }
    }

    _switchToPrep() {
        this.state = "prep";
        this.gathering.prepTicks = 0;
        this.cooldowns.set("mining", 0);
        this.building.reset();
        try { this.hunter.triggerEvent("manhunt:enter_prep"); } catch (_) { }
    }

    _switchToRetreat() {
        this.state = "retreat";
        this.building.reset();
    }
}