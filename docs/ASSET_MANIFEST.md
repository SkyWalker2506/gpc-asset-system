# Asset Manifest System

Canonical asset discovery layer used by all editors (level editor, course editor,
UI editor, asset editor, assets-library) and available at runtime via
`window.GPC_ASSETS`.

The manifest does NOT replace existing hardcoded sprite paths in `game.js` —
those continue to load directly. The manifest is purely a discovery + metadata
layer for editor tooling.

## Files

- `www/src/asset-manifest.js` — runtime module, exposes `window.GPC_ASSETS`.
- `www/assets/manifest.json` — generated on-disk asset list.
- `scripts/scan-assets.js` — Node script that regenerates `manifest.json`.

## Regenerating the manifest

Run from the repo root after adding/removing/renaming any PNG under
`www/assets/sliced/`:

```sh
node scripts/scan-assets.js
```

Then bump cache buster on the `asset-manifest.js?v=` query strings if the
runtime module changed (manifest.json itself is fetched no-cache).

## Auto-tagging heuristics

Path / filename patterns assign tags automatically:

| Pattern | Tags |
| --- | --- |
| `batch8/ui-*` | `ui`, `icon` |
| `balls/ball-*` | `ball`, `character` |
| `c1-ambient/sun/*` | `background`, `decoration` |
| `c1-ambient/clouds/*` | `background`, `decoration` |
| `c1-ambient/butterflies/*` | `background`, `decoration`, `character` |
| `batch15/c1-grass/*`, `batch9/c1-flowers-*` | `background`, `decoration` |
| `c2-* / c3-* / c4-* / c5-*` (non-flower/cloud) | `background`, `obstacle` (+course tag) |
| `*-anim*`, `*-strip*`, `[-_]Nf` in name | `animation` |
| `glow|spark|effect|flash|shine|burst` | `effect` |
| (default) | `decoration` |

Course tag is derived from `c[1-6]-` prefix in the path.

## Runtime contract (window.GPC_ASSETS)

```js
GPC_ASSETS.list({tags, anyTag, course}) -> Asset[]
GPC_ASSETS.get(id) -> Asset | null
GPC_ASSETS.update(id, patch) -> Asset           // patch: {name?, tags?, w?, h?, course?, crop?}
GPC_ASSETS.remove(id) -> void                   // soft-delete; on-disk → hidden
GPC_ASSETS.add(file|dataUrl, meta) -> Asset     // meta: {name, tags, course?, frameCount?}
GPC_ASSETS.on('change', cb)
GPC_ASSETS.TAG_VOCAB                            // ['ui','background','decoration','obstacle','character','animation','ball','effect','icon']
GPC_ASSETS.ready() -> Promise                   // resolves when manifest.json fetched
```

`Asset` shape:

```ts
{
  id: string,
  path: string,                // relative to www/  (or data: URL for uploads)
  name: string,
  tags: string[],
  course?: '1'|'2'|'3'|'4'|'5'|'6',
  w: number, h: number,
  type: 'sprite' | 'animation',
  frameCount?: number,
  source: 'on-disk' | 'uploaded',
  hidden?: boolean,
}
```

## Storage

| Layer | Where | Purpose |
| --- | --- | --- |
| On-disk | `assets/manifest.json` (fetched) | Canonical list of files in repo |
| Overrides | `localStorage['gpc_asset_overrides']` (`{id: patch}`) | User edits to on-disk assets (rename/retag/hide) |
| Uploads | `localStorage['gpc_asset_uploads']` (`Asset[]`) | User-uploaded assets (path = data URL) |

Reads merge: on-disk + overrides applied, then uploads appended; `hidden:true`
filtered out.

## Adding the script

Already wired into:
`index.html`, `editor.html`, `course-editor.html`, `ui-editor.html`,
`asset-editor.html`, `assets-library.html`.

For new pages, include before any consumer:

```html
<script src="./src/asset-manifest.js?v=1"></script>
```
