/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

/**
 * AI State Machine — Orchestrator (v0.7.0 refactor).
 * Delegates combat, gathering, building, and survival to ai/ submodules.
 */

import { system, world } from "@minecraft/server";
import {
    getHunter, getTarget, getInventory, despawn,
    getEnableTaunts, getBoatHandling, getAILevel
} from "./entity_manager.js";
import {
    checkLavaEscape, checkWaterMLG, checkBlockClutch, checkCaveEscape,
    checkPillarUp, checkParkourJump, checkBridging, executeAction
} from "./movement.js";
import { getProfile, getRandomTaunt } from "./ai/profiles.js";
import {
    triggerAttack, rollCrit, doStrafe, doJumpAttack, doSprintJump,
    tryPourLava, tryEat, equipShield, clearShield, handleDamage,
    getCombatTarget
} from "./ai/combat.js";
import {
    startMining, finishMining, findPrepGatherTarget, placeUtility
} from "./ai/gathering.js";
import {
    executeBridgeStep, executePillarStep, executePlaceWater,
    executePlaceBlock, executeBreakBlock
} from "./ai/building.js";
import {
    tickRetreat, cleanTempWater
} from "./ai/survival.js";
import { getDifficultyScaledProfile } from "./difficulty_scaling.js";

const TICK_RATE = 2;

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

function getProfileScaled() {
    return getDifficultyScaledProfile(getAILevel());
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
    clearShield(getHunter(), shieldTimerId);
    shieldTimerId = null;
    shieldActive = false;
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

export { triggerAttack, rollCrit, handleDamage };

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

    cleanTempWater(hunter, tempWaterBlocks, mlgWaterBlocks, inventory);

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
            finishMining(hunter, inventory, miningTarget);
            miningTarget = null;
        }
        return;
    }

    try {
        const hp = hunter.getComponent("minecraft:health");
        const profile = getProfileScaled();
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

    executeBridgeStep(hunter, inventory, {
        type: "bridge_step",
        phase: "stop",
        blockType: action.blockType
    }, hunter.dimension);
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

                executeBridgeStep(hunter, inventory, {
                    type: "bridge_step",
                    phase: "place",
                    blockPos: { x: bx, y: by, z: bz },
                    blockType: bridgeState.blockType,
                    direction: bridgeState.direction
                }, hunter.dimension);
                bridgeState.blocksPlaced++;
            } catch (_) {
                bridgeState = null;
            }
        } else {
            executeBridgeStep(hunter, inventory, {
                type: "bridge_step",
                phase: "stop",
                blockType: bridgeState.blockType
            }, hunter.dimension);
        }

    } else if (bridgeState.phase === "place") {
        if (bridgeState.phaseTicksLeft <= 0) {
            bridgeState.phase = "walk";
            bridgeState.phaseTicksLeft = 3;

            executeBridgeStep(hunter, inventory, {
                type: "bridge_step",
                phase: "walk",
                direction: bridgeState.direction
            }, hunter.dimension);
        }

    } else if (bridgeState.phase === "walk") {
        if (bridgeState.phaseTicksLeft <= 0) {
            if (bridgeState.blocksPlaced < bridgeState.gapSize &&
                inventory.hasItem(bridgeState.blockType)) {
                bridgeState.phase = "stop";
                bridgeState.phaseTicksLeft = 1;

                executeBridgeStep(hunter, inventory, {
                    type: "bridge_step",
                    phase: "stop",
                    blockType: bridgeState.blockType
                }, hunter.dimension);
            } else {
                bridgeState = null;
                stuckTicks = 0;
                exitBuildingMode(hunter);
                try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
                if (inventory) inventory.equipWeapon(hunter);
            }
        } else {
            executeBridgeStep(hunter, inventory, {
                type: "bridge_step",
                phase: "walk",
                direction: bridgeState.direction
            }, hunter.dimension);
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

        executePillarStep(hunter, inventory, {
            type: "pillar_step",
            phase: "jump",
            blockType: action.blockType,
            blockPos: action.blockPos,
            lookDirection: pillarState.lookDirection
        }, hunter.dimension);
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

                    executePillarStep(hunter, inventory, {
                        type: "pillar_step",
                        phase: "place",
                        blockType: pillarState.blockType,
                        blockPos: { x: fx, y: fy, z: fz },
                        lookDirection: pillarState.lookDirection
                    }, hunter.dimension);
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
    const profile = getProfileScaled();

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
                miningTarget = startMining(hunter, inventory, cave.blockPos);
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
        const profile = getProfileScaled();
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
            if (tryEat(hunter, inventory, profile.eatBelowHp)) {
                cdEat = profile.cdEat * 2;
            } else {
                cdEat = profile.cdEat;
            }
        }

        if (inventory && cdShield <= 0 && combatDist < profile.attackRange + 1) {
            if (inventory.hasShield() && !shieldActive) {
                shieldTimerId = equipShield(hunter, 20);
                shieldActive = true;
                cdShield = profile.cdShield;

                system.runTimeout(() => {
                    shieldTimerId = null;
                    shieldActive = false;
                }, 20);
            }
        }

        if (inventory && inventory.getBridgeBlockCount() < 4 && cdMining <= 0 && !miningTarget && dist > 15) {
            const gatherResult = inventory.findGatherTarget(hunter, profile.gatherSearchRadius);
            if (gatherResult) {
                miningTarget = startMining(hunter, inventory, gatherResult.pos);
                cdMining = profile.cdMining;
            }
        }

        if (combatDist <= profile.strafeRange && combatDist >= 1.5 && cdStrafe <= 0) {
            strafeDir = doStrafe(hunter, combatTarget, combatDist, strafeDir);
            cdStrafe = profile.cdStrafe;
        }

        if (combatDist <= profile.comboRange && cdCombo <= 0 && comboHits > 0) {
            cdAttackAnim = triggerAttack(hunter, cdAttackAnim);
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
                if (doJumpAttack(hunter, combatTarget, combatDist)) {
                    cdAttackAnim = triggerAttack(hunter, cdAttackAnim);
                    comboHits = 3;
                }
                cdJumpAttack = profile.cdJumpAttack;
            }
        }

        if (combatDist > profile.sprintJumpMin && combatDist < profile.sprintJumpMax && cdSprintJump <= 0) {
            if (doSprintJump(hunter, combatTarget)) {
                cdSprintJump = profile.cdSprintJump;
            }
        }

        if (combatDist <= profile.lavaPourRange && inventory) {
            const lavaEntry = tryPourLava(hunter, combatTarget, inventory);
            if (lavaEntry) {
                tempWaterBlocks.push(lavaEntry);
            }
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

function tickPrep(hunter, target, inventory) {
    try {
        const profile = getProfileScaled();
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
                miningTarget = startMining(hunter, inventory, gatherTarget.pos);
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
            tryEat(hunter, inventory, profile.eatBelowHp);
            cdEat = profile.cdEat;
        }

        if (prepTicks >= profile.prepDuration || inventory.hasGoodGear()) {
            inventory.equipBest(hunter);
            blocksTraveled = 0;
            switchToChase(hunter);
        }

    } catch (_) { }
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
        target.sendMessage(getRandomTaunt());
    } catch (_) { }
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
