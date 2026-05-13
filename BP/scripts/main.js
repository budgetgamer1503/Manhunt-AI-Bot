/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
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
    attemptBedPlacementNearPortal, getCurrentConfigSnapshot
} from "./entity_manager.js";
import { startAI, stopAI, forceChaseMode, triggerAttack, rollCrit, handleDamage } from "./state_machine.js";

let spawnSequenceActive = false;
let bedScanId = null;
let bedScanCounter = 0;
let loadoutSyncId = null;

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
    stopBedScanning();
    stopLoadoutSync();
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
        playSound(player);

        const countdownId = system.runInterval(() => {
            countdown--;
            if (countdown > 0) {
                showCountdown(player, countdown);
                playSound(player);
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

                    startAI();
                    startBedScanning();
                    startLoadoutSync();
                    player.sendMessage(`§c§l${config.name} §r§7has spawned and is hunting you.`);
                    player.sendMessage(`§7AI Level: §6${config.aiLevel}`);
                    player.sendMessage(`§7Inventory Mode: §b${describeInventoryMode(config.inventoryMode)}`);
                    player.sendMessage("§7Preparation mode is hybrid: the hunter can still gather, craft, and upgrade gear.");
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

function playSound(player) {
    try {
        player.playSound("random.click", { volume: 0.8, pitch: 1.2 });
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
            } catch (_) { }
        }
        stopAI();
        stopBedScanning();
        stopLoadoutSync();
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
                startAI();
                startBedScanning();
                startLoadoutSync();
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
            } catch (_) { }
        }

        stopAI();
        stopBedScanning();
        stopLoadoutSync();
        system.runTimeout(() => {
            try { despawn(false); } catch (_) { }
        }, 10);
    });
}

function handlePlayerDeath(entity) {
    const target = getTarget();
    if (!target || target.id !== entity.id) return;

    system.runTimeout(() => {
        if (isRespawning()) {
            cancelRespawn("target player died during respawn");
        }

        despawn(false);
        stopAI();
        stopBedScanning();
        stopLoadoutSync();

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
                stopBedScanning();
                stopLoadoutSync();
                world.sendMessage(`§7${event.playerName} left the game. The hunter has been despawned.`);
            }
        } catch (_) {
            if (isRespawning()) {
                cancelRespawn("target player left during respawn");
            }
            despawn(false);
            stopAI();
            stopBedScanning();
            stopLoadoutSync();
        }
    }

    clearPlayerConfig(event.playerId ?? "");
});

system.runTimeout(() => {
    cleanupOrphans();
}, 40);

system.run(() => {
    world.sendMessage("§eManhunt Bot §7loaded. Use the §eHunter Compass §7to begin.");
});

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
