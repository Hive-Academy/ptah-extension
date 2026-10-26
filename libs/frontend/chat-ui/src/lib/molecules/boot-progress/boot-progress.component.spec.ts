import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BackendReadiness, BootPhase } from '@ptah-extension/shared';

import {
  BootProgressComponent,
  type BootHostStep,
} from './boot-progress.component';

describe('BootProgressComponent', () => {
  let fixture: ComponentFixture<BootProgressComponent>;

  function render(inputs: {
    phase: BootPhase | string;
    readiness?: BackendReadiness;
    startedAt?: number;
    detail?: string;
    hostSteps?: readonly BootHostStep[] | null;
  }): void {
    fixture.componentRef.setInput('phase', inputs.phase);
    fixture.componentRef.setInput('readiness', inputs.readiness ?? 'warming');
    fixture.componentRef.setInput('startedAt', inputs.startedAt ?? Date.now());
    fixture.componentRef.setInput('detail', inputs.detail);
    if (inputs.hostSteps !== undefined) {
      fixture.componentRef.setInput('hostSteps', inputs.hostSteps);
    }
    fixture.detectChanges();
  }

  function stepStates(): Record<string, string> {
    const nodes = fixture.nativeElement.querySelectorAll('li[data-phase]');
    const states: Record<string, string> = {};
    nodes.forEach((node: HTMLElement) => {
      states[node.getAttribute('data-phase') ?? ''] =
        node.getAttribute('data-state') ?? '';
    });
    return states;
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await TestBed.configureTestingModule({
      imports: [BootProgressComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(BootProgressComponent);
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('lists the five pre-settled phases as a real ordered list', () => {
    render({ phase: 'starting' });

    const list = fixture.nativeElement.querySelector('ol');
    expect(list).toBeTruthy();
    expect(list.querySelectorAll('li')).toHaveLength(5);
    expect(Object.keys(stepStates())).toEqual([
      'starting',
      'database',
      'harness',
      'sessions',
      'index',
    ]);
  });

  it('marks the phases already reached as done and the current one as active', () => {
    render({ phase: 'sessions' });

    expect(stepStates()).toEqual({
      starting: 'done',
      database: 'done',
      harness: 'done',
      sessions: 'active',
      index: 'pending',
    });
  });

  it('renders the current phase label as the headline', () => {
    render({ phase: 'database' });

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-headline"]')
        .textContent.trim(),
    ).toBe('Opening the database');
  });

  it('degrades an unrecognised phase to "Starting" with nothing checked', () => {
    render({ phase: 'quantum-tunnelling' });

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-headline"]')
        .textContent.trim(),
    ).toBe('Starting');
    expect(Object.values(stepStates())).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('renders the host-supplied detail when there is one', () => {
    render({ phase: 'database', detail: 'Opening a 1.0 GB database' });

    expect(fixture.nativeElement.textContent).toContain(
      'Opening a 1.0 GB database',
    );
  });

  it('omits the detail line entirely when the host sends none', () => {
    render({ phase: 'database' });

    const paragraphs = fixture.nativeElement.querySelectorAll('p');
    // Only the elapsed line remains.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].getAttribute('data-testid')).toBe('boot-elapsed');
  });

  it('derives elapsed time from startedAt and keeps counting', () => {
    render({ phase: 'database', startedAt: Date.now() - 3000 });

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-elapsed"]')
        .textContent.trim(),
    ).toBe('3s elapsed');

    jest.advanceTimersByTime(2000);
    fixture.detectChanges();

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-elapsed"]')
        .textContent.trim(),
    ).toBe('5s elapsed');
  });

  it('never shows negative elapsed time when startedAt is in the future', () => {
    render({ phase: 'database', startedAt: Date.now() + 5000 });

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-elapsed"]')
        .textContent.trim(),
    ).toBe('0s elapsed');
  });

  it('is a polite live region so the phase change is announced', () => {
    render({ phase: 'starting' });

    const region = fixture.nativeElement.querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('tints the headline when the boot is degraded', () => {
    render({ phase: 'harness', readiness: 'degraded' });

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="boot-headline"]')
        .getAttribute('class'),
    ).toContain('text-warning');
  });

  describe('host boot steps', () => {
    const HOST = '[data-testid="boot-host-steps"]';

    function hostRows(): HTMLElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll(`${HOST} li[data-state]`),
      );
    }

    it('renders nothing for the host steps when the host publishes none', () => {
      render({ phase: 'database' });
      expect(fixture.nativeElement.querySelector(HOST)).toBeNull();

      render({ phase: 'database', hostSteps: null });
      expect(fixture.nativeElement.querySelector(HOST)).toBeNull();

      render({ phase: 'database', hostSteps: [] });
      expect(fixture.nativeElement.querySelector(HOST)).toBeNull();
    });

    it('continues the pre-renderer checklist with its labels and states', () => {
      render({
        phase: 'database',
        hostSteps: [
          { stepId: 'verify', state: 'done', elapsedMs: 1240 },
          { stepId: 'restore', state: 'active', done: 3, count: 12 },
          { stepId: 'agents', state: 'pending' },
        ],
      });

      const rows = hostRows();
      expect(rows.map((row) => row.getAttribute('data-state'))).toEqual([
        'done',
        'active',
        'pending',
      ]);
      expect(
        rows.map((row) =>
          row.querySelector('.ptah-staged-steps__label')?.textContent?.trim(),
        ),
      ).toEqual([
        'Verify local state',
        'Restore workspace history',
        'Start agents',
      ]);
      expect(
        rows.map((row) =>
          row.querySelector('.ptah-staged-steps__aside')?.textContent?.trim(),
        ),
      ).toEqual(['1.2 s', '3 / 12', '']);
      const bar = rows[1].querySelector('[role="progressbar"]');
      expect(bar?.getAttribute('aria-valuenow')).toBe('3');
      expect(bar?.getAttribute('aria-valuemax')).toBe('12');
    });

    it('rounds a long step to whole seconds and shows a failed step', () => {
      render({
        phase: 'database',
        hostSteps: [
          { stepId: 'verify', state: 'done', elapsedMs: 12_600 },
          { stepId: 'restore', state: 'failed', elapsedMs: 400 },
          { stepId: 'agents', state: 'pending' },
        ],
      });

      const rows = hostRows();
      expect(rows[0].textContent).toContain('13 s');
      expect(rows[1].getAttribute('data-state')).toBe('failed');
      // Only a finished step shows its elapsed time.
      expect(rows[1].textContent).not.toContain('0.4 s');
    });

    it('sits above the phase rows, which keep rendering', () => {
      render({
        phase: 'sessions',
        hostSteps: [{ stepId: 'verify', state: 'active' }],
      });

      const host = fixture.nativeElement.querySelector(HOST);
      const phases = fixture.nativeElement.querySelector(
        '[data-testid="boot-steps"]',
      );
      expect(
        host.compareDocumentPosition(phases) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(stepStates()['sessions']).toBe('active');
    });
  });

  it('clears its elapsed timer on destroy', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    render({ phase: 'starting' });

    fixture.destroy();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
