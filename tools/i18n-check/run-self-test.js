#!/usr/bin/env node
/**
 * i18n-check self-test: runs `src/main.ts` against the planted fixture tree
 * in `__fixtures__/project/` (a data-only miniature workspace).
 *
 * A run passes only if the checker exits 1, the output names every planted
 * violation, names none of the must-pass sites, and prints no violation that
 * was not planted (degradation-audit discipline, plan Component 2).
 *
 * It then runs `src/review/review-tables.ts --check` against the committed
 * fixture tables in `__fixtures__/project/copy-review/`, which must be up to
 * date (exit 0). Regenerate them with the same command without `--check`.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Absolute ts-node entry point, spawned through `process.execPath`: no shell
// and no PATH lookup (same reasoning as tools/degradation-audit/run-self-test.js).
const tsNodeBin = require.resolve('ts-node/dist/bin.js');
const tsconfig = path.join(__dirname, 'tsconfig.json');
const main = path.join(__dirname, 'src', 'main.ts');
const reviewTables = path.join(__dirname, 'src', 'review', 'review-tables.ts');
const fixtureRoot = path.join(__dirname, '__fixtures__', 'project');

const PRICING_TS = 'libs/web/pricing/src/lib/pricing-page.component.ts';
const PRICING_HTML = 'libs/web/pricing/src/lib/pricing-card.component.html';
const RTL_TS = 'libs/web/pricing/src/lib/rtl-format.component.ts';
const RTL_HTML = 'libs/web/pricing/src/lib/rtl-format.component.html';
const RTL_CSS = 'libs/web/pricing/src/lib/rtl-format.component.css';

const RUNS = [
  {
    name: 'pricing (F2a and F2b plants)',
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
      // An allowed scope's own structural defect gets one pointer line.
      {
        kind: 'allowed-scope-defect',
        file: 'libs/web/core/src/lib/i18n/en.json',
        key: '',
      },
      // F2b: RTL patterns (4.1) and locale formatting (5.1).
      { kind: 'rtl-physical', file: RTL_HTML, key: 'ml-4' },
      { kind: 'locale-format-pipe', file: RTL_HTML, key: 'date' },
      { kind: 'rtl-variant-in-island', file: RTL_HTML, key: 'rtl:rotate-180' },
      { kind: 'rtl-physical', file: RTL_TS, key: 'margin-left' },
      { kind: 'rtl-physical', file: RTL_TS, key: 'left' },
      {
        kind: 'locale-format-call',
        file: RTL_TS,
        key: 'toLocaleDateString',
      },
      {
        kind: 'intl-without-locale',
        file: RTL_TS,
        key: 'Intl.RelativeTimeFormat',
      },
      { kind: 'rtl-physical', file: RTL_CSS, key: 'margin-left' },
      // Review round 1: rtl: pairing only for translate-x / gradient /
      // origin, four-value shorthands, and markers that attach to nothing.
      { kind: 'rtl-physical', file: RTL_HTML, key: 'ml-6' },
      { kind: 'rtl-physical', file: RTL_CSS, key: 'padding' },
      { kind: 'detached-marker', file: RTL_TS, key: '' },
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
      // F2b: island physical utilities, centring pairs, exempt sites, the
      // `number | Date` union and an intlLocale() formatter. Every other
      // leak is caught as an unplanted violation.
      'left-0',
      'left-1/2',
      'translate-x-1/2',
      'pr-6',
      'ml-1',
      '] currency',
      'paddingRight',
      'Intl.DateTimeFormat',
      'Moment',
      'translate-x-1',
      'rtl:mr-8',
      '] margin -',
      '] inset',
    ],
  },
  {
    name: 'legal (sole-default-key, no-source-files, allowed-scope-defect)',
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
      // Legal reads `core` too, so it gets the same pointer line.
      {
        kind: 'allowed-scope-defect',
        file: 'libs/web/core/src/lib/i18n/en.json',
        key: '',
      },
    ],
    mustPass: [],
  },
];

// `file:line: [kind] key - detail` (see src/lib/report.ts formatViolation).
const VIOLATION_RE = /^(\S+):(\d+): \[([a-z-]+)\](?: (?!- )(\S+))?/;

/** Runs a tool entry point against the fixture tree; echoes its output. */
function runTool(entry, args) {
  const result = spawnSync(
    process.execPath,
    [
      tsNodeBin,
      '--transpile-only',
      '--project',
      tsconfig,
      entry,
      '--workspace-root',
      fixtureRoot,
      '--glossary',
      'glossary.json',
      ...args,
    ],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stderr.write(output);
  return { status: result.status, output };
}

function runOne(run) {
  const result = runTool(main, run.args);
  const output = result.output;

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

/** The committed fixture review tables match a fresh generation. */
function runReviewTablesCheck() {
  const result = runTool(reviewTables, [
    '--project-root',
    'libs/web/pricing',
    '--scope',
    'pricing',
    '--out',
    'copy-review',
    '--check',
  ]);
  const failures = [];
  if (result.status !== 0) {
    failures.push(`expected exit code 0, got ${result.status}`);
  }
  if (!/^review-tables \[pricing\]: OK /m.test(result.output)) {
    failures.push('no OK line in the review-tables --check output');
  }
  return failures;
}

let failed = false;
const reviewFailures = runReviewTablesCheck();
if (reviewFailures.length === 0) {
  console.error(
    'i18n-check self-test PASS [review-tables --check]: committed fixture tables are up to date',
  );
} else {
  failed = true;
  console.error('i18n-check self-test FAIL [review-tables --check]:');
  for (const f of reviewFailures) console.error(`  ${f}`);
}
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
