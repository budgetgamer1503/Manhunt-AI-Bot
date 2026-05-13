/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
    getAILevel, getBed, getDeathCount, getEquipmentPersistence,
    getHunter, getLastRespawnStatus, getRespawnDebug, getTarget,
    isActive, isRespawning, getInventory
} from "./entity_manager.js";
import { getAIState } from "./state_machine.js";
import { INVENTORY_MODES, describeInventoryMode, capturePlayerInventoryProfile } from "./inventory.js";
import { getCreatorKitChoices, DEFAULT_CREATOR_KIT_ID } from "./kits.js";

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
        prepBehavior: "hybrid"
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
        prepBehavior: config.prepBehavior === "hybrid" ? "hybrid" : defaults.prepBehavior
    };
}

function getConfig(playerId) {
    if (!playerConfigs.has(playerId)) {
        playerConfigs.set(playerId, getDefaultConfig());
    }
    return playerConfigs.get(playerId);
}

export function rememberLastUsedConfig(playerId, config) {
    lastUsedConfigs.set(playerId, cloneConfig(config));
}

export function getLastUsedConfig(playerId) {
    const config = lastUsedConfigs.get(playerId);
    return config ? cloneConfig(config) : null;
}

export function describeAILevel(levelId) {
    return AI_LEVELS.find((level) => level.id === levelId)?.name ?? "Normal";
}

export function showSpawnMenu(player, handlers, hunterActive = false) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§l§4MANHUNT BOT")
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

    addMenuButton(
        form,
        actions,
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
        form,
        actions,
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
        form,
        actions,
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
        form,
        actions,
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

    return [
        "§7Configure the hunter and manage the current hunt.",
        "",
        "§l§fHunter Configuration",
        `§fIdentity: §e${config.name}`,
        `§fAppearance: §b${SKIN_OPTIONS[config.skinId]?.name ?? "Steve"}`,
        `§fAI Level: §6${describeAILevel(config.aiLevel)}`,
        "",
        "§l§fBehavior",
        `§fTaunts: ${config.enableTaunts ? "§aEnabled" : "§cDisabled"}`,
        `§fBoat Handling: ${config.boatHandling === "destroy" ? "§cDestroy" : "§7Ignore"}`,
        `§fEquipment: ${config.equipmentPersistence ? "§aKeep On Death" : "§cDrop On Death"}`,
        "",
        "§l§fDebug",
        `§fRespawn Debug: ${config.respawnDebug ? "§aEnabled" : "§7Disabled"}`,
        "",
        "§l§fHunt Status",
        `§fState: ${hunterActive ? "§c" : "§7"}${runtimeState}`
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
            `§fEquipment: ${config.equipmentPersistence ? "§aKeep On Death" : "§cDrop On Death"}`,
            `§fRespawn Debug: ${config.respawnDebug ? "§aEnabled" : "§7Disabled"}`,
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
                    } catch (_) {
                    }
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
                } catch (_) {
                }
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
                } catch (_) {
                }
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
    const form = new ActionFormData()
        .title("§lHUNT STATUS")
        .body([
            `§fHunt State: ${isRespawning() ? "§eRespawning" : (hunterActive ? "§cActive" : "§7Idle")}`,
            `§fTarget Player: ${target ? `§e${target.name}` : "§7None"}`,
            `§fAI Level: §6${describeAILevel(getAILevel())}`,
            `§fAI Phase: §b${getAIState()}`,
            `§fHunter Dimension: ${hunter ? `§a${hunter.dimension.id.replace("minecraft:", "")}` : "§7None"}`,
            `§fDeaths: §c${getDeathCount()}`,
            `§fEquipment Persistence: ${getEquipmentPersistence() ? "§aOn" : "§cOff"}`,
            `§fTracked Bed: ${bed.pos ? `§a${bed.dimId} @ ${Math.floor(bed.pos.x)} ${Math.floor(bed.pos.y)} ${Math.floor(bed.pos.z)}` : "§7None"}`,
            `§fLast Respawn: ${respawnStatus.success === true ? "§aSuccess" : respawnStatus.success === false ? "§cFailed" : "§7Pending"}`,
            `§fRespawn Stage: §7${respawnStatus.stage}`
        ].concat(
            getRespawnDebug()
                ? [
                    `§fRespawn Reason: §7${respawnStatus.reason ?? "None"}`,
                    `§fRespawn Source: §7${respawnStatus.source ?? "None"}`,
                    `§fAttempts: §7${respawnStatus.attempts ?? 0}`
                ]
                : []
        ).join("\n"))
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
