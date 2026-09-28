/**
 * `ptah.tasks.*` — the MCP agent write path.
 *
 * This is the surface an AGENT drives, which makes it the one most likely to be
 * handed a path where a folder name was expected, or a metadata field the tool
 * validates and then quietly drops. Both have happened, so both are pinned:
 *
 *  - the path-segment guard is the SHARED one, and rejects every shape the
 *    frontmatter parser rejects (previously it caught only `/`, `\` and an
 *    exact `..`);
 *  - `create` carries the five metadata fields all the way to the writer;
 *  - `update` is status OR metadata, routed through the single write funnel.
 */
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { fitsBudget } from '@ptah-extension/tool-output-reducers';
import {
  applyToolResultBudget,
  getToolResultBudget,
} from '../mcp-core/tool-result-budget';
import { buildHelpMethod } from './system-namespace.builders';
import {
  TASK_ESTIMATES,
  type TaskSpecDetail,
  type TaskSpecSummary,
} from '@ptah-extension/shared';

import {
  TaskCreateArgsSchema,
  TaskGetArgsSchema,
  TaskUpdateArgsSchema,
  buildTasksNamespace,
  type TaskSpecIndexLike,
  type TaskSpecWriterLike,
  type TasksNamespace,
} from './tasks-namespace.builder';

const ROOT = 'd:/workspace';

function summary(
  overrides: Partial<TaskSpecSummary> & { id: string },
): TaskSpecSummary {
  return {
    folderName: overrides.id,
    status: 'backlog',
    type: 'FEATURE',
    title: overrides.id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  } as TaskSpecSummary;
}

interface Harness {
  tasks: TasksNamespace;
  writer: { create: jest.Mock; updateMetadata: jest.Mock };
  index: { ensureStarted: jest.Mock; list: jest.Mock; getDetail: jest.Mock };
}

function build(tasks: readonly TaskSpecSummary[] = []): Harness {
  const writer = {
    create: jest.fn().mockResolvedValue({
      success: true,
      task: summary({ id: 'TASK_2026_400' }),
    }),
    updateMetadata: jest.fn().mockResolvedValue({
      success: true,
      task: summary({ id: 'TASK_2026_400' }),
    }),
  };
  const index = {
    ensureStarted: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({
      tasks: [...tasks],
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    }),
    getDetail: jest.fn().mockResolvedValue(null),
  };
  return {
    writer,
    index,
    tasks: buildTasksNamespace({
      getWriter: () => writer as unknown as TaskSpecWriterLike,
      getIndex: () => index as unknown as TaskSpecIndexLike,
      getWorkspaceRoot: () => ROOT,
    }),
  };
}

// ---------------------------------------------------------------------------
// G3 — the shared path-segment guard
// ---------------------------------------------------------------------------

/**
 * Every shape that must NOT survive as a task id. Mirrors the
 * `REJECTED_PARENTS` table in `task-specs`' `contract.guard.spec.ts`: these
 * two guards decide the same question about the same class of value, and the
 * whole reason they were unified is that they used to disagree.
 *
 * Everything below except the four leading-separator/traversal-path shapes was
 * accepted by the previous local check.
 */
const REJECTED_IDS: ReadonlyArray<[label: string, value: string]> = [
  ['a traversal token', '..'],
  ['a PADDED traversal token', ' .. '],
  ['a current-directory token', '.'],
  ['a relative path', '../TASK_2026_100'],
  ['a backslash-separated path', '..\\TASK_2026_100'],
  ['an absolute POSIX path', '/etc/passwd'],
  ['an absolute Windows path', 'C:\\Windows\\System32'],
  ['a bare Windows drive letter', 'C:'],
  ['a drive-RELATIVE Windows path', 'C:TASK_2026_100'],
  ['an NTFS alternate-data-stream name', 'TASK_2026_100:stream'],
  ['an embedded NUL', 'TASK_2026_100\u0000'],
  ['whitespace only', '   '],
];

describe('taskId guard — the shared single-path-segment check', () => {
  it.each(REJECTED_IDS)('ptah_task_get rejects %s', (_label, value) => {
    expect(TaskGetArgsSchema.safeParse({ taskId: value }).success).toBe(false);
  });

  it.each(REJECTED_IDS)('ptah_task_update rejects %s', (_label, value) => {
    expect(
      TaskUpdateArgsSchema.safeParse({ taskId: value, status: 'done' }).success,
    ).toBe(false);
  });

  it.each(REJECTED_IDS)(
    'ptah_task_create rejects %s as a parent',
    (_l, value) => {
      expect(
        TaskCreateArgsSchema.safeParse({
          title: 'T',
          type: 'FEATURE',
          parent: value,
        }).success,
      ).toBe(false);
    },
  );

  it.each(REJECTED_IDS)(
    'ptah_task_create rejects %s inside a relation array',
    (_label, value) => {
      expect(
        TaskCreateArgsSchema.safeParse({
          title: 'T',
          type: 'FEATURE',
          relatesTo: [value],
        }).success,
      ).toBe(false);
    },
  );

  it('accepts an ordinary folder name', () => {
    expect(
      TaskGetArgsSchema.safeParse({ taskId: 'TASK_2026_181' }).success,
    ).toBe(true);
  });

  it('refuses a rejected id before any write is attempted', async () => {
    const { tasks, writer } = build();
    const result = await tasks.update({ taskId: ' .. ', status: 'done' });
    expect(result.ok).toBe(false);
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FR-B1.7 — the label limits are the SHARED ones, on this path too
// ---------------------------------------------------------------------------

describe('label limits hold on the MCP path', () => {
  it.each([
    ['a newline inside a label', ['multi\nline']],
    ['a label over 32 characters', ['x'.repeat(33)]],
    ['a blank label', ['   ']],
  ] as const)('create rejects %s', (_label, labels) => {
    expect(
      TaskCreateArgsSchema.safeParse({
        title: 'T',
        type: 'FEATURE',
        labels: [...labels],
      }).success,
    ).toBe(false);
  });

  it('create rejects more than 12 labels', () => {
    const labels = Array.from({ length: 13 }, (_v, i) => `label-${i}`);
    expect(
      TaskCreateArgsSchema.safeParse({ title: 'T', type: 'FEATURE', labels })
        .success,
    ).toBe(false);
  });

  it('update rejects the same shapes', () => {
    expect(
      TaskUpdateArgsSchema.safeParse({
        taskId: 'TASK_2026_181',
        labels: ['x'.repeat(33)],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G2 — create carries the five metadata fields to the writer
// ---------------------------------------------------------------------------

describe('ptah_task_create — metadata reaches the writer', () => {
  it('passes all five fields through', async () => {
    const { tasks, writer } = build();

    const result = await tasks.create({
      title: 'Created with metadata',
      type: 'FEATURE',
      labels: ['licensing', 'needs:design'],
      estimate: 'L',
      parent: 'TASK_2026_300',
      duplicates: ['TASK_2026_310'],
      relatesTo: ['TASK_2026_311'],
    });

    expect(result.ok).toBe(true);
    // Precisely what this pins: `create` forwards the parsed args wholesale, so
    // the fields always reached the writer FROM HERE. What discarded them was
    // `TaskWriterService.create` not mapping them into `renderTaskMd`. This
    // asserts the forwarding stays intact; the on-disk proof that the writer
    // now honours them is on the RPC path, over the same writer.
    expect(writer.create).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({
        labels: ['licensing', 'needs:design'],
        estimate: 'L',
        parent: 'TASK_2026_300',
        duplicates: ['TASK_2026_310'],
        relatesTo: ['TASK_2026_311'],
      }),
    );
  });

  it('passes no metadata keys when the agent supplied none', async () => {
    const { tasks, writer } = build();

    await tasks.create({ title: 'Plain', type: 'FEATURE' });

    const [, input] = writer.create.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    for (const key of [
      'labels',
      'estimate',
      'parent',
      'duplicates',
      'relatesTo',
    ]) {
      expect(input[key]).toBeUndefined();
    }
  });

  it.each([...TASK_ESTIMATES])('accepts the %s estimate', (estimate) => {
    expect(
      TaskCreateArgsSchema.safeParse({ title: 'T', type: 'FEATURE', estimate })
        .success,
    ).toBe(true);
  });

  it('rejects an unrecognised estimate', () => {
    expect(
      TaskCreateArgsSchema.safeParse({
        title: 'T',
        type: 'FEATURE',
        estimate: 'Medium',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ptah_task_update — status OR metadata, one funnel
// ---------------------------------------------------------------------------

describe('ptah_task_update', () => {
  it('still accepts a status-only call and routes it through updateMetadata', async () => {
    const { tasks, writer } = build();

    const result = await tasks.update({
      taskId: 'TASK_2026_181',
      status: 'in_progress',
    });

    expect(result.ok).toBe(true);
    expect(writer.updateMetadata).toHaveBeenCalledWith(ROOT, 'TASK_2026_181', {
      status: 'in_progress',
    });
  });

  it('accepts metadata without a status', async () => {
    const { tasks, writer } = build();

    await tasks.update({ taskId: 'TASK_2026_181', labels: ['licensing'] });

    expect(writer.updateMetadata).toHaveBeenCalledWith(ROOT, 'TASK_2026_181', {
      labels: ['licensing'],
    });
  });

  it('forwards a removal (null / []) rather than dropping it', async () => {
    const { tasks, writer } = build();

    await tasks.update({ taskId: 'TASK_2026_181', estimate: null, labels: [] });

    expect(writer.updateMetadata).toHaveBeenCalledWith(ROOT, 'TASK_2026_181', {
      estimate: null,
      labels: [],
    });
  });

  it('rejects a call naming only a taskId, and writes nothing', async () => {
    const { tasks, writer } = build();

    const result = await tasks.update({ taskId: 'TASK_2026_181' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.code).toBe('INVALID_ARGS');
    // Without this the tool would refresh `updated` and rewrite a carrier the
    // agent never asked to change.
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it('surfaces TASK_CONFLICT as a retryable coded failure', async () => {
    const { tasks, writer } = build();
    writer.updateMetadata.mockResolvedValueOnce({
      success: false,
      error: { code: 'TASK_CONFLICT', message: 'changed on disk' },
    });

    const result = await tasks.update({
      taskId: 'TASK_2026_181',
      status: 'done',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.code).toBe('TASK_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// ptah_task_get — the derived block
// ---------------------------------------------------------------------------

describe('ptah_task_get — derived relations', () => {
  it('returns children, rollup and inverses from the shared graph', async () => {
    const parent = summary({ id: 'TASK_2026_400' });
    const child = summary({
      id: 'TASK_2026_401',
      parent: 'TASK_2026_400',
      status: 'done',
    });
    const blocker = summary({
      id: 'TASK_2026_402',
      dependsOn: ['TASK_2026_400'],
    });
    const related = summary({
      id: 'TASK_2026_403',
      relatesTo: ['TASK_2026_400'],
    });

    const harness = build([parent, child, blocker, related]);
    harness.index.getDetail.mockResolvedValue({
      ...parent,
      body: '',
    } as unknown as TaskSpecDetail);

    const result = await harness.tasks.get({ taskId: 'TASK_2026_400' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.derived.children).toEqual(['TASK_2026_401']);
    expect(result.derived.childRollup).toEqual({
      total: 1,
      done: 1,
      cancelled: 0,
      open: 0,
    });
    // No `blocks:` key exists anywhere — this is derived from TASK_2026_402's
    // own `dependsOn`, which is the one authored side.
    expect(result.derived.blocks).toEqual(['TASK_2026_402']);
    expect(result.derived.related).toEqual(['TASK_2026_403']);
  });

  it('returns empty derived arrays for a task with no relations', async () => {
    const lone = summary({ id: 'TASK_2026_400' });
    const harness = build([lone]);
    harness.index.getDetail.mockResolvedValue({
      ...lone,
      body: '',
    } as unknown as TaskSpecDetail);

    const result = await harness.tasks.get({ taskId: 'TASK_2026_400' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.derived.children).toEqual([]);
    expect(result.derived.childRollup).toBeUndefined();
    expect(result.derived.blocks).toEqual([]);
    expect(result.derived.unmetDependencies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ptah_task_list — paged, summary by default (TASK_2026_559 Batch 15)
// ---------------------------------------------------------------------------
//
// Live, an unfiltered call returned 223,297 characters for 235 tasks: every
// row, every description. These pin the bounded contract. The result is read
// through a loose local shape so the same assertions ran (and failed) against
// the unbounded implementation before the fix.

interface ListPage {
  ok: boolean;
  tasks: Array<Record<string, unknown>>;
  count?: number;
  total?: number;
  nextCursor?: string;
  fields?: string;
  code?: string;
  error?: string;
}

const asPage = (result: unknown): ListPage => result as ListPage;

const pad = (n: number): string => String(n).padStart(3, '0');
const idFor = (n: number): string => `TASK_2026_${pad(n)}_ab${n % 10}c`;

/** A realistic row: a long title, a paragraph of description, some metadata. */
function realisticTask(n: number, created: string | null): TaskSpecSummary {
  return summary({
    id: idFor(n),
    status: n % 3 === 0 ? 'done' : 'in_progress',
    title: `Restore the contract of tool number ${n} and guard it against regression`,
    description: `Background for task ${n}. `.repeat(28),
    labels: ['mcp', 'token-budget'],
    dependsOn: n > 1 ? [idFor(n - 1)] : [],
    created,
    updated: created,
  });
}

/**
 * 150 tasks, deliberately NOT in list order: several share one `created`
 * (the tie-break must be stable) and six have none (they sort last).
 */
function manyTasks(): TaskSpecSummary[] {
  const rows: TaskSpecSummary[] = [];
  for (let n = 1; n <= 150; n++) {
    const created =
      n % 25 === 0
        ? null
        : `2026-0${1 + (n % 9)}-${String(1 + (n % 27)).padStart(2, '0')}T00:00:00.000Z`;
    rows.push(realisticTask(n, created));
  }
  return rows.reverse();
}

/** Follow `nextCursor` to the end; returns every page. */
async function drain(
  tasks: TasksNamespace,
  args: Record<string, unknown> = {},
): Promise<ListPage[]> {
  const pages: ListPage[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = asPage(
      await tasks.list(cursor ? { ...args, cursor } : { ...args }),
    );
    if (!page.ok) throw new Error(page.error);
    pages.push(page);
    cursor = page.nextCursor;
    if (!cursor) return pages;
  }
  throw new Error('cursor never ended');
}

const cursorOf = (payload: string): string =>
  Buffer.from(payload).toString('base64url');

describe('ptah_task_list — paging and summary rows', () => {
  it('returns at most 25 rows and at most 8,000 characters by default, with the total', async () => {
    const harness = build(manyTasks());

    const page = asPage(await harness.tasks.list({}));

    expect(page.ok).toBe(true);
    expect(page.tasks.length).toBe(25);
    expect(page.total).toBe(150);
    expect(page.count).toBe(25);
    expect(typeof page.nextCursor).toBe('string');
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(8_000);
  });

  it('drops the description in the default summary rows', async () => {
    const harness = build(manyTasks());

    const page = asPage(await harness.tasks.list());

    expect(page.fields).toBe('summary');
    for (const row of page.tasks) {
      expect(row).not.toHaveProperty('description');
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('title');
      expect(row).toHaveProperty('labels');
    }
  });

  it('flags a task with validation issues in its summary row, and only that one', async () => {
    const harness = build([
      summary({ id: 'TASK_2026_001' }),
      summary({
        id: 'TASK_2026_002',
        frontmatterValid: false,
        validationIssues: [
          { field: 'type', code: 'invalid_type', message: 'bad type' },
        ],
      }),
    ]);

    const page = asPage(await harness.tasks.list());
    const byId = new Map(page.tasks.map((row) => [row['id'], row]));

    expect(byId.get('TASK_2026_002')).toMatchObject({
      frontmatterValid: false,
    });
    expect(byId.get('TASK_2026_002')).not.toHaveProperty('validationIssues');
    expect(byId.get('TASK_2026_001')).not.toHaveProperty('frontmatterValid');
  });

  it("includes the description with fields: 'full'", async () => {
    const harness = build(manyTasks());

    const page = asPage(await harness.tasks.list({ fields: 'full' }));

    expect(page.ok).toBe(true);
    expect(page.fields).toBe('full');
    expect(page.tasks.length).toBe(25);
    expect(page.tasks[0]['description']).toEqual(
      expect.stringContaining('Background for task'),
    );
    expect(page.tasks[0]).toHaveProperty('validationIssues');
  });

  it('covers all 150 tasks through the cursor, once each, newest first', async () => {
    const harness = build(manyTasks());

    const pages = await drain(harness.tasks);
    const ids = pages.flatMap((page) =>
      page.tasks.map((row) => String(row['id'])),
    );

    expect(pages.length).toBe(6);
    expect(ids.length).toBe(150);
    expect(new Set(ids).size).toBe(150);
    const created = pages.flatMap((page) =>
      page.tasks.map((row) => row['created'] as string | null | undefined),
    );
    const dated = created.filter(
      (value): value is string => typeof value === 'string',
    );
    expect(dated.length).toBe(144);
    expect(dated).toEqual([...dated].sort().reverse());
    expect(pages[pages.length - 1].nextCursor).toBeUndefined();
  });

  it('honours limit, and rejects a limit above 200', async () => {
    const harness = build(manyTasks());

    const page = asPage(await harness.tasks.list({ limit: 200 }));
    expect(page.tasks.length).toBe(150);
    expect(page.nextCursor).toBeUndefined();

    const refused = asPage(await harness.tasks.list({ limit: 201 }));
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('INVALID_ARGS');
  });

  it('reads the index once, unfiltered, and applies status/type itself', async () => {
    const harness = build(manyTasks());

    const page = asPage(
      await harness.tasks.list({ status: ['done'], limit: 200 }),
    );

    // One unfiltered read: cursor identity must not depend on the filter.
    expect(harness.index.list).toHaveBeenCalledTimes(1);
    expect(harness.index.list).toHaveBeenCalledWith(ROOT);
    expect(page.total).toBe(50);
    expect(page.tasks.every((row) => row['status'] === 'done')).toBe(true);
  });

  it('returns an empty page, not an error, for a cursor past the end', async () => {
    const harness = build(manyTasks());

    const first = asPage(await harness.tasks.list({ limit: 149 }));
    const tail = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 5 }),
    );
    expect(tail.ok).toBe(true);
    expect(tail.tasks.length).toBe(1);
    expect(tail.nextCursor).toBeUndefined();

    // Remove that last row: the same cursor now points past the end.
    const lastId = String(tail.tasks[0]['id']);
    harness.index.list.mockResolvedValue({
      tasks: manyTasks().filter((task) => task.id !== lastId),
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    });
    const past = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 5 }),
    );
    expect(past.ok).toBe(true);
    expect(past.tasks).toEqual([]);
    expect(past.total).toBe(149);
    expect(past.nextCursor).toBeUndefined();
  });

  it.each([
    ['not base64 JSON', 'definitely-not-a-cursor'],
    ['JSON of the wrong shape', cursorOf('{"x":1}')],
    ['a wrong version', cursorOf('{"v":2,"c":null,"id":"TASK_2026_001"}')],
    ['an empty id', cursorOf('{"v":1,"c":null,"id":""}')],
    ['an empty string', ''],
    ['an overlong string', 'A'.repeat(2_000)],
    ['a fabricated, well-shaped key', cursorOf('{"v":1,"c":null,"id":"zzzz"}')],
    [
      'a fabricated key with a made-up group hash',
      cursorOf('{"v":1,"c":null,"id":"zzzz","h":"0123456789abcdef"}'),
    ],
  ])(
    'refuses a malformed cursor (%s) with INVALID_CURSOR, not a first page',
    async (_label, cursor) => {
      const harness = build(manyTasks());

      const page = asPage(await harness.tasks.list({ cursor }));

      expect(page.ok).toBe(false);
      expect(page.code).toBe('INVALID_CURSOR');
      expect(page.tasks).toBeUndefined();
    },
  );

  it('refuses a genuine cursor with one character corrupted', async () => {
    const harness = build(manyTasks());
    const first = asPage(await harness.tasks.list());
    const genuine = String(first.nextCursor);
    const corrupted = `${genuine.slice(0, 5)}!${genuine.slice(5)}`;

    const page = asPage(await harness.tasks.list({ cursor: corrupted }));

    expect(page.ok).toBe(false);
    expect(page.code).toBe('INVALID_CURSOR');
  });

  it('orders by instant, not by the text of the timestamp', async () => {
    const harness = build([
      // 08:00Z written with an offset; lexically it sorts AFTER 09:00Z.
      summary({ id: 'TASK_2026_A', created: '2026-09-26T10:00:00+02:00' }),
      summary({ id: 'TASK_2026_B', created: '2026-09-26T09:00:00.000Z' }),
      summary({ id: 'TASK_2026_C', created: '2026-09-27' }),
      // The same instant as B, spelled differently: a tie, broken by id.
      summary({ id: 'TASK_2026_A2', created: '2026-09-26T11:00:00+02:00' }),
    ]);

    const page = asPage(await harness.tasks.list());

    expect(page.tasks.map((row) => row['id'])).toEqual([
      'TASK_2026_C',
      'TASK_2026_A2',
      'TASK_2026_B',
      'TASK_2026_A',
    ]);
    // The authored text is still what the row shows.
    expect(page.tasks[3]['created']).toBe('2026-09-26T10:00:00+02:00');
  });

  it('never repeats or skips an existing task when tasks are added or removed between pages', async () => {
    const live = manyTasks();
    const harness = build();
    harness.index.list.mockImplementation(async () => ({
      tasks: [...live],
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    }));
    const original = new Set(live.map((task) => task.id));

    const seen: string[] = [];
    const first = asPage(await harness.tasks.list({ limit: 40 }));
    expect(first.ok).toBe(true);
    seen.push(...first.tasks.map((row) => String(row['id'])));

    // Between pages: one brand-new task that sorts BEFORE the cursor (newest),
    // one that sorts AFTER it (oldest), one already-seen row deleted and one
    // not-yet-seen row deleted.
    live.push(realisticTask(900, '2027-01-01T00:00:00.000Z'));
    live.push(realisticTask(901, '2025-01-01T00:00:00.000Z'));
    const seenVictim = seen[3];
    const unseenVictim = live.find(
      (task) => original.has(task.id) && !seen.includes(task.id),
    )?.id;
    for (const victim of [seenVictim, unseenVictim]) {
      live.splice(
        live.findIndex((task) => task.id === victim),
        1,
      );
    }

    let cursor = first.nextCursor;
    while (cursor) {
      const page = asPage(await harness.tasks.list({ cursor, limit: 40 }));
      expect(page.ok).toBe(true);
      seen.push(...page.tasks.map((row) => String(row['id'])));
      cursor = page.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    for (const id of original) {
      if (id === unseenVictim) continue;
      expect(seen).toContain(id);
    }
    expect(seen).not.toContain(unseenVictim);
    expect(seen).toContain(idFor(901));
    expect(seen).not.toContain(idFor(900));
  });
});

// ---------------------------------------------------------------------------
// ptah_task_check — capped lists, verdict on the full set (Batch 15.2)
// ---------------------------------------------------------------------------

interface CheckPage {
  ok: boolean;
  healthy?: boolean;
  taskCount?: number;
  invalid: unknown[];
  excluded: unknown[];
  invalidTotal?: number;
  excludedTotal?: number;
}

const asCheck = (result: unknown): CheckPage => result as CheckPage;

describe('ptah_task_check — capped entries', () => {
  function brokenTree(invalidCount: number, excludedCount: number) {
    const tasks: TaskSpecSummary[] = [];
    for (let n = 1; n <= invalidCount; n++) {
      tasks.push(
        summary({
          id: `TASK_2026_${pad(n)}`,
          frontmatterValid: false,
          validationIssues: [
            {
              field: 'type',
              code: 'invalid_type',
              message: `type is not one of the allowed values (${n})`,
            },
          ],
        }),
      );
    }
    tasks.push(summary({ id: 'TASK_2026_999' }));
    const excluded = Array.from({ length: excludedCount }, (_, n) => ({
      folderName: `stray-folder-${n}`,
      reason: 'no_carrier' as const,
    }));
    return { tasks, excluded };
  }

  it('shows 50 of 120 invalid tasks with the true total, and the verdict is unchanged', async () => {
    const tree = brokenTree(120, 0);
    const harness = build();
    harness.index.list.mockResolvedValue({
      tasks: tree.tasks,
      excluded: tree.excluded,
      excludedCount: 0,
      specsDirExists: true,
    });

    const result = asCheck(await harness.tasks.check());

    expect(result.ok).toBe(true);
    expect(result.invalid.length).toBe(50);
    expect(result.invalidTotal).toBe(120);
    expect(result.excludedTotal).toBe(0);
    expect(result.healthy).toBe(false);
    expect(result.taskCount).toBe(121);
  });

  it('caps excluded folders the same way, and stays unhealthy on the full set', async () => {
    const tree = brokenTree(0, 70);
    const harness = build();
    harness.index.list.mockResolvedValue({
      tasks: tree.tasks,
      excluded: tree.excluded,
      excludedCount: 70,
      specsDirExists: true,
    });

    const result = asCheck(await harness.tasks.check());

    expect(result.excluded.length).toBe(50);
    expect(result.excludedTotal).toBe(70);
    expect(result.invalid).toEqual([]);
    expect(result.invalidTotal).toBe(0);
    expect(result.healthy).toBe(false);
  });

  it('reports a clean tree as healthy with zero totals', async () => {
    const harness = build([summary({ id: 'TASK_2026_001' })]);

    const result = asCheck(await harness.tasks.check());

    expect(result.healthy).toBe(true);
    expect(result.invalidTotal).toBe(0);
    expect(result.excludedTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 15 r1 — rename between pages, and pages sized by the result budget
// ---------------------------------------------------------------------------

describe('ptah_task_list — a rename between pages is never silent', () => {
  /** Three undated tasks: one tie group, ordered by id alone. */
  function liveHarness(ids: string[]) {
    const live = ids.map((id) => summary({ id }));
    const harness = build();
    harness.index.list.mockImplementation(async () => ({
      tasks: [...live],
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    }));
    const rename = (from: string, to: string): void => {
      const at = live.findIndex((task) => task.id === from);
      live[at] = summary({ id: to });
    };
    return { harness, rename };
  }

  it('refuses to continue when an UNSEEN task is renamed to sort before the cursor', async () => {
    const { harness, rename } = liveHarness([
      'TASK_2026_100',
      'TASK_2026_200',
      'TASK_2026_300',
    ]);
    const first = asPage(await harness.tasks.list({ limit: 1 }));
    expect(first.tasks.map((row) => row['id'])).toEqual(['TASK_2026_100']);

    rename('TASK_2026_300', 'TASK_2026_050');
    const next = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 1 }),
    );

    // Old behaviour: ok, [200], then end — TASK_2026_050 silently missed.
    expect(next.ok).toBe(false);
    expect(next.code).toBe('INVALID_CURSOR');
    expect(next.error).toContain('omit cursor');
  });

  it('refuses to continue when a SEEN task is renamed to sort after the cursor', async () => {
    const { harness, rename } = liveHarness([
      'TASK_2026_100',
      'TASK_2026_200',
      'TASK_2026_300',
    ]);
    const first = asPage(await harness.tasks.list({ limit: 2 }));

    rename('TASK_2026_100', 'TASK_2026_250');
    const next = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 2 }),
    );

    // Old behaviour: ok, [250, 300] — the same task returned twice.
    expect(next.ok).toBe(false);
    expect(next.code).toBe('INVALID_CURSOR');
  });

  it('continues normally when the rename is outside the cursor date group', async () => {
    const live = [
      summary({ id: 'TASK_2026_100', created: '2026-09-03T00:00:00Z' }),
      summary({ id: 'TASK_2026_200', created: '2026-09-02T00:00:00Z' }),
      summary({ id: 'TASK_2026_300', created: '2026-09-01T00:00:00Z' }),
    ];
    const harness = build();
    harness.index.list.mockImplementation(async () => ({
      tasks: [...live],
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    }));
    const first = asPage(await harness.tasks.list({ limit: 2 }));
    // Rename both a seen and an unseen task; neither shares the cursor's date.
    live[0] = { ...live[0], id: 'TASK_2026_900', folderName: 'TASK_2026_900' };
    live[2] = { ...live[2], id: 'TASK_2026_001', folderName: 'TASK_2026_001' };

    const next = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 2 }),
    );

    expect(next.ok).toBe(true);
    expect(next.tasks.map((row) => row['id'])).toEqual(['TASK_2026_001']);
  });
});

describe('ptah_task_list — pages fit the MCP result budget whole', () => {
  const budget = getToolResultBudget('ptah_task_list');
  const fits = (text: string): boolean => fitsBudget(text, budget);

  it('never lets the budget step cut a page, and loses no row between pages', async () => {
    const harness = build(manyTasks());
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await harness.tasks.list(cursor ? { cursor } : {}, {
        fits,
      });
      const text = JSON.stringify(result);
      const outcome = await applyToolResultBudget({
        text,
        toolName: 'ptah_task_list',
        requestId: `page-${pages}`,
        spoolRoot: os.tmpdir(),
      });
      // Through the real budget layer: returned byte-for-byte, valid JSON.
      expect(outcome.truncated).toBe(false);
      expect(outcome.text).toBe(text);
      const page = asPage(JSON.parse(outcome.text));
      expect(page.ok).toBe(true);
      expect(page.count).toBe(page.tasks.length);
      seen.push(...page.tasks.map((row) => String(row['id'])));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 50);

    expect(seen.length).toBe(150);
    expect(new Set(seen).size).toBe(150);
  });

  it('keeps full rows whole too, fewer per page', async () => {
    const harness = build(manyTasks());

    const page = asPage(await harness.tasks.list({ fields: 'full' }, { fits }));

    expect(fits(JSON.stringify(page))).toBe(true);
    expect(page.tasks.length).toBeGreaterThan(0);
    expect(page.tasks.length).toBeLessThan(25);
    expect(page.tasks[0]['description']).toEqual(
      expect.stringContaining('Background for task'),
    );
    expect(typeof page.nextCursor).toBe('string');
  });

  it('replaces a row too large for any page with a stub and moves past it', async () => {
    const huge = summary({
      id: 'TASK_2026_002',
      created: '2026-09-02T00:00:00Z',
      description: 'word '.repeat(20_000),
    });
    const next = summary({
      id: 'TASK_2026_001',
      created: '2026-09-01T00:00:00Z',
    });
    const harness = build([huge, next]);

    const first = asPage(
      await harness.tasks.list({ fields: 'full' }, { fits }),
    );

    expect(fits(JSON.stringify(first))).toBe(true);
    expect(first.tasks).toEqual([{ id: 'TASK_2026_002', oversized: true }]);
    expect(first.error ?? '').toBe('');
    const second = asPage(
      await harness.tasks.list(
        { fields: 'full', cursor: first.nextCursor },
        { fits },
      ),
    );
    expect(second.tasks.map((row) => row['id'])).toEqual(['TASK_2026_001']);
  });

  it('states count vs total in ptah.help("tasks")', async () => {
    const help = await buildHelpMethod()('tasks');

    for (const phrase of [
      'ptah.tasks.list',
      'count',
      'total',
      'nextCursor',
      "fields: 'full'",
      'INVALID_CURSOR',
      'invalidTotal',
    ]) {
      expect(help).toContain(phrase);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 15 r2 — filtered walks, forged cursors, long ids
// ---------------------------------------------------------------------------

describe('ptah_task_list — r2 cursor contract', () => {
  /**
   * An index that really applies the status filter, over a mutable list —
   * the shape the task-specs store has, so a status change removes a row
   * from a filtered read.
   */
  function filteringHarness(rows: TaskSpecSummary[]) {
    const harness = build();
    harness.index.list.mockImplementation(
      async (_root: string, filters?: { status?: string[] }) => ({
        tasks: rows.filter(
          (task) =>
            !filters?.status?.length || filters.status.includes(task.status),
        ),
        excluded: [],
        excludedCount: 0,
        specsDirExists: true,
      }),
    );
    const setStatus = (id: string, status: TaskSpecSummary['status']) => {
      const at = rows.findIndex((task) => task.id === id);
      rows[at] = { ...rows[at], status };
    };
    return { harness, setStatus };
  }

  const backlog = (id: string): TaskSpecSummary =>
    summary({ id, status: 'backlog' });

  it('continues a status-filtered walk after the anchor task leaves the filter', async () => {
    const { harness, setStatus } = filteringHarness([
      backlog('TASK_2026_A'),
      backlog('TASK_2026_B'),
      backlog('TASK_2026_C'),
      backlog('TASK_2026_D'),
    ]);
    const first = asPage(
      await harness.tasks.list({ status: ['backlog'], limit: 1 }),
    );
    expect(first.tasks.map((row) => row['id'])).toEqual(['TASK_2026_A']);

    setStatus('TASK_2026_A', 'done');
    const seen = ['TASK_2026_A'];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = asPage(
        await harness.tasks.list({ status: ['backlog'], limit: 1, cursor }),
      );
      expect(page.ok).toBe(true);
      seen.push(...page.tasks.map((row) => String(row['id'])));
      cursor = page.nextCursor;
    }

    expect(seen).toEqual([
      'TASK_2026_A',
      'TASK_2026_B',
      'TASK_2026_C',
      'TASK_2026_D',
    ]);
  });

  it('continues when an earlier returned (non-anchor) task leaves the filter', async () => {
    const { harness, setStatus } = filteringHarness([
      backlog('TASK_2026_A'),
      backlog('TASK_2026_B'),
      backlog('TASK_2026_C'),
      backlog('TASK_2026_D'),
    ]);
    const first = asPage(
      await harness.tasks.list({ status: ['backlog'], limit: 2 }),
    );

    setStatus('TASK_2026_A', 'done');
    const next = asPage(
      await harness.tasks.list({
        status: ['backlog'],
        limit: 2,
        cursor: first.nextCursor,
      }),
    );

    expect(next.ok).toBe(true);
    expect(next.tasks.map((row) => row['id'])).toEqual([
      'TASK_2026_C',
      'TASK_2026_D',
    ]);
  });

  it('refuses a genuine cursor whose payload was re-written with recomputed public hashes', async () => {
    const harness = build([
      summary({ id: 'TASK_2026_001', created: '2026-09-03T00:00:00Z' }),
      summary({ id: 'TASK_2026_002', created: '2026-09-02T00:00:00Z' }),
      summary({ id: 'TASK_2026_003', created: '2026-09-01T00:00:00Z' }),
    ]);
    const first = asPage(await harness.tasks.list({ limit: 1 }));
    const payload = JSON.parse(
      Buffer.from(String(first.nextCursor), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    // Move the anchor onto the LAST row, keeping the genuine signature. Every
    // unsigned field is valid for that row — the anchor hash and the group
    // fingerprint are public sha256 values — so only the HMAC can refuse it;
    // without it, TASK_2026_002 would be silently skipped.
    const publicHash = (text: string): string =>
      createHash('sha256').update(text).digest('hex').slice(0, 16);
    const forged = cursorOf(
      JSON.stringify({
        ...payload,
        c: Date.parse('2026-09-01T00:00:00Z'),
        a: publicHash('TASK_2026_003'),
        h: publicHash('TASK_2026_003'),
      }),
    );

    const page = asPage(await harness.tasks.list({ cursor: forged }));

    expect(page.ok).toBe(false);
    expect(page.code).toBe('INVALID_CURSOR');
  });

  it('refuses the reviewer v2 forgery with the empty-group hash', async () => {
    const harness = build([
      summary({ id: 'TASK_2026_001', created: '2026-09-03T00:00:00Z' }),
      summary({ id: 'TASK_2026_002', created: '2026-09-02T00:00:00Z' }),
    ]);

    const page = asPage(
      await harness.tasks.list({
        cursor: cursorOf('{"v":2,"c":null,"id":"zzzz","h":"e3b0c44298fc1c14"}'),
      }),
    );

    expect(page.ok).toBe(false);
    expect(page.code).toBe('INVALID_CURSOR');
  });

  it('issues a cursor it accepts back for a folder name at the length limit', async () => {
    // 255 UTF-16 code units — the NTFS component limit — of a 3-byte UTF-8
    // character: the largest id a folder can carry.
    const longId = `TASK_${'\u6F22'.repeat(250)}`;
    const harness = build([
      summary({ id: longId, created: '2026-09-02T00:00:00Z' }),
      summary({ id: 'TASK_2026_001', created: '2026-09-01T00:00:00Z' }),
    ]);

    const first = asPage(await harness.tasks.list({ limit: 1 }));
    expect(first.tasks.map((row) => row['id'])).toEqual([longId]);
    const next = asPage(
      await harness.tasks.list({ cursor: first.nextCursor, limit: 1 }),
    );

    expect(next.ok).toBe(true);
    expect(next.tasks.map((row) => row['id'])).toEqual(['TASK_2026_001']);
  });
});
