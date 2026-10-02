import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { SkillSynthesisEventWire } from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SkillActivityFeedComponent } from './skill-activity-feed.component';

interface StubState {
  recentEvents: ReturnType<typeof signal<readonly SkillSynthesisEventWire[]>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  hasActiveSession: ReturnType<typeof signal<boolean>>;
  refresh: jest.Mock<Promise<void>, []>;
  startPolling: jest.Mock<void, []>;
  stopPolling: jest.Mock<void, []>;
  analyzeNow: jest.Mock<Promise<void>, []>;
  setTriggers: jest.Mock;
}

function makeStub(): StubState {
  return {
    recentEvents: signal<readonly SkillSynthesisEventWire[]>([]),
    loading: signal(false),
    error: signal<string | null>(null),
    hasActiveSession: signal(true),
    refresh: jest.fn(async () => undefined),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    analyzeNow: jest.fn(async () => undefined),
    setTriggers: jest.fn(async () => undefined),
  };
}

function createFixture(stub: StubState) {
  TestBed.configureTestingModule({
    imports: [SkillActivityFeedComponent],
    providers: [{ provide: SkillDiagnosticsStateService, useValue: stub }],
  });
  const fixture = TestBed.createComponent(SkillActivityFeedComponent);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('SkillActivityFeedComponent', () => {
  it('refreshes once and then starts the poll on init', () => {
    const stub = makeStub();
    createFixture(stub);
    expect(stub.refresh).toHaveBeenCalledTimes(1);
    expect(stub.startPolling).toHaveBeenCalledTimes(1);
    expect(stub.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      stub.startPolling.mock.invocationCallOrder[0],
    );
    expect(stub.stopPolling).not.toHaveBeenCalled();
  });

  it('stops polling on destroy', () => {
    const stub = makeStub();
    const { fixture } = createFixture(stub);
    fixture.destroy();
    expect(stub.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('renders the Recent events section with the feed, newest first', () => {
    const stub = makeStub();
    const now = Date.now();
    stub.recentEvents.set([
      {
        id: '01J00000000000000000000003',
        kind: 'error',
        timestamp: now,
        error: 'newest failure',
      },
      {
        id: '01J00000000000000000000002',
        kind: 'ineligible',
        timestamp: now - 1_000,
        sessionId: 'b',
      },
      {
        id: '01J00000000000000000000001',
        kind: 'analyze-run',
        timestamp: now - 2_000,
        sessionId: 'a',
      },
    ]);
    const { root } = createFixture(stub);

    const panel = root.querySelector('[data-test="panel-events"]');
    expect(panel?.querySelector('h2')?.textContent).toContain('Recent events');
    const rows = Array.from(
      panel?.querySelectorAll<HTMLElement>('[role="list"] > li') ?? [],
    );
    expect(rows.map((li) => li.getAttribute('data-event-id'))).toEqual([
      '01J00000000000000000000003',
      '01J00000000000000000000002',
      '01J00000000000000000000001',
    ]);
    expect(rows[0].textContent).toContain('newest failure');
  });

  it('shows the empty feed state when there are no events', () => {
    const { root } = createFixture(makeStub());
    expect(root.textContent).toContain('No recent events.');
  });

  it('Analyze current session calls analyzeNow when a session is active', () => {
    const stub = makeStub();
    const { root } = createFixture(stub);
    const btn = root.querySelector<HTMLButtonElement>(
      '[data-test="analyze-now"]',
    );
    expect(btn?.disabled).toBe(false);
    expect(
      root.querySelector('[data-test="no-active-session-hint"]'),
    ).toBeNull();
    btn?.click();
    expect(stub.analyzeNow).toHaveBeenCalledTimes(1);
  });

  it('disables Analyze current session with a hint when no session is active', () => {
    const stub = makeStub();
    stub.hasActiveSession.set(false);
    const { root } = createFixture(stub);
    const btn = root.querySelector<HTMLButtonElement>(
      '[data-test="analyze-now"]',
    );
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toBe(
      'Open a session to analyze it manually',
    );
    expect(
      root.querySelector('[data-test="no-active-session-hint"]')?.textContent,
    ).toContain('Open a session to analyze it manually');
    btn?.click();
    expect(stub.analyzeNow).not.toHaveBeenCalled();
  });

  it('disables Analyze current session while a request is loading', () => {
    const stub = makeStub();
    stub.loading.set(true);
    const { root } = createFixture(stub);
    expect(
      root.querySelector<HTMLButtonElement>('[data-test="analyze-now"]')
        ?.disabled,
    ).toBe(true);
  });

  it('shows the state error as an alert', () => {
    const stub = makeStub();
    const { fixture, root } = createFixture(stub);
    expect(root.querySelector('[role="alert"]')).toBeNull();

    stub.error.set('something exploded');
    fixture.detectChanges();
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('something exploded');
  });

  it('never writes triggers', () => {
    const stub = makeStub();
    createFixture(stub);
    expect(stub.setTriggers).not.toHaveBeenCalled();
  });
});
