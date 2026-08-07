// BomPixel - piksel editorleri (skin + silah skini)
// Ozellikler: kalem/silgi/doldur, ayna, geri al, emoji damgasi, gorselden piksele cevirme, sablonlar
import { makeSpinPreview } from './voxel.js';

export function gridFromArt(rows, colors) {
  const h = rows.length, w = rows[0].length;
  const px = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      px.push(c === '.' ? null : (colors[c] || '#ffffff'));
    }
  return { w, h, px };
}

export const SKIN_TEMPLATES = {
  asker: gridFromArt([
    '....TTTT....', '...TTTTTT...', '...SSSSSS...', '...SESSES...', '...SSSSSS...', '...SSMMSS...',
    '....SSSS....', '..BBBBBBBB..', '.SBBBBBBBBS.', '.SBBGGGGBBS.', '.SBBBBBBBBS.', '.SBBBBBBBBS.',
    '...PPPPPP...', '...PP..PP...', '...PP..PP...', '...PP..PP...', '...KK..KK...', '..KKK..KKK..'
  ], { T: '#3d2b1f', S: '#e8b88a', E: '#222222', M: '#a05c40', B: '#2f6f4f', G: '#ffd23f', P: '#31456b', K: '#332222' }),
  robot: gridFromArt([
    '....AAAA....', '...AAAAAA...', '...MMMMMM...', '...MOMMOM...', '...MMMMMM...', '...MMLLMM...',
    '....MMMM....', '..CCCCCCCC..', '.MCCCCCCCCM.', '.MCCOOOOCCM.', '.MCCCCCCCCM.', '.MCCCCCCCCM.',
    '...MMMMMM...', '...MM..MM...', '...MM..MM...', '...MM..MM...', '...OO..OO...', '..OOO..OOO..'
  ], { A: '#ff5533', M: '#9aa7b5', O: '#33ddff', L: '#445566', C: '#6a7885' }),
  uzayli: gridFromArt([
    '.....YY.....', '....YYYY....', '...YYYYYY...', '..YYEYYEYY..', '..YYYYYYYY..', '...YYMMYY...',
    '....YYYY....', '..VVVVVVVV..', '.YVVVVVVVVY.', '.YVVPPPPVVY.', '.YVVVVVVVVY.', '.YVVVVVVVVY.',
    '...VVVVVV...', '...VV..VV...', '...VV..VV...', '...VV..VV...', '...YY..YY...', '..YYY..YYY..'
  ], { Y: '#7ddb5a', E: '#111111', M: '#2c5c1c', V: '#5a3a8a', P: '#ff66cc' }),
  hayalet: gridFromArt([
    '....WWWW....', '...WWWWWW...', '..WWWWWWWW..', '..WEWWWWEW..', '..WWWWWWWW..', '..WWWMMWWW..',
    '..WWWWWWWW..', '..WWWWWWWW..', '..WWWWWWWW..', '..WWWWWWWW..', '..WWWWWWWW..', '..WWWWWWWW..',
    '..WWWWWWWW..', '..WWWWWWWW..', '..W.WWWW.W..', '..W.W..W.W..', '............', '............'
  ], { W: '#e8ecf5', E: '#223355', M: '#8899bb' })
};

export const WEAPON_TEMPLATE = gridFromArt([
  '................', '................', '..XXXXXXXXXXXX..', '..XXXXXXXXXXXX..', '..XooXXXXXXXXX..',
  '..XXXXxx........', '..xXXx..........', '..xXXx..........', '...xx...........', '................'
], { X: '#4d5a6a', x: '#33404d', o: '#ffdd33' });

export const PALETTE = [
  '#000000', '#333344', '#666677', '#99aabb', '#e8ecf5', '#ffffff',
  '#7a3b2e', '#b0574a', '#e8935c', '#e8b88a', '#ffd23f', '#ffe58a',
  '#2f6f4f', '#5f9e4f', '#7ddb5a', '#1f4f6f', '#3a78c8', '#66ddff',
  '#31456b', '#5a3a8a', '#9a5ac8', '#ff66cc', '#ff5533', '#ff8833'
];

export class PixelEditor {
  constructor(canvas, w, h, opts = {}) {
    this.cv = canvas; this.w = w; this.h = h;
    this.px = new Array(w * h).fill(null);
    this.tool = 'pen';
    this.color = '#ffd23f';
    this.mirror = !!opts.mirror;
    this.emoji = '😀';
    this.emojiSize = opts.emojiSize || 8;
    this.undoStack = [];
    this.onChange = opts.onChange || (() => {});
    this.cell = Math.floor(Math.min(canvas.width / w, canvas.height / h));
    this.ox = Math.floor((canvas.width - this.cell * w) / 2);
    this.oy = Math.floor((canvas.height - this.cell * h) / 2);
    this._down = false;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); this._down = true; this.pushUndo(); this.applyAt(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (this._down && this.tool !== 'fill' && this.tool !== 'stamp') this.applyAt(e); });
    canvas.addEventListener('pointerup', () => { this._down = false; });
    this.redraw();
  }
  cellAt(e) {
    const r = this.cv.getBoundingClientRect();
    const sx = this.cv.width / r.width, sy = this.cv.height / r.height;
    const x = Math.floor(((e.clientX - r.left) * sx - this.ox) / this.cell);
    const y = Math.floor(((e.clientY - r.top) * sy - this.oy) / this.cell);
    return [x, y];
  }
  applyAt(e) {
    const [x, y] = this.cellAt(e);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.tool === 'pen') this.set(x, y, this.color);
    else if (this.tool === 'eraser') this.set(x, y, null);
    else if (this.tool === 'fill') this.fill(x, y, this.color);
    else if (this.tool === 'stamp') this.stampEmoji(this.emoji, x, y, this.emojiSize);
    this.redraw(); this.onChange();
  }
  set(x, y, c) {
    this.px[y * this.w + x] = c;
    if (this.mirror) this.px[y * this.w + (this.w - 1 - x)] = c;
  }
  fill(x, y, c) {
    const target = this.px[y * this.w + x];
    if (target === c) return;
    const q = [[x, y]];
    const seen = new Set([y * this.w + x]);
    while (q.length) {
      const [cx, cy] = q.pop();
      this.px[cy * this.w + cx] = c;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, i = ny * this.w + nx;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h || seen.has(i)) continue;
        if (this.px[i] === target) { seen.add(i); q.push([nx, ny]); }
      }
    }
  }
  stampEmoji(emoji, cx, cy, size) {
    const t = document.createElement('canvas');
    t.width = t.height = 64;
    const c = t.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '54px serif';
    c.fillText(emoji, 32, 36);
    const data = c.getImageData(0, 0, 64, 64).data;
    const half = Math.floor(size / 2);
    for (let gy = 0; gy < size; gy++)
      for (let gx = 0; gx < size; gx++) {
        // 64/size bloklarinin ortalamasi
        const bs = Math.floor(64 / size);
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = gy * bs; yy < (gy + 1) * bs; yy++)
          for (let xx = gx * bs; xx < (gx + 1) * bs; xx++) {
            const i = (yy * 64 + xx) * 4;
            if (data[i + 3] > 100) { r += data[i]; g += data[i + 1]; b += data[i + 2]; a++; }
            n++;
          }
        if (a > n * 0.22) {
          const hex = '#' + [r / a, g / a, b / a].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
          const tx = cx - half + gx, ty = cy - half + gy;
          if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.px[ty * this.w + tx] = hex;
        }
      }
  }
  importImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.pushUndo();
        const t = document.createElement('canvas');
        t.width = this.w; t.height = this.h;
        const c = t.getContext('2d');
        const sc = Math.max(this.w / img.width, this.h / img.height);
        const dw = img.width * sc, dh = img.height * sc;
        c.drawImage(img, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
        const data = c.getImageData(0, 0, this.w, this.h).data;
        for (let i = 0; i < this.w * this.h; i++) {
          const a = data[i * 4 + 3];
          this.px[i] = a < 64 ? null :
            '#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
        }
        this.redraw(); this.onChange(); resolve();
      };
      const rd = new FileReader();
      rd.onload = () => { img.src = rd.result; };
      rd.readAsDataURL(file);
    });
  }
  pushUndo() {
    this.undoStack.push(this.px.slice());
    if (this.undoStack.length > 30) this.undoStack.shift();
  }
  undo() {
    const p = this.undoStack.pop();
    if (p) { this.px = p; this.redraw(); this.onChange(); }
  }
  clear() { this.pushUndo(); this.px.fill(null); this.redraw(); this.onChange(); }
  setGrid(g) {
    if (g && g.w === this.w && g.h === this.h) this.px = g.px.slice();
    this.redraw(); this.onChange();
  }
  getGrid() { return { w: this.w, h: this.h, px: this.px.slice() }; }
  redraw() {
    const ctx = this.cv.getContext('2d');
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        const px = this.ox + x * this.cell, py = this.oy + y * this.cell;
        ctx.fillStyle = c || ((x + y) % 2 ? '#232336' : '#2a2a40');
        ctx.fillRect(px, py, this.cell, this.cell);
      }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(this.ox + 0.5, this.oy + 0.5, this.cell * this.w - 1, this.cell * this.h - 1);
  }
}

// Ortak arac cubugu baglama: kok elemandaki [data-tool], [data-color] vb.
export function bindEditorUI(root, ed, preview, previewScale, previewDepth) {
  const refreshPrev = () => preview && preview.setGrid(ed.getGrid(), previewScale, previewDepth);
  ed.onChange = refreshPrev;
  root.querySelectorAll('[data-tool]').forEach(b => {
    b.onclick = () => {
      ed.tool = b.dataset.tool;
      root.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b));
    };
  });
  const pal = root.querySelector('.palette');
  if (pal) {
    pal.innerHTML = '';
    for (const c of PALETTE) {
      const d = document.createElement('button');
      d.className = 'swatch'; d.style.background = c;
      d.onclick = () => { ed.color = c; if (ed.tool === 'eraser' || ed.tool === 'stamp') ed.tool = 'pen'; syncSw(); };
      pal.appendChild(d);
    }
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = ed.color; inp.className = 'swatch custom';
    inp.oninput = () => { ed.color = inp.value; if (ed.tool === 'eraser') ed.tool = 'pen'; syncSw(); };
    pal.appendChild(inp);
    function syncSw() {
      pal.querySelectorAll('button.swatch').forEach(b => b.classList.toggle('active', b.style.background && rgbToHex(b.style.background) === ed.color));
      root.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === ed.tool));
    }
    syncSw();
  }
  const emojiRow = root.querySelector('.emoji-row');
  if (emojiRow) {
    for (const e of ['😀', '😎', '👽', '💀', '🔥', '❤️', '⭐', '⚡', '🐱', '🍕']) {
      const b = document.createElement('button');
      b.className = 'emoji-btn'; b.textContent = e;
      b.onclick = () => { ed.emoji = e; ed.tool = 'stamp'; root.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === 'stamp')); };
      emojiRow.appendChild(b);
    }
    const inp = document.createElement('input');
    inp.className = 'emoji-input'; inp.placeholder = '🙂'; inp.maxLength = 4;
    inp.onchange = () => { if (inp.value) { ed.emoji = inp.value; ed.tool = 'stamp'; } };
    emojiRow.appendChild(inp);
  }
  const undoB = root.querySelector('.btn-undo'); if (undoB) undoB.onclick = () => ed.undo();
  const clearB = root.querySelector('.btn-clear'); if (clearB) clearB.onclick = () => ed.clear();
  const mirrorB = root.querySelector('.btn-mirror');
  if (mirrorB) mirrorB.onclick = () => { ed.mirror = !ed.mirror; mirrorB.classList.toggle('active', ed.mirror); };
  const imp = root.querySelector('.img-import');
  if (imp) imp.onchange = () => { if (imp.files[0]) ed.importImage(imp.files[0]); imp.value = ''; };
  refreshPrev();
  return { refreshPrev };
}

function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
}
