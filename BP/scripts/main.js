import { system, world } from "@minecraft/server";
import { COMPASS_ID, HUNTER_ID, VERSION, WAYPOINT_IDS } from "./constants.js";
import {
  ensureCompass,
  handleEntityDeath,
  handleEntityHurt,
  initializeHuntRuntime,
  tickHunt
} from "./hunt.js";
import { initializeState, isStateReady, migrateLegacyPlayerConfig } from "./state.js";
import { showMainMenu } from "./ui.js";

let runtimeReady = false;
let initializationQueued = false;
let announcedLoad = false;

function initializeRuntime() {
  if (runtimeReady || initializationQueued) return;
  initializationQueued = true;
  system.run(() => {
    initializationQueued = false;
    if (runtimeReady) return;
    try {
      initializeState();
      initializeHuntRuntime();
      runtimeReady = true;
      for (const player of world.getPlayers()) {
        try { migrateLegacyPlayerConfig(player); } catch {}
        try { ensureCompass(player); } catch {}
      }
      if (!announcedLoad) {
        announcedLoad = true;
        console.warn(`[Manhunt AI Bot] Behavior Pack v${VERSION} loaded.`);
      }
    } catch (error) {
      console.warn(`[Manhunt AI Bot] Initialization deferred: ${error}`);
      system.runTimeout(initializeRuntime, 20);
    }
  });
}

// Event subscriptions are valid during early execution. World-state work is deferred.
try {
  world.afterEvents.worldLoad.subscribe(() => initializeRuntime());
} catch {
  // The one-tick fallback below covers runtimes where the event is unavailable.
}

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack?.typeId !== COMPASS_ID) return;
  system.run(() => {
    if (!runtimeReady || !isStateReady()) {
      initializeRuntime();
      try { event.source.sendMessage("§eManhunt AI Bot is initializing. Use the compass again in one second."); } catch {}
      return;
    }
    showMainMenu(event.source).catch((error) => console.warn(`[Manhunt AI Bot] Menu error: ${error}`));
  });
});

world.afterEvents.playerSpawn.subscribe((event) => {
  system.runTimeout(() => {
    if (!runtimeReady) initializeRuntime();
    if (!runtimeReady || !isStateReady()) return;
    try { migrateLegacyPlayerConfig(event.player); } catch {}
    try { ensureCompass(event.player); } catch {}
    if (event.initialSpawn) {
      try { event.player.sendMessage(`§eManhunt AI Bot v${VERSION} loaded. Use the Hunter Compass.`); } catch {}
    }
  }, 20);
});

world.afterEvents.entityDie.subscribe((event) => {
  if (!runtimeReady) return;
  // Read death-event entities before the engine invalidates them on a later tick.
  try { handleEntityDeath(event); }
  catch (error) { console.warn(`[Manhunt AI Bot] Death handler error: ${error}`); }
});

world.afterEvents.entityHurt.subscribe((event) => {
  if (!runtimeReady) return;
  try { handleEntityHurt(event); }
  catch (error) { console.warn(`[Manhunt AI Bot] Hurt handler error: ${error}`); }
});

world.afterEvents.entitySpawn.subscribe((event) => {
  if (event.entity.typeId !== HUNTER_ID && !WAYPOINT_IDS.includes(event.entity.typeId)) return;
  system.run(() => {
    try {
      if (WAYPOINT_IDS.includes(event.entity.typeId)) event.entity.addTag("manhunt_waypoint_active");
    } catch {}
  });
});

// This callback executes after startup early-execution has ended.
system.runTimeout(initializeRuntime, 1);

system.runInterval(() => {
  if (!runtimeReady || !isStateReady()) {
    initializeRuntime();
    return;
  }
  try { tickHunt(); }
  catch (error) { console.warn(`[Manhunt AI Bot] Brain loop error: ${error}`); }
}, 1);
