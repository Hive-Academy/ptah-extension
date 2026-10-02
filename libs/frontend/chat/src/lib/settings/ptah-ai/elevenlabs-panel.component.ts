import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  LucideAngularModule,
  XCircle,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  VoiceInfoDto,
  VoiceProviderConfigElevenLabsDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  ELEVENLABS_STT_ROWS,
  ELEVENLABS_TTS_ROWS,
  type ElevenLabsSelectKey,
  type ElevenLabsSelectRow,
} from './elevenlabs-select-rows';

type WriteResult = { ok: true } | { ok: false; message: string };
type SelectionKey = 'voiceId' | ElevenLabsSelectKey;

interface TestResult {
  readonly ok: boolean;
  readonly message: string;
}

// F1: the backend returns raw error.message on every failure, so a visible
// message is always one of these fixed sentences — never host error text.
const SAVE_KEY_FAILED_MESSAGE = 'Could not save the ElevenLabs API key.';
const CLEAR_KEY_FAILED_MESSAGE = 'Could not clear the ElevenLabs API key.';
const SAVE_SETTINGS_FAILED_MESSAGE = 'Could not save the ElevenLabs settings.';
const LOAD_VOICES_FAILED_MESSAGE = 'Could not load your ElevenLabs voices.';
const TEST_OK_MESSAGE = 'Connection works.';
const TEST_FAILED_MESSAGE = 'The connection test failed.';
/** One fixed sentence per `VoiceErrorCategory` the probe can report (V22). */
const TEST_CATEGORY_MESSAGE: Readonly<Record<string, string>> = {
  auth: 'Authentication: ElevenLabs rejected the key.',
  quota: 'Quota: the ElevenLabs account is out of credits or rate-limited.',
  network: 'Network: could not reach ElevenLabs.',
};
const TEST_OTHER_CATEGORY_MESSAGE =
  'Provider error: ElevenLabs could not complete the test.';

function testFailureMessage(category: string | undefined): string {
  if (!category) return TEST_FAILED_MESSAGE;
  return TEST_CATEGORY_MESSAGE[category] ?? TEST_OTHER_CATEGORY_MESSAGE;
}

/**
 * ElevenLabs cloud provider panel, drawer D-VOICE (pattern map V21-V25), rendered once per
 * direction. Shared: the API key block. Direction-specific: TTS shows voice, model and output
 * format; STT shows the transcription model. All controls are `table-xs` rows.
 *
 * Key (V21, G13 verify-then-save): a typed key must pass `voice:testConnection` with that exact
 * draft before Save turns on, so a key is never saved on a failed probe. Clear asks for an inline
 * confirm (P8) and has no Undo. With no draft, Test connection probes the stored key (V22).
 * Selections (V23-V25) save through {@link SettingsSaveFeedbackService.saveGeneric} with Undo; a
 * failed write reverts the select and raises an alert toast (D15).
 *
 * SECURITY: the key input is a password field, the stored key is never rendered (the panel only
 * knows `apiKeyConfigured`), and a saved or abandoned draft is dropped from the signal.
 */
@Component({
  selector: 'ptah-elevenlabs-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (errorMessage(); as message) {
      <div
        role="alert"
        data-testid="elevenlabs-panel-error"
        class="mb-3 flex items-center gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content"
      >
        <lucide-angular
          [img]="AlertCircleIcon"
          class="w-3.5 h-3.5 text-error shrink-0"
          aria-hidden="true"
        />
        {{ message }}
      </div>
    }

    <table class="table table-xs" data-testid="elevenlabs-panel-table">
      <tbody>
        <!-- V21: stored key status + Clear (S-confirm, no Undo) -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            API key
          </th>
          <td class="align-top">
            <div class="flex items-center justify-between gap-2">
              <span
                class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                [attr.data-testid]="
                  config().apiKeyConfigured
                    ? 'elevenlabs-key-configured'
                    : 'elevenlabs-key-missing'
                "
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  [class.bg-success]="config().apiKeyConfigured"
                  [class.bg-warning]="!config().apiKeyConfigured"
                  aria-hidden="true"
                ></span>
                {{
                  config().apiKeyConfigured ? 'Configured' : 'Not configured'
                }}
              </span>
              @if (config().apiKeyConfigured) {
                <button
                  #clearBtn
                  type="button"
                  class="btn btn-outline btn-xs border-error text-base-content"
                  [disabled]="saving()"
                  [attr.aria-expanded]="confirmingClear()"
                  (click)="openClearConfirm()"
                  data-testid="elevenlabs-key-clear"
                >
                  Clear
                </button>
              }
            </div>
            @if (config().apiKeyConfigured && confirmingClear()) {
              <div
                role="group"
                aria-label="Confirm clear ElevenLabs API key"
                class="mt-2 space-y-2 rounded border border-base-300 p-3"
                (keydown.escape)="cancelClear()"
                data-testid="elevenlabs-clear-group"
              >
                <p class="text-xs text-base-content">
                  Clear the stored ElevenLabs key from this machine? ElevenLabs
                  voice stops working until a key is added.
                </p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="btn btn-outline btn-sm border-error text-base-content"
                    [disabled]="saving()"
                    (click)="clearKey()"
                    data-testid="elevenlabs-clear-confirm"
                  >
                    Clear key
                  </button>
                  <button
                    #clearCancel
                    type="button"
                    class="btn btn-ghost btn-sm"
                    (click)="cancelClear()"
                    data-testid="elevenlabs-clear-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }
          </td>
        </tr>

        <!-- V21/V22: new key, verify-then-save (G13) -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            {{ config().apiKeyConfigured ? 'Replace key' : 'New key' }}
          </th>
          <td class="align-top">
            <div class="flex items-center gap-1">
              <div class="relative flex-1">
                <input
                  id="elevenlabs-key"
                  [type]="keyVisible() ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="ElevenLabs API key"
                  aria-describedby="elevenlabs-key-help"
                  class="input input-bordered input-xs w-full pr-8 font-mono"
                  [value]="keyDraft()"
                  [disabled]="saving()"
                  [placeholder]="
                    config().apiKeyConfigured
                      ? 'Enter a new key to replace the stored one'
                      : 'Paste your ElevenLabs API key'
                  "
                  (input)="onKeyInput($event)"
                  data-testid="elevenlabs-key-input"
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-xs absolute right-0 top-0"
                  [attr.aria-label]="
                    keyVisible() ? 'Hide API key' : 'Show API key'
                  "
                  [attr.aria-pressed]="keyVisible()"
                  (click)="keyVisible.set(!keyVisible())"
                  data-testid="elevenlabs-key-visibility"
                >
                  <lucide-angular
                    [img]="keyVisible() ? EyeOffIcon : EyeIcon"
                    class="w-3 h-3"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <button
                type="button"
                class="btn btn-outline btn-xs gap-1"
                [disabled]="!canTest()"
                (click)="testConnection()"
                data-testid="elevenlabs-test-btn"
              >
                @if (isTesting()) {
                  <span
                    class="loading loading-spinner loading-xs"
                    aria-hidden="true"
                  ></span>
                  <span>Testing…</span>
                } @else {
                  <span>Test connection</span>
                }
              </button>
              <button
                type="button"
                class="btn btn-primary btn-xs"
                [disabled]="!canSaveKey()"
                (click)="saveKey()"
                data-testid="elevenlabs-key-save"
              >
                Save
              </button>
            </div>
            <p
              id="elevenlabs-key-help"
              class="mt-1 text-[10px] text-base-content-muted"
              data-testid="elevenlabs-key-hint"
            >
              @if (keyDraft().trim().length > 0 && !draftVerified()) {
                Test the key first; Save turns on once the test passes.
              } @else {
                Stored encrypted on this machine.
              }
            </p>
            <div aria-live="polite" class="mt-1">
              @if (testResult(); as result) {
                <span
                  class="badge badge-outline badge-sm h-auto gap-1 text-base-content"
                  data-testid="elevenlabs-test-result"
                >
                  <lucide-angular
                    [img]="result.ok ? CheckCircleIcon : XCircleIcon"
                    class="w-3 h-3 shrink-0"
                    [class.text-success]="result.ok"
                    [class.text-error]="!result.ok"
                    aria-hidden="true"
                  />
                  {{ result.message }}
                </span>
              }
            </div>
          </td>
        </tr>

        @if (direction() === 'tts') {
          <!-- V23: voice (S-sel + Undo) -->
          <tr>
            <th
              scope="row"
              class="w-24 align-top font-medium text-base-content"
            >
              Voice
            </th>
            <td class="align-top">
              @if (!config().apiKeyConfigured) {
                <p
                  class="text-[10px] text-base-content-muted"
                  data-testid="elevenlabs-voices-locked"
                >
                  Save an API key to load your voices.
                </p>
              } @else if (isLoadingVoices()) {
                <div
                  class="text-[10px] text-base-content-muted"
                  data-testid="elevenlabs-voices-loading"
                >
                  Loading voices…
                </div>
              } @else if (voicesError(); as vErr) {
                <div class="flex items-center gap-2">
                  <span
                    class="flex items-center gap-1 text-[10px] text-base-content"
                    data-testid="elevenlabs-voices-error"
                  >
                    <lucide-angular
                      [img]="AlertCircleIcon"
                      class="w-3 h-3 text-error shrink-0"
                      aria-hidden="true"
                    />
                    {{ vErr }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    (click)="loadVoices()"
                    data-testid="elevenlabs-voices-retry"
                  >
                    Retry
                  </button>
                </div>
              } @else {
                <select
                  id="elevenlabs-voice"
                  aria-label="Voice"
                  class="select select-bordered select-xs w-full"
                  [value]="voiceId()"
                  [disabled]="saving()"
                  (change)="onVoiceChange($event)"
                  data-testid="elevenlabs-voice-select"
                >
                  @for (voice of voices(); track voice.id) {
                    <option
                      [value]="voice.id"
                      [selected]="voice.id === voiceId()"
                    >
                      {{ voice.label }}
                    </option>
                  }
                </select>
              }
            </td>
          </tr>
        }
        <!-- V24 (TTS model, output format) / V25 (STT model): S-sel + Undo -->
        @for (row of selectRows(); track row.key) {
          <tr>
            <th
              scope="row"
              class="w-24 align-top font-medium text-base-content"
            >
              {{ row.label }}
            </th>
            <td class="align-top">
              <select
                [id]="'elevenlabs-' + row.slug"
                [attr.aria-label]="row.ariaLabel"
                class="select select-bordered select-xs w-full"
                [value]="selection[row.key]()"
                [disabled]="saving()"
                (change)="onSelectionChange($event, row)"
                [attr.data-testid]="'elevenlabs-' + row.slug + '-select'"
              >
                @for (opt of row.options; track opt.value) {
                  <option
                    [value]="opt.value"
                    [selected]="opt.value === selection[row.key]()"
                  >
                    {{ opt.label }}
                  </option>
                }
              </select>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ElevenLabsPanelComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly direction = input.required<'stt' | 'tts'>();
  readonly config = input.required<VoiceProviderConfigElevenLabsDto>();
  readonly changed = output<void>();

  readonly AlertCircleIcon = AlertCircle;
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  // Config-driven selects (reset when the container passes a fresh config).
  readonly voiceId = linkedSignal(() => this.config().voiceId ?? '');
  readonly selection: Readonly<
    Record<ElevenLabsSelectKey, WritableSignal<string>>
  > = {
    ttsModelId: linkedSignal(() => this.config().ttsModelId),
    outputFormat: linkedSignal(() => this.config().outputFormat),
    sttModelId: linkedSignal(() => this.config().sttModelId),
  };
  readonly selectRows = computed(() =>
    this.direction() === 'tts' ? ELEVENLABS_TTS_ROWS : ELEVENLABS_STT_ROWS,
  );

  /** Draft key — NEVER seeded from the stored key (which is never sent to us). */
  readonly keyDraft = signal('');
  readonly keyVisible = signal(false);
  /** The exact draft that last passed `voice:testConnection`; `null` until one does (G13). */
  private readonly verifiedKey = signal<string | null>(null);
  readonly isTesting = signal(false);
  readonly testResult = signal<TestResult | null>(null);
  readonly confirmingClear = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly voices = signal<VoiceInfoDto[]>([]);
  readonly isLoadingVoices = signal(false);
  readonly voicesError = signal<string | null>(null);

  readonly showVoicePicker = computed(
    () => this.direction() === 'tts' && this.config().apiKeyConfigured,
  );
  /** The typed draft is the one that passed the probe. */
  readonly draftVerified = computed(() => {
    const draft = this.keyDraft().trim();
    return draft.length > 0 && this.verifiedKey() === draft;
  });
  /** G13: Save is on only for a draft that passed the probe. */
  readonly canSaveKey = computed(
    () => this.draftVerified() && !this.isTesting() && !this.saving(),
  );
  /** Probes the draft when one is typed, otherwise the stored key. */
  readonly canTest = computed(
    () =>
      !this.isTesting() &&
      (this.config().apiKeyConfigured || this.keyDraft().trim().length > 0),
  );

  private readonly clearButton =
    viewChild<ElementRef<HTMLButtonElement>>('clearBtn');
  private readonly clearCancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('clearCancel');

  constructor() {
    // Loads voices on mount and again once a first key is saved and the container re-reads.
    effect(() => {
      if (this.showVoicePicker()) untracked(() => void this.loadVoices());
    });
    // P8: the inline confirm takes focus on its Cancel button when it opens.
    effect(() => this.clearCancelButton()?.nativeElement.focus());
  }

  onKeyInput(event: Event): void {
    this.keyDraft.set((event.target as HTMLInputElement).value);
    this.verifiedKey.set(null);
    this.testResult.set(null);
  }

  /**
   * V22 probe. With a draft it tests exactly that draft and, on a pass, unlocks Save for it (G13);
   * without one it tests the stored key. The outcome is one fixed sentence per category (F1).
   */
  async testConnection(): Promise<void> {
    if (!this.canTest()) return;
    const draft = this.keyDraft().trim();
    this.errorMessage.set(null);
    this.testResult.set(null);
    this.verifiedKey.set(null);
    this.isTesting.set(true);
    let outcome: TestResult = { ok: false, message: TEST_FAILED_MESSAGE };
    try {
      const result = await this.rpc.call('voice:testConnection', {
        providerId: 'elevenlabs',
        ...(draft.length > 0 ? { apiKey: draft } : {}),
      });
      if (result.isSuccess()) {
        outcome = result.data.ok
          ? { ok: true, message: TEST_OK_MESSAGE }
          : { ok: false, message: testFailureMessage(result.data.category) };
      }
    } catch {
      // A thrown transport error gets the generic fixed sentence (F1).
    } finally {
      this.isTesting.set(false);
    }
    // The draft changed while the probe ran: this outcome is about a key no longer in the field.
    if (this.keyDraft().trim() !== draft) return;
    this.testResult.set(outcome);
    if (outcome.ok && draft.length > 0) this.verifiedKey.set(draft);
  }

  /** V21 save (S-verify, no Undo): only the draft that passed the probe is ever sent. */
  async saveKey(): Promise<void> {
    const apiKey = this.keyDraft().trim();
    if (apiKey.length === 0 || this.verifiedKey() !== apiKey) return;
    this.errorMessage.set(null);
    await this.feedback.saveGeneric({
      label: 'ElevenLabs API key',
      write: async () => {
        const result = await this.writeApiKey(apiKey, SAVE_KEY_FAILED_MESSAGE);
        if (result.ok) {
          this.keyDraft.set('');
          this.verifiedKey.set(null);
          this.keyVisible.set(false);
          this.testResult.set(null);
          // A replaced key may see a different voice library; a first key loads via the effect.
          void this.loadVoices();
        }
        return result;
      },
      undo: null,
    });
  }

  openClearConfirm(): void {
    this.errorMessage.set(null);
    this.confirmingClear.set(true);
  }

  cancelClear(): void {
    this.confirmingClear.set(false);
    this.clearButton()?.nativeElement.focus();
  }

  /** V21 clear after the inline confirm (S-confirm, no Undo). The confirm stays open on failure. */
  async clearKey(): Promise<void> {
    this.errorMessage.set(null);
    await this.feedback.saveGeneric({
      label: 'removal of the ElevenLabs API key',
      write: async () => {
        const result = await this.writeApiKey('', CLEAR_KEY_FAILED_MESSAGE);
        if (result.ok) {
          this.confirmingClear.set(false);
          this.keyDraft.set('');
          this.verifiedKey.set(null);
          this.testResult.set(null);
          this.voices.set([]);
        }
        return result;
      },
      undo: null,
    });
  }

  async loadVoices(): Promise<void> {
    if (!this.showVoicePicker()) return;
    this.isLoadingVoices.set(true);
    this.voicesError.set(null);
    let loaded: VoiceInfoDto[] | null = null;
    try {
      const result = await this.rpc.call('voice:listVoices', {
        providerId: 'elevenlabs',
      });
      if (result.isSuccess() && result.data.ok) loaded = result.data.voices;
    } catch {
      // A thrown transport error gets the same fixed sentence (F1).
    } finally {
      this.isLoadingVoices.set(false);
    }
    if (loaded) this.voices.set(loaded);
    else this.voicesError.set(LOAD_VOICES_FAILED_MESSAGE);
  }

  onVoiceChange(event: Event): Promise<void> {
    return this.saveSelection(
      event,
      'ElevenLabs voice',
      this.voiceId,
      'voiceId',
    );
  }

  onSelectionChange(event: Event, row: ElevenLabsSelectRow): Promise<void> {
    const label = `ElevenLabs ${row.ariaLabel.toLowerCase()}`;
    return this.saveSelection(event, label, this.selection[row.key], row.key);
  }

  /**
   * V23-V25 (S-sel): saves on selection with Undo = the previous value. No Undo when there was no
   * previous value (an unset voice), since the host rejects an empty id.
   */
  private async saveSelection(
    event: Event,
    label: string,
    field: WritableSignal<string>,
    key: SelectionKey,
  ): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const next = select.value;
    const previous = field();
    if (next === previous) return;
    await this.feedback.saveGeneric({
      label,
      write: () => this.writeSelection(field, key, next, previous),
      undo:
        previous.length > 0
          ? () => this.writeSelection(field, key, previous, next)
          : null,
    });
    // The binding alone does not repaint when the signal ends where it started.
    select.value = field();
  }

  /** Shows `next` while it saves; restores `fallback` when the write fails (D15). */
  private async writeSelection(
    field: WritableSignal<string>,
    key: SelectionKey,
    next: string,
    fallback: string,
  ): Promise<WriteResult> {
    field.set(next);
    const elevenlabs: Partial<Record<SelectionKey, string>> = {};
    elevenlabs[key] = next;
    const result = await this.attempt(
      SAVE_SETTINGS_FAILED_MESSAGE,
      async () => {
        const answer = await this.rpc.call('voice:setProviderConfig', {
          elevenlabs,
        });
        return answer.isSuccess() && answer.data.ok;
      },
    );
    if (!result.ok) field.set(fallback);
    return result;
  }

  /** `voice:setApiKey` (`''` clears the stored key). */
  private writeApiKey(apiKey: string, failure: string): Promise<WriteResult> {
    return this.attempt(failure, async () => {
      const answer = await this.rpc.call('voice:setApiKey', {
        providerId: 'elevenlabs',
        apiKey,
      });
      return answer.isSuccess() && answer.data.ok;
    });
  }

  /**
   * Runs one write. Success only when the write's own result says so (D15); it emits `changed` so
   * the container re-reads the backend config. Any failure — RPC error, `{ok:false}` or a throw —
   * shows the fixed `failure` sentence inline, never host text (F1).
   */
  private async attempt(
    failure: string,
    request: () => Promise<boolean>,
  ): Promise<WriteResult> {
    this.errorMessage.set(null);
    let saved = false;
    try {
      saved = await request();
    } catch {
      // A thrown transport error gets the same fixed sentence (F1).
    }
    if (saved) {
      this.changed.emit();
      return { ok: true };
    }
    this.errorMessage.set(failure);
    return { ok: false, message: failure };
  }
}
