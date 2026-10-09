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
import { SurfaceSectionComponent } from '@ptah-extension/ui';
import {
  LANE_GUARD_DEFAULTS,
  LANE_GUARD_FIELDS,
  laneGuardFieldError,
  laneGuardFromConfig,
  laneGuardKeyInError,
  laneGuardPairError,
  laneGuardWrite,
  type LaneGuardKey,
  type LaneGuardValues,
} from './lane-guards-settings.logic';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const RPC_TIMEOUT_MS = 5_000;

const EMPTY_DRAFTS: Record<LaneGuardKey, string> = {
  laneToolCallSteerAt: '',
  laneToolCallStopAt: '',
  laneRepeatCallStopAt: '',
};

function draftsFrom(values: LaneGuardValues): Record<LaneGuardKey, string> {
  return {
    laneToolCallSteerAt: String(values.laneToolCallSteerAt),
    laneToolCallStopAt: String(values.laneToolCallStopAt),
    laneRepeatCallStopAt: String(values.laneRepeatCallStopAt),
  };
}

/**
 * Lane guards (`agentOrchestration.laneToolCall*`). Loads and saves through
 * `agent:getConfig` / `agent:setConfig`. An invalid value, including a stop
 * that is not greater than steer, is never written. A host rejection is shown
 * as the backend returned it.
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
      class="text-xs text-base-content"
      aria-labelledby="lane-guards-heading"
      data-testid="settings-section-lane-guards"
    >
      <div section-header>
        <h3 id="lane-guards-heading" class="font-bold uppercase tracking-wide">
          Lane guards
        </h3>
        <p class="mt-0.5 text-[11px] text-base-content-muted">
          Keep background lanes from spending too long on tool calls.
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
                'btn btn-outline btn-xs min-h-7 border-base-content-muted text-base-content ' +
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
            class="text-[11px] text-base-content-muted"
            data-testid="lane-guards-intro"
          >
            At Steer at, the lane is asked to wrap up. At Stop at, it is
            stopped. Some CLIs, for example grok and Ptah CLI providers, cannot
            receive the mid-turn steer, so they run until the stop value.
            Repeat-call stop at stops a lane that repeats the same call that
            many times.
          </p>
          <div class="grid auto-rows-fr gap-4 md:grid-cols-3">
            @for (field of fields; track field.key) {
              <div class="flex min-w-0 flex-col gap-1">
                <label [for]="field.testId" class="font-bold">{{
                  field.label
                }}</label>
                <div class="join flex w-full">
                  <input
                    type="text"
                    inputmode="numeric"
                    [id]="field.testId"
                    [class]="
                      'input input-bordered input-sm join-item h-8 min-h-8 min-w-0 flex-1 text-right text-xs tabular-nums text-base-content ' +
                      (fieldMessage(field.key) ? 'input-error ' : '') +
                      focusRing
                    "
                    [value]="drafts()[field.key]"
                    [attr.aria-invalid]="
                      fieldMessage(field.key) ? 'true' : null
                    "
                    [attr.aria-describedby]="describedBy(field)"
                    [ptahBusyDisabled]="busy()"
                    (input)="edit(field.key, $event)"
                    (change)="commit(field.key)"
                    [attr.data-testid]="field.testId"
                  />
                  <span
                    class="btn btn-sm join-item h-8 min-h-8 shrink-0 cursor-default whitespace-nowrap border-base-content/10 px-2 text-[11px] font-normal text-base-content-muted"
                    aria-hidden="true"
                    >calls</span
                  >
                </div>
                <p
                  [id]="field.testId + '-help'"
                  class="text-[11px] text-base-content-muted"
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

      <p
        role="status"
        aria-live="polite"
        class="min-h-4 text-base-content-muted"
        data-testid="lane-guards-status"
      >
        {{ status() }}
      </p>
    </ptah-surface-section>
  `,
})
export class LaneGuardsSettingsComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);

  protected readonly focusRing = FOCUS;
  protected readonly fields = LANE_GUARD_FIELDS;

  protected readonly load = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly drafts = signal<Record<LaneGuardKey, string>>({
    ...EMPTY_DRAFTS,
  });
  protected readonly busy = signal(false);
  protected readonly status = signal('');
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
    this.status.set('');
  }

  protected async commit(key: LaneGuardKey): Promise<void> {
    const payload = laneGuardWrite(key, this.drafts(), this.saved());
    if (!payload || this.busy()) return;
    const label =
      LANE_GUARD_FIELDS.find((field) => field.key === key)?.label ??
      'Lane guard';
    this.busy.set(true);
    this.status.set('Saving…');
    this.rejected.update((rejected) => {
      const next = { ...rejected };
      for (const written of Object.keys(payload) as LaneGuardKey[]) {
        delete next[written];
      }
      return next;
    });
    try {
      const result = await this.rpc.call('agent:setConfig', payload, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (result.isSuccess() && result.data.success) {
        this.saved.update((saved) => ({ ...saved, ...payload }));
        this.status.set(`Saved ${label}.`);
        return;
      }
      const backend =
        (result.isSuccess() ? result.data.error : result.error) ??
        `Could not save ${label}. The saved setting is unchanged.`;
      const named = laneGuardKeyInError(backend) ?? key;
      this.rejected.update((rejected) => ({ ...rejected, [named]: backend }));
      this.status.set(backend);
    } catch (error: unknown) {
      this.logger.warn('LaneGuardsSettings', 'agent:setConfig failed', error);
      const message = `Could not save ${label}. The saved setting is unchanged.`;
      this.rejected.update((rejected) => ({ ...rejected, [key]: message }));
      this.status.set(message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async reload(): Promise<void> {
    this.load.set('loading');
    this.status.set('');
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
    const steer = laneGuardFromConfig(
      'laneToolCallSteerAt',
      config.laneToolCallSteerAt,
    );
    const stop = laneGuardFromConfig(
      'laneToolCallStopAt',
      config.laneToolCallStopAt,
    );
    const repeat = laneGuardFromConfig(
      'laneRepeatCallStopAt',
      config.laneRepeatCallStopAt,
    );
    const pairBroken = laneGuardPairError(steer, stop) !== null;
    const values: LaneGuardValues = {
      laneToolCallSteerAt: pairBroken
        ? LANE_GUARD_DEFAULTS.laneToolCallSteerAt
        : steer,
      laneToolCallStopAt: pairBroken
        ? LANE_GUARD_DEFAULTS.laneToolCallStopAt
        : stop,
      laneRepeatCallStopAt: repeat,
    };
    this.saved.set(values);
    this.drafts.set(draftsFrom(values));
  }
}
