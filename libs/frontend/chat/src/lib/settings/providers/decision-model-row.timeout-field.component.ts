import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import {
  DECISION_MODEL_TIMEOUT_MAX_MS,
  DECISION_MODEL_TIMEOUT_MIN_MS,
  DECISION_MODEL_TIMEOUT_SETTING_KEY,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  DECISION_INPUT,
  DECISION_INPUT_INVALID,
  DECISION_LABEL,
} from './decision-model-key-field.component';

const RPC_TIMEOUT_MS = 5_000;
const MIN_SECONDS = DECISION_MODEL_TIMEOUT_MIN_MS / 1000;
const MAX_SECONDS = DECISION_MODEL_TIMEOUT_MAX_MS / 1000;
const SAVE_LABEL = 'decision request timeout';
const SAVE_FAILED =
  'Could not save the decision request timeout. The saved value is unchanged.';

/** A typed field value checked for saving: milliseconds, `null` to clear, or the inline error. */
export type DecisionTimeoutInput =
  | { readonly ok: true; readonly ms: number | null }
  | { readonly ok: false; readonly error: string };

/** Whole seconds from `MIN_SECONDS` to `MAX_SECONDS`; an empty field clears the setting (built-in default). */
export function parseDecisionTimeoutSeconds(text: string): DecisionTimeoutInput {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, ms: null };
  const seconds = Number(trimmed);
  if (
    !/^\d+$/.test(trimmed) ||
    seconds < MIN_SECONDS ||
    seconds > MAX_SECONDS
  ) {
    return {
      ok: false,
      error: `Not saved. Enter whole seconds from ${MIN_SECONDS} to ${MAX_SECONDS}, or leave it empty for the default.`,
    };
  }
  return { ok: true, ms: seconds * 1000 };
}

/**
 * The stored setting as field text: whole seconds, the same clamp the host applies on read. Empty when unset or not
 * a positive number (the host then uses its built-in timeout).
 */
export function decisionTimeoutText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return '';
  const ms = Math.min(
    DECISION_MODEL_TIMEOUT_MAX_MS,
    Math.max(DECISION_MODEL_TIMEOUT_MIN_MS, value),
  );
  return String(Math.round(ms / 1000));
}

/**
 * The decision-model request timeout field (`agentOrchestration.decisionModelTimeoutMs`). Unlike the selection it is
 * one global setting for every System One kind and both localities, so it reads with `settings:get` and saves on its
 * own with `settings:set` when the field is committed (Enter or leaving it), through the page toast with an Undo.
 * Shown in seconds, stored in milliseconds. An invalid value shows an inline hint and is never written.
 */
@Component({
  selector: 'ptah-decision-model-timeout-field',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block space-y-2' },
  template: `
    <label for="decision-model-timeout" [class]="labelClass"
      >Request timeout (seconds)</label
    >
    <input
      id="decision-model-timeout"
      type="text"
      inputmode="numeric"
      [class]="error() ? invalidInputClass : inputClass"
      autocomplete="off"
      spellcheck="false"
      placeholder="Default"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="describedBy()"
      [value]="text()"
      [disabled]="disabled() || busy() || !loaded()"
      (input)="onInput($event)"
      (change)="commit()"
      data-testid="decision-timeout"
    />
    <p
      id="decision-model-timeout-help"
      class="text-xs text-base-content-muted"
      data-testid="decision-timeout-help"
    >
      How long one decision request may take before routing falls back.
      Raise it for a slow model, such as one running on a CPU. Applies to
      every decision model except a structured-output model. Saves on its own
      when you press Enter or leave the field; empty uses the default.
    </p>
    @if (readFailed()) {
      <p
        role="alert"
        class="text-xs text-error"
        data-testid="decision-timeout-read-error"
      >
        Could not read the saved timeout, so the field is locked. Reopen
        settings to try again.
      </p>
    }
    @if (error(); as message) {
      <p
        id="decision-model-timeout-error"
        role="alert"
        class="text-xs text-error"
        data-testid="decision-timeout-error"
      >
        {{ message }}
      </p>
    }
  `,
})
export class DecisionModelTimeoutFieldComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  protected readonly labelClass = DECISION_LABEL;
  protected readonly inputClass = DECISION_INPUT;
  protected readonly invalidInputClass = DECISION_INPUT_INVALID;

  readonly disabled = input<boolean>(false);

  /** The field text: the read-back value until the user types. */
  protected readonly text = signal('');
  /** The last value the host confirmed, as field text. */
  private readonly saved = signal('');
  protected readonly loaded = signal(false);
  protected readonly readFailed = signal(false);
  protected readonly busy = this.feedback.saving;
  private readonly parsed = computed(() =>
    parseDecisionTimeoutSeconds(this.text()),
  );
  protected readonly error = computed(() => {
    const parsed = this.parsed();
    return parsed.ok ? null : parsed.error;
  });
  protected readonly describedBy = computed(() =>
    this.error()
      ? 'decision-model-timeout-help decision-model-timeout-error'
      : 'decision-model-timeout-help',
  );

  ngOnInit(): void {
    void this.read();
  }

  protected onInput(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.text.set(event.target.value);
  }

  /** Saves a valid, changed value. The Undo writes the previous read-back value. */
  protected async commit(): Promise<void> {
    const parsed = this.parsed();
    if (!parsed.ok || this.text().trim() === this.saved()) return;
    const previous = parseDecisionTimeoutSeconds(this.saved());
    await this.feedback.saveGeneric({
      label: SAVE_LABEL,
      write: () => this.write(parsed.ms),
      undo: previous.ok ? () => this.write(previous.ms) : null,
    });
  }

  /** Reads the stored value; a failed read leaves the field disabled and empty and says so (the host default applies). */
  private async read(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'settings:get',
        { key: DECISION_MODEL_TIMEOUT_SETTING_KEY },
        { timeout: RPC_TIMEOUT_MS },
      );
      if (!result.isSuccess() || result.data.success !== true) {
        this.readFailed.set(true);
        return;
      }
      const text = decisionTimeoutText(result.data.value);
      this.saved.set(text);
      this.text.set(text);
      this.loaded.set(true);
    } catch (error: unknown) {
      this.readFailed.set(true);
      this.logger.warn('DecisionModelTimeoutField', 'settings:get failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  }

  /** One `settings:set` write; a confirmed one moves the read-back value and the field. */
  private async write(
    ms: number | null,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const result = await this.rpc.call(
        'settings:set',
        { key: DECISION_MODEL_TIMEOUT_SETTING_KEY, value: ms },
        { timeout: RPC_TIMEOUT_MS },
      );
      if (!result.isSuccess() || result.data.success !== true)
        return { ok: false, message: SAVE_FAILED };
    } catch (error: unknown) {
      this.logger.warn('DecisionModelTimeoutField', 'settings:set failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      return { ok: false, message: SAVE_FAILED };
    }
    const text = decisionTimeoutText(ms);
    this.saved.set(text);
    this.text.set(text);
    return { ok: true };
  }
}
