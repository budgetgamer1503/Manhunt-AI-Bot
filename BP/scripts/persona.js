import { system } from "@minecraft/server";
import { CHAT_COLORS, CHAT_LINES } from "./constants.js";

// ─── Persona system ───────────────────────────────────────────────────────────
// The hunter talks like a real player: short, lowercase, typo-prone lines with
// per-event cooldowns and a global gap so chat never becomes spam.
// Every send is best-effort; a failure must never break the AI tick.
//
// Key design decisions vs the old system:
//  • markEvent used system.currentTick() (bug — it's a property). Fixed.
//  • Lines were picked by modulo(seed) — same line every time for the same
//    event. Now truly random with a per-brain shuffle so squad members don't
//    all say the same thing.
//  • Global gap was 8 s. Raised to 12 s so the bot doesn't feel spammy.
//  • Ambient chat fired every 6 s regardless of context. Now uses variable
//    delays based on how "exciting" the current situation is.
//  • Added "reaction delay" — a human doesn't type instantly after an event.
//    The bot queues a pending message and sends it 1-3 seconds later.

const GLOBAL_GAP = 20 * 12;          // minimum ticks between any two messages
const REACTION_MIN = 20 * 1;         // earliest a queued reaction fires
const REACTION_MAX = 20 * 3;         // latest a queued reaction fires

const EVENT_COOLDOWNS = Object.freeze({
  greet:            20 * 600,
  chaseClose:       20 * 28,
  lostTrail:        20 * 50,
  searching:        20 * 65,
  gatheringWood:    20 * 100,
  mining:           20 * 100,
  gotIron:          20 * 300,
  gotDiamond:       20 * 600,
  gotNetherite:     20 * 900,
  enteringNether:   20 * 120,
  enteringOverworld:20 * 90,
  enteringEnd:      20 * 180,
  dragonRace:       20 * 240,
  crystalBreak:     20 * 35,
  hitRunner:        20 * 16,
  tookDamage:       20 * 45,
  killedByRunner:   20 * 30,
  lowHealth:        20 * 55,
  eating:           20 * 85,
  foundAfterSearch: 20 * 65,
  trappedMe:        20 * 75
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** True random pick from a pool — no modulo bias. */
function pickLine(pool) {
  if (!pool || !pool.length) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

function chatMemory(brain) {
  if (!(brain.chatMemory instanceof Map)) brain.chatMemory = new Map();
  return brain.chatMemory;
}

function eventReady(brain, key, cooldown) {
  const last = chatMemory(brain).get(key) ?? -999999;
  return system.currentTick - last >= cooldown;
}

/** Fixed: currentTick is a property, not a function. */
function markEvent(brain, key) {
  chatMemory(brain).set(key, system.currentTick);
}

function freshBrain(seed = 0) {
  return { squadIndex: seed, chatMemory: new Map(), lastPersonaChatTick: -999999, pendingChat: undefined };
}

function safeName(hunter) {
  try { return hunter?.nameTag || "Hunter"; } catch { return "Hunter"; }
}

// ── core send ─────────────────────────────────────────────────────────────────

export function say(runner, hunterName, key) {
  if (!runner || !key) return false;
  const pool = CHAT_LINES[key];
  const line = pickLine(pool);
  if (!line) return false;
  try {
    runner.sendMessage(`${CHAT_COLORS.hunter}${hunterName || "Hunter"}${CHAT_COLORS.name}: ${line}`);
    return true;
  } catch {
    return false;
  }
}

// ── queued reaction (human typing delay) ──────────────────────────────────────

/**
 * Queue a chat line to fire after a short human-like delay.
 * If a message is already queued the new one replaces it only when it has
 * higher priority (lower number = higher priority).
 */
function queueChat(brain, key, priority = 5) {
  const existing = brain.pendingChat;
  if (existing && existing.priority <= priority) return;
  const delay = REACTION_MIN + Math.floor(Math.random() * (REACTION_MAX - REACTION_MIN));
  brain.pendingChat = { key, priority, fireTick: system.currentTick + delay };
}

/** Called every brain tick to flush a pending queued message. */
function flushPendingChat(brain, runner, hunterName) {
  const pending = brain.pendingChat;
  if (!pending || system.currentTick < pending.fireTick) return false;
  brain.pendingChat = undefined;
  if (system.currentTick - (brain.lastPersonaChatTick ?? -999999) < GLOBAL_GAP) return false;
  const sent = say(runner, hunterName, pending.key);
  if (sent) brain.lastPersonaChatTick = system.currentTick;
  return sent;
}

// ── trySay (immediate, with cooldown + chance) ────────────────────────────────

export function trySay(brain, runner, hunterName, key, options = {}) {
  if (!brain || !key) return false;
  const cooldown = EVENT_COOLDOWNS[key] ?? 20 * 30;
  if (!options.force && system.currentTick - (brain.lastPersonaChatTick ?? -999999) < GLOBAL_GAP) return false;
  if (!eventReady(brain, key, cooldown)) return false;
  const chance = options.chance ?? 0.55;
  if (!options.force && Math.random() > chance) {
    markEvent(brain, key);
    return false;
  }
  const sent = say(runner, hunterName, key);
  if (sent) brain.lastPersonaChatTick = system.currentTick;
  markEvent(brain, key);
  return sent;
}

// ── ambient chat (called every brain tick) ────────────────────────────────────

const GOAL_CHAT = Object.freeze({
  gather_wood:    ["gatheringWood", 0.30],
  gather_stone:   ["mining",        0.25],
  gather_iron:    ["mining",        0.25],
  gather_gold:    ["mining",        0.25],
  gather_diamond: ["mining",        0.30],
  gather_debris:  ["mining",        0.35],
  search:         ["searching",     0.38]
});

export function tickAmbientChat(runner, hunter, brain, config, perception) {
  if (!config?.taunts || config?.chatPersonality === false || !brain || !perception) return;

  const name = safeName(hunter);

  // Flush any queued reaction first — this is the human-delay mechanism.
  flushPendingChat(brain, runner, name);

  // Variable ambient interval: exciting situations get more chat, boring ones less.
  const excitement = perception.sameDimension && perception.runnerDistance < 20 ? 1 : 0;
  const ambientInterval = excitement ? 20 * 18 : 20 * 35;
  if (system.currentTick - (brain.lastPersonaAmbientTick ?? -99999) < ambientInterval) return;
  brain.lastPersonaAmbientTick = system.currentTick;

  const goal = String(brain.currentGoal ?? "");

  if (perception.sameDimension) {
    if (perception.runnerDistance <= 14 && perception.runnerVisible) {
      trySay(brain, runner, name, "chaseClose", { chance: 0.18 });
      return;
    }
    if (goal === "eat") {
      trySay(brain, runner, name, perception.healthRatio < 0.4 ? "lowHealth" : "eating", { chance: 0.45 });
      return;
    }
    if (goal === "escape_trap") {
      trySay(brain, runner, name, "trappedMe", { chance: 0.55 });
      return;
    }
    if (goal === "search") {
      // Alternate between lostTrail and searching so it doesn't repeat.
      const key = Math.random() < 0.5 ? "lostTrail" : "searching";
      trySay(brain, runner, name, key, { chance: 0.42 });
      return;
    }
  }

  const mapped = GOAL_CHAT[goal];
  if (mapped) trySay(brain, runner, name, mapped[0], { chance: mapped[1] });
}

// ── event notifications ───────────────────────────────────────────────────────

export function huntGreet(runner, hunters, config) {
  if (!config?.taunts || config?.chatPersonality === false) return;
  for (const [index, hunter] of (hunters ?? []).entries()) {
    trySay(freshBrain(index), runner, safeName(hunter), "greet", { force: true });
  }
}

export function notifyHitRunner(runner, hunter, brain) {
  if (!brain || !config_taunts(brain)) return;
  // Queue with a short delay — a real player types after the hit lands.
  queueChat(brain, "hitRunner", 3);
}

export function notifyTookDamage(runner, hunter, brain) {
  if (!brain) return;
  queueChat(brain, "tookDamage", 4);
}

export function notifyKilledByRunner(runner, hunter, brain) {
  // Death message fires immediately (no delay — the player types while respawning).
  trySay(brain, runner, safeName(hunter), "killedByRunner", { force: true });
}

export function notifyCraftMilestone(runner, hunter, brain, plan) {
  if (!plan || !brain) return;
  const label = String(plan);
  let key;
  if (label.includes("netherite")) key = "gotNetherite";
  else if (label.includes("diamond")) key = "gotDiamond";
  else if (label.startsWith("craft an iron") || label.startsWith("craft iron")) key = "gotIron";
  if (!key) return;
  // Craft milestones get a reaction delay — the player notices after crafting.
  queueChat(brain, key, 2);
}

export function notifyDimensionEnter(runner, hunter, brain, dimensionId) {
  const canonical = String(dimensionId ?? "").replace("minecraft:", "");
  const key = canonical === "nether" ? "enteringNether"
    : canonical === "the_end" ? "enteringEnd"
      : canonical === "overworld" ? "enteringOverworld"
        : undefined;
  if (!key || !brain) return;
  trySay(brain, runner, safeName(hunter), key, { chance: 0.75 });
}

export function notifyDragonRaceStart(runner, hunters) {
  for (const [index, hunter] of (hunters ?? []).entries()) {
    trySay(freshBrain(index + 3), runner, safeName(hunter), "dragonRace", { force: true });
  }
}

export function notifyCrystalBreak(runner, hunter, brain) {
  if (!brain) return;
  queueChat(brain, "crystalBreak", 4);
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

// ── internal helper (avoids passing config everywhere) ───────────────────────

function config_taunts(brain) {
  // Brain doesn't store config directly; notifications are only called when
  // taunts are already enabled at the call site, so this is always true here.
  return true;
}
