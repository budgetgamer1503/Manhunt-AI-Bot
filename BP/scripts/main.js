/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { world, system, EffectTypes, EquipmentSlot } from "@minecraft/server";
import {
    showSpawnMenu, clearPlayerConfig, rememberLastUsedConfig
} from "./ui.js";
import { WEAPON_DAMAGE, capturePlayerInventoryProfile, describeInventoryMode } from "./inventory.js";
import {
    getHunter, getTarget, getInventory, isActive, isRespawning,
    spawn, despawn, respawn, canRespawn, getDeathCount,
    setTarget, setBed, storeDeathLocation, resolveDeathPosition,
    cachePosition, cleanupOrphans, cancelRespawn,
    getEquipmentPersistence, saveInventoryForRespawn, clearSavedInventory,
    attemptBedPlacementNearPortal, getCurrentConfigSnapshot,
    getTargets, addTarget, removeTarget, clearTargets
} from "./entity_manager.js";
import { startAI, stopAI, forceChaseMode, triggerAttack, rollCrit, handleDamage } from "./state_machine.js";
import { startHunt, endHunt, recordHunterDeath, recordRunnerDeath, checkTimeLimit, loadHuntState, isHuntActive } from "./win_conditions.js";
import { startStats, endStats, recordDamageDealt, recordDamageTaken, recordHunterDeath as statsRecordHunterDeath, recordRunnerDeath as statsRecordRunnerDeath } from "./stats.js";
import {
    playFootstep, playProximityHeartbeat, playAttackSound, playDeathSound,
    playRespawnSound, playTauntSound, playHuntStartSound, playHuntEndSound,
    playCountdownSound, playBlockPlaceSound, playBlockBreakSound, playEatSound
} from "./sounds.js";
import { info, debug, error } from "./logger.js";
const MODULE = "main";
let spawnSequenceActive = false;
let bedScanId = null;
let bedScanCounter = 0;
let loadoutSyncId = null;
let compassTrackingId = null;
let footstepId = null;
let proximityId = null;
let timeLimitCheckId = null;
loadHuntState();
system.runTimeout(() => {
    cleanupOrphans();
}, 40);
system.run(() => {
    info(MODULE, "Manhunt Bot v0.7.0 loaded.");
    world.sendMessage("§eManhunt Bot v0.7.0 §7loaded. Use the §eHunter Compass §7to begin.");
});
world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;
    if (!item || item.typeId !== "manhunt:hunter_compass") return;
    if (spawnSequenceActive) {
        player.onScreenDisplay.setActionBar("§eSpawn sequence already in progress.");
        return;
    }
    system.run(() => {
        showSpawnMenu(player, {
            onSpawn: onSpawnConfirmed,
            onQuickRestart: onQuickRestartRequested,
            onDespawn: onDespawnRequested
        }, isActive());
    });
});
function onSpawnConfirmed(player, config) {
    if (isActive()) {
        player.onScreenDisplay.setActionBar("§cA hunter is already active.");
        return;
    }
    beginSpawnSequence(player, config);
}
function onQuickRestartRequested(player, config) {
    if (isActive()) {
        player.onScreenDisplay.setActionBar("§cA hunter is already active.");
        return;
    }
    beginSpawnSequence(player, config);
}
function onDespawnRequested(player) {
    if (!isActive() && !isRespawning()) return;
    if (isRespawning()) {
        cancelRespawn("manual despawn requested");
    }
    despawn(true);
    stopAI();
    stopAllSystems();
    player.sendMessage("§7The hunter has been despawned.");
}
function beginSpawnSequence(player, config) {
    if (spawnSequenceActive) return;
    spawnSequenceActive = true;
    rememberLastUsedConfig(player.id, config);
    try {
        const playerLoadout = capturePlayerInventoryProfile(player);
        try {
            const inventory = player.getComponent("minecraft:inventory");
            if (inventory?.container) inventory.container.clearAll();
        } catch (_) { }
        try {
            const equippable = player.getComponent("minecraft:equippable");
            if (equippable) {
                for (const slot of ["Head", "Chest", "Legs", "Feet", "Offhand"]) {
                    try { equippable.setEquipment(slot, undefined); } catch (_) { }
                }
            }
        } catch (_) { }
        try {
            const regeneration = EffectTypes.get("regeneration");
            const saturation = EffectTypes.get("saturation");
            if (regeneration) player.addEffect(regeneration, 200, { amplifier: 4, showParticles: true });
            if (saturation) player.addEffect(saturation, 200, { amplifier: 4, showParticles: false });
        } catch (_) { }
        let countdown = 10;
        showCountdown(player, countdown);
        const countdownId = system.runInterval(() => {
            countdown--;
            if (countdown > 0) {
                showCountdown(player, countdown);
                return;
            }
            if (countdown === 0) {
                showHuntBegins(player, config.name);
                const hunter = spawn(player, config, playerLoadout);
                if (hunter) {
                    const hunterInventory = getInventory();
                    if (hunterInventory) {
                        try { hunterInventory.equipBest(hunter); } catch (_) { }
                    }
                                        startHunt(config);
                    startStats();
                    startAI();
                    startBedScanning();
                    startLoadoutSync();
                    startCompassTracking();
                    startTimeLimitCheck();
                    player.sendMessage(`§c§l${config.name} §r§7has spawned and is hunting you.`);
                    player.sendMessage(`§7AI Level: §6${config.aiLevel}`);
                    player.sendMessage(`§7Inventory Mode: §b${describeInventoryMode(config.inventoryMode)}`);
                    player.sendMessage(`§7Win Condition: §6${config.winCondition || "Infinite"}`);
                    player.sendMessage("§7Tip: Sneak to hide from the tracker.");
                } else {
                    player.sendMessage("§cFailed to spawn hunter. Try again.");
                }
                system.clearRun(countdownId);
                spawnSequenceActive = false;
            }
        }, 20);
    } catch (_) {
        spawnSequenceActive = false;
        player.sendMessage("§cError during spawn sequence. Try again.");
    }
}
function showCountdown(player, secondsLeft) {
    try {
        let color = "§a";
        if (secondsLeft <= 3) color = "§c§l";
        else if (secondsLeft <= 6) color = "§e";
        player.onScreenDisplay.setTitle(`${color}${secondsLeft}`, {
            fadeInDuration: 0,
            fadeOutDuration: 5,
            stayDuration: 15,
            subtitle: "§7The hunter is coming..."
        });
    } catch (_) { }
}
function showHuntBegins(player, name) {
    try {
        player.onScreenDisplay.setTitle("§4§lTHE HUNT BEGINS", {
            fadeInDuration: 5,
            fadeOutDuration: 20,
            stayDuration: 40,
            subtitle: `§c${name}`
        });
    } catch (_) { }
}
system.runInterval(() => {
    cachePosition();
}, 5);
world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (!entity) return;
    try {
        if (entity.typeId === "manhunt:hunter" && entity.hasTag("hunter_active")) {
            handleHunterDeath(entity);
            return;
        }
        if (entity.typeId === "minecraft:player") {
            handlePlayerDeath(entity);
        }
    } catch (_) { }
});
function handleHunterDeath(entity) {
    const death = resolveDeathPosition(entity);
    storeDeathLocation(death.pos, death.dimId);
    playDeathSound(entity.dimension, death.pos);
    const target = getTarget();
    const inventory = getInventory();
    if (inventory) {
        if (getEquipmentPersistence()) {
            saveInventoryForRespawn(inventory);
        } else {
            try {
                const dim = world.getDimension(death.dimId);
                inventory.dropAll(dim, death.pos);
            } catch (_) {
                try { inventory.dropAll(entity.dimension, death.pos); } catch (_) { }
            }
            clearSavedInventory();
        }
    }
    try {
        entity.runCommand("replaceitem entity @s slot.weapon.offhand 0 air 0");
    } catch (_) { }
        statsRecordHunterDeath();
        const result = recordHunterDeath();
    if (result.huntOver) {
        if (target) {
            try {
                target.onScreenDisplay.setTitle("§a§lHUNTER DEFEATED!", {
                    fadeInDuration: 5,
                    fadeOutDuration: 20,
                    stayDuration: 60,
                    subtitle: "§7You survived the manhunt."
                });
                target.sendMessage("§aThe hunter has been defeated. §7You won the manhunt.");
                playHuntEndSound(target, "runner");
            } catch (_) { }
        }
        endStats("runner", result.reason);
        stopAI();
        stopAllSystems();
        system.runTimeout(() => {
            try { despawn(false); } catch (_) { }
        }, 10);
        return;
    }
    if (!canRespawn()) {
        if (target) {
            try {
                target.onScreenDisplay.setTitle("§a§lHUNTER DEFEATED!", {
                    fadeInDuration: 5,
                    fadeOutDuration: 20,
                    stayDuration: 60,
                    subtitle: "§7You survived the manhunt."
                });
                target.sendMessage("§aThe hunter has been defeated. §7You won the manhunt.");
                playHuntEndSound(target, "runner");
            } catch (_) { }
        }
        endStats("runner", "Hunter could not respawn");
        stopAI();
        stopAllSystems();
        system.runTimeout(() => {
            try { despawn(false); } catch (_) { }
        }, 10);
        return;
    }
    if (target) {
        try {
            const deathNum = getDeathCount() + 1;
            target.onScreenDisplay.setTitle("§e§lHUNTER KILLED!", {
                fadeInDuration: 5,
                fadeOutDuration: 20,
                stayDuration: 60,
                subtitle: `§7Respawning in 1 minute... §8(Death #${deathNum})`
            });
            target.sendMessage("§eHunter killed. §7Respawn sequence started for 1 minute.");
        } catch (_) { }
    }
    stopAI();
    respawn((newHunter) => {
        if (newHunter && target) {
            try {
                setTarget(target);
                playRespawnSound(newHunter.dimension, newHunter.location);
                startAI();
                startBedScanning();
                startLoadoutSync();
                startCompassTracking();
                startFootstepSounds();
                startProximitySounds();
                startTimeLimitCheck();
            } catch (_) { }
            return;
        }
        if (target) {
            try {
                target.onScreenDisplay.setTitle("§a§lHUNTER DEFEATED!", {
                    fadeInDuration: 5,
                    fadeOutDuration: 20,
                    stayDuration: 60,
                    subtitle: "§7The hunter failed to respawn."
                });
                target.sendMessage("§aThe hunter has been permanently defeated.");
                playHuntEndSound(target, "runner");
            } catch (_) { }
        }
        endStats("runner", "Hunter failed to respawn");
        stopAI();
        stopAllSystems();
        system.runTimeout(() => {
            try { despawn(false); } catch (_) { }
        }, 10);
    });
}
function handlePlayerDeath(entity) {
    const target = getTarget();
    if (!target || target.id !== entity.id) return;
    statsRecordRunnerDeath();
    const result = recordRunnerDeath(entity.nameTag || "Player");
    if (result.huntOver) {
        endStats("hunter", result.reason);
    }
    system.runTimeout(() => {
        if (isRespawning()) {
            cancelRespawn("target player died during respawn");
        }
        despawn(false);
        stopAI();
        stopAllSystems();
        try {
            world.sendMessage(`§c${entity.nameTag || "Player"} §7was killed by the hunter. The manhunt is over.`);
        } catch (_) { }
    }, 20);
}
world.afterEvents.entityHurt.subscribe((event) => {
    const entity = event.hurtEntity;
    if (!entity) return;
    try {
        if (entity.typeId === "manhunt:hunter" && entity.hasTag("hunter_active")) {
            const damage = event.damage;
            recordDamageTaken(damage);
            const inventory = getInventory();
            if (inventory) {
                const cause = event.damageSource?.cause ?? "none";
                const attacker = event.damageSource?.damagingEntity ?? undefined;
                handleDamage(entity, inventory, cause, attacker);
            }
            forceChaseMode();
        }
    } catch (_) { }
});
world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const target = event.hitEntity;
    if (!attacker || !target) return;
    try {
        if (attacker.typeId === "manhunt:hunter" && attacker.hasTag("hunter_active")) {
            triggerAttack(attacker);
            playAttackSound(attacker);
            const equippable = attacker.getComponent("minecraft:equippable");
            if (equippable) {
                const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
                if (mainhand && WEAPON_DAMAGE[mainhand.typeId]) {
                    const weaponDamage = WEAPON_DAMAGE[mainhand.typeId];
                    let extraDamage = weaponDamage - 3;
                    const { isCrit, multiplier } = rollCrit(attacker);
                    if (isCrit && extraDamage > 0) {
                        extraDamage = Math.ceil(extraDamage * multiplier);
                        try {
                            const targetPos = target.location;
                            attacker.dimension.spawnParticle("minecraft:critical_hit_emitter", {
                                x: targetPos.x,
                                y: targetPos.y + 1,
                                z: targetPos.z
                            });
                        } catch (_) { }
                    }
                    if (extraDamage > 0) {
                        try {
                            target.applyDamage(extraDamage, {
                                cause: "entityAttack",
                                damagingEntity: attacker
                            });
                        } catch (_) { }
                    }
                    recordDamageDealt(weaponDamage + extraDamage);
                }
            }
        }
    } catch (_) { }
});
function startBedScanning() {
    if (bedScanId !== null) return;
    bedScanId = system.runInterval(() => {
        const hunter = getHunter();
        const target = getTarget();
        let scanPos = null;
        let scanDim = null;
        if (hunter) {
            scanPos = hunter.location;
            scanDim = hunter.dimension;
        } else if (target) {
            scanPos = target.location;
            scanDim = target.dimension;
        }
        if (!scanPos || !scanDim) return;
        try {
            const dimId = scanDim.id.replace("minecraft:", "");
            for (let x = -3; x <= 3; x++) {
                for (let y = -1; y <= 2; y++) {
                    for (let z = -3; z <= 3; z++) {
                        const blockPos = {
                            x: Math.floor(scanPos.x) + x,
                            y: Math.floor(scanPos.y) + y,
                            z: Math.floor(scanPos.z) + z
                        };
                        try {
                            const block = scanDim.getBlock(blockPos);
                            if (block?.typeId?.includes("bed")) {
                                setBed(blockPos, dimId);
                                return;
                            }
                        } catch (_) { }
                    }
                }
            }
            bedScanCounter++;
            if (bedScanCounter >= 5) {
                bedScanCounter = 0;
                attemptBedPlacementNearPortal();
            }
        } catch (_) { }
    }, 200);
}
function stopBedScanning() {
    if (bedScanId === null) return;
    system.clearRun(bedScanId);
    bedScanId = null;
}
function startCompassTracking() {
    if (compassTrackingId !== null) return;
    compassTrackingId = system.runInterval(() => {
        const hunter = getHunter();
        const target = getTarget();
        if (!hunter || !target) return;
        try {
            const hPos = hunter.location;
            const tPos = target.location;
            const dx = hPos.x - tPos.x;
            const dz = hPos.z - tPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
                        const equippable = target.getComponent("minecraft:equippable");
            if (equippable) {
                const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
                if (mainhand?.typeId === "manhunt:hunter_compass") {
                    const color = dist < 30 ? "§c" : dist < 80 ? "§e" : "§a";
                    const arrow = getDirectionArrow(tPos, hPos);
                    target.onScreenDisplay.setActionBar(`${color}${arrow} Hunter: ${Math.floor(dist)}m away`);
                }
            }
        } catch (_) { }
    }, 10);
}
function getDirectionArrow(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const angle = Math.atan2(dx, dz) * (180 / Math.PI);
    if (angle >= -22.5 && angle < 22.5) return "↑";           if (angle >= 22.5 && angle < 67.5) return "↗";            if (angle >= 67.5 && angle < 112.5) return "→";           if (angle >= 112.5 && angle < 157.5) return "↘";          if (angle >= 157.5 || angle < -157.5) return "↓";         if (angle >= -157.5 && angle < -112.5) return "↙";        if (angle >= -112.5 && angle < -67.5) return "←";         if (angle >= -67.5 && angle < -22.5) return "↖";          return "●";
}
function stopCompassTracking() {
    if (compassTrackingId === null) return;
    system.clearRun(compassTrackingId);
    compassTrackingId = null;
}
function startFootstepSounds() {
    if (footstepId !== null) return;
    footstepId = system.runInterval(() => {
        const hunter = getHunter();
        if (!hunter) return;
        try {
            const vel = hunter.getVelocity();
            const speed = Math.sqrt(vel.x ** 2 + vel.z ** 2);
            if (speed > 0.05) {
                playFootstep(hunter);
            }
        } catch (_) { }
    }, 8);
}
function stopFootstepSounds() {
    if (footstepId === null) return;
    system.clearRun(footstepId);
    footstepId = null;
}
function startProximitySounds() {
    if (proximityId !== null) return;
    proximityId = system.runInterval(() => {
        const hunter = getHunter();
        const target = getTarget();
        if (!hunter || !target) return;
        try {
            const hPos = hunter.location;
            const tPos = target.location;
            const dist = Math.sqrt((hPos.x - tPos.x) ** 2 + (hPos.z - tPos.z) ** 2);
            playProximityHeartbeat(target, dist);
        } catch (_) { }
    }, 20);
}
function stopProximitySounds() {
    if (proximityId === null) return;
    system.clearRun(proximityId);
    proximityId = null;
}
function startTimeLimitCheck() {
    if (timeLimitCheckId !== null) return;
    timeLimitCheckId = system.runInterval(() => {
        const result = checkTimeLimit();
        if (result.huntOver) {
            const target = getTarget();
            if (target) {
                try {
                    target.onScreenDisplay.setTitle("§a§lTIME'S UP!", {
                        fadeInDuration: 5,
                        fadeOutDuration: 20,
                        stayDuration: 60,
                        subtitle: "§7You survived the time limit!"
                    });
                    target.sendMessage("§aYou survived! §7The time limit has expired.");
                    playHuntEndSound(target, "runner");
                } catch (_) { }
            }
            endStats("runner", result.reason);
            stopAI();
            stopAllSystems();
            system.runTimeout(() => {
                try { despawn(false); } catch (_) { }
            }, 10);
        }
    }, 40);
}
function stopTimeLimitCheck() {
    if (timeLimitCheckId === null) return;
    system.clearRun(timeLimitCheckId);
    timeLimitCheckId = null;
}
function startLoadoutSync() {
    if (loadoutSyncId !== null) return;
    loadoutSyncId = system.runInterval(() => {
        if (isRespawning()) return;
        const hunter = getHunter();
        const target = getTarget();
        const hunterInventory = getInventory();
        if (!hunter || !target || !hunterInventory) return;
        const currentConfig = getCurrentConfigSnapshot();
        if (currentConfig.inventoryMode !== "player_share") return;
        const playerLoadout = capturePlayerInventoryProfile(target);
        hunterInventory.refreshForConfig(currentConfig, playerLoadout, {
            replaceExisting: false,
            preserveUpgrades: true
        });
        try { hunterInventory.equipBest(hunter); } catch (_) { }
    }, 40);
}
function stopLoadoutSync() {
    if (loadoutSyncId === null) return;
    system.clearRun(loadoutSyncId);
    loadoutSyncId = null;
}
world.afterEvents.playerLeave.subscribe((event) => {
    const target = getTarget();
    if (target) {
        try {
            if (target.name === event.playerName) {
                if (isRespawning()) {
                    cancelRespawn("target player left during respawn");
                }
                despawn(false);
                stopAI();
                stopAllSystems();
                world.sendMessage(`§7${event.playerName} left the game. The hunter has been despawned.`);
            }
        } catch (_) {
            if (isRespawning()) {
                cancelRespawn("target player left during respawn");
            }
            despawn(false);
            stopAI();
            stopAllSystems();
        }
    }
    clearPlayerConfig(event.playerId ?? "");
});
world.afterEvents.playerDimensionChange.subscribe((event) => {
    const player = event.player;
    const target = getTarget();
    if (!target || player.id !== target.id) return;
    debug(MODULE, `Target changed dimension: ${event.fromDimension.id} -> ${event.toDimension.id}`);
        system.runTimeout(() => {
        const hunter = getHunter();
        if (!hunter || !isActive()) return;
        try {
            const toDimension = event.toDimension;
            const tPos = player.location;
                        let spawnY = tPos.y;
            for (let y = Math.floor(tPos.y) + 10; y >= Math.max(tPos.y - 20, -64); y--) {
                const block = toDimension.getBlock({ x: Math.floor(tPos.x), y, z: Math.floor(tPos.z) });
                if (block && block.typeId !== "minecraft:air" && block.typeId !== "minecraft:water") {
                    spawnY = y + 1;
                    break;
                }
            }
            const angle = Math.random() * Math.PI * 2;
            const dist = 8 + Math.random() * 5;
            const newX = tPos.x + Math.cos(angle) * dist;
            const newZ = tPos.z + Math.sin(angle) * dist;
            hunter.teleport(
                { x: newX, y: spawnY, z: newZ },
                { dimension: toDimension }
            );
            debug(MODULE, `Hunter followed target to ${toDimension.id}`);
            target.sendMessage("§cThe hunter followed you through the portal!");
        } catch (e) {
            error(MODULE, "Failed to follow target through portal", e);
        }
    }, 60); });
function stopAllSystems() {
    stopBedScanning();
    stopLoadoutSync();
    stopCompassTracking();
    stopFootstepSounds();
    stopProximitySounds();
    stopTimeLimitCheck();
}