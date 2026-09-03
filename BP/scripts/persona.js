import { system } from "@minecraft/server";
import { CHAT_COLORS, CHAT_LINES } from "./constants.js";

// The hunter talks like a real player: short contextual lines, per-event
// cooldowns and a global gap so chat never becomes spam. Every send is
// best-effort; a failure must never break the AI tick.

const GLOBAL_GAP = 20 * 8;
const EVENT_COOLDOWNS = Object.freeze({
  greet: 20 * 600,
  chaseClose: 20 * 25,
  lostTrail: 20 * 45,
  searching: 20 * 60,
  gatheringWood: 20 * 90,
  mining: 20 * 90,
  gotIron: 20 * 300,
  gotDiamond: 20 * 600,
  gotNetherite: 20 * 900,
  enteringNether: 20 * 120,
  enteringOverworld: 20 * 90,
  enteringEnd: 20 * 180,
  dragonRace: 20 * 240,
  crystalBreak: 20 * 30,
  hitRunner: 20 * 14,
  tookDamage: 20 * 40,
  killedByRunner: 20 * 30,
  lowHealth: 20 * 50,
  eating: 20 * 80,
  foundAfterSearch: 20 * 60,
  trappedMe: 20 * 70
});

function pickLine(pool, seed) {
  if (!pool || !pool.length) return undefined;
  const index = Math.abs(Math.trunc(seed)) % pool.length;
  return pool[index];
}

function chatMemory(brain) {
  if (!(brain.chatMemory instanceof Map)) brain.chatMemory = new Map();
  return brain.chatMemory;
}

function eventReady(brain, key, cooldown) {
  const last = chatMemory(brain).get(key) ?? -999999;
  return system.currentTick - last >= cooldown;
}

function markEvent(brain, key) {
  chatMemory(brain).set(key, system.currentTick());
}

function freshBrain(seed = 0) {
  return { squadIndex: seed, chatMemory: new Map(), lastPersonaChatTick: -999999 };
}

export function say(runner, hunterName, key, options = {}) {
  if (!runner || !key) return false;
  const pool = CHAT_LINES[key];
  const line = pickLine(pool, options.seed ?? Math.floor(Math.random() * 9973));
  if (!line) return false;
  try {
    runner.sendMessage(`${CHAT_COLORS.hunter}${hunterName || "Hunter"}${CHAT_COLORS.name}: ${line}`);
    return true;
  } catch {
    return false;
  }
}

export function trySay(brain, runner, hunterName, key, options = {}) {
  if (!brain || !key) return false;
  const cooldown = EVENT_COOLDOWNS[key] ?? 20 * 30;
  if (system.currentTick - (brain.lastPersonaChatTick ?? -999999) < GLOBAL_GAP && !options.force) return false;
  if (!eventReady(brain, key, cooldown)) return false;
  const chance = options.chance ?? 0.55;
  if (!options.force && Math.random() > chance) {
    // A skipped line still consumes the event cooldown so quiet events are not
    // retried every tick until they finally pass the dice roll.
    markEvent(brain, key);
    return false;
  }
  const sent = say(runner, hunterName, key, { seed: system.currentTick + (brain.squadIndex ?? 0) * 7 + key.length });
  brain.lastPersonaChatTick = system.currentTick;
  markEvent(brain, key);
  return sent;
}

export function huntGreet(runner, hunters, config) {
  if (!config?.taunts || config?.chatPersonality === false) return;
  for (const [index, hunter] of (hunters ?? []).entries()) {
    trySay(freshBrain(index), runner, safeName(hunter), "greet", { force: true, seed: index });
  }
}

const GOAL_CHAT = Object.freeze({
  gather_wood: ["gatheringWood", 0.35],
  gather_stone: ["mining", 0.3],
  gather_iron: ["mining", 0.3],
  gather_gold: ["mining", 0.3],
  gather_diamond: ["mining", 0.35],
  gather_debris: ["mining", 0.4],
  search: ["searching", 0.4]
});

export function tickAmbientChat(runner, hunter, brain, config, perception) {
  if (!config?.taunts || config?.chatPersonality === false || !brain || !perception) return;
  if (system.currentTick - (brain.lastPersonaAmbientTick ?? -99999) < 20 * 6) return;
  brain.lastPersonaAmbientTick = system.currentTick;

  const goal = String(brain.currentGoal ?? "");
  const name = safeName(hunter);

  if (perception.sameDimension) {
    if (perception.runnerDistance <= 16 && perception.runnerVisible) {
      trySay(brain, runner, name, "chaseClose", { chance: 0.22 });
      return;
    }
    if (goal === "eat") {
      trySay(brain, runner, name, perception.healthRatio < 0.4 ? "lowHealth" : "eating", { chance: 0.5 });
      return;
    }
    if (goal === "escape_trap") {
      trySay(brain, runner, name, "trappedMe", { chance: 0.6 });
      return;
    }
    if (goal === "search" && Math.random() < 0.5) {
      trySay(brain, runner, name, "lostTrail", { chance: 0.5 });
      return;
    }
  }

  const mapped = GOAL_CHAT[goal];
  if (mapped) trySay(brain, runner, name, mapped[0], { chance: mapped[1] });
}

export function notifyHitRunner(runner, hunter, brain) {
  trySay(brain, runner, safeName(hunter), "hitRunner", { chance: 0.3 });
}

export function notifyTookDamage(runner, hunter, brain) {
  trySay(brain, runner, safeName(hunter), "tookDamage", { chance: 0.2 });
}

export function notifyKilledByRunner(runner, hunter, brain) {
  trySay(brain, runner, safeName(hunter), "killedByRunner", { force: true });
}

export function notifyCraftMilestone(runner, hunter, brain, plan) {
  if (!plan) return;
  const label = String(plan);
  let key;
  if (label.includes("netherite")) key = "gotNetherite";
  else if (label.includes("diamond")) key = "gotDiamond";
  else if (label.startsWith("craft an iron") || label.startsWith("craft iron")) key = "gotIron";
  if (!key) return;
  trySay(brain, runner, safeName(hunter), key, { chance: 0.7 });
}

export function notifyDimensionEnter(runner, hunter, brain, dimensionId) {
  const canonical = String(dimensionId ?? "").replace("minecraft:", "");
  const key = canonical === "nether" ? "enteringNether"
    : canonical === "the_end" ? "enteringEnd"
      : canonical === "overworld" ? "enteringOverworld"
        : undefined;
  if (!key) return;
  trySay(brain, runner, safeName(hunter), key, { chance: 0.75 });
}

export function notifyDragonRaceStart(runner, hunters) {
  for (const [index, hunter] of (hunters ?? []).entries()) {
    trySay(freshBrain(index + 3), runner, safeName(hunter), "dragonRace", { force: true, seed: index + 3 });
  }
}

export function notifyCrystalBreak(runner, hunter, brain) {
  trySay(brain, runner, safeName(hunter), "crystalBreak", { chance: 0.4 });
}

export function notifyHuntEnd(runner, outcome, hunterNames = []) {
  const name = hunterNames[0] ?? "Hunter";
  const key = outcome === "hunters_win_dragon" ? "winDragon"
    : outcome === "runner_wins_dragon" ? "loseDragon"
      : outcome === "hunters_win_kill" ? "winKill"
        : outcome === "runner_survives" ? "loseDeath"
          : "farewell";
  trySay(freshBrain(0), runner, name, key, { force: true });
}

function safeName(hunter) {
  try { return hunter?.nameTag || "Hunter"; } catch { return "Hunter"; }
}
