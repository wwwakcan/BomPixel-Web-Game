// BomPixel - piksel izgarasindan 3D voxel model uretimi
import * as THREE from '/vendor/three.module.js';

const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

// grid: {w,h,px[]}  (satir-oncelikli, satir 0 = ust)
// Dolu her piksel "depth" derinliginde kup olur. Ayaklar y=0'da, x/z ortalanir.
export function voxelMeshFromGrid(grid, scale = 0.1, depth = 2) {
  const cells = [];
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      const c = grid.px[y * grid.w + x];
      if (c) cells.push([x, y, c]);
    }
  const count = Math.max(1, cells.length * depth);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(boxGeo, mat, count);
  let i = 0;
  for (const [x, y, c] of cells) {
    _c.set(c);
    for (let d = 0; d < depth; d++) {
      _m.makeScale(scale, scale, scale);
      _m.setPosition(
        (x - grid.w / 2 + 0.5) * scale,
        (grid.h - 1 - y + 0.5) * scale,
        (d - depth / 2 + 0.5) * scale
      );
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c);
      i++;
    }
  }
  // bos gridde tek gorunmez instance
  if (cells.length === 0) { _m.makeScale(0.001, 0.001, 0.001); mesh.setMatrixAt(0, _m); }
  mesh.count = Math.max(1, i);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// Isim etiketi (her zaman kameraya bakar)
export function makeNameSprite(name, sub, color = '#ffffff') {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 28px monospace';
  const w = Math.max(ctx.measureText(name).width, sub ? ctx.measureText(sub).width * 0.7 : 0) + 24;
  cv.width = Math.ceil(w); cv.height = sub ? 64 : 44;
  const c2 = cv.getContext('2d');
  c2.fillStyle = 'rgba(10,10,20,0.55)';
  c2.fillRect(0, 0, cv.width, cv.height);
  c2.font = 'bold 28px monospace';
  c2.textAlign = 'center'; c2.textBaseline = 'top';
  c2.fillStyle = color;
  c2.fillText(name, cv.width / 2, 6);
  if (sub) {
    c2.font = 'bold 20px monospace';
    c2.fillStyle = '#9adcff';
    c2.fillText(sub, cv.width / 2, 38);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  const s = 0.011;
  sp.scale.set(cv.width * s, cv.height * s, 1);
  return sp;
}

// Emoji sprite (kafa ustu hareketli emoji + silah stickerlari icin)
export function makeEmojiSprite(emoji, size = 0.5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '52px serif';
  c.fillText(emoji, 32, 36);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sp.scale.set(size, size, 1);
  return sp;
}

// Kafa ustu can bari (kirmizi seviye cubugu) — dusman herkes gorur
export function makeHpBar() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 10;
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sp.scale.set(0.75, 0.12, 1);
  const draw = (hp, friendly) => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 64, 10);
    c.fillStyle = 'rgba(10,10,16,0.75)';
    c.fillRect(0, 0, 64, 10);
    c.fillStyle = friendly ? '#4dd34d' : '#e03030';
    c.fillRect(1, 1, Math.max(0, Math.min(1, hp / 100)) * 62, 8);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.strokeRect(0.5, 0.5, 63, 9);
    tex.needsUpdate = true;
  };
  draw(100, false);
  return { sprite: sp, draw };
}

// 2D onizleme: skin gridini canvas'a buyuk piksellerle ciz
export function drawGridToCanvas(grid, canvas, checker = true) {
  const ctx = canvas.getContext('2d');
  const s = Math.floor(Math.min(canvas.width / grid.w, canvas.height / grid.h));
  const ox = Math.floor((canvas.width - s * grid.w) / 2);
  const oy = Math.floor((canvas.height - s * grid.h) / 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      const c = grid.px[y * grid.w + x];
      if (c) { ctx.fillStyle = c; ctx.fillRect(ox + x * s, oy + y * s, s, s); }
      else if (checker) {
        ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(ox + x * s, oy + y * s, s, s);
      }
    }
}

// Kucuk donen 3D onizleme kutusu (editorler icin)
export function makeSpinPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setSize(container.clientWidth || 180, container.clientHeight || 180, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.imageRendering = 'pixelated';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 20);
  cam.position.set(0, 1.2, 3.2);
  cam.lookAt(0, 0.8, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(2, 3, 2); scene.add(dl);
  let mesh = null, running = true;
  function setGrid(grid, scale, depth) {
    if (mesh) { scene.remove(mesh); mesh.geometry && mesh.dispose && mesh.dispose(); }
    mesh = voxelMeshFromGrid(grid, scale, depth);
    scene.add(mesh);
  }
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (mesh) mesh.rotation.y += 0.02;
    renderer.render(scene, cam);
  }
  loop();
  return { setGrid, stop() { running = false; renderer.dispose(); container.innerHTML = ''; } };
}
