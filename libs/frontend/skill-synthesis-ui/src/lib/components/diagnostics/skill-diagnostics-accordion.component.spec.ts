import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  EligibilityHistogramDto,
  SkillSynthesisEventWire,
  SkillTriggersDto,
} from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SkillDiagnosticsAccordionComponent } from './skill-diagnostics-accordion.component';

interface StubState {
  triggers: ReturnType<typeof signal<SkillTriggersDto>>;
  lastAnalyzeRunAt: ReturnType<typeof signal<number | null>>;
  lastCuratorPassAt: ReturnType<typeof signal<number | null>>;
  recentEvents: ReturnType<typeof signal<readonly SkillSynthesisEventWire[]>>;
  eligibilityHistogram: ReturnType<typeof signal<EligibilityHistogramDto>>;
  byStatus: ReturnType<
    typeof signal<{
      totalCandidates: number;
      totalPromoted: number;
      totalRejected: number;
      activeSkills: number;
      totalInvocations: number;
    }>
  >;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  sessionsAnalyzedToday: ReturnType<typeof signal<number>>;
  hasActiveSession: ReturnType<typeof signal<boolean>>;
  refresh: jest.Mock<Promise<void>, []>;
  startPolling: jest.Mock<void, []>;
  stopPolling: jest.Mock<void, []>;
  analyzeNow: jest.Mock<Promise<void>, []>;
  setTriggers: jest.Mock<Promise<void>, [Partial<SkillTriggersDto>]>;
}

function makeStub(): StubState {
  return {
    triggers: signal<SkillTriggersDto>({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
    }),
    lastAnalyzeRunAt: signal<number | null>(Date.now()),
    lastCuratorPassAt: signal<number | null>(Date.now() - 60_000),
    recentEvents: signal<readonly SkillSynthesisEventWire[]>([
      { kind: 'analyze-run', timestamp: Date.now(), sessionId: 'a' },
    ]),
    eligibilityHistogram: signal<EligibilityHistogramDto>({
      tooFewTurns: 1,
      lowFidelity: 2,
      insufficientAbstraction: 3,
      accepted: 4,
    }),
    byStatus: signal({
      totalCandidates: 7,
      totalPromoted: 3,
      totalRejected: 1,
      activeSkills: 2,
      totalInvocations: 12,
    }),
    loading: signal(false),
    error: signal<string | null>(null),
    sessionsAnalyzedToday: signal(10),
    hasActiveSession: signal(true),
    refresh: jest.fn(async () => undefined),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    analyzeNow: jest.fn(async () => undefined),
    setTriggers: jest.fn(async () => undefined),
  };
}

describe('SkillDiagnosticsAccordionComponent', () => {
  function createFixture(stub: StubState) {
    TestBed.configureTestingModule({
      imports: [SkillDiagnosticsAccordionComponent],
      providers: [{ provide: SkillDiagnosticsStateService, useValue: stub }],
    });
    return TestBed.createComponent(SkillDiagnosticsAccordionComponent);
  }

  it('renders all seven panels with state-driven content', () => {
    const stub = makeStub();
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-test="panel-last-run"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-last-curator"]')).toBeTruthy();
    expect(
      root.querySelector('[data-test="panel-sessions-today"]'),
    ).toBeTruthy();
    expect(root.querySelector('[data-test="panel-by-status"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-events"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-triggers"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-actions"]')).toBeTruthy();

    expect(stub.refresh).toHaveBeenCalledTimes(1);
    expect(stub.startPolling).toHaveBeenCalledTimes(1);

    expect(
      root
        .querySelector('[data-test="panel-sessions-today"]')
        ?.textContent?.trim(),
    ).toContain('10');

    expect(
      root.querySelector('[data-test="panel-by-status"]')?.textContent,
    ).toContain('7');
  });

  it('Analyze current session button triggers analyzeNow()', () => {
    const stub = makeStub();
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '[data-test="panel-actions"] button.btn-primary',
    ) as HTMLButtonElement;
    button.click();
    expect(stub.analyzeNow).toHaveBeenCalledTimes(1);
  });

  it('toggling a trigger writes via setTriggers', () => {
    const stub = makeStub();
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const checkboxes = fixture.nativeElement.querySelectorAll(
      '[data-test="panel-triggers"] input[type="checkbox"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    checkboxes[0].checked = false;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(stub.setTriggers).toHaveBeenCalledWith({ sessionEnd: false });
  });

  it('shows error text when state.error is set', () => {
    const stub = makeStub();
    stub.error.set('something exploded');
    const fixture = createFixture(stub);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('something exploded');
  });

  it('stops polling on destroy', () => {
    const stub = makeStub();
    const fixture = createFixture(stub);
    fixture.detectChanges();
    fixture.destroy();
    expect(stub.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('Analyze current session button is disabled when no active session', () => {
    const stub = makeStub();
    stub.hasActiveSession.set(false);
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector(
      '[data-test="analyze-now"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe(
      'Open a session to analyze it manually',
    );
  });

  it('shows "no active session" hint when hasActiveSession is false', () => {
    const stub = makeStub();
    stub.hasActiveSession.set(false);
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const hint = fixture.nativeElement.querySelector(
      '[data-test="no-active-session-hint"]',
    );
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? '').toContain(
      'Open a session to analyze it manually',
    );
  });

  it('Analyze current session button is enabled when hasActiveSession is true', () => {
    const stub = makeStub();
    stub.hasActiveSession.set(true);
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector(
      '[data-test="analyze-now"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const hint = fixture.nativeElement.querySelector(
      '[data-test="no-active-session-hint"]',
    );
    expect(hint).toBeNull();
  });

  it('toggling subagentStop persists nested DTO via setTriggers', () => {
    const stub = makeStub();
    stub.triggers.set({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
      subagentStop: { enabled: false },
    });
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="subagentStop"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(stub.setTriggers).toHaveBeenCalledWith({
      subagentStop: { enabled: true },
    });
  });

  it('changing postToolUse minEditCount persists nested DTO via setTriggers', () => {
    const stub = makeStub();
    stub.triggers.set({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
      postToolUse: { enabled: true, minEditCount: 1 },
    });
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="postToolUseMinEditCount"] input[type="number"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = '5';
    input.dispatchEvent(new Event('change'));
    expect(stub.setTriggers).toHaveBeenCalledWith({
      postToolUse: { enabled: true, minEditCount: 5 },
    });
  });

  it('toggling turnComplete persists nested DTO via setTriggers', () => {
    const stub = makeStub();
    stub.triggers.set({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
      turnComplete: { enabled: false },
    });
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="turnComplete"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(stub.setTriggers).toHaveBeenCalledWith({
      turnComplete: { enabled: true },
    });
  });

  it('changing maxAnalyzesPerHour persists flat field via setTriggers', () => {
    const stub = makeStub();
    stub.triggers.set({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
      maxAnalyzesPerHour: 60,
    });
    const fixture = createFixture(stub);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-test="panel-triggers"] ptah-skill-trigger-toggle[key="maxAnalyzesPerHour"] input[type="number"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = '120';
    input.dispatchEvent(new Event('change'));
    expect(stub.setTriggers).toHaveBeenCalledWith({
      maxAnalyzesPerHour: 120,
    });
  });
});
