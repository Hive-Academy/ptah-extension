import { TestBed } from '@angular/core/testing';
import type { TaskSpecSummary, TaskStatus } from '@ptah-extension/shared';
import { TaskColumnComponent } from './task-column.component';

function makeTask(id: string, status: TaskStatus = 'backlog'): TaskSpecSummary {
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
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
  };
}

describe('TaskColumnComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskColumnComponent] });
  });

  function render(tasks: TaskSpecSummary[], total: number | null = null) {
    const fixture = TestBed.createComponent(TaskColumnComponent);
    fixture.componentRef.setInput('status', 'backlog');
    fixture.componentRef.setInput('tasks', tasks);
    fixture.componentRef.setInput('total', total);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host,
      count: () =>
        host
          .querySelector('[data-testid="task-column-count"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      empty: () =>
        host
          .querySelector('[data-testid="task-column-empty"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      title: () =>
        host
          .querySelector('[data-testid="task-column-count"]')
          ?.getAttribute('title') ?? '',
    };
  }

  // ---------------------------------------------------------------------------
  // The header count
  // ---------------------------------------------------------------------------

  it('shows the bare count when the filter is hiding nothing', () => {
    expect(render([makeTask('TASK_2026_200')]).count()).toBe('1');
  });

  it('shows filtered over indexed once the filter hides something', () => {
    expect(render([makeTask('TASK_2026_200')], 3).count()).toBe('1 of 3');
  });

  /**
   * "X of X" is noise, and the rule is stated in the component's own comment —
   * this is what holds it to it. A column whose total equals its rendered list
   * is not being filtered.
   */
  it('does not render a redundant "N of N"', () => {
    expect(render([makeTask('TASK_2026_200')], 1).count()).toBe('1');
  });

  it('falls back to the rendered count when no total is supplied', () => {
    expect(render([makeTask('TASK_2026_200')]).count()).toBe('1');
  });

  /**
   * The clamp. A caller that passes a `total` SMALLER than the rendered list
   * (a stale count racing a fresh payload) would otherwise make `hidden()`
   * negative, and the header would claim "3 of 1" — a statement about the
   * workspace that is not merely useless but wrong. `Math.max(0, …)` collapses
   * that case back to the plain count.
   */
  it('clamps a total that is smaller than the rendered list', () => {
    const view = render(
      [
        makeTask('TASK_2026_200'),
        makeTask('TASK_2026_201'),
        makeTask('TASK_2026_202'),
      ],
      1,
    );
    expect(view.count()).toBe('3');
    expect(view.title()).not.toContain('of');
  });

  it('spells the relationship out in the title while filtering', () => {
    const title = render([makeTask('TASK_2026_200')], 4).title();
    expect(title).toContain('1 of 4');
    expect(title).toContain('3 hidden by the active filter');
  });

  // ---------------------------------------------------------------------------
  // The empty column — the copy this batch exists to make true
  // ---------------------------------------------------------------------------

  /**
   * The exact strings, pinned. "No tasks" under an active filter is a false
   * statement about the workspace, and that falsehood is the whole reason the
   * second sentence exists — so both are asserted verbatim rather than by
   * substring.
   */
  it('says "No tasks" only when nothing is being hidden', () => {
    const view = render([]);
    expect(view.empty()).toBe('No tasks');
  });

  it('says how many the filter is hiding instead of claiming there are none', () => {
    const view = render([], 7);
    expect(view.empty()).toBe('7 hidden by the filter');
    expect(view.empty()).not.toContain('No tasks');
  });

  /**
   * NFR-12 / R15 — the sentence explaining an empty column was
   * `text-base-content/30`, which computes to 1.85:1 on daisyUI `light`. An
   * explanation nobody can read is not an explanation, so no opacity-modified
   * theme token is allowed to carry it.
   */
  it('carries no opacity-modified text colour on the empty-column copy', () => {
    const classes =
      render([], 7).host.querySelector('[data-testid="task-column-empty"]')
        ?.className ?? '';
    expect(classes).toContain('text-base-content');
    expect(classes).not.toMatch(/text-base-content\/\d/);
  });

  it('renders one card per task with the column count agreeing', () => {
    const view = render(
      [makeTask('TASK_2026_200'), makeTask('TASK_2026_201')],
      5,
    );
    expect(view.host.querySelectorAll('ptah-task-card')).toHaveLength(2);
    expect(view.count()).toBe('2 of 5');
  });

  // ---------------------------------------------------------------------------
  // The focus pass-through (transferred from Task 7.3 — FR-C7.1)
  //
  // The column holds no focus state; it exists on this path only because the
  // board cannot reach the cards without it. These assert the forwarding, which
  // is the whole of the column's contribution.
  // ---------------------------------------------------------------------------
  describe('focus forwarding', () => {
    function withFocus(focusedTaskId: string | null) {
      const view = render([
        makeTask('TASK_2026_200'),
        makeTask('TASK_2026_201'),
      ]);
      view.fixture.componentRef.setInput('focusedTaskId', focusedTaskId);
      view.fixture.detectChanges();
      return view.host;
    }

    it('gives the tab stop to the named card and to no other', () => {
      const host = withFocus('TASK_2026_201');
      const roots = Array.from(host.querySelectorAll('[data-task-id]'));

      expect(roots.map((root) => root.getAttribute('tabindex'))).toEqual([
        '-1',
        '0',
      ]);
    });

    it('leaves every card out of the tab order when nothing is focused', () => {
      // The column does NOT invent a default — the board owns the fallback, so
      // that "exactly one card is focused" is decided once across six columns
      // rather than six times.
      const host = withFocus(null);
      const roots = Array.from(host.querySelectorAll('[data-task-id]'));

      expect(roots.map((root) => root.getAttribute('tabindex'))).toEqual([
        '-1',
        '-1',
      ]);
    });

    it('forwards a card toggle upward', () => {
      const view = render([makeTask('TASK_2026_200')]);
      const toggled: string[] = [];
      view.fixture.componentInstance.taskToggle.subscribe((id) =>
        toggled.push(id),
      );

      view.host
        .querySelector('[data-task-id="TASK_2026_200"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        );

      expect(toggled).toEqual(['TASK_2026_200']);
    });
  });
});
