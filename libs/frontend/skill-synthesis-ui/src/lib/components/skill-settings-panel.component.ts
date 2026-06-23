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
              <span class="text-xs text-base-content/60"
                >Successes to promote</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="successesToPromote"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
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
              <span class="text-xs text-base-content/60"
                >Max active skills</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="maxActiveSkills"
              />
            </label>
            <label class="flex flex-col gap-1 sm:col-span-2">
              <span class="text-xs text-base-content/60">Candidates dir</span>
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
              <span class="text-xs text-base-content/60"
                >Eligibility min turns</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="eligibilityMinTurns"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
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
              <span class="text-xs text-base-content/60"
                >Generalization context threshold</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="generalizationContextThreshold"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
                >Prefilter min edits</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinEdits"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
                >Prefilter min chars</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinChars"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
                >Prefilter min tool uses</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinToolUses"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
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
              <span class="text-xs text-base-content/60"
                >Min judge score (0-10)</span
              >
              <input
                type="number"
                step="0.1"
                class="input input-bordered input-sm"
                formControlName="minJudgeScore"
              />
            </label>
            <label class="flex flex-col gap-1 sm:col-span-2">
              <span class="text-xs text-base-content/60"
                >Judge model ('inherit' = workspace default)</span
              >
              <input
                type="text"
                class="input input-bordered input-sm"
                formControlName="judgeModel"
              />
            </label>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold">Pinning &amp; curation</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
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
              <span class="text-xs text-base-content/60"
                >Curator interval (hours)</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="curatorIntervalHours"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
                >Suggestion min cluster size</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="suggestionMinClusterSize"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-base-content/60"
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

  public readonly save = output<void>();

  protected readonly skeletonSlots = [0, 1, 2, 3];
}
