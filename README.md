# Manhunt Bot v0.8.0 — The Squads & Ranged Combat Update

## 🎯 The Ultimate Survival Challenge

Experience the thrill of being hunted in your own Minecraft world! **Manhunt Bot** spawns an AI hunter that tracks, chases, and fights you using advanced combat tactics, survival skills, and relentless pursuit. Unlike regular mobs, this hunter adapts to your strategies and uses real Minecraft mechanics against you.

## 🎮 How It Works

1. **Get the Hunter Compass** — Use Creative Mode or `/give @s manhunt:hunter_compass`
2. **Configure Your Hunt** — Right-click to open the interactive menu
3. **Customize Everything** — Manage a squad of up to 4 hunters, select names, skins, classes, difficulties, and win conditions
4. **10-Second Countdown** — Your inventory clears, regeneration is applied, and the hunt begins
5. **Survive** — The hunter squad tracks you across dimensions, builds bridges, shoots predictive arrows, throws potions, MLGs water, and cooperates to hunt you down
6. **Win or Lose** — Defeat the entire squad permanently, survive the time limit, or get hunted down

## ⚡ v0.8.0 Features ("Squads & Ranged Combat")

### 👥 Hunter Squads & Lobby UI
- **Solo to Quad Support** — Spawn and fight up to 4 parallel hunters concurrently, each operating on an independent staggered brain loop.
- **Unified Squad Lobby** — Configure every hunter slot individually: set names, skins, difficulties, and specialized class profiles.
- **Quick Team Presets** — Apply predefined squad setups loaded dynamically from the resource pack:
  - *Classic Solo* (1 Balanced Hunter)
  - *Double Trouble* (2 Melee Knight Hunters)
  - *Ranged Firepower* (1 Knight + 1 Archer Hunter)
  - *Tactical Trio* (1 Knight + 1 Archer + 1 Saboteur Hunter)
  - *Apex Predators* (2 Knights + 1 Archer + 1 Saboteur)

### ⚔️ Specialized Hunter Classes
- **Knight (Melee Tank)** — High armor, slow speed. Relies on heavy shield blocking, timed knockback parries, and aggressive circle-strafing.
- **Archer (Ranged Support)** — High speed, low armor. Kits up with Bows/Crossbows. Backpedals to maintain a 8-15 block distance, shooting predictive shots that account for the runner's speed and vector. Switches to melee if cornered.
- **Saboteur (Tactician)** — Medium armor, normal speed. Combines melee pressure with tactical deployables. Places fire or cobwebs in front of the runner, and splashes potions of slowness and harming.

### 🧠 Advanced Combat & Target Tracking AI
- **Dynamic Shield Facing** — Hunters block incoming arrow trajectories dynamically by facing the projectile's threat vector rather than mirroring the player.
- **Staggered Round-Robin Brain Ticking** — High performance brain processing spreads the execution of multiple parallel brains across alternate ticks to guarantee impeccable game tick rates.
- **Multi-Compass Tracking HUD** — Direction arrows (↑↗→↘↓↙←↖) + distance measurements for all active hunters rotate dynamically on your action bar with color-coded warning proximities.

### 🛡️ Survival Intelligence & Prep Upgrades
- **Dig-In cover** — When furnace-smelting ores during prep, hunters check if players are nearby and automatically encase themselves in 3 cobblestone shielding blocks to prevent sudden runner ambushes.
- **Sensory Mining Feedback** — Spawns realistic breaking blocks particles (`minecraft:block_destroy`) and plays pickaxe break sounds dynamically so runner can audit hunter positions by sound.
- **Dimension & Threat Adaptation** — Automatically equips gold armor in the Nether to placate Piglins. Prevents eye-contact with Endermen and places water at feet if aggroed in the End.
- **Hazard Routing** — Safely paths around Powder Snow, Magma, and Sweet Berry bushes.

### 🏆 Win Conditions & Persistent Achievements
- **Squad Win Scaling** — Team lives pools, collective death matches, and custom limits scale dynamically based on your chosen squad size.
- **Lightweight Trophies Engine** — Dynamic achievements checklist tracks dodge counts, low-heart escapes, squad wipes, and bed destruction. Saves progress persistently inside player dynamic properties!

---

## 🛠️ Installation

**Requirements:** Minecraft Bedrock 1.26.10+ (Scripting API Enabled)

1. Download the `.mcaddon` file
2. Double-click to import into Minecraft
3. Create a new world or edit an existing one
4. Apply both Behavior Pack and Resource Pack
5. Load your world and use the Hunter Compass!

---

## 🎨 Custom Skins

Add your own hunter skins by placing PNG files in `RP/textures/entity/hunter/` and updating the entity client definition. The Custom skin slot (ID 5) is reserved for this purpose.

---

## 🎯 Gameplay Tips

- **Sneak** to hide from the hunter's tracking compass
- **Water buckets** are essential — the hunters MLG, so should you
- **Listen for mining** — follow the block breaking sounds during prep mode to ambush hunters
- **Avoid Archer line of sight** — archers predict your path; zig-zag to force arrows to miss
- **Nether/End portals** buy you time but the entire squad will follow
- **Destroy their beds** — finding and breaking the squad bed locks them from respawning!

---

## 📊 Why Manhunt Bot?

| Feature | Manhunt Bot v0.8.0 | Other AI Addons |
|:---|:---:|:---|
| **Multi-Hunter Support** | Up to 4 Squad members with dynamic presets | Solo Only |
| **Hunter Classes** | Knight, Archer, Saboteur unique tactics | None |
| **Predictive Archery** | Leads shots based on runner velocity | Flat projectile firing |
| **Smelting Cover** | Places protective blocks around furnace | Mines invisibly |
| **Sound Audits** | Real breaking blocks particles + sounds | Muted silent gathering |
| **Persistent Achievements** | Built-in trophy cards using dynamic properties | None |
| **Win conditions** | 4 customizable scalable modes | None |
| **Portal following** | Multi-dimension safe portal transfer | None |

---

## 🚀 Roadmap

- Advanced squad flanking coordinates (surrounding the runner)
- Custom skins UI upload assistant
- More creative traps and redstone sabotage AI
- Community-suggested features

---

## 📜 Credits

**Developer:** BUDGETGAMER1503  
**Version:** 0.8.0  
**Tested On:** Minecraft Bedrock 1.26.20  

### Support & Feedback
- Report issues on CurseForge comments
- Feature suggestions welcome
- Follow for updates and new versions

## ⚠️ Important Notes

- Backup your world before installing — always good practice
- Some features may not work for non-host players in multiplayer
- The hunter is designed for single-player or host-only use
- The hunter uses a virtual inventory system — it doesn't need actual item slots to craft and equip

---

_"I can hear your heartbeat…" — The Hunter Squad_
