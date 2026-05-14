# Manhunt Bot v0.7.0

## What's New
- **Win Conditions** — Limited Lives, Time Limit, Kill Count, or Infinite
- **Compass Tracking** — Direction arrow + distance on action bar
- **Difficulty Scaling** — Hunter gets harder over time (toggleable)
- **Portal Following** — Hunter follows through Nether/End portals
- **Persistent Config** — Settings survive world reloads
- **Prep Behaviors** — Hybrid, Pure Chase, or Aggressive
- **Hunt Stats** — Duration, damage, deaths tracked at hunt end

## Combat Upgrades
- Distance-based strafing (circle-strafe close, random mid, approach far)
- W-Tap sprint-reset knockback
- Shield knockback + parry stun
- Priority food system (25 foods, health thresholds, combat-aware, regen effects)

## Survival Upgrades
- Anti-trap: escapes encasement, auto-bridges lava/fire
- Fall water save: 15% MLG water bucket after 10+ block falls

## Technical
- Modular AI system (7 focused class files instead of 1 giant 1357-line file)
- Fixed version mismatch, `require()` crashes, prepBehavior hardcoding

**Requires Minecraft Bedrock 1.21.40+**