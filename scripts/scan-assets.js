#!/usr/bin/env node
/**
 * scan-assets.js — Scan a project's `<assetRoot>/**\/*.png` tree and produce
 * `<manifestPath>` (canonical on-disk asset list).
 *
 * Project-agnostic: tagging rules and override file paths are loaded from a
 * config file. The submodule ships sane fallbacks but contains NO project-
 * specific (golf, ball, c1-c9) hardcoded patterns.
 *
 * Usage:
 *   node scan-assets.js [--config <path>] [--check]
 *
 * Config (`scan-assets.config.json`) — searched in this order, first hit wins:
 *   1. --config <path>
 *   2. <root>/scan-assets.config.json
 *   3. <root>/www/lib/asset-system/scan-assets.config.json
 *   (root is detected by walking up looking for `<root>/<assetRoot>`)
 *
 * Schema:
 *   {
 *     "manifestPath": "www/assets/manifest.json",  // output, relative to root
 *     "assetRoot":    "www/assets/sliced",         // scan input
 *     "pathStrip":    "www/assets/",               // stripped from path field
 *     "pathRelativeTo": "www",                     // path field is relative to <root>/<this>
 *     "overridesPath": "manifest.overrides.json",  // hand-curated override JSON
 *     "courseRegex":  "(?:^|[\\/_-])c([1-9])(?:[-_\\/.]|$)",  // capture group 1 = course id
 *     "tagRules": [                                // ordered; ALL matching rules apply
 *       { "match": "regex string", "flags": "i", "tags": ["ui","icon"] }
 *       // optional: { "stop": true } to halt rule evaluation when matched
 *       // optional: { "replaceTags": true } to clear previously-added tags
 *     ],
 *     "frameCountRegex": "[-_](\\d+)f(?:[-_.]|$)",
 *     "defaultTags": ["decoration"]
 *   }
 *
 * Override file (`manifest.overrides.json`):
 *   {
 *     "version": 1,
 *     "overrides": {
 *       "<asset-id>": { "name": "Pretty Name", "tags": ["ball","accessory"] }
 *     }
 *   }
 *   - `name` REPLACES the auto name.
 *   - `tags` REPLACES the auto tags array (explicit, never appends).
 *   - other keys are shallow-merged on top of the auto entry.
 *   - Keys in the override that do NOT match any on-disk asset are kept as
 *     "orphan-overrides" entries (with source: 'orphan-override') so the
 *     regen does not silently drop curated data; cleanup is manual.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { config: null, check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') out.config = argv[++i];
    else if (a.startsWith('--config=')) out.config = a.slice('--config='.length);
    else if (a === '--check') out.check = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: scan-assets.js [--config <path>] [--check]\n');
      process.exit(0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------
function resolveRoot(assetRootHint) {
  if (process.env.GPC_ROOT) return path.resolve(process.env.GPC_ROOT);
  let cur = path.resolve(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (assetRootHint && fs.existsSync(path.join(cur, assetRootHint))) return cur;
    if (fs.existsSync(path.join(cur, 'www', 'assets', 'sliced'))) return cur;
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, '..');
}

// ---------------------------------------------------------------------------
// Defaults — minimal, project-neutral
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  manifestPath: 'www/assets/manifest.json',
  assetRoot: 'www/assets/sliced',
  pathRelativeTo: 'www',
  overridesPath: 'manifest.overrides.json',
  courseRegex: '(?:^|[\\/_-])c([1-9])(?:[-_\\/.]|$)',
  tagRules: [],
  frameCountRegex: '[-_](\\d+)f(?:[-_.]|$)',
  defaultTags: ['decoration'],
};

function loadConfig(explicitPath) {
  let configPath = null;
  if (explicitPath) {
    configPath = path.resolve(explicitPath);
  } else {
    // Probe likely roots
    const probes = [];
    let cur = path.resolve(__dirname, '..');
    for (let i = 0; i < 8; i++) {
      probes.push(path.join(cur, 'scan-assets.config.json'));
      probes.push(path.join(cur, 'www', 'lib', 'asset-system', 'scan-assets.config.json'));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    for (const p of probes) {
      if (fs.existsSync(p)) { configPath = p; break; }
    }
  }
  if (!configPath || !fs.existsSync(configPath)) {
    return { config: { ...DEFAULT_CONFIG }, source: null };
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { config: { ...DEFAULT_CONFIG, ...raw }, source: configPath };
}

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function pngSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return { w: 0, h: 0 };
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch (_) { return { w: 0, h: 0 }; }
}

// ---------------------------------------------------------------------------
// Tag rule engine
// ---------------------------------------------------------------------------
function compileRules(rules) {
  return (rules || []).map((r) => {
    let re = null;
    try { re = new RegExp(r.match, r.flags || ''); }
    catch (e) { throw new Error(`Invalid regex in tagRule: ${r.match} (${e.message})`); }
    return {
      re,
      tags: Array.isArray(r.tags) ? r.tags : [],
      stop: !!r.stop,
      replaceTags: !!r.replaceTags,
      target: r.target || 'rel', // 'rel' | 'name'
    };
  });
}

function applyRules(rel, name, compiledRules) {
  const tags = new Set();
  for (const r of compiledRules) {
    const subject = r.target === 'name' ? name : rel;
    if (r.re.test(subject)) {
      if (r.replaceTags) tags.clear();
      for (const t of r.tags) tags.add(t);
      if (r.stop) break;
    }
  }
  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
function detectFrameCount(name, regexSrc) {
  try {
    const re = new RegExp(regexSrc, 'i');
    const m = name.match(re);
    if (m) return parseInt(m[1], 10);
  } catch (_) { /* ignore */ }
  // Fallback secondary
  const m2 = name.match(/(?:anim|strip)[-_](\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

function detectCourse(rel, regexSrc) {
  if (!regexSrc) return null;
  try {
    const re = new RegExp(regexSrc, 'i');
    const m = rel.toLowerCase().match(re);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function makeId(rel, pathStrip) {
  let r = rel;
  if (pathStrip && r.startsWith(pathStrip)) r = r.slice(pathStrip.length);
  return r.replace(/\.png$/i, '').replace(/[\/]/g, ':');
}

function loadOverrides(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return { version: 1, overrides: {}, source: null };
  try {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const overrides = raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
    return { version: raw.version || 1, overrides, source: absPath };
  } catch (e) {
    throw new Error(`Failed to parse overrides at ${absPath}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  const cfgRes = loadConfig(args.config);
  const cfg = cfgRes.config;
  const root = resolveRoot(cfg.assetRoot);

  const slicedAbs = path.join(root, cfg.assetRoot);
  const outAbs = path.join(root, cfg.manifestPath);
  const overridesAbs = cfg.overridesPath ? path.join(root, cfg.overridesPath) : null;
  const pathBase = cfg.pathRelativeTo ? path.join(root, cfg.pathRelativeTo) : root;

  if (!fs.existsSync(slicedAbs)) {
    console.error('No asset root found at', slicedAbs);
    process.exit(1);
  }

  const compiledRules = compileRules(cfg.tagRules);
  const overridesData = loadOverrides(overridesAbs);

  const files = walk(slicedAbs).sort();
  const assets = [];
  const tagCounts = {};
  const seenIds = new Set();

  for (const abs of files) {
    const rel = path.relative(pathBase, abs).split(path.sep).join('/');
    const name = path.basename(abs, '.png');
    const { w, h } = pngSize(abs);
    const frameCount = detectFrameCount(name, cfg.frameCountRegex);
    let tags = applyRules(rel, name, compiledRules);
    if (tags.length === 0) tags = (cfg.defaultTags || []).slice();
    const course = detectCourse(rel, cfg.courseRegex);
    const id = makeId(rel, cfg.pathStrip || '');

    let asset = {
      id,
      path: rel,
      name,
      tags,
      w, h,
      type: tags.includes('animation') ? 'animation' : 'sprite',
      source: 'on-disk',
    };
    if (course) asset.course = course;
    if (frameCount) asset.frameCount = frameCount;

    // Apply override (merge on top, name + tags replace; other fields shallow-merge)
    const ov = overridesData.overrides[id];
    if (ov) {
      asset = { ...asset, ...ov };
      if (ov.name) asset.name = ov.name;
      if (Array.isArray(ov.tags)) asset.tags = ov.tags.slice();
      asset.type = asset.tags.includes('animation') ? 'animation' : 'sprite';
    }

    assets.push(asset);
    seenIds.add(id);
    for (const t of asset.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }

  // Orphan overrides — keys present in override file but no matching on-disk asset.
  const orphanOverrides = [];
  for (const [k, v] of Object.entries(overridesData.overrides)) {
    if (seenIds.has(k)) continue;
    orphanOverrides.push(k);
    const a = {
      id: k,
      path: v.path || null,
      name: v.name || k,
      tags: Array.isArray(v.tags) ? v.tags.slice() : [],
      w: v.w || 0,
      h: v.h || 0,
      type: (Array.isArray(v.tags) && v.tags.includes('animation')) ? 'animation' : 'sprite',
      source: 'orphan-override',
      ...v,
    };
    assets.push(a);
  }
  if (orphanOverrides.length) {
    console.warn(`scan-assets: ${orphanOverrides.length} orphan override(s) (no matching file on disk):`);
    for (const k of orphanOverrides) console.warn('  -', k);
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: assets.length,
    tagCounts,
    assets,
  };

  if (args.check) {
    let prev = null;
    if (fs.existsSync(outAbs)) {
      try { prev = JSON.parse(fs.readFileSync(outAbs, 'utf8')); } catch (_) { /* ignore */ }
    }
    if (!prev) { console.log('--check: no existing manifest, would write fresh.'); process.exit(1); }
    // Compare ignoring generatedAt
    const a = JSON.stringify({ ...manifest, generatedAt: '' });
    const b = JSON.stringify({ ...prev,     generatedAt: '' });
    if (a === b) { console.log('--check: manifest is up to date.'); process.exit(0); }
    console.log('--check: manifest is OUT OF DATE.');
    process.exit(1);
  }

  fs.writeFileSync(outAbs, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${assets.length} assets to ${path.relative(root, outAbs)}`);
  if (cfgRes.source) console.log(`Config:    ${path.relative(root, cfgRes.source)}`);
  if (overridesData.source) console.log(`Overrides: ${path.relative(root, overridesData.source)} (${Object.keys(overridesData.overrides).length} entries)`);
  console.log('Tag counts:', tagCounts);
}

main();
