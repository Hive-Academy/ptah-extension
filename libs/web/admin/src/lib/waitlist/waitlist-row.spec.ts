import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { WaitlistListRow } from './waitlist-query-state';
import { WaitlistRowComponent } from './waitlist-row';

function makeRow(overrides: Partial<WaitlistListRow> = {}): WaitlistListRow {
  return {
    id: 'wl-1',
    email: 'dev@hive.com',
    source: 'landing',
    createdAt: '2026-03-01T10:00:00.000Z',
    notifiedAt: null,
    approvedAt: null,
    convertedAt: null,
    stage: 'new',
    stageAt: '2026-03-01T10:00:00.000Z',
    approvalEligible: true,
    ...overrides,
  };
}

describe('WaitlistRowComponent', () => {
  let fixture: ComponentFixture<WaitlistRowComponent>;
  let component: WaitlistRowComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WaitlistRowComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(WaitlistRowComponent);
    component = fixture.componentInstance;
  });

  it('renders eligible New row with checkbox, Approve button, and accessible names', () => {
    fixture.componentRef.setInput('row', makeRow());
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const checkbox = el.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.getAttribute('aria-label')).toBe(
      'Select dev@hive.com for approval',
    );

    const approveBtn = el.querySelector(
      'button[aria-label="Approve dev@hive.com"]',
    );
    expect(approveBtn).toBeTruthy();

    const detailsBtn = el.querySelector(
      'button[aria-label="View details for dev@hive.com"]',
    );
    expect(detailsBtn).toBeTruthy();

    expect(el.textContent).toContain('dev@hive.com');
    expect(el.textContent).toContain('Joined');
  });

  it('renders eligible Invited row with checkbox and Approve button', () => {
    fixture.componentRef.setInput(
      'row',
      makeRow({
        id: 'wl-2',
        email: 'invited@hive.com',
        stage: 'invited',
        notifiedAt: '2026-03-05T12:00:00.000Z',
        stageAt: '2026-03-05T12:00:00.000Z',
        approvalEligible: true,
      }),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(
      el.querySelector('button[aria-label="Approve invited@hive.com"]'),
    ).toBeTruthy();
    expect(el.textContent).toContain('Invited');
  });

  it('does NOT render checkbox or Approve button for Approved rows', () => {
    fixture.componentRef.setInput(
      'row',
      makeRow({
        id: 'wl-3',
        email: 'approved@hive.com',
        stage: 'approved',
        approvedAt: '2026-03-06T12:00:00.000Z',
        stageAt: '2026-03-06T12:00:00.000Z',
        approvalEligible: false,
      }),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(
      el.querySelector('button[aria-label="Approve approved@hive.com"]'),
    ).toBeNull();
    expect(el.textContent).toContain('Approved');
    expect(el.querySelector('a')?.textContent).toContain('View license');
  });

  it('does NOT render checkbox or Approve button for Converted rows', () => {
    fixture.componentRef.setInput(
      'row',
      makeRow({
        id: 'wl-4',
        email: 'paid@hive.com',
        stage: 'converted',
        convertedAt: '2026-03-07T12:00:00.000Z',
        stageAt: '2026-03-07T12:00:00.000Z',
        approvalEligible: false,
      }),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(
      el.querySelector('button[aria-label="Approve paid@hive.com"]'),
    ).toBeNull();
    expect(el.textContent).toContain('Converted');
    expect(el.querySelector('a')?.textContent).toContain('View license');
  });

  it('emits toggleSelect when checkbox is changed', () => {
    const row = makeRow();
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();

    let emittedRow: WaitlistListRow | null = null;
    component.toggleSelect.subscribe((r) => (emittedRow = r));

    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.dispatchEvent(new Event('change'));

    expect(emittedRow).toBe(row);
  });

  it('emits approve when Approve button is clicked', () => {
    const row = makeRow();
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();

    let emittedRow: WaitlistListRow | null = null;
    component.approve.subscribe((r) => (emittedRow = r));

    const approveBtn = fixture.nativeElement.querySelector(
      'button[aria-label="Approve dev@hive.com"]',
    ) as HTMLButtonElement;
    approveBtn.click();

    expect(emittedRow).toBe(row);
  });

  it('emits viewDetails with the row and opener HTMLElement', () => {
    const row = makeRow();
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();

    let emittedData: { row: WaitlistListRow; triggerEl: HTMLElement } | null =
      null;
    component.viewDetails.subscribe((data) => (emittedData = data));

    const detailsBtn = fixture.nativeElement.querySelector(
      'button[aria-label="View details for dev@hive.com"]',
    ) as HTMLButtonElement;
    detailsBtn.click();

    expect(emittedData).not.toBeNull();
    expect(emittedData?.row).toBe(row);
    expect(emittedData?.triggerEl).toBe(detailsBtn);
  });

  it('renders "Unknown" when source is null or empty', () => {
    fixture.componentRef.setInput('row', makeRow({ source: null }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Unknown');
  });
});
