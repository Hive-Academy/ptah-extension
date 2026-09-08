import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BackendReadiness, BootPhase } from '@ptah-extension/shared';

import { BootProgressComponent } from './boot-progress.component';

describe('BootProgressComponent', () => {
  let fixture: ComponentFixture<BootProgressComponent>;

  function render(inputs: {
    phase: BootPhase | string;
    readiness?: BackendReadiness;
    startedAt?: number;
    detail?: string;
  }): void {
    fixture.componentRef.setInput('phase', inputs.phase);
    fixture.componentRef.setInput('readiness', inputs.readiness ?? 'warming');
    fixture.componentRef.setInput('startedAt', inputs.startedAt ?? Date.now());
    fixture.componentRef.setInput('detail', inputs.detail);
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

  it('clears its elapsed timer on destroy', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    render({ phase: 'starting' });

    fixture.destroy();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
