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
    courses:  ['World 1','World 2','World 3'], // labels for the library's "course" filter (UI-only)
  };
</script>
<script src="./lib/asset-system/src/asset-manifest.js"></script>
```

The script exposes both `window.GPC_ASSETS` (legacy) and `window.AssetSystem` (preferred alias) — they reference the same API object.

For the library page UI, also include `src/assets-library.js`.

## Contract API

| Method                       | Returns           | Notes |
|------------------------------|-------------------|-------|
| `list(filter?)`              | `Asset[]`         | Optional `{tags, course, includeHidden}` filter |
| `get(id)`                    | `Asset \| null`   | Lookup by id |
| `add(file \| dataUrl, meta)` | `Promise<Asset>`  | `meta = {name?, tags?, course?}` |
| `update(id, patch)`          | `Asset`           | Persists override; emits `change` |
| `remove(id)`                 | `boolean`         | Uploads removed; on-disk assets soft-hidden |
| `on('change', cb)`           | `unsubscribe()`   | Fires on any local mutation |
| `ready()`                    | `Promise<void>`   | Resolves when manifest fetch settles |
| `TAG_VOCAB`                  | `string[]`        | Resolved vocab (config or default) |

## Examples

- `examples/assets-library.html` — full library UI as integrated in the golf game.
- `examples/standalone.html` — minimal page using only the manifest API with a custom vocab; no host project needed. Open via a static server: `python3 -m http.server -d examples 8080`.

## Generate the manifest

```bash
node lib/asset-system/scripts/scan-assets.js
```

(Currently hard-codes `www/assets/sliced/` as input and `www/assets/manifest.json` as output. PR welcome to make this configurable via env or argv.)

## Validation

`scripts/validate-assets.js` is a read-only health check that flags
manifest vs. filesystem mismatches. Pure Node, no deps. Safe for CI.

```bash
node lib/asset-system/scripts/validate-assets.js [--config <path>] [--json] [--fail-on=warn|error]
```

### Checks

| Validator              | Level     | What it catches |
|------------------------|-----------|-----------------|
| `orphan-files`         | warn      | PNGs on disk not in manifest (manifest stale) |
| `dead-entries`         | error     | Manifest entries pointing to missing files |
| `duplicate-ids`        | error     | Two entries sharing the same `id` |
| `duplicate-paths`      | warn      | Two entries pointing to the same path |
| `missing-tags`         | warn      | Entries with empty `tags` array |
| `unknown-tags`         | warn      | Tags outside `config.tagVocab` (skipped if no vocab) |
| `broken-runtime-paths` | error     | `runtimeDir` / `canonicalPath` unresolved on disk |
| `size-anomaly`         | warn      | PNGs above `sizeThresholdKB` (default 1024) |
| `dimension-anomaly`    | info      | PNGs whose area is >4x or <0.25x median of siblings in same dir |

### Config

Searched in order: `--config <path>`, `<root>/www/lib/asset-system/validate.config.json`,
`<root>/validate.config.json`. All keys optional.

```json
{
  "manifestPath": "www/assets/manifest.json",
  "assetRoots": ["www/assets/sliced"],
  "tagVocab": ["ui","background","decoration","obstacle","character","animation","ball","effect","icon"],
  "sizeThresholdKB": 1024,
  "skipFiles": ["**/_archive/**", "**/incoming/**"]
}
```

`skipFiles` accepts minimal globs (`**`, `*`, `?`).

### Exit codes

| `--fail-on` (default `error`) | Behavior |
|-------------------------------|----------|
| `error`                       | exit 2 if any error issue, else 0 |
| `warn`                        | exit 1 if any warn-or-higher, else 0 |
| `never`                       | always exit 0 (still prints) |

### Sample output

```
validate-assets — root: /path/to/project
  config:   /path/to/project/validate.config.json
  manifest: www/assets/manifest.json (272 assets)
  on-disk:  272 PNG files

- orphan-files [ok]
- dead-entries [ok]
- duplicate-ids [ok]
- duplicate-paths [ok]
- missing-tags [ok]
- unknown-tags [ok]
- broken-runtime-paths [ok]
- size-anomaly [3 issues]
    WARN  Oversize PNG (2107KB > 1024KB): www/assets/sliced/batch14/c1-meadow-backdrop.png
    ...
- dimension-anomaly [9 issues]
    INFO  Dimension outlier (602x1130, 4.43x median in ...): ...
    ...

Totals: 0 error, 3 warn, 9 info
```

`--json` emits the full structured report (one object per validator) for
programmatic consumers.

### CI usage

```yaml
- uses: actions/checkout@v4
  with: { submodules: true }
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: node www/lib/asset-system/scripts/validate-assets.js --fail-on=error
```

## Status

Initial extract from golf-paper-craft @ 2026-05-03. The asset-library UI's "course" filter is now config-driven — pass `GPC_ASSETS_CONFIG.courses` to retitle for non-golf hosts. See `CHANGELOG.md` for per-release notes.

## License

MIT (inherits from origin project).
