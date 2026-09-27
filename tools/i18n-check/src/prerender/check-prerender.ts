#!/usr/bin/env npx ts-node
/**
 * check-prerender — the English prerender contract of the six SSG routes
 * (3.5, plan Component 2).
 *
 *   check-prerender.ts --dist <dir> --baseline <dir> [--update]
 *                      [--workspace-root <dir>]
 *
 * For each route it parses `<dist>/<route>/index.html` with parse5 and
 * extracts the visible `<body>` text with ONE normalisation
 * (`extractVisibleText`), used both to capture a baseline and to compare
 * against it:
 *   1. walk the subtree in document order, skipping comment nodes and
 *      `script`, `style`, `template`, `[data-i18n-switcher]` and
 *      `[data-prerender-volatile]` subtrees (the last marks build-time values
 *      that are not copy, such as the live countdown, so they are never
 *      baselined); the same skip applies to the text, the h1/h2 and the
 *      key-path walks;
 *   2. take text-node values (parse5 decodes entities);
 *   3. concatenate them with no separator, across element boundaries, so a
 *      new wrapper element adds no text (`<span>$29</span>/mo` is `$29/mo`);
 *   4. collapse each run of Unicode whitespace to one space, and trim.
 *
 * Compare mode (default) asserts, per route: `<html lang="en">`,
 * `<html dir="ltr">`, no text node that is a scope-anchored key path, no empty
 * `h1`/`h2`, and `h1` and body text equal to `<baseline>/<slug>.json`
 * (`{ route, h1, text }`, read as parsed JSON, never byte-for-byte).
 *
 * `--update` captures the baselines. It runs every assertion except `dir`
 * (the attribute is not rendered before the app wiring lands) and the
 * baseline comparison, and writes nothing when any assertion fails. It is run
 * exactly once, against the unmodified templates: a later text difference is
 * fixed in the template or the `en.json` value, never in the baseline.
 *
 * `--dist` and `--baseline` resolve against `--workspace-root` (default: the
 * current directory). Exit 0 when clean or written; 1 on any violation; 2 on
 * a usage error.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { UsageError, toRel } from '../lib/cli';
import {
  formatViolation,
  normaliseViolations,
  type Violation,
  type ViolationKind,
} from '../lib/report';
import { KNOWN_SCOPES } from '../lib/scope-map';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type Document = DefaultTreeAdapterTypes.Document;

export interface PrerenderOptions {
  workspaceRoot: string;
  dist: string;
  baseline: string;
  update: boolean;
}

/** One prerendered route (`app.routes.server.ts`) and its baseline slug. */
export interface PrerenderRoute {
  slug: string;
  route: string;
  /** Output file relative to the browser dist directory. */
  file: string;
}

export const PRERENDER_ROUTES: readonly PrerenderRoute[] = [
  { slug: 'home', route: '/', file: 'index.html' },
  { slug: 'download', route: '/download', file: 'download/index.html' },
  { slug: 'pricing', route: '/pricing', file: 'pricing/index.html' },
  {
    slug: 'terms-and-conditions',
    route: '/terms-and-conditions',
    file: 'terms-and-conditions/index.html',
  },
  { slug: 'privacy', route: '/privacy', file: 'privacy/index.html' },
  { slug: 'refund', route: '/refund', file: 'refund/index.html' },
];

/** The committed per-route baseline. */
export interface PrerenderBaseline {
  route: string;
  h1: string;
  text: string;
}

/** What the normalisation extracts from one prerendered document. */
export interface PageSnapshot {
  lang: string | null;
  dir: string | null;
  /** Normalised text of the first `h1`, '' when there is none. */
  h1: string;
  text: string;
  /** Every `h1`/`h2` whose normalised text is empty, in document order. */
  emptyHeadings: string[];
  /** Normalised text nodes that are a scope-anchored translation key path. */
  keyPaths: string[];
}

const USAGE =
  'usage: check-prerender.ts --dist <dir> --baseline <dir> [--update] [--workspace-root <dir>]';

const VALUE_FLAGS = ['--dist', '--baseline', '--workspace-root'];

const SKIPPED_TAGS = new Set(['script', 'style', 'template']);

/**
 * Subtrees excluded from every walk: the language switcher (its labels are
 * the same in both languages) and volatile build-time output that is not copy
 * (for example the countdown, whose value depends on the build time).
 */
const SKIPPED_ATTRS: readonly string[] = [
  'data-i18n-switcher',
  'data-prerender-volatile',
];

/**
 * A text node that is nothing but a key path of a known scope (the 3.5
 * regex). Anchored on scope names because `ptah.live` is real copy.
 */
export const KEY_PATH_RE = new RegExp(
  `^(${KNOWN_SCOPES.join('|')})\\.[\\w-]+(\\.[\\w-]+)*$`,
);

/** Collapse every run of Unicode whitespace to one space, and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function isTextNode(node: Node): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function isSkipped(element: Element): boolean {
  return (
    SKIPPED_TAGS.has(element.tagName) ||
    element.attrs.some((attr) => SKIPPED_ATTRS.includes(attr.name))
  );
}

function childrenOf(node: Node): readonly Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}

/**
 * Raw text-node values under `root`, in document order, skipping comments
 * and `script`/`style`/`template`/`[data-i18n-switcher]`/
 * `[data-prerender-volatile]` subtrees. Comment nodes carry no text value, so
 * they fall out of the walk.
 */
function visibleTextNodes(root: Node): string[] {
  const values: string[] = [];
  const walk = (node: Node): void => {
    if (isTextNode(node)) {
      values.push(node.value);
      return;
    }
    if (isElement(node) && isSkipped(node)) return;
    for (const child of childrenOf(node)) walk(child);
  };
  walk(root);
  return values;
}

/**
 * THE normalisation: shared by baseline capture and every comparison, for
 * the page text and for headings alike.
 */
export function extractVisibleText(root: Node): string {
  return collapseWhitespace(visibleTextNodes(root).join(''));
}

function findAll(root: Node, match: (el: Element) => boolean): Element[] {
  const found: Element[] = [];
  const walk = (node: Node): void => {
    if (isElement(node)) {
      if (isSkipped(node)) return;
      if (match(node)) found.push(node);
    }
    for (const child of childrenOf(node)) walk(child);
  };
  walk(root);
  return found;
}

function attrOf(element: Element | undefined, name: string): string | null {
  return element?.attrs.find((attr) => attr.name === name)?.value ?? null;
}

/** Parses one prerendered document and extracts everything the check needs. */
export function snapshotPage(html: string): PageSnapshot {
  const document: Document = parse(html);
  const htmlEl = document.childNodes.find(
    (node): node is Element => isElement(node) && node.tagName === 'html',
  );
  // parse5 always synthesises <html> and <body>.
  const body = htmlEl?.childNodes.find(
    (node): node is Element => isElement(node) && node.tagName === 'body',
  );
  const root: Node = body ?? document;
  const headings = findAll(
    root,
    (el) => el.tagName === 'h1' || el.tagName === 'h2',
  );
  const firstH1 = headings.find((el) => el.tagName === 'h1');
  return {
    lang: attrOf(htmlEl, 'lang'),
    dir: attrOf(htmlEl, 'dir'),
    h1: firstH1 ? extractVisibleText(firstH1) : '',
    text: extractVisibleText(root),
    emptyHeadings: headings
      .filter((el) => extractVisibleText(el) === '')
      .map((el) => el.tagName),
    keyPaths: visibleTextNodes(root)
      .map(collapseWhitespace)
      .filter((value) => KEY_PATH_RE.test(value)),
  };
}

/**
 * The assertions every snapshot must meet. `dir` is asserted in compare mode
 * only: a capture of the pre-i18n build has no `dir` attribute yet.
 */
export function assertPage(
  snapshot: PageSnapshot,
  file: string,
  mode: 'capture' | 'compare',
): Violation[] {
  const violations: Violation[] = [];
  const add = (kind: ViolationKind, detail: string, key = ''): void => {
    violations.push({ file, line: 0, kind, key, detail });
  };
  if (snapshot.lang !== 'en') {
    add(
      'prerender-lang',
      `<html lang> is ${quoteAttr(snapshot.lang)}, expected "en"`,
    );
  }
  if (mode === 'compare' && snapshot.dir !== 'ltr') {
    add(
      'prerender-dir',
      `<html dir> is ${quoteAttr(snapshot.dir)}, expected "ltr"`,
    );
  }
  for (const keyPath of snapshot.keyPaths) {
    add(
      'prerender-key-path',
      'a translation key path is rendered as text',
      keyPath,
    );
  }
  for (const tag of snapshot.emptyHeadings) {
    add('prerender-empty-heading', `an empty <${tag}> is rendered`);
  }
  return violations;
}

function quoteAttr(value: string | null): string {
  return value === null ? 'missing' : `"${value}"`;
}

/** A readable excerpt around the first difference of two strings. */
export function describeDifference(expected: string, actual: string): string {
  let at = 0;
  while (
    at < expected.length &&
    at < actual.length &&
    expected[at] === actual[at]
  ) {
    at += 1;
  }
  const excerpt = (value: string): string =>
    JSON.stringify(value.slice(Math.max(0, at - 40), at + 40));
  return `first difference at character ${at}: baseline ${excerpt(expected)}, prerender ${excerpt(actual)}`;
}

/** Reads a baseline as parsed JSON and validates its shape. */
export function readBaseline(
  absPath: string,
  file: string,
  route: string,
): { baseline: PrerenderBaseline } | { violation: Violation } {
  const fail = (kind: ViolationKind, detail: string) => ({
    violation: { file, line: 0, kind, key: '', detail },
  });
  if (!fs.existsSync(absPath)) {
    return fail(
      'missing-file',
      'baseline missing; baselines are captured once and never regenerated',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error: unknown) {
    return fail(
      'parse-error',
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['route'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['h1'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['text'] !== 'string'
  ) {
    return fail(
      'invalid-value',
      'baseline must be { "route": string, "h1": string, "text": string }',
    );
  }
  const baseline = parsed as PrerenderBaseline;
  if (baseline.route !== route) {
    return fail(
      'invalid-value',
      `baseline route is "${baseline.route}", expected "${route}"`,
    );
  }
  return { baseline };
}

/** Compares a snapshot with its baseline. */
export function compareWithBaseline(
  snapshot: PageSnapshot,
  baseline: PrerenderBaseline,
  file: string,
): Violation[] {
  const violations: Violation[] = [];
  if (snapshot.h1 !== baseline.h1) {
    violations.push({
      file,
      line: 0,
      kind: 'prerender-drift',
      key: 'h1',
      detail: describeDifference(baseline.h1, snapshot.h1),
    });
  }
  if (snapshot.text !== baseline.text) {
    violations.push({
      file,
      line: 0,
      kind: 'prerender-drift',
      key: 'text',
      detail: describeDifference(baseline.text, snapshot.text),
    });
  }
  return violations;
}

/** Baseline file content: two-space JSON plus a final newline (Prettier-clean). */
export function serialiseBaseline(baseline: PrerenderBaseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export function parseArgs(argv: readonly string[]): PrerenderOptions {
  const values = new Map<string, string>();
  let update = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--update') {
      update = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new UsageError(`unknown argument "${flag}"`);
    }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      throw new UsageError(`${flag} needs a value`);
    }
    values.set(flag, argv[i + 1]);
    i += 1;
  }
  const dist = values.get('--dist');
  const baseline = values.get('--baseline');
  if (!dist || !baseline) {
    throw new UsageError('--dist and --baseline are required');
  }
  return {
    workspaceRoot: path.resolve(
      values.get('--workspace-root') ?? process.cwd(),
    ),
    dist,
    baseline,
    update,
  };
}

/** Runs the check (or the capture) over the six routes. */
export function checkPrerender(options: PrerenderOptions): {
  code: number;
  lines: string[];
} {
  const distDir = path.resolve(options.workspaceRoot, options.dist);
  const baselineDir = path.resolve(options.workspaceRoot, options.baseline);
  const mode = options.update ? 'capture' : 'compare';
  const violations: Violation[] = [];
  const captured: { absPath: string; baseline: PrerenderBaseline }[] = [];

  for (const route of PRERENDER_ROUTES) {
    const htmlAbs = path.join(distDir, route.file);
    const htmlRel = toRel(options.workspaceRoot, htmlAbs);
    if (!fs.existsSync(htmlAbs)) {
      violations.push({
        file: htmlRel,
        line: 0,
        kind: 'missing-file',
        key: '',
        detail: `prerendered ${route.route} missing; build ptah-landing-page first`,
      });
      continue;
    }
    const snapshot = snapshotPage(fs.readFileSync(htmlAbs, 'utf8'));
    violations.push(...assertPage(snapshot, htmlRel, mode));

    const baselineAbs = path.join(baselineDir, `${route.slug}.json`);
    if (options.update) {
      captured.push({
        absPath: baselineAbs,
        baseline: { route: route.route, h1: snapshot.h1, text: snapshot.text },
      });
      continue;
    }
    const read = readBaseline(
      baselineAbs,
      toRel(options.workspaceRoot, baselineAbs),
      route.route,
    );
    if ('violation' in read) {
      violations.push(read.violation);
      continue;
    }
    violations.push(...compareWithBaseline(snapshot, read.baseline, htmlRel));
  }

  if (violations.length > 0) {
    const sorted = normaliseViolations(violations);
    return {
      code: 1,
      lines: [
        ...sorted.map(formatViolation),
        `check-prerender (${mode}): ${sorted.length} violation(s)${options.update ? '; no baseline written' : ''}`,
      ],
    };
  }
  if (!options.update) {
    return {
      code: 0,
      lines: [
        `check-prerender: ${PRERENDER_ROUTES.length} routes match their baselines`,
      ],
    };
  }
  fs.mkdirSync(baselineDir, { recursive: true });
  for (const { absPath, baseline } of captured) {
    fs.writeFileSync(absPath, serialiseBaseline(baseline), 'utf8');
  }
  return {
    code: 0,
    lines: captured.map(
      ({ absPath }) => `wrote ${toRel(options.workspaceRoot, absPath)}`,
    ),
  };
}

function main(): number {
  let options: PrerenderOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      console.error(`check-prerender: ${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  const { code, lines } = checkPrerender(options);
  for (const line of lines) console.log(line);
  return code;
}

// Imported by the spec; executed as the CLI entry point.
if (require.main === module) {
  try {
    process.exit(main());
  } catch (error: unknown) {
    console.error('check-prerender: internal error', error);
    process.exit(2);
  }
}
