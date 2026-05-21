/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
    getAILevel, getBed, getDeathCount, getEquipmentPersistence,
    getHunter, getHunters, getLastRespawnStatus, getRespawnDebug, getTarget,
    isActive, isRespawning, getInventory
} from "./entity_manager.js";
import { getAIState } from "./state_machine.js";
import { INVENTORY_MODES, describeInventoryMode, capturePlayerInventoryProfile } from "./inventory.js";
import { getCreatorKitChoices, DEFAULT_CREATOR_KIT_ID } from "./kits.js";
import { WIN_CONDITIONS, getHuntState, getRemainingTimeMinutes, getRemainingLives, getRemainingKills } from "./win_conditions.js";
import { getScalingDescription } from "./difficulty_scaling.js";
import { serverForm } from "./serverForm.js";
import { ACHIEVEMENTS, getUnlockedAchievements } from "./achievements.js";
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
        difficultyScaling: true,
        squadSize: 1,
        squad: [
            {
                name: "Hunter 1",
                skinId: 0,
                classId: "default",
                aiLevel: "normal",
                enableTaunts: true,
                boatHandling: "destroy",
                inventoryMode: "starter",
                creatorKitId: DEFAULT_CREATOR_KIT_ID,
                prepBehavior: "hybrid"
            }
        ]
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
        difficultyScaling: config.difficultyScaling !== undefined ? !!config.difficultyScaling : defaults.difficultyScaling,
        squadSize: Number.isInteger(config.squadSize) && config.squadSize > 0 ? config.squadSize : defaults.squadSize,
        squad: Array.isArray(config.squad) ? config.squad.map(h => ({
            name: h.name || "Hunter",
            skinId: Number.isInteger(h.skinId) ? h.skinId : 0,
            classId: h.classId || "default",
            aiLevel: h.aiLevel || "normal",
            enableTaunts: h.enableTaunts !== undefined ? !!h.enableTaunts : true,
            boatHandling: h.boatHandling === "ignore" ? "ignore" : "destroy",
            inventoryMode: h.inventoryMode || "starter",
            creatorKitId: h.creatorKitId || DEFAULT_CREATOR_KIT_ID,
            prepBehavior: h.prepBehavior || "hybrid"
        })) : JSON.parse(JSON.stringify(defaults.squad))
    };
}
function getConfig(playerId) {
    if (!playerConfigs.has(playerId)) {
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
        .title("§l§4MANHUNT BOT v0.8.0")
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
    addMenuButton(form, actions, "§l§dManage Hunt Squad\n§r§7Configure multi-hunter squad settings", () => {
        showSquadLobby(player, handlers, hunterActive);
    });
    addMenuButton(form, actions, "§l§e🏆 Achievements Checklist\n§r§7Check unlocked manhunt challenges", () => {
        showAchievementsChecklist(player, handlers, hunterActive);
    });
    addMenuButton(form, actions, "§l§bHunt Status\n§r§7View squad runtime state and coordinates", () => {
        showHuntStatus(player, handlers, hunterActive);
    });
    addMenuButton(form, actions, `§lInventory Mode: ${describeInventoryMode(config.inventoryMode)}\n§r§7Set item source for hunter`, () => {
        showInventoryModeSelector(player, handlers, hunterActive);
    });
    addMenuButton(
        form, actions,
        `§lWin Condition: ${describeWinCondition(config.winCondition)}${
            config.winCondition === "limited_lives" ? ` (${config.maxLives} Lives)` :
            config.winCondition === "time_limit" ? ` (${config.timeLimitMinutes} min)` :
            config.winCondition === "kill_count" ? ` (${config.killTarget} Kills)` : ""
        }\n§r§7Set how the hunt ends`,
        () => {
            showWinConditionSelector(player, handlers, hunterActive);
        }
    );
    addMenuButton(
        form, actions,
        config.difficultyScaling
            ? "§lDifficulty Scaling: Enabled\n§r§7Hunters get harder over time"
            : "§lDifficulty Scaling: Disabled\n§r§7Hunters stay at base difficulty",
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
        config.equipmentPersistence
            ? "§lEquipment: Keep On Death\n§r§7Hunters keep gear after death"
            : "§lEquipment: Drop On Death\n§r§7Hunters drop gear after death",
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
        addMenuButton(form, actions, "§l§4Despawn Squad\n§r§7Remove all active hunters", () => {
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
    
    const squadSize = config.squadSize || 1;
    const squad = config.squad || [];
    const compList = squad.slice(0, squadSize).map((h, i) => {
        const classMeta = serverForm?.classes?.[h.classId] || { name: h.classId };
        const className = classMeta.name.split(" ")[0];
        return `  §7${i+1}. §e${h.name} §7(§b${className}§7)`;
    }).join("\n");

    return [
        "§7Configure the hunter squad and manage the current hunt.",
        "",
        "§l§fSquad Configuration",
        `§fSquad Size: §d${squadSize}`,
        `§fComposition:`,
        compList,
        "",
        `§fWin Condition: §6${describeWinCondition(config.winCondition)}${
            config.winCondition === "limited_lives" ? ` (${config.maxLives} Lives)` :
            config.winCondition === "time_limit" ? ` (${config.timeLimitMinutes} min)` :
            config.winCondition === "kill_count" ? ` (${config.killTarget} Kills)` : ""
        }`,
        `§fDifficulty Scaling: ${config.difficultyScaling ? "§aOn" : "§cOff"}`,
        `§fEquipment Persistence: ${config.equipmentPersistence ? "§aKeep" : "§cDrop"}`,
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
    const squadSize = config.squadSize || 1;
    const squad = config.squad || [];
    
    const compText = squad.slice(0, squadSize).map((h, i) => {
        const classMeta = serverForm?.classes?.[h.classId] || { name: h.classId };
        const className = classMeta.name.split(" ")[0];
        return `  §e- ${h.name} §7(§b${className}§7)`;
    }).join("\n");
    
    const form = new ActionFormData()
        .title(isQuickRestart ? "§l§6QUICK RESTART" : "§l§4CONFIRM SQUAD HUNT")
        .body([
            "§7Final check before hunt begins.",
            "",
            `§fSquad Size: §d${squadSize}`,
            "§fSquad Members:",
            compText,
            "",
            `§fWin Condition: §6${describeWinCondition(config.winCondition)}`,
            `§fDifficulty Scaling: ${config.difficultyScaling ? "§aOn" : "§cOff"}`,
            `§fEquipment: ${config.equipmentPersistence ? "§aKeep On Death" : "§cDrop On Death"}`,
            "",
            "§cNote: Starter inventory mode will clear your inventory.",
            "§710‑second countdown starts immediately."
        ].join("\n"))
        .button(isQuickRestart ? "§l§aRestart Squad Hunt" : "§l§aStart Squad Hunt")
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
function showWinConditionConfigurator(player, conditionId, handlers, hunterActive) {
    const config = getConfig(player.id);
    
    system.run(() => {
        const form = new ModalFormData();
        
        if (conditionId === "limited_lives") {
            form.title("§lCONFIG: LIMITED LIVES")
                .slider("Max Squad Lives", 1, 20, 1, config.maxLives || 3);
        } else if (conditionId === "time_limit") {
            form.title("§lCONFIG: SURVIVAL TIME")
                .slider("Time Limit (Minutes)", 5, 120, 5, config.timeLimitMinutes || 30);
        } else if (conditionId === "kill_count") {
            form.title("§lCONFIG: TARGET KILLS")
                .slider("Target Hunter Kills", 1, 20, 1, config.killTarget || 3);
        } else {
            config.winCondition = "infinite";
            player.onScreenDisplay.setActionBar("§aWin condition set to §6Infinite Respawns");
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        
        form.show(player).then((res) => {
            if (res.canceled || res.cancelationReason === "UserBusy") {
                if (res.cancelationReason === "UserBusy") {
                    system.runTimeout(() => {
                        showWinConditionConfigurator(player, conditionId, handlers, hunterActive);
                    }, 20);
                    return;
                }
                showWinConditionSelector(player, handlers, hunterActive);
                return;
            }
            
            const formValues = res.formValues || [];
            config.winCondition = conditionId;
            
            if (conditionId === "limited_lives") {
                config.maxLives = Math.floor(formValues[0] ?? 3);
                player.onScreenDisplay.setActionBar(`§aWin Condition: §6Limited Lives (${config.maxLives})`);
            } else if (conditionId === "time_limit") {
                config.timeLimitMinutes = Math.floor(formValues[0] ?? 30);
                player.onScreenDisplay.setActionBar(`§aWin Condition: §6Time Limit (${config.timeLimitMinutes} min)`);
            } else if (conditionId === "kill_count") {
                config.killTarget = Math.floor(formValues[0] ?? 3);
                player.onScreenDisplay.setActionBar(`§aWin Condition: §6Kill Target (${config.killTarget} kills)`);
            }
            
            showSpawnMenu(player, handlers, hunterActive);
        }).catch(() => {
            showWinConditionSelector(player, handlers, hunterActive);
        });
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
            if (condition.id === "infinite") {
                config.winCondition = "infinite";
                player.onScreenDisplay.setActionBar("§aWin condition set to §6Infinite Respawns");
                showSpawnMenu(player, handlers, hunterActive);
            } else {
                showWinConditionConfigurator(player, condition.id, handlers, hunterActive);
            }
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
    const hunters = getHunters();
    const target = getTarget();
    const bed = getBed();
    const respawnStatus = getLastRespawnStatus();
    const huntState = getHuntState();
    
    const lines = [
        `§fHunt State: ${isRespawning() ? "§eRespawning" : (hunterActive ? "§cActive" : "§7Idle")}`,
        `§fTarget Player: ${target ? `§e${target.name}` : "§7None"}`,
        `§fWin Condition: §6${describeWinCondition(huntState.winCondition)}`,
        `§fTracked Bed: ${bed.pos ? `§a${bed.dimId} @ ${Math.floor(bed.pos.x)} ${Math.floor(bed.pos.y)} ${Math.floor(bed.pos.z)}` : "§7None"}`
    ];
    
    if (hunterActive && hunters.length > 0) {
        lines.push("", "§l§fActive Hunter Squad:");
        hunters.forEach((h, i) => {
            let entityLoc = "Unknown";
            let dimName = "Overworld";
            let healthText = "Unknown HP";
            try {
                const loc = h.entity.location;
                entityLoc = `${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`;
                dimName = h.entity.dimension.id.replace("minecraft:", "");
                const health = h.entity.getComponent("minecraft:health");
                if (health) {
                    healthText = `${Math.round(health.currentValue)}/${health.defaultValue} HP`;
                }
            } catch (_) {}
            
            const classMeta = serverForm?.classes?.[h.classId] || { name: h.classId };
            lines.push(
                `§bH${i + 1}: ${h.name} §7(§e${classMeta.name}§7)`,
                `  §fState: §a${healthText} §7| §fAI: §6${describeAILevel(h.aiLevel)}`,
                `  §fPos: §a${dimName} @ ${entityLoc}`,
                `  §fDeaths: §c${h.deathCount} §7| §fLives Left: §d${h.lives ?? "N/A"}`
            );
        });
    } else {
        lines.push("", "§7No hunters active currently.");
    }
    
    lines.push("", "§l§fSystem Respawn Info:");
    lines.push(
        `§fLast Respawn: ${respawnStatus.success === true ? "§aSuccess" : respawnStatus.success === false ? "§cFailed" : "§7Pending"}`,
        `§fRespawn Stage: §7${respawnStatus.stage}`
    );
    if (getRespawnDebug()) {
        lines.push(
            `§fRespawn Reason: §7${respawnStatus.reason ?? "None"}`,
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

function showSquadLobby(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const squadFormMeta = serverForm?.squad_form || {};
    const title = squadFormMeta.title || "§l§4MANHUNT SQUAD LOBBY";
    
    const form = new ActionFormData()
        .title(title)
        .body(`§7Configure class, difficulty, name, and skins for each hunter in your squad.\n\n§fCurrent Squad Size: §d${config.squadSize || 1}`);
    
    const actions = [];
    
    addMenuButton(form, actions, "§l§6Squad Size & Presets\n§r§7Apply presets or change squad size", () => {
        showSquadSizeAndPresets(player, handlers, hunterActive);
    });
    
    const squadSize = config.squadSize || 1;
    if (!config.squad) config.squad = [];
    while (config.squad.length < squadSize) {
        const idx = config.squad.length;
        const classes = ["default", "knight", "archer", "saboteur"];
        config.squad.push({
            name: `Hunter ${idx + 1}`,
            skinId: idx % 8,
            classId: classes[idx % classes.length],
            aiLevel: config.aiLevel || "normal",
            enableTaunts: config.enableTaunts !== undefined ? config.enableTaunts : true,
            boatHandling: config.boatHandling || "destroy",
            inventoryMode: config.inventoryMode || "starter",
            creatorKitId: config.creatorKitId || DEFAULT_CREATOR_KIT_ID,
            prepBehavior: config.prepBehavior || "hybrid"
        });
    }
    
    for (let i = 0; i < squadSize; i++) {
        const hunterConf = config.squad[i];
        const classMeta = serverForm?.classes?.[hunterConf.classId] || { name: hunterConf.classId };
        const className = classMeta.name;
        const skinName = SKIN_OPTIONS[hunterConf.skinId]?.name ?? "Steve";
        const aiName = describeAILevel(hunterConf.aiLevel);
        
        addMenuButton(
            form, actions, 
            `§l§bSlot ${i + 1}: ${hunterConf.name}\n§r§7Class: ${className} | AI: ${aiName} | Skin: ${skinName}`,
            () => {
                showHunterSlotEditor(player, i, handlers, hunterActive);
            }
        );
    }
    
    addMenuButton(form, actions, "§l§7Back to Menu", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });
    
    form.show(player).then((res) => {
        if (res.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[res.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}

function showSquadSizeAndPresets(player, handlers, hunterActive) {
    const config = getConfig(player.id);
    const form = new ActionFormData()
        .title("§lSQUAD PRESETS")
        .body("§7Choose a starting squad preset or adjust size manually.");
    
    const actions = [];
    
    const presets = serverForm?.squad_form?.presets || [];
    for (const preset of presets) {
        addMenuButton(form, actions, `§l${preset.name}`, () => {
            const presetClasses = preset.classes || ["default"];
            config.squadSize = presetClasses.length;
            config.squad = presetClasses.map((clsId, idx) => {
                const classMeta = serverForm?.classes?.[clsId] || { name: `${clsId} Hunter` };
                const names = ["Steve", "Alex", "Zombie", "Skeleton", "Creeper", "Custom", "Dream", "Techno"];
                const name = `${classMeta.name.split(" ")[0]} ${names[idx % names.length]}`;
                return {
                    name: name,
                    skinId: idx % 8,
                    classId: clsId,
                    aiLevel: config.aiLevel || "normal",
                    enableTaunts: config.enableTaunts !== undefined ? config.enableTaunts : true,
                    boatHandling: config.boatHandling || "destroy",
                    inventoryMode: config.inventoryMode || "starter",
                    creatorKitId: config.creatorKitId || DEFAULT_CREATOR_KIT_ID,
                    prepBehavior: config.prepBehavior || "hybrid"
                };
            });
            player.onScreenDisplay.setActionBar(`§aApplied preset: ${preset.name.split("\n")[0]}`);
            showSquadLobby(player, handlers, hunterActive);
        });
    }
    
    addMenuButton(form, actions, "§l§bSet Squad Size Manually\n§r§7Choose squad size from 1 to 4", () => {
        system.run(() => {
            const modal = new ModalFormData()
                .title("§lMANUAL SQUAD SIZE")
                .slider("Squad Size", 1, 4, 1, config.squadSize || 1);
            modal.show(player).then((res) => {
                if (res.canceled) {
                    showSquadSizeAndPresets(player, handlers, hunterActive);
                    return;
                }
                const newSize = Math.floor(res.formValues?.[0] ?? config.squadSize);
                config.squadSize = newSize;
                if (!config.squad) config.squad = [];
                while (config.squad.length < newSize) {
                    const idx = config.squad.length;
                    const classes = ["default", "knight", "archer", "saboteur"];
                    const classId = classes[idx % classes.length];
                    config.squad.push({
                        name: `Hunter ${idx + 1}`,
                        skinId: idx % 8,
                        classId: classId,
                        aiLevel: config.aiLevel || "normal",
                        enableTaunts: config.enableTaunts !== undefined ? config.enableTaunts : true,
                        boatHandling: config.boatHandling || "destroy",
                        inventoryMode: config.inventoryMode || "starter",
                        creatorKitId: config.creatorKitId || DEFAULT_CREATOR_KIT_ID,
                        prepBehavior: config.prepBehavior || "hybrid"
                    });
                }
                if (config.squad.length > newSize) {
                    config.squad = config.squad.slice(0, newSize);
                }
                player.onScreenDisplay.setActionBar(`§aSquad size set to §d${newSize}`);
                showSquadLobby(player, handlers, hunterActive);
            }).catch(() => {
                showSquadSizeAndPresets(player, handlers, hunterActive);
            });
        });
    });
    
    addMenuButton(form, actions, "§l§7Back", () => {
        showSquadLobby(player, handlers, hunterActive);
    });
    
    form.show(player).then((res) => {
        if (res.canceled) {
            showSquadLobby(player, handlers, hunterActive);
            return;
        }
        const action = actions[res.selection];
        if (action) action();
    }).catch(() => {
        showSquadLobby(player, handlers, hunterActive);
    });
}

function showHunterSlotEditor(player, slotIndex, handlers, hunterActive) {
    const config = getConfig(player.id);
    const hConf = config.squad[slotIndex];
    
    const classKeys = Object.keys(serverForm?.classes || {});
    const classNames = classKeys.map(k => serverForm.classes[k].name);
    const defaultClassIdx = Math.max(0, classKeys.indexOf(hConf.classId));
    
    const aiKeys = AI_LEVELS.map(l => l.id);
    const aiNames = AI_LEVELS.map(l => l.name);
    const defaultAIIdx = Math.max(0, aiKeys.indexOf(hConf.aiLevel));
    
    const skinNames = SKIN_OPTIONS.map(s => s.name);
    const defaultSkinIdx = Math.max(0, SKIN_OPTIONS.findIndex(s => s.id === hConf.skinId));
    
    const prepKeys = PREP_BEHAVIORS.map(b => b.id);
    const prepNames = PREP_BEHAVIORS.map(b => b.name);
    const defaultPrepIdx = Math.max(0, prepKeys.indexOf(hConf.prepBehavior));
    
    system.run(() => {
        const form = new ModalFormData()
            .title(`§lEDIT HUNTER ${slotIndex + 1}`)
            .textField("Hunter Name", "Name", hConf.name)
            .dropdown("Class Profile", classNames, defaultClassIdx)
            .dropdown("AI Difficulty", aiNames, defaultAIIdx)
            .dropdown("Skin / Model", skinNames, defaultSkinIdx)
            .dropdown("Gathering Behavior", prepNames, defaultPrepIdx)
            .toggle("Enable Taunts", hConf.enableTaunts !== undefined ? hConf.enableTaunts : true);
        
        form.show(player).then((res) => {
            if (res.canceled || res.cancelationReason === "UserBusy") {
                if (res.cancelationReason === "UserBusy") {
                    system.runTimeout(() => {
                        showHunterSlotEditor(player, slotIndex, handlers, hunterActive);
                    }, 20);
                    return;
                }
                showSquadLobby(player, handlers, hunterActive);
                return;
            }
            
            const formValues = res.formValues || [];
            const rawName = String(formValues[0] || "").trim();
            hConf.name = rawName.length > 0 ? rawName.substring(0, 24) : `Hunter ${slotIndex + 1}`;
            
            const classIdx = formValues[1] ?? defaultClassIdx;
            hConf.classId = classKeys[classIdx] || "default";
            
            const aiIdx = formValues[2] ?? defaultAIIdx;
            hConf.aiLevel = aiKeys[aiIdx] || "normal";
            
            const skinIdx = formValues[3] ?? defaultSkinIdx;
            hConf.skinId = SKIN_OPTIONS[skinIdx]?.id ?? 0;
            
            const prepIdx = formValues[4] ?? defaultPrepIdx;
            hConf.prepBehavior = prepKeys[prepIdx] || "hybrid";
            
            hConf.enableTaunts = !!formValues[5];
            
            hConf.boatHandling = config.boatHandling || "destroy";
            hConf.inventoryMode = config.inventoryMode || "starter";
            hConf.creatorKitId = config.creatorKitId || DEFAULT_CREATOR_KIT_ID;
            
            player.onScreenDisplay.setActionBar(`§aHunter ${slotIndex + 1} updated successfully!`);
            showSquadLobby(player, handlers, hunterActive);
        }).catch(() => {
            showSquadLobby(player, handlers, hunterActive);
        });
    });
}

function showAchievementsChecklist(player, handlers, hunterActive) {
    const unlocked = getUnlockedAchievements(player);
    const totalCount = ACHIEVEMENTS.length;
    const unlockedCount = ACHIEVEMENTS.filter(a => unlocked.includes(a.id)).length;
    
    const pct = Math.round((unlockedCount / totalCount) * 100);
    const progressText = `§fProgress: §a${unlockedCount}/${totalCount} §7(§e${pct}%§7)\n\n§7Complete manhunt challenges to unlock persistent trophies!`;
    
    const form = new ActionFormData()
        .title("§l§6🏆 ACHIEVEMENTS CHECKLIST")
        .body(progressText);
    
    const actions = [];
    
    for (const ach of ACHIEVEMENTS) {
        const isUnlocked = unlocked.includes(ach.id);
        const prefix = isUnlocked ? "§a§l✔ " : "§c§l✘ ";
        const status = isUnlocked ? "§aUnlocked" : "§7Locked";
        addMenuButton(
            form, actions, 
            `${prefix}${ach.name}\n§r§7${status} - ${ach.description}`, 
            () => {
                if (isUnlocked) {
                    player.sendMessage(`§6§l🏆 Achievement Unlocked: §e${ach.name}\n§7${ach.description}`);
                } else {
                    player.sendMessage(`§c§l🔒 Locked: §e${ach.name}\n§7Try to perform this challenge in-game!`);
                }
                showAchievementsChecklist(player, handlers, hunterActive);
            }
        );
    }
    
    addMenuButton(form, actions, "§l§7Back to Menu", () => {
        showSpawnMenu(player, handlers, hunterActive);
    });
    
    form.show(player).then((res) => {
        if (res.canceled) {
            showSpawnMenu(player, handlers, hunterActive);
            return;
        }
        const action = actions[res.selection];
        if (action) action();
    }).catch(() => {
        showSpawnMenu(player, handlers, hunterActive);
    });
}