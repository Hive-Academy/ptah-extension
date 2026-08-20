import { ApplicationRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TaskPaletteAction, TaskPaletteEntry } from './palette-entries';
import { TaskCommandPaletteComponent } from './task-command-palette.component';

function entry(
  id: string,
  label: string,
  overrides: Partial<TaskPaletteEntry> = {},
): TaskPaletteEntry {
  return {
    id,
    label,
    group: 'board',
    disabledReason: null,
    action: { kind: 'createTask' },
    ...overrides,
  };
}

const CATALOGUE: readonly TaskPaletteEntry[] = [
  entry('board:create', 'Create a task'),
  entry('board:reindex', 'Reindex the workspace tasks', {
    action: { kind: 'reindex' },
  }),
  entry('status:done', 'Set status: Done', {
    group: 'selection',
    disabledReason: 'No task is selected — open a task first.',
    action: { kind: 'setStatus', taskId: '', status: 'done' },
  }),
  entry('task:TASK_2026_200', 'TASK_2026_200 — Board metadata', {
    group: 'tasks',
    action: { kind: 'openTask', taskId: 'TASK_2026_200' },
  }),
];

/**
 * A catalogue built so that narrowing leaves MORE THAN ONE match.
 *
 * Seven entries; the query 'filter' matches FOUR of them. Three are prefix
 * matches and rank above 'Clear all filters', which is an interior match — so
 * after narrowing, row 0 is 'Filter by status: Done' and row 3 is 'Clear all
 * filters'. That spread is the point: with a single survivor the shared
 * `KeyboardNavigationService` clamp alone would produce the same answer as an
 * eager reset, and the test would pass with the reset removed.
 */
const NARROWING_CATALOGUE: readonly TaskPaletteEntry[] = [
  entry('filter:clear', 'Clear all filters', {
    group: 'filters',
    action: { kind: 'clearFilter' },
  }),
  entry('board:create', 'Create a task'),
  entry('board:reindex', 'Reindex the workspace tasks', {
    action: { kind: 'reindex' },
  }),
  // Three prefix matches for 'filter', each with a DISTINCT action, so the
  // assertion can name exactly which row ran rather than inferring it.
  entry('filter:status', 'Filter by status: Done', {
    group: 'filters',
    action: { kind: 'openTask', taskId: 'TASK_2026_300' },
  }),
  entry('filter:type', 'Filter by type: FEATURE', {
    group: 'filters',
    action: { kind: 'openTask', taskId: 'TASK_2026_301' },
  }),
  entry('filter:label', 'Filter by label: licensing', {
    group: 'filters',
    action: { kind: 'openTask', taskId: 'TASK_2026_302' },
  }),
  entry('task:TASK_2026_200', 'TASK_2026_200 — Board metadata', {
    group: 'tasks',
    action: { kind: 'openTask', taskId: 'TASK_2026_200' },
  }),
];

describe('TaskCommandPaletteComponent', () => {
  let scrollIntoView: jest.Mock;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    // jsdom implements no layout, so `scrollIntoView` is absent on Element.
    // Installing a double is what lets FR-C6.5's scroll requirement be
    // asserted rather than merely guarded against.
    scrollIntoView = jest.fn();
    (
      Element.prototype as unknown as { scrollIntoView: unknown }
    ).scrollIntoView = scrollIntoView;

    // A real, focused element to return focus to. `document.activeElement` is
    // `<body>` in a bare jsdom document, and "focus went back to body" would
    // pass a restore assertion without restoring anything.
    opener = document.createElement('button');
    opener.textContent = 'Commands';
    document.body.appendChild(opener);
    opener.focus();

    TestBed.configureTestingModule({ imports: [TaskCommandPaletteComponent] });
  });

  afterEach(() => {
    opener.remove();
    delete (Element.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
  });

  function render(
    entries: readonly TaskPaletteEntry[] = CATALOGUE,
  ): ComponentFixture<TaskCommandPaletteComponent> {
    const fixture = TestBed.createComponent(TaskCommandPaletteComponent);
    fixture.componentRef.setInput('entries', entries);
    fixture.detectChanges();
    // `afterNextRender` callbacks are run by the application tick, not by a
    // component-local `detectChanges`. Ticking here is what makes the
    // focus-on-open assertion exercise the real path instead of a lifecycle
    // hook chosen because it was easier to test.
    TestBed.inject(ApplicationRef).tick();
    return fixture;
  }

  const host = (fixture: ComponentFixture<TaskCommandPaletteComponent>) =>
    fixture.nativeElement as HTMLElement;

  const input = (fixture: ComponentFixture<TaskCommandPaletteComponent>) =>
    host(fixture).querySelector('input') as HTMLInputElement;

  const options = (fixture: ComponentFixture<TaskCommandPaletteComponent>) =>
    Array.from(host(fixture).querySelectorAll('[role="option"]'));

  /**
   * Press a key ON THE INPUT — the element that actually carries the handler.
   *
   * Every keyboard assertion in this file goes through here. Calling the
   * protected handler directly would prove the method works and prove nothing
   * about whether it is wired to anything.
   */
  function press(
    fixture: ComponentFixture<TaskCommandPaletteComponent>,
    key: string,
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    input(fixture).dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  function type(
    fixture: ComponentFixture<TaskCommandPaletteComponent>,
    value: string,
  ): void {
    const field = input(fixture);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function collectRuns(
    fixture: ComponentFixture<TaskCommandPaletteComponent>,
  ): TaskPaletteAction[] {
    const runs: TaskPaletteAction[] = [];
    fixture.componentInstance.run.subscribe((action) => runs.push(action));
    return runs;
  }

  // -------------------------------------------------------------------------
  // FR-C6.5 — the ARIA contract
  // -------------------------------------------------------------------------
  it('is a role="dialog" with an accessible name', () => {
    const dialog = host(render()).querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe(
      'Task board command palette',
    );
  });

  it('renders the results as a role="listbox" of role="option"', () => {
    const fixture = render();
    expect(host(fixture).querySelector('[role="listbox"]')).not.toBeNull();
    expect(options(fixture)).toHaveLength(CATALOGUE.length);
  });

  it('points aria-activedescendant at the active option, and moves it with the arrows', () => {
    const fixture = render();
    const ids = options(fixture).map((option) => option.id);

    expect(input(fixture).getAttribute('aria-activedescendant')).toBe(ids[0]);

    press(fixture, 'ArrowDown');
    expect(input(fixture).getAttribute('aria-activedescendant')).toBe(ids[1]);

    press(fixture, 'ArrowUp');
    expect(input(fixture).getAttribute('aria-activedescendant')).toBe(ids[0]);

    press(fixture, 'End');
    expect(input(fixture).getAttribute('aria-activedescendant')).toBe(
      ids[ids.length - 1],
    );
  });

  it('marks exactly one option aria-selected at a time', () => {
    const fixture = render();
    press(fixture, 'ArrowDown');
    const selected = options(fixture).filter(
      (option) => option.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Reindex');
  });

  it('scrolls the active option into view on every move (FR-C6.5)', () => {
    const fixture = render();
    scrollIntoView.mockClear();
    press(fixture, 'ArrowDown');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  // -------------------------------------------------------------------------
  // FR-C6.4 — full keyboard operation
  // -------------------------------------------------------------------------
  it('moves focus into the query input on open', () => {
    const fixture = render();
    expect(document.activeElement).toBe(input(fixture));
  });

  it('returns focus to whatever held it, on close', () => {
    const fixture = render();
    expect(document.activeElement).not.toBe(opener);

    fixture.destroy();

    expect(document.activeElement).toBe(opener);
  });

  it('filters as you type and ranks the prefix match first', () => {
    const fixture = render();
    type(fixture, 'task');

    const labels = options(fixture).map((option) =>
      (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    // 'TASK_2026_200 — …' is a prefix match; 'Create a task' is interior.
    expect(labels[0]).toContain('TASK_2026_200');
    expect(labels.some((label) => label.includes('Create a task'))).toBe(true);
  });

  it('runs the active entry on Enter', () => {
    const fixture = render();
    const runs = collectRuns(fixture);

    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');

    expect(runs).toEqual([{ kind: 'reindex' }]);
  });

  it('resets the active row when the query narrows the list', () => {
    // The failure this pins: type, arrow down, retype — an index left pointing
    // at the old list runs a command the user never saw highlighted. It is the
    // fastest path through this surface and therefore the likeliest one.
    //
    // THE FIXTURE IS THE ASSERTION. An earlier version of this test narrowed to
    // exactly ONE match, and it passed with the eager reset deleted — the
    // shared service's own clamp pulls an out-of-range index back to the last
    // row, and with one row "the last row" and "row 0" are the same row. The
    // test named a behaviour it could not observe. The query below leaves FOUR
    // matches, so index 3 is still in range after the narrowing and only the
    // reset can bring it back to 0.
    const fixture = render(NARROWING_CATALOGUE);
    const runs = collectRuns(fixture);

    // Down three times: active index 3 of the seven-entry catalogue.
    press(fixture, 'ArrowDown');
    press(fixture, 'ArrowDown');
    press(fixture, 'ArrowDown');
    expect(options(fixture)[3].getAttribute('aria-selected')).toBe('true');

    type(fixture, 'filter');

    // Four still match, and index 3 is one of them — so a stale index is
    // genuinely reachable here rather than being clamped away.
    expect(options(fixture)).toHaveLength(4);
    press(fixture, 'Enter');

    // Row 0 of the narrowed list ('Filter by status: Done'), not the row 3 the
    // index was left on ('Clear all filters').
    expect(runs).toEqual([{ kind: 'openTask', taskId: 'TASK_2026_300' }]);
  });

  it('closes on Escape without running anything', () => {
    const fixture = render();
    const runs = collectRuns(fixture);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    press(fixture, 'Escape');

    expect(closed).toBe(1);
    expect(runs).toEqual([]);
  });

  it('consumes only the keys it acts on', () => {
    const fixture = render();
    // Acted on — and therefore stopped, so nothing outside sees them.
    expect(press(fixture, 'ArrowDown').defaultPrevented).toBe(true);
    expect(press(fixture, 'Escape').defaultPrevented).toBe(true);
    // Typing. It must reach the input, so it is left alone.
    expect(press(fixture, 'a').defaultPrevented).toBe(false);
    expect(press(fixture, 'K').defaultPrevented).toBe(false);
  });

  it('traps Tab, because the dialog has exactly one focusable element', () => {
    const fixture = render();
    expect(press(fixture, 'Tab').defaultPrevented).toBe(true);

    // The claim behind the trap, measured: every natively focusable control
    // and everything carrying a tabindex, minus the ones held out of the tab
    // order. Exactly one survives — the query input. The backdrop button and
    // every option button are `tabindex="-1"`, so Tab reaches none of them.
    const focusable = Array.from(
      host(fixture).querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ).filter((element) => element.getAttribute('tabindex') !== '-1');
    expect(focusable).toEqual([input(fixture)]);
  });

  // -------------------------------------------------------------------------
  // NFR-12 — the constructs that failed the contrast audit, pinned ABSENT
  //
  // jsdom computes no colours, so a ratio assertion here would be theatre. What
  // it CAN prove is that the two rejected constructs are gone and that the
  // replacements are present. The ratios themselves are recomputed per theme
  // against `tailwind.config.js` and belong to the visual pass.
  // -------------------------------------------------------------------------
  describe('active and disabled row treatment', () => {
    it('carries no primary-on-primary text anywhere in the list', () => {
      // bg-primary + text-primary-content measured 4.144:1 on anubis, the app
      // default — and it was the row highlighted on every open.
      const fixture = render();
      for (const option of options(fixture)) {
        expect(option.className).not.toContain('bg-primary');
        expect(option.className).not.toContain('text-primary-content');
      }
    });

    it('carries no opacity modifier on any row, active or disabled', () => {
      // opacity-60 on the disabled row failed 4.5:1 at rest on three of the
      // four mandated bases and on all four in the active+disabled compound.
      // This is the third time opacity-as-de-emphasis has failed an audit on
      // this task, so it is pinned absent rather than merely not written.
      const fixture = render();
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown'); // land on the DISABLED row: active+disabled

      for (const option of options(fixture)) {
        const all = [option, ...Array.from(option.querySelectorAll('*'))];
        for (const element of all) {
          const classes = element.className.toString();
          expect(classes).not.toMatch(/\bopacity-\d/);
          expect(classes).not.toMatch(/text-base-content\/\d/);
        }
      }
    });

    it('marks the active runnable row with a literal Enter affordance', () => {
      // The signal that has to read as ARMED while DOM focus stays in the
      // query input. A tint can only imply that; naming the key says it.
      const fixture = render();
      const hint = () =>
        host(fixture).querySelector('[data-testid="task-palette-enter-hint"]');

      expect(hint()).not.toBeNull();
      expect(
        hint()?.closest('[role="option"]')?.getAttribute('aria-selected'),
      ).toBe('true');

      press(fixture, 'ArrowDown');
      expect(hint()?.closest('[role="option"]')?.textContent).toContain(
        'Reindex',
      );
    });

    it('shows no Enter affordance on an active DISABLED row', () => {
      const fixture = render();
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown'); // the disabled 'Set status: Done'

      const active = options(fixture).find(
        (option) => option.getAttribute('aria-selected') === 'true',
      );
      expect(active?.getAttribute('aria-disabled')).toBe('true');
      expect(
        active?.querySelector('[data-testid="task-palette-enter-hint"]'),
      ).toBeNull();
      // …and the reason is what occupies that slot instead.
      expect(
        active?.querySelector('[data-testid="task-palette-reason"]')
          ?.textContent,
      ).toContain('No task is selected');
    });

    it('lets only the label truncate, never the reason or the hint', () => {
      // Item 5, and the same fix Batch 9 applied to the view chips: the
      // untrusted, arbitrarily long element is the one allowed to shrink; the
      // short fixed ones are shrink-0. The reason sits on its own line, so it
      // cannot be crowded out at all.
      const fixture = render();
      const active = options(fixture)[0];

      const label = active.querySelector('.truncate');
      expect(label?.textContent).toContain('Create a task');
      expect(label?.className).toContain('min-w-0');

      const hint = active.querySelector(
        '[data-testid="task-palette-enter-hint"]',
      );
      expect(hint?.className).toContain('shrink-0');

      const disabled = host(fixture).querySelector(
        '[data-testid="task-palette-option-disabled"]',
      );
      const reason = disabled?.querySelector(
        '[data-testid="task-palette-reason"]',
      );
      expect(reason?.className).not.toContain('truncate');
      // Its own line: the reason is a child of the OPTION, not of the label's
      // row, so there is no flex competition for it to lose.
      expect(reason?.parentElement?.getAttribute('role')).toBe('option');
    });
  });

  // -------------------------------------------------------------------------
  // FR-C6.6 — disabled, listed, and refused
  // -------------------------------------------------------------------------
  it('lists a disabled entry rather than hiding it, and states the reason', () => {
    const fixture = render();
    const disabled = host(fixture).querySelector(
      '[data-testid="task-palette-option-disabled"]',
    );

    expect(disabled).not.toBeNull();
    expect(disabled?.getAttribute('aria-disabled')).toBe('true');
    expect(disabled?.textContent).toContain('Set status: Done');
    expect(
      disabled?.querySelector('[data-testid="task-palette-reason"]')
        ?.textContent,
    ).toContain('No task is selected');
  });

  it('refuses to run a disabled entry, and stays open', () => {
    const fixture = render();
    const runs = collectRuns(fixture);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    // Index 2 is the disabled 'Set status: Done'.
    press(fixture, 'ArrowDown');
    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');

    expect(runs).toEqual([]);
    expect(closed).toBe(0);
  });

  it('refuses a disabled entry on click too', () => {
    const fixture = render();
    const runs = collectRuns(fixture);

    host(fixture)
      .querySelector<HTMLElement>(
        '[data-testid="task-palette-option-disabled"]',
      )
      ?.click();

    expect(runs).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  it('renders entry labels as text, never as markup (BR-10)', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const fixture = render([entry('task:x', `TASK_2026_299 — ${hostile}`)]);

    const option = options(fixture)[0];
    expect(option.textContent).toContain(hostile);
    expect(option.querySelector('img')).toBeNull();
  });

  it('says how many matches it is not showing', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      entry(`task:${i}`, `TASK_2026_${200 + i} — Title`),
    );
    const fixture = render(many);

    expect(options(fixture)).toHaveLength(50);
    expect(
      host(fixture).querySelector('[data-testid="task-palette-overflow"]')
        ?.textContent,
    ).toContain('10 more match');
  });

  it('says so when nothing matches', () => {
    const fixture = render();
    type(fixture, 'zzzzz');

    expect(
      host(fixture).querySelector('[data-testid="task-palette-no-results"]'),
    ).not.toBeNull();
  });

  it('asks to close when the backdrop is clicked, and not when the dialog is', () => {
    const fixture = render();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    host(fixture)
      .querySelector<HTMLElement>('[data-testid="task-palette-dialog"]')
      ?.click();
    expect(closed).toBe(0);

    host(fixture)
      .querySelector<HTMLElement>('[data-testid="task-palette-backdrop"]')
      ?.click();
    expect(closed).toBe(1);
  });
});
