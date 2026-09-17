import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  AdminApiService,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { AdminOverview } from './overview';

function mockStats(
  overrides: Partial<AdminStatsResponse> = {},
): AdminStatsResponse {
  return {
    waitlist: {
      total: 100,
      notified: 40,
      converted: 5,
      last7Days: 12,
      approved: 15,
      new: 45,
      invited: 40,
      pending: 85,
    },
    members: {
      builders: 20,
      community: 80,
    },
    groups: [],
    attention: {
      waitlistUninvited: 45,
      failedWebhooksUnresolved: 0,
      subscriptionsPastDue: 0,
      sessionRequestsPending: 0,
    },
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AdminOverview', () => {
  let fixture: ComponentFixture<AdminOverview>;
  let component: AdminOverview;
  let api: { getStats: jest.Mock };

  beforeEach(() => {
    api = {
      getStats: jest.fn().mockReturnValue(of(mockStats())),
    };

    TestBed.configureTestingModule({
      imports: [AdminOverview],
      providers: [
        provideRouter([]),
        { provide: AdminApiService, useValue: api },
      ],
    });

    fixture = TestBed.createComponent(AdminOverview);
    component = fixture.componentInstance;
  });

  it('uses attention.waitlistUninvited from server rather than total - notified', () => {
    fixture.detectChanges();

    // total is 100, notified is 40. The old formula would be 100 - 40 = 60,
    // which wrongly overcounted the 15 approved rows as uninvited.
    // The server's authoritative attention.waitlistUninvited is 45.
    const waitlistUninvited = (
      component as unknown as { waitlistUninvited: () => number }
    ).waitlistUninvited();
    expect(waitlistUninvited).toBe(45);
  });

  it('falls back to waitlist.new when attention block is absent', () => {
    const statsWithoutAttention = mockStats();
    delete (statsWithoutAttention as Partial<AdminStatsResponse>).attention;
    api.getStats.mockReturnValue(of(statsWithoutAttention));

    const newFixture = TestBed.createComponent(AdminOverview);
    const newComponent = newFixture.componentInstance;
    newFixture.detectChanges();

    const waitlistUninvited = (
      newComponent as unknown as { waitlistUninvited: () => number }
    ).waitlistUninvited();
    expect(waitlistUninvited).toBe(45);
  });
});
