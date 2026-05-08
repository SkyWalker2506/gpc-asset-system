/**
 * GPC Asset CDN — resolves canonical asset paths to Supabase CDN URLs.
 *
 * Usage:
 *   window.GPC_ASSET_CDN.resolve('assets/sliced/balls/ball-01.png')
 *   // → 'https://xxx.supabase.co/storage/v1/object/public/gpc-assets/editor/sliced/balls/ball-01.png'
 *
 * cdnBase is set by one of:
 *   1. manifest.json's `cdnBase` field (written by migrate-to-supabase.mjs)
 *   2. window.GPC_MANIFEST_CDN_BASE (host-page override)
 *   3. window.GPC_ASSETS_CONFIG.cdnBase (config override)
 *   4. empty string → paths are returned unchanged (local dev fallback)
 */
(function () {
  'use strict';

  var cfg = window.GPC_ASSETS_CONFIG || {};
  var base = cfg.cdnBase || window.GPC_MANIFEST_CDN_BASE || '';

  window.GPC_ASSET_CDN = {
    base: base,

    /**
     * Resolve a canonical asset path to a CDN URL.
     * If no CDN base is configured, returns the original path unchanged.
     * @param {string} canonicalPath  e.g. "assets/sliced/balls/ball-01.png"
     * @returns {string}
     */
    resolve: function (canonicalPath) {
      if (!this.base) return canonicalPath;
      // Strip leading "assets/" and map to Supabase storage path convention
      var rel = canonicalPath.replace(/^assets\//, '');
      var storagePath;
      if (rel.indexOf('sliced/') === 0) {
        storagePath = 'editor/' + rel;
      } else if (/^batch\d+/.test(rel)) {
        storagePath = 'browser-only/' + rel;
      } else {
        storagePath = 'editor/' + rel;
      }
      return this.base + '/' + storagePath;
    }
  };

})();
