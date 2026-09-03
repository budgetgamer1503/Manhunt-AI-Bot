# Manhunt Bot v2.1.0 - The Pro Update

## The Ultimate Survival Challenge

Experience the thrill of being hunted in your own Minecraft world. **Manhunt Bot** spawns an AI hunter that tracks, chases, and fights you using real Minecraft mechanics - and, just like a real player, it starts with **nothing** and has to gather, craft, and gear up on its own.

Now with **pro-player strategic intelligence**: the hunter reads the situation, recognises kill windows, intercepts your escape routes, and stops wasting time gathering once it already outgears you.

---

## How It Works

1. **Get the Hunter Compass** - Use Creative Mode or `/give @s manhunt:hunter_compass`
2. **Configure Your Hunt** - Right-click to open the interactive menu
3. **Build Your Squad** - Manage up to 4 hunters, each with a name, skin, and AI difficulty
4. **10-Second Countdown** - The hunt begins
5. **Survive** - The hunters punch trees, craft tools, mine ore, smelt iron, forge netherite, build bridges, MLG water, and relentlessly chase you across all three dimensions
6. **Win or Lose** - Slay the dragon first, defeat the squad, survive the time limit, or get hunted down

---

## v2.1.0 - The Pro Update

### Pro-Player Strategic Brain

The entire goal-scoring system was rebuilt around how a real skilled manhunt hunter actually thinks.

**Gear Advantage Awareness**
The hunter constantly evaluates whether it outgears you. Once it has a significant gear advantage it stops gathering and starts pushing hard. No more mining iron when it already has full iron gear - it knows when it is time to hunt.

**Kill Window Recognition**
The single biggest difference between a casual and a pro hunter. The brain now detects when you are vulnerable and overrides everything else to push:
- You just took a hit
- You are stuck in a cobweb
- You are moving slowly (cornered or low stamina)
- You are in the End (dragon fight is imminent)
- Late game - 15+ minutes in, every second counts

**Intercept Routing**
At distances over 16 blocks the hunter now chases where you are *going*, not where you are. It extrapolates your velocity 8 ticks ahead and routes to cut off your escape, not follow from behind.

**Stalling Detection**
If you hide or stop moving for around 12 seconds the hunter recognises you are stalling and switches to an active flush-out search rather than wandering aimlessly.

**Time Pressure**
Gathering scores decay over time. After 10 minutes the hunter gathers 30% less aggressively. After 20 minutes, 60% less. Late game is about killing, not gearing.

**Dimension Urgency**
The longer you have been in another dimension, the more urgently the hunter follows. Urgency scales up every 5 seconds you are separated.

**Resource Efficiency**
The hunter stops gathering once it has enough. It will not keep mining iron when it already has full iron gear, will not gather food when it has 10 pieces, will not collect wood when it already has a full crafting table and tools.

**Dynamic Aggression**
- Eat threshold scales with gear advantage - outgearing you means it can fight at lower HP
- Work distance scales with gear advantage - if it outgears you it crafts closer to you
- Crafting and smelting are suppressed entirely in the End and when actively chasing in the Nether

---

### Rebuilt Combat System

**Strafe Direction Memory**
The hunter picks a strafe direction and commits to it for several ticks before switching - exactly how real PvP players move. The old system switched randomly every tick which looked robotic.

**Spacing Rhythm (W-tap)**
After landing a hit the hunter backs off slightly then re-engages. This is the fundamental PvP rhythm real players use instinctively.

**Feint System**
Higher difficulty tiers occasionally raise their shield, then immediately drop it and swing - a real PvP technique designed to bait your counter-attack.

**Gaussian Aim Error**
Bow aim error now uses a bell-curve distribution instead of uniform random. Small misses are common, wild misses are rare - exactly like a real player's aim drift.

**Smarter Hostile Handling**
The hunter no longer breaks off the runner chase to fight mobs unless that mob is the one actually dealing damage to it.

---

### Rebuilt Chat Personality

**Human Typing Delay**
Chat messages now queue with a 1-3 second delay before sending. A real player does not type the instant something happens - they react, then type.

**True Random Line Selection**
The old system always picked the same line for the same event. Now it is fully random so you never hear the same line twice in a row.

**Variable Ambient Interval**
Exciting situations (runner nearby) trigger chat every ~18 seconds. Boring situations (mining alone) every ~35 seconds.

**Rewritten Chat Lines**
All lines are now lowercase, casual, and short - exactly how a real player types mid-game. "almost", "found u", "DIAMONDS", "ur cooked now", "nom" instead of formal robotic sentences.

---

## v2.0.0 - The Endgame Update

**Race to the Dragon**
New win mode: the first side to slay the Ender Dragon wins. Hunters use stronghold sense - retracing your overworld trail, detecting real end portals, and following you into the End. They destroy your placed end crystals mid-fight and snipe you off pillars.

**Full Netherite Arc**
The diamond cap is gone. Hunters mine ancient debris, smelt scrap, forge ingots, and reforge their tools and armor to netherite - earned block by block in the Nether.

**Nightmare Difficulty**
A fourth AI tier above Expert: near-instant reactions, tightest shield windows, fastest bow cadence, near-zero decision noise.

---

## v1.0.0 - Self-Sufficient Hunter

**Earned Progression**
Hunters spawn empty-handed and climb the tech tree themselves: punch wood, craft tools, mine stone, smelt iron, forge gear. Kill a hunter and it drops everything it worked for - then re-gathers from scratch on respawn.

**Hunter Squads**
Spawn 1-4 hunters, each on an independent staggered brain loop. Presets: Solo, Balanced Squad, and Pressure Squad.

**Advanced Survival AI**
MLG water clutches, block-clutches, bridging, pillaring, parkour jumps, hazard routing, and multi-hunter tracking HUD.

**Win Conditions**
Infinite respawns, limited lives, survival timer, kill-count, or Race-to-the-Dragon.

---

## Installation

**Requirements:** Minecraft Bedrock 1.26.10+

1. Download the `.mcaddon` file
2. Double-click to import into Minecraft
3. Create or edit a world and apply both the Behavior Pack and Resource Pack
4. Load in and use the Hunter Compass

---

## Gameplay Tips

- **Sneak** to hide from the tracking compass - but if you stop moving for too long it switches to active search mode.
- **Listen for mining** - early on, hunters are gathering wood and stone. That is your window to strike while they are weak.
- **Do not let them get diamond gear** - once they outgear you they stop gathering and push hard. Hit them before they upgrade.
- **Water buckets** are essential - the hunters MLG, so should you.
- **Nether/End portals** buy time, but the whole squad will follow - and they get more urgent the longer you are separated.
- **Keep moving** - the hunter predicts where you are going at long range. Changing direction breaks the intercept.
- **Hit them early** - a freshly spawned hunter has no weapon yet. That window closes fast.

---

## Credits

**Developer:** BUDGETGAMER1503
**Version:** 2.1.0
**Tested On:** Minecraft Bedrock 1.26.20

## Important Notes

- Back up your world before installing.
- Some features may not work for non-host players in multiplayer.
- The hunter uses a virtual inventory system - it gathers and crafts without needing real container slots.

---

*"found u :)" - The Hunter*
