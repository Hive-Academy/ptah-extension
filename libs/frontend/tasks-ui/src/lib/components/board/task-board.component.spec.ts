import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  TASK_STATUSES,
  buildTaskGraph,
  type TaskSpecSummary,
  type TaskStatus,
} from '@ptah-extension/shared';
import type { TaskBoardColumn } from '../../services/tasks-store.service';
import { TaskBoardComponent } from './task-board.component';

function task(
  id: string,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status: 'backlog',
    type: 'FEATURE',
    title: `Title ${id}`,
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

/** All six columns, in canonical order, with the named ones populated. */
function columns(
  populated: Partial<Record<TaskStatus, TaskSpecSummary[]>>,
): TaskBoardColumn[] {
  return TASK_STATUSES.map((status) => {
    const tasks = populated[status] ?? [];
    return { status, tasks, total: tasks.length };
  });
}

/** Two cards in `backlog`, one in `done`, everything between them empty. */
const SPARSE = columns({
  backlog: [task('TASK_2026_200'), task('TASK_2026_201')],
  done: [task('TASK_2026_209', { status: 'done' })],
});

describe('TaskBoardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskBoardComponent] });
  });

  function render(
    board: TaskBoardColumn[] = SPARSE,
  ): ComponentFixture<TaskBoardComponent> {
    const fixture = TestBed.createComponent(TaskBoardComponent);
    fixture.componentRef.setInput('columns', board);
    fixture.componentRef.setInput(
      'graph',
      buildTaskGraph(board.flatMap((column) => column.tasks)),
    );
    fixture.detectChanges();
    return fixture;
  }

  const host = (fixture: ComponentFixture<TaskBoardComponent>) =>
    fixture.nativeElement as HTMLElement;

  /** Every element a Tab press could land on, in document order. */
  function tabStops(fixture: ComponentFixture<TaskBoardComponent>): Element[] {
    return Array.from(
      host(fixture).querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ).filter((element) => element.getAttribute('tabindex') !== '-1');
  }

  function cardRoot(
    fixture: ComponentFixture<TaskBoardComponent>,
    id: string,
  ): HTMLElement {
    const found = host(fixture).querySelector<HTMLElement>(
      `[data-task-id="${id}"]`,
    );
    if (found === null) throw new Error(`no card rendered for ${id}`);
    return found;
  }

  /**
   * Press a key on a real element inside the board.
   *
   * Never on the component instance: the whole point of a `host:` binding is
   * that a keystroke reaches it by bubbling from wherever focus actually is,
   * and calling `onKeyDown` directly would assert none of that.
   */
  function press(
    fixture: ComponentFixture<TaskBoardComponent>,
    target: Element,
    key: string,
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  // -------------------------------------------------------------------------
  // FR-C7.1 — the roving tabindex, INCLUDING the descendants
  // -------------------------------------------------------------------------
  describe('roving tabindex', () => {
    it('gives exactly one card the tab stop', () => {
      const fixture = render();
      const roots = Array.from(
        host(fixture).querySelectorAll('[data-task-id]'),
      );

      expect(roots).toHaveLength(3);
      expect(
        roots.filter((root) => root.getAttribute('tabindex') === '0'),
      ).toHaveLength(1);
      expect(roots[0].getAttribute('tabindex')).toBe('0');
    });

    it('rovers the card DESCENDANTS too, not just the root', () => {
      // The defect this pins, in the terms it was found in: the card root is a
      // role="button" that CONTAINS real <button> and <input> descendants —
      // status menu trigger, its six menu items, Start, the isolate toggle.
      // Roving the root alone leaves every one of those in the tab order on
      // every card, so a three-card board is ~30 tab stops rather than one.
      const fixture = render();

      const unfocused = cardRoot(fixture, 'TASK_2026_201');
      const strandedDescendants = Array.from(
        unfocused.querySelectorAll('button, input, [tabindex]'),
      ).filter((element) => element.getAttribute('tabindex') !== '-1');

      expect(strandedDescendants).toEqual([]);
    });

    it('confines every tab stop on the board to the ONE focused card', () => {
      // Three cards in one column, each carrying the full control set: the
      // card root, the status-menu trigger, its menu container, six status
      // options, the isolate toggle and Start — eleven focusable nodes.
      //
      // The arithmetic is the finding, and it is measured rather than
      // asserted from reading. `focusableNodes` counts what the browser COULD
      // focus, ignoring the roving attribute; `tabStops` counts what Tab
      // actually reaches. Before the descendants were rovered those two
      // numbers were IDENTICAL — no node in the card carried `tabindex="-1"`,
      // so every one of the 33 was reachable. On the 181-task board this task
      // was written against that is ~1 991 tab stops.
      const fixture = render(
        columns({
          backlog: [
            task('TASK_2026_200'),
            task('TASK_2026_201'),
            task('TASK_2026_202'),
          ],
        }),
      );
      const focused = cardRoot(fixture, 'TASK_2026_200');
      const focusableNodes = host(fixture).querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]',
      );
      const stops = tabStops(fixture);

      expect(focusableNodes).toHaveLength(33);
      expect(stops).toHaveLength(11);

      // …and all eleven belong to the one focused card.
      for (const stop of stops) {
        expect(stop === focused || focused.contains(stop)).toBe(true);
      }
      expect(stops.filter((stop) => stop === focused)).toHaveLength(1);
    });

    it('falls back to the first visible card when the focused one is filtered away', () => {
      const fixture = render();
      press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'ArrowDown');
      expect(cardRoot(fixture, 'TASK_2026_201').getAttribute('tabindex')).toBe(
        '0',
      );

      // A filter drops the focused card. Without the fallback the board would
      // have ZERO tab stops here, which is a worse keyboard failure than the
      // many it replaces.
      fixture.componentRef.setInput(
        'columns',
        columns({ backlog: [task('TASK_2026_200')] }),
      );
      fixture.detectChanges();

      expect(cardRoot(fixture, 'TASK_2026_200').getAttribute('tabindex')).toBe(
        '0',
      );
    });
  });

  // -------------------------------------------------------------------------
  // FR-C7.1 — arrow navigation over the FILTERED model
  // -------------------------------------------------------------------------
  describe('arrow navigation', () => {
    it('moves down and up within a column, and moves DOM focus with it', () => {
      const fixture = render();
      const first = cardRoot(fixture, 'TASK_2026_200');

      press(fixture, first, 'ArrowDown');
      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_201'));

      press(fixture, cardRoot(fixture, 'TASK_2026_201'), 'ArrowUp');
      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_200'));
    });

    it('stops at the ends of a column rather than wrapping', () => {
      const fixture = render();
      const first = cardRoot(fixture, 'TASK_2026_200');

      const event = press(fixture, first, 'ArrowUp');

      expect(cardRoot(fixture, 'TASK_2026_200').getAttribute('tabindex')).toBe(
        '0',
      );
      // Not consumed, so whatever else would scroll still can (R10).
      expect(event.defaultPrevented).toBe(false);
    });

    it('skips the empty columns between two populated ones', () => {
      // backlog → (in_progress, in_review, blocked, cancelled all empty) → done
      const fixture = render();

      press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'ArrowRight');

      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_209'));
    });

    it('clamps the row when the neighbouring column is shorter', () => {
      const fixture = render();
      press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'ArrowDown');
      press(fixture, cardRoot(fixture, 'TASK_2026_201'), 'ArrowRight');

      // `done` holds one card; row 1 clamps to row 0 rather than landing
      // nowhere.
      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_209'));
    });

    it('refuses to move past the last populated column', () => {
      const fixture = render();
      press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'ArrowRight');
      const event = press(
        fixture,
        cardRoot(fixture, 'TASK_2026_209'),
        'ArrowRight',
      );

      expect(cardRoot(fixture, 'TASK_2026_209').getAttribute('tabindex')).toBe(
        '0',
      );
      expect(event.defaultPrevented).toBe(false);
    });

    it('jumps to the ends of a column with Home and End', () => {
      const fixture = render();
      press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'End');
      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_201'));

      press(fixture, cardRoot(fixture, 'TASK_2026_201'), 'Home');
      expect(document.activeElement).toBe(cardRoot(fixture, 'TASK_2026_200'));
    });

    it('consumes an arrow key only when it moved something (R10)', () => {
      const fixture = render();
      expect(
        press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'ArrowDown')
          .defaultPrevented,
      ).toBe(true);
      expect(
        press(fixture, cardRoot(fixture, 'TASK_2026_201'), 'ArrowDown')
          .defaultPrevented,
      ).toBe(false);
    });

    it('ignores a key it does not handle', () => {
      const fixture = render();
      expect(
        press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'q')
          .defaultPrevented,
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // R10 — never while the user is inside a form control
  // -------------------------------------------------------------------------
  it('ignores every key raised inside a form control', () => {
    // The isolate toggle is a real `<input>` on every non-terminal card, so
    // this is not a hypothetical target: without the guard, an arrow key aimed
    // at a checkbox would move the board out from under it.
    const fixture = render();
    const focusedCard = cardRoot(fixture, 'TASK_2026_200');
    const checkbox = focusedCard.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();

    const event = press(fixture, checkbox as Element, 'ArrowDown');

    expect(event.defaultPrevented).toBe(false);
    expect(focusedCard.getAttribute('tabindex')).toBe('0');
  });

  // -------------------------------------------------------------------------
  // FR-C7.2 / FR-C7.3 — activation and Escape
  // -------------------------------------------------------------------------
  it('emits escapePressed on Escape, and consumes it', () => {
    const fixture = render();
    let escapes = 0;
    fixture.componentInstance.escapePressed.subscribe(() => (escapes += 1));

    const event = press(fixture, cardRoot(fixture, 'TASK_2026_200'), 'Escape');

    expect(escapes).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('forwards a card toggle and moves the roving focus onto it', () => {
    const fixture = render();
    const toggled: string[] = [];
    fixture.componentInstance.taskToggle.subscribe((id) => toggled.push(id));

    press(fixture, cardRoot(fixture, 'TASK_2026_209'), ' ');

    expect(toggled).toEqual(['TASK_2026_209']);
    expect(cardRoot(fixture, 'TASK_2026_209').getAttribute('tabindex')).toBe(
      '0',
    );
  });

  it('moves the roving focus to a card opened with the mouse', () => {
    const fixture = render();
    const opened: string[] = [];
    fixture.componentInstance.taskSelect.subscribe((id) => opened.push(id));

    cardRoot(fixture, 'TASK_2026_209').click();
    fixture.detectChanges();

    expect(opened).toEqual(['TASK_2026_209']);
    expect(cardRoot(fixture, 'TASK_2026_209').getAttribute('tabindex')).toBe(
      '0',
    );
  });

  it('renders nothing focusable for an empty board', () => {
    const fixture = render(columns({}));
    expect(tabStops(fixture)).toEqual([]);
  });
});
