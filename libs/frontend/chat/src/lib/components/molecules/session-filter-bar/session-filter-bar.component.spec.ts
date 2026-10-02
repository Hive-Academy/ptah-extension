/**
 * SessionFilterBarComponent specs (TASK_2026_580 C1.1.2).
 *
 * Coverage: the normalized query shape, the 250 ms debounce on typed fields
 * (L17), one pending change (an immediate change takes the pending text with
 * it), no duplicate emission, and release of the pending timer on destroy.
 */
import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import {
  SESSION_FILTER_TEXT_DEBOUNCE_MS,
  SessionFilterBarComponent,
  type SessionFilterQuery,
} from './session-filter-bar.component';

describe('SessionFilterBarComponent', () => {
  let fixture: ComponentFixture<SessionFilterBarComponent>;
  let host: HTMLElement;
  let emitted: SessionFilterQuery[];

  const el = <T extends HTMLElement>(testId: string): T => {
    const found = host.querySelector<T>(`[data-testid="${testId}"]`);
    if (!found) throw new Error(`Missing ${testId}`);
    return found;
  };

  const type = (testId: string, value: string): void => {
    const input = el<HTMLInputElement>(testId);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const select = (testId: string, value: string): void => {
    const node = el<HTMLSelectElement>(testId);
    node.value = value;
    node.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  const openFilters = (): void => {
    el<HTMLButtonElement>('session-filter-toggle').click();
    fixture.detectChanges();
  };

  const check = (testId: string): void => {
    const box = el<HTMLInputElement>(testId);
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SessionFilterBarComponent] });
    fixture = TestBed.createComponent(SessionFilterBarComponent);
    host = fixture.nativeElement as HTMLElement;
    emitted = [];
    fixture.componentInstance.queryChange.subscribe((q) => emitted.push(q));
    fixture.detectChanges();
  });

  it('debounces search text by 250 ms and sends only the settled value', fakeAsync(() => {
    type('session-filter-text', 'a');
    tick(100);
    type('session-filter-text', 'ab');
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS - 1);
    expect(emitted).toEqual([]);

    tick(1);
    expect(emitted).toEqual([
      { sort: 'lastActive', groupBy: 'none', text: 'ab' },
    ]);
  }));

  it('keeps a typed trailing space when the parent echoes the trimmed text', fakeAsync(() => {
    type('session-filter-text', 'foo ');
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS);
    expect(emitted).toEqual([
      { sort: 'lastActive', groupBy: 'none', text: 'foo' },
    ]);

    // The parent stores the emitted query and passes it back as the seed.
    fixture.componentRef.setInput('query', emitted[0]);
    fixture.detectChanges();
    expect(el<HTMLInputElement>('session-filter-text').value).toBe('foo ');

    // A seed that differs after trimming still replaces the draft.
    fixture.componentRef.setInput('query', {
      sort: 'lastActive',
      groupBy: 'none',
      text: 'bar',
    });
    fixture.detectChanges();
    expect(el<HTMLInputElement>('session-filter-text').value).toBe('bar');
  }));

  it('emits sort and group changes at once, carrying the pending text', fakeAsync(() => {
    type('session-filter-text', 'fix');
    select('session-filter-sort', 'priority');
    expect(emitted).toEqual([
      { sort: 'priority', groupBy: 'none', text: 'fix' },
    ]);

    // The pending text timer was replaced, so nothing else fires.
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS);
    expect(emitted.length).toBe(1);

    select('session-filter-group', 'parent');
    expect(emitted[1]).toEqual({
      sort: 'priority',
      groupBy: 'parent',
      text: 'fix',
    });
  }));

  it('builds status and priority lists in vocabulary order with toggles', fakeAsync(() => {
    openFilters();
    check('session-filter-status-done');
    check('session-filter-status-waiting');
    check('session-filter-priority-high');
    check('session-filter-pinned');
    check('session-filter-has-pr');
    type('session-filter-task', ' TASK_2026_580_9f77 ');
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS);

    expect(emitted[emitted.length - 1]).toEqual({
      sort: 'lastActive',
      groupBy: 'none',
      status: ['waiting', 'done'],
      priority: ['high'],
      pinned: true,
      hasPr: true,
      taskId: 'TASK_2026_580_9f77',
    });
    expect(
      el<HTMLButtonElement>('session-filter-toggle').getAttribute('aria-label'),
    ).toBe('Filters (6 active)');
  }));

  it('clears filters and drops unchecked toggles from the query', fakeAsync(() => {
    openFilters();
    check('session-filter-status-archived');
    el<HTMLButtonElement>('session-filter-clear').click();
    fixture.detectChanges();
    expect(emitted[emitted.length - 1]).toEqual({
      sort: 'lastActive',
      groupBy: 'none',
    });
  }));

  it('does not emit a query equal to the seed', fakeAsync(() => {
    fixture.componentRef.setInput('query', {
      sort: 'name',
      text: 'abc',
    } satisfies SessionFilterQuery);
    fixture.detectChanges();
    expect(el<HTMLInputElement>('session-filter-text').value).toBe('abc');

    type('session-filter-text', 'abc ');
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS);
    expect(emitted).toEqual([]);
  }));

  it('releases the pending timer on destroy', fakeAsync(() => {
    type('session-filter-text', 'late');
    fixture.destroy();
    tick(SESSION_FILTER_TEXT_DEBOUNCE_MS);
    expect(emitted).toEqual([]);
  }));
});
