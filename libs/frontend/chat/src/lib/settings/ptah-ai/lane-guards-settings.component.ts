import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SurfaceSectionComponent } from '@ptah-extension/ui';
import {
  LANE_GUARD_DEFAULTS,
  LANE_GUARD_FIELDS,
  laneGuardFieldError,
  laneGuardFromConfig,
  laneGuardKeyInError,
  laneGuardWrite,
  type LaneGuardKey,
  type LaneGuardValues,
} from './lane-guards-settings.logic';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const RPC_TIMEOUT_MS = 5_000;

const EMPTY_DRAFTS: Record<LaneGuardKey, string> = {
  laneRepeatCallStopAt: '',
};

function draftsFrom(values: LaneGuardValues): Record<LaneGuardKey, string> {
  return {
    laneRepeatCallStopAt: String(values.laneRepeatCallStopAt),
  };
}

/**
 * Lane guards (`agentOrchestration.laneRepeatCallStopAt`). Loads and saves
 * through `agent:getConfig` / `agent:setConfig`. Lanes have no tool-call
 * budget; only the repeat-call loop stop is configurable. An invalid value is
 * never written. A host rejection is shown
 * next to its field as the backend returned it; every save outcome (with Undo)
 * is reported in the page toast (`SettingsSaveFeedbackService.saveGeneric`).
 */
@Component({
  selector: 'ptah-lane-guards-settings',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, SurfaceSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-surface-section
      tone="subtle"
      padding="md"
      glassSurface="chrome"
      class="text-sm text-base-content"
      aria-labelledby="lane-guards-heading"
      data-testid="settings-section-lane-guards"
    >
      <div section-header class="mb-3 border-b border-base-content/10 pb-2">
        <h3 id="lane-guards-heading" class="text-base font-semibold text-base-content">
          Lane guards
        </h3>
        <p class="mt-0.5 text-xs text-base-content-muted">
          Stop background lanes that are stuck in a loop.
        </p>
      </div>

      @switch (load()) {
        @case ('loading') {
          <p role="status" aria-live="polite" data-testid="lane-guards-loading">
            Loading lane guards…
          </p>
        }
        @case ('error') {
          <div role="alert" class="space-y-1.5">
            <p data-testid="lane-guards-load-error">
              The lane guard settings could not be read. Your saved settings
              have not changed.
            </p>
            <button
              type="button"
              [class]="
                'btn btn-outline btn-sm border-base-content-muted text-base-content ' +
                focusRing
              "
              (click)="reload()"
              data-testid="lane-guards-retry"
            >
              Retry lane guards
            </button>
          </div>
        }
        @default {
          <p
            id="lane-guards-intro"
            class="text-xs text-base-content-muted"
            data-testid="lane-guards-intro"
          >
            Lanes have no tool-call limit. Ptah stops a lane only when it
            repeats the same call this many times, which means it is stuck in a
            loop. A stopped lane is still judged by the files it delivered.
          </p>
          <div class="grid max-w-sm gap-y-5">
            @for (field of fields; track field.key) {
              <div class="flex min-w-0 flex-col gap-1">
                <label [for]="field.testId" class="text-sm font-medium text-base-content">{{
                  field.label
                }}</label>
                <div class="join flex w-full">
                  <input
                    type="text"
                    inputmode="numeric"
                    [id]="field.testId"
                    [class]="
                      'input input-bordered input-sm join-item min-w-0 flex-1 text-right text-sm tabular-nums text-base-content ' +
                      (fieldMessage(field.key) ? 'input-error ' : '') +
                      focusRing
                    "
                    [value]="drafts()[field.key]"
                    [attr.aria-invalid]="
                      fieldMessage(field.key) ? 'true' : null
                    "
                    [attr.aria-describedby]="describedBy(field)"
                    [ptahBusyDisabled]="busy() || feedback.saving()"
                    (input)="edit(field.key, $event)"
                    (change)="commit(field.key)"
                    [attr.data-testid]="field.testId"
                  />
                  <span
                    class="btn btn-sm join-item shrink-0 cursor-default whitespace-nowrap border-base-content/10 px-3 text-xs font-normal text-base-content-muted"
                    aria-hidden="true"
                    >calls</span
                  >
                </div>
                <p
                  [id]="field.testId + '-help'"
                  class="text-xs text-base-content-muted"
                >
                  {{ field.help }} Range: {{ field.min }} or greater.
                </p>
                @if (fieldMessage(field.key); as message) {
                  <p
                    [id]="field.testId + '-error'"
                    role="alert"
                    [attr.data-testid]="field.testId + '-error'"
                  >
                    {{ message }}
                  </p>
                }
              </div>
            }
          </div>
        }
      }

    </ptah-surface-section>
  `,
})
export class LaneGuardsSettingsComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  protected readonly feedback = inject(SettingsSaveFeedbackService);

  protected readonly focusRing = FOCUS;
  protected readonly fields = LANE_GUARD_FIELDS;

  protected readonly load = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly drafts = signal<Record<LaneGuardKey, string>>({
    ...EMPTY_DRAFTS,
  });
  protected readonly busy = signal(false);
  private readonly saved = signal<LaneGuardValues>({ ...LANE_GUARD_DEFAULTS });
  /** Host rejection text, keyed by the field the host named or the one committed. */
  private readonly rejected = signal<Partial<Record<LaneGuardKey, string>>>({});

  protected readonly fieldErrors = computed(() => {
    const drafts = this.drafts();
    const errors: Partial<Record<LaneGuardKey, string>> = {};
    for (const field of LANE_GUARD_FIELDS) {
      const error = laneGuardFieldError(field.key, drafts);
      if (error) errors[field.key] = error;
    }
    return errors;
  });

  ngOnInit(): void {
    void this.reload();
  }

  protected fieldMessage(key: LaneGuardKey): string | null {
    return this.fieldErrors()[key] ?? this.rejected()[key] ?? null;
  }

  protected describedBy(field: (typeof LANE_GUARD_FIELDS)[number]): string {
    const help = `${field.testId}-help`;
    return this.fieldMessage(field.key)
      ? `${help} ${field.testId}-error`
      : help;
  }

  protected edit(key: LaneGuardKey, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({ ...drafts, [key]: value }));
    this.rejected.update((rejected) => {
      if (!rejected[key]) return rejected;
      const next = { ...rejected };
      delete next[key];
      return next;
    });
  }

  /**
   * Saves one committed field through the page toast with Undo (the previous values are known). A host rejection
   * stays next to the field it names; the toast carries the outcome.
   */
  protected async commit(key: LaneGuardKey): Promise<void> {
    const payload = laneGuardWrite(key, this.drafts(), this.saved());
    if (!payload || this.busy() || this.feedback.saving()) return;
    const label =
      LANE_GUARD_FIELDS.find((field) => field.key === key)?.label ??
      'Lane guard';
    const saved = this.saved();
    const previous: Partial<LaneGuardValues> = {};
    for (const written of Object.keys(payload) as LaneGuardKey[]) {
      previous[written] = saved[written];
    }
    this.busy.set(true);
    try {
      await this.feedback.saveGeneric({
        label,
        write: () => this.write(payload, key, label),
        undo: async () => {
          const result = await this.write(previous, key, label);
          if (result.ok) {
            this.drafts.update((drafts) => {
              const next = { ...drafts };
              for (const [field, value] of Object.entries(previous)) {
                next[field as LaneGuardKey] = String(value);
              }
              return next;
            });
          }
          return result;
        },
      });
    } finally {
      this.busy.set(false);
    }
  }

  /** One `agent:setConfig` write; a rejection is kept next to the field the host named, or the committed one. */
  private async write(
    payload: Partial<LaneGuardValues>,
    key: LaneGuardKey,
    label: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    this.rejected.update((rejected) => {
      const next = { ...rejected };
      for (const written of Object.keys(payload) as LaneGuardKey[]) {
        delete next[written];
      }
      return next;
    });
    const fallback = `Could not save ${label}. The saved setting is unchanged.`;
    try {
      const result = await this.rpc.call('agent:setConfig', payload, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (result.isSuccess() && result.data.success) {
        this.saved.update((saved) => ({ ...saved, ...payload }));
        return { ok: true };
      }
      const backend =
        (result.isSuccess() ? result.data.error : result.error) ?? fallback;
      const named = laneGuardKeyInError(backend) ?? key;
      this.rejected.update((rejected) => ({ ...rejected, [named]: backend }));
      return { ok: false, message: backend };
    } catch (error: unknown) {
      this.logger.warn('LaneGuardsSettings', 'agent:setConfig failed', error);
      this.rejected.update((rejected) => ({ ...rejected, [key]: fallback }));
      return { ok: false, message: fallback };
    }
  }

  protected async reload(): Promise<void> {
    this.load.set('loading');
    try {
      const result = await this.rpc.call('agent:getConfig', undefined, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (!result.isSuccess()) {
        this.load.set('error');
        return;
      }
      this.applyConfig(result.data);
      this.rejected.set({});
      this.load.set('ready');
    } catch (error: unknown) {
      this.logger.warn('LaneGuardsSettings', 'agent:getConfig failed', error);
      this.load.set('error');
    }
  }

  private applyConfig(config: AgentOrchestrationConfig): void {
    const values: LaneGuardValues = {
      laneRepeatCallStopAt: laneGuardFromConfig(
        'laneRepeatCallStopAt',
        config.laneRepeatCallStopAt,
      ),
    };
    this.saved.set(values);
    this.drafts.set(draftsFrom(values));
  }
}
