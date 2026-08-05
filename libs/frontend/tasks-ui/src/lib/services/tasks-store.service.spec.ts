/**
 * TasksStore — signal store tests.
 *
 * Stubs `ClaudeRpcService.call` so board load, push-triggered refresh, and the
 * (non-optimistic) status-change path are exercised against the real `tasks:*`
 * RPC names without the message bus.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  BULK_CHUNK_SIZE,
  EMPTY_TASK_FILTER,
  TASK_STATUSES,
  TaskMetadataPatchSchema,
  type TaskMetadataPatch,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksBoardResult,
  type TasksBulkResultItem,
} from '@ptah-extension/shared';
import {
  BULK_CONFIRM_THRESHOLD,
  TasksStore,
  TASKS_CHANGED_MESSAGE_TYPE,
  normalizeRootKey,
} from './tasks-store.service';

function makeTask(
  id: string,
  status: TaskStatus,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title: `Title ${id}`,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: '2026-07-14T10:00:00.000Z',
    updated: '2026-07-14T10:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function makeBoard(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>>,
  meta: Partial<
    Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>
  > = {},
): TasksBoardResult {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
  };
}

/**
 * Median wall-clock cost of `run`, over `samples` timed iterations after one
 * untimed warm-up.
 *
 * ## This file's failure was a genuine outlier, not a clock artifact
 *
 * The single-sample form of the filter budget below flaked at a measured
 * 1-in-2 rate, once reporting **62.07 ms** against 16 ms. It already used
 * `performance.now()`, which is sub-millisecond — so that 62 ms was a real
 * 62 ms of wall clock: a GC pause or a descheduled slice landing entirely
 * inside the one sample that decided the result. One sample on a loaded
 * machine measures the scheduler rather than the code.
 *
 * A median over nine discards such an outlier by construction — it would take
 * five slow samples out of nine to move it — and the warm-up keeps first-call
 * JIT out of the numbers.
 *
 * ## The twin in `task-filter.spec.ts` failed for a DIFFERENT reason
 *
 * Worth stating, because the two were briefly explained as one. That file used
 * `Date.now()`, whose ~15.6 ms Windows tick made a ~0.34 ms operation measure
 * 0 or 15.6 with nothing between — quantization against a budget of 16, not
 * contention. It needed `performance.now()` as well as the median; this file
 * only ever needed the median. Same remedy, two distinct causes; neither
 * file's evidence explains the other's defect.
 */
function medianMs(run: () => void, samples = 9): number {
  run();
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    run();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return timings[(samples - 1) >> 1];
}

/**
 * Median ceiling for one full-facet recompute over 1 000 tasks.
 *
 * Kept at the original one-frame budget: the number was never the problem, the
 * single sample was. The measured warm median here is **0.38 ms**, so this sits
 * at roughly 42x headroom, and the regression this test exists to catch — the
 * graph being rebuilt inside the filter path, or a predicate going quadratic —
 * costs tens to hundreds of milliseconds at this size and trips it immediately.
 */
const FILTER_CEILING_MS = 16;

const ok = <T>(data: T) => ({
  success: true,
  isSuccess: () => true,
  data,
});
const err = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

describe('TasksStore', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    store = TestBed.inject(TasksStore);
  });

  it('loadBoard() populates columns, excluded count, and specsDirExists', async () => {
    rpcCall.mockResolvedValue(
      ok(
        makeBoard(
          { backlog: [makeTask('TASK_2026_200', 'backlog')] },
          { excludedCount: 85, specsDirExists: true },
        ),
      ),
    );

    await store.loadBoard();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
    expect(store.columns().backlog).toHaveLength(1);
    expect(store.excludedCount()).toBe(85);
    expect(store.specsDirExists()).toBe(true);
    expect(store.totalCount()).toBe(1);
    expect(store.isEmpty()).toBe(false);
  });

  it('board() computed exposes all six columns in canonical order', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    await store.loadBoard();

    expect(store.board().map((c) => c.status)).toEqual([...TASK_STATUSES]);
  });

  it('isEmpty() is true after a load when the specs dir is absent', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({}, { specsDirExists: false })));

    await store.loadBoard();

    expect(store.isEmpty()).toBe(true);
  });

  it('records an error when the board load fails', async () => {
    rpcCall.mockResolvedValue(err('scan-failed'));

    await store.loadBoard();

    expect(store.error()).toBe('scan-failed');
  });

  it('handleMessage refreshes the board on a tasks:changed push', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
    await Promise.resolve();
    await Promise.resolve();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('handleMessage ignores unrelated message types', () => {
    store.handleMessage({ type: 'something:else' });
    expect(rpcCall).not.toHaveBeenCalled();
  });

  // `updateStatus` is a call onto `applyMetadata` — one client mutation funnel,
  // one RPC method. `tasks:updateStatus` still exists on the wire for the CLI
  // and MCP paths; the board does not use it.
  it('updateStatus does NOT optimistically move the card before re-fetch', async () => {
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_200', 'backlog')] })),
    );
    await store.loadBoard();
    expect(store.columns().backlog).toHaveLength(1);

    // updateStatus success, then an authoritative re-fetch that moves the card.
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_200', 'in_progress') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(
        makeBoard({ in_progress: [makeTask('TASK_2026_200', 'in_progress')] }),
      ),
    );

    await store.updateStatus('TASK_2026_200', 'in_progress');

    expect(rpcCall).toHaveBeenCalledWith('tasks:updateMetadata', {
      taskId: 'TASK_2026_200',
      patch: { status: 'in_progress' },
    });
    // The board reflects the server-authoritative re-fetch, not a local guess.
    expect(store.columns().backlog).toHaveLength(0);
    expect(store.columns().in_progress).toHaveLength(1);
  });

  it('updateStatus surfaces the structured backend error', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({
        success: false,
        error: { code: 'TASK_EXCLUDED', message: 'excluded' },
      }),
    );

    await store.updateStatus('TASK_2026_200', 'done');

    expect(store.error()).toBe('excluded');
  });

  it('createTask reloads the board on success', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_201', 'backlog') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_201', 'backlog')] })),
    );

    const result = await store.createTask({ title: 'New', type: 'FEATURE' });

    expect(rpcCall).toHaveBeenCalledWith('tasks:create', {
      title: 'New',
      type: 'FEATURE',
    });
    expect(result?.success).toBe(true);
    expect(store.columns().backlog).toHaveLength(1);
  });

  it('reindex sets an action message and reloads', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, indexedCount: 3, excludedCount: 85, durationMs: 12 }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));

    await store.reindex();

    expect(rpcCall).toHaveBeenCalledWith('tasks:reindex', {});
    expect(store.actionMessage()).toContain('3');
  });

  describe('visibility/focus staleness reconcile', () => {
    it('re-fetches the board on window focus after an initial load', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();

      expect(rpcCall).toHaveBeenCalledTimes(2);
      expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {});
    });

    it('re-fetches on visibilitychange when the document becomes visible', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      // jsdom default visibilityState is 'visible' → reconcile fires.
      expect(rpcCall).toHaveBeenCalledTimes(2);
    });

    it('does NOT reconcile on focus before the first load has completed', async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();

      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('stops reconciling once the injector is destroyed', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      TestBed.resetTestingModule();

      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      // Listener was torn down with the root injector — no extra fetch.
      expect(rpcCall).toHaveBeenCalledTimes(1);
    });
  });

  it('openTask fetches and stores the detail', async () => {
    const detail = {
      ...makeTask('TASK_2026_200', 'backlog'),
      body: '# body',
      artifacts: ['task.md'],
    };
    rpcCall.mockResolvedValueOnce(ok({ task: detail }));

    await store.openTask('TASK_2026_200');

    expect(rpcCall).toHaveBeenCalledWith('tasks:get', {
      taskId: 'TASK_2026_200',
    });
    expect(store.selectedTaskId()).toBe('TASK_2026_200');
    expect(store.taskDetail()?.body).toBe('# body');
  });

  // -------------------------------------------------------------------------
  // The derived graph (Task 3.2)
  // -------------------------------------------------------------------------
  describe('graph()', () => {
    it('derives children, rollups and inverses from the loaded payload alone', async () => {
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: [
              makeTask('TASK_2026_200', 'backlog', {
                labels: ['licensing'],
              }),
              makeTask('TASK_2026_202', 'backlog', {
                dependsOn: ['TASK_2026_200'],
                relatesTo: ['TASK_2026_200'],
              }),
            ],
            done: [
              makeTask('TASK_2026_201', 'done', { parent: 'TASK_2026_200' }),
            ],
          }),
        ),
      );

      await store.loadBoard();
      const graph = store.graph();

      expect(graph.children.get('TASK_2026_200')).toEqual(['TASK_2026_201']);
      expect(graph.rollup.get('TASK_2026_200')).toEqual({
        total: 1,
        done: 1,
        cancelled: 0,
        open: 0,
      });
      expect(graph.blocks.get('TASK_2026_200')).toEqual(['TASK_2026_202']);
      expect(graph.related.get('TASK_2026_200')).toEqual(['TASK_2026_202']);
      expect(store.knownLabels()).toEqual(['licensing']);
    });

    it('is memoized — repeated reads rebuild nothing until the payload changes', async () => {
      rpcCall.mockResolvedValue(
        ok(makeBoard({ backlog: [makeTask('TASK_2026_200', 'backlog')] })),
      );
      await store.loadBoard();

      const first = store.graph();
      expect(store.graph()).toBe(first);
      expect(store.knownLabels()).toBe(store.knownLabels());

      rpcCall.mockResolvedValue(
        ok(makeBoard({ backlog: [makeTask('TASK_2026_203', 'backlog')] })),
      );
      await store.loadBoard();
      expect(store.graph()).not.toBe(first);
    });

    it('issues no RPC at all while the graph is being read (FR-B3.2)', async () => {
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: [
              makeTask('TASK_2026_200', 'backlog'),
              makeTask('TASK_2026_201', 'backlog', {
                parent: 'TASK_2026_200',
              }),
            ],
          }),
        ),
      );
      await store.loadBoard();
      rpcCall.mockClear();

      // Everything the board and the detail panel read off the graph.
      store.graph();
      store.knownLabels();
      store.allTasks();
      store.graph().rollup.get('TASK_2026_200');
      store.graph().effectiveParent.get('TASK_2026_201');

      // Not "no write" — NO CALL. A parent's carrier is never touched when a
      // child appears, because children are read out of the CHILD's frontmatter.
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('survives a host payload that predates the metadata contract', async () => {
      // No labels / duplicates / relatesTo on the wire at all.
      const wire: Partial<TaskSpecSummary> = {
        ...makeTask('TASK_2026_200', 'backlog'),
      };
      delete wire.labels;
      delete wire.duplicates;
      delete wire.relatesTo;

      rpcCall.mockResolvedValue(
        ok(makeBoard({ backlog: [wire as TaskSpecSummary] })),
      );
      await store.loadBoard();

      expect(() => store.graph()).not.toThrow();
      expect(store.knownLabels()).toEqual([]);
      expect(store.columns().backlog[0].labels).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // The filter path (Phase 4 / Task 7.1)
  //
  // The claims under test are the two the phase gate names — a filter change
  // costs ZERO RPC calls, and a recompute over a full-sized board fits inside a
  // frame — plus the counter asymmetry that makes "23 of 181" sayable.
  // -------------------------------------------------------------------------
  describe('filter and sort', () => {
    /** Four tasks that every facet in this block can tell apart. */
    async function loadFixture(): Promise<void> {
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: [
              makeTask('TASK_2026_200', 'backlog', {
                labels: ['licensing'],
                estimate: 'M',
                executor: 'backend-developer',
                updated: '2026-08-01T00:00:00.000Z',
              }),
              makeTask('TASK_2026_201', 'backlog', {
                parent: 'TASK_2026_200',
                updated: '2026-08-03T00:00:00.000Z',
              }),
              makeTask('TASK_2026_202', 'backlog', {
                parent: 'TASK_2026_200',
                labels: ['ui'],
                updated: '2026-08-02T00:00:00.000Z',
              }),
            ],
            done: [
              makeTask('TASK_2026_203', 'done', {
                labels: ['licensing'],
                estimate: 'XS',
              }),
            ],
          }),
        ),
      );
      await store.loadBoard();
    }

    it('opens neutral: every task shown, nothing marked as filtered', async () => {
      await loadFixture();

      expect(store.filterActive()).toBe(false);
      expect(store.matchedCount()).toBe(4);
      expect(store.totalIndexed()).toBe(4);
      expect(store.filteredEmpty()).toBe(false);
    });

    it('narrows the columns while the header counters stay INDEXED', async () => {
      await loadFixture();

      store.setFilter({ ...EMPTY_TASK_FILTER, labels: ['LICENSING'] });

      // Columns report the filtered set...
      expect(store.matchedCount()).toBe(2);
      const backlog = store.board().find((c) => c.status === 'backlog');
      expect(backlog?.tasks.map((t) => t.id)).toEqual(['TASK_2026_200']);
      // ...and each column still states what it is hiding.
      expect(backlog?.total).toBe(3);

      // ...while the header counters keep reading `_columns` directly. This
      // asymmetry IS the `23 of 181` contract — do not "fix" it into agreement.
      expect(store.totalCount()).toBe(4);
      expect(store.totalIndexed()).toBe(4);
      expect(store.statusCounts().backlog).toBe(3);
      expect(store.doneCount()).toBe(1);
    });

    /**
     * THE PHASE 4 GATE, half one. Not "no reload" — no CALL of any kind.
     *
     * Every facet is exercised, every derived signal is read, and the
     * microtask queue is drained afterwards so a deferred call could not
     * escape the assertion.
     */
    it('issues ZERO RPC calls for a filter or sort change (FR-C1.4)', async () => {
      await loadFixture();
      rpcCall.mockClear();

      store.setFilter({
        ...EMPTY_TASK_FILTER,
        text: 'title',
        statuses: ['backlog'],
        types: ['FEATURE'],
        labels: ['licensing'],
        labelsMode: 'any',
        estimates: ['M'],
        unestimated: true,
        executors: ['backend-developer'],
        parentage: ['parent', 'child'],
        relations: ['duplicate'],
        hasValidationIssues: false,
      });
      store.setSort({ field: 'title', direction: 'asc' });
      store.showChildrenOf('TASK_2026_200');
      store.clearFilter();

      // Read everything the board, the bar and the columns read.
      store.filtered();
      store.filteredIds();
      store.board();
      store.matchedCount();
      store.totalIndexed();
      store.filterActive();
      store.filteredEmpty();
      store.estimateBuckets();
      store.knownLabels();
      store.knownExecutors();

      await Promise.resolve();
      await Promise.resolve();

      expect(rpcCall).not.toHaveBeenCalled();
    });

    /**
     * THE PHASE 4 GATE, half two.
     *
     * The budget is a frame, and it is a budget on what a KEYSTROKE costs — so
     * the graph is warmed first, exactly as it is on a board the user has been
     * looking at. The identity assertion afterwards is the structural half of
     * the same claim: if a filter signal were ever read inside the graph
     * computed, the graph would be a different object here and the 16 ms would
     * be a rebuild over every task rather than a filter pass.
     */
    it('recomputes 1 000 tasks in under 16 ms without rebuilding the graph', async () => {
      const many = Array.from({ length: 1000 }, (_, i) =>
        makeTask(
          `TASK_2026_${String(i).padStart(4, '0')}`,
          i % 2 === 0 ? 'backlog' : 'in_progress',
          {
            labels: i % 3 === 0 ? ['Licensing'] : ['ui'],
            estimate: i % 5 === 0 ? 'M' : undefined,
            executor: 'backend-developer',
            ...(i > 0 && i % 7 === 0 ? { parent: 'TASK_2026_0000' } : {}),
          },
        ),
      );
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: many.filter((t) => t.status === 'backlog'),
            in_progress: many.filter((t) => t.status === 'in_progress'),
          }),
        ),
      );
      await store.loadBoard();

      // Warm the memoized graph, as a rendered board already has.
      const warmGraph = store.graph();
      expect(store.board()).toHaveLength(TASK_STATUSES.length);

      // A FRESH spec object per run, so the `filtered` / `board` computeds
      // genuinely re-run each time. Reusing one object would leave every
      // iteration after the first reading a memoized value and timing nothing.
      let columns: ReturnType<typeof store.board> = [];
      let matched = 0;
      const elapsed = medianMs(() => {
        store.setFilter({
          ...EMPTY_TASK_FILTER,
          text: 'TASK_2026',
          statuses: ['backlog'],
          types: ['FEATURE'],
          labels: ['licensing'],
          labelsMode: 'any',
          estimates: ['M'],
          unestimated: true,
          executors: ['backend-developer'],
          parentage: ['child', 'standalone'],
        });
        columns = store.board();
        matched = store.matchedCount();
      });

      expect(matched).toBeGreaterThan(0);
      expect(columns.some((column) => column.tasks.length > 0)).toBe(true);
      expect(elapsed).toBeLessThan(FILTER_CEILING_MS);
      // The payload did not move, so neither did the graph. This is the
      // structural half of the check and it is NOT timing-dependent: object
      // identity is what proves the graph computed did not re-run.
      expect(store.graph()).toBe(warmGraph);
    });

    it('sorts every column stably, tie-broken by id', async () => {
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            // Three tasks sharing one `updated` stamp, handed over in an order
            // that is neither ascending nor descending by id.
            backlog: [
              makeTask('TASK_2026_202', 'backlog'),
              makeTask('TASK_2026_200', 'backlog'),
              makeTask('TASK_2026_201', 'backlog'),
            ],
          }),
        ),
      );
      await store.loadBoard();

      const idsOf = (): string[] =>
        store
          .board()
          .find((c) => c.status === 'backlog')
          ?.tasks.map((t) => t.id) ?? [];

      // Default sort is `updated desc`; the stamps are equal, so only the
      // tie-break can decide — and it is ASCENDING by id in both directions.
      expect(idsOf()).toEqual([
        'TASK_2026_200',
        'TASK_2026_201',
        'TASK_2026_202',
      ]);
      store.setSort({ field: 'updated', direction: 'asc' });
      expect(idsOf()).toEqual([
        'TASK_2026_200',
        'TASK_2026_201',
        'TASK_2026_202',
      ]);
    });

    it('survives a reload, because loadBoard only replaces the columns', async () => {
      await loadFixture();
      store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });
      expect(store.matchedCount()).toBe(1);

      await store.loadBoard();

      expect(store.filter().statuses).toEqual(['done']);
      expect(store.matchedCount()).toBe(1);
    });

    it('reports filteredEmpty only when tasks exist but none match', async () => {
      await loadFixture();
      expect(store.filteredEmpty()).toBe(false);

      store.setFilter({ ...EMPTY_TASK_FILTER, text: 'nothing-matches-this' });

      expect(store.matchedCount()).toBe(0);
      expect(store.filteredEmpty()).toBe(true);
      // Distinct from "there are no tasks" — the workspace is still full.
      expect(store.isEmpty()).toBe(false);
      expect(store.totalIndexed()).toBe(4);
    });

    it('never reports filteredEmpty on an empty workspace', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();

      expect(store.isEmpty()).toBe(true);
      expect(store.filteredEmpty()).toBe(false);
    });

    it('showChildrenOf narrows to exactly that parent’s sub-tasks (FR-B3.3)', async () => {
      await loadFixture();

      store.showChildrenOf('TASK_2026_200');

      expect(store.filtered().map((task) => task.id)).toEqual([
        'TASK_2026_201',
        'TASK_2026_202',
      ]);
      // The count on the badge and the number of cards left are the same
      // number, because both are read off the same derived parentage.
      expect(store.graph().rollup.get('TASK_2026_200')?.total).toBe(2);
    });

    it('showChildrenOf keeps the rest of the filter rather than resetting it', async () => {
      await loadFixture();
      store.setFilter({ ...EMPTY_TASK_FILTER, labels: ['ui'] });

      store.showChildrenOf('TASK_2026_200');

      expect(store.filter().labels).toEqual(['ui']);
      expect(store.filtered().map((task) => task.id)).toEqual([
        'TASK_2026_202',
      ]);
    });

    it('counts estimate buckets over the INDEXED set, not the filtered one', async () => {
      await loadFixture();
      store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });

      const buckets = store.estimateBuckets();

      expect(buckets.sized.M).toBe(1);
      expect(buckets.sized.XS).toBe(1);
      expect(buckets.sized.L).toBe(0);
      expect(buckets.unestimated).toBe(2);
    });

    it('clearFilter restores the neutral spec', async () => {
      await loadFixture();
      store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });
      expect(store.filterActive()).toBe(true);

      store.clearFilter();

      expect(store.filter()).toEqual(EMPTY_TASK_FILTER);
      expect(store.filterActive()).toBe(false);
      expect(store.matchedCount()).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // applyMetadata — the single client mutation funnel (Task 5.1)
  // -------------------------------------------------------------------------
  describe('applyMetadata', () => {
    const TASK = 'TASK_2026_200';

    /**
     * The SHARED schema's own message for a patch it refuses.
     *
     * Read out of the schema rather than typed out here on purpose. A literal
     * expectation would be a second copy of the wording, and the whole point of
     * surfacing the issue verbatim is that there is exactly one copy.
     */
    function schemaMessage(patch: TaskMetadataPatch): string {
      const parsed = TaskMetadataPatchSchema.safeParse(patch);
      if (parsed.success) {
        throw new Error('expected the shared schema to refuse this patch');
      }
      return parsed.error.issues[0].message;
    }

    it('writes through tasks:updateMetadata and re-reads the board', async () => {
      const written = makeTask(TASK, 'backlog', { labels: ['licensing'] });
      rpcCall.mockResolvedValueOnce(ok({ success: true, task: written }));
      rpcCall.mockResolvedValueOnce(ok(makeBoard({ backlog: [written] })));

      const result = await store.applyMetadata(TASK, { labels: ['licensing'] });

      expect(result.success).toBe(true);
      expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:updateMetadata', {
        taskId: TASK,
        patch: { labels: ['licensing'] },
      });
      expect(rpcCall).toHaveBeenNthCalledWith(2, 'tasks:board', {});
      expect(store.columns().backlog[0].labels).toEqual(['licensing']);
    });

    it('issues one write and no board fetch under { reload: false }', async () => {
      rpcCall.mockResolvedValue(
        ok({ success: true, task: makeTask(TASK, 'backlog') }),
      );

      await store.applyMetadata(TASK, { estimate: 'M' }, { reload: false });

      expect(rpcCall).toHaveBeenCalledTimes(1);
      expect(rpcCall).toHaveBeenCalledWith('tasks:updateMetadata', {
        taskId: TASK,
        patch: { estimate: 'M' },
      });
    });

    it('sends an emptied array verbatim — key removal is the writer’s decision', async () => {
      rpcCall.mockResolvedValue(
        ok({ success: true, task: makeTask(TASK, 'backlog') }),
      );

      await store.applyMetadata(
        TASK,
        { labels: [], duplicates: [], dependsOn: [] },
        { reload: false },
      );

      // `[]` reaches the wire unchanged for all three. The writer removes the
      // key for `labels` / `duplicates` and still writes `dependsOn: []` — the
      // client does not encode that asymmetry a second time.
      expect(rpcCall).toHaveBeenCalledWith('tasks:updateMetadata', {
        taskId: TASK,
        patch: { labels: [], duplicates: [], dependsOn: [] },
      });
    });

    it('surfaces the structured backend error and reloads nothing', async () => {
      rpcCall.mockResolvedValueOnce(
        ok({
          success: false,
          error: {
            code: 'TASK_CONFLICT',
            message: 'the carrier moved on disk',
          },
        }),
      );

      const result = await store.applyMetadata(TASK, { estimate: 'L' });

      expect(result.success).toBe(false);
      expect(store.error()).toBe('the carrier moved on disk');
      expect(rpcCall).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // The three label limits and the path-segment rule are enforced by the
    // SHARED schema. These assert the behaviour AND that the sentence shown is
    // the schema's own — the RPC boundary collapses every Zod failure to a
    // generic "Invalid task request parameters.", so a caller that only saw
    // that would have nothing to act on.
    // -----------------------------------------------------------------------
    it.each([
      [
        'more labels than the cap allows',
        { labels: Array.from({ length: 13 }, (_, i) => `label-${i}`) },
      ],
      ['a label longer than the cap', { labels: ['x'.repeat(33)] }],
      ['a label carrying a newline', { labels: ['two\nlines'] }],
      ['a blank label', { labels: ['   '] }],
      ['a parent that is not a single path segment', { parent: '../escape' }],
      ['a relation entry with a drive prefix', { relatesTo: ['C:elsewhere'] }],
      ['a patch that asks for nothing', {}],
      ['a patch whose only key is undefined', { labels: undefined }],
    ] as ReadonlyArray<readonly [string, TaskMetadataPatch]>)(
      'refuses %s without issuing a write, quoting the schema verbatim',
      async (_name, patch) => {
        const result = await store.applyMetadata(TASK, patch);

        expect(rpcCall).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_PARAMS');
        expect(result.error?.message).toBe(schemaMessage(patch));
        expect(store.error()).toBe(schemaMessage(patch));
        // Not the RPC boundary's generic text, which is the whole reason the
        // client validates before the round trip.
        expect(store.error()).not.toBe('Invalid task request parameters.');
      },
    );

    // -----------------------------------------------------------------------
    // A write that landed, followed by a re-read that did not.
    //
    // The failure mode being closed: `applyMetadata` rejects, the template
    // handler has no catch, and it becomes an unhandled rejection with NO error
    // set — the user is left looking at stale state with no signal at all, in
    // the batch that first lets them mutate a carrier.
    // -----------------------------------------------------------------------
    describe('when the post-write reload fails', () => {
      /** No write-failure message says this; the refresh message leads with it. */
      const SAVED = 'The change was saved';

      it('resolves as a SUCCESS and never rejects', async () => {
        rpcCall.mockResolvedValueOnce(
          ok({ success: true, task: makeTask(TASK, 'backlog') }),
        );
        rpcCall.mockRejectedValueOnce(new Error('board transport down'));

        // `.resolves` IS the assertion about the unhandled rejection: the
        // rejection was the only way one could arise, and a rejecting promise
        // here fails this line rather than escaping into the event handler.
        await expect(
          store.applyMetadata(TASK, { estimate: 'L' }),
        ).resolves.toEqual(expect.objectContaining({ success: true }));
      });

      it('says the change was saved and the VIEW is stale, not that the write failed', async () => {
        rpcCall.mockResolvedValueOnce(
          ok({ success: true, task: makeTask(TASK, 'backlog') }),
        );
        rpcCall.mockRejectedValueOnce(new Error('board transport down'));

        await store.applyMetadata(TASK, { estimate: 'L' });

        const message = store.error() ?? '';
        // Distinguishable from every write-failure message, and it has to be:
        // telling a user their edit failed when it is already on disk invites
        // them to make it a second time.
        expect(message).toContain(SAVED);
        expect(message).toContain('out of date');
        expect(message).toContain('board transport down');
        expect(message).not.toBe('Failed to update task metadata');
      });

      it('catches a failing DETAIL refresh too, not just the board', async () => {
        rpcCall.mockImplementation((method: string) => {
          if (method === 'tasks:get') {
            return Promise.resolve(
              ok({
                task: {
                  ...makeTask(TASK, 'backlog'),
                  body: '',
                  artifacts: [],
                },
              }),
            );
          }
          return Promise.resolve(ok(makeBoard({})));
        });
        await store.openTask(TASK);
        expect(store.selectedTaskId()).toBe(TASK);

        rpcCall.mockReset();
        rpcCall.mockImplementation((method: string) => {
          if (method === 'tasks:updateMetadata') {
            return Promise.resolve(
              ok({ success: true, task: makeTask(TASK, 'backlog') }),
            );
          }
          if (method === 'tasks:board') {
            return Promise.resolve(ok(makeBoard({})));
          }
          return Promise.reject(new Error('detail transport down'));
        });

        const result = await store.applyMetadata(TASK, { estimate: 'S' });

        expect(result.success).toBe(true);
        expect(store.error()).toContain(SAVED);
        expect(store.error()).toContain('detail transport down');
      });

      it('leaves a genuine WRITE failure reading as a write failure', async () => {
        // The complement: the two messages must not converge.
        rpcCall.mockResolvedValueOnce(
          ok({
            success: false,
            error: { code: 'TASK_CONFLICT', message: 'the carrier moved' },
          }),
        );

        await store.applyMetadata(TASK, { estimate: 'L' });

        expect(store.error()).toBe('the carrier moved');
        expect(store.error()).not.toContain(SAVED);
      });
    });

    it('accepts a patch that sits exactly on the label cap', async () => {
      rpcCall.mockResolvedValue(
        ok({ success: true, task: makeTask(TASK, 'backlog') }),
      );

      const result = await store.applyMetadata(
        TASK,
        { labels: Array.from({ length: 12 }, (_, i) => `label-${i}`) },
        { reload: false },
      );

      expect(result.success).toBe(true);
      expect(rpcCall).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Per-task write serialization (Task 5.1, FR-B5.8) — the Phase 3 gate item
  // "two rapid same-task edits produce ZERO spurious conflicts".
  //
  // The mock below models the ONE thing that actually makes concurrent writes
  // safe: the writer's pre-write re-read. A second write that starts while
  // another is mid-flight sees a file that moved and is refused with
  // TASK_CONFLICT. Serialization does not make the write correct — it removes
  // this UI's ability to trigger that refusal against itself.
  // -------------------------------------------------------------------------
  describe('per-task write serialization', () => {
    const TASK = 'TASK_2026_200';
    const OTHER = 'TASK_2026_201';

    interface WriteHarness {
      /** Writes refused because another write on the SAME task was in flight. */
      conflicts(): number;
      /** Writes currently in flight, across all tasks. */
      pending(): number;
      /** Resolve the oldest in-flight write. */
      settleNext(): void;
    }

    function installWriteMock(): WriteHarness {
      const queue: Array<() => void> = [];
      const active = new Set<string>();
      let conflicts = 0;

      rpcCall.mockImplementation(
        (method: string, params: { taskId?: string }) => {
          if (method !== 'tasks:updateMetadata') {
            return Promise.resolve(ok(makeBoard({})));
          }
          const taskId = params.taskId ?? '';
          if (active.has(taskId)) {
            conflicts++;
            return Promise.resolve(
              ok({
                success: false,
                error: { code: 'TASK_CONFLICT', message: 'the carrier moved' },
              }),
            );
          }
          active.add(taskId);
          return new Promise((resolve) => {
            queue.push(() => {
              active.delete(taskId);
              resolve(ok({ success: true, task: makeTask(taskId, 'backlog') }));
            });
          });
        },
      );

      return {
        conflicts: () => conflicts,
        pending: () => queue.length,
        settleNext: () => {
          const next = queue.shift();
          if (!next) throw new Error('no write is in flight');
          next();
        },
      };
    }

    /** Drain every microtask and timer callback the store may have queued. */
    const settle = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 0));

    async function drain(harness: WriteHarness): Promise<void> {
      for (let guard = 0; guard < 20 && harness.pending() > 0; guard++) {
        harness.settleNext();
        await settle();
      }
    }

    it('produces ZERO spurious conflicts for two rapid edits to one task', async () => {
      const harness = installWriteMock();

      const first = store.applyMetadata(
        TASK,
        { labels: ['a'] },
        { reload: false },
      );
      const second = store.applyMetadata(
        TASK,
        { labels: ['a', 'b'] },
        { reload: false },
      );
      await settle();

      // The second write has NOT been issued — that is the whole mechanism.
      expect(harness.pending()).toBe(1);

      harness.settleNext();
      await settle();
      expect(harness.pending()).toBe(1);
      harness.settleNext();

      expect((await first).success).toBe(true);
      expect((await second).success).toBe(true);
      expect(harness.conflicts()).toBe(0);
      expect(store.error()).toBeNull();
    });

    it('produces ZERO conflicts across a burst of six edits to one task', async () => {
      const harness = installWriteMock();

      const writes = Array.from({ length: 6 }, (_, i) =>
        store.applyMetadata(
          TASK,
          { labels: [`label-${i}`] },
          { reload: false },
        ),
      );
      await settle();
      await drain(harness);

      const results = await Promise.all(writes);
      expect(results.every((r) => r.success)).toBe(true);
      expect(harness.conflicts()).toBe(0);
    });

    // The identity check before `delete`. Write 1 settles while 2 is in flight
    // and 3 is queued; a fourth edit arrives at that moment. Deleting the map
    // entry unconditionally would drop write 3's tail, so write 4 would find no
    // tail and start immediately — overlapping write 2.
    it('keeps the queue intact when an early write settles under later ones', async () => {
      const harness = installWriteMock();

      const one = store.applyMetadata(
        TASK,
        { labels: ['a'] },
        { reload: false },
      );
      const two = store.applyMetadata(
        TASK,
        { labels: ['b'] },
        { reload: false },
      );
      const three = store.applyMetadata(
        TASK,
        { labels: ['c'] },
        { reload: false },
      );
      await settle();

      harness.settleNext();
      await settle();

      const four = store.applyMetadata(
        TASK,
        { labels: ['d'] },
        { reload: false },
      );
      await settle();

      await drain(harness);
      const results = await Promise.all([one, two, three, four]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(harness.conflicts()).toBe(0);
    });

    // A predecessor that REJECTS must not leave every later write on that task
    // waiting on a promise that never fulfils.
    //
    // Exercised against the queue primitive directly, because no production op
    // can reach this path any more: `writeMetadata` guards both its RPC call
    // and its post-write reload, so it resolves with a typed failure instead of
    // throwing. The primitive's contract still has to hold for the ops Batches
    // 7, 9, 12 and 14 will add, and going through the private member is the
    // only honest way left to state it — the alternative is deleting a
    // guarantee because today's only caller happens not to need it.
    it('does not wedge the queue when a predecessor rejects', async () => {
      const queue = store as unknown as {
        enqueueWrite<T>(taskId: string, op: () => Promise<T>): Promise<T>;
      };
      const order: string[] = [];

      const first = queue.enqueueWrite(TASK, async () => {
        order.push('first');
        throw new Error('op failed');
      });
      const second = queue.enqueueWrite(TASK, async () => {
        order.push('second');
        return 'ok';
      });

      await expect(first).rejects.toThrow('op failed');
      await expect(second).resolves.toBe('ok');
      // Still serialized, not merely still running.
      expect(order).toEqual(['first', 'second']);
    });

    // The queue is per CARRIER, not global. Two tasks are two conflict domains,
    // and serializing them against each other would make a bulk run N times
    // slower for no correctness gain.
    it('does not serialize writes to different tasks against each other', async () => {
      const harness = installWriteMock();

      const here = store.applyMetadata(
        TASK,
        { labels: ['a'] },
        { reload: false },
      );
      const there = store.applyMetadata(
        OTHER,
        { labels: ['b'] },
        { reload: false },
      );
      await settle();

      expect(harness.pending()).toBe(2);

      await drain(harness);
      expect((await here).success).toBe(true);
      expect((await there).success).toBe(true);
      expect(harness.conflicts()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// TasksStore — workspace awareness
//
// The Electron shell keeps this page mounted across workspace switches. These
// tests cover: explicit `workspaceRoot` on every scoped RPC, board reload on
// switch, instant cached repaint on switch-back, the switched-away race guard,
// and `tasks:changed` push routing by workspace root.
// ---------------------------------------------------------------------------

type Ws = { path: string; name: string; type: string };

describe('TasksStore — workspace awareness', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;
  let workspaceInfo: ReturnType<typeof signal<Ws | null>>;

  const wsA: Ws = { path: 'D:/ws-a', name: 'a', type: 'workspace' };
  const wsB: Ws = { path: 'D:/ws-b', name: 'b', type: 'workspace' };

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        { provide: AppStateManager, useValue: { workspaceInfo } },
      ],
    });
    store = TestBed.inject(TasksStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    rpcCall = jest.fn().mockResolvedValue(ok(makeBoard({})));
    workspaceInfo = signal<Ws | null>(wsA);
  });

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('sends the active workspaceRoot on every tasks RPC that supports it', async () => {
    configure();

    await store.loadBoard();
    expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(ok({ task: null }));
    await store.openTask('TASK_2026_200');
    expect(rpcCall).toHaveBeenCalledWith('tasks:get', {
      taskId: 'TASK_2026_200',
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(ok({ success: true }));
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.updateStatus('TASK_2026_200', 'done');
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:updateMetadata', {
      taskId: 'TASK_2026_200',
      patch: { status: 'done' },
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_201', 'backlog') }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.createTask({ title: 'New', type: 'FEATURE' });
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:create', {
      title: 'New',
      type: 'FEATURE',
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, indexedCount: 1, excludedCount: 0, durationMs: 5 }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.reindex();
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:reindex', {
      workspaceRoot: 'D:/ws-a',
    });
  });

  it('reloads the board with the new workspaceRoot when the workspace switches', async () => {
    configure();
    TestBed.tick(); // first effect run only records the current key
    await store.loadBoard();
    expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(store.columns().done).toHaveLength(1);
  });

  it('paints the cached board instantly on switch-back, before the refetch resolves', async () => {
    configure();
    TestBed.tick();

    rpcCall.mockResolvedValue(
      ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
    );
    await store.loadBoard(); // ws-a → backlog A (cached)
    expect(store.columns().backlog).toHaveLength(1);

    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush();
    expect(store.columns().done).toHaveLength(1);
    expect(store.columns().backlog).toHaveLength(0);

    // Switch back to ws-a: the refetch is deferred so we can assert the cached
    // slice is painted synchronously by the effect tick.
    let resolveA: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation(
      () =>
        new Promise((r) => {
          resolveA = r;
        }),
    );
    workspaceInfo.set(wsA);
    TestBed.tick();
    expect(store.columns().backlog).toHaveLength(1);
    expect(store.columns().done).toHaveLength(0);

    resolveA(ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })));
    await flush();
  });

  it('does not let a slow response for a switched-away workspace overwrite the active board', async () => {
    configure();
    TestBed.tick();

    let resolveB: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation(
      (_method: string, params: { workspaceRoot?: string }) => {
        if (params.workspaceRoot === 'D:/ws-b') {
          return new Promise((r) => {
            resolveB = r;
          });
        }
        return Promise.resolve(
          ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
        );
      },
    );

    await store.loadBoard(); // ws-a → backlog A
    expect(store.columns().backlog).toHaveLength(1);

    workspaceInfo.set(wsB); // ws-b response is deferred
    TestBed.tick();
    await flush();

    workspaceInfo.set(wsA); // switch back before ws-b resolves
    TestBed.tick();
    await flush();
    expect(store.columns().backlog).toHaveLength(1);

    // The late ws-b response applies to ws-b's cache slice only — not the view.
    resolveB(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    await flush();
    expect(store.columns().done).toHaveLength(0);
    expect(store.columns().backlog).toHaveLength(1);
  });

  it('routes a tasks:changed push to the correct workspace slice', async () => {
    configure();
    TestBed.tick();

    rpcCall.mockResolvedValue(
      ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
    );
    await store.loadBoard(); // ws-a (cached)
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush(); // ws-b (cached)
    workspaceInfo.set(wsA);
    TestBed.tick();
    await flush(); // back on ws-a

    // A background (ws-b) change refreshes only ws-b's slice.
    rpcCall.mockClear();
    store.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: 'D:/ws-b', reason: 'watcher' },
    });
    await flush();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(rpcCall).not.toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    // A change for the active workspace refreshes the visible board.
    rpcCall.mockClear();
    store.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: 'D:/ws-a', reason: 'write' },
    });
    await flush();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });
  });

  // Issue 4 — same-workspace out-of-order board responses: the older one loses.
  it('drops an older same-workspace board response so it cannot overwrite a newer one', async () => {
    configure();
    TestBed.tick(); // first effect flush only records the baseline

    // Two concurrent fetches for the SAME workspace (ws-a) — capture both
    // resolvers so we can settle the newer one first, then the older late.
    const resolvers: ((v: unknown) => void)[] = [];
    rpcCall.mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );

    const first = store.loadBoard(); // ws-a seq 1
    const second = store.loadBoard(); // ws-a seq 2
    expect(resolvers).toHaveLength(2);

    // The NEWER (second) request resolves first with board B.
    resolvers[1](ok(makeBoard({ done: [makeTask('B', 'done')] })));
    await second;
    expect(store.columns().done).toHaveLength(1);

    // The OLDER (first) request resolves late with board A — must be ignored.
    resolvers[0](ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })));
    await first;
    expect(store.columns().done).toHaveLength(1);
    expect(store.columns().backlog).toHaveLength(0);
  });

  // Issue 2 — double-click openTask: the slower (earlier) response is dropped.
  it('drops a slower detail response when a newer task was opened (double-click)', async () => {
    configure();
    const resolvers: Record<string, (v: unknown) => void> = {};
    rpcCall.mockImplementation(
      (method: string, params: { taskId?: string }) => {
        if (method === 'tasks:get' && params.taskId) {
          return new Promise((r) => {
            resolvers[params.taskId as string] = r;
          });
        }
        return Promise.resolve(ok(makeBoard({})));
      },
    );

    const p1 = store.openTask('T1');
    const p2 = store.openTask('T2');
    expect(store.selectedTaskId()).toBe('T2');

    // Resolve the newer request (T2) first — its detail must land.
    resolvers['T2'](
      ok({ task: { ...makeTask('T2', 'backlog'), body: 'B2', artifacts: [] } }),
    );
    await p2;
    expect(store.taskDetail()?.body).toBe('B2');

    // The older request (T1) resolves late — it must NOT clobber T2's detail.
    resolvers['T1'](
      ok({ task: { ...makeTask('T1', 'backlog'), body: 'B1', artifacts: [] } }),
    );
    await p1;
    expect(store.selectedTaskId()).toBe('T2');
    expect(store.taskDetail()?.body).toBe('B2');
  });

  // Issue 2 — a detail response that lands after closeTask() must be dropped
  // (covers the workspace-switch-mid-fetch case: onWorkspaceSwitch → closeTask).
  it('drops a detail response that resolves after closeTask()', async () => {
    configure();
    let resolveGet: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation((method: string) => {
      if (method === 'tasks:get') {
        return new Promise((r) => {
          resolveGet = r;
        });
      }
      return Promise.resolve(ok(makeBoard({})));
    });

    const p = store.openTask('T1');
    store.closeTask();
    expect(store.selectedTaskId()).toBeNull();

    resolveGet(
      ok({ task: { ...makeTask('T1', 'backlog'), body: 'B1', artifacts: [] } }),
    );
    await p;
    expect(store.taskDetail()).toBeNull();
    expect(store.selectedTaskId()).toBeNull();
  });

  // Issue 7 — baseline-mismatch-at-first-flush: a switch that lands between
  // construction and the effect's first flush is a real switch, not a silent
  // baseline recording.
  it('fetches for the post-switch workspace when a switch races the first flush', async () => {
    configure(); // constructs the store, seeding the baseline key from ws-a

    // Switch BEFORE the effect's first flush. The pre-fix code recorded the new
    // key on first emission and returned (no fetch); the fix seeds the baseline
    // at construction so the mismatch is treated as a switch.
    workspaceInfo.set(wsB);
    rpcCall.mockClear();
    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));

    TestBed.tick();
    await flush();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(store.columns().done).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Selection + bulk status (FR-C4) — Batch 12
// ---------------------------------------------------------------------------
describe('TasksStore — selection and bulk status', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;

  /** Every `tasks:board` call the spy has seen — the R5 counter. */
  const boardCalls = (): unknown[][] =>
    rpcCall.mock.calls.filter((call) => call[0] === 'tasks:board');

  const bulkCalls = (): unknown[][] =>
    rpcCall.mock.calls.filter((call) => call[0] === 'tasks:bulkUpdateStatus');

  /** `n` backlog tasks, ids in ascending order. */
  function tasks(count: number, prefix = 'TASK_2026_'): TaskSpecSummary[] {
    return Array.from({ length: count }, (_, index) =>
      makeTask(`${prefix}${String(index).padStart(3, '0')}`, 'backlog'),
    );
  }

  /**
   * Answer `tasks:bulkUpdateStatus` per id, and `tasks:board` with `payload`.
   *
   * `outcome` decides each id's entry, so a test states its failure shape
   * rather than assembling result lists by hand.
   */
  function installBulkMock(
    payload: TasksBoardResult,
    outcome: (taskId: string) => TasksBulkResultItem = (taskId) => ({
      taskId,
      ok: true,
    }),
  ): void {
    rpcCall.mockImplementation(
      (method: string, params: { taskIds?: string[] }) => {
        if (method === 'tasks:bulkUpdateStatus') {
          return Promise.resolve(
            ok({ results: (params.taskIds ?? []).map(outcome) }),
          );
        }
        return Promise.resolve(ok(payload));
      },
    );
  }

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    store = TestBed.inject(TasksStore);
  });

  // -------------------------------------------------------------------------
  // The selection model (FR-C4.1–4.2) — Task 12.1
  // -------------------------------------------------------------------------
  describe('selection', () => {
    beforeEach(async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(5) })));
      await store.loadBoard();
    });

    it('toggles one task on and off', () => {
      store.toggleSelection('TASK_2026_001');
      expect([...store.selection()]).toEqual(['TASK_2026_001']);
      store.toggleSelection('TASK_2026_001');
      expect([...store.selection()]).toEqual([]);
    });

    /**
     * The independence contract, in the one direction that is easy to break by
     * accident: a selection gesture must not open the detail panel.
     */
    it('opens no detail panel and closes none', async () => {
      await store.openTask('TASK_2026_000');
      store.toggleSelection('TASK_2026_001');
      expect(store.selectedTaskId()).toBe('TASK_2026_000');

      store.clearSelection();
      expect(store.selectedTaskId()).toBe('TASK_2026_000');
      expect(store.selectionCount()).toBe(0);
    });

    it('extends a range across the visible, sorted order from the anchor', () => {
      store.toggleSelection('TASK_2026_001');
      store.selectRangeTo('TASK_2026_003');

      expect([...store.selection()].sort()).toEqual([
        'TASK_2026_001',
        'TASK_2026_002',
        'TASK_2026_003',
      ]);
    });

    /**
     * The range means what the user SEES — resolved against the SORT.
     *
     * ## Reversing the sort would NOT have tested anything
     *
     * The first version of this asserted a `desc` id sort, and it could not
     * fail: the set of ids lying between two endpoints is identical in a list
     * and in its reverse, so the assertion held against `allTasks()` just as
     * well as against `visibleOrder()`. It was green and worthless.
     *
     * A sort that REORDERS rather than reverses is what discriminates. The
     * `updated` stamps below are deliberately shuffled, so the rendered order
     * is `004, 001, 003, 000, 002` — and the range from 004 to 003 is
     * `{001, 003, 004}` on screen against `{003, 004}` in payload order, where
     * the two ids sit adjacent.
     *
     * The two answers differ by ONE task — `TASK_2026_001` — and that one is
     * the whole test. An earlier version of this comment claimed two, which
     * overstated it: the payload-order answer is a SUBSET here, not a different
     * span. One wrongly-written carrier is still a wrongly-written carrier, and
     * the mutation below confirms the assertion moves on exactly that id.
     */
    it('resolves a range against the SORTED order, not the payload order', async () => {
      const stamps = [
        '2026-08-01T00:00:02.000Z',
        '2026-08-01T00:00:04.000Z',
        '2026-08-01T00:00:01.000Z',
        '2026-08-01T00:00:03.000Z',
        '2026-08-01T00:00:05.000Z',
      ];
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: stamps.map((updated, index) =>
              makeTask(`TASK_2026_00${index}`, 'backlog', { updated }),
            ),
          }),
        ),
      );
      await store.loadBoard();
      store.setSort({ field: 'updated', direction: 'desc' });

      expect(store.visibleOrder()).toEqual([
        'TASK_2026_004',
        'TASK_2026_001',
        'TASK_2026_003',
        'TASK_2026_000',
        'TASK_2026_002',
      ]);

      store.toggleSelection('TASK_2026_004');
      store.selectRangeTo('TASK_2026_003');

      expect([...store.selection()].sort()).toEqual([
        'TASK_2026_001',
        'TASK_2026_003',
        'TASK_2026_004',
      ]);
    });

    /**
     * …and against the FILTER. A hidden task is not "between" two visible ones
     * as far as the user can tell, so a range must step over it rather than
     * write a carrier that is not on screen.
     */
    it('steps over a filtered-away task inside a range', async () => {
      // 002 is hidden by a LABEL facet, so it stays in the middle of the
      // payload order while leaving the middle of the rendered one. Hiding it
      // by status would not discriminate: the status columns flatten in
      // TASK_STATUSES order, which would move it past both endpoints and make
      // the two answers agree by accident.
      rpcCall.mockResolvedValue(
        ok(
          makeBoard({
            backlog: [0, 1, 2, 3].map((index) =>
              makeTask(`TASK_2026_00${index}`, 'backlog', {
                labels: index === 2 ? [] : ['keep'],
              }),
            ),
          }),
        ),
      );
      await store.loadBoard();
      store.setFilter({ ...EMPTY_TASK_FILTER, labels: ['keep'] });
      expect(store.visibleOrder()).toEqual([
        'TASK_2026_000',
        'TASK_2026_001',
        'TASK_2026_003',
      ]);

      store.toggleSelection('TASK_2026_001');
      store.selectRangeTo('TASK_2026_003');

      expect([...store.selection()].sort()).toEqual([
        'TASK_2026_001',
        'TASK_2026_003',
      ]);
    });

    it('honours the filter in select-all-matching', () => {
      store.selectAllMatching();
      expect(store.selectionCount()).toBe(5);

      store.clearSelection();
      store.setFilter({ ...EMPTY_TASK_FILTER, text: 'TASK_2026_003' });
      store.selectAllMatching();
      expect([...store.selection()]).toEqual(['TASK_2026_003']);
    });

    it('degrades a range with no anchor to a plain toggle', () => {
      store.selectRangeTo('TASK_2026_002');
      expect([...store.selection()]).toEqual(['TASK_2026_002']);
    });

    /**
     * A selection the filter hides is REPORTED, never silently pruned — see
     * `hiddenSelectionCount`. Pruning here would discard the user's work with
     * no undo; saying nothing would write carriers they cannot see.
     */
    it('keeps a filtered-away selection and counts it as hidden', () => {
      store.selectAllMatching();
      expect(store.selectionCount()).toBe(5);

      store.setFilter({ ...EMPTY_TASK_FILTER, text: 'TASK_2026_003' });

      expect(store.selectionCount()).toBe(5);
      expect(store.hiddenSelectionCount()).toBe(4);
    });

    /**
     * A task that has LEFT the index is a different case, and it is pruned: it
     * is not hidden, it is gone, and a count that can never be acted on is a
     * count nobody can correct.
     */
    it('prunes ids the reloaded board no longer holds', async () => {
      store.selectAllMatching();
      expect(store.selectionCount()).toBe(5);

      rpcCall.mockResolvedValue(
        ok(makeBoard({ backlog: tasks(5).slice(0, 2) })),
      );
      await store.loadBoard();

      expect([...store.selection()].sort()).toEqual([
        'TASK_2026_000',
        'TASK_2026_001',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // The chunked loop, and the ≤ 1 reload it is held to (Task 12.3 / R5)
  // -------------------------------------------------------------------------
  describe('bulkUpdateStatus', () => {
    /**
     * THE assertion of this batch (R5 / FR-C4.10).
     *
     * Fifty ids is three chunks at BULK_CHUNK_SIZE = 20, and the mock fires a
     * `tasks:changed` push after EVERY chunk — which is what the backend
     * actually does, once per call, from `rebuildAfterBulk`. Both fronts are
     * under test at once: the loop must not reload, and the push handler must
     * not reload on its behalf.
     *
     * `toBeLessThanOrEqual(1)`, not "about one". The number this replaces is
     * four.
     */
    it('issues at most ONE tasks:board call for a 50-task bulk with a push after every chunk', async () => {
      const fifty = tasks(50);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: fifty })));
      await store.loadBoard();
      store.selectAllMatching();
      expect(store.selectionCount()).toBe(50);

      installBulkMock(makeBoard({ backlog: fifty }));
      // Every chunk's response is followed by the push the backend sends.
      const withPush = rpcCall.getMockImplementation();
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        const result = await (
          withPush as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') {
          store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
        }
        return result;
      });
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(bulkCalls()).toHaveLength(3);
      expect(boardCalls().length).toBeLessThanOrEqual(1);
    });

    it('chunks the selection at BULK_CHUNK_SIZE and never sends more', async () => {
      const fifty = tasks(50);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: fifty })));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(makeBoard({ backlog: fifty }));

      await store.bulkUpdateStatus('in_review');

      const sizes = bulkCalls().map(
        (call) => (call[1] as { taskIds: string[] }).taskIds.length,
      );
      expect(sizes).toEqual([BULK_CHUNK_SIZE, BULK_CHUNK_SIZE, 10]);
      for (const size of sizes) {
        expect(size).toBeLessThanOrEqual(BULK_CHUNK_SIZE);
      }
    });

    /**
     * FR-C4.6 — the split that makes a partial outcome usable.
     *
     * Two of five refuse. The three that landed leave the selection so the user
     * is not offered them again; the two that did not stay in it so Retry has
     * something to aim at.
     */
    it('deselects successes and keeps failures selected', async () => {
      const five = tasks(5);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: five })));
      await store.loadBoard();
      store.selectAllMatching();

      installBulkMock(makeBoard({ backlog: five }), (taskId) =>
        taskId === 'TASK_2026_001' || taskId === 'TASK_2026_003'
          ? {
              taskId,
              ok: false,
              error: { code: 'TASK_CONFLICT', message: 'the carrier moved' },
              currentStatus: 'in_review',
            }
          : { taskId, ok: true },
      );

      await store.bulkUpdateStatus('done');

      expect([...store.selection()].sort()).toEqual([
        'TASK_2026_001',
        'TASK_2026_003',
      ]);
      const summary = store.bulkSummary();
      expect(summary?.succeeded).toBe(3);
      expect(summary?.failures.map((failure) => failure.taskId)).toEqual([
        'TASK_2026_001',
        'TASK_2026_003',
      ]);
    });

    /** FR-C4.7 — the conflict's on-disk status survives into the summary. */
    it('carries currentStatus through to the failure summary', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(1) })));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(makeBoard({ backlog: tasks(1) }), (taskId) => ({
        taskId,
        ok: false,
        error: { code: 'TASK_CONFLICT', message: 'the carrier moved' },
        currentStatus: 'blocked',
      }));

      await store.bulkUpdateStatus('done');

      const failure = store.bulkSummary()?.failures[0];
      expect(failure?.currentStatus).toBe('blocked');
      expect(failure?.message).toBe('the carrier moved');
      expect(failure?.title).toBe('Title TASK_2026_000');
    });

    /** FR-C4.8 — nothing re-issues a failed write. */
    it('never re-issues a failed write on its own', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(3) })));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(makeBoard({ backlog: tasks(3) }), (taskId) => ({
        taskId,
        ok: false,
        error: { code: 'WRITE_FAILED', message: 'the write was refused' },
      }));
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(bulkCalls()).toHaveLength(1);
    });

    /**
     * FR-C4.9 — cancellation is chunk-granular, and the three groups it
     * produces are kept apart.
     *
     * Cancel fires from inside the first chunk's response, so the second chunk
     * is never issued. The twenty that were written are gone from the
     * selection; the twenty that were not stay in it and are counted as
     * NEITHER succeeded nor failed — reporting them as failures would tell the
     * user twenty tasks broke when they pressed Cancel.
     */
    it('stops between chunks, leaving un-attempted tasks selected and uncounted', async () => {
      const forty = tasks(40);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: forty })));
      await store.loadBoard();
      store.selectAllMatching();

      installBulkMock(makeBoard({ backlog: forty }));
      const inner = rpcCall.getMockImplementation();
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        const result = await (
          inner as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') store.cancelBulk();
        return result;
      });
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(bulkCalls()).toHaveLength(1);
      const summary = store.bulkSummary();
      expect(summary?.cancelled).toBe(true);
      expect(summary?.attempted).toBe(BULK_CHUNK_SIZE);
      expect(summary?.requested).toBe(40);
      expect(summary?.succeeded).toBe(BULK_CHUNK_SIZE);
      expect(summary?.failures).toEqual([]);
      expect(store.selectionCount()).toBe(20);

      // The third group is recorded as its OWN list, not merged into failures.
      expect(summary?.untouched).toHaveLength(20);
      expect(summary?.untouched[0].taskId).toBe('TASK_2026_020');
      // Every requested task lands in exactly one group — the invariant that
      // makes the report complete.
      expect(
        (summary?.succeeded ?? 0) +
          (summary?.failures.length ?? 0) +
          (summary?.untouched.length ?? 0),
      ).toBe(summary?.requested);
    });

    /**
     * The board's half of the three-group split.
     *
     * After a cancelled run both groups leave a card CHECKED, so without this
     * map they are one visual state carrying two meanings. A run that mixes a
     * refusal and a cancellation is the only fixture that can tell them apart.
     */
    it('reports failed and untouched as distinct per-card outcomes', async () => {
      const forty = tasks(40);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: forty })));
      await store.loadBoard();
      store.selectAllMatching();

      installBulkMock(makeBoard({ backlog: forty }), (taskId) =>
        taskId === 'TASK_2026_005'
          ? {
              taskId,
              ok: false,
              error: { code: 'TASK_CONFLICT', message: 'the carrier moved' },
              currentStatus: 'in_review',
            }
          : { taskId, ok: true },
      );
      const inner = rpcCall.getMockImplementation();
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        const result = await (
          inner as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') store.cancelBulk();
        return result;
      });

      await store.bulkUpdateStatus('done');

      const outcomes = store.lastRunOutcomes();
      expect(outcomes.get('TASK_2026_005')).toBe('failed');
      expect(outcomes.get('TASK_2026_020')).toBe('untouched');
      // A task that SUCCEEDED is not in the map at all — it is no longer
      // selected, so there is nothing about it left to explain.
      expect(outcomes.has('TASK_2026_000')).toBe(false);
    });

    it('empties the per-card outcomes when the summary is dismissed', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(2) })));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(makeBoard({ backlog: tasks(2) }), (taskId) => ({
        taskId,
        ok: false,
        error: { code: 'WRITE_FAILED', message: 'the write was refused' },
      }));

      await store.bulkUpdateStatus('done');
      expect(store.lastRunOutcomes().size).toBe(2);

      store.clearBulkSummary();
      expect(store.lastRunOutcomes().size).toBe(0);
    });

    /**
     * A transport failure is not an answer about any one task, but every task
     * still needs one — otherwise ids silently vanish out of the run.
     */
    it('turns a failed chunk call into one failure entry per requested id', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(3) })));
      await store.loadBoard();
      store.selectAllMatching();

      rpcCall.mockImplementation((method: string) =>
        method === 'tasks:bulkUpdateStatus'
          ? Promise.resolve(err('the host is unreachable'))
          : Promise.resolve(ok(makeBoard({ backlog: tasks(3) }))),
      );

      await store.bulkUpdateStatus('done');

      const summary = store.bulkSummary();
      expect(summary?.failures).toHaveLength(3);
      expect(summary?.succeeded).toBe(0);
      expect(summary?.failures[0].message).toBe('the host is unreachable');
      expect(store.selectionCount()).toBe(3);
    });

    it('refuses to start a second run while one is in flight', async () => {
      const twenty = tasks(20);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: twenty })));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(makeBoard({ backlog: twenty }));
      rpcCall.mockClear();

      const first = store.bulkUpdateStatus('done');
      await store.bulkUpdateStatus('blocked');
      await first;

      expect(bulkCalls()).toHaveLength(1);
      expect((bulkCalls()[0][1] as { status: string }).status).toBe('done');
    });
  });

  // -------------------------------------------------------------------------
  // Push suppression (front b) — the one most likely to pass for the wrong
  // reason, so it is pinned from both sides.
  // -------------------------------------------------------------------------
  describe('tasks:changed suppression during a run', () => {
    it('reloads the board when a push arrives OUTSIDE a run', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(1) })));
      await store.loadBoard();
      rpcCall.mockClear();

      store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
      await Promise.resolve();
      await Promise.resolve();

      expect(boardCalls()).toHaveLength(1);
    });

    /**
     * The control for the assertion above: the SAME push, delivered while a run
     * is in flight, must not reload. Without both halves, "the push handler is
     * suppressed" is satisfied by a handler that never worked at all.
     */
    it('drops the same push while a run is in flight', async () => {
      const twenty = tasks(20);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: twenty })));
      await store.loadBoard();
      store.selectAllMatching();

      installBulkMock(makeBoard({ backlog: twenty }));
      const inner = rpcCall.getMockImplementation();
      let boardCallsDuringRun = -1;
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        const result = await (
          inner as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') {
          store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
          await Promise.resolve();
          await Promise.resolve();
          boardCallsDuringRun = boardCalls().length;
        }
        return result;
      });
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      // Measured INSIDE the run, before the finally's own reload — so a
      // reload that merely arrives late cannot be mistaken for suppression.
      expect(boardCallsDuringRun).toBe(0);
      expect(boardCalls()).toHaveLength(1);
    });

    /**
     * The THIRD front, which I wrongly reported as untestable.
     *
     * I claimed jsdom would not deliver these events here and chose to disclose
     * the gap rather than imply the guard was pinned. The disclosure was
     * factually wrong: this same file already dispatches `focus` and
     * `visibilitychange` successfully, twice, in the reconcile block above. The
     * coverage was available the whole time.
     *
     * The guard itself is real. `reconcile()` short-circuits on `_loading` and
     * `_loaded`, and NEITHER is set during a bulk run — the run does not touch
     * `_loading` — so a window regaining focus mid-run walks straight into
     * `loadBoard()` unless `_bulk()` stops it. That is a second board fetch
     * during a run that is only allowed one, from an input no push suppression
     * covers.
     */
    it('ignores a focus event that arrives mid-run', async () => {
      const twenty = tasks(20);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: twenty })));
      await store.loadBoard();
      store.selectAllMatching();

      installBulkMock(makeBoard({ backlog: twenty }));
      const inner = rpcCall.getMockImplementation();
      let boardCallsDuringRun = -1;
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        const result = await (
          inner as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') {
          window.dispatchEvent(new Event('focus'));
          await Promise.resolve();
          await Promise.resolve();
          boardCallsDuringRun = boardCalls().length;
        }
        return result;
      });
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(boardCallsDuringRun).toBe(0);
      expect(boardCalls().length).toBeLessThanOrEqual(1);
    });

    /**
     * The control for it: the same event, outside a run, still reconciles. Two
     * halves again — without this, "focus is ignored during a run" is satisfied
     * by a reconcile that never worked.
     */
    it('still reconciles on focus outside a run', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: tasks(1) })));
      await store.loadBoard();
      rpcCall.mockClear();

      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();

      expect(boardCalls()).toHaveLength(1);
    });

    /**
     * What the suppression OWES, and the only consumer of the missed-push flag.
     *
     * The open task here is NOT in the run, so the board reload is the only
     * thing the run itself would refresh — and `loadBoard` does not touch the
     * detail panel. A push dropped during the run therefore has exactly one
     * path back: the flag. Drop the flag and this detail sits stale forever,
     * with no later push to correct it.
     */
    it('refreshes the open detail after the run when a push was dropped', async () => {
      const five = tasks(5);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: five })));
      await store.loadBoard();
      await store.openTask('TASK_2026_004');
      store.toggleSelection('TASK_2026_000');

      installBulkMock(makeBoard({ backlog: five }));
      const inner = rpcCall.getMockImplementation();
      rpcCall.mockImplementation(async (method: string, params: unknown) => {
        if (method === 'tasks:get') {
          return Promise.resolve(
            ok({ task: { id: 'TASK_2026_004' } as unknown }),
          );
        }
        const result = await (
          inner as (m: string, p: unknown) => Promise<unknown>
        )(method, params);
        if (method === 'tasks:bulkUpdateStatus') {
          store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
        }
        return result;
      });
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(
        rpcCall.mock.calls.filter((call) => call[0] === 'tasks:get'),
      ).toHaveLength(1);
      expect(boardCalls().length).toBeLessThanOrEqual(1);
    });

    it('leaves an unrelated open detail alone when no push was dropped', async () => {
      const five = tasks(5);
      rpcCall.mockResolvedValue(ok(makeBoard({ backlog: five })));
      await store.loadBoard();
      await store.openTask('TASK_2026_004');
      store.toggleSelection('TASK_2026_000');
      installBulkMock(makeBoard({ backlog: five }));
      rpcCall.mockClear();

      await store.bulkUpdateStatus('done');

      expect(
        rpcCall.mock.calls.filter((call) => call[0] === 'tasks:get'),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // The confirmation gate (FR-C4.12) — Task 12.4's rule, enforced in the store
  // so the palette cannot route around it (FR-C6.7).
  // -------------------------------------------------------------------------
  describe('requestBulkStatus', () => {
    async function selectN(count: number): Promise<void> {
      const board = makeBoard({ backlog: tasks(count) });
      rpcCall.mockResolvedValue(ok(board));
      await store.loadBoard();
      store.selectAllMatching();
      installBulkMock(board);
      rpcCall.mockClear();
    }

    it(`runs immediately at exactly ${BULK_CONFIRM_THRESHOLD}`, async () => {
      await selectN(BULK_CONFIRM_THRESHOLD);

      store.requestBulkStatus('done');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(store.bulkRequest()).toBeNull();
      expect(bulkCalls().length).toBeGreaterThan(0);
    });

    it(`asks first at ${BULK_CONFIRM_THRESHOLD + 1}, and writes nothing until confirmed`, async () => {
      await selectN(BULK_CONFIRM_THRESHOLD + 1);

      store.requestBulkStatus('done');
      await Promise.resolve();

      expect(store.bulkRequest()).toBe('done');
      expect(bulkCalls()).toEqual([]);

      store.confirmBulkRequest();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(store.bulkRequest()).toBeNull();
      expect(bulkCalls().length).toBeGreaterThan(0);
    });

    it('discards the pending request without touching the selection', async () => {
      await selectN(BULK_CONFIRM_THRESHOLD + 1);
      store.requestBulkStatus('done');

      store.cancelBulkRequest();
      await Promise.resolve();

      expect(store.bulkRequest()).toBeNull();
      expect(bulkCalls()).toEqual([]);
      expect(store.selectionCount()).toBe(BULK_CONFIRM_THRESHOLD + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeRootKey — backend parity (Issue 6)
//
// The frontend key mirrors the *equivalence classes* of the backend
// `normalizeWorkspaceRoot`
// (libs/backend/task-specs/src/lib/normalize-workspace-root.ts): the same
// workspace, however its path string arrives, must collapse to one key. It is
// NOT a byte-identical string — the backend keeps the OS-native separator via
// `path.resolve`, while the frontend cannot import node `path`, so it unifies
// separators to `/`. Only the grouping must stay in parity; if the backend
// normalization changes, update these expectations to match.
// ---------------------------------------------------------------------------
describe('normalizeRootKey — backend parity', () => {
  const CANONICAL = 'd:/projects/ws';

  it.each([
    ['D:\\projects\\ws', 'back-slashed, upper drive'],
    ['D:\\projects\\ws\\', 'trailing separator'],
    ['D:/projects/ws', 'forward slashes'],
    ['d:\\projects\\ws', 'lower drive'],
    ['d:/projects/ws/', 'lower drive + trailing'],
    ['D:\\projects/ws', 'mixed separators'],
  ])('collapses "%s" (%s) to the shared workspace key', (input) => {
    expect(normalizeRootKey(input)).toBe(CANONICAL);
  });

  it('is idempotent on an already-canonical key', () => {
    expect(normalizeRootKey(CANONICAL)).toBe(CANONICAL);
  });
});
