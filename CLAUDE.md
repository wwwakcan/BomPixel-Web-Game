# BomPixel — AI assistant notes

Read **[AI Development.md](AI%20Development.md)** first — it contains the architecture, hard invariants, pitfalls, data formats and recipes for this codebase.

Quick facts:
- Run: `npm start` (port 3000) · Test: `npm test` (server must be running; 55-scenario E2E, uses its own isolated arenas)
- Node ≥ 22.5 (built-in `node:sqlite`); DB at `data/bompixel.db` (gitignored — never commit)
- **Twin geometry rule:** `buildWalls`/`heightAt`/`insideBuilding` are duplicated in `server/game.js` and `public/js/world.js` — change both together
- **NaN rule:** guard every division (`|| 0.001`); nothing non-finite may reach a snapshot
- Bump `BUILD` in `public/js/game3d.js` on client changes; UI strings are Turkish
- Debug: browser console `__bpDebug.state()`; admin API `GET /api/admin/live`; background tabs pause rAF (frozen frames are not bugs)
