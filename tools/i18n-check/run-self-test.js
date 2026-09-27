#!/usr/bin/env node
/**
 * i18n-check self-test: runs `src/main.ts` against the planted fixture tree
 * in `__fixtures__/project/` (a data-only miniature workspace).
 *
 * A run passes only if the checker exits 1, the output names every planted
 * violation, names none of the must-pass sites, and prints no violation that
 * was not planted (degradation-audit discipline, plan Component 2).
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Absolute ts-node entry point, spawned through `process.execPath`: no shell
// and no PATH lookup (same reasoning as tools/degradation-audit/run-self-test.js).
const tsNodeBin = require.resolve('ts-node/dist/bin.js');
const tsconfig = path.join(__dirname, 'tsconfig.json');
const main = path.join(__dirname, 'src', 'main.ts');
const fixtureRoot = path.join(__dirname, '__fixtures__', 'project');

const PRICING_TS = 'libs/web/pricing/src/lib/pricing-page.component.ts';
const PRICING_HTML = 'libs/web/pricing/src/lib/pricing-card.component.html';

const RUNS = [
  {
    name: 'pricing (F2a plants)',
    args: ['--project-root', 'libs/web/pricing', '--scope', 'pricing'],
    expected: [
      {
        kind: 'missing-in-ar',
        file: 'libs/web/pricing/src/lib/i18n/en.json',
        key: 'pricing.page.onlyEnglish',
      },
      { kind: 'unknown-key', file: PRICING_TS, key: 'pricing.page.missing' },
      { kind: 'unknown-key', file: PRICING_TS, key: 'pricing.page.ghost' },
      { kind: 'foreign-scope', file: PRICING_TS, key: 'landing.hero.title' },
      { kind: 'unannotated-computed-key', file: PRICING_TS, key: 'dynamicKey' },
      {
        kind: 'unannotated-computed-key',
        file: PRICING_TS,
        key: 'this.dynamicKey',
      },
      {
        kind: 'parse-error',
        file: 'libs/web/pricing/src/lib/broken.component.html',
        key: '',
      },
      // translateObjectSignal needs a group (review round 1, Serious-1).
      { kind: 'not-a-group', file: PRICING_TS, key: 'pricing.card.heading' },
      { kind: 'not-a-group', file: PRICING_TS, key: 'pricing.card.note' },
      // A marker covers its next sibling only (review round 1, Serious-2).
      {
        kind: 'unannotated-computed-key',
        file: PRICING_TS,
        key: 'this.detachedMessage.key',
      },
      {
        kind: 'unknown-key',
        file: PRICING_TS,
        key: 'pricing.detached.sample.path',
      },
      {
        kind: 'unannotated-computed-key',
        file: PRICING_HTML,
        key: 'detachedHtmlNotice.key',
      },
      {
        kind: 'unknown-key',
        file: PRICING_HTML,
        key: 'pricing.detached.html.path',
      },
    ],
    mustPass: [
      'core.checkout',
      'ui.nav.home',
      'statusI18nKeys',
      'STATUS_I18N_KEYS',
      'pricing.status.',
      'message.key',
      'ptah.live',
      'pricing.page.title',
      'pricing.page.subtitle',
      'pricing.page.brand',
      'pricing.not.a.key',
      // Group-name constant read by translateObjectSignal.
      'SECTION_I18N_KEYS',
      ' pricing.card - ',
      ' pricing.status - ',
      // Wrapped elements whose marker sits 2+ lines above the covered site.
      'checkoutMessage',
      'checkoutNotice',
      'pricing.doc.sample.path',
      'pricing.sample.key.path',
    ],
  },
  {
    name: 'legal (sole-default-key, no-source-files)',
    args: ['--project-root', 'libs/web/legal', '--scope', 'legal'],
    expected: [
      {
        kind: 'sole-default-key',
        file: 'libs/web/legal/src/lib/i18n/en.json',
        key: 'legal.default',
      },
      {
        kind: 'sole-default-key',
        file: 'libs/web/legal/src/lib/i18n/ar.json',
        key: 'legal.default',
      },
      // The legal fixture has no source files: nothing checked is a failure.
      { kind: 'no-source-files', file: 'libs/web/legal/src', key: '' },
    ],
    mustPass: [],
  },
];

// `file:line: [kind] key - detail` (see src/lib/report.ts formatViolation).
const VIOLATION_RE = /^(\S+):(\d+): \[([a-z-]+)\](?: (?!- )(\S+))?/;

function runOne(run) {
  const result = spawnSync(
    process.execPath,
    [
      tsNodeBin,
      '--transpile-only',
      '--project',
      tsconfig,
      main,
      '--workspace-root',
      fixtureRoot,
      '--glossary',
      'glossary.json',
      ...run.args,
    ],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stderr.write(output);

  const failures = [];
  if (result.status !== 1) {
    failures.push(`expected exit code 1, got ${result.status}`);
  }

  const violations = output
    .split(/\r?\n/)
    .map((line) => VIOLATION_RE.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({
      line: match[0],
      file: match[1],
      kind: match[3],
      key: match[4] || '',
    }));

  const matches = (v, e) =>
    v.kind === e.kind && v.file === e.file && v.key === e.key;

  for (const e of run.expected) {
    if (!violations.some((v) => matches(v, e))) {
      failures.push(
        `planted violation not reported: [${e.kind}] ${e.file} ${e.key}`,
      );
    }
  }
  for (const v of violations) {
    if (!run.expected.some((e) => matches(v, e))) {
      failures.push(`unplanted violation reported: ${v.line}`);
    }
    const leaked = run.mustPass.find((token) => v.line.includes(token));
    if (leaked) {
      failures.push(`must-pass site "${leaked}" reported: ${v.line}`);
    }
  }
  return failures;
}

let failed = false;
for (const run of RUNS) {
  const failures = runOne(run);
  if (failures.length === 0) {
    console.error(
      `i18n-check self-test PASS [${run.name}]: every planted violation reported, exit code 1`,
    );
    continue;
  }
  failed = true;
  console.error(`i18n-check self-test FAIL [${run.name}]:`);
  for (const f of failures) console.error(`  ${f}`);
}

process.exit(failed ? 1 : 0);
