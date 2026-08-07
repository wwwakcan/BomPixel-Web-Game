// BomPixel - SQLite katmani (node:sqlite yerlesik modulu, Node 22.5+)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('node:sqlite bulunamadi. Node 22.5+ gerekli.');
  throw e;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bompixel.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  pass TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  active_group INTEGER,
  selected_weapon INTEGER,
  created_at INTEGER,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS skins (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at INTEGER,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  w INTEGER, h INTEGER,
  data TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS weapon_types (
  id TEXT PRIMARY KEY,
  name TEXT,
  dmg INTEGER, rate INTEGER, speed INTEGER, range INTEGER,
  pellets INTEGER DEFAULT 1,
  auto INTEGER DEFAULT 0,
  beam INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS weapons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER,
  name TEXT,
  type TEXT NOT NULL,
  skin TEXT,
  anim TEXT DEFAULT 'klasik',
  color TEXT DEFAULT '#ffdd33',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER,
  map_name TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  scores TEXT
);
`);

// ---------- migrasyonlar (var olan DB'lere yeni kolonlar) ----------
function addColumn(table, name, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}
addColumn('users', 'loadout', 'TEXT');       // 3 silahlik yukleme: [id,id,id]
addColumn('weapons', 'stickers', 'TEXT');    // animasyonlu emoji stickerlar: ["🔥","⭐"] -> hasar bonusu

// ---------- yardimcilar ----------
const now = () => Date.now();

function hashPass(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// Karakter sablonlarindan piksel izgarasi uret ('.'=bos, harf=renk)
function gridFromArt(rows, colors) {
  const h = rows.length, w = rows[0].length;
  const px = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      px.push(c === '.' ? null : (colors[c] || '#ffffff'));
    }
  return { w, h, px };
}

const DEFAULT_SKIN = gridFromArt([
  '....TTTT....',
  '...TTTTTT...',
  '...SSSSSS...',
  '...SESSES...',
  '...SSSSSS...',
  '...SSMMSS...',
  '....SSSS....',
  '..BBBBBBBB..',
  '.ABBBBBBBBA.',
  '.ABBGGGGBBA.',
  '.ABBBBBBBBA.',
  '.SBBBBBBBBS.',
  '...PPPPPP...',
  '...PP..PP...',
  '...PP..PP...',
  '...PP..PP...',
  '...KK..KK...',
  '..KKK..KKK..'
], { T: '#3d2b1f', S: '#e8b88a', E: '#222222', M: '#a05c40', B: '#2f6f4f', G: '#ffd23f', A: '#e8b88a', P: '#31456b', K: '#332222' });

const GUN_ARTS = {
  tabanca: gridFromArt([
    '................',
    '................',
    '....XXXXXXXXXXX.',
    '....XXXXXXXXXXX.',
    '....XooXXXXXXXX.',
    '....XXXX........',
    '....xXXx........',
    '....xXXx........',
    '.....xx.........',
    '................'
  ], { X: '#4d5a6a', x: '#33404d', o: '#ffdd33' }),
  tarayici: gridFromArt([
    '................',
    '..........xx....',
    '.XXXXXXXXXXXXXXX',
    '.XXXXXXXXXXXXXXX',
    '.XooXXXXXXXXXXXX',
    '.XXXXXxXXXX.....',
    '...xXXxxXXx.....',
    '...xXXx.xXx.....',
    '....xx...x......',
    '................'
  ], { X: '#5b6d3c', x: '#39461f', o: '#ff8833' }),
  pompali: gridFromArt([
    '................',
    '................',
    'xxXXXXXXXXXXXXXX',
    'xxXXXXXXXXXXXXXX',
    'xxXXooXXXXXXXXXX',
    '....XXXXxxxx....',
    '....xXXx........',
    '.....XXx........',
    '.....xx.........',
    '................'
  ], { X: '#7a4a2b', x: '#4a2a15', o: '#ffcc55' }),
  keskin: gridFromArt([
    '.......oo.......',
    '.......oo.......',
    'XXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXX',
    '..XXXXXXXXXXX...',
    '....xXXXxx......',
    '....xXXx........',
    '.....XXx........',
    '.....xx.........',
    '................'
  ], { X: '#3a4a5a', x: '#22303c', o: '#66ddff' }),
  lazer: gridFromArt([
    '................',
    '....oooo........',
    '.XXXXXXXXXXXXXoo',
    '.XXXXXXXXXXXXXoo',
    '.XXooooXXXXXXXX.',
    '..XXXXXXxXX.....',
    '....xXXxxXx.....',
    '....xXXx........',
    '.....xx.........',
    '................'
  ], { X: '#5a3a7a', x: '#37224d', o: '#66ffcc' })
};

function seed() {
  const t = now();

  // Silah tipleri (atis tipleri sistemi — admin panelden duzenlenebilir)
  const wtCount = db.prepare('SELECT COUNT(*) AS c FROM weapon_types').get().c;
  if (wtCount === 0) {
    const ins = db.prepare('INSERT INTO weapon_types (id,name,dmg,rate,speed,range,pellets,auto,beam) VALUES (?,?,?,?,?,?,?,?,?)');
    ins.run('tabanca', 'Piksel Tabanca', 25, 350, 45, 60, 1, 0, 0);
    ins.run('tarayici', 'Oto Tarayici', 16, 130, 55, 70, 1, 1, 0);
    ins.run('pompali', 'Pompali', 12, 900, 40, 26, 6, 0, 0);
    ins.run('keskin', 'Keskin Nisanci', 90, 1400, 0, 150, 1, 0, 1);
    ins.run('lazer', 'Lazer Isini', 40, 800, 0, 80, 1, 0, 1);
  }

  // Varsayilan silahlar (owner NULL = herkes kullanabilir)
  const wCount = db.prepare('SELECT COUNT(*) AS c FROM weapons WHERE owner_id IS NULL').get().c;
  if (wCount === 0) {
    const ins = db.prepare('INSERT INTO weapons (owner_id,name,type,skin,anim,color,created_at) VALUES (NULL,?,?,?,?,?,?)');
    ins.run('Piksel Tabanca', 'tabanca', JSON.stringify(GUN_ARTS.tabanca), 'klasik', '#ffdd33', t);
    ins.run('Oto Tarayici', 'tarayici', JSON.stringify(GUN_ARTS.tarayici), 'alev', '#ff8833', t);
    ins.run('Pompali', 'pompali', JSON.stringify(GUN_ARTS.pompali), 'alev', '#ffcc55', t);
    ins.run('Keskin Nisanci', 'keskin', JSON.stringify(GUN_ARTS.keskin), 'lazer', '#66ddff', t);
    ins.run('Lazer Isini', 'lazer', JSON.stringify(GUN_ARTS.lazer), 'enerji', '#66ffcc', t);
  }

  // Admin hesabi
  const uCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (uCount === 0) {
    const salt = crypto.randomBytes(8).toString('hex');
    const r = db.prepare('INSERT INTO users (username,email,pass,salt,is_admin,created_at) VALUES (?,?,?,?,1,?)')
      .run('admin', 'admin@bompixel.local', hashPass('admin123', salt), salt, t);
    db.prepare('INSERT INTO skins (user_id,data,updated_at) VALUES (?,?,?)')
      .run(r.lastInsertRowid, JSON.stringify(DEFAULT_SKIN), t);
    console.log('[db] Admin hesabi olusturuldu -> kullanici: admin  sifre: admin123  (girince degistirin!)');
  }

  // Varsayilan sehir haritasi
  const mCount = db.prepare('SELECT COUNT(*) AS c FROM maps').get().c;
  if (mCount === 0) {
    const { generateCity } = require('./defaultMap');
    const map = generateCity(96, 96);
    const r = db.prepare('INSERT INTO maps (name,w,h,data,created_by,created_at) VALUES (?,?,?,?,NULL,?)')
      .run('Piksel Sehir', map.w, map.h, JSON.stringify(map), t);
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('active_map', String(r.lastInsertRowid));
    console.log('[db] Varsayilan harita "Piksel Sehir" olusturuldu.');
  }
}

seed();

module.exports = { db, hashPass, now, DEFAULT_SKIN, gridFromArt };
