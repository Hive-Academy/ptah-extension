import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  MAX_SAVED_TASK_VIEWS,
  type SavedTaskView,
} from '@ptah-extension/shared';
import {
  TaskViewMenuComponent,
  type TaskViewMove,
  type TaskViewRename,
} from './task-view-menu.component';

function view(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
  return {
    id: 'view-a',
    name: 'In progress',
    filter: EMPTY_TASK_FILTER,
    sort: DEFAULT_TASK_SORT,
    order: 0,
    ...overrides,
  };
}

describe('TaskViewMenuComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskViewMenuComponent] });
  });

  function render(
    options: {
      readonly views?: readonly SavedTaskView[];
      readonly activeViewId?: string | null;
      readonly modified?: boolean;
      readonly skipped?: number;
      readonly busy?: boolean;
      readonly error?: string | null;
      readonly notice?: string | null;
    } = {},
  ) {
    const fixture = TestBed.createComponent(TaskViewMenuComponent);
    fixture.componentRef.setInput('views', options.views ?? []);
    fixture.componentRef.setInput('activeViewId', options.activeViewId ?? null);
    fixture.componentRef.setInput('modified', options.modified ?? false);
    fixture.componentRef.setInput('skipped', options.skipped ?? 0);
    fixture.componentRef.setInput('busy', options.busy ?? false);
    fixture.componentRef.setInput('error', options.error ?? null);
    fixture.componentRef.setInput('notice', options.notice ?? null);
    fixture.detectChanges();

    const applied: string[] = [];
    const created: string[] = [];
    const renamed: TaskViewRename[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];
    const moved: TaskViewMove[] = [];
    const cleared: number[] = [];
    fixture.componentInstance.viewApplied.subscribe((id) => applied.push(id));
    fixture.componentInstance.viewCreated.subscribe((n) => created.push(n));
    fixture.componentInstance.viewRenamed.subscribe((r) => renamed.push(r));
    fixture.componentInstance.viewUpdated.subscribe((id) => updated.push(id));
    fixture.componentInstance.viewDeleted.subscribe((id) => deleted.push(id));
    fixture.componentInstance.viewMoved.subscribe((m) => moved.push(m));
    fixture.componentInstance.activeCleared.subscribe(() => cleared.push(1));

    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
      applied,
      created,
      renamed,
      updated,
      deleted,
      moved,
      cleared,
    };
  }

  const at = (host: HTMLElement, testid: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${testid}"]`);
  const all = (host: HTMLElement, testid: string): HTMLElement[] =>
    Array.from(host.querySelectorAll(`[data-testid="${testid}"]`));
  const text = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('renders the stored views in the order they were given', () => {
    // Deliberately hostile to a re-sort: the array order and the `order` values
    // disagree, exactly as they may after `tasks:getViews` breaks a tie on
    // surviving position. The backend already sorted; this renders.
    const { host } = render({
      views: [
        view({ id: 'v1', name: 'First', order: 9 }),
        view({ id: 'v2', name: 'Second', order: 3 }),
        view({ id: 'v3', name: 'Third', order: 7 }),
      ],
    });

    expect(all(host, 'task-view-apply').map((b) => text(b))).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  /**
   * View ids are client-generated, but the list is read back out of a settings
   * file a user can hand-edit and nothing de-duplicates it. `track view.id`
   * throws NG0955 on the second row; the position-qualified key cannot.
   */
  it('renders two views sharing one id without a track-key collision', () => {
    const { host } = render({
      views: [
        view({ id: 'same', name: 'One' }),
        view({ id: 'same', name: 'Two' }),
      ],
    });

    expect(all(host, 'task-view-row')).toHaveLength(2);
    expect(all(host, 'task-view-apply').map((b) => text(b))).toEqual([
      'One',
      'Two',
    ]);
  });

  it('emits the id of the view the user picked', () => {
    const { host, applied } = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
    });

    (all(host, 'task-view-apply')[1] as HTMLButtonElement).click();

    expect(applied).toEqual(['v2']);
  });

  it('marks the active row and names it on the trigger', () => {
    const { host } = render({
      views: [view({ id: 'v1', name: 'Blocked work' })],
      activeViewId: 'v1',
    });

    expect(at(host, 'task-view-apply')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(text(at(host, 'task-view-menu-trigger'))).toContain('Blocked work');
  });

  it('shows the modified badge only while the lens has moved', () => {
    const withoutChange = render({
      views: [view({ id: 'v1' })],
      activeViewId: 'v1',
    });
    expect(at(withoutChange.host, 'task-view-modified-badge')).toBeNull();

    const withChange = render({
      views: [view({ id: 'v1' })],
      activeViewId: 'v1',
      modified: true,
    });
    expect(text(at(withChange.host, 'task-view-modified-badge'))).toBe(
      'Modified',
    );
  });

  it('offers Update only on the active row, and only while it is modified', () => {
    const clean = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
      activeViewId: 'v1',
    });
    expect(all(clean.host, 'task-view-update')).toHaveLength(0);

    const dirty = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
      activeViewId: 'v1',
      modified: true,
    });
    const updates = all(dirty.host, 'task-view-update');
    expect(updates).toHaveLength(1);
    (updates[0] as HTMLButtonElement).click();
    expect(dirty.updated).toEqual(['v1']);
  });

  it('disables the move controls at the ends of the list', () => {
    const { host } = render({
      views: [
        view({ id: 'v1' }),
        view({ id: 'v2', order: 1 }),
        view({ id: 'v3', order: 2 }),
      ],
    });

    const up = all(host, 'task-view-move-up') as HTMLButtonElement[];
    const down = all(host, 'task-view-move-down') as HTMLButtonElement[];
    expect(up.map((b) => b.disabled)).toEqual([true, false, false]);
    expect(down.map((b) => b.disabled)).toEqual([false, false, true]);
  });

  it('emits a direction rather than an order value', () => {
    const { host, moved } = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
    });

    (all(host, 'task-view-move-down')[0] as HTMLButtonElement).click();

    expect(moved).toEqual([{ id: 'v1', direction: 'down' }]);
  });

  it('emits the trimmed name when a view is saved', () => {
    const { fixture, host, created } = render();
    const input = at(host, 'task-view-create-input') as HTMLInputElement;
    input.value = '  Licensing  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (at(host, 'task-view-create') as HTMLButtonElement).click();

    expect(created).toEqual(['Licensing']);
  });

  /**
   * The name must survive the emit, because the write can still be refused —
   * `CAP_EXCEEDED` resolves rather than throwing, and it is exactly the case a
   * user reaches after deliberately naming one more view. Clearing the box here
   * would throw the name away at the worst possible moment; the parent clears
   * it only once the save has landed.
   */
  it('keeps the typed name after emitting, so a refusal cannot discard it', () => {
    const { fixture, host } = render();
    const input = at(host, 'task-view-create-input') as HTMLInputElement;
    input.value = 'Fifty-first';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (at(host, 'task-view-create') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.createDraft()).toBe('Fifty-first');
    expect((at(host, 'task-view-create-input') as HTMLInputElement).value).toBe(
      'Fifty-first',
    );
  });

  it('will not save a blank name', () => {
    const { host, created } = render();

    const button = at(host, 'task-view-create') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();

    expect(created).toEqual([]);
  });

  it('renames through a two-field inline form', () => {
    const { fixture, host, renamed } = render({
      views: [view({ id: 'v1', name: 'Old' })],
    });

    (at(host, 'task-view-rename') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = at(host, 'task-view-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Old');
    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (at(host, 'task-view-rename-confirm') as HTMLButtonElement).click();

    expect(renamed).toEqual([{ id: 'v1', name: 'New' }]);
  });

  /**
   * The rename twin of the create case, and it exists so the two adjacent
   * controls follow ONE rule. A rename loses less on a refusal — the original
   * name is still on screen in the row — but a reader cannot tell which of two
   * different behaviours is the intended pattern.
   */
  it('keeps the rename row open and filled after emitting', () => {
    const { fixture, host } = render({
      views: [view({ id: 'v1', name: 'Old' })],
    });

    (at(host, 'task-view-rename') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = at(host, 'task-view-rename-input') as HTMLInputElement;
    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (at(host, 'task-view-rename-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.renameDraft()).toBe('New');
    expect(fixture.componentInstance.renamingId()).toBe('v1');
    expect((at(host, 'task-view-rename-input') as HTMLInputElement).value).toBe(
      'New',
    );
  });

  /** Cancelling is the user's own act, so it still closes and clears at once. */
  it('closes and clears the rename row when the user cancels', () => {
    const { fixture, host, renamed } = render({
      views: [view({ id: 'v1', name: 'Old' })],
    });

    (at(host, 'task-view-rename') as HTMLButtonElement).click();
    fixture.detectChanges();
    const buttons = Array.from(
      (at(host, 'task-view-row') as HTMLElement).querySelectorAll('button'),
    );
    const cancel = buttons.find((b) => b.textContent?.trim() === 'Cancel');
    cancel?.click();
    fixture.detectChanges();

    expect(at(host, 'task-view-rename-input')).toBeNull();
    expect(fixture.componentInstance.renamingId()).toBeNull();
    expect(renamed).toEqual([]);
  });

  /** Settings are gitignored: a deleted view has no undo anywhere. */
  it('asks before deleting, and emits nothing until it is confirmed', () => {
    const { fixture, host, deleted } = render({
      views: [view({ id: 'v1' })],
    });

    (at(host, 'task-view-delete') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(at(host, 'task-view-delete-confirm')).not.toBeNull();
    expect(deleted).toEqual([]);

    (at(host, 'task-view-delete-confirm-yes') as HTMLButtonElement).click();
    expect(deleted).toEqual(['v1']);
  });

  /**
   * Contract 2. The cap failure RESOLVES rather than throwing, and its message
   * already names the limit and states that nothing was saved. It is rendered
   * as it arrived — a generic "save failed" would lose both facts.
   */
  it('renders the CAP_EXCEEDED message verbatim', () => {
    const message =
      'You can save at most 50 views. This request carried 51. ' +
      'Nothing was saved — delete a view and try again.';
    const { host } = render({ error: message });

    expect(text(at(host, 'task-view-error'))).toContain(message);
  });

  it('says the list is full and disables the create control at the cap', () => {
    const full = Array.from({ length: MAX_SAVED_TASK_VIEWS }, (_, index) =>
      view({ id: `v${index}`, order: index }),
    );
    const { host } = render({ views: full });

    expect((at(host, 'task-view-create') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(text(at(host, 'task-view-cap'))).toContain(
      String(MAX_SAVED_TASK_VIEWS),
    );
  });

  /**
   * Contract 3. The views ARE on disk — this is styled as information and
   * carries no retry, because its own message ends "There is nothing to save
   * again."
   */
  it('renders the partial-success warning as a notice with no retry', () => {
    const message =
      'Your views were saved. The active view could not be recorded, so the ' +
      'board may open on a different view than the one you selected. There is ' +
      'nothing to save again.';
    const { host } = render({ notice: message });

    const notice = at(host, 'task-view-notice');
    expect(text(notice)).toContain(message);
    expect(notice?.getAttribute('role')).toBe('status');
    expect(at(host, 'task-view-error')).toBeNull();
    expect(text(host).toLowerCase()).not.toContain('retry');
  });

  /** Contract 6. A menu that is quietly shorter than the user left it. */
  it('reports skipped entries and says nothing was deleted', () => {
    const { host } = render({ views: [view()], skipped: 2 });

    const skipped = text(at(host, 'task-view-skipped'));
    expect(skipped).toContain('2 stored view(s) could not be read');
    expect(skipped).toContain('nothing was deleted');
  });

  it('says what to do when there are no views yet', () => {
    const { host } = render();

    expect(at(host, 'task-view-list')).toBeNull();
    expect(text(at(host, 'task-view-none'))).toContain('No saved views yet');
  });

  /**
   * BR-10. A view name is untrusted free text. It reaches the DOM through
   * `{{ interpolation }}` and through property-bound attributes, both of which
   * set values rather than parse markup — so no element and no event-handler
   * attribute is ever created from it.
   *
   * The assertion is on the TREE, not on a substring of `innerHTML`: the name
   * legitimately appears inside `title`/`aria-label`, where the serializer
   * shows it entity-escaped and inert. Searching the serialized string for
   * `onerror=` finds that escaped attribute VALUE and would fail a component
   * that is behaving correctly.
   */
  it('renders a name carrying markup as text, never as HTML', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { host } = render({ views: [view({ id: 'v1', name: hostile })] });

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[onerror]')).toBeNull();
    expect(text(at(host, 'task-view-apply'))).toBe(hostile);
    // The name reached the text node escaped, i.e. as data.
    expect(host.innerHTML).toContain('&lt;img src=x');
  });

  /**
   * Apply is included deliberately. It was the one control without the guard,
   * and it is the one that writes the active-view pointer: two applies in quick
   * succession are two `tasks:saveViews` calls that can resolve out of order and
   * leave the highlight on a view the board is not showing.
   */
  it('locks every mutating control, apply included, while a write is outstanding', () => {
    const { host } = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
      busy: true,
    });

    for (const control of all(host, 'task-view-apply')) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (all(host, 'task-view-move-down')[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((at(host, 'task-view-rename') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((at(host, 'task-view-delete') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('emits nothing when apply is clicked while busy', () => {
    const { host, applied } = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
      busy: true,
    });

    (all(host, 'task-view-apply')[1] as HTMLButtonElement).click();

    expect(applied).toEqual([]);
  });

  /**
   * At the 50-view cap an unbounded list pushes the create row and the cap
   * message out of the panel — and the cap message is what a user with 50 views
   * needs to read. The list scrolls; the panel does not.
   */
  it('scrolls the list rather than growing the panel past its controls', () => {
    const full = Array.from({ length: MAX_SAVED_TASK_VIEWS }, (_, index) =>
      view({ id: `v${index}`, order: index }),
    );
    const { host } = render({ views: full });

    const list = at(host, 'task-view-list');
    expect(list?.classList.contains('overflow-y-auto')).toBe(true);
    expect(
      Array.from(list?.classList ?? []).some((name) =>
        name.startsWith('max-h-'),
      ),
    ).toBe(true);
    // The controls below it are still in the tree, under the scroll region.
    expect(at(host, 'task-view-create-input')).not.toBeNull();
    expect(at(host, 'task-view-cap')).not.toBeNull();
  });

  /** A `flex-1` input without `min-w-0` cannot shrink below its intrinsic size. */
  it('lets both name inputs shrink inside their flex rows', () => {
    const { fixture, host } = render({ views: [view({ id: 'v1' })] });
    (at(host, 'task-view-rename') as HTMLButtonElement).click();
    fixture.detectChanges();

    for (const testid of ['task-view-create-input', 'task-view-rename-input']) {
      const input = at(host, testid);
      expect(input?.classList.contains('flex-1')).toBe(true);
      expect(input?.classList.contains('min-w-0')).toBe(true);
    }
  });

  /**
   * NFR-12. `alert-error` is 3.87:1 on anubis and `alert-info` 2.95:1 — the
   * latter missing even the 3:1 non-text floor, on the app's default theme.
   * Asserting the CONSTRUCT is gone is the honest assertion: jsdom computes no
   * contrast ratio, so a ratio expectation here would be theatre. The measured
   * table lives on the component.
   */
  it('carries no daisyUI alert fill on any of the three message states', () => {
    const { host } = render({
      views: [view({ id: 'v1' })],
      skipped: 3,
      error: 'nothing was saved',
      notice: 'the pointer did not record',
    });

    expect(host.querySelector('.alert')).toBeNull();
    expect(host.querySelector('.alert-error')).toBeNull();
    expect(host.querySelector('.alert-info')).toBeNull();
    // All three still carry their text in the full base-content colour.
    for (const testid of [
      'task-view-error',
      'task-view-notice',
      'task-view-skipped',
    ]) {
      expect(at(host, testid)?.classList.contains('text-base-content')).toBe(
        true,
      );
    }
  });

  /** The two states that must still be distinguishable without colour. */
  it('keeps the error and notice roles distinct now that the fills are gone', () => {
    const { host } = render({
      error: 'Nothing was saved.',
      notice: 'Your views were saved. There is nothing to save again.',
    });

    expect(at(host, 'task-view-error')?.getAttribute('role')).toBe('alert');
    expect(at(host, 'task-view-notice')?.getAttribute('role')).toBe('status');
  });

  it('gives every row control a 24px target, not a 12px one', () => {
    const { host } = render({ views: [view({ id: 'v1' })] });

    for (const testid of [
      'task-view-move-up',
      'task-view-move-down',
      'task-view-rename',
      'task-view-delete',
    ]) {
      const control = at(host, testid);
      expect(control?.classList.contains('h-6')).toBe(true);
      expect(control?.classList.contains('w-6')).toBe(true);
    }
  });

  /**
   * `TASK_2026_183` owns the surface-wide opacity sweep; this batch adds no new
   * instance. Asserting the CONSTRUCT is absent is the honest assertion here —
   * jsdom computes no contrast ratio, so a ratio expectation would be theatre.
   */
  it('carries no opacity-modified text colour on any informational element', () => {
    const { host } = render({
      views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
      activeViewId: 'v1',
      modified: true,
      skipped: 3,
      error: 'nothing was saved',
      notice: 'the pointer did not record',
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
});
