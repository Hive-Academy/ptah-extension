/**
 * `TaskWriterService.updateMetadata` — the single carrier-write funnel.
 *
 * This suite guards the properties that make a metadata write safe on a tree
 * that has no undo. `.ptah/**` is gitignored: a body this writer drops, a key
 * it removes without being asked, or a neighbouring carrier it touches is gone,
 * and no `git checkout` brings it back. Every assertion below exists because
 * the failure it catches would be SILENT.
 *
 * Six properties:
 *
 *  1. The BODY survives byte-for-byte — including a leading BOM and CRLF line
 *     endings, the two shapes a naive splice destroys first.
 *  2. A key this patch did not name keeps its VALUE and its POSITION.
 *  3. An emptied field REMOVES its key rather than writing `labels: []`.
 *  4. A write to task A leaves every other carrier byte-identical (BR-6 — no
 *     backfill, no normalization, ever).
 *  5. An external edit landing inside the read→write window is refused with
 *     `TASK_CONFLICT` and writes NOTHING.
 *  6. A read-only render over the whole tree issues zero writes under any
 *     `TASK_*` folder, proven against a filesystem whose `writeFile` throws.
 *
 * ## Why frontmatter is compared through the PARSER and only the body as bytes
 *
 * `updateFrontmatter` re-serializes the whole block through `matter.stringify`,
 * so an untouched key may come back with different QUOTING. That is
 * pre-existing — it happens on every status change already — and it is not an
 * add, a remove or a reorder, so it does not violate the key-stability
 * contract. Asserting byte-equality on the block would pin a property the
 * writer has never had and would push a future developer toward hand-rolling a
 * line-splice, which is a second write path.
 */
import * as path from 'path';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import {
  CARRIER_FILE,
  buildTaskGraph,
  renderTaskMd,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { parseTaskFile, updateFrontmatter } from './task-frontmatter';
import { NoOpTaskIndexNotifier } from './task-index.port';
import { TaskScannerService } from './task-scanner.service';
import { TaskWriterService } from './task-writer.service';

const WORKSPACE = normalizeWorkspaceRoot('D:\\workspace');
const TASK_A = 'TASK_2026_301';
const TASK_B = 'TASK_2026_302';

function carrierPath(taskId: string): string {
  return path.join(WORKSPACE, '.ptah', 'specs', taskId, CARRIER_FILE);
}

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function readBack(fs: MockFileSystemProvider, taskId: string): string {
  const bytes = fs.__state.files.get(carrierPath(taskId));
  if (bytes === undefined) throw new Error(`no carrier for ${taskId}`);
  return new TextDecoder().decode(bytes as Uint8Array);
}

/** Everything after the closing `---`, via the parser. */
function bodyOf(taskId: string, raw: string): string {
  const parsed = parseTaskFile(taskId, raw);
  if (parsed.kind !== 'task') {
    throw new Error(`carrier excluded: ${parsed.excluded.reason}`);
  }
  return parsed.body;
}

function summaryOf(taskId: string, raw: string): TaskSpecSummary {
  const parsed = parseTaskFile(taskId, raw);
  if (parsed.kind !== 'task') {
    throw new Error(`carrier excluded: ${parsed.excluded.reason}`);
  }
  return parsed.task;
}

/** The frontmatter keys, in the order they appear in the block. */
function keyOrder(raw: string): string[] {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) throw new Error('no frontmatter block');
  return match[1]
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

interface Harness {
  fs: MockFileSystemProvider;
  writer: TaskWriterService;
}

async function seed(
  carriers: ReadonlyArray<readonly [taskId: string, content: string]>,
): Promise<Harness> {
  const fs = createMockFileSystemProvider();
  for (const [taskId, content] of carriers) {
    await fs.writeFile(carrierPath(taskId), content);
  }
  // Seeding went through the mock's own writes. Clear them so every "wrote
  // exactly once" / "wrote nothing" assertion below measures only what the
  // writer under test did.
  fs.writeFile.mockClear();
  fs.writeFileBytes.mockClear();
  fs.createDirectory.mockClear();
  fs.delete.mockClear();
  return {
    fs,
    writer: new TaskWriterService(
      fs,
      silentLogger(),
      new NoOpTaskIndexNotifier(),
    ),
  };
}

/** A carrier with every metadata field set, so removal has something to remove. */
function fullCarrier(taskId: string): string {
  return renderTaskMd({
    id: taskId,
    title: 'Metadata under test',
    type: 'FEATURE',
    status: 'backlog',
    executor: 'backend-developer',
    labels: ['licensing', 'needs:design'],
    estimate: 'M',
    parent: 'TASK_2026_300',
    duplicates: ['TASK_2026_310'],
    relatesTo: ['TASK_2026_311'],
    now: '2026-08-04T00:00:00.000Z',
  });
}

// ---------------------------------------------------------------------------
// 1 + 2. Body preservation and key stability
// ---------------------------------------------------------------------------

describe('updateMetadata — the body and the untouched keys survive', () => {
  it('preserves a multi-line body byte-for-byte', async () => {
    const original = `${fullCarrier(TASK_A)}\n## Notes\n\n\`\`\`yaml\n---\nnot: frontmatter\n---\n\`\`\`\n\ntrailing text\n`;
    const { fs, writer } = await seed([[TASK_A, original]]);

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
      labels: ['licensing'],
    });

    expect(result.success).toBe(true);
    // The fenced `---` block is the interesting part: a splice that searched
    // for the LAST `---` rather than matching the leading block would swallow
    // it whole.
    expect(bodyOf(TASK_A, readBack(fs, TASK_A))).toBe(bodyOf(TASK_A, original));
  });

  /**
   * The BOM case is asserted against `updateFrontmatter` DIRECTLY, not through
   * the writer, and the reason matters. `createMockFileSystemProvider` decodes
   * with a default `TextDecoder`, whose `ignoreBOM` is false \u2014 so it SWALLOWS a
   * leading BOM on read and the writer never sees one. Running this through the
   * mock would produce a green test that proves nothing about the code path it
   * names. `updateFrontmatter` is a pure exported function and is where the BOM
   * is actually stripped and re-applied, so that is where it is pinned.
   */
  it('preserves the body across a leading BOM, and keeps the BOM', () => {
    const original = `\uFEFF${fullCarrier(TASK_A)}\nBody after a BOM.\n`;

    const next = updateFrontmatter(original, { estimate: 'L' });

    // A dropped BOM would defeat `FRONTMATTER_RE`'s `^---` anchor on the next
    // read, silently excluding the carrier as `no_frontmatter`.
    expect(next.charCodeAt(0)).toBe(0xfeff);
    expect(bodyOf(TASK_A, next)).toBe(bodyOf(TASK_A, original));
    expect(next).toContain('Body after a BOM.');
    expect(summaryOf(TASK_A, next).estimate).toBe('L');
  });

  it('does not accumulate blank lines across repeated writes', async () => {
    // `matter.stringify` emits a trailing separator newline that the sliced
    // body already carries, so an unguarded concatenation adds one blank line
    // per write \u2014 forever, on a gitignored file with no undo. Four writes is
    // enough to make an accumulation unmistakable.
    const original = `${fullCarrier(TASK_A)}\nStable body.\n`;
    const { fs, writer } = await seed([[TASK_A, original]]);

    for (const estimate of ['S', 'M', 'L', 'XL'] as const) {
      const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
        estimate,
      });
      expect(result.success).toBe(true);
    }

    expect(bodyOf(TASK_A, readBack(fs, TASK_A))).toBe(bodyOf(TASK_A, original));
  });

  it('preserves a CRLF body byte-for-byte', async () => {
    const original = `${fullCarrier(TASK_A)}\r\n## CRLF section\r\n\r\nline one\r\nline two\r\n`;
    const { fs, writer } = await seed([[TASK_A, original]]);

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
      status: 'in_progress',
    });

    expect(result.success).toBe(true);
    const body = bodyOf(TASK_A, readBack(fs, TASK_A));
    expect(body).toBe(bodyOf(TASK_A, original));
    // Stated separately: a normalizing writer would still produce an "equal"
    // body if BOTH sides were normalized by the comparison helper.
    expect(body).toContain('\r\n');
  });

  it('leaves an untouched key with its value AND its position', async () => {
    const original = fullCarrier(TASK_A);
    const { fs, writer } = await seed([[TASK_A, original]]);
    const before = keyOrder(original);

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
      estimate: 'XL',
    });

    expect(result.success).toBe(true);
    const next = readBack(fs, TASK_A);
    // Same keys, same order. The merge preserves `existing` insertion order and
    // only appends genuinely new keys at the end.
    expect(keyOrder(next)).toEqual(before);
    const task = summaryOf(TASK_A, next);
    expect(task.executor).toBe('backend-developer');
    expect(task.labels).toEqual(['licensing', 'needs:design']);
    expect(task.parent).toBe('TASK_2026_300');
    expect(task.relatesTo).toEqual(['TASK_2026_311']);
  });

  it('appends a FIRST-EVER key at the end and disturbs nothing above it', async () => {
    const original = renderTaskMd({
      id: TASK_A,
      title: 'No metadata yet',
      type: 'FEATURE',
      now: '2026-08-04T00:00:00.000Z',
    });
    const { fs, writer } = await seed([[TASK_A, original]]);
    const before = keyOrder(original);
    expect(before).not.toContain('labels');

    await writer.updateMetadata(WORKSPACE, TASK_A, { labels: ['licensing'] });

    const after = keyOrder(readBack(fs, TASK_A));
    expect(after).toEqual([...before, 'labels']);
  });
});

// ---------------------------------------------------------------------------
// 3. Emptying a field REMOVES the key
// ---------------------------------------------------------------------------

describe('updateMetadata — empty removes the key (FR-B5.5)', () => {
  it.each([
    ['labels', { labels: [] as string[] }, 'labels:'],
    ['duplicates', { duplicates: [] as string[] }, 'duplicates:'],
    ['relatesTo', { relatesTo: [] as string[] }, 'relates_to:'],
    ['estimate', { estimate: null }, 'estimate:'],
    ['parent', { parent: null }, 'parent:'],
  ] as const)(
    'clearing %s removes the key from the rendered text',
    async (_name, patch, yamlKey) => {
      const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

      const result = await writer.updateMetadata(WORKSPACE, TASK_A, patch);

      expect(result.success).toBe(true);
      const next = readBack(fs, TASK_A);
      // Absent from the TEXT, not merely empty after parse. `labels: []` on
      // disk would parse back as `[]` and pass a value-only assertion while
      // leaving a line the author never wrote.
      expect(next).not.toContain(yamlKey);
    },
  );

  it('clearing one field leaves the others intact', async () => {
    const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

    await writer.updateMetadata(WORKSPACE, TASK_A, { labels: [] });

    const task = summaryOf(TASK_A, readBack(fs, TASK_A));
    expect(task.labels).toEqual([]);
    expect(task.estimate).toBe('M');
    expect(task.parent).toBe('TASK_2026_300');
    expect(task.duplicates).toEqual(['TASK_2026_310']);
    expect(task.relatesTo).toEqual(['TASK_2026_311']);
  });

  /**
   * `depends_on` is the documented exception and stays one. Every carrier on
   * disk already carries the line; removing it here would rewrite the
   * frontmatter of every task in every workspace to change nothing a reader
   * can see.
   */
  it('dependsOn: [] is still WRITTEN as [], not removed', async () => {
    const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
      dependsOn: [],
    });

    expect(result.success).toBe(true);
    const next = readBack(fs, TASK_A);
    expect(next).toContain('depends_on:');
    expect(summaryOf(TASK_A, next).dependsOn).toEqual([]);
  });

  it('every field is a FULL REPLACEMENT, never a merge', async () => {
    const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

    await writer.updateMetadata(WORKSPACE, TASK_A, { labels: ['security'] });

    // Not `['licensing', 'needs:design', 'security']`. The caller computes the
    // whole new array from the task it already holds; the writer refuses to do
    // a read-modify-write it cannot make atomic.
    expect(summaryOf(TASK_A, readBack(fs, TASK_A)).labels).toEqual([
      'security',
    ]);
  });

  it('rejects a patch that asks for nothing, and writes nothing', async () => {
    const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);
    fs.writeFile.mockClear();

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {});

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('INVALID_PARAMS');
    // The point of the refusal: an empty patch would otherwise still refresh
    // `updated` and rewrite a file nobody asked to change.
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a taskId that is a path, and writes nothing', async () => {
    const { fs, writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);
    fs.writeFile.mockClear();

    const result = await writer.updateMetadata(WORKSPACE, ' .. ', {
      status: 'done',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('INVALID_PARAMS');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateStatus stays behaviourally identical after becoming a delegate
// ---------------------------------------------------------------------------

describe('updateStatus — unchanged contract over the shared funnel', () => {
  it('still moves the status and preserves the body', async () => {
    const original = `${fullCarrier(TASK_A)}\nBody that must survive.\n`;
    const { fs, writer } = await seed([[TASK_A, original]]);

    const result = await writer.updateStatus(WORKSPACE, TASK_A, 'in_review');

    expect(result.success).toBe(true);
    const next = readBack(fs, TASK_A);
    expect(summaryOf(TASK_A, next).status).toBe('in_review');
    expect(bodyOf(TASK_A, next)).toBe(bodyOf(TASK_A, original));
  });

  it('reports a missing task as TASK_NOT_FOUND, not INVALID_PARAMS', async () => {
    const { writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

    const result = await writer.updateStatus(
      WORKSPACE,
      'TASK_2026_999',
      'done',
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  /**
   * The one new line in `updateStatus`: the funnel's `INVALID_PARAMS` is folded
   * onto `WRITE_FAILED` so `UpdateStatusResult` — and with it the wire union in
   * `rpc-tasks.types.ts` and every exhaustive switch over it — does not have to
   * widen for a case Zod already prevents upstream.
   */
  it('folds the funnel INVALID_PARAMS onto WRITE_FAILED, message intact', async () => {
    const { writer } = await seed([[TASK_A, fullCarrier(TASK_A)]]);

    const result = await writer.updateStatus(WORKSPACE, '..', 'done');

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('WRITE_FAILED');
    expect(result.error.message).toContain('single task folder name');
  });
});

// ---------------------------------------------------------------------------
// 4. A write to A leaves every other carrier byte-identical (BR-6)
// ---------------------------------------------------------------------------

describe('updateMetadata — neighbours are never touched (BR-6)', () => {
  it('leaves every other carrier byte-identical', async () => {
    const { fs, writer } = await seed([
      [TASK_A, fullCarrier(TASK_A)],
      // Deliberately a carrier with NO metadata keys: if anything backfilled or
      // normalized, this is where it would show.
      [
        TASK_B,
        renderTaskMd({
          id: TASK_B,
          title: 'Untouched neighbour',
          type: 'BUGFIX',
          now: '2026-08-04T00:00:00.000Z',
        }),
      ],
    ]);
    const snapshot = new Map(fs.__state.files);

    const result = await writer.updateMetadata(WORKSPACE, TASK_A, {
      labels: ['licensing', 'security'],
      estimate: 'S',
    });

    expect(result.success).toBe(true);
    // Same file set — nothing created, nothing deleted.
    expect([...fs.__state.files.keys()].sort()).toEqual(
      [...snapshot.keys()].sort(),
    );
    for (const [key, bytes] of snapshot) {
      if (key === carrierPath(TASK_A)) continue;
      expect(fs.__state.files.get(key)).toEqual(bytes);
    }
    // Only one file was written at all.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      carrierPath(TASK_A),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. A mid-write external edit is refused and writes nothing
// ---------------------------------------------------------------------------

describe('updateMetadata — the conflict domain is the whole file', () => {
  /**
   * The external write is fired as a side effect of the writer's FIRST read, so
   * it lands deterministically inside the read→write window rather than being
   * raced for.
   */
  async function armExternalWrite(
    original: string,
    external: string,
  ): Promise<Harness & { fired: () => number }> {
    const harness = await seed([[TASK_A, original]]);
    const readFile = harness.fs.readFile.getMockImplementation() as (
      p: string,
    ) => Promise<string>;
    const writeFile = harness.fs.writeFile.getMockImplementation() as (
      p: string,
      content: string,
    ) => Promise<void>;

    let armed = true;
    let fired = 0;
    harness.fs.readFile.mockImplementation(async (p: string) => {
      const content = await readFile(p);
      if (p === carrierPath(TASK_A) && armed) {
        armed = false;
        fired++;
        await writeFile(carrierPath(TASK_A), external);
      }
      return content;
    });

    return { ...harness, fired: () => fired };
  }

  it('returns TASK_CONFLICT and leaves the external write fully intact', async () => {
    const original = fullCarrier(TASK_A);
    const external = `${original}\nAn external agent appended this paragraph.\n`;
    const harness = await armExternalWrite(original, external);

    const result = await harness.writer.updateMetadata(WORKSPACE, TASK_A, {
      labels: ['security'],
    });

    expect(harness.fired()).toBe(1);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('TASK_CONFLICT');
    // Byte-identical to what the other writer left — nothing of ours landed.
    expect(readBack(harness.fs, TASK_A)).toBe(external);
  });

  /**
   * The comparison is over the WHOLE file, deliberately. Narrowing it to the
   * keys this patch names — a tempting fix for conflict fatigue — would let a
   * metadata write silently discard somebody else's BODY edit, which is the
   * exact class of loss this write path exists to prevent.
   */
  it('conflicts on a BODY-only external edit, not just a frontmatter one', async () => {
    const original = fullCarrier(TASK_A);
    const external = `${original}\nOnly the body changed.\n`;
    const harness = await armExternalWrite(original, external);

    const result = await harness.writer.updateMetadata(WORKSPACE, TASK_A, {
      estimate: 'XL',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('TASK_CONFLICT');
    expect(readBack(harness.fs, TASK_A)).toContain('Only the body changed.');
  });
});

// ---------------------------------------------------------------------------
// deferNotify — bulk callers get ONE rescan, not N
// ---------------------------------------------------------------------------

describe('updateMetadata — deferNotify', () => {
  function countingNotifier(): {
    notifier: NoOpTaskIndexNotifier;
    calls: () => number;
  } {
    let calls = 0;
    const notifier = {
      applyFolderChange: async () => {
        calls++;
      },
    } as unknown as NoOpTaskIndexNotifier;
    return { notifier, calls: () => calls };
  }

  it('notifies the index once per write by default', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrierPath(TASK_A), fullCarrier(TASK_A));
    const { notifier, calls } = countingNotifier();
    const writer = new TaskWriterService(fs, silentLogger(), notifier);

    await writer.updateMetadata(WORKSPACE, TASK_A, { estimate: 'S' });

    expect(calls()).toBe(1);
  });

  it('suppresses the notification when deferNotify is set', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrierPath(TASK_A), fullCarrier(TASK_A));
    const { notifier, calls } = countingNotifier();
    const writer = new TaskWriterService(fs, silentLogger(), notifier);

    const result = await writer.updateMetadata(
      WORKSPACE,
      TASK_A,
      { estimate: 'S' },
      { deferNotify: true },
    );

    // The FILE still changed — deferNotify suppresses the rescan broadcast, not
    // the write. A bulk caller notifies once at the end instead of N times.
    expect(result.success).toBe(true);
    expect(summaryOf(TASK_A, readBack(fs, TASK_A)).estimate).toBe('S');
    expect(calls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// create — the five metadata fields reach the carrier (G2)
// ---------------------------------------------------------------------------

describe('create — metadata reaches the carrier', () => {
  it('writes all five fields, and they round-trip', async () => {
    const { fs, writer } = await seed([]);

    const result = await writer.create(WORKSPACE, {
      title: 'Created with metadata',
      type: 'FEATURE',
      labels: ['licensing', 'needs:design'],
      estimate: 'L',
      parent: 'TASK_2026_300',
      duplicates: ['TASK_2026_310'],
      relatesTo: ['TASK_2026_311'],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    const task = summaryOf(result.task.id, readBack(fs, result.task.id));
    expect(task.labels).toEqual(['licensing', 'needs:design']);
    expect(task.estimate).toBe('L');
    expect(task.parent).toBe('TASK_2026_300');
    expect(task.duplicates).toEqual(['TASK_2026_310']);
    expect(task.relatesTo).toEqual(['TASK_2026_311']);
  });

  it('a create with NO metadata writes none of the five keys', async () => {
    const { fs, writer } = await seed([]);

    const result = await writer.create(WORKSPACE, {
      title: 'Created without metadata',
      type: 'FEATURE',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    const raw = readBack(fs, result.task.id);
    for (const key of [
      'labels:',
      'estimate:',
      'parent:',
      'duplicates:',
      'relates_to:',
    ]) {
      expect(raw).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. A read-only render writes NOTHING under any TASK_* folder
// ---------------------------------------------------------------------------

describe('read-only render issues zero carrier writes (FR-B3.2, BR-6)', () => {
  /**
   * The strongest available form of the claim: the filesystem itself REFUSES
   * to write. A read path that attempted one would not merely be counted, it
   * would throw and fail the test outright — so this cannot pass by an
   * assertion being written against the wrong spy.
   *
   * The scope is "under a `TASK_*` folder". `TaskIndexService.ensureStarted`
   * writes `.ptah/specs/README.md` when its content hash differs; that path is
   * not exercised here and is not under a task folder either way.
   */
  it('scanning and graph-building the whole tree writes nothing, on a read-only fs', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrierPath(TASK_A), fullCarrier(TASK_A));
    await fs.writeFile(
      carrierPath(TASK_B),
      renderTaskMd({
        id: TASK_B,
        title: 'Child of A',
        type: 'BUGFIX',
        parent: TASK_A,
        labels: ['licensing'],
        now: '2026-08-04T00:00:00.000Z',
      }),
    );

    // From here on, ANY write is fatal. Clear the seeding calls first so the
    // "not called" assertions measure only the render.
    fs.writeFile.mockClear();
    fs.writeFileBytes.mockClear();
    fs.delete.mockClear();
    fs.writeFile.mockImplementation(async (p: string) => {
      throw new Error(`read-only render attempted a write to ${p}`);
    });
    fs.writeFileBytes.mockImplementation(async (p: string) => {
      throw new Error(`read-only render attempted a byte write to ${p}`);
    });
    fs.delete.mockImplementation(async (p: string) => {
      throw new Error(`read-only render attempted a delete of ${p}`);
    });

    const snapshot = new Map(fs.__state.files);
    const scanner = new TaskScannerService(fs, silentLogger());

    const scan = await scanner.scan(WORKSPACE);
    const graph = buildTaskGraph(scan.tasks);

    // The render found real content — otherwise "zero writes" is vacuous.
    expect(scan.tasks.map((t) => t.id).sort()).toEqual([TASK_A, TASK_B]);
    expect(graph.children.get(TASK_A)).toEqual([TASK_B]);
    expect(graph.knownLabels.length).toBeGreaterThan(0);

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.writeFileBytes).not.toHaveBeenCalled();
    expect(fs.delete).not.toHaveBeenCalled();
    for (const [key, bytes] of snapshot) {
      expect(fs.__state.files.get(key)).toEqual(bytes);
    }
  });
});
