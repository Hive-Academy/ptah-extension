import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WaitlistFilterBar } from './waitlist-filter-bar';

describe('WaitlistFilterBar', () => {
  let fixture: ComponentFixture<WaitlistFilterBar>;
  let component: WaitlistFilterBar;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WaitlistFilterBar],
    });
    fixture = TestBed.createComponent(WaitlistFilterBar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders all filter controls with accessible labels', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('input[aria-label="Search email or source"]'),
    ).toBeTruthy();
    expect(
      el.querySelector('label[for="waitlist-source-select"]')?.textContent,
    ).toContain('Source');
    expect(
      el.querySelector('input[aria-label="Signup date from"]'),
    ).toBeTruthy();
    expect(el.querySelector('input[aria-label="Signup date to"]')).toBeTruthy();
    expect(el.querySelector('select[aria-label="Sort by field"]')).toBeTruthy();
    expect(
      el.querySelector('select[aria-label="Sort direction"]'),
    ).toBeTruthy();
    expect(
      el.querySelector('label[for="waitlist-page-size-select"]')?.textContent,
    ).toContain('Show');
    const clearButton = el.querySelector('button');
    expect(clearButton?.textContent).toContain('Clear filters');
    expect(clearButton?.hasAttribute('aria-label')).toBe(false);
  });

  it('emits searchChange when search input changes', () => {
    let emitted = '';
    component.searchChange.subscribe((val) => (emitted = val));

    const input = fixture.nativeElement.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    input.value = 'developer@hive.com';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toBe('developer@hive.com');
  });

  it('emits sourceChange when a valid source is selected', () => {
    let emittedSource: string | undefined = undefined;
    component.sourceChange.subscribe((val) => (emittedSource = val));

    const select = fixture.nativeElement.querySelector(
      '#waitlist-source-select',
    ) as HTMLSelectElement;
    select.value = 'vscode';
    select.dispatchEvent(new Event('change'));

    expect(emittedSource).toBe('vscode');

    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(emittedSource).toBeUndefined();
  });

  it('emits ISO timestamp boundaries for createdFrom and createdTo', () => {
    let emittedFrom: string | undefined;
    let emittedTo: string | undefined;
    component.createdFromChange.subscribe((val) => (emittedFrom = val));
    component.createdToChange.subscribe((val) => (emittedTo = val));

    const fromInput = fixture.nativeElement.querySelector(
      'input[aria-label="Signup date from"]',
    ) as HTMLInputElement;
    fromInput.value = '2026-03-01';
    fromInput.dispatchEvent(new Event('change'));

    expect(emittedFrom).toBe('2026-03-01T00:00:00.000Z');

    const toInput = fixture.nativeElement.querySelector(
      'input[aria-label="Signup date to"]',
    ) as HTMLInputElement;
    toInput.value = '2026-03-15';
    toInput.dispatchEvent(new Event('change'));

    expect(emittedTo).toBe('2026-03-15T23:59:59.999Z');
  });

  it('displays validation warning when createdFrom is after createdTo', () => {
    fixture.componentRef.setInput('createdFrom', '2026-03-20T00:00:00.000Z');
    fixture.componentRef.setInput('createdTo', '2026-03-10T23:59:59.999Z');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('.alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(
      'createdFrom must be before or equal to createdTo',
    );
  });

  it('emits sortByChange and sortOrderChange with allowlisted values', () => {
    let emittedSortBy = '';
    let emittedSortOrder = '';
    component.sortByChange.subscribe((val) => (emittedSortBy = val));
    component.sortOrderChange.subscribe((val) => (emittedSortOrder = val));

    const sortSelect = fixture.nativeElement.querySelector(
      'select[aria-label="Sort by field"]',
    ) as HTMLSelectElement;
    sortSelect.value = 'notifiedAt';
    sortSelect.dispatchEvent(new Event('change'));
    expect(emittedSortBy).toBe('notifiedAt');

    const dirSelect = fixture.nativeElement.querySelector(
      'select[aria-label="Sort direction"]',
    ) as HTMLSelectElement;
    dirSelect.value = 'asc';
    dirSelect.dispatchEvent(new Event('change'));
    expect(emittedSortOrder).toBe('asc');
  });

  it('emits pageSizeChange with allowed numbers (10, 25, 50, 100)', () => {
    let emittedPageSize = 0;
    component.pageSizeChange.subscribe((val) => (emittedPageSize = val));

    const pageSelect = fixture.nativeElement.querySelector(
      '#waitlist-page-size-select',
    ) as HTMLSelectElement;
    pageSelect.value = '50';
    pageSelect.dispatchEvent(new Event('change'));

    expect(emittedPageSize).toBe(50);
  });

  it('emits cleared with void payload when Clear filters is clicked (retains stage)', () => {
    let clearCalled = false;
    component.cleared.subscribe(() => (clearCalled = true));

    const btn = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    btn.click();

    expect(clearCalled).toBe(true);
  });
});
