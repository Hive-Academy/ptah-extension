import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import {
  LucideAngularModule,
  Mic,
  CheckCircle,
  Download,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

interface WhisperModelOption {
  readonly value: string;
  readonly label: string;
}

const ENGLISH_MODELS: readonly WhisperModelOption[] = [
  { value: 'tiny.en', label: 'tiny.en (~40 MB, fastest)' },
  { value: 'base.en', label: 'base.en (~80 MB, default)' },
  { value: 'small.en', label: 'small.en (~250 MB, more accurate)' },
  { value: 'medium.en', label: 'medium.en (~780 MB)' },
] as const;

const MULTILINGUAL_MODELS: readonly WhisperModelOption[] = [
  { value: 'tiny', label: 'tiny (~40 MB, fastest)' },
  { value: 'base', label: 'base (~80 MB)' },
  { value: 'small', label: 'small (~250 MB)' },
  { value: 'medium', label: 'medium (~780 MB)' },
  { value: 'large-v3-turbo', label: 'large-v3-turbo (~800 MB, most accurate)' },
] as const;

interface TtsVoiceOption {
  readonly value: string;
  readonly label: string;
}

/** Curated subset of Kokoro v1.0 voices, grouped by accent. */
const TTS_VOICES_AMERICAN: readonly TtsVoiceOption[] = [
  { value: 'af_heart', label: 'Heart (female, default)' },
  { value: 'af_bella', label: 'Bella (female)' },
  { value: 'af_nicole', label: 'Nicole (female)' },
  { value: 'af_sarah', label: 'Sarah (female)' },
  { value: 'am_michael', label: 'Michael (male)' },
  { value: 'am_fenrir', label: 'Fenrir (male)' },
  { value: 'am_puck', label: 'Puck (male)' },
] as const;

const TTS_VOICES_BRITISH: readonly TtsVoiceOption[] = [
  { value: 'bf_emma', label: 'Emma (female)' },
  { value: 'bf_isabella', label: 'Isabella (female)' },
  { value: 'bm_george', label: 'George (male)' },
  { value: 'bm_fable', label: 'Fable (male)' },
] as const;

/** Matches the backend TTS download-progress sentinel (`TTS_PROGRESS_MODEL`). */
const TTS_PROGRESS_MODEL = 'tts';
const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';

const DOWNLOAD_MODEL_TIMEOUT_MS = 30 * 60 * 1000;
const SYNTHESIZE_TIMEOUT_MS = 60 * 1000;

@Component({
  selector: 'ptah-voice-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="MicIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Voice Transcription
          </h2>
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Whisper model used for voice-to-text. Shared by the chat mic and
          messaging-gateway voice notes. The model downloads to
          <code class="text-[10px] bg-base-300 px-1 rounded"
            >~/.ptah/models/</code
          >
          on first use.
        </p>

        @if (errorMessage()) {
          <div class="text-xs text-error mb-2" data-testid="voice-config-error">
            {{ errorMessage() }}
          </div>
        }

        <div>
          <div class="flex items-center justify-between mb-1">
            <label
              for="voice-whisper-model"
              class="text-xs font-medium text-base-content/70"
            >
              Whisper Model
            </label>
            @if (savedRecently()) {
              <span
                class="text-[10px] text-success flex items-center gap-1"
                data-testid="voice-config-saved"
              >
                <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
                Saved
              </span>
            }
          </div>
          <select
            id="voice-whisper-model"
            class="select select-bordered select-xs w-full"
            [value]="selectedModel()"
            [disabled]="isSaving()"
            (change)="onModelChange($event)"
            data-testid="voice-config-model-select"
          >
            <optgroup label="English-only">
              @for (opt of englishModels; track opt.value) {
                <option
                  [value]="opt.value"
                  [selected]="opt.value === selectedModel()"
                >
                  {{ opt.label }}
                </option>
              }
            </optgroup>
            <optgroup label="Multilingual">
              @for (opt of multilingualModels; track opt.value) {
                <option
                  [value]="opt.value"
                  [selected]="opt.value === selectedModel()"
                >
                  {{ opt.label }}
                </option>
              }
            </optgroup>
          </select>
        </div>

        <div class="mt-2">
          @if (isDownloading()) {
            <div
              class="flex items-center gap-2"
              data-testid="voice-config-download-status"
            >
              <progress
                class="progress progress-primary flex-1 h-2"
                [value]="downloadPercent() ?? 0"
                max="100"
                data-testid="voice-config-download-progress"
              ></progress>
              <span class="text-[10px] text-base-content/60 w-20 text-right">
                @if (downloadPercent() !== null) {
                  Downloading {{ downloadPercent() }}%
                } @else {
                  Starting…
                }
              </span>
            </div>
          } @else {
            <div class="flex items-center justify-between gap-2">
              @if (downloaded()) {
                <span
                  class="text-[10px] text-success flex items-center gap-1"
                  data-testid="voice-config-download-status"
                >
                  <span class="text-success">●</span>
                  Downloaded
                </span>
              } @else {
                <span
                  class="text-[10px] text-base-content/50 flex items-center gap-1"
                  data-testid="voice-config-download-status"
                >
                  <span class="text-base-content/40">○</span>
                  Not downloaded
                </span>
              }

              <button
                class="btn btn-outline btn-xs gap-1"
                [disabled]="isSaving() || downloaded()"
                (click)="downloadModel()"
                data-testid="voice-config-download-btn"
              >
                <lucide-angular [img]="DownloadIcon" class="w-3 h-3" />
                <span>{{ downloaded() ? 'Ready' : 'Download' }}</span>
              </button>
            </div>
          }
        </div>

        <div class="divider my-3 text-[10px] text-base-content/40">
          Text-to-Speech
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Kokoro voice used to read replies aloud. Apache-licensed, runs locally
          on the same engine; the ~80 MB model downloads to
          <code class="text-[10px] bg-base-300 px-1 rounded"
            >~/.ptah/models/</code
          >
          on first use.
        </p>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label
              for="tts-voice"
              class="text-xs font-medium text-base-content/70"
            >
              Voice
            </label>
            @if (voiceSavedRecently()) {
              <span
                class="text-[10px] text-success flex items-center gap-1"
                data-testid="tts-config-saved"
              >
                <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
                Saved
              </span>
            }
          </div>
          <select
            id="tts-voice"
            class="select select-bordered select-xs w-full"
            [value]="selectedVoice()"
            [disabled]="isSavingVoice()"
            (change)="onVoiceChange($event)"
            data-testid="tts-config-voice-select"
          >
            <optgroup label="American English">
              @for (opt of americanVoices; track opt.value) {
                <option
                  [value]="opt.value"
                  [selected]="opt.value === selectedVoice()"
                >
                  {{ opt.label }}
                </option>
              }
            </optgroup>
            <optgroup label="British English">
              @for (opt of britishVoices; track opt.value) {
                <option
                  [value]="opt.value"
                  [selected]="opt.value === selectedVoice()"
                >
                  {{ opt.label }}
                </option>
              }
            </optgroup>
          </select>
        </div>

        <div class="mt-2">
          @if (isTtsDownloading()) {
            <div
              class="flex items-center gap-2"
              data-testid="tts-config-download-status"
            >
              <progress
                class="progress progress-primary flex-1 h-2"
                [value]="ttsDownloadPercent() ?? 0"
                max="100"
              ></progress>
              <span class="text-[10px] text-base-content/60 w-20 text-right">
                @if (ttsDownloadPercent() !== null) {
                  Downloading {{ ttsDownloadPercent() }}%
                } @else {
                  Starting…
                }
              </span>
            </div>
          } @else {
            <div class="flex items-center justify-between gap-2">
              @if (ttsDownloaded()) {
                <span
                  class="text-[10px] text-success flex items-center gap-1"
                  data-testid="tts-config-download-status"
                >
                  <span class="text-success">●</span>
                  Downloaded
                </span>
              } @else {
                <span
                  class="text-[10px] text-base-content/50 flex items-center gap-1"
                  data-testid="tts-config-download-status"
                >
                  <span class="text-base-content/40">○</span>
                  Not downloaded
                </span>
              }

              <div class="flex items-center gap-1">
                <button
                  class="btn btn-ghost btn-xs gap-1"
                  [disabled]="isPreviewing() || isSavingVoice()"
                  (click)="previewVoice()"
                  data-testid="tts-config-preview-btn"
                >
                  <lucide-angular [img]="MicIcon" class="w-3 h-3" />
                  <span>{{ isPreviewing() ? 'Playing…' : 'Preview' }}</span>
                </button>
                <button
                  class="btn btn-outline btn-xs gap-1"
                  [disabled]="isSavingVoice() || ttsDownloaded()"
                  (click)="downloadTtsModel()"
                  data-testid="tts-config-download-btn"
                >
                  <lucide-angular [img]="DownloadIcon" class="w-3 h-3" />
                  <span>{{ ttsDownloaded() ? 'Ready' : 'Download' }}</span>
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class VoiceConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly downloadProgress = inject(VoiceDownloadProgressService);

  readonly MicIcon = Mic;
  readonly CheckCircleIcon = CheckCircle;
  readonly DownloadIcon = Download;

  readonly englishModels = ENGLISH_MODELS;
  readonly multilingualModels = MULTILINGUAL_MODELS;
  readonly americanVoices = TTS_VOICES_AMERICAN;
  readonly britishVoices = TTS_VOICES_BRITISH;

  readonly selectedModel = signal<string>('base.en');
  readonly downloaded = signal(false);
  readonly isDownloading = signal(false);
  readonly isSaving = signal(false);
  readonly savedRecently = signal(false);

  readonly selectedVoice = signal<string>('af_heart');
  readonly ttsDownloaded = signal(false);
  readonly isTtsDownloading = signal(false);
  readonly isSavingVoice = signal(false);
  readonly voiceSavedRecently = signal(false);
  readonly isPreviewing = signal(false);

  /** Live download percent for the selected model, or `null` before the first tick. */
  readonly downloadPercent = computed(() => {
    const tick = this.downloadProgress.progress();
    if (!tick || tick.model !== this.selectedModel()) return null;
    return tick.percent;
  });
  /** Live TTS download percent, keyed by the backend sentinel model id. */
  readonly ttsDownloadPercent = computed(() => {
    const tick = this.downloadProgress.progress();
    if (!tick || tick.model !== TTS_PROGRESS_MODEL) return null;
    return tick.percent;
  });
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadConfig(), this.loadTtsConfig()]);
  }

  async loadConfig(): Promise<void> {
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call(
        'voice:getConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok) {
        this.selectedModel.set(result.data.config.whisperModel);
        this.downloaded.set(result.data.config.downloaded ?? false);
      } else if (result.isSuccess() && !result.data.ok) {
        this.errorMessage.set(result.data.error);
      } else if (!result.isSuccess()) {
        this.errorMessage.set(
          result.error ?? 'Failed to load voice configuration',
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to load voice configuration',
      );
    }
  }

  async onModelChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    await this.saveConfig(value);
  }

  private async saveConfig(whisperModel: string): Promise<void> {
    this.errorMessage.set(null);
    this.savedRecently.set(false);
    this.isSaving.set(true);

    const previous = this.selectedModel();
    this.selectedModel.set(whisperModel);

    try {
      const result = await this.rpcService.call('voice:setConfig', {
        whisperModel,
      });
      if (result.isSuccess() && result.data.ok) {
        this.savedRecently.set(true);
        await this.refreshDownloadStatus();
      } else {
        this.selectedModel.set(previous);
        const message =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to save voice configuration');
        this.errorMessage.set(message);
      }
    } catch (error: unknown) {
      this.selectedModel.set(previous);
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to save voice configuration',
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Re-query whether the currently-selected model is present on disk. */
  private async refreshDownloadStatus(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'voice:getConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok) {
        this.downloaded.set(result.data.config.downloaded ?? false);
      }
    } catch {
      // Status is best-effort; leave the prior value on failure.
    }
  }

  async downloadModel(): Promise<void> {
    if (this.isDownloading()) return;
    this.errorMessage.set(null);
    this.downloadProgress.reset();
    this.isDownloading.set(true);

    try {
      const result = await this.rpcService.call(
        'voice:downloadModel',
        { model: this.selectedModel() },
        { timeout: DOWNLOAD_MODEL_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        this.downloaded.set(true);
      } else {
        const message =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to download voice model');
        this.errorMessage.set(message);
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to download voice model',
      );
    } finally {
      this.isDownloading.set(false);
      this.downloadProgress.reset();
    }
  }

  async loadTtsConfig(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'voice:getTtsConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok) {
        this.selectedVoice.set(result.data.config.voice);
        this.ttsDownloaded.set(result.data.config.downloaded ?? false);
      } else if (result.isSuccess() && !result.data.ok) {
        this.errorMessage.set(result.data.error);
      } else if (!result.isSuccess()) {
        this.errorMessage.set(
          result.error ?? 'Failed to load TTS configuration',
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to load TTS configuration',
      );
    }
  }

  async onVoiceChange(event: Event): Promise<void> {
    const voice = (event.target as HTMLSelectElement).value;
    this.errorMessage.set(null);
    this.voiceSavedRecently.set(false);
    this.isSavingVoice.set(true);

    const previous = this.selectedVoice();
    this.selectedVoice.set(voice);

    try {
      const result = await this.rpcService.call('voice:setTtsConfig', {
        voice,
      });
      if (result.isSuccess() && result.data.ok) {
        this.voiceSavedRecently.set(true);
      } else {
        this.selectedVoice.set(previous);
        const message =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to save TTS voice');
        this.errorMessage.set(message);
      }
    } catch (error: unknown) {
      this.selectedVoice.set(previous);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to save TTS voice',
      );
    } finally {
      this.isSavingVoice.set(false);
    }
  }

  async downloadTtsModel(): Promise<void> {
    if (this.isTtsDownloading()) return;
    this.errorMessage.set(null);
    this.downloadProgress.reset();
    this.isTtsDownloading.set(true);

    try {
      const result = await this.rpcService.call(
        'voice:downloadTtsModel',
        {} as Record<string, never>,
        { timeout: DOWNLOAD_MODEL_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        this.ttsDownloaded.set(true);
      } else {
        const message =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to download TTS model');
        this.errorMessage.set(message);
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to download TTS model',
      );
    } finally {
      this.isTtsDownloading.set(false);
      this.downloadProgress.reset();
    }
  }

  async previewVoice(): Promise<void> {
    if (this.isPreviewing()) return;
    this.errorMessage.set(null);
    this.isPreviewing.set(true);

    try {
      const result = await this.rpcService.call(
        'voice:synthesize',
        { text: PREVIEW_TEXT, voice: this.selectedVoice() },
        { timeout: SYNTHESIZE_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        this.ttsDownloaded.set(true);
        await this.playAudio(result.data.audioBase64, result.data.mimeType);
      } else {
        const message =
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to synthesize preview');
        this.errorMessage.set(message);
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to synthesize preview',
      );
    } finally {
      this.isPreviewing.set(false);
    }
  }

  private async playAudio(base64: string, mimeType: string): Promise<void> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    try {
      const audio = new Audio(url);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
