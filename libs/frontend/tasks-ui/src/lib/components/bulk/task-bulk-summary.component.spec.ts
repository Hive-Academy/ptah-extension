import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TaskBulkSummaryComponent } from './task-bulk-summary.component';
import { TaskBulkBarComponent } from './task-bulk-bar.component';
import type {
  BulkOperation,
  BulkSummary,
} from '../../services/tasks-store.service';
import type { TasksBulkLabelMode, TaskStatus } from '@ptah-extension/shared';

const moveTo = (status: TaskStatus): BulkOperation => ({
  kind: 'status',
  status,
});

const labelOp = (label: string, mode: TasksBulkLabelMode): BulkOperation => ({
  kind: 'label',
  label,
  mode,
});

function summary(overrides: Partial<BulkSummary> = {}): BulkSummary {
  return {
    operation: moveTo('done'),
    requested: 3,
    attempted: 3,
    succeeded: 3,
    noop: 0,
    failures: [],
    untouched: [],
    cancelled: false,
    ...overrides,
  };
}

async function render(
  value: BulkSummary,
): Promise<ComponentFixture<TaskBulkSummaryComponent>> {
  // Several tests render twice (a control case and the case under test), and
  // TestBed refuses to be reconfigured once instantiated.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [TaskBulkSummaryComponent] });
  const fixture = TestBed.createComponent(TaskBulkSummaryComponent);
  fixture.componentRef.setInput('summary', value);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<unknown>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('TaskBulkSummaryComponent', () => {
  it('reports both numbers rather than a verdict', async () => {
    const fixture = await render(
      summary({
        requested: 5,
        attempted: 5,
        succeeded: 3,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: 'Title TASK_2026_001',
            code: 'TASK_CONFLICT',
            message: 'the carrier moved',
          },
          {
            taskId: 'TASK_2026_003',
            title: null,
            code: 'WRITE_FAILED',
            message: 'the write was refused',
          },
        ],
      }),
    );

    const rendered = text(fixture);
    expect(rendered).toContain('3 task(s) moved to Done');
    expect(rendered).toContain('2 were refused and are still selected');
  });

  /**
   * FR-C4.7 — the fact that makes a conflict row worth reading.
   *
   * Without it the row says "it changed, try again", which is a dead end. The
   * assertion is on the STATUS LABEL rather than the raw token, because the
   * label is what a user reads and a row that rendered `in_review` verbatim
   * would still pass a token-level check.
   */
  it('names the status the carrier holds on disk after a conflict', async () => {
    const fixture = await render(
      summary({
        requested: 1,
        attempted: 1,
        succeeded: 0,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: 'Title TASK_2026_001',
            code: 'TASK_CONFLICT',
            message: 'the carrier moved',
            currentStatus: 'in_review',
          },
        ],
      }),
    );

    const rendered = text(fixture);
    expect(rendered).toContain('the carrier moved');
    expect(rendered).toContain('It is now in In Review on disk');
  });

  /** FR-C4.9, verbatim — chunk-granular, and the words say what that means. */
  it('states the cancellation sentence exactly', async () => {
    const fixture = await render(
      summary({
        requested: 120,
        attempted: 40,
        succeeded: 40,
        cancelled: true,
      }),
    );

    expect(text(fixture).replace(/\s+/g, ' ')).toContain(
      'Cancelled after 40 of 120. Writes already issued completed and were not reversed.',
    );
  });

  /** FR-C4.8 — Retry is a control the user presses; nothing fires on its own. */
  it('offers Retry only when something failed, and emits the target status', async () => {
    const clean = await render(summary());
    expect(
      (clean.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-summary-retry"]',
      ),
    ).toBeNull();

    const fixture = await render(
      summary({
        operation: moveTo('in_review'),
        succeeded: 0,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: null,
            code: 'WRITE_FAILED',
            message: 'the write was refused',
          },
        ],
      }),
    );
    const emitted: BulkOperation[] = [];
    fixture.componentInstance.retry.subscribe((operation) =>
      emitted.push(operation),
    );
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-summary-retry"]',
      ) as HTMLButtonElement
    ).click();

    expect(emitted).toEqual([{ kind: 'status', status: 'in_review' }]);
  });

  // -------------------------------------------------------------------------
  // Label runs (FR-C5) — the no-op is the whole difficulty
  // -------------------------------------------------------------------------

  /**
   * THE sentence this task exists to prevent.
   *
   * Ten tasks were asked for and all ten now carry the label, but eight already
   * did: two files were written. A headline built off `succeeded` would say
   * "10 task(s) got the label", which is wrong about disk in the direction that
   * makes a user believe an edit landed — and it would be wrong silently, since
   * every count in the summary would still add up.
   */
  it('reports what a label run WROTE, not how many tasks ended up carrying the label', async () => {
    const fixture = await render(
      summary({
        operation: labelOp('licensing', 'add'),
        requested: 10,
        attempted: 10,
        succeeded: 10,
        noop: 8,
      }),
    );
    const host = fixture.nativeElement as HTMLElement;

    const headline = host.querySelector(
      '[data-testid="task-bulk-summary-headline"]',
    )?.textContent;
    expect(headline).toContain('2 task(s) got the label "licensing"');
    expect(headline).not.toContain('10 task(s) got the label');

    // …and the eight are stated as their own fact, with their own hook.
    expect(
      host.querySelector('[data-testid="task-bulk-summary-noop"]')?.textContent,
    ).toContain('8 already carried "licensing", so nothing was written');
  });

  it('says a removal did not carry the label, rather than already carried it', async () => {
    const fixture = await render(
      summary({
        operation: labelOp('licensing', 'remove'),
        requested: 5,
        attempted: 5,
        succeeded: 5,
        noop: 3,
      }),
    );
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="task-bulk-summary-headline"]')
        ?.textContent,
    ).toContain('2 task(s) had the label "licensing" removed');
    expect(
      host.querySelector('[data-testid="task-bulk-summary-noop"]')?.textContent,
    ).toContain('3 did not carry "licensing"');
  });

  /**
   * The control for both of the above: a run where every success wrote states
   * nothing about no-ops. Without this, "the no-op sentence appears" is also
   * satisfied by a panel that always shows it.
   */
  it('renders no no-op sentence for a run where every success wrote', async () => {
    const fixture = await render(
      summary({
        operation: labelOp('licensing', 'add'),
        requested: 3,
        attempted: 3,
        succeeded: 3,
        noop: 0,
      }),
    );
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="task-bulk-summary-noop"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="task-bulk-summary-headline"]')
        ?.textContent,
    ).toContain('3 task(s) got the label "licensing"');
  });

  /**
   * The label limits live in `TaskMetadataPatchSchema`, on the write path. This
   * panel restates none of them and prints what the boundary said, exactly.
   */
  it('renders the backend refusal sentence verbatim', async () => {
    const sentence = 'A task may carry at most 12 labels.';
    const fixture = await render(
      summary({
        operation: labelOp('a-thirteenth-label', 'add'),
        requested: 1,
        attempted: 1,
        succeeded: 0,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: 'Title TASK_2026_001',
            code: 'INVALID_PARAMS',
            message: sentence,
          },
        ],
      }),
    );

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-failure-message"]',
      )?.textContent,
    ).toContain(sentence);
  });

  /**
   * Retry re-emits the WHOLE operation, label and direction included.
   *
   * A retry that emitted only "there was a label run" would have to guess both
   * on the way back in, and the guess that reads best — add — is the one that
   * silently reverses a removal.
   */
  it('re-emits the whole label operation from Retry', async () => {
    const fixture = await render(
      summary({
        operation: labelOp('licensing', 'remove'),
        requested: 1,
        attempted: 1,
        succeeded: 0,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: null,
            code: 'WRITE_FAILED',
            message: 'the write was refused',
          },
        ],
      }),
    );
    const emitted: BulkOperation[] = [];
    fixture.componentInstance.retry.subscribe((operation) =>
      emitted.push(operation),
    );

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-summary-retry"]',
      ) as HTMLButtonElement
    ).click();

    expect(emitted).toEqual([
      { kind: 'label', label: 'licensing', mode: 'remove' },
    ]);
  });

  /**
   * BR-10 — an untrusted title reaches the DOM as text, never as markup.
   *
   * The title comes off disk, and a card title is the shortest path from a
   * carrier file to an innerHTML sink. `textContent` carrying the raw string
   * while `querySelector('img')` finds nothing is the pair that tells
   * interpolation from binding.
   */
  it('renders a task title as text, never as markup', async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const fixture = await render(
      summary({
        succeeded: 0,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: hostile,
            code: 'WRITE_FAILED',
            message: 'the write was refused',
          },
        ],
      }),
    );

    expect(text(fixture)).toContain(hostile);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('img'),
    ).toBeNull();
  });

  /**
   * The third group gets its own count and its own list.
   *
   * The store already refuses to call these failures; this is the same refusal
   * at the surface. A user who pressed Cancel on 120 tasks must be able to read
   * that 80 were never attempted — and must NOT read it inside the list of
   * things that refused.
   */
  it('counts and lists never-attempted tasks apart from the failures', async () => {
    const fixture = await render(
      summary({
        requested: 5,
        attempted: 3,
        succeeded: 2,
        cancelled: true,
        failures: [
          {
            taskId: 'TASK_2026_001',
            title: 'Title TASK_2026_001',
            code: 'TASK_CONFLICT',
            message: 'the carrier moved',
          },
        ],
        untouched: [
          { taskId: 'TASK_2026_003', title: 'Title TASK_2026_003' },
          { taskId: 'TASK_2026_004', title: null },
        ],
      }),
    );
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="task-bulk-summary-untouched-count"]')
        ?.textContent,
    ).toContain('2 task(s) were never attempted');
    expect(
      host.querySelectorAll('[data-testid="task-bulk-summary-untouched"]'),
    ).toHaveLength(2);

    // …and they are NOT in the failure list.
    const failures = Array.from(
      host.querySelectorAll('[data-testid="task-bulk-summary-failure"]'),
    ).map((row) => row.textContent ?? '');
    expect(failures).toHaveLength(1);
    expect(failures.join(' ')).not.toContain('TASK_2026_003');

    // The headline counts refusals only — it never absorbs the third group.
    expect(
      host.querySelector('[data-testid="task-bulk-summary-headline"]')
        ?.textContent,
    ).toContain('1 were refused');
  });

  it('renders no untouched section for a run that completed', async () => {
    const fixture = await render(summary());
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-summary-untouched-count"]',
      ),
    ).toBeNull();
  });

  /**
   * The failure list scrolls; the panel does not grow without bound.
   *
   * A chunk is 20 tasks, so a double-figure failure count is routine. Without a
   * cap the list pushes the board region down until the columns are unusable,
   * and carries Retry and Dismiss off screen with it — the controls that exist
   * to deal with the very list doing the pushing.
   */
  it('bounds the failure list height and scrolls it', async () => {
    const fixture = await render(
      summary({
        requested: 20,
        attempted: 20,
        succeeded: 0,
        failures: Array.from({ length: 20 }, (_, index) => ({
          taskId: `TASK_2026_0${String(index).padStart(2, '0')}`,
          title: null,
          code: 'WRITE_FAILED' as const,
          message: 'the write was refused',
        })),
      }),
    );

    const list = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-bulk-summary-list"]',
    );
    const classes = list?.className ?? '';
    expect(classes).toContain('overflow-y-auto');
    expect(classes).toMatch(/max-h-/);
  });

  // -------------------------------------------------------------------------
  // FR-C4.4 — the language ban, asserted over rendered text
  // -------------------------------------------------------------------------
  describe('the three banned words', () => {
    /**
     * They appear in NO label, tooltip, or message on either bulk surface.
     *
     * Rendered text alone would miss the half of this surface that only screen
     * readers and hover reach, so the sweep covers `textContent` plus every
     * `title`, `aria-label` and `alt` in the tree — a reassuring word hidden in
     * a tooltip is exactly the shape this ban exists to refuse.
     *
     * Both bulk components are swept, and the bar is swept in all three of its
     * states, because the confirmation is the single most likely place for
     * somebody to reach for the word "atomic" while trying to be reassuring.
     */
    const BANNED = ['atomic', 'transactional', 'all-or-nothing'];

    function sweep(element: HTMLElement): string {
      const parts = [element.textContent ?? ''];
      for (const node of Array.from(element.querySelectorAll('*'))) {
        for (const attribute of ['title', 'aria-label', 'alt']) {
          const value = node.getAttribute(attribute);
          if (value !== null) parts.push(value);
        }
      }
      const rootLabel = element.getAttribute('aria-label');
      if (rootLabel !== null) parts.push(rootLabel);
      return parts.join(' ').toLowerCase();
    }

    it('appear nowhere in the failure summary', async () => {
      const fixture = await render(
        summary({
          requested: 120,
          attempted: 40,
          succeeded: 38,
          cancelled: true,
          failures: [
            {
              taskId: 'TASK_2026_001',
              title: 'Title TASK_2026_001',
              code: 'TASK_CONFLICT',
              message: 'the carrier moved',
              currentStatus: 'in_review',
            },
            {
              taskId: 'TASK_2026_002',
              title: 'Title TASK_2026_002',
              code: 'WRITE_FAILED',
              message: 'the write was refused',
            },
          ],
        }),
      );

      const swept = sweep(fixture.nativeElement as HTMLElement);
      for (const word of BANNED) {
        expect(swept).not.toContain(word);
      }
    });

    /**
     * The same sweep over the LABEL states this task added.
     *
     * A ratchet that only covers what existed when it was written stops being a
     * ratchet the moment anything is added beside it: the reassuring word would
     * simply be typed into the new sentence instead. The label confirmation is
     * the likeliest place for it, for exactly the reason the status one was.
     */
    it('appear nowhere in a label summary that reports no-ops', async () => {
      const fixture = await render(
        summary({
          operation: labelOp('licensing', 'add'),
          requested: 10,
          attempted: 10,
          succeeded: 9,
          noop: 8,
          failures: [
            {
              taskId: 'TASK_2026_001',
              title: 'Title TASK_2026_001',
              code: 'INVALID_PARAMS',
              message: 'A task may carry at most 12 labels.',
            },
          ],
        }),
      );

      const swept = sweep(fixture.nativeElement as HTMLElement);
      for (const word of BANNED) {
        expect(swept).not.toContain(word);
      }
    });

    it.each([
      ['idle', { count: 42, requested: null, progress: null }],
      [
        'awaiting confirmation',
        { count: 42, requested: moveTo('done'), progress: null },
      ],
      [
        'awaiting confirmation of a label add',
        {
          count: 42,
          requested: labelOp('licensing', 'add'),
          progress: null,
        },
      ],
      [
        'awaiting confirmation of a label removal',
        {
          count: 42,
          requested: labelOp('licensing', 'remove'),
          progress: null,
        },
      ],
      [
        'running',
        {
          count: 42,
          requested: null,
          progress: {
            operation: moveTo('done'),
            done: 20,
            total: 42,
            cancelled: false,
          },
        },
      ],
      [
        'running a label add',
        {
          count: 42,
          requested: null,
          progress: {
            operation: labelOp('licensing', 'add'),
            done: 20,
            total: 42,
            cancelled: false,
          },
        },
      ],
      [
        'running a label removal',
        {
          count: 42,
          requested: null,
          progress: {
            operation: labelOp('licensing', 'remove'),
            done: 20,
            total: 42,
            cancelled: false,
          },
        },
      ],
    ])('appear nowhere in the bulk bar (%s)', async (_state, inputs) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [TaskBulkBarComponent] });
      const fixture = TestBed.createComponent(TaskBulkBarComponent);
      fixture.componentRef.setInput('count', inputs.count);
      fixture.componentRef.setInput('hiddenCount', 3);
      fixture.componentRef.setInput('matchedCount', 90);
      fixture.componentRef.setInput('requested', inputs.requested);
      fixture.componentRef.setInput('progress', inputs.progress);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const swept = sweep(fixture.nativeElement as HTMLElement);
      for (const word of BANNED) {
        expect(swept).not.toContain(word);
      }
    });
  });
});

describe('TaskBulkBarComponent', () => {
  async function renderBar(
    inputs: Record<string, unknown>,
  ): Promise<ComponentFixture<TaskBulkBarComponent>> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [TaskBulkBarComponent] });
    const fixture = TestBed.createComponent(TaskBulkBarComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /**
   * FR-C4.12 — the confirmation names BOTH facts.
   *
   * The count and the target status are the two things that decide whether this
   * is the action the user meant. A prompt missing either is one people learn
   * to click through, so both are asserted, and asserted on the visible prompt
   * rather than on an aria-label that a sighted user never meets.
   */
  it('names the count AND the target status in the confirmation', async () => {
    const fixture = await renderBar({
      count: 42,
      requested: moveTo('in_review'),
    });

    const prompt = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-bulk-confirm"]',
    );
    expect(prompt?.textContent).toContain('Move 42 task(s) to In Review?');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-confirm-run"]',
      )?.textContent,
    ).toContain('Move 42 to In Review');
  });

  /**
   * The commit button does not use the known-failing primary pair.
   *
   * `bg-primary` + `text-primary-content` is 4.144:1 on anubis, the app
   * default, against a 4.5:1 gate — recorded by Batch 7, refused by Batch 9,
   * and moved off by Batch 10 for the palette's active row. This is the button
   * that commits N irreversible carrier writes, so it is the last control in
   * the feature that should carry it.
   *
   * Pinned as CONSTRUCT ABSENCE rather than as a ratio: jsdom computes no
   * colours, so a computed-style assertion here would be vacuous. The measured
   * ratios for the replacement live in the component's own docblock.
   */
  it('does not commit the bulk write through a btn-primary control', async () => {
    const fixture = await renderBar({ count: 42, requested: moveTo('done') });

    const confirm = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-bulk-confirm-run"]',
    );
    expect(confirm).not.toBeNull();
    expect(confirm?.className).not.toContain('btn-primary');
    expect(confirm?.className).not.toContain('btn-secondary');
    expect(confirm?.className).not.toContain('btn-accent');
    // …and it is carried by the base pair instead.
    expect(confirm?.className).toContain('text-base-content');
    expect(confirm?.className).toContain('border-base-content');
  });

  /**
   * The alertdialog contains the controls that answer it.
   *
   * The role promises assistive technology a grouping; a Confirm button outside
   * it is a prompt the user is told about and then has to go find.
   */
  it('encloses both confirmation buttons inside the alertdialog', async () => {
    const fixture = await renderBar({ count: 42, requested: moveTo('done') });
    const dialog = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-bulk-confirm"]',
    );

    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(
      dialog?.querySelector('[data-testid="task-bulk-confirm-run"]'),
    ).not.toBeNull();
    expect(
      dialog?.querySelector('[data-testid="task-bulk-confirm-cancel"]'),
    ).not.toBeNull();
  });

  it('shows progress as done over total while a run is in flight', async () => {
    const fixture = await renderBar({
      count: 42,
      progress: {
        operation: moveTo('done'),
        done: 7,
        total: 12,
        cancelled: false,
      },
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-progress"]',
      )?.textContent,
    ).toContain('7 / 12');
  });

  it('states how many of the selection the filter is hiding', async () => {
    const fixture = await renderBar({ count: 12, hiddenCount: 9 });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-hidden"]',
      )?.textContent,
    ).toContain('9 of them hidden by the filter');
  });

  // -------------------------------------------------------------------------
  // The label control (FR-C5)
  // -------------------------------------------------------------------------

  /** The label field, and the two picks it can produce. */
  function labelField(
    fixture: ComponentFixture<TaskBulkBarComponent>,
  ): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-bulk-label-input"]',
    ) as HTMLInputElement;
  }

  /**
   * Record BOTH outputs. A label control wired to `statusPicked` — or one that
   * fires both — is a defect an assertion counting only `labelPicked` cannot
   * see.
   */
  function watch(fixture: ComponentFixture<TaskBulkBarComponent>): {
    labels: unknown[];
    statuses: unknown[];
  } {
    const labels: unknown[] = [];
    const statuses: unknown[] = [];
    fixture.componentInstance.labelPicked.subscribe((pick) =>
      labels.push(pick),
    );
    fixture.componentInstance.statusPicked.subscribe((status) =>
      statuses.push(status),
    );
    return { labels, statuses };
  }

  it('emits the trimmed label with mode add, and clears the field', async () => {
    const fixture = await renderBar({ count: 4 });
    const seen = watch(fixture);
    const field = labelField(fixture);
    field.value = '  licensing  ';

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-label-add"]',
      ) as HTMLButtonElement
    ).click();

    expect(seen.labels).toEqual([{ label: 'licensing', mode: 'add' }]);
    expect(seen.statuses).toEqual([]);
    // Cleared, for the same reason the status picker resets: the control is a
    // verb, and a populated field reads as a property of the selection.
    expect(field.value).toBe('');
  });

  it('emits mode remove from the Remove control', async () => {
    const fixture = await renderBar({ count: 4 });
    const seen = watch(fixture);
    labelField(fixture).value = 'licensing';

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-label-remove"]',
      ) as HTMLButtonElement
    ).click();

    expect(seen.labels).toEqual([{ label: 'licensing', mode: 'remove' }]);
    expect(seen.statuses).toEqual([]);
  });

  /**
   * THE KEYBOARD PATH, driven as a keyboard.
   *
   * Nothing is clicked here. A test that reached the same emission through
   * `.click()` on the Add button would pass against a bar whose field ignores
   * Enter entirely — which is a control that is unusable without a mouse for
   * its most common action.
   */
  it('adds the label when Enter is pressed in the field, with no click anywhere', async () => {
    const fixture = await renderBar({ count: 4 });
    const seen = watch(fixture);
    const field = labelField(fixture);
    const clicks: string[] = [];
    for (const button of Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    )) {
      button.addEventListener('click', () =>
        clicks.push(button.getAttribute('data-testid') ?? ''),
      );
    }
    field.value = 'licensing';

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();

    expect(seen.labels).toEqual([{ label: 'licensing', mode: 'add' }]);
    expect(seen.statuses).toEqual([]);
    expect(clicks).toEqual([]);
    expect(field.value).toBe('');
  });

  /**
   * An empty field is not a request. Nothing is emitted and the field is left
   * exactly as the user left it — including the whitespace they typed, which
   * clearing would make look like an action had been taken.
   */
  it('emits nothing for a whitespace-only field', async () => {
    const fixture = await renderBar({ count: 4 });
    const seen = watch(fixture);
    const field = labelField(fixture);
    field.value = '   ';

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-label-add"]',
      ) as HTMLButtonElement
    ).click();
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(seen.labels).toEqual([]);
    expect(seen.statuses).toEqual([]);
    expect(field.value).toBe('   ');
  });

  /**
   * The confirmation over a label run names the label, the direction AND the
   * count — the three facts that decide whether this is the action meant.
   */
  it.each([
    [
      'add',
      labelOp('licensing', 'add'),
      'Add the label "licensing" to 42 task(s)?',
      'Add "licensing" to 42',
    ],
    [
      'remove',
      labelOp('licensing', 'remove'),
      'Remove the label "licensing" from 42 task(s)?',
      'Remove "licensing" from 42',
    ],
  ])(
    'names the label, the direction and the count in the confirmation (%s)',
    async (_mode, operation, prompt, action) => {
      const fixture = await renderBar({ count: 42, requested: operation });
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="task-bulk-confirm"]')?.textContent,
      ).toContain(prompt);
      expect(
        host.querySelector('[data-testid="task-bulk-confirm-run"]')
          ?.textContent,
      ).toContain(action);
    },
  );

  it.each([
    ['add', labelOp('licensing', 'add'), 'Adding the label "licensing"'],
    [
      'remove',
      labelOp('licensing', 'remove'),
      'Removing the label "licensing"',
    ],
  ])(
    'says which label a running label run is applying (%s)',
    async (_mode, operation, expected) => {
      const fixture = await renderBar({
        count: 42,
        progress: { operation, done: 7, total: 12, cancelled: false },
      });

      const progress = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-progress"]',
      )?.textContent;
      expect(progress).toContain(expected);
      expect(progress).toContain('7 / 12');
      // It does not describe a label run as a status move.
      expect(progress).not.toContain('Moving to');
    },
  );

  /**
   * A control whose only possible effect is nothing must not be offered — the
   * user cannot tell that by looking at it.
   */
  it('offers select-all-matching only when it would add something', async () => {
    const nothingToAdd = await renderBar({ count: 12, matchedCount: 12 });
    expect(
      (nothingToAdd.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-select-all"]',
      ),
    ).toBeNull();

    const more = await renderBar({ count: 12, matchedCount: 90 });
    expect(
      (more.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-select-all"]',
      )?.textContent,
    ).toContain('Select all 90 matching');
  });
});
