# Changelog

## 0.3.0 — 2026-05-04

### Changed
- `scripts/scan-assets.js` — fully project-agnostic. All tagging logic now driven by an external config file (`scan-assets.config.json`); the scanner no longer hardcodes any project-specific patterns (no golf/ball/c1-c9 in source). Search order: `--config <path>` > `<root>/scan-assets.config.json` > `<root>/www/lib/asset-system/scan-assets.config.json`.

### Added
- Override layer: scan-assets reads `manifest.overrides.json` (path configurable) and merges hand-curated `name` and `tags` on top of the heuristic output. `name` replaces the auto name; `tags` array replaces (explicit, not appended); other keys shallow-merge. Override keys with no matching on-disk asset are kept as `source: 'orphan-override'` entries with a console warning, so curated data is never silently dropped on regen.
- `--check` flag: dry-run that compares regenerated manifest against the on-disk file (ignoring `generatedAt`) and exits 0 if up-to-date, 1 otherwise. Useful for CI pre-commit gating.
- Config schema fields: `assetRoot`, `pathRelativeTo`, `overridesPath`, `courseRegex`, `frameCountRegex`, `defaultTags`, `tagRules` (ordered list of `{match, flags, tags, stop?, replaceTags?, target?}` rules; `target` = `'rel'` (default, full path) or `'name'` (basename)).

### Notes
- Idempotent: running scan-assets twice in a row produces a byte-identical manifest aside from `generatedAt`.
- Backward compatible: if no config file is found, defaults match the previous behaviour shape (manifest at `www/assets/manifest.json`, scan `www/assets/sliced`), but with empty `tagRules` (so all assets get `defaultTags`). Projects upgrading must add a `scan-assets.config.json`.

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
