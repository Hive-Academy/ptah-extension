/**
 * Pierre hunk mapping against REAL git output (TASK_2026_576 Requirement 3.3,
 * implementation-plan Component 17, assumption A1).
 *
 * Each case builds a throwaway repository under the OS temp directory, takes
 * `git diff` with the backend's own flags, and hands the exact bytes to the
 * pinned `@pierre/diffs` 1.5.1. Pierre is ESM-only and this project's Jest
 * transform does not cover it, so it runs in a child Node process (its parser
 * and `DiffHunksRenderer` are DOM-free); the child returns Pierre's parsed
 * hunks, the slot names Pierre itself computes, and every `<slot name>` in the
 * HAST it renders. The assertions then run the production mapping
 * (`pierre-hunk-mapping.ts`) over that data:
 *
 * - Pierre hunk `i` is git hunk `i`, with equal starts and counts;
 * - exactly one toolbar slot per hunk, each rendered exactly once — including
 *   a hunk at line 1 and hunks separated by a single unchanged line;
 * - under `hunkSeparators: 'line-info'` no separator `<slot>` exists, so every
 *   hunk resolves to its annotation slot (A1, `createSeparator.ts`);
 * - CR bytes survive Pierre's parse untouched.
 *
 * Source-under-test: libs/frontend/git-ui/src/lib/renderer/pierre-hunk-mapping.ts
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitHunkRef } from '@ptah-extension/shared';
import {
  hunkAnchor,
  resolveHunkHosts,
  verifyHunkMapping,
  type PierreHunkPosition,
} from './pierre-hunk-mapping';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../../..');
const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
/** The backend's flags (`git-info.service.ts` DIFF_FLAGS). */
const DIFF_FLAGS = [
  '-U3',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];
/** Same header grammar as `git-info.service.ts` HUNK_HEADER_RE. */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Child-process probe. Reads `{ patch, annotations, diffStyle }` on stdin and
 * prints one marked JSON line, so anything Pierre logs cannot corrupt it.
 */
const PROBE = `
import { readFileSync } from 'node:fs';
import {
  DiffHunksRenderer,
  getHunkSeparatorSlotName,
  getLineAnnotationName,
  parsePatchFiles,
} from '@pierre/diffs';

const { patch, annotations, diffStyle } = JSON.parse(readFileSync(0, 'utf8'));
const files = parsePatchFiles(patch, undefined, true).flatMap((p) => p.files);
const file = files[0];
const renderer = new DiffHunksRenderer({
  diffStyle,
  hunkSeparators: 'line-info',
  lineDiffType: 'word',
  expandUnchanged: false,
  preferredHighlighter: 'shiki-js',
});
renderer.setLineAnnotations(annotations);
const result = await renderer.asyncRender(file);
const slots = [];
const walk = (node) => {
  if (node == null) return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (node.tagName === 'slot') slots.push(String(node.properties.name));
  (node.children ?? []).forEach(walk);
};
walk(result.unifiedContentAST);
walk(result.additionsContentAST);
walk(result.deletionsContentAST);
const types = diffStyle === 'unified' ? ['unified'] : ['additions', 'deletions'];
process.stdout.write('PIERRE_PROBE ' + JSON.stringify({
  fileCount: files.length,
  hunks: file.hunks.map((h) => ({
    additionStart: h.additionStart,
    additionCount: h.additionCount,
    deletionStart: h.deletionStart,
    deletionCount: h.deletionCount,
    collapsedBefore: h.collapsedBefore,
  })),
  parsedLines: [...file.deletionLines, ...file.additionLines],
  annotationSlots: annotations.map((a) => getLineAnnotationName(a)),
  separatorSlots: file.hunks.map((_, i) => types.map((t) => getHunkSeparatorSlotName(t, i))),
  renderedSlots: slots,
  hunkData: result.hunkData.map((d) => ({ slotName: d.slotName, hunkIndex: d.hunkIndex })),
}) + '\\n');
`;

interface ProbeResult {
  fileCount: number;
  hunks: (PierreHunkPosition & { collapsedBefore: number })[];
  parsedLines: string[];
  annotationSlots: string[];
  separatorSlots: string[][];
  renderedSlots: string[];
  hunkData: { slotName: string; hunkIndex: number }[];
}

function probe(
  patch: string,
  refs: readonly GitHunkRef[],
  diffStyle: 'unified' | 'split',
): ProbeResult {
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', PROBE],
    {
      cwd: WORKSPACE_ROOT,
      input: JSON.stringify({
        patch,
        annotations: refs.map((ref) => hunkAnchor(ref)),
        diffStyle,
      }),
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const line = stdout.split('\n').find((l) => l.startsWith('PIERRE_PROBE '));
  if (!line) throw new Error(`probe produced no result:\n${stdout}`);
  return JSON.parse(line.slice('PIERRE_PROBE '.length)) as ProbeResult;
}

/** Mirror of the backend's `parseHunkRefs` (git-info.service.ts). */
function parseHunkRefs(patch: string): GitHunkRef[] {
  const normalized = patch.endsWith('\n') ? patch : `${patch}\n`;
  const segments = normalized.match(/[^\n]*\n/g) ?? [];
  const headers = segments.filter((s) => HUNK_HEADER_RE.test(s));
  return headers.map((segment, index) => {
    const header = segment.slice(0, segment.indexOf('\n'));
    const match = HUNK_HEADER_RE.exec(header) as RegExpExecArray;
    return {
      index,
      originalStart: Number(match[1]),
      originalLines: match[2] === undefined ? 1 : Number(match[2]),
      modifiedStart: Number(match[3]),
      modifiedLines: match[4] === undefined ? 1 : Number(match[4]),
      header,
    };
  });
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const createdDirs: string[] = [];

function repo(autocrlf: 'false' | 'true' = 'false'): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-pierre-map-')),
  );
  createdDirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'pierre-map@ptah.test');
  git(dir, 'config', 'user.name', 'pierre-map');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', autocrlf);
  return dir;
}

function commitAll(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
}

const lines = (n: number, prefix = 'line'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

afterAll(() => {
  for (const dir of createdDirs)
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The full set of Requirement 3.3 assertions for one real patch. */
function expectOneToOne(
  patch: string,
  diffStyle: 'unified' | 'split' = 'unified',
): { refs: GitHunkRef[]; result: ProbeResult } {
  const refs = parseHunkRefs(patch);
  expect(refs.length).toBeGreaterThan(0);
  const result = probe(patch, refs, diffStyle);

  expect(result.fileCount).toBe(1);
  expect(verifyHunkMapping(result.hunks, refs)).toBeNull();

  // A1: no separator carries a <slot> under 'line-info'.
  expect(
    result.renderedSlots.filter((s) => s.startsWith('hunk-separator-')),
  ).toEqual([]);

  const rendered = new Set(result.renderedSlots);
  const resolved = resolveHunkHosts(
    refs.length,
    (i) => result.separatorSlots[i],
    (i) => result.annotationSlots[i],
    rendered,
  );
  expect(resolved.error).toBeNull();
  expect(resolved.hosts.map((h) => h.index)).toEqual(refs.map((r) => r.index));
  for (const host of resolved.hosts) {
    expect(host.slotName).toBe(result.annotationSlots[host.index]);
    expect(
      result.renderedSlots.filter((s) => s === host.slotName),
    ).toHaveLength(1);
  }
  return { refs, result };
}

describe('Pierre hunk mapping against real git diff output', () => {
  it('maps a multi-hunk file one-to-one, including a hunk at line 1', () => {
    const dir = repo();
    const base = lines(80);
    fs.writeFileSync(path.join(dir, 'multi.txt'), base.join('\n') + '\n');
    commitAll(dir);
    const next = [...base];
    next[0] = 'line 1 changed';
    next.splice(30, 1);
    next.splice(55, 0, 'inserted A', 'inserted B');
    next[78] = 'line 79 changed';
    fs.writeFileSync(path.join(dir, 'multi.txt'), next.join('\n') + '\n');

    const patch = git(dir, 'diff', ...DIFF_FLAGS, '--', 'multi.txt');
    const { refs, result } = expectOneToOne(patch);
    expect(refs[0].originalStart).toBe(1);
    expect(refs[0].modifiedStart).toBe(1);
    expect(result.hunks[0].collapsedBefore).toBe(0);
    expect(refs).toHaveLength(4);
  });

  it('gives a distinct host to hunks separated by a single unchanged line', () => {
    const dir = repo();
    const base = lines(12);
    fs.writeFileSync(path.join(dir, 'tight.txt'), base.join('\n') + '\n');
    commitAll(dir);
    const next = [...base];
    next[0] = 'one';
    next[2] = 'three';
    next[4] = 'five';
    fs.writeFileSync(path.join(dir, 'tight.txt'), next.join('\n') + '\n');

    // -U0: git's closest possible hunks (a zero gap merges them into one).
    const flags = DIFF_FLAGS.map((f) => (f === '-U3' ? '-U0' : f));
    const patch = git(dir, 'diff', ...flags, '--', 'tight.txt');
    const { refs, result } = expectOneToOne(patch, 'split');
    expect(refs.map((r) => r.modifiedStart)).toEqual([1, 3, 5]);
    expect(result.hunks.map((h) => h.collapsedBefore)).toEqual([0, 1, 1]);
  });

  it('anchors a pure-deletion hunk on the deletions side', () => {
    const dir = repo();
    const base = lines(30);
    fs.writeFileSync(path.join(dir, 'del.txt'), base.join('\n') + '\n');
    commitAll(dir);
    const next = base.filter((_, i) => i < 10 || i > 13);
    fs.writeFileSync(path.join(dir, 'del.txt'), next.join('\n') + '\n');

    const flags = DIFF_FLAGS.map((f) => (f === '-U3' ? '-U0' : f));
    const patch = git(dir, 'diff', ...flags, '--', 'del.txt');
    const { refs, result } = expectOneToOne(patch);
    expect(refs[0].modifiedLines).toBe(0);
    expect(result.annotationSlots[0]).toBe(
      `annotation-deletions-${refs[0].originalStart}`,
    );
  });

  it('maps a rename with edits (-M)', () => {
    const dir = repo();
    const base = lines(40);
    fs.writeFileSync(path.join(dir, 'before.txt'), base.join('\n') + '\n');
    commitAll(dir);
    fs.rmSync(path.join(dir, 'before.txt'));
    const next = [...base];
    next[19] = 'line 20 changed';
    fs.writeFileSync(path.join(dir, 'after.txt'), next.join('\n') + '\n');
    git(dir, 'add', '-A');

    const patch = git(dir, 'diff', '--cached', '-M', ...DIFF_FLAGS);
    expect(patch).toContain('rename from before.txt');
    expectOneToOne(patch, 'split');
  });

  it('keeps CR bytes untouched for a CRLF file under core.autocrlf=false', () => {
    const dir = repo('false');
    const base = lines(20);
    fs.writeFileSync(path.join(dir, 'crlf.txt'), base.join('\r\n') + '\r\n');
    commitAll(dir);
    const next = [...base];
    next[0] = 'first changed';
    next[15] = 'sixteen changed';
    fs.writeFileSync(path.join(dir, 'crlf.txt'), next.join('\r\n') + '\r\n');

    const patch = git(dir, 'diff', ...DIFF_FLAGS, '--', 'crlf.txt');
    expect(patch).toContain('\r\n');
    const { result } = expectOneToOne(patch);
    const bodyCRs = (patch.slice(patch.indexOf('\n@@') + 1).match(/\r/g) ?? [])
      .length;
    const parsedCRs = result.parsedLines.join('').split('\r').length - 1;
    expect(bodyCRs).toBeGreaterThan(0);
    // Context lines appear once per side in Pierre's arrays, so every body CR
    // is preserved at least once and none are invented or stripped.
    expect(parsedCRs).toBeGreaterThanOrEqual(bodyCRs);
    expect(
      result.parsedLines.filter((l) => l.endsWith('\r\n')).length,
    ).toBeGreaterThan(0);
  });

  it('maps a CRLF working-tree file under core.autocrlf=true', () => {
    const dir = repo('true');
    const base = lines(20);
    fs.writeFileSync(path.join(dir, 'auto.txt'), base.join('\r\n') + '\r\n');
    commitAll(dir);
    const next = [...base];
    next[0] = 'first changed';
    next[15] = 'sixteen changed';
    fs.writeFileSync(path.join(dir, 'auto.txt'), next.join('\r\n') + '\r\n');

    const patch = git(dir, 'diff', ...DIFF_FLAGS, '--', 'auto.txt');
    const { result } = expectOneToOne(patch);
    // Whatever bytes git emitted are the bytes Pierre holds.
    const bodyCRs = (patch.match(/\r/g) ?? []).length;
    const parsedCRs = result.parsedLines.join('').split('\r').length - 1;
    expect(parsedCRs >= bodyCRs || bodyCRs === 0).toBe(true);
  });

  it('maps a new file and a deleted file', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'gone.txt'), lines(5).join('\n') + '\n');
    commitAll(dir);
    fs.rmSync(path.join(dir, 'gone.txt'));
    fs.writeFileSync(path.join(dir, 'fresh.txt'), lines(4).join('\n') + '\n');
    git(dir, 'add', '-A');

    const added = git(
      dir,
      'diff',
      '--cached',
      ...DIFF_FLAGS,
      '--',
      'fresh.txt',
    );
    const removed = git(
      dir,
      'diff',
      '--cached',
      ...DIFF_FLAGS,
      '--',
      'gone.txt',
    );
    expect(added).toContain('@@ -0,0 +1,4 @@');
    expect(removed).toContain('@@ -1,5 +0,0 @@');
    expectOneToOne(added);
    expectOneToOne(removed);
  });
});
