import { TestBed } from '@angular/core/testing';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  CONTEXT_FILE,
  LEGACY_BATCHES_FILE,
  buildTaskGraph,
  type TaskGraph,
  type TaskSpecDetail,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
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

describe('TaskDetailComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskDetailComponent] });
  });

  function render(
    detail: TaskSpecDetail | null,
    loading = false,
    graph: TaskGraph | null = null,
  ) {
    const fixture = TestBed.createComponent(TaskDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.componentRef.setInput('loading', loading);
    fixture.componentRef.setInput('graph', graph);
    fixture.detectChanges();
    return fixture;
  }

  // ---------------------------------------------------------------------------
  // In-place workflow documents
  // ---------------------------------------------------------------------------

  describe('workflow documents', () => {
    function renderWithDoc(
      inputs: Record<string, unknown>,
      detail: TaskSpecDetail = makeDetail({
        artifacts: [CARRIER_FILE, CONTEXT_FILE, 'implementation-plan.md'],
      }),
    ) {
      const fixture = TestBed.createComponent(TaskDetailComponent);
      fixture.componentRef.setInput('detail', detail);
      for (const [key, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(key, value);
      }
      fixture.detectChanges();
      return { fixture, host: fixture.nativeElement as HTMLElement };
    }

    /**
     * Reading a document and opening it in the editor are different intents —
     * "show me the plan" versus "I am about to change it" — so they are two
     * controls. Collapsing them is what meant the panel could only ever do the
     * second.
     */
    it('asks to READ on the row, and to EDIT on the separate control', () => {
      const { fixture, host } = renderWithDoc({});
      const read: Array<string | null> = [];
      const opened: string[] = [];
      fixture.componentInstance.readDocument.subscribe((file) =>
        read.push(file),
      );
      fixture.componentInstance.openArtifact.subscribe((file) =>
        opened.push(file),
      );

      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-doc-read-implementation-plan.md"]',
        )
        ?.click();
      expect(read).toEqual(['implementation-plan.md']);
      expect(opened).toEqual([]);

      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-doc-open-implementation-plan.md"]',
        )
        ?.click();
      expect(opened).toEqual(['implementation-plan.md']);
      expect(read).toEqual(['implementation-plan.md']);
    });

    it('closes the open document when its own row is clicked again', () => {
      const { fixture, host } = renderWithDoc({
        openDocument: 'implementation-plan.md',
      });
      const read: Array<string | null> = [];
      fixture.componentInstance.readDocument.subscribe((file) =>
        read.push(file),
      );

      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-doc-read-implementation-plan.md"]',
        )
        ?.click();
      expect(read).toEqual([null]);
    });

    it('renders the document through the markdown chokepoint', () => {
      const { host } = renderWithDoc({
        openDocument: 'implementation-plan.md',
        documentContent: '# Plan\n\nStep one.',
      });
      const panel = host.querySelector('[data-testid="task-doc-panel"]');
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('ptah-markdown-block')).not.toBeNull();
      expect(host.innerHTML).not.toContain('# Plan');
    });

    /**
     * Absent is not broken. Most tasks carry a handful of the fifteen
     * recognised documents, and "failed to load" about the ordinary case sends
     * the user hunting a fault that is not there.
     */
    it('says the document is absent rather than reporting a failure', () => {
      const { host } = renderWithDoc({
        openDocument: 'implementation-plan.md',
        documentContent: null,
      });
      const absent = host.querySelector('[data-testid="task-doc-absent"]');
      expect(absent?.textContent).toContain('does not contain');
      expect(absent?.textContent).toContain('implementation-plan.md');
    });

    it('shows a spinner instead of an absence claim while the read is in flight', () => {
      const { host } = renderWithDoc({
        openDocument: 'implementation-plan.md',
        documentContent: null,
        documentLoading: true,
      });
      expect(host.querySelector('[data-testid="task-doc-absent"]')).toBeNull();
      expect(
        host.querySelector('[data-testid="task-doc-panel"] .loading'),
      ).not.toBeNull();
    });

    it('renders no document panel when nothing is open', () => {
      const { host } = renderWithDoc({});
      expect(host.querySelector('[data-testid="task-doc-panel"]')).toBeNull();
    });
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
    'marks the batch-breakdown stage present for %s',
    (file) => {
      const fixture = render(makeDetail({ artifacts: [CARRIER_FILE, file] }));
      const host = fixture.nativeElement as HTMLElement;
      const row = Array.from(host.querySelectorAll('button')).find((el) =>
        el.textContent?.includes(file),
      );
      expect(row).toBeDefined();
      expect(row?.textContent).not.toContain('not generated');
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
