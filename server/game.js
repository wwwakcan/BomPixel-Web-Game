// BomPixel - sunucu otoriteli oyun dongusu (Socket.IO)
// Coklu arena: her harita ayri bir oda; oyuncu istedigi haritayi secip girer.
const { db, now } = require('./db');
const { userByToken } = require('./auth');

const TICK_MS = 50;              // 20 Hz
const ROUND_MS = 8 * 60 * 1000;  // 8 dk tur
const MOVE_SPEED = 6;
const PLAYER_R = 0.35, PLAYER_H = 1.8, EYE = 1.5;
const C4_TIMER = 35000, C4_PLANT_MS = 2500, C4_DEFUSE_MS = 4000, C4_COOLDOWN = 45000;
const C4_RADIUS = 50, DEFUSE_DIST = 2.0, DEFUSE_SCORE = 3; // yaricap 50m (cap 100m), yakinliga gore hasar

// ---------- geometri ----------
function heightAt(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= map.w || zi >= map.h) return 0;
  return map.height[zi * map.w + xi];
}
function tileType(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= map.w || zi >= map.h) return 0;
  return map.type[zi * map.w + xi];
}

function buildWalls(map) {
  const walls = [];
  const th = 0.35, BH = 3;
  const W = map.w, H = map.h;
  walls.push({ min: [-1, 0, -1], max: [W + 1, BH, 0] });
  walls.push({ min: [-1, 0, H], max: [W + 1, BH, H + 1] });
  walls.push({ min: [-1, 0, -1], max: [0, BH, H + 1] });
  walls.push({ min: [W, 0, -1], max: [W + 1, BH, H + 1] });
  for (const b of map.buildings) {
    const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.h, ht = b.ht;
    const dw = 1.5;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const seg = (side, a0, a1) => {
      if (a1 - a0 < 0.05) return;
      if (side === 'N') walls.push({ min: [a0, 0, z0], max: [a1, ht, z0 + th] });
      if (side === 'S') walls.push({ min: [a0, 0, z1 - th], max: [a1, ht, z1] });
      if (side === 'W') walls.push({ min: [x0, 0, a0], max: [x0 + th, ht, a1] });
      if (side === 'E') walls.push({ min: [x1 - th, 0, a0], max: [x1, ht, a1] });
    };
    for (const side of ['N', 'S', 'E', 'W']) {
      const horiz = (side === 'N' || side === 'S');
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      const c = horiz ? cx : cz;
      if (b.door === side) { seg(side, a0, c - dw / 2); seg(side, c + dw / 2, a1); }
      else seg(side, a0, a1);
    }
    walls.push({ min: [x0, ht, z0], max: [x1, ht + 0.3, z1], roof: true });
  }
  return walls;
}

function insideBuilding(map, x, z) {
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i];
    if (x > b.x + 0.4 && x < b.x + b.w - 0.4 && z > b.z + 0.4 && z < b.z + b.h - 0.4) return i;
  }
  return -1;
}

function segAABB(o, d, len, min, max) {
  let t0 = 0, t1 = len;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let ta = (min[i] - o[i]) / d[i], tb = (max[i] - o[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

function losBlocked(walls, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d) || 1;
  const dn = d.map(v => v / len);
  for (const w of walls) {
    const t = segAABB(a, dn, len, w.min, w.max);
    if (t != null && t < len - 0.05) return true;
  }
  return false;
}

// Sticker bonusu: her sticker +%4 hasar (en fazla 3)
function stickerMult(w) {
  const n = Math.min(3, (w && w.stickers ? w.stickers.length : 0));
  return 1 + 0.04 * n;
}

function createGame(io) {
  const arenas = new Map();     // mapId -> arena
  const online = new Map();     // userId -> Set(socket)
  const weaponTypes = new Map();

  function reloadWeaponTypes() {
    weaponTypes.clear();
    for (const t of db.prepare('SELECT * FROM weapon_types').all()) weaponTypes.set(t.id, t);
  }
  reloadWeaponTypes();

  const room = a => 'arena:' + a.id;

  function getArena(mapId) {
    let a = arenas.get(mapId);
    if (a) return a;
    const rowM = db.prepare('SELECT * FROM maps WHERE id=?').get(mapId);
    if (!rowM) return null;
    const map = JSON.parse(rowM.data);
    a = {
      id: rowM.id, name: rowM.name, map, walls: buildWalls(map),
      players: new Map(), projectiles: [], projSeq: 1,
      c4s: [], c4Seq: 1,
      roundStart: 0, roundEnd: 0, roundTimer: null
    };
    arenas.set(rowM.id, a);
    startRound(a, true);
    return a;
  }

  function defaultMapId() {
    const rowS = db.prepare('SELECT value FROM settings WHERE key=?').get('active_map');
    if (rowS) {
      const m = db.prepare('SELECT id FROM maps WHERE id=?').get(Number(rowS.value));
      if (m) return m.id;
    }
    const m = db.prepare('SELECT id FROM maps ORDER BY id LIMIT 1').get();
    return m ? m.id : null;
  }

  function spawnPoint(a) {
    const s = a.map.spawns && a.map.spawns.length
      ? a.map.spawns[Math.floor(Math.random() * a.map.spawns.length)]
      : [a.map.w / 2, a.map.h / 2];
    return { x: s[0], z: s[1] };
  }

  function respawn(a, p, silent) {
    const sp = spawnPoint(a);
    p.x = sp.x; p.z = sp.z; p.y = heightAt(a.map, sp.x, sp.z);
    p.hp = 100; p.lastMoveAt = now();
    p.planting = null; p.defusing = null;
    if (!silent) p.socket.emit('respawn', { pos: [p.x, p.y, p.z] });
  }

  // ---------- skor / tur ----------
  function scoreboard(a) {
    const list = [...a.players.values()].map(p => ({
      uid: p.uid, name: p.name, k: p.kills, d: p.deaths, group: p.groupName || null
    }));
    list.sort((x, y) => y.k - x.k || x.d - y.d);
    return list.slice(0, 10);
  }
  const broadcastScore = a => io.to(room(a)).emit('score', scoreboard(a));

  function startRound(a, silent) {
    a.roundStart = now();
    a.roundEnd = a.roundStart + ROUND_MS;
    a.c4s = [];
    for (const p of a.players.values()) { p.kills = 0; p.deaths = 0; respawn(a, p); }
    if (!silent) {
      io.to(room(a)).emit('roundStart', { endsAt: a.roundEnd, map: a.name });
      broadcastScore(a);
    }
    if (a.roundTimer) clearTimeout(a.roundTimer);
    a.roundTimer = setTimeout(() => endRound(a), ROUND_MS);
  }

  function endRound(a) {
    const scores = scoreboard(a);
    if (a.players.size > 0) {
      db.prepare('INSERT INTO matches (map_id,map_name,started_at,ended_at,scores) VALUES (?,?,?,?,?)')
        .run(a.id, a.name, a.roundStart, now(), JSON.stringify(scores));
    }
    io.to(room(a)).emit('roundEnd', { scores, nextIn: 6000 });
    if (a.roundTimer) clearTimeout(a.roundTimer);
    a.roundTimer = setTimeout(() => startRound(a), 6000);
  }

  // ---------- hasar ----------
  function damage(a, victim, dmg, attacker, weaponName, cause) {
    if (victim.hp <= 0) return;
    victim.hp -= dmg;
    victim.socket.emit('hitYou', { hp: Math.max(0, victim.hp), from: attacker ? [attacker.x, attacker.y, attacker.z] : null });
    if (attacker && attacker !== victim) attacker.socket.emit('hitConfirm', { dmg });
    if (victim.hp <= 0) {
      victim.deaths++;
      if (attacker && attacker !== victim) attacker.kills++;
      io.to(room(a)).emit('kill', {
        killer: attacker && attacker !== victim ? { name: attacker.name, uid: attacker.uid } : null,
        victim: { name: victim.name, uid: victim.uid },
        weapon: weaponName || null, cause: cause || 'silah'
      });
      respawn(a, victim);
      broadcastScore(a);
    }
  }

  const sameTeam = (x, y) => x.group != null && x.group === y.group;

  // ---------- ates ----------
  function fireBeam(a, p, o, d, stats, mult) {
    let bestT = stats.range, hitP = null;
    for (const w of a.walls) {
      const t = segAABB(o, d, stats.range, w.min, w.max);
      if (t != null && t < bestT) bestT = t;
    }
    for (let s = 1; s < stats.range; s += 0.75) {
      if (s >= bestT) break;
      const x = o[0] + d[0] * s, y = o[1] + d[1] * s, z = o[2] + d[2] * s;
      if (y <= heightAt(a.map, x, z)) { bestT = s; break; }
    }
    for (const q of a.players.values()) {
      if (q === p || q.hp <= 0 || sameTeam(p, q)) continue;
      const min = [q.x - PLAYER_R, q.y, q.z - PLAYER_R], max = [q.x + PLAYER_R, q.y + PLAYER_H, q.z + PLAYER_R];
      const t = segAABB(o, d, stats.range, min, max);
      if (t != null && t < bestT) { bestT = t; hitP = { q, t }; }
    }
    if (hitP) {
      const hy = o[1] + d[1] * hitP.t;
      const head = hy > hitP.q.y + 1.35;
      damage(a, hitP.q, Math.round(stats.dmg * mult * (head ? 1.5 : 1)), p, p.weapon.name);
    }
    const end = [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT];
    io.to(room(a)).emit('beam', { pid: p.id, from: o, to: end, color: p.weapon.color, anim: p.weapon.anim });
  }

  function fire(a, p, dir) {
    if (p.activeSlot > 2 || !p.weapon) return; // C4 ile ates edilmez
    const stats = weaponTypes.get(p.weapon.type);
    if (!stats) return;
    const t = now();
    if (t - p.lastFire < stats.rate * 0.85) return;
    p.lastFire = t;
    const mult = stickerMult(p.weapon);
    const o = [p.x, p.y + EYE, p.z];
    let d = dir.map(Number);
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / L, d[1] / L, d[2] / L];
    if (!d.every(isFinite) || !o.every(isFinite)) return;
    io.to(room(a)).emit('shot', { pid: p.id, o, d, anim: p.weapon.anim, color: p.weapon.color, wt: p.weapon.type });
    if (stats.beam) { fireBeam(a, p, o, d, stats, mult); return; }
    const n = Math.max(1, stats.pellets | 0);
    for (let i = 0; i < n; i++) {
      let dd = d;
      if (n > 1) {
        const s = 0.07;
        dd = [d[0] + (Math.random() - 0.5) * s * 2, d[1] + (Math.random() - 0.5) * s * 2, d[2] + (Math.random() - 0.5) * s * 2];
        const l = Math.hypot(...dd); dd = dd.map(v => v / l);
      }
      a.projectiles.push({
        id: a.projSeq++, owner: p.id,
        x: o[0], y: o[1], z: o[2], dx: dd[0], dy: dd[1], dz: dd[2],
        speed: stats.speed, left: stats.range, dmg: Math.round(stats.dmg * mult),
        wname: p.weapon.name, color: p.weapon.color
      });
    }
  }

  // ---------- botlar (yapay zeka) ----------
  const BOT_LEVELS = {
    kolay: { err: 0.17, range: 26, fireMult: 2.3, plant: 0.004, defuse: false, speed: 0.75 },
    normal: { err: 0.08, range: 40, fireMult: 1.5, plant: 0.010, defuse: false, speed: 0.9 },
    zor: { err: 0.032, range: 60, fireMult: 1.0, plant: 0.018, defuse: true, speed: 1.0 }
  };
  const BOT_NAMES = ['RoboCan', 'PikselAli', 'BotBerk', 'CipsiZeka', 'DevreDisi', 'VoltajVeli', 'BitBaran', 'SanalSelin'];
  let botUid = -100;
  const stubSocket = { emit() {}, join() {}, leave() {} };

  function botSkin(rnd) {
    const hue = Math.floor(rnd() * 360);
    const c = (h, s, l) => {
      const a2 = s * Math.min(l, 1 - l);
      const f = n => { const k = (n + h / 30) % 12; return Math.round((l - a2 * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0'); };
      return '#' + f(0) + f(8) + f(4);
    };
    const M = c(hue, 0.35, 0.55), D = c(hue, 0.4, 0.35), E = '#22ddff', A = c((hue + 40) % 360, 0.6, 0.5);
    const rows = [
      '....AAAA....', '...AAAAAA...', '...MMMMMM...', '...MEMMEM...', '...MMMMMM...', '...MMDDMM...',
      '....MMMM....', '..DDDDDDDD..', '.MDDDDDDDDM.', '.MDDAAAADDM.', '.MDDDDDDDDM.', '.MDDDDDDDDM.',
      '...DDDDDD...', '...DD..DD...', '...DD..DD...', '...DD..DD...', '...MM..MM...', '..MMM..MMM..'
    ];
    const px = [];
    for (const row of rows) for (const ch of row) px.push(ch === '.' ? null : ({ M, D, E, A }[ch] || M));
    return { w: 12, h: 18, px, emoji: '🤖', emojiAnim: 'zipla' };
  }

  // sunucu tarafi bot hareketi: duvar + basamak kontrolu
  function botBlocked(a, x, z, r = 0.32) {
    for (const w of a.walls) {
      if (w.roof || w.min[1] > 1.2) continue;
      if (x + r > w.min[0] && x - r < w.max[0] && z + r > w.min[2] && z - r < w.max[2]) return true;
    }
    return false;
  }
  function botMove(a, p, dx, dz) {
    if (!isFinite(dx) || !isFinite(dz)) return false; // NaN sizintisina karsi son savunma
    let nx = p.x + dx, nz = p.z + dz;
    const refH = Math.max(heightAt(a.map, p.x, p.z), p.y);
    if (botBlocked(a, nx, p.z) || heightAt(a.map, nx, p.z) - refH > 1.05) nx = p.x;
    if (botBlocked(a, nx, nz) || heightAt(a.map, nx, nz) - refH > 1.05) nz = p.z;
    const moved = Math.abs(nx - p.x) + Math.abs(nz - p.z) > 0.001;
    p.x = Math.min(a.map.w - 0.4, Math.max(0.4, nx));
    p.z = Math.min(a.map.h - 0.4, Math.max(0.4, nz));
    p.y = heightAt(a.map, p.x, p.z);
    return moved;
  }

  function makeBot(a, level) {
    const rnd = Math.random;
    const name = '🤖' + BOT_NAMES[Math.floor(rnd() * BOT_NAMES.length)] + Math.floor(rnd() * 90 + 10);
    const defaults = db.prepare('SELECT * FROM weapons WHERE owner_id IS NULL ORDER BY id').all().map(weaponRowToMeta);
    const slots = [defaults[Math.floor(rnd() * defaults.length)], defaults[0], defaults[1]];
    const sp = spawnPoint(a);
    const p = {
      id: 'bot:' + (botUid), uid: botUid--, isBot: true, level,
      socket: stubSocket, name,
      x: sp.x, y: heightAt(a.map, sp.x, sp.z), z: sp.z, yaw: 0, pitch: 0,
      hp: 100, kills: 0, deaths: 0, inside: -1,
      lastFire: 0, lastMoveAt: now(),
      skin: botSkin(rnd), slots, activeSlot: 0, weapon: slots[0],
      c4At: now() + 15000 + rnd() * 20000, planting: null, defusing: null,
      group: null, groupName: null,
      ai: { target: null, wx: sp.x, wz: sp.z, nextFire: 0, stuck: 0, lastX: sp.x, lastZ: sp.z, nextThink: 0 }
    };
    a.players.set(p.id, p);
    io.to(room(a)).emit('playerJoin', playerMeta(p));
    return p;
  }

  function setBots(a, count, level) {
    count = Math.max(0, Math.min(8, count | 0));
    if (!BOT_LEVELS[level]) level = 'normal';
    const bots = [...a.players.values()].filter(p => p.isBot);
    for (const b of bots) if (b.level !== level || bots.indexOf(b) >= count) {
      a.players.delete(b.id);
      io.to(room(a)).emit('playerLeave', { id: b.id });
    }
    let cur = [...a.players.values()].filter(p => p.isBot).length;
    while (cur < count) { makeBot(a, level); cur++; }
    broadcastScore(a);
  }

  function clearBots(a) {
    for (const p of [...a.players.values()]) if (p.isBot) {
      a.players.delete(p.id);
      io.to(room(a)).emit('playerLeave', { id: p.id });
    }
  }

  function pickWander(a, bot) {
    for (let t = 0; t < 12; t++) {
      const sp = a.map.spawns[Math.floor(Math.random() * a.map.spawns.length)] || [a.map.w / 2, a.map.h / 2];
      const x = Math.min(a.map.w - 2, Math.max(2, sp[0] + (Math.random() - 0.5) * 24));
      const z = Math.min(a.map.h - 2, Math.max(2, sp[1] + (Math.random() - 0.5) * 24));
      if (tileType(a.map, x, z) !== 2 && insideBuilding(a.map, x, z) === -1) { bot.ai.wx = x; bot.ai.wz = z; return; }
    }
  }

  // bina icinde kalan bot kapiya yonlenip disari cikar
  function steerOutOfBuilding(a, bot) {
    const b = a.map.buildings[bot.inside];
    if (!b) return false;
    const cx = b.x + b.w / 2, cz = b.z + b.h / 2;
    let ix, iz, ox, oz;
    if (b.door === 'N') { ix = cx; iz = b.z + 0.8; ox = cx; oz = b.z - 1.5; }
    else if (b.door === 'S') { ix = cx; iz = b.z + b.h - 0.8; ox = cx; oz = b.z + b.h + 1.5; }
    else if (b.door === 'W') { ix = b.x + 0.8; iz = cz; ox = b.x - 1.5; oz = cz; }
    else { ix = b.x + b.w - 0.8; iz = cz; ox = b.x + b.w + 1.5; oz = cz; }
    const nearDoor = Math.hypot(bot.x - ix, bot.z - iz) < 1.2;
    bot.ai.wx = nearDoor ? ox : ix;
    bot.ai.wz = nearDoor ? oz : iz;
    return true;
  }

  function aiTick() {
    const dt = 0.18;
    for (const a of arenas.values()) {
      const bots = [...a.players.values()].filter(p => p.isBot);
      if (!bots.length) continue;
      for (const bot of bots) {
        if (bot.hp <= 0) continue;
        const L = BOT_LEVELS[bot.level] || BOT_LEVELS.normal;
        const t = now();

        // C4 kuruyor: sabit dur
        if (bot.planting) {
          if (t - bot.planting.t >= C4_PLANT_MS) { bot.planting = null; plantC4(a, bot); }
          continue;
        }
        // C4 cozuyor
        if (bot.defusing) {
          const c4 = a.c4s.find(c => c.id === bot.defusing.id);
          if (!c4 || Math.hypot(bot.x - c4.x, bot.z - c4.z) > DEFUSE_DIST) { bot.defusing = null; }
          else if (t - bot.defusing.t >= C4_DEFUSE_MS) {
            bot.defusing = null;
            a.c4s = a.c4s.filter(c => c.id !== c4.id);
            bot.kills += DEFUSE_SCORE;
            io.to(room(a)).emit('c4Defused', { id: c4.id, by: bot.name, score: DEFUSE_SCORE });
            broadcastScore(a);
          }
          continue;
        }

        // hedef sec: gorunur en yakin dusman (insan onceligi)
        let target = null, bestD = L.range;
        for (const q of a.players.values()) {
          if (q === bot || q.hp <= 0) continue;
          const d = Math.hypot(q.x - bot.x, q.z - bot.z);
          const dScored = q.isBot ? d * 1.6 : d; // insanlari tercih et
          if (dScored < bestD) {
            if (!losBlocked(a.walls, [bot.x, bot.y + EYE, bot.z], [q.x, q.y + 1.1, q.z])) { bestD = dScored; target = q; }
          }
        }

        if (target) {
          const dx = target.x - bot.x, dz = target.z - bot.z;
          const dTrue = Math.hypot(dx, dz);
          const d = dTrue || 0.001; // sifira bolme = NaN = gorunmez bot! asla.
          bot.yaw = Math.atan2(-dx, -dz);
          // mesafeyi koru
          const spd = MOVE_SPEED * L.speed * dt;
          if (dTrue > 16) botMove(a, bot, dx / d * spd, dz / d * spd);
          else if (dTrue < 6) botMove(a, bot, -dx / d * spd * 0.7, -dz / d * spd * 0.7);
          else if (Math.random() < 0.3) { // yanlama
            botMove(a, bot, -dz / d * spd * 0.6 * (Math.random() < 0.5 ? 1 : -1), dx / d * spd * 0.6);
          }
          // ates
          if (t >= bot.ai.nextFire) {
            const stats = weaponTypes.get(bot.weapon.type);
            if (stats) {
              const dy = (target.y + 1.15) - (bot.y + EYE);
              let dir = [dx, dy, dz];
              const len = Math.hypot(...dir) || 0.001;
              dir = dir.map(v => v / len + (Math.random() - 0.5) * 2 * L.err);
              fire(a, bot, dir);
              bot.ai.nextFire = t + stats.rate * L.fireMult * (0.9 + Math.random() * 0.5);
            }
          }
        } else {
          // zor botlar dusman C4'unu cozmeye gider
          let targetC4 = null;
          if (L.defuse) {
            for (const c of a.c4s) {
              if (c.owner === bot.uid) continue;
              const d = Math.hypot(c.x - bot.x, c.z - bot.z);
              if (d < 30) { targetC4 = c; break; }
            }
          }
          if (targetC4) {
            const dx = targetC4.x - bot.x, dz = targetC4.z - bot.z;
            const d = Math.hypot(dx, dz) || 0.001;
            if (d <= DEFUSE_DIST * 0.8) bot.defusing = { id: targetC4.id, t };
            else { bot.yaw = Math.atan2(-dx, -dz); botMove(a, bot, dx / d * MOVE_SPEED * L.speed * dt, dz / d * MOVE_SPEED * L.speed * dt); }
          } else {
            // bina icindeyse once kapidan cik (gorunmez bot olmasin)
            bot.inside = insideBuilding(a.map, bot.x, bot.z);
            if (bot.inside >= 0) steerOutOfBuilding(a, bot);
            // dolan
            const dx = bot.ai.wx - bot.x, dz = bot.ai.wz - bot.z;
            const d = Math.hypot(dx, dz) || 0.001;
            if (d < 1.5) pickWander(a, bot);
            else {
              bot.yaw = Math.atan2(-dx, -dz);
              const moved = botMove(a, bot, dx / d * MOVE_SPEED * L.speed * dt, dz / d * MOVE_SPEED * L.speed * dt);
              if (!moved) { bot.ai.stuck += dt; if (bot.ai.stuck > 0.8) { bot.ai.stuck = 0; pickWander(a, bot); } }
              else bot.ai.stuck = 0;
            }
            // akilli botlar C4 kurar
            if (t > bot.c4At && Math.random() < L.plant) {
              bot.planting = { t };
            }
          }
        }
        // suya dogru gidiyorsa rota degistir
        const aheadX = bot.x - Math.sin(bot.yaw) * 1.2, aheadZ = bot.z - Math.cos(bot.yaw) * 1.2;
        if (tileType(a.map, aheadX, aheadZ) === 2) pickWander(a, bot);
      }
    }
  }
  setInterval(aiTick, 180);

  function plantC4(a, p) {
    p.c4At = now() + C4_COOLDOWN;
    const c4 = {
      id: a.c4Seq++, x: p.x, y: heightAt(a.map, p.x, p.z), z: p.z,
      owner: p.uid, ownerName: p.name, group: p.group,
      explodeAt: now() + C4_TIMER
    };
    a.c4s.push(c4);
    p.socket.emit('c4Status', { readyAt: p.c4At });
    io.to(room(a)).emit('c4Planted', {
      i: c4.id, p: [c4.x, c4.y, c4.z], t: c4.explodeAt, g: c4.group, o: c4.owner, by: p.name
    });
  }

  // ---------- C4 ----------
  function explodeC4(a, c4) {
    io.to(room(a)).emit('c4Exploded', { id: c4.id, pos: [c4.x, c4.y, c4.z], radius: C4_RADIUS });
    const planter = [...a.players.values()].find(p => p.uid === c4.owner) || null;
    for (const q of a.players.values()) {
      if (q.hp <= 0) continue;
      if (planter && q !== planter && sameTeam(planter, q)) continue;
      const d = Math.hypot(q.x - c4.x, (q.y + 0.9) - (c4.y + 0.2), q.z - c4.z);
      if (d > C4_RADIUS) continue;
      // yakinsa kesin olum, uzaklastikca azalan hasar (50m'de ~15)
      let dmg = d < 8 ? 200 : Math.max(15, Math.round(200 - (d - 8) * (185 / (C4_RADIUS - 8))));
      if (losBlocked(a.walls, [c4.x, c4.y + 0.3, c4.z], [q.x, q.y + 0.9, q.z])) dmg = Math.round(dmg * 0.4);
      damage(a, q, dmg, planter, 'C4', 'c4');
    }
  }

  // ---------- tick ----------
  function tick() {
    for (const a of arenas.values()) {
      if (a.players.size === 0 && a.projectiles.length === 0 && a.c4s.length === 0) continue;
      const dt = TICK_MS / 1000;

      // mermiler
      const alive = [];
      for (const pr of a.projectiles) {
        const step = Math.min(pr.speed * dt, pr.left);
        const o = [pr.x, pr.y, pr.z], d = [pr.dx, pr.dy, pr.dz];
        let bestT = step, hit = null, hitWall = false;
        for (const w of a.walls) {
          const t = segAABB(o, d, step, w.min, w.max);
          if (t != null && t < bestT) { bestT = t; hitWall = true; hit = null; }
        }
        for (let s = 0.4; s <= step; s += 0.4) {
          if (s >= bestT) break;
          const x = o[0] + d[0] * s, y = o[1] + d[1] * s, z = o[2] + d[2] * s;
          if (y <= heightAt(a.map, x, z)) { bestT = s; hitWall = true; hit = null; break; }
        }
        const owner = a.players.get(pr.owner);
        for (const q of a.players.values()) {
          if (q.id === pr.owner || q.hp <= 0) continue;
          if (owner && sameTeam(owner, q)) continue;
          const min = [q.x - PLAYER_R, q.y, q.z - PLAYER_R], max = [q.x + PLAYER_R, q.y + PLAYER_H, q.z + PLAYER_R];
          const t = segAABB(o, d, step, min, max);
          if (t != null && t < bestT) { bestT = t; hit = q; hitWall = false; }
        }
        if (hit) {
          const hy = o[1] + d[1] * bestT;
          const head = hy > hit.y + 1.35;
          damage(a, hit, head ? Math.round(pr.dmg * 1.5) : pr.dmg, owner || null, pr.wname);
          continue;
        }
        if (hitWall) continue;
        pr.x += d[0] * step; pr.y += d[1] * step; pr.z += d[2] * step;
        pr.left -= step;
        if (pr.left > 0.01 && pr.y > -2) alive.push(pr);
      }
      a.projectiles = alive;

      // C4 zamanlayicilari
      for (let i = a.c4s.length - 1; i >= 0; i--) {
        if (now() >= a.c4s[i].explodeAt) {
          const c4 = a.c4s[i];
          a.c4s.splice(i, 1);
          explodeC4(a, c4);
        }
      }

      // oyuncular: NaN kurtarma + su olumu + bina ici
      for (const p of a.players.values()) {
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) { respawn(a, p); continue; } // bozulan konumu iyilestir
        p.inside = insideBuilding(a.map, p.x, p.z);
        if (p.hp > 0 && p.y <= 0.2 && tileType(a.map, p.x, p.z) === 2) {
          damage(a, p, 1000, null, null, 'su');
          io.to(room(a)).emit('splash', { pos: [p.x, 0, p.z] });
        }
      }

      // anlik goruntu
      const players = [];
      for (const p of a.players.values()) {
        players.push({
          i: p.id, p: [round2(p.x), round2(p.y), round2(p.z)],
          y: round2(p.yaw), pi: round2(p.pitch),
          h: p.hp, k: p.kills, d: p.deaths, in: p.inside, s: p.activeSlot
        });
      }
      const proj = a.projectiles.map(pr => ({ i: pr.id, p: [round2(pr.x), round2(pr.y), round2(pr.z)], c: pr.color }));
      const c4 = a.c4s.map(c => ({ i: c.id, p: [round2(c.x), round2(c.y), round2(c.z)], t: c.explodeAt, g: c.group, o: c.owner }));
      io.to(room(a)).emit('snap', { t: now(), players, proj, c4 });
    }
  }
  const round2 = v => isFinite(v) ? Math.round(v * 100) / 100 : 0; // NaN asla yayinlanmaz
  setInterval(tick, TICK_MS);

  // ---------- silah yukleme ----------
  function weaponRowToMeta(w) {
    return {
      id: w.id, name: w.name, type: w.type, skin: JSON.parse(w.skin),
      anim: w.anim, color: w.color,
      stickers: w.stickers ? JSON.parse(w.stickers) : []
    };
  }

  function loadSlots(user) {
    const defaults = db.prepare('SELECT * FROM weapons WHERE owner_id IS NULL ORDER BY id LIMIT 3').all();
    let ids = null;
    try { ids = user.loadout ? JSON.parse(user.loadout) : null; } catch (e) {}
    const slots = [];
    for (let i = 0; i < 3; i++) {
      let w = null;
      if (ids && ids[i] != null)
        w = db.prepare('SELECT * FROM weapons WHERE id=? AND (owner_id IS NULL OR owner_id=?)').get(ids[i], user.id);
      if (!w) w = defaults[i] || defaults[0];
      slots.push(weaponRowToMeta(w));
    }
    return slots;
  }

  function playerMeta(p) {
    return {
      id: p.id, uid: p.uid, name: p.name, skin: p.skin, bot: !!p.isBot,
      slots: p.slots.map(w => ({ name: w.name, type: w.type, skin: w.skin, anim: w.anim, color: w.color, stickers: w.stickers })),
      activeSlot: p.activeSlot,
      group: p.group, groupName: p.groupName
    };
  }

  // ---------- baglanti ----------
  io.on('connection', (socket) => {
    const user = userByToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!user) { socket.emit('authError'); socket.disconnect(true); return; }
    socket.data.uid = user.id;
    socket.data.uname = user.username;

    if (!online.has(user.id)) online.set(user.id, new Set());
    online.get(user.id).add(socket);
    io.emit('presence', { uid: user.id, name: user.username, on: true });
    socket.emit('onlineList', onlineList());

    let arena = null; // bu soketin arenasi

    socket.on('join', (m) => {
      leaveArena();
      const mapId = (m && m.mapId) ? Number(m.mapId) : defaultMapId();
      arena = getArena(mapId) || getArena(defaultMapId());
      if (!arena) return;
      const a = arena;
      const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      const skinRow = db.prepare('SELECT data FROM skins WHERE user_id=?').get(user.id);
      let group = null, groupName = null;
      if (fresh.active_group != null) {
        const gm = db.prepare('SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id=g.id WHERE g.id=? AND m.user_id=?')
          .get(fresh.active_group, user.id);
        if (gm) { group = gm.id; groupName = gm.name; }
      }
      const sp = spawnPoint(a);
      const p = {
        id: socket.id, socket, uid: user.id, name: user.username,
        x: sp.x, y: heightAt(a.map, sp.x, sp.z), z: sp.z, yaw: 0, pitch: 0,
        hp: 100, kills: 0, deaths: 0, inside: -1,
        lastFire: 0, lastMoveAt: now(),
        skin: skinRow ? JSON.parse(skinRow.data) : null,
        slots: loadSlots(fresh), activeSlot: 0,
        c4At: 0, planting: null, defusing: null,
        group, groupName
      };
      p.weapon = p.slots[0];
      a.players.set(socket.id, p);
      socket.join(room(a));
      socket.emit('welcome', {
        selfId: socket.id, map: a.map, mapName: a.name, mapId: a.id,
        weaponTypes: [...weaponTypes.values()],
        players: [...a.players.values()].map(playerMeta),
        spawn: [p.x, p.y, p.z],
        round: { endsAt: a.roundEnd },
        c4: { readyAt: p.c4At },
        c4s: a.c4s.map(c => ({ i: c.id, p: [c.x, c.y, c.z], t: c.explodeAt, g: c.group, o: c.owner }))
      });
      socket.to(room(a)).emit('playerJoin', playerMeta(p));
      broadcastScore(a);
      // giris ekraninda secilen botlari kur
      if (m && m.bots != null) setBots(a, Number(m.bots), String(m.botLevel || 'normal'));
    });

    socket.on('leaveArena', () => leaveArena());
    function leaveArena() {
      if (!arena) return;
      const a = arena;
      if (a.players.has(socket.id)) {
        a.players.delete(socket.id);
        socket.leave(room(a));
        io.to(room(a)).emit('playerLeave', { id: socket.id });
        broadcastScore(a);
      }
      // insan kalmadiysa botlari ve C4'leri temizle
      const humans = [...a.players.values()].filter(p => !p.isBot).length;
      if (humans === 0) { clearBots(a); a.c4s = []; a.projectiles = []; }
      arena = null;
    }

    const me = () => arena ? arena.players.get(socket.id) : null;

    socket.on('input', (m) => {
      const p = me();
      if (!p || !m || !Array.isArray(m.p)) return;
      const a = arena;
      let [x, y, z] = m.p.map(Number);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
      const t = now(), dts = Math.max(0.02, (t - p.lastMoveAt) / 1000);
      const maxD = MOVE_SPEED * dts * 1.8 + 0.5;
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxD) { const f = maxD / dist; x = p.x + dx * f; z = p.z + dz * f; }
      x = Math.min(a.map.w - 0.3, Math.max(0.3, x));
      z = Math.min(a.map.h - 0.3, Math.max(0.3, z));
      // hareket kurma/cozmeyi iptal eder
      if (dist > 0.4) {
        if (p.planting) { p.planting = null; socket.emit('actionCancel', { what: 'plant' }); }
        if (p.defusing) { p.defusing = null; socket.emit('actionCancel', { what: 'defuse' }); }
      }
      p.x = x; p.z = z;
      const gh = heightAt(a.map, x, z);
      p.y = Math.max(0, Math.min(y, gh + 1.9)); // ziplama payi
      p.yaw = Number(m.y) || 0; p.pitch = Number(m.pi) || 0;
      p.lastMoveAt = t;
    });

    socket.on('fire', (m) => {
      const p = me();
      if (!p || p.hp <= 0 || !m || !Array.isArray(m.d)) return;
      fire(arena, p, m.d);
    });

    socket.on('switchSlot', (m) => {
      const p = me();
      if (!p) return;
      const slot = Number(m && m.slot);
      if (!(slot >= 0 && slot <= 3)) return;
      p.activeSlot = slot;
      p.weapon = slot < 3 ? p.slots[slot] : null;
      p.planting = null; p.defusing = null;
      const w = slot < 3 ? p.slots[slot] : null;
      socket.to(room(arena)).emit('playerSwitch', {
        id: p.id, slot,
        weapon: w ? { name: w.name, type: w.type, skin: w.skin, anim: w.anim, color: w.color, stickers: w.stickers } : null
      });
    });

    // Magazadan (B) yukleme degistirilince slotlari canli yenile
    socket.on('reloadSlots', () => {
      const p = me();
      if (!p) return;
      const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      p.slots = loadSlots(fresh);
      p.weapon = p.activeSlot < 3 ? p.slots[p.activeSlot] : null;
      io.to(room(arena)).emit('playerSlots', {
        id: p.id,
        slots: p.slots.map(w => ({ name: w.name, type: w.type, skin: w.skin, anim: w.anim, color: w.color, stickers: w.stickers }))
      });
    });

    // ---- C4 kurma ----
    socket.on('plantStart', () => {
      const p = me();
      if (!p || p.hp <= 0 || p.activeSlot !== 3) return;
      if (now() < p.c4At) return;
      p.planting = { t: now(), x: p.x, z: p.z };
    });
    socket.on('plantDone', () => {
      const p = me();
      if (!p || !p.planting || p.activeSlot !== 3) return;
      const el = now() - p.planting.t;
      const moved = Math.hypot(p.x - p.planting.x, p.z - p.planting.z);
      if (el < C4_PLANT_MS - 300 || moved > 0.9) { p.planting = null; return; }
      p.planting = null;
      plantC4(arena, p);
    });
    socket.on('plantCancel', () => { const p = me(); if (p) p.planting = null; });

    // ---- C4 cozme ----
    function nearC4(p, id) {
      const c4 = arena.c4s.find(c => c.id === Number(id));
      if (!c4) return null;
      if (c4.owner === p.uid) return null;
      if (p.group != null && c4.group != null && p.group === c4.group) return null;
      if (Math.hypot(p.x - c4.x, p.z - c4.z) > DEFUSE_DIST) return null;
      return c4;
    }
    socket.on('defuseStart', (m) => {
      const p = me();
      if (!p || p.hp <= 0) return;
      const c4 = nearC4(p, m && m.id);
      if (!c4) return;
      p.defusing = { id: c4.id, t: now() };
    });
    socket.on('defuseDone', (m) => {
      const p = me();
      if (!p || !p.defusing || p.defusing.id !== Number(m && m.id)) return;
      const a = arena;
      if (now() - p.defusing.t < C4_DEFUSE_MS - 300) { p.defusing = null; return; }
      const c4 = nearC4(p, p.defusing.id);
      p.defusing = null;
      if (!c4) return;
      a.c4s = a.c4s.filter(c => c.id !== c4.id);
      p.kills += DEFUSE_SCORE;
      io.to(room(a)).emit('c4Defused', { id: c4.id, by: p.name, score: DEFUSE_SCORE });
      broadcastScore(a);
    });
    socket.on('defuseCancel', () => { const p = me(); if (p) p.defusing = null; });

    // Oyun icinden grup daveti
    socket.on('inviteUser', (m, cb) => {
      try {
        const toUid = Number(m && m.toUid);
        const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        let gid = m && m.groupId ? Number(m.groupId) : fresh.active_group;
        if (gid == null) {
          const own = db.prepare('SELECT group_id FROM group_members WHERE user_id=? ORDER BY joined_at LIMIT 1').get(user.id);
          gid = own ? own.group_id : null;
        }
        if (toUid < 0) return cb && cb({ error: 'Botlar gruba katilamaz. 🤖' });
        if (gid == null) return cb && cb({ error: 'Once bir grup kurun veya katilin.' });
        const membership = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, user.id);
        if (!membership) return cb && cb({ error: 'Bu grubun uyesi degilsiniz.' });
        if (toUid === user.id) return cb && cb({ error: 'Kendinizi davet edemezsiniz.' });
        const target = db.prepare('SELECT id,username FROM users WHERE id=?').get(toUid);
        if (!target) return cb && cb({ error: 'Kullanici bulunamadi.' });
        if (db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, toUid))
          return cb && cb({ error: 'Zaten grupta.' });
        if (db.prepare("SELECT 1 FROM invites WHERE group_id=? AND to_id=? AND status='pending'").get(gid, toUid))
          return cb && cb({ error: 'Zaten bekleyen davet var.' });
        const g = db.prepare('SELECT name FROM groups WHERE id=?').get(gid);
        const r = db.prepare("INSERT INTO invites (group_id,from_id,to_id,status,created_at) VALUES (?,?,?, 'pending',?)")
          .run(gid, user.id, toUid, now());
        notifyUser(toUid, 'invite', { id: Number(r.lastInsertRowid), group: g.name, groupId: gid, from: user.username });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ error: 'Davet gonderilemedi.' }); }
    });

    socket.on('disconnect', () => {
      leaveArena();
      const set = online.get(user.id);
      if (set) { set.delete(socket); if (set.size === 0) online.delete(user.id); }
      if (!online.has(user.id)) io.emit('presence', { uid: user.id, name: user.username, on: false });
      db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(now(), user.id);
    });
  });

  // ---------- REST kancalari ----------
  function onlineList() {
    return [...online.keys()].map(uid => {
      const s = [...online.get(uid)][0];
      return { uid, name: s ? s.data.uname : '?' };
    });
  }
  function notifyUser(uid, ev, data) {
    const set = online.get(uid);
    if (set) for (const s of set) s.emit(ev, data);
  }

  function mapPlayerCounts() {
    const counts = {};
    for (const a of arenas.values())
      counts[a.id] = [...a.players.values()].filter(p => !p.isBot).length;
    return counts;
  }

  // Harita kaydedildiginde acik arenayi canli guncelle
  function reloadMap(mapId) {
    const a = arenas.get(Number(mapId));
    if (!a) return;
    const rowM = db.prepare('SELECT * FROM maps WHERE id=?').get(a.id);
    if (!rowM) return;
    a.map = JSON.parse(rowM.data);
    a.name = rowM.name;
    a.walls = buildWalls(a.map);
    a.projectiles = []; a.c4s = [];
    io.to(room(a)).emit('mapChange', { map: a.map, name: a.name });
    for (const p of a.players.values()) respawn(a, p);
  }

  function updateSign(mapId, sign) {
    const rowM = db.prepare('SELECT * FROM maps WHERE id=?').get(Number(mapId));
    if (!rowM) return false;
    const map = JSON.parse(rowM.data);
    map.signs = map.signs || [];
    const i = map.signs.findIndex(s => s.id === sign.id);
    if (i >= 0) map.signs[i] = { ...map.signs[i], ...sign }; else map.signs.push(sign);
    db.prepare('UPDATE maps SET data=? WHERE id=?').run(JSON.stringify(map), rowM.id);
    const a = arenas.get(rowM.id);
    if (a) {
      a.map.signs = map.signs;
      io.to(room(a)).emit('signUpdate', map.signs[i >= 0 ? i : map.signs.length - 1]);
    }
    return true;
  }

  function live() {
    const arenaList = [...arenas.values()].map(a => ({
      mapId: a.id, name: a.name, players: a.players.size,
      roundEndsAt: a.roundEnd,
      list: [...a.players.values()].map(p => ({ name: p.name, k: p.kills, d: p.deaths, hp: p.hp }))
    }));
    return {
      online: onlineList().length,
      inArena: arenaList.reduce((s, a) => s + a.players, 0),
      arenas: arenaList,
      defaultMapId: defaultMapId()
    };
  }

  function arenaHasPlayers(mapId) {
    const a = arenas.get(Number(mapId));
    return a ? a.players.size > 0 : false;
  }
  function dropArena(mapId) { arenas.delete(Number(mapId)); }

  // varsayilan haritayi onceden ayaga kaldir
  const dm = defaultMapId();
  if (dm != null) getArena(dm);

  return {
    reloadWeaponTypes, updateSign, live, reloadMap,
    mapPlayerCounts, arenaHasPlayers, dropArena,
    onlineUids: () => new Set(online.keys()),
    notifyUser,
    restartRound: () => { for (const a of arenas.values()) if (a.players.size) endRound(a); },
    isOnline: uid => online.has(uid)
  };
}

module.exports = { createGame, buildWalls };
