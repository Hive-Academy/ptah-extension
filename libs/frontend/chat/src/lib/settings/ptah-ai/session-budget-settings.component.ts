import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SESSION_BUDGET_SETTINGS,
  isSessionBudgetPercentOrderValid,
  type SessionBudgetConfig,
  type SessionBudgetNumberSetting,
  type SessionBudgetUnit,
} from '@ptah-extension/shared';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { SurfaceSectionComponent } from '@ptah-extension/ui';

type BudgetKey = keyof SessionBudgetConfig;
type NumberKey =
  | 'tokens'
  | 'usd'
  | 'fallbackWeightedTokens'
  | 'tightenPercent'
  | 'handoffPercent'
  | 'handoffAfterCompactions'
  | 'tightenWindowTokens';
type BooleanKey = 'enabled' | 'blockAtLimit';

type Parsed =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: string };

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const BUDGET_KEYS = Object.keys(SESSION_BUDGET_SETTINGS) as BudgetKey[];
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
/** A missing host response must reveal Retry instead of leaving the settings card busy. */
const SETTINGS_READ_TIMEOUT_MS = 5_000;
/** A missing write response must free the card (busy) and say the save is unconfirmed. */
const SETTINGS_WRITE_TIMEOUT_MS = 5_000;
/** The prefix `rpcCall` puts on the error of a request that got no response in time. */
const RPC_TIMEOUT_PREFIX = 'RPC timeout';
const UNIT_LABELS: Readonly<Record<SessionBudgetUnit, string>> = {
  tokens: 'Tokens',
  cost: 'Cost (USD)',
};

interface NumberField {
  readonly key: NumberKey;
  readonly label: string;
  readonly help: string;
}

const NUMBER_FIELDS: readonly NumberField[] = [
  {
    key: 'tokens',
    label: 'Token budget',
    help: 'Chat token limit.',
  },
  {
    key: 'usd',
    label: 'Cost budget (USD)',
    help: 'Session cost limit.',
  },
  {
    key: 'fallbackWeightedTokens',
    label: 'Fallback weighted tokens',
    help: 'Used when model pricing is unavailable.',
  },
  {
    key: 'tightenPercent',
    label: 'Tighten at (%)',
    help: 'Starts tightening; stays below Handoff.',
  },
  {
    key: 'handoffPercent',
    label: 'Handoff at (%)',
    help: 'Suggests a new session.',
  },
  {
    key: 'handoffAfterCompactions',
    label: 'Handoff after compactions',
    help: 'Suggests a handoff after this many compactions.',
  },
  {
    key: 'tightenWindowTokens',
    label: 'Tighten auto-compact window (tokens)',
    help: 'Advisory only until set; then lowers the compact window.',
  },
];

const BOOLEAN_LABELS: Readonly<Record<BooleanKey, string>> = {
  enabled: 'Track a budget for each chat session',
  blockAtLimit: 'Pause sending at 100% until you choose what to do',
};

const LABELS: Readonly<Record<BudgetKey, string>> = {
  ...BOOLEAN_LABELS,
  unit: 'Budget unit',
  ...(Object.fromEntries(
    NUMBER_FIELDS.map((field) => [field.key, field.label]),
  ) as Record<NumberKey, string>),
};

/** Bound check against the shared table (`SESSION_BUDGET_SETTINGS`); the cross-field rule is applied by the card. */
function parseNumber(setting: SessionBudgetNumberSetting, raw: string): Parsed {
  const text = raw.trim().replace(/[,_\s]/g, '');
  if (text === '') {
    return setting.nullable
      ? { ok: true, value: null }
      : { ok: false, error: 'Enter a value.' };
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, error: 'Enter a number.' };
  }
  const value = Number(text);
  if (setting.integer && !Number.isInteger(value)) {
    return { ok: false, error: 'Enter a whole number.' };
  }
  if (value < setting.min || value > setting.max) {
    return {
      ok: false,
      error: `Enter a value from ${NUMBER_FORMAT.format(setting.min)} to ${NUMBER_FORMAT.format(setting.max)}.`,
    };
  }
  return { ok: true, value };
}

/** A read-back value as the backend reader takes it: a stored value that breaks the bounds reads as the default. */
function storedNumberIsValid(
  setting: SessionBudgetNumberSetting,
  value: unknown,
): boolean {
  if (value === null) return setting.nullable;
  return (
    typeof value === 'number' && parseNumber(setting, String(value)).ok === true
  );
}

/**
 * Session budget (`sessionBudget.*`, TASK_2026_597 N7). Reads and writes each key through `settings:get` / `settings:set`
 * (file-based, `~/.ptah/settings.json`), validating inline against `SESSION_BUDGET_SETTINGS` and the shared
 * tighten < handoff rule. An invalid value is never written. Toggles and the unit select show only the read-back
 * value; a number field keeps what the user typed until it is saved.
 */
@Component({
  selector: 'ptah-session-budget-settings',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, SurfaceSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-surface-section
      tone="subtle"
      padding="md"
      class="text-xs text-base-content"
      aria-labelledby="session-budget-heading"
      data-testid="settings-section-session-budget"
    >
      <div section-header>
        <h3
          id="session-budget-heading"
          class="font-bold uppercase tracking-wide"
        >
          Session budget
        </h3>
        <p class="mt-0.5 text-[11px] text-base-content-muted">
          Set per-chat limits and when Ptah should intervene.
        </p>
      </div>

      @switch (load()) {
        @case ('loading') {
          <p
            role="status"
            aria-live="polite"
            data-testid="session-budget-loading"
          >
            Loading session budget…
          </p>
        }
        @case ('error') {
          <div role="alert" class="space-y-1.5">
            <p data-testid="session-budget-load-error">
              The session budget settings could not be read. Your saved settings
              have not changed.
            </p>
            <button
              type="button"
              [class]="
                'btn btn-outline btn-xs min-h-7 border-base-content-muted text-base-content ' +
                focusRing
              "
              (click)="reload()"
              data-testid="session-budget-retry"
            >
              Retry session budget
            </button>
          </div>
        }
        @default {
          <div class="grid auto-rows-fr gap-4 md:grid-cols-3">
            @for (key of booleanKeys; track key) {
              <div class="flex min-w-0 flex-col gap-1">
                <span class="font-bold">{{ labels[key] }}</span>
                <label
                  class="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-base-content/10 px-2"
                >
                  <input
                    type="checkbox"
                    [class]="'toggle toggle-sm toggle-primary ' + focusRing"
                    [checked]="booleanValue(key)"
                    [ptahBusyDisabled]="busy()"
                    (change)="toggle(key, $event)"
                    [attr.aria-label]="labels[key]"
                    [attr.data-testid]="'session-budget-' + key"
                  />
                  <span>Enabled</span>
                </label>
                <p class="text-[11px] text-base-content-muted">
                  Enable this limit for the current chat.
                </p>
              </div>
            }

            <div class="flex min-w-0 flex-col gap-1">
              <label for="session-budget-unit" class="font-bold">{{
                labels.unit
              }}</label>
              <select
                id="session-budget-unit"
                [class]="
                  'select select-bordered select-sm h-8 min-h-8 w-full text-xs ' +
                  focusRing
                "
                [value]="unitValue()"
                [ptahBusyDisabled]="busy()"
                aria-describedby="session-budget-unit-help"
                (change)="selectUnit($event)"
                data-testid="session-budget-unit"
              >
                @for (unit of units; track unit) {
                  <option [value]="unit" [selected]="unit === unitValue()">
                    {{ unitLabels[unit] }}
                  </option>
                }
              </select>
              <p
                id="session-budget-unit-help"
                class="text-[11px] text-base-content-muted"
              >
                Tokens use chat usage; Cost uses priced models.
              </p>
              @if (errors()['unit']; as message) {
                <p data-testid="session-budget-unit-error">{{ message }}</p>
              }
            </div>

            @for (field of numberFields; track field.key) {
              <div class="flex min-w-0 flex-col gap-1">
                <label
                  [for]="'session-budget-' + field.key"
                  class="font-bold"
                  >{{ field.label }}</label
                >
                <div class="join flex w-full">
                  <input
                    type="text"
                    [id]="'session-budget-' + field.key"
                    [attr.inputmode]="
                      settings[field.key].integer ? 'numeric' : 'decimal'
                    "
                    [class]="
                      'input input-bordered input-sm join-item h-8 min-h-8 min-w-0 flex-1 text-right text-xs tabular-nums text-base-content ' +
                      (errors()[field.key] ? 'input-error ' : '') +
                      focusRing
                    "
                    [value]="numberText(field.key)"
                    [attr.placeholder]="
                      settings[field.key].nullable ? 'Advisory only' : null
                    "
                    [attr.aria-invalid]="errors()[field.key] ? 'true' : null"
                    [attr.aria-describedby]="
                      'session-budget-' +
                      field.key +
                      '-help' +
                      (errors()[field.key]
                        ? ' session-budget-' + field.key + '-error'
                        : '') +
                      (storedNotice(field.key)
                        ? ' session-budget-' + field.key + '-stored'
                        : '')
                    "
                    [ptahBusyDisabled]="busy()"
                    (input)="edit(field.key, $event)"
                    (change)="commit(field.key)"
                    (focus)="focusedKey = field.key"
                    (blur)="blurred(field.key)"
                    [attr.data-testid]="'session-budget-' + field.key"
                  />
                  <span
                    class="btn btn-sm join-item h-8 min-h-8 shrink-0 cursor-default whitespace-nowrap border-base-content/10 px-2 text-[11px] font-normal text-base-content-muted"
                    aria-hidden="true"
                    >{{ unitSuffix(field.key) }}</span
                  >
                </div>
                @if (humanReadable(field.key); as readable) {
                  <span
                    class="whitespace-nowrap text-[11px] text-base-content-muted"
                    >{{ readable }}</span
                  >
                }
                <p
                  [id]="'session-budget-' + field.key + '-help'"
                  class="text-[11px] text-base-content-muted"
                >
                  {{ field.help }} Range: {{ range(field.key) }}.
                </p>
                @if (errors()[field.key]; as message) {
                  <p
                    [id]="'session-budget-' + field.key + '-error'"
                    [attr.data-testid]="
                      'session-budget-' + field.key + '-error'
                    "
                  >
                    {{ message }}
                  </p>
                }
                @if (storedNotice(field.key); as notice) {
                  <p
                    [id]="'session-budget-' + field.key + '-stored'"
                    class="rounded-md border border-info/30 bg-info/10 px-2 py-1"
                    [attr.data-testid]="
                      'session-budget-' + field.key + '-stored'
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

      <p
        role="status"
        aria-live="polite"
        class="min-h-4 text-base-content-muted"
        data-testid="session-budget-status"
      >
        {{ status() }}
      </p>
    </ptah-surface-section>
  `,
})
export class SessionBudgetSettingsComponent implements OnInit {
  private readonly vscode = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);

  protected readonly focusRing = FOCUS;
  protected readonly settings = SESSION_BUDGET_SETTINGS;
  protected readonly labels = LABELS;
  protected readonly numberFields = NUMBER_FIELDS;
  protected readonly booleanKeys: readonly BooleanKey[] = [
    'enabled',
    'blockAtLimit',
  ];
  protected readonly units = SESSION_BUDGET_SETTINGS.unit.values;
  protected readonly unitLabels = UNIT_LABELS;

  protected readonly load = signal<'loading' | 'error' | 'ready'>('loading');
  /** Read-back values by field, as stored (possibly out of bounds when the file was edited by hand). */
  private readonly saved = signal<Partial<Record<BudgetKey, unknown>>>({});
  /** What the user typed into a number field and has not saved yet. */
  private readonly drafts = signal<Partial<Record<NumberKey, string>>>({});
  protected readonly errors = signal<Partial<Record<BudgetKey, string>>>({});
  /** The field whose write is in flight; every control is busy meanwhile (the percent pair depends on each other). */
  private readonly savingKey = signal<BudgetKey | null>(null);
  protected readonly busy = computed(() => this.savingKey() !== null);
  protected readonly status = signal('');
  /** The number field that has focus: its draft is still being typed, so a partner save must not commit it. */
  protected focusedKey: NumberKey | null = null;

  protected readonly unitValue = computed<SessionBudgetUnit>(() => {
    const value = this.saved()['unit'];
    return (
      this.units.find((unit) => unit === value) ?? this.settings.unit.default
    );
  });

  ngOnInit(): void {
    void this.reload();
  }

  /** Reads all ten keys; any failed read shows the load error with Retry. */
  async reload(): Promise<void> {
    this.load.set('loading');
    try {
      const results = await Promise.all(
        BUDGET_KEYS.map((key) =>
          rpcCall<{ success: boolean; value?: unknown }>(
            this.vscode,
            'settings:get',
            { key: SESSION_BUDGET_SETTINGS[key].key },
            SETTINGS_READ_TIMEOUT_MS,
          ),
        ),
      );
      if (results.some((result) => !result.success || !result.data?.success)) {
        this.load.set('error');
        return;
      }
      this.saved.set(
        Object.fromEntries(
          BUDGET_KEYS.map((key, index) => [key, results[index].data?.value]),
        ),
      );
      this.drafts.set({});
      this.errors.set({});
      this.load.set('ready');
    } catch (error: unknown) {
      console.warn('[SessionBudgetSettings] settings:get failed', error);
      this.load.set('error');
    }
  }

  protected booleanValue(key: BooleanKey): boolean {
    const value = this.saved()[key];
    return typeof value === 'boolean' ? value : this.settings[key].default;
  }

  protected numberText(key: NumberKey): string {
    const draft = this.drafts()[key];
    if (draft !== undefined) return draft;
    const value = this.saved()[key];
    return typeof value === 'number' ? String(value) : '';
  }

  protected range(key: NumberKey): string {
    const setting: SessionBudgetNumberSetting = this.settings[key];
    return `${NUMBER_FORMAT.format(setting.min)} to ${NUMBER_FORMAT.format(setting.max)}`;
  }

  protected unitSuffix(key: NumberKey): string {
    if (key === 'usd') return 'USD';
    if (key.endsWith('Percent')) return '%';
    if (key === 'handoffAfterCompactions') return 'runs';
    return 'tokens';
  }

  protected humanReadable(key: NumberKey): string | null {
    if (
      !['tokens', 'fallbackWeightedTokens', 'tightenWindowTokens'].includes(key)
    )
      return null;
    const value = Number(this.numberText(key).replace(/[,_\s]/g, ''));
    if (!Number.isFinite(value) || value < 1_000) return null;
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' }).format(value)} tokens`;
  }

  /** A stored value the backend ignores (out of bounds, wrong type, or a broken percent pair) says what applies instead. */
  protected storedNotice(key: NumberKey): string | null {
    const setting: SessionBudgetNumberSetting = this.settings[key];
    const value = this.saved()[key];
    if (value !== undefined && !storedNumberIsValid(setting, value)) {
      return `The saved value is not valid; Ptah uses the default (${this.formatDefault(setting)}).`;
    }
    if (key === 'handoffPercent' && !this.percentPairValid()) {
      return `Tighten at is not below Handoff at; Ptah uses the defaults (${this.settings.tightenPercent.default}% and ${this.settings.handoffPercent.default}%).`;
    }
    return null;
  }

  protected edit(key: NumberKey, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({ ...drafts, [key]: text }));
    this.setError(key, this.validate(key, text));
  }

  /**
   * Leaving a field commits its pending draft even when nothing was typed since focus: `change` only fires for a
   * new keystroke, so a draft a partner save made valid while this field had focus would otherwise be lost.
   * `commit` returns early for an invalid, unchanged or busy draft, so a `change` that already wrote it is not repeated.
   */
  protected blurred(key: NumberKey): void {
    if (this.focusedKey === key) this.focusedKey = null;
    if (this.drafts()[key] !== undefined) void this.commit(key);
  }

  /** On commit (blur / Enter): a valid, changed value is written; an invalid one stays on screen with its message. */
  async commit(key: NumberKey): Promise<void> {
    const text = this.drafts()[key];
    if (text === undefined || this.busy()) return;
    const error = this.validate(key, text);
    this.setError(key, error);
    if (error !== null) return;
    const parsed = parseNumber(this.settings[key], text);
    if (!parsed.ok) return;
    if (parsed.value === this.saved()[key]) {
      this.clearDraft(key);
      return;
    }
    if (await this.write(key, parsed.value)) {
      this.clearDraft(key);
      if (key === 'tightenPercent' || key === 'handoffPercent') {
        await this.commitPartner(
          key === 'tightenPercent' ? 'handoffPercent' : 'tightenPercent',
        );
      }
    }
  }

  /**
   * After one percent is saved, the other's pending draft is checked against it. A blurred draft is committed; a
   * focused one is still being typed, so it is only re-validated and is committed by its own blur / Enter.
   */
  private async commitPartner(
    key: 'tightenPercent' | 'handoffPercent',
  ): Promise<void> {
    if (this.focusedKey !== key) {
      await this.commit(key);
      return;
    }
    const text = this.drafts()[key];
    if (text !== undefined) this.setError(key, this.validate(key, text));
  }

  async toggle(key: BooleanKey, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    // The box keeps showing the saved value; the successful write moves it.
    input.checked = this.booleanValue(key);
    if (this.busy() || next === this.booleanValue(key)) return;
    await this.write(key, next);
  }

  async selectUnit(event: Event): Promise<void> {
    const input = event.target as HTMLSelectElement;
    const next = this.units.find((unit) => unit === input.value);
    input.value = this.unitValue();
    if (this.busy() || next === undefined || next === this.unitValue()) return;
    await this.write('unit', next);
  }

  /** Bounds plus, for the percent pair, the shared tighten < handoff rule against the other field's effective value. */
  private validate(key: NumberKey, text: string): string | null {
    const parsed = parseNumber(this.settings[key], text);
    if (!parsed.ok) return parsed.error;
    if (key === 'tightenPercent' && parsed.value !== null) {
      const handoff = this.effectiveNumber('handoffPercent');
      if (!isSessionBudgetPercentOrderValid(parsed.value, handoff)) {
        return `Tighten at must be below Handoff at (${handoff}%).`;
      }
    }
    if (key === 'handoffPercent' && parsed.value !== null) {
      const tighten = this.effectiveNumber('tightenPercent');
      if (!isSessionBudgetPercentOrderValid(tighten, parsed.value)) {
        return `Handoff at must be above Tighten at (${tighten}%).`;
      }
    }
    return null;
  }

  /** The value the backend reads for a percent field: the stored one when in bounds, else the default. */
  private effectiveNumber(key: 'tightenPercent' | 'handoffPercent'): number {
    const setting = this.settings[key];
    const value = this.saved()[key];
    return typeof value === 'number' && storedNumberIsValid(setting, value)
      ? value
      : setting.default;
  }

  private percentPairValid(): boolean {
    return isSessionBudgetPercentOrderValid(
      this.effectiveNumber('tightenPercent'),
      this.effectiveNumber('handoffPercent'),
    );
  }

  /** Writes one key; true when the host confirmed the write. A failure leaves the saved value and says so. */
  private async write(
    key: BudgetKey,
    value: number | null | boolean | SessionBudgetUnit,
  ): Promise<boolean> {
    const label = this.labels[key];
    this.savingKey.set(key);
    this.setError(key, null);
    let confirmed = false;
    let timedOut = false;
    try {
      const result = await rpcCall<{ success: boolean }>(
        this.vscode,
        'settings:set',
        { key: SESSION_BUDGET_SETTINGS[key].key, value },
        SETTINGS_WRITE_TIMEOUT_MS,
      );
      confirmed = result.success && result.data?.success === true;
      timedOut =
        !result.success &&
        (result.error?.startsWith(RPC_TIMEOUT_PREFIX) ?? false);
    } catch (error: unknown) {
      // Reported inline below (the field's message and the status line), like a refused write.
      console.warn('[SessionBudgetSettings] settings:set failed', error);
    }
    if (confirmed) {
      this.saved.update((saved) => ({ ...saved, [key]: value }));
      // Sends already go through once the budget is off; drop the stale banners now (F-D).
      if (key === 'enabled' && value === false) {
        this.tabManager.clearSessionBudgets();
      }
      this.status.set(`Saved ${label}.`);
    } else {
      // A timed-out write may still land on the host, so it cannot claim the setting is unchanged.
      const message = timedOut
        ? `Could not confirm saving ${label}. Reopen settings to see the saved value.`
        : `Could not save ${label}. The saved setting is unchanged.`;
      this.setError(key, message);
      this.status.set(message);
    }
    this.savingKey.set(null);
    return confirmed;
  }

  private formatDefault(setting: SessionBudgetNumberSetting): string {
    return setting.default === null
      ? 'advisory only'
      : NUMBER_FORMAT.format(setting.default);
  }

  private clearDraft(key: NumberKey): void {
    this.drafts.update((drafts) => {
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  }

  private setError(key: BudgetKey, message: string | null): void {
    this.errors.update((errors) => {
      const next = { ...errors };
      if (message === null) delete next[key];
      else next[key] = message;
      return next;
    });
  }
}
