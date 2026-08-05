import { TestBed } from '@angular/core/testing';
import {
  buildTaskGraph,
  type TaskGraph,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { LABEL_CHIP_CLASSES, labelChipClass } from '../../task-presentation';
import {
  TaskCardComponent,
  type TaskStartRequest,
  type TaskStatusChange,
} from './task-card.component';

function makeTask(overrides: Partial<TaskSpecSummary> = {}): TaskSpecSummary {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Implement the board',
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

/**
 * Every affordance the five new metadata fields can add to a card. The
 * zero-metadata assertion below is "none of these exist"; each positive test
 * claims exactly one of them.
 */
const METADATA_TESTIDS = [
  'task-card-labels',
  'task-card-estimate',
  'task-card-rollup',
  'task-card-parent',
  'task-card-duplicate',
] as const;

describe('TaskCardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskCardComponent] });
  });

  function render(task: TaskSpecSummary, graph: TaskGraph | null = null) {
    const fixture = TestBed.createComponent(TaskCardComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('graph', graph);
    fixture.detectChanges();
    return fixture;
  }

  it('renders id, title, and type badge', () => {
    const fixture = render(makeTask());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TASK_2026_200');
    expect(text).toContain('Implement the board');
    expect(text).toContain('FEATURE');
  });

  it('shows a validation-warning affordance when frontmatter is invalid', () => {
    const fixture = render(
      makeTask({
        frontmatterValid: false,
        validationIssues: [
          { field: 'type', code: 'invalid_type', message: 'bad type' },
        ],
      }),
    );
    const warning = (fixture.nativeElement as HTMLElement).querySelector(
      '[title="Frontmatter has validation warnings"]',
    );
    expect(warning).not.toBeNull();
  });

  it('renders a depends_on indicator when dependencies exist', () => {
    const fixture = render(makeTask({ dependsOn: ['TASK_2026_100'] }));
    const dep = (fixture.nativeElement as HTMLElement).querySelector(
      '[title="Depends on: TASK_2026_100"]',
    );
    expect(dep).not.toBeNull();
  });

  it('emits start with the worktree flag when Start is clicked', () => {
    const fixture = render(makeTask());
    let emitted: TaskStartRequest | undefined;
    fixture.componentInstance.startTask.subscribe((r) => (emitted = r));

    fixture.componentInstance.isolate.set(true);
    const startBtn = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Start task TASK_2026_200"]',
    ) as HTMLButtonElement;
    startBtn.click();

    expect(emitted).toEqual({ taskId: 'TASK_2026_200', isolate: true });
  });

  it('emits statusChange when a different status is picked', () => {
    const fixture = render(makeTask({ status: 'backlog' }));
    let emitted: TaskStatusChange | undefined;
    fixture.componentInstance.statusChange.subscribe((c) => (emitted = c));

    // Invoke the protected handler through the template contract.
    (
      fixture.componentInstance as unknown as {
        onStatusPick: (s: string) => void;
      }
    ).onStatusPick('in_progress');

    expect(emitted).toEqual({
      taskId: 'TASK_2026_200',
      status: 'in_progress',
    });
  });

  // -------------------------------------------------------------------------
  // The zero-metadata workspace (plan §6.7) — the acceptance test for
  // "adding metadata support did not change a card that has no metadata".
  // -------------------------------------------------------------------------
  describe('a card with none of the five metadata fields', () => {
    it.each(METADATA_TESTIDS)('renders no %s affordance', (testid) => {
      const fixture = render(makeTask());
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          `[data-testid="${testid}"]`,
        ),
      ).toBeNull();
    });

    it('renders no chip, badge, rollup, breadcrumb or marker even with a full graph', () => {
      // A real graph over a real board — the card is still bare because THIS
      // task declares nothing and nothing declares it.
      const graph = buildTaskGraph([
        makeTask(),
        makeTask({ id: 'TASK_2026_201', folderName: 'TASK_2026_201' }),
      ]);
      const host = render(makeTask(), graph).nativeElement as HTMLElement;
      for (const testid of METADATA_TESTIDS) {
        expect(host.querySelector(`[data-testid="${testid}"]`)).toBeNull();
      }
    });

    it('carries exactly one badge — the type badge — and no metadata text', () => {
      const host = render(makeTask()).nativeElement as HTMLElement;
      const badges = Array.from(host.querySelectorAll('.badge')).filter(
        (el) => !el.classList.contains('badge-square'),
      );
      expect(badges).toHaveLength(1);
      expect(badges[0].textContent?.trim()).toBe('FEATURE');

      const text = host.textContent ?? '';
      expect(text).not.toContain('duplicate');
      expect(text).not.toContain('not linked');
      // No "unestimated" / "add label" nag of any wording.
      expect(text.toLowerCase()).not.toContain('unestimated');
      expect(text.toLowerCase()).not.toContain('add label');
    });

    it('keeps the card body structurally unchanged (four child blocks)', () => {
      // header row, title, meta row, actions footer. A sixth block appearing
      // here is the exact regression the pixel-identity gate is about.
      const host = render(makeTask()).nativeElement as HTMLElement;
      const body = host.querySelector('.card-body');
      expect(body?.children).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // The five fields, each rendered
  // -------------------------------------------------------------------------
  it('renders every one of the five declared fields when all are present', () => {
    // All five carrier fields on one task. `relates_to` has no card affordance
    // by design — a loose relation is a detail-panel fact, not a board glance —
    // so it is asserted in the detail spec, not here.
    const parent = makeTask({
      id: 'TASK_2026_100',
      folderName: 'TASK_2026_100',
    });
    const task = makeTask({
      parent: 'TASK_2026_100',
      labels: ['licensing', 'needs:design'],
      estimate: 'M',
      duplicates: ['TASK_2026_100'],
      relatesTo: ['TASK_2026_100'],
    });
    const host = render(task, buildTaskGraph([parent, task]))
      .nativeElement as HTMLElement;

    const at = (testid: string): HTMLElement | null =>
      host.querySelector(`[data-testid="${testid}"]`);

    expect(at('task-card-labels')?.textContent).toContain('licensing');
    expect(at('task-card-labels')?.textContent).toContain('needs:design');
    expect(at('task-card-estimate')?.textContent?.trim()).toBe('M');
    expect(at('task-card-parent')?.textContent).toContain('TASK_2026_100');
    expect(at('task-card-duplicate')?.textContent).toContain('duplicate');
  });

  it('renders a child rollup of completed over total, as a control', () => {
    // Parentage is ONE level deep, so a task with children can never also
    // declare a parent — the rollup and the breadcrumb are mutually exclusive
    // on a valid board, and this fixture is the parent half of that pair.
    const task = makeTask();
    const children = [
      makeTask({
        id: 'TASK_2026_201',
        folderName: 'TASK_2026_201',
        parent: 'TASK_2026_200',
        status: 'done',
      }),
      makeTask({
        id: 'TASK_2026_202',
        folderName: 'TASK_2026_202',
        parent: 'TASK_2026_200',
        status: 'in_progress',
      }),
      makeTask({
        id: 'TASK_2026_203',
        folderName: 'TASK_2026_203',
        parent: 'TASK_2026_200',
        status: 'cancelled',
      }),
    ];
    const host = render(task, buildTaskGraph([task, ...children]))
      .nativeElement as HTMLElement;
    const rollup = host.querySelector('[data-testid="task-card-rollup"]');

    expect(rollup?.textContent?.replace(/\s+/g, ' ')).toContain('1 / 3');
    expect(rollup?.getAttribute('title')).toContain('1 done');
    expect(rollup?.getAttribute('title')).toContain('1 open');
    expect(rollup?.getAttribute('title')).toContain('1 cancelled');

    // "1 / 3" is not an accessible name — the sentence must be in the tree,
    // and the bare numerals must be out of it.
    const srOnly = rollup?.querySelector('.sr-only');
    expect(srOnly?.textContent).toContain('Sub-tasks');
    expect(srOnly?.textContent).toContain('1 done');
    const glyph = rollup?.querySelector(
      '[data-testid="task-card-rollup-glyph"]',
    );
    expect(glyph?.textContent?.replace(/\s+/g, ' ')).toContain('1 / 3');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');

    // FR-B3.3: it is a button, and its accessible name says what pressing it
    // does — a control named only by its value tells a screen-reader user what
    // it reads and nothing about what it will do.
    expect(rollup?.tagName).toBe('BUTTON');
    expect(srOnly?.textContent).toContain('show only these sub-tasks');
  });

  // -------------------------------------------------------------------------
  // Keyboard activation (FR-C7.2), and the pre-existing double-fire it closes
  //
  // Every assertion below dispatches a real `keydown` on a real element. The
  // `.click()`-driven test further down proves the MOUSE path and nothing
  // else: a descendant's `click` handler calls `stopPropagation`, so the mouse
  // path was never the broken one. The keyboard path had no such guard — the
  // `keydown` bubbles to the card root before the browser synthesises the
  // descendant's click — and that is what these pin.
  // -------------------------------------------------------------------------
  describe('keyboard activation', () => {
    function keydown(target: Element, key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    }

    function withRollup() {
      const parent = makeTask();
      const child = makeTask({
        id: 'TASK_2026_201',
        folderName: 'TASK_2026_201',
        parent: 'TASK_2026_200',
      });
      const fixture = render(parent, buildTaskGraph([parent, child]));
      const opened: string[] = [];
      const toggled: string[] = [];
      const narrowed: string[] = [];
      fixture.componentInstance.selectTask.subscribe((id) => opened.push(id));
      fixture.componentInstance.toggleTask.subscribe((id) => toggled.push(id));
      fixture.componentInstance.filterChildren.subscribe((id) =>
        narrowed.push(id),
      );
      return { fixture, opened, toggled, narrowed };
    }

    const at = (fixture: { nativeElement: unknown }, selector: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        selector,
      ) as HTMLElement;

    it('carries an explicit focus ring, because the card root is a div (NFR-12)', () => {
      // The webview's global focus rule (`styles.css:439`) covers
      // `button/input/select/textarea/a`. The card root is a
      // `<div role="button">`, so it is outside that rule and would otherwise
      // show the browser default — which is the exact Batch 7 finding #8 that
      // the two filter components already fixed. The token is the same one
      // they use, so the board has ONE ring rather than a second opinion.
      //
      // Pinned as the CONSTRUCT, not as a contrast ratio: jsdom computes no
      // colours and no layout, so a ratio assertion here would be theatre. The
      // ratio belongs to the visual pass.
      const classes =
        (render(makeTask()).nativeElement as HTMLElement).querySelector(
          '[role="button"]',
        )?.className ?? '';

      expect(classes).toContain('focus-visible:outline');
      expect(classes).toContain('focus-visible:outline-2');
      expect(classes).toContain('focus-visible:outline-offset-2');
      expect(classes).toContain('focus-visible:outline-[oklch(var(--s))]');
    });

    it('opens the card when Enter lands on the card itself', () => {
      const { fixture, opened } = withRollup();
      const event = keydown(at(fixture, '[role="button"]'), 'Enter');

      expect(opened).toEqual(['TASK_2026_200']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('toggles the card when Space lands on the card itself', () => {
      const { fixture, opened, toggled } = withRollup();
      const event = keydown(at(fixture, '[role="button"]'), ' ');

      expect(toggled).toEqual(['TASK_2026_200']);
      expect(opened).toEqual([]);
      // Space on a card must never also scroll the column.
      expect(event.defaultPrevented).toBe(true);
    });

    /**
     * A card whose declared parent WAS honoured, so the crumb renders as a
     * button.
     *
     * A second fixture is needed because parentage is one level deep: a task
     * with children can never also declare a parent, so the rollup and the
     * crumb are mutually exclusive on a valid board and cannot be covered by
     * one card. The rendered card is TASK_2026_200 in both, so every selector
     * below is stable across the pair.
     */
    function withParent() {
      const parent = makeTask({
        id: 'TASK_2026_100',
        folderName: 'TASK_2026_100',
      });
      const child = makeTask({ parent: 'TASK_2026_100' });
      const fixture = render(child, buildTaskGraph([parent, child]));
      const opened: string[] = [];
      const toggled: string[] = [];
      fixture.componentInstance.selectTask.subscribe((id) => opened.push(id));
      fixture.componentInstance.toggleTask.subscribe((id) => toggled.push(id));
      return { fixture, opened, toggled };
    }

    /**
     * EVERY focusable descendant of a card, and which fixture renders it.
     *
     * The count is the finding: the card root is a role="button" holding TEN
     * focusable descendants — the status-menu trigger, its menu container, its
     * six status options, the isolate toggle and Start — eleven nodes with the
     * root, twelve where a parent crumb renders. The six menu options are one
     * repeated control and are covered by the trigger plus the board spec's
     * count; the five DISTINCT controls are enumerated here and each is
     * exercised against BOTH activation keys.
     */
    const DESCENDANTS = [
      [
        'the status-menu trigger',
        'button[aria-label="Change status"]',
        'rollup',
      ],
      ['a status menu option', '.dropdown-content button', 'rollup'],
      ['Start', 'button[aria-label="Start task TASK_2026_200"]', 'rollup'],
      ['the isolate toggle', 'input[type="checkbox"]', 'rollup'],
      ['the child rollup', '[data-testid="task-card-rollup"]', 'rollup'],
      ['the parent crumb', '[data-testid="task-card-parent"] button', 'parent'],
    ] as const;

    const fixtureFor = (which: 'rollup' | 'parent') =>
      which === 'rollup' ? withRollup() : withParent();

    it('does NOT open the card when Enter lands on the child rollup', () => {
      // Called out separately from the table because this one has a named,
      // documented consequence: Enter on the rollup narrowed the board to this
      // task's children — which EXCLUDES this task — while opening the detail
      // panel for the task that had just become invisible. One keypress, two
      // contradictory outcomes.
      const { fixture, opened, toggled } = withRollup();

      keydown(at(fixture, '[data-testid="task-card-rollup"]'), 'Enter');

      expect(opened).toEqual([]);
      expect(toggled).toEqual([]);
    });

    it.each(DESCENDANTS)(
      'does NOT open or toggle the card when Enter lands on %s',
      (_name, selector, which) => {
        const { fixture, opened, toggled } = fixtureFor(which);

        const target = at(fixture, selector);
        expect(target).not.toBeNull();
        keydown(target, 'Enter');

        expect(opened).toEqual([]);
        expect(toggled).toEqual([]);
      },
    );

    it.each(DESCENDANTS)(
      'does NOT open or toggle the card when Space lands on %s',
      (_name, selector, which) => {
        const { fixture, opened, toggled } = fixtureFor(which);

        const target = at(fixture, selector);
        expect(target).not.toBeNull();
        keydown(target, ' ');

        expect(opened).toEqual([]);
        expect(toggled).toEqual([]);
      },
    );
  });

  it('emits the PARENT id from the rollup, and does not open the card', () => {
    const task = makeTask();
    const child = makeTask({
      id: 'TASK_2026_201',
      folderName: 'TASK_2026_201',
      parent: 'TASK_2026_200',
    });
    const fixture = render(task, buildTaskGraph([task, child]));

    const parents: string[] = [];
    const opened: string[] = [];
    fixture.componentInstance.filterChildren.subscribe((id) =>
      parents.push(id),
    );
    fixture.componentInstance.selectTask.subscribe((id) => opened.push(id));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="task-card-rollup"]')
      ?.click();

    expect(parents).toEqual(['TASK_2026_200']);
    // The click is stopped at the badge: narrowing the board and opening the
    // detail panel are different intents and must not both fire.
    expect(opened).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Density — the board has exactly ONE column width (16rem), so an unbounded
  // card is not an edge case, it is the only case.
  // -------------------------------------------------------------------------
  describe('label density', () => {
    const many = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

    it('caps the visible chips and rolls the rest into a +N affordance', () => {
      const host = render(makeTask({ labels: many }))
        .nativeElement as HTMLElement;
      const chips = host.querySelectorAll(
        '[data-testid="task-card-labels"] .badge:not([data-testid])',
      );
      expect(chips).toHaveLength(3);

      const overflow = host.querySelector(
        '[data-testid="task-card-labels-overflow"]',
      );
      expect(overflow?.textContent?.trim()).toBe('+2');
      // The overflow chip NAMES what it stands for — it is not a silent drop.
      expect(overflow?.getAttribute('aria-label')).toContain('delta');
      expect(overflow?.getAttribute('aria-label')).toContain('epsilon');
    });

    it('shows no overflow chip when every label fits', () => {
      const host = render(makeTask({ labels: ['alpha', 'beta'] }))
        .nativeElement as HTMLElement;
      expect(
        host.querySelector('[data-testid="task-card-labels-overflow"]'),
      ).toBeNull();
    });

    it('bounds a single long unbroken label so it cannot escape the card', () => {
      const host = render(makeTask({ labels: ['a'.repeat(200)] }))
        .nativeElement as HTMLElement;
      const chip = host.querySelector(
        '[data-testid="task-card-labels"] .badge',
      );
      expect(chip?.className).toContain('truncate');
      expect(chip?.className).toContain('max-w-');
    });
  });

  it('renders label text verbatim as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const host = render(makeTask({ labels: [hostile] }))
      .nativeElement as HTMLElement;
    const chips = host.querySelector('[data-testid="task-card-labels"]');
    expect(chips?.textContent).toContain(hostile);
    expect(chips?.querySelector('img')).toBeNull();
  });

  it('gives case- and whitespace-variant labels the same chip colour (R9)', () => {
    expect(labelChipClass('Licensing')).toBe(labelChipClass('licensing '));
    expect(LABEL_CHIP_CLASSES).toContain(labelChipClass('Licensing'));
  });

  it('draws every palette slot from a distinct hue', () => {
    // Not the perceptual audit — that is a documented manual gate with numbers
    // in `task-presentation.ts`. This is the cheap half of it: two slots keyed
    // to the SAME hue would be an outright duplicate, and the hash would then
    // have seven usable colours while claiming eight.
    const hues = LABEL_CHIP_CLASSES.map(
      (entry) => /bg-([a-z]+)-100/.exec(entry)?.[1],
    );
    expect(hues.every((hue) => hue !== undefined)).toBe(true);
    expect(new Set(hues).size).toBe(LABEL_CHIP_CLASSES.length);
  });

  it('states fill, text and border for every slot, so no chip inherits a theme colour', () => {
    for (const entry of LABEL_CHIP_CLASSES) {
      expect(entry).toMatch(/\bbg-[a-z]+-100\b/);
      expect(entry).toMatch(/\btext-[a-z]+-800\b/);
      expect(entry).toMatch(/\bborder-[a-z]+-700\b/);
    }
  });

  it('opens the parent when the parent claim was honoured', () => {
    const parent = makeTask({
      id: 'TASK_2026_100',
      folderName: 'TASK_2026_100',
    });
    const task = makeTask({ parent: 'TASK_2026_100' });
    const fixture = render(task, buildTaskGraph([parent, task]));
    let emitted: string | undefined;
    fixture.componentInstance.selectTask.subscribe((id) => (emitted = id));

    const button = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="task-card-parent"] button',
    ) as HTMLButtonElement;
    button.click();

    expect(emitted).toBe('TASK_2026_100');
  });

  it('states why a refused parent claim is not navigable, and offers no control', () => {
    // A parent naming a folder that is not on the board: the value is still
    // shown (it is the only evidence of what the author meant) but there is
    // nothing to open, so there is no button to press.
    const task = makeTask({
      parent: 'TASK_2026_999',
      validationIssues: [
        {
          field: 'parent',
          code: 'dangling_parent',
          message: `parent 'TASK_2026_999' does not resolve to a readable task; the claim is not honoured.`,
          ref: 'TASK_2026_999',
        },
      ],
    });
    const host = render(task, buildTaskGraph([task]))
      .nativeElement as HTMLElement;
    const crumb = host.querySelector('[data-testid="task-card-parent"]');

    expect(crumb?.querySelector('button')).toBeNull();
    expect(crumb?.textContent).toContain('TASK_2026_999');
    expect(crumb?.textContent).toContain('not linked');

    // A `title` needs a mouse. The reason has to be in the accessibility tree
    // or "disabled with a stated reason" is only true for pointer users.
    expect(crumb?.getAttribute('role')).toBe('note');
    const label = crumb?.getAttribute('aria-label') ?? '';
    expect(label).toContain('TASK_2026_999');
    expect(label).toContain('is not honoured');
  });

  it('adds no accessible-name override when the parent IS navigable', () => {
    const parent = makeTask({
      id: 'TASK_2026_100',
      folderName: 'TASK_2026_100',
    });
    const task = makeTask({ parent: 'TASK_2026_100' });
    const host = render(task, buildTaskGraph([parent, task]))
      .nativeElement as HTMLElement;
    const crumb = host.querySelector('[data-testid="task-card-parent"]');

    expect(crumb?.getAttribute('role')).toBeNull();
    expect(crumb?.getAttribute('aria-label')).toBeNull();
  });
});
