import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StreamRouter, StreamingSurfaceRegistry } from '@ptah-extension/chat-routing';
import { VSCodeService, WallClockService } from '@ptah-extension/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { AnalysisStatsDashboardComponent } from './analysis-stats-dashboard.component';

describe('AnalysisStatsDashboardComponent', () => {
  it('derives elapsed time from the root run across remounts and reset', () => {
    const now = signal(10_000);
    const release = jest.fn();
    const acquire = jest.fn(() => release);
    TestBed.configureTestingModule({
      imports: [AnalysisStatsDashboardComponent],
      providers: [
        SetupWizardStateService,
        {
          provide: VSCodeService,
          useValue: { postMessage: jest.fn() },
        },
        {
          provide: StreamRouter,
          useValue: {
            onSurfaceCreated: jest.fn(),
            onSurfaceClosed: jest.fn(),
            routeStreamEventForSurface: jest.fn(),
          },
        },
        {
          provide: StreamingSurfaceRegistry,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getAdapter: jest.fn(),
          },
        },
        {
          provide: WallClockService,
          useValue: { now: () => now, acquire },
        },
      ],
    });
    const state = TestBed.inject(SetupWizardStateService);
    const first = TestBed.createComponent(AnalysisStatsDashboardComponent);
    first.detectChanges();
    expect(first.nativeElement.textContent).not.toMatch(/\d+:\d\d/);
    expect(acquire).not.toHaveBeenCalled();

    state.handleMessage({
      type: 'setup-wizard:analysis-stream',
      payload: { kind: 'text', content: 'starting', timestamp: 1_000 },
    });
    first.detectChanges();
    expect(first.nativeElement.textContent).toContain('0:09');
    expect(acquire).toHaveBeenCalledWith('second');
    first.destroy();
    expect(release).toHaveBeenCalledTimes(1);

    now.set(65_000);
    const remounted = TestBed.createComponent(AnalysisStatsDashboardComponent);
    remounted.detectChanges();
    expect(remounted.nativeElement.textContent).toContain('1:04');

    state.reset();
    remounted.detectChanges();
    expect(remounted.nativeElement.textContent).not.toMatch(/\d+:\d\d/);
    expect(release).toHaveBeenCalledTimes(2);
    remounted.destroy();
  });
});
