// BomPixel - ana istemci akisi: kimlik, CS tarzi ana menu, envanter, gruplar, oyun
import { PixelEditor, bindEditorUI, SKIN_TEMPLATES, WEAPON_TEMPLATE } from './editors.js';
import { drawGridToCanvas, makeSpinPreview } from './voxel.js';
import { startGame } from './game3d.js';
import { sfx, unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = localStorage.getItem('bp_token');
let meData = null;
let mapsData = [];
let selectedMap = Number(localStorage.getItem('bp_map')) || null;
let socket = null;
let game = null;
let onlineMap = new Map();
let skinEd = null, skinPrev = null, weapEd = null, weapPrev = null;
let firstSkin = false;
let mapsTimer = null;

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(data.error || 'Oturum gecersiz'); }
  if (!res.ok) throw new Error(data.error || 'Hata olustu');
  return data;
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
  clearInterval(mapsTimer);
  if (id === 'screen-main') {
    refreshMaps();
    mapsTimer = setInterval(() => { if (!$('page-home').classList.contains('hidden')) refreshMaps(); }, 6000);
  }
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + page));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
}

function toast(html, actions = [], ttl = 6000) {
  const box = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<div class="toast-msg">${html}</div>`;
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'toast-actions';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn tiny ' + (a.cls || '');
      b.textContent = a.label;
      b.onclick = () => { t.remove(); a.fn(); };
      row.appendChild(b);
    }
    t.appendChild(row);
  }
  box.appendChild(t);
  if (ttl) setTimeout(() => t.remove(), ttl);
  return t;
}

function logout() {
  localStorage.removeItem('bp_token');
  token = null; meData = null;
  if (socket) { socket.disconnect(); socket = null; }
  show('screen-auth');
}

// ---------------- kimlik ----------------
function initAuth() {
  $('tab-login').onclick = () => setAuthTab(true);
  $('tab-register').onclick = () => setAuthTab(false);
  function setAuthTab(login) {
    $('login-form').classList.toggle('hidden', !login);
    $('register-form').classList.toggle('hidden', login);
    $('tab-login').classList.toggle('active', login);
    $('tab-register').classList.toggle('active', !login);
    $('auth-err').textContent = '';
  }
  const doLogin = async () => {
    try {
      const r = await api('/login', 'POST', { username: $('li-user').value, password: $('li-pass').value });
      token = r.token; localStorage.setItem('bp_token', token);
      unlockAudio(); await boot();
    } catch (e) { $('auth-err').textContent = e.message; }
  };
  $('btn-login').onclick = doLogin;
  $('li-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('btn-register').onclick = async () => {
    try {
      const r = await api('/register', 'POST', {
        username: $('rg-user').value, email: $('rg-email').value, password: $('rg-pass').value
      });
      token = r.token; localStorage.setItem('bp_token', token);
      unlockAudio(); await boot();
    } catch (e) { $('auth-err').textContent = e.message; }
  };
}

// ---------------- socket ----------------
function connectSocket() {
  if (socket) return;
  socket = io({ auth: { token } });
  socket.on('authError', () => logout());
  socket.on('onlineList', list => {
    onlineMap = new Map(list.map(o => [o.uid, o.name]));
    renderOnline(); renderGroups();
  });
  socket.on('presence', p => {
    if (p.on) onlineMap.set(p.uid, p.name); else onlineMap.delete(p.uid);
    renderOnline(); renderGroups();
  });
  socket.on('invite', inv => {
    sfx.invite();
    toast(`<b>${esc(inv.from)}</b> seni <b>${esc(inv.group)}</b> grubuna davet etti!`, [
      { label: 'Kabul Et', cls: 'primary', fn: () => respondInvite(inv.id, true) },
      { label: 'Reddet', fn: () => respondInvite(inv.id, false) }
    ], 20000);
    refreshMe();
  });
  socket.on('groupUpdate', () => refreshMe());
}

async function respondInvite(id, accept) {
  try {
    await api(`/invites/${id}/respond`, 'POST', { accept });
    if (accept) toast('Gruba katildin! 🎉', [], 3000);
    await refreshMe();
  } catch (e) { toast(esc(e.message), [], 3000); }
}

// ---------------- ana menu ----------------
async function refreshMe() {
  try { meData = await api('/me'); } catch (e) { return; }
  if (!$('screen-main').classList.contains('hidden')) renderMain();
}

async function refreshMaps() {
  try {
    const d = await api('/maps');
    mapsData = d.maps;
    if (!selectedMap || !mapsData.find(m => m.id === selectedMap)) {
      const def = mapsData.find(m => m.isDefault) || mapsData[0];
      selectedMap = def ? def.id : null;
    }
    renderMaps();
  } catch (e) {}
}

function renderMain() {
  const u = meData.user;
  $('lb-username').textContent = u.username;
  $('hero-name').textContent = u.username;
  $('lb-admin-link').classList.toggle('hidden', !u.is_admin);
  if (meData.skin) drawGridToCanvas(meData.skin, $('lb-skin-canvas'), false);
  const activeG = meData.groups.find(g => g.id === u.active_group);
  $('hero-team').textContent = activeG ? `🛡️ Takim: ${activeG.name}` : '🎯 Tekil oynuyorsun';
  renderHeroLoadout();
  renderLoadoutSlots(); renderWeapons(); renderGroups(); renderInvites(); renderOnline();
}

const weaponById = id => meData.weapons.find(w => w.id === id);
const typeName = id => (meData.weaponTypes.find(t => t.id === id) || {}).name || id;
const stickerBonus = w => Math.min(3, (w.stickers || []).length) * 4;

function renderHeroLoadout() {
  const el = $('hero-loadout');
  el.innerHTML = '';
  meData.loadout.forEach((id, i) => {
    const w = weaponById(id);
    if (!w) return;
    const d = document.createElement('div');
    d.className = 'hero-w';
    const cv = document.createElement('canvas');
    cv.width = 48; cv.height = 30;
    drawGridToCanvas(w.skin, cv, false);
    d.appendChild(cv);
    d.title = w.name;
    el.appendChild(d);
  });
  const c4 = document.createElement('div');
  c4.className = 'hero-w'; c4.textContent = '💣';
  el.appendChild(c4);
}

// ---- ENVANTER: yukleme slotlari ----
function renderLoadoutSlots() {
  const el = $('loadout-slots');
  el.innerHTML = '';
  meData.loadout.forEach((id, i) => {
    const w = weaponById(id);
    const d = document.createElement('div');
    d.className = 'loadout-slot';
    d.innerHTML = `<span class="slot-key">${i + 1}</span>`;
    if (w) {
      const cv = document.createElement('canvas');
      cv.width = 96; cv.height = 60;
      drawGridToCanvas(w.skin, cv, false);
      d.appendChild(cv);
      const b = stickerBonus(w);
      const info = document.createElement('div');
      info.innerHTML = `<b>${esc(w.name)}</b><small>${esc(typeName(w.type))}${b ? ` · +%${b}` : ''}</small>`;
      d.appendChild(info);
    }
    const bt = document.createElement('button');
    bt.className = 'btn tiny';
    bt.textContent = 'Degistir';
    bt.onclick = () => openPicker(i);
    d.appendChild(bt);
    el.appendChild(d);
  });
}

function openPicker(slot) {
  $('modal-pick').classList.remove('hidden');
  $('pick-slot-no').textContent = slot + 1;
  const el = $('pick-list');
  el.innerHTML = '';
  for (const w of meData.weapons) {
    const row = document.createElement('div');
    row.className = 'list-row' + (meData.loadout[slot] === w.id ? ' selected' : '');
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 40; cv.className = 'weap-thumb';
    drawGridToCanvas(w.skin, cv, false);
    row.appendChild(cv);
    const b = stickerBonus(w);
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = `<b>${esc(w.name)}</b><small>${esc(typeName(w.type))}${b ? ` · +%${b} hasar` : ''}${w.mine ? ' · senin' : ''}</small>`;
    row.appendChild(info);
    row.onclick = async () => {
      const slots = meData.loadout.slice();
      slots[slot] = w.id;
      try {
        await api('/loadout', 'POST', { slots });
        meData.loadout = slots;
        $('modal-pick').classList.add('hidden');
        renderLoadoutSlots(); renderHeroLoadout();
        toast(`${esc(w.name)} → Slot ${slot + 1} ✓`, [], 2000);
      } catch (e) { toast(esc(e.message), [], 3000); }
    };
    el.appendChild(row);
  }
}

// ---- ENVANTER: silah koleksiyonu + stickerlar ----
function renderWeapons() {
  const el = $('weapon-list');
  el.innerHTML = '';
  for (const w of meData.weapons) {
    const row = document.createElement('div');
    row.className = 'list-row';
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 40; cv.className = 'weap-thumb';
    drawGridToCanvas(w.skin, cv, false);
    row.appendChild(cv);
    const b = stickerBonus(w);
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = `<b>${esc(w.name)}</b><small>${esc(typeName(w.type))} · ${esc(w.anim)}${b ? ` · <span class="bonus">+%${b} hasar</span>` : ''}${w.mine ? '' : ' · standart'}</small>`;
    row.appendChild(info);
    if (w.mine) {
      const stBox = document.createElement('div');
      stBox.className = 'sticker-box';
      (w.stickers || []).forEach((s, si) => {
        const sb = document.createElement('button');
        sb.className = 'sticker';
        sb.textContent = s;
        sb.title = 'Kaldir';
        sb.onclick = async () => {
          const st = w.stickers.slice(); st.splice(si, 1);
          try { await api(`/weapons/${w.id}/stickers`, 'POST', { stickers: st }); await refreshMe(); } catch (e) { toast(esc(e.message)); }
        };
        stBox.appendChild(sb);
      });
      if ((w.stickers || []).length < 3) {
        const add = document.createElement('button');
        add.className = 'sticker add';
        add.textContent = '+';
        add.title = 'Sticker ekle (+%4 hasar)';
        add.onclick = async () => {
          const emj = prompt('Sticker emoji (or: 🔥 ⭐ ⚡ 💀 🐉):');
          if (!emj || !emj.trim()) return;
          const st = (w.stickers || []).concat([emj.trim().slice(0, 8)]);
          try { await api(`/weapons/${w.id}/stickers`, 'POST', { stickers: st }); await refreshMe(); toast('Sticker yapistirildi! +%4 hasar 🔥', [], 2500); }
          catch (e) { toast(esc(e.message), [], 3000); }
        };
        stBox.appendChild(add);
      }
      row.appendChild(stBox);
      const del = document.createElement('button');
      del.className = 'btn tiny danger';
      del.textContent = '✕';
      del.onclick = async () => { await api('/weapons/' + w.id, 'DELETE'); await refreshMe(); };
      row.appendChild(del);
    }
    el.appendChild(row);
  }
}

// ---- SAVAS: harita kartlari ----
function renderMaps() {
  const el = $('map-cards');
  if (!el) return;
  el.innerHTML = '';
  for (const m of mapsData) {
    const d = document.createElement('div');
    d.className = 'map-card' + (m.id === selectedMap ? ' selected' : '');
    d.innerHTML = `<div class="map-icon">🗺️</div>
      <div class="grow"><b>${esc(m.name)}</b><small>${m.w}x${m.h} m${m.isDefault ? ' · varsayilan' : ''}</small></div>
      <span class="map-players">👥 ${m.players}</span>`;
    d.onclick = () => {
      selectedMap = m.id;
      localStorage.setItem('bp_map', String(m.id));
      renderMaps();
    };
    el.appendChild(d);
  }
  const sel = mapsData.find(m => m.id === selectedMap);
  if (sel) {
    $('sel-map-name').textContent = sel.name;
    $('sel-map-info').textContent = `${sel.w}x${sel.h} metre · su an ${sel.players} oyuncu`;
  }
}

// ---------------- gruplar ----------------
function renderGroups() {
  const el = $('groups-list');
  if (!el || !meData) return;
  el.innerHTML = '';
  const active = meData.user.active_group;
  const solo = document.createElement('div');
  solo.className = 'list-row' + (active == null ? ' selected' : '');
  solo.innerHTML = `<div class="grow"><b>🎯 Tekil Oyna</b><small>takimsiz, herkese karsi</small></div>`;
  const sb = document.createElement('button');
  sb.className = 'btn tiny'; sb.textContent = active == null ? 'Aktif ✓' : 'Sec';
  sb.onclick = async () => { await api('/groups/0/activate', 'POST'); meData.user.active_group = null; renderGroups(); renderMain(); };
  solo.appendChild(sb);
  el.appendChild(solo);

  for (const g of meData.groups) {
    const box = document.createElement('div');
    box.className = 'group-box' + (active === g.id ? ' selected' : '');
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<b>🛡️ ${esc(g.name)}</b>${g.myRole === 'owner' ? ' <span class="badge">Yonetici</span>' : ''}`;
    const act = document.createElement('button');
    act.className = 'btn tiny';
    act.textContent = active === g.id ? 'Takim Aktif ✓' : 'Takim Yap';
    act.onclick = async () => {
      try { await api(`/groups/${g.id}/activate`, 'POST'); meData.user.active_group = g.id; renderGroups(); renderMain(); }
      catch (e) { toast(esc(e.message)); }
    };
    head.appendChild(act);
    const leave = document.createElement('button');
    leave.className = 'btn tiny danger';
    leave.textContent = g.myRole === 'owner' ? 'Dagit/Ayril' : 'Ayril';
    leave.onclick = async () => { await api(`/groups/${g.id}/leave`, 'POST'); await refreshMe(); };
    head.appendChild(leave);
    box.appendChild(head);
    const mem = document.createElement('div');
    mem.className = 'group-members';
    for (const m of g.members) {
      const on = onlineMap.has(m.uid) || m.online;
      const row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span><span class="grow">${esc(m.name)}${m.role === 'owner' ? ' 👑' : ''}</span><small>${on ? 'cevrimici' : 'cevrimdisi'}</small>`;
      if (g.myRole === 'owner' && m.uid !== meData.user.id) {
        const k = document.createElement('button');
        k.className = 'btn tiny danger'; k.textContent = 'At';
        k.onclick = async () => { await api(`/groups/${g.id}/kick`, 'POST', { uid: m.uid }); await refreshMe(); };
        row.appendChild(k);
      }
      mem.appendChild(row);
    }
    box.appendChild(mem);
    el.appendChild(box);
  }
}

function renderInvites() {
  const el = $('invites-list');
  el.innerHTML = '';
  if (!meData.invites.length) { el.innerHTML = '<small class="dim">Bekleyen davet yok.</small>'; return; }
  for (const inv of meData.invites) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div class="grow"><b>${esc(inv.groupName)}</b><small>${esc(inv.fromName)} davet etti</small></div>`;
    const a = document.createElement('button');
    a.className = 'btn tiny primary'; a.textContent = 'Kabul';
    a.onclick = () => respondInvite(inv.id, true);
    const r = document.createElement('button');
    r.className = 'btn tiny'; r.textContent = 'Reddet';
    r.onclick = () => respondInvite(inv.id, false);
    row.appendChild(a); row.appendChild(r);
    el.appendChild(row);
  }
}

function renderOnline() {
  const el = $('online-list');
  if (!el || !meData) return;
  el.innerHTML = '';
  const others = [...onlineMap.entries()].filter(([uid]) => uid !== meData.user.id);
  $('online-count').textContent = onlineMap.size;
  if (!others.length) { el.innerHTML = '<small class="dim">Baska cevrimici oyuncu yok.</small>'; return; }
  const myGroups = meData.groups;
  for (const [uid, name] of others) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span class="dot on"></span><div class="grow"><b>${esc(name)}</b></div>`;
    if (myGroups.length) {
      const b = document.createElement('button');
      b.className = 'btn tiny'; b.textContent = 'Gruba Davet';
      b.onclick = async () => {
        const gid = meData.user.active_group || myGroups[0].id;
        try { await api('/invites', 'POST', { groupId: gid, toUsername: name }); toast('Davet gonderildi ✓', [], 2500); }
        catch (e) { toast(esc(e.message), [], 3000); }
      };
      row.appendChild(b);
    }
    el.appendChild(row);
  }
}

function initMain() {
  $('btn-logout').onclick = () => logout();
  $('btn-play').onclick = () => startPlay();
  // bot tercihleri hatirlanir
  const bc = $('bot-count'), bl = $('bot-level');
  if (localStorage.getItem('bp_bots') != null) bc.value = localStorage.getItem('bp_bots');
  if (localStorage.getItem('bp_botlevel')) bl.value = localStorage.getItem('bp_botlevel');
  bc.onchange = () => localStorage.setItem('bp_bots', bc.value);
  bl.onchange = () => localStorage.setItem('bp_botlevel', bl.value);
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => {
    b.onclick = () => showPage(b.dataset.page);
  });
  $('nav-character').onclick = () => openSkinEditor(false);
  $('btn-new-weapon').onclick = () => openWeaponEditor();
  $('btn-pick-close').onclick = () => $('modal-pick').classList.add('hidden');
  $('btn-create-group').onclick = async () => {
    const name = $('group-create-name').value.trim();
    if (!name) return;
    try {
      await api('/groups', 'POST', { name });
      $('group-create-name').value = '';
      toast('Grup kuruldu! Artik oyuncu davet edebilirsin. 🛡️', [], 3500);
      await refreshMe();
    } catch (e) { toast(esc(e.message), [], 3000); }
  };
}

// ---------------- skin editoru ----------------
function openSkinEditor(first) {
  firstSkin = first;
  show('screen-skin');
  $('skin-title').textContent = first ? 'Karakterini Yap!' : 'Karakterini Duzenle';
  if (!skinEd) {
    skinEd = new PixelEditor($('skin-canvas'), 12, 18, { emojiSize: 8 });
    skinPrev = makeSpinPreview($('skin-preview3d'));
    bindEditorUI($('screen-skin'), skinEd, skinPrev, 0.1, 2);
    const sel = $('skin-templates');
    sel.onchange = () => {
      if (SKIN_TEMPLATES[sel.value]) { skinEd.pushUndo(); skinEd.setGrid(SKIN_TEMPLATES[sel.value]); }
      sel.value = '';
    };
    // hizli emoji secimi
    const q = document.querySelector('#screen-skin .emoji-quick');
    for (const e of ['😀', '😎', '👑', '🔥', '💀', '⚡', '🐱', '🌟', '❌']) {
      const b = document.createElement('button');
      b.className = 'emoji-btn';
      b.textContent = e === '❌' ? '❌' : e;
      b.onclick = () => { $('skin-emoji').value = e === '❌' ? '' : e; };
      q.appendChild(b);
    }
    $('btn-skin-save').onclick = async () => {
      try {
        const data = skinEd.getGrid();
        const emj = $('skin-emoji').value.trim();
        if (emj) { data.emoji = emj; data.emojiAnim = $('skin-emoji-anim').value; }
        await api('/skin', 'POST', { data });
        await refreshMe();
        show('screen-main'); renderMain();
        toast('Karakter kaydedildi! 🎨', [], 2500);
      } catch (e) { toast(esc(e.message), [], 3000); }
    };
    $('btn-skin-back').onclick = () => {
      if (!firstSkin) { show('screen-main'); renderMain(); }
      else toast('Once karakterini kaydet!', [], 2500);
    };
  }
  skinEd.setGrid(meData.skin || SKIN_TEMPLATES.asker);
  $('skin-emoji').value = (meData.skin && meData.skin.emoji) || '';
  $('skin-emoji-anim').value = (meData.skin && meData.skin.emojiAnim) || 'zipla';
}

// ---------------- silah editoru ----------------
function openWeaponEditor() {
  $('modal-weapon').classList.remove('hidden');
  if (!weapEd) {
    weapEd = new PixelEditor($('weap-canvas'), 16, 10, { emojiSize: 6 });
    weapPrev = makeSpinPreview($('weap-preview3d'));
    bindEditorUI($('modal-weapon'), weapEd, weapPrev, 0.09, 2);
    $('weap-type').onchange = renderWeapStats;
    $('btn-weap-close').onclick = () => $('modal-weapon').classList.add('hidden');
    $('btn-weap-save').onclick = async () => {
      try {
        // sticker girisinden emojileri ayikla
        const raw = $('weap-stickers').value.trim();
        const stickers = raw ? [...new Intl.Segmenter('tr', { granularity: 'grapheme' }).segment(raw)]
          .map(s => s.segment).filter(s => s.trim()).slice(0, 3) : [];
        await api('/weapons', 'POST', {
          name: $('weap-name').value || 'Silahim',
          type: $('weap-type').value,
          skin: weapEd.getGrid(),
          anim: $('weap-anim').value,
          color: $('weap-color').value,
          stickers
        });
        $('modal-weapon').classList.add('hidden');
        toast('Silah kaydedildi! Envanterden slota ata. 🔫', [], 3000);
        await refreshMe();
      } catch (e) { toast(esc(e.message), [], 3000); }
    };
  }
  const sel = $('weap-type');
  sel.innerHTML = '';
  for (const t of meData.weaponTypes) {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    sel.appendChild(o);
  }
  renderWeapStats();
  weapEd.setGrid(WEAPON_TEMPLATE);
}
function renderWeapStats() {
  const t = meData.weaponTypes.find(x => x.id === $('weap-type').value);
  if (!t) return;
  $('weap-stats').innerHTML =
    `Hasar <b>${t.dmg}</b> · Atis araligi <b>${t.rate}ms</b> · ` +
    (t.beam ? 'Anlik isin' : `Mermi hizi <b>${t.speed}m/s</b>`) +
    ` · Menzil <b>${t.range}m</b>` + (t.pellets > 1 ? ` · Sacma x${t.pellets}` : '') + (t.auto ? ' · OTOMATIK' : '') +
    (t.id === 'keskin' ? ' · 🔭 DURBUN (sag tik)' : '');
}

// ---------------- oyun ----------------
function startPlay() {
  if (!meData.skin) { openSkinEditor(true); return; }
  show('screen-game');
  game = startGame({
    socket,
    me: { uid: meData.user.id, name: meData.user.username },
    myGroupId: meData.user.active_group,
    mapId: selectedMap,
    myWeapons: meData.weapons,
    myLoadout: meData.loadout,
    bots: Number($('bot-count').value) || 0,
    botLevel: $('bot-level').value,
    saveLoadout: async (slots) => { await api('/loadout', 'POST', { slots }); meData.loadout = slots.slice(); },
    onExit: async () => {
      game = null;
      show('screen-main');
      await refreshMe();
      renderMain();
    }
  });
}

// ---------------- baslangic ----------------
async function boot() {
  try {
    meData = await api('/me');
  } catch (e) { show('screen-auth'); return; }
  connectSocket();
  await refreshMaps();
  if (!meData.skin) { openSkinEditor(true); }
  else { show('screen-main'); renderMain(); showPage('home'); }
}

initAuth();
initMain();
document.addEventListener('pointerdown', unlockAudio, { once: true });
if (token) boot(); else show('screen-auth');
