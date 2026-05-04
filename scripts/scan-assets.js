#!/usr/bin/env node
/**
 * scan-assets.js — Scan www/assets/sliced/**\/*.png and produce
 * www/assets/manifest.json (canonical on-disk asset list).
 *
 * Usage: node scripts/scan-assets.js
 *
 * The output schema matches the contract consumed by
 * www/src/asset-manifest.js (window.GPC_ASSETS).
 */
const fs = require('fs');
const path = require('path');

// Resolve project root: env override > walk up looking for www/assets/sliced
// > fallback to ../ (matches old behaviour for projects laid out as
// `<root>/www/assets/sliced`). This lets the script run from inside a git
// submodule (`<root>/www/lib/asset-system/`) without a wrapper.
function resolveRoot() {
  if (process.env.GPC_ROOT) return path.resolve(process.env.GPC_ROOT);
  let cur = path.resolve(__dirname, '..');
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(cur, 'www', 'assets', 'sliced'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, '..');
}
const ROOT = resolveRoot();
const SLICED = path.join(ROOT, 'www', 'assets', 'sliced');
const OUT = path.join(ROOT, 'www', 'assets', 'manifest.json');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// Try to detect PNG dimensions from header bytes (no external deps).
function pngSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return { w: 0, h: 0 };
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h };
  } catch (_) { return { w: 0, h: 0 }; }
}

// Detect course tag from path. Recognises:
//   c1-foo.png, foo-c1.png, foo_c1_bar, course1-foo, courseN/, c1-anything/
//   Returns null for ui-/ball-/global assets.
function detectCourse(rel) {
  const lower = rel.toLowerCase();
  // Hard-exclude global namespaces.
  if (/(?:^|\/)balls\//.test(lower)) return null;
  const base = lower.split('/').pop() || '';
  if (/^ui[-_]/.test(base)) return null;

  // course<N>-... or course<N>/...
  let m = lower.match(/(?:^|[\/_-])course([1-6])(?:[-_\/.]|$)/);
  if (m) return m[1];
  // c<N> as a token boundary anywhere in the path/name (start, after /, _ or -;
  // followed by /, -, _, . or end).
  m = lower.match(/(?:^|[\/_-])c([1-6])(?:[-_\/.]|$)/);
  if (m) return m[1];
  return null;
}

// Detect frame count from filename: e.g. -8f, _8f, -anim-8, -strip-8
function detectFrameCount(name) {
  const m1 = name.match(/[-_](\d+)f(?:[-_.]|$)/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = name.match(/(?:anim|strip)[-_](\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

function autoTag(rel, name, frameCount) {
  const tags = new Set();
  const lower = rel.toLowerCase();

  // UI
  if (/batch8\/ui[-_]/i.test(lower) || /(?:^|\/)ui[-_]/i.test(name)) {
    tags.add('ui'); tags.add('icon');
  }

  // Balls
  if (/\/balls\//i.test(lower) || /\/ball-\d+/i.test(lower)) {
    tags.add('ball'); tags.add('character');
  }

  // C1 ambient sub-folders
  if (/c1-ambient\/sun\//i.test(lower)) { tags.add('background'); tags.add('decoration'); }
  if (/c1-ambient\/clouds\//i.test(lower)) { tags.add('background'); tags.add('decoration'); }
  if (/c1-ambient\/butterflies\//i.test(lower)) { tags.add('background'); tags.add('decoration'); tags.add('character'); }

  // C1 grass + flowers
  if (/c1-grass\//i.test(lower) || /c1-flowers/i.test(name)) {
    tags.add('background'); tags.add('decoration');
  }

  // Course-tagged sprites (non-flower/cloud) → background+obstacle
  const courseMatch = name.match(/^c([1-6])-/i);
  if (courseMatch && !/flower|cloud|grass|ambient/i.test(name)) {
    tags.add('background');
    tags.add('obstacle');
  }

  // Animation / strip
  if (/-anim|_anim|-strip|_strip/i.test(name) || frameCount) {
    tags.add('animation');
  }

  // Effect heuristics
  if (/glow|spark|effect|flash|shine|burst/i.test(name)) tags.add('effect');

  // Character heuristics
  if (/(?:^|[-_])(?:croc|crocodile|butterfly|fish|bird|enemy|character)/i.test(name)) {
    tags.add('character');
  }

  if (tags.size === 0) tags.add('decoration');
  return Array.from(tags);
}

function makeId(rel) {
  return rel.replace(/^www\/assets\//, '').replace(/\.png$/i, '').replace(/[\/]/g, ':');
}

function main() {
  if (!fs.existsSync(SLICED)) {
    console.error('No sliced/ directory found at', SLICED);
    process.exit(1);
  }
  const files = walk(SLICED).sort();
  const assets = [];
  const tagCounts = {};

  for (const abs of files) {
    const rel = path.relative(path.join(ROOT, 'www'), abs).split(path.sep).join('/');
    const name = path.basename(abs, '.png');
    const { w, h } = pngSize(abs);
    const frameCount = detectFrameCount(name);
    const tags = autoTag(rel, name, frameCount);
    const course = detectCourse(rel);
    const type = tags.includes('animation') ? 'animation' : 'sprite';

    const asset = {
      id: makeId(rel),
      path: rel, // relative to www/
      name,
      tags,
      w, h,
      type,
      source: 'on-disk',
    };
    if (course) asset.course = course;
    if (frameCount) asset.frameCount = frameCount;
    assets.push(asset);

    for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: assets.length,
    tagCounts,
    assets,
  };

  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${assets.length} assets to ${path.relative(ROOT, OUT)}`);
  console.log('Tag counts:', tagCounts);
}

main();
