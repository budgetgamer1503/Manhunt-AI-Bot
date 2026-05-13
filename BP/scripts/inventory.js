/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

import { system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { DEFAULT_CREATOR_KIT_ID, getCreatorKitById, resolveCreatorKit } from "./kits.js";
export const WEAPON_DAMAGE = {
    "minecraft:wooden_sword": 4,
    "minecraft:stone_sword": 5,
    "minecraft:iron_sword": 6,
    "minecraft:diamond_sword": 7,
    "minecraft:netherite_sword": 8,
    "minecraft:wooden_axe": 3,
    "minecraft:stone_axe": 4,
    "minecraft:iron_axe": 5,
    "minecraft:diamond_axe": 6
};
const ARMOR_VALUES = {
    Head: {
        "minecraft:leather_helmet": 1,
        "minecraft:iron_helmet": 2,
        "minecraft:diamond_helmet": 3,
        "minecraft:netherite_helmet": 4
    },
    Chest: {
        "minecraft:leather_chestplate": 3,
        "minecraft:iron_chestplate": 6,
        "minecraft:diamond_chestplate": 8,
        "minecraft:netherite_chestplate": 9
    },
    Legs: {
        "minecraft:leather_leggings": 2,
        "minecraft:iron_leggings": 5,
        "minecraft:diamond_leggings": 6,
        "minecraft:netherite_leggings": 7
    },
    Feet: {
        "minecraft:leather_boots": 1,
        "minecraft:iron_boots": 2,
        "minecraft:diamond_boots": 3,
        "minecraft:netherite_boots": 4
    }
};
const FOOD_VALUES = {
    "minecraft:cooked_beef": { hunger: 8, saturation: 12.8 },
    "minecraft:cooked_porkchop": { hunger: 8, saturation: 12.8 },
    "minecraft:cooked_mutton": { hunger: 6, saturation: 9.6 },
    "minecraft:cooked_chicken": { hunger: 6, saturation: 7.2 },
    "minecraft:bread": { hunger: 5, saturation: 6.0 },
    "minecraft:apple": { hunger: 4, saturation: 2.4 },
    "minecraft:cooked_salmon": { hunger: 6, saturation: 9.6 },
    "minecraft:cooked_cod": { hunger: 5, saturation: 6.0 },
    "minecraft:golden_apple": { hunger: 4, saturation: 9.6 },
    "minecraft:dried_kelp": { hunger: 1, saturation: 0.6 }
};
const RECIPES = [
    {
        name: "oak_planks",
        inputs: [{ typeId: "minecraft:oak_log", amount: 1 }],
        output: { typeId: "minecraft:oak_planks", amount: 4 }
    },
    {
        name: "sticks",
        inputs: [{ typeId: "minecraft:oak_planks", amount: 2 }],
        output: { typeId: "minecraft:stick", amount: 4 }
    },
    {
        name: "wooden_pickaxe",
        inputs: [
            { typeId: "minecraft:oak_planks", amount: 3 },
            { typeId: "minecraft:stick", amount: 2 }
        ],
        output: { typeId: "minecraft:wooden_pickaxe", amount: 1 }
    },
    {
        name: "wooden_sword",
        inputs: [
            { typeId: "minecraft:oak_planks", amount: 2 },
            { typeId: "minecraft:stick", amount: 1 }
        ],
        output: { typeId: "minecraft:wooden_sword", amount: 1 }
    },
    {
        name: "wooden_axe",
        inputs: [
            { typeId: "minecraft:oak_planks", amount: 3 },
            { typeId: "minecraft:stick", amount: 2 }
        ],
        output: { typeId: "minecraft:wooden_axe", amount: 1 }
    },
    {
        name: "stone_pickaxe",
        inputs: [
            { typeId: "minecraft:cobblestone", amount: 3 },
            { typeId: "minecraft:stick", amount: 2 }
        ],
        output: { typeId: "minecraft:stone_pickaxe", amount: 1 }
    },
    {
        name: "stone_sword",
        inputs: [
            { typeId: "minecraft:cobblestone", amount: 2 },
            { typeId: "minecraft:stick", amount: 1 }
        ],
        output: { typeId: "minecraft:stone_sword", amount: 1 }
    },
    {
        name: "stone_axe",
        inputs: [
            { typeId: "minecraft:cobblestone", amount: 3 },
            { typeId: "minecraft:stick", amount: 2 }
        ],
        output: { typeId: "minecraft:stone_axe", amount: 1 }
    },
    {
        name: "iron_pickaxe",
        inputs: [
            { typeId: "minecraft:iron_ingot", amount: 3 },
            { typeId: "minecraft:stick", amount: 2 }
        ],
        output: { typeId: "minecraft:iron_pickaxe", amount: 1 }
    },
    {
        name: "iron_sword",
        inputs: [
            { typeId: "minecraft:iron_ingot", amount: 2 },
            { typeId: "minecraft:stick", amount: 1 }
        ],
        output: { typeId: "minecraft:iron_sword", amount: 1 }
    },
    {
        name: "iron_helmet",
        inputs: [{ typeId: "minecraft:iron_ingot", amount: 5 }],
        output: { typeId: "minecraft:iron_helmet", amount: 1 }
    },
    {
        name: "iron_chestplate",
        inputs: [{ typeId: "minecraft:iron_ingot", amount: 8 }],
        output: { typeId: "minecraft:iron_chestplate", amount: 1 }
    },
    {
        name: "iron_leggings",
        inputs: [{ typeId: "minecraft:iron_ingot", amount: 7 }],
        output: { typeId: "minecraft:iron_leggings", amount: 1 }
    },
    {
        name: "iron_boots",
        inputs: [{ typeId: "minecraft:iron_ingot", amount: 4 }],
        output: { typeId: "minecraft:iron_boots", amount: 1 }
    },
    {
        name: "shield",
        inputs: [
            { typeId: "minecraft:oak_planks", amount: 6 },
            { typeId: "minecraft:iron_ingot", amount: 1 }
        ],
        output: { typeId: "minecraft:shield", amount: 1 }
    },
    {
        name: "crafting_table",
        inputs: [{ typeId: "minecraft:oak_planks", amount: 4 }],
        output: { typeId: "minecraft:crafting_table", amount: 1 }
    },
    {
        name: "furnace",
        inputs: [{ typeId: "minecraft:cobblestone", amount: 8 }],
        output: { typeId: "minecraft:furnace", amount: 1 }
    }
];
const CRAFT_PRIORITY = [
    "oak_planks", "sticks",
    "wooden_pickaxe", "wooden_sword",
    "stone_pickaxe", "stone_sword", "stone_axe",
    "iron_sword", "iron_pickaxe",
    "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots",
    "shield"
];
export const MINEABLE_BLOCKS = {
    "minecraft:oak_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:birch_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:spruce_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:jungle_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:acacia_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:dark_oak_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:mangrove_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:cherry_log": { drop: "minecraft:oak_log", amount: 1, baseTicks: 20 },
    "minecraft:stone": { drop: "minecraft:cobblestone", amount: 1, baseTicks: 30 },
    "minecraft:cobblestone": { drop: "minecraft:cobblestone", amount: 1, baseTicks: 30 },
    "minecraft:iron_ore": { drop: "minecraft:raw_iron", amount: 1, baseTicks: 40 },
    "minecraft:deepslate_iron_ore": { drop: "minecraft:raw_iron", amount: 1, baseTicks: 45 },
    "minecraft:coal_ore": { drop: "minecraft:coal", amount: 1, baseTicks: 30 },
    "minecraft:dirt": { drop: "minecraft:dirt", amount: 1, baseTicks: 8 },
    "minecraft:grass_block": { drop: "minecraft:dirt", amount: 1, baseTicks: 10 },
    "minecraft:gravel": { drop: "minecraft:gravel", amount: 1, baseTicks: 10 },
    "minecraft:sand": { drop: "minecraft:sand", amount: 1, baseTicks: 8 }
};
const GATHER_TARGETS = [
    "minecraft:dirt", "minecraft:grass_block", "minecraft:gravel", "minecraft:sand", "minecraft:stone",
    "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
    "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
    "minecraft:mangrove_log", "minecraft:cherry_log"
];
const WEAPON_PRIORITY = [
    "minecraft:netherite_sword", "minecraft:diamond_sword", "minecraft:iron_sword",
    "minecraft:stone_sword", "minecraft:wooden_sword",
    "minecraft:diamond_axe", "minecraft:iron_axe", "minecraft:stone_axe", "minecraft:wooden_axe"
];
const PICKAXE_PRIORITY = [
    "minecraft:netherite_pickaxe", "minecraft:diamond_pickaxe", "minecraft:iron_pickaxe",
    "minecraft:stone_pickaxe", "minecraft:wooden_pickaxe"
];
const AXE_PRIORITY = [
    "minecraft:diamond_axe", "minecraft:iron_axe", "minecraft:stone_axe", "minecraft:wooden_axe"
];
const ARMOR_PRIORITY = {
    Head: ["minecraft:netherite_helmet", "minecraft:diamond_helmet", "minecraft:iron_helmet", "minecraft:leather_helmet"],
    Chest: ["minecraft:netherite_chestplate", "minecraft:diamond_chestplate", "minecraft:iron_chestplate", "minecraft:leather_chestplate"],
    Legs: ["minecraft:netherite_leggings", "minecraft:diamond_leggings", "minecraft:iron_leggings", "minecraft:leather_leggings"],
    Feet: ["minecraft:netherite_boots", "minecraft:diamond_boots", "minecraft:iron_boots", "minecraft:leather_boots"]
};
const BONUS_BLOCKS = [
    "minecraft:cobblestone", "minecraft:stone", "minecraft:oak_planks", "minecraft:spruce_planks",
    "minecraft:birch_planks", "minecraft:dirt", "minecraft:gravel", "minecraft:sand",
    "minecraft:netherrack", "minecraft:cobbled_deepslate"
];
const BONUS_UTILITY_ITEMS = [
    "minecraft:water_bucket", "minecraft:lava_bucket", "minecraft:bucket",
    "minecraft:shield", "minecraft:red_bed", "minecraft:crafting_table",
    "minecraft:furnace", "minecraft:coal", "minecraft:raw_iron", "minecraft:iron_ingot",
    "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
    "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
    "minecraft:mangrove_log", "minecraft:cherry_log"
];
export const INVENTORY_MODES = [
    { id: "starter", name: "Starter", description: "Spawn with the default hunter starter kit." },
    { id: "player_share", name: "Player Share", description: "Mirror a filtered version of the player's inventory and equipment." },
    { id: "creator_kit", name: "Creator Kit", description: "Use a creator-defined kit matched from the player's inventory." }
];
const ITEM_CAPS = {
    "minecraft:bread": 16,
    "minecraft:cooked_beef": 16,
    "minecraft:cooked_porkchop": 16,
    "minecraft:cooked_mutton": 16,
    "minecraft:cooked_chicken": 16,
    "minecraft:cooked_salmon": 16,
    "minecraft:cooked_cod": 16,
    "minecraft:apple": 12,
    "minecraft:golden_apple": 3,
    "minecraft:dried_kelp": 16,
    "minecraft:cobblestone": 48,
    "minecraft:stone": 48,
    "minecraft:oak_planks": 48,
    "minecraft:spruce_planks": 48,
    "minecraft:birch_planks": 48,
    "minecraft:dirt": 48,
    "minecraft:gravel": 48,
    "minecraft:sand": 48,
    "minecraft:cobbled_deepslate": 48,
    "minecraft:netherrack": 48,
    "minecraft:coal": 16,
    "minecraft:raw_iron": 16,
    "minecraft:iron_ingot": 16,
    "minecraft:torch": 16,
    "minecraft:stick": 16,
    "minecraft:oak_log": 16,
    "minecraft:spruce_log": 16,
    "minecraft:birch_log": 16,
    "minecraft:jungle_log": 16,
    "minecraft:acacia_log": 16,
    "minecraft:dark_oak_log": 16,
    "minecraft:mangrove_log": 16,
    "minecraft:cherry_log": 16
};
const CREATOR_KIT_FALLBACK_ITEMS = {
    "minecraft:bread": 10,
    "minecraft:cobblestone": 32,
    "minecraft:oak_planks": 16
};
function getItemCap(typeId) {
    return ITEM_CAPS[typeId] ?? 1;
}
function cloneItemMap(itemMap = {}) {
    return { ...itemMap };
}
function mergeItemMaps(...maps) {
    const merged = Object.create(null);
    for (const source of maps) {
        for (const [typeId, amount] of Object.entries(source ?? {})) {
            if (!typeId || amount <= 0) continue;
            merged[typeId] = (merged[typeId] ?? 0) + amount;
        }
    }
    return merged;
}
function setItemCount(target, typeId, amount) {
    if (!typeId || amount <= 0) return;
    target[typeId] = Math.max(target[typeId] ?? 0, amount);
}
function addCappedItem(target, typeId, amount) {
    if (!typeId || amount <= 0) return;
    target[typeId] = Math.min(getItemCap(typeId), (target[typeId] ?? 0) + amount);
}
function normalizeItemMap(itemMap = {}) {
    const normalized = Object.create(null);
    for (const [typeId, amount] of Object.entries(itemMap)) {
        if (!typeId || amount <= 0) continue;
        normalized[typeId] = Math.min(getItemCap(typeId), amount);
    }
    return normalized;
}
export function getDefaultInventoryModeConfig(config = {}) {
    return {
        inventoryMode: INVENTORY_MODES.some((mode) => mode.id === config.inventoryMode) ? config.inventoryMode : "starter",
        creatorKitId: typeof config.creatorKitId === "string" && config.creatorKitId.length > 0 ? config.creatorKitId : DEFAULT_CREATOR_KIT_ID,
        prepBehavior: config.prepBehavior === "hybrid" ? "hybrid" : "hybrid"
    };
}
export function describeInventoryMode(modeId) {
    return INVENTORY_MODES.find((mode) => mode.id === modeId)?.name ?? "Starter";
}
export function capturePlayerInventoryProfile(player) {
    const rawItems = Object.create(null);
    try {
        const inventory = player.getComponent("minecraft:inventory");
        const container = inventory?.container;
        if (container) {
            for (let index = 0; index < container.size; index++) {
                const stack = container.getItem(index);
                if (stack) {
                    rawItems[stack.typeId] = (rawItems[stack.typeId] ?? 0) + stack.amount;
                }
            }
        }
    } catch (_) { }
    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (equippable) {
            for (const slot of [
                EquipmentSlot.Mainhand,
                EquipmentSlot.Offhand,
                EquipmentSlot.Head,
                EquipmentSlot.Chest,
                EquipmentSlot.Legs,
                EquipmentSlot.Feet
            ]) {
                try {
                    const item = equippable.getEquipment(slot);
                    if (item) {
                        rawItems[item.typeId] = (rawItems[item.typeId] ?? 0) + item.amount;
                    }
                } catch (_) { }
            }
        }
    } catch (_) { }
    return {
        rawItems,
        sharedItems: buildFilteredPlayerShareMap(rawItems),
        resolvedCreatorKit: resolveCreatorKit(rawItems, DEFAULT_CREATOR_KIT_ID)
    };
}
export function buildFilteredPlayerShareMap(playerItems = {}) {
    const desired = Object.create(null);
    ensurePreferredToolInMap(desired, playerItems, WEAPON_PRIORITY);
    ensurePreferredToolInMap(desired, playerItems, PICKAXE_PRIORITY);
    ensurePreferredToolInMap(desired, playerItems, AXE_PRIORITY);
    for (const items of Object.values(ARMOR_PRIORITY)) {
        const armor = items.find((item) => (playerItems[item] ?? 0) > 0);
        if (armor) setItemCount(desired, armor, 1);
    }
    const foodTypes = Object.keys(FOOD_VALUES)
        .filter((item) => (playerItems[item] ?? 0) > 0)
        .sort((a, b) => FOOD_VALUES[b].saturation - FOOD_VALUES[a].saturation);
    let totalFood = 0;
    for (const food of foodTypes) {
        if (totalFood >= 16) break;
        const addAmount = Math.min(playerItems[food], getItemCap(food), 16 - totalFood);
        if (addAmount > 0) {
            addCappedItem(desired, food, addAmount);
            totalFood += addAmount;
        }
    }
    for (const block of BONUS_BLOCKS) {
        const count = playerItems[block] ?? 0;
        if (count > 0) {
            addCappedItem(desired, block, Math.min(count, getItemCap(block)));
            break;
        }
    }
    for (const item of BONUS_UTILITY_ITEMS) {
        const count = playerItems[item] ?? 0;
        if (count <= 0) continue;
        addCappedItem(desired, item, Math.min(count, getItemCap(item)));
    }
    return normalizeItemMap(desired);
}
function ensurePreferredToolInMap(target, playerItems, priorityList) {
    const tool = priorityList.find((item) => (playerItems[item] ?? 0) > 0);
    if (tool) setItemCount(target, tool, 1);
}
export function buildInventoryModeItemMap(config = {}, profile = null) {
    const modeConfig = getDefaultInventoryModeConfig(config);
    const rawItems = cloneItemMap(profile?.rawItems ?? {});
    const sharedItems = cloneItemMap(profile?.sharedItems ?? buildFilteredPlayerShareMap(rawItems));
    if (modeConfig.inventoryMode === "player_share") {
        return {
            itemMap: sharedItems,
            resolvedKit: null
        };
    }
    if (modeConfig.inventoryMode === "creator_kit") {
        const resolvedKit = resolveCreatorKit(rawItems, modeConfig.creatorKitId);
        return {
            itemMap: normalizeItemMap(mergeItemMaps(resolvedKit?.items ?? {}, CREATOR_KIT_FALLBACK_ITEMS)),
            resolvedKit
        };
    }
    return {
        itemMap: normalizeItemMap({
            "minecraft:wooden_sword": 1,
            "minecraft:wooden_pickaxe": 1,
            "minecraft:wooden_axe": 1,
            "minecraft:bread": 10,
            "minecraft:cobblestone": 32,
            "minecraft:oak_planks": 16,
            "minecraft:water_bucket": 1,
            "minecraft:shield": 1,
            "minecraft:red_bed": 1
        }),
        resolvedKit: null
    };
}
export class HunterInventory {
    constructor() {
        this.slots = new Array(27).fill(null);
        this._tempEquipActive = false;
        this._tempEquipEndTick = 0;
        this.modeState = {
            inventoryMode: "starter",
            creatorKitId: DEFAULT_CREATOR_KIT_ID,
            resolvedCreatorKitId: null,
            prepBehavior: "hybrid"
        };
    }
    clear() {
        this.slots.fill(null);
        this.resetTempEquip();
    }
    addItem(typeId, amount = 1) {
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i] && this.slots[i].typeId === typeId) {
                this.slots[i].amount += amount;
                return true;
            }
        }
        for (let i = 0; i < this.slots.length; i++) {
            if (!this.slots[i]) {
                this.slots[i] = { typeId, amount };
                return true;
            }
        }
        return false;
    }
    removeItem(typeId, amount = 1) {
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i] && this.slots[i].typeId === typeId) {
                this.slots[i].amount -= amount;
                if (this.slots[i].amount <= 0) {
                    this.slots[i] = null;
                }
                return true;
            }
        }
        return false;
    }
    hasItem(typeId, amount = 1) {
        for (const slot of this.slots) {
            if (slot && slot.typeId === typeId && slot.amount >= amount) {
                return true;
            }
        }
        return false;
    }
    countItem(typeId) {
        let total = 0;
        for (const slot of this.slots) {
            if (slot && slot.typeId === typeId) {
                total += slot.amount;
            }
        }
        return total;
    }
    ensureAtLeast(typeId, amount = 1) {
        const current = this.countItem(typeId);
        if (current >= amount) return true;
        return this.addItem(typeId, amount - current);
    }
    getBestWeapon() {
        let best = null;
        let bestDmg = 0;
        for (const slot of this.slots) {
            if (slot && WEAPON_DAMAGE[slot.typeId] && WEAPON_DAMAGE[slot.typeId] > bestDmg) {
                bestDmg = WEAPON_DAMAGE[slot.typeId];
                best = slot.typeId;
            }
        }
        return best;
    }
    getBestArmor(slotName) {
        const map = ARMOR_VALUES[slotName];
        if (!map) return null;
        let best = null;
        let bestVal = 0;
        for (const slot of this.slots) {
            if (slot && map[slot.typeId] && map[slot.typeId] > bestVal) {
                bestVal = map[slot.typeId];
                best = slot.typeId;
            }
        }
        return best;
    }
    getBestFood() {
        let best = null;
        let bestSat = 0;
        for (const slot of this.slots) {
            if (slot && FOOD_VALUES[slot.typeId] && FOOD_VALUES[slot.typeId].saturation > bestSat) {
                bestSat = FOOD_VALUES[slot.typeId].saturation;
                best = slot.typeId;
            }
        }
        return best;
    }
    getFoodHunger(typeId) {
        return FOOD_VALUES[typeId]?.hunger ?? 0;
    }
    getBridgeBlock() {
        const preferred = [
            "minecraft:cobblestone", "minecraft:dirt", "minecraft:oak_planks",
            "minecraft:stone", "minecraft:cobbled_deepslate", "minecraft:netherrack",
            "minecraft:gravel", "minecraft:sand"
        ];
        for (const b of preferred) {
            if (this.hasItem(b)) return b;
        }
        return null;
    }
    getLavaSafeBlock() {
        const safe = ["minecraft:cobblestone", "minecraft:stone", "minecraft:cobbled_deepslate", "minecraft:netherrack", "minecraft:dirt"];
        for (const b of safe) {
            if (this.hasItem(b)) return b;
        }
        return this.getBridgeBlock();
    }
    getBestPickaxe() {
        const picks = ["minecraft:diamond_pickaxe", "minecraft:iron_pickaxe", "minecraft:stone_pickaxe", "minecraft:wooden_pickaxe"];
        for (const p of picks) {
            if (this.hasItem(p)) return p;
        }
        return null;
    }
    getBestAxe() {
        const axes = ["minecraft:diamond_axe", "minecraft:iron_axe", "minecraft:stone_axe", "minecraft:wooden_axe"];
        for (const a of axes) {
            if (this.hasItem(a)) return a;
        }
        return null;
    }
    hasWaterBucket() {
        return this.hasItem("minecraft:water_bucket");
    }
    hasShield() {
        return this.hasItem("minecraft:shield");
    }
    hasGoodGear() {
        const sword = this.hasItem("minecraft:stone_sword") || this.hasItem("minecraft:iron_sword");
        const pick = this.hasItem("minecraft:stone_pickaxe") || this.hasItem("minecraft:iron_pickaxe");
        return sword && pick;
    }
    getBridgeBlockCount() {
        const block = this.getBridgeBlock();
        return block ? this.countItem(block) : 0;
    }
    clone() {
        const copy = new HunterInventory();
        copy.slots = this.slots.map((slot) => slot ? { ...slot } : null);
        copy._tempEquipActive = false;
        copy._tempEquipEndTick = 0;
        copy.modeState = { ...this.modeState };
        return copy;
    }
    toSnapshot() {
        return {
            slots: this.slots.map((slot) => slot ? { ...slot } : null),
            modeState: { ...this.modeState }
        };
    }
    static fromSnapshot(snapshot) {
        const inventory = new HunterInventory();
        if (snapshot?.slots?.length) {
            inventory.slots = snapshot.slots.map((slot) => slot ? { ...slot } : null);
        }
        inventory._tempEquipActive = false;
        inventory._tempEquipEndTick = 0;
        inventory.modeState = {
            ...inventory.modeState,
            ...(snapshot?.modeState ?? {})
        };
        return inventory;
    }
    setModeState(config = {}, resolvedKit = null) {
        const normalized = getDefaultInventoryModeConfig(config);
        this.modeState = {
            inventoryMode: normalized.inventoryMode,
            creatorKitId: normalized.creatorKitId,
            resolvedCreatorKitId: resolvedKit?.id ?? (normalized.creatorKitId !== DEFAULT_CREATOR_KIT_ID ? normalized.creatorKitId : null),
            prepBehavior: normalized.prepBehavior
        };
    }
    initializeForConfig(config = {}, profile = null) {
        const { itemMap, resolvedKit } = buildInventoryModeItemMap(config, profile);
        this.clear();
        this.setModeState(config, resolvedKit);
        this.applyItemMap(itemMap, { replaceExisting: false });
        return { itemMap, resolvedKit };
    }
    refreshForConfig(config = {}, profile = null, options = {}) {
        const { itemMap, resolvedKit } = buildInventoryModeItemMap(config, profile);
        const replaceExisting = !!options.replaceExisting;
        const preserveUpgrades = options.preserveUpgrades !== false;
        this.setModeState(config, resolvedKit);
        this.applyItemMap(itemMap, { replaceExisting, preserveUpgrades });
        return { itemMap, resolvedKit };
    }
    applyItemMap(itemMap = {}, options = {}) {
        const normalized = normalizeItemMap(itemMap);
        if (options.replaceExisting) {
            const keptSlots = options.preserveUpgrades ? this.buildUpgradePreservationMap(normalized) : Object.create(null);
            this.clear();
            for (const [typeId, amount] of Object.entries(keptSlots)) {
                this.addItem(typeId, amount);
            }
        }
        for (const [typeId, amount] of Object.entries(normalized)) {
            this.ensureAtLeast(typeId, amount);
        }
    }
    buildUpgradePreservationMap(targetMap = {}) {
        const preserved = Object.create(null);
        const keepByPriority = (priorityList) => {
            const existing = priorityList.find((item) => this.countItem(item) > 0);
            const incoming = priorityList.find((item) => (targetMap[item] ?? 0) > 0);
            if (!existing) return;
            if (!incoming || priorityList.indexOf(existing) < priorityList.indexOf(incoming)) {
                preserved[existing] = 1;
            }
        };
        keepByPriority(WEAPON_PRIORITY);
        keepByPriority(PICKAXE_PRIORITY);
        keepByPriority(AXE_PRIORITY);
        for (const items of Object.values(ARMOR_PRIORITY)) {
            const existing = items.find((item) => this.countItem(item) > 0);
            const incoming = items.find((item) => (targetMap[item] ?? 0) > 0);
            if (existing && (!incoming || items.indexOf(existing) < items.indexOf(incoming))) {
                preserved[existing] = 1;
            }
        }
        if (this.hasItem("minecraft:shield")) {
            preserved["minecraft:shield"] = 1;
        }
        return preserved;
    }
    getPreferredMainhandItem() {
        return this.getBestWeapon() || this.getBestAxe() || this.getBestPickaxe() || this.getBestFood() || this.getBridgeBlock();
    }
    showItemInHand(hunter, itemTypeId, actionEvent, durationTicks) {
        if (this._tempEquipActive) return;
        try {
            hunter.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${itemTypeId} 1`);
            if (actionEvent && actionEvent !== "none") {
                try { hunter.triggerEvent(`manhunt:set_action_${actionEvent}`); } catch (_) { }
            }
            this._tempEquipActive = true;
            this._tempEquipEndTick = system.currentTick + durationTicks;
        } catch (_) { }
    }
    forceShowItemInHand(hunter, itemTypeId, actionEvent, durationTicks) {
        try {
            hunter.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${itemTypeId} 1`);
            if (actionEvent && actionEvent !== "none") {
                try { hunter.triggerEvent(`manhunt:set_action_${actionEvent}`); } catch (_) { }
            }
            this._tempEquipActive = true;
            this._tempEquipEndTick = system.currentTick + durationTicks;
        } catch (_) { }
    }
    tickTempEquip(hunter) {
        if (!this._tempEquipActive) return;
        if (system.currentTick >= this._tempEquipEndTick) {
            this.finishTempEquip(hunter);
        }
    }
    finishTempEquip(hunter) {
        this._tempEquipActive = false;
        try { hunter.triggerEvent("manhunt:set_action_none"); } catch (_) { }
        try {
            const best = this.getPreferredMainhandItem();
            if (best) {
                hunter.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${best} 1`);
            }
        } catch (_) { }
    }
    isTempEquipActive() {
        return this._tempEquipActive;
    }
    resetTempEquip() {
        this._tempEquipActive = false;
        this._tempEquipEndTick = 0;
    }
    equipBest(hunter) {
        if (this._tempEquipActive) return;
        try {
            const weapon = this.getPreferredMainhandItem();
            if (weapon) {
                try { hunter.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${weapon} 1`); } catch (_) { }
            }
            const armorSlots = [
                { id: "Head", slot: "slot.armor.head" },
                { id: "Chest", slot: "slot.armor.chest" },
                { id: "Legs", slot: "slot.armor.legs" },
                { id: "Feet", slot: "slot.armor.feet" }
            ];
            for (const { id, slot } of armorSlots) {
                const armor = this.getBestArmor(id);
                if (armor) {
                    try { hunter.runCommand(`replaceitem entity @s ${slot} 0 ${armor} 1`); } catch (_) { }
                }
            }
            if (this.hasShield()) {
                try { hunter.runCommand(`replaceitem entity @s slot.weapon.offhand 0 minecraft:shield 1`); } catch (_) { }
            }
        } catch (_) { }
    }
    equipWeapon(hunter) {
        if (this._tempEquipActive) return;
        try {
            const weapon = this.getPreferredMainhandItem();
            if (!weapon) return;
            hunter.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${weapon} 1`);
        } catch (_) { }
    }
    attemptCraft() {
        for (const recipeName of CRAFT_PRIORITY) {
            const recipe = RECIPES.find(r => r.name === recipeName);
            if (!recipe) continue;
            if (this.hasItem(recipe.output.typeId) &&
                !recipeName.includes("planks") &&
                !recipeName.includes("sticks")) {
                continue;
            }
            let canCraft = true;
            for (const input of recipe.inputs) {
                if (!this.hasItem(input.typeId, input.amount)) {
                    canCraft = false;
                    break;
                }
            }
            if (canCraft) {
                for (const input of recipe.inputs) {
                    this.removeItem(input.typeId, input.amount);
                }
                this.addItem(recipe.output.typeId, recipe.output.amount);
                return recipe.name;
            }
        }
        return null;
    }
    attemptSmelt(currentTick, smeltTimers) {
        const smeltTime = 200;
        if (smeltTimers.has("iron")) {
            const start = smeltTimers.get("iron");
            if (currentTick - start >= smeltTime) {
                this.addItem("minecraft:iron_ingot", 1);
                smeltTimers.delete("iron");
                return true;
            }
            return false;
        }
        if (this.hasItem("minecraft:raw_iron")) {
            this.removeItem("minecraft:raw_iron", 1);
            smeltTimers.set("iron", currentTick);
            return true;
        }
        return false;
    }
    getMiningDuration(blockTypeId) {
        const info = MINEABLE_BLOCKS[blockTypeId];
        if (!info) return 0;
        let duration = info.baseTicks;
        if (blockTypeId.includes("log")) {
            if (this.getBestAxe()) duration = Math.max(8, Math.floor(duration * 0.5));
        } else if (blockTypeId.includes("stone") || blockTypeId.includes("cobble") ||
            blockTypeId.includes("ore") || blockTypeId.includes("iron")) {
            if (this.getBestPickaxe()) duration = Math.max(8, Math.floor(duration * 0.4));
        }
        return duration;
    }
    getMiningTool(blockTypeId) {
        if (blockTypeId.includes("log")) return this.getBestAxe();
        if (blockTypeId.includes("stone") || blockTypeId.includes("cobble") ||
            blockTypeId.includes("ore") || blockTypeId.includes("iron")) {
            return this.getBestPickaxe();
        }
        return this.getBestPickaxe() || this.getBestAxe();
    }
    getMiningDrop(blockTypeId) {
        const info = MINEABLE_BLOCKS[blockTypeId];
        if (!info) return null;
        if (blockTypeId.includes("log")) {
            return { typeId: "minecraft:oak_planks", amount: 4 };
        }
        if (blockTypeId === "minecraft:grass_block") {
            return { typeId: "minecraft:dirt", amount: 1 };
        }
        return { typeId: info.drop, amount: info.amount };
    }
    findGatherTarget(hunter, searchRadius = 3) {
        try {
            const pos = hunter.location;
            const dim = hunter.dimension;
            const feetY = Math.floor(pos.y) - 1;
            let closest = null;
            let closestDist = Infinity;
            for (let x = -searchRadius; x <= searchRadius; x++) {
                for (let y = -1; y <= 2; y++) {
                    for (let z = -searchRadius; z <= searchRadius; z++) {
                        const bx = Math.floor(pos.x) + x;
                        const by = Math.floor(pos.y) + y;
                        const bz = Math.floor(pos.z) + z;
                        if (by === feetY && bx === Math.floor(pos.x) && bz === Math.floor(pos.z)) continue;
                        try {
                            const block = dim.getBlock({ x: bx, y: by, z: bz });
                            if (block && GATHER_TARGETS.includes(block.typeId)) {
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
    dropAll(dimension, location) {
        this.resetTempEquip();
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i]) {
                try {
                    const item = new ItemStack(this.slots[i].typeId, this.slots[i].amount);
                    dimension.spawnItem(item, {
                        x: location.x + (Math.random() - 0.5) * 2,
                        y: location.y + 0.5,
                        z: location.z + (Math.random() - 0.5) * 2
                    });
                } catch (_) { }
                this.slots[i] = null;
            }
        }
    }
    giveStarterKit() {
        this.initializeForConfig({ inventoryMode: "starter", creatorKitId: DEFAULT_CREATOR_KIT_ID, prepBehavior: "hybrid" });
    }
    applyPlayerLoadoutBonus(playerItems = {}) {
        this.syncProgressionFromPlayer(playerItems);
    }
    syncProgressionFromPlayer(playerItems = {}) {
        this.ensurePreferredTool(playerItems, WEAPON_PRIORITY);
        this.ensurePreferredTool(playerItems, PICKAXE_PRIORITY);
        this.ensurePreferredTool(playerItems, AXE_PRIORITY);
        for (const [slotName, items] of Object.entries(ARMOR_PRIORITY)) {
            const armor = items.find((item) => (playerItems[item] ?? 0) > 0);
            if (armor) {
                this.ensureAtLeast(armor, 1);
            }
        }
        const foodTypes = Object.keys(FOOD_VALUES)
            .filter((item) => (playerItems[item] ?? 0) > 0)
            .sort((a, b) => FOOD_VALUES[b].saturation - FOOD_VALUES[a].saturation);
        let totalFood = 0;
        for (const food of foodTypes) {
            if (totalFood >= 16) break;
            const addAmount = Math.min(playerItems[food], 16 - totalFood);
            if (addAmount > 0) {
                this.ensureAtLeast(food, addAmount);
                totalFood += addAmount;
            }
        }
        for (const block of BONUS_BLOCKS) {
            const count = playerItems[block] ?? 0;
            if (count > 0) {
                this.ensureAtLeast(block, Math.min(count, 48));
                break;
            }
        }
        for (const item of BONUS_UTILITY_ITEMS) {
            const count = playerItems[item] ?? 0;
            if (count <= 0) continue;
            const addAmount = item === "minecraft:coal" || item === "minecraft:raw_iron" || item === "minecraft:iron_ingot"
                ? Math.min(count, 16)
                : 1;
            this.ensureAtLeast(item, addAmount);
        }
    }
    ensurePreferredTool(playerItems, priorityList) {
        const tool = priorityList.find((item) => (playerItems[item] ?? 0) > 0);
        if (tool) {
            this.ensureAtLeast(tool, 1);
        }
    }
}