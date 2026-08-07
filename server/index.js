// BomPixel - ana sunucu
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { db, now } = require('./db');
const { register, login, publicUser, authMiddleware } = require('./auth');
const { createGame } = require('./game');
const { createAdminApi } = require('./adminApi');

// three.js modullerini public/vendor'a kopyala (CDN'siz, tamamen yerel)
const VENDOR = path.join(__dirname, '..', 'public', 'vendor');
if (!fs.existsSync(VENDOR)) fs.mkdirSync(VENDOR, { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) {
  const src = path.join(__dirname, '..', 'node_modules', 'three', 'build', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(VENDOR, f));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 3e6 });

app.use(express.json({ limit: '4mb' }));
// no-cache: JS/CSS her yuklemede sunucuyla dogrulanir (eski surum onbellekte kalmasin)
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

const game = createGame(io);
app.use('/api/admin', createAdminApi(game));

// ---------------- kimlik ----------------
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body || {};
  const r = register(username, email, password);
  if (r.error) return res.status(400).json({ error: r.error });
  const l = login(username, password);
  res.json(l);
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const r = login(username, password);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// ---------------- profil ----------------
function groupsOf(userId) {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.owner_id, m.role FROM groups g
    JOIN group_members m ON m.group_id = g.id WHERE m.user_id=?`).all(userId);
  const online = game.onlineUids();
  return rows.map(g => {
    const members = db.prepare(`
      SELECT u.id, u.username, m.role FROM group_members m
      JOIN users u ON u.id = m.user_id WHERE m.group_id=? ORDER BY m.role DESC, u.username`).all(g.id);
    return {
      id: g.id, name: g.name, myRole: g.role, ownerId: g.owner_id,
      members: members.map(m => ({ uid: m.id, name: m.username, role: m.role, online: online.has(m.id) }))
    };
  });
}

function myInvites(userId) {
  return db.prepare(`
    SELECT i.id, i.group_id AS groupId, g.name AS groupName, u.username AS fromName
    FROM invites i JOIN groups g ON g.id=i.group_id JOIN users u ON u.id=i.from_id
    WHERE i.to_id=? AND i.status='pending' ORDER BY i.id DESC`).all(userId);
}

function myWeapons(userId) {
  return db.prepare('SELECT id,owner_id,name,type,skin,anim,color,stickers FROM weapons WHERE owner_id IS NULL OR owner_id=? ORDER BY owner_id IS NOT NULL, id')
    .all(userId).map(w => ({
      ...w, skin: JSON.parse(w.skin), mine: w.owner_id === userId,
      stickers: w.stickers ? JSON.parse(w.stickers) : []
    }));
}

function resolveLoadout(user, weapons) {
  const defaults = weapons.filter(w => !w.mine).slice(0, 3);
  let ids = null;
  try { ids = user.loadout ? JSON.parse(user.loadout) : null; } catch (e) {}
  const slots = [];
  for (let i = 0; i < 3; i++) {
    let w = ids && ids[i] != null ? weapons.find(x => x.id === ids[i]) : null;
    slots.push((w || defaults[i] || defaults[0] || null));
  }
  return slots.map(w => w ? w.id : null);
}

app.get('/api/me', authMiddleware, (req, res) => {
  const skin = db.prepare('SELECT data FROM skins WHERE user_id=?').get(req.user.id);
  const weapons = myWeapons(req.user.id);
  res.json({
    user: publicUser(req.user),
    skin: skin ? JSON.parse(skin.data) : null,
    weapons,
    loadout: resolveLoadout(req.user, weapons),
    weaponTypes: db.prepare('SELECT * FROM weapon_types').all(),
    groups: groupsOf(req.user.id),
    invites: myInvites(req.user.id)
  });
});

// ---------------- haritalar (oyuncu secimi icin) ----------------
app.get('/api/maps', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id,name,w,h FROM maps ORDER BY id').all();
  const counts = game.mapPlayerCounts();
  const live = game.live();
  res.json({
    maps: rows.map(m => ({ ...m, players: counts[m.id] || 0, isDefault: m.id === live.defaultMapId }))
  });
});

// ---------------- yukleme (3 silahlik loadout) ----------------
app.post('/api/loadout', authMiddleware, (req, res) => {
  const slots = req.body && req.body.slots;
  if (!Array.isArray(slots) || slots.length !== 3)
    return res.status(400).json({ error: '3 silah secmelisiniz.' });
  for (const id of slots) {
    const w = db.prepare('SELECT id FROM weapons WHERE id=? AND (owner_id IS NULL OR owner_id=?)').get(Number(id), req.user.id);
    if (!w) return res.status(400).json({ error: 'Gecersiz silah secimi.' });
  }
  db.prepare('UPDATE users SET loadout=? WHERE id=?').run(JSON.stringify(slots.map(Number)), req.user.id);
  res.json({ ok: true });
});

// ---------------- skin ----------------
function validGrid(g, maxW, maxH) {
  return g && Number.isInteger(g.w) && Number.isInteger(g.h) && g.w > 0 && g.h > 0 &&
    g.w <= maxW && g.h <= maxH && Array.isArray(g.px) && g.px.length === g.w * g.h &&
    g.px.every(c => c === null || /^#[0-9a-fA-F]{6}$/.test(c));
}

const EMOJI_ANIMS = ['zipla', 'don', 'buyu'];

app.post('/api/skin', authMiddleware, (req, res) => {
  const g = req.body && req.body.data;
  if (!validGrid(g, 24, 32)) return res.status(400).json({ error: 'Gecersiz skin verisi.' });
  // hareketli emoji alanlari (istege bagli)
  const clean = { w: g.w, h: g.h, px: g.px };
  if (typeof g.emoji === 'string' && g.emoji.trim() && g.emoji.length <= 8) {
    clean.emoji = g.emoji.trim();
    clean.emojiAnim = EMOJI_ANIMS.includes(g.emojiAnim) ? g.emojiAnim : 'zipla';
  }
  db.prepare('INSERT INTO skins (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .run(req.user.id, JSON.stringify(clean), now());
  res.json({ ok: true });
});

// ---------------- silahlar ----------------
function validStickers(st) {
  return Array.isArray(st) && st.length <= 3 &&
    st.every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 8);
}

app.post('/api/weapons', authMiddleware, (req, res) => {
  const { name, type, skin, anim, color, stickers } = req.body || {};
  const t = db.prepare('SELECT id FROM weapon_types WHERE id=?').get(String(type || ''));
  if (!t) return res.status(400).json({ error: 'Gecersiz silah tipi.' });
  if (!validGrid(skin, 24, 16)) return res.status(400).json({ error: 'Gecersiz silah skini.' });
  if (!['klasik', 'alev', 'lazer', 'enerji'].includes(anim)) return res.status(400).json({ error: 'Gecersiz ates animasyonu.' });
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color || ''))) return res.status(400).json({ error: 'Gecersiz renk.' });
  const st = validStickers(stickers) ? stickers.map(s => s.trim()) : [];
  const nm = String(name || 'Silahim').slice(0, 24);
  const count = db.prepare('SELECT COUNT(*) c FROM weapons WHERE owner_id=?').get(req.user.id).c;
  if (count >= 12) return res.status(400).json({ error: 'En fazla 12 ozel silah yapabilirsiniz.' });
  const r = db.prepare('INSERT INTO weapons (owner_id,name,type,skin,anim,color,stickers,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.user.id, nm, String(type), JSON.stringify(skin), anim, color, JSON.stringify(st), now());
  db.prepare('UPDATE users SET selected_weapon=? WHERE id=?').run(Number(r.lastInsertRowid), req.user.id);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

// Kendi silahina animasyonlu sticker ekle/degistir (her sticker +%4 hasar, max 3)
app.post('/api/weapons/:id/stickers', authMiddleware, (req, res) => {
  const w = db.prepare('SELECT id FROM weapons WHERE id=? AND owner_id=?').get(Number(req.params.id), req.user.id);
  if (!w) return res.status(404).json({ error: 'Sadece kendi silahiniza sticker yapistirabilirsiniz.' });
  const st = req.body && req.body.stickers;
  if (!validStickers(st)) return res.status(400).json({ error: 'En fazla 3 emoji sticker.' });
  db.prepare('UPDATE weapons SET stickers=? WHERE id=?').run(JSON.stringify(st.map(s => s.trim())), w.id);
  res.json({ ok: true });
});

app.delete('/api/weapons/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM weapons WHERE id=? AND owner_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

app.post('/api/select-weapon', authMiddleware, (req, res) => {
  const id = Number(req.body && req.body.id);
  const w = db.prepare('SELECT id FROM weapons WHERE id=? AND (owner_id IS NULL OR owner_id=?)').get(id, req.user.id);
  if (!w) return res.status(400).json({ error: 'Silah bulunamadi.' });
  db.prepare('UPDATE users SET selected_weapon=? WHERE id=?').run(id, req.user.id);
  res.json({ ok: true });
});

// ---------------- gruplar ----------------
app.post('/api/groups', authMiddleware, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 20);
  if (name.length < 2) return res.status(400).json({ error: 'Grup adi en az 2 karakter olmali.' });
  const mine = db.prepare('SELECT COUNT(*) c FROM groups WHERE owner_id=?').get(req.user.id).c;
  if (mine >= 5) return res.status(400).json({ error: 'En fazla 5 grup kurabilirsiniz.' });
  const r = db.prepare('INSERT INTO groups (name,owner_id,created_at) VALUES (?,?,?)').run(name, req.user.id, now());
  const gid = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id,user_id,role,joined_at) VALUES (?,?,'owner',?)").run(gid, req.user.id, now());
  db.prepare('UPDATE users SET active_group=? WHERE id=?').run(gid, req.user.id);
  res.json({ ok: true, id: gid });
});

app.get('/api/groups', authMiddleware, (req, res) => {
  res.json({ groups: groupsOf(req.user.id), activeGroup: req.user.active_group });
});

app.post('/api/groups/:id/activate', authMiddleware, (req, res) => {
  const gid = Number(req.params.id);
  if (gid === 0) { // tekil oyna
    db.prepare('UPDATE users SET active_group=NULL WHERE id=?').run(req.user.id);
    return res.json({ ok: true });
  }
  const m = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
  if (!m) return res.status(400).json({ error: 'Bu grubun uyesi degilsiniz.' });
  db.prepare('UPDATE users SET active_group=? WHERE id=?').run(gid, req.user.id);
  res.json({ ok: true });
});

function notifyGroup(gid, skipUid) {
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(gid);
  for (const m of members) if (m.user_id !== skipUid) game.notifyUser(m.user_id, 'groupUpdate', {});
}

app.post('/api/groups/:id/leave', authMiddleware, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return res.status(404).json({ error: 'Grup yok.' });
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, req.user.id);
  db.prepare('UPDATE users SET active_group=NULL WHERE id=? AND active_group=?').run(req.user.id, gid);
  if (g.owner_id === req.user.id) {
    const next = db.prepare('SELECT user_id FROM group_members WHERE group_id=? ORDER BY joined_at LIMIT 1').get(gid);
    if (next) {
      db.prepare('UPDATE groups SET owner_id=? WHERE id=?').run(next.user_id, gid);
      db.prepare("UPDATE group_members SET role='owner' WHERE group_id=? AND user_id=?").run(gid, next.user_id);
    } else {
      db.prepare('DELETE FROM groups WHERE id=?').run(gid);
      db.prepare('DELETE FROM invites WHERE group_id=?').run(gid);
    }
  }
  notifyGroup(gid, null);
  res.json({ ok: true });
});

app.post('/api/groups/:id/kick', authMiddleware, (req, res) => {
  const gid = Number(req.params.id), target = Number(req.body && req.body.uid);
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g || g.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece grup yoneticisi atabilir.' });
  if (target === req.user.id) return res.status(400).json({ error: 'Kendinizi atamazsiniz.' });
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, target);
  db.prepare('UPDATE users SET active_group=NULL WHERE id=? AND active_group=?').run(target, gid);
  game.notifyUser(target, 'groupUpdate', {});
  notifyGroup(gid, null);
  res.json({ ok: true });
});

// ---------------- davetler ----------------
app.post('/api/invites', authMiddleware, (req, res) => {
  const gid = Number(req.body && req.body.groupId);
  const toName = String((req.body && req.body.toUsername) || '').trim();
  const m = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
  if (!m) return res.status(403).json({ error: 'Bu grubun uyesi degilsiniz.' });
  const target = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?)').get(toName);
  if (!target) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Kendinizi davet edemezsiniz.' });
  if (db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, target.id))
    return res.status(400).json({ error: 'Zaten grupta.' });
  if (db.prepare("SELECT 1 FROM invites WHERE group_id=? AND to_id=? AND status='pending'").get(gid, target.id))
    return res.status(400).json({ error: 'Zaten bekleyen davet var.' });
  const g = db.prepare('SELECT name FROM groups WHERE id=?').get(gid);
  const r = db.prepare("INSERT INTO invites (group_id,from_id,to_id,status,created_at) VALUES (?,?,?,'pending',?)")
    .run(gid, req.user.id, target.id, now());
  game.notifyUser(target.id, 'invite', { id: Number(r.lastInsertRowid), group: g.name, groupId: gid, from: req.user.username });
  res.json({ ok: true });
});

app.post('/api/invites/:id/respond', authMiddleware, (req, res) => {
  const inv = db.prepare("SELECT * FROM invites WHERE id=? AND to_id=? AND status='pending'").get(Number(req.params.id), req.user.id);
  if (!inv) return res.status(404).json({ error: 'Davet bulunamadi.' });
  const accept = !!(req.body && req.body.accept);
  db.prepare('UPDATE invites SET status=? WHERE id=?').run(accept ? 'accepted' : 'declined', inv.id);
  if (accept) {
    const g = db.prepare('SELECT id FROM groups WHERE id=?').get(inv.group_id);
    if (!g) return res.status(400).json({ error: 'Grup artik yok.' });
    db.prepare("INSERT OR IGNORE INTO group_members (group_id,user_id,role,joined_at) VALUES (?,?,'member',?)")
      .run(inv.group_id, req.user.id, now());
    const u = db.prepare('SELECT active_group FROM users WHERE id=?').get(req.user.id);
    if (u.active_group == null) db.prepare('UPDATE users SET active_group=? WHERE id=?').run(inv.group_id, req.user.id);
    notifyGroup(inv.group_id, null);
  }
  res.json({ ok: true, accepted: accept });
});

// ---------------- baslat ----------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ####   ####  #    #  #####  # #    # ###### #');
  console.log('  #   # #    # ##  ##  #    # #  #  #  #      #');
  console.log('  ####  #    # # ## #  #####  #   ##   #####  #');
  console.log('  #   # #    # #    #  #      #   ##   #      #');
  console.log('  ####   ####  #    #  #      #  #  #  ###### ######');
  console.log('');
  console.log(`  BomPixel calisiyor -> http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const ni of nets[name] || [])
      if (ni.family === 'IPv4' && !ni.internal)
        console.log(`  Mobil/tablet icin (ayni ag): http://${ni.address}:${PORT}`);
  console.log(`  Admin paneli -> http://localhost:${PORT}/admin`);
  console.log('');
});
