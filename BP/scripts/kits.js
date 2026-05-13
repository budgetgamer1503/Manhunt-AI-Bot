/*
 * © 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */

export const DEFAULT_CREATOR_KIT_ID = "auto";

export const CREATOR_KITS = [
    {
        id: "balanced_hunter",
        name: "Balanced Hunter",
        description: "General survival kit with melee pressure, blocks, food, and core utilities.",
        items: {
            "minecraft:stone_sword": 1,
            "minecraft:stone_pickaxe": 1,
            "minecraft:stone_axe": 1,
            "minecraft:bread": 12,
            "minecraft:cobblestone": 40,
            "minecraft:oak_planks": 20,
            "minecraft:water_bucket": 1,
            "minecraft:shield": 1,
            "minecraft:red_bed": 1,
            "minecraft:crafting_table": 1
        },
        activation: {
            anyOf: [
                "minecraft:stone_sword",
                "minecraft:stone_pickaxe",
                "minecraft:cobblestone",
                "minecraft:bread"
            ]
        },
        scoreItems: [
            "minecraft:stone_sword",
            "minecraft:stone_pickaxe",
            "minecraft:stone_axe",
            "minecraft:bread",
            "minecraft:cobblestone",
            "minecraft:shield"
        ]
    },
    {
        id: "melee_pressure",
        name: "Melee Pressure",
        description: "Aggressive combat kit with iron gear, strong healing, and chase supplies.",
        items: {
            "minecraft:iron_sword": 1,
            "minecraft:iron_axe": 1,
            "minecraft:shield": 1,
            "minecraft:cooked_beef": 12,
            "minecraft:cobblestone": 48,
            "minecraft:water_bucket": 1,
            "minecraft:iron_ingot": 6,
            "minecraft:oak_planks": 16
        },
        activation: {
            anyOf: [
                "minecraft:iron_sword",
                "minecraft:diamond_sword",
                "minecraft:shield",
                "minecraft:cooked_beef",
                "minecraft:golden_apple"
            ]
        },
        scoreItems: [
            "minecraft:iron_sword",
            "minecraft:diamond_sword",
            "minecraft:shield",
            "minecraft:cooked_beef",
            "minecraft:golden_apple",
            "minecraft:iron_ingot"
        ]
    },
    {
        id: "resource_runner",
        name: "Resource Runner",
        description: "Preparation-oriented mining kit with tools, smelting materials, and utility blocks.",
        items: {
            "minecraft:stone_sword": 1,
            "minecraft:iron_pickaxe": 1,
            "minecraft:stone_axe": 1,
            "minecraft:bread": 10,
            "minecraft:cobblestone": 32,
            "minecraft:coal": 8,
            "minecraft:raw_iron": 8,
            "minecraft:furnace": 1,
            "minecraft:crafting_table": 1,
            "minecraft:water_bucket": 1
        },
        activation: {
            anyOf: [
                "minecraft:iron_pickaxe",
                "minecraft:raw_iron",
                "minecraft:iron_ingot",
                "minecraft:coal",
                "minecraft:furnace"
            ]
        },
        scoreItems: [
            "minecraft:iron_pickaxe",
            "minecraft:raw_iron",
            "minecraft:iron_ingot",
            "minecraft:coal",
            "minecraft:furnace"
        ]
    },
    {
        id: "builder_escape",
        name: "Builder Escape",
        description: "Mobility and structure-heavy kit with blocks, tools, bed, and placement utility.",
        items: {
            "minecraft:stone_sword": 1,
            "minecraft:stone_pickaxe": 1,
            "minecraft:stone_axe": 1,
            "minecraft:bread": 8,
            "minecraft:oak_planks": 48,
            "minecraft:cobblestone": 24,
            "minecraft:water_bucket": 1,
            "minecraft:red_bed": 1,
            "minecraft:crafting_table": 1,
            "minecraft:torch": 16
        },
        activation: {
            anyOf: [
                "minecraft:oak_planks",
                "minecraft:crafting_table",
                "minecraft:red_bed",
                "minecraft:water_bucket",
                "minecraft:torch"
            ]
        },
        scoreItems: [
            "minecraft:oak_planks",
            "minecraft:cobblestone",
            "minecraft:crafting_table",
            "minecraft:red_bed",
            "minecraft:water_bucket",
            "minecraft:torch"
        ]
    }
];

export function getCreatorKitById(kitId) {
    return CREATOR_KITS.find((kit) => kit.id === kitId) ?? null;
}

export function getCreatorKitChoices() {
    return [
        {
            id: DEFAULT_CREATOR_KIT_ID,
            name: "Auto Match",
            description: "Pick the best creator kit from the player's tracked inventory."
        },
        ...CREATOR_KITS.map((kit) => ({
            id: kit.id,
            name: kit.name,
            description: kit.description
        }))
    ];
}

export function resolveCreatorKit(playerItems = {}, preferredKitId = DEFAULT_CREATOR_KIT_ID) {
    if (preferredKitId && preferredKitId !== DEFAULT_CREATOR_KIT_ID) {
        return getCreatorKitById(preferredKitId) ?? CREATOR_KITS[0];
    }

    let bestKit = null;
    let bestScore = -1;

    for (const kit of CREATOR_KITS) {
        if (!matchesActivation(playerItems, kit.activation)) continue;

        let score = 0;
        for (const typeId of kit.scoreItems ?? []) {
            score += Math.min(playerItems[typeId] ?? 0, 4);
        }

        if (score > bestScore) {
            bestScore = score;
            bestKit = kit;
        }
    }

    return bestKit ?? CREATOR_KITS[0];
}

function matchesActivation(playerItems, activation = {}) {
    const anyOf = activation.anyOf ?? [];
    const allOf = activation.allOf ?? [];

    if (allOf.length > 0 && !allOf.every((typeId) => (playerItems[typeId] ?? 0) > 0)) {
        return false;
    }

    if (anyOf.length === 0) return true;
    return anyOf.some((typeId) => (playerItems[typeId] ?? 0) > 0);
}
