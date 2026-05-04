# Changelog

## 0.2.0 — 2026-05-04

### Added
- `scripts/validate-assets.js` — read-only manifest health check. 9 validators (orphan-files, dead-entries, duplicate-ids, duplicate-paths, missing-tags, unknown-tags, broken-runtime-paths, size-anomaly, dimension-anomaly). Pure Node, no deps. CLI: `--config`, `--json`, `--fail-on=warn|error`. Project-agnostic: config-driven manifest path, asset roots, tag vocabulary, size threshold, skip globs.
- `window.AssetSystem` alias for `window.GPC_ASSETS` — preferred API name in new projects. Old name preserved for backward compatibility.
- `GPC_ASSETS_CONFIG.courses` — host page can override the asset-library "course" filter labels (e.g. `['World 1', 'World 2']`) for non-golf projects.
- `examples/standalone.html` + `examples/demo-manifest.json` — minimal demo of the manifest API with a custom tag vocab and group labels, runs without the golf host page.

### Notes
- `GPC_ASSETS_CONFIG.tagVocab` was already supported in `asset-manifest.js`; the change in this release makes the asset-library UI honor a custom `courses` list as well.

## 0.1.0 — 2026-05-03

- Initial extract from golf-paper-craft.
