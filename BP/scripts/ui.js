import { system } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import {
  AI_LEVELS,
  PERFORMANCE_PROFILES,
  PREP_MODES,
  RISK_PROFILES,
  SKINS,
  SQUAD_PRESETS,
  VERSION,
  WIN_MODES
} from "./constants.js";
import {
  ensureCompass,
  exportDebugReport,
  forceHunterReplan,
  getStatusText,
  giveHunterTestResources,
  resetHunterForTesting,
  resetHunterRouteMemory,
  startHunt,
  stopHunt,
  teleportHunterForTesting,
  toggleHunterPause
} from "./hunt.js";
import {
  getConfig,
  getHunters,
  isHuntActive,
  isStateReady,
  resetConfig,
  saveConfig
} from "./state.js";
import {
  cleanName,
  finiteInteger,
  safeIndex,
  steppedInteger
} from "./utils.js";

function openSoon(player, callback, ...args) {
  system.runTimeout(() => {
    try {
      const result = callback(player, ...args);
      if (result && typeof result.catch === "function") result.catch((error) => console.warn(`[Manhunt AI Bot] UI error: ${error}`));
    } catch (error) {
      console.warn(`[Manhunt AI Bot] UI error: ${error}`);
    }
  }, 1);
}

async function showForm(form, player) {
  try { return await form.show(player); }
  catch (error) {
    console.warn(`[Manhunt AI Bot] Form could not be shown: ${error}`);
    return undefined;
  }
}

function controlValues(response) {
  if (!response || response.canceled || !Array.isArray(response.formValues)) return undefined;
  // server-ui 2.x inserts undefined for labels, headers and dividers.
  return response.formValues.filter((value) => value !== undefined);
}

function winValue(config) {
  if (config.winMode === 0) return `${config.livesOrKills} team lives`;
  if (config.winMode === 1) return `${config.timeMinutes} minutes`;
  if (config.winMode === 2) return `${config.livesOrKills} kills`;
  if (config.winMode === 4) return "first dragon kill wins";
  return "∞ unlimited lives";
}

function setupText(config) {
  return [
    `§cHunter §8- §f${config.hunterName} × ${config.hunterCount}`,
    `§dSquad §8- §f${SQUAD_PRESETS[config.squadPreset]}`,
    `§6AI §8- §f${AI_LEVELS[config.aiLevel]} / ${RISK_PROFILES[config.riskProfile]}`,
    `§eMode §8- §f${WIN_MODES[config.winMode]} (${winValue(config)})`,
    `§aPreparation §8- §f${PREP_MODES[config.prepMode]}`,
    `§bPerformance §8- §f${PERFORMANCE_PROFILES[config.performanceProfile]}`,
    `§2Progression §8- ${config.gathering ? "§aEnabled" : "§cDisabled"} §8(§7netherite ${config.netheriteProgression ? "on" : "off"}§8)`,
    `§5Dimensions §8- ${config.portalIntelligence ? "§aNether" : "§cNether off"} §8| §dEnd pursuit ${config.endPursuit ? "§aOn" : "§cOff"}`,
    `§3Safe building §8- ${config.safeBuilding ? "§aEnabled" : "§cDisabled"}`
  ].join("\n");
}

export async function showMainMenu(player) {
  if (!isStateReady()) {
    player.sendMessage("§eManhunt AI Bot is initializing. Reopen the compass in one second.");
    return;
  }
  const active = isHuntActive();
  const config = getConfig();
  const form = new ActionFormData()
    .title(`§l§4MANHUNT AI BOT §r§8v${VERSION}`)
    .header(active ? "§cACTIVE ADAPTIVE HUNT" : "§6REAL-AI HUNT SETUP")
    .label(active ? getStatusText() : setupText(config))
    .divider();

  if (active) {
    form
      .button("§6Live AI Dashboard\n§7Goals, plans, memory and inventory")
      .button("§dDeveloper Tools\n§7Replan, reset, teleport and diagnostics")
      .button("§cStop Hunt")
      .button(`§7How v${VERSION} Works`);
  } else {
    form
      .button("§l§cSTART HUNT\n§r§710-second head start", "textures/items/hunter_compass")
      .button("§6Hunter and Squad\n§7Name, skins, count, roles and skill")
      .button("§eHunt Rules\n§7Victory mode and preparation")
      .button("§aAI and Survival\n§7Mining, crafting, portals and recovery")
      .button("§bPerformance and Debug\n§7Work budget, route markers and errors")
      .button("§4Reset All Settings")
      .button("§dGive Hunter Compass")
      .button(`§7How v${VERSION} Works`);
  }

  const response = await showForm(form, player);
  if (!response || response.canceled) return;
  if (active) {
    if (response.selection === 0) openSoon(player, showStatus);
    if (response.selection === 1) openSoon(player, showDeveloperTools);
    if (response.selection === 2) openSoon(player, confirmStop);
    if (response.selection === 3) openSoon(player, showHelp);
    return;
  }

  if (response.selection === 0) startHunt(player);
  if (response.selection === 1) openSoon(player, showHunterSquadSettings);
  if (response.selection === 2) openSoon(player, showRulesSettings);
  if (response.selection === 3) openSoon(player, showIntelligenceSettings);
  if (response.selection === 4) openSoon(player, showPerformanceSettings);
  if (response.selection === 5) openSoon(player, confirmResetSettings);
  if (response.selection === 6) {
    ensureCompass(player);
    player.sendMessage("§aHunter Compass added.");
  }
  if (response.selection === 7) openSoon(player, showHelp);
}

async function showHunterSquadSettings(player) {
  const config = getConfig();
  const form = new ModalFormData()
    .title("§l§6HUNTER AND SQUAD")
    .header("§cIdentity")
    .textField("Base hunter name", "Hunter", { defaultValue: config.hunterName })
    .dropdown("Primary skin", SKINS, { defaultValueIndex: safeIndex(config.skin, SKINS, 0) })
    .slider("Hunter count", 1, 4, { valueStep: 1, defaultValue: finiteInteger(config.hunterCount, 1, 4, 1) })
    .dropdown("Squad strategy", SQUAD_PRESETS, { defaultValueIndex: safeIndex(config.squadPreset, SQUAD_PRESETS, 0) })
    .divider()
    .header("§6Decision Style")
    .dropdown("AI skill", AI_LEVELS, { defaultValueIndex: safeIndex(config.aiLevel, AI_LEVELS, 1) })
    .dropdown("Risk profile", RISK_PROFILES, { defaultValueIndex: safeIndex(config.riskProfile, RISK_PROFILES, 1) })
    .toggle("Human-like imperfect choices", { defaultValue: config.humanMistakes })
    .label("§7Balanced Squad assigns Chaser, Gatherer, Builder and Archer. Pressure Squad assigns two Chasers before Builder and Archer. Shared perception prevents four separate full world scans.")
    .submitButton("Save Squad");

  const values = controlValues(await showForm(form, player));
  if (values && values.length >= 7) {
    const saved = saveConfig({
      hunterName: cleanName(values[0], config.hunterName),
      skin: safeIndex(values[1], SKINS, config.skin),
      hunterCount: finiteInteger(values[2], 1, 4, config.hunterCount),
      squadPreset: safeIndex(values[3], SQUAD_PRESETS, config.squadPreset),
      aiLevel: safeIndex(values[4], AI_LEVELS, config.aiLevel),
      riskProfile: safeIndex(values[5], RISK_PROFILES, config.riskProfile),
      humanMistakes: values[6] === true
    });
    player.sendMessage(`§aSaved: §f${saved.hunterName} × ${saved.hunterCount} §7| ${SQUAD_PRESETS[saved.squadPreset]} | ${AI_LEVELS[saved.aiLevel]}`);
  }
  openSoon(player, showMainMenu);
}

async function showRulesSettings(player) {
  const config = getConfig();
  const form = new ModalFormData()
    .title("§l§eHUNT RULES")
    .header("§6Victory")
    .dropdown("Win condition", WIN_MODES, { defaultValueIndex: safeIndex(config.winMode, WIN_MODES, 3) })
    .slider("Team lives / required kills", 1, 40, { valueStep: 1, defaultValue: finiteInteger(config.livesOrKills, 1, 40, 3) })
    .slider("Time limit in minutes", 5, 240, { valueStep: 5, defaultValue: steppedInteger(config.timeMinutes, 5, 240, 5, 30) })
    .label("§8Infinite ignores the lives slider and every hunter respawns independently. With multiple hunters, Limited Lives counts total squad deaths. §dRace to the Dragon§8: the first side to slay the Ender Dragon wins; hunters follow through the End and sabotage your fight.")
    .divider()
    .header("§aPreparation")
    .dropdown("Preparation behavior", PREP_MODES, { defaultValueIndex: safeIndex(config.prepMode, PREP_MODES, 0) })
    .toggle("Keep inventory and progression after death", { defaultValue: config.equipmentPersistence })
    .toggle("Time/death difficulty progression", { defaultValue: config.difficultyScaling })
    .submitButton("Save Rules");

  const values = controlValues(await showForm(form, player));
  if (values && values.length >= 6) {
    const saved = saveConfig({
      winMode: safeIndex(values[0], WIN_MODES, config.winMode),
      livesOrKills: finiteInteger(values[1], 1, 40, config.livesOrKills),
      timeMinutes: steppedInteger(values[2], 5, 240, 5, config.timeMinutes),
      prepMode: safeIndex(values[3], PREP_MODES, config.prepMode),
      equipmentPersistence: values[4] === true,
      difficultyScaling: values[5] === true
    });
    player.sendMessage(`§aRules saved: §f${WIN_MODES[saved.winMode]} §7| ${PREP_MODES[saved.prepMode]}`);
  }
  openSoon(player, showMainMenu);
}

async function showIntelligenceSettings(player) {
  const config = getConfig();
  const form = new ModalFormData()
    .title("§l§aAI AND SURVIVAL")
    .header("§2Progression")
    .toggle("Gather, craft, smelt and upgrade", { defaultValue: config.gathering })
    .toggle("Advanced tool-aware mining", { defaultValue: config.advancedMining })
    .toggle("Netherite progression (ancient debris to full gear)", { defaultValue: config.netheriteProgression })
    .toggle("Safe plan-owned block placement", { defaultValue: config.safeBuilding })
    .toggle("Portal memory and construction", { defaultValue: config.portalIntelligence })
    .toggle("End pursuit (stronghold sense, end portals, dragon race)", { defaultValue: config.endPursuit })
    .divider()
    .header("§bTracking and Recovery")
    .toggle("Sneaking can break distant exact tracking", { defaultValue: config.stealthTracking })
    .toggle("Emergency recovery after long failure", { defaultValue: config.emergencyRecovery })
    .toggle("Clean hunter-built route blocks at hunt end", { defaultValue: config.cleanupPlacedBlocks })
    .toggle("Counter boats during pursuit", { defaultValue: config.destroyBoats })
    .divider()
    .header("§6Personality")
    .toggle("Event-based hunter taunts", { defaultValue: config.taunts })
    .toggle("Player-style chat lines (greetings, milestones, banter)", { defaultValue: config.chatPersonality })
    .label("§7Every break/place action must belong to an active plan. Mining respects tool tiers, avoids falling blocks and lava, and preserves iron for pickaxe, shield and bucket before optional armor. Netherite progression mines ancient debris in the Nether once the diamond pickaxe exists.")
    .submitButton("Save Intelligence");

  const values = controlValues(await showForm(form, player));
  if (values && values.length >= 12) {
    const saved = saveConfig({
      gathering: values[0] === true,
      advancedMining: values[1] === true,
      netheriteProgression: values[2] === true,
      safeBuilding: values[3] === true,
      portalIntelligence: values[4] === true,
      endPursuit: values[5] === true,
      stealthTracking: values[6] === true,
      emergencyRecovery: values[7] === true,
      cleanupPlacedBlocks: values[8] === true,
      destroyBoats: values[9] === true,
      taunts: values[10] === true,
      chatPersonality: values[11] === true
    });
    player.sendMessage(`§aIntelligence saved. Safe building: ${saved.safeBuilding ? "§aEnabled" : "§cDisabled"} §7| Portals: ${saved.portalIntelligence ? "§aEnabled" : "§cDisabled"} §7| End pursuit: ${saved.endPursuit ? "§aEnabled" : "§cDisabled"}`);
  }
  openSoon(player, showMainMenu);
}

async function showPerformanceSettings(player) {
  const config = getConfig();
  const form = new ModalFormData()
    .title("§l§bPERFORMANCE AND DEBUG")
    .dropdown("Performance profile", PERFORMANCE_PROFILES, { defaultValueIndex: safeIndex(config.performanceProfile, PERFORMANCE_PROFILES, 1) })
    .toggle("AI debug dashboard and action bar", { defaultValue: config.debugMode })
    .toggle("Show route particles", { defaultValue: config.routeParticles })
    .label("§7Low-End uses smaller scan and route budgets. Balanced is recommended. Maximum AI evaluates more alternatives. All profiles keep the same survival rules and placement safety.")
    .label("§8Route particles are developer-only and may reduce FPS on mobile.")
    .submitButton("Save Performance");

  const values = controlValues(await showForm(form, player));
  if (values && values.length >= 3) {
    const saved = saveConfig({
      performanceProfile: safeIndex(values[0], PERFORMANCE_PROFILES, config.performanceProfile),
      debugMode: values[1] === true,
      routeParticles: values[2] === true
    });
    player.sendMessage(`§aPerformance saved: §f${PERFORMANCE_PROFILES[saved.performanceProfile]} §7| route particles ${saved.routeParticles ? "on" : "off"}`);
  }
  openSoon(player, showMainMenu);
}

async function showStatus(player) {
  const form = new ActionFormData()
    .title("§l§6LIVE AI DASHBOARD")
    .header("§cObserve → Remember → Plan → Act → Verify")
    .label(getStatusText())
    .divider()
    .button("§6Refresh")
    .button("§dDeveloper Tools")
    .button("§7Back");
  const response = await showForm(form, player);
  if (!response || response.canceled) return;
  if (response.selection === 0) openSoon(player, showStatus);
  if (response.selection === 1) openSoon(player, showDeveloperTools);
  if (response.selection === 2) openSoon(player, showMainMenu);
}

function hunterChoices() {
  const hunters = getHunters()
    .sort((a, b) => Number(a.getDynamicProperty("manhunt:squad_index") ?? 0) - Number(b.getDynamicProperty("manhunt:squad_index") ?? 0));
  if (!hunters.length) return [{ label: "Hunter 1", squadIndex: 0 }];
  return hunters.map((hunter, order) => {
    const squadIndex = finiteInteger(hunter.getDynamicProperty("manhunt:squad_index"), 0, 3, order);
    return { label: hunter.nameTag || `Hunter ${squadIndex + 1}`, squadIndex };
  });
}

async function selectDeveloperHunter(player, action) {
  const choices = hunterChoices();
  const form = new ModalFormData()
    .title("§l§dSELECT HUNTER")
    .dropdown("Target hunter", choices.map((entry) => entry.label), { defaultValueIndex: 0 })
    .submitButton("Continue");
  const values = controlValues(await showForm(form, player));
  if (!values) return;
  const selectedPosition = finiteInteger(values[0], 0, Math.max(0, choices.length - 1), 0);
  action(player, choices[selectedPosition]?.squadIndex ?? 0);
  openSoon(player, showDeveloperTools);
}

async function showDeveloperTools(player) {
  const active = isHuntActive();
  const form = new ActionFormData()
    .title("§l§dDEVELOPER TOOLS")
    .header(active ? "§aRuntime controls" : "§eStart a hunt to use hunter controls")
    .label("§7These tools are intended for testing route plans, crafting progression and failure recovery. They never edit world files outside the active addon state.")
    .divider()
    .button("§6Force Replan\n§7Abandon active route and choose another")
    .button("§bReset Route Memory\n§7Clear falls, failed pillars and blacklists")
    .button("§cReset Hunter\n§7Empty inventory and progression")
    .button("§aTeleport Hunter for Test\n§7Place near you at a safe point")
    .button("§eGive Test Resources\n§7Wood, blocks, iron, food and portal items")
    .button("§5Pause / Resume Hunter AI")
    .button("§dExport Debug Report to Chat")
    .button("§7Back");
  const response = await showForm(form, player);
  if (!response || response.canceled) return;
  if (!active && response.selection < 6) {
    player.sendMessage("§eStart a hunt before using hunter-specific developer controls.");
    openSoon(player, showMainMenu);
    return;
  }
  if (response.selection === 0) openSoon(player, selectDeveloperHunter, forceHunterReplan);
  if (response.selection === 1) openSoon(player, selectDeveloperHunter, resetHunterRouteMemory);
  if (response.selection === 2) openSoon(player, selectDeveloperHunter, resetHunterForTesting);
  if (response.selection === 3) openSoon(player, selectDeveloperHunter, teleportHunterForTesting);
  if (response.selection === 4) openSoon(player, selectDeveloperHunter, giveHunterTestResources);
  if (response.selection === 5) openSoon(player, selectDeveloperHunter, toggleHunterPause);
  if (response.selection === 6) {
    exportDebugReport(player);
    openSoon(player, showDeveloperTools);
  }
  if (response.selection === 7) openSoon(player, showMainMenu);
}

async function confirmStop(player) {
  const form = new MessageFormData()
    .title("Stop Manhunt?")
    .body("This removes every active hunter, route node and current hunt state.")
    .button1("Stop Hunt")
    .button2("Cancel");
  const response = await showForm(form, player);
  if (!response || response.canceled) return;
  if (response.selection === 0) stopHunt(player);
  else openSoon(player, showMainMenu);
}

async function confirmResetSettings(player) {
  const form = new MessageFormData()
    .title("Reset all settings?")
    .body(`This restores the current v${VERSION} default configuration. Active hunts are not changed until restarted.`)
    .button1("Reset Settings")
    .button2("Cancel");
  const response = await showForm(form, player);
  if (!response || response.canceled) return;
  if (response.selection === 0) {
    const saved = resetConfig();
    player.sendMessage(`§aSettings reset. Default mode: ${WIN_MODES[saved.winMode]}, ${saved.hunterCount} hunter.`);
  }
  openSoon(player, showMainMenu);
}

async function showHelp(player) {
  const form = new ActionFormData()
    .title(`§l§4MANHUNT AI BOT v${VERSION}`)
    .header("§6One coordinated brain")
    .label("§7Every hunter observes the world, remembers failures and successful paths, scores goals, creates a concrete action plan, performs one verified step, then checks whether it worked. Advanced-action errors fall back to native chase instead of shutting the AI down.")
    .divider()
    .header("§bRoute memory and vertical pursuit")
    .label("§7The hunter remembers falls, failed pillars, water traps and its own bridges. Vertical priority is natural terrain, existing routes, diagonal stairs, spiral stairs, pillar breaking, then an offset pillar as a last resort. It calculates the required block reserve before climbing.")
    .divider()
    .header("§2Mining and crafting")
    .label("§7Logs become planks, planks become table and sticks, then tools. Valuable ores require the correct pickaxe. The planner reserves iron for pickaxe, shield and bucket before optional armor. It can craft bow, arrows, boat, flint and steel, cooked food and golden apples.")
    .divider()
    .header("§cCombat and anti-cheese")
    .label("§7Combat uses native melee pursuit with line-of-sight checks, axe against shields, timed shield windows, healing retreats, hazard sidesteps and bow shots. Towering, tunnels, bridges, boats, trees, cobwebs, cliffs and dimension changes each trigger a specific counter-plan.")
    .divider()
    .header("§5Portals, squads and the End")
    .label("§7Hunters share runner, resource, bridge, danger and portal memory. A hunter uses remembered portals and can construct an obsidian frame when resources are available. In End pursuit mode the squad retraces your overworld trail toward strongholds, uses real end portals and destroys placed end crystals mid-fight.")
    .divider()
    .header("§dNetherite and personality")
    .label("§7With a diamond pickaxe the squad mines ancient debris in the Nether, smelts scrap, forges ingots and reforges tools and armor to netherite. Hunters also talk like players: contextual greetings, milestone callouts and banter, all cooldown-gated so chat stays natural.")
    .button("§7Back");
  await showForm(form, player);
  openSoon(player, showMainMenu);
}
