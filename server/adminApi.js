// BomPixel - Admin REST API
const express = require('express');
const { db, now } = require('./db');
const { adminMiddleware } = require('./auth');

function createAdminApi(game) {
  const r = express.Router();
  r.use(adminMiddleware);

  // ---- canli durum ----
  r.get('/live', (req, res) => res.json(game.live()));
  r.post('/round/restart', (req, res) => { game.restartRound(); res.json({ ok: true }); });

  // ---- haritalar ----
  r.get('/maps', (req, res) => {
    const rows = db.prepare('SELECT id,name,w,h,created_at FROM maps ORDER BY id DESC').all();
    const act = db.prepare('SELECT value FROM settings WHERE key=?').get('active_map');
    res.json({ maps: rows, active: act ? Number(act.value) : null });
  });
  r.get('/maps/:id', (req, res) => {
    const m = db.prepare('SELECT * FROM maps WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Harita yok.' });
    res.json({ id: m.id, name: m.name, data: JSON.parse(m.data) });
  });
  r.post('/maps', (req, res) => {
    const { id, name, data } = req.body || {};
    if (!name || !data || !data.w || !data.h || !Array.isArray(data.type))
      return res.status(400).json({ error: 'Gecersiz harita verisi.' });
    if (data.w < 16 || data.h < 16 || data.w > 256 || data.h > 256)
      return res.status(400).json({ error: 'Harita boyutu 16-256 metre arasi olmali.' });
    if (!data.spawns || !data.spawns.length)
      return res.status(400).json({ error: 'En az 1 dogum noktasi ekleyin.' });
    data.buildings = data.buildings || []; data.signs = data.signs || [];
    if (id) {
      db.prepare('UPDATE maps SET name=?, w=?, h=?, data=? WHERE id=?')
        .run(String(name), data.w, data.h, JSON.stringify(data), Number(id));
      game.reloadMap(Number(id)); // acik arena varsa canli guncelle
      return res.json({ ok: true, id: Number(id) });
    }
    const ins = db.prepare('INSERT INTO maps (name,w,h,data,created_by,created_at) VALUES (?,?,?,?,?,?)')
      .run(String(name), data.w, data.h, JSON.stringify(data), req.user.id, now());
    res.json({ ok: true, id: Number(ins.lastInsertRowid) });
  });
  r.post('/maps/:id/activate', (req, res) => {
    const m = db.prepare('SELECT * FROM maps WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'Harita yok.' });
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('active_map', String(m.id));
    res.json({ ok: true });
  });
  r.delete('/maps/:id', (req, res) => {
    const id = Number(req.params.id);
    const act = db.prepare('SELECT value FROM settings WHERE key=?').get('active_map');
    if (act && Number(act.value) === id)
      return res.status(400).json({ error: 'Varsayilan harita silinemez.' });
    if (game.arenaHasPlayers(id))
      return res.status(400).json({ error: 'Icinde oyuncu olan harita silinemez.' });
    game.dropArena(id);
    db.prepare('DELETE FROM maps WHERE id=?').run(id);
    res.json({ ok: true });
  });

  // ---- tabelalar / reklamlar (secilen haritada CANLI degisir) ----
  r.get('/signs', (req, res) => {
    const maps = db.prepare('SELECT id,name FROM maps ORDER BY id').all();
    const mapId = req.query.mapId ? Number(req.query.mapId) : game.live().defaultMapId;
    const m = db.prepare('SELECT id,name,data FROM maps WHERE id=?').get(mapId);
    if (!m) return res.json({ signs: [], maps, mapId: null });
    res.json({ signs: JSON.parse(m.data).signs || [], maps, mapId: m.id, map: m.name });
  });
  r.post('/signs', (req, res) => {
    const s = req.body || {};
    const mapId = Number(s.mapId);
    if (!s.id || !mapId) return res.status(400).json({ error: 'Tabela id + mapId gerekli.' });
    if (s.type === 'image') {
      if (typeof s.content !== 'string' || !s.content.startsWith('data:image'))
        return res.status(400).json({ error: 'Gecersiz gorsel (data URL bekleniyor).' });
      if (s.content.length > 2_000_000) return res.status(400).json({ error: 'Gorsel cok buyuk (max ~1.5MB).' });
    } else {
      s.type = 'text';
      s.content = String(s.content || '').slice(0, 60);
    }
    s.pixel = s.pixel ? 1 : 0;
    delete s.mapId;
    if (!game.updateSign(mapId, s)) return res.status(404).json({ error: 'Harita bulunamadi.' });
    res.json({ ok: true });
  });

  // ---- silah tipleri (atis tipleri sistemi) ----
  r.get('/weapon-types', (req, res) => res.json({ types: db.prepare('SELECT * FROM weapon_types').all() }));
  r.post('/weapon-types', (req, res) => {
    const t = req.body || {};
    if (!t.id) return res.status(400).json({ error: 'id gerekli' });
    const ex = db.prepare('SELECT id FROM weapon_types WHERE id=?').get(String(t.id));
    const vals = [String(t.name || t.id), Number(t.dmg) || 10, Number(t.rate) || 500, Number(t.speed) || 40,
      Number(t.range) || 60, Number(t.pellets) || 1, t.auto ? 1 : 0, t.beam ? 1 : 0];
    if (ex) db.prepare('UPDATE weapon_types SET name=?,dmg=?,rate=?,speed=?,range=?,pellets=?,auto=?,beam=? WHERE id=?')
      .run(...vals, String(t.id));
    else db.prepare('INSERT INTO weapon_types (id,name,dmg,rate,speed,range,pellets,auto,beam) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(String(t.id), ...vals);
    game.reloadWeaponTypes();
    res.json({ ok: true });
  });

  // ---- kullanicilar ----
  r.get('/users', (req, res) => {
    const rows = db.prepare('SELECT id,username,email,is_admin,created_at,last_seen FROM users ORDER BY id').all();
    const online = game.onlineUids();
    res.json({ users: rows.map(u => ({ ...u, online: online.has(u.id) })) });
  });
  r.post('/users/:id/admin', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Kendi yetkinizi degistiremezsiniz.' });
    db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(req.body && req.body.admin ? 1 : 0, id);
    res.json({ ok: true });
  });
  r.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Kendinizi silemezsiniz.' });
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM skins WHERE user_id=?').run(id);
    db.prepare('DELETE FROM group_members WHERE user_id=?').run(id);
    db.prepare('DELETE FROM invites WHERE to_id=? OR from_id=?').run(id, id);
    db.prepare('DELETE FROM weapons WHERE owner_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    res.json({ ok: true });
  });

  // ---- gecmis oyunlar ----
  r.get('/matches', (req, res) => {
    const rows = db.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT 50').all();
    res.json({ matches: rows.map(m => ({ ...m, scores: JSON.parse(m.scores || '[]') })) });
  });

  return r;
}

module.exports = { createAdminApi };
