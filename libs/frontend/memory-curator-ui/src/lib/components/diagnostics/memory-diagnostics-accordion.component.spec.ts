import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  MemoryCuratorEventWire,
  MemoryDbHealthDto,
  MemoryTriggersDto,
} from '@ptah-extension/shared';

import { MemoryDiagnosticsStateService } from '../../services/memory-diagnostics-state.service';

import { MemoryDiagnosticsAccordionComponent } from './memory-diagnostics-accordion.component';

describe('MemoryDiagnosticsAccordionComponent', () => {
  const triggers = signal<MemoryTriggersDto | null>({
    preCompact: true,
    idleMs: 600000,
    turnThreshold: 20,
    bootScan: true,
  });
  const lastRun = signal<{
    at: number;
    stats: Record<string, number> | null;
  } | null>({
    at: 1_700_000_000_000,
    stats: { promoted: 3 },
  });
  const lastDecay = signal<{
    at: number;
    stats: Record<string, number> | null;
  } | null>(null);
  const recentEvents = signal<readonly MemoryCuratorEventWire[]>([]);
  const dbHealth = signal<MemoryDbHealthDto | null>({
    memories: 10,
    memory_chunks: 100,
    memory_chunks_vec: 100,
    memory_chunks_fts: 100,
    code_symbols: 50,
    code_symbols_vec: 50,
    coherent: true,
    mismatches: [],
  });
  const loading = signal<boolean>(false);
  const error = signal<string | null>(null);
  const hasActiveSession = signal<boolean>(true);

  let runNowMock: jest.Mock;
  let setTriggersMock: jest.Mock;
  let refreshMock: jest.Mock;
  let startPollingMock: jest.Mock;
  let stopPollingMock: jest.Mock;

  beforeEach(async () => {
    triggers.set({
      preCompact: true,
      idleMs: 600000,
      turnThreshold: 20,
      bootScan: true,
    });
    lastRun.set({ at: 1_700_000_000_000, stats: { promoted: 3 } });
    lastDecay.set(null);
    recentEvents.set([]);
    dbHealth.set({
      memories: 10,
      memory_chunks: 100,
      memory_chunks_vec: 100,
      memory_chunks_fts: 100,
      code_symbols: 50,
      code_symbols_vec: 50,
      coherent: true,
      mismatches: [],
    });
    loading.set(false);
    error.set(null);
    hasActiveSession.set(true);

    runNowMock = jest.fn(() => Promise.resolve());
    setTriggersMock = jest.fn(() => Promise.resolve());
    refreshMock = jest.fn(() => Promise.resolve());
    startPollingMock = jest.fn();
    stopPollingMock = jest.fn();

    await TestBed.configureTestingModule({
      imports: [MemoryDiagnosticsAccordionComponent],
      providers: [
        {
          provide: MemoryDiagnosticsStateService,
          useValue: {
            triggers,
            lastRun,
            lastDecay,
            recentEvents,
            dbHealth,
            loading,
            error,
            hasActiveSession,
            runNow: runNowMock,
            setTriggers: setTriggersMock,
            refresh: refreshMock,
            startPolling: startPollingMock,
            stopPolling: stopPollingMock,
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the six panels when state is fully loaded', () => {
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="last-curator-run"]'),
    ).not.toBeNull();
    expect(root.querySelector('[data-testid="last-decay-run"]')).not.toBeNull();
    expect(root.textContent ?? '').toContain('Triggers');
    expect(root.textContent ?? '').toContain('Recent events');
    expect(root.textContent ?? '').toContain('DB Health');
    expect(
      root.querySelector('[data-testid="run-curator-now"]'),
    ).not.toBeNull();
    expect(startPollingMock).toHaveBeenCalled();
  });

  it('Run curator now button calls state.runNow()', () => {
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="run-curator-now"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(runNowMock).toHaveBeenCalledTimes(1);
  });

  it('toggling a trigger writes via setTriggers', () => {
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const toggles = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'input[type="checkbox"]',
    );
    expect(toggles.length).toBeGreaterThan(0);
    const preCompact = toggles[0] as HTMLInputElement;
    preCompact.checked = false;
    preCompact.dispatchEvent(new Event('change'));

    expect(setTriggersMock).toHaveBeenCalledWith({ preCompact: false });
  });

  it('shows ✗ MISMATCH when DB health is incoherent', () => {
    dbHealth.set({
      memories: 10,
      memory_chunks: 100,
      memory_chunks_vec: 99,
      memory_chunks_fts: 100,
      code_symbols: 50,
      code_symbols_vec: 50,
      coherent: false,
      mismatches: ['memory_chunks/memory_chunks_vec'],
    });

    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const mismatch = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="health-mismatch"]',
    );
    expect(mismatch.length).toBeGreaterThan(0);
  });

  it('shows "No recent events" placeholder when feed is empty', () => {
    recentEvents.set([]);
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const placeholder = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="event-feed-empty"]',
    );
    expect(placeholder).not.toBeNull();
  });

  it('stopPolling fires on destroy', () => {
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();
    fixture.destroy();
    expect(stopPollingMock).toHaveBeenCalled();
  });

  it('Refresh button calls state.refresh()', () => {
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="refresh-diagnostics"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('renders the loading placeholder when triggers is null', () => {
    triggers.set(null);
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'Loading trigger settings',
    );
  });

  it('shows error alert when error signal set', () => {
    error.set('boom');
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'boom',
    );
  });

  it('Run curator now button is disabled when no active session', () => {
    hasActiveSession.set(false);
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="run-curator-now"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe(
      'Open a session to run curator manually',
    );
  });

  it('shows "no active session" hint when hasActiveSession is false', () => {
    hasActiveSession.set(false);
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="no-active-session-hint"]',
    );
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? '').toContain(
      'Open a session to run curator manually',
    );
  });

  it('Run curator now button is enabled when hasActiveSession is true', () => {
    hasActiveSession.set(true);
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="run-curator-now"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="no-active-session-hint"]',
    );
    expect(hint).toBeNull();
  });

  it('toggling PostToolUse persists nested DTO via setTriggers', () => {
    triggers.set({
      preCompact: true,
      idleMs: 600_000,
      turnThreshold: 20,
      bootScan: true,
      postToolUse: { enabled: false },
    });
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const allToggles = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'ptah-memory-trigger-toggle',
    );
    const postToolUseRow = Array.from(allToggles).find((el) =>
      (el.textContent ?? '').includes('PostToolUse'),
    );
    if (!postToolUseRow) throw new Error('PostToolUse row not found');
    const checkbox = postToolUseRow.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(setTriggersMock).toHaveBeenCalledWith({
      postToolUse: { enabled: true },
    });
  });

  it('toggling UserPromptSubmit persists nested DTO with cue list preserved', () => {
    triggers.set({
      preCompact: true,
      idleMs: 600_000,
      turnThreshold: 20,
      bootScan: true,
      userPromptSubmit: {
        enabled: false,
        cueList: ['remember', 'note that'],
        minPromptLength: 0,
      },
    });
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const allToggles = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'ptah-memory-trigger-toggle',
    );
    const cuesRow = Array.from(allToggles).find((el) =>
      (el.textContent ?? '').includes('UserPromptSubmit cues'),
    );
    if (!cuesRow) throw new Error('UserPromptSubmit cues row not found');
    const checkbox = cuesRow.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(setTriggersMock).toHaveBeenCalledWith({
      userPromptSubmit: {
        enabled: true,
        cueList: ['remember', 'note that'],
        minPromptLength: 0,
      },
    });
  });

  it('changing Max curates per hour value persists via setTriggers', () => {
    triggers.set({
      preCompact: true,
      idleMs: 600_000,
      turnThreshold: 20,
      bootScan: true,
      maxCuratesPerHour: 60,
    });
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const allToggles = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'ptah-memory-trigger-toggle',
    );
    const maxRow = Array.from(allToggles).find((el) =>
      (el.textContent ?? '').includes('Max curates per hour'),
    );
    if (!maxRow) throw new Error('Max curates per hour row not found');
    const number = maxRow.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    number.value = '120';
    number.dispatchEvent(new Event('change'));
    expect(setTriggersMock).toHaveBeenCalledWith({ maxCuratesPerHour: 120 });
  });

  it('renders read-only cue list textarea joined by newlines', () => {
    triggers.set({
      preCompact: true,
      idleMs: 600_000,
      turnThreshold: 20,
      bootScan: true,
      userPromptSubmit: {
        enabled: true,
        cueList: ['remember', 'note that', 'fyi'],
        minPromptLength: 0,
      },
    });
    const fixture = TestBed.createComponent(
      MemoryDiagnosticsAccordionComponent,
    );
    fixture.detectChanges();

    const textarea = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="memory-cue-list"]',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.readOnly).toBe(true);
    expect(textarea.value).toBe('remember\nnote that\nfyi');
  });
});
