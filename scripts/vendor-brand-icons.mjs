#!/usr/bin/env node
/**
 * vendor-brand-icons.mjs
 *
 * Vendors brand marks from theSVG (github.com/glincker/thesvg) at ONE pinned
 * commit into TypeScript path data for `@ptah-extension/ui`
 * (`native/brand-mark/brand-marks.generated.ts`). Run by hand; the output is
 * committed. It is not part of any build, so CI never depends on the network.
 *
 * Why TypeScript and not `.svg` files: the VS Code Marketplace scanner rejects
 * AI vendor names in non-JS files, by file path as well as by content
 * (`libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts:5-11`).
 * Path data compiled into the webview JS passes; a vendored `openai.svg` would
 * burn the extension id.
 *
 * Pipeline, per manifest slug (`scripts/brand-icons.manifest.json`):
 *   1. Variant availability comes from theSVG's own index at the pinned commit
 *      (`src/data/icons.json`), so `onDark` exists exactly when theSVG ships a
 *      `dark` variant. A slug the index does not list must be declared
 *      `monogram` or `unindexed` in the manifest. When theSVG ships a
 *      `light`/`dark` pair, its `default` repeats the dark-background artwork,
 *      so `art` (the light-theme artwork) is read from `light`; otherwise from
 *      `default`.
 *   2. `brand-icons/extract-artwork.mjs` normalises each file with svgo and
 *      extracts `{ viewBox, kind:'fill', paths:[{ d, fill, fillRule?, opacity? }] }`
 *      with a custom svgo plugin, rejecting what the renderer cannot draw
 *      faithfully (gradients, filters, strokes, unapplied transforms, blend
 *      modes, cutting clips or masks, wordmark-shaped viewBoxes, ...).
 *   3. Art invisible on light surfaces, or dark art invisible on dark ones, is
 *      rejected too. A rejected `art` falls back to the `mono` variant painted
 *      in `currentColor`, then to a monogram. A rejected `dark` or requested
 *      `mono` is omitted. Every rejection is printed.
 *   4. `surface` is `light` when every fill has contrast below 3:1 (WCAG 1.4.11)
 *      against #1a1a20, the dark theme's base-200.
 *
 * Files are read from mirrors of the same commit, in manifest order (raw
 * GitHub first: jsDelivr refuses uncached files of this repository, which is
 * above its 50 MB package limit). Content at a commit SHA is immutable, so the
 * mirror that answers does not change the bytes.
 *
 * Outputs (paths in the manifest), all generated from the same run:
 *   - the TS table (`output`);
 *   - the SHIPPED plain-text notices (`notices`): theSVG's licence plus every
 *     mark whose own licence asks for attribution or notice. Production
 *     minification strips the TS header comment, so this file is what carries
 *     attribution into the VS Code package and the desktop app (both copy it at
 *     build time). It is not JavaScript, so a Marketplace-scanner token in it
 *     aborts the run (`brand-icons/scanner-tokens.mjs`, self-checked each run);
 *   - the NOT-shipped rejection report (`report`, under `scripts/brand-icons/`).
 *
 * Failure behaviour: any network or HTTP failure (after trying every mirror),
 * an invalid manifest, a failed A4 probe or scanner-guard self-check, output
 * above the 300 KB budget, a scanner token in the notices, or a notice-requiring
 * mark missing from them exits non-zero and writes nothing. Output is
 * deterministic: sorted slugs, alphabetical record keys, fixed precision,
 * prettier-formatted, and the dates are the manifest's pin date, not the run
 * date.
 *
 * Usage:
 *   npm run vendor:brand-icons                     # fetch, normalise, write all three outputs
 *   node scripts/vendor-brand-icons.mjs --check    # regenerate in memory; exit 1 if any generated file differs
 *   node scripts/vendor-brand-icons.mjs --probe-a4 # run only the A4 extraction probe; write nothing
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { readableOn } from './brand-icons/colour.mjs';
import { extractArtwork, toMono } from './brand-icons/extract-artwork.mjs';
import { formatNumber } from './brand-icons/path-geometry.mjs';
import {
  formatConsoleReport,
  licenceClass,
  renderNotices,
  renderRejectionReport,
  selectNamedMarks,
} from './brand-icons/render-notices.mjs';
import { isProvider, renderModule } from './brand-icons/render-table.mjs';
import {
  assertScannerGuardWorks,
  findScannerTokens,
} from './brand-icons/scanner-tokens.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const MANIFEST_PATH = resolve(ROOT_DIR, 'scripts', 'brand-icons.manifest.json');

const OUTPUT_BUDGET_BYTES = 300 * 1024;
/** The dark theme's base-200 (anubis): the backdrop of the `surface` rule. */
const SURFACE_BACKDROP = '#1a1a20';
const NON_TEXT_CONTRAST = 3;
const LIGHT_SURFACE = '#ffffff';
/**
 * Visibility guard, separate from the 3:1 tile rule: artwork whose best fill
 * stays below this on the surface it is drawn on was made for the opposite
 * background (white-on-dark art served as `default`). Logos are exempt from
 * WCAG contrast minimums, so saturated brand colours (about 2:1 on white)
 * pass; white and near-white art (below 1.3:1) does not.
 */
const VISIBILITY_FLOOR = 1.5;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_CONCURRENCY = 6;
const MAX_SVG_BYTES = 512 * 1024;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_LICENSE_BYTES = 64 * 1024;
const INDEX_PATH = 'src/data/icons.json';
const LICENSE_PATH = 'LICENSE';
const A4_PROBE = { slug: 'github', variant: 'dark' };

const GROUPS = new Set(['catalogue', 'known-server', 'cli', 'provider']);
/** Variants a manifest may declare for a folder theSVG's index does not list. */
const VARIANTS = ['default', 'dark', 'mono'];
/** Variants read from theSVG's index; `light` is used only as half of a light/dark pair. */
const THESVG_VARIANTS = ['default', 'light', 'dark', 'mono'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CHECK = process.argv.includes('--check');
const PROBE_ONLY = process.argv.includes('--probe-a4');

/** A failure that must abort the run without writing anything. */
class VendorError extends Error {}

const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// Manifest and index
// ---------------------------------------------------------------------------

function validateOutputs({ output, notices, report }, fail) {
  if (
    typeof output !== 'string' ||
    !/^libs\/[\w./-]+\.generated\.ts$/.test(output)
  ) {
    fail('output must be a libs/**/*.generated.ts path');
  }
  if (typeof notices !== 'string' || !/^libs\/[\w./-]+\.txt$/.test(notices)) {
    fail('notices must be a libs/**/*.txt path');
  }
  if (findScannerTokens(notices).length > 0) {
    fail('the notices file name must not contain a Marketplace-scanner token');
  }
  if (
    typeof report !== 'string' ||
    !/^scripts\/brand-icons\/[\w.-]+\.md$/.test(report)
  ) {
    fail('report must be a scripts/brand-icons/*.md path');
  }
}

function validateSource(source, icons, fail) {
  if (!/^[0-9a-f]{40}$/.test(source?.commit ?? ''))
    fail('source.commit must be a 40-hex commit SHA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source?.pinnedOn ?? ''))
    fail('source.pinnedOn must be YYYY-MM-DD');
  if (!/^[\w.-]+\/[\w.-]+$/.test(source?.repository ?? ''))
    fail('source.repository must be owner/name');
  if (!Array.isArray(source.mirrors) || source.mirrors.length === 0) {
    fail('source.mirrors must be a non-empty array');
  }
  for (const mirror of source.mirrors) {
    const valid =
      typeof mirror === 'string' &&
      mirror.startsWith('https://') &&
      mirror.includes('{commit}') &&
      mirror.includes('{path}');
    if (!valid)
      fail(
        `mirror ${JSON.stringify(mirror)} must be an https URL template with {commit} and {path}`,
      );
  }
  if (!Array.isArray(icons) || icons.length === 0)
    fail('icons must be a non-empty array');
}

function validateIcon(icon, fail) {
  const where = `icon ${JSON.stringify(icon?.slug)}`;
  if (!SLUG_RE.test(icon?.slug ?? ''))
    fail(`${where}: slug must be kebab-case`);
  if (
    !Array.isArray(icon.groups) ||
    icon.groups.length === 0 ||
    !icon.groups.every((g) => GROUPS.has(g))
  ) {
    fail(
      `${where}: groups must be a non-empty subset of ${[...GROUPS].join(', ')}`,
    );
  }
  if (icon.emitMono !== undefined && icon.emitMono !== true)
    fail(`${where}: emitMono must be true when present`);
  if (icon.monogram !== undefined) {
    if (typeof icon.monogram !== 'string' || icon.monogram.trim() === '')
      fail(`${where}: monogram must state a reason`);
    if (icon.emitMono || icon.unindexed)
      fail(`${where}: a monogram slug cannot request artwork`);
    if (icon.groups.includes('provider'))
      fail(`${where}: a provider brand needs artwork, not a monogram`);
  }
  if (icon.unindexed !== undefined) {
    const { variants, note } = icon.unindexed;
    const validVariants =
      Array.isArray(variants) &&
      variants.includes('default') &&
      variants.every((v) => VARIANTS.includes(v));
    if (!validVariants)
      fail(
        `${where}: unindexed.variants must include "default" and only ${VARIANTS.join(', ')}`,
      );
    if (typeof note !== 'string' || note.trim() === '')
      fail(`${where}: unindexed.note must explain the folder`);
  }
}

function loadManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const { source, icons } = manifest;
  const fail = (message) => {
    throw new VendorError(`Invalid manifest: ${message}`);
  };
  validateSource(source, icons, fail);
  validateOutputs(manifest, fail);
  const seen = new Set();
  for (const icon of icons) {
    validateIcon(icon, fail);
    if (seen.has(icon.slug)) fail(`icon "${icon.slug}": duplicate slug`);
    seen.add(icon.slug);
  }
  const probe = icons.find((icon) => icon.slug === A4_PROBE.slug);
  if (!probe || probe.monogram)
    fail(`the A4 probe needs "${A4_PROBE.slug}" as a vendored slug`);
  return {
    source,
    outputs: {
      table: manifest.output,
      notices: manifest.notices,
      report: manifest.report,
    },
    icons: [...icons].sort((a, b) => compareStrings(a.slug, b.slug)),
  };
}

function indexBySlug(index) {
  if (!Array.isArray(index))
    throw new VendorError(`${INDEX_PATH} is not an array`);
  const bySlug = new Map();
  const byAlias = new Map();
  for (const entry of index) {
    if (
      typeof entry?.slug !== 'string' ||
      typeof entry.variants !== 'object' ||
      entry.variants === null
    )
      continue;
    bySlug.set(entry.slug, entry);
    for (const alias of entry.aliases ?? [])
      byAlias.set(String(alias).toLowerCase(), entry);
  }
  return { bySlug, byAlias };
}

function dropUndefined(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

/** Turns a manifest entry into the files to fetch, checked against theSVG's index. */
function planIcon(icon, index) {
  const entry = index.bySlug.get(icon.slug);
  const alias = index.byAlias.get(icon.slug);
  const licence = entry
    ? String(entry.license ?? 'not declared')
    : alias
      ? `${alias.license ?? 'not declared'} (index alias of ${alias.slug})`
      : 'not declared';
  // Display name, brand site and licence id for the shipped notices file.
  const described = entry ?? alias;
  const brand = {
    title: String(described?.title ?? icon.slug),
    url: typeof described?.url === 'string' ? described.url : '',
    licenceId: described?.license ? String(described.license) : '',
  };
  if (icon.monogram) {
    if (entry) {
      throw new VendorError(
        `Manifest lists "${icon.slug}" as a monogram, but theSVG's index has it; vendor it instead`,
      );
    }
    return { icon, licence, brand, files: null };
  }
  if (icon.unindexed) {
    if (entry)
      throw new VendorError(
        `Manifest declares "${icon.slug}" unindexed, but theSVG's index lists it`,
      );
    const file = (variant) =>
      icon.unindexed.variants.includes(variant)
        ? `public/icons/${icon.slug}/${variant}.svg`
        : undefined;
    const files = {
      art: file('default'),
      dark: file('dark'),
      mono: file('mono'),
    };
    if (icon.emitMono && !files.mono) {
      throw new VendorError(
        `Manifest requests mono for "${icon.slug}", but declares no mono variant`,
      );
    }
    return {
      icon,
      licence,
      brand,
      files: dropUndefined(files),
      artVariant: 'default',
    };
  }
  if (!entry) {
    throw new VendorError(
      `"${icon.slug}" is not in theSVG's index at the pinned commit; declare it "monogram" or "unindexed" in the manifest`,
    );
  }
  const available = {};
  for (const variant of THESVG_VARIANTS) {
    const path = entry.variants[variant];
    if (
      typeof path === 'string' &&
      /^\/icons\/[\w.-]+\/[\w.-]+\.svg$/.test(path)
    )
      available[variant] = `public${path}`;
  }
  if (!available.default)
    throw new VendorError(
      `theSVG's index has no default variant for "${icon.slug}"`,
    );
  if (icon.emitMono && !available.mono) {
    throw new VendorError(
      `Manifest requests mono for "${icon.slug}", but theSVG has no mono variant`,
    );
  }
  // A light/dark pair is theSVG's theme split, and its `default` then repeats
  // the dark-background artwork. `art` is the light-theme artwork, so it comes
  // from `light` whenever the pair exists.
  const themed = Boolean(available.light && available.dark);
  const files = {
    art: themed ? available.light : available.default,
    dark: available.dark,
    mono: available.mono,
  };
  return {
    icon,
    licence,
    brand,
    files: dropUndefined(files),
    artVariant: themed ? 'light' : 'default',
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Fetches one repository file at the pinned commit, trying each mirror in order. */
async function fetchPinned(source, path, maxBytes) {
  const failures = [];
  for (const template of source.mirrors) {
    const url = template
      .replace('{commit}', source.commit)
      .replace('{path}', path);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        failures.push(`${url} -> HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > maxBytes)
        throw new VendorError(`${url} is larger than ${maxBytes} bytes`);
      return text;
    } catch (error) {
      if (error instanceof VendorError) throw error;
      failures.push(`${url} -> ${errorMessage(error)}`);
    }
  }
  throw new VendorError(
    `Could not fetch ${path} from any mirror:\n    ${failures.join('\n    ')}`,
  );
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await task(items[current]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Vendoring
// ---------------------------------------------------------------------------

/** `light` when every fill stays below 3:1 on the dark base-200, so the mark needs a white tile. */
function computeSurface(art) {
  return readableOn(art, SURFACE_BACKDROP, NON_TEXT_CONTRAST) ? 'any' : 'light';
}

async function vendorIcon(plan, source) {
  const { icon, files } = plan;
  const outcome = {
    slug: icon.slug,
    plan,
    record: null,
    rejections: [],
    notes: [],
  };
  if (!files) {
    outcome.notes.push(`monogram: ${icon.monogram}`);
    return outcome;
  }
  const cache = new Map();
  const load = async (key) => {
    if (!cache.has(key))
      cache.set(
        key,
        extractArtwork(await fetchPinned(source, files[key], MAX_SVG_BYTES)),
      );
    return cache.get(key);
  };
  const reject = (variant, reason, fallback) =>
    outcome.rejections.push({ variant, reason, fallback });

  // `art` is drawn on light surfaces (a white tile or a light theme's base-200).
  let primary = await load('art');
  if (
    primary.ok &&
    !readableOn(primary.artwork, LIGHT_SURFACE, VISIBILITY_FLOOR)
  ) {
    primary = {
      ok: false,
      reason: `invisible on light surfaces (every fill below ${VISIBILITY_FLOOR}:1 on ${LIGHT_SURFACE})`,
    };
  }
  let art = null;
  if (primary.ok) {
    art = primary.artwork;
  } else if (files.mono) {
    const mono = toMono(await load('mono'));
    reject(
      plan.artVariant,
      primary.reason,
      mono.ok ? 'mono variant in currentColor' : 'monogram',
    );
    if (mono.ok) art = mono.artwork;
    else reject('mono', mono.reason, 'monogram');
  } else {
    reject(plan.artVariant, primary.reason, 'monogram (no mono variant)');
  }
  if (!art) return outcome;

  const record = { art, surface: computeSurface(art) };
  if (files.dark) {
    const dark = await load('dark');
    const omitted = 'omitted; art is shown on dark themes';
    if (!dark.ok) reject('dark', dark.reason, omitted);
    else if (!readableOn(dark.artwork, SURFACE_BACKDROP, VISIBILITY_FLOOR)) {
      reject(
        'dark',
        `invisible on dark surfaces (every fill below ${VISIBILITY_FLOOR}:1 on ${SURFACE_BACKDROP})`,
        omitted,
      );
    } else record.onDark = dark.artwork;
  }
  if (icon.emitMono) {
    const mono = toMono(await load('mono'));
    if (mono.ok) record.mono = mono.artwork;
    else reject('mono', mono.reason, 'omitted; art is used for the mono tone');
  }
  outcome.record = record;
  return outcome;
}

/** A4: the plugin must run and svgo must have applied github dark's `scale(64)`. */
async function probeA4(plans, source) {
  const plan = plans.find((p) => p.icon.slug === A4_PROBE.slug);
  const path = plan.files[A4_PROBE.variant];
  if (!path)
    throw new VendorError(
      `A4 probe: theSVG has no ${A4_PROBE.variant} variant for ${A4_PROBE.slug}`,
    );
  const extraction = extractArtwork(
    await fetchPinned(source, path, MAX_SVG_BYTES),
  );
  const label = `${A4_PROBE.slug}/${A4_PROBE.variant}`;
  if (!extraction.ok)
    throw new VendorError(
      `A4 probe failed: ${label} was rejected (${extraction.reason})`,
    );
  const { box, artwork } = extraction;
  const [vx, vy, vw, vh] = artwork.viewBox.split(' ').map(Number);
  const slack = 0.005 * Math.max(vw, vh);
  const inside =
    box.minX >= vx - slack &&
    box.minY >= vy - slack &&
    box.maxX <= vx + vw + slack &&
    box.maxY <= vy + vh + slack;
  const spansViewBox =
    box.maxX - box.minX >= vw / 2 && box.maxY - box.minY >= vh / 2;
  const bbox = [box.minX, box.minY, box.maxX, box.maxY]
    .map(formatNumber)
    .join(' ');
  const summary = `A4 probe ${label}: viewBox ${artwork.viewBox}, path bbox ${bbox}, ${artwork.paths.length} path(s)`;
  if (!inside)
    throw new VendorError(`${summary} -> FAIL (outside the viewBox)`);
  if (!spansViewBox)
    throw new VendorError(
      `${summary} -> FAIL (transform not applied: paths span under half the viewBox)`,
    );
  return `${summary} -> PASS`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Formats `text` with the repository's prettier config for `relativePath`'s file type. */
async function formatFor(relativePath, text) {
  const filepath = resolve(ROOT_DIR, relativePath);
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, filepath });
}

/**
 * Renders the three generated files and runs every guard over them. Returns
 * `[relativePath, contents]` pairs only when all of them may be written.
 */
async function buildOutputs({ source, outputs, outcomes, licenseText, a4 }) {
  const table = await formatFor(
    outputs.table,
    renderModule({
      source,
      licenseText,
      outcomes,
      indexPath: INDEX_PATH,
      noticesPath: outputs.notices,
    }),
  );
  const tableBytes = Buffer.byteLength(table);
  if (tableBytes > OUTPUT_BUDGET_BYTES) {
    throw new VendorError(
      `${outputs.table} would be ${tableBytes} bytes, above the ${OUTPUT_BUDGET_BYTES}-byte budget; nothing written`,
    );
  }

  const selection = selectNamedMarks(outcomes);
  if (selection.problems.length > 0) {
    throw new VendorError(
      `Shipped notices cannot be written; nothing written:\n    ${selection.problems.join('\n    ')}`,
    );
  }
  const notices = renderNotices({ source, licenseText, selection });
  // The notices file is not JavaScript: one scanner token in it burns the
  // extension id on upload. This is the gate, not a lint.
  const banned = findScannerTokens(notices);
  if (banned.length > 0) {
    throw new VendorError(
      `${outputs.notices} would contain Marketplace-scanner tokens (${banned.join(', ')}); nothing written`,
    );
  }
  // Independent of the selection logic: every mark whose licence requires a
  // notice must be named in the text that ships.
  const unlisted = outcomes.filter(
    (o) =>
      o.record &&
      licenceClass(o.plan.brand.licenceId) === 'notice-required' &&
      !notices.includes(`\n${o.plan.brand.title}\n  Licence: `),
  );
  if (unlisted.length > 0) {
    throw new VendorError(
      `${outputs.notices} omits marks whose licence requires a notice: ${unlisted.map((o) => o.slug).join(', ')}`,
    );
  }

  const report = await formatFor(
    outputs.report,
    renderRejectionReport({ source, outcomes, a4 }),
  );
  return {
    files: [
      [outputs.table, table],
      [outputs.notices, notices],
      [outputs.report, report],
    ],
    tableBytes,
    namedCount: selection.named.length,
  };
}

function readOrEmpty(absolutePath) {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function main() {
  try {
    assertScannerGuardWorks();
  } catch (error) {
    throw new VendorError(errorMessage(error));
  }
  const { source, outputs, icons } = loadManifest();
  const index = indexBySlug(
    JSON.parse(await fetchPinned(source, INDEX_PATH, MAX_INDEX_BYTES)),
  );
  const plans = icons.map((icon) => planIcon(icon, index));

  const a4 = await probeA4(plans, source);
  if (PROBE_ONLY) {
    console.log(a4);
    return;
  }

  const licenseText = await fetchPinned(
    source,
    LICENSE_PATH,
    MAX_LICENSE_BYTES,
  );
  const outcomes = await mapWithConcurrency(plans, FETCH_CONCURRENCY, (plan) =>
    vendorIcon(plan, source),
  );
  const providerMissing = outcomes
    .filter((o) => isProvider(o) && !o.record)
    .map((o) => o.slug);
  if (providerMissing.length > 0) {
    throw new VendorError(
      `Provider brands must have artwork, but fell back to a monogram: ${providerMissing.join(', ')}`,
    );
  }

  const built = await buildOutputs({
    source,
    outputs,
    outcomes,
    licenseText,
    a4,
  });
  console.log(
    formatConsoleReport({
      source,
      outcomes,
      a4,
      output: outputs.table,
      bytes: built.tableBytes,
      budget: OUTPUT_BUDGET_BYTES,
    }),
  );
  console.log(
    `Notices: ${outputs.notices} (${built.namedCount} marks named; scanner guard clean)`,
  );
  console.log(`Rejection report: ${outputs.report}`);

  if (CHECK) {
    const stale = built.files
      .filter(([path, text]) => readOrEmpty(resolve(ROOT_DIR, path)) !== text)
      .map(([path]) => path);
    if (stale.length > 0) {
      throw new VendorError(
        `out of date: ${stale.join(', ')}; run npm run vendor:brand-icons`,
      );
    }
    console.log('All generated files are up to date');
    return;
  }
  // Every file is rendered and guarded before the first write; temporaries
  // then replace the targets by rename.
  for (const [path, text] of built.files) {
    const target = resolve(ROOT_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.tmp`, text);
  }
  for (const [path] of built.files) {
    const target = resolve(ROOT_DIR, path);
    renameSync(`${target}.tmp`, target);
    console.log(`Wrote ${path}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof VendorError
      ? `vendor-brand-icons: ${error.message}`
      : error,
  );
  process.exitCode = 1;
});
