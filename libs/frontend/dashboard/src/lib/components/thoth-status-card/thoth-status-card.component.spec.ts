import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';

import { ThothStatusCardComponent } from './thoth-status-card.component';
import {
  ThothStatusService,
  type ThothGatewaySummary,
  type ThothStatusSummary,
} from '../../services/thoth-status.service';

function makeSummary(gateway: ThothGatewaySummary): ThothStatusSummary {
  return {
    memory: { available: true, totalFacts: 5, queueLength: 0 },
    skills: { available: true, pendingCandidates: 0 },
    cron: { available: true, totalJobs: 0, nextRunAt: null },
    gateway,
    isLoading: false,
    lastUpdatedAt: 1,
    errors: { memory: null, skills: null, cron: null, gateway: null },
  };
}

describe('ThothStatusCardComponent', () => {
  let fixture: ComponentFixture<ThothStatusCardComponent>;
  let summary: ReturnType<typeof signal<ThothStatusSummary>>;
  let refreshIfNeeded: jest.Mock;
  let appState: { setThothActiveTab: jest.Mock; setCurrentView: jest.Mock };

  beforeEach(async () => {
    summary = signal<ThothStatusSummary>(
      makeSummary({ available: false, reason: 'desktop-only' }),
    );
    refreshIfNeeded = jest.fn().mockResolvedValue(undefined);
    appState = {
      setThothActiveTab: jest.fn(),
      setCurrentView: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ThothStatusCardComponent],
      providers: [
        {
          provide: ThothStatusService,
          useValue: { summary, refreshIfNeeded },
        },
        { provide: AppStateManager, useValue: appState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ThothStatusCardComponent);
  });

  function gatewayTile(): HTMLElement {
    return fixture.nativeElement.querySelector(
      '[data-pillar="gateway"]',
    ) as HTMLElement;
  }

  function gatewayValue(): string {
    return (
      gatewayTile()
        .querySelector('[data-testid="dashboard-status-card-value"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? ''
    );
  }

  function gatewayDesc(): string {
    return (
      gatewayTile().querySelectorAll('.stat-desc')[0]?.textContent?.trim() ?? ''
    );
  }

  it('shows the running-platform count as the headline metric', () => {
    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 0,
        platforms: [
          { platform: 'telegram', state: 'running' },
          { platform: 'discord', state: 'running' },
          { platform: 'slack', state: 'disabled' },
        ],
      }),
    );
    fixture.detectChanges();

    expect(gatewayValue()).toBe('2 running');
    expect(refreshIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('demotes pending approvals to the description line', () => {
    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 2,
        platforms: [{ platform: 'discord', state: 'running' }],
      }),
    );
    fixture.detectChanges();

    expect(gatewayValue()).toBe('1 running');
    expect(gatewayDesc()).toBe('2 pending approval');
  });

  it('shows no-pending description when nothing awaits approval', () => {
    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 0,
        platforms: [{ platform: 'discord', state: 'enabled' }],
      }),
    );
    fixture.detectChanges();

    expect(gatewayValue()).toBe('0 running');
    expect(gatewayDesc()).toBe('no pending approvals');
  });

  it('renders an error badge with the adapter error as tooltip', () => {
    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 0,
        platforms: [
          { platform: 'discord', state: 'error', lastError: 'token bad' },
        ],
      }),
    );
    fixture.detectChanges();

    const badge = gatewayTile().querySelector('.badge-error');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toBe('token bad');
    expect(badge?.textContent?.trim()).toBe('discord');
  });

  it('preserves the desktop-only empty state', () => {
    fixture.detectChanges();

    expect(gatewayValue()).toBe('—');
    expect(gatewayDesc()).toBe('Desktop only');
    expect(gatewayTile().classList.contains('opacity-60')).toBe(true);
  });

  it('re-renders live when the summary signal changes', () => {
    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 0,
        platforms: [{ platform: 'discord', state: 'enabled' }],
      }),
    );
    fixture.detectChanges();
    expect(gatewayValue()).toBe('0 running');

    summary.set(
      makeSummary({
        available: true,
        pendingBindings: 0,
        platforms: [{ platform: 'discord', state: 'running' }],
      }),
    );
    fixture.detectChanges();
    expect(gatewayValue()).toBe('1 running');
  });
});
