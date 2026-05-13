/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { world, system, EffectTypes, BlockPermutation } from "@minecraft/server";
import { HunterInventory } from "./inventory.js";
import { DEFAULT_CREATOR_KIT_ID } from "./kits.js";

const HUNTER_TYPE = "manhunt:hunter";
const HUNTER_TAG = "hunter_active";
const RESPAWN_DELAY = 1200;
const RESPAWN_INVINCIBILITY = 100;

let activeHunter = null;
let hunterInventory = null;
let targetPlayer = null;
let hunterName = "Hunter";
let hunterSkinId = 0;
let hunterEnableTaunts = true;
let hunterBoatHandling = "destroy";
let hunterEquipmentPersistence = false;
let hunterDeathCount = 0;
let respawnInProgress = false;

let hunterBedPos = null;
let hunterBedDimId = null;
let hunterDeathPos = null;
let hunterDeathDimId = null;

let lastKnownPos = null;
let lastKnownDimId = "overworld";

let savedInventory = null;
let hunterAILevel = "normal";
let respawnDebug = false;
let lastRespawnStatus = {
    success: null,
    stage: "idle",
    reason: "",
    source: "",
    attempts: 0,
    timestamp: 0
};
let hunterInventoryMode = "starter";
let hunterCreatorKitId = DEFAULT_CREATOR_KIT_ID;
let hunterPrepBehavior = "hybrid";

let respawnContext = null;
const RESPAWN_MAX_RETRIES = 3;

export function getHunter() {
    if (activeHunter) {
        try { const _ = activeHunter.location; return activeHunter; }
        catch (_) { activeHunter = null; }
    }
    for (const dimId of ["overworld", "nether", "the_end"]) {
        try {
            const dim = world.getDimension(dimId);
            const hunters = dim.getEntities({ type: HUNTER_TYPE, tags: [HUNTER_TAG] });
            for (const h of hunters) {
                try {
                    const _ = h.location;
                    activeHunter = h;
                    if (!hunterInventory) hunterInventory = new HunterInventory();
                    return activeHunter;
                } catch (_) { }
            }
        } catch (_) { }
    }
    return null;
}

export function getTarget() {
    if (targetPlayer) {
        try { const _ = targetPlayer.location; return targetPlayer; }
        catch (_) {
            if (!respawnInProgress) {
                try {
                    const players = world.getAllPlayers();
                    if (players.length > 0) {
                        targetPlayer = players[0];
                        return targetPlayer;
                    }
                } catch (_) { }
                targetPlayer = null;
            }
        }
    }
    return targetPlayer;
}

export function getInventory() { return hunterInventory; }
export function isActive() { return getHunter() !== null; }
export function isRespawning() { return respawnInProgress; }
export function getDeathCount() { return hunterDeathCount; }
export function getHunterNameStr() { return hunterName; }
export function getEnableTaunts() { return hunterEnableTaunts; }
export function getBoatHandling() { return hunterBoatHandling; }
export function getAILevel() { return hunterAILevel; }
export function getLastRespawnStatus() { return lastRespawnStatus; }
export function getRespawnDebug() { return respawnDebug; }
export function cancelRespawn() {
    if (respawnInProgress) {
        respawnInProgress = false;
        return true;
    }
    return false;
}
export function getCurrentConfigSnapshot() {
    return {
        name: hunterName,
        skinId: hunterSkinId,
        enableTaunts: hunterEnableTaunts,
        boatHandling: hunterBoatHandling,
        equipmentPersistence: hunterEquipmentPersistence,
        aiLevel: hunterAILevel,
        inventoryMode: hunterInventoryMode,
        creatorKitId: hunterCreatorKitId,
        prepBehavior: hunterPrepBehavior
    };
}

export function setTarget(player) { targetPlayer = player; }

export function setBed(pos, dimId) {
    hunterBedPos = { x: pos.x, y: pos.y, z: pos.z };
    hunterBedDimId = dimId;
}

export function getBed() {
    return { pos: hunterBedPos, dimId: hunterBedDimId };
}

export function storeDeathLocation(pos, dimId) {
    hunterDeathPos = { x: pos.x, y: pos.y, z: pos.z };
    hunterDeathDimId = dimId;
}

export function getDeathLocation() {
    return { pos: hunterDeathPos, dimId: hunterDeathDimId };
}

export function cachePosition() {
    const h = getHunter();
    if (!h) return;
    try {
        lastKnownPos = { x: h.location.x, y: h.location.y, z: h.location.z };
        lastKnownDimId = h.dimension.id.replace("minecraft:", "");
    } catch (_) { }
}

export function resolveDeathPosition(entity) {
    try {
        return {
            pos: { x: entity.location.x, y: entity.location.y, z: entity.location.z },
            dimId: entity.dimension.id.replace("minecraft:", "")
        };
    } catch (_) { }
    if (lastKnownPos) {
        return { pos: { ...lastKnownPos }, dimId: lastKnownDimId };
    }
    return { pos: { x: 0, y: 64, z: 0 }, dimId: "overworld" };
}

export function spawn(player, config, playerLoadout = null) {
    if (isActive()) return null;

    try {
        const dim = player.dimension;
        const pPos = player.location;

        const angle = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 10;
        const spawnX = pPos.x + Math.cos(angle) * dist;
        const spawnZ = pPos.z + Math.sin(angle) * dist;

        let spawnY = pPos.y;
        try {
            for (let y = Math.floor(pPos.y) + 10; y >= Math.max(pPos.y - 20, -64); y--) {
                const block = dim.getBlock({ x: Math.floor(spawnX), y, z: Math.floor(spawnZ) });
                if (block && block.typeId !== "minecraft:air" && block.typeId !== "minecraft:water") {
                    spawnY = y + 1;
                    break;
                }
            }
        } catch (_) { spawnY = pPos.y; }

        const hunter = dim.spawnEntity(HUNTER_TYPE, { x: spawnX, y: spawnY, z: spawnZ });

        hunter.addTag(HUNTER_TAG);
        hunter.nameTag = config.name || "Hunter";

        try { hunter.triggerEvent(`manhunt:set_skin_${config.skinId}`); } catch (_) { }

        activeHunter = hunter;
        hunterName = config.name || "Hunter";
        hunterSkinId = config.skinId || 0;
        hunterEnableTaunts = config.enableTaunts !== undefined ? config.enableTaunts : true;
        hunterBoatHandling = config.boatHandling || "destroy";
        hunterEquipmentPersistence = config.equipmentPersistence !== undefined ? config.equipmentPersistence : false;
        hunterAILevel = config.aiLevel || "normal";
        hunterInventoryMode = config.inventoryMode || "starter";
        hunterCreatorKitId = config.creatorKitId || DEFAULT_CREATOR_KIT_ID;
        hunterPrepBehavior = config.prepBehavior || "hybrid";
        targetPlayer = player;
        hunterDeathCount = 0;

        hunterInventory = new HunterInventory();
        hunterInventory.initializeForConfig(config, playerLoadout);

        system.runTimeout(() => {
            try { hunterInventory.equipBest(hunter); } catch (_) { }
        }, 5);

        return hunter;
    } catch (_) { }
    return null;
}

export function despawn(dropItems = false) {
    if (respawnInProgress) return;

    if (activeHunter) {
        try {
            if (dropItems && hunterInventory) {
                hunterInventory.dropAll(activeHunter.dimension, activeHunter.location);
            }
        } catch (_) { }
        try { activeHunter.remove(); } catch (_) {
            try { activeHunter.kill(); } catch (_) { }
        }
    }

    cleanupAllHunters();

    activeHunter = null;
    hunterInventory = null;
    targetPlayer = null;
    hunterName = "Hunter";
    hunterSkinId = 0;
    hunterEnableTaunts = true;
    hunterBoatHandling = "destroy";
    hunterEquipmentPersistence = false;
    hunterBedPos = null;
    hunterBedDimId = null;
    hunterDeathPos = null;
    hunterDeathDimId = null;
    hunterDeathCount = 0;
    lastKnownPos = null;
    savedInventory = null;
}

export function canRespawn() {
    return true;
}

export function respawn(onComplete) {
    if (!canRespawn()) {
        if (onComplete) onComplete(null);
        return;
    }


    system.runTimeout(() => {
        respawnHunterStaged(onComplete);
    }, RESPAWN_DELAY);
}


function validateCandidatePosition(dim, pos) {
    try {
        const floorX = Math.floor(pos.x);
        const floorY = Math.floor(pos.y);
        const floorZ = Math.floor(pos.z);

        const floorBlock = dim.getBlock({ x: floorX, y: floorY - 1, z: floorZ });
        if (!floorBlock || floorBlock.typeId === "minecraft:air" || floorBlock.typeId === "minecraft:water" || floorBlock.typeId === "minecraft:lava") {
            return { valid: false, reason: "no solid floor" };
        }

        const head1 = dim.getBlock({ x: floorX, y: floorY, z: floorZ });
        const head2 = dim.getBlock({ x: floorX, y: floorY + 1, z: floorZ });
        if (head1?.typeId !== "minecraft:air" || head2?.typeId !== "minecraft:air") {
            return { valid: false, reason: "insufficient headroom" };
        }

        const lavaCheck = dim.getBlock({ x: floorX, y: floorY - 1, z: floorZ });
        if (lavaCheck?.typeId === "minecraft:lava") {
            return { valid: false, reason: "floor is lava" };
        }

        if (pos.y < -64 || pos.y > 320) {
            return { valid: false, reason: "unsafe Y level" };
        }

        if (floorBlock.typeId === "minecraft:water") {
            return { valid: false, reason: "floor is water" };
        }

        const fireCheck = dim.getBlock({ x: floorX, y: floorY, z: floorZ });
        if (fireCheck?.typeId === "minecraft:fire") {
            return { valid: false, reason: "position is fire" };
        }

        if (floorBlock.typeId === "minecraft:cactus") {
            return { valid: false, reason: "floor is cactus" };
        }

        if (floorBlock.typeId === "minecraft:sweet_berry_bush") {
            return { valid: false, reason: "floor is berry bush" };
        }

        if (head1?.typeId === "minecraft:powder_snow" || head2?.typeId === "minecraft:powder_snow") {
            return { valid: false, reason: "position has powder snow" };
        }

        return { valid: true, reason: "ok" };
    } catch (e) {
        return { valid: false, reason: "validation error: " + e };
    }
}

function buildSpawnCandidates(targetPlayer, deathLocation, bedLocation) {
    const candidates = [];

    if (bedLocation && bedLocation.pos && bedLocation.dimId) {
        try {
            const dim = world.getDimension(bedLocation.dimId);
            if (isBedValid(dim, bedLocation.pos)) {
                const safePos = findSafeSpawnNearBed(dim, bedLocation.pos);
                candidates.push({
                    pos: safePos,
                    dimId: bedLocation.dimId,
                    source: "bed",
                    priority: 0
                });
            }
        } catch (_) { }
    }

    if (targetPlayer) {
        try {
            const tPos = targetPlayer.location;
            const tDimId = targetPlayer.dimension.id.replace("minecraft:", "");
            const dim = world.getDimension(tDimId);
            for (let i = 0; i < 8; i++) {
                const angle = (i * Math.PI / 4) + (Math.random() * 0.5);
                const distance = 20 + Math.random() * 40;
                const x = tPos.x + Math.cos(angle) * distance;
                const z = tPos.z + Math.sin(angle) * distance;
                const safeY = findSafeY(dim, x, z, tPos.y);
                candidates.push({
                    pos: { x, y: safeY, z },
                    dimId: tDimId,
                    source: "near_target",
                    priority: 1
                });
            }
        } catch (_) { }
    }

    if (deathLocation && deathLocation.pos && deathLocation.dimId) {
        candidates.push({
            pos: { ...deathLocation.pos, y: deathLocation.pos.y + 1 },
            dimId: deathLocation.dimId,
            source: "death_location",
            priority: 2
        });
    }

    candidates.push({
        pos: { x: 0.5, y: 64, z: 0.5 },
        dimId: "overworld",
        source: "world_spawn",
        priority: 3
    });

    candidates.sort((a, b) => a.priority - b.priority);
    return candidates;
}

function updateRespawnStatus(success, stage, reason = "", source = "", attempts = 0) {
    lastRespawnStatus = {
        success,
        stage,
        reason,
        source,
        attempts,
        timestamp: system.currentTick
    };
    if (respawnDebug) {
        console.warn(`[Respawn] stage=${stage} success=${success} reason=${reason} source=${source}`);
    }
}


function respawnHunterStaged(onComplete, retryCount = 0) {
    if (respawnInProgress) {
        updateRespawnStatus(false, "already_in_progress", "Respawn already in progress");
        if (onComplete) onComplete(null);
        return;
    }

    const context = {
        targetPlayer: targetPlayer ? { id: targetPlayer.id, name: targetPlayer.name } : null,
        configSnapshot: getCurrentConfigSnapshot(),
        deathLocation: getDeathLocation(),
        bedLocation: getBed(),
        inventorySnapshot: savedInventory ? savedInventory.toSnapshot() : null,
        retryCount: retryCount,
        maxRetries: RESPAWN_MAX_RETRIES,
        failureStage: "",
        failureReason: ""
    };
    respawnContext = context;

    respawnInProgress = true;
    hunterDeathCount++;
    updateRespawnStatus(null, "preparing", "Stopping AI and locking respawn");

    let target = targetPlayer;
    if (!target) {
        try {
            const players = world.getAllPlayers();
            if (players.length > 0) target = players[0];
        } catch (_) { }
        if (!target) {
            updateRespawnStatus(false, "no_target", "No target player available");
            respawnInProgress = false;
            if (onComplete) onComplete(null);
            return;
        }
    }

    const candidates = buildSpawnCandidates(target, context.deathLocation, context.bedLocation);
    updateRespawnStatus(null, "candidate_selection", `Generated ${candidates.length} candidates`);

    let selectedCandidate = null;
    for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        try {
            const dim = world.getDimension(cand.dimId);
            const validation = validateCandidatePosition(dim, cand.pos);
            if (validation.valid) {
                selectedCandidate = cand;
                break;
            } else {
                if (respawnDebug) console.warn(`[Respawn] candidate ${cand.source} invalid: ${validation.reason}`);
            }
        } catch (_) { }
    }

    if (!selectedCandidate) {
        updateRespawnStatus(false, "no_valid_candidate", "No valid spawn candidate found after checking all");
        respawnInProgress = false;

        if (retryCount < RESPAWN_MAX_RETRIES) {
            if (respawnDebug) console.warn(`[Respawn] No valid candidate, retrying (${retryCount + 1}/${RESPAWN_MAX_RETRIES})...`);
            system.runTimeout(() => {
                respawnHunterStaged(onComplete, retryCount + 1);
            }, 40);
        } else {
            if (onComplete) onComplete(null);
        }
        return;
    }

    updateRespawnStatus(null, "spawning", `Spawning at ${selectedCandidate.source}`);

    try {
        const dim = world.getDimension(selectedCandidate.dimId);
        const hunter = dim.spawnEntity(HUNTER_TYPE, selectedCandidate.pos);

        hunter.addTag(HUNTER_TAG);
        hunter.nameTag = hunterName;
        try { hunter.triggerEvent(`manhunt:set_skin_${hunterSkinId}`); } catch (_) { }

        activeHunter = hunter;
        targetPlayer = target;

        system.runTimeout(() => {
            try {
                const _ = hunter.location;
            } catch (_) {
                updateRespawnStatus(false, "post_spawn_vanish", "Hunter vanished immediately after spawn");
                respawnInProgress = false;

                if (retryCount < RESPAWN_MAX_RETRIES) {
                    if (respawnDebug) console.warn(`[Respawn] Retrying (${retryCount + 1}/${RESPAWN_MAX_RETRIES})...`);
                    system.runTimeout(() => {
                        respawnHunterStaged(onComplete, retryCount + 1);
                    }, 40);
                } else {
                    if (onComplete) onComplete(null);
                }
                return;
            }

            if (hunterEquipmentPersistence && savedInventory) {
                hunterInventory = HunterInventory.fromSnapshot(savedInventory);
                savedInventory = null;
            } else {
                hunterInventory = new HunterInventory();
                const config = getCurrentConfigSnapshot();
                hunterInventory.initializeForConfig(config, null);
                savedInventory = null;
            }

            applyRespawnBuffs(hunter);

            system.runTimeout(() => {
                try { hunterInventory.equipBest(hunter); } catch (_) { }
            }, 5);

            respawnInProgress = false;
            updateRespawnStatus(true, "completed", "Respawn successful", selectedCandidate.source, retryCount);

            try {
                target.sendMessage(`§c§l⚔ ${hunterName} §r§7has respawned at ${selectedCandidate.source === "bed" ? "their bed" : "world spawn"}! §7(Death #${hunterDeathCount})`);
                target.onScreenDisplay.setTitle("§c§lHUNTER RESPAWNED!", {
                    fadeInDuration: 5, fadeOutDuration: 20, stayDuration: 40,
                    subtitle: `§7${hunterName} is back for revenge!`
                });
            } catch (_) { }

            if (onComplete) onComplete(hunter);
        }, 10);

    } catch (e) {
        updateRespawnStatus(false, "spawn_failed", "Exception during spawn: " + e, selectedCandidate.source);
        respawnInProgress = false;

        if (retryCount < RESPAWN_MAX_RETRIES) {
            if (respawnDebug) console.warn(`[Respawn] Retrying after exception (${retryCount + 1}/${RESPAWN_MAX_RETRIES})...`);
            system.runTimeout(() => {
                respawnHunterStaged(onComplete, retryCount + 1);
            }, 40);
        } else {
            if (onComplete) onComplete(null);
        }
    }
}

function cleanupAllHunters() {
    for (const dimId of ["overworld", "nether", "the_end"]) {
        try {
            const dim = world.getDimension(dimId);
            const hunters = dim.getEntities({ type: HUNTER_TYPE, tags: [HUNTER_TAG] });
            for (const h of hunters) {
                try { h.remove(); } catch (_) { }
            }
        } catch (_) { }
    }
}

function findSafeY(dim, x, z, startY) {
    for (let y = Math.floor(startY) + 5; y >= Math.max(startY - 20, -64); y--) {
        try {
            const block = dim.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
            if (block && block.typeId !== "minecraft:air" && block.typeId !== "minecraft:water") {
                const a1 = dim.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
                const a2 = dim.getBlock({ x: Math.floor(x), y: y + 2, z: Math.floor(z) });
                if (a1?.typeId === "minecraft:air" && a2?.typeId === "minecraft:air") {
                    return y + 1;
                }
            }
        } catch (_) { }
    }
    return startY;
}

function isBedValid(dim, pos) {
    try {
        const block = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
        if (block?.typeId?.includes("bed")) return true;

        const offsets = [
            { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
            { x: 1, z: 1 }, { x: -1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: -1 }
        ];
        for (const off of offsets) {
            const b = dim.getBlock({
                x: Math.floor(pos.x) + off.x, y: Math.floor(pos.y), z: Math.floor(pos.z) + off.z
            });
            if (b?.typeId?.includes("bed")) return true;
        }
    } catch (_) { }
    return false;
}

function findSafeSpawnNearBed(dim, bedPos) {
    const offsets = [
        { x: 0, z: 0 },
        { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
        { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 },
        { x: 1, z: 1 }, { x: -1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: -1 }
    ];

    for (const off of offsets) {
        const checkPos = {
            x: Math.floor(bedPos.x) + off.x,
            y: Math.floor(bedPos.y),
            z: Math.floor(bedPos.z) + off.z
        };

        const safeY = findSafeY(dim, checkPos.x, checkPos.z, checkPos.y + 1);
        const candidatePos = { x: checkPos.x + 0.5, y: safeY, z: checkPos.z + 0.5 };

        const validation = validateCandidatePosition(dim, candidatePos);
        if (validation.valid) {
            return candidatePos;
        }
    }

    return { x: bedPos.x + 0.5, y: bedPos.y + 1, z: bedPos.z + 0.5 };
}

function tryPlaceBedNearPortal(hunter, inventory) {
    try {
        if (hunter.dimension.id === "minecraft:nether") {
            return false;
        }

        if (!inventory || !inventory.hasItem("minecraft:red_bed", 1)) {
            return false;
        }

        const dim = hunter.dimension;
        const pos = hunter.location;

        const scanRadius = 16;
        for (let x = -scanRadius; x <= scanRadius; x++) {
            for (let y = -scanRadius; y <= scanRadius; y++) {
                for (let z = -scanRadius; z <= scanRadius; z++) {
                    const checkPos = {
                        x: Math.floor(pos.x) + x,
                        y: Math.floor(pos.y) + y,
                        z: Math.floor(pos.z) + z
                    };

                    try {
                        const block = dim.getBlock(checkPos);
                        if (block?.typeId === "minecraft:nether_portal") {
                            const bedPos = findBedPlacementLocation(dim, checkPos);
                            if (bedPos) {
                                inventory.removeItem("minecraft:red_bed", 1);

                                const bedBlock = dim.getBlock(bedPos);
                                if (bedBlock && bedBlock.typeId === "minecraft:air") {
                                    bedBlock.setPermutation(BlockPermutation.resolve("minecraft:red_bed"));

                                    const dimId = dim.id.replace("minecraft:", "");
                                    setBed(bedPos, dimId);
                                    return true;
                                }
                            }
                        }
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }
    return false;
}

function findBedPlacementLocation(dim, portalPos) {
    const offsets = [
        { x: 5, z: 0 }, { x: -5, z: 0 }, { x: 0, z: 5 }, { x: 0, z: -5 },
        { x: 8, z: 0 }, { x: -8, z: 0 }, { x: 0, z: 8 }, { x: 0, z: -8 },
        { x: 3, z: 3 }, { x: -3, z: 3 }, { x: 3, z: -3 }, { x: -3, z: -3 }
    ];

    for (const off of offsets) {
        const checkPos = {
            x: Math.floor(portalPos.x) + off.x,
            y: Math.floor(portalPos.y),
            z: Math.floor(portalPos.z) + off.z
        };

        if (isValidBedLocation(dim, checkPos)) {
            return checkPos;
        }
    }

    return null;
}

function isValidBedLocation(dim, pos) {
    try {
        const block = dim.getBlock(pos);
        const blockBelow = dim.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });

        if (block?.typeId === "minecraft:air" &&
            blockBelow &&
            blockBelow.typeId !== "minecraft:air" &&
            blockBelow.typeId !== "minecraft:water" &&
            blockBelow.typeId !== "minecraft:lava") {

            const blockAbove = dim.getBlock({ x: pos.x, y: pos.y + 1, z: pos.z });
            if (blockAbove?.typeId === "minecraft:air") {
                return true;
            }
        }
    } catch (_) { }
    return false;
}

function applyRespawnBuffs(hunter) {
    try {
        const res = EffectTypes.get("resistance");
        if (res) hunter.addEffect(res, RESPAWN_INVINCIBILITY, { amplifier: 4, showParticles: true });
        const reg = EffectTypes.get("regeneration");
        if (reg) hunter.addEffect(reg, RESPAWN_INVINCIBILITY, { amplifier: 2, showParticles: true });
        const fr = EffectTypes.get("fire_resistance");
        if (fr) hunter.addEffect(fr, RESPAWN_INVINCIBILITY, { amplifier: 0, showParticles: false });
    } catch (_) { }
}

export function getEquipmentPersistence() {
    return hunterEquipmentPersistence;
}

export function saveInventoryForRespawn(inventory) {
    savedInventory = inventory;
}

export function getSavedInventory() {
    return savedInventory;
}

export function clearSavedInventory() {
    savedInventory = null;
}

export function attemptBedPlacementNearPortal() {
    const hunter = getHunter();
    if (!hunter || !hunterInventory) return false;
    return tryPlaceBedNearPortal(hunter, hunterInventory);
}

export function cleanupOrphans() {
    cleanupAllHunters();
}