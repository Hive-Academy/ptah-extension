import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  type TaskFilterSpec,
  type TaskSortSpec,
} from '@ptah-extension/shared';
import type { TaskEstimateBuckets } from '../../services/tasks-store.service';
import { TaskFilterBarComponent } from './task-filter-bar.component';

const BUCKETS: TaskEstimateBuckets = {
  sized: { XS: 1, S: 0, M: 3, L: 0, XL: 2 },
  unestimated: 7,
};

describe('TaskFilterBarComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskFilterBarComponent] });
  });

  function render(
    filter: Partial<TaskFilterSpec> = {},
    options: {
      readonly sort?: TaskSortSpec;
      readonly knownLabels?: readonly string[];
      readonly knownExecutors?: readonly string[];
      readonly matchedCount?: number;
      readonly totalIndexed?: number;
    } = {},
  ) {
    const fixture = TestBed.createComponent(TaskFilterBarComponent);
    fixture.componentRef.setInput('filter', {
      ...EMPTY_TASK_FILTER,
      ...filter,
    });
    fixture.componentRef.setInput('sort', options.sort ?? DEFAULT_TASK_SORT);
    fixture.componentRef.setInput('knownLabels', options.knownLabels ?? []);
    fixture.componentRef.setInput(
      'knownExecutors',
      options.knownExecutors ?? [],
    );
    fixture.componentRef.setInput('estimateBuckets', BUCKETS);
    fixture.componentRef.setInput('matchedCount', options.matchedCount ?? 23);
    fixture.componentRef.setInput('totalIndexed', options.totalIndexed ?? 181);
    fixture.detectChanges();

    const emitted: TaskFilterSpec[] = [];
    const sorts: TaskSortSpec[] = [];
    fixture.componentInstance.filterChange.subscribe((spec) =>
      emitted.push(spec),
    );
    fixture.componentInstance.sortChange.subscribe((spec) => sorts.push(spec));
    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
      emitted,
      sorts,
    };
  }

  const at = (host: HTMLElement, testid: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${testid}"]`);

  it('states the matched count over the indexed count while filtering (FR-C1.2)', () => {
    const { host } = render({ statuses: ['done'] });
    expect(
      at(host, 'task-filter-count')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('23 of 181');
  });

  /** The column counter's rule, applied here too: "X of X" is noise. */
  it('states the bare board size when no filter is active', () => {
    const { host } = render();
    expect(at(host, 'task-filter-count')?.textContent?.trim()).toBe('181');
  });

  /**
   * NFR-12 / R15. The measured failure was `badge-primary`: primary-content on
   * primary is 4.14:1 on anubis, the app's own default theme. The count is now
   * text in the inherited `base-content`, and the selected state is carried by
   * weight and `btn-active` instead of a filled colour.
   */
  it('marks a filtered facet without a filled primary badge', () => {
    const { host } = render({ statuses: ['done'] });
    const summary = host.querySelector(
      '[data-testid="facet-menu-status"] summary',
    );

    expect(summary?.classList.contains('btn-active')).toBe(true);
    expect(summary?.classList.contains('font-semibold')).toBe(true);
    expect(
      summary
        ?.querySelector('[data-testid="facet-selected-count"]')
        ?.textContent?.trim(),
    ).toBe('1');
    expect(host.querySelector('.badge-primary')).toBeNull();
  });

  /**
   * The systemic finding: an opacity modifier on a theme token has a different
   * ratio in every theme, and none of `/30`–`/70` clears 4.5:1 on all four
   * mandated bases. This asserts the construct is gone from information text,
   * rather than asserting a number a test cannot measure.
   */
  it('carries no opacity-modified text colour on any informational element', () => {
    const { host } = render({
      statuses: ['done'],
      labels: ['licensing'],
      text: 'needle',
    });
    const offenders = Array.from(host.querySelectorAll('*')).filter((el) =>
      Array.from(el.classList).some(
        (name) =>
          name.startsWith('text-base-content/') &&
          el.getAttribute('aria-hidden') !== 'true',
      ),
    );
    expect(offenders.map((el) => el.className)).toEqual([]);
  });

  it('gives the chip remove control a 24px target, not a 12px one', () => {
    const { host } = render({ labels: ['licensing'] });
    const remove = at(host, 'task-filter-chips')?.querySelector('button');

    // h-6/w-6 = 1.5rem = 24px, WCAG 2.2 SC 2.5.8's floor. `badge-xs`, which
    // this replaced, is 12px.
    expect(remove?.classList.contains('h-6')).toBe(true);
    expect(remove?.classList.contains('w-6')).toBe(true);
  });

  it('emits the typed needle verbatim, never a pattern (BR-10)', () => {
    const { host, emitted } = render();
    const input = at(host, 'task-filter-text') as HTMLInputElement;

    // Regex metacharacters are DATA here. Nothing compiles this string.
    input.value = '(a+)+$';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].text).toBe('(a+)+$');
  });

  it('toggles a status on and back off through the same control', () => {
    const { fixture, host, emitted } = render();
    const statusBox = host.querySelector<HTMLInputElement>(
      '[data-testid="facet-menu-status"] input[type="checkbox"]',
    );
    statusBox?.dispatchEvent(new Event('change'));
    expect(emitted[0].statuses).toEqual(['backlog']);

    fixture.componentRef.setInput('filter', {
      ...EMPTY_TASK_FILTER,
      statuses: ['backlog'],
    });
    fixture.detectChanges();
    host
      .querySelector<HTMLInputElement>(
        '[data-testid="facet-menu-status"] input[type="checkbox"]',
      )
      ?.dispatchEvent(new Event('change'));
    expect(emitted[1].statuses).toEqual([]);
  });

  it('offers "No estimate" inside the estimate menu, with its indexed count', () => {
    const { host, emitted } = render();
    const menu = at(host, 'facet-menu-estimate');
    const entries = Array.from(menu?.querySelectorAll('li') ?? []);

    // Five sizes plus the unestimated bucket — ONE facet, so one menu.
    expect(entries).toHaveLength(6);
    expect(entries[5].textContent).toContain('No estimate');
    expect(entries[5].textContent).toContain('7');

    entries[5]
      .querySelector<HTMLInputElement>('input')
      ?.dispatchEvent(new Event('change'));
    expect(emitted[0].unestimated).toBe(true);
  });

  /**
   * R9 — one label, one entry, whatever the carrier spelled it. The fold is the
   * SHARED `labelKey`, so a selection made from a saved view that spelled it
   * differently still shows as selected here.
   */
  it('treats a differently-cased selection as the same label', () => {
    const { host, emitted } = render(
      { labels: ['licensing '] },
      { knownLabels: ['Licensing'] },
    );
    const box = host.querySelector<HTMLInputElement>(
      '[data-testid="facet-menu-label"] input[type="checkbox"]',
    );

    expect(box?.checked).toBe(true);

    box?.dispatchEvent(new Event('change'));
    // Toggling off removes the entry that MATCHES, not the one that is equal.
    expect(emitted[0].labels).toEqual([]);
  });

  it('renders the ANY/ALL toggle only once a second label is selected', () => {
    expect(
      at(render({ labels: ['a'] }).host, 'task-filter-labels-mode'),
    ).toBeNull();

    const { host, emitted } = render({ labels: ['a', 'b'] });
    const mode = at(host, 'task-filter-labels-mode');
    expect(mode).not.toBeNull();

    const allButton = Array.from(mode?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'All',
    );
    allButton?.click();
    expect(emitted[0].labelsMode).toBe('all');
  });

  it('says nothing is available rather than opening an empty label menu', () => {
    const { host } = render();
    expect(at(host, 'facet-menu-label')?.textContent).toContain(
      'No task on the board carries a label yet.',
    );
  });

  // ---------------------------------------------------------------------------
  // Chips
  // ---------------------------------------------------------------------------

  it('renders one removable chip per active VALUE, not per facet', () => {
    const { host, emitted } = render({
      statuses: ['backlog', 'done'],
      labels: ['licensing'],
      text: 'needle',
    });
    const chips = Array.from(
      at(host, 'task-filter-chips')?.querySelectorAll('li') ?? [],
    );
    expect(chips).toHaveLength(4);

    // Removing one status leaves the other, and every other facet, standing.
    const removeBacklog = chips[1].querySelector('button');
    removeBacklog?.click();
    expect(emitted[0].statuses).toEqual(['done']);
    expect(emitted[0].labels).toEqual(['licensing']);
    expect(emitted[0].text).toBe('needle');
  });

  /**
   * Chips are derived from text a human typed into a carrier, so two of them
   * CAN render the same string. `track` is qualified by facet and position for
   * exactly this case — a track on the value alone throws here.
   */
  it('renders duplicate values without a track collision', () => {
    const { host } = render({ labels: ['ui', 'ui'], executors: ['ui'] });
    const chips = Array.from(
      at(host, 'task-filter-chips')?.querySelectorAll('li') ?? [],
    );
    expect(chips).toHaveLength(3);
  });

  /** NFR-4 / NFR-13 — label text is interpolated, never parsed. */
  it('renders a hostile label as text', () => {
    const hostile = '<img src=x onerror="boom">';
    const { host } = render({ labels: [hostile] });
    const chips = at(host, 'task-filter-chips');

    expect(chips?.querySelector('img')).toBeNull();
    expect(chips?.textContent).toContain(hostile);
  });

  it('names the sub-task facet on its chip, so a rollup click is undoable', () => {
    const { host, emitted } = render({ childrenOf: ['TASK_2026_200'] });
    const chip = at(host, 'task-filter-chips')?.querySelector('li');

    expect(chip?.textContent).toContain('TASK_2026_200');
    chip?.querySelector('button')?.click();
    expect(emitted[0].childrenOf).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Clear-all + sort
  // ---------------------------------------------------------------------------

  it('disables clear-all with a stated reason when no filter is active', () => {
    const { host } = render();
    const clear = at(host, 'task-filter-clear') as HTMLButtonElement;

    expect(clear.disabled).toBe(true);
    expect(clear.title).toContain('nothing to clear');
  });

  it('clears every facet at once (FR-C1.6)', () => {
    const { host, emitted } = render({
      statuses: ['done'],
      labels: ['licensing'],
      hasValidationIssues: true,
    });
    (at(host, 'task-filter-clear') as HTMLButtonElement).click();

    expect(emitted[0]).toEqual(EMPTY_TASK_FILTER);
  });

  it('toggles the sort direction without touching the field', () => {
    const { host, sorts } = render(
      {},
      { sort: { field: 'title', direction: 'asc' } },
    );
    (at(host, 'task-sort-direction') as HTMLButtonElement).click();

    expect(sorts[0]).toEqual({ field: 'title', direction: 'desc' });
  });

  it('emits the picked sort field', () => {
    const { host, sorts } = render();
    const select = at(host, 'task-sort-field') as HTMLSelectElement;
    select.value = 'estimate';
    select.dispatchEvent(new Event('change'));

    expect(sorts[0]).toEqual({ ...DEFAULT_TASK_SORT, field: 'estimate' });
  });

  it('ignores a sort field that is not in the shared vocabulary', () => {
    const { host, sorts } = render();
    const select = at(host, 'task-sort-field') as HTMLSelectElement;
    const rogue = document.createElement('option');
    rogue.value = 'not-a-field';
    select.appendChild(rogue);
    select.value = 'not-a-field';
    select.dispatchEvent(new Event('change'));

    expect(sorts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Values the workspace no longer carries (FR-C2.4)
  //
  // This is what a saved view looks like once the last task carrying a label
  // is retired. The facet still applies and still matches nothing; the chip
  // says so, and NOTHING is pruned.
  // -------------------------------------------------------------------------
  describe('the stale-facet annotation', () => {
    it('annotates a label no task on the board carries', () => {
      const { host } = render(
        { labels: ['retired'] },
        { knownLabels: ['licensing'] },
      );

      expect(at(host, 'task-filter-chip-note')?.textContent).toContain(
        'no longer present in this workspace',
      );
    });

    it('annotates an executor no task on the board names', () => {
      const { host } = render(
        { executors: ['ghost'] },
        { knownExecutors: ['backend-developer'] },
      );

      expect(at(host, 'task-filter-chip-note')?.textContent).toContain(
        'no longer present in this workspace',
      );
    });

    /** Folded on the shared `labelKey`, exactly as the predicate folds it (R9). */
    it('does not annotate a label that differs only in case or trailing space', () => {
      const { host } = render(
        { labels: ['Licensing'] },
        { knownLabels: ['licensing '] },
      );

      expect(at(host, 'task-filter-chip-note')).toBeNull();
    });

    /** Executors are matched case-SENSITIVELY, so the fold must not apply. */
    it('annotates an executor that differs only in case', () => {
      const { host } = render(
        { executors: ['Alice'] },
        { knownExecutors: ['alice'] },
      );

      expect(at(host, 'task-filter-chip-note')).not.toBeNull();
    });

    /**
     * The mirror of the label trailing-space case, and it was missing.
     *
     * `matchesExecutors` trims BOTH sides and `buildTaskGraph` stores
     * `knownExecutors` already trimmed, so `' gemini '` in a saved view MATCHES
     * a task whose executor is `gemini`. Comparing raw here annotated that chip
     * "no longer present in this workspace" while it was busy matching — the
     * exact contradiction the annotation exists to prevent.
     */
    it('does not annotate an executor that differs only in surrounding space', () => {
      const { host } = render(
        { executors: [' gemini '] },
        { knownExecutors: ['gemini'] },
      );

      expect(at(host, 'task-filter-chip-note')).toBeNull();
    });

    /** Trimming must not become folding: case still separates two agents. */
    it('still annotates when trimming is not enough to match', () => {
      const { host } = render(
        { executors: [' Gemini '] },
        { knownExecutors: ['gemini'] },
      );

      expect(at(host, 'task-filter-chip-note')).not.toBeNull();
    });

    /**
     * The note renders only when something is wrong, so an unbounded
     * `whitespace-nowrap` overflowed the 256px bar every single time it
     * appeared. Bounded exactly like the value beside it — the full sentence
     * stays in the text node for assistive technology and in `title` for a
     * pointer.
     */
    it('bounds the note instead of letting it widen the bar', () => {
      const { host } = render({ labels: ['retired'] }, { knownLabels: [] });

      const note = at(host, 'task-filter-chip-note');
      expect(note?.classList.contains('truncate')).toBe(true);
      expect(note?.classList.contains('min-w-0')).toBe(true);
      expect(note?.classList.contains('whitespace-nowrap')).toBe(false);
      expect(note?.getAttribute('title')).toBe(
        'no longer present in this workspace',
      );
      // The chip itself can no longer exceed the bar.
      expect(
        note?.closest('span.inline-flex')?.classList.contains('max-w-full'),
      ).toBe(true);
      // …and the value does not compete with the note for the space that is
      // left, which would leave the annotation more legible than the fact.
      expect(note?.previousElementSibling?.classList.contains('shrink-0')).toBe(
        true,
      );
    });

    it('leaves other facets unannotated', () => {
      const { host } = render(
        { statuses: ['done'], types: ['BUGFIX'], text: 'needle' },
        { knownLabels: [], knownExecutors: [] },
      );

      expect(at(host, 'task-filter-chip-note')).toBeNull();
    });

    /**
     * The annotation is a RENDER, never an edit. Removing it is still the
     * user's act: the chip's own remove control is the only thing that changes
     * the spec, and it emits exactly the same spec it would for a live value.
     */
    it('does not prune the stale value, and its removal is still the user act', () => {
      const { host, emitted } = render(
        { labels: ['retired'] },
        { knownLabels: [] },
      );

      const chip = at(host, 'task-filter-chips');
      expect(chip?.textContent).toContain('retired');
      expect(emitted).toHaveLength(0);

      (chip?.querySelector('button') as HTMLButtonElement).click();
      expect(emitted[0].labels).toEqual([]);
    });
  });
});
