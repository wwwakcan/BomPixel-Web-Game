# AI Development Guide — BomPixel

> **Purpose:** This file is the onboarding brief for AI coding assistants (Claude Code, Cursor, Copilot, Windsurf, aider, …) and the humans pairing with them. Read it before touching code — it contains the architecture, the invariants you must not break, hard-won pitfalls from past development, data formats, and step-by-step recipes for the most common changes.
>
> *TR: Bu dosya, projeyi yapay zekâ ile geliştirmeye devam edecekler için hazırlanmış teknik brifingtir. Kod değiştirmeden önce okuyun.*

---

## 1. What this project is

BomPixel is a **real-time multiplayer 3D voxel FPS** running entirely in the browser:

- **Server:** Node.js (≥ 22.5, built-in `node:sqlite`), Express, Socket.IO. Single process, server-authoritative combat at a 20 Hz tick.
- **Client:** Plain ES modules (no bundler, no build step), Three.js (served locally from `public/vendor/`, copied from `node_modules` at server start), WebAudio-synthesized sound (zero audio assets), CSS-only UI.
- **Philosophy:** zero external services, zero CDNs, zero binary assets, dependency-light. Everything (maps, skins, sounds, bots) is generated at runtime from data.
- UI text is **Turkish** (mostly ASCII-folded: `Dusman`, `Yukleme`); code identifiers and comments are Turkish/English mix. Keep user-facing strings Turkish.

### Commands

```bash
npm start        # run server on :3000 (PORT env to override)
npm test         # end-to-end smoke test (server must be running) — 55 scenarios, exit 0 = green
node --check f   # syntax-check a CJS file; for ES modules copy to .mjs first
```

Default admin seeded on first boot: `admin` / `admin123`. Database: `data/bompixel.db` (gitignored — contains password hashes; **never commit**). Factory reset: stop server, delete `data/`, start.

---

## 2. File map — where everything lives

| File | Responsibility |
|---|---|
| `server/index.js` | Express app, user REST API (auth/skin/weapons/loadout/groups/invites/maps), static serving with `Cache-Control: no-cache`, Socket.IO bootstrap, Three.js vendor copy |
| `server/game.js` | **The heart.** Multi-arena state, 20 Hz tick (projectiles, hits, C4 timers, water deaths), socket protocol, bot AI (5.5 Hz), rounds & match recording, REST hooks (`live`, `updateSign`, `reloadMap`, …) |
| `server/db.js` | Schema, `addColumn` migrations, seeding (admin, weapon types, default weapons w/ pixel art, default city map) |
| `server/auth.js` | Register/login, scrypt hashing, session tokens, Express middlewares (`authMiddleware`, `adminMiddleware`) |
| `server/adminApi.js` | Admin REST (maps CRUD, live signs, weapon types, users, matches, live monitor) |
| `server/defaultMap.js` | Deterministic city generator (seeded RNG) — roads, river, park+pond, hills, buildings, billboards, spawns |
| `public/index.html` | ALL screens in one page: auth → skin editor → CS-style main menu (battle/inventory/groups pages) → game canvas + HUD |
| `public/js/main.js` | Screen flow, auth, main-menu rendering, map/bot selection, loadout & sticker management, group UI, toasts, socket lifecycle (owns the socket) |
| `public/js/game3d.js` | **The other heart.** Three.js runtime: input (desktop+touch), physics (jump/gravity/collide), weapon slots & shop (B), sniper zoom, C4 plant/defuse UX, minimap, HUD, effects, positional audio triggers, remote-player rendering, socket handlers `H.*` |
| `public/js/world.js` | Map → meshes (terrain/water/buildings/signs) + **collision & geometry helpers (twins of server versions — see §3.1)** |
| `public/js/voxel.js` | Pixel grid → InstancedMesh voxel model, name sprites, HP bars, emoji sprites, 2D grid preview, spin preview |
| `public/js/editors.js` | `PixelEditor` (pencil/fill/mirror/undo/emoji-stamp/image-import), skin templates, editor UI binding |
| `public/js/audio.js` | WebAudio synth (`sfx.*`) + `positional()` pan/volume math |
| `public/js/admin.js` + `admin.html` | Admin panel incl. canvas map editor |
| `public/css/style.css` | Entire UI (pixel theme, HUD, mobile controls) |
| `test/bot.js` | E2E smoke test — **creates its own isolated arenas**, never touches live players |

---

## 3. INVARIANTS — break these and the game breaks

### 3.1 Twin geometry (the #1 rule)
`buildWalls`, `heightAt`, `tileType`, `insideBuilding` exist **twice**, intentionally duplicated (no shared-module build step):

- `server/game.js` (CJS) — used for bullets, bots, validation
- `public/js/world.js` (ESM) — used for rendering & movement

**Any change to one MUST be mirrored in the other**, byte-for-byte in logic (wall thickness 0.35, door width 1.5, roof handling, border walls). Divergence causes ghost walls / shoot-through-walls bugs.

### 3.2 NaN discipline (caused the worst bug in history of this repo)
A single `dx / 0` in bot AI once produced `NaN` positions → serialized as `null` → **invisible bots that still shot players**. Defenses now in place — keep all of them:

1. Every distance division uses `Math.hypot(...) || 0.001` (server AI) — do the same in new code.
2. `round2()` in `game.js` refuses to emit non-finite values — never bypass it in snapshots.
3. The tick self-heals: any player/bot with a non-finite coordinate is respawned.
4. Client `H.snap` ignores non-finite positions.
5. `botMove` / `fire` reject non-finite inputs.

**Rule: no division by a possibly-zero magnitude, and nothing non-finite ever crosses the wire.**

### 3.3 Client rendering rules
- The weapon viewmodel renders in a **separate scene** (`vmScene`) after `renderer.clearDepth()` — and `renderer.autoClear` must be set `false` around that second render then restored, or the whole screen goes black. (This exact bug shipped once.)
- Remote players use **target-smoothing** (`rp.tx/ty/tz` + lerp in the loop), not buffered interpolation. It was chosen for robustness — don't reintroduce time-buffer interpolation without very good reason.
- New remote players are `visible = false` until their first snapshot position arrives (`rp.hasPos`).

### 3.4 Cache & versioning
- Static JS/CSS/HTML is served with `Cache-Control: no-cache` (see `index.js`). Don't remove it — stale-cache clients caused a multi-hour ghost hunt.
- `game3d.js` has a `BUILD = 'vN'` constant logged to console and exposed via `__bpDebug.build`. **Bump it on every meaningful client change** so "which version is this browser running?" is always answerable.

### 3.5 `node:sqlite` specifics
- Positional `?` params only. **Never pass `undefined`** (throws) — use `?? null`. Booleans must be `1/0`.
- Same API shape as better-sqlite3 (`prepare/run/get/all`, `lastInsertRowid`), `db.exec` for pragmas.
- Schema changes: add via `addColumn(table, name, def)` in `db.js` — idempotent, runs at boot, upgrades existing DBs in place. Never edit `CREATE TABLE` expecting old DBs to change.

### 3.6 Server authority
Everything that affects fairness is computed server-side: damage, hits (segment vs AABB), headshots (y > feet+1.35 → 1.5×), C4 timing/radius/defuse, scores, water deaths, fire-rate limits, movement speed clamp (`MOVE_SPEED * dt * 1.8 + 0.5`), plant/defuse cancel-on-move. Clients *simulate* movement and *request* actions. New mechanics must follow this split.

### 3.7 Socket handler hygiene (client)
All in-game handlers live in the `H` object in `game3d.js`; registered with `socket.on` at startGame and **removed with `socket.off(ev, fn)` in `destroy()`**. Lobby-level handlers (invite/presence/groupUpdate) belong to `main.js` and persist. New events must follow this pattern or handlers leak across matches. `H.connect` re-emits `join` on reconnect — keep it working.

### 3.8 Misc invariants
- Ids: humans = socket.id (string), bots = `'bot:<negativeUid>'`, bot uid < 0 (client uses `uid < 0` / `meta.bot` to hide invite buttons).
- Building visibility: hidden players are revealed for 1.2 s after firing (`rp.revealUntil`) — fairness feature, keep it.
- Empty arenas: when the last human leaves, bots/C4s/projectiles are cleared; arenas tick only when non-empty.
- `express.json({ limit: '4mb' })` exists for image ads/skins — keep sign image data-URLs ≤ ~1.5 MB (validated in adminApi).

---

## 4. Runtime model (mental picture)

```
join {mapId, bots, botLevel}
  └▶ getArena(mapId)  — lazy-creates: { map, walls, players:Map, projectiles, c4s, round timers }
       ├▶ welcome  {selfId, map, weaponTypes, player metas(slots+skin+group), spawn, round, c4s}
       ├▶ room 'arena:<id>' broadcasts: snap @20Hz {players[{i,p,y,pi,h,k,d,in,s}], proj, c4}
       ├▶ events: shot/beam/hitYou/hitConfirm/kill/respawn/score/roundStart/roundEnd/
       │          c4Planted/c4Defused/c4Exploded/mapChange/signUpdate/playerJoin/Leave/Switch/Slots
       └▶ bot AI interval 180ms: think per bot (target LOS → aim+fire | wander | plant | defuse)
```

Gameplay constants (all in `server/game.js` top or nearby): TICK 50 ms · ROUND 8 min · SPEED 6 m/s · C4: plant 2.5 s / fuse 35 s / defuse 4 s (+3 pts) / cooldown 45 s / radius 50 m (≤8 m lethal, walls dampen ×0.4) · sticker +4 %/emoji (max 3) · headshot 1.5× · jump v 5.4, g 14.5 (client).

### Data formats
- **Pixel grid** `{w,h,px:["#rrggbb"|null,…]}` row-major; skins 12×18 (+ optional `emoji`,`emojiAnim`: `zipla|don|buyu`), weapons 16×10. Validated by `validGrid` in `index.js`.
- **Map** `{w,h,type[],height[],buildings[{x,z,w,h,ht,door,color}],signs[{id,cx,cz,y,side,w,h,type,content,pixel,color,bg,board}],spawns[[x,z]]}` — tile types: 0 ground, 1 road, 2 water(deadly), 3 park. Signs use world-space `cx/cz` + facing `side`.
- **DB tables:** users(loadout JSON, active_group), sessions, skins(data JSON), groups, group_members, invites, maps(data JSON), settings(active_map=default), weapon_types, weapons(skin/stickers JSON, owner NULL=stock), matches(scores JSON).

---

## 5. Recipes — how to add things

### Add a new weapon type (fire type)
1. Insert via admin panel OR seed in `db.js` (`weapon_types`: dmg, rate, speed, range, pellets, auto, beam).
2. If it needs unique behavior beyond those stats, extend `fire()` / `fireBeam()` in `server/game.js`.
3. Client: add a fire sound in `audio.js` `FIRE_SOUNDS`, optionally a muzzle anim in `spawnFlashAt`/`setViewmodel`.
4. If scoped: `canZoom()` in `game3d.js` currently checks `type === 'keskin'` — generalize with a `zoom` column if needed.

### Add a new socket event
1. Server: handler inside `io.on('connection')` in `game.js`; get the player with `me()`; validate everything; broadcast with `io.to(room(arena))`.
2. Client: add `H.myEvent = (m) => {…}` in `game3d.js` — auto-registered/cleaned by the `H` loop.
3. Add a scenario to `test/bot.js` using its `waitFor(socket, event, timeout, predicate)` helper.

### Add a map feature (new tile type / object)
Touch ALL of: `defaultMap.js` (generator, optional) → admin `admin.js` map editor (tool + drawing) → `adminApi.js` validation → `public/js/world.js` `buildWorld` (mesh) **and** collision → `server/game.js` twins (walls/height/type) → both `buildWalls` twins if it blocks movement/bullets.

### Add a HUD element
`index.html` (element inside `#screen-game`) → `style.css` → update from `game3d.js` (event handler or the ~1 s throttled blocks in `loop()`). Reset its state in the "HUD katmanlarini temiz basla" block at startGame if it can persist across matches.

### Add a game mode
Best pattern: a `mode` field on the arena (set at `getArena`/join), branch inside `startRound`/`endRound`/`damage`/scoreboard. Keep per-mode state on the arena object. Broadcast mode in `welcome` and render mode-specific HUD client-side.

### Change the DB schema
`addColumn` in `db.js` + write code tolerating NULL in old rows. Never require a manual migration.

---

## 6. Testing & debugging toolbox

### E2E test (`npm test`, server running)
`test/bot.js` registers throwaway users, **creates its own isolated arenas via the admin API** (never join the default map in tests — live players may be there!), walks bots with the `walkTo` helper (respects the server speed clamp: ≤0.28 m per 50 ms step), and asserts 55 scenarios (combat, slots, C4 plant+defuse, groups, admin, live sign/map updates, bot AI). It cleans up its maps at the end. **Extend it for every new mechanic.**

### In-browser
- Console logs `[BomPixel] istemci surumu: vN` — first thing to check ("is this build current?").
- `window.__bpDebug.state()` → selfId, mapId, every remote's `{pos, target, hasPos, hp, inside, visible, slot}`. `__bpDebug.players/scene/c4Meshes` for deep pokes.
- ⚠️ **Browsers pause `requestAnimationFrame` in background tabs.** A screenshot/inspection of a *hidden* tab shows a frozen game — remotes stuck, positions stale. This is NOT a bug; verify in a focused tab. (This artifact once faked an "invisible players" bug for hours.)

### Server-side truth
- Admin API `GET /api/admin/live` (Bearer admin token) → every arena, player, K/D/HP.
- Headless probe pattern: small Node script with `socket.io-client` (devDependency) — login via `/api/login`, `join` an isolated map, print `snap` payloads. This bypasses all browser weirdness and shows exactly what the server emits.
- Windows quirk: to syntax-check ESM files, copy to `.mjs` then `node --check`.

---

## 7. Known pitfalls (learned the hard way — don't relearn)

| Pitfall | Lesson |
|---|---|
| Black screen after render changes | Second `renderer.render()` call clears the frame unless `autoClear=false` around it |
| Invisible-but-shooting entities | NaN leaked into positions (see §3.2). Check `snap` payload for `null` coords first |
| "Bug persists after my fix" | Stale browser cache (now mitigated by no-cache + BUILD tag) or you measured a **background tab** (rAF paused) |
| Test flakiness / interference | Tests must run in their own admin-created arenas; the default map may have live humans |
| Bots stuck/invisible in buildings | Wander targets must reject building interiors; `steerOutOfBuilding` walks them out the door — keep both |
| `node:sqlite` throws on bind | An `undefined` slipped into params — use `?? null`, booleans as 1/0 |
| Pointer lock exceptions | Always request via the `lockPointer()` wrapper (guarded promise), never raw `requestPointerLock()` |
| Esc menu unreachable | Menu opens on pointerlock loss; the Escape-keydown fallback (with 400 ms debounce vs lock-change) covers never-locked contexts — keep it |
| OneDrive-hosted repo | SQLite WAL files under OneDrive sync can be flaky; prefer excluding `data/` from sync, or move the repo for serious hosting |

---

## 8. Conventions

- **User-facing text: Turkish**, ASCII-leaning (`Gecersiz`, `Yukleme`). Code comments: short, Turkish or English.
- 2-space indent, semicolons, single quotes; plain functions over classes (only `PixelEditor` is a class).
- No new runtime dependencies without strong justification; **never** add a CDN/external request (breaks the self-contained guarantee).
- Escape all user content rendered to DOM via the local `esc()` helpers — usernames/group names are attacker-controlled.
- Keep `README.md` (EN) and `README.tr.md` (TR) in sync when features change; bump `BUILD` in `game3d.js`.
- Before "done": `npm test` green + a real browser sanity pass (focused tab!).

## 9. Current state & where to go next

Implemented: multi-arena, 3-slot loadout + shop, C4 (plant/defuse/knockback), sniper zoom, jump, minimap, HP bars, animated skin emoji, sticker damage bonuses, AI bots (3 difficulties, hard bots handle C4), groups/teams, live-editable maps & billboards, mobile controls, positional synth audio, match history, admin suite.

The community roadmap lives in `README.md` → *Roadmap* (game modes, grenades, chat, XP/ranks, community maps, settings menu, gamepad, PWA). Each entry there fits the recipes in §5.
