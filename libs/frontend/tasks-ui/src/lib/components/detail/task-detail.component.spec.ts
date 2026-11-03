import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AppStateManager } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  CONTEXT_FILE,
  LEGACY_BATCHES_FILE,
  buildTaskGraph,
  type TaskGraph,
  type TaskLinkedSession,
  type TaskSpecDetail,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { TaskAgentDiscoveryService } from '../../services/task-agent-discovery.service';
import {
  buildRootFolderEntries,
  folderBreadcrumbs,
  rootEntriesOf,
  type TaskFolderBreadcrumb,
  type TaskFolderEntry,
} from '../../services/task-folder-entries';
import type {
  TaskDocumentState,
  TaskFolderListing,
} from '../../services/task-folder.store';
import { TaskSessionLinksService } from '../../services/task-session-links.service';
import { TasksStore } from '../../services/tasks-store.service';
import type { TaskAgentTarget } from '../../types/task-agent.types';
import { TaskDetailComponent } from './task-detail.component';

function makeDetail(overrides: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'in_progress',
    type: 'FEATURE',
    title: 'Board detail',
    dependsOn: ['TASK_2026_100'],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: '2026-07-14T10:00:00.000Z',
    updated: '2026-07-14T11:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    body: '# Heading\n\nSome body copy.',
    artifacts: [CARRIER_FILE, CONTEXT_FILE],
    ...overrides,
  };
}

/** A board-visible sibling, for graph fixtures. */
function makeSummary(
  id: string,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status: 'backlog',
    type: 'FEATURE',
    title: id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

/** The slice of `TasksStore` the detail reads: the folder browser facade. */
type FolderFacade = Pick<
  TasksStore,
  | 'folderListing'
  | 'folderBreadcrumbs'
  | 'folderEntries'
  | 'folderDirectory'
  | 'openFile'
  | 'documentState'
  | 'readFolderFile'
  | 'openFolderDirectory'
>;

/** A signal-backed stand-in for the store's folder facade. */
function createFolderFacade() {
  const listing = signal<TaskFolderListing>({
    directory: '',
    status: 'idle',
    entries: [],
    message: null,
  });
  const breadcrumbs = signal<readonly TaskFolderBreadcrumb[]>([]);
  const document = signal<TaskDocumentState>({ status: 'idle' });
  const readFolderFile = jest.fn(async (file: string | null) => {
    document.set(
      file === null ? { status: 'idle' } : { status: 'loading', file },
    );
  });
  const openFolderDirectory = jest.fn(async () => undefined);
  const entries = computed<readonly TaskFolderEntry[]>(() => listing().entries);
  const facade: FolderFacade = {
    folderListing: listing,
    folderBreadcrumbs: breadcrumbs,
    folderEntries: entries,
    folderDirectory: computed(() => listing().directory),
    openFile: computed(() => {
      const state = document();
      return state.status === 'idle' ? null : state.file;
    }),
    documentState: document,
    readFolderFile,
    openFolderDirectory,
  };
  return {
    facade,
    document,
    readFolderFile,
    openFolderDirectory,
    /** Point the facade at a task's root listing, as TasksStore does. */
    showRoot(detail: TaskSpecDetail | null): void {
      breadcrumbs.set(folderBreadcrumbs(detail?.folderName ?? '', ''));
      listing.set(
        detail
          ? {
              directory: '',
              status: 'ready',
              entries: buildRootFolderEntries(rootEntriesOf(detail)),
              message: null,
            }
          : { directory: '', status: 'idle', entries: [], message: null },
      );
    },
  };
}

type FolderFake = ReturnType<typeof createFolderFacade>;

/** Providers every detail render needs: no host transport is reached. */
function detailProviders(folder: FolderFake) {
  return [
    { provide: TasksStore, useValue: folder.facade },
    {
      provide: AppStateManager,
      useValue: {
        workspaceInfo: signal({ path: '/work' }),
        requestOpenSession: jest.fn(),
      },
    },
    {
      provide: TaskSessionLinksService,
      useValue: {
        linksFor: (): readonly TaskLinkedSession[] => [],
      },
    },
    {
      provide: TaskAgentDiscoveryService,
      useValue: {
        availableAgents: signal<readonly TaskAgentTarget[]>([]),
        load: jest.fn(async () => undefined),
      },
    },
  ];
}

describe('TaskDetailComponent', () => {
  let folder: FolderFake;

  beforeEach(() => {
    folder = createFolderFacade();
    TestBed.configureTestingModule({
      imports: [TaskDetailComponent],
      providers: detailProviders(folder),
    });
  });

  function render(
    detail: TaskSpecDetail | null,
    loading = false,
    graph: TaskGraph | null = null,
  ) {
    folder.showRoot(detail);
    const fixture = TestBed.createComponent(TaskDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.componentRef.setInput('loading', loading);
    fixture.componentRef.setInput('graph', graph);
    fixture.detectChanges();
    return fixture;
  }

  const byId = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  // ---------------------------------------------------------------------------
  // Spec-folder view: files, reader, overview
  // ---------------------------------------------------------------------------

  describe('spec folder', () => {
    const planned = () =>
      makeDetail({
        artifacts: [CARRIER_FILE, CONTEXT_FILE, 'implementation-plan.md'],
        entries: [
          { name: CARRIER_FILE, kind: 'file' },
          { name: CONTEXT_FILE, kind: 'file' },
          { name: 'implementation-plan.md', kind: 'file' },
          { name: 'prototype', kind: 'directory' },
        ],
      });

    it('composes files, the carrier overview, metadata, activity and the run placeholder', () => {
      const host = render(planned()).nativeElement as HTMLElement;
      expect(host.querySelector('ptah-task-folder-files')).not.toBeNull();
      expect(host.querySelector('ptah-task-folder-overview')).not.toBeNull();
      expect(host.querySelector('ptah-task-document-reader')).toBeNull();
      expect(byId(host, 'task-detail-metadata')).not.toBeNull();
      expect(host.querySelector('ptah-task-activity')).not.toBeNull();
      expect(byId(host, 'task-run-placeholder')?.textContent).toContain(
        'Planned for Phase 2 · TASK_2026_358',
      );
      expect(byId(host, 'task-detail-breadcrumb')?.textContent).toContain(
        '.ptah / specs / TASK_2026_200',
      );
    });

    it('reads a file through the store, then shows the reader for it', () => {
      const fixture = render(planned());
      const host = fixture.nativeElement as HTMLElement;
      byId(host, 'task-folder-row-implementation-plan.md')?.click();
      expect(folder.readFolderFile).toHaveBeenCalledWith(
        'implementation-plan.md',
      );

      folder.document.set({
        status: 'ready',
        file: 'implementation-plan.md',
        content: '# Plan',
      });
      fixture.detectChanges();
      expect(host.querySelector('ptah-task-folder-overview')).toBeNull();
      expect(byId(host, 'task-doc-file')?.textContent).toContain(
        'implementation-plan.md',
      );
      const blocks = fixture.debugElement.queryAll(
        By.directive(MarkdownBlockComponent),
      );
      expect(blocks).toHaveLength(1);
      const block: MarkdownBlockComponent = blocks[0].componentInstance;
      expect(block.content()).toBe('# Plan');
      expect(block.variant()).toBe('auto');
      expect(host.innerHTML).not.toContain('# Plan');
    });

    it('shows the last selected file after rapid switching', () => {
      const fixture = render(planned());
      const host = fixture.nativeElement as HTMLElement;
      byId(host, 'task-folder-row-context.md')?.click();
      byId(host, 'task-folder-row-implementation-plan.md')?.click();
      fixture.detectChanges();
      // The store keeps only the latest request; the panel shows its state.
      expect(byId(host, 'task-doc-file')?.textContent).toContain(
        'implementation-plan.md',
      );
      expect(
        byId(host, 'task-folder-row-implementation-plan.md')?.getAttribute(
          'aria-current',
        ),
      ).toBe('true');
      expect(
        byId(host, 'task-folder-row-context.md')?.getAttribute('aria-current'),
      ).toBeNull();
    });

    it('routes Open in editor to the openArtifact output', () => {
      const fixture = render(planned());
      const host = fixture.nativeElement as HTMLElement;
      const opened: string[] = [];
      fixture.componentInstance.openArtifact.subscribe((file) =>
        opened.push(file),
      );
      byId(host, 'task-overview-open-editor')?.click();

      folder.document.set({
        status: 'ready',
        file: CONTEXT_FILE,
        content: 'x',
      });
      fixture.detectChanges();
      byId(host, 'task-doc-open-editor')?.click();
      expect(opened).toEqual([CARRIER_FILE, CONTEXT_FILE]);
    });

    it('offers no editor action for a file the folder does not hold', () => {
      const fixture = render(planned());
      folder.document.set({ status: 'missing', file: 'test-report.md' });
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(byId(host, 'task-doc-missing')).not.toBeNull();
      expect(byId(host, 'task-doc-open-editor')).toBeNull();
    });

    it('closes the reader back to the carrier overview', () => {
      const fixture = render(planned());
      folder.document.set({
        status: 'ready',
        file: CONTEXT_FILE,
        content: 'x',
      });
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      byId(host, 'task-doc-close')?.click();
      fixture.detectChanges();
      expect(folder.readFolderFile).toHaveBeenLastCalledWith(null);
      expect(host.querySelector('ptah-task-folder-overview')).not.toBeNull();
    });

    it('browses a directory through the store instead of reading it', () => {
      const host = render(planned()).nativeElement as HTMLElement;
      byId(host, 'task-folder-row-prototype')?.click();
      expect(folder.openFolderDirectory).toHaveBeenCalledWith('prototype');
      expect(folder.readFolderFile).not.toHaveBeenCalled();
    });

    it('keeps the public host contract tasks-view binds', () => {
      const fixture = render(planned());
      const ref = fixture.componentRef;
      expect(() => {
        ref.setInput('folderHint', 'TASK_2026_200');
        ref.setInput('starting', false);
        ref.setInput('knownLabels', []);
        ref.setInput('knownTaskIds', []);
        ref.setInput('busy', false);
        ref.setInput('openDocument', null);
        ref.setInput('documentContent', null);
        ref.setInput('documentLoading', false);
        fixture.detectChanges();
      }).not.toThrow();
      const instance = fixture.componentInstance;
      for (const emitter of [
        instance.closed,
        instance.startTask,
        instance.statusChange,
        instance.readDocument,
        instance.openArtifact,
        instance.openTask,
        instance.applyMetadata,
      ]) {
        expect(typeof emitter.subscribe).toBe('function');
      }
    });
  });

  it('is a full page whose header Back, Start and Change status reach the host', () => {
    const fixture = render(makeDetail({ status: 'backlog' }));
    const host = fixture.nativeElement as HTMLElement;
    const instance = fixture.componentInstance;
    const events: unknown[] = [];
    instance.closed.subscribe(() => events.push('closed'));
    instance.startTask.subscribe((request) => events.push(request));
    instance.statusChange.subscribe((change) => events.push(change));

    expect(
      host.querySelector('[data-testid="task-detail-page"]'),
    ).not.toBeNull();
    expect(host.querySelector('aside')).toBeNull();
    expect(byId(host, 'task-detail-path')?.textContent).toContain(
      '.ptah/specs/TASK_2026_200/',
    );
    byId(host, 'task-detail-back')?.click();
    byId(host, 'task-detail-start')?.click();
    (
      host.querySelector(
        '[data-testid="task-detail-status-menu"] [data-status="done"]',
      ) as HTMLElement
    ).click();

    expect(events).toEqual([
      'closed',
      { taskId: 'TASK_2026_200', isolate: false },
      { taskId: 'TASK_2026_200', status: 'done' },
    ]);
  });

  it('renders frontmatter facts and depends_on', () => {
    const fixture = render(makeDetail());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Board detail');
    expect(text).toContain('In Progress');
    expect(text).toContain('TASK_2026_100');
  });

  it('routes the body through the markdown chokepoint (no [innerHTML])', () => {
    const fixture = render(makeDetail());
    const host = fixture.nativeElement as HTMLElement;
    // MarkdownBlockComponent (mocked as <markdown>) is present…
    expect(host.querySelector('ptah-markdown-block')).not.toBeNull();
    // …and no raw innerHTML binding leaked the markdown source verbatim.
    expect(host.innerHTML).not.toContain('# Heading');
  });

  it('renders validation warnings when present', () => {
    const fixture = render(
      makeDetail({
        validationIssues: [
          { field: 'created', code: 'invalid_date', message: 'unparseable' },
        ],
      }),
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('created');
    expect(text).toContain('unparseable');
  });

  // The batch breakdown stage accepts BOTH the current name and its pre-rename
  // name. That fallback is permanent — folders on disk are gitignored, so no
  // migration can be trusted to have run.
  it.each([BATCHES_FILE, LEGACY_BATCHES_FILE])(
    'lists the batch-breakdown stage as present for %s',
    (file) => {
      const fixture = render(makeDetail({ artifacts: [CARRIER_FILE, file] }));
      const row = byId(
        fixture.nativeElement as HTMLElement,
        `task-folder-row-${file}`,
      );
      expect(row?.getAttribute('data-presence')).toBe('present');
      expect(row?.textContent).not.toContain('Missing');
    },
  );

  it('shows a spinner while loading', () => {
    const fixture = render(null, true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.loading'),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Task 3.6 regression pin — NG0955 on the validation-issue @for.
  //
  // `track issue.field` collided the moment one array-valued field carried two
  // bad entries. It is pinned here rather than in the graph specs because the
  // duplicate-key failure is a RENDER failure: the data was always right.
  //
  // On Angular 21.2.6 NG0955 is a `console.warn` raised from the @for
  // RECONCILE path, not a throw and not a first-render check — verified by
  // reading `reconcile()` in @angular/core and by driving both paths. So the
  // row-count assertions below cannot catch the defect on their own (they pass
  // with the broken key), and the warning assertion is the one that bites.
  // Both are kept: the counts are the user-visible contract, the warning is the
  // mechanism.
  // -------------------------------------------------------------------------
  describe('validation issues with a colliding track key', () => {
    /** Every NG0955 raised while `body` runs. */
    function ng0955During(body: () => void): string[] {
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        body();
        return warn.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => message.includes('NG0955'));
      } finally {
        warn.mockRestore();
      }
    }

    it('raises no NG0955 when the issue list is re-rendered', () => {
      const dangling = (message: string, ref: string) => ({
        field: 'relates_to',
        code: 'dangling_relation' as const,
        message,
        ref,
      });

      const warnings = ng0955During(() => {
        const fixture = render(
          makeDetail({
            frontmatterValid: false,
            validationIssues: [
              dangling('a', 'TASK_2026_901'),
              dangling('b', 'TASK_2026_902'),
            ],
          }),
        );
        // A reconcile — this is the path that detects duplicate keys, and it
        // is exactly what a `tasks:changed` push does to an open panel.
        fixture.componentRef.setInput(
          'detail',
          makeDetail({
            frontmatterValid: false,
            validationIssues: [
              dangling('c', 'TASK_2026_903'),
              dangling('d', 'TASK_2026_904'),
              dangling('e', 'TASK_2026_905'),
            ],
          }),
        );
        fixture.detectChanges();
        fixture.componentRef.setInput(
          'detail',
          makeDetail({
            frontmatterValid: false,
            validationIssues: [dangling('d', 'TASK_2026_904')],
          }),
        );
        fixture.detectChanges();
      });

      expect(warnings).toEqual([]);
    });

    it('renders one row per issue for two distinct dangling relates_to entries', () => {
      const fixture = render(
        makeDetail({
          relatesTo: ['TASK_2026_901', 'TASK_2026_902'],
          frontmatterValid: false,
          validationIssues: [
            {
              field: 'relates_to',
              code: 'dangling_relation',
              message: `relates_to entry 'TASK_2026_901' does not match any folder under the spec root.`,
              ref: 'TASK_2026_901',
            },
            {
              field: 'relates_to',
              code: 'dangling_relation',
              message: `relates_to entry 'TASK_2026_902' does not resolve to a task with a readable carrier.`,
              ref: 'TASK_2026_902',
            },
          ],
        }),
      );
      const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="task-detail-issues"] li',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('TASK_2026_901');
      expect(rows[1].textContent).toContain('TASK_2026_902');
    });

    it('renders one row per issue when the SAME bad entry is listed twice', () => {
      // Two lists, two different rules, and they are not in conflict.
      //
      // FR-B4.8's display de-duplication applies to the RELATION list — one
      // chip per distinct id (see the relations-dedupe tests below). It does
      // NOT apply here: the repeated entry is never rewritten out of the file,
      // so the parser reports it once per OCCURRENCE, and each occurrence is a
      // real finding about a real line the author wrote. Collapsing them would
      // under-report the file.
      //
      // The consequence for this @for is that two issues can share an
      // identical (field, code, ref) — the case a `ref`-only track fallback
      // still collides on, which is why `$index` is folded into the key.
      const fixture = render(
        makeDetail({
          relatesTo: ['TASK_2026_901', 'TASK_2026_901'],
          frontmatterValid: false,
          validationIssues: [
            {
              field: 'relates_to',
              code: 'dangling_relation',
              message: `relates_to entry 'TASK_2026_901' does not match any folder under the spec root.`,
              ref: 'TASK_2026_901',
            },
            {
              field: 'relates_to',
              code: 'dangling_relation',
              message: `relates_to entry 'TASK_2026_901' does not match any folder under the spec root.`,
              ref: 'TASK_2026_901',
            },
          ],
        }),
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="task-detail-issues"] li',
        ),
      ).toHaveLength(2);
    });

    it('renders one row per issue when neither issue carries a ref', () => {
      // The fallback arm. `ref` is optional and absent for every shape-level
      // code, so two shape findings on one field must still get distinct keys.
      const fixture = render(
        makeDetail({
          frontmatterValid: false,
          validationIssues: [
            {
              field: 'relates_to',
              code: 'invalid_relation',
              message: 'relates_to must be an array of task-id strings.',
            },
            {
              field: 'relates_to',
              code: 'invalid_relation',
              message: 'relates_to must be an array of task-id strings.',
            },
          ],
        }),
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="task-detail-issues"] li',
        ),
      ).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Metadata + relation groups
  // -------------------------------------------------------------------------
  it('renders labels and the estimate when declared, and nothing when absent', () => {
    const bare = render(makeDetail()).nativeElement as HTMLElement;
    expect(bare.querySelector('[data-testid="task-detail-labels"]')).toBeNull();
    expect(
      bare.querySelector('[data-testid="task-detail-estimate"]'),
    ).toBeNull();

    const rich = render(makeDetail({ labels: ['licensing'], estimate: 'XL' }))
      .nativeElement as HTMLElement;
    expect(
      rich.querySelector('[data-testid="task-detail-labels"]')?.textContent,
    ).toContain('licensing');
    expect(
      rich.querySelector('[data-testid="task-detail-estimate"]')?.textContent,
    ).toContain('Extra large');
  });

  it('groups relations and marks derived edges as owned by the other task', () => {
    const detail = makeDetail({
      dependsOn: ['TASK_2026_100'],
      duplicates: ['TASK_2026_101'],
      relatesTo: ['TASK_2026_102'],
    });
    // TASK_2026_103 depends on us (⇒ Blocks) and declares us a duplicate
    // (⇒ Duplicated by) and relates to us (⇒ the derived half of Related).
    const other = makeSummary('TASK_2026_103', {
      dependsOn: ['TASK_2026_200'],
      duplicates: ['TASK_2026_200'],
      relatesTo: ['TASK_2026_200'],
    });
    const graph = buildTaskGraph([
      { ...detail },
      makeSummary('TASK_2026_100'),
      makeSummary('TASK_2026_101'),
      makeSummary('TASK_2026_102'),
      other,
    ]);
    const host = render(detail, false, graph).nativeElement as HTMLElement;

    const group = (key: string): HTMLElement | null =>
      host.querySelector(`[data-testid="task-relations-group-${key}"]`);

    expect(group('blocked_by')?.textContent).toContain('TASK_2026_100');
    expect(group('blocks')?.textContent).toContain('TASK_2026_103');
    expect(group('duplicates')?.textContent).toContain('TASK_2026_101');
    expect(group('duplicated_by')?.textContent).toContain('TASK_2026_103');
    expect(group('related:authored')?.textContent).toContain('TASK_2026_102');
    expect(group('related:derived')?.textContent).toContain('TASK_2026_103');

    // The derived groups say, in words, that the edge is owned elsewhere.
    expect(group('blocks')?.textContent).toContain(
      'Declared by the other task',
    );
    expect(group('related:authored')?.textContent).toContain(
      `Declared in this task's own frontmatter`,
    );
  });

  it('emits the id when a relation chip is opened — never a silent no-op', () => {
    const detail = makeDetail({ dependsOn: ['TASK_2026_100'] });
    const graph = buildTaskGraph([{ ...detail }, makeSummary('TASK_2026_100')]);
    const fixture = render(detail, false, graph);
    let emitted: string | undefined;
    fixture.componentInstance.openTask.subscribe((id) => (emitted = id));

    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-relations-group-blocked_by"] button',
    ) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    chip.click();

    expect(emitted).toBe('TASK_2026_100');
  });

  it('disables relation chips with a stated reason when no graph is supplied', () => {
    const host = render(makeDetail({ dependsOn: ['TASK_2026_100'] }))
      .nativeElement as HTMLElement;
    const chip = host.querySelector(
      '[data-testid="task-relations-group-blocked_by"] button',
    ) as HTMLButtonElement;

    expect(chip.disabled).toBe(true);
    expect(chip.title.length).toBeGreaterThan(0);
    expect(chip.title).toContain('board index is not available');
  });

  // -------------------------------------------------------------------------
  // The same duplicate-track-key defect, one file over (relations list).
  //
  // The DERIVED buckets arrive de-duplicated — `buildTaskGraph` inserts through
  // `addUnique`. The AUTHORED arrays do not: the parser assigns its validated
  // array straight through, and FR-B4.8 requires the repeat to survive in the
  // file. So a resolvable id repeated in `depends_on` reaches the relation list
  // twice. The earlier dangling-entry test cannot see this — `resolves()`
  // filters a dangling id out before a key is ever computed.
  //
  // Like the NG0955 pin above, a first-render row count does not catch it
  // either: duplicate keys are only detected on reconcile.
  // -------------------------------------------------------------------------
  describe('relations built from repeated authored entries', () => {
    function ng0955During(body: () => void): string[] {
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        body();
        return warn.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => message.includes('NG0955'));
      } finally {
        warn.mockRestore();
      }
    }

    it('renders one chip per distinct id and raises no NG0955 across a reconcile', () => {
      const target = makeSummary('TASK_2026_100');
      const other = makeSummary('TASK_2026_101');
      // A RESOLVABLE id, repeated. Both copies survive `resolves()`.
      const twice = makeDetail({
        dependsOn: ['TASK_2026_100', 'TASK_2026_100'],
        duplicates: ['TASK_2026_101', 'TASK_2026_101'],
        relatesTo: ['TASK_2026_101', 'TASK_2026_101'],
      });
      const graph = buildTaskGraph([{ ...twice }, target, other]);

      let fixture!: ReturnType<typeof render>;
      const warnings = ng0955During(() => {
        fixture = render(twice, false, graph);
        // Reconcile — the only path that detects a duplicate key.
        fixture.componentRef.setInput(
          'detail',
          makeDetail({
            dependsOn: ['TASK_2026_100', 'TASK_2026_100', 'TASK_2026_101'],
            duplicates: ['TASK_2026_101', 'TASK_2026_101'],
            relatesTo: ['TASK_2026_101', 'TASK_2026_101'],
          }),
        );
        fixture.detectChanges();
        fixture.componentRef.setInput('detail', twice);
        fixture.detectChanges();
      });

      expect(warnings).toEqual([]);

      const host = fixture.nativeElement as HTMLElement;
      // Scoped to the chip itself. The panel renders the relation groups
      // EDITABLE (Batch 5), so each authored entry now carries a remove control
      // beside its chip and a bare `button` selector would count both.
      const chips = (key: string): string[] =>
        Array.from(
          host.querySelectorAll(
            `[data-testid="task-relations-group-${key}"] [data-testid="task-relation-chip"]`,
          ),
        ).map((el) => el.textContent?.trim() ?? '');

      expect(chips('blocked_by')).toEqual(['TASK_2026_100']);
      expect(chips('duplicates')).toEqual(['TASK_2026_101']);
      expect(chips('related:authored')).toEqual(['TASK_2026_101']);
    });
  });

  it('gives the two halves of Related distinct headings', () => {
    const detail = makeDetail({ dependsOn: [], relatesTo: ['TASK_2026_102'] });
    const other = makeSummary('TASK_2026_103', {
      relatesTo: ['TASK_2026_200'],
    });
    const graph = buildTaskGraph([
      { ...detail },
      makeSummary('TASK_2026_102'),
      other,
    ]);
    const host = render(detail, false, graph).nativeElement as HTMLElement;

    const heading = (key: string): string =>
      host
        .querySelector(`[data-testid="task-relations-group-${key}"] span`)
        ?.textContent?.trim() ?? '';

    expect(heading('related:authored')).toBe('Related — declared here');
    expect(heading('related:derived')).toBe('Related — declared elsewhere');
    expect(heading('related:authored')).not.toBe(heading('related:derived'));
  });

  it('omits a relation whose target is not on the board rather than linking nowhere', () => {
    const detail = makeDetail({ relatesTo: ['TASK_2026_999'] });
    const graph = buildTaskGraph([{ ...detail }]);
    const host = render(detail, false, graph).nativeElement as HTMLElement;

    expect(
      host.querySelector(
        '[data-testid="task-relations-group-related:authored"]',
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Non-agent markdown stays plain (TASK_2026_413 R2)
//
// The task-detail panel renders a spec DOCUMENT, not agent output, and it has
// no session tab — so a relative link inside it has no workspace to resolve
// against, and hijacking it into the file viewer would open the wrong file or
// nothing. The `data-ptah-file-links` opt-in is therefore deliberately ABSENT
// here, and the document-level listener must ignore a link rendered in it.
// ---------------------------------------------------------------------------
describe('TaskDetailComponent — file-link opt-in', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TaskDetailComponent],
      providers: detailProviders(createFolderFacade()),
    });
  });

  it('renders no file-link opt-in marker anywhere in the panel', () => {
    const fixture = TestBed.createComponent(TaskDetailComponent);
    fixture.componentRef.setInput(
      'detail',
      makeDetail({ body: 'See [the plan](implementation-plan.md:3).' }),
    );
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('graph', null);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.hasAttribute('data-ptah-file-links')).toBe(false);
    expect(host.querySelector('[data-ptah-file-links]')).toBeNull();
    expect(host.closest('[data-ptah-file-links]')).toBeNull();
  });
});
