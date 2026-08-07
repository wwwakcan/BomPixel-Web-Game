// BomPixel - Varsayilan "Piksel Sehir" haritasi ureteci
// Harita formati:
// {
//   w, h            : metre cinsinden boyut (1 karo = 1 m)
//   type[]          : w*h satir-oncelikli karo tipi (0 zemin, 1 yol, 2 su, 3 park)
//   height[]        : w*h karo yuksekligi (0..3, tumsekler)
//   buildings[]     : {x,z,w,h,ht,door:'N'|'S'|'E'|'W',color}
//   signs[]         : {id,x,z,y,side,w,h,type:'text'|'image',content,pixel,color,bg}
//   spawns[]        : [x,z]
// }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCity(W, H) {
  const rnd = mulberry32(1337);
  const type = new Array(W * H).fill(0);
  const height = new Array(W * H).fill(0);
  const buildings = [];
  const signs = [];
  const spawns = [];
  const at = (x, z) => z * W + x;

  // Yol izgarasi: her 16 karoda bir, 3 karo genis
  const roads = [];
  for (let x = 8; x < W - 4; x += 16) roads.push({ axis: 'v', pos: x });
  for (let z = 8; z < H - 4; z += 16) roads.push({ axis: 'h', pos: z });
  for (const r of roads) {
    if (r.axis === 'v') {
      for (let z = 0; z < H; z++) for (let x = r.pos; x < r.pos + 3; x++) type[at(x, z)] = 1;
    } else {
      for (let x = 0; x < W; x++) for (let z = r.pos; z < r.pos + 3; z++) type[at(x, z)] = 1;
    }
  }

  // Merkez park (tumsekler + golet)
  const px0 = 40, pz0 = 40, pw = 16, ph = 16;
  for (let z = pz0; z < pz0 + ph; z++)
    for (let x = px0; x < px0 + pw; x++) {
      type[at(x, z)] = 3;
      const dx = x - (px0 + pw / 2), dz = z - (pz0 + ph / 2);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 5.5 && d < 7.5) height[at(x, z)] = 1;   // cevre tumsek halkasi
    }
  // Golet (suya dusen olur!)
  for (let z = pz0 + 5; z < pz0 + 11; z++)
    for (let x = px0 + 5; x < px0 + 11; x++) {
      const dx = x - (px0 + 8), dz = z - (pz0 + 8);
      if (dx * dx + dz * dz <= 9) { type[at(x, z)] = 2; height[at(x, z)] = 0; }
    }

  // Kose tepeleri (tumsek alanlar)
  const hills = [[16, 74], [74, 16], [74, 74]];
  for (const [hx, hz] of hills) {
    for (let z = hz - 5; z <= hz + 5; z++)
      for (let x = hx - 5; x <= hx + 5; x++) {
        if (x < 1 || z < 1 || x >= W - 1 || z >= H - 1) continue;
        if (type[at(x, z)] !== 0) continue;
        const d = Math.max(Math.abs(x - hx), Math.abs(z - hz));
        if (d <= 2) height[at(x, z)] = 2;
        else if (d <= 4) height[at(x, z)] = 1;
      }
  }

  // Nehir (kuzey kenarda kanal)
  for (let x = 2; x < W - 2; x++)
    for (let z = 2; z < 5; z++) {
      if (type[at(x, z)] === 1) continue; // yollar kopru olur
      type[at(x, z)] = 2; height[at(x, z)] = 0;
    }

  // Binalar: yol bloklarinin icine yerlestir
  const palette = ['#b0574a', '#5a7a9a', '#8a6a4a', '#6a8a5a', '#7a5a8a', '#9a8a5a', '#4a7a7a'];
  const adTexts = ['BomPixel', 'PIKSEL KOLA', 'VOXEL MARKET', 'HOS GELDIN', 'PIXEL NET KAFE', 'BOM! BOM!', 'SEHIR RADYO 101'];
  let signId = 1;
  const blockStarts = [];
  for (let bx = 12; bx < W - 16; bx += 16)
    for (let bz = 12; bz < H - 16; bz += 16) blockStarts.push([bx, bz]);

  for (const [bx, bz] of blockStarts) {
    // park alanina denk gelen bloklari atla
    if (bx >= px0 - 12 && bx < px0 + pw && bz >= pz0 - 12 && bz < pz0 + ph) continue;
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const bw = 6 + Math.floor(rnd() * 4);
      const bh = 6 + Math.floor(rnd() * 4);
      const x = bx + Math.floor(rnd() * (12 - bw + 1));
      const z = bz + Math.floor(rnd() * (12 - bh + 1));
      // karolar uygun mu? (zemin ve duz olmali)
      let ok = true;
      for (let zz = z - 1; zz < z + bh + 1 && ok; zz++)
        for (let xx = x - 1; xx < x + bw + 1 && ok; xx++) {
          if (xx < 1 || zz < 1 || xx >= W - 1 || zz >= H - 1) { ok = false; break; }
          if (type[at(xx, zz)] !== 0 || height[at(xx, zz)] !== 0) ok = false;
        }
      if (!ok) continue;
      // mevcut binalarla cakisma
      for (const b of buildings)
        if (x < b.x + b.w + 1 && x + bw + 1 > b.x && z < b.z + b.h + 1 && z + bh + 1 > b.z) { ok = false; break; }
      if (!ok) continue;

      const ht = 3 + Math.floor(rnd() * 3);
      const door = ['N', 'S', 'E', 'W'][Math.floor(rnd() * 4)];
      const color = palette[Math.floor(rnd() * palette.length)];
      buildings.push({ x, z, w: bw, h: bh, ht, door, color });

      // Bazi binalara tabela/reklam (admin panelden canli degistirilebilir)
      if (rnd() < 0.65) {
        const side = ['N', 'S', 'E', 'W'][Math.floor(rnd() * 4)];
        let cx, cz;
        if (side === 'N') { cx = x + bw / 2; cz = z - 0.08; }
        else if (side === 'S') { cx = x + bw / 2; cz = z + bh + 0.08; }
        else if (side === 'E') { cx = x + bw + 0.08; cz = z + bh / 2; }
        else { cx = x - 0.08; cz = z + bh / 2; }
        signs.push({
          id: 's' + (signId++),
          cx, cz, y: ht - 0.9,
          side,
          w: Math.min(side === 'N' || side === 'S' ? bw - 1 : bh - 1, 5),
          h: 1.1,
          type: 'text',
          content: adTexts[Math.floor(rnd() * adTexts.length)],
          pixel: 1,
          color: ['#ffdd33', '#66ffcc', '#ff88cc', '#88ccff', '#ffaa44'][Math.floor(rnd() * 5)],
          bg: '#1a1a2a'
        });
      }
    }
  }

  // Parkta buyuk reklam panosu (billboard, direk ustunde)
  signs.push({
    id: 's' + (signId++), cx: px0 + 8, cz: pz0 - 2, y: 3.4, side: 'S', w: 7, h: 2.4,
    type: 'text', content: 'BomPixel ARENA', pixel: 1, color: '#ffdd33', bg: '#301040', board: 1
  });
  signs.push({
    id: 's' + (signId++), cx: 13, cz: 30, y: 3.2, side: 'E', w: 6, h: 2.2,
    type: 'text', content: 'REKLAM VER: admin', pixel: 1, color: '#66ffcc', bg: '#102030', board: 1
  });

  // Dogum noktalari: yollarda ve parkta guvenli karolar
  const wants = [[10, 10], [86, 10], [10, 86], [86, 86], [48, 24], [24, 48], [72, 48], [48, 72], [40, 40], [56, 56], [9, 48], [86, 48]];
  for (const [sx, sz] of wants) {
    let best = null;
    outer:
    for (let r = 0; r < 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x = sx + dx, z = sz + dz;
          if (x < 2 || z < 6 || x >= W - 2 || z >= H - 2) continue;
          if (type[at(x, z)] === 2) continue;
          let inB = false;
          for (const b of buildings)
            if (x >= b.x - 1 && x < b.x + b.w + 1 && z >= b.z - 1 && z < b.z + b.h + 1) { inB = true; break; }
          if (!inB) { best = [x + 0.5, z + 0.5]; break outer; }
        }
    if (best) spawns.push(best);
  }

  return { w: W, h: H, type, height, buildings, signs, spawns };
}

module.exports = { generateCity };
