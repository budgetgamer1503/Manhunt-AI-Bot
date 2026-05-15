# Manhunt Bot v0.7.0 — AI Hunter Addon for Minecraft Bedrock

## 🎯 The Ultimate Survival Challenge

Experience the thrill of being hunted in your own Minecraft world! **Manhunt Bot** spawns an AI hunter that tracks, chases, and fights you using advanced combat tactics, survival skills, and relentless pursuit. Unlike regular mobs, this hunter adapts to your strategies and uses real Minecraft mechanics against you.

## 🎮 How It Works

1. **Get the Hunter Compass** — Use Creative Mode or `/give @s manhunt:hunter_compass`
2. **Configure Your Hunt** — Right-click to open the interactive menu
3. **Customize Everything** — Name, skin, AI level, win condition, inventory mode, prep behavior
4. **10-Second Countdown** — Your inventory clears, regeneration applied, the hunt begins
5. **Survive** — The hunter tracks you across dimensions, builds bridges, MLGs water buckets, and fights with advanced combat AI
6. **Win or Lose** — Defeat the hunter permanently, survive the time limit, or get hunted down

## ⚡ v0.7.0 Features

### 🧠 Advanced Combat AI
- **Distance-based strafing** — Circle-strafe at close range (<4 blocks), random directional at mid range (4-12 blocks), approach with randomness at long range (>12 blocks)
- **W-Tap sprint-reset** — 30% chance for extra forward knockback after strafe sequences, mimicking real PvP tactics
- **Shield knockback + parry** — Blocking knocks attackers back based on hunter's facing direction; timed parries deal 1.8x knockback + slowness stun
- **Priority food system** — 25 food types with weighted priority, individual health thresholds per food, combat-only foods (enchanted golden apples, chorus fruit) reserved for fights, all foods apply regeneration + bonus effects
- **Jump attacks, weapon combos, critical hits, lava pouring** — Full PvP moveset
- **3 AI difficulty levels** — Easy, Normal, Expert with tuned cooldowns, ranges, and aggression

### 🛡️ Survival Intelligence
- **Anti-trap system** — Detects encasement in solid blocks (obsidian, cobblestone, etc.) and breaks out; auto-places cobblestone when standing on lava, fire, or soul fire
- **Water bucket MLG** — Places water precisely to break fatal falls
- **Fall water save** — 15% chance to simulate MLG water bucket after falling 10+ blocks
- **Block clutching** — Places blocks below while falling to catch ledges
- **Cave escape** — Detects being stuck underground and mines/pillars out
- **Bridging + pillaring** — Builds across gaps and pillars up to reach elevated targets
- **Lava escape** — Uses water bucket or safe blocks when caught in lava

### 🏆 Win Conditions
- **Limited Lives** — Hunter has 3 lives (configurable). Runner wins when all are exhausted
- **Time Limit** — Survive 30 minutes (configurable). Runner wins when time expires
- **Kill Count** — Kill the hunter N times to claim victory
- **Infinite** — Classic endless mode, hunter respawns forever

### 🎨 Full Customization
- **8 hunter skins** — Steve, Alex, Zombie, Skeleton, Creeper, Dream, Technoblade, Custom
- **Custom hunter name** — Name your hunter anything (up to 24 characters)
- **3 AI levels** — Easy (slower, safer retreats), Normal (baseline), Expert (faster, more aggressive)
- **3 inventory modes** — Starter Kit (default tools/food), Player Share (mirrors your gear), Creator Kit (4 preset kits + auto-match)
- **3 prep behaviors** — Hybrid (gathers + crafts during chase), Pure Chase (never stops to gather), Aggressive (shorter prep, faster gathering)
- **Difficulty scaling toggle** — Hunter gets progressively harder every 5 minutes and after each death
- **Equipment persistence** — Choose whether hunter keeps or drops gear on death
- **Boat handling** — Destroy nearby boats or ignore them
- **Taunt toggle** — Enable/disable hunter taunt messages
- **Persistent config** — All settings survive world reloads via dynamic properties

### 📦 Creator Kits
Choose from 4 preset loadouts or let the AI auto-match the best kit based on your inventory:
- **Balanced Hunter** — Stone tools, bread, cobblestone, shield, water bucket, bed
- **Melee Pressure** — Iron sword + axe, cooked beef, shield, iron ingots for crafting
- **Resource Runner** — Iron pickaxe, coal, raw iron, furnace — built for mining and smelting
- **Builder Escape** — Planks, cobblestone, torches, crafting table — mobility and structure focus

### 🧭 Quality of Life
- **Compass tracking** — Direction arrow (↑↗→↘↓↙←↖) + distance in meters on action bar when holding the Hunter Compass; color-coded: green (>80m), yellow (30-80m), red (<30m)
- **Portal following** — Hunter follows you through Nether and End portals after a 3-second delay with safe position finding
- **Hunt stats** — Duration, damage dealt/taken, blocks traveled, deaths, items crafted, blocks mined displayed at hunt end
- **Quick restart** — Reuse your last hunt configuration instantly without reconfiguring
- **Hunt status screen** — View runtime state, AI phase, dimension, death count, bed location, and respawn diagnostics

## 🛠️ Installation

**Requirements:** Minecraft Bedrock 26.10+

1. Download the `.mcaddon` file
2. Double-click to import into Minecraft
3. Create a new world or edit an existing one
4. Apply both Behavior Pack and Resource Pack
5. Load your world and use the Hunter Compass!

## 🎨 Custom Skins

Add your own hunter skins by placing PNG files in `RP/textures/entity/hunter/` and updating the entity client definition. The Custom skin slot (ID 5) is reserved for this purpose.

## 🎯 Gameplay Tips

- **Sneak** to hide from the hunter's tracking
- **Water buckets** are essential — the hunter MLGs, so should you
- **Use terrain** — the hunter navigates obstacles but you can create traps
- **Nether/End portals** buy you time but the hunter will follow
- **Watch your compass** — the color and distance tell you how close the hunter is
- **Don't box yourself in** — the hunter has anti-trap escape mechanics
- **Gather quickly** — the hunter mines, crafts, and upgrades gear during prep phases
- **Build high** — pillaring up forces the hunter to pillar or bridge to reach you

## 📊 Why Manhunt Bot?

| Feature | Manhunt Bot | Other AI Addons |
|---------|-------------|-----------------|
| Combat AI | Distance-based strafing, W-Tap, shield parry | Basic chase + attack |
| Survival | MLG, anti-trap, lava escape, cave escape | None |
| Building | Bridging, pillaring, block placement | None |
| Gathering | Mining, crafting, smelting, tool upgrades | None |
| Win conditions | 4 configurable modes | None |
| Customization | 8 skins, 3 AI levels, 3 inventory modes | Limited |
| Difficulty scaling | Progressive over time + per death | None |
| Portal following | Nether + End support | None |
| Compass tracking | Direction + distance HUD | None |

## 🚀 Roadmap

- Multi-hunter support (team hunts)
- More hunter skins and variants
- Achievement system
- Community-suggested features

## 📜 Credits

**Developer:** BUDGETGAMER1503
**Version:** 0.7.0
**Tested On:** Minecraft Bedrock 26.20

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

_"I can hear your heartbeat…" — The Hunter_
