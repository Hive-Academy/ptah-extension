import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminApiService } from '../services/admin-api.service';
import { WaitlistDetailsDrawer } from './waitlist-details-drawer';
import { WaitlistDetailsResponse } from './waitlist-query-state';

function mockDetails(
  overrides: Partial<WaitlistDetailsResponse> = {},
): WaitlistDetailsResponse {
  return {
    entry: {
      id: 'wl-99',
      email: 'founder@example.com',
      source: 'landing',
      createdAt: '2026-03-01T10:00:00.000Z',
      notifiedAt: null,
      approvedAt: null,
      convertedAt: null,
      stage: 'new',
      stageAt: '2026-03-01T10:00:00.000Z',
      approvalEligible: true,
    },
    user: {
      id: 'usr-1',
      email: 'founder@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      createdAt: '2026-03-02T10:00:00.000Z',
      licenses: [
        {
          id: 'lic-1',
          plan: 'builders',
          status: 'active',
          source: 'complimentary',
          expiresAt: '2027-03-02T10:00:00.000Z',
          createdAt: '2026-03-02T10:00:00.000Z',
          createdBy: 'admin@hive.com',
        },
      ],
      subscriptions: [],
      groups: [
        {
          id: 'grp-1',
          key: 'founding-members',
          name: 'Founding Members',
          assignedAt: '2026-03-02T10:00:00.000Z',
          source: 'approval',
        },
      ],
    },
    audit: [
      {
        id: 'aud-1',
        actorEmail: 'admin@hive.com',
        action: 'waitlist.approve',
        targetType: 'Waitlist',
        targetId: 'wl-99',
        createdAt: '2026-03-02T10:00:00.000Z',
        metadata: {
          userId: 'usr-1',
          licenseId: 'lic-1',
          durationPreset: '1y',
        },
      },
    ],
    ...overrides,
  };
}

describe('WaitlistDetailsDrawer', () => {
  let fixture: ComponentFixture<WaitlistDetailsDrawer>;
  let component: WaitlistDetailsDrawer;
  let api: { getWaitlistDetails: jest.Mock };

  beforeEach(() => {
    api = {
      getWaitlistDetails: jest.fn().mockReturnValue(of(mockDetails())),
    };

    TestBed.configureTestingModule({
      imports: [WaitlistDetailsDrawer],
      providers: [
        provideRouter([]),
        { provide: AdminApiService, useValue: api },
      ],
    });

    fixture = TestBed.createComponent(WaitlistDetailsDrawer);
    component = fixture.componentInstance;
  });

  it('fetches details and renders full account, license, and audit information', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-99');
    fixture.detectChanges();

    expect(api.getWaitlistDetails).toHaveBeenCalledWith('wl-99');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('founder@example.com');
    expect(el.textContent).toContain('Grace Hopper');
    expect(el.textContent).toContain('builders');
    expect(el.textContent).toContain('Founding Members');
    expect(el.textContent).toContain('waitlist.approve');
    expect(el.textContent).toContain('User ID: usr-1');

    // Navigation link to merged user/licenses view
    const userLink = el.querySelector('a[href="/admin/users/usr-1"]');
    expect(userLink).toBeTruthy();
  });

  it('renders explicit empty states when user, licenses, or groups are missing', () => {
    api.getWaitlistDetails.mockReturnValue(
      of(
        mockDetails({
          user: null,
          audit: [],
        }),
      ),
    );

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-empty');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No linked user account found.');
    expect(el.textContent).toContain('No audit history found.');
  });

  it('renders 404 not-found state when entry does not exist', () => {
    api.getWaitlistDetails.mockReturnValue(
      throwError(() => ({ status: 404, message: 'Not found' })),
    );

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-404');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Entry no longer exists');
  });

  it('renders dependency error and provides Retry button on 503 / network error', () => {
    api.getWaitlistDetails.mockReturnValue(
      throwError(() => ({ status: 503, message: 'Unavailable' })),
    );

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-503');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      'Waitlist details are temporarily unavailable',
    );

    // Switch mock to success and retry
    api.getWaitlistDetails.mockReturnValue(of(mockDetails()));
    const retryBtn = el.querySelector(
      'button.btn-outline',
    ) as HTMLButtonElement;
    retryBtn.click();
    fixture.detectChanges();

    expect(api.getWaitlistDetails).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('founder@example.com');
  });

  it('renders Approve button only when entry is approvalEligible', () => {
    // Eligible
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-99');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const approveBtn = el.querySelector(
      'div[drawerFooter] button.btn-primary',
    ) as HTMLButtonElement;
    expect(approveBtn).toBeTruthy();

    let approvedId = '';
    component.approve.subscribe((id) => (approvedId = id));
    approveBtn.click();
    expect(approvedId).toBe('wl-99');

    // Ineligible (approved)
    api.getWaitlistDetails.mockReturnValue(
      of(
        mockDetails({
          entry: {
            id: 'wl-app',
            email: 'app@example.com',
            source: 'vscode',
            createdAt: '2026-03-01T00:00:00.000Z',
            notifiedAt: null,
            approvedAt: '2026-03-05T00:00:00.000Z',
            convertedAt: null,
            stage: 'approved',
            stageAt: '2026-03-05T00:00:00.000Z',
            approvalEligible: false,
          },
        }),
      ),
    );
    fixture.componentRef.setInput('entryId', 'wl-app');
    fixture.detectChanges();

    const absentApprove = el.querySelector(
      'div[drawerFooter] button.btn-primary',
    );
    expect(absentApprove).toBeNull();
  });

  it('emits closed when Close button is clicked', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-99');
    fixture.detectChanges();

    let closed = false;
    component.closed.subscribe(() => (closed = true));

    const closeBtn = fixture.nativeElement.querySelector(
      'div[drawerFooter] button.btn-ghost',
    ) as HTMLButtonElement;
    closeBtn.click();

    expect(closed).toBe(true);
  });

  it('handles race condition when row A is slow and row B is fast (drawer shows B)', () => {
    const subjectA = new Subject<WaitlistDetailsResponse>();
    const detailsB = mockDetails({
      entry: {
        id: 'wl-b',
        email: 'person-b@example.com',
        source: 'landing',
        createdAt: '2026-03-01T10:00:00.000Z',
        notifiedAt: null,
        approvedAt: null,
        convertedAt: null,
        stage: 'new',
        stageAt: '2026-03-01T10:00:00.000Z',
        approvalEligible: true,
      },
    });

    api.getWaitlistDetails.mockImplementation((id: string) => {
      if (id === 'wl-a') {
        return subjectA.asObservable();
      }
      return of(detailsB);
    });

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('entryId', 'wl-a');
    fixture.detectChanges();

    // Now quickly open entry B
    fixture.componentRef.setInput('entryId', 'wl-b');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('person-b@example.com');

    // A resolves later
    subjectA.next(
      mockDetails({
        entry: {
          id: 'wl-a',
          email: 'person-a@example.com',
          source: 'landing',
          createdAt: '2026-03-01T10:00:00.000Z',
          notifiedAt: null,
          approvedAt: null,
          convertedAt: null,
          stage: 'new',
          stageAt: '2026-03-01T10:00:00.000Z',
          approvalEligible: true,
        },
      }),
    );
    subjectA.complete();
    fixture.detectChanges();

    // Drawer still shows B, not overwritten by stale A
    expect(el.textContent).toContain('person-b@example.com');
    expect(el.textContent).not.toContain('person-a@example.com');
  });
});
