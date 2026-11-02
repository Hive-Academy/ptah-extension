import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import {
  ADVANCED_SETTINGS,
  ADVANCED_SETTING_GROUPS,
  validateAdvancedSettingValue,
  type AdvancedNumberSetting,
  type AdvancedSetting,
  type AdvancedSettingApply,
  type AdvancedSettingGroupId,
  type AdvancedSettingValidation,
} from '@ptah-extension/shared';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
/**
 * A missing host response must reveal Retry instead of leaving the group busy. It bounds both the `rpcCall`
 * response wait and, through the group's own deadline, `rpcCall`'s untimed wait for the host to become ready.
 */
const SETTINGS_READ_TIMEOUT_MS = 5_000;
/** A missing write response must free the group (busy) and say the save is unconfirmed. */
const SETTINGS_WRITE_TIMEOUT_MS = 5_000;
/** The prefix `rpcCall` puts on the error of a request that got no response in time. */
const RPC_TIMEOUT_PREFIX = 'RPC timeout';
/** Plain digits with an optional sign and fraction, after `,` `_` and spaces are stripped. */
const NUMBER_TEXT = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

const APPLY_NOTES: Readonly<Record<AdvancedSettingApply, string>> = {
  live: 'Applies right away.',
  'next-run': 'Applies on the next cleanup run.',
  'next-agent': 'Applies to the next Codex agent you start.',
  restart: 'Restart Ptah to apply.',
};

/** Typed text as a number, then the shared bounds check (`validateAdvancedSettingValue`). */
function parseNumber(
  setting: AdvancedNumberSetting,
  raw: string,
): AdvancedSettingValidation {
  const text = raw.trim().replace(/[,_\s]/g, '');
  if (text === '') return { ok: false, error: 'Enter a value.' };
  if (!NUMBER_TEXT.test(text)) return { ok: false, error: 'Enter a number.' };
  return validateAdvancedSettingValue(setting, Number(text));
}

function formatValue(
  setting: AdvancedSetting,
  value: number | boolean,
): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  const unit =
    setting.kind === 'number' && setting.unit ? ` ${setting.unit}` : '';
  return `${NUMBER_FORMAT.format(value)}${unit}`;
}

/**
 * One group of advanced file-based settings (`~/.ptah/settings.json`, TASK_2026_658), rendered from the shared
 * `ADVANCED_SETTINGS` table. Reads each key with `settings:get` and writes with `settings:set`, like the session
 * budget card (session-budget-settings.component.ts), whose behaviour and copy it follows. A number field keeps what
 * the user typed until it is saved; an invalid value is never written. A toggle shows only the read-back value.
 */
@Component({
  selector: 'ptah-advanced-settings-group',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (group(); as group) {
      <section
        [attr.data-glass-surface]="contentSurface() ? 'content' : null"
        class="flex flex-col gap-3 border-b border-base-content/10 pb-7 text-sm text-base-content"
        [attr.aria-labelledby]="idPrefix() + '-heading'"
        [attr.data-testid]="'settings-section-' + group.id"
      >
        <div section-header class="mb-3">
          <h3
            [id]="idPrefix() + '-heading'"
            class="text-xs font-bold uppercase tracking-wider text-base-content"
          >
            {{ group.title }}
          </h3>
          <p class="mt-0.5 text-xs text-base-content-muted">
            {{ group.description }}
          </p>
        </div>

        @switch (load()) {
          @case ('loading') {
            <p
              role="status"
              aria-live="polite"
              [attr.data-testid]="idPrefix() + '-loading'"
            >
              Loading {{ group.title }}…
            </p>
          }
          @case ('error') {
            <div role="alert" class="space-y-1.5">
              <p [attr.data-testid]="idPrefix() + '-load-error'">
                The {{ group.title }} settings could not be read. Your saved
                settings have not changed.
              </p>
              <button
                type="button"
                [class]="
                  'btn btn-outline btn-sm border-base-content-muted text-base-content ' +
                  focusRing
                "
                (click)="reload()"
                [attr.data-testid]="idPrefix() + '-retry'"
              >
                Retry {{ group.title }}
              </button>
            </div>
          }
          @default {
            <div class="grid items-start gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              @for (setting of settings(); track setting.key) {
                <div
                  class="flex min-w-0 flex-col gap-1"
                  [attr.data-testid]="
                    'advanced-setting-' + setting.key + '-field'
                  "
                >
                  @if (setting.kind === 'boolean') {
                    <span class="flex items-center gap-1.5 text-sm font-medium text-base-content"
                      >{{ setting.label }}
                      @if (setting.apply === 'restart') {
                        <span [class]="restartBadge" aria-hidden="true"
                          >Restart</span
                        >
                      }
                    </span>
                    <label
                      class="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-base-content/10 px-2"
                    >
                      <input
                        type="checkbox"
                        [id]="'advanced-setting-' + setting.key"
                        [class]="'toggle toggle-sm toggle-primary ' + focusRing"
                        [checked]="booleanValue(setting)"
                        [ptahBusyDisabled]="busy()"
                        (change)="toggle(setting, $event)"
                        [attr.aria-label]="setting.label"
                        [attr.aria-invalid]="
                          errors()[setting.key] ? 'true' : null
                        "
                        [attr.aria-describedby]="describedBy(setting)"
                        [attr.data-testid]="'advanced-setting-' + setting.key"
                      />
                      <span
                        class="text-sm"
                        [attr.data-testid]="
                          'advanced-setting-' + setting.key + '-state'
                        "
                        >{{
                          booleanValue(setting) ? 'Enabled' : 'Disabled'
                        }}</span
                      >
                    </label>
                  } @else {
                    <label
                      [for]="'advanced-setting-' + setting.key"
                      class="flex items-center gap-1.5 text-sm font-medium text-base-content"
                      >{{ setting.label }}
                      @if (setting.apply === 'restart') {
                        <span [class]="restartBadge" aria-hidden="true"
                          >Restart</span
                        >
                      }
                    </label>
                    <div class="join flex w-full">
                      <input
                        type="text"
                        [id]="'advanced-setting-' + setting.key"
                        [attr.inputmode]="
                          setting.integer ? 'numeric' : 'decimal'
                        "
                        [class]="
                          'input input-bordered input-sm join-item min-w-0 flex-1 text-right text-sm tabular-nums text-base-content ' +
                          (errors()[setting.key] ? errorBorder + ' ' : '') +
                          focusRing
                        "
                        [value]="numberText(setting)"
                        [attr.aria-invalid]="
                          errors()[setting.key] ? 'true' : null
                        "
                        [attr.aria-describedby]="describedBy(setting)"
                        [ptahBusyDisabled]="busy()"
                        (input)="edit(setting, $event)"
                        (change)="commit(setting)"
                        (blur)="blurred(setting)"
                        [attr.data-testid]="'advanced-setting-' + setting.key"
                      />
                      @if (setting.unit) {
                        <span
                          class="btn btn-sm join-item shrink-0 cursor-default whitespace-nowrap border-base-content/10 px-3 text-xs font-normal text-base-content-muted"
                          aria-hidden="true"
                          >{{ setting.unit }}</span
                        >
                      }
                    </div>
                  }
                  <p
                    [id]="'advanced-setting-' + setting.key + '-help'"
                    class="text-xs text-base-content-muted"
                  >
                    {{ helpText(setting) }}
                  </p>
                  @if (errors()[setting.key]; as message) {
                    <p
                      role="alert"
                      [id]="'advanced-setting-' + setting.key + '-error'"
                      class="text-error"
                      [attr.data-testid]="
                        'advanced-setting-' + setting.key + '-error'
                      "
                    >
                      {{ message }}
                    </p>
                  }
                  @if (storedNotice(setting); as notice) {
                    <p
                      [id]="'advanced-setting-' + setting.key + '-stored'"
                      class="rounded-md border border-info/30 bg-info/10 px-2 py-1"
                      [attr.data-testid]="
                        'advanced-setting-' + setting.key + '-stored'
                      "
                    >
                      {{ notice }}
                    </p>
                  }
                </div>
              }
            </div>
          }
        }
      </section>
    }
  `,
  styles: `
    :host-context([data-glass='on']) [data-glass-surface='content'] {
      padding: 1.25rem;
    }
  `,
})
export class AdvancedSettingsGroupComponent implements OnInit {
  readonly contentSurface = input(true);
  private readonly vscode = inject(VSCodeService);
  /** The page toast: every write's outcome (with Undo after a save) is said there. */
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly groupId = input.required<AdvancedSettingGroupId>();

  protected readonly focusRing = FOCUS;
  /**
   * The anubis-light `.input` rule in styles.css sets the border at (0,2,0), which beats daisyUI's `input-error`,
   * so the error border is forced. It uses the measured `--ptah-error-ink` and falls back to the theme's error.
   */
  protected readonly errorBorder =
    'input-error !border-[color:var(--ptah-error-ink,oklch(var(--er)))]';
  protected readonly restartBadge =
    'badge badge-outline badge-sm whitespace-nowrap border-info/30 bg-info/10 text-xs font-medium text-base-content';

  protected readonly group = computed(() =>
    ADVANCED_SETTING_GROUPS.find((group) => group.id === this.groupId()),
  );
  protected readonly settings = computed(() =>
    ADVANCED_SETTINGS.filter((setting) => setting.group === this.groupId()),
  );
  protected readonly idPrefix = computed(
    () => `advanced-group-${this.groupId()}`,
  );

  protected readonly load = signal<'loading' | 'error' | 'ready'>('loading');
  /** Read-back values by key, as stored (possibly invalid when the file was edited by hand). */
  private readonly saved = signal<Readonly<Record<string, unknown>>>({});
  /** What the user typed into a number field and has not saved yet. */
  private readonly drafts = signal<Readonly<Record<string, string>>>({});
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  /** The key whose write is in flight; every control in the group is busy meanwhile. */
  private readonly savingKey = signal<string | null>(null);
  protected readonly busy = computed(
    () => this.savingKey() !== null || this.feedback.saving(),
  );
  /** The deadline timer of the read in flight; cleared when the read settles or the group is destroyed. */
  private readDeadline: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.readDeadline));
  }

  ngOnInit(): void {
    void this.reload();
  }

  /**
   * Reads every key of the group in parallel; any failed read, or no answer within the group's own deadline
   * (`rpcCall` starts its timeout only once the host is ready), shows the load error with Retry.
   */
  async reload(): Promise<void> {
    this.load.set('loading');
    const settings = this.settings();
    const reads = Promise.all(
      settings.map((setting) =>
        rpcCall<{ success: boolean; value?: unknown }>(
          this.vscode,
          'settings:get',
          { key: setting.key },
          SETTINGS_READ_TIMEOUT_MS,
        ).catch(() => null),
      ),
    );
    clearTimeout(this.readDeadline);
    const deadline = new Promise<null>((resolve) => {
      this.readDeadline = setTimeout(
        () => resolve(null),
        SETTINGS_READ_TIMEOUT_MS,
      );
    });
    const results = await Promise.race([reads, deadline]);
    clearTimeout(this.readDeadline);
    if (
      results === null ||
      results.some(
        (result) => result === null || !result.success || !result.data?.success,
      )
    ) {
      this.load.set('error');
      return;
    }
    this.saved.set(
      Object.fromEntries(
        settings.map((setting, index) => [
          setting.key,
          results[index]?.data?.value,
        ]),
      ),
    );
    this.drafts.set({});
    this.errors.set({});
    this.load.set('ready');
  }

  protected booleanValue(setting: AdvancedSetting): boolean {
    const value = this.saved()[setting.key];
    return typeof value === 'boolean' ? value : setting.default === true;
  }

  protected numberText(setting: AdvancedNumberSetting): string {
    const draft = this.drafts()[setting.key];
    if (draft !== undefined) return draft;
    const value = this.saved()[setting.key];
    return typeof value === 'number' ? String(value) : '';
  }

  /** Descriptor help, then the range (numbers) and when a saved value takes effect. */
  protected helpText(setting: AdvancedSetting): string {
    const range =
      setting.kind === 'number'
        ? ` Range: ${NUMBER_FORMAT.format(setting.min)} to ${NUMBER_FORMAT.format(setting.max)}${setting.unit ? ` ${setting.unit}` : ''}.`
        : '';
    return `${setting.help}${range} ${APPLY_NOTES[setting.apply]}`;
  }

  protected describedBy(setting: AdvancedSetting): string {
    const id = `advanced-setting-${setting.key}`;
    return [
      `${id}-help`,
      this.errors()[setting.key] ? `${id}-error` : null,
      this.storedNotice(setting) ? `${id}-stored` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' ');
  }

  /**
   * A stored value the shared validator refuses (hand-edited file) is flagged. The copy does not say which value
   * applies instead: clamped consumers (memory retention / lifecycle) use the nearest bound, others the default.
   */
  protected storedNotice(setting: AdvancedSetting): string | null {
    const value = this.saved()[setting.key];
    if (value === undefined || validateAdvancedSettingValue(setting, value).ok)
      return null;
    return `The saved value is not valid. Save a new value to replace it. Default: ${formatValue(setting, setting.default)}.`;
  }

  protected edit(setting: AdvancedNumberSetting, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({ ...drafts, [setting.key]: text }));
    const parsed = parseNumber(setting, text);
    this.setError(setting.key, parsed.ok ? null : parsed.error);
  }

  /** Leaving a field commits a pending draft that `change` did not (e.g. after an unconfirmed save). */
  protected blurred(setting: AdvancedNumberSetting): void {
    if (this.drafts()[setting.key] !== undefined) void this.commit(setting);
  }

  /** On commit (blur / Enter): a valid, changed value is written; an invalid one stays on screen with its message. */
  async commit(setting: AdvancedNumberSetting): Promise<void> {
    const text = this.drafts()[setting.key];
    if (text === undefined || this.busy()) return;
    const parsed = parseNumber(setting, text);
    this.setError(setting.key, parsed.ok ? null : parsed.error);
    if (!parsed.ok) return;
    if (parsed.value === this.saved()[setting.key]) {
      this.clearDraft(setting.key);
      return;
    }
    if (await this.write(setting, parsed.value)) this.clearDraft(setting.key);
  }

  async toggle(setting: AdvancedSetting, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const next = box.checked;
    // The box keeps showing the saved value; the successful write moves it.
    box.checked = this.booleanValue(setting);
    if (this.busy() || next === this.booleanValue(setting)) return;
    await this.write(setting, next);
  }

  /**
   * Writes one key through the page toast (`saveGeneric`); true when the host confirmed the write. The toast says
   * "Saved {label}." with an Undo to the previous read-back value, or the failure; the saved value stays shown.
   */
  private async write(
    setting: AdvancedSetting,
    value: number | boolean,
  ): Promise<boolean> {
    const { key, label } = setting;
    const previous = this.saved()[key];
    this.savingKey.set(key);
    this.setError(key, null);
    try {
      const result = await this.feedback.saveGeneric({
        label,
        write: () => this.send(setting, value),
        // An unreadable or hand-edited previous value cannot be written back.
        undo:
          typeof previous === typeof value
            ? () => this.send(setting, previous as number | boolean)
            : null,
      });
      return result === 'saved';
    } finally {
      this.savingKey.set(null);
    }
  }

  /** One `settings:set` write; a confirmed one moves the read-back value. */
  private async send(
    setting: AdvancedSetting,
    value: number | boolean,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { key, label } = setting;
    let confirmed = false;
    let timedOut = false;
    try {
      const result = await rpcCall<{ success: boolean }>(
        this.vscode,
        'settings:set',
        { key, value },
        SETTINGS_WRITE_TIMEOUT_MS,
      );
      confirmed = result.success && result.data?.success === true;
      timedOut =
        !result.success &&
        (result.error?.startsWith(RPC_TIMEOUT_PREFIX) ?? false);
    } catch {
      // degradation-audit: reported - a transport failure is said in the toast like a refused write.
    }
    if (confirmed) {
      this.saved.update((saved) => ({ ...saved, [key]: value }));
      return { ok: true };
    }
    // A timed-out write may still land on the host, so it cannot claim the setting is unchanged. Host error text
    // is never shown (it may carry paths or secrets); the client validator already refused out-of-range values.
    const message = timedOut
      ? `Could not confirm saving ${label}. Reopen settings to see the saved value.`
      : `Could not save ${label}. The saved setting is unchanged.`;
    // The field keeps the same fixed message: its typed value stays and is not the saved one (the toast times out).
    this.setError(key, message);
    return { ok: false, message };
  }

  private clearDraft(key: string): void {
    this.drafts.update((drafts) => {
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  }

  private setError(key: string, message: string | null): void {
    this.errors.update((errors) => {
      const next = { ...errors };
      if (message === null) delete next[key];
      else next[key] = message;
      return next;
    });
  }
}
