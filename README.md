# 💥 BomPixel

**A real-time multiplayer 3D voxel FPS that runs entirely in the browser — no CDNs, no external services, no build step.**

[Türkçe README](README.tr.md) · Node.js + Socket.IO + SQLite + Three.js · MIT License

BomPixel is a pixel-art battle arena inspired by classic tactical shooters: pick a map, build your loadout, squad up with your group, plant (or defuse) the C4 — and everything from your character skin to the billboards in the city is player- or admin-created, live.

```
  ####   ####  #    #  #####  # #    # ###### #
  #   # #    # ##  ##  #    # #  #  #  #      #
  ####  #    # # ## #  #####  #   ##   #####  #
  #   # #    # #    #  #      #   ##   #      #
  ####   ####  #    #  #      #  #  #  ###### ######
```

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How to Play](#how-to-play)
- [Game Systems](#game-systems)
- [Admin Panel](#admin-panel)
- [Architecture](#architecture)
- [Data Formats](#data-formats)
- [HTTP API](#http-api)
- [Socket Protocol](#socket-protocol)
- [Testing](#testing)
- [Configuration & Deployment](#configuration--deployment)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Gameplay
- 🎮 **First-person voxel combat** — 20 Hz server-authoritative simulation with client-side prediction and smoothing
- 🔫 **3-weapon loadout** — switch with `1/2/3/4`, mouse wheel, or the in-game shop (`B`); slot 4 is always the C4
- 💣 **C4 bomb mechanic** — plant with right-click (2.5 s, animated), 35 s fuse with an on-screen burning timer, 50 m damage radius with distance falloff, explosion knockback, and **+3 points for the enemy who defuses it** (hold `E`, 4 s)
- 🔭 **Sniper scope** — right-click toggles an animated optical zoom (FOV 75 → 24) on the sniper rifle
- 🦘 **Jumping** with real gravity; climb hills, hop gaps
- 🏢 **One-way building visibility** — players inside a building see out, but can't be seen from outside; firing reveals your position for 1.2 s
- 💧 **Deadly water** — fall in and you're done
- ⚡ **Instant respawn**, headshots deal 1.5× damage
- 🗺️ **Multiple arenas** — every map is its own concurrent battle room; pick one from the lobby with live player counts
- 🏆 **Live Top-10 scoreboard**, kill feed, 8-minute rounds with recorded match history
- 🧭 **Minimap** (top-right): your heading, teammates in green, planted C4s blinking red

### AI Bots
- 🤖 **Smart bots with three difficulties** (Easy / Normal / Hard), chosen when entering a match
- Bots patrol, take line-of-sight into account, prefer human targets, keep engagement distance, strafe, avoid water, and exit buildings through doors
- **Hard bots plant and defuse C4** and have deadly aim
- Bot count (0–8) is per-arena and cleaned up automatically when the last human leaves

### Creativity
- 🎨 **Pixel skin editor** — 12×18 grid, pencil/eraser/fill, symmetry mode, undo, templates, **emoji stamping**, and **image → pixel conversion** (upload any picture); skins are stored server-side and rendered as extruded 3D voxel characters
- ✨ **Animated head emoji** — pick an emoji + animation (bounce / spin / pulse) that floats above your character for everyone to see
- 🔨 **Weapon skin creator** — 16×10 grid with the same tools; choose the fire type and **pick your own muzzle animation** (classic flash / flame / laser trail / energy ring) and tracer color
- 💠 **Animated stickers** — glue up to 3 emoji stickers on your own weapons; each adds **+4 % damage** and is visible to everyone in 3D

### Social
- 🛡️ **Groups (clans)** — create groups, invite players from the lobby **or mid-match** (Tab list), see the group owner and every member's live online/offline status
- 🤝 **Team play** — activate a group as your squad: no friendly fire, green name tags, green health bars
- 📩 Live invite notifications with accept/decline

### Admin
- 🗺️ **In-browser map editor** — paint terrain (grass/road/water/park), raise/lower hills, drag out **enterable buildings** (height, door side, color), place billboards and spawn points, set the map size in meters (16–256)
- 📢 **Live billboards/ads** — edit any sign's text or image (pixelated or clean) and it updates **instantly for everyone in the match**
- ⚖️ **Weapon-type balancing** — damage, fire rate, projectile speed, range, pellets, auto/beam — applied live
- 👥 User management, 📜 match history, 📡 live arena monitor

### Everywhere
- 📱 **Desktop, mobile and tablet from one codebase** — pointer lock + WASD on desktop; virtual joystick, drag-to-look, fire/jump/zoom/plant buttons on touch devices
- 🔊 **Zero-asset audio** — every sound (gunshots, footsteps, C4 beeps, explosions) is synthesized with WebAudio; **positional**: you hear nearby enemies' footsteps and shots panned by direction and distance
- 📦 **Fully self-contained** — SQLite via Node's built-in `node:sqlite`, Three.js served locally, no external requests at all

---

## Quick Start

**Requirements:** Node.js **≥ 22.5** (for the built-in `node:sqlite`; Node 24 recommended). No compilers, no native modules.

```bash
git clone <your-repo-url> bompixel
cd bompixel
npm install
npm start
```

- Game: **http://localhost:3000**
- Admin panel: **http://localhost:3000/admin**
- Phones/tablets on the same Wi-Fi: the console prints a `http://<LAN-IP>:3000` URL

On first start the server seeds the database with:

| What | Value |
|---|---|
| Admin account | `admin` / `admin123` — **change this immediately** |
| Default map | *Piksel Şehir* — a procedurally generated 96×96 m city with roads, a river, a park with a pond, hills, enterable buildings and billboards |
| Weapon types | Pistol, Auto Rifle, Shotgun, Sniper (scoped beam), Laser |

> ⚠️ The SQLite database is created at `data/bompixel.db`. It contains password hashes and session tokens — it is `.gitignore`d and must never be committed.

---

## How to Play

| Action | Desktop | Mobile / Tablet |
|---|---|---|
| Move | `W A S D` | Left virtual joystick |
| Look | Mouse (pointer lock) | Drag right side of screen |
| Fire | Left click (hold for auto weapons) | 🔥 button |
| Jump | `Space` | ⬆️ button |
| Switch weapon | `1 / 2 / 3 / 4` or mouse wheel | Tap the weapon slots |
| Weapon shop | `B` | 🛒 button |
| Scope (sniper) | Right click — toggle | 🔭 button |
| Plant C4 (slot 4) | Hold right click | Hold 💣 KUR |
| Defuse enemy C4 | Hold `E` near it | Hold ✂️ ÇÖZ |
| Player list + invites | `Tab` | 👥 button |
| Menu | `Esc` | ✕ button |

**Flow:** register (username + email + password) → draw your skin (mandatory, it *is* your character) → land in the CS-style main menu (**BATTLE / INVENTORY / CHARACTER / GROUPS**) → pick a map and bots → fight.

---

## Game Systems

### Combat model
The server simulates everything that matters at **20 Hz**: projectile flight (segment-stepped, wall/terrain/player collision), instant beams with wall occlusion, damage, headshot detection (hit above chest height → 1.5×), kills, respawns, water deaths and C4 timers. Clients send position/orientation at 20 Hz with server-side speed clamping (light anti-cheat), and render remote players with target-smoothing so movement looks fluid at any frame rate.

### C4 lifecycle
```
carry (slot 4) ──right-click 2.5 s──▶ PLANTED (35 s fuse, beeping faster and faster)
     ▲                                    │
     └──── 45 s cooldown ◀── explodes ────┤  radius 50 m, ≤8 m = lethal,
                                          │  falloff to 15 dmg, walls dampen to 40 %,
                                          │  survivors get knocked back
                    enemy holds E 4 s ────┘─▶ DEFUSED (+3 points to defuser)
```
Moving cancels planting/defusing (both client- and server-side). Everyone sees a burning 💣 + countdown banner while any C4 is armed.

### Buildings
Buildings are hollow, entered through a door gap. Rendering is asymmetric — walls turn transparent when *you* are inside, and players inside a different building than yours are hidden. Bullets are blocked by walls both ways (doors are real gaps). Firing while hidden reveals you for 1.2 s.

### Bots
Each bot is a full server-side player (shows up in snapshots, scoreboard, kill feed) with a 5.5 Hz think loop:

| | Easy | Normal | Hard |
|---|---|---|---|
| Aim error | ±0.17 rad | ±0.08 | ±0.032 |
| Engage range | 26 m | 40 m | 60 m |
| Fire-rate factor | 2.3× slower | 1.5× | 1.0× |
| Plants C4 | rarely | sometimes | often |
| Defuses C4 | ✗ | ✗ | ✓ |

### Rounds & matches
Every arena runs independent 8-minute rounds. When a round ends the final scoreboard is written to the `matches` table (visible in the admin panel), scores reset, and a new round starts after 6 s.

---

## Admin Panel

`/admin` (requires an admin account):

| Tab | What it does |
|---|---|
| 📡 Live | Online users, every open arena with players/K/D/HP, force-end rounds |
| 🗺️ Maps | List, create, edit, delete maps; set the default map; **saving a map that is being played updates it live** |
| 📢 Signs / Ads | Per-map billboard editor — text or uploaded image, pixelated toggle, colors; changes broadcast instantly |
| 🔫 Weapon Types | Live balance table (damage / rate / speed / range / pellets / auto / beam) + add new types |
| 👥 Users | Online status, grant/revoke admin, delete users |
| 📜 Match History | Every recorded round with date, map, duration and podium |

---

## Architecture

```
┌─────────────────────────────┐        WebSocket (Socket.IO)        ┌──────────────────────────────┐
│  Browser client (ES modules)│ ◀─────── snapshots @20 Hz ────────▶ │  Node.js server              │
│                             │        REST (JSON + Bearer)         │                              │
│  main.js    menu/lobby/nav  │ ◀─────────────────────────────────▶ │  index.js    Express + APIs  │
│  game3d.js  Three.js runtime│                                     │  game.js     arenas, tick,   │
│  world.js   map → meshes,   │      shared geometry logic          │              combat, C4, bots│
│             collision       │ ◀··· (duplicated, keep in sync) ···▶│  db.js       node:sqlite     │
│  voxel.js   pixel grid → 3D │                                     │  auth.js     scrypt sessions │
│  editors.js pixel editors   │                                     │  adminApi.js admin REST      │
│  audio.js   WebAudio synth  │                                     │  defaultMap.js city generator│
└─────────────────────────────┘                                     └──────────────────────────────┘
```

### Directory layout

```
server/
  index.js       Express app, user REST API, static serving, Socket.IO bootstrap
  game.js        Multi-arena game loop: tick, projectiles, hit detection, C4, rounds, bot AI
  db.js          Schema, migrations, seeding (admin, weapons, default city)
  auth.js        Register/login/session (scrypt password hashing)
  adminApi.js    Admin REST API
  defaultMap.js  Deterministic "Piksel Şehir" city generator
public/
  index.html     Single page: auth → skin editor → main menu → game
  admin.html     Admin panel + map editor
  js/…           ES modules (no bundler); Three.js copied to public/vendor at startup
  css/style.css  The whole UI
test/bot.js      End-to-end smoke test (see Testing)
data/            SQLite database (auto-created, git-ignored)
```

### Key design decisions
- **Every map is an independent arena** (`Map<mapId, arena>`): own players, projectiles, C4s, round timer. Empty arenas cost nothing.
- **Server authority where it counts** — all damage, hits, C4 and scoring are server-computed; movement is client-simulated but speed-clamped and NaN-sanitized server-side.
- **Duplicated geometry code** — `buildWalls`, `heightAt`, `insideBuilding` exist identically in `server/game.js` and `public/js/world.js`. This is deliberate (no shared-module build step). **If you change one, change the other.**
- **No bundler** — the client is plain ES modules served statically with `Cache-Control: no-cache` so players always revalidate after a deploy.
- **Everything seeded, nothing downloaded** — Three.js is copied from `node_modules` into `public/vendor` at server start.

---

## Data Formats

### Pixel grid (skins & weapon skins)
```jsonc
{ "w": 12, "h": 18, "px": ["#rrggbb", null, …],  // row-major, null = transparent
  "emoji": "🔥", "emojiAnim": "zipla" }           // optional, skins only (zipla|don|buyu)
```
Skins are 12×18 (extruded to voxels at 0.1 m/px, 2 deep), weapon skins 16×10.

### Map
```jsonc
{
  "w": 96, "h": 96,                  // size in meters (1 tile = 1 m)
  "type":   [0,1,2,3, …],           // per tile: 0 ground, 1 road, 2 water (deadly), 3 park
  "height": [0,1,2, …],             // per tile hill height (0–3)
  "buildings": [{ "x":4,"z":8,"w":6,"h":7,"ht":4,"door":"S","color":"#b0574a" }],
  "signs":  [{ "id":"s1","cx":7,"cz":7.9,"y":3,"side":"S","w":4,"h":1.2,
               "type":"text","content":"BomPixel","pixel":1,
               "color":"#ffdd33","bg":"#1a1a2a","board":1 }],   // board = free-standing pole
  "spawns": [[12.5, 40.5], …]
}
```

---

## HTTP API

All non-auth endpoints require `Authorization: Bearer <token>`.

### Auth & profile
| Method | Path | Description |
|---|---|---|
| POST | `/api/register` | `{username,email,password}` → token (auto-login) |
| POST | `/api/login` | `{username,password}` → token |
| GET | `/api/me` | Profile, skin, weapons, loadout, weapon types, groups, pending invites |
| POST | `/api/skin` | Save pixel skin (`{data: grid}`) |
| GET | `/api/maps` | All maps with live **human** player counts |
| POST | `/api/loadout` | `{slots:[id,id,id]}` — the three weapon slots |

### Weapons
| Method | Path | Description |
|---|---|---|
| POST | `/api/weapons` | Create a custom weapon: name, type, skin grid, muzzle anim, tracer color, stickers |
| POST | `/api/weapons/:id/stickers` | Update stickers on your own weapon (≤3 emoji, +4 % dmg each) |
| DELETE | `/api/weapons/:id` | Delete your weapon |

### Groups & invites
| Method | Path | Description |
|---|---|---|
| POST | `/api/groups` | Create a group (creator becomes owner) |
| GET | `/api/groups` | My groups with members + online flags |
| POST | `/api/groups/:id/activate` | Play as this team (`:id` = 0 → play solo) |
| POST | `/api/groups/:id/leave` · `/kick` | Leave (ownership transfers) / owner kicks `{uid}` |
| POST | `/api/invites` | Invite by username `{groupId,toUsername}` |
| POST | `/api/invites/:id/respond` | `{accept: true|false}` |

### Admin (`/api/admin/…`, admin only)
`live`, `round/restart`, `maps` (CRUD + `/:id/activate` = set default), `signs` (per map, live broadcast), `weapon-types`, `users` (+ `/:id/admin`, delete), `matches`.

---

## Socket Protocol

Connect with `io({ auth: { token } })`.

**Client → server:** `join {mapId?, bots?, botLevel?}` · `leaveArena` · `input {p:[x,y,z], y, pi}` · `fire {o,d}` · `switchSlot {slot}` · `reloadSlots` · `plantStart/plantDone/plantCancel` · `defuseStart/defuseDone/defuseCancel {id}` · `inviteUser {toUid}` (ack)

**Server → client:**
| Event | Payload |
|---|---|
| `welcome` | selfId, full map, weapon types, player metas, spawn, round end, C4 state |
| `snap` (20 Hz) | players `{i,p,y,pi,h,k,d,in,s}`, projectiles, armed C4s |
| `playerJoin/Leave/Switch/Slots` | roster & loadout changes |
| `shot / beam / hitYou / hitConfirm / kill / respawn / splash` | combat feedback |
| `c4Planted / c4Defused / c4Exploded / c4Status / actionCancel` | C4 lifecycle |
| `score / roundStart / roundEnd` | scoreboard & rounds |
| `mapChange / signUpdate` | live world edits from the admin panel |
| `presence / onlineList / invite / groupUpdate / authError` | social & session |

---

## Testing

With the server running, in a second terminal:

```bash
npm test
```

`test/bot.js` is a full end-to-end smoke test (55 scenarios): it registers two players, **creates its own isolated arenas** (so it never disturbs live players), walks one bot to the other and kills it, switches weapon slots, plants and defuses a C4, exercises groups/invites, spawns hard AI bots and waits for them to open fire, drives every admin API including live billboard updates and live map reloads, and cleans up after itself. Exit code 0 = all green.

---

## Configuration & Deployment

| Setting | How |
|---|---|
| Port | `PORT=8080 npm start` (default 3000) |
| LAN play | Server binds `0.0.0.0`; the console prints LAN URLs for phones/tablets |
| Reverse proxy | Terminate TLS in front (nginx/Caddy); allow WebSocket upgrade for `/socket.io/` |
| Data | Back up `data/bompixel.db` (WAL mode); delete it to factory-reset |

Production notes: put it behind HTTPS (pointer lock and fullscreen behave best in secure contexts), change the seeded admin password on day one, and consider raising the scrypt cost / adding rate limiting before exposing it to the open internet.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node:sqlite` not found | Node < 22.5 — upgrade (Node 24 recommended) |
| Port already in use | Another instance is running — `PORT=3001 npm start` or kill the old process |
| Black screen / stale UI after update | Hard-refresh once (`Ctrl+Shift+R`). JS is served with `no-cache`, so this should never recur |
| Which client version am I running? | The console logs `[BomPixel] istemci surumu: vN`; `__bpDebug.state()` dumps live entity state |
| Mouse not captured | Click the canvas once; pointer lock needs a user gesture |
| Remote players frozen in another tab | Browsers pause `requestAnimationFrame` in background tabs — this is normal |

---

## Roadmap

Ideas that fit the codebase well — PRs welcome:

- Game modes: bomb/defuse sites (CS-style), team score, Gun Game, zone control, co-op zombie waves, battle-royale with rising water
- Grenades (frag/smoke/flash), melee knife, reload & ammo, pickups, exploding barrels
- In-game text chat + radio commands, private password rooms, kill cam, spectator mode
- XP/ranks, achievements that unlock stickers, per-player stats, weekly leaderboards
- Community map sharing with admin approval, jump pads, ladders, day/night with glowing signs
- Settings menu (sensitivity, volume, render scale, key bindings), gamepad support, PWA install

---

## Contributing

1. Fork, branch, hack. There is no build step — edit and refresh.
2. **Keep the twin geometry in sync**: any change to `buildWalls` / `heightAt` / `insideBuilding` must be applied to both `server/game.js` and `public/js/world.js`.
3. Guard every division and broadcast: positions must never go NaN (`round2` refuses to emit non-finite values — keep it that way).
4. Run `npm test` before opening a PR; add scenarios for new mechanics (the test creates isolated arenas, so it is safe to run against a live server).
5. Keep the project dependency-light and CDN-free — that's the point.

---

## License

[MIT](LICENSE) — do whatever you want, just keep the notice.

Built with [Three.js](https://threejs.org/), [Socket.IO](https://socket.io/), [Express](https://expressjs.com/) and Node's built-in SQLite. All game art is generated at runtime from pixel grids; all audio is synthesized — the repository contains no binary assets.
