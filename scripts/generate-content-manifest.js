#!/usr/bin/env node
/**
 * Generate content-manifest.json
 *
 * Walks plugin and template directories, lists all files,
 * computes a SHA-256 content hash, and writes the manifest to the repo root.
 *
 * Usage:
 *   node scripts/generate-content-manifest.js              # write the manifest
 *   node scripts/generate-content-manifest.js --check      # fail on drift, write nothing
 *   node scripts/generate-content-manifest.js --self-test  # prove --check detects drift
 *
 * `--check` is the CI gate (TASK_2026_240). It exists because
 * ContentDownloadService downloads only what the manifest enumerates AND
 * pruneStaleFiles deletes local files the manifest omits — so a stale manifest
 * does not merely withhold new content, it removes content users already have.
 *
 * TASK_2025_248, TASK_2026_240
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGINS_BASE_PATH = 'apps/ptah-extension-vscode/assets/plugins';
const TEMPLATES_BASE_PATH = 'libs/backend/agent-generation/templates/agents';
const MANIFEST_PATH = path.join(REPO_ROOT, 'content-manifest.json');

/**
 * Files under the plugin tree that must never reach a user (TASK_2026_254).
 *
 * The manifest is the ONLY filter in the pipeline: ContentDownloadService
 * downloads exactly what is listed here, the mirror copies it to
 * `~/.ptah/user`, and harness-sync fans it out to every AI tool's harness dir.
 * A file that survives this list is a file every user reads. So the bar is not
 * "is it harmless" but "does a model reading it do better work".
 *
 * Each entry is `{ test, why }`. `test` receives the forward-slash path
 * relative to the plugins base. Applied to the plugin tree ONLY — the template
 * tree is walked unfiltered.
 */
const PLUGIN_DENYLIST = [
  {
    test: (p) => path.basename(p) === 'README.md',
    why: 'Human repo-browsing prose, not skill content. skill-creator/SKILL.md forbids a README inside a skill, and the four in this bundle document build systems (pnpm, src/) that never ship.',
  },
  {
    test: (p) => path.basename(p) === 'metadata.json',
    why: 'Upstream build metadata for the React rules generator (test-cases.json, pnpm build). None of that tooling is bundled, so the file describes a pipeline the user does not have.',
  },
  {
    test: (p) => /(^|\/)rules\/_[^/]+\.md$/.test(p),
    why: 'Underscore-prefixed scaffolding (_sections.md, _template.md) consumed by the upstream rules generator. Not guidance — a model reading it learns the authoring harness, not React.',
  },
  {
    test: (p) => /(^|\/)skills\/[^/]+\/AGENTS\.md$/.test(p),
    why: '98% verbatim concatenation of the sibling rules/ directory (102 KB across two skills). Ships the same corpus twice and defeats the progressive disclosure that rules/ exists to provide.',
  },
  {
    test: (p) => /(^|\/)orchestration\/examples\//.test(p),
    why: 'Orphan transcripts with zero inbound links from any SKILL.md, so nothing can ever load them; creative-trace.md additionally contains fabricated customer testimonials presented as real.',
  },
  {
    test: (p) => /(^|\/)skill-creator\/scripts\/[^/]+\.py$/.test(p),
    why: 'Python is not a dependency of any supported harness, and SKILL.md invoked these with a path that does not resolve. The manual steps are documented in SKILL.md instead. (LICENSE.txt is deliberately NOT denied — Apache-2.0 §4 requires it to travel with the derived work.)',
  },
  // The 11 Angular component assets below are unreachable: no SKILL.md,
  // reference, or selection table names them, so no model can ever open one.
  // Listed explicitly rather than by rule, because the 11 SIBLING files in the
  // same assets/ directories ARE referenced and must keep shipping.
  {
    test: (p) =>
      [
        // angular-3d-scene-crafter — absent from the scene selection table
        'ptah-angular/skills/angular-3d-scene-crafter/assets/scene-template.component.ts',
        'ptah-angular/skills/angular-3d-scene-crafter/assets/scenes/hexagonal-hero-demo.component.ts',
        'ptah-angular/skills/angular-3d-scene-crafter/assets/scenes/marble-hero-scene.component.ts',
        'ptah-angular/skills/angular-3d-scene-crafter/assets/scenes/metaball-hero-scene.component.ts',
        'ptah-angular/skills/angular-3d-scene-crafter/assets/scenes/particle-storm-hero-scene.component.ts',
        // angular-gsap-animation-crafter — absent from the pattern selection table
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/pages/gsap-showcase.component.ts',
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/angular-3d-section.component.ts',
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/angular-gsap-section.component.ts',
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/gsap-showcase-hero-section.component.ts',
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/problem-solution-section.component.ts',
        'ptah-angular/skills/angular-gsap-animation-crafter/assets/sections/value-propositions-section.component.ts',
      ].includes(p),
    why: 'Orphan Angular components in the two angular skills — grep proves zero .md files name them, while their 11 referenced siblings are cited by the selection tables and stay.',
  },
];

/** True when the plugin-relative path matches any denylist entry. */
function isDenied(relativePath) {
  return PLUGIN_DENYLIST.some((rule) => rule.test(relativePath));
}

/**
 * Recursively collect all file paths relative to baseDir.
 * Returns sorted array of forward-slash relative paths.
 *
 * `deny` is an optional predicate over the relative path. It is passed for the
 * plugin tree and omitted for the template tree.
 */
function walkDir(dir, baseDir, deny) {
  const results = [];

  if (!fs.existsSync(dir)) {
    console.warn(`Warning: Directory does not exist: ${dir}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir, deny));
    } else if (entry.isFile()) {
      // Use forward slashes for cross-platform consistency in the manifest
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      if (deny && deny(relativePath)) continue;
      results.push(relativePath);
    }
  }

  return results.sort();
}

/**
 * Build the manifest from what is on disk right now. Pure — writes nothing, so
 * both the generator and the checker read from one implementation.
 */
function buildManifest() {
  const pluginsDir = path.join(REPO_ROOT, PLUGINS_BASE_PATH);
  const templatesDir = path.join(REPO_ROOT, TEMPLATES_BASE_PATH);

  const pluginFiles = walkDir(pluginsDir, pluginsDir, isDenied);
  const templateFiles = walkDir(templatesDir, templatesDir);

  // Compute a single content hash across all files (both plugins and templates)
  const allFiles = [
    ...pluginFiles.map((f) => ({ rel: f, base: pluginsDir })),
    ...templateFiles.map((f) => ({ rel: f, base: templatesDir })),
  ];
  const hash = crypto.createHash('sha256');
  for (const { rel, base } of allFiles) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(base, rel)));
  }

  return {
    $schema: 'https://ptah.live/schemas/content-manifest.json',
    version: '1.0.0',
    contentHash: `sha256:${hash.digest('hex')}`,
    generatedAt: new Date().toISOString(),
    baseUrl:
      'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main',
    plugins: {
      basePath: PLUGINS_BASE_PATH,
      files: pluginFiles,
    },
    templates: {
      basePath: TEMPLATES_BASE_PATH,
      files: templateFiles,
    },
  };
}

/**
 * Compare a freshly built manifest against a committed one.
 *
 * Compares `contentHash` and the file lists, never `generatedAt` — the
 * generator stamps a new timestamp on every run, so a timestamp difference
 * proves nothing about content and a checker keyed on it would fail every
 * regenerated manifest while passing genuinely stale ones.
 *
 * Returns an array of human-readable problems; empty means no drift.
 */
function findDrift(actual, committed) {
  const problems = [];

  for (const section of ['plugins', 'templates']) {
    const committedFiles = new Set(committed?.[section]?.files ?? []);
    const actualFiles = new Set(actual[section].files);

    const missing = actual[section].files.filter((f) => !committedFiles.has(f));
    const stale = [...committedFiles].filter((f) => !actualFiles.has(f));

    if (missing.length > 0) {
      problems.push(
        `${section}: ${missing.length} file(s) on disk are absent from the manifest, ` +
          `so no user would ever receive them:\n` +
          missing.map((f) => `    + ${f}`).join('\n'),
      );
    }
    if (stale.length > 0) {
      problems.push(
        `${section}: ${stale.length} file(s) listed in the manifest no longer exist, ` +
          `so the download would 404:\n` +
          stale.map((f) => `    - ${f}`).join('\n'),
      );
    }
  }

  if (committed?.contentHash !== actual.contentHash) {
    problems.push(
      `contentHash mismatch — file contents changed without regeneration.\n` +
        `    committed: ${committed?.contentHash ?? '(absent)'}\n` +
        `    actual:    ${actual.contentHash}`,
    );
  }

  return problems;
}

function readCommittedManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`content-manifest.json not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch (error) {
    console.error(
      `content-manifest.json is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

function runCheck() {
  const actual = buildManifest();
  const committed = readCommittedManifest();
  const problems = findDrift(actual, committed);

  if (problems.length === 0) {
    console.log(
      `content-manifest.json is up to date (${actual.contentHash}, ` +
        `${actual.plugins.files.length + actual.templates.files.length} files).`,
    );
    return;
  }

  console.error('content-manifest.json is stale.\n');
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(
    'A stale manifest is destructive: ContentDownloadService prunes local files\n' +
      'the manifest omits, so users LOSE content they already have.\n\n' +
      'Fix: npm run manifest:generate — then commit content-manifest.json.',
  );
  process.exit(1);
}

/**
 * Prove the checker actually detects drift, so a broken checker cannot silently
 * pass forever. Mirrors the di-lint self-test gate in ci.yml.
 */
function runSelfTest() {
  const actual = buildManifest();
  const failures = [];

  const assert = (name, condition) => {
    if (condition) console.log(`  PASS  ${name}`);
    else {
      console.error(`  FAIL  ${name}`);
      failures.push(name);
    }
  };

  const identical = JSON.parse(JSON.stringify(actual));
  assert(
    'identical manifest reports no drift',
    findDrift(actual, identical).length === 0,
  );

  const restamped = { ...identical, generatedAt: '1970-01-01T00:00:00.000Z' };
  assert(
    'generatedAt difference alone reports no drift',
    findDrift(actual, restamped).length === 0,
  );

  const dropped = JSON.parse(JSON.stringify(actual));
  dropped.plugins.files = dropped.plugins.files.slice(1);
  assert(
    'file dropped from the manifest is detected',
    findDrift(actual, dropped).length > 0,
  );

  const invented = JSON.parse(JSON.stringify(actual));
  invented.plugins.files = [
    ...invented.plugins.files,
    'ptah-core/skills/ghost.md',
  ].sort();
  assert(
    'file listed but absent from disk is detected',
    findDrift(actual, invented).length > 0,
  );

  const rehashed = { ...identical, contentHash: 'sha256:0' };
  assert(
    'contentHash mismatch is detected',
    findDrift(actual, rehashed).length > 0,
  );

  if (failures.length > 0) {
    console.error(`\nSelf-test failed: ${failures.length} assertion(s).`);
    process.exit(1);
  }
  console.log('\nSelf-test passed.');
}

function runGenerate() {
  const manifest = buildManifest();

  console.log(`  Found ${manifest.plugins.files.length} plugin files`);
  console.log(`  Found ${manifest.templates.files.length} template files`);

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
  console.log(`\nManifest written to: ${MANIFEST_PATH}`);
  console.log(`  Content hash: ${manifest.contentHash}`);
  console.log(
    `  Total files: ${
      manifest.plugins.files.length + manifest.templates.files.length
    }`,
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) runSelfTest();
  else if (args.includes('--check')) runCheck();
  else runGenerate();
}

main();
