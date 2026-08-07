// BomPixel uctan uca duman testi: 2 bot + admin akisi
// Test kendi kucuk arenalarinda kosar — canli oyunculari rahatsiz etmez.
// Kullanim: node test/bot.js   (sunucu calisiyor olmali: npm start)
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';
const results = [];
function ok(name) { results.push(['OK', name]); console.log('  [OK]', name); }
function fail(name, extra) { results.push(['FAIL', name]); console.log('  [FAIL]', name, extra || ''); }
function assert(cond, name, extra) { cond ? ok(name) : fail(name, extra); return cond; }

async function api(path, method = 'GET', body, token) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 5000);
  });
}

function waitFor(socket, ev, timeout = 8000, pred = () => true) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off(ev, h); reject(new Error('timeout: ' + ev)); }, timeout);
    const h = (data) => { if (pred(data)) { clearTimeout(t); socket.off(ev, h); resolve(data); } };
    socket.on(ev, h);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('BomPixel duman testi basliyor...\n');
  const suffix = Date.now().toString(36).slice(-5);
  const U1 = 'bot_a_' + suffix, U2 = 'bot_b_' + suffix;

  // --- kayit / giris ---
  const r1 = await api('/register', 'POST', { username: U1, email: 'a@test.com', password: 'test1234' });
  assert(r1.status === 200 && r1.data.token, 'kayit + otomatik giris (bot A)', JSON.stringify(r1.data));
  const r2 = await api('/register', 'POST', { username: U2, email: 'b@test.com', password: 'test1234' });
  assert(r2.status === 200 && r2.data.token, 'kayit (bot B)');
  const t1 = r1.data.token, t2 = r2.data.token;
  const uid1 = r1.data.user.id, uid2 = r2.data.user.id;

  const dup = await api('/register', 'POST', { username: U1, email: 'x@test.com', password: 'test1234' });
  assert(dup.status === 400, 'ayni kullanici adi reddedilir');
  const badLogin = await api('/login', 'POST', { username: U1, password: 'yanlis' });
  assert(badLogin.status === 400, 'yanlis sifre reddedilir');

  // --- skin ---
  const skin = { w: 12, h: 18, px: new Array(12 * 18).fill('#ff0000'), emoji: '🔥', emojiAnim: 'don' };
  assert((await api('/skin', 'POST', { data: skin }, t1)).status === 200, 'skin + hareketli emoji kaydedilir');
  await api('/skin', 'POST', { data: { w: 12, h: 18, px: new Array(216).fill('#00ff00') } }, t2);
  assert((await api('/skin', 'POST', { data: { w: 2, h: 2, px: ['x', null, null, null] } }, t1)).status === 400, 'gecersiz skin reddedilir');

  const me1 = await api('/me', 'GET', null, t1);
  assert(me1.status === 200 && me1.data.skin.emoji === '🔥' && me1.data.weapons.length >= 5, '/me profil + emoji + silahlar');
  assert(Array.isArray(me1.data.loadout) && me1.data.loadout.length === 3, '/me yukleme (3 slot)');

  // --- loadout ---
  const defIds = me1.data.weapons.filter(w => !w.mine).slice(0, 5).map(w => w.id);
  assert((await api('/loadout', 'POST', { slots: [defIds[3], defIds[1], defIds[0]] }, t1)).status === 200, 'loadout kaydi');
  await api('/loadout', 'POST', { slots: [defIds[0], defIds[1], defIds[2]] }, t1);
  assert((await api('/loadout', 'POST', { slots: [99999, 1, 1] }, t1)).status === 400, 'gecersiz loadout reddedilir');

  // --- ozel silah + sticker ---
  const wskin = { w: 16, h: 10, px: new Array(160).fill(null).map((_, i) => i % 3 ? '#00ff00' : null) };
  const wr = await api('/weapons', 'POST', { name: 'Test Lazer', type: 'lazer', skin: wskin, anim: 'enerji', color: '#00ffcc', stickers: ['🔥', '⭐'] }, t1);
  assert(wr.status === 200, 'ozel silah + sticker olusturma');
  assert((await api(`/weapons/${wr.data.id}/stickers`, 'POST', { stickers: ['🔥', '⭐', '⚡'] }, t1)).status === 200, 'sticker guncelleme (+%12)');

  // --- admin girisi + izole test arenalari ---
  const al = await api('/login', 'POST', { username: 'admin', password: 'admin123' });
  assert(al.status === 200, 'admin girisi');
  const at = al.data.token;
  assert((await api('/admin/live', 'GET', null, t1)).status === 403, 'admin olmayan giremez');

  const tinyMap = {
    w: 24, h: 24,
    type: new Array(576).fill(0), height: new Array(576).fill(0),
    buildings: [{ x: 3, z: 3, w: 5, h: 5, ht: 3, door: 'S', color: '#886644' }],
    signs: [{ id: 'ts1', cx: 12, cz: 1.5, y: 2.4, side: 'S', w: 4, h: 1.2, type: 'text', content: 'TEST', pixel: 1, color: '#ffdd33', bg: '#111122', board: 1 }],
    spawns: [[12, 12], [17, 17]]
  };
  const nm = await api('/admin/maps', 'POST', { name: 'TestArena_' + suffix, data: tinyMap }, at);
  assert(nm.status === 200 && nm.data.id, 'admin yeni harita kaydi');
  const TESTMAP = nm.data.id;
  const nm2 = await api('/admin/maps', 'POST', { name: 'BotArena_' + suffix, data: { ...tinyMap, signs: [] } }, at);
  const BOTMAP = nm2.data.id;
  assert((await api('/admin/maps', 'POST', { name: 'X', data: { w: 8, h: 8, type: [], spawns: [] } }, at)).status === 400, 'gecersiz harita reddedilir');

  // --- harita listesi ---
  const mapsR = await api('/maps', 'GET', null, t1);
  assert(mapsR.status === 200 && mapsR.data.maps.some(m => m.id === TESTMAP) && 'players' in mapsR.data.maps[0], 'harita listesi + oyuncu sayilari');

  // --- socket ---
  const s1 = await connect(t1);
  const s2 = await connect(t2);
  ok('socket baglantisi (2 bot)');

  const badSock = io(BASE, { auth: { token: 'sahte' }, transports: ['websocket'] });
  const authErr = await new Promise(res => {
    badSock.on('authError', () => res(true));
    badSock.on('disconnect', () => res(true));
    setTimeout(() => res(false), 4000);
  });
  assert(authErr, 'sahte token socketten atilir');
  badSock.close();

  // --- izole arenaya katilim ---
  const w1p = waitFor(s1, 'welcome');
  s1.emit('join', { mapId: TESTMAP, bots: 0 });
  const w1 = await w1p;
  assert(w1.mapId === TESTMAP && w1.map.w === 24, 'welcome: secilen (izole) haritaya girildi');
  assert(Array.isArray(w1.weaponTypes) && w1.weaponTypes.length >= 5, 'welcome: silah tipleri');
  assert(w1.map.signs.length > 0 && w1.map.buildings.length > 0, 'haritada tabela + bina var');
  const selfMeta1 = w1.players.find(p => p.id === w1.selfId);
  assert(selfMeta1 && selfMeta1.slots.length === 3, 'welcome: 3 silahlik loadout meta');

  const joinSeen = waitFor(s1, 'playerJoin', 8000, m => m.name === U2);
  const w2p = waitFor(s2, 'welcome');
  s2.emit('join', { mapId: TESTMAP, bots: 0 });
  const w2 = await w2p;
  await joinSeen; ok('playerJoin yayini');
  const metaB = w2.players.find(p => p.id !== w2.selfId && p.name === U1);
  assert(metaB && metaB.skin && metaB.skin.emoji === '🔥', 'diger oyuncunun skin emojisi goruluyor');

  await waitFor(s1, 'snap', 5000, s => s.players.length >= 2);
  ok('snapshot akiyor');

  let posA = null, posB = null;
  const selfIdA = w1.selfId, selfIdB = w2.selfId;
  s1.on('snap', s => {
    for (const p of s.players) {
      if (p.i === selfIdA) posA = p.p;
      if (p.i === selfIdB) posB = p.p;
    }
  });
  await waitFor(s1, 'snap', 5000, () => posA && posB);

  async function walkTo(sock, getSelf, getTarget, stopDist, timeoutMs, each) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const a = getSelf(), b = getTarget();
      if (a && b) {
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const dist = Math.hypot(dx, dz);
        if (dist <= stopDist) return true;
        const step = Math.min(0.28, dist);
        sock.emit('input', { p: [a[0] + dx / dist * step, a[1], a[2] + dz / dist * step], y: 0, pi: 0 });
        if (each) each(dist, a, b);
      }
      await sleep(50);
    }
    return false;
  }

  // --- savas ---
  let killed = false;
  const killWatch = waitFor(s1, 'kill', 30000, k => k.killer && k.killer.uid === uid1 && k.victim.uid === uid2).then(() => { killed = true; }).catch(() => {});
  let fired = 0;
  await walkTo(s1, () => posA, () => posB, 2.5, 20000, (dist, a, b) => {
    if (dist < 22 && !killed) {
      const dy = (b[1] + 0.9) - (a[1] + 1.5);
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      s1.emit('fire', { o: [a[0], a[1] + 1.5, a[2]], d: [dx / len, dy / len, dz / len] });
      fired++;
    }
  });
  const tK = Date.now();
  while (!killed && Date.now() - tK < 10000) {
    if (posA && posB) {
      const dx = posB[0] - posA[0], dz = posB[2] - posA[2];
      const dy = (posB[1] + 0.9) - (posA[1] + 1.5);
      const len = Math.hypot(dx, dy, dz);
      s1.emit('fire', { o: posA, d: [dx / len, dy / len, dz / len] });
      fired++;
    }
    await sleep(120);
  }
  await killWatch;
  assert(killed, `savas: A ates etti (${fired} atis), B'yi oldurdu`);
  await waitFor(s2, 'snap', 5000, s => s.players.some(p => p.i === selfIdB && p.h === 100));
  ok('olen oyuncu aninda dogdu (hp 100)');

  // --- silah degistirme ---
  const swWatch = waitFor(s2, 'playerSwitch', 6000, m => m.id === selfIdA && m.slot === 1);
  s1.emit('switchSlot', { slot: 1 });
  await swWatch;
  ok('slot degisimi yayinlandi');
  await waitFor(s2, 'snap', 5000, s => s.players.some(p => p.i === selfIdA && p.s === 1));
  ok('snapshot aktif slotu tasiyor');

  // --- C4: A kurar, B cozer ---
  const bArrived = await walkTo(s2, () => posB, () => posA, 1.5, 25000);
  assert(bArrived, 'B, A nin yanina yurudu');
  s1.emit('switchSlot', { slot: 3 });
  await sleep(150);
  const plantWatch = waitFor(s2, 'c4Planted', 8000);
  s1.emit('plantStart');
  await sleep(2600);
  s1.emit('plantDone');
  const c4ev = await plantWatch;
  assert(c4ev && c4ev.i && c4ev.by === U1, 'C4 kuruldu ve yayinlandi 💣');
  const defWatch = waitFor(s1, 'c4Defused', 10000, m => m.id === c4ev.i);
  s2.emit('defuseStart', { id: c4ev.i });
  await sleep(4200);
  s2.emit('defuseDone', { id: c4ev.i });
  const defEv = await defWatch;
  assert(defEv.by === U2 && defEv.score === 3, 'C4 cozuldu, cozene +3 puan ✂️');
  await waitFor(s1, 'score', 5000, list => list.some(r => r.uid === uid2 && r.k >= 3));
  ok('skorbordda cozme puani');

  // --- C4 patlamasi (hizli dogrulama: cozulmeden patlar) ---
  s1.emit('plantStart');
  await sleep(2600);
  s1.emit('plantDone');
  const c4b = await waitFor(s2, 'c4Planted', 8000).catch(() => null);
  assert(!c4b, 'C4 sogumasi (45sn) calisiyor — hemen ikinci C4 kurulamaz');

  // --- gruplar ---
  const g = await api('/groups', 'POST', { name: 'TestTakim' }, t1);
  assert(g.status === 200, 'grup kurma');
  const invPromise = waitFor(s2, 'invite', 8000);
  const invAck = await new Promise(res => s1.emit('inviteUser', { toUid: uid2 }, res));
  assert(invAck && invAck.ok, 'oyun ici davet gonderimi');
  const inv = await invPromise;
  assert(inv.group === 'TestTakim' && inv.from === U1, 'davet bildirimi ulasti');
  assert((await api(`/invites/${inv.id}/respond`, 'POST', { accept: true }, t2)).status === 200, 'davet kabulu');
  const me2 = await api('/me', 'GET', null, t2);
  const grp = me2.data.groups.find(x => x.name === 'TestTakim');
  assert(grp && grp.members.length === 2, 'grup uyeleri (2)');
  assert(grp.members.every(m => typeof m.online === 'boolean'), 'online/offline durumu');
  assert(grp.members.find(m => m.uid === uid1).role === 'owner', 'grup yoneticisi');

  // --- botlar: s2 kendi bot arenasina gecer ---
  const wMove = waitFor(s2, 'welcome', 8000);
  s2.emit('join', { mapId: BOTMAP, bots: 2, botLevel: 'zor' });
  const w2b = await wMove;
  assert(w2b.mapId === BOTMAP && w2b.map.w === 24, 'oyuncu farkli haritaya gecti (coklu arena)');
  const botSnap = await waitFor(s2, 'snap', 8000, s => s.players.filter(p => String(p.i).startsWith('bot:')).length >= 2).catch(() => null);
  assert(botSnap, 'akilli botlar arenaya katildi 🤖');
  const botShoot = await waitFor(s2, 'shot', 15000, m => String(m.pid).startsWith('bot:')).catch(() => null);
  assert(botShoot, 'bot dusmani gorup ates etti');
  const mapsR2 = await api('/maps', 'GET', null, t1);
  const cnt = mapsR2.data.maps.find(m => m.id === BOTMAP);
  assert(cnt && cnt.players === 1, 'harita listesi bot degil insan sayiyor');

  // --- admin canli / tabela / silah tipi ---
  const live = await api('/admin/live', 'GET', null, at);
  assert(live.status === 200 && live.data.arenas.some(a => a.mapId === TESTMAP), 'admin canli durum (arenalar)');
  const maps = await api('/admin/maps', 'GET', null, at);
  assert(maps.status === 200 && maps.data.maps.length >= 2, 'admin harita listesi');

  const signWatch = waitFor(s1, 'signUpdate', 8000, s => s.id === 'ts1');
  const su = await api('/admin/signs', 'POST', { ...tinyMap.signs[0], mapId: TESTMAP, content: 'CANLI REKLAM', pixel: 1 }, at);
  assert(su.status === 200, 'admin tabela kaydi');
  const sev = await signWatch;
  assert(sev.content === 'CANLI REKLAM', 'tabela CANLI yayildi');

  assert((await api('/admin/weapon-types', 'POST', { id: 'tabanca', name: 'Piksel Tabanca', dmg: 26, rate: 350, speed: 45, range: 60, pellets: 1, auto: false, beam: false }, at)).status === 200, 'admin silah tipi guncelleme');

  // acik haritayi kaydet -> canli mapChange
  const curMap = await api('/admin/maps/' + TESTMAP, 'GET', null, at);
  const mcW = waitFor(s1, 'mapChange', 8000);
  await api('/admin/maps', 'POST', { id: TESTMAP, name: curMap.data.name, data: curMap.data.data }, at);
  await mcW;
  ok('harita kaydi acik arenaya canli yansidi');

  // --- tur bitir -> mac gecmisi ---
  const roundEndW = waitFor(s1, 'roundEnd', 8000);
  await api('/admin/round/restart', 'POST', null, at);
  await roundEndW;
  ok('tur bitisi yayini');
  await sleep(400);
  const matches = await api('/admin/matches', 'GET', null, at);
  assert(matches.status === 200 && matches.data.matches.length >= 1, 'gecmis oyunlar kaydedildi');
  const users = await api('/admin/users', 'GET', null, at);
  assert(users.status === 200 && users.data.users.some(u => u.username === U1 && u.online), 'admin uye listesi + online');

  s1.close(); s2.close();
  // test arenalarindaki botlar insan kalmayinca otomatik temizlenir
  await sleep(500);
  await api('/admin/maps/' + BOTMAP, 'DELETE', null, at);
  await api('/admin/maps/' + TESTMAP, 'DELETE', null, at); // temizlik

  const fails = results.filter(r => r[0] === 'FAIL');
  console.log(`\nSonuc: ${results.length - fails.length}/${results.length} test gecti.`);
  if (fails.length) { console.log('BASARISIZ:', fails.map(f => f[1]).join(' | ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('\nTEST HATASI:', e.message); process.exit(1); });
