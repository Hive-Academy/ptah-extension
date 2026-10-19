import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';

import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import { SkillClonesViewComponent } from './clones/skill-clones-view.component';
import { SkillSynthesisTabComponent } from './skill-synthesis-tab.component';
import { SkillsPauseSwitchComponent } from './skills-pause-switch.component';

@Component({
  selector: 'ptah-skill-clones-view',
  standalone: true,
  template: '<span data-testid="library-filter-token">{{ divergedFilterRequest() }}</span>',
})
class LibraryTestComponent {
  readonly divergedFilterRequest = input(0);
  readonly skillsPaused = input(false);
  readonly pausedRefusal = output<void>();
}

@Component({
  selector: 'ptah-skills-pause-switch',
  standalone: true,
  template: '<button type="button" (click)="pausedChange.emit(true)">Pause Skills</button>',
})
class PauseSwitchTestComponent {
  readonly pausedChange = output<boolean>();
}

describe('SkillSynthesisTabComponent', () => {
  function mount(isElectron = true) {
    const telemetryEnabled = signal<boolean | null>(true);
    const skillsPaused = signal(false);
    const refreshTelemetryEnabled = jest.fn(async () => undefined);
    const setTelemetryEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const markSkillsPaused = jest.fn(() => skillsPaused.set(true));
    const divergedRequest = signal(false);
    const consumeSkillsDivergedRequest = jest.fn(() => {
      if (!divergedRequest()) return false;
      divergedRequest.set(false);
      return true;
    });

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        {
          provide: SkillSynthesisStateService,
          useValue: {
            skillsPaused,
            telemetryEnabled,
            telemetrySaving: signal(false),
            telemetryError: signal<string | null>(null),
            refreshTelemetryEnabled,
            setTelemetryEnabled,
            markSkillsPaused,
            specs: signal([]),
            specsLoading: signal(false),
            staleSpecCount: signal(0),
            refreshSpecs: jest.fn(async () => undefined),
          },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron }) },
        },
        {
          provide: AppStateManager,
          useValue: { consumeSkillsDivergedRequest },
        },
      ],
    });
    TestBed.overrideComponent(SkillSynthesisTabComponent, {
      remove: { imports: [SkillClonesViewComponent, SkillsPauseSwitchComponent] },
      add: { imports: [LibraryTestComponent, PauseSwitchTestComponent] },
    });
    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    return {
      fixture,
      root: fixture.nativeElement as HTMLElement,
      refreshTelemetryEnabled,
      setTelemetryEnabled,
      markSkillsPaused,
      divergedRequest,
      consumeSkillsDivergedRequest,
    };
  }

  it('shows the Library and specs control and preserves both switches on desktop', () => {
    const { root, refreshTelemetryEnabled } = mount();
    expect(root.querySelector('ptah-skill-clones-view')).not.toBeNull();
    expect(root.querySelector('[data-testid="skills-specs-control"]')).not.toBeNull();
    expect(root.querySelector('ptah-skills-pause-switch')).not.toBeNull();
    expect(root.querySelector('[data-testid="skills-telemetry-toggle"]')).not.toBeNull();
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector('[data-testid="run-curator"]')).toBeNull();
    expect(root.querySelector('ptah-skill-stats-strip')).toBeNull();
    expect(refreshTelemetryEnabled).toHaveBeenCalledTimes(1);
  });

  it('routes the telemetry switch through state', () => {
    const { fixture, root, setTelemetryEnabled } = mount();
    const toggle = root.querySelector<HTMLInputElement>('[data-testid="skills-telemetry-toggle"]');
    expect(toggle).not.toBeNull();
    toggle?.click();
    fixture.detectChanges();
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(toggle?.checked).toBe(true);
  });

  it('forwards pause events and handles a paused enhancement refusal', () => {
    const { fixture, markSkillsPaused } = mount();
    const emitted: boolean[] = [];
    fixture.componentInstance.pausedChange.subscribe((value) => emitted.push(value));
    const pause = fixture.debugElement.query(By.directive(PauseSwitchTestComponent))
      .componentInstance as PauseSwitchTestComponent;
    pause.pausedChange.emit(true);
    expect(emitted).toEqual([true]);

    const library = fixture.debugElement.query(By.directive(LibraryTestComponent))
      .componentInstance as LibraryTestComponent;
    library.pausedRefusal.emit();
    expect(markSkillsPaused).toHaveBeenCalledTimes(1);
  });

  it('consumes each diverged Library deep link once', () => {
    const { fixture, root, divergedRequest, consumeSkillsDivergedRequest } = mount();
    const token = () => root.querySelector('[data-testid="library-filter-token"]')?.textContent?.trim();
    expect(token()).toBe('0');
    divergedRequest.set(true);
    fixture.detectChanges();
    expect(token()).toBe('1');
    fixture.detectChanges();
    expect(token()).toBe('1');
    divergedRequest.set(true);
    fixture.detectChanges();
    expect(token()).toBe('2');
    expect(consumeSkillsDivergedRequest).toHaveBeenCalled();
  });

  it('keeps the desktop notice in VS Code and skips telemetry reads', () => {
    const { root, refreshTelemetryEnabled } = mount(false);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Ptah desktop');
    expect(root.querySelector('ptah-skill-clones-view')).toBeNull();
    expect(refreshTelemetryEnabled).not.toHaveBeenCalled();
  });
});
