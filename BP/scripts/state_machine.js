/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, world, BlockPermutation } from "@minecraft/server";
import {
    getHunter, getTarget, getInventory, despawn,
    getEnableTaunts, getBoatHandling, getAILevel
} from "./entity_manager.js";
import {
    checkLavaEscape, checkWaterMLG, checkBlockClutch, checkCaveEscape,
    checkPillarUp, checkParkourJump, checkBridging, executeAction
} from "./movement.js";

const TICK_RATE = 2;

const AI_PROFILES = {
    easy: {
        catchupDistance: 96,
        catchupPlaceDist: 52,
        prepEnterDist: 48,
        prepExitDist: 26,
        prepTravelBlocks: 300,
        attackRange: 3.2,
        comboRange: 3.1,
        strafeRange: 3.6,
        jumpAttackMin: 3,
        jumpAttackMax: 5,
        sprintJumpMin: 10,
        sprintJumpMax: 34,
        lavaPourRange: 3.5,
        critChance: 0.15,
        critMultiplier: 1.2,
        cdCombo: 7,
        cdJumpAttack: 30,
        cdStrafe: 12,
        cdSprintJump: 24,
        cdEat: 12,
        cdTaunt: 360,
        cdTauntClose: 220,
        cdAttackAnim: 5,
        cdCatchup: 90,
        cdMining: 14,
        cdParkour: 16,
        cdPlace: 5,
        cdShield: 30,
        retreatHp: 7,
        retreatHealHp: 14,
        prepDuration: 700,
        prepGatherRadius: 4,
        prepLogTarget: 12,
        prepStoneTarget: 24,
        prepIronTarget: 2,
        gatherSearchRadius: 3,
        eatBelowHp: 12,
        shieldBlockChance: 0.2,
        jumpAttackChance: 0.25
    },
    normal: {
        catchupDistance: 80,
        catchupPlaceDist: 40,
        prepEnterDist: 40,
        prepExitDist: 30,
        prepTravelBlocks: 250,
        attackRange: 3.5,
        comboRange: 3.5,
        strafeRange: 4.0,
        jumpAttackMin: 3,
        jumpAttackMax: 6,
        sprintJumpMin: 8,
        sprintJumpMax: 40,
        lavaPourRange: 4,
        critChance: 0.33,
        critMultiplier: 1.5,
        cdCombo: 4,
        cdJumpAttack: 20,
        cdStrafe: 8,
        cdSprintJump: 15,
        cdEat: 15,
        cdTaunt: 300,
        cdTauntClose: 150,
        cdAttackAnim: 4,
        cdCatchup: 50,
        cdMining: 10,
        cdParkour: 10,
        cdPlace: 3,
        cdShield: 20,
        retreatHp: 4,
        retreatHealHp: 10,
        prepDuration: 600,
        prepGatherRadius: 5,
        prepLogTarget: 16,
        prepStoneTarget: 32,
        prepIronTarget: 3,
        gatherSearchRadius: 4,
        eatBelowHp: 14,
        shieldBlockChance: 0.5,
        jumpAttackChance: 0.5
    },
    expert: {
        catchupDistance: 64,
        catchupPlaceDist: 28,
        prepEnterDist: 32,
        prepExitDist: 36,
        prepTravelBlocks: 200,
        attackRange: 3.8,
        comboRange: 3.7,
        strafeRange: 4.5,
        jumpAttackMin: 2.5,
        jumpAttackMax: 7,
        sprintJumpMin: 6,
        sprintJumpMax: 48,
        lavaPourRange: 5,
        critChance: 0.45,
        critMultiplier: 1.8,
        cdCombo: 3,
        cdJumpAttack: 14,
        cdStrafe: 5,
        cdSprintJump: 10,
        cdEat: 10,
        cdTaunt: 220,
        cdTauntClose: 110,
        cdAttackAnim: 3,
        cdCatchup: 30,
        cdMining: 7,
        cdParkour: 6,
        cdPlace: 2,
        cdShield: 12,
        retreatHp: 3,
        retreatHealHp: 8,
        prepDuration: 450,
        prepGatherRadius: 6,
        prepLogTarget: 18,
        prepStoneTarget: 40,
        prepIronTarget: 4,
        gatherSearchRadius: 5,
        eatBelowHp: 16,
        shieldBlockChance: 0.65,
        jumpAttackChance: 0.7
    }
};

const TAUNTS = [
    "§c§oYou can run, but you can't hide...",
    "§c§oI can hear your heartbeat.",
    "§c§oGetting closer...",
    "§c§oDid you think you could escape?",
    "§c§oI see you.",
    "§c§oYou're making this too easy.",
    "§c§oRun faster.",
    "§c§oThe hunt never ends.",
    "§c§oI'm right behind you...",
    "§c§oNowhere left to run."
];

let aiIntervalId = null;
let state = "idle";

let tickCounter = 0;

let lastX = 0, lastZ = 0;
let blocksTraveled = 0;
let stuckTicks = 0;

let fallTicks = 0;

let cdCombo = 0, cdJumpAttack = 0, cdStrafe = 0, cdSprintJump = 0;
let cdAttackAnim = 0, cdCatchup = 0, cdShield = 0;
let comboHits = 0;
let strafeDir = 1;

let cdEat = 0, cdTaunt = 0, cdMining = 0, cdParkour = 0, cdPlace = 0;

let prepTicks = 0;
let smeltTimers = new Map();

let miningTarget = null;

let parkourJumpAction = null;
let parkourJumpDelay = 0;

let bridgeState = null;

let pillarState = null;

let tempWaterBlocks = [];
let mlgWaterBlocks = [];

let shieldTimerId = null;
let shieldActive = false;

let isBuilding = false;

function getProfile() {
    return AI_PROFILES[getAILevel()] ?? AI_PROFILES.normal;
}

export function getAIState() {
    return state;
}

export function startAI() {
    if (aiIntervalId !== null) return;

    state = "chase";
    tickCounter = 0;
    blocksTraveled = 0;
    stuckTicks = 0;
    fallTicks = 0;
    resetCooldowns();
    miningTarget = null;
    parkourJumpAction = null;
    bridgeState = null;
    pillarState = null;
    prepTicks = 0;
    smeltTimers.clear();
    tempWaterBlocks = [];
    mlgWaterBlocks = [];
    isBuilding = false;

    const hunter = getHunter();
    if (hunter) {
        try {
            const p = hunter.location;
            lastX = p.x; lastZ = p.z;
        } catch (_) { }
        try { hunter.triggerEvent("manhunt:enter_chase"); } catch (_) { }

        const inv = getInventory();
        if (inv) try { inv.equipBest(hunter); } catch (_) { }
    }

    aiIntervalId = system.runInterval(() => {
        try { tick(); } catch (_) { }
    }, TICK_RATE);
}

export function stopAI() {
    if (aiIntervalId !== null) {
        system.clearRun(aiIntervalId);
        aiIntervalId = null;
    }
    state = "idle";
    resetCooldowns();
    miningTarget = null;
    parkourJumpAction = null;
    bridgeState = null;
    pillarState = null;
    smeltTimers.clear();
    clearShield();
    tempWaterBlocks = [];
    mlgWaterBlocks = [];
    isBuilding = false;

    const inv = getInventory();
    if (inv) inv.resetTempEquip();
}

export function forceChaseMode() {
    if (isBuilding) {
        exitBuildingMode();
    }
    bridgeState = null;
    pillarState = null;
    parkourJumpAction = null;
    if (state !== "chase") {
        switchToChase();
    } else {
        const h = getHunter();
        if (h) {
            try { h.triggerEvent("manhunt:enter_chase"); } catch (_) { }
        }
    }
}

export function triggerAttack(hunter) {
    if (cdAttackAnim > 0) return;
    try {
        hunter.triggerEvent("manhunt:set_action_attacking");
        cdAttackAnim = getProfile().cdAttackAnim;
        system.runTimeout(() => {
            try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
        }, 8);
    } catch (_) { }
}

export function rollCrit(hunter) {
    const profile = getProfile();
    try {
        const vel = hunter.getVelocity();
        if (vel.y < -0.08 || Math.random() < profile.critChance) {
            return { isCrit: true, multiplier: profile.critMultiplier };
        }
    } catch (_) { }
    return { isCrit: false, multiplier: 1.0 };
}

export function handleDamage(hunter, inventory, cause, attacker) {
    if (shieldActive && inventory.hasShield() && Math.random() < getProfile().shieldBlockChance) {
        try {
            const hp = hunter.getComponent("minecraft:health");
            if (hp) {
                const heal = Math.min(2, hp.effectiveMax - hp.currentValue);
                if (heal > 0) hp.setCurrentValue(hp.currentValue + heal);
            }
        } catch (_) { }
        return;
    }

    if (inventory.isTempEquipActive()) {
        inventory.finishTempEquip(hunter);
    }
    inventory.equipWeapon(hunter);

    if ((cause === "projectile" || cause === "entityAttack") && inventory.hasShield()) {
        equipShield(hunter);
    }

    forceChaseMode();
}

function tick() {
    const hunter = getHunter();
    const target = getTarget();
    const inventory = getInventory();

    if (!hunter || !target) {
        if (!hunter && target) stopAI();
        if (hunter && !target) { despawn(true); stopAI(); }
        return;
    }

    tickCounter++;

    if (inventory) inventory.tickTempEquip(hunter);

    tickCooldowns();

    try {
        const pos = hunter.location;
        const dx = pos.x - lastX;
        const dz = pos.z - lastZ;
        const moved = Math.sqrt(dx * dx + dz * dz);
        blocksTraveled += moved;

        if (moved < 0.05) stuckTicks++;
        else stuckTicks = 0;

        lastX = pos.x; lastZ = pos.z;
    } catch (_) { }

    try {
        const vel = hunter.getVelocity();
        if (vel.y < -0.5) fallTicks++;
        else fallTicks = 0;
    } catch (_) { }

    cleanTempWater(hunter);

    handleNearbyBoats(hunter);

    if (bridgeState) {
        tickBridgeState(hunter, inventory);
        return;
    }

    if (pillarState) {
        tickPillarState(hunter, inventory);
        return;
    }

    if (parkourJumpAction && parkourJumpDelay > 0) {
        parkourJumpDelay--;
        if (parkourJumpDelay <= 0) {
            try {
                const vel = hunter.getVelocity();
                if (vel.y >= -0.08 && vel.y <= 0.08) {
                    hunter.applyImpulse(parkourJumpAction);
                }
            } catch (_) { }
            parkourJumpAction = null;
            exitBuildingMode(hunter);
        }
        return;
    }

    const survivalAction = checkSurvival(hunter, inventory, target);
    if (survivalAction) {
        if (survivalAction.type === "bridge_step") {
            startBridgeSequence(hunter, inventory, survivalAction);
            return;
        }
        if (survivalAction.type === "pillar_step") {
            startPillarSequence(hunter, inventory, survivalAction);
            return;
        }

        executeAction(hunter, inventory, survivalAction);

        if (survivalAction.type === "place_water") {
            const entry = {
                pos: { ...survivalAction.blockPos },
                removeTick: system.currentTick + 60
            };
            if (survivalAction.tempWater) {
                mlgWaterBlocks.push(entry);
            }
            tempWaterBlocks.push(entry);
        }
        if (survivalAction.type === "parkour_jump") {
            enterBuildingMode(hunter);
            parkourJumpAction = survivalAction.jump;
            parkourJumpDelay = survivalAction.jumpDelay || 2;
        }
        return;
    }

    if (miningTarget) {
        miningTarget.ticksLeft -= TICK_RATE;
        if (miningTarget.ticksLeft <= 0) {
            finishMining(hunter, inventory);
        }
        return;
    }

    try {
        const hp = hunter.getComponent("minecraft:health");
        const profile = getProfile();
        if (hp) {
            if (hp.currentValue <= profile.retreatHp && state !== "retreat") {
                switchToRetreat(hunter);
            } else if (hp.currentValue > profile.retreatHealHp && state === "retreat") {
                switchToChase(hunter);
            }
        }
    } catch (_) { }

    switch (state) {
        case "chase":
            tickChase(hunter, target, inventory);
            break;
        case "prep":
            tickPrep(hunter, target, inventory);
            break;
        case "retreat":
            tickRetreat(hunter, target, inventory);
            break;
        default:
            switchToChase(hunter);
            break;
    }
}

function startBridgeSequence(hunter, inventory, action) {
    enterBuildingMode(hunter);

    bridgeState = {
        phase: "stop",
        direction: action.direction,
        blockType: action.blockType,
        blocksPlaced: 0,
        gapSize: action.gapSize || 6,
        phaseTicksLeft: 2
    };

    executeAction(hunter, inventory, {
        type: "bridge_step",
        phase: "stop",
        blockType: action.blockType
    });
}

function tickBridgeState(hunter, inventory) {
    if (!bridgeState || !inventory) {
        bridgeState = null;
        return;
    }

    bridgeState.phaseTicksLeft--;

    if (bridgeState.phase === "stop") {
        if (bridgeState.phaseTicksLeft <= 0) {
            bridgeState.phase = "place";
            bridgeState.phaseTicksLeft = 1;

            try {
                const pos = hunter.location;
                const bx = Math.floor(pos.x + bridgeState.direction.x * 1.0);
                const bz = Math.floor(pos.z + bridgeState.direction.z * 1.0);
                const by = Math.floor(pos.y) - 1;

                executeAction(hunter, inventory, {
                    type: "bridge_step",
                    phase: "place",
                    blockPos: { x: bx, y: by, z: bz },
                    blockType: bridgeState.blockType,
                    direction: bridgeState.direction
                });
                bridgeState.blocksPlaced++;
            } catch (_) {
                bridgeState = null;
            }
        } else {
            executeAction(hunter, inventory, {
                type: "bridge_step",
                phase: "stop",
                blockType: bridgeState.blockType
            });
        }

    } else if (bridgeState.phase === "place") {
        if (bridgeState.phaseTicksLeft <= 0) {
            bridgeState.phase = "walk";
            bridgeState.phaseTicksLeft = 3;

            executeAction(hunter, inventory, {
                type: "bridge_step",
                phase: "walk",
                direction: bridgeState.direction
            });
        }

    } else if (bridgeState.phase === "walk") {
        if (bridgeState.phaseTicksLeft <= 0) {
            if (bridgeState.blocksPlaced < bridgeState.gapSize &&
                inventory.hasItem(bridgeState.blockType)) {
                bridgeState.phase = "stop";
                bridgeState.phaseTicksLeft = 1;

                executeAction(hunter, inventory, {
                    type: "bridge_step",
                    phase: "stop",
                    blockType: bridgeState.blockType
                });
            } else {
                bridgeState = null;
                stuckTicks = 0;
                exitBuildingMode(hunter);
                try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
                if (inventory) inventory.equipWeapon(hunter);
            }
        } else {
            executeAction(hunter, inventory, {
                type: "bridge_step",
                phase: "walk",
                direction: bridgeState.direction
            });
        }
    }
}

function startPillarSequence(hunter, inventory, action) {
    try {
        enterBuildingMode(hunter);

        pillarState = {
            phase: "jump",
            blockType: action.blockType,
            originalY: Math.floor(hunter.location.y),
            phaseTicksLeft: 1,
            jumpTicks: 0,
            lookDirection: action.lookDirection || { x: 1, z: 0 }
        };

        executeAction(hunter, inventory, {
            type: "pillar_step",
            phase: "jump",
            blockType: action.blockType,
            blockPos: action.blockPos,
            lookDirection: pillarState.lookDirection
        });
    } catch (_) {
        pillarState = null;
        exitBuildingMode(hunter);
    }
}

function tickPillarState(hunter, inventory) {
    if (!pillarState || !inventory) {
        pillarState = null;
        return;
    }

    pillarState.phaseTicksLeft--;

    if (pillarState.phase === "jump") {
        if (pillarState.phaseTicksLeft <= 0) {
            try {
                const vel = hunter.getVelocity();
                const pos = hunter.location;
                pillarState.jumpTicks++;

                if (pos.y > pillarState.originalY + 0.35 || vel.y <= 0.18 || pillarState.jumpTicks >= 4) {
                    pillarState.phase = "place";
                    pillarState.phaseTicksLeft = 1;

                    const fx = Math.floor(pos.x);
                    const fy = pillarState.originalY;
                    const fz = Math.floor(pos.z);

                    executeAction(hunter, inventory, {
                        type: "pillar_step",
                        phase: "place",
                        blockType: pillarState.blockType,
                        blockPos: { x: fx, y: fy, z: fz },
                        lookDirection: pillarState.lookDirection
                    });
                } else {
                    pillarState.phaseTicksLeft = 1;
                }
            } catch (_) {
                pillarState = null;
            }
        }
    } else if (pillarState.phase === "place") {
        pillarState = null;
        stuckTicks = 0;
        exitBuildingMode(hunter);
    }
}

function checkSurvival(hunter, inventory, target) {
    if (!inventory) return null;
    const profile = getProfile();

    const lava = checkLavaEscape(hunter, inventory);
    if (lava) return lava;

    const mlg = checkWaterMLG(hunter, inventory, fallTicks);
    if (mlg) return mlg;

    if (cdPlace <= 0) {
        const clutch = checkBlockClutch(hunter, inventory);
        if (clutch) { cdPlace = profile.cdPlace; return clutch; }
    }

    if (cdPlace <= 0) {
        const cave = checkCaveEscape(hunter, inventory, stuckTicks);
        if (cave) {
            if (cave.type === "break_block") {
                startMining(hunter, inventory, cave.blockPos);
            }
            stuckTicks = 0;
            return cave;
        }
    }

    if (cdParkour <= 0) {
        const park = checkParkourJump(hunter);
        if (park) { cdParkour = profile.cdParkour; return park; }
    }

    if (target && cdPlace <= 0) {
        const pillar = checkPillarUp(hunter, inventory, target);
        if (pillar) { cdPlace = profile.cdPlace * 4; return pillar; }
    }

    if (target && cdPlace <= 0 && stuckTicks >= 15) {
        const bridge = checkBridging(hunter, inventory, target, stuckTicks);
        if (bridge) {
            cdPlace = profile.cdPlace;
            if (bridge.type === "parkour_jump") cdParkour = profile.cdParkour;
            stuckTicks = Math.max(0, stuckTicks - 5);
            return bridge;
        }
    }

    return null;
}

function tickChase(hunter, target, inventory) {
    try {
        const profile = getProfile();
        const hPos = hunter.location;
        const tPos = target.location;
        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const combatTarget = getCombatTarget(hunter, target);
        const combatPos = combatTarget.location;
        const combatDx = combatPos.x - hPos.x;
        const combatDz = combatPos.z - hPos.z;
        const combatDist = Math.sqrt(combatDx * combatDx + combatDz * combatDz);

        if (dist > profile.catchupDistance && cdCatchup <= 0) {
            const nx = dx / dist;
            const nz = dz / dist;
            const newX = tPos.x - nx * profile.catchupPlaceDist;
            const newZ = tPos.z - nz * profile.catchupPlaceDist;

            try {
                const dim = hunter.dimension;
                let newY = tPos.y;
                for (let y = Math.floor(tPos.y) + 5; y >= Math.max(tPos.y - 10, -64); y--) {
                    const b = dim.getBlock({ x: Math.floor(newX), y, z: Math.floor(newZ) });
                    if (b && b.typeId !== "minecraft:air" && b.typeId !== "minecraft:water") {
                        newY = y + 1;
                        break;
                    }
                }
                hunter.teleport({ x: newX, y: newY, z: newZ });
                cdCatchup = profile.cdCatchup;
            } catch (_) { }
        }

        if (inventory && !inventory.isTempEquipActive()) {
            inventory.equipWeapon(hunter);
        }

        if (inventory && cdEat <= 0) {
            if (tryEat(hunter, inventory)) {
                cdEat = profile.cdEat * 2;
            } else {
                cdEat = profile.cdEat;
            }
        }

        if (inventory && cdShield <= 0 && combatDist < profile.attackRange + 1) {
            checkShield(hunter, inventory);
        }

        if (inventory && inventory.getBridgeBlockCount() < 4 && cdMining <= 0 && !miningTarget && dist > 15) {
            const gatherResult = inventory.findGatherTarget(hunter, profile.gatherSearchRadius);
            if (gatherResult) {
                startMining(hunter, inventory, gatherResult.pos);
                cdMining = profile.cdMining;
            }
        }

        if (combatDist <= profile.strafeRange && combatDist >= 1.5 && cdStrafe <= 0) {
            doStrafe(hunter, combatTarget, combatDist);
            cdStrafe = profile.cdStrafe;
        }

        if (combatDist <= profile.comboRange && cdCombo <= 0 && comboHits > 0) {
            triggerAttack(hunter);
            comboHits--;
            cdCombo = profile.cdCombo;
            try {
                const nx = combatDx / combatDist;
                const nz = combatDz / combatDist;
                hunter.applyImpulse({ x: nx * 0.12, y: 0, z: nz * 0.12 });
            } catch (_) { }
        }

        if (combatDist >= profile.jumpAttackMin && combatDist <= profile.jumpAttackMax && cdJumpAttack <= 0) {
            if (Math.random() < profile.jumpAttackChance) {
                doJumpAttack(hunter, combatTarget, combatDist);
                cdJumpAttack = profile.cdJumpAttack;
            }
        }

        if (combatDist > profile.sprintJumpMin && combatDist < profile.sprintJumpMax && cdSprintJump <= 0) {
            if (doSprintJump(hunter, combatTarget)) {
                cdSprintJump = profile.cdSprintJump;
            }
        }

        if (combatDist <= profile.lavaPourRange && inventory) {
            tryPourLava(hunter, combatTarget, inventory);
        }

        if (cdTaunt <= 0 && combatDist < 50) {
            sendTaunt(combatTarget);
            cdTaunt = combatDist < 15 ? profile.cdTauntClose : profile.cdTaunt;
        }

        if (blocksTraveled >= profile.prepTravelBlocks && dist > profile.prepEnterDist) {
            switchToPrep(hunter);
        }

    } catch (_) { }
}

function getCombatTarget(hunter, primaryTarget) {
    try {
        const players = world.getAllPlayers();
        const hunterPos = hunter.location;
        let closest = primaryTarget;
        let closestDist = distance2D(hunterPos, primaryTarget.location);

        for (const player of players) {
            if (player.id === primaryTarget.id) continue;
            if (player.dimension.id !== hunter.dimension.id) continue;

            const dist = distance2D(hunterPos, player.location);
            if (dist <= 8 && dist < closestDist + 1) {
                closest = player;
                closestDist = dist;
            }
        }

        return closest;
    } catch (_) { }
    return primaryTarget;
}

function distance2D(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function tickPrep(hunter, target, inventory) {
    try {
        const profile = getProfile();
        prepTicks += TICK_RATE;

        const hPos = hunter.location;
        const tPos = target.location;
        const dist = Math.sqrt((tPos.x - hPos.x) ** 2 + (tPos.z - hPos.z) ** 2);

        if (dist < profile.prepExitDist) {
            switchToChase(hunter);
            return;
        }

        if (!inventory) return;

        if (cdMining <= 0 && !miningTarget) {
            const gatherTarget = findPrepGatherTarget(hunter, inventory, profile);
            if (gatherTarget) {
                startMining(hunter, inventory, gatherTarget.pos);
                cdMining = profile.cdMining;
            }
        }

        if (!miningTarget) {
            let crafted = inventory.attemptCraft();
            if (crafted) {
                inventory.attemptCraft();
                inventory.equipBest(hunter);
            }
        }

        inventory.attemptSmelt(system.currentTick, smeltTimers);

        if (prepTicks === TICK_RATE * 3) {
            placeUtility(hunter, "minecraft:crafting_table");
        }
        if (prepTicks === TICK_RATE * 6) {
            placeUtility(hunter, "minecraft:furnace");
        }

        if (cdEat <= 0) {
            tryEat(hunter, inventory);
            cdEat = profile.cdEat;
        }

        if (prepTicks >= profile.prepDuration || inventory.hasGoodGear()) {
            inventory.equipBest(hunter);
            blocksTraveled = 0;
            switchToChase(hunter);
        }

    } catch (_) { }
}

function findPrepGatherTarget(hunter, inventory, profile) {
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

function tickRetreat(hunter, target, inventory) {
    if (!inventory) return;

    tryEat(hunter, inventory);

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

function doStrafe(hunter, target, dist) {
    try {
        const vel = hunter.getVelocity();
        if (Math.abs(vel.y) > 0.05) return;

        const hPos = hunter.location;
        const tPos = target.location;
        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;

        if (Math.random() < 0.15) strafeDir *= -1;

        const perpX = -dz / dist * strafeDir;
        const perpZ = dx / dist * strafeDir;

        const fwdX = (dx / dist) * 0.1;
        const fwdZ = (dz / dist) * 0.1;

        const dim = hunter.dimension;
        const checkX = Math.floor(hPos.x + perpX * 1.5);
        const checkZ = Math.floor(hPos.z + perpZ * 1.5);
        const checkY = Math.floor(hPos.y) - 1;

        const blockBelow = dim.getBlock({ x: checkX, y: checkY, z: checkZ });
        const blockAt = dim.getBlock({ x: checkX, y: checkY + 1, z: checkZ });

        if (!blockBelow || blockBelow.typeId === "minecraft:air" ||
            blockBelow.typeId === "minecraft:water" || blockBelow.typeId === "minecraft:lava") {
            return;
        }

        if (blockAt && blockAt.typeId !== "minecraft:air" &&
            blockAt.typeId !== "minecraft:tall_grass" && blockAt.typeId !== "minecraft:short_grass") {
            return;
        }

        hunter.applyImpulse({ x: perpX * 0.12 + fwdX, y: 0, z: perpZ * 0.12 + fwdZ });
    } catch (_) { }
}

function doJumpAttack(hunter, target, dist) {
    try {
        const hPos = hunter.location;
        const tPos = target.location;
        const vel = hunter.getVelocity();

        if (vel.y > 0.05 || vel.y < -0.3) return;

        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const nx = dx / dist;
        const nz = dz / dist;

        hunter.applyImpulse({ x: nx * 0.45, y: 0.45, z: nz * 0.45 });
        triggerAttack(hunter);
        comboHits = 3;
    } catch (_) { }
}

function doSprintJump(hunter, target) {
    try {
        const hPos = hunter.location;
        const tPos = target.location;
        const vel = hunter.getVelocity();

        const dx = tPos.x - hPos.x;
        const dz = tPos.z - hPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (vel.y > 0.05 || vel.y < -0.1) return false;
        if (Math.sqrt(vel.x ** 2 + vel.z ** 2) < 0.1) return false;

        const nx = dx / dist;
        const nz = dz / dist;

        hunter.applyImpulse({ x: nx * 0.15, y: 0.38, z: nz * 0.15 });
        return true;
    } catch (_) { }
    return false;
}

function tryPourLava(hunter, target, inventory) {
    if (!inventory.hasItem("minecraft:lava_bucket")) return;
    try {
        const tPos = target.location;
        const lavaPos = { x: Math.floor(tPos.x), y: Math.floor(tPos.y), z: Math.floor(tPos.z) };
        const block = hunter.dimension.getBlock(lavaPos);
        if (block?.typeId === "minecraft:air") {
            inventory.showItemInHand(hunter, "minecraft:lava_bucket", "placing", 15);
            block.setPermutation(BlockPermutation.resolve("minecraft:lava"));
            inventory.removeItem("minecraft:lava_bucket", 1);
            inventory.addItem("minecraft:bucket", 1);
            tempWaterBlocks.push({
                pos: { ...lavaPos },
                removeTick: system.currentTick + 60
            });
        }
    } catch (_) { }
}

function tryEat(hunter, inventory) {
    if (inventory.isTempEquipActive()) return false;
    try {
        const hp = hunter.getComponent("minecraft:health");
        if (!hp || hp.currentValue >= getProfile().eatBelowHp) return false;

        const food = inventory.getBestFood();
        if (!food) return false;

        inventory.showItemInHand(hunter, food, "eating", 32);

        system.runTimeout(() => {
            try {
                const hunger = inventory.getFoodHunger(food);
                inventory.removeItem(food, 1);
                const h = hunter.getComponent("minecraft:health");
                if (h) {
                    const heal = Math.min(hunger, h.effectiveMax - h.currentValue);
                    if (heal > 0) h.setCurrentValue(h.currentValue + heal);
                }
            } catch (_) { }
        }, 32);

        return true;
    } catch (_) { }
    return false;
}

function checkShield(hunter, inventory) {
    if (!inventory.hasShield()) return;
    if (shieldTimerId !== null || shieldActive) return;

    try {
        hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 minecraft:shield 1`);
        cdShield = getProfile().cdShield;
        shieldActive = true;

        shieldTimerId = system.runTimeout(() => {
            try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
            shieldTimerId = null;
            shieldActive = false;
        }, 20);
    } catch (_) { }
}

function equipShield(hunter) {
    const inventory = getInventory();
    if (!inventory || !inventory.hasShield()) return;
    if (shieldTimerId !== null || shieldActive) return;

    try {
        hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 minecraft:shield 1`);
        shieldActive = true;
        cdShield = getProfile().cdShield;

        if (shieldTimerId !== null) {
            try { system.clearRun(shieldTimerId); } catch (_) { }
        }
        shieldTimerId = system.runTimeout(() => {
            try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
            shieldTimerId = null;
            shieldActive = false;
        }, 40);
    } catch (_) { }
}

function clearShield() {
    if (shieldTimerId !== null) {
        try { system.clearRun(shieldTimerId); } catch (_) { }
        shieldTimerId = null;
    }
    shieldActive = false;

    const hunter = getHunter();
    if (hunter) {
        try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air 0`); } catch (_) { }
    }
}

function startMining(hunter, inventory, blockPos) {
    try {
        const dim = hunter.dimension;
        const block = dim.getBlock(blockPos);
        if (!block || block.typeId === "minecraft:air") return;

        const typeId = block.typeId;
        const duration = inventory.getMiningDuration(typeId);
        if (duration <= 0) return;

        const tool = inventory.getMiningTool(typeId);
        if (tool) {
            inventory.showItemInHand(hunter, tool, "mining", duration + 5);
        } else {
            try { hunter.triggerEvent("manhunt:set_action_mining"); } catch (_) { }
        }

        miningTarget = {
            pos: { x: blockPos.x, y: blockPos.y, z: blockPos.z },
            typeId: typeId,
            ticksLeft: duration
        };
    } catch (_) { }
}

function finishMining(hunter, inventory) {
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
    miningTarget = null;
}

function switchToChase(hunter) {
    state = "chase";
    prepTicks = 0;
    comboHits = 0;
    bridgeState = null;
    pillarState = null;
    miningTarget = null;
    if (isBuilding) exitBuildingMode();
    const h = hunter || getHunter();
    if (h) {
        try { h.triggerEvent("manhunt:enter_chase"); } catch (_) { }
    }
    const inv = getInventory();
    if (inv) {
        inv.resetTempEquip();
        if (h) try { inv.equipBest(h); } catch (_) { }
    }
}

function enterBuildingMode(hunter) {
    if (isBuilding) return;
    isBuilding = true;
    const h = hunter || getHunter();
    if (h) {
        try { h.triggerEvent("manhunt:enter_building"); } catch (_) { }
    }
}

function exitBuildingMode(hunter) {
    if (!isBuilding) return;
    isBuilding = false;
    const h = hunter || getHunter();
    if (h) {
        try { h.triggerEvent("manhunt:enter_chase"); } catch (_) { }
    }
}

function switchToPrep(hunter) {
    state = "prep";
    prepTicks = 0;
    cdMining = 0;
    bridgeState = null;
    pillarState = null;
    try { hunter.triggerEvent("manhunt:enter_prep"); } catch (_) { }
}

function switchToRetreat(hunter) {
    state = "retreat";
    bridgeState = null;
    pillarState = null;
}

function sendTaunt(target) {
    try {
        if (!getEnableTaunts()) return;
        target.sendMessage(TAUNTS[Math.floor(Math.random() * TAUNTS.length)]);
    } catch (_) { }
}

function placeUtility(hunter, blockType) {
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

function cleanTempWater(hunter) {
    const now = system.currentTick;
    const inventory = getInventory();

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

function handleNearbyBoats(hunter) {
    const boatHandling = getBoatHandling();
    if (boatHandling === "ignore") return;

    try {
        const dim = hunter.dimension;
        const pos = hunter.location;

        try {
            hunter.runCommand("ride @e[type=minecraft:boat,r=3] dismount");
        } catch (_) { }

        const boats = dim.getEntities({
            type: "minecraft:boat",
            location: pos,
            maxDistance: 10
        });

        for (const boat of boats) {
            try {
                boat.kill();

                dim.playSound("random.break", boat.location, { volume: 0.5, pitch: 1.0 });

                dim.spawnParticle("minecraft:block_destroy", boat.location, {
                    block: "minecraft:oak_planks"
                });
            } catch (_) { }
        }
    } catch (_) { }
}

function tickCooldowns() {
    if (cdCombo > 0) cdCombo--;
    if (cdJumpAttack > 0) cdJumpAttack--;
    if (cdStrafe > 0) cdStrafe--;
    if (cdSprintJump > 0) cdSprintJump--;
    if (cdAttackAnim > 0) cdAttackAnim--;
    if (cdCatchup > 0) cdCatchup--;
    if (cdEat > 0) cdEat--;
    if (cdTaunt > 0) cdTaunt--;
    if (cdMining > 0) cdMining--;
    if (cdParkour > 0) cdParkour--;
    if (cdPlace > 0) cdPlace--;
    if (cdShield > 0) cdShield--;
}

function resetCooldowns() {
    cdCombo = 0; cdJumpAttack = 0; cdStrafe = 0; cdSprintJump = 0;
    cdAttackAnim = 0; cdCatchup = 0; cdEat = 0; cdTaunt = 0;
    cdMining = 0; cdParkour = 0; cdPlace = 0; cdShield = 0;
    comboHits = 0; strafeDir = 1;
    stuckTicks = 0; fallTicks = 0;
    blocksTraveled = 0;

    if (shieldTimerId !== null) {
        try { system.clearRun(shieldTimerId); } catch (_) { }
        shieldTimerId = null;
    }
    shieldActive = false;
}
