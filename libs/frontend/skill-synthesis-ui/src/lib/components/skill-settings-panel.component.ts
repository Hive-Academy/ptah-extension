/**
 * SkillSettingsPanelComponent — every knob the Skills tab owns, in one place.
 *
 * THIS IS THE ONE SOURCE OF TRUTH for skill-synthesis settings. The general
 * Settings view LINKS here rather than duplicating the controls: two copies of
 * a lane picker means two places a provider can be pinned and one of them
 * silently losing.
 *
 * Presentational by construction. The Core / Eligibility / Judging / Pinning /
 * Background sections are bound to a `FormGroup` the parent owns; the Lanes
 * section is bound to a `SkillLanesDto` the parent loads and re-emits. The only
 * thing this component injects is the model-catalogue port the shared picker
 * needs, which it supplies from the Skills tab's own RPC service.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import {
  PROVIDER_MODELS_LOADER,
  ProviderModelPickerComponent,
  type ProviderModelSelection,
} from '@ptah-extension/ui';
import type {
  SkillLaneDto,
  SkillLaneIdDto,
  SkillLanesDto,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../services/skill-synthesis-rpc.service';

/** A lane edit, ready to be handed to `skillSynthesis:setLanes` as a patch. */
export interface SkillLaneSelectionChange {
  readonly laneId: SkillLaneIdDto;
  readonly provider: string;
  readonly model: string;
}

interface LaneRow {
  readonly id: SkillLaneIdDto;
  readonly label: string;
  readonly lane: SkillLaneDto;
  readonly requiresToolUse: boolean;
}

/**
 * Render order and human labels for the four stages that call an LLM.
 *
 * Ordered by where each sits in the pipeline, not alphabetically. There is no
 * provider id here and there never may be: a lane is a set of capability
 * fields, and the provider behind it is whatever the user picked — or, by
 * default, nothing at all.
 */
const LANE_LABELS: ReadonlyArray<{
  readonly id: SkillLaneIdDto;
  readonly label: string;
}> = [
  { id: 'archaeologist', label: 'Archaeologist lane' },
  { id: 'synthesis', label: 'Synthesis lane' },
  { id: 'judge', label: 'Judge lane' },
  { id: 'replay', label: 'Replay lane' },
];

/**
 * The sentence that states the default in words.
 *
 * The MACHINE expression of the same default is `SkillLaneDto.provider === ''`,
 * which makes the shared picker's own inherit option the selected one. No lane
 * ships with a provider preselected — that is the guarantee that an existing
 * install keeps behaving exactly as it did before lanes existed.
 */
const INHERIT_EXPLANATION =
  'Every lane inherits the active provider until you choose one here. Leaving all four untouched keeps the current behaviour exactly.';

@Component({
  selector: 'ptah-skill-settings-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ProviderModelPickerComponent],
  /**
   * The picker takes its transport as a port so it can live in `libs/frontend/ui`
   * without importing `type:core`. The Skills tab supplies its OWN RPC service,
   * which is what lets one picker serve both this tab (VS Code + Electron) and
   * the Electron-only Memory tab.
   */
  providers: [
    { provide: PROVIDER_MODELS_LOADER, useExisting: SkillSynthesisRpcService },
  ],
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
                >Eligibility min turns</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="eligibilityMinTurns"
              />
            </label>
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
                >Prefilter min chars</span
              >
              <input
                type="number"
                class="input input-bordered input-sm"
                formControlName="prefilterMinChars"
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
            <label class="flex flex-col gap-1 sm:col-span-2">
              <span class="text-xs text-base-content-muted"
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
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">Lanes</h2>
            <p
              class="text-xs text-base-content-muted"
              data-testid="skills-lanes-inherit-note"
            >
              {{ inheritExplanation }}
            </p>
          </div>

          @if (laneRows(); as lanes) {
            <div class="space-y-2">
              @for (row of lanes; track row.id) {
                <ptah-provider-model-picker
                  [attr.data-testid]="'skills-lane-picker'"
                  [attr.data-lane]="row.id"
                  [label]="row.label"
                  [provider]="row.lane.provider"
                  [model]="row.lane.model"
                  [defaultTier]="row.lane.defaultTier"
                  [requiresToolUse]="row.requiresToolUse"
                  (selectionChange)="onLaneSelection(row.id, $event)"
                />
              }
            </div>
          } @else {
            <p
              class="text-xs text-base-content-muted"
              data-testid="skills-lanes-loading"
            >
              Loading lane configuration…
            </p>
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

  /** All four lanes, or `null` while `skillSynthesis:getLanes` is in flight. */
  public readonly lanes = input<SkillLanesDto | null>(null);

  /**
   * Gates the tray-keepalive toggle. There is no tray in the VS Code webview,
   * so offering the control there would promise something the host cannot do.
   */
  public readonly isElectron = input<boolean>(false);

  public readonly save = output<void>();

  /** One lane edit. The parent turns it into a sparse `setLanes` patch. */
  public readonly laneChange = output<SkillLaneSelectionChange>();

  protected readonly skeletonSlots = [0, 1, 2, 3];
  protected readonly inheritExplanation = INHERIT_EXPLANATION;

  protected readonly laneRows = computed<readonly LaneRow[] | null>(() => {
    const lanes = this.lanes();
    if (!lanes) return null;
    return LANE_LABELS.map(({ id, label }) => {
      const lane = lanes[id];
      return {
        id,
        label,
        lane,
        // Surfaced so the picker can warn when a pinned model cannot drive
        // tools, instead of letting the lane burn its whole timeout finding out.
        requiresToolUse: lane.toolUse === 'required',
      };
    });
  });

  protected onLaneSelection(
    laneId: SkillLaneIdDto,
    selection: ProviderModelSelection,
  ): void {
    this.laneChange.emit({
      laneId,
      provider: selection.provider,
      model: selection.model,
    });
  }
}
