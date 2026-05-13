/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
    getAILevel, getBed, getDeathCount, getEquipmentPersistence,
    getHunter, getLastRespawnStatus, getRespawnDebug, getTarget,
    isActive, isRespawning, getInventory
} from "./entity_manager.js";
import { getAIState } from "./state_machine.js";
import { INVENTORY_MODES, describeInventoryMode, capturePlayerInventoryProfile } from "./inventory.js";
import { getCreatorKitChoices, DEFAULT_CREATOR_KIT_ID } from "./kits.js";
import { WIN_CONDITIONS, getHuntState, getRemainingTimeMinutes, getRemainingLives, getRemainingKills } from "./win_conditions.js";
import { getScalingDescription } from "./difficulty_scaling.js";

const CONFIG_PROP = "manhunt:last_config";

const SKIN_OPTIONS = [
    { id: 0, name: "Steve", description: "Classic Steve skin" },
    { id: 1, name: "Alex", description: "Classic Alex skin" },
    { id: 2, name: "Zombie", description: "Zombie hunter skin" },
    { id: 3, name: "Skeleton", description: "Skeleton hunter skin" },
    { id: 4, name: "Creeper", description: "Creeper hunter skin" },
    { id: 5, name: "Custom Skin", description: "Reserved custom skin slot" },
    { id: 6, name: "Dream", description: "Green hoodie and white mask" },
    { id: 7, name: "Technoblade", description: "Pink skin with crown" }
];

const AI_LEVELS = [
    { id: "easy", name: "Easy", description: "Lower pressure, slower reactions, safer retreats" },
    { id: "normal", name: "Normal", description: "Current baseline behavior" },
    { id: "expert", name: "Expert", description: "Higher pressure, faster reactions, stronger combat" }
];

const PREP_BEHAVIORS = [
    { id: "hybrid", name: "Hybrid", description: "Hunter can gather, craft, and upgrade gear during chase." },
    { id: "pure_chase", name: "Pure Chase", description: "Hunter never stops to gather — relentless pursuit." },
    { id: "aggressive", name: "Aggressive", description: "Shorter prep phases, faster gathering, more combat." }
];

const playerConfigs = new Map();
const lastUsedConfigs = new Map();

function getDefaultConfig() {
    return {
        name: "Hunter",
        skinId: 0,
        enableTaunts: true,
        boatHandling: "destroy",
        equipmentPersistence: false,
        aiLevel: "normal",
        respawnDebug: false,
        inventoryMode: "starter",
        creatorKitId: DEFAULT_CREATOR_KIT_ID,
        prepBehavior: "hybrid",
        winCondition: "infinite",
        maxLives: 3,
        timeLimitMinutes: 30,
        killTarget: 3,
        difficultyScaling: true
    };
}

function cloneConfig(config = {}) {
    const defaults = getDefaultConfig();
    return {
        name: config.name || defaults.name,
        skinId: Number.isInteger(config.skinId) ? config.skinId : defaults.skinId,
        enableTaunts: config.enableTaunts !== undefined ? !!config.enableTaunts : defaults.enableTaunts,
        boatHandling: config.boatHandling === "ignore" ? "ignore" : defaults.boatHandling,
        equipmentPersistence: config.equipmentPersistence !== undefined ? !!config.equipmentPersistence : defaults.equipmentPersistence,
        aiLevel: AI_LEVELS.some((level) => level.id === config.aiLevel) ? config.aiLevel : defaults.aiLevel,
        respawnDebug: config.respawnDebug !== undefined ? !!config.respawnDebug : defaults.respawnDebug,
        inventoryMode: INVENTORY_MODES.some((mode) => mode.id === config.inventoryMode) ? config.inventoryMode : defaults.inventoryMode,
        creatorKitId: typeof config.creatorKitId === "string" && config.creatorKitId.length > 0 ? config.creatorKitId : defaults.creatorKitId,
        prepBehavior: PREP_BEHAVIORS.some((b) => b.id === config.prepBehavior) ? config.prepBehavior : defaults.prepBehavior,
        winCondition: WIN_CONDITIONS.some((w) => w.id === config.winCondition) ? config.winCondition : defaults.winCondition,
        maxLives: Number.isInteger(config.maxLives) && config.maxLives > 0 ? config.maxLives : defaults.maxLives,
        timeLimitMinutes: Number.isInteger(config.timeLimitMinutes) && config.timeLimitMinutes > 0 ? config.timeLimitMinutes : defaults.timeLimitMinutes,
        killTarget: Number.isInteger(config.killTarget) && config.killTarget > 0 ? config.killTarget : defaults.killTarget,
        difficultyScaling: config.difficultyScaling !== undefined ? !!config.difficultyScaling : defaults.difficultyScaling
    };
}

function getConfig(playerId) {
    if (!playerConfigs.has(playerId)) {
        // Try loading from persistent storage
        const loaded = loadPersistentConfig(playerId);
        playerConfigs.set(playerId, loaded || getDefaultConfig());
    }
    return playerConfigs.get(playerId);
}

function loadPersistentConfig(playerId) {
    try {
        const raw = world.getDynamicProperty(`${CONFIG_PROP}_${playerId}`);
        if (raw) {
            return cloneConfig(JSON.parse(raw));
        }
    } catch (_) { }
    return null;
}

function savePersistentConfig(playerId, config) {
    try {
        world.setDynamicProperty(`${CONFIG_PROP}_${playerId}`, JSON.stringify(config));
    } catch (_) { }
}

export function rememberLastUsedConfig(playerId, config) {
    const cloned = cloneConfig(config);
    lastUsedConfigs.set(playerId, cloned);
    savePersistentConfig(playerId, cloned);
}

export function getLastUsedConfig(playerId) {
    const config = lastUsedConfigs.get(playerId);
    if (config) return cloneConfig(config);
    return loadPersistentConfig(playerId);
}

export function describeAILevel(levelId) {
    return AI_LEVELS.find((level) => level.id === levelId)?.name ?? "Normal";
}

export function describeWinCondition(conditionId) {
    return WIN_CONDITIONS.find((w) => w.id === conditionId)?.name ?? "Infinite";
}

export function describePrepBehavior(behaviorId) {
    return PREP_BEHAVIORS.find((b) => b.id === behaviorId)?.name ?? "Hybrid";
}

export function showSpawnMenu(player, handlers, hunterActive = false) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§l§4MANHUNT BOT v0.7.0")
        .body(buildSpawnMenuBody(config, hunterActive));

    const actions = [];
    addMenuButton(form, actions, "§l§cStart Hunt\n§r§7Use current config and begin countdown", () => {
        if (hunterActive) {
            player.onScreenDisplay.setActionBar("§cA hunter is already active.");
            return;
        }
        showSpawnConfirmation(player, config, handlers, hunterActive, false);
    });

    addMenuButton(form, actions, "§l§6Quick Restart\n§r§7Reuse the last confirmed hunt config", () => {
        const lastConfig = getLastUsedConfig(player.id);
        if (!lastConfig) {
            player.onScreenDisplay.setActionBar("§eNo previous hunt config is available.");
            return;
        }
        if (hunterActive) {
            player.onScreenDisplay.setActionBar("§cDespawn the current hunter first.");
            return;
        }
        showSpawnConfirmation(player, lastConfig, handlers, hunterActive, true);
    });

    addMenuButton(form, actions, "§l§bHunt Status\n§r§7View runtime state and respawn info", () => {
        showHuntStatus(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, "§lEdit Name\n§r§7Change hunter name", () => {
        showNameEditor(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, "§lSelect Skin\n§r§7Choose hunter appearance", () => {
        showSkinSelector(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, `§lAI Level: ${describeAILevel(config.aiLevel)}\n§r§7Set difficulty profile`, () => {
        showAILevelSelector(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, `§lInventory Mode: ${describeInventoryMode(config.inventoryMode)}\n§r§7Set item source for hunter`, () => {
        showInventoryModeSelector(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, `§lWin Condition: ${describeWinCondition(config.winCondition)}\n§r§7Set how the hunt ends`, () => {
        showWinConditionSelector(player, handlers, hunterActive);
    });

    addMenuButton(form, actions, `§lPrep Behavior: ${describePrepBehavior(config.prepBehavior)}\n§r§7Set gathering/preparation style`, () => {
        showPrepBehaviorSelector(player, handlers, hunterActive);
    });

    addMenuButton(
        form, actions,
        config.difficultyScaling
            ? "§lDifficulty Scaling: Enabled\n§r§7Hunter gets harder over time"
            : "§lDifficulty Scaling: Disabled\n§r§7Hunter stays at base difficulty",
        () => {
            config.difficultyScaling = !config.difficultyScaling;
            player.onScreenDisplay.setActionBar(
                config.difficultyScaling ? "§aDifficulty scaling enabled." : "§cDifficulty scaling disabled."
            );
            showSpawnMenu(player, handlers, hunterActive);
        }
    );

    addMenuButton(
        form, actions,
        config.enableTaunts
            ? "§lTaunts: Enabled\n§r§7Hunter sends hunt taunts"
            : "§lTaunts: Disabled\n§r§7Hunter stays silent",
        () => {
            config.enableTaunts = !config.enableTaunts;
            player.onScreenDisplay.setActionBar(
                config.enableTaunts ? "§aHunter taunts enabled." : "§cHunter taunts disabled."
            );
            showSpawnMenu(player, handlers, hunterActive);
        }
    );

    addMenuButton(
        form, actions,
        config.boatHandling === "destroy"
            ? "§lBoat Handling: Destroy\n§r§7Hunter breaks nearby boats"
            : "§lBoat Handling: Ignore\n§r§7Hunter ignores boats",
        () => {
            config.boatHandling = config.boatHandling === "destroy" ? "ignore" : "destroy";
            player.onScreenDisplay.setActionBar(
                config.boatHandling === "destroy"
                    ? "§eHunter will destroy nearby boats."
                    : "§7Hunter will ignore boats."
            );
            showSpawnMenu(player, handlers, hunterActive);
        }
    );

    addMenuButton(
        form, actions,
        config.equipmentPersistence
            ? "§lEquipment: Keep On Death\n§r§7Hunter keeps gear after death"
            : "§lEquipment: Drop On Death\n§r§7Hunter drops gear after death",
        () => {
            config.equipmentPersistence = !config.equipmentPersistence;
            player.onScreenDisplay.setActionBar(
                config.equipmentPersistence
                    ? "§aEquipment persistence enabled."
                    : "§cEquipment will drop on death."
            );
            showSpawnMenu(player, handlers, hunterActive);
        }
    );

    addMenuButton(
        form, actions,
        config.respawnDebug
            ? "§lRespawn Debug: Enabled\n§r§7Show detailed respawn diagnostics"
            : "§lRespawn Debug: Disabled\n§r§7Hide detailed respawn diagnostics",
        () => {
            config.respawnDebug = !config.respawnDebug;
            player.onScreenDisplay.setActionBar(
                config.respawnDebug
                    ? "§aRespawn debug messages enabled."
                    : "§7Respawn debug messages disabled."
            );
            showSpawnMenu(player, handlers, hunterActive);
        }
    );

    if (hunterActive) {
        addMenuButton(form, actions, "§l§4Despawn Hunter\n§r§7Remove the active hunter", () => {
            handlers.onDespawn?.(player);
        });
    }

    addMenuButton(form, actions, "§lClose\n§r§7Exit menu", () => { });

    form.show(player).then((response) => {
        if (response.canceled) return;
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => { });
}

function buildSpawnMenuBody(config, hunterActive) {
    const runtimeState = hunterActive
        ? (isRespawning() ? "Respawning" : "Active")
        : (isActive() ? "Active" : "Idle");

    const huntState = getHuntState();
    let winInfo = "";
    if (huntState.active) {
        if (huntState.winCondition === "time_limit") {
            winInfo = `\n§fTime Left: §e${getRemainingTimeMinutes().toFixed(1)}m`;
        } else if (huntState.winCondition === "limited_lives") {
            winInfo = `\n§fLives Left: §c${getRemainingLives()}`;
        } else if (huntState.winCondition === "kill_count") {
            winInfo = `\n§fKills Needed: §c${getRemainingKills()}`;
        }
    }

    return [
        "§7Configure the hunter and manage the current hunt.",
        "",
        "§l§fHunter Configuration",
        `§fIdentity: §e${config.name}`,
        `§fAppearance: §b${SKIN_OPTIONS[config.skinId]?.name ?? "Steve"}`,
        `§fAI Level: §6${describeAILevel(config.aiLevel)}`,
        `§fWin Condition: §6${describeWinCondition(config.winCondition)}`,
        `§fPrep Behavior: §6${describePrepBehavior(config.prepBehavior)}`,
        "",
        "§l§fBehavior",
        `§fScaling: ${config.difficultyScaling ? "§aOn" : "§cOff"}`,
        `§fTaunts: ${config.enableTaunts ? "§aEnabled" : "§cDisabled"}`,
        `§fBoat Handling: ${config.boatHandling === "destroy" ? "§cDestroy" : "§7Ignore"}`,
        `§fEquipment: ${config.equipmentPersistence ? "§aKeep On Death" : "§cDrop On Death"}`,
        "",
        "§l§fDebug",
        `§fRespawn Debug: ${config.respawnDebug ? "§aEnabled" : "§7Disabled"}`,
        "",
        "§l§fHunt Status",
        `§fState: ${hunterActive ? "§c" : "§7"}${runtimeState}${winInfo}`
    ].join("\n");
}

function addMenuButton(form, actions, label, action) {
    form.button(label);
    actions.push(action);
}

function showSpawnConfirmation(player, config, handlers, hunterActive, isQuickRestart) {
    const form = new ActionFormData()
        .title(isQuickRestart ? "§l§6QUICK RESTART" : "§l§4CONFIRM HUNT")
        .body([
            "§7Final check before hunt begins.",
            "",
            `§fHunter: §e${config.name}`,
            `§fSkin: §b${SKIN_OPTIONS[config.skinId]?.name ?? "Steve"}`,
            `§fAI Level: §6${describeAILevel(config.aiLevel)}`,
            `§fWin Condition: §6${describeWinCondition(config.winCondition)}`,
            `§fPrep: §6${describePrepBehavior(config.prepBehavior)}`,
            `§fScaling: ${config.difficultyScaling ? "§aOn" : "§cOff"}`,
            `§fEquipment: ${config.equipmentPersistence ? "§aKeep On Death" : "§cDrop On Death"}`,
            "",
            "§cNote: Starter inventory mode will clear your inventory.",
            "§710‑second countdown starts immediately."
        ].join("\n"))
        .button(isQuickRestart ? "§l§aRestart Hunt" : "§l§aStart Hunt")
        .button("§l§7Back");

    form.show(player).then((response) => {
        if (response.canceled || response.selection === 1) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }

        const confirmedConfig = cloneConfig(config);
        rememberLastUsedConfig(player.id, confirmedConfig);
        if (isQuickRestart) {
            handlers.onQuickRestart?.(player, confirmedConfig);
        } else {
            handlers.onSpawn?.(player, confirmedConfig);
        }
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showNameEditor(player, handlers, hunterActive) {
    const config = getConfig(player.id);

    system.run(() => {
        const form = new ModalFormData()
            .title("§lEDIT HUNTER NAME")
            .textField("Hunter name", "Hunter", { defaultValue: config.name });

        form.show(player).then((response) => {
            if (response.canceled || response.cancelationReason === "UserBusy") {
                if (response.cancelationReason === "UserBusy") {
                    system.runTimeout(() => {
                        showNameEditor(player, handlers, hunterActive);
                    }, 20);
                    return;
                }
                showSpawnMenu(player, handlers, hunterActive);
                return;
            }

            const name = String(response.formValues?.[0] ?? "").trim();
            config.name = name.length > 0 ? name.substring(0, 24) : "Hunter";
            player.onScreenDisplay.setActionBar(`§aHunter name set to §e${config.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        }).catch(() => {
            showSpawnMenu(player, handlers, hunterActive);
        });
    });
}

function showSkinSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lSELECT SKIN")
        .body(`§7Current skin: §b${SKIN_OPTIONS[config.skinId]?.name ?? "Steve"}`);

    const actions = [];
    for (const skin of SKIN_OPTIONS) {
        const selected = skin.id === config.skinId ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${skin.name}${selected}\n§r§7${skin.description}`, () => {
            config.skinId = skin.id;
            player.onScreenDisplay.setActionBar(`§aSkin set to §b${skin.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showAILevelSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lAI LEVEL")
        .body(`§7Current level: §6${describeAILevel(config.aiLevel)}`);

    const actions = [];
    for (const level of AI_LEVELS) {
        const selected = level.id === config.aiLevel ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${level.name}${selected}\n§r§7${level.description}`, () => {
            config.aiLevel = level.id;
            player.onScreenDisplay.setActionBar(`§aAI level set to §6${level.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showWinConditionSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lWIN CONDITION")
        .body(`§7Current: §6${describeWinCondition(config.winCondition)}`);

    const actions = [];
    for (const condition of WIN_CONDITIONS) {
        const selected = condition.id === config.winCondition ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${condition.name}${selected}\n§r§7${condition.description}`, () => {
            config.winCondition = condition.id;
            player.onScreenDisplay.setActionBar(`§aWin condition set to §6${condition.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showPrepBehaviorSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lPREP BEHAVIOR")
        .body(`§7Current: §6${describePrepBehavior(config.prepBehavior)}`);

    const actions = [];
    for (const behavior of PREP_BEHAVIORS) {
        const selected = behavior.id === config.prepBehavior ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${behavior.name}${selected}\n§r§7${behavior.description}`, () => {
            config.prepBehavior = behavior.id;
            player.onScreenDisplay.setActionBar(`§aPrep behavior set to §6${behavior.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showInventoryModeSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lINVENTORY MODE")
        .body(`§7Current mode: §6${describeInventoryMode(config.inventoryMode)}\n§7Kit: §6${config.creatorKitId || "Default"}`);

    const actions = [];
    for (const mode of INVENTORY_MODES) {
        const selected = mode.id === config.inventoryMode ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${mode.name}${selected}\n§r§7${mode.description}`, () => {
            config.inventoryMode = mode.id;

            if (mode.id === "creator_kit") {
                if (hunterActive) {
                    try {
                        const hunter = getHunter();
                        const target = getTarget();
                        const hunterInventory = getInventory();
                        if (hunter && target && hunterInventory) {
                            const playerLoadout = capturePlayerInventoryProfile(target);
                            hunterInventory.refreshForConfig(config, playerLoadout, {
                                replaceExisting: false,
                                preserveUpgrades: true
                            });
                            try { hunterInventory.equipBest(hunter); } catch (_) { }
                        }
                    } catch (_) { }
                }
                showCreatorKitSelector(player, handlers, hunterActive);
                return;
            }

            if (mode.id !== "creator_kit") {
                config.creatorKitId = DEFAULT_CREATOR_KIT_ID;
            }
            if (hunterActive) {
                try {
                    const hunter = getHunter();
                    const target = getTarget();
                    const hunterInventory = getInventory();
                    if (hunter && target && hunterInventory) {
                        const playerLoadout = capturePlayerInventoryProfile(target);
                        hunterInventory.refreshForConfig(config, playerLoadout, {
                            replaceExisting: false,
                            preserveUpgrades: true
                        });
                        try { hunterInventory.equipBest(hunter); } catch (_) { }
                    }
                } catch (_) { }
            }

            player.onScreenDisplay.setActionBar(`§aInventory mode set to §6${mode.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showCreatorKitSelector(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const choices = getCreatorKitChoices();
    const form = new ActionFormData()
        .title("§lCREATOR KIT")
        .body(`§7Select a kit for creator_kit mode`);

    const actions = [];
    for (const kit of choices) {
        const selected = kit.id === config.creatorKitId ? " §a[Selected]" : "";
        addMenuButton(form, actions, `§l${kit.name}${selected}\n§r§7${kit.description}`, () => {
            config.creatorKitId = kit.id;

            if (hunterActive && config.inventoryMode === "creator_kit") {
                try {
                    const hunter = getHunter();
                    const target = getTarget();
                    const hunterInventory = getInventory();
                    if (hunter && target && hunterInventory) {
                        const playerLoadout = capturePlayerInventoryProfile(target);
                        hunterInventory.refreshForConfig(config, playerLoadout, {
                            replaceExisting: false,
                            preserveUpgrades: true
                        });
                        try { hunterInventory.equipBest(hunter); } catch (_) { }
                    }
                } catch (_) { }
            }

            player.onScreenDisplay.setActionBar(`§aCreator kit set to §6${kit.name}`);
            showSpawnMenu(player, handlers, hunterActive);
        });
    }

    addMenuButton(form, actions, "§l§7Back", () => {
        showInventoryModeSelector(player, handlers, hunterActive);
    });

    form.show(player).then((response) => {
        if (response.canceled) {
            showInventoryModeSelector(player, handlers, hunterActive);
            return;
        }
        const action = actions[response.selection];
        if (action) action();
    }).catch(() => {
        showInventoryModeSelector(player, handlers, hunterActive);
    });
}

function showHuntStatus(player, handlers, hunterActive) {
    const hunter = getHunter();
    const target = getTarget();
    const bed = getBed();
    const respawnStatus = getLastRespawnStatus();
    const huntState = getHuntState();

    const lines = [
        `§fHunt State: ${isRespawning() ? "§eRespawning" : (hunterActive ? "§cActive" : "§7Idle")}`,
        `§fTarget Player: ${target ? `§e${target.name}` : "§7None"}`,
        `§fAI Level: §6${describeAILevel(getAILevel())}`,
        `§fAI Phase: §b${getAIState()}`,
        `§fHunter Dimension: ${hunter ? `§a${hunter.dimension.id.replace("minecraft:", "")}` : "§7None"}`,
        `§fDeaths: §c${getDeathCount()}`,
        `§fWin Condition: §6${describeWinCondition(huntState.winCondition)}`,
        `§fScaling: §7${getScalingDescription(getAILevel(), getDeathCount(), huntState.huntStartTick)}`,
        `§fEquipment Persistence: ${getEquipmentPersistence() ? "§aOn" : "§cOff"}`,
        `§fTracked Bed: ${bed.pos ? `§a${bed.dimId} @ ${Math.floor(bed.pos.x)} ${Math.floor(bed.pos.y)} ${Math.floor(bed.pos.z)}` : "§7None"}`,
        `§fLast Respawn: ${respawnStatus.success === true ? "§aSuccess" : respawnStatus.success === false ? "§cFailed" : "§7Pending"}`,
        `§fRespawn Stage: §7${respawnStatus.stage}`
    ];

    if (getRespawnDebug()) {
        lines.push(
            `§fRespawn Reason: §7${respawnStatus.reason ?? "None"}`,
            `§fRespawn Source: §7${respawnStatus.source ?? "None"}`,
            `§fAttempts: §7${respawnStatus.attempts ?? 0}`
        );
    }

    const form = new ActionFormData()
        .title("§lHUNT STATUS")
        .body(lines.join("\n"))
        .button("§l§7Back");

    form.show(player).then(() => {
        showSpawnMenu(player, handlers, hunterActive);
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

export function clearPlayerConfig(playerId) {
    playerConfigs.delete(playerId);
    lastUsedConfigs.delete(playerId);
}
