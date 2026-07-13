import {
  Component,
  inject,
  input,
  output,
  computed,
  signal,
  linkedSignal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  KeyRound,
  CheckCircle,
  XCircle,
  Loader,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  VoiceProviderConfigElevenLabsDto,
  VoiceInfoDto,
} from '@ptah-extension/shared';

interface LabeledOption {
  readonly value: string;
  readonly label: string;
}

const TTS_MODELS: readonly LabeledOption[] = [
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (default)' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (low latency)' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' },
  { value: 'eleven_monolingual_v1', label: 'Monolingual v1 (English)' },
] as const;

const OUTPUT_FORMATS: readonly LabeledOption[] = [
  { value: 'mp3_44100_128', label: 'MP3 44.1 kHz / 128 kbps (default)' },
  { value: 'mp3_44100_64', label: 'MP3 44.1 kHz / 64 kbps' },
  { value: 'mp3_22050_32', label: 'MP3 22 kHz / 32 kbps' },
  { value: 'opus_48000_128', label: 'Opus 48 kHz / 128 kbps' },
  { value: 'pcm_16000', label: 'PCM 16 kHz' },
  { value: 'pcm_24000', label: 'PCM 24 kHz' },
] as const;

const STT_MODELS: readonly LabeledOption[] = [
  { value: 'scribe_v1', label: 'Scribe v1' },
] as const;

interface TestResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * ElevenLabs cloud provider panel (FR-5.3, FR-6.4). Rendered once per direction
 * (STT or TTS). Shared across directions: a masked API-key input + a Test
 * connection probe. Direction-specific: TTS shows the voice dropdown (fetched
 * from `voice:listVoices {providerId:'elevenlabs'}`), TTS-model and output-format
 * selects; STT shows the transcription-model select.
 *
 * SECURITY: the key input is `type="password"`, the stored key is NEVER rendered
 * (the component only knows `apiKeyConfigured: boolean` from the backend), and a
 * "Configured" indicator is derived from that flag — no key value is ever bound
 * into the DOM. There is NO download UI (cloud providers require no local model).
 */
@Component({
  selector: 'ptah-elevenlabs-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (errorMessage(); as message) {
      <div class="text-xs text-error mb-2" data-testid="elevenlabs-panel-error">
        {{ message }}
      </div>
    }

    <!-- API key (shared across directions) -->
    <div class="mb-3">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-1">
          <lucide-angular
            [img]="KeyRoundIcon"
            class="w-3 h-3 text-base-content/60"
          />
          <label
            for="elevenlabs-key"
            class="text-xs font-medium text-base-content/70"
          >
            API Key
          </label>
        </div>
        @if (config().apiKeyConfigured) {
          <span
            class="text-[10px] text-success flex items-center gap-1"
            data-testid="elevenlabs-key-configured"
          >
            <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
            Configured ●●●
          </span>
        } @else {
          <span
            class="text-[10px] text-warning"
            data-testid="elevenlabs-key-missing"
          >
            Not configured
          </span>
        }
      </div>

      <div class="flex items-center gap-1">
        <input
          id="elevenlabs-key"
          type="password"
          autocomplete="off"
          class="input input-bordered input-xs w-full font-mono"
          [value]="keyDraft()"
          [disabled]="isSavingKey()"
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
          class="btn btn-primary btn-xs"
          [disabled]="isSavingKey() || keyDraft().length === 0"
          (click)="saveKey()"
          data-testid="elevenlabs-key-save"
        >
          {{ isSavingKey() ? 'Saving…' : 'Save' }}
        </button>
        @if (config().apiKeyConfigured) {
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            [disabled]="isSavingKey()"
            (click)="clearKey()"
            data-testid="elevenlabs-key-clear"
          >
            Clear
          </button>
        }
      </div>

      <div class="mt-1 flex items-center gap-2">
        <button
          type="button"
          class="btn btn-outline btn-xs gap-1"
          [disabled]="
            isTesting() ||
            (!config().apiKeyConfigured && keyDraft().length === 0)
          "
          (click)="testConnection()"
          data-testid="elevenlabs-test-btn"
        >
          @if (isTesting()) {
            <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
            <span>Testing…</span>
          } @else {
            <span>Test connection</span>
          }
        </button>
        @if (testResult(); as result) {
          <span
            class="text-[10px] flex items-center gap-1"
            [class.text-success]="result.ok"
            [class.text-error]="!result.ok"
            data-testid="elevenlabs-test-result"
          >
            <lucide-angular
              [img]="result.ok ? CheckCircleIcon : XCircleIcon"
              class="w-2.5 h-2.5"
            />
            {{ result.message }}
          </span>
        }
      </div>
    </div>

    @if (direction() === 'tts') {
      <!-- Voice -->
      <div class="mb-2">
        <label
          for="elevenlabs-voice"
          class="text-xs font-medium text-base-content/70 mb-1 block"
        >
          Voice
        </label>
        @if (!config().apiKeyConfigured) {
          <p
            class="text-[10px] text-base-content/50"
            data-testid="elevenlabs-voices-locked"
          >
            Save an API key to load your voices.
          </p>
        } @else if (isLoadingVoices()) {
          <div
            class="text-[10px] text-base-content/50"
            data-testid="elevenlabs-voices-loading"
          >
            Loading voices…
          </div>
        } @else if (voicesError(); as vErr) {
          <div class="flex items-center gap-2">
            <span
              class="text-[10px] text-error"
              data-testid="elevenlabs-voices-error"
            >
              {{ vErr }}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="loadVoices()"
            >
              Retry
            </button>
          </div>
        } @else {
          <select
            id="elevenlabs-voice"
            class="select select-bordered select-xs w-full"
            [value]="voiceId()"
            [disabled]="isSavingConfig()"
            (change)="onVoiceChange($event)"
            data-testid="elevenlabs-voice-select"
          >
            @for (voice of voices(); track voice.id) {
              <option [value]="voice.id" [selected]="voice.id === voiceId()">
                {{ voice.label }}
              </option>
            }
          </select>
        }
      </div>

      <!-- TTS model -->
      <div class="mb-2">
        <label
          for="elevenlabs-tts-model"
          class="text-xs font-medium text-base-content/70 mb-1 block"
        >
          Model
        </label>
        <select
          id="elevenlabs-tts-model"
          class="select select-bordered select-xs w-full"
          [value]="ttsModelId()"
          [disabled]="isSavingConfig()"
          (change)="onTtsModelChange($event)"
          data-testid="elevenlabs-tts-model-select"
        >
          @for (opt of ttsModels; track opt.value) {
            <option [value]="opt.value" [selected]="opt.value === ttsModelId()">
              {{ opt.label }}
            </option>
          }
        </select>
      </div>

      <!-- Output format -->
      <div>
        <label
          for="elevenlabs-output-format"
          class="text-xs font-medium text-base-content/70 mb-1 block"
        >
          Output Format
        </label>
        <select
          id="elevenlabs-output-format"
          class="select select-bordered select-xs w-full"
          [value]="outputFormat()"
          [disabled]="isSavingConfig()"
          (change)="onOutputFormatChange($event)"
          data-testid="elevenlabs-output-format-select"
        >
          @for (opt of outputFormats; track opt.value) {
            <option
              [value]="opt.value"
              [selected]="opt.value === outputFormat()"
            >
              {{ opt.label }}
            </option>
          }
        </select>
      </div>
    } @else {
      <!-- STT model -->
      <div>
        <label
          for="elevenlabs-stt-model"
          class="text-xs font-medium text-base-content/70 mb-1 block"
        >
          Transcription Model
        </label>
        <select
          id="elevenlabs-stt-model"
          class="select select-bordered select-xs w-full"
          [value]="sttModelId()"
          [disabled]="isSavingConfig()"
          (change)="onSttModelChange($event)"
          data-testid="elevenlabs-stt-model-select"
        >
          @for (opt of sttModels; track opt.value) {
            <option [value]="opt.value" [selected]="opt.value === sttModelId()">
              {{ opt.label }}
            </option>
          }
        </select>
      </div>
    }
  `,
})
export class ElevenLabsPanelComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);

  readonly direction = input.required<'stt' | 'tts'>();
  readonly config = input.required<VoiceProviderConfigElevenLabsDto>();
  readonly changed = output<void>();

  readonly KeyRoundIcon = KeyRound;
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly LoaderIcon = Loader;

  readonly ttsModels = TTS_MODELS;
  readonly outputFormats = OUTPUT_FORMATS;
  readonly sttModels = STT_MODELS;

  // Config-driven selects (reset when the container passes a fresh config).
  readonly voiceId = linkedSignal(() => this.config().voiceId ?? '');
  readonly ttsModelId = linkedSignal(() => this.config().ttsModelId);
  readonly outputFormat = linkedSignal(() => this.config().outputFormat);
  readonly sttModelId = linkedSignal(() => this.config().sttModelId);

  /** Draft key — NEVER seeded from the stored key (which is never sent to us). */
  readonly keyDraft = signal('');
  readonly isSavingKey = signal(false);
  readonly isTesting = signal(false);
  readonly testResult = signal<TestResult | null>(null);
  readonly isSavingConfig = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly voices = signal<VoiceInfoDto[]>([]);
  readonly isLoadingVoices = signal(false);
  readonly voicesError = signal<string | null>(null);

  readonly showVoicePicker = computed(
    () => this.direction() === 'tts' && this.config().apiKeyConfigured,
  );

  async ngOnInit(): Promise<void> {
    if (this.showVoicePicker()) await this.loadVoices();
  }

  onKeyInput(event: Event): void {
    this.keyDraft.set((event.target as HTMLInputElement).value);
    this.testResult.set(null);
  }

  async saveKey(): Promise<void> {
    const apiKey = this.keyDraft();
    if (apiKey.length === 0) return;
    this.errorMessage.set(null);
    this.isSavingKey.set(true);
    try {
      const result = await this.rpc.call('voice:setApiKey', {
        providerId: 'elevenlabs',
        apiKey,
      });
      if (result.isSuccess() && result.data.ok) {
        this.keyDraft.set('');
        this.testResult.set(null);
        this.changed.emit();
        await this.loadVoices();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to save API key'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to save API key',
      );
    } finally {
      this.isSavingKey.set(false);
    }
  }

  async clearKey(): Promise<void> {
    this.errorMessage.set(null);
    this.isSavingKey.set(true);
    try {
      const result = await this.rpc.call('voice:setApiKey', {
        providerId: 'elevenlabs',
        apiKey: '',
      });
      if (result.isSuccess() && result.data.ok) {
        this.keyDraft.set('');
        this.testResult.set(null);
        this.voices.set([]);
        this.changed.emit();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to clear API key'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to clear API key',
      );
    } finally {
      this.isSavingKey.set(false);
    }
  }

  async testConnection(): Promise<void> {
    this.errorMessage.set(null);
    this.testResult.set(null);
    this.isTesting.set(true);
    try {
      const draft = this.keyDraft();
      const result = await this.rpc.call('voice:testConnection', {
        providerId: 'elevenlabs',
        ...(draft.length > 0 ? { apiKey: draft } : {}),
      });
      if (result.isSuccess() && result.data.ok) {
        this.testResult.set({ ok: true, message: 'Connection OK' });
      } else {
        const category =
          result.isSuccess() && !result.data.ok
            ? result.data.category
            : undefined;
        const base =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Connection failed');
        this.testResult.set({
          ok: false,
          message: category ? `${this.categoryLabel(category)}: ${base}` : base,
        });
      }
    } catch (error: unknown) {
      this.testResult.set({
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    } finally {
      this.isTesting.set(false);
    }
  }

  async loadVoices(): Promise<void> {
    if (!this.config().apiKeyConfigured || this.direction() !== 'tts') return;
    this.isLoadingVoices.set(true);
    this.voicesError.set(null);
    try {
      const result = await this.rpc.call('voice:listVoices', {
        providerId: 'elevenlabs',
      });
      if (result.isSuccess() && result.data.ok) {
        this.voices.set(result.data.voices);
      } else {
        this.voicesError.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to load voices'),
        );
      }
    } catch (error: unknown) {
      this.voicesError.set(
        error instanceof Error ? error.message : 'Failed to load voices',
      );
    } finally {
      this.isLoadingVoices.set(false);
    }
  }

  onVoiceChange(event: Event): void {
    const voiceId = (event.target as HTMLSelectElement).value;
    this.voiceId.set(voiceId);
    void this.saveConfig({ voiceId });
  }

  onTtsModelChange(event: Event): void {
    const ttsModelId = (event.target as HTMLSelectElement).value;
    this.ttsModelId.set(ttsModelId);
    void this.saveConfig({ ttsModelId });
  }

  onOutputFormatChange(event: Event): void {
    const outputFormat = (event.target as HTMLSelectElement).value;
    this.outputFormat.set(outputFormat);
    void this.saveConfig({ outputFormat });
  }

  onSttModelChange(event: Event): void {
    const sttModelId = (event.target as HTMLSelectElement).value;
    this.sttModelId.set(sttModelId);
    void this.saveConfig({ sttModelId });
  }

  private async saveConfig(elevenlabs: {
    voiceId?: string;
    ttsModelId?: string;
    outputFormat?: string;
    sttModelId?: string;
  }): Promise<void> {
    this.errorMessage.set(null);
    this.isSavingConfig.set(true);
    try {
      const result = await this.rpc.call('voice:setProviderConfig', {
        elevenlabs,
      });
      if (result.isSuccess() && result.data.ok) {
        this.changed.emit();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to save ElevenLabs settings'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to save ElevenLabs settings',
      );
    } finally {
      this.isSavingConfig.set(false);
    }
  }

  private categoryLabel(category: string): string {
    switch (category) {
      case 'auth':
        return 'Authentication';
      case 'quota':
        return 'Quota';
      case 'network':
        return 'Network';
      default:
        return 'Provider error';
    }
  }
}
