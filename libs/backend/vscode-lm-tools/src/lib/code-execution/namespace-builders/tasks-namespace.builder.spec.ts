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
    create: jest
      .fn()
      .mockResolvedValue({
        success: true,
        task: summary({ id: 'TASK_2026_400' }),
      }),
    updateMetadata: jest
      .fn()
      .mockResolvedValue({
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
