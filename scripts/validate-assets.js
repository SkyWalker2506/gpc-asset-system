#!/usr/bin/env node
/**
 * validate-assets.js — Read-only health check for an asset manifest.
 *
 * Project-agnostic. Lives next to scan-assets.js. Does NOT regenerate the
 * manifest. Reports manifest <-> filesystem mismatches and intra-manifest
 * inconsistencies, suitable for CI gating.
 *
 * Usage:
 *   node validate-assets.js [--config <path>] [--json] [--fail-on=warn|error]
 *
 * Config (validate.config.json) — searched in order:
 *   1. --config <path>
 *   2. <project-root>/www/lib/asset-system/validate.config.json
 *   3. <project-root>/validate.config.json
 *   (project root is detected the same way scan-assets.js does it)
 *
 * Schema:
 *   {
 *     "manifestPath": "www/assets/manifest.json",
 *     "assetRoots":   ["www/assets/sliced"],
 *     "tagVocab":     ["ui","background", ...],   // optional
 *     "sizeThresholdKB": 1024,                    // optional, default 1024
 *     "skipFiles":    ["**\/_archive\/**", ...]   // optional glob list
 *   }
 *
 * Exit codes:
 *   0 — clean
 *   1 — warnings only (and --fail-on=warn)  OR informational issues
 *   2 — errors            (and --fail-on=error, the default)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Project root detection (mirrors scan-assets.js)
// ---------------------------------------------------------------------------
function resolveRoot() {
  if (process.env.GPC_ROOT) return path.resolve(process.env.GPC_ROOT);
  let cur = path.resolve(__dirname, '..');
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(cur, 'www', 'assets')) ||
      fs.existsSync(path.join(cur, 'package.json'))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, '..');
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { config: null, json: false, failOn: 'error' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--config') out.config = argv[++i];
    else if (a.startsWith('--config=')) out.config = a.slice('--config='.length);
    else if (a.startsWith('--fail-on=')) out.failOn = a.slice('--fail-on='.length);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: validate-assets.js [--config <path>] [--json] [--fail-on=warn|error]\n'
      );
      process.exit(0);
    }
  }
  if (!['warn', 'error', 'never'].includes(out.failOn)) out.failOn = 'error';
  return out;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
const DEFAULTS = {
  manifestPath: 'www/assets/manifest.json',
  assetRoots: ['www/assets/sliced'],
  tagVocab: null,
  sizeThresholdKB: 1024,
  skipFiles: [],
};

function loadConfig(root, explicit) {
  const tried = [];
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  candidates.push(path.join(root, 'www', 'lib', 'asset-system', 'validate.config.json'));
  candidates.push(path.join(root, 'validate.config.json'));
  for (const p of candidates) {
    tried.push(p);
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        return { config: { ...DEFAULTS, ...raw }, source: p };
      } catch (e) {
        throw new Error(`Failed to parse config at ${p}: ${e.message}`);
      }
    }
  }
  return { config: { ...DEFAULTS }, source: null, tried };
}

// ---------------------------------------------------------------------------
// Glob matching (minimal, supports **, *, ?)
// ---------------------------------------------------------------------------
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^$(){}|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  re += '$';
  return new RegExp(re);
}
function matchAny(rel, patterns) {
  if (!patterns || !patterns.length) return false;
  return patterns.some((g) => globToRegExp(g).test(rel));
}

// ---------------------------------------------------------------------------
// FS walking
// ---------------------------------------------------------------------------
function walkPng(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkPng(full, out);
    else if (e.isFile() && /\.png$/i.test(e.name)) out.push(full);
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
  } catch (_) {
    return { w: 0, h: 0 };
  }
}

// ---------------------------------------------------------------------------
// Issue helpers
// ---------------------------------------------------------------------------
const LEVELS = { info: 0, warn: 1, error: 2 };
function mkIssue(level, msg, item) {
  return { level, msg, item: item || null };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------
function vOrphanFiles(ctx) {
  const issues = [];
  const manifestPaths = new Set(ctx.assets.map((a) => normalizePath(a.path)));
  for (const f of ctx.diskFiles) {
    const rel = path.relative(ctx.root, f).split(path.sep).join('/');
    const relWww = rel.startsWith('www/') ? rel.slice(4) : rel;
    if (matchAny(rel, ctx.config.skipFiles)) continue;
    if (!manifestPaths.has(normalizePath(relWww)) && !manifestPaths.has(normalizePath(rel))) {
      issues.push(mkIssue('warn', `Orphan PNG (not in manifest): ${rel}`, rel));
    }
  }
  return { name: 'orphan-files', issues };
}

function vDeadEntries(ctx) {
  const issues = [];
  for (const a of ctx.assets) {
    const abs = resolveManifestPath(ctx.root, a.path);
    if (!fs.existsSync(abs)) {
      issues.push(mkIssue('error', `Manifest entry points to missing file: ${a.id} -> ${a.path}`, a.id));
    }
  }
  return { name: 'dead-entries', issues };
}

function vDuplicateIds(ctx) {
  const issues = [];
  const seen = new Map();
  for (const a of ctx.assets) {
    if (!a.id) {
      issues.push(mkIssue('error', `Manifest entry without id (path=${a.path})`, a.path));
      continue;
    }
    if (seen.has(a.id)) {
      issues.push(mkIssue('error', `Duplicate id: ${a.id}`, a.id));
    } else seen.set(a.id, true);
  }
  return { name: 'duplicate-ids', issues };
}

function vDuplicatePaths(ctx) {
  const issues = [];
  const seen = new Map();
  for (const a of ctx.assets) {
    if (!a.path) continue;
    const k = normalizePath(a.path);
    if (seen.has(k)) {
      issues.push(mkIssue('warn', `Duplicate path '${a.path}' (ids: ${seen.get(k)} & ${a.id})`, a.path));
    } else seen.set(k, a.id);
  }
  return { name: 'duplicate-paths', issues };
}

function vMissingTags(ctx) {
  const issues = [];
  for (const a of ctx.assets) {
    if (!Array.isArray(a.tags) || a.tags.length === 0) {
      issues.push(mkIssue('warn', `Asset has no tags: ${a.id}`, a.id));
    }
  }
  return { name: 'missing-tags', issues };
}

function vUnknownTags(ctx) {
  const issues = [];
  const vocab = ctx.config.tagVocab;
  if (!Array.isArray(vocab) || vocab.length === 0) {
    return { name: 'unknown-tags', issues, skipped: 'no tagVocab in config' };
  }
  const allowed = new Set(vocab);
  for (const a of ctx.assets) {
    if (!Array.isArray(a.tags)) continue;
    for (const t of a.tags) {
      if (!allowed.has(t)) {
        issues.push(mkIssue('warn', `Unknown tag '${t}' on ${a.id}`, a.id));
      }
    }
  }
  return { name: 'unknown-tags', issues };
}

function vBrokenRuntimePaths(ctx) {
  const issues = [];
  for (const a of ctx.assets) {
    for (const key of ['runtimeDir', 'canonicalPath']) {
      const v = a[key];
      if (!v) continue;
      const abs = resolveManifestPath(ctx.root, v);
      if (!fs.existsSync(abs)) {
        issues.push(mkIssue('error', `${key} unresolved on ${a.id}: ${v}`, a.id));
      }
    }
  }
  return { name: 'broken-runtime-paths', issues };
}

function vSizeAnomaly(ctx) {
  const issues = [];
  const limit = (ctx.config.sizeThresholdKB || 1024) * 1024;
  for (const f of ctx.diskFiles) {
    const rel = path.relative(ctx.root, f).split(path.sep).join('/');
    if (matchAny(rel, ctx.config.skipFiles)) continue;
    let st;
    try { st = fs.statSync(f); } catch (_) { continue; }
    if (st.size > limit) {
      issues.push(mkIssue('warn', `Oversize PNG (${(st.size/1024).toFixed(0)}KB > ${ctx.config.sizeThresholdKB}KB): ${rel}`, rel));
    }
  }
  return { name: 'size-anomaly', issues };
}

function vDimensionAnomaly(ctx) {
  // Group disk files by parent directory; flag any whose w*h is more than 4x
  // or less than 0.25x the median area of its siblings (min 4 siblings).
  const issues = [];
  const groups = new Map();
  for (const f of ctx.diskFiles) {
    const rel = path.relative(ctx.root, f).split(path.sep).join('/');
    if (matchAny(rel, ctx.config.skipFiles)) continue;
    const dir = path.dirname(f);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  for (const [dir, files] of groups) {
    if (files.length < 4) continue;
    const sizes = files.map((f) => ({ f, ...pngSize(f) })).filter((s) => s.w && s.h);
    if (sizes.length < 4) continue;
    const areas = sizes.map((s) => s.w * s.h).slice().sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    if (!median) continue;
    for (const s of sizes) {
      const a = s.w * s.h;
      const ratio = a / median;
      if (ratio > 4 || ratio < 0.25) {
        const rel = path.relative(ctx.root, s.f).split(path.sep).join('/');
        issues.push(mkIssue('info', `Dimension outlier (${s.w}x${s.h}, ${ratio.toFixed(2)}x median in ${path.relative(ctx.root, dir)}): ${rel}`, rel));
      }
    }
  }
  return { name: 'dimension-anomaly', issues };
}

// ---------------------------------------------------------------------------
// Path helpers — manifest paths are stored relative to www/ (legacy) or
// project root. Try both.
// ---------------------------------------------------------------------------
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
function resolveManifestPath(root, p) {
  const norm = normalizePath(p);
  const aWww = path.join(root, 'www', norm);
  if (fs.existsSync(aWww)) return aWww;
  const aRoot = path.join(root, norm);
  return aRoot;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  const root = resolveRoot();
  let configRes;
  try {
    configRes = loadConfig(root, args.config);
  } catch (e) {
    process.stderr.write(`validate-assets: ${e.message}\n`);
    process.exit(2);
  }
  const config = configRes.config;

  const manifestAbs = path.join(root, config.manifestPath);
  if (!fs.existsSync(manifestAbs)) {
    process.stderr.write(`validate-assets: manifest not found at ${manifestAbs}\n`);
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
  } catch (e) {
    process.stderr.write(`validate-assets: failed to parse manifest: ${e.message}\n`);
    process.exit(2);
  }
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  const diskFiles = [];
  for (const r of config.assetRoots) {
    walkPng(path.join(root, r), diskFiles);
  }

  const ctx = { root, config, manifest, assets, diskFiles };

  const validators = [
    vOrphanFiles,
    vDeadEntries,
    vDuplicateIds,
    vDuplicatePaths,
    vMissingTags,
    vUnknownTags,
    vBrokenRuntimePaths,
    vSizeAnomaly,
    vDimensionAnomaly,
  ];

  const results = validators.map((fn) => fn(ctx));

  // Aggregate
  let maxLevel = -1;
  const counts = { info: 0, warn: 0, error: 0 };
  for (const r of results) {
    for (const i of r.issues) {
      counts[i.level] = (counts[i.level] || 0) + 1;
      if (LEVELS[i.level] > maxLevel) maxLevel = LEVELS[i.level];
    }
  }

  const summary = {
    root,
    configSource: configRes.source,
    manifestPath: config.manifestPath,
    manifestCount: assets.length,
    diskFileCount: diskFiles.length,
    counts,
    results,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    printHuman(summary);
  }

  let exit = 0;
  if (args.failOn === 'error' && maxLevel >= LEVELS.error) exit = 2;
  else if (args.failOn === 'warn' && maxLevel >= LEVELS.warn) exit = 1;
  else if (counts.warn || counts.info) exit = exit || (maxLevel >= LEVELS.error ? 2 : (maxLevel >= LEVELS.warn ? 1 : 0));
  process.exit(exit);
}

function printHuman(s) {
  const out = [];
  out.push(`validate-assets — root: ${s.root}`);
  out.push(`  config:   ${s.configSource || '(defaults; no config file found)'}`);
  out.push(`  manifest: ${s.manifestPath} (${s.manifestCount} assets)`);
  out.push(`  on-disk:  ${s.diskFileCount} PNG files`);
  out.push('');
  for (const r of s.results) {
    const tag = r.skipped ? `[skipped: ${r.skipped}]` : (r.issues.length === 0 ? '[ok]' : `[${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}]`);
    out.push(`- ${r.name} ${tag}`);
    const show = r.issues.slice(0, 10);
    for (const i of show) {
      out.push(`    ${i.level.toUpperCase().padEnd(5)} ${i.msg}`);
    }
    if (r.issues.length > show.length) {
      out.push(`    ... and ${r.issues.length - show.length} more`);
    }
  }
  out.push('');
  out.push(`Totals: ${s.counts.error || 0} error, ${s.counts.warn || 0} warn, ${s.counts.info || 0} info`);
  process.stdout.write(out.join('\n') + '\n');
}

main();
