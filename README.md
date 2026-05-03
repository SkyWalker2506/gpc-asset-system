# gpc-asset-system

Browser-game asset library + manifest system. Tag-aware, zero-build, drop-in.

Originally extracted from [golf-paper-craft](https://github.com/SkyWalker2506/golf-paper-craft) for reuse across browser-game projects.

## What it gives you

- `src/asset-manifest.js` — `window.GPC_ASSETS` runtime API: `list`, `get`, `add`, `update`, `remove`, `on('change')`. Merges three sources:
  - on-disk PNGs scanned into `assets/manifest.json`
  - per-asset overrides in `localStorage`
  - user uploads (data URLs) in `localStorage`
- `src/assets-library.js` — full tag-aware browser UI (search, filter, multi-select, edit, bulk ops, upload). Renders into `assets-library.html`.
- `scripts/scan-assets.js` — Node CLI that walks `www/assets/sliced/**/*.png` and writes `www/assets/manifest.json`. Auto-tags by path/filename heuristics (animation strips, courses, balls, etc.).
- `examples/assets-library.html` — reference page wiring the script + UI.
- `docs/ASSET_MANIFEST.md` — schema + integration notes.

## Install (as git submodule)

```bash
git submodule add https://github.com/SkyWalker2506/gpc-asset-system.git www/lib/asset-system
```

In any HTML that needs the API:

```html
<!-- optional config; must come BEFORE the script -->
<script>
  window.GPC_ASSETS_CONFIG = {
    manifestUrl: 'assets/manifest.json',
    storageKeys: { uploads: 'myapp_uploads', overrides: 'myapp_overrides' },
    tagVocab: ['ui','background','decoration','character','effect'],
  };
</script>
<script src="./lib/asset-system/src/asset-manifest.js"></script>
```

For the library page UI, also include `src/assets-library.js`.

## Generate the manifest

```bash
node lib/asset-system/scripts/scan-assets.js
```

(Currently hard-codes `www/assets/sliced/` as input and `www/assets/manifest.json` as output. PR welcome to make this configurable via env or argv.)

## Status

Initial extract from golf-paper-craft @ 2026-05-03. The library UI still references a small page-list (`COURSES = ['C1'..'C6']`) that is golf-flavored; consumers can override by editing or PR a config option.

## License

MIT (inherits from origin project).
