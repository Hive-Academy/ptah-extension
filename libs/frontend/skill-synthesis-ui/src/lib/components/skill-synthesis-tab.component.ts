import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { LucideAngularModule, Sparkles } from 'lucide-angular';

import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import { SkillClonesViewComponent } from './clones/skill-clones-view.component';
import { SkillsPauseSwitchComponent } from './skills-pause-switch.component';

@Component({
  selector: 'ptah-skill-synthesis-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    SkillClonesViewComponent,
    SkillsPauseSwitchComponent,
  ],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="alert"
      >
        <lucide-angular
          [img]="SparklesIcon"
          class="size-8 text-base-content-muted"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">
          The Skills Library is only available in the Ptah desktop app.
        </p>
        <p class="text-xs text-base-content-muted">
          Download Ptah desktop to manage your Skills, Agents and Commands Library.
        </p>
        <a
          class="link link-primary text-xs"
          href="https://github.com/HiveAcademy/ptah-extension/releases"
          target="_blank"
          rel="noopener noreferrer"
          >Download Ptah desktop</a
        >
      </div>
    } @else {
      <div
        class="surface-1 flex flex-col gap-5 rounded-xl p-5"
        data-testid="thoth-section-skills"
      >
        <header class="flex items-start gap-3">
          <span
            class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-0 text-secondary"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="h-5 w-5"
              aria-hidden="true"
            />
          </span>
          <div>
            <h1 class="text-xl font-semibold tracking-tight">Skills</h1>
            <p class="mt-0.5 text-sm text-base-content-muted">
              Manage your Skills, Agents and Commands Library.
            </p>
          </div>
        </header>

        <ptah-skills-pause-switch (pausedChange)="pausedChange.emit($event)" />

        <section
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
          aria-labelledby="skills-telemetry-label"
          data-testid="skills-telemetry-switch"
        >
          <div>
            <label id="skills-telemetry-label" for="skills-telemetry-toggle" class="text-sm font-semibold">
              Skill telemetry
            </label>
            <p id="skills-telemetry-help" class="text-xs text-base-content-muted">
              Records skill use even while Skills is paused.
            </p>
          </div>
          <input
            id="skills-telemetry-toggle"
            type="checkbox"
            role="switch"
            class="toggle toggle-sm toggle-primary"
            [checked]="telemetryEnabled() === true"
            [disabled]="telemetrySaving() || telemetryEnabled() === null"
            aria-describedby="skills-telemetry-help"
            (change)="onToggleTelemetry($event)"
            data-testid="skills-telemetry-toggle"
          />
          @if (telemetryError(); as message) {
            <p class="basis-full text-xs text-error" role="alert">{{ message }}</p>
          }
        </section>

        <ptah-skill-clones-view
          [divergedFilterRequest]="clonesDivergedFilter()"
          [skillsPaused]="skillsPaused()"
          (pausedRefusal)="onPausedRefusal()"
        />
      </div>
    }
  `,
})
export class SkillSynthesisTabComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);

  protected readonly SparklesIcon = Sparkles;
  protected readonly skillsPaused = this.state.skillsPaused;
  protected readonly telemetryEnabled = this.state.telemetryEnabled;
  protected readonly telemetrySaving = this.state.telemetrySaving;
  protected readonly telemetryError = this.state.telemetryError;
  public readonly pausedChange = output<boolean>();
  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  private readonly _clonesDivergedFilter = signal(0);
  protected readonly clonesDivergedFilter = this._clonesDivergedFilter.asReadonly();

  public constructor() {
    effect(() => {
      if (!this.appState.consumeSkillsDivergedRequest()) return;
      this._clonesDivergedFilter.update((token) => token + 1);
    });
  }

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshTelemetryEnabled();
  }

  protected onToggleTelemetry(event: Event): void {
    const input = event.target as HTMLInputElement;
    const wanted = input.checked;
    input.checked = this.telemetryEnabled() === true;
    void this.state.setTelemetryEnabled(wanted);
  }

  protected onPausedRefusal(): void {
    this.state.markSkillsPaused();
  }
}
