export const VERSION = "2.0.0";

export const HUNTER_ID = "manhunt:hunter";
export const WAYPOINT_ID = "manhunt:path_node";
export const WAYPOINT_IDS = Object.freeze([
  "manhunt:path_node",
  "manhunt:path_node_1",
  "manhunt:path_node_2",
  "manhunt:path_node_3"
]);
export const COMPASS_ID = "manhunt:hunter_compass";

export const SKINS = Object.freeze([
  "Steve",
  "Alex",
  "Zombie",
  "Skeleton",
  "Creeper",
  "Custom",
  "Dream",
  "Technoblade"
]);

export const AI_LEVELS = Object.freeze(["Easy", "Normal", "Expert", "Nightmare"]);
export const WIN_MODES = Object.freeze(["Limited Lives", "Time Limit", "Kill Count", "Infinite", "Race to the Dragon"]);
export const PREP_MODES = Object.freeze(["Hybrid", "Pure Chase", "Aggressive"]);
export const PERFORMANCE_PROFILES = Object.freeze(["Low-End", "Balanced", "Maximum AI"]);
export const RISK_PROFILES = Object.freeze(["Cautious", "Balanced", "Relentless"]);
export const SQUAD_PRESETS = Object.freeze(["Solo", "Balanced Squad", "Pressure Squad"]);
export const HUNTER_ROLES = Object.freeze(["Chaser", "Gatherer", "Builder", "Archer"]);

export const GOALS = Object.freeze({
  IDLE: "idle",
  COUNTDOWN: "countdown",
  FALL_SAVE: "fall_save",
  ESCAPE_LAVA: "escape_lava",
  ESCAPE_WATER: "escape_water",
  ESCAPE_TRAP: "escape_trap",
  RECOVER_STUCK: "recover_stuck",
  RETREAT: "retreat",
  EAT: "eat",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  DEFEND: "defend",
  CRAFT: "craft",
  SMELT: "smelt",
  SHARE_RESOURCES: "share_resources",
  GATHER_WOOD: "gather_wood",
  GATHER_STONE: "gather_stone",
  GATHER_COAL: "gather_coal",
  GATHER_IRON: "gather_iron",
  GATHER_GOLD: "gather_gold",
  GATHER_DIAMOND: "gather_diamond",
  GATHER_DEBRIS: "gather_debris",
  DESTROY_CRYSTALS: "destroy_crystals",
  GATHER_FLINT: "gather_flint",
  GATHER_OBSIDIAN: "gather_obsidian",
  GATHER_FOOD: "gather_food",
  GATHER_BLOCKS: "gather_blocks",
  GATHER_COMBAT_MATERIALS: "gather_combat_materials",
  SEARCH: "search",
  CHASE: "chase",
  VERTICAL_PURSUIT: "vertical_pursuit",
  DESCEND: "descend",
  BREAK_PILLAR: "break_pillar",
  FOLLOW_DIMENSION: "follow_dimension",
  FIND_PORTAL: "find_portal",
  BUILD_PORTAL: "build_portal",
  USE_BOAT: "use_boat"
});

export const DEFAULT_CONFIG = Object.freeze({
  schema: 9,
  hunterName: "Hunter",
  skin: 0,
  aiLevel: 1,
  winMode: 3,
  livesOrKills: 3,
  timeMinutes: 30,
  prepMode: 0,
  gathering: true,
  difficultyScaling: true,
  equipmentPersistence: true,
  taunts: true,
  performanceProfile: 1,
  riskProfile: 1,
  stealthTracking: true,
  humanMistakes: true,
  debugMode: false,
  routeParticles: false,
  cleanupPlacedBlocks: false,
  emergencyRecovery: true,
  destroyBoats: true,
  hunterCount: 1,
  squadPreset: 0,
  portalIntelligence: true,
  advancedMining: true,
  safeBuilding: true,
  netheriteProgression: true,
  endPursuit: true,
  chatPersonality: true
});

export const PROFILE_SETTINGS = Object.freeze([
  Object.freeze({
    brainInterval: 10,
    decisionInterval: 20,
    perceptionInterval: 10,
    resourceScanBudget: 18,
    routeCandidateCount: 3,
    routeLookahead: 3,
    routeNodeBudget: 24,
    resourceRadius: 8,
    maxRememberedResources: 24,
    maxRouteMemory: 64,
    statusWriteInterval: 40,
    squadStagger: 5
  }),
  Object.freeze({
    brainInterval: 5,
    decisionInterval: 10,
    perceptionInterval: 5,
    resourceScanBudget: 38,
    routeCandidateCount: 5,
    routeLookahead: 5,
    routeNodeBudget: 54,
    resourceRadius: 11,
    maxRememberedResources: 56,
    maxRouteMemory: 128,
    statusWriteInterval: 20,
    squadStagger: 3
  }),
  Object.freeze({
    brainInterval: 4,
    decisionInterval: 6,
    perceptionInterval: 4,
    resourceScanBudget: 70,
    routeCandidateCount: 7,
    routeLookahead: 7,
    routeNodeBudget: 96,
    resourceRadius: 14,
    maxRememberedResources: 96,
    maxRouteMemory: 220,
    statusWriteInterval: 20,
    squadStagger: 2
  })
]);

export const LOG_ITEMS = Object.freeze([
  "minecraft:oak_log",
  "minecraft:spruce_log",
  "minecraft:birch_log",
  "minecraft:jungle_log",
  "minecraft:acacia_log",
  "minecraft:dark_oak_log",
  "minecraft:mangrove_log",
  "minecraft:cherry_log",
  "minecraft:crimson_stem",
  "minecraft:warped_stem"
]);

export const PLANK_ITEMS = Object.freeze([
  "minecraft:oak_planks",
  "minecraft:spruce_planks",
  "minecraft:birch_planks",
  "minecraft:jungle_planks",
  "minecraft:acacia_planks",
  "minecraft:dark_oak_planks",
  "minecraft:mangrove_planks",
  "minecraft:cherry_planks",
  "minecraft:crimson_planks",
  "minecraft:warped_planks"
]);

export const STONE_ITEMS = Object.freeze([
  "minecraft:cobblestone",
  "minecraft:cobbled_deepslate"
]);

export const BUILDING_ITEMS = Object.freeze([
  "minecraft:cobblestone",
  "minecraft:cobbled_deepslate",
  "minecraft:dirt",
  "minecraft:netherrack",
  "minecraft:oak_planks",
  "minecraft:spruce_planks",
  "minecraft:birch_planks",
  "minecraft:jungle_planks",
  "minecraft:acacia_planks",
  "minecraft:dark_oak_planks",
  "minecraft:mangrove_planks",
  "minecraft:cherry_planks",
  "minecraft:crimson_planks",
  "minecraft:warped_planks"
]);

export const FOOD_ITEMS = Object.freeze([
  "minecraft:golden_apple",
  "minecraft:cooked_beef",
  "minecraft:cooked_porkchop",
  "minecraft:cooked_mutton",
  "minecraft:cooked_chicken",
  "minecraft:cooked_rabbit",
  "minecraft:baked_potato",
  "minecraft:bread",
  "minecraft:beef",
  "minecraft:porkchop",
  "minecraft:mutton",
  "minecraft:chicken",
  "minecraft:rabbit",
  "minecraft:apple",
  "minecraft:carrot",
  "minecraft:potato",
  "minecraft:sweet_berries",
  "minecraft:melon_slice",
  "minecraft:beetroot"
]);

export const FOOD_HEAL = Object.freeze({
  "minecraft:golden_apple": 12,
  "minecraft:cooked_beef": 8,
  "minecraft:cooked_porkchop": 8,
  "minecraft:cooked_mutton": 6,
  "minecraft:cooked_chicken": 6,
  "minecraft:cooked_rabbit": 5,
  "minecraft:baked_potato": 5,
  "minecraft:bread": 5,
  "minecraft:beef": 3,
  "minecraft:porkchop": 3,
  "minecraft:mutton": 2,
  "minecraft:chicken": 2,
  "minecraft:rabbit": 3,
  "minecraft:apple": 4,
  "minecraft:carrot": 3,
  "minecraft:potato": 2,
  "minecraft:sweet_berries": 2,
  "minecraft:melon_slice": 2,
  "minecraft:beetroot": 2
});

export const RESOURCE_BLOCKS = Object.freeze({
  wood: new Set(LOG_ITEMS),
  stone: new Set([
    "minecraft:stone", "minecraft:cobblestone", "minecraft:deepslate",
    "minecraft:cobbled_deepslate", "minecraft:tuff", "minecraft:andesite",
    "minecraft:diorite", "minecraft:granite", "minecraft:blackstone"
  ]),
  blocks: new Set([
    "minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt",
    "minecraft:rooted_dirt", "minecraft:podzol", "minecraft:mycelium",
    "minecraft:stone", "minecraft:cobblestone", "minecraft:deepslate",
    "minecraft:cobbled_deepslate", "minecraft:tuff", "minecraft:andesite",
    "minecraft:diorite", "minecraft:granite", "minecraft:netherrack",
    "minecraft:blackstone"
  ]),
  coal: new Set(["minecraft:coal_ore", "minecraft:deepslate_coal_ore"]),
  iron: new Set(["minecraft:iron_ore", "minecraft:deepslate_iron_ore", "minecraft:raw_iron_block"]),
  gold: new Set(["minecraft:gold_ore", "minecraft:deepslate_gold_ore", "minecraft:nether_gold_ore", "minecraft:raw_gold_block"]),
  diamond: new Set(["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"]),
  debris: new Set(["minecraft:ancient_debris"]),
  flint: new Set(["minecraft:gravel"]),
  portal: new Set(["minecraft:obsidian", "minecraft:lava"]),
  food: new Set([
    "minecraft:hay_block", "minecraft:melon_block", "minecraft:pumpkin",
    "minecraft:sweet_berry_bush", "minecraft:wheat", "minecraft:carrots",
    "minecraft:potatoes", "minecraft:beetroot"
  ])
});

export const DROP_TABLE = Object.freeze({
  "minecraft:oak_log": ["minecraft:oak_log", 1],
  "minecraft:spruce_log": ["minecraft:spruce_log", 1],
  "minecraft:birch_log": ["minecraft:birch_log", 1],
  "minecraft:jungle_log": ["minecraft:jungle_log", 1],
  "minecraft:acacia_log": ["minecraft:acacia_log", 1],
  "minecraft:dark_oak_log": ["minecraft:dark_oak_log", 1],
  "minecraft:mangrove_log": ["minecraft:mangrove_log", 1],
  "minecraft:cherry_log": ["minecraft:cherry_log", 1],
  "minecraft:crimson_stem": ["minecraft:crimson_stem", 1],
  "minecraft:warped_stem": ["minecraft:warped_stem", 1],
  "minecraft:dirt": ["minecraft:dirt", 1],
  "minecraft:grass_block": ["minecraft:dirt", 1],
  "minecraft:coarse_dirt": ["minecraft:dirt", 1],
  "minecraft:rooted_dirt": ["minecraft:dirt", 1],
  "minecraft:podzol": ["minecraft:dirt", 1],
  "minecraft:mycelium": ["minecraft:dirt", 1],
  "minecraft:netherrack": ["minecraft:netherrack", 1],
  "minecraft:blackstone": ["minecraft:blackstone", 1],
  "minecraft:stone": ["minecraft:cobblestone", 1],
  "minecraft:cobblestone": ["minecraft:cobblestone", 1],
  "minecraft:deepslate": ["minecraft:cobbled_deepslate", 1],
  "minecraft:cobbled_deepslate": ["minecraft:cobbled_deepslate", 1],
  "minecraft:tuff": ["minecraft:tuff", 1],
  "minecraft:andesite": ["minecraft:andesite", 1],
  "minecraft:diorite": ["minecraft:diorite", 1],
  "minecraft:granite": ["minecraft:granite", 1],
  "minecraft:coal_ore": ["minecraft:coal", 1],
  "minecraft:deepslate_coal_ore": ["minecraft:coal", 1],
  "minecraft:iron_ore": ["minecraft:raw_iron", 1],
  "minecraft:deepslate_iron_ore": ["minecraft:raw_iron", 1],
  "minecraft:raw_iron_block": ["minecraft:raw_iron", 9],
  "minecraft:gold_ore": ["minecraft:raw_gold", 1],
  "minecraft:deepslate_gold_ore": ["minecraft:raw_gold", 1],
  "minecraft:nether_gold_ore": ["minecraft:gold_nugget", 3],
  "minecraft:raw_gold_block": ["minecraft:raw_gold", 9],
  "minecraft:diamond_ore": ["minecraft:diamond", 1],
  "minecraft:deepslate_diamond_ore": ["minecraft:diamond", 1],
  "minecraft:ancient_debris": ["minecraft:ancient_debris", 1],
  "minecraft:obsidian": ["minecraft:obsidian", 1],
  "minecraft:cobweb": ["minecraft:string", 1],
  "minecraft:hay_block": ["minecraft:wheat", 9],
  "minecraft:melon_block": ["minecraft:melon_slice", 5],
  "minecraft:pumpkin": ["minecraft:pumpkin", 1],
  "minecraft:sweet_berry_bush": ["minecraft:sweet_berries", 3],
  "minecraft:wheat": ["minecraft:wheat", 1],
  "minecraft:carrots": ["minecraft:carrot", 2],
  "minecraft:potatoes": ["minecraft:potato", 2],
  "minecraft:beetroot": ["minecraft:beetroot", 2]
});

export const BLOCK_HARDNESS = Object.freeze({
  "minecraft:leaves": 4,
  "minecraft:dirt": 8,
  "minecraft:grass_block": 9,
  "minecraft:sand": 7,
  "minecraft:gravel": 8,
  "minecraft:clay": 10,
  "minecraft:cobweb": 14,
  "minecraft:netherrack": 8,
  "minecraft:oak_log": 22,
  "minecraft:spruce_log": 22,
  "minecraft:birch_log": 22,
  "minecraft:jungle_log": 22,
  "minecraft:acacia_log": 22,
  "minecraft:dark_oak_log": 22,
  "minecraft:mangrove_log": 22,
  "minecraft:cherry_log": 22,
  "minecraft:crimson_stem": 22,
  "minecraft:warped_stem": 22,
  "minecraft:stone": 30,
  "minecraft:cobblestone": 34,
  "minecraft:blackstone": 36,
  "minecraft:deepslate": 44,
  "minecraft:cobbled_deepslate": 44,
  "minecraft:coal_ore": 38,
  "minecraft:deepslate_coal_ore": 48,
  "minecraft:iron_ore": 42,
  "minecraft:deepslate_iron_ore": 52,
  "minecraft:gold_ore": 46,
  "minecraft:deepslate_gold_ore": 56,
  "minecraft:diamond_ore": 54,
  "minecraft:deepslate_diamond_ore": 62,
  "minecraft:obsidian": 220,
  "minecraft:ancient_debris": 90
});

export const HAZARD_BLOCKS = new Set([
  "minecraft:lava",
  "minecraft:flowing_lava",
  "minecraft:fire",
  "minecraft:soul_fire",
  "minecraft:magma",
  "minecraft:cactus",
  "minecraft:powder_snow",
  "minecraft:sweet_berry_bush",
  "minecraft:campfire",
  "minecraft:soul_campfire"
]);

export const FALLING_BLOCKS = new Set([
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:gravel",
  "minecraft:concrete_powder"
]);

export const UNBREAKABLE_BLOCKS = new Set([
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:portal",
  "minecraft:command_block",
  "minecraft:repeating_command_block",
  "minecraft:chain_command_block",
  "minecraft:structure_block",
  "minecraft:jigsaw"
]);

export const PICKAXES = Object.freeze([
  undefined,
  "minecraft:wooden_pickaxe",
  "minecraft:stone_pickaxe",
  "minecraft:iron_pickaxe",
  "minecraft:diamond_pickaxe",
  "minecraft:netherite_pickaxe"
]);

export const SWORDS = Object.freeze([
  undefined,
  "minecraft:wooden_sword",
  "minecraft:stone_sword",
  "minecraft:iron_sword",
  "minecraft:diamond_sword",
  "minecraft:netherite_sword"
]);

export const AXES = Object.freeze([
  undefined,
  "minecraft:wooden_axe",
  "minecraft:stone_axe",
  "minecraft:iron_axe",
  "minecraft:diamond_axe",
  "minecraft:netherite_axe"
]);

export const SHOVELS = Object.freeze([
  undefined,
  "minecraft:wooden_shovel",
  "minecraft:stone_shovel",
  "minecraft:iron_shovel",
  "minecraft:diamond_shovel",
  "minecraft:netherite_shovel"
]);

export const ARMOR_ITEMS = Object.freeze({
  head: ["minecraft:iron_helmet", "minecraft:diamond_helmet", "minecraft:netherite_helmet"],
  chest: ["minecraft:iron_chestplate", "minecraft:diamond_chestplate", "minecraft:netherite_chestplate"],
  legs: ["minecraft:iron_leggings", "minecraft:diamond_leggings", "minecraft:netherite_leggings"],
  feet: ["minecraft:iron_boots", "minecraft:diamond_boots", "minecraft:netherite_boots"]
});

export const DIAMOND_ARMOR_COST = Object.freeze({ helmet: 5, chestplate: 8, leggings: 7, boots: 4 });

export const PICK_REQUIREMENTS = Object.freeze({
  "minecraft:stone": 1,
  "minecraft:cobblestone": 1,
  "minecraft:deepslate": 1,
  "minecraft:cobbled_deepslate": 1,
  "minecraft:tuff": 1,
  "minecraft:andesite": 1,
  "minecraft:diorite": 1,
  "minecraft:granite": 1,
  "minecraft:blackstone": 1,
  "minecraft:coal_ore": 1,
  "minecraft:deepslate_coal_ore": 1,
  "minecraft:iron_ore": 2,
  "minecraft:deepslate_iron_ore": 2,
  "minecraft:raw_iron_block": 2,
  "minecraft:gold_ore": 3,
  "minecraft:deepslate_gold_ore": 3,
  "minecraft:raw_gold_block": 3,
  "minecraft:redstone_ore": 3,
  "minecraft:lit_redstone_ore": 3,
  "minecraft:diamond_ore": 3,
  "minecraft:deepslate_diamond_ore": 3,
  "minecraft:emerald_ore": 3,
  "minecraft:obsidian": 4,
  "minecraft:ancient_debris": 4
});

export const PORTAL_FRAME_OFFSETS = Object.freeze([
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 0 },
  { x: 0, y: 2, z: 0 }, { x: 3, y: 2, z: 0 },
  { x: 0, y: 3, z: 0 }, { x: 3, y: 3, z: 0 },
  { x: 0, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }, { x: 2, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }
]);

export const TAUNTS = Object.freeze({
  near: [
    "You are running out of road.",
    "I found your trail.",
    "One mistake is enough.",
    "I am closer than you think."
  ],
  hit: [
    "That one connected.",
    "Keep moving.",
    "You cannot trade hits forever."
  ],
  escape: [
    "That trap only slowed me down.",
    "I learned that route.",
    "You will need a better trap."
  ],
  upgrade: [
    "I upgraded. Your head start is shrinking.",
    "Better tools. Faster hunt.",
    "Preparation complete."
  ]
});

// Chat lines — written like a real player: lowercase, casual, occasionally
// with typos or filler words. More variety per event so the bot never sounds
// like a looping soundboard.
export const CHAT_LINES = Object.freeze({
  greet: Object.freeze([
    "glhf",
    "gl lol",
    "run",
    "already on ur trail",
    "this wont take long",
    "lets go",
    "ready when u are",
    "dont make this boring"
  ]),
  chaseClose: Object.freeze([
    "almost",
    "i can hear u",
    "stop running lol",
    "ur so close",
    "got ur trail",
    "nowhere to go",
    "i see u",
    "come here",
    "u cant outrun me"
  ]),
  lostTrail: Object.freeze([
    "where'd u go",
    "hm",
    "...",
    "sneaky",
    "ok where",
    "u vanished",
    "lost u for a sec",
    "hiding wont help",
    "ill find u"
  ]),
  searching: Object.freeze([
    "i know ur around here",
    "checking caves",
    "come out",
    "u cant hide forever",
    "scanning",
    "where are u",
    "found ur footprints",
    "getting warmer"
  ]),
  gatheringWood: Object.freeze([
    "one sec",
    "punching trees rq",
    "brb wood",
    "need sticks",
    "quick wood run",
    "dont go far"
  ]),
  mining: Object.freeze([
    "mining rq",
    "deepslate is so slow",
    "one sec",
    "stripping a vein",
    "brb",
    "getting resources",
    "almost done"
  ]),
  gotIron: Object.freeze([
    "iron get",
    "iron gear time",
    "full iron soon",
    "ok now we're talking",
    "geared up",
    "iron acquired"
  ]),
  gotDiamond: Object.freeze([
    "DIAMONDS",
    "oh no for u",
    "diamonds letsgo",
    "gg gear",
    "diamonds :)",
    "ur cooked now",
    "shiny"
  ]),
  gotNetherite: Object.freeze([
    "netherite. gg.",
    "maxed out",
    "ancient debris secured",
    "ur actually cooked",
    "netherite diff",
    "gl now lol"
  ]),
  enteringNether: Object.freeze([
    "following u to nether",
    "nether time",
    "see u in hell",
    "portal go brr",
    "nether run lets go",
    "following"
  ]),
  enteringOverworld: Object.freeze([
    "back",
    "overworld again",
    "home turf",
    "back to overworld"
  ]),
  enteringEnd: Object.freeze([
    "end?? bold",
    "following u to the end",
    "dragon race?",
    "end portal found",
    "lets go end"
  ]),
  dragonRace: Object.freeze([
    "first kill wins",
    "race to the dragon",
    "may the best player win lol",
    "dragon race accepted",
    "lets see who gets it"
  ]),
  crystalBreak: Object.freeze([
    "crystal down",
    "nope",
    "not today",
    "denied",
    "bye crystal"
  ]),
  hitRunner: Object.freeze([
    "got u",
    "tag",
    "lol",
    "too slow",
    "there it is",
    "hit",
    "ouch",
    ":)"
  ]),
  tookDamage: Object.freeze([
    "ow",
    "ok noted",
    "lucky",
    "that actually hurt",
    "nice shot",
    "ok ok",
    "fair"
  ]),
  killedByRunner: Object.freeze([
    "gg respawning",
    "enjoy it",
    "ill be back",
    "nice one",
    "ok that was good",
    "respawning lol",
    "gg but im coming back"
  ]),
  lowHealth: Object.freeze([
    "eating rq",
    "backing off",
    "healing",
    "one sec eating",
    "low hp brb",
    "need food"
  ]),
  eating: Object.freeze([
    "nom",
    "eating",
    "food break",
    "one sec",
    "chomping"
  ]),
  foundAfterSearch: Object.freeze([
    "found u",
    "there u are",
    "gotcha",
    "hello :)",
    "hi",
    "peek a boo"
  ]),
  trappedMe: Object.freeze([
    "a trap really",
    "ok clever",
    "who traps a hunter lol",
    "nice try",
    "getting out",
    "trapped lmao"
  ]),
  winDragon: Object.freeze([
    "gg dragon mine",
    "race over",
    "gg",
    "told u"
  ]),
  loseDragon: Object.freeze([
    "gg wp",
    "u earned that",
    "fair race",
    "rematch?",
    "next time"
  ]),
  winKill: Object.freeze([
    "gg",
    "hunt complete",
    "nothing personal",
    "gg ez",
    "got em"
  ]),
  loseDeath: Object.freeze([
    "gg runner wins",
    "u outlasted us",
    "well played",
    "gg wp",
    "u survived gg"
  ]),
  farewell: Object.freeze([
    "gg",
    "good game",
    "rematch?",
    "gg wp",
    "fun game"
  ])
});

export const CHAT_COLORS = Object.freeze({ hunter: "\u00A7c", name: "\u00A7f", system: "\u00A77" });
