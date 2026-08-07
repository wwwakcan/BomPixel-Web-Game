// BomPixel - Admin paneli (harita editoru, tabelalar, silah tipleri, uyeler, gecmis)
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = localStorage.getItem('bp_token');

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api/admin' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Hata'), { status: res.status });
    return data;
  }

  function toast(msg, ok = true) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderColor = ok ? '#5dd35d' : '#ff7070';
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---------------- sekmeler ----------------
  document.querySelectorAll('.a-tab').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.a-tab').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.a-section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + b.dataset.tab));
      const load = { live: loadLive, maps: loadMaps, signs: loadSigns, weapons: loadWeapons, users: loadUsers, matches: loadMatches }[b.dataset.tab];
      load && load();
    };
  });

  // ---------------- canli ----------------
  let liveTimer = null;
  async function loadLive() {
    try {
      const d = await api('/live');
      $('lv-online').textContent = d.online;
      $('lv-arena').textContent = d.inArena;
      $('lv-map').textContent = d.arenas.length + ' arena acik';
      $('lv-round').textContent = '-';
      $('lv-players').innerHTML = d.arenas.length
        ? d.arenas.map(a => {
            const left = Math.max(0, a.roundEndsAt - Date.now());
            const t = Math.floor(left / 60000) + 'dk ' + Math.floor((left % 60000) / 1000) + 'sn';
            const rows = a.list.map(p => `<div style="padding-left:14px">${esc(p.name)} — ${p.k}/${p.d} (HP ${p.hp})</div>`).join('');
            return `<div style="margin-bottom:8px"><b style="color:#ffd23f">🗺️ ${esc(a.name)}</b> — ${a.players} oyuncu · tur bitis: ${t}${rows}</div>`;
          }).join('')
        : 'Acik arena yok.';
    } catch (e) {}
    clearTimeout(liveTimer);
    if (!$('tab-live').classList.contains('hidden')) liveTimer = setTimeout(loadLive, 4000);
  }
  $('btn-new-round').onclick = async () => { await api('/round/restart', 'POST'); toast('Tum arenalarda yeni tur baslatildi'); };

  // ---------------- haritalar ----------------
  let M = null, mapId = null; // duzenlenen harita
  const at = (x, z) => z * M.w + x;

  async function loadMaps() {
    $('map-editor').classList.add('hidden');
    $('maps-home').classList.remove('hidden');
    const d = await api('/maps');
    $('maps-list').innerHTML = '';
    for (const m of d.maps) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `<div class="grow"><b>${esc(m.name)}</b> ${d.active === m.id ? '<span class="kbadge">VARSAYILAN</span>' : ''}<small>${m.w}x${m.h} metre — oyuncular haritayi ana menuden secebilir</small></div>`;
      const eb = document.createElement('button');
      eb.className = 'btn tiny'; eb.textContent = 'Duzenle';
      eb.onclick = () => openEditor(m.id);
      row.appendChild(eb);
      if (d.active !== m.id) {
        const ab = document.createElement('button');
        ab.className = 'btn tiny primary'; ab.textContent = 'Varsayilan Yap';
        ab.onclick = async () => { await api(`/maps/${m.id}/activate`, 'POST'); toast('Varsayilan harita degisti.'); loadMaps(); };
        row.appendChild(ab);
        const db = document.createElement('button');
        db.className = 'btn tiny danger'; db.textContent = 'Sil';
        db.onclick = async () => {
          if (!confirm('Silinsin mi?')) return;
          try { await api('/maps/' + m.id, 'DELETE'); loadMaps(); } catch (e) { toast(e.message, false); }
        };
        row.appendChild(db);
      }
      $('maps-list').appendChild(row);
    }
  }

  $('btn-new-map').onclick = () => {
    mapId = null;
    const w = 64, h = 64;
    M = { w, h, type: new Array(w * h).fill(0), height: new Array(w * h).fill(0), buildings: [], signs: [], spawns: [[w / 2, h / 2]] };
    $('me-name').value = 'Yeni Harita';
    $('me-w').value = w; $('me-h').value = h;
    showEditor();
  };

  async function openEditor(id) {
    const d = await api('/maps/' + id);
    mapId = id;
    M = d.data;
    $('me-name').value = d.name;
    $('me-w').value = M.w; $('me-h').value = M.h;
    showEditor();
  }

  function showEditor() {
    $('maps-home').classList.add('hidden');
    $('map-editor').classList.remove('hidden');
    fitCanvas(); redraw();
  }
  $('btn-map-back').onclick = loadMaps;

  $('btn-me-resize').onclick = () => {
    const w = Math.min(256, Math.max(16, +$('me-w').value || 64));
    const h = Math.min(256, Math.max(16, +$('me-h').value || 64));
    const nt = new Array(w * h).fill(0), nh = new Array(w * h).fill(0);
    for (let z = 0; z < Math.min(h, M.h); z++)
      for (let x = 0; x < Math.min(w, M.w); x++) { nt[z * w + x] = M.type[at(x, z)]; nh[z * w + x] = M.height[at(x, z)]; }
    M.w = w; M.h = h; M.type = nt; M.height = nh;
    M.buildings = M.buildings.filter(b => b.x + b.w < w && b.z + b.h < h);
    M.spawns = M.spawns.filter(s => s[0] < w - 1 && s[1] < h - 1);
    M.signs = M.signs.filter(s => s.cx < w && s.cz < h);
    fitCanvas(); redraw();
  };

  $('btn-map-save').onclick = async () => {
    try {
      if (!M.spawns.length) return toast('En az 1 dogum noktasi ekleyin (⭐)', false);
      const r = await api('/maps', 'POST', { id: mapId, name: $('me-name').value || 'Harita', data: M });
      mapId = r.id;
      toast('Harita kaydedildi ✓');
    } catch (e) { toast(e.message, false); }
  };

  // --- cizim ---
  const cv = $('me-canvas'), ctx = cv.getContext('2d');
  let scale = 8;
  function fitCanvas() {
    scale = Math.max(3, Math.floor(Math.min(760 / M.w, 640 / M.h)));
    cv.width = M.w * scale; cv.height = M.h * scale;
  }
  const TCOL = { 0: '#5a6b3c', 1: '#4a4a52', 2: '#3a78c8', 3: '#3f7e33' };
  function redraw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let z = 0; z < M.h; z++)
      for (let x = 0; x < M.w; x++) {
        const t = M.type[at(x, z)], h = M.height[at(x, z)];
        ctx.fillStyle = TCOL[t] || TCOL[0];
        ctx.fillRect(x * scale, z * scale, scale, scale);
        if (h > 0 && t !== 2) {
          ctx.fillStyle = `rgba(255,255,255,${h * 0.14})`;
          ctx.fillRect(x * scale, z * scale, scale, scale);
        }
      }
    for (const b of M.buildings) {
      ctx.fillStyle = b.color || '#b0574a';
      ctx.fillRect(b.x * scale, b.z * scale, b.w * scale, b.h * scale);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.strokeRect(b.x * scale + 1, b.z * scale + 1, b.w * scale - 2, b.h * scale - 2);
      // kapi isareti
      ctx.fillStyle = '#ffd23f';
      const cx = (b.x + b.w / 2) * scale, cz = (b.z + b.h / 2) * scale, s = scale;
      if (b.door === 'N') ctx.fillRect(cx - s / 2, b.z * scale, s, 3);
      if (b.door === 'S') ctx.fillRect(cx - s / 2, (b.z + b.h) * scale - 3, s, 3);
      if (b.door === 'W') ctx.fillRect(b.x * scale, cz - s / 2, 3, s);
      if (b.door === 'E') ctx.fillRect((b.x + b.w) * scale - 3, cz - s / 2, 3, s);
    }
    ctx.font = `${Math.max(10, scale * 1.6)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of M.signs) ctx.fillText('📢', s.cx * scale, s.cz * scale);
    for (const s of M.spawns) ctx.fillText('⭐', s[0] * scale, s[1] * scale);
    if (drag) {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
      const x0 = Math.min(drag.x0, drag.x1), z0 = Math.min(drag.z0, drag.z1);
      const wd = Math.abs(drag.x1 - drag.x0) + 1, hd = Math.abs(drag.z1 - drag.z0) + 1;
      ctx.strokeRect(x0 * scale, z0 * scale, wd * scale, hd * scale);
    }
  }

  let tool = 'ground', drag = null, painting = false;
  document.querySelectorAll('.me-tool').forEach(b => {
    b.onclick = () => {
      tool = b.dataset.mtool;
      document.querySelectorAll('.me-tool').forEach(x => x.classList.toggle('active', x === b));
    };
  });

  function cellOf(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * (cv.width / r.width) / scale);
    const z = Math.floor((e.clientY - r.top) * (cv.height / r.height) / scale);
    return [Math.max(0, Math.min(M.w - 1, x)), Math.max(0, Math.min(M.h - 1, z))];
  }

  function paint(x, z) {
    const brush = +$('me-brush').value | 0;
    const half = Math.floor(brush / 2);
    for (let dz = -half; dz <= half; dz++)
      for (let dx = -half; dx <= half; dx++) {
        const px = x + dx, pz = z + dz;
        if (px < 0 || pz < 0 || px >= M.w || pz >= M.h) continue;
        const i = pz * M.w + px;
        if (tool === 'ground') { M.type[i] = 0; }
        else if (tool === 'road') { M.type[i] = 1; M.height[i] = 0; }
        else if (tool === 'water') { M.type[i] = 2; M.height[i] = 0; }
        else if (tool === 'park') { M.type[i] = 3; }
        else if (tool === 'raise') { if (M.type[i] !== 2) M.height[i] = Math.min(3, M.height[i] + 1); }
        else if (tool === 'lower') { M.height[i] = Math.max(0, M.height[i] - 1); }
      }
  }

  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const [x, z] = cellOf(e);
    if (tool === 'building') { drag = { x0: x, z0: z, x1: x, z1: z }; redraw(); return; }
    if (tool === 'sign') {
      const side = $('me-signside').value;
      M.signs.push({
        id: 's' + Date.now().toString(36), cx: x + 0.5, cz: z + 0.5, y: 2.6, side,
        w: 4, h: 1.4, type: 'text', content: 'REKLAM', pixel: 1, color: '#ffd23f', bg: '#1a1a2a', board: 1
      });
      redraw(); toast('Tabela eklendi. Icerigini "Tabelalar" sekmesinden (aktif haritaysa) degistirin.');
      return;
    }
    if (tool === 'spawn') { M.spawns.push([x + 0.5, z + 0.5]); redraw(); return; }
    if (tool === 'erase') {
      const bi = M.buildings.findIndex(b => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.h);
      if (bi >= 0) { M.buildings.splice(bi, 1); redraw(); return; }
      const si = M.signs.findIndex(s => Math.abs(s.cx - x) < 1.5 && Math.abs(s.cz - z) < 1.5);
      if (si >= 0) { M.signs.splice(si, 1); redraw(); return; }
      const pi = M.spawns.findIndex(s => Math.abs(s[0] - x) < 1.5 && Math.abs(s[1] - z) < 1.5);
      if (pi >= 0) { M.spawns.splice(pi, 1); redraw(); return; }
      return;
    }
    painting = true; paint(x, z); redraw();
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    const [x, z] = cellOf(e);
    $('me-status').textContent = `(${x}, ${z})`;
    if (drag) { drag.x1 = x; drag.z1 = z; redraw(); }
    else if (painting) { paint(x, z); redraw(); }
  });
  cv.addEventListener('pointerup', () => {
    if (drag) {
      const x0 = Math.min(drag.x0, drag.x1), z0 = Math.min(drag.z0, drag.z1);
      const w = Math.abs(drag.x1 - drag.x0) + 1, h = Math.abs(drag.z1 - drag.z0) + 1;
      if (w >= 3 && h >= 3) {
        M.buildings.push({
          x: x0, z: z0, w, h,
          ht: Math.min(8, Math.max(2, +$('me-bheight').value || 4)),
          door: $('me-bdoor').value, color: $('me-bcolor').value
        });
      } else toast('Bina en az 3x3 olmali', false);
      drag = null; redraw();
    }
    painting = false;
  });

  // ---------------- tabelalar ----------------
  let signsMapId = null;
  async function loadSigns() {
    const d = await api('/signs' + (signsMapId ? '?mapId=' + signsMapId : ''));
    signsMapId = d.mapId;
    const el = $('signs-list');
    el.innerHTML = '';
    // harita secici
    const selRow = document.createElement('div');
    selRow.className = 'me-toolbar';
    const sel = document.createElement('select');
    for (const m of d.maps) {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.name;
      if (m.id === d.mapId) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => { signsMapId = Number(sel.value); loadSigns(); };
    const lbl = document.createElement('span');
    lbl.className = 'me-opt';
    lbl.append('Harita: ', sel);
    selRow.appendChild(lbl);
    el.appendChild(selRow);
    if (!d.signs.length) el.insertAdjacentHTML('beforeend', '<p class="dim">Bu haritada tabela yok. Harita editorunden ekleyin.</p>');
    for (const s of d.signs) {
      const row = document.createElement('div');
      row.className = 'sign-row';
      const prev = document.createElement('div');
      prev.style.cssText = 'width:60px;height:36px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;overflow:hidden;border:1px solid #454565';
      const setPrev = () => {
        if (s.type === 'image' && s.content) { prev.innerHTML = `<img src="${s.content}" style="max-width:100%;max-height:100%">`; }
        else { prev.style.background = s.bg || '#1a1a2a'; prev.style.color = s.color || '#ffd23f'; prev.textContent = s.content; }
      };
      setPrev();
      row.appendChild(prev);
      const cfg = document.createElement('div');
      cfg.className = 'cfg';
      cfg.innerHTML = `<small class="dim">${esc(s.id)}</small>`;
      const typeSel = document.createElement('select');
      typeSel.innerHTML = '<option value="text">Metin</option><option value="image">Gorsel</option>';
      typeSel.value = s.type || 'text';
      const txt = document.createElement('input');
      txt.type = 'text'; txt.value = s.type === 'image' ? '' : (s.content || ''); txt.maxLength = 60; txt.placeholder = 'Tabela metni';
      const file = document.createElement('input');
      file.type = 'file'; file.accept = 'image/*'; file.style.display = s.type === 'image' ? '' : 'none';
      txt.style.display = s.type === 'image' ? 'none' : '';
      typeSel.onchange = () => {
        s.type = typeSel.value;
        txt.style.display = s.type === 'image' ? 'none' : '';
        file.style.display = s.type === 'image' ? '' : 'none';
      };
      let imgData = s.type === 'image' ? s.content : null;
      file.onchange = () => {
        const f = file.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          // buyuk gorselleri kucult
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            const sc = Math.min(1, 480 / img.width);
            c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            imgData = c.toDataURL('image/png');
            s.content = imgData; setPrev();
          };
          img.src = rd.result;
        };
        rd.readAsDataURL(f);
      };
      const pixLbl = document.createElement('label');
      pixLbl.className = 'me-opt';
      const pix = document.createElement('input'); pix.type = 'checkbox'; pix.checked = !!s.pixel;
      pixLbl.append(pix, ' piksel');
      const colIn = document.createElement('input'); colIn.type = 'color'; colIn.value = s.color || '#ffd23f'; colIn.title = 'Yazi rengi';
      const bgIn = document.createElement('input'); bgIn.type = 'color'; bgIn.value = s.bg || '#1a1a2a'; bgIn.title = 'Zemin rengi';
      cfg.append(typeSel, txt, file, pixLbl, colIn, bgIn);
      row.appendChild(cfg);
      const save = document.createElement('button');
      save.className = 'btn tiny primary'; save.textContent = 'Kaydet (CANLI)';
      save.onclick = async () => {
        const payload = { ...s, mapId: signsMapId, type: typeSel.value, pixel: pix.checked ? 1 : 0, color: colIn.value, bg: bgIn.value };
        payload.content = typeSel.value === 'image' ? (imgData || '') : txt.value;
        if (typeSel.value === 'image' && !payload.content) return toast('Once gorsel secin', false);
        try { await api('/signs', 'POST', payload); delete payload.mapId; Object.assign(s, payload); setPrev(); toast('Tabela oyunda canli guncellendi ✓'); }
        catch (e) { toast(e.message, false); }
      };
      row.appendChild(save);
      el.appendChild(row);
    }
  }

  // ---------------- silah tipleri ----------------
  async function loadWeapons() {
    const d = await api('/weapon-types');
    const tb = $('wt-rows');
    tb.innerHTML = '';
    const mkRow = (t, isNew) => {
      const tr = document.createElement('tr');
      const cells = {};
      const mk = (key, val, num, w) => {
        const td = document.createElement('td');
        const i = document.createElement('input');
        if (num) { i.type = 'number'; i.className = 'num'; }
        i.value = val;
        if (key === 'id' && !isNew) i.disabled = true;
        td.appendChild(i); tr.appendChild(td);
        cells[key] = i;
      };
      mk('id', t.id || '', false);
      mk('name', t.name || '', false);
      mk('dmg', t.dmg ?? 10, true);
      mk('rate', t.rate ?? 500, true);
      mk('speed', t.speed ?? 40, true);
      mk('range', t.range ?? 60, true);
      mk('pellets', t.pellets ?? 1, true);
      const mkChk = (key, val) => {
        const td = document.createElement('td');
        const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!val;
        td.appendChild(i); tr.appendChild(td); cells[key] = i;
      };
      mkChk('auto', t.auto); mkChk('beam', t.beam);
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'btn tiny primary'; b.textContent = isNew ? 'Ekle' : 'Kaydet';
      b.onclick = async () => {
        try {
          await api('/weapon-types', 'POST', {
            id: cells.id.value.trim(), name: cells.name.value, dmg: +cells.dmg.value,
            rate: +cells.rate.value, speed: +cells.speed.value, range: +cells.range.value,
            pellets: +cells.pellets.value, auto: cells.auto.checked, beam: cells.beam.checked
          });
          toast('Silah tipi kaydedildi (oyunda aktif) ✓');
          if (isNew) loadWeapons();
        } catch (e) { toast(e.message, false); }
      };
      td.appendChild(b); tr.appendChild(td);
      return tr;
    };
    for (const t of d.types) tb.appendChild(mkRow(t, false));
    tb.appendChild(mkRow({}, true));
  }

  // ---------------- uyeler ----------------
  async function loadUsers() {
    const d = await api('/users');
    const tb = $('users-rows');
    tb.innerHTML = '';
    for (const u of d.users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${u.id}</td><td><b>${esc(u.username)}</b></td><td>${esc(u.email)}</td>
        <td>${u.online ? '<span class="dot on"></span> cevrimici' : '<span class="dot off"></span> cevrimdisi'}</td>`;
      const tda = document.createElement('td');
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = !!u.is_admin;
      chk.onchange = async () => {
        try { await api(`/users/${u.id}/admin`, 'POST', { admin: chk.checked }); toast('Guncellendi'); }
        catch (e) { chk.checked = !chk.checked; toast(e.message, false); }
      };
      tda.appendChild(chk); tr.appendChild(tda);
      const tdd = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'btn tiny danger'; del.textContent = 'Sil';
      del.onclick = async () => {
        if (!confirm(`${u.username} silinsin mi?`)) return;
        try { await api('/users/' + u.id, 'DELETE'); loadUsers(); } catch (e) { toast(e.message, false); }
      };
      tdd.appendChild(del); tr.appendChild(tdd);
      tb.appendChild(tr);
    }
  }

  // ---------------- gecmis oyunlar ----------------
  async function loadMatches() {
    const d = await api('/matches');
    const el = $('matches-rows');
    el.innerHTML = d.matches.length ? '' : '<p class="dim">Henuz kayitli oyun yok. Turlar bittikce burada listelenir.</p>';
    for (const m of d.matches) {
      const dur = Math.round((m.ended_at - m.started_at) / 60000);
      const top = m.scores.slice(0, 3).map((s, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(s.name)} (${s.k}/${s.d})`).join(' · ');
      const div = document.createElement('div');
      div.className = 'list-row';
      div.innerHTML = `<div class="grow"><b>#${m.id} — ${esc(m.map_name)}</b>
        <small>${new Date(m.started_at).toLocaleString('tr-TR')} · ${dur}dk · ${m.scores.length} oyuncu</small>
        <small>${top || 'skor yok'}</small></div>`;
      el.appendChild(div);
    }
  }

  // ---------------- baslangic ----------------
  (async () => {
    if (!token) { $('admin-guard').classList.remove('hidden'); return; }
    try {
      await api('/live');
      $('admin-main').classList.remove('hidden');
      loadLive();
    } catch (e) {
      $('admin-guard').classList.remove('hidden');
    }
  })();
})();
