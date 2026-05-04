// Golf: Paper Craft — Asset Library (tag-aware central browser)
// Consumes window.GPC_ASSETS as the single source of truth. Adds:
//   - Top toolbar: search, multi-select tag chips (AND), course filter, +Upload
//   - Responsive thumbnail grid with name/tags/dimensions
//   - Right-side edit panel: rename, tag chip editor, course assign, crop
//     bbox editor on canvas, replace image, delete/hide
//   - Bulk operations: retag, delete, course-assign
//   - Drag-drop upload with filename-suggested tags
//   - Live update via GPC_ASSETS.on('change') + storage events
//   - One-way migration of legacy `gpc_custom_assets` localStorage payload
(() => {
  'use strict';

  const LEGACY_KEY = 'gpc_custom_assets';
  const LEGACY_MIGRATED_KEY = 'gpc_custom_assets_migrated_v2';
  // Project-agnostic: host page may set window.GPC_ASSETS_CONFIG.courses (or .groups)
  // to retitle the "course" filter for non-golf projects (e.g. ['Level 1','Level 2'] or ['scene-a','scene-b']).
  const _UI_CFG = (window.GPC_ASSETS_CONFIG || {});
  const COURSES = (Array.isArray(_UI_CFG.courses) && _UI_CFG.courses.length)
    ? _UI_CFG.courses.slice()
    : ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
  const FALLBACK_VOCAB = ['ui', 'background', 'decoration', 'obstacle', 'character', 'animation', 'ball', 'effect', 'icon'];

  // ----- State -----
  let activeTags = new Set();      // AND-mode tag filters
  let courseFilter = 'all';        // 'all' | 'none' | '1'..'6' (normalised from 'C1'..)
  // Normalise a UI-side course value ('C1'/'c1'/'1') to the storage value
  // ('1'). Disk + uploads use bare digits to keep `a.course === '1'` lookups
  // straightforward.
  function normalizeCourse(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s === 'all' || s === 'none') return s;
    const m = s.match(/^c?([1-6])$/i);
    return m ? m[1] : s;
  }
  let searchQuery = '';
  let showHidden = false;
  let selectedId = null;
  let bulkMode = false;
  let bulkSet = new Set();
  let cropDrag = null;             // { handle:'tl'|'br'|... | 'move', startX, startY, orig }

  // ----- API shim -----
  // If window.GPC_ASSETS isn't loaded yet, install a tiny placeholder so the
  // page renders an error pane instead of a blank screen.
  function api() { return window.GPC_ASSETS || null; }
  function vocab() {
    const a = api();
    return (a && Array.isArray(a.TAG_VOCAB) && a.TAG_VOCAB.length) ? a.TAG_VOCAB : FALLBACK_VOCAB;
  }

  // ----- Migration: legacy gpc_custom_assets -> GPC_ASSETS.add() -----
  async function migrateLegacy() {
    const a = api();
    if (!a || typeof a.add !== 'function') return;
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) === '1') return;
    let raw = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch (_) {}
    if (!raw) { localStorage.setItem(LEGACY_MIGRATED_KEY, '1'); return; }
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { obj = null; }
    if (!obj || typeof obj !== 'object') {
      localStorage.setItem(LEGACY_MIGRATED_KEY, '1');
      return;
    }
    const entries = Object.entries(obj);
    if (!entries.length) { localStorage.setItem(LEGACY_MIGRATED_KEY, '1'); return; }
    let ok = 0, fail = 0;
    for (const [legacyId, asset] of entries) {
      try {
        if (!asset || !asset.dataUrl) { fail++; continue; }
        const blob = await dataUrlToBlob(asset.dataUrl);
        const filename = (asset.name || legacyId) + '.png';
        const file = new File([blob], filename, { type: blob.type || 'image/png' });
        const tags = inferTagsFromLegacy(asset);
        await a.add(file, { name: asset.name || legacyId, tags });
        ok++;
      } catch (e) { console.warn('[lib] migrate failed for', legacyId, e); fail++; }
    }
    flashToast(`Migrated ${ok} asset${ok === 1 ? '' : 's'}${fail ? ` (${fail} skipped)` : ''}`);
    localStorage.setItem(LEGACY_MIGRATED_KEY, '1');
  }
  function inferTagsFromLegacy(asset) {
    const out = new Set();
    const t = (asset.type || '').toLowerCase();
    if (t === 'background') out.add('background');
    if (t === 'button') out.add('ui');
    if (t === 'animation') out.add('animation');
    if (t === 'sprite') out.add('decoration');
    String(asset.tags || '').split(/[,\s]+/).filter(Boolean).forEach(s => out.add(s.toLowerCase()));
    return Array.from(out);
  }
  async function dataUrlToBlob(url) {
    const res = await fetch(url);
    return res.blob();
  }

  // ----- Helpers -----
  function flashToast(msg, bad = false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => t.classList.remove('show'), 1400);
  }
  function suggestTagsFromFilename(name) {
    const f = (name || '').toLowerCase();
    const tags = new Set();
    if (/(?:bg|background|backdrop|sky|sunset|dawn)/.test(f)) tags.add('background');
    if (/(?:btn|button|hud|menu|panel|card)/.test(f)) tags.add('ui');
    if (/(?:icon|badge)/.test(f)) tags.add('icon');
    if (/(?:anim|loop|frames|-\d+f|_\d+f)/.test(f)) tags.add('animation');
    if (/(?:tree|rock|cloud|flower|grass|fence|deco)/.test(f)) tags.add('decoration');
    if (/(?:wall|spike|hill|trampoline|spring|crocodile|croc|wind|gravity|candy|spinner|fan|water|portal)/.test(f)) tags.add('obstacle');
    if (/(?:ball|skin)/.test(f)) tags.add('ball');
    if (/(?:effect|fx|particle|sparkle|glow|burst)/.test(f)) tags.add('effect');
    if (/(?:character|hero|enemy|npc|face)/.test(f)) tags.add('character');
    return Array.from(tags);
  }

  // ----- Filter pipeline -----
  function filteredAssets() {
    const a = api();
    if (!a || typeof a.list !== 'function') return [];
    const opts = {};
    if (activeTags.size) opts.tags = Array.from(activeTags); // AND
    if (courseFilter !== 'all' && courseFilter !== 'none') opts.course = courseFilter;
    let list;
    try { list = a.list(opts) || []; }
    catch (e) { console.warn('[lib] GPC_ASSETS.list failed', e); list = []; }
    if (courseFilter === 'none') list = list.filter(x => !x.course);
    if (!showHidden) list = list.filter(x => !x.hidden);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(x => {
        if ((x.name || '').toLowerCase().includes(q)) return true;
        if ((x.id || '').toLowerCase().includes(q)) return true;
        return (x.tags || []).some(t => String(t).toLowerCase().includes(q));
      });
    }
    return list;
  }

  // ----- Render: top toolbar tag chips -----
  function renderTagFilterChips() {
    const wrap = document.getElementById('tag-filter-chips');
    if (!wrap) return;
    wrap.innerHTML = vocab().map(tag => {
      const on = activeTags.has(tag);
      return `<button class="tag-chip${on ? ' active' : ''}" data-tag="${tag}">${tag}</button>`;
    }).join('');
    wrap.querySelectorAll('[data-tag]').forEach(el => {
      el.addEventListener('click', () => {
        const t = el.dataset.tag;
        if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
        renderTagFilterChips();
        renderGrid();
      });
    });
  }

  // ----- Render: grid -----
  function renderGrid() {
    const grid = document.getElementById('lib-grid');
    const empty = document.getElementById('lib-empty');
    const count = document.getElementById('lib-count');
    if (!grid) return;
    if (!api()) {
      grid.innerHTML = '';
      empty.style.display = 'none';
      const err = document.getElementById('lib-error');
      err.style.display = '';
      err.textContent = 'window.GPC_ASSETS is not available. Make sure src/asset-manifest.js is loaded before this script.';
      return;
    }
    const list = filteredAssets();
    count.textContent = `${list.length} asset${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = list.map(a => tileHtml(a)).join('');
    grid.querySelectorAll('[data-update-id]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const aid = el.dataset.updateId || '';
        const url = 'https://asset-browser-golf-paper-craft.vercel.app/?edit=' + encodeURIComponent(aid);
        window.open(url, '_blank', 'noopener');
      });
    });
    grid.querySelectorAll('.lib-tile[data-id]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('[data-update-id]')) return;
        const id = btn.dataset.id;
        if (bulkMode) {
          if (bulkSet.has(id)) bulkSet.delete(id); else bulkSet.add(id);
          updateBulkBar();
          renderGrid();
          return;
        }
        selectedId = id;
        cropDrag = null;
        renderGrid();
        renderEditPanel();
      });
    });
  }
  function tileHtml(a) {
    const id = a.id;
    const sel = id === selectedId;
    const checked = bulkSet.has(id);
    const hidden = !!a.hidden;
    const src = assetSrc(a);
    const w = a.srcW || a.w || a.width || 0;
    const h = a.srcH || a.h || a.height || 0;
    const tags = (a.tags || []).slice(0, 4).map(t => `<span class="ttag">${escape(t)}</span>`).join('');
    const badge = a.course ? `<span class="badge">C${a.course}</span>` : (a.kind === 'animation' || (a.tags||[]).includes('animation') ? `<span class="badge">anim</span>` : '');
    return `
      <button class="lib-tile${sel ? ' selected' : ''}${checked ? ' bulk-checked' : ''}${hidden ? ' hidden-asset' : ''}" data-id="${escape(id)}" title="${escape(a.name || id)}">
        <span class="bulk-tick"></span>
        <span class="lib-update-btn" data-update-id="${escape(id)}" title="Edit in Asset Browser">✏ Update</span>
        <div class="thumb-wrap">
          ${badge}
          <img loading="lazy" src="${escape(src)}" alt="${escape(a.name || id)}"/>
        </div>
        <div class="meta">
          <div class="nm">${escape(a.name || id)}</div>
          <div class="dim">${w}×${h}${hidden ? ' · hidden' : ''}</div>
          <div class="tile-tags">${tags}</div>
        </div>
      </button>`;
  }
  // Resolve a usable <img src> for an asset. On-disk assets store a relative
  // `path` like "assets/sliced/balls/ball-01.png" — prefix with "./" so it
  // resolves against the host page regardless of mount path. Uploads store a
  // data URL in `path` (or legacy `dataUrl`).
  function assetSrc(a) {
    if (!a) return '';
    const raw = a.url || a.dataUrl || a.path || '';
    if (!raw) return '';
    if (/^(data:|blob:|https?:|\.\/|\.\.\/|\/)/i.test(raw)) return raw;
    return './' + raw.replace(/^\/+/, '');
  }
  function isUploadAsset(a) {
    if (!a) return false;
    if (a.source === 'uploaded' || a.source === 'upload' || a.uploaded) return true;
    const raw = a.dataUrl || a.path || '';
    return /^data:/i.test(raw);
  }

  function escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ----- Render: edit panel -----
  function renderEditPanel() {
    const empty = document.getElementById('props-empty');
    const body = document.getElementById('props-body');
    const a = currentAsset();
    if (!a) { empty.style.display = ''; body.style.display = 'none'; return; }
    empty.style.display = 'none';
    body.style.display = '';
    document.getElementById('path-display').textContent = `asset:${a.id}`;
    setVal('input[data-field="name"]', a.name || '');
    // HTML option values are 'C1'..'C6' but storage is bare '1'..'6'.
    setVal('select[data-field="course"]', a.course ? ('C' + a.course) : '');
    setVal('input[data-field="srcW"]', a.srcW || a.width || 0);
    setVal('input[data-field="srcH"]', a.srcH || a.height || 0);
    renderVocabChips();
    renderTagEditor();
    renderPreviewCanvas();
    const hideBtn = document.getElementById('btn-toggle-hidden');
    hideBtn.textContent = a.hidden ? '↺ Restore' : '👁 Hide';
    // Replace only meaningful for uploaded assets (those have dataUrl, not a baked /assets/ url).
    const replaceBtn = document.getElementById('btn-replace');
    const isUpload = !!a.dataUrl || a.source === 'upload' || a.uploaded;
    replaceBtn.disabled = !isUpload;
    replaceBtn.style.opacity = isUpload ? '1' : '0.45';
  }
  function setVal(sel, v) {
    const el = document.querySelector(sel);
    if (!el || document.activeElement === el) return;
    el.value = v == null ? '' : v;
  }
  function currentAsset() {
    const a = api();
    if (!a || !selectedId) return null;
    try { return a.get(selectedId) || null; } catch (_) { return null; }
  }
  function renderVocabChips() {
    const wrap = document.getElementById('vocab-chips');
    const a = currentAsset();
    const tags = new Set((a && a.tags) || []);
    wrap.innerHTML = vocab().map(t => `
      <button class="tag-chip${tags.has(t) ? ' active' : ''}" data-vocab="${t}">${t}</button>
    `).join('');
    wrap.querySelectorAll('[data-vocab]').forEach(b => {
      b.addEventListener('click', () => toggleTag(b.dataset.vocab));
    });
  }
  function renderTagEditor() {
    const wrap = document.getElementById('tag-edit');
    const input = document.getElementById('new-tag-input');
    const a = currentAsset();
    const tags = (a && a.tags) || [];
    // Render existing tags as removable chips, keep input at the end
    wrap.innerHTML = tags.map(t => `<button class="tag-chip active removable" data-rm="${escape(t)}">${escape(t)}</button>`).join('')
      + '<input type="text" class="new-tag-input" id="new-tag-input" placeholder="add tag…"/>';
    wrap.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', () => removeTag(b.dataset.rm));
    });
    const newInput = document.getElementById('new-tag-input');
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = newInput.value.trim().toLowerCase();
        if (v) addTag(v);
        newInput.value = '';
      }
    });
  }
  function toggleTag(tag) {
    const a = currentAsset();
    if (!a) return;
    const cur = new Set(a.tags || []);
    if (cur.has(tag)) cur.delete(tag); else cur.add(tag);
    api().update(a.id, { tags: Array.from(cur) });
  }
  function addTag(tag) {
    const a = currentAsset();
    if (!a) return;
    const cur = new Set(a.tags || []);
    cur.add(tag);
    api().update(a.id, { tags: Array.from(cur) });
  }
  function removeTag(tag) {
    const a = currentAsset();
    if (!a) return;
    const cur = (a.tags || []).filter(t => t !== tag);
    api().update(a.id, { tags: cur });
  }

  // ----- Crop canvas -----
  let cropImg = null;
  function renderPreviewCanvas() {
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    const a = currentAsset();
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 380, ch = 220;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!a) return;
    const src = a.url || a.dataUrl;
    if (!src) return;
    if (!cropImg || cropImg._src !== src) {
      cropImg = new Image();
      cropImg._src = src;
      cropImg.onload = renderPreviewCanvas;
      cropImg.src = src;
      return;
    }
    if (!cropImg.complete || !cropImg.naturalWidth) return;
    const iw = cropImg.naturalWidth, ih = cropImg.naturalHeight;
    const scale = Math.min((cw - 16) / iw, (ch - 16) / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.drawImage(cropImg, dx, dy, dw, dh);
    // Stash for hit-test
    canvas._fit = { dx, dy, dw, dh, iw, ih, scale };

    // Crop overlay
    const crop = a.crop || null;
    if (crop && Number.isFinite(crop.x)) {
      const cx = dx + crop.x * scale;
      const cy = dy + crop.y * scale;
      const cwp = crop.w * scale;
      const chp = crop.h * scale;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      // Outer mask
      ctx.fillRect(dx, dy, dw, cy - dy);
      ctx.fillRect(dx, cy + chp, dw, dy + dh - (cy + chp));
      ctx.fillRect(dx, cy, cx - dx, chp);
      ctx.fillRect(cx + cwp, cy, dx + dw - (cx + cwp), chp);
      ctx.strokeStyle = '#b48cff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cwp, chp);
      // Corner handles
      const handles = [
        ['tl', cx, cy], ['tr', cx + cwp, cy],
        ['bl', cx, cy + chp], ['br', cx + cwp, cy + chp]
      ];
      ctx.fillStyle = '#b48cff';
      handles.forEach(([_, hx, hy]) => ctx.fillRect(hx - 4, hy - 4, 8, 8));
      ctx.restore();
    }

    document.getElementById('preview-info').textContent =
      crop ? `crop ${Math.round(crop.x)},${Math.round(crop.y)} ${Math.round(crop.w)}×${Math.round(crop.h)}`
           : `drag on canvas to crop · source ${iw}×${ih}`;
  }

  function bindCropCanvas() {
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      const a = currentAsset();
      const fit = canvas._fit;
      if (!a || !fit) return;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // Image-space coords
      const ix = (px - fit.dx) / fit.scale;
      const iy = (py - fit.dy) / fit.scale;
      if (ix < 0 || iy < 0 || ix > fit.iw || iy > fit.ih) return;
      const crop = a.crop || null;
      // Hit-test handles
      if (crop) {
        const handle = hitHandle(crop, ix, iy);
        if (handle) {
          cropDrag = { handle, startIx: ix, startIy: iy, orig: { ...crop } };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        // Inside crop → move
        if (ix >= crop.x && ix <= crop.x + crop.w && iy >= crop.y && iy <= crop.y + crop.h) {
          cropDrag = { handle: 'move', startIx: ix, startIy: iy, orig: { ...crop } };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      // Otherwise: start a fresh crop rectangle
      cropDrag = { handle: 'new', startIx: ix, startIy: iy, orig: { x: ix, y: iy, w: 0, h: 0 } };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cropDrag) return;
      const a = currentAsset();
      const fit = canvas._fit;
      if (!a || !fit) return;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ix = clamp((px - fit.dx) / fit.scale, 0, fit.iw);
      const iy = clamp((py - fit.dy) / fit.scale, 0, fit.ih);
      const next = computeCrop(cropDrag, ix, iy, fit);
      a.crop = next; // local mutation for live preview
      renderPreviewCanvas();
    });
    const finish = (e) => {
      if (!cropDrag) return;
      const a = currentAsset();
      if (a) {
        const c = a.crop;
        if (c && c.w >= 2 && c.h >= 2) {
          api().update(a.id, { crop: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) } });
        } else {
          api().update(a.id, { crop: null });
        }
      }
      cropDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }
  function hitHandle(crop, ix, iy) {
    const tol = 8;
    const corners = { tl:[crop.x,crop.y], tr:[crop.x+crop.w,crop.y], bl:[crop.x,crop.y+crop.h], br:[crop.x+crop.w,crop.y+crop.h] };
    for (const k in corners) {
      const [hx, hy] = corners[k];
      if (Math.abs(ix - hx) < tol && Math.abs(iy - hy) < tol) return k;
    }
    return null;
  }
  function computeCrop(drag, ix, iy, fit) {
    const o = drag.orig;
    if (drag.handle === 'new') {
      const x = Math.min(drag.startIx, ix), y = Math.min(drag.startIy, iy);
      return { x, y, w: Math.abs(ix - drag.startIx), h: Math.abs(iy - drag.startIy) };
    }
    if (drag.handle === 'move') {
      const dx = ix - drag.startIx, dy = iy - drag.startIy;
      return { x: clamp(o.x + dx, 0, fit.iw - o.w), y: clamp(o.y + dy, 0, fit.ih - o.h), w: o.w, h: o.h };
    }
    let x = o.x, y = o.y, w = o.w, h = o.h;
    if (drag.handle === 'tl') { w = o.x + o.w - ix; h = o.y + o.h - iy; x = ix; y = iy; }
    if (drag.handle === 'tr') { w = ix - o.x; h = o.y + o.h - iy; y = iy; }
    if (drag.handle === 'bl') { w = o.x + o.w - ix; h = iy - o.y; x = ix; }
    if (drag.handle === 'br') { w = ix - o.x; h = iy - o.y; }
    return { x: clamp(x, 0, fit.iw), y: clamp(y, 0, fit.ih), w: Math.max(0, w), h: Math.max(0, h) };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ----- Upload flow -----
  // Course is REQUIRED on upload. Files are queued behind a modal that asks
  // for course assignment up-front (suggested from filename prefix). This
  // keeps the on-disk manifest and uploads consistent — every asset carries
  // a scope so editor pickers can filter.
  let pendingUploadFiles = [];

  function suggestCourseFromFilename(name) {
    const f = (name || '').toLowerCase();
    let m = f.match(/(?:^|[\/_-])course([1-6])(?:[-_\/.]|$)/);
    if (m) return m[1];
    m = f.match(/(?:^|[\/_-])c([1-6])(?:[-_\/.]|$)/);
    if (m) return m[1];
    return ''; // unknown
  }
  function isLikelyGlobal(name) {
    const f = (name || '').toLowerCase();
    return /^ui[-_]/.test(f) || /^ball[-_]/.test(f) || /^icon[-_]/.test(f);
  }

  function openUploadModal(files) {
    const arr = Array.from(files || []).filter(f => f && /image\//.test(f.type || ''));
    if (!arr.length) return;
    pendingUploadFiles = arr;

    const modal = document.getElementById('upload-modal');
    const list = document.getElementById('upload-file-list');
    const count = document.getElementById('upload-count');
    const sel = document.getElementById('upload-course');
    const hint = document.getElementById('upload-suggest-hint');
    if (!modal || !sel) {
      // Fallback: legacy direct upload, course unset (preserves old behaviour
      // if the modal HTML is missing on a host page).
      uploadCommit('__unset__');
      return;
    }
    count.textContent = String(arr.length);

    // Build per-file rows with suggested course, derive a majority suggestion
    // for the dropdown default.
    const counts = {};
    list.innerHTML = arr.map(f => {
      const c = suggestCourseFromFilename(f.name);
      const g = isLikelyGlobal(f.name);
      const tag = c ? ('C' + c) : (g ? 'GLOBAL' : '?');
      if (c) counts[c] = (counts[c] || 0) + 1;
      else if (g) counts['__global__'] = (counts['__global__'] || 0) + 1;
      return `<div class="ufile"><span class="badge">${tag}</span><span>${escape(f.name)}</span></div>`;
    }).join('');

    // Pick the highest-frequency suggestion.
    let best = '__unset__', bestN = 0;
    for (const k in counts) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } }
    sel.value = best;
    hint.textContent = best === '__unset__'
      ? 'Could not infer a course from filenames — pick one before uploading.'
      : (best === '__global__'
        ? 'Filenames look UI/global — set Global, or override per-asset after upload.'
        : `Suggested C${best} based on filename prefix. Override if wrong.`);

    modal.style.display = 'flex';
  }

  function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'none';
    pendingUploadFiles = [];
  }

  async function uploadCommit(courseValue) {
    const a = api();
    if (!a) { flashToast('Asset API not loaded', true); return; }
    const arr = pendingUploadFiles;
    if (!arr.length) { closeUploadModal(); return; }
    let course = null;
    if (courseValue && courseValue !== '__unset__' && courseValue !== '__global__') {
      course = String(courseValue);
    }
    let firstId = null;
    for (const f of arr) {
      const baseName = f.name.replace(/\.[a-z0-9]+$/i, '');
      const tags = suggestTagsFromFilename(f.name);
      try {
        const meta = { name: baseName, tags };
        if (course) meta.course = course;
        const asset = await a.add(f, meta);
        if (asset && asset.id && !firstId) firstId = asset.id;
      } catch (e) {
        console.error('[lib] add failed', f.name, e);
        flashToast(`Upload failed: ${f.name}`, true);
      }
    }
    if (firstId) selectedId = firstId;
    closeUploadModal();
    renderGrid();
    renderEditPanel();
    flashToast(`${arr.length} uploaded${course ? ' → C' + course : ' (global)'}`);
  }

  // Public entry point for the file-input/drop handlers — opens the modal.
  async function uploadFiles(files) {
    openUploadModal(files);
  }

  // ----- Bulk operations -----
  function setBulkMode(on) {
    bulkMode = !!on;
    if (!on) bulkSet.clear();
    document.getElementById('shell').classList.toggle('bulk-mode', bulkMode);
    document.getElementById('bulk-bar').classList.toggle('on', bulkMode);
    document.getElementById('btn-bulk').textContent = bulkMode ? '☐ Bulk off' : '☑ Bulk select';
    updateBulkBar();
    renderGrid();
  }
  function updateBulkBar() {
    document.getElementById('bulk-count').textContent = `${bulkSet.size} selected`;
  }
  function bulkApplyTag(tag) {
    if (!tag || !bulkSet.size) return;
    const a = api();
    bulkSet.forEach(id => {
      const ass = a.get(id);
      if (!ass) return;
      const cur = new Set(ass.tags || []);
      cur.add(tag);
      a.update(id, { tags: Array.from(cur) });
    });
    flashToast(`Tagged ${bulkSet.size} with #${tag}`);
  }
  function bulkApplyCourse(course) {
    if (!bulkSet.size) return;
    const a = api();
    const norm = course === 'none' ? null : normalizeCourse(course);
    bulkSet.forEach(id => a.update(id, { course: norm }));
    flashToast(`Assigned ${bulkSet.size} to ${norm ? 'C' + norm : 'global'}`);
  }
  function bulkDelete() {
    if (!bulkSet.size) return;
    if (!confirm(`Delete ${bulkSet.size} asset(s)? Uploads are removed permanently; baked assets are hidden.`)) return;
    const a = api();
    bulkSet.forEach(id => {
      const ass = a.get(id);
      if (!ass) return;
      const isUpload = !!ass.dataUrl || ass.source === 'upload' || ass.uploaded;
      if (isUpload && typeof a.remove === 'function') a.remove(id);
      else a.update(id, { hidden: true });
    });
    bulkSet.clear();
    setBulkMode(false);
  }

  // ----- Wiring -----
  function bindUI() {
    // Search
    const search = document.getElementById('q-search');
    search.addEventListener('input', () => { searchQuery = search.value.trim(); renderGrid(); });

    // Course filter
    const cf = document.getElementById('course-filter');
    cf.addEventListener('change', () => { courseFilter = normalizeCourse(cf.value); renderGrid(); });

    // Show hidden
    document.getElementById('show-hidden').addEventListener('change', (e) => {
      showHidden = e.target.checked; renderGrid();
    });

    // Upload (button + drag-drop overlay)
    const fileAdd = document.getElementById('file-add');
    document.getElementById('btn-upload').addEventListener('click', () => fileAdd.click());
    fileAdd.addEventListener('change', (e) => {
      uploadFiles(e.target.files);
      e.target.value = '';
    });
    let dragDepth = 0;
    const overlay = document.getElementById('drop-overlay');
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragDepth++; overlay.classList.add('on');
    });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.remove('on'); });
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; overlay.classList.remove('on');
      if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
    });

    // Bulk toggle
    document.getElementById('btn-bulk').addEventListener('click', () => setBulkMode(!bulkMode));
    document.getElementById('bulk-exit').addEventListener('click', () => setBulkMode(false));
    document.getElementById('bulk-clear').addEventListener('click', () => { bulkSet.clear(); updateBulkBar(); renderGrid(); });
    document.getElementById('bulk-select-all').addEventListener('click', () => {
      filteredAssets().forEach(a => bulkSet.add(a.id));
      updateBulkBar(); renderGrid();
    });
    document.getElementById('bulk-tag-apply').addEventListener('click', () => {
      const inp = document.getElementById('bulk-tag-add');
      const t = inp.value.trim().toLowerCase();
      if (t) { bulkApplyTag(t); inp.value = ''; }
    });
    document.getElementById('bulk-course').addEventListener('change', (e) => {
      if (e.target.value) bulkApplyCourse(e.target.value);
      e.target.value = '';
    });
    document.getElementById('bulk-delete').addEventListener('click', bulkDelete);

    // Edit panel: name + course
    document.querySelector('input[data-field="name"]').addEventListener('input', (e) => {
      const a = currentAsset(); if (!a) return;
      api().update(a.id, { name: e.target.value });
    });
    document.querySelector('select[data-field="course"]').addEventListener('change', (e) => {
      const a = currentAsset(); if (!a) return;
      api().update(a.id, { course: normalizeCourse(e.target.value) || null });
    });

    // Path copy
    document.getElementById('path-display').addEventListener('click', () => {
      const txt = document.getElementById('path-display').textContent;
      try { navigator.clipboard.writeText(txt); flashToast('Copied'); } catch (_) {}
    });

    // Edit in Asset Browser — deep-link to ?edit=<id>
    const btnEditBrowser = document.getElementById('btn-edit-browser');
    if (btnEditBrowser) {
      btnEditBrowser.addEventListener('click', () => {
        if (!selectedId) return;
        const url = `https://asset-browser-golf-paper-craft.vercel.app/?edit=${encodeURIComponent(selectedId)}`;
        window.open(url, '_blank', 'noopener');
      });
    }

    // Replace / hide / delete / clear crop
    document.getElementById('btn-replace').addEventListener('click', () => document.getElementById('file-replace').click());
    document.getElementById('file-replace').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      const a = currentAsset();
      e.target.value = '';
      if (!f || !a) return;
      // Replace = remove + add with same tags/course/name
      const tags = a.tags || [];
      const course = a.course || null;
      const name = a.name || a.id;
      try {
        if (typeof api().remove === 'function') api().remove(a.id);
        const created = await api().add(f, { name, tags, course });
        if (created && created.id) selectedId = created.id;
        flashToast('Replaced');
      } catch (err) { console.error(err); flashToast('Replace failed', true); }
    });
    document.getElementById('btn-toggle-hidden').addEventListener('click', () => {
      const a = currentAsset(); if (!a) return;
      api().update(a.id, { hidden: !a.hidden });
    });
    document.getElementById('btn-delete').addEventListener('click', () => {
      const a = currentAsset(); if (!a) return;
      const isUpload = !!a.dataUrl || a.source === 'upload' || a.uploaded;
      const msg = isUpload
        ? `Permanently delete uploaded asset "${a.name || a.id}"?\nThis breaks any reference to asset:${a.id}.`
        : `"${a.name || a.id}" is a baked-in asset and cannot be deleted, only hidden.\nHide it now?`;
      if (!confirm(msg)) return;
      if (isUpload && typeof api().remove === 'function') {
        api().remove(a.id);
        selectedId = null;
      } else {
        api().update(a.id, { hidden: true });
      }
    });
    document.getElementById('btn-clear-crop').addEventListener('click', () => {
      const a = currentAsset(); if (!a) return;
      api().update(a.id, { crop: null });
    });

    // Play
    document.getElementById('btn-play-game').addEventListener('click', () => {
      let target = null;
      try {
        const raw = localStorage.getItem('gpc_editor_v1');
        if (raw) {
          const st = JSON.parse(raw);
          const levels = st && Array.isArray(st.levels) ? st.levels : [];
          const idx = (st && Number.isFinite(st.currentIdx)) ? st.currentIdx : 0;
          const lvl = levels[idx];
          if (lvl && lvl.courtId && lvl.slot) target = { course: lvl.courtId, level: lvl.slot };
        }
      } catch (_) {}
      location.href = target
        ? `./index.html?course=${target.course}&level=${target.level}&editorSync=1`
        : './index.html';
    });

    // Upload modal wiring
    const uploadConfirm = document.getElementById('upload-confirm');
    const uploadCancel = document.getElementById('upload-cancel');
    const uploadCancel2 = document.getElementById('upload-cancel-2');
    const uploadCourseSel = document.getElementById('upload-course');
    if (uploadConfirm) {
      uploadConfirm.addEventListener('click', () => {
        const v = uploadCourseSel ? uploadCourseSel.value : '__unset__';
        if (v === '__unset__') {
          flashToast('Pick a course (or Global) first', true);
          if (uploadCourseSel) uploadCourseSel.focus();
          return;
        }
        uploadCommit(v);
      });
    }
    if (uploadCancel) uploadCancel.addEventListener('click', closeUploadModal);
    if (uploadCancel2) uploadCancel2.addEventListener('click', closeUploadModal);

    // Resize → re-render preview
    window.addEventListener('resize', renderPreviewCanvas);
  }

  // ----- Live updates -----
  function subscribe() {
    const a = api();
    if (a && typeof a.on === 'function') {
      a.on('change', () => {
        renderGrid();
        renderEditPanel();
      });
    }
    // Cross-tab fallback
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      if (e.key === 'gpc_assets' || e.key === 'gpc_assets_updated_at' || e.key === LEGACY_KEY) {
        renderGrid();
        renderEditPanel();
      }
    });
  }

  // ----- Boot -----
  async function boot() {
    bindUI();
    bindCropCanvas();
    renderTagFilterChips();
    if (!api()) {
      // Manifest hasn't loaded — render an error pane and bail (UI still wired,
      // so a hot-load of the manifest + reload will recover).
      renderGrid();
      console.warn('[asset-library] window.GPC_ASSETS missing — only the empty UI will be rendered');
      return;
    }
    try { await migrateLegacy(); } catch (e) { console.warn('[lib] migration error', e); }
    subscribe();
    renderGrid();
    renderEditPanel();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
