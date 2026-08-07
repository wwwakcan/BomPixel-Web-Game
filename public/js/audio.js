// BomPixel - WebAudio ile sentez sesler (hic ses dosyasi yok) + konumsal ses
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function unlockAudio() { try { ac(); } catch (e) {} }

// pan: -1 (sol) .. 1 (sag)
function out(a, g, pan) {
  if (pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(a.destination);
  } else g.connect(a.destination);
}

function blip(freq0, freq1, dur, type = 'square', vol = 0.12, pan = 0) {
  try {
    const a = ac();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq0, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); out(a, g, pan);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  } catch (e) {}
}

function noise(dur, vol = 0.1, low = 800, pan = 0) {
  try {
    const a = ac();
    const b = a.createBuffer(1, Math.max(1, a.sampleRate * dur), a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(); s.buffer = b;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    s.connect(f).connect(g); out(a, g, pan);
    s.start();
  } catch (e) {}
}

const FIRE_SOUNDS = {
  tabanca: (v, p) => blip(420, 130, 0.09, 'square', v, p),
  tarayici: (v, p) => blip(360, 180, 0.06, 'square', v * 0.8, p),
  pompali: (v, p) => { blip(200, 60, 0.16, 'square', v * 1.1, p); noise(0.12, v * 0.8, 1200, p); },
  keskin: (v, p) => blip(900, 90, 0.22, 'sawtooth', v, p),
  lazer: (v, p) => blip(1200, 500, 0.16, 'sine', v * 0.9, p)
};

let stepAlt = false;

export const sfx = {
  fire(type) { (FIRE_SOUNDS[type] || FIRE_SOUNDS.tabanca)(0.12, 0); },
  fireRemote(type, vol = 0.05, pan = 0) { (FIRE_SOUNDS[type] || FIRE_SOUNDS.tabanca)(Math.min(0.1, vol), pan); },
  hitmark() { blip(1400, 1000, 0.05, 'sine', 0.1); },
  hurt() { blip(180, 90, 0.15, 'sawtooth', 0.14); },
  death() { blip(300, 40, 0.5, 'sawtooth', 0.16); },
  splash(vol = 0.16, pan = 0) { noise(0.4, vol, 500, pan); },
  respawn() { blip(300, 700, 0.18, 'sine', 0.1); },
  invite() { blip(660, 880, 0.12, 'sine', 0.1); setTimeout(() => blip(880, 1100, 0.14, 'sine', 0.1), 110); },
  click() { blip(700, 500, 0.04, 'square', 0.05); },
  kill() { blip(500, 900, 0.1, 'square', 0.1); setTimeout(() => blip(700, 1200, 0.12, 'square', 0.1), 90); },
  // yeni sesler
  step(vol = 0.05, pan = 0) {
    stepAlt = !stepAlt;
    noise(0.05, vol, stepAlt ? 500 : 380, pan);
  },
  jump() { blip(250, 420, 0.1, 'sine', 0.06); },
  land() { noise(0.07, 0.08, 300); },
  switch() { blip(500, 800, 0.05, 'square', 0.07); },
  zoomIn() { blip(600, 1000, 0.08, 'sine', 0.06); },
  zoomOut() { blip(1000, 600, 0.08, 'sine', 0.06); },
  beep(vol = 0.08, pan = 0) { blip(1900, 1850, 0.05, 'square', vol, pan); },
  plantTick() { blip(1500, 1500, 0.03, 'square', 0.05); },
  defuseTick() { blip(800, 850, 0.03, 'sine', 0.05); },
  defused() { blip(700, 1200, 0.15, 'sine', 0.12); setTimeout(() => blip(900, 1500, 0.2, 'sine', 0.12), 130); },
  explosion(vol = 0.3, pan = 0) {
    noise(0.7, Math.min(0.35, vol), 250, pan);
    blip(120, 30, 0.6, 'sawtooth', Math.min(0.3, vol), pan);
    setTimeout(() => noise(0.4, Math.min(0.2, vol * 0.6), 150, pan), 80);
  }
};

// Konumsal parametreler: dinleyici (kendi) pozisyonu + yaw'a gore vol/pan hesabi
export function positional(dx, dz, yaw, maxDist = 30, base = 0.14) {
  const dist = Math.hypot(dx, dz);
  if (dist > maxDist) return null;
  const vol = base * (1 - dist / maxDist) + 0.005;
  // kameraya gore sag bileseni: right = (cos(yaw), -sin(yaw))
  const pan = dist < 0.5 ? 0 : (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dist;
  return { vol, pan: Math.max(-1, Math.min(1, pan * 0.85)), dist };
}
