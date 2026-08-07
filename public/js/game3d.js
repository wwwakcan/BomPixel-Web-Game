// BomPixel - 3D oyun istemcisi (Three.js)
// Ozellikler: 3 silahlik loadout (1/2/3 + scroll), C4 (4), durbun zoom, ziplama,
// kafa ustu can barlari, hareketli emoji, sticker'li silahlar, konumsal sesler.
import * as THREE from '/vendor/three.module.js';
import { voxelMeshFromGrid, makeNameSprite, makeEmojiSprite, makeHpBar, drawGridToCanvas } from './voxel.js';
import { buildWorld, buildWalls, heightAt, tileType, insideBuilding, collideMove, redrawSign, addSign } from './world.js';
import { sfx, unlockAudio, positional } from './audio.js';

const BUILD = 'v8'; // konsolda gorunen istemci surumu (onbellek teshisi icin)
const EYE = 1.5, SPEED = 6, INTERP_MS = 120;
const JUMP_V = 5.4, GRAV = 14.5;
const PLANT_MS = 2500, DEFUSE_MS = 4000;
const $ = id => document.getElementById(id);
const isMobile = () => ('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches;

function circleTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

export function startGame({ socket, me, myGroupId, mapId, myWeapons, myLoadout, saveLoadout, bots, botLevel, onExit }) {
  unlockAudio();
  const mobile = isMobile();
  const canvas = $('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const RES = mobile ? 0.42 : 0.55;
  canvas.style.imageRendering = 'pixelated';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x86c8f0);
  scene.fog = new THREE.Fog(0x86c8f0, 40, 130);
  const BASE_FOV = 75, ZOOM_FOV = 24;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a4038, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.0);
  sun.position.set(30, 60, 20); scene.add(sun);

  // Silah modeli (viewmodel) ayri sahnede cizilir -> duvarlarin icinden gecmez
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.2));
  const vmSun = new THREE.DirectionalLight(0xffffff, 0.8);
  vmSun.position.set(1, 2, 1); vmScene.add(vmSun);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(Math.max(2, w * RES) | 0, Math.max(2, h * RES) | 0, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vmCam.aspect = w / h; vmCam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const flashTex = circleTexture();

  // ---------- durum ----------
  let map = null, walls = [], world = null, selfId = null, joinedMapId = mapId;
  const weaponTypes = new Map();
  const players = new Map();
  const projMeshes = new Map();
  const c4Meshes = new Map();   // id -> {g, blink, data, nextBeep}
  const effects = [];
  const animSprites = [];        // {sp, mode, t0, base}
  let slots = [], activeSlot = 0, myStats = null, vm = null, vmFlash = null;
  let c4ReadyAt = 0;
  const self = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, k: 0, d: 0 };
  let vy = 0, grounded = true, jumpQueued = false;
  let zoomed = false;
  let myInside = -1, lastInsideApplied = -2;
  let firing = false, lastFire = 0, lastInputSent = 0;
  let planting = null, defusing = null, eDown = false, rightDown = false, nearestC4 = null;
  let stepT = 0, shake = 0;
  const kb = { vx: 0, vz: 0, t: 0 }; // patlama savrulmasi
  let snapOffset = null;
  let roundEndsAt = 0;
  let destroyed = false, tabOpen = false, menuOpen = false, shopOpen = false;
  let lastLockChange = 0, lastWheel = 0;
  const loadoutIds = (myLoadout || []).slice();
  const keys = {};
  const joy = { id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
  const look = { id: -1, lx: 0, ly: 0 };

  function lockPointer() {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  const activeWeapon = () => activeSlot < 3 ? slots[activeSlot] : null;
  const stickerBonus = w => Math.min(3, (w && w.stickers ? w.stickers.length : 0)) * 4;

  // ---------- yardimcilar ----------
  function posAudio(x, z, maxDist = 30, base = 0.14) {
    return positional(x - self.x, z - self.z, self.yaw, maxDist, base);
  }

  function addStickerSprites(parent, stickers, cx, cy, cz, size) {
    const list = [];
    (stickers || []).slice(0, 3).forEach((emj, i) => {
      const sp = makeEmojiSprite(emj, size);
      sp.position.set(cx + (i - 1) * size * 1.05, cy, cz);
      parent.add(sp);
      const rec = { sp, mode: 'pulse', t0: Math.random() * 6, base: size };
      animSprites.push(rec);
      list.push(rec);
    });
    return list;
  }
  function removeAnimSprites(list) {
    for (const rec of list || []) {
      const i = animSprites.indexOf(rec);
      if (i >= 0) animSprites.splice(i, 1);
      if (rec.sp.parent) rec.sp.parent.remove(rec.sp);
    }
  }

  // ---------- uzak oyuncular ----------
  function buildRemoteGun(rp) {
    if (rp.gun) { rp.g.remove(rp.gun); rp.gun = null; }
    removeAnimSprites(rp.gunStickers); rp.gunStickers = [];
    const slot = rp.activeSlot;
    if (slot === 3) { // C4 elinde
      const c4m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.16),
        new THREE.MeshLambertMaterial({ color: 0x22262c }));
      c4m.position.set(0.38, 1.05, -0.15);
      rp.g.add(c4m); rp.gun = c4m;
      return;
    }
    const w = rp.meta.slots && rp.meta.slots[slot];
    if (!w || !w.skin) return;
    const gun = voxelMeshFromGrid(w.skin, 0.045, 1);
    gun.rotation.y = Math.PI / 2;
    gun.position.set(0.38, 1.0, -0.1);
    rp.g.add(gun); rp.gun = gun;
    rp.gunStickers = addStickerSprites(rp.g, w.stickers, 0.38, 1.35, -0.1, 0.16);
  }

  function addRemote(meta) {
    if (meta.id === selfId || players.has(meta.id)) return;
    const g = new THREE.Group();
    const body = meta.skin && meta.skin.px ? voxelMeshFromGrid(meta.skin, 0.1, 2)
      : voxelMeshFromGrid({ w: 2, h: 4, px: ['#888888', '#888888', '#888888', '#888888', '#666666', '#666666', '#666666', '#666666'] }, 0.3, 2);
    body.rotation.y = Math.PI;
    g.add(body);
    const friendly = myGroupId != null && meta.group === myGroupId;
    const tag = makeNameSprite(meta.name, meta.groupName ? '[' + meta.groupName + ']' : null, friendly ? '#7dff9a' : '#ffffff');
    tag.position.y = 2.25;
    g.add(tag);
    const hpBar = makeHpBar();
    hpBar.draw(100, friendly);
    hpBar.sprite.position.y = 2.0;
    g.add(hpBar.sprite);
    // hareketli skin emojisi
    let emojiRec = null;
    if (meta.skin && meta.skin.emoji) {
      const sp = makeEmojiSprite(meta.skin.emoji, 0.42);
      sp.position.set(0, 2.55, 0);
      g.add(sp);
      emojiRec = { sp, mode: meta.skin.emojiAnim || 'zipla', t0: Math.random() * 6, base: 0.42, baseY: 2.55 };
      animSprites.push(emojiRec);
    }
    scene.add(g);
    const rp = {
      meta, g, gun: null, gunStickers: [], tag, hpBar, emojiRec,
      hasPos: false, tx: 0, ty: 0, tz: 0, tyaw: 0,
      inside: -1, hp: 100, lastHp: 100, k: 0, d: 0,
      friendly, activeSlot: meta.activeSlot || 0, stepAcc: 0
    };
    g.visible = false; // ilk konum gelene kadar gizli
    players.set(meta.id, rp);
    buildRemoteGun(rp);
  }
  function removeRemote(id) {
    const rp = players.get(id);
    if (rp) {
      removeAnimSprites(rp.gunStickers);
      if (rp.emojiRec) removeAnimSprites([rp.emojiRec]);
      scene.remove(rp.g);
      players.delete(id);
    }
  }
  function clearAllRemotes() { for (const id of [...players.keys()]) removeRemote(id); }

  // ---------- dunya ----------
  let mmBase = null; // minimap taban goruntusu
  function buildMinimapBase() {
    mmBase = document.createElement('canvas');
    mmBase.width = map.w; mmBase.height = map.h;
    const c = mmBase.getContext('2d');
    const TC = { 0: '#4a5a34', 1: '#3a3a42', 2: '#2a5a9a', 3: '#3a6e2c' };
    for (let z = 0; z < map.h; z++)
      for (let x = 0; x < map.w; x++) {
        c.fillStyle = TC[map.type[z * map.w + x]] || TC[0];
        c.fillRect(x, z, 1, 1);
      }
    c.fillStyle = '#8a7a6a';
    for (const b of map.buildings) c.fillRect(b.x, b.z, b.w, b.h);
  }
  function drawMinimap() {
    const cv = $('minimap');
    if (!cv || !mmBase) return;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    const scale = S / Math.max(map.w, map.h);
    const ox = (S - map.w * scale) / 2, oy = (S - map.h * scale) / 2;
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mmBase, ox, oy, map.w * scale, map.h * scale);
    const px = (x, z) => [ox + x * scale, oy + z * scale];
    // C4'ler (kirmizi yanip soner)
    const blinkOn = (Date.now() / 300 | 0) % 2 === 0;
    for (const m of c4Meshes.values()) {
      if (!blinkOn) continue;
      const [x, y] = px(m.g.position.x, m.g.position.z);
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    // takim arkadaslari (yesil)
    for (const rp of players.values()) {
      if (!rp.friendly || rp.hp <= 0) continue;
      const [x, y] = px(rp.g.position.x, rp.g.position.z);
      ctx.fillStyle = '#4dd34d';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.283); ctx.fill();
    }
    // kendim (beyaz ok, yon gosterir)
    const [sx2, sy2] = px(self.x, self.z);
    ctx.save();
    ctx.translate(sx2, sy2);
    ctx.rotate(-self.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function setMap(m) {
    map = m;
    walls = buildWalls(map);
    if (world) scene.remove(world.group);
    world = buildWorld(map);
    scene.add(world.group);
    lastInsideApplied = -2;
    buildMinimapBase();
  }
  function setBuildingAlpha(idx, alpha) {
    const bset = world.buildingMeshes[idx];
    if (!bset) return;
    for (const mt of bset.mats) { mt.opacity = alpha; mt.depthWrite = alpha > 0.9; }
  }
  function applyInsideVisual() {
    if (myInside === lastInsideApplied || !world) return;
    if (lastInsideApplied >= 0) setBuildingAlpha(lastInsideApplied, 1);
    if (myInside >= 0) setBuildingAlpha(myInside, 0.22);
    lastInsideApplied = myInside;
  }

  // ---------- kendi silahim (viewmodel) ----------
  let vmStickers = [];
  function setViewmodel() {
    if (vm) { vmScene.remove(vm); removeAnimSprites(vmStickers); vmStickers = []; }
    vm = new THREE.Group();
    const w = activeWeapon();
    if (w) {
      myStats = weaponTypes.get(w.type) || { rate: 400, auto: 0, beam: 0 };
      const gm = voxelMeshFromGrid(w.skin, 0.05, 2);
      gm.rotation.y = Math.PI / 2;
      vm.add(gm);
      vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: w.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false }));
      vmFlash.scale.set(0.5, 0.5, 1);
      vmFlash.position.set(0.02, 0.45, -0.55);
      vm.add(vmFlash);
      vmStickers = addStickerSprites(vm, w.stickers, -0.05, 0.3, 0.25, 0.1);
    } else {
      // C4 elde
      myStats = null;
      const c4m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.2),
        new THREE.MeshLambertMaterial({ color: 0x22262c }));
      c4m.position.set(0, 0.3, 0);
      vm.add(c4m);
      const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xff3030, transparent: true, blending: THREE.AdditiveBlending, depthTest: false }));
      led.scale.set(0.12, 0.12, 1);
      led.position.set(0.06, 0.42, 0.02);
      vm.add(led);
      vm.userData.led = led;
      vmFlash = null;
    }
    vm.position.set(0.3, -0.85, -0.55); // asagidan yukari cikis animasyonu
    vmScene.add(vm);
    updateWeaponHud();
    const wn = $('hud-weapon-name');
    if (wn) {
      if (w) {
        const b = stickerBonus(w);
        wn.textContent = w.name + (b ? ` (+%${b})` : '');
      } else wn.textContent = 'C4 💣';
    }
  }

  function switchSlot(slot, silent) {
    if (slot === activeSlot || slot < 0 || slot > 3) return;
    activeSlot = slot;
    setZoom(false);
    cancelActions();
    setViewmodel();
    socket.emit('switchSlot', { slot });
    if (!silent) sfx.switch();
    updateWeaponHud();
    updateMobileContext();
  }

  // ---------- silah HUD (sag altta dikey) ----------
  function buildWeaponHud() {
    const box = $('weapon-slots');
    if (!box) return;
    box.innerHTML = '';
    slots.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'wslot';
      d.dataset.slot = i;
      const cv = document.createElement('canvas');
      cv.width = 72; cv.height = 42;
      drawGridToCanvas(w.skin, cv, false);
      d.appendChild(cv);
      const info = document.createElement('div');
      info.className = 'wslot-info';
      const b = stickerBonus(w);
      info.innerHTML = `<span class="wslot-key">${i + 1}</span><span class="wslot-name">${w.name}${b ? ` <em>+%${b}</em>` : ''}</span>`;
      d.appendChild(info);
      d.onclick = () => switchSlot(i);
      box.appendChild(d);
    });
    const c4d = document.createElement('div');
    c4d.className = 'wslot c4';
    c4d.dataset.slot = 3;
    c4d.innerHTML = `<div class="c4-icon">💣</div><div class="wslot-info"><span class="wslot-key">4</span><span class="wslot-name">C4</span><span id="c4-status" class="c4-status">HAZIR</span></div>`;
    c4d.onclick = () => switchSlot(3);
    box.appendChild(c4d);
    updateWeaponHud();
  }
  function updateWeaponHud() {
    const box = $('weapon-slots');
    if (!box) return;
    box.querySelectorAll('.wslot').forEach(d => d.classList.toggle('active', Number(d.dataset.slot) === activeSlot));
  }
  function updateC4Hud() {
    const el = $('c4-status');
    if (!el) return;
    const left = c4ReadyAt - Date.now();
    if (left <= 0) { el.textContent = 'HAZIR'; el.classList.remove('cooldown'); }
    else { el.textContent = Math.ceil(left / 1000) + 'sn'; el.classList.add('cooldown'); }
  }

  // ---------- zoom (durbun) ----------
  function canZoom() { const w = activeWeapon(); return w && w.type === 'keskin'; }
  function setZoom(on) {
    if (on && !canZoom()) return;
    if (zoomed === on) return;
    zoomed = on;
    const sc = $('scope'); if (sc) sc.classList.toggle('hidden', !on);
    const ch = $('crosshair'); if (ch) ch.style.opacity = on ? 0 : 1;
    on ? sfx.zoomIn() : sfx.zoomOut();
  }

  // ---------- C4 dunya nesneleri ----------
  function addC4Mesh(c) {
    if (c4Meshes.has(c.i)) return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.28),
      new THREE.MeshLambertMaterial({ color: 0x22262c }));
    box.position.y = 0.1;
    g.add(box);
    const blink = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xff3030, transparent: true, blending: THREE.AdditiveBlending }));
    blink.scale.set(0.3, 0.3, 1);
    blink.position.y = 0.28;
    g.add(blink);
    g.position.set(c.p[0], c.p[1], c.p[2]);
    scene.add(g);
    c4Meshes.set(c.i, { g, blink, data: c, nextBeep: 0 });
  }
  function removeC4Mesh(id) {
    const m = c4Meshes.get(id);
    if (m) { scene.remove(m.g); c4Meshes.delete(id); }
  }
  function isEnemyC4(c) {
    if (c.o === me.uid) return false;
    if (myGroupId != null && c.g != null && c.g === myGroupId) return false;
    return true;
  }

  // ---------- kurma / cozme ----------
  function cancelActions() {
    if (planting) { planting = null; socket.emit('plantCancel'); hideActionBar(); }
    if (defusing) { defusing = null; socket.emit('defuseCancel'); hideActionBar(); }
  }
  function showActionBar(label) {
    const b = $('action-bar'); if (!b) return;
    b.classList.remove('hidden');
    $('action-label').textContent = label;
    $('action-fill').style.width = '0%';
  }
  function hideActionBar() { const b = $('action-bar'); if (b) b.classList.add('hidden'); }

  function tryStartPlant() {
    if (activeSlot !== 3 || planting || defusing) return;
    if (Date.now() < c4ReadyAt) { centerMsg('C4 hazir degil!', 900, '#ff8080'); return; }
    if (!grounded) return;
    planting = { start: performance.now(), lastTick: 0 };
    socket.emit('plantStart');
    showActionBar('💣 C4 KURULUYOR...');
  }
  function tryStartDefuse() {
    if (!nearestC4 || planting || defusing) return;
    defusing = { id: nearestC4.i, start: performance.now(), lastTick: 0 };
    socket.emit('defuseStart', { id: nearestC4.i });
    showActionBar('✂️ C4 COZULUYOR...');
  }

  // ---------- HUD ----------
  function setHP(hp) {
    self.hp = hp;
    const f = $('hp-fill'), n = $('hp-num');
    if (f) { f.style.width = Math.max(0, hp) + '%'; f.style.background = hp > 60 ? '#5dd35d' : hp > 30 ? '#e8c33a' : '#e05545'; }
    if (n) n.textContent = Math.max(0, hp);
  }
  function centerMsg(txt, ms = 1200, color = '#fff') {
    const el = $('center-msg'); if (!el) return;
    el.textContent = txt; el.style.color = color; el.style.opacity = 1;
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, ms);
  }
  function dmgFlash() {
    const el = $('dmg-flash'); if (!el) return;
    el.style.opacity = 0.55;
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 140);
  }
  function hitmark() {
    const el = $('hitmarker'); if (!el) return;
    el.style.opacity = 1;
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 130);
  }
  function feed(html) {
    const kf = $('killfeed'); if (!kf) return;
    const d = document.createElement('div');
    d.className = 'kf-item'; d.innerHTML = html;
    kf.prepend(d);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 4200);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderScoreboard(list) {
    const el = $('sb-rows'); if (!el) return;
    el.innerHTML = '';
    list.forEach((s, i) => {
      const r = document.createElement('div');
      r.className = 'sb-row' + (s.uid === me.uid ? ' me' : '');
      r.innerHTML = `<span class="sb-rank">${i + 1}</span><span class="sb-name">${esc(s.name)}${s.group ? ' <em>[' + esc(s.group) + ']</em>' : ''}</span><span class="sb-kd">${s.k}/${s.d}</span>`;
      el.appendChild(r);
    });
  }

  function renderTabList() {
    const el = $('tab-rows'); if (!el) return;
    el.innerHTML = '';
    const rows = [{ meta: { id: selfId, uid: me.uid, name: me.name, groupName: null }, k: self.k, d: self.d, self: true }];
    for (const rp of players.values()) rows.push({ meta: rp.meta, k: rp.k, d: rp.d });
    rows.sort((a, b) => b.k - a.k);
    for (const r of rows) {
      const div = document.createElement('div');
      div.className = 'tab-row' + (r.self ? ' me' : '');
      const gtag = r.meta.groupName ? ` <em>[${esc(r.meta.groupName)}]</em>` : '';
      div.innerHTML = `<span>${esc(r.meta.name)}${gtag}</span><span>${r.k}/${r.d}</span>`;
      if (!r.self && !r.meta.bot) {
        const btn = document.createElement('button');
        btn.className = 'btn tiny';
        btn.textContent = 'Gruba Davet';
        btn.onclick = () => socket.emit('inviteUser', { toUid: r.meta.uid }, (res) => {
          centerMsg(res && res.error ? res.error : 'Davet gonderildi ✓', 1500, res && res.error ? '#ff8080' : '#7dff9a');
        });
        div.appendChild(btn);
      }
      el.appendChild(div);
    }
  }

  function setTab(open) {
    tabOpen = open;
    const el = $('tab-list'); if (el) el.classList.toggle('hidden', !open);
    if (open) { renderTabList(); if (document.pointerLockElement) document.exitPointerLock(); }
    else if (!mobile && !menuOpen) lockPointer();
  }
  function setMenu(open) {
    menuOpen = open;
    const el = $('game-menu'); if (el) el.classList.toggle('hidden', !open);
    if (!open && !mobile && !tabOpen && !shopOpen) lockPointer();
  }

  // ---------- silah magazasi (B) ----------
  function setShop(open) {
    shopOpen = open;
    const el = $('shop'); if (el) el.classList.toggle('hidden', !open);
    if (open) { renderShop(); firing = false; if (document.pointerLockElement) document.exitPointerLock(); }
    else if (!mobile && !menuOpen && !tabOpen) lockPointer();
  }
  function renderShop() {
    const el = $('shop-rows'); if (!el) return;
    el.innerHTML = '';
    const typeName = t => (weaponTypes.get(t) || {}).name || t;
    for (const w of (myWeapons || [])) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 40; cv.className = 'weap-thumb';
      drawGridToCanvas(w.skin, cv, false);
      row.appendChild(cv);
      const info = document.createElement('div');
      info.className = 'grow';
      const b = stickerBonus(w);
      info.innerHTML = `<b>${esc(w.name)}</b><small>${esc(typeName(w.type))}${b ? ` · +%${b} hasar` : ''}${(w.stickers || []).join('')}</small>`;
      row.appendChild(info);
      for (let s = 0; s < 3; s++) {
        const bt = document.createElement('button');
        bt.className = 'btn tiny' + (loadoutIds[s] === w.id ? ' primary' : '');
        bt.textContent = String(s + 1);
        bt.onclick = async () => {
          loadoutIds[s] = w.id;
          try {
            if (saveLoadout) await saveLoadout(loadoutIds);
            socket.emit('reloadSlots');
            renderShop();
            centerMsg(`${w.name} → Slot ${s + 1} ✓`, 1200, '#7dff9a');
          } catch (e) { centerMsg('Kaydedilemedi', 1200, '#ff8080'); }
        };
        row.appendChild(bt);
      }
      el.appendChild(row);
    }
  }

  // ---------- girisler ----------
  function onKeyDown(e) {
    if (e.code === 'Tab') { e.preventDefault(); if (!shopOpen) setTab(!tabOpen); return; }
    if (e.code === 'KeyB') { if (!menuOpen && !tabOpen) setShop(!shopOpen); return; }
    if (e.code === 'Escape' && shopOpen) { setShop(false); return; }
    if (e.code === 'Escape' && !mobile && !document.pointerLockElement && !menuOpen && !tabOpen &&
        performance.now() - lastLockChange > 400) { setMenu(true); return; }
    if (menuOpen || tabOpen || shopOpen) return;
    if (e.code === 'Digit1') switchSlot(0);
    else if (e.code === 'Digit2') switchSlot(1);
    else if (e.code === 'Digit3') switchSlot(2);
    else if (e.code === 'Digit4') switchSlot(3);
    else if (e.code === 'Space') { e.preventDefault(); jumpQueued = true; }
    else if (e.code === 'KeyE') { eDown = true; if (nearestC4 && !defusing) tryStartDefuse(); }
    keys[e.code] = true;
  }
  function onKeyUp(e) {
    keys[e.code] = false;
    if (e.code === 'KeyE') eDown = false;
  }
  function onWheel(e) {
    if (menuOpen || tabOpen || shopOpen) return;
    const t = performance.now();
    if (t - lastWheel < 130) return;
    lastWheel = t;
    const dir = e.deltaY > 0 ? 1 : -1;
    switchSlot((activeSlot + dir + 4) % 4);
  }
  function onMouseMove(e) {
    if (document.pointerLockElement !== canvas) return;
    const sens = zoomed ? 0.0008 : 0.0022;
    self.yaw -= e.movementX * sens;
    self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch - e.movementY * sens));
  }
  function onMouseDown(e) {
    if (menuOpen || tabOpen || shopOpen) return;
    if (document.pointerLockElement !== canvas && !mobile) { lockPointer(); return; }
    if (e.button === 0) firing = true;
    if (e.button === 2) {
      rightDown = true;
      if (activeSlot === 3) tryStartPlant();
      else if (canZoom()) setZoom(!zoomed); // durbun: sag tik ac / tekrar sag tik kapat
    }
  }
  function onMouseUp(e) {
    if (e.button === 0) firing = false;
    if (e.button === 2) {
      rightDown = false;
      if (planting) cancelActions();
    }
  }
  function onCtx(e) { e.preventDefault(); }
  function onLockChange() {
    lastLockChange = performance.now();
    if (mobile) return;
    if (document.pointerLockElement !== canvas && !tabOpen && !shopOpen && !destroyed) setMenu(true);
    else if (document.pointerLockElement === canvas) setMenu(false);
  }

  // Mobil kontroller
  function updateMobileContext() {
    if (!mobile) return;
    const zb = $('btn-zoom'); if (zb) zb.classList.toggle('hidden', !canZoom());
    const ab = $('btn-action');
    if (ab) {
      if (activeSlot === 3) { ab.textContent = '💣 KUR'; ab.classList.remove('hidden'); }
      else if (nearestC4) { ab.textContent = '✂️ COZ'; ab.classList.remove('hidden'); }
      else ab.classList.add('hidden');
    }
  }
  function bindTouch() {
    const knob = $('joy-knob'), base = $('joy-base');
    canvas.addEventListener('touchstart', tStart, { passive: false });
    canvas.addEventListener('touchmove', tMove, { passive: false });
    canvas.addEventListener('touchend', tEnd, { passive: false });
    canvas.addEventListener('touchcancel', tEnd, { passive: false });
    function tStart(e) {
      e.preventDefault(); unlockAudio();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && joy.id === -1) {
          joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joy.dx = joy.dy = 0;
          if (base) { base.style.left = (t.clientX - 55) + 'px'; base.style.top = (t.clientY - 55) + 'px'; base.classList.remove('hidden'); }
        } else if (look.id === -1) {
          look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
        }
      }
    }
    function tMove(e) {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) {
          joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.ox) / 45));
          joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.oy) / 45));
          if (knob) knob.style.transform = `translate(${joy.dx * 32}px, ${joy.dy * 32}px)`;
        } else if (t.identifier === look.id) {
          const sens = zoomed ? 0.002 : 0.006;
          self.yaw -= (t.clientX - look.lx) * sens;
          self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch - (t.clientY - look.ly) * sens));
          look.lx = t.clientX; look.ly = t.clientY;
        }
      }
    }
    function tEnd(e) {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) { joy.id = -1; joy.dx = joy.dy = 0; if (base) base.classList.add('hidden'); if (knob) knob.style.transform = ''; }
        if (t.identifier === look.id) look.id = -1;
      }
    }
    const hold = (el, down, up) => {
      if (!el) return;
      el.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); up && up(); }, { passive: false });
    };
    hold($('btn-fire'), () => { firing = true; }, () => { firing = false; });
    hold($('btn-jump'), () => { jumpQueued = true; });
    hold($('btn-zoom'), () => setZoom(!zoomed));
    hold($('btn-action'),
      () => { if (activeSlot === 3) tryStartPlant(); else if (nearestC4) tryStartDefuse(); },
      () => { if (planting || defusing) cancelActions(); });
    const tb = $('btn-tab-m'); if (tb) tb.onclick = () => setTab(!tabOpen);
    const mb = $('btn-menu-m'); if (mb) mb.onclick = () => destroy();
    const sb = $('btn-sb-m'); if (sb) sb.onclick = () => $('scoreboard').classList.toggle('collapsed');
    const shb = $('btn-shop-m'); if (shb) shb.onclick = () => setShop(!shopOpen);
  }

  // ---------- socket ----------
  const H = {};
  H.welcome = (w) => {
    selfId = w.selfId;
    joinedMapId = w.mapId;
    weaponTypes.clear();
    for (const t of w.weaponTypes) weaponTypes.set(t.id, t);
    clearAllRemotes();
    for (const [id, pm] of projMeshes) { scene.remove(pm.mesh); projMeshes.delete(id); }
    for (const id of [...c4Meshes.keys()]) removeC4Mesh(id);
    setMap(w.map);
    for (const meta of w.players) {
      if (meta.id === selfId) { slots = meta.slots; activeSlot = 0; buildWeaponHud(); setViewmodel(); continue; }
      addRemote(meta);
    }
    [self.x, self.y, self.z] = w.spawn;
    vy = 0; grounded = true;
    roundEndsAt = w.round.endsAt;
    c4ReadyAt = w.c4 ? w.c4.readyAt : 0;
    for (const c of (w.c4s || [])) addC4Mesh(c);
    setHP(100);
    centerMsg(w.mapName + ' — Savas basladi!', 1800, '#ffe066');
  };
  H.playerJoin = (meta) => { addRemote(meta); feed(`<b>${esc(meta.name)}</b> katildi`); };
  H.playerLeave = (m) => removeRemote(m.id);
  H.snap = (s) => {
    const nowMs = performance.now();
    const target = nowMs - s.t;
    snapOffset = snapOffset == null ? target : snapOffset * 0.9 + target * 0.1;
    for (const p of s.players) {
      if (p.i === selfId) {
        if (p.h !== self.hp) setHP(p.h);
        self.k = p.k; self.d = p.d;
        continue;
      }
      const rp = players.get(p.i);
      if (!rp) continue;
      // hedef konum: bozuk veri asla islenmez
      if (isFinite(p.p[0]) && isFinite(p.p[1]) && isFinite(p.p[2])) {
        rp.tx = p.p[0]; rp.ty = p.p[1]; rp.tz = p.p[2]; rp.tyaw = isFinite(p.y) ? p.y : 0;
        if (!rp.hasPos) { // ilk konumda dogrudan isinlan (0,0,0'dan kaymasin)
          rp.hasPos = true;
          rp.g.position.set(rp.tx, rp.ty, rp.tz);
          rp.g.rotation.y = rp.tyaw;
        }
      }
      if (p.h !== rp.lastHp) { rp.hpBar.draw(p.h, rp.friendly); rp.lastHp = p.h; }
      rp.hp = p.h; rp.k = p.k; rp.d = p.d; rp.inside = p.in;
      if (p.s !== rp.activeSlot) { rp.activeSlot = p.s; buildRemoteGun(rp); }
    }
    // mermiler
    const seen = new Set();
    for (const pr of s.proj) {
      seen.add(pr.i);
      let pm = projMeshes.get(pr.i);
      if (!pm) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.26),
          new THREE.MeshBasicMaterial({ color: pr.c || '#ffdd33' }));
        scene.add(mesh);
        pm = { mesh, prev: pr.p.slice(), cur: pr.p.slice(), at: nowMs };
        projMeshes.set(pr.i, pm);
      } else {
        pm.prev = pm.cur; pm.cur = pr.p.slice(); pm.at = nowMs;
      }
    }
    for (const [id, pm] of projMeshes) if (!seen.has(id)) { scene.remove(pm.mesh); projMeshes.delete(id); }
    // c4'ler
    const seenC4 = new Set();
    for (const c of (s.c4 || [])) { seenC4.add(c.i); addC4Mesh(c); const m = c4Meshes.get(c.i); if (m) m.data = c; }
    for (const id of [...c4Meshes.keys()]) if (!seenC4.has(id)) removeC4Mesh(id);
    if (tabOpen) renderTabList();
  };
  H.shot = (m) => {
    if (m.pid === selfId) return;
    const rp = players.get(m.pid);
    if (rp) {
      rp.revealUntil = performance.now() + 1200; // ates eden kisa sure gorunur (namlu alevi ele verir)
      const p = rp.g.position;
      spawnFlashAt([p.x, p.y + 1.4, p.z], m.color, m.anim);
      const pa = posAudio(m.o[0], m.o[2], 45, 0.11);
      if (pa) sfx.fireRemote(m.wt, pa.vol, pa.pan);
    }
  };
  H.beam = (m) => {
    const rp = players.get(m.pid);
    if (rp) rp.revealUntil = performance.now() + 1200;
    spawnBeam(m.from, m.to, m.color);
  };
  H.hitYou = (m) => { setHP(m.hp); dmgFlash(); sfx.hurt(); };
  H.hitConfirm = () => { hitmark(); sfx.hitmark(); };
  H.kill = (m) => {
    const kn = m.killer ? esc(m.killer.name) : null;
    const wtxt = m.weapon === 'C4' ? ' 💣' : ' ⚡';
    const cause = m.cause === 'su' ? ' 💧 suya dustu' : '';
    feed(kn ? `<b>${kn}</b>${wtxt} <b>${esc(m.victim.name)}</b>` : `<b>${esc(m.victim.name)}</b>${cause || ' oldu'}`);
    if (m.victim.uid === me.uid) {
      sfx.death();
      centerMsg(m.cause === 'su' ? 'SUYA DUSTUN! 💧' : m.cause === 'c4' ? 'C4 SENI YOK ETTI! 💥' : 'OLDUN!', 1200, '#ff6060');
    } else if (m.killer && m.killer.uid === me.uid) {
      sfx.kill();
      centerMsg('+1 ' + (m.weapon === 'C4' ? '💥' : '⚡') + ' ' + esc(m.victim.name), 1100, '#7dff9a');
    }
  };
  H.respawn = (m) => { [self.x, self.y, self.z] = m.pos; vy = 0; grounded = true; setHP(100); sfx.respawn(); cancelActions(); setZoom(false); };
  H.splash = (m) => {
    const pa = posAudio(m.pos[0], m.pos[2], 30, 0.16);
    if (pa) sfx.splash(pa.vol, pa.pan);
  };
  H.score = (list) => renderScoreboard(list);
  H.roundStart = (m) => { roundEndsAt = m.endsAt; $('round-over') && $('round-over').classList.add('hidden'); centerMsg('YENI TUR!', 1500, '#ffe066'); };
  H.roundEnd = (m) => {
    const ov = $('round-over'); if (!ov) return;
    const rows = m.scores.map((s, i) => `<div class="sb-row"><span class="sb-rank">${i + 1}</span><span class="sb-name">${esc(s.name)}</span><span class="sb-kd">${s.k}/${s.d}</span></div>`).join('');
    ov.innerHTML = `<div class="panel"><h2>TUR BITTI</h2>${m.scores[0] ? `<p class="winner">🏆 ${esc(m.scores[0].name)}</p>` : ''}${rows}<p class="dim">Yeni tur birazdan...</p></div>`;
    ov.classList.remove('hidden');
  };
  H.mapChange = (m) => { setMap(m.map); centerMsg('Harita guncellendi: ' + m.name, 2000, '#ffe066'); };
  H.signUpdate = (sign) => {
    if (!world) return;
    const entry = world.signMeshes.get(sign.id);
    if (entry) {
      entry.sign = Object.assign({}, entry.sign, { type: sign.type, content: sign.content, pixel: sign.pixel, color: sign.color, bg: sign.bg });
      redrawSign(entry, entry.sign);
    } else {
      world.signMeshes.set(sign.id, addSign(world.group, sign));
    }
  };
  // ---- C4 olaylari ----
  H.c4Planted = (c) => {
    addC4Mesh(c);
    feed(`<b>${esc(c.by)}</b> C4 kurdu! 💣`);
    if (c.o === me.uid) { hideActionBar(); centerMsg('C4 KURULDU! 💣', 1400, '#ffcc44'); }
    else if (isEnemyC4(c)) centerMsg('⚠️ DUSMAN C4 KURDU! Bul ve coz (+' + 3 + ' puan)', 2200, '#ff9944');
  };
  H.c4Defused = (m) => {
    removeC4Mesh(m.id);
    sfx.defused();
    feed(`<b>${esc(m.by)}</b> C4'u cozdu ✂️ +${m.score}`);
    if (defusing && defusing.id === m.id) { defusing = null; hideActionBar(); centerMsg('C4 COZULDU! +' + m.score + ' PUAN ✂️', 1600, '#7dff9a'); }
  };
  H.c4Exploded = (m) => {
    removeC4Mesh(m.id);
    spawnExplosion(m.pos);
    // savrulma: patlamaya yakinsan firlatilirsin
    const radius = m.radius || 50;
    const dx = self.x - m.pos[0], dz = self.z - m.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < radius) {
      const st = Math.max(0.15, 1 - d / radius);
      const nx = d > 0.3 ? dx / d : Math.cos(Math.random() * 6.28);
      const nz = d > 0.3 ? dz / d : Math.sin(Math.random() * 6.28);
      kb.vx = nx * 16 * st; kb.vz = nz * 16 * st; kb.t = 0.5;
      vy = Math.max(vy, 7 * st); grounded = false;
      shake = Math.max(shake, 0.9 * st);
    }
  };
  H.c4Status = (m) => { c4ReadyAt = m.readyAt; updateC4Hud(); };
  H.actionCancel = (m) => { planting = null; defusing = null; hideActionBar(); };
  H.playerSlots = (m) => {
    if (m.id === selfId) {
      slots = m.slots;
      buildWeaponHud(); setViewmodel();
    } else {
      const rp = players.get(m.id);
      if (rp) { rp.meta.slots = m.slots; buildRemoteGun(rp); }
    }
  };
  H.connect = () => { if (!destroyed && selfId) socket.emit('join', { mapId: joinedMapId, bots, botLevel }); };
  for (const [ev, fn] of Object.entries(H)) socket.on(ev, fn);

  // ---------- efektler ----------
  function spawnBeam(from, to, color) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    g.scale.z = len;
    g.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    g.lookAt(new THREE.Vector3(...to));
    scene.add(g);
    effects.push({ mesh: g, ttl: 0.14, max: 0.14 });
  }
  function spawnFlashAt(pos, color, anim) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color, transparent: true, blending: THREE.AdditiveBlending }));
    const s = anim === 'alev' ? 0.85 : 0.5;
    sp.scale.set(s, s, 1);
    sp.position.set(...pos);
    scene.add(sp);
    effects.push({ mesh: sp, ttl: 0.09, max: 0.09 });
    if (anim === 'enerji') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      ring.position.set(...pos);
      ring.lookAt(camera.position);
      scene.add(ring);
      effects.push({ mesh: ring, ttl: 0.22, max: 0.22, grow: 6 });
    }
  }
  function spawnExplosion(pos) {
    // buyuyen ates kuresi
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    ball.position.set(pos[0], pos[1] + 0.4, pos[2]);
    scene.add(ball);
    effects.push({ mesh: ball, ttl: 0.5, max: 0.5, grow: 14 });
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffdd88, transparent: true, blending: THREE.AdditiveBlending }));
    flash.scale.set(9, 9, 1);
    flash.position.set(pos[0], pos[1] + 1, pos[2]);
    scene.add(flash);
    effects.push({ mesh: flash, ttl: 0.25, max: 0.25 });
    // sarapnel parcaciklari
    for (let i = 0; i < 16; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff8833 : 0x333333 }));
      p.position.set(pos[0], pos[1] + 0.4, pos[2]);
      scene.add(p);
      const a = Math.random() * Math.PI * 2, sp2 = 4 + Math.random() * 6;
      effects.push({
        mesh: p, ttl: 0.8 + Math.random() * 0.4, max: 1.2,
        vel: [Math.cos(a) * sp2, 4 + Math.random() * 5, Math.sin(a) * sp2], grav: true
      });
    }
    const d = Math.hypot(pos[0] - self.x, pos[2] - self.z);
    const pa = posAudio(pos[0], pos[2], 80, 0.35);
    sfx.explosion(pa ? pa.vol + 0.08 : 0.1, pa ? pa.pan : 0);
    if (d < 18) shake = Math.max(shake, 0.55 * (1 - d / 18));
  }

  // ---------- dongu ----------
  const fwdV = new THREE.Vector3();
  let lastT = performance.now(), rafId = 0, bobT = 0, c4HudT = 0, c4TopT = 0;

  function loop() {
    if (destroyed) return;
    rafId = requestAnimationFrame(loop);
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - lastT) / 1000);
    lastT = nowMs;
    if (!map) { renderer.render(scene, camera); return; }

    // hareket girdisi
    let f = 0, st = 0;
    const frozen = menuOpen || tabOpen || shopOpen || planting || defusing;
    if (!frozen) {
      if (keys.KeyW || keys.ArrowUp) f += 1;
      if (keys.KeyS || keys.ArrowDown) f -= 1;
      if (keys.KeyD) st += 1;
      if (keys.KeyA) st -= 1;
      if (mobile) { f += -joy.dy; st += joy.dx; }
    }
    const L = Math.hypot(f, st);
    if (L > 1) { f /= L; st /= L; }
    const moving = (f || st);
    if (moving) {
      const sy = Math.sin(self.yaw), cy = Math.cos(self.yaw);
      const spd = zoomed ? SPEED * 0.55 : SPEED;
      const mx = (-sy * f + cy * st) * spd * dt;
      const mz = (-cy * f - sy * st) * spd * dt;
      const [nx, nz] = collideMove(map, walls, self.x, self.z, self.x + mx, self.z + mz, self.y);
      self.x = nx; self.z = nz;
      bobT += dt * 9;
    }

    // ziplama + yercekimi
    const gh = heightAt(map, self.x, self.z);
    if (jumpQueued) {
      jumpQueued = false;
      if (grounded && !frozen) { vy = JUMP_V; grounded = false; sfx.jump(); }
    }
    if (!grounded) {
      vy -= GRAV * dt;
      self.y += vy * dt;
      if (self.y <= gh) {
        self.y = gh;
        if (vy < -7) sfx.land();
        vy = 0; grounded = true;
      }
    } else {
      if (gh > self.y + 0.01) self.y = Math.min(gh, self.y + 12 * dt); // basamak cik
      else if (gh < self.y - 0.05) { grounded = false; vy = 0; }       // kenardan dus
      else self.y = gh;
    }

    // patlama savrulmasi
    if (kb.t > 0) {
      kb.t -= dt;
      const [kx, kz] = collideMove(map, walls, self.x, self.z, self.x + kb.vx * dt, self.z + kb.vz * dt, self.y);
      self.x = kx; self.z = kz;
      const dec = Math.max(0, 1 - dt * 2.2);
      kb.vx *= dec; kb.vz *= dec;
    }

    // adim sesleri (kendi)
    if (moving && grounded && !frozen) {
      stepT += dt;
      if (stepT > 0.36) { stepT = 0; sfx.step(0.045, 0); }
    } else stepT = 0.2;

    myInside = insideBuilding(map, self.x, self.z);
    applyInsideVisual();

    // zoom FOV animasyonu
    const targetFov = zoomed ? ZOOM_FOV : BASE_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }

    camera.position.set(self.x, self.y + EYE, self.z);
    camera.rotation.y = self.yaw;
    camera.rotation.x = self.pitch;
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.5;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      shake *= Math.max(0, 1 - dt * 4);
    }

    // viewmodel
    if (vm) {
      vm.visible = !zoomed;
      const targetY = planting ? -1.0 : -0.62;
      vm.position.y += (targetY + (grounded && moving ? Math.sin(bobT) * 0.012 : 0) - vm.position.y) * Math.min(1, dt * 8);
      vm.position.z += (-0.55 - vm.position.z) * Math.min(1, dt * 14);
      if (vm.userData.led) vm.userData.led.material.opacity = (Math.sin(nowMs / 150) > 0 ? 1 : 0.15);
    }

    // ates
    if (firing && myStats && activeSlot < 3 && !frozen) {
      const t = Date.now();
      if (t - lastFire >= myStats.rate) {
        lastFire = t;
        camera.getWorldDirection(fwdV);
        socket.emit('fire', { o: [self.x, self.y + EYE, self.z], d: [fwdV.x, fwdV.y, fwdV.z] });
        sfx.fire(activeWeapon().type);
        if (vm) vm.position.z = -0.47;
        if (vmFlash) {
          vmFlash.material.opacity = 1;
          setTimeout(() => { if (vmFlash) vmFlash.material.opacity = 0; }, 60);
        }
        if (!myStats.auto) firing = false;
      }
    }

    // kurma / cozme ilerlemesi
    if (planting) {
      const el = nowMs - planting.start;
      $('action-fill').style.width = Math.min(100, el / PLANT_MS * 100) + '%';
      if (el - planting.lastTick > 400) { planting.lastTick = el; sfx.plantTick(); }
      if (el >= PLANT_MS) { socket.emit('plantDone'); planting = null; hideActionBar(); }
    }
    if (defusing) {
      const el = nowMs - defusing.start;
      $('action-fill').style.width = Math.min(100, el / DEFUSE_MS * 100) + '%';
      if (el - defusing.lastTick > 500) { defusing.lastTick = el; sfx.defuseTick(); }
      if (!c4Meshes.has(defusing.id)) { defusing = null; hideActionBar(); }
      else if (el >= DEFUSE_MS) { socket.emit('defuseDone', { id: defusing.id }); defusing = null; hideActionBar(); }
    }

    // yakin dusman C4 tespiti + istem
    let nc = null, ncDist = 2.0;
    for (const m of c4Meshes.values()) {
      if (!isEnemyC4(m.data)) continue;
      const d = Math.hypot(m.g.position.x - self.x, m.g.position.z - self.z);
      if (d < ncDist) { ncDist = d; nc = m.data; }
    }
    if ((nc && !nearestC4) || (!nc && nearestC4) || (nc && nearestC4 && nc.i !== nearestC4.i)) {
      nearestC4 = nc;
      const dp = $('defuse-prompt');
      if (dp) dp.classList.toggle('hidden', !nc || mobile);
      updateMobileContext();
    }

    // C4 bip + isik
    for (const m of c4Meshes.values()) {
      const leftMs = m.data.t - Date.now();
      const interval = Math.max(120, Math.min(1100, leftMs * 0.09));
      if (nowMs >= m.nextBeep) {
        m.nextBeep = nowMs + interval;
        const pa = posAudio(m.g.position.x, m.g.position.z, 26, 0.1);
        if (pa) sfx.beep(pa.vol, pa.pan);
        m.blink.material.opacity = 1;
      } else {
        m.blink.material.opacity = Math.max(0.12, m.blink.material.opacity - dt * 5);
      }
    }

    // girdiyi gonder (20 Hz)
    if (nowMs - lastInputSent > 50) {
      lastInputSent = nowMs;
      socket.emit('input', { p: [self.x, self.y, self.z], y: self.yaw, pi: self.pitch });
    }

    // uzak oyuncular: son hedefe yumusak kayma (basit ve saglam)
    for (const rp of players.values()) {
      if (!rp.hasPos) { rp.g.visible = false; continue; }
      const g = rp.g.position;
      const k = Math.min(1, dt * 11);
      const oldX = g.x, oldZ = g.z;
      g.x += (rp.tx - g.x) * k;
      g.y += (rp.ty - g.y) * k;
      g.z += (rp.tz - g.z) * k;
      let dyaw = (rp.tyaw - rp.g.rotation.y) % (Math.PI * 2);
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      rp.g.rotation.y += dyaw * k;
      // uzak adim sesleri (mesafe + yon)
      const moved = Math.hypot(g.x - oldX, g.z - oldZ);
      if (moved > 0.001 && moved < 1) {
        rp.stepAcc += moved;
        if (rp.stepAcc > 2.3) {
          rp.stepAcc = 0;
          const pa = posAudio(g.x, g.z, 22, 0.06);
          if (pa) sfx.step(pa.vol, pa.pan);
        }
      }
      const hidden = rp.inside >= 0 && rp.inside !== myInside && nowMs > (rp.revealUntil || 0);
      rp.g.visible = !hidden && rp.hp > 0;
    }

    // mermiler
    for (const pm of projMeshes.values()) {
      const k = Math.max(0, Math.min(1, (nowMs - pm.at) / 55));
      pm.mesh.position.set(
        pm.prev[0] + (pm.cur[0] - pm.prev[0]) * k,
        pm.prev[1] + (pm.cur[1] - pm.prev[1]) * k,
        pm.prev[2] + (pm.cur[2] - pm.prev[2]) * k);
    }

    // animasyonlu spritelar (emoji + sticker)
    const at = nowMs / 1000;
    for (const r of animSprites) {
      const t = at + r.t0;
      if (r.mode === 'zipla' && r.baseY != null) r.sp.position.y = r.baseY + Math.sin(t * 4) * 0.09;
      else if (r.mode === 'don') r.sp.material.rotation = t * 2.2;
      else if (r.mode === 'buyu' || r.mode === 'pulse') {
        const s = r.base * (1 + Math.sin(t * 3) * 0.13);
        r.sp.scale.set(s, s, 1);
      }
    }

    // efektler
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.ttl -= dt;
      if (e.ttl <= 0) { scene.remove(e.mesh); effects.splice(i, 1); continue; }
      const k = e.ttl / e.max;
      if (e.mesh.material) e.mesh.material.opacity = k;
      if (e.grow) { const s = 1 + (1 - k) * e.grow; e.mesh.scale.set(s, s, s); }
      if (e.vel) {
        e.vel[1] -= 12 * dt;
        e.mesh.position.x += e.vel[0] * dt;
        e.mesh.position.y += e.vel[1] * dt;
        e.mesh.position.z += e.vel[2] * dt;
        if (e.mesh.position.y < 0.05) { e.mesh.position.y = 0.05; e.vel[1] = Math.abs(e.vel[1]) * 0.3; e.vel[0] *= 0.6; e.vel[2] *= 0.6; }
      }
    }

    // C4 HUD sayaci (saniyede bir)
    if (nowMs - c4HudT > 900) { c4HudT = nowMs; updateC4Hud(); }

    // ustte yanan C4 sayaci (kurulu C4 varsa)
    if (nowMs - c4TopT > 180) {
      c4TopT = nowMs;
      const el = $('c4-timer');
      if (el) {
        let soonest = Infinity;
        for (const m of c4Meshes.values()) soonest = Math.min(soonest, m.data.t);
        if (soonest < Infinity) {
          const left = Math.max(0, soonest - Date.now());
          el.classList.remove('hidden');
          el.classList.toggle('critical', left < 10000);
          el.innerHTML = `<span class="c4-fuse">💣</span> ${(left / 1000).toFixed(1)}sn`;
        } else el.classList.add('hidden');
      }
      drawMinimap();
    }

    // tur sayaci
    const rt = $('round-timer');
    if (rt && roundEndsAt) {
      const left = Math.max(0, roundEndsAt - Date.now());
      const mm = String(Math.floor(left / 60000)).padStart(2, '0');
      const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      rt.textContent = mm + ':' + ss;
    }

    renderer.render(scene, camera);
    if (vm && vm.visible) {
      renderer.autoClear = false;   // ikinci cizim ekrani SILMESIN (siyah ekran fixi)
      renderer.clearDepth();
      renderer.render(vmScene, vmCam);
      renderer.autoClear = true;
    }
  }

  // ---------- kur / yik ----------
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLockChange);
  if (mobile) {
    document.body.classList.add('is-mobile');
    bindTouch();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  } else {
    const br = $('btn-resume'); if (br) br.onclick = () => setMenu(false);
  }
  const be = $('btn-exit'); if (be) be.onclick = () => destroy();
  const bs = $('btn-shop-close'); if (bs) bs.onclick = () => setShop(false);

  // HUD katmanlarini temiz basla
  for (const id of ['shop', 'tab-list', 'game-menu', 'round-over', 'scope', 'action-bar', 'defuse-prompt']) {
    const el = $(id); if (el) el.classList.add('hidden');
  }
  const kf0 = $('killfeed'); if (kf0) kf0.innerHTML = '';

  // gelistirici teshis penceresi (konsoldan __bpDebug.state() ile durum bakilir)
  console.log('[BomPixel] istemci surumu:', BUILD);
  window.__bpDebug = {
    build: BUILD, players, projMeshes, c4Meshes, scene,
    state: () => ({
      build: BUILD, selfId, mapId: joinedMapId, remotes: players.size,
      self: { x: +self.x.toFixed(1), y: +self.y.toFixed(1), z: +self.z.toFixed(1), inside: myInside },
      list: [...players.entries()].map(([id, rp]) => ({
        id, name: rp.meta.name, visible: rp.g.visible,
        pos: rp.g.position.toArray().map(v => +v.toFixed(1)),
        target: [+rp.tx.toFixed(1), +rp.ty.toFixed(1), +rp.tz.toFixed(1)],
        hasPos: rp.hasPos, hp: rp.hp, inside: rp.inside, slot: rp.activeSlot
      }))
    })
  };

  resize();
  socket.emit('join', { mapId: joinedMapId, bots, botLevel });
  loop();
  if (!mobile) setTimeout(lockPointer, 60);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(rafId);
    socket.emit('leaveArena');
    for (const [ev, fn] of Object.entries(H)) socket.off(ev, fn);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('contextmenu', onCtx);
    canvas.removeEventListener('wheel', onWheel);
    document.removeEventListener('pointerlockchange', onLockChange);
    window.removeEventListener('resize', resize);
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    renderer.dispose();
    document.body.classList.remove('is-mobile');
    onExit && onExit();
  }

  return { destroy };
}
