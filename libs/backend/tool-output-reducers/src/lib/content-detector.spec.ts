import { detectContentKind } from './content-detector';
import type { ContentKind } from './reducer.types';

const FIXTURES: Record<Exclude<ContentKind, 'preformatted'>, string> = {
  json: JSON.stringify(
    { name: 'ptah', tools: [{ id: 1 }, { id: 2 }], ok: true },
    null,
    2,
  ),
  html: [
    '<!DOCTYPE html>',
    '<html><head><title>Docs</title></head>',
    '<body><main><article><p>Body text</p></article></main></body>',
    '</html>',
  ].join('\n'),
  markdown: [
    'Intro paragraph before the headings.',
    '',
    '## Install',
    'Run the installer.',
    '',
    '## Usage',
    'Call the tool.',
  ].join('\n'),
  code: [
    "import { join } from 'node:path';",
    '',
    'export interface Options {',
    '  root: string;',
    '}',
    '',
    'export function resolve(options: Options): string {',
    "  return join(options.root, 'src');",
    '}',
  ].join('\n'),
  log: [
    'PASS src/a.spec.ts',
    'FAIL src/b.spec.ts',
    '  ● resolves the root',
    '    at Object.<anonymous> (src/b.spec.ts:12:5)',
    'Tests: 1 failed, 1 passed',
  ].join('\n'),
  text: [
    'The workspace has three projects.',
    'Each project builds on its own.',
    'Nothing else to report.',
  ].join('\n'),
};

describe('detectContentKind', () => {
  it.each(Object.entries(FIXTURES))('detects %s', (kind, text) => {
    expect(detectContentKind(text)).toBe(kind);
  });

  it('lets the hint win over sniffing', () => {
    expect(detectContentKind(FIXTURES.json, 'preformatted')).toBe(
      'preformatted',
    );
    expect(detectContentKind(FIXTURES.log, 'code')).toBe('code');
    expect(detectContentKind('', 'markdown')).toBe('markdown');
  });

  it('resolves an empty or whitespace-only string to text', () => {
    expect(detectContentKind('')).toBe('text');
    expect(detectContentKind(' \n\t\n')).toBe('text');
  });

  it('resolves a JSON document that carries Markdown to json', () => {
    const json = JSON.stringify({
      readme: '# Title\n\n## Section\n\nBody',
      notes: ['## a', '## b'],
    });
    expect(detectContentKind(json)).toBe('json');
  });

  it('resolves a JSON scalar to text: nothing to compact, the text path cuts and spools', () => {
    expect(detectContentKind('42')).toBe('text');
    expect(detectContentKind('"quoted"')).toBe('text');
    expect(detectContentKind('null')).toBe('text');
    expect(detectContentKind('true')).toBe('text');
    const longString = JSON.stringify('x'.repeat(8_001));
    expect(longString.length).toBeGreaterThan(8_000);
    expect(detectContentKind(longString)).toBe('text');
  });

  it('falls through when bracketed text is not valid JSON', () => {
    expect(detectContentKind('{ not: json }')).toBe('text');
  });

  it('ignores a leading byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(detectContentKind(bom + FIXTURES.json)).toBe('json');
  });

  it('detects tag-dense HTML without a doctype', () => {
    const fragment =
      '<div class="a"><ul><li>one</li><li>two</li></ul><p>text</p></div>';
    expect(detectContentKind(fragment)).toBe('html');
  });

  it('detects a log by repeated lines alone', () => {
    const log = ['polling queue', 'polling queue', 'queue drained'].join('\n');
    expect(detectContentKind(log)).toBe('log');
  });

  it('detects a log by timestamp prefixes alone', () => {
    const log = [
      '2026-09-25T10:00:01 worker started',
      '2026-09-25T10:00:02 job 1 picked up',
      '2026-09-25T10:00:03 job 1 done',
    ].join('\n');
    expect(detectContentKind(log)).toBe('log');
  });

  it.each([
    'The failed experiment informed our design.\nWe recommend keeping the detailed analysis.',
    'At least one reviewer failed to respond.\nThe error in judgement was ours.',
    'An exception was made for the release.\nWe failed twice before succeeding.',
  ])('resolves prose that mentions errors to text: %j', (prose) => {
    expect(detectContentKind(prose)).toBe('text');
  });

  it.each([
    'TypeError: Cannot read properties of undefined\n    at resolve (src/a.ts:10:3)',
    "src/a.ts(3,5): error TS2345: Argument of type 'string' is not assignable.\nFound 1 error.",
    'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\nValueError: bad',
  ])('detects a log by a line-anchored error marker: %j', (log) => {
    expect(detectContentKind(log)).toBe('log');
  });

  it.each([
    '# Calculate totals\nimport math\ndef total(values):\n    return sum(values)',
    '# Calculate totals\nimport math\n# Helper\ndef total(values):\n    return sum(values)',
  ])('treats # lines in source as comments, not headings: %j', (source) => {
    expect(detectContentKind(source)).toBe('code');
  });

  it('does not treat a script with a shebang as markdown', () => {
    const script = '#!/usr/bin/env bash\n# Build\nnpm ci\n# Test\nnpm test';
    expect(detectContentKind(script)).not.toBe('markdown');
  });

  it.each([
    "# Title\n\nIntro text.\n\n```ts\nimport a from 'a';\nexport const b = 1;\nexport function c() {}\n```",
    '# Guide\n\nRead this first.\n\n## Setup\n\nInstall it.',
  ])('keeps headings over prose and fenced code as markdown: %j', (doc) => {
    expect(detectContentKind(doc)).toBe('markdown');
  });

  it.each([
    'FAILED attempts are retried automatically.\nThe queue drains within a minute.',
    'FAIL fast is the principle we follow.\nIt keeps defects cheap.',
  ])('resolves prose that starts with an uppercase verdict to text: %j', (prose) => {
    expect(detectContentKind(prose)).toBe('text');
  });

  it.each([
    'FAIL src/app.spec.ts\n  works',
    'FAILED tests/test_api.py::test_login - AssertionError\nshort test summary info',
    'ERROR in ./src/main.ts\nModule not found',
    'FATAL: connection refused\nretrying later',
    'FAILED\nsee the summary above',
  ])('detects an uppercase verdict followed by a log shape: %j', (log) => {
    expect(detectContentKind(log)).toBe('log');
  });

  it.each([
    '# Guide\n\n````md\n```ts\nimport a from "a";\nexport const b = 1;\nexport function c() {}\n```\n````\n\nDone.',
    '# Notes\n\n~~~\n```\nimport x from "x";\nexport const y = 1;\nexport function z() {}\n```\n~~~\n\nEnd.',
  ])('keeps a longer or different fence open across an inner triple-backtick fence: %j', (doc) => {
    expect(detectContentKind(doc)).toBe('markdown');
  });

  it.each([
    'ERROR budgets are reviewed every quarter.\nNothing else changed this time.',
    'FATAL flaws were found in the first draft.\nThe second draft fixed them.',
  ])('resolves prose that opens with a bare level word to text: %j', (prose) => {
    expect(detectContentKind(prose)).toBe('text');
  });

  it.each([
    '[INFO] Build started\n[WARN] Cache miss',
    'INFO: server listening\nDEBUG: request received',
    'ERROR [main] boot failed\nINFO - retrying',
  ])('counts a level word with a log shape toward the prefix ratio: %j', (log) => {
    expect(detectContentKind(log)).toBe('log');
  });

  it('detects a long fence run in linear time', () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const crafted = `# Guide\n${'`'.repeat(65_520)}${lineSeparator}x`;
    const started = performance.now();
    detectContentKind(crafted);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('is deterministic for the same input', () => {
    for (const text of Object.values(FIXTURES)) {
      expect(detectContentKind(text)).toBe(detectContentKind(text));
    }
  });
});
