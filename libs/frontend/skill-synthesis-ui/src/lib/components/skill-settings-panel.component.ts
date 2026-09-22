import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { AppStateManager } from '@ptah-extension/core';

@Component({
  selector: 'ptah-skill-settings-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    @if (loaded()) {
      <form [formGroup]="form()" class="max-w-2xl space-y-6">
        <section class="space-y-3">
          <h2 class="text-sm font-semibold">Core</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                formControlName="enabled"
              />
              <span class="text-sm">Enabled</span>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Successes to promote</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="successesToPromote"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Dedup cosine threshold</span
              >
              <input
                type="number"
                step="0.01"
                class="input input-bordered input-sm"
                formControlName="dedupCosineThreshold"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max active skills</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="maxActiveSkills"
              />
            </label>
            <label class="flex flex-col gap-1 sm:col-span-2">
              <span class="text-xs text-base-content-muted"
                >Candidates dir</span
              >
              <input
                type="text"
                class="input input-bordered input-sm"
                formControlName="candidatesDir"
              />
            </label>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold">Eligibility &amp; quality</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Eviction decay rate (0-1)</span
              >
              <input
                type="number"
                step="0.01"
                class="input input-bordered input-sm"
                formControlName="evictionDecayRate"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Generalization context threshold</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="generalizationContextThreshold"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Prefilter min edits</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinEdits"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Prefilter min tool uses</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinToolUses"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Dedup cluster threshold (0-1)</span
              >
              <input
                type="number"
                step="0.01"
                class="input input-bordered input-sm"
                formControlName="dedupClusterThreshold"
              />
            </label>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold">Judging</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                formControlName="judgeEnabled"
              />
              <span class="text-sm">Judge enabled</span>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Min judge score (0-10)</span
              >
              <input
                type="number"
                step="0.1"
                class="input input-bordered input-sm"
                formControlName="minJudgeScore"
              />
            </label>
            <button type="button" class="btn btn-outline min-h-9 focus-visible:outline-2" (click)="manage('judging-enhancement')">Manage judging model in Providers</button>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold">Pinning &amp; curation</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max pinned skills</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="maxPinnedSkills"
              />
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                formControlName="curatorEnabled"
              />
              <span class="text-sm">Curator enabled</span>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Curator interval (hours)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="curatorIntervalHours"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Suggestion min cluster size</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="suggestionMinClusterSize"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Suggestion max candidates</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="suggestionMaxCandidates"
              />
            </label>
          </div>
        </section>

        <section class="space-y-3" data-testid="skills-lanes-section">
          <h2 class="text-sm font-semibold">Background models</h2>
          @for (lane of laneTargets; track lane) {
            <button type="button" class="btn btn-outline min-h-9 focus-visible:outline-2" (click)="manage(lane)">Manage {{ lane }} in Providers</button>
          }
        </section>

        <section class="space-y-3" data-testid="skills-background-section">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">Background work</h2>
            <p class="text-xs text-base-content-muted">
              Synthesis runs on a drained queue, off the critical path. These
              knobs bound what it may spend and when it may run.
            </p>
          </div>

          <div
            class="grid grid-cols-1 gap-3 sm:grid-cols-2"
            formGroupName="budget"
          >
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Daily token budget (0 = unlimited)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-budget-max-tokens-per-day"
                formControlName="maxTokensPerDay"
              />
            </label>
          </div>

          <div
            class="grid grid-cols-1 gap-3 sm:grid-cols-2"
            formGroupName="drain"
          >
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Foreground backoff (ms)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-foreground-backoff-ms"
                formControlName="foregroundBackoffMs"
              />
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                data-testid="skills-drain-pause-on-battery"
                formControlName="pauseOnBattery"
              />
              <span class="text-sm">Pause while on battery</span>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Drain schedule (cron)</span
              >
              <input
                type="text"
                class="input input-bordered input-sm font-mono"
                data-testid="skills-drain-cron-expr"
                formControlName="cronExpr"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Nightly schedule (cron)</span
              >
              <input
                type="text"
                class="input input-bordered input-sm font-mono"
                data-testid="skills-drain-nightly-cron-expr"
                formControlName="nightlyCronExpr"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Weekly schedule (cron)</span
              >
              <input
                type="text"
                class="input input-bordered input-sm font-mono"
                data-testid="skills-drain-weekly-cron-expr"
                formControlName="weeklyCronExpr"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max items per run (frequent tier)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-max-items-per-run"
                formControlName="maxItemsPerRun"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max items per run (nightly tier)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-nightly-max-items-per-run"
                formControlName="nightlyMaxItemsPerRun"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max items per run (weekly tier)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-weekly-max-items-per-run"
                formControlName="weeklyMaxItemsPerRun"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Per-workspace batch</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-per-workspace-batch"
                formControlName="perWorkspaceBatch"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Max attempts per item</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-max-attempts"
                formControlName="maxAttempts"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content-muted"
                >Stale claim TTL (ms)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                data-testid="skills-drain-stale-claim-ttl-ms"
                formControlName="staleClaimTtlMs"
              />
            </label>
          </div>

          @if (isElectron()) {
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  data-testid="skills-tray-keepalive"
                  formControlName="trayKeepalive"
                />
                <span class="text-sm">Keep running in the tray</span>
              </label>
            </div>
          }
        </section>

        <div class="flex justify-end">
          <button
            type="button"
            class="btn btn-primary btn-sm transition-colors duration-150"
            [disabled]="saving() || form().invalid"
            (click)="save.emit()"
          >
            Save settings
          </button>
        </div>
      </form>
    } @else {
      <div class="max-w-2xl space-y-3" aria-busy="true">
        @for (i of skeletonSlots; track i) {
          <div class="h-9 rounded bg-base-300/40"></div>
        }
      </div>
    }
  `,
})
export class SkillSettingsPanelComponent {
  public readonly form = input.required<FormGroup>();
  public readonly loaded = input<boolean>(false);
  public readonly saving = input<boolean>(false);

  /**
   * Gates the tray-keepalive toggle. There is no tray in the VS Code webview,
   * so offering the control there would promise something the host cannot do.
   */
  public readonly isElectron = input<boolean>(false);

  public readonly save = output<void>();

  private readonly appState = inject(AppStateManager);
  protected readonly skeletonSlots = [0, 1, 2, 3];
  protected readonly laneTargets = ['archaeologist', 'synthesis', 'judge', 'replay'] as const;
  protected manage(section: typeof this.laneTargets[number] | 'judging-enhancement'): void {
    this.appState.requestSettingsTab({ tab: 'providers', section });
    this.appState.setCurrentView('settings');
  }
}
