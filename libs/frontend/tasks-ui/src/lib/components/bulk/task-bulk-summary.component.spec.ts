import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TaskBulkSummaryComponent } from './task-bulk-summary.component';
import { TaskBulkBarComponent } from './task-bulk-bar.component';
import type { BulkSummary } from '../../services/tasks-store.service';

function summary(overrides: Partial<BulkSummary> = {}): BulkSummary {
  return {
    status: 'done',
    requested: 3,
    attempted: 3,
    succeeded: 3,
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
        status: 'in_review',
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
    const emitted: string[] = [];
    fixture.componentInstance.retry.subscribe((status) => emitted.push(status));
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-summary-retry"]',
      ) as HTMLButtonElement
    ).click();

    expect(emitted).toEqual(['in_review']);
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

    it.each([
      ['idle', { count: 42, requested: null, progress: null }],
      [
        'awaiting confirmation',
        { count: 42, requested: 'done' as const, progress: null },
      ],
      [
        'running',
        {
          count: 42,
          requested: null,
          progress: {
            status: 'done' as const,
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
    const fixture = await renderBar({ count: 42, requested: 'in_review' });

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
    const fixture = await renderBar({ count: 42, requested: 'done' });

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
    const fixture = await renderBar({ count: 42, requested: 'done' });
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
      progress: { status: 'done', done: 7, total: 12, cancelled: false },
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
