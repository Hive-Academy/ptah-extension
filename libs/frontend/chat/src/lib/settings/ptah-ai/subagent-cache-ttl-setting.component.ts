import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import {
  SUBAGENT_PROMPT_CACHE_TTL_SETTINGS,
  type SubagentPromptCacheTtlSetting,
} from '@ptah-extension/shared';
import { SurfaceSectionComponent } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const ENV_VAR = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';
const NOT_SAVED =
  'Could not save the subagent prompt-cache TTL. The saved setting is unchanged.';
const NOT_CONFIRMED =
  'Could not confirm whether the subagent prompt-cache TTL was saved. Check the saved setting again before changing it.';
const LABELS: Readonly<Record<SubagentPromptCacheTtlSetting, string>> = {
  auto: 'Auto (1 hour for sessions with subagents)',
  '5m': '5 minutes',
  '1h': '1 hour',
};

/**
 * Subagent prompt-cache TTL (`agentOrchestration.subagentPromptCacheTtl`, TASK_2026_597 N1). Same save model as
 * `CopilotAutoApproveToggleComponent`: the write is `state.saveSettings({orchestration:{subagentPromptCacheTtl}})` through
 * `SettingsSaveFeedbackService` (toast + Undo), and the select only ever shows the read-back value (D15). An unknown
 * outcome blanks the select and takes no writes until "Check saved setting again" reads the value.
 *
 * When the host's `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` is set (`subagentPromptCacheTtlEnvOverride`, read-only) the
 * select stays editable and a notice says the env var takes precedence, or that its value is invalid and ignored.
 */
@Component({
  selector: 'ptah-subagent-cache-ttl-setting',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, SurfaceSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-surface-section
      tone="subtle"
      padding="md"
      class="text-xs text-base-content"
      aria-label="Subagent prompt cache"
      data-testid="subagent-cache-ttl-setting"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <label for="subagent-cache-ttl" class="text-xs font-bold"
          >Subagent prompt-cache TTL</label
        >
        <select
          id="subagent-cache-ttl"
          [class]="
            'select select-bordered select-xs min-h-7 w-full sm:w-72 ' +
            focusRing
          "
          [value]="shown() ?? ''"
          [ptahBusyDisabled]="saving() || needsRecheck() || feedback.saving()"
          [attr.aria-describedby]="
            envNotice() ? 'subagent-cache-ttl-env' : null
          "
          (change)="select($event)"
          data-testid="subagent-cache-ttl"
        >
          @if (shown() === null) {
            <option value="" disabled selected>Unknown</option>
          }
          @for (option of options; track option.value) {
            <option
              [value]="option.value"
              [selected]="option.value === shown()"
            >
              {{ option.label }}
            </option>
          }
        </select>
      </div>
      @if (envNotice(); as notice) {
        <p
          id="subagent-cache-ttl-env"
          class="rounded-md border border-info/30 bg-info/10 px-2 py-1 text-xs text-base-content"
          data-testid="subagent-cache-ttl-env"
        >
          @if (notice.invalid) {
            <code class="font-mono">{{ envVar }}</code> has an invalid value and
            is ignored by Ptah.
          } @else {
            <code class="font-mono">{{ envVar }}={{ notice.value }}</code> is
            set in your environment and takes precedence.
          }
        </p>
      }
      @if (error(); as message) {
        <p
          class="text-xs text-base-content"
          role="alert"
          data-testid="subagent-cache-ttl-error"
        >
          {{ message }}
        </p>
      } @else if (saved() === null) {
        <p
          class="text-xs text-base-content-muted"
          role="status"
          data-testid="subagent-cache-ttl-unloaded"
        >
          The saved setting could not be read.
        </p>
      }
      @if (needsRecheck()) {
        <button
          type="button"
          [class]="
            'btn btn-outline btn-xs min-h-7 border-base-content-muted text-base-content ' +
            focusRing
          "
          [ptahBusyDisabled]="saving()"
          (click)="recheck()"
          data-testid="subagent-cache-ttl-recheck"
        >
          Check saved setting again
        </button>
      }
    </ptah-surface-section>
  `,
})
export class SubagentCacheTtlSettingComponent {
  protected readonly focusRing = FOCUS;
  protected readonly envVar = ENV_VAR;
  protected readonly options = SUBAGENT_PROMPT_CACHE_TTL_SETTINGS.map(
    (value) => ({ value, label: LABELS[value] }),
  );
  private readonly state = inject(ProvidersSettingsStateService);
  protected readonly feedback = inject(SettingsSaveFeedbackService);

  /** The saved value as last read, or `null` when the orchestration read has no data. */
  protected readonly saved = computed(
    () => this.state.orchestration().data?.subagentPromptCacheTtl ?? null,
  );
  /** The env override notice, or `null` when the env var is unset (or the read has no data). */
  protected readonly envNotice = computed(() => {
    const value =
      this.state.orchestration().data?.subagentPromptCacheTtlEnvOverride;
    if (value === 'invalid') return { invalid: true, value };
    return value === '5m' || value === '1h' ? { invalid: false, value } : null;
  });
  /** True while this setting's write or re-read runs; the select is disabled meanwhile. */
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A write's outcome is unknown: no value is shown and no write is taken until a re-read succeeds. */
  protected readonly unconfirmed = signal(false);
  protected readonly needsRecheck = computed(
    () => this.unconfirmed() || this.saved() === null,
  );
  /** What the select shows: the read-back value, or nothing while the last write's outcome is unknown. */
  protected readonly shown = computed(() =>
    this.unconfirmed() ? null : this.saved(),
  );

  async select(event: Event): Promise<void> {
    const input = event.target as HTMLSelectElement;
    const saved = this.saved();
    const next = SUBAGENT_PROMPT_CACHE_TTL_SETTINGS.find(
      (value) => value === input.value,
    );
    // The select keeps showing the saved value; the read-back after the write moves it.
    input.value = this.shown() ?? '';
    const context = this.state.reviewContext();
    if (
      saved === null ||
      next === undefined ||
      next === saved ||
      this.saving() ||
      this.unconfirmed() ||
      !context
    )
      return;
    this.saving.set(true);
    this.error.set(null);
    try {
      // `refused`: another save in flight, nothing written; `started`: the commit describes this write; `threw`: the
      // outcome is unknown; `skipped`: never called.
      const result: { attempt: 'skipped' | 'threw' | 'refused' | 'started' } = {
        attempt: 'skipped',
      };
      await this.feedback.save({
        label: 'Subagent prompt-cache TTL',
        scope: 'global',
        write: async () => {
          result.attempt = 'threw';
          const started = await this.state.saveSettings(
            { orchestration: { subagentPromptCacheTtl: next } },
            context,
          );
          result.attempt = started ? 'started' : 'refused';
          return started;
        },
        undo: () =>
          this.state.saveSettings(
            { orchestration: { subagentPromptCacheTtl: saved } },
            context,
          ),
      });
      if (result.attempt === 'started') this.settle(next);
      else if (result.attempt === 'threw') this.markUnconfirmed();
    } finally {
      this.saving.set(false);
    }
  }

  /** Re-reads the saved value after an unconfirmed write; accepts writes again once it reads one. */
  async recheck(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.state.refreshOrchestration();
      if (
        this.state.orchestration().status === 'ready' &&
        this.saved() !== null
      ) {
        this.unconfirmed.set(false);
        this.error.set(null);
      } else {
        this.markUnconfirmed();
      }
    } finally {
      this.saving.set(false);
    }
  }

  private settle(requested: SubagentPromptCacheTtlSetting): void {
    if (this.state.commit().status === 'unconfirmed' || this.saved() === null) {
      this.markUnconfirmed();
      return;
    }
    if (this.saved() !== requested) this.error.set(NOT_SAVED);
  }

  private markUnconfirmed(): void {
    this.unconfirmed.set(true);
    this.error.set(NOT_CONFIRMED);
  }
}
