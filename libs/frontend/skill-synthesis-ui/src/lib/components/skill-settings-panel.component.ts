import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';

@Component({
  selector: 'ptah-skill-settings-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <details
      class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-100"
      data-test="settings-panel"
    >
      <summary
        class="collapse-title min-h-0 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-base-content/70"
      >
        Settings
      </summary>
      <div class="collapse-content">
        @if (loaded()) {
          <form [formGroup]="form()" class="pt-2">
            <fieldset class="fieldset border border-base-300 rounded p-3">
              <legend class="fieldset-legend text-xs font-semibold">
                Core
              </legend>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="form-control">
                  <span class="label label-text text-xs">Enabled</span>
                  <input
                    type="checkbox"
                    class="checkbox"
                    formControlName="enabled"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Successes to promote</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="successesToPromote"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Dedup cosine threshold</span
                  >
                  <input
                    type="number"
                    step="0.01"
                    class="input input-bordered input-sm"
                    formControlName="dedupCosineThreshold"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Max active skills</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="maxActiveSkills"
                  />
                </label>
                <label class="form-control sm:col-span-2">
                  <span class="label label-text text-xs">Candidates dir</span>
                  <input
                    type="text"
                    class="input input-bordered input-sm"
                    formControlName="candidatesDir"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset class="fieldset border border-base-300 rounded p-3 mt-2">
              <legend class="fieldset-legend text-xs font-semibold">
                Eligibility &amp; Quality
              </legend>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Eligibility min turns</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="eligibilityMinTurns"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Eviction decay rate (0-1)</span
                  >
                  <input
                    type="number"
                    step="0.01"
                    class="input input-bordered input-sm"
                    formControlName="evictionDecayRate"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Generalization context threshold</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="generalizationContextThreshold"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Min trajectory fidelity ratio (0-1)</span
                  >
                  <input
                    type="number"
                    step="0.01"
                    class="input input-bordered input-sm"
                    formControlName="minTrajectoryFidelityRatio"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Min abstraction edit distance (0-1)</span
                  >
                  <input
                    type="number"
                    step="0.01"
                    class="input input-bordered input-sm"
                    formControlName="minAbstractionEditDistance"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset class="fieldset border border-base-300 rounded p-3 mt-2">
              <legend class="fieldset-legend text-xs font-semibold">
                Cluster Dedup
              </legend>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="form-control">
                  <span class="label label-text text-xs"
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
            </fieldset>

            <fieldset class="fieldset border border-base-300 rounded p-3 mt-2">
              <legend class="fieldset-legend text-xs font-semibold">
                LLM Judge
              </legend>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="form-control">
                  <span class="label label-text text-xs">Judge enabled</span>
                  <input
                    type="checkbox"
                    class="checkbox"
                    formControlName="judgeEnabled"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Min judge score (0-10)</span
                  >
                  <input
                    type="number"
                    step="0.1"
                    class="input input-bordered input-sm"
                    formControlName="minJudgeScore"
                  />
                </label>
                <label class="form-control sm:col-span-2">
                  <span class="label label-text text-xs"
                    >Judge model ('inherit' = workspace default)</span
                  >
                  <input
                    type="text"
                    class="input input-bordered input-sm"
                    formControlName="judgeModel"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset class="fieldset border border-base-300 rounded p-3 mt-2">
              <legend class="fieldset-legend text-xs font-semibold">
                Pinning &amp; Curator
              </legend>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Max pinned skills</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="maxPinnedSkills"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs">Curator enabled</span>
                  <input
                    type="checkbox"
                    class="checkbox"
                    formControlName="curatorEnabled"
                  />
                </label>
                <label class="form-control">
                  <span class="label label-text text-xs"
                    >Curator interval (hours)</span
                  >
                  <input
                    type="number"
                    class="input input-bordered input-sm"
                    formControlName="curatorIntervalHours"
                  />
                </label>
              </div>
            </fieldset>

            <div class="mt-3 flex justify-end">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                [disabled]="saving() || form().invalid"
                (click)="save.emit()"
              >
                Save Settings
              </button>
            </div>
          </form>
        } @else {
          <div class="pt-2 text-xs text-base-content/60">
            Loading settings&hellip;
          </div>
        }
      </div>
    </details>
  `,
})
export class SkillSettingsPanelComponent {
  public readonly form = input.required<FormGroup>();
  public readonly loaded = input<boolean>(false);
  public readonly saving = input<boolean>(false);

  public readonly save = output<void>();
}
