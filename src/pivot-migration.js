/**
 * pivot-migration.js — One-shot localStorage migration from pixel-offset pivot
 * schema (x: -80..+80 from centre) to normalised schema (x: 0..1 from top-left).
 *
 * Old: pivot.x = pixel offset from horizontal centre; pivot.y = pixel offset from bottom edge
 * New: pivot.x = 0..1 (0=left, 1=right); pivot.y = 0..1 (0=top, 1=bottom)
 * Default: { x: 0.5, y: 1.0 } (bottom-centre, equivalent to old { x: 0, y: 0 })
 *
 * Migration formula (given sprite dimensions W×H):
 *   newX = 0.5 + oldX / W
 *   newY = 1.0 + oldY / H
 *   (old offset from bottom-centre → normalised from top-left)
 *
 * Runs once per browser; guarded by localStorage flag 'gpc_asset_overrides_pivot_v2'.
 */
(function () {
  'use strict';

  var LS_OVERRIDES = 'gpc_asset_overrides';
  var LS_FLAG = 'gpc_asset_overrides_pivot_v2';

  function run() {
    if (localStorage.getItem(LS_FLAG) === '1') return; // already migrated

    var raw = localStorage.getItem(LS_OVERRIDES);
    if (!raw) { localStorage.setItem(LS_FLAG, '1'); return; }

    var overrides;
    try { overrides = JSON.parse(raw); } catch (_) { localStorage.setItem(LS_FLAG, '1'); return; }
    if (!overrides || typeof overrides !== 'object') { localStorage.setItem(LS_FLAG, '1'); return; }

    var assets = window.GPC_ASSETS; // may be null if called before ready; caller should wait
    var changed = false;

    Object.keys(overrides).forEach(function (id) {
      var entry = overrides[id];
      if (!entry || typeof entry !== 'object') return;
      if (!entry.pivot) return; // no pivot stored — default will apply, no action needed

      var piv = entry.pivot;
      var x = Number(piv.x);
      var y = Number(piv.y);

      // Detect old schema: values outside 0..1 range are unambiguously old pixel-offsets.
      // Values already in 0..1 range could be new schema — skip them to avoid double-migration.
      var looksLegacy = (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5);
      if (!looksLegacy) return;

      // Try to get sprite dimensions for precise conversion
      var spriteW = 64, spriteH = 64; // safe fallback
      if (assets && assets.get) {
        var asset = assets.get(id);
        if (asset && asset.w && asset.h) {
          spriteW = asset.w;
          spriteH = asset.h;
        }
      }

      var newX = 0.5 + x / spriteW;
      var newY = 1.0 + y / spriteH;
      // Clamp to 0..1
      newX = Math.max(0, Math.min(1, Math.round(newX * 100) / 100));
      newY = Math.max(0, Math.min(1, Math.round(newY * 100) / 100));

      entry.pivot = { x: newX, y: newY };
      changed = true;
      console.info('[pivot-migration] ' + id + ': (' + x + ', ' + y + ') → (' + newX + ', ' + newY + ')');
    });

    if (changed) {
      try { localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides)); }
      catch (e) { console.warn('[pivot-migration] localStorage write failed', e); }
    }

    localStorage.setItem(LS_FLAG, '1');
  }

  // Run after GPC_ASSETS is ready (if available) else immediately
  if (window.GPC_ASSETS && window.GPC_ASSETS.ready) {
    window.GPC_ASSETS.ready().then(run).catch(run);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // Try again after manifest may have initialised
      if (window.GPC_ASSETS && window.GPC_ASSETS.ready) {
        window.GPC_ASSETS.ready().then(run).catch(run);
      } else {
        run();
      }
    });
  } else {
    run();
  }

  // Expose for manual invocation / testing
  window.GPC_PIVOT_MIGRATION = { run: run };
})();
