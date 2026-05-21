# Manhunt Bot v0.8.0

## What's New
- **Hunter Squads** — Spawn and chase runner with up to 4 parallel active hunters concurrently
- **Squad Presets** — Classic Solo, Double Trouble, Ranged Firepower, Tactical Trio, and Apex Predators dynamic presets built directly into standard JavaScript modules
- **Interactive Squad Lobby UI** — Slot-based Modal configurator to set unique names, skin IDs, AI difficulties, classes, and prep behaviors for each slot
- **Persistent Achievement Engine** — Tracks dodging, low-heart escapes, squad slays, and bed breaks, persisting progression via player dynamic properties
- **Achievements Checklist Screen** — Interactive scorecard dashboard showing completed challenges, locked items, and percentage calculations
- **Individual Status HUD** — Displays live coordinates, dimensional travel, HP, and individual death/life counters for all squad members

## Class & Combat Upgrades
- **Specialized Classes** — Modifiers for Knight (melee strafe tank), Archer (predictive archery), and Saboteur (potion tactics)
- **Predictive Trajectory Archery** — Archers lead bow and crossbow shots by calculating runner's velocity vector and direction
- **Tactical Backpedaling** — Archers maintain 8-15 block distance, shooting arrows, and dynamic weapon swapping to melee when runner gets too close
- **Saboteur Trapping** — Places cobwebs and fire 2 blocks in front of running targets; throws slowness and harming splash potions
- **Dynamic Shield Face** — Timed parries face incoming projectile trajectories to shield against incoming threats

## Survival & Prep Mode Realism
- **Sensory Mining Feedback** — Plays sensory audio mining feedback and spawns block-breaking particles (`minecraft:block_destroy`) during virtual gathering
- **Dig-In Smelting Cover** — Spawns 3 cobblestone/dirt shielding blocks around furnace and hunter if smelting ores while runner is close
- **Enderman Protective Eye Contact** — Safely paths sight lines to prevent Enderman aggro; drops defensive water at feet if aggroed
- **Nether Gold Armoring** — Equips a gold armor piece in the Nether dimension to avoid Piglin hostility
- **Smart Hazard Routing** — Avoids Magma, Powder Snow, and Sweet Berry bushes dynamically

## Technical
- **Round-Robin Tick Scheduling** — Staggers brain loop cycles on alternate ticks (`(system.currentTick + index) % 2 === 0`) to preserve tick rates and ensure perfect FPS scaling
- **Multi-Compass HUD Rotation** — HUD compass tracking automatically rotates focus to nearest hunter, reporting distance and bearings cleanly
- **Version Unified** — Telemetry, manifests, and system logs standardized to v0.8.0
- **AI Ticking Auto-Stop** — Automatically suspends the V8 ticking interval completely when all squad members are dead/respawning to reduce idle CPU usage to 0%, and seamlessly resumes on respawn
- **Squad Dimension Chasing** — Teleports all alive members of the squad through portals to follow the runner with staggered spawn angles and safety block checks
- **Squad Respawn Reliability** — Preserves squad members' configuration profiles, death counts, and lives across deaths by maintaining persistent squad slot metadata

**Requires Minecraft Bedrock 1.26.10+ (Scripting API Enabled)**
