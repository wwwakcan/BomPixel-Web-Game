// BomPixel - harita verisinden 3D dunya kurulumu + carpisma yardimcilari
import * as THREE from '/vendor/three.module.js';

export function heightAt(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= map.w || zi >= map.h) return 0;
  return map.height[zi * map.w + xi];
}
export function tileType(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= map.w || zi >= map.h) return 0;
  return map.type[zi * map.w + xi];
}
export function insideBuilding(map, x, z) {
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i];
    if (x > b.x + 0.4 && x < b.x + b.w - 0.4 && z > b.z + 0.4 && z < b.z + b.h - 0.4) return i;
  }
  return -1;
}

// Sunucudaki buildWalls ile birebir ayni mantik (carpisma icin)
export function buildWalls(map) {
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
  }
  return walls;
}

// Daire (oyuncu) vs duvar AABB'leri: eksen ayrik kaydirmali carpisma
// feetY: ziplarken yuksek karolara cikabilmek icin ayak yuksekligi
export function collideMove(map, walls, x, z, nx, nz, feetY = null, r = 0.32) {
  const refH = Math.max(heightAt(map, x, z), feetY == null ? -1 : feetY);
  let tx = nx;
  if (blocked(walls, tx, z, r) || stepTooHigh(map, refH, tx, z)) tx = x;
  let tz = nz;
  if (blocked(walls, tx, tz, r) || stepTooHigh(map, refH, tx, tz)) tz = z;
  tx = Math.min(map.w - 0.35, Math.max(0.35, tx));
  tz = Math.min(map.h - 0.35, Math.max(0.35, tz));
  return [tx, tz];
}
function blocked(walls, x, z, r) {
  for (const w of walls) {
    if (w.roof) continue;
    if (w.min[1] > 1.2) continue;
    if (x + r > w.min[0] && x - r < w.max[0] && z + r > w.min[2] && z - r < w.max[2]) return true;
  }
  return false;
}
function stepTooHigh(map, refH, x, z) {
  return heightAt(map, x, z) - refH > 1.05;
}

// ---------- dunya meshleri ----------
const TILE_COLORS = {
  0: ['#8a9a5b', '#93a465'], // zemin (cimen)
  1: ['#4a4a52', '#52525a'], // yol (asfalt)
  3: ['#5f9e4f', '#6aa858']  // park
};

export function buildWorld(map) {
  const group = new THREE.Group();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();

  // Zemin karolari (yukseklikli)
  let count = 0;
  for (let i = 0; i < map.w * map.h; i++) if (map.type[i] !== 2) count++;
  const ground = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, count));
  let gi = 0;
  for (let z = 0; z < map.h; z++)
    for (let x = 0; x < map.w; x++) {
      const t = map.type[z * map.w + x];
      if (t === 2) continue;
      const h = map.height[z * map.w + x];
      const top = h, bottom = -1;
      m.makeScale(1, top - bottom, 1);
      m.setPosition(x + 0.5, (top + bottom) / 2, z + 0.5);
      ground.setMatrixAt(gi, m);
      const base = TILE_COLORS[t] || TILE_COLORS[0];
      col.set(base[(x + z) % 2]);
      if (h > 0) col.offsetHSL(0, 0.02 * h, 0.03 * h); // tumsekler biraz acik
      if (t === 1 && (x % 8 === 4) && (z % 2 === 0)) col.set('#c8c84a'); // yol cizgileri
      ground.setColorAt(gi, col);
      gi++;
    }
  ground.count = Math.max(1, gi);
  ground.instanceMatrix.needsUpdate = true;
  if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
  group.add(ground);

  // Su karolari (yari saydam, olumcul!)
  let wcount = 0;
  for (let i = 0; i < map.w * map.h; i++) if (map.type[i] === 2) wcount++;
  if (wcount > 0) {
    const water = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshLambertMaterial({ color: 0x3a78c8, transparent: true, opacity: 0.75 }), wcount);
    let wi = 0;
    for (let z = 0; z < map.h; z++)
      for (let x = 0; x < map.w; x++) {
        if (map.type[z * map.w + x] !== 2) continue;
        m.makeScale(1, 0.8, 1);
        m.setPosition(x + 0.5, -0.62, z + 0.5);
        water.setMatrixAt(wi, m);
        col.set((x + z) % 2 ? '#3a78c8' : '#4488d8');
        water.setColorAt(wi, col);
        wi++;
      }
    water.instanceMatrix.needsUpdate = true;
    if (water.instanceColor) water.instanceColor.needsUpdate = true;
    group.add(water);
  }

  // Binalar: duvar kutulari + cati (icerdeyken saydamlasir)
  const buildingMeshes = []; // her bina icin {meshes:[], mats:[]}
  const th = 0.35;
  map.buildings.forEach((b) => {
    const bset = { meshes: [], mats: [] };
    const wallMat = new THREE.MeshLambertMaterial({ color: b.color || '#b0574a', transparent: true, opacity: 1 });
    const roofMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.color || '#b0574a').offsetHSL(0, -0.1, -0.18), transparent: true, opacity: 1 });
    bset.mats.push(wallMat, roofMat);
    const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.h, ht = b.ht;
    const dw = 1.5, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const addBox = (mat, xa, ya, za, xb, yb, zb) => {
      if (xb - xa < 0.05 || zb - za < 0.05) return;
      const g = new THREE.Mesh(boxGeo, mat);
      g.scale.set(xb - xa, yb - ya, zb - za);
      g.position.set((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
      group.add(g); bset.meshes.push(g);
    };
    const seg = (side, a0, a1) => {
      if (side === 'N') addBox(wallMat, a0, 0, z0, a1, ht, z0 + th);
      if (side === 'S') addBox(wallMat, a0, 0, z1 - th, a1, ht, z1);
      if (side === 'W') addBox(wallMat, x0, 0, a0, x0 + th, ht, a1);
      if (side === 'E') addBox(wallMat, x1 - th, 0, a0, x1, ht, a1);
    };
    for (const side of ['N', 'S', 'E', 'W']) {
      const horiz = (side === 'N' || side === 'S');
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      const c = horiz ? cx : cz;
      if (b.door === side) {
        seg(side, a0, c - dw / 2); seg(side, c + dw / 2, a1);
        // kapi ustu lentosu
        if (side === 'N') addBox(wallMat, c - dw / 2, 2.1, z0, c + dw / 2, ht, z0 + th);
        if (side === 'S') addBox(wallMat, c - dw / 2, 2.1, z1 - th, c + dw / 2, ht, z1);
        if (side === 'W') { const g = new THREE.Mesh(boxGeo, wallMat); g.scale.set(th, ht - 2.1, dw); g.position.set(x0 + th / 2, (2.1 + ht) / 2, c); group.add(g); bset.meshes.push(g); }
        if (side === 'E') { const g = new THREE.Mesh(boxGeo, wallMat); g.scale.set(th, ht - 2.1, dw); g.position.set(x1 - th / 2, (2.1 + ht) / 2, c); group.add(g); bset.meshes.push(g); }
      } else seg(side, a0, a1);
    }
    // cati
    const roof = new THREE.Mesh(boxGeo, roofMat);
    roof.scale.set(b.w, 0.3, b.h);
    roof.position.set(cx, ht + 0.15, cz);
    group.add(roof); bset.meshes.push(roof);
    buildingMeshes.push(bset);
  });

  // Tabelalar / reklamlar
  const signMeshes = new Map();
  for (const s of (map.signs || [])) signMeshes.set(s.id, addSign(group, s));

  return { group, buildingMeshes, signMeshes };
}

const ROT = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

export function addSign(group, sign) {
  const cv = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sign.w, sign.h), mat);
  mesh.position.set(sign.cx, sign.y, sign.cz);
  mesh.rotation.y = ROT[sign.side] ?? 0;
  group.add(mesh);
  let pole = null;
  if (sign.board) {
    pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, sign.y, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x555566 }));
    pole.position.set(sign.cx, sign.y / 2, sign.cz);
    group.add(pole);
  }
  const entry = { mesh, pole, canvas: cv, tex, sign };
  redrawSign(entry, sign);
  return entry;
}

export function redrawSign(entry, sign) {
  entry.sign = sign;
  const cv = entry.canvas;
  const ratio = sign.h / sign.w;
  cv.width = 256; cv.height = Math.max(32, Math.round(256 * ratio));
  const ctx = cv.getContext('2d');
  const draw = (c, w, h) => {
    c.fillStyle = sign.bg || '#1a1a2a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = sign.color || '#ffdd33';
    c.lineWidth = Math.max(1, h / 20);
    c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
    c.fillStyle = sign.color || '#ffdd33';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let fs = h * 0.55;
    c.font = `bold ${fs}px monospace`;
    const tw = c.measureText(sign.content || '').width;
    if (tw > w * 0.92) fs *= (w * 0.92) / tw;
    c.font = `bold ${Math.max(4, fs)}px monospace`;
    c.fillText(sign.content || '', w / 2, h / 2 + fs * 0.05);
  };
  const finish = () => { entry.tex.needsUpdate = true; };
  if (sign.type === 'image' && sign.content) {
    const img = new Image();
    img.onload = () => {
      const ctx2 = cv.getContext('2d');
      ctx2.imageSmoothingEnabled = true;
      if (sign.pixel) {
        const t = document.createElement('canvas');
        t.width = 40; t.height = Math.max(6, Math.round(40 * ratio));
        const tc = t.getContext('2d');
        tc.drawImage(img, 0, 0, t.width, t.height);
        ctx2.imageSmoothingEnabled = false;
        ctx2.drawImage(t, 0, 0, cv.width, cv.height);
      } else {
        ctx2.drawImage(img, 0, 0, cv.width, cv.height);
      }
      finish();
    };
    img.src = sign.content;
  } else {
    if (sign.pixel) {
      // dusuk cozunurlukte ciz, sonra piksel piksel buyut
      const t = document.createElement('canvas');
      t.width = 64; t.height = Math.max(8, Math.round(64 * ratio));
      draw(t.getContext('2d'), t.width, t.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, cv.width, cv.height);
    } else {
      draw(ctx, cv.width, cv.height);
    }
    finish();
  }
}
