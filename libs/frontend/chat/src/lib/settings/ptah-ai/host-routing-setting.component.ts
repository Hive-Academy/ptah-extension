import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import {
  SettingsSaveFeedbackService,
  settingNotConfirmedMessage,
  settingNotSavedMessage,
} from '../feedback/settings-save-feedback.service';
import { parseDecisionModelStatus } from '../providers/decision-model-row.view';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const RPC_TIMEOUT_MS = 5_000;
const SETTING_KEY = 'agentOrchestration.hostRouting';
/** The visible label; the checkbox's `aria-label` is the same text. */
const LABEL = 'Routing suggestions';
/** The toast's field name ("Saved routing suggestions."). */
const TOAST_LABEL = 'routing suggestions';
const NOT_SAVED = `${settingNotSavedMessage(TOAST_LABEL)} The saved setting is unchanged.`;
const NOT_CONFIRMED = settingNotConfirmedMessage(TOAST_LABEL);

type WriteResult = { ok: true } | { ok: false; message: string };

/**
 * Routing suggestions (`agentOrchestration.hostRouting`, TASK_2026_857 Component 19). Electron only: the parent
 * mounts it under `isElectron`, because only the Electron host runs the routing coordinator.
 *
 * Reads `settings:get` (the stored flag; no stored value reads as the default `true`) and `agent:getConfig` (whether a
 * decision model is configured) in parallel. The setting is effective only with a decision model, so without one the
 * checkbox is unchecked and disabled with a note, and nothing is written; the stored value is left as it is.
 *
 * Writes go through `settings:set` and `SettingsSaveFeedbackService.saveGeneric` (toast + Undo); every write, and its
 * Undo, re-reads `settings:get`, so the checkbox only shows a value it read back. A failed read shows Retry and takes
 * no writes until a read succeeds.
 */
@Component({
  selector: 'ptah-host-routing-setting',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-col gap-3 text-sm text-base-content"
      aria-labelledby="host-routing-heading"
      data-testid="host-routing-setting"
    >
      <div class="border-b border-base-content/10 pb-2">
        <div class="flex items-center justify-between gap-3">
          <label
            id="host-routing-heading"
            for="host-routing-toggle"
            class="text-base font-semibold text-base-content"
            >{{ label }}</label
          >
          @if (load() === 'ready') {
            <input
              id="host-routing-toggle"
              type="checkbox"
              [class]="'toggle toggle-xs toggle-success ' + focusRing"
              [checked]="effective()"
              [disabled]="!modelConfigured()"
              [ptahBusyDisabled]="saving() || feedback.saving()"
              [attr.aria-label]="label"
              [attr.aria-describedby]="describedBy()"
              (change)="toggle($event)"
              data-testid="host-routing-toggle"
            />
          }
        </div>
        <p id="host-routing-help" class="mt-0.5 text-xs text-base-content-muted">
          Before planning, Ptah checks whether the engineering task is agreed
          and suggests a task type, depth and available executors. Uses one
          decision-model call per message.
        </p>
      </div>

      @switch (load()) {
        @case ('loading') {
          <p
            class="text-xs text-base-content-muted"
            role="status"
            aria-live="polite"
            data-testid="host-routing-loading"
          >
            Loading routing suggestions…
          </p>
        }
        @case ('error') {
          <div role="alert" class="space-y-1.5">
            <p data-testid="host-routing-load-error">
              The setting could not be read.
            </p>
            <button
              type="button"
              [class]="
                'btn btn-outline btn-sm border-base-content-muted text-base-content ' +
                focusRing
              "
              [ptahBusyDisabled]="saving()"
              (click)="reload()"
              data-testid="host-routing-retry"
            >
              Retry
            </button>
          </div>
        }
        @default {
          @if (!modelConfigured()) {
            <p
              id="host-routing-needs-model"
              class="text-xs text-base-content-muted"
              data-testid="host-routing-needs-model"
            >
              Off: set a decision model in Providers to use this.
            </p>
          }
        }
      }
    </section>
  `,
})
export class HostRoutingSettingComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  protected readonly feedback = inject(SettingsSaveFeedbackService);

  protected readonly focusRing = FOCUS;
  protected readonly label = LABEL;

  /** The stored flag as last read; `null` when it could not be read. */
  private readonly stored = signal<boolean | null>(null);
  /** Whether a decision model is configured, as last read; `null` when it could not be read. */
  protected readonly modelConfigured = signal<boolean | null>(null);
  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  /** True while this row's write or read runs. */
  protected readonly saving = signal(false);

  /** Routing runs only with a decision model and a stored value that is not `false`. */
  protected readonly effective = computed(
    () => this.modelConfigured() === true && this.stored() !== false,
  );
  protected readonly describedBy = computed(() =>
    this.modelConfigured() === false
      ? 'host-routing-help host-routing-needs-model'
      : 'host-routing-help',
  );

  ngOnInit(): void {
    void this.reload();
  }

  /** Reads the stored flag and the decision model together; either failing shows Retry. */
  protected async reload(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.load.set('loading');
    try {
      const [stored, model] = await Promise.all([
        this.readStored(),
        this.readModelConfigured(),
      ]);
      this.stored.set(stored);
      this.modelConfigured.set(model);
      this.load.set(stored !== null && model !== null ? 'ready' : 'error');
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const current = this.effective();
    // The checkbox keeps showing the read value; the read-back after the write moves it.
    input.checked = current;
    if (
      this.load() !== 'ready' ||
      this.modelConfigured() !== true ||
      this.stored() === null ||
      this.saving() ||
      this.feedback.saving()
    )
      return;
    const next = !current;
    this.saving.set(true);
    try {
      await this.feedback.saveGeneric({
        label: TOAST_LABEL,
        write: () => this.write(next),
        undo: () => this.write(current),
      });
    } finally {
      this.saving.set(false);
    }
  }

  /** One `settings:set` write, then a `settings:get` re-read whatever the outcome. */
  private async write(value: boolean): Promise<WriteResult> {
    let result: WriteResult;
    try {
      const response = await this.rpc.call(
        'settings:set',
        { key: SETTING_KEY, value },
        { timeout: RPC_TIMEOUT_MS },
      );
      // The RPC boundary is untrusted at runtime: only a literal `success: true` confirms the write.
      result =
        response.isSuccess() && response.data.success === true
          ? { ok: true }
          : { ok: false, message: NOT_SAVED };
    } catch (error: unknown) {
      // degradation-audit: reported - the toast names the unknown outcome and the re-read below shows the real value.
      this.logger.warn('HostRoutingSetting', 'settings:set failed', {
        errorType: errorTypeOf(error),
      });
      result = { ok: false, message: NOT_CONFIRMED };
    }
    const stored = await this.readStored();
    this.stored.set(stored);
    if (stored === null) {
      this.load.set('error');
      if (result.ok) return { ok: false, message: NOT_CONFIRMED };
    }
    return result;
  }

  /** The stored flag; no stored value is the default `true`. `null` when the read failed or held another type. */
  private async readStored(): Promise<boolean | null> {
    try {
      const response = await this.rpc.call(
        'settings:get',
        { key: SETTING_KEY },
        { timeout: RPC_TIMEOUT_MS },
      );
      if (!response.isSuccess() || response.data.success !== true) return null;
      const value = response.data.value;
      if (value === undefined || value === null) return true;
      return typeof value === 'boolean' ? value : null;
    } catch (error: unknown) {
      // degradation-audit: reported - a failed read shows the error row with Retry.
      this.logger.warn('HostRoutingSetting', 'settings:get failed', {
        errorType: errorTypeOf(error),
      });
      return null;
    }
  }

  /** Whether `agent:getConfig` names a decision model; `null` when it could not be read. */
  private async readModelConfigured(): Promise<boolean | null> {
    try {
      const response = await this.rpc.call('agent:getConfig', undefined, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (!response.isSuccess()) return null;
      const status = parseDecisionModelStatus(response.data.decisionModel);
      if (!status) return null;
      // `unset` + `unreachable` is the host's "selection not read" answer, not a real unset.
      if (status.selection.kind === 'unset')
        return status.state === 'unreachable' ? null : false;
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - a failed read shows the error row with Retry.
      this.logger.warn('HostRoutingSetting', 'agent:getConfig failed', {
        errorType: errorTypeOf(error),
      });
      return null;
    }
  }
}

/** A safe log classification: the constructor name, never the error's message, stack or fields. */
function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
