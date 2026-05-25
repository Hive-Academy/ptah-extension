#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const REPLACEMENT = '>=6.0.2';

function patchPackageJson(pkgPath) {
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch {
    return false;
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return false;
  }

  let changed = false;
  for (const field of ['dependencies', 'optionalDependencies']) {
    const range = pkg[field] && pkg[field].tar;
    if (typeof range === 'string' && /^[~^]?[0-6]\./.test(range)) {
      pkg[field].tar = REPLACEMENT;
      changed = true;
    }
  }

  if (changed) {
    const trailingNewline = raw.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + trailingNewline);
  }
  return changed;
}

function scan(dir, patched) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('@')) {
      scan(path.join(dir, name), patched);
      continue;
    }
    const pkgDir = path.join(dir, name);
    if (patchPackageJson(path.join(pkgDir, 'package.json'))) {
      patched.push(path.relative(NODE_MODULES, pkgDir));
    }
    const nested = path.join(pkgDir, 'node_modules');
    if (fs.existsSync(nested)) scan(nested, patched);
  }
}

function main() {
  if (!fs.existsSync(NODE_MODULES)) {
    return;
  }
  const patched = [];
  scan(NODE_MODULES, patched);
  if (patched.length > 0) {
    console.log(
      `[patch-sqlite3-tar] widened tar range to "${REPLACEMENT}" in: ${patched.join(', ')}`,
    );
  } else {
    console.log(
      '[patch-sqlite3-tar] no conflicting tar ranges found (nothing to patch).',
    );
  }
}

main();
