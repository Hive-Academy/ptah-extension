import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AdminApiService,
  AdminApproveWaitlistResponse,
} from '../../services/admin-api.service';
import { ApproveWaitlistModal } from './approve-waitlist-modal';

function mockApprovalResponse(): AdminApproveWaitlistResponse {
  return {
    requested: 5,
    tally: {
      approved: 1,
      already_approved: 1,
      already_paid: 1,
      not_found: 1,
      failed: 1,
    },
    results: [
      {
        id: 'wl-1',
        email: 'one@example.com',
        outcome: 'approved',
        licenseId: 'lic-1',
      },
      { id: 'wl-2', email: 'two@example.com', outcome: 'already_approved' },
      { id: 'wl-3', email: 'three@example.com', outcome: 'already_paid' },
      { id: 'wl-4', email: null, outcome: 'not_found' },
      {
        id: 'wl-5',
        email: 'five@example.com',
        outcome: 'failed',
        error: { code: 'GRANT_FAILED' },
      },
    ],
  };
}

describe('ApproveWaitlistModal', () => {
  let fixture: ComponentFixture<ApproveWaitlistModal>;
  let component: ApproveWaitlistModal;
  let api: { approveWaitlist: jest.Mock };

  beforeEach(() => {
    api = {
      approveWaitlist: jest.fn().mockReturnValue(of(mockApprovalResponse())),
    };

    TestBed.configureTestingModule({
      imports: [ApproveWaitlistModal],
      providers: [{ provide: AdminApiService, useValue: api }],
    });

    fixture = TestBed.createComponent(ApproveWaitlistModal);
    component = fixture.componentInstance;
  });

  it('blocks submission when 0 IDs are provided', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', []);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const submitBtn = el.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(el.textContent).toContain('Select at least one row to approve');
  });

  it('blocks submission when more than 50 IDs are provided', () => {
    const ids51 = Array.from({ length: 51 }, (_, i) => `wl-${i}`);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', ids51);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const submitBtn = el.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(el.textContent).toContain('approve at most 50 at a time');
  });

  it('submits 1-50 IDs, renders aggregate and per-entry outcomes, and emits full response', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', [
      'wl-1',
      'wl-2',
      'wl-3',
      'wl-4',
      'wl-5',
    ]);
    fixture.detectChanges();

    let emittedResponse: AdminApproveWaitlistResponse | null = null;
    component.submitted.subscribe((res) => (emittedResponse = res));

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(api.approveWaitlist).toHaveBeenCalledWith({
      ids: ['wl-1', 'wl-2', 'wl-3', 'wl-4', 'wl-5'],
    });
    expect(emittedResponse).not.toBeNull();
    expect(emittedResponse?.tally.approved).toBe(1);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('5 rows processed');
    expect(el.textContent).toContain('Approved');
    expect(el.textContent).toContain('Already approved');
    expect(el.textContent).toContain('Already paid');
    expect(el.textContent).toContain('Not found');
    expect(el.textContent).toContain('Failed');
    expect(el.textContent).toContain('one@example.com');
    expect(el.textContent).toContain('wl-4');
    expect(el.textContent).toContain('five@example.com');
    expect(el.textContent).toContain('GRANT_FAILED');
    expect(el.querySelector('[data-outcome="not_found"]')).toBeTruthy();
    expect(el.querySelector('[data-outcome="failed"]')).toBeTruthy();
  });

  it('maps a known approval API code to fixed safe copy', () => {
    api.approveWaitlist.mockReturnValue(
      throwError(() => ({
        status: 500,
        error: {
          code: 'COHORT_NOT_CONFIGURED',
          message: 'database relation member_groups missing',
        },
      })),
    );

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', ['wl-1']);
    fixture.detectChanges();

    let submittedCalled = false;
    component.submitted.subscribe(() => (submittedCalled = true));

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(submittedCalled).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      'The founding cohort is not configured. Please contact support.',
    );
    expect(el.textContent).not.toContain('database relation');

    // Submit button is re-enabled so the admin can retry
    const submitBtn = el.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('uses generic fixed copy for an unknown error object', () => {
    api.approveWaitlist.mockReturnValue(
      throwError(() => ({
        status: 502,
        error: { code: 'PROXY_FAILURE', message: 'upstream secret detail' },
        message: 'transport secret detail',
      })),
    );

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', ['wl-1']);
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Failed to approve these rows. Please try again.');
    expect(text).not.toContain('upstream secret detail');
    expect(text).not.toContain('transport secret detail');
  });

  it('emits closeModal on Cancel or Close click', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ids', ['wl-1']);
    fixture.detectChanges();

    let closed = false;
    component.closeModal.subscribe(() => (closed = true));

    const cancelBtn = fixture.nativeElement.querySelector(
      'button.btn-ghost',
    ) as HTMLButtonElement;
    cancelBtn.click();

    expect(closed).toBe(true);
  });
});
