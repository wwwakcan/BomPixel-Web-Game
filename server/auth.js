// BomPixel - kimlik dogrulama (kayit / giris / oturum)
const crypto = require('crypto');
const { db, hashPass, now } = require('./db');

function register(username, email, password) {
  username = String(username || '').trim();
  email = String(email || '').trim();
  password = String(password || '');
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
    return { error: 'Kullanici adi 3-16 karakter olmali (harf, rakam, _).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: 'Gecerli bir e-posta girin.' };
  if (password.length < 4)
    return { error: 'Sifre en az 4 karakter olmali.' };
  const exists = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?)').get(username);
  if (exists) return { error: 'Bu kullanici adi alinmis.' };
  const salt = crypto.randomBytes(8).toString('hex');
  const r = db.prepare('INSERT INTO users (username,email,pass,salt,is_admin,created_at) VALUES (?,?,?,?,0,?)')
    .run(username, email, hashPass(password, salt), salt, now());
  return { userId: Number(r.lastInsertRowid) };
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(String(username || '').trim());
  if (!u) return { error: 'Kullanici bulunamadi.' };
  if (hashPass(String(password || ''), u.salt) !== u.pass) return { error: 'Sifre hatali.' };
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, u.id, now());
  db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(now(), u.id);
  return { token, user: publicUser(u) };
}

function userByToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(String(token));
  if (!s) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) || null;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    is_admin: !!u.is_admin, active_group: u.active_group,
    selected_weapon: u.selected_weapon
  };
}

// Express ara katmanlari
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const u = userByToken(token);
  if (!u) return res.status(401).json({ error: 'Oturum gecersiz. Tekrar giris yapin.' });
  req.user = u;
  next();
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Yetkiniz yok (admin gerekli).' });
    next();
  });
}

module.exports = { register, login, userByToken, publicUser, authMiddleware, adminMiddleware };
