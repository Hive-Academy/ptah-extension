#!/usr/bin/env node
/**
 * Fails when a docs page references a screenshot that is not in the repo.
 *
 * `astro build` resolves content-collection frontmatter, not `/screenshots/…`
 * URLs: those are plain public-directory paths the browser fetches at request
 * time. So 27 broken image references built cleanly and shipped to
 * docs.ptah.live, where every one of them rendered as a broken image
 * (TASK_2026_260). This is the gate that stops the next one.
 *
 * Run: `node apps/ptah-docs/scripts/check-screenshot-refs.mjs`
 * Wired into `nx build ptah-docs` ahead of `astro build`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = join(DOCS_ROOT, 'src', 'content', 'docs');
const PUBLIC_SHOTS = join(DOCS_ROOT, 'public', 'screenshots');

const REFERENCE = /\/screenshots\/([A-Za-z0-9._-]+\.(?:png|webp|jpe?g|gif|svg))/g;

/** Every markdown/MDX file under the docs content collection. */
function contentFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...contentFiles(full));
    else if (/\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
}

const present = existsSync(PUBLIC_SHOTS)
  ? new Set(readdirSync(PUBLIC_SHOTS))
  : new Set();

/** file -> missing asset names, in first-seen order. */
const missing = new Map();
const referenced = new Set();

for (const file of contentFiles(CONTENT_DIR)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(REFERENCE)) {
    const asset = match[1];
    referenced.add(asset);
    if (present.has(asset)) continue;
    const key = relative(DOCS_ROOT, file).replace(/\\/g, '/');
    if (!missing.has(key)) missing.set(key, new Set());
    missing.get(key).add(asset);
  }
}

if (missing.size > 0) {
  const total = [...missing.values()].reduce((n, set) => n + set.size, 0);
  console.error(
    `\n${total} screenshot reference(s) in ${missing.size} page(s) have no file ` +
      `in public/screenshots/:\n`,
  );
  for (const [file, assets] of missing) {
    console.error(`  ${file}`);
    for (const asset of assets) console.error(`    - /screenshots/${asset}`);
  }
  console.error(
    `\nCapture the missing shots with \`nx run ptah-docs:screenshots\`, or ` +
      `remove the reference. A missing file ships as a broken image — ` +
      `\`astro build\` cannot see it.\n`,
  );
  process.exit(1);
}

const orphans = [...present].filter((file) => !referenced.has(file));
if (orphans.length > 0) {
  // Not a failure: an asset can legitimately land ahead of the page using it.
  console.warn(
    `[screenshots] ${orphans.length} unreferenced file(s): ${orphans.join(', ')}`,
  );
}

console.log(
  `[screenshots] ${referenced.size} reference(s) across the docs all resolve.`,
);
