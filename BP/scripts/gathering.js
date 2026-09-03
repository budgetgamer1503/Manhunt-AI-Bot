import { EquipmentSlot, system } from "@minecraft/server";
import {
  AXES,
  BLOCK_HARDNESS,
  BUILDING_ITEMS,
  DIAMOND_ARMOR_COST,
  DROP_TABLE,
  FOOD_ITEMS,
  LOG_ITEMS,
  PICKAXES,
  PICK_REQUIREMENTS,
  PLANK_ITEMS,
  PROFILE_SETTINGS,
  RESOURCE_BLOCKS,
  SHOVELS,
  STONE_ITEMS,
  SWORDS
} from "./constants.js";
import {
  addItem,
  clearHunterLoadout,
  countAny,
  countItem,
  equipArmorSet,
  equipMainhand,
  equipOffhand,
  getBestFood,
  getBuildingItem,
  setEquipment,
  listInventory,
  removeAny,
  removeItem,
  restoreInventorySnapshot,
  runInventoryTransaction
} from "./inventory.js";
import { recordWork } from "./memory.js";
import {
  forgetResource,
  getHunterRole,
  getSharedResources,
  releaseTarget,
  reserveTarget,
  shareResource
} from "./squad.js";
import {
  adjacentLavaCount,
  distance,
  distanceSquared,
  floorLocation,
  getLightAt,
  hasStandingSpace,
  isAirBlock,
  isBreakableBlock,
  isFallingBlock,
  isPassableBlock,
  isSolidSupport,
  locationKey,
  safeDynamicGet,
  safeDynamicSet,
  safeGetBlock,
  safeLookAt,
  safePlayAnimation,
  safeTrigger,
  withinBlockReach
} from "./utils.js";
import {
  advanceActionStep,
  authorizeAction,
  authorizeBreak,
  authorizePlacement,
  createActionPlan,
  failActionStep,
  getCurrentStep
} from "./planner.js";

const LOG_TO_PLANK = Object.freeze({
  "minecraft:oak_log": "minecraft:oak_planks",
  "minecraft:spruce_log": "minecraft:spruce_planks",
  "minecraft:birch_log": "minecraft:birch_planks",
  "minecraft:jungle_log": "minecraft:jungle_planks",
  "minecraft:acacia_log": "minecraft:acacia_planks",
  "minecraft:dark_oak_log": "minecraft:dark_oak_planks",
  "minecraft:mangrove_log": "minecraft:mangrove_planks",
  "minecraft:cherry_log": "minecraft:cherry_planks",
  "minecraft:crimson_stem": "minecraft:crimson_planks",
  "minecraft:warped_stem": "minecraft:warped_planks"
});

const RESOURCE_EVENTS = Object.freeze({
  wood: "manhunt:gather_wood",
  stone: "manhunt:gather_stone",
  blocks: "manhunt:gather_blocks",
  coal: "manhunt:gather_coal",
  iron: "manhunt:gather_iron",
  gold: "manhunt:gather_gold",
  diamond: "manhunt:gather_diamond",
  debris: "manhunt:gather_debris",
  flint: "manhunt:gather_flint",
  portal: "manhunt:gather_obsidian",
  food: "manhunt:gather_food",
  combat: "manhunt:gather_combat"
});

const RAW_TO_COOKED = Object.freeze({
  "minecraft:beef": "minecraft:cooked_beef",
  "minecraft:porkchop": "minecraft:cooked_porkchop",
  "minecraft:mutton": "minecraft:cooked_mutton",
  "minecraft:chicken": "minecraft:cooked_chicken",
  "minecraft:rabbit": "minecraft:cooked_rabbit",
  "minecraft:potato": "minecraft:baked_potato"
});

const ARMOR_RECIPES = Object.freeze([
  { key: "helmet", cost: 5, item: "minecraft:iron_helmet", slot: EquipmentSlot.Head },
  { key: "chestplate", cost: 8, item: "minecraft:iron_chestplate", slot: EquipmentSlot.Chest },
  { key: "leggings", cost: 7, item: "minecraft:iron_leggings", slot: EquipmentSlot.Legs },
  { key: "boots", cost: 4, item: "minecraft:iron_boots", slot: EquipmentSlot.Feet }
]);

const ARMOR_SLOTS = Object.freeze({
  helmet: EquipmentSlot.Head,
  chestplate: EquipmentSlot.Chest,
  leggings: EquipmentSlot.Legs,
  boots: EquipmentSlot.Feet
});

let offsetCache = new Map();

function numberProperty(entity, key, fallback = 0) {
  const value = Number(safeDynamicGet(entity, key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function booleanProperty(entity, key, fallback = false) {
  const value = safeDynamicGet(entity, key, fallback);
  return typeof value === "boolean" ? value : fallback;
}

function increment(entity, key, amount = 1) {
  safeDynamicSet(entity, key, numberProperty(entity, key, 0) + amount);
}

function setTier(entity, key, value) {
  safeDynamicSet(entity, key, Math.max(0, Math.min(5, Math.trunc(value))));
}

export function getPickTier(hunter) { return numberProperty(hunter, "manhunt:pick_tier", 0); }
export function getSwordTier(hunter) { return numberProperty(hunter, "manhunt:sword_tier", 0); }
export function getAxeTier(hunter) { return numberProperty(hunter, "manhunt:axe_tier", 0); }
export function getShovelTier(hunter) { return numberProperty(hunter, "manhunt:shovel_tier", 0); }
export function getArmorTier(hunter) { return numberProperty(hunter, "manhunt:armor_tier", 0); }

export function equipBestPickaxe(hunter) {
  const item = PICKAXES[getPickTier(hunter)];
  if (item) equipMainhand(hunter, item);
  return item;
}

export function equipBestSword(hunter) {
  const item = SWORDS[getSwordTier(hunter)];
  if (item) equipMainhand(hunter, item);
  return item;
}

export function equipBestAxe(hunter) {
  const item = AXES[getAxeTier(hunter)];
  if (item) equipMainhand(hunter, item);
  return item;
}

export function equipBestShovel(hunter) {
  const item = SHOVELS[getShovelTier(hunter)];
  if (item) equipMainhand(hunter, item);
  return item;
}

export function initializeProgress(hunter, config, snapshot = undefined) {
  clearHunterLoadout(hunter);
  for (const [key, value] of Object.entries({
    "manhunt:pick_tier": 0,
    "manhunt:sword_tier": 0,
    "manhunt:axe_tier": 0,
    "manhunt:shovel_tier": 0,
    "manhunt:armor_tier": 0,
    "manhunt:has_crafting_table": false,
    "manhunt:has_furnace": false,
    "manhunt:has_shield": false,
    "manhunt:has_bow": false,
    "manhunt:prep_complete": false,
    "manhunt:fuel_charges": 0,
    "manhunt:blocks_mined": 0,
    "manhunt:recipes_crafted": 0,
    "manhunt:items_produced": 0,
    "manhunt:items_smelted": 0,
    "manhunt:iron_helmet": false,
    "manhunt:iron_chestplate": false,
    "manhunt:iron_leggings": false,
    "manhunt:iron_boots": false,
    "manhunt:diamond_helmet": false,
    "manhunt:diamond_chestplate": false,
    "manhunt:diamond_leggings": false,
    "manhunt:diamond_boots": false,
    "manhunt:netherite_helmet": false,
    "manhunt:netherite_chestplate": false,
    "manhunt:netherite_leggings": false,
    "manhunt:netherite_boots": false
  })) safeDynamicSet(hunter, key, value);

  if (snapshot) restoreProgressSnapshot(hunter, snapshot, config?.equipmentPersistence === true && snapshot.statsOnly !== true);
}

function markCrafted(hunter, outputAmount = 1) {
  increment(hunter, "manhunt:recipes_crafted", 1);
  increment(hunter, "manhunt:items_produced", outputAmount);
}

function countPlanks(hunter) { return countAny(hunter, PLANK_ITEMS); }
function countStone(hunter) { return countAny(hunter, STONE_ITEMS); }
function consumeAnyPlanks(hunter, amount) { return removeAny(hunter, PLANK_ITEMS, amount); }

function findFirstOwned(hunter, typeIds) {
  return typeIds.find((typeId) => countItem(hunter, typeId) > 0);
}

function convertOneLog(hunter) {
  const log = findFirstOwned(hunter, LOG_ITEMS);
  if (!log) return false;
  const output = LOG_TO_PLANK[log] ?? "minecraft:oak_planks";
  const crafted = runInventoryTransaction(hunter, () => removeItem(hunter, log, 1) && addItem(hunter, output, 4));
  if (!crafted) return false;
  markCrafted(hunter, 4);
  return true;
}

function craftSticks(hunter) {
  if (countPlanks(hunter) < 2) return false;
  const crafted = runInventoryTransaction(hunter, () => consumeAnyPlanks(hunter, 2) && addItem(hunter, "minecraft:stick", 4));
  if (!crafted) return false;
  markCrafted(hunter, 4);
  return true;
}

function craftCraftingTable(hunter) {
  if (booleanProperty(hunter, "manhunt:has_crafting_table") || countPlanks(hunter) < 4) return false;
  const crafted = runInventoryTransaction(hunter, () => consumeAnyPlanks(hunter, 4) && safeDynamicSet(hunter, "manhunt:has_crafting_table", true));
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftTool(hunter, material, type) {
  const tiers = { wood: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
  const tier = tiers[material];
  const tierKey = `manhunt:${type}_tier`;
  if (numberProperty(hunter, tierKey, 0) >= tier) return false;
  if (!booleanProperty(hunter, "manhunt:has_crafting_table")) return false;
  if (material === "netherite") {
    // Smithing-table upgrade abstraction: one ingot reforges an existing
    // diamond tool into its netherite form.
    if (numberProperty(hunter, tierKey, 0) < 4) return false;
    if (countItem(hunter, "minecraft:netherite_ingot") < 1) return false;
    const crafted = runInventoryTransaction(hunter, () =>
      removeItem(hunter, "minecraft:netherite_ingot", 1) && safeDynamicSet(hunter, tierKey, tier)
    );
    if (!crafted) return false;
    markCrafted(hunter, 1);
    return true;
  }
  const materialCount = type === "sword" ? 2 : type === "shovel" ? 1 : 3;
  const stickCount = type === "sword" || type === "shovel" ? (type === "sword" ? 1 : 2) : 2;
  const available = material === "wood" ? countPlanks(hunter)
    : material === "stone" ? countStone(hunter)
      : countItem(hunter, `minecraft:${material}` + (material === "iron" ? "_ingot" : ""));
  if (available < materialCount || countItem(hunter, "minecraft:stick") < stickCount) return false;
  const crafted = runInventoryTransaction(hunter, () => {
    const consumed = material === "wood" ? consumeAnyPlanks(hunter, materialCount)
      : material === "stone" ? removeAny(hunter, STONE_ITEMS, materialCount)
        : removeItem(hunter, material === "iron" ? "minecraft:iron_ingot" : "minecraft:diamond", materialCount);
    return consumed && removeItem(hunter, "minecraft:stick", stickCount) && safeDynamicSet(hunter, tierKey, tier);
  });
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftNetheriteIngot(hunter) {
  if (countItem(hunter, "minecraft:netherite_scrap") < 4 || countItem(hunter, "minecraft:gold_ingot") < 4) return false;
  if (!booleanProperty(hunter, "manhunt:has_crafting_table")) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:netherite_scrap", 4) &&
    removeItem(hunter, "minecraft:gold_ingot", 4) &&
    addItem(hunter, "minecraft:netherite_ingot", 1)
  );
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftFurnace(hunter) {
  if (booleanProperty(hunter, "manhunt:has_furnace") || countStone(hunter) < 8) return false;
  const crafted = runInventoryTransaction(hunter, () => removeAny(hunter, STONE_ITEMS, 8) && safeDynamicSet(hunter, "manhunt:has_furnace", true));
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftShield(hunter) {
  if (booleanProperty(hunter, "manhunt:has_shield")) return false;
  if (countItem(hunter, "minecraft:iron_ingot") < 1 || countPlanks(hunter) < 6) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:iron_ingot", 1) &&
    consumeAnyPlanks(hunter, 6) &&
    safeDynamicSet(hunter, "manhunt:has_shield", true)
  );
  if (!crafted) return false;
  equipOffhand(hunter, "minecraft:shield");
  markCrafted(hunter, 1);
  return true;
}

function craftBucket(hunter) {
  if (countItem(hunter, "minecraft:bucket") > 0 || countItem(hunter, "minecraft:water_bucket") > 0) return false;
  if (countItem(hunter, "minecraft:iron_ingot") < 3) return false;
  const crafted = runInventoryTransaction(hunter, () => removeItem(hunter, "minecraft:iron_ingot", 3) && addItem(hunter, "minecraft:bucket", 1));
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftBread(hunter) {
  if (countItem(hunter, "minecraft:wheat") < 3) return false;
  const crafted = runInventoryTransaction(hunter, () => removeItem(hunter, "minecraft:wheat", 3) && addItem(hunter, "minecraft:bread", 1));
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftTorches(hunter) {
  const fuel = countItem(hunter, "minecraft:coal") > 0 ? "minecraft:coal" : "minecraft:charcoal";
  if (countItem(hunter, fuel) < 1 || countItem(hunter, "minecraft:stick") < 1) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, fuel, 1) && removeItem(hunter, "minecraft:stick", 1) && addItem(hunter, "minecraft:torch", 4)
  );
  if (!crafted) return false;
  markCrafted(hunter, 4);
  return true;
}

function craftBow(hunter) {
  if (booleanProperty(hunter, "manhunt:has_bow")) return false;
  if (countItem(hunter, "minecraft:string") < 3 || countItem(hunter, "minecraft:stick") < 3) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:string", 3) &&
    removeItem(hunter, "minecraft:stick", 3) &&
    addItem(hunter, "minecraft:bow", 1) &&
    safeDynamicSet(hunter, "manhunt:has_bow", true)
  );
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftArrows(hunter) {
  if (countItem(hunter, "minecraft:flint") < 1 || countItem(hunter, "minecraft:stick") < 1 || countItem(hunter, "minecraft:feather") < 1) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:flint", 1) &&
    removeItem(hunter, "minecraft:stick", 1) &&
    removeItem(hunter, "minecraft:feather", 1) &&
    addItem(hunter, "minecraft:arrow", 4)
  );
  if (!crafted) return false;
  markCrafted(hunter, 4);
  return true;
}

function craftBoat(hunter) {
  if (countItem(hunter, "minecraft:oak_boat") > 0 || countPlanks(hunter) < 5) return false;
  const crafted = runInventoryTransaction(hunter, () => consumeAnyPlanks(hunter, 5) && addItem(hunter, "minecraft:oak_boat", 1));
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

export function craftEmergencyBoat(hunter) {
  if (countItem(hunter, "minecraft:oak_boat") > 0) return true;

  // Resolve the complete dependency chain instead of repeatedly failing the
  // boat action when the hunter owns logs but has not yet converted them.
  // A crafting table consumes four planks and the boat consumes five more.
  if (!booleanProperty(hunter, "manhunt:has_crafting_table")) {
    while (countPlanks(hunter) < 4 && countAny(hunter, LOG_ITEMS) > 0) {
      if (!convertOneLog(hunter)) break;
    }
    if (!craftCraftingTable(hunter) && !booleanProperty(hunter, "manhunt:has_crafting_table")) return false;
  }

  while (countPlanks(hunter) < 5 && countAny(hunter, LOG_ITEMS) > 0) {
    if (!convertOneLog(hunter)) break;
  }

  return craftBoat(hunter) || countItem(hunter, "minecraft:oak_boat") > 0;
}

function craftFlintAndSteel(hunter) {
  if (countItem(hunter, "minecraft:flint_and_steel") > 0) return false;
  if (countItem(hunter, "minecraft:flint") < 1 || countItem(hunter, "minecraft:iron_ingot") < 1) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:flint", 1) &&
    removeItem(hunter, "minecraft:iron_ingot", 1) &&
    addItem(hunter, "minecraft:flint_and_steel", 1)
  );
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function craftGoldenApple(hunter) {
  if (countItem(hunter, "minecraft:apple") < 1 || countItem(hunter, "minecraft:gold_ingot") < 8) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:apple", 1) &&
    removeItem(hunter, "minecraft:gold_ingot", 8) &&
    addItem(hunter, "minecraft:golden_apple", 1)
  );
  if (!crafted) return false;
  markCrafted(hunter, 1);
  return true;
}

function ironReserved(hunter) {
  let reserve = 0;
  if (getPickTier(hunter) < 3) reserve += 3;
  if (!booleanProperty(hunter, "manhunt:has_shield")) reserve += 1;
  if (countItem(hunter, "minecraft:bucket") + countItem(hunter, "minecraft:water_bucket") < 1) reserve += 3;
  if (getSwordTier(hunter) < 3) reserve += 2;
  return reserve;
}

function craftArmorPiece(hunter, recipe) {
  if (!recipe) return false;
  if (booleanProperty(hunter, `manhunt:iron_${recipe.key}`)) return false;
  if (countItem(hunter, "minecraft:iron_ingot") < recipe.cost + ironReserved(hunter)) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:iron_ingot", recipe.cost) && safeDynamicSet(hunter, `manhunt:iron_${recipe.key}`, true)
  );
  if (!crafted) return false;
  setEquipment(hunter, recipe.slot, recipe.item);
  markCrafted(hunter, 1);
  const complete = ARMOR_RECIPES.every((entry) => booleanProperty(hunter, `manhunt:iron_${entry.key}`));
  if (complete) setTier(hunter, "manhunt:armor_tier", Math.max(getArmorTier(hunter), 3));
  return true;
}

function craftDiamondArmorPiece(hunter, key) {
  const cost = DIAMOND_ARMOR_COST[key];
  if (!cost) return false;
  if (booleanProperty(hunter, `manhunt:diamond_${key}`)) return false;
  // Diamond armor is late-game: only spend diamonds once the tool kit is
  // complete so the pickaxe/sword upgrades are never starved.
  if (getPickTier(hunter) < 4 || getSwordTier(hunter) < 4) return false;
  if (booleanProperty(hunter, `manhunt:netherite_${key}`)) return true;
  if (countItem(hunter, "minecraft:diamond") < cost + diamondReserve(hunter)) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:diamond", cost) && safeDynamicSet(hunter, `manhunt:diamond_${key}`, true)
  );
  if (!crafted) return false;
  setEquipment(hunter, ARMOR_SLOTS[key], `minecraft:diamond_${key}`);
  markCrafted(hunter, 1);
  const complete = Object.keys(DIAMOND_ARMOR_COST).every((entry) => booleanProperty(hunter, `manhunt:diamond_${entry}`));
  if (complete) setTier(hunter, "manhunt:armor_tier", Math.max(getArmorTier(hunter), 4));
  return true;
}

function craftNetheriteArmorPiece(hunter, key) {
  if (booleanProperty(hunter, `manhunt:netherite_${key}`)) return false;
  if (!booleanProperty(hunter, `manhunt:diamond_${key}`)) return false;
  if (countItem(hunter, "minecraft:netherite_ingot") < 1 + netheriteToolReserve(hunter)) return false;
  const crafted = runInventoryTransaction(hunter, () =>
    removeItem(hunter, "minecraft:netherite_ingot", 1) && safeDynamicSet(hunter, `manhunt:netherite_${key}`, true)
  );
  if (!crafted) return false;
  setEquipment(hunter, ARMOR_SLOTS[key], `minecraft:netherite_${key}`);
  markCrafted(hunter, 1);
  const complete = ["helmet", "chestplate", "leggings", "boots"].every((entry) => booleanProperty(hunter, `manhunt:netherite_${entry}`));
  if (complete) setTier(hunter, "manhunt:armor_tier", 5);
  return true;
}

function diamondReserve(hunter) {
  let reserve = 0;
  if (getPickTier(hunter) < 4) reserve += 3;
  if (getSwordTier(hunter) < 4) reserve += 2;
  if (getAxeTier(hunter) < 4) reserve += 3;
  return reserve;
}

function netheriteToolReserve(hunter) {
  let reserve = 0;
  if (getPickTier(hunter) < 5) reserve += 1;
  if (getSwordTier(hunter) < 5) reserve += 1;
  if (getAxeTier(hunter) < 5) reserve += 1;
  return reserve;
}

function craftStepAvailable(hunter, label) {
  const logs = countAny(hunter, LOG_ITEMS);
  const planks = countPlanks(hunter);
  const sticks = countItem(hunter, "minecraft:stick");
  if (label === "convert logs into planks") return logs > 0;
  if (label === "craft a crafting table") return planks >= 4;
  if (label === "craft sticks") return planks >= 2;
  if (label.includes("wooden")) return planks >= (label.includes("sword") ? 2 : label.includes("shovel") ? 1 : 3) && sticks >= (label.includes("sword") ? 1 : 2);
  if (label.includes("stone")) return countStone(hunter) >= (label.includes("sword") ? 2 : label.includes("shovel") ? 1 : 3) && sticks >= (label.includes("sword") ? 1 : 2);
  return true;
}

function nextCraftStep(hunter, role = "Chaser") {
  const logs = countAny(hunter, LOG_ITEMS);
  const planks = countPlanks(hunter);
  const sticks = countItem(hunter, "minecraft:stick");
  const table = booleanProperty(hunter, "manhunt:has_crafting_table");
  const plankEquivalent = planks + logs * 4;
  if (!table) {
    // A crafting table alone is not progression. Reserve enough wood for the
    // table, sticks and the first wooden pickaxe before consuming four planks.
    // This prevents the old one-log deadlock: table crafted, zero wood left.
    if (plankEquivalent < 9) return undefined;
    if (planks >= 4) return "craft a crafting table";
    if (logs > 0) return "convert logs into planks";
    return undefined;
  }
  const bootstrap = [
    [getPickTier(hunter) < 1, "craft a wooden pickaxe", 3, 2],
    [getAxeTier(hunter) < 1, "craft a wooden axe", 3, 2],
    [getSwordTier(hunter) < 1, "craft a wooden sword", 2, 1],
    [getShovelTier(hunter) < 1, "craft a wooden shovel", 1, 2]
  ];
  for (const [needed, label, materialCost, stickCost] of bootstrap) {
    if (!needed) continue;
    if (craftStepAvailable(hunter, label)) return label;
    // Craft only the sticks required by the next concrete tool. The previous
    // generic "keep four sticks" rule could consume the final pickaxe planks
    // and deadlock progression at 3 planks + 2 sticks.
    if (sticks < stickCost) {
      if (planks >= 2) return "craft sticks";
      if (logs > 0) return "convert logs into planks";
      return undefined;
    }
    if (planks < materialCost) {
      if (logs > 0) return "convert logs into planks";
      return undefined;
    }
    return label;
  }
  const stoneSteps = [
    [getPickTier(hunter) < 2, "craft a stone pickaxe", 3],
    [getAxeTier(hunter) < 2, "craft a stone axe", 3],
    [getSwordTier(hunter) < 2, "craft a stone sword", 2],
    [getShovelTier(hunter) < 2, "craft a stone shovel", 1]
  ];
  for (const [needed, label, cost] of stoneSteps) if (needed && countStone(hunter) >= cost && sticks >= (label.includes("sword") ? 1 : 2)) return label;
  if (!booleanProperty(hunter, "manhunt:has_furnace") && countStone(hunter) >= 8) return "craft a furnace";
  if (countItem(hunter, "minecraft:wheat") >= 3 && countItem(hunter, "minecraft:bread") < 4) return "craft bread";
  if (countItem(hunter, "minecraft:torch") < 8 && (countItem(hunter, "minecraft:coal") + countItem(hunter, "minecraft:charcoal")) > 0 && sticks > 0) return "craft torches";

  // Dependency repair for later recipes. The old planner could own logs but
  // still skip shield/boat/bow forever because those recipes require planks
  // or sticks. Convert only the amount needed by an actually available recipe.
  const iron = countItem(hunter, "minecraft:iron_ingot");
  const needsToolSticks =
    (getPickTier(hunter) < 3 && iron >= 3) ||
    (getSwordTier(hunter) < 3 && iron >= 2) ||
    (getAxeTier(hunter) < 3 && iron >= 3) ||
    (getShovelTier(hunter) < 3 && iron >= 1) ||
    (getPickTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 3) ||
    (getSwordTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 2) ||
    (getAxeTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 3) ||
    (!booleanProperty(hunter, "manhunt:has_bow") && countItem(hunter, "minecraft:string") >= 3);
  if (needsToolSticks && sticks < 3) {
    if (planks >= 2) return "craft sticks";
    if (logs > 0) return "convert logs into planks";
  }
  if (!booleanProperty(hunter, "manhunt:has_shield") && iron >= 1 && planks < 6 && logs > 0) return "convert logs into planks";
  if (countItem(hunter, "minecraft:oak_boat") < 1 && planks < 5 && logs > 0) return "convert logs into planks";

  if (getPickTier(hunter) < 3 && iron >= 3 && sticks >= 2) return "craft an iron pickaxe";
  if (!booleanProperty(hunter, "manhunt:has_shield") && countItem(hunter, "minecraft:iron_ingot") >= 1 && planks >= 6) return "craft a shield";
  if (countItem(hunter, "minecraft:bucket") + countItem(hunter, "minecraft:water_bucket") < 1 && countItem(hunter, "minecraft:iron_ingot") >= 3) return "craft a bucket";
  if (getSwordTier(hunter) < 3 && countItem(hunter, "minecraft:iron_ingot") >= 2 && sticks >= 1) return "craft an iron sword";
  if (getAxeTier(hunter) < 3 && countItem(hunter, "minecraft:iron_ingot") >= 3 && sticks >= 2) return "craft an iron axe";
  if (getShovelTier(hunter) < 3 && countItem(hunter, "minecraft:iron_ingot") >= 1 && sticks >= 2) return "craft an iron shovel";
  if ((role === "Archer" || countItem(hunter, "minecraft:string") >= 3) && !booleanProperty(hunter, "manhunt:has_bow") && countItem(hunter, "minecraft:string") >= 3 && sticks >= 3) return "craft a bow";
  if (booleanProperty(hunter, "manhunt:has_bow") && countItem(hunter, "minecraft:arrow") < 24 && countItem(hunter, "minecraft:flint") > 0 && countItem(hunter, "minecraft:feather") > 0 && sticks > 0) return "craft arrows";
  if (countItem(hunter, "minecraft:oak_boat") < 1 && planks >= 5) return "craft a boat";
  if (countItem(hunter, "minecraft:flint_and_steel") < 1 && countItem(hunter, "minecraft:flint") > 0 && countItem(hunter, "minecraft:iron_ingot") > 0) return "craft flint and steel";
  if (countItem(hunter, "minecraft:apple") > 0 && countItem(hunter, "minecraft:gold_ingot") >= 8 && countItem(hunter, "minecraft:golden_apple") < 2) return "craft a golden apple";
  for (const recipe of ARMOR_RECIPES) if (!booleanProperty(hunter, `manhunt:iron_${recipe.key}`) && countItem(hunter, "minecraft:iron_ingot") >= recipe.cost + ironReserved(hunter)) return `craft an iron ${recipe.key}`;
  if (getPickTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 3 && sticks >= 2) return "craft a diamond pickaxe";
  if (getSwordTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 2 && sticks >= 1) return "craft a diamond sword";
  if (getAxeTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") >= 3 && sticks >= 2) return "craft a diamond axe";
  // v2.0 endgame: convert scrap into ingots, reforge tools, then upgrade armor.
  const scrap = countItem(hunter, "minecraft:netherite_scrap");
  const ingots = countItem(hunter, "minecraft:netherite_ingot");
  if (scrap >= 4 && countItem(hunter, "minecraft:gold_ingot") >= 4) return "craft a netherite ingot";
  if (ingots >= 1) {
    if (getSwordTier(hunter) < 5) return "reforge the sword with netherite";
    if (getPickTier(hunter) < 5) return "reforge the pickaxe with netherite";
    if (getAxeTier(hunter) < 5) return "reforge the axe with netherite";
    if (getShovelTier(hunter) < 5) return "reforge the shovel with netherite";
  }
  for (const key of ["helmet", "chestplate", "leggings", "boots"]) {
    if (!booleanProperty(hunter, `manhunt:diamond_${key}`) && getPickTier(hunter) >= 4 && getSwordTier(hunter) >= 4 && countItem(hunter, "minecraft:diamond") >= DIAMOND_ARMOR_COST[key] + diamondReserve(hunter)) {
      return `craft a diamond ${key}`;
    }
  }
  if (ingots >= 1) {
    for (const key of ["chestplate", "leggings", "helmet", "boots"]) {
      if (booleanProperty(hunter, `manhunt:diamond_${key}`) && !booleanProperty(hunter, `manhunt:netherite_${key}`)) {
        return `reforge the ${key} with netherite`;
      }
    }
  }
  return undefined;
}


export function syncHunterEquipment(hunter, brain, perception = undefined, force = false) {
  if (!hunter || !brain) return false;
  if (!force && system.currentTick - (brain.lastEquipmentSyncTick ?? -9999) < 8) return false;
  brain.lastEquipmentSyncTick = system.currentTick;

  for (const recipe of ARMOR_RECIPES) {
    // Respect the highest owned material per slot; a full sync must never
    // downgrade a reforged netherite piece back to iron.
    if (booleanProperty(hunter, `manhunt:netherite_${recipe.key}`)) setEquipment(hunter, recipe.slot, `minecraft:netherite_${recipe.key}`);
    else if (booleanProperty(hunter, `manhunt:diamond_${recipe.key}`)) setEquipment(hunter, recipe.slot, `minecraft:diamond_${recipe.key}`);
    else if (booleanProperty(hunter, `manhunt:iron_${recipe.key}`)) setEquipment(hunter, recipe.slot, recipe.item);
  }

  if (booleanProperty(hunter, "manhunt:has_shield")) equipOffhand(hunter, "minecraft:shield");
  else setEquipment(hunter, EquipmentSlot.Offhand, undefined);

  const goal = String(brain.currentGoal ?? "");
  const plannedStep = brain.actionPlan?.steps?.[brain.actionPlan?.cursor ?? 0];
  let held;
  if (brain.holdMainhandItem && system.currentTick < (brain.holdMainhandUntilTick ?? 0)) {
    held = brain.holdMainhandItem;
    equipMainhand(hunter, held);
  } else if ((perception?.falling || goal === "fall_save") && countItem(hunter, "minecraft:water_bucket") > 0) {
    held = "minecraft:water_bucket";
    equipMainhand(hunter, held);
  } else if (plannedStep?.type === "activate_portal" && countItem(hunter, "minecraft:flint_and_steel") > 0) {
    held = "minecraft:flint_and_steel";
    equipMainhand(hunter, held);
  } else if (plannedStep?.type === "place_water" && countItem(hunter, "minecraft:water_bucket") > 0) {
    held = "minecraft:water_bucket";
    equipMainhand(hunter, held);
  } else if (plannedStep?.type === "place" && plannedStep?.metadata?.purpose === "torch" && countItem(hunter, "minecraft:torch") > 0) {
    held = "minecraft:torch";
    equipMainhand(hunter, held);
  } else if (["place", "pillar"].includes(plannedStep?.type)) {
    held = plannedStep.item && countItem(hunter, plannedStep.item) > 0 ? plannedStep.item : getBuildingItem(hunter);
    if (held) equipMainhand(hunter, held);
  } else if (plannedStep?.type === "break" && plannedStep.location) {
    const plannedBlock = safeGetBlock(hunter.dimension, plannedStep.location);
    held = plannedBlock?.typeId ? equipMiningTool(hunter, plannedBlock.typeId) : undefined;
  } else if (brain.mineTask?.typeId) {
    held = equipMiningTool(hunter, brain.mineTask.typeId);
  } else if (["vertical_pursuit", "gather_blocks"].includes(goal)) {
    held = getBuildingItem(hunter);
    if (held) equipMainhand(hunter, held);
    else held = equipBestPickaxe(hunter);
  } else if (goal === "build_portal") {
    held = countItem(hunter, "minecraft:obsidian") > 0 ? "minecraft:obsidian" : undefined;
    if (held) equipMainhand(hunter, held);
  } else if (goal === "ranged_attack" && booleanProperty(hunter, "manhunt:has_bow")) {
    held = "minecraft:bow";
    equipMainhand(hunter, held);
  } else if (goal === "eat") {
    held = selectFoodForEating(hunter)?.typeId;
    if (held) equipMainhand(hunter, held);
  } else if (goal.startsWith("gather_wood")) {
    held = equipBestAxe(hunter);
  } else if (["gather_stone", "gather_coal", "gather_iron", "gather_gold", "gather_diamond", "gather_debris", "gather_obsidian", "break_pillar"].includes(goal)) {
    held = equipBestPickaxe(hunter);
  } else if (goal === "gather_flint") {
    held = equipBestShovel(hunter);
  } else {
    held = equipBestSword(hunter);
  }
  if (held) {
    brain.lastVisibleMainhand = held;
    brain.lastVisibleMainhandUntilTick = system.currentTick + 16;
  } else if (brain.lastVisibleMainhand && system.currentTick < (brain.lastVisibleMainhandUntilTick ?? 0)) {
    held = brain.lastVisibleMainhand;
    equipMainhand(hunter, held);
  } else {
    brain.lastVisibleMainhand = undefined;
    setEquipment(hunter, EquipmentSlot.Mainhand, undefined);
  }
  brain.equipmentContext = `${goal}:${held ?? "empty"}`;
  return true;
}

export function getCraftPlan(hunter) {
  return nextCraftStep(hunter, getHunterRole(hunter));
}

export function performCraftStep(hunter, brain) {
  if (system.currentTick - brain.lastCraftTick < 12) return false;
  const plan = nextCraftStep(hunter, brain.role);
  if (!plan) return false;
  let crafted = false;
  if (plan === "convert logs into planks") crafted = convertOneLog(hunter);
  else if (plan === "craft a crafting table") crafted = craftCraftingTable(hunter);
  else if (plan === "craft sticks") crafted = craftSticks(hunter);
  else if (plan === "craft a wooden pickaxe") crafted = craftTool(hunter, "wood", "pick");
  else if (plan === "craft a wooden axe") crafted = craftTool(hunter, "wood", "axe");
  else if (plan === "craft a wooden sword") crafted = craftTool(hunter, "wood", "sword");
  else if (plan === "craft a wooden shovel") crafted = craftTool(hunter, "wood", "shovel");
  else if (plan === "craft a stone pickaxe") crafted = craftTool(hunter, "stone", "pick");
  else if (plan === "craft a stone axe") crafted = craftTool(hunter, "stone", "axe");
  else if (plan === "craft a stone sword") crafted = craftTool(hunter, "stone", "sword");
  else if (plan === "craft a stone shovel") crafted = craftTool(hunter, "stone", "shovel");
  else if (plan === "craft a furnace") crafted = craftFurnace(hunter);
  else if (plan === "craft bread") crafted = craftBread(hunter);
  else if (plan === "craft torches") crafted = craftTorches(hunter);
  else if (plan === "craft an iron pickaxe") crafted = craftTool(hunter, "iron", "pick");
  else if (plan === "craft an iron axe") crafted = craftTool(hunter, "iron", "axe");
  else if (plan === "craft an iron sword") crafted = craftTool(hunter, "iron", "sword");
  else if (plan === "craft an iron shovel") crafted = craftTool(hunter, "iron", "shovel");
  else if (plan === "craft a diamond pickaxe") crafted = craftTool(hunter, "diamond", "pick");
  else if (plan === "craft a diamond sword") crafted = craftTool(hunter, "diamond", "sword");
  else if (plan === "craft a diamond axe") crafted = craftTool(hunter, "diamond", "axe");
  else if (plan === "craft a netherite ingot") crafted = craftNetheriteIngot(hunter);
  else if (plan === "reforge the sword with netherite") crafted = craftTool(hunter, "netherite", "sword");
  else if (plan === "reforge the pickaxe with netherite") crafted = craftTool(hunter, "netherite", "pick");
  else if (plan === "reforge the axe with netherite") crafted = craftTool(hunter, "netherite", "axe");
  else if (plan === "reforge the shovel with netherite") crafted = craftTool(hunter, "netherite", "shovel");
  else if (plan.startsWith("craft a diamond ")) crafted = craftDiamondArmorPiece(hunter, plan.replace("craft a diamond ", ""));
  else if (plan.startsWith("reforge the ") && plan.endsWith(" with netherite") && plan !== "reforge the sword with netherite" && plan !== "reforge the pickaxe with netherite" && plan !== "reforge the axe with netherite" && plan !== "reforge the shovel with netherite") {
    crafted = craftNetheriteArmorPiece(hunter, plan.replace("reforge the ", "").replace(" with netherite", ""));
  }
  else if (plan === "craft a shield") crafted = craftShield(hunter);
  else if (plan === "craft a bucket") crafted = craftBucket(hunter);
  else if (plan === "craft a bow") crafted = craftBow(hunter);
  else if (plan === "craft arrows") crafted = craftArrows(hunter);
  else if (plan === "craft a boat") crafted = craftBoat(hunter);
  else if (plan === "craft flint and steel") crafted = craftFlintAndSteel(hunter);
  else if (plan === "craft a golden apple") crafted = craftGoldenApple(hunter);
  else if (plan.startsWith("craft an iron ")) crafted = craftArmorPiece(hunter, ARMOR_RECIPES.find((entry) => plan.endsWith(entry.key)));
  if (crafted) {
    brain.lastCraftTick = system.currentTick;
    brain.lastSuccessfulAction = plan;
    if (plan.includes("pickaxe") || plan.includes("axe") || plan.includes("shovel")) {
      // Targets rejected only because a tool was missing become valid as soon
      // as that tool is crafted. Drop stale approach/blacklist state so the
      // executor immediately selects the nearest reachable resource again.
      brain.resourceBlacklist.clear();
      brain.resourceScans = {};
      brain.resourceScan = { category: undefined, originKey: undefined, cursor: 0, offsets: undefined };
      clearResourceTarget(brain);
    }
    syncHunterEquipment(hunter, brain, brain.perception, true);
  }
  return crafted;
}

export function tryFillWaterBucket(hunter, perception) {
  if (!perception?.inWater || countItem(hunter, "minecraft:water_bucket") > 0 || countItem(hunter, "minecraft:bucket") < 1) return false;
  if (!removeItem(hunter, "minecraft:bucket", 1)) return false;
  if (!addItem(hunter, "minecraft:water_bucket", 1)) {
    addItem(hunter, "minecraft:bucket", 1);
    return false;
  }
  return true;
}

function consumeFuel(hunter) {
  const current = numberProperty(hunter, "manhunt:fuel_charges", 0);
  if (current > 0) {
    safeDynamicSet(hunter, "manhunt:fuel_charges", current - 1);
    return true;
  }
  for (const [typeId, charges] of [["minecraft:coal", 8], ["minecraft:charcoal", 8], ...PLANK_ITEMS.map((id) => [id, 1]), ...LOG_ITEMS.map((id) => [id, 1])]) {
    if (countItem(hunter, typeId) > 0 && removeItem(hunter, typeId, 1)) {
      safeDynamicSet(hunter, "manhunt:fuel_charges", charges - 1);
      return true;
    }
  }
  return false;
}

function selectSmeltInput(hunter) {
  if (countItem(hunter, "minecraft:ancient_debris") > 0 && countItem(hunter, "minecraft:netherite_scrap") < 8) return { input: "minecraft:ancient_debris", output: "minecraft:netherite_scrap" };
  if (countItem(hunter, "minecraft:raw_iron") > 0) return { input: "minecraft:raw_iron", output: "minecraft:iron_ingot" };
  if (countItem(hunter, "minecraft:raw_gold") > 0) return { input: "minecraft:raw_gold", output: "minecraft:gold_ingot" };
  for (const [input, output] of Object.entries(RAW_TO_COOKED)) if (countItem(hunter, input) > 0 && countItem(hunter, output) < 8) return { input, output };
  if (countItem(hunter, "minecraft:charcoal") < 4) {
    const log = findFirstOwned(hunter, LOG_ITEMS);
    if (log) return { input: log, output: "minecraft:charcoal" };
  }
  return undefined;
}

function fuelItemCount(hunter) {
  return countItem(hunter, "minecraft:coal") + countItem(hunter, "minecraft:charcoal") + countAny(hunter, PLANK_ITEMS) + countAny(hunter, LOG_ITEMS);
}

function hasFuelAfterReservingInput(hunter, selected) {
  if (numberProperty(hunter, "manhunt:fuel_charges", 0) > 0) return true;
  let available = fuelItemCount(hunter);
  if (selected && (LOG_ITEMS.includes(selected.input) || PLANK_ITEMS.includes(selected.input))) available--;
  return available > 0;
}

export function canSmelt(hunter) {
  if (!booleanProperty(hunter, "manhunt:has_furnace")) return false;
  const selected = selectSmeltInput(hunter);
  return !!selected && hasFuelAfterReservingInput(hunter, selected);
}

export function tickSmelting(hunter, brain) {
  if (!brain.smeltTask) {
    if (!canSmelt(hunter)) return false;
    const selected = selectSmeltInput(hunter);
    if (!selected || !hasFuelAfterReservingInput(hunter, selected)) return false;
    // Inputs remain in inventory during the timed operation. They are consumed
    // atomically at completion, so death, goal interruption, or a full output
    // inventory cannot silently delete fuel or ore.
    brain.smeltTask = { ...selected, startTick: system.currentTick, completeTick: system.currentTick + 80 };
    return true;
  }
  if (system.currentTick < brain.smeltTask.completeTick) return true;
  const task = brain.smeltTask;
  if (countItem(hunter, task.input) < 1 || !hasFuelAfterReservingInput(hunter, task)) {
    brain.lastFailedAction = `smelting cancelled: ${task.input.replace("minecraft:", "")} or fuel is no longer available`;
    brain.smeltTask = undefined;
    return false;
  }
  const fuelBefore = numberProperty(hunter, "manhunt:fuel_charges", 0);
  const completed = runInventoryTransaction(hunter, () =>
    removeItem(hunter, task.input, 1) && consumeFuel(hunter) && addItem(hunter, task.output, 1)
  );
  if (!completed) {
    safeDynamicSet(hunter, "manhunt:fuel_charges", fuelBefore);
    task.completeTick = system.currentTick + 20;
    brain.lastFailedAction = "smelting output is waiting for inventory space";
    return true;
  }
  increment(hunter, "manhunt:items_smelted", 1);
  brain.lastSmeltTick = system.currentTick;
  brain.lastSuccessfulAction = `smelted ${task.output.replace("minecraft:", "")}`;
  brain.smeltTask = undefined;
  return true;
}

function getOffsets(radius) {
  const key = Math.max(2, Math.trunc(radius));
  if (offsetCache.has(key)) return offsetCache.get(key);
  const offsets = [];
  for (let y = -Math.min(8, key); y <= Math.min(8, key); y++) {
    for (let x = -key; x <= key; x++) {
      for (let z = -key; z <= key; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const distanceScore = x * x + z * z + y * y * 1.45;
        if (distanceScore > key * key * 1.45) continue;
        offsets.push({ x, y, z, score: distanceScore });
      }
    }
  }
  offsets.sort((a, b) => a.score - b.score);
  offsetCache.set(key, offsets);
  return offsets;
}

const RESOURCE_APPROACH_OFFSETS = Object.freeze([
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 }, { x: -1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 },
  { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
  { x: 1, y: -1, z: 0 }, { x: -1, y: -1, z: 0 }, { x: 0, y: -1, z: 1 }, { x: 0, y: -1, z: -1 },
  { x: 1, y: -2, z: 0 }, { x: -1, y: -2, z: 0 }, { x: 0, y: -2, z: 1 }, { x: 0, y: -2, z: -1 },
  { x: 1, y: -3, z: 0 }, { x: -1, y: -3, z: 0 }, { x: 0, y: -3, z: 1 }, { x: 0, y: -3, z: -1 }
]);

function resourceApproachCandidate(dimension, location, from) {
  const base = floorLocation(location);
  const candidates = [];
  for (const offset of RESOURCE_APPROACH_OFFSETS) {
    const standing = { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
    if (!hasStandingSpace(dimension, standing, false)) continue;
    const eye = { x: standing.x + 0.5, y: standing.y + 1.45, z: standing.z + 0.5 };
    const target = { x: base.x + 0.5, y: base.y + 0.5, z: base.z + 0.5 };
    const reachSquared = distanceSquared(eye, target);
    if (reachSquared > 13.7) continue;
    candidates.push({
      location: { x: standing.x + 0.5, y: standing.y, z: standing.z + 0.5 },
      score: distanceSquared(from ?? target, standing) + reachSquared * 0.2
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.location;
}

function isResourceExposed(dimension, location) {
  for (const offset of [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
  ]) {
    const adjacent = safeGetBlock(dimension, { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z });
    if (isPassableBlock(adjacent, true)) return true;
  }
  return false;
}

function pruneBlacklist(brain) {
  for (const [key, expiry] of brain.resourceBlacklist) if (!Number.isFinite(expiry) || expiry <= system.currentTick) brain.resourceBlacklist.delete(key);
  while (brain.resourceBlacklist.size > 96) brain.resourceBlacklist.delete(brain.resourceBlacklist.keys().next().value);
}

function pruneMemory(brain, category, maximum) {
  const list = brain.resourceMemory[category] ?? [];
  const unique = new Map();
  for (const entry of list) unique.set(locationKey(entry.location, entry.dimensionId), entry);
  brain.resourceMemory[category] = [...unique.values()].sort((a, b) => b.tick - a.tick).slice(0, maximum);
}

export function scanForResources(hunter, brain, category, config) {
  const set = RESOURCE_BLOCKS[category];
  if (!set) return 0;
  const profile = PROFILE_SETTINGS[config.performanceProfile] ?? PROFILE_SETTINGS[1];
  const origin = floorLocation(hunter.location);
  const originKey = locationKey(origin, hunter.dimension.id);
  if (!brain.resourceScans || typeof brain.resourceScans !== "object") brain.resourceScans = {};
  let scan = brain.resourceScans[category];
  if (!scan || scan.originKey !== originKey || !scan.offsets) {
    scan = { category, originKey, cursor: 0, offsets: getOffsets(profile.resourceRadius) };
    brain.resourceScans[category] = scan;
  }
  // Keep the last active scan exposed for diagnostics while preserving an
  // independent cursor per category. Dependency scans (blocks -> wood) no
  // longer reset each other to offset zero every brain update.
  brain.resourceScan = scan;
  pruneBlacklist(brain);
  let found = 0;
  for (let processed = 0; processed < profile.resourceScanBudget && scan.cursor < scan.offsets.length; processed++, scan.cursor++) {
    const offset = scan.offsets[scan.cursor];
    const location = { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z };
    const key = locationKey(location, hunter.dimension.id);
    if ((brain.resourceBlacklist.get(key) ?? 0) > system.currentTick) continue;
    const block = safeGetBlock(hunter.dimension, location);
    if (!block || !set.has(block.typeId) || !isResourceExposed(hunter.dimension, location)) continue;
    const entry = { dimensionId: hunter.dimension.id, location, typeId: block.typeId, tick: system.currentTick };
    brain.resourceMemory[category].push(entry);
    shareResource(category, hunter.dimension.id, location, block.typeId, 1);
    found++;
  }
  if (scan.cursor >= scan.offsets.length) scan.cursor = 0;
  pruneMemory(brain, category, profile.maxRememberedResources);
  recordWork(brain, "scan", profile.resourceScanBudget);
  return found;
}

function removePersonalResource(brain, category, dimensionId, location) {
  const key = locationKey(location, dimensionId);
  brain.resourceMemory[category] = (brain.resourceMemory[category] ?? []).filter((entry) => locationKey(entry.location, entry.dimensionId) !== key);
}

export function chooseResourceTarget(hunter, brain, category) {
  const personal = brain.resourceMemory[category] ?? [];
  const shared = getSharedResources(category, hunter.dimension.id);
  const unique = new Map();
  for (const entry of [...personal, ...shared]) unique.set(locationKey(entry.location, entry.dimensionId), entry);
  const candidates = [];
  for (const entry of unique.values()) {
    if (entry.dimensionId !== hunter.dimension.id) continue;
    const key = locationKey(entry.location, entry.dimensionId);
    if ((brain.resourceBlacklist.get(key) ?? 0) > system.currentTick) continue;
    const block = safeGetBlock(hunter.dimension, entry.location);
    if (!block || !RESOURCE_BLOCKS[category]?.has(block.typeId)) {
      forgetResource(category, entry.dimensionId, entry.location);
      removePersonalResource(brain, category, entry.dimensionId, entry.location);
      releaseTarget(key, hunter.id);
      continue;
    }
    const targetLocation = floorLocation(entry.location);
    if (!canMineBlock(hunter, block.typeId, false)) continue;
    const unsafe = unsafeToMine(hunter, targetLocation, block.typeId);
    if (unsafe) {
      brain.resourceBlacklist.set(key, system.currentTick + 20 * 20);
      continue;
    }
    const approach = resourceApproachCandidate(hunter.dimension, targetLocation, hunter.location);
    if (!approach) {
      brain.resourceBlacklist.set(key, system.currentTick + 20 * 30);
      continue;
    }
    const currentDistance = distanceSquared(hunter.location, targetLocation);
    const approachDistance = distanceSquared(hunter.location, approach);
    const verticalPenalty = Math.max(0, Math.abs(targetLocation.y - hunter.location.y) - 3) * 5;
    candidates.push({
      score: approachDistance + currentDistance * 0.15 + verticalPenalty,
      key,
      target: { ...entry, location: targetLocation, approach, typeId: block.typeId, distanceSquared: currentDistance }
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    // Reserve only the selected valid candidate. The old implementation
    // reserved every rejected and non-winning resource, starving teammates.
    if (!reserveTarget(candidate.key, hunter.id, 20 * 20)) continue;
    candidate.target.reservationKey = candidate.key;
    return candidate.target;
  }
  return undefined;
}

export function setResourceTarget(brain, target, category) {
  if (brain.resourceReservationKey && brain.resourceReservationKey !== target?.reservationKey) releaseTarget(brain.resourceReservationKey, brain.hunterId);
  brain.resourceTarget = target ? { ...target.location } : undefined;
  brain.resourceApproach = target?.approach ? { ...target.approach } : undefined;
  brain.resourceTargetCategory = target ? category : undefined;
  brain.resourceReservationKey = target?.reservationKey;
  brain.resourceTargetSinceTick = target ? system.currentTick : 0;
  brain.resourceTargetBestDistance = target ? Math.sqrt(target.distanceSquared) : Number.POSITIVE_INFINITY;
}

export function clearResourceTarget(brain) {
  if (brain?.resourceReservationKey) releaseTarget(brain.resourceReservationKey, brain.hunterId);
  brain.resourceTarget = undefined;
  brain.resourceApproach = undefined;
  brain.resourceTargetCategory = undefined;
  brain.resourceReservationKey = undefined;
  brain.resourceTargetSinceTick = 0;
  brain.resourceTargetBestDistance = Number.POSITIVE_INFINITY;
}

export function requiredPickTier(typeId) {
  return PICK_REQUIREMENTS[typeId] ?? 0;
}

export function canMineBlock(hunter, typeId, emergency = false) {
  const required = requiredPickTier(typeId);
  if (required > getPickTier(hunter)) return false;
  if (typeId === "minecraft:obsidian" && getPickTier(hunter) < 4) return false;
  if (emergency && required >= 2 && getPickTier(hunter) < required) return false;
  return true;
}

function preferredToolKind(typeId) {
  if (LOG_ITEMS.includes(typeId) || typeId.includes("planks")) return "axe";
  if (typeId === "minecraft:dirt" || typeId === "minecraft:grass_block" || typeId === "minecraft:gravel" || typeId.includes("sand")) return "shovel";
  if (requiredPickTier(typeId) > 0 || typeId.includes("stone") || typeId.includes("deepslate") || typeId.includes("ore") || typeId.includes("debris") || typeId === "minecraft:tuff" || typeId === "minecraft:obsidian") return "pick";
  if (typeId === "minecraft:cobweb") return "sword";
  return "hand";
}

function toolTierForBlock(hunter, typeId) {
  const kind = preferredToolKind(typeId);
  if (kind === "axe") return getAxeTier(hunter);
  if (kind === "pick") return getPickTier(hunter);
  if (kind === "shovel") return getShovelTier(hunter);
  if (kind === "sword") return getSwordTier(hunter);
  return 0;
}

function requiredMiningTicks(hunter, typeId, emergency = false) {
  let base = BLOCK_HARDNESS[typeId];
  if (!base) {
    if (typeId.includes("log") || typeId.includes("stem")) base = 22;
    else if (typeId.includes("leaves")) base = 4;
    else if (typeId.includes("stone") || typeId.includes("ore")) base = 36;
    else base = 14;
  }
  const tier = toolTierForBlock(hunter, typeId);
  const multipliers = [1.5, 0.82, 0.55, 0.34, 0.22];
  let ticks = Math.max(4, Math.ceil(base * (multipliers[tier] ?? 1.5)));
  if (emergency && requiredPickTier(typeId) <= getPickTier(hunter)) ticks = Math.max(6, Math.ceil(ticks * 0.76));
  return ticks;
}

function unsafeToMine(hunter, location, typeId, options = {}) {
  const feet = floorLocation(hunter.location);
  if (!options.allowBelow && location.x === feet.x && location.z === feet.z && location.y < feet.y) return "will not mine directly beneath itself";
  const above = safeGetBlock(hunter.dimension, { x: location.x, y: location.y + 1, z: location.z });
  if (!options.allowFallingBlock && isFallingBlock(above)) return "falling sand or gravel could suffocate the hunter";
  if (!options.allowLava && adjacentLavaCount(hunter.dimension, location) > 0 && typeId !== "minecraft:obsidian") return "lava is touching the target block";
  return undefined;
}

export function beginMiningTask(hunter, brain, location, category = undefined, emergency = false, options = {}) {
  const block = safeGetBlock(hunter.dimension, location);
  if (!block || !isBreakableBlock(block)) return false;
  if (!canMineBlock(hunter, block.typeId, emergency)) {
    brain.lastFailedAction = `wrong tool for ${block.typeId.replace("minecraft:", "")}`;
    return false;
  }
  const unsafe = unsafeToMine(hunter, floorLocation(location), block.typeId, options);
  if (unsafe) {
    brain.lastFailedAction = unsafe;
    return false;
  }
  const key = locationKey(location, hunter.dimension.id);
  if (brain.mineTask?.key === key) return true;
  if (!authorizeBreak(brain, location)) {
    createActionPlan(brain, category ? `mine_${category}` : "mine_route", `mine ${block.typeId.replace("minecraft:", "")}`, [
      { type: "break", location: floorLocation(location), reason: "planned mining", maxTicks: 240, metadata: { category, emergency } }
    ], { category }, 260);
  }
  brain.mineTask = {
    key,
    location: floorLocation(location),
    dimensionId: hunter.dimension.id,
    typeId: block.typeId,
    category,
    emergency,
    options: { ...options },
    startTick: system.currentTick,
    lastProgressTick: system.currentTick,
    progressTicks: 0,
    requiredTicks: requiredMiningTicks(hunter, block.typeId, emergency)
  };
  return true;
}

export function cancelMiningTask(brain, reason = "cancelled") {
  if (brain?.mineTask) brain.lastFailedAction = `mining: ${reason}`;
  if (brain) brain.mineTask = undefined;
}

function equipMiningTool(hunter, typeId) {
  const kind = preferredToolKind(typeId);
  if (kind === "axe") return equipBestAxe(hunter);
  if (kind === "pick") return equipBestPickaxe(hunter);
  if (kind === "shovel") return equipBestShovel(hunter);
  if (kind === "sword") return equipBestSword(hunter);
  return undefined;
}

function collectBlockDrop(hunter, typeId) {
  let drop;
  if (typeId === "minecraft:gravel") {
    drop = Math.random() < 0.55 ? ["minecraft:flint", 1] : ["minecraft:gravel", 1];
  } else if (String(typeId).includes("leaves")) {
    drop = Math.random() < 0.08 ? ["minecraft:apple", 1] : undefined;
  } else {
    drop = DROP_TABLE[typeId] ?? (typeId && !typeId.includes("grass") ? [typeId, 1] : undefined);
  }
  if (!drop) return true;
  return runInventoryTransaction(hunter, () => addItem(hunter, drop[0], drop[1]));
}

function chooseTorchLocation(hunter) {
  const base = floorLocation(hunter.location);
  for (const offset of [{ x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }]) {
    const location = { x: base.x + offset.x, y: base.y, z: base.z + offset.z };
    const block = safeGetBlock(hunter.dimension, location);
    const below = safeGetBlock(hunter.dimension, { x: location.x, y: location.y - 1, z: location.z });
    if (isAirBlock(block) && isSolidSupport(below)) return location;
  }
  return undefined;
}

export function tickTorchPlacement(hunter, brain) {
  const step = getCurrentStep(brain);
  if (!step || step.type !== "place" || step.metadata?.purpose !== "torch") return false;
  if (!authorizePlacement(brain, step.location, "torch") || !withinBlockReach(hunter, step.location, 3)) return false;
  const block = safeGetBlock(hunter.dimension, step.location);
  const below = safeGetBlock(hunter.dimension, { x: step.location.x, y: step.location.y - 1, z: step.location.z });
  if (!isAirBlock(block) || !isSolidSupport(below) || countItem(hunter, "minecraft:torch") < 1) {
    failActionStep(brain, "torch location became invalid");
    return false;
  }
  if (!removeItem(hunter, "minecraft:torch", 1)) return false;
  try { block.setType("minecraft:torch"); } catch { addItem(hunter, "minecraft:torch", 1); failActionStep(brain, "torch placement failed"); return false; }
  advanceActionStep(brain, "torch placed");
  return true;
}

export function tickMiningTask(hunter, brain) {
  const task = brain.mineTask;
  if (!task) return { active: false, completed: false };
  if (hunter.dimension.id !== task.dimensionId) {
    cancelMiningTask(brain, "dimension changed");
    return { active: false, completed: false };
  }
  const block = safeGetBlock(hunter.dimension, task.location);
  if (!block || block.typeId !== task.typeId) {
    brain.mineTask = undefined;
    if (authorizeBreak(brain, task.location)) advanceActionStep(brain, "block already removed");
    return { active: false, completed: false };
  }
  if (!canMineBlock(hunter, task.typeId, task.emergency)) {
    cancelMiningTask(brain, "required tool is unavailable");
    failActionStep(brain, "required mining tool is unavailable");
    return { active: false, completed: false, wrongTool: true };
  }
  const unsafe = unsafeToMine(hunter, task.location, task.typeId, task.options);
  if (unsafe) {
    cancelMiningTask(brain, unsafe);
    failActionStep(brain, unsafe);
    return { active: false, completed: false, unsafe: true };
  }
  const range = task.emergency ? 3.4 : 2.9;
  const now = system.currentTick;
  const delta = Math.max(1, Math.min(20, now - (task.lastProgressTick ?? now - 1)));
  task.lastProgressTick = now;
  if (distance(hunter.location, task.location) > range) {
    task.progressTicks = Math.max(0, task.progressTicks - Math.ceil(delta * 0.35));
    return { active: true, completed: false, approaching: true };
  }
  task.progressTicks += delta;
  safeLookAt(hunter, { x: task.location.x + 0.5, y: task.location.y + 0.5, z: task.location.z + 0.5 });
  equipMiningTool(hunter, task.typeId);
  if (task.progressTicks % 7 < delta) safePlayAnimation(hunter, "animation.humanoid.attack.rotations", { blendOutTime: 0.12 });
  if (task.progressTicks < task.requiredTicks) return { active: true, completed: false };
  let originalPermutation;
  try { originalPermutation = block.permutation; } catch { originalPermutation = undefined; }
  try {
    block.setType("minecraft:air");
  } catch {
    return { active: true, completed: false };
  }
  if (!collectBlockDrop(hunter, task.typeId)) {
    try {
      if (originalPermutation) block.setPermutation(originalPermutation);
      else block.setType(task.typeId);
    } catch {
      // The world changed after mining; retain the failure diagnostic.
    }
    task.progressTicks = Math.max(0, task.requiredTicks - 5);
    brain.lastFailedAction = "mining paused because the hunter inventory is full";
    return { active: true, completed: false, inventoryFull: true };
  }
  increment(hunter, "manhunt:blocks_mined", 1);
  if (authorizeBreak(brain, task.location)) increment(hunter, "manhunt:route_blocks_broken", 1);
  recordWork(brain, "break", 1);
  brain.lastBreakTick = system.currentTick;
  brain.lastSuccessfulAction = `mined ${task.typeId.replace("minecraft:", "")}`;
  brain.mineTask = undefined;
  if (task.category) clearResourceTarget(brain);
  if (authorizeBreak(brain, task.location)) advanceActionStep(brain, "mined planned block");
  if (getLightAt(hunter.dimension, hunter.location, 15) < 7 && countItem(hunter, "minecraft:torch") > 0 && !brain.actionPlan) {
    const torchLocation = chooseTorchLocation(hunter);
    if (torchLocation) createActionPlan(brain, "light_tunnel", "place a torch in a dark mined route", [
      { type: "place", location: torchLocation, reason: "light the tunnel", metadata: { purpose: "torch" }, maxTicks: 80 }
    ], {}, 100);
  }
  return { active: false, completed: true, typeId: task.typeId };
}

function tickObsidianFormation(hunter, brain, location) {
  const block = safeGetBlock(hunter.dimension, location);
  if (!block || block.typeId !== "minecraft:lava") return { active: false, completed: false };
  if (hunter.dimension.id === "minecraft:nether" || hunter.dimension.id === "nether") {
    failActionStep(brain, "water cannot form obsidian in the Nether");
    return { active: false, completed: false };
  }
  if (getPickTier(hunter) < 4 || countItem(hunter, "minecraft:water_bucket") < 1) {
    failActionStep(brain, "diamond pickaxe and water bucket are required to form and mine obsidian");
    return { active: false, completed: false };
  }
  if (!authorizeAction(brain, "form_obsidian", location)) return { active: false, completed: false };
  if (!withinBlockReach(hunter, location, 3.4)) return { active: true, approaching: true };
  if (adjacentLavaCount(hunter.dimension, hunter.location) > 2 && distance(hunter.location, location) < 1.5) {
    failActionStep(brain, "lava formation position is too dangerous");
    return { active: false, completed: false };
  }
  safeLookAt(hunter, { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 });
  if (!removeItem(hunter, "minecraft:water_bucket", 1)) return { active: false, completed: false };
  try { block.setType("minecraft:obsidian"); }
  catch { addItem(hunter, "minecraft:water_bucket", 1); failActionStep(brain, "obsidian formation failed"); return { active: false, completed: false }; }
  addItem(hunter, "minecraft:bucket", 1);
  advanceActionStep(brain, "lava source converted to obsidian");
  brain.lastSuccessfulAction = "formed obsidian with water";
  return { active: false, completed: true };
}

export function tickResourceGathering(hunter, brain, category, config) {
  if (category === "combat") {
    safeTrigger(hunter, RESOURCE_EVENTS.combat);
    return { state: "hunting_combat_materials" };
  }
  scanForResources(hunter, brain, category, config);
  const resourceSet = RESOURCE_BLOCKS[category];
  if (!resourceSet) return { state: "missing" };
  if (brain.resourceTarget && brain.resourceTargetCategory === category) {
    const block = safeGetBlock(hunter.dimension, brain.resourceTarget);
    if (!block || !resourceSet.has(block.typeId)) clearResourceTarget(brain);
    else if (brain.resourceReservationKey && !reserveTarget(brain.resourceReservationKey, hunter.id, 20 * 20)) clearResourceTarget(brain);
  }
  if (!brain.resourceTarget) {
    const target = chooseResourceTarget(hunter, brain, category);
    if (target) setResourceTarget(brain, target, category);
  }
  if (!brain.resourceTarget) {
    if (category === "food") {
      safeTrigger(hunter, RESOURCE_EVENTS.food);
      return { state: "hunting_animals" };
    }
    return { state: "searching" };
  }
  const currentDistance = distance(hunter.location, brain.resourceTarget);
  const targetBlock = safeGetBlock(hunter.dimension, brain.resourceTarget);
  if (category === "portal" && targetBlock?.typeId === "minecraft:lava") {
    if (getPickTier(hunter) < 4 || countItem(hunter, "minecraft:water_bucket") < 1) {
      const key = locationKey(brain.resourceTarget, hunter.dimension.id);
      brain.resourceBlacklist.set(key, system.currentTick + 20 * 45);
      clearResourceTarget(brain);
      return { state: "need_water_and_diamond_pick" };
    }
    if (currentDistance > 3.4) return { state: "approaching", target: brain.resourceTarget };
    const step = getCurrentStep(brain);
    if (!step || step.type !== "form_obsidian" || locationKey(step.location) !== locationKey(brain.resourceTarget)) {
      createActionPlan(brain, "form_obsidian", "convert a safe lava source into mineable obsidian", [
        { type: "form_obsidian", location: floorLocation(brain.resourceTarget), reason: "pour water onto the lava source", maxTicks: 100 }
      ], { category: "portal" }, 120);
    }
    const result = tickObsidianFormation(hunter, brain, brain.resourceTarget);
    return { state: result.completed ? "formed_obsidian" : "forming_obsidian", target: brain.resourceTarget };
  }
  if (currentDistance + 0.4 < brain.resourceTargetBestDistance) brain.resourceTargetBestDistance = currentDistance;
  const targetAge = system.currentTick - brain.resourceTargetSinceTick;
  if (targetAge > 240 && currentDistance > brain.resourceTargetBestDistance + 1.5) {
    const key = locationKey(brain.resourceTarget, hunter.dimension.id);
    brain.resourceBlacklist.set(key, system.currentTick + 20 * 60);
    brain.routeFailures++;
    clearResourceTarget(brain);
    return { state: "blacklisted" };
  }
  if (currentDistance <= 2.9) {
    safeTrigger(hunter, "manhunt:idle");
    const targetLocation = floorLocation(brain.resourceTarget);
    const step = getCurrentStep(brain);
    if (!step || step.type !== "break" || locationKey(step.location) !== locationKey(targetLocation)) {
      createActionPlan(brain, `mine_${category}`, `mine the selected ${category} resource`, [
        {
          type: "break",
          location: targetLocation,
          reason: `mine the verified ${category} target with the correct tool`,
          maxTicks: 360,
          metadata: { emergency: false, resourceCategory: category }
        }
      ], { category, resourceTarget: targetLocation }, 20 * 40);
    }
    if (!authorizeBreak(brain, targetLocation)) return { state: "planning_mine", target: brain.resourceTarget };
    if (!brain.mineTask && !beginMiningTask(hunter, brain, targetLocation, category, false)) {
      const key = locationKey(targetLocation, hunter.dimension.id);
      brain.resourceBlacklist.set(key, system.currentTick + 20 * 45);
      clearResourceTarget(brain);
      failActionStep(brain, "selected resource cannot be mined safely with the current tool");
      return { state: "wrong_tool_or_unsafe" };
    }
    const result = tickMiningTask(hunter, brain);
    return { state: result.completed ? "mined" : "mining", target: brain.resourceTarget };
  }
  return { state: "approaching", target: brain.resourceTarget };
}

export function getResourceNeeds(hunter, config, perception, elapsedTicks) {
  if (!config.gathering) return [];
  const role = getHunterRole(hunter);
  const needs = [];
  const logs = countAny(hunter, LOG_ITEMS);
  const planks = countPlanks(hunter);
  const sticks = countItem(hunter, "minecraft:stick");
  const stone = countStone(hunter);
  const food = countAny(hunter, FOOD_ITEMS);
  const building = countAny(hunter, BUILDING_ITEMS);
  const rawIron = countItem(hunter, "minecraft:raw_iron");
  const iron = countItem(hunter, "minecraft:iron_ingot");
  const coal = countItem(hunter, "minecraft:coal") + countItem(hunter, "minecraft:charcoal");
  const rawGold = countItem(hunter, "minecraft:raw_gold");
  const gold = countItem(hunter, "minecraft:gold_ingot");
  const pickTier = getPickTier(hunter);
  const swordTier = getSwordTier(hunter);
  const prepLimit = config.prepMode === 2 ? 45 * 20 : 120 * 20;
  const inPreparationWindow = config.prepMode !== 1 && elapsedTicks < prepLimit && perception.runnerDistance > 10;
  const woodUnits = logs * 4 + planks;
  const bootstrapMissing = !booleanProperty(hunter, "manhunt:has_crafting_table") || pickTier < 1 || swordTier < 1 || getAxeTier(hunter) < 1;
  if ((bootstrapMissing && woodUnits < 16) || (sticks < 2 && planks < 2 && logs < 1)) needs.push({ category: "wood", score: inPreparationWindow ? 760 : 610, reason: "logs are needed for planks, sticks, and the first tools" });
  if (pickTier >= 1 && (stone < 12 || pickTier < 2 || swordTier < 2 || !booleanProperty(hunter, "manhunt:has_furnace"))) needs.push({ category: "stone", score: inPreparationWindow ? 690 : 540, reason: "stone tools, furnace, and dependable building blocks are missing" });
  if (food < (role === "Chaser" ? 5 : 3)) needs.push({ category: "food", score: perception.healthRatio < 0.72 ? 760 : 530, reason: "the food reserve is low" });
  const desiredBlocks = role === "Builder" ? 48 : role === "Chaser" ? 20 : 16;
  if (building < desiredBlocks) needs.push({ category: "blocks", score: role === "Builder" ? 730 : 500, reason: `the ${role.toLowerCase()} needs ${desiredBlocks} safe route blocks` });
  if (config.advancedMining !== false) {
    if ((rawIron > 0 || rawGold > 0) && coal < 1 && numberProperty(hunter, "manhunt:fuel_charges", 0) <= 0) needs.push({ category: "coal", score: 650, reason: "fuel is required to smelt collected metal and food" });
    if (pickTier >= 2 && iron + rawIron < 18) needs.push({ category: "iron", score: role === "Gatherer" ? 680 : 470, reason: "iron is reserved for pickaxe, shield, bucket, weapon, and armor" });
    if (pickTier >= 3 && gold + rawGold < 8 && countItem(hunter, "minecraft:apple") > 0) needs.push({ category: "gold", score: 390, reason: "gold can become a healing golden apple" });
    if (pickTier >= 3 && getPickTier(hunter) < 4 && countItem(hunter, "minecraft:diamond") < 3) needs.push({ category: "diamond", score: role === "Gatherer" ? 410 : 280, reason: "a diamond pickaxe unlocks obsidian and better equipment" });
    const scrap = countItem(hunter, "minecraft:netherite_scrap");
    const netheriteIngot = countItem(hunter, "minecraft:netherite_ingot");
    const inNether = String(perception.dimensionId ?? "").includes("nether");
    if (config.netheriteProgression !== false && inNether && pickTier >= 4 && scrap + netheriteIngot * 4 < 8) {
      needs.push({ category: "debris", score: role === "Gatherer" ? 700 : 560, reason: "ancient debris is the path to netherite gear" });
    }
    if (!perception.sameDimension && config.portalIntelligence && getPickTier(hunter) >= 4 && countItem(hunter, "minecraft:obsidian") < 14) needs.push({ category: "portal", score: role === "Gatherer" || role === "Builder" ? 720 : 610, reason: "fourteen obsidian blocks are required to construct a portal frame" });
    if (countItem(hunter, "minecraft:flint") < 2) needs.push({ category: "flint", score: 300, reason: "flint is needed for arrows and portal ignition" });
  }
  if ((role === "Archer" || config.hunterCount > 2) && (!booleanProperty(hunter, "manhunt:has_bow") || countItem(hunter, "minecraft:arrow") < 16)) needs.push({ category: "combat", score: role === "Archer" ? 700 : 360, reason: "string, feathers, flint, and arrows are needed for ranged combat" });
  const best = new Map();
  for (const need of needs) if (!best.has(need.category) || best.get(need.category).score < need.score) best.set(need.category, need);
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function isPreparationComplete(hunter, config, elapsedTicks) {
  if (!config.gathering || config.prepMode === 1) return true;
  if (booleanProperty(hunter, "manhunt:prep_complete")) return true;
  const role = getHunterRole(hunter);
  const limit = config.prepMode === 2 ? 45 * 20 : 120 * 20;
  const coreReady = getPickTier(hunter) >= 2 && getSwordTier(hunter) >= 2 && countAny(hunter, FOOD_ITEMS) >= 3 && countAny(hunter, BUILDING_ITEMS) >= (role === "Builder" ? 24 : 10);
  if (coreReady || elapsedTicks >= limit) {
    safeDynamicSet(hunter, "manhunt:prep_complete", true);
    return true;
  }
  return false;
}

export function selectFoodForEating(hunter) { return getBestFood(hunter); }
export function consumeFood(hunter, typeId) { return removeItem(hunter, typeId, 1); }

export function addMobDrop(hunter, entity) {
  if (!hunter || !entity) return;
  const drops = {
    "minecraft:cow": [["minecraft:beef", 2], ["minecraft:leather", 1]],
    "minecraft:mooshroom": [["minecraft:beef", 2], ["minecraft:leather", 1]],
    "minecraft:pig": [["minecraft:porkchop", 2]],
    "minecraft:sheep": [["minecraft:mutton", 2], ["minecraft:white_wool", 1]],
    "minecraft:chicken": [["minecraft:chicken", 1], ["minecraft:feather", 2]],
    "minecraft:rabbit": [["minecraft:rabbit", 1]],
    "minecraft:spider": [["minecraft:string", 2]],
    "minecraft:cave_spider": [["minecraft:string", 2]],
    "minecraft:skeleton": [["minecraft:arrow", 3], ["minecraft:bone", 2]],
    "minecraft:stray": [["minecraft:arrow", 3], ["minecraft:bone", 2]],
    "minecraft:zombie": Math.random() < 0.08 ? [["minecraft:iron_ingot", 1]] : [["minecraft:rotten_flesh", 1]]
  };
  for (const [typeId, amount] of drops[entity.typeId] ?? []) addItem(hunter, typeId, amount);
}

export const addAnimalDrop = addMobDrop;

export function getProgressSnapshot(hunter) {
  return {
    inventory: listInventory(hunter),
    pickTier: getPickTier(hunter), swordTier: getSwordTier(hunter), axeTier: getAxeTier(hunter), shovelTier: getShovelTier(hunter), armorTier: getArmorTier(hunter),
    hasCraftingTable: booleanProperty(hunter, "manhunt:has_crafting_table"),
    hasFurnace: booleanProperty(hunter, "manhunt:has_furnace"),
    hasShield: booleanProperty(hunter, "manhunt:has_shield"),
    hasBow: booleanProperty(hunter, "manhunt:has_bow"),
    ironHelmet: booleanProperty(hunter, "manhunt:iron_helmet"),
    ironChestplate: booleanProperty(hunter, "manhunt:iron_chestplate"),
    ironLeggings: booleanProperty(hunter, "manhunt:iron_leggings"),
    ironBoots: booleanProperty(hunter, "manhunt:iron_boots"),
    diamondHelmet: booleanProperty(hunter, "manhunt:diamond_helmet"),
    diamondChestplate: booleanProperty(hunter, "manhunt:diamond_chestplate"),
    diamondLeggings: booleanProperty(hunter, "manhunt:diamond_leggings"),
    diamondBoots: booleanProperty(hunter, "manhunt:diamond_boots"),
    netheriteHelmet: booleanProperty(hunter, "manhunt:netherite_helmet"),
    netheriteChestplate: booleanProperty(hunter, "manhunt:netherite_chestplate"),
    netheriteLeggings: booleanProperty(hunter, "manhunt:netherite_leggings"),
    netheriteBoots: booleanProperty(hunter, "manhunt:netherite_boots"),
    prepComplete: booleanProperty(hunter, "manhunt:prep_complete"),
    fuelCharges: numberProperty(hunter, "manhunt:fuel_charges"),
    blocksMined: numberProperty(hunter, "manhunt:blocks_mined"),
    recipesCrafted: numberProperty(hunter, "manhunt:recipes_crafted"),
    itemsProduced: numberProperty(hunter, "manhunt:items_produced"),
    itemsSmelted: numberProperty(hunter, "manhunt:items_smelted"),
    routeJumps: numberProperty(hunter, "manhunt:route_jumps"),
    routeBlocksPlaced: numberProperty(hunter, "manhunt:route_blocks_placed"),
    routeBlocksBroken: numberProperty(hunter, "manhunt:route_blocks_broken"),
    mlgSaves: numberProperty(hunter, "manhunt:mlg_saves"),
    blockClutches: numberProperty(hunter, "manhunt:block_clutches"),
    boatsDestroyed: numberProperty(hunter, "manhunt:boats_destroyed"),
    boatsUsed: numberProperty(hunter, "manhunt:boats_used")
  };
}

export function restoreProgressSnapshot(hunter, snapshot, restoreEquipment = true) {
  if (!snapshot) return;
  if (restoreEquipment) {
    restoreInventorySnapshot(hunter, snapshot.inventory);
    setTier(hunter, "manhunt:pick_tier", snapshot.pickTier ?? 0);
    setTier(hunter, "manhunt:sword_tier", snapshot.swordTier ?? 0);
    setTier(hunter, "manhunt:axe_tier", snapshot.axeTier ?? 0);
    setTier(hunter, "manhunt:shovel_tier", snapshot.shovelTier ?? 0);
    setTier(hunter, "manhunt:armor_tier", snapshot.armorTier ?? 0);
    safeDynamicSet(hunter, "manhunt:has_crafting_table", snapshot.hasCraftingTable === true);
    safeDynamicSet(hunter, "manhunt:has_furnace", snapshot.hasFurnace === true);
    safeDynamicSet(hunter, "manhunt:has_shield", snapshot.hasShield === true);
    safeDynamicSet(hunter, "manhunt:has_bow", snapshot.hasBow === true);
    safeDynamicSet(hunter, "manhunt:iron_helmet", snapshot.ironHelmet === true);
    safeDynamicSet(hunter, "manhunt:iron_chestplate", snapshot.ironChestplate === true);
    safeDynamicSet(hunter, "manhunt:iron_leggings", snapshot.ironLeggings === true);
    safeDynamicSet(hunter, "manhunt:iron_boots", snapshot.ironBoots === true);
    safeDynamicSet(hunter, "manhunt:diamond_helmet", snapshot.diamondHelmet === true);
    safeDynamicSet(hunter, "manhunt:diamond_chestplate", snapshot.diamondChestplate === true);
    safeDynamicSet(hunter, "manhunt:diamond_leggings", snapshot.diamondLeggings === true);
    safeDynamicSet(hunter, "manhunt:diamond_boots", snapshot.diamondBoots === true);
    safeDynamicSet(hunter, "manhunt:netherite_helmet", snapshot.netheriteHelmet === true);
    safeDynamicSet(hunter, "manhunt:netherite_chestplate", snapshot.netheriteChestplate === true);
    safeDynamicSet(hunter, "manhunt:netherite_leggings", snapshot.netheriteLeggings === true);
    safeDynamicSet(hunter, "manhunt:netherite_boots", snapshot.netheriteBoots === true);
    safeDynamicSet(hunter, "manhunt:prep_complete", snapshot.prepComplete === true);
    safeDynamicSet(hunter, "manhunt:fuel_charges", snapshot.fuelCharges ?? 0);
  }
  for (const key of ["blocksMined", "recipesCrafted", "itemsProduced", "itemsSmelted", "routeJumps", "routeBlocksPlaced", "routeBlocksBroken", "mlgSaves", "blockClutches", "boatsDestroyed", "boatsUsed"]) {
    const property = `manhunt:${key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`;
    safeDynamicSet(hunter, property, snapshot[key] ?? 0);
  }
  if (!restoreEquipment) return;
  if (snapshot.hasShield) equipOffhand(hunter, "minecraft:shield");
  const armorSlots = { helmet: EquipmentSlot.Head, chestplate: EquipmentSlot.Chest, leggings: EquipmentSlot.Legs, boots: EquipmentSlot.Feet };
  if ((snapshot.armorTier ?? 0) >= 5) equipArmorSet(hunter, "netherite");
  else if ((snapshot.armorTier ?? 0) >= 4) equipArmorSet(hunter, "diamond");
  else {
    for (const [key, slot] of Object.entries(armorSlots)) {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      if (snapshot[`netherite${cap}`] === true) setEquipment(hunter, slot, `minecraft:netherite_${key}`);
      else if (snapshot[`diamond${cap}`] === true) setEquipment(hunter, slot, `minecraft:diamond_${key}`);
      else if (snapshot[`iron${cap}`] === true) setEquipment(hunter, slot, `minecraft:iron_${key}`);
    }
  }
  equipBestSword(hunter);
}

export function getGatheringStatus(hunter) {
  return {
    pickTier: getPickTier(hunter), swordTier: getSwordTier(hunter), axeTier: getAxeTier(hunter), shovelTier: getShovelTier(hunter), armorTier: getArmorTier(hunter),
    food: countAny(hunter, FOOD_ITEMS), buildingBlocks: countAny(hunter, BUILDING_ITEMS), logs: countAny(hunter, LOG_ITEMS), planks: countPlanks(hunter), stone: countStone(hunter),
    coal: countItem(hunter, "minecraft:coal") + countItem(hunter, "minecraft:charcoal"), rawIron: countItem(hunter, "minecraft:raw_iron"), iron: countItem(hunter, "minecraft:iron_ingot"),
    rawGold: countItem(hunter, "minecraft:raw_gold"), gold: countItem(hunter, "minecraft:gold_ingot"), diamonds: countItem(hunter, "minecraft:diamond"),
    netheriteScrap: countItem(hunter, "minecraft:netherite_scrap"), netheriteIngot: countItem(hunter, "minecraft:netherite_ingot"),
    arrows: countItem(hunter, "minecraft:arrow"), string: countItem(hunter, "minecraft:string"), flint: countItem(hunter, "minecraft:flint"), obsidian: countItem(hunter, "minecraft:obsidian"),
    blocksMined: numberProperty(hunter, "manhunt:blocks_mined"), recipesCrafted: numberProperty(hunter, "manhunt:recipes_crafted"), itemsProduced: numberProperty(hunter, "manhunt:items_produced"), itemsSmelted: numberProperty(hunter, "manhunt:items_smelted"),
    hasCraftingTable: booleanProperty(hunter, "manhunt:has_crafting_table"), hasFurnace: booleanProperty(hunter, "manhunt:has_furnace"), hasShield: booleanProperty(hunter, "manhunt:has_shield"), hasBow: booleanProperty(hunter, "manhunt:has_bow"),
    fuelCharges: numberProperty(hunter, "manhunt:fuel_charges"), hasWaterBucket: countItem(hunter, "minecraft:water_bucket") > 0, prepComplete: booleanProperty(hunter, "manhunt:prep_complete")
  };
}
