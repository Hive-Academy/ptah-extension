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
  Mic,
  CheckCircle,
  Download,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  VoiceProviderConfigLocalDto,
  VoiceInfoDto,
} from '@ptah-extension/shared';
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

/** Matches the backend TTS download-progress sentinel (`TTS_PROGRESS_MODEL`). */
const TTS_PROGRESS_MODEL = 'tts';
const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';
const DOWNLOAD_MODEL_TIMEOUT_MS = 30 * 60 * 1000;
const SYNTHESIZE_TIMEOUT_MS = 60 * 1000;

/** `owner/name` HuggingFace repo id shape (letters, digits, `._-`). */
const HF_REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/;

type ModelSource = 'curated' | 'hf' | 'dir';

interface VoiceGroup {
  readonly category: string;
  readonly voices: readonly VoiceInfoDto[];
}

/**
 * Local Kokoro (TTS) settings panel (FR-4.1, FR-6.2). Extracted from the legacy
 * voice-config Kokoro section; the voice list is fetched from
 * `voice:listVoices {providerId:'local'}` (backend-owned).
 *
 * Mirrors {@link LocalSttPanelComponent}: a source toggle (Curated / HF repo id
 * / Local folder) with a validated text input lets the user point Kokoro at a
 * custom HF repo id or an absolute local model folder. Unlike STT, the Kokoro
 * model source is TTS-specific, so the initial `modelSource`/`customModel` are
 * read from `voice:getTtsConfig` (the `config` input's `modelSource`/`customModel`
 * are the Whisper/STT source and must not be reused here).
 *
 * Preview + download are preserved and the TTS download-progress sentinel
 * `'tts'` is unchanged. Persists via `voice:setTtsConfig` (the current voice is
 * always sent as the last-known-good value; `modelSource`/`customModel` carry the
 * custom source) and emits `changed` so the container re-reads the backend config.
 */
@Component({
  selector: 'ptah-local-tts-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p class="text-xs text-base-content/70 mb-2">
      Kokoro voice used to read replies aloud. Apache-licensed, runs locally;
      the ~80 MB model downloads to
      <code class="text-[10px] bg-base-300 px-1 rounded">~/.ptah/models/</code>
      on first use.
    </p>

    @if (errorMessage(); as message) {
      <div class="text-xs text-error mb-2" data-testid="local-tts-panel-error">
        {{ message }}
      </div>
    }

    <!-- Source toggle -->
    <div
      class="flex items-center gap-1 mb-2"
      role="radiogroup"
      aria-label="Model source"
    >
      @for (opt of sourceOptions; track opt.value) {
        <button
          type="button"
          class="btn btn-xs flex-1"
          [class.btn-primary]="source() === opt.value"
          [class.btn-ghost]="source() !== opt.value"
          role="radio"
          [attr.aria-checked]="source() === opt.value"
          [disabled]="isSavingVoice()"
          (click)="onSourceChange(opt.value)"
          [attr.data-testid]="'local-tts-source-' + opt.value"
        >
          {{ opt.label }}
        </button>
      }
    </div>

    @if (source() !== 'curated') {
      <div class="mb-2">
        <div class="flex items-center gap-1">
          <input
            id="local-tts-custom"
            type="text"
            class="input input-bordered input-xs w-full"
            [class.input-error]="
              customModel().length > 0 && !customModelValid()
            "
            [value]="customModel()"
            [disabled]="isSavingVoice()"
            [placeholder]="
              source() === 'hf'
                ? 'owner/kokoro-model (HF repo id)'
                : 'Absolute path to model folder'
            "
            (input)="onCustomModelInput($event)"
            data-testid="local-tts-custom-input"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs"
            [disabled]="isSavingVoice() || !customModelValid()"
            (click)="saveCustomSource()"
            data-testid="local-tts-custom-save"
          >
            Save
          </button>
        </div>
        @if (customModel().length > 0 && !customModelValid()) {
          <p
            class="text-[10px] text-error mt-1"
            data-testid="local-tts-custom-hint"
          >
            {{
              source() === 'hf'
                ? 'Enter a valid HuggingFace repo id (owner/name).'
                : 'Enter an absolute folder path.'
            }}
          </p>
        }
      </div>
    }

    <div>
      <div class="flex items-center justify-between mb-1">
        <label
          for="local-tts-voice"
          class="text-xs font-medium text-base-content/70"
        >
          Voice
        </label>
        @if (savedRecently()) {
          <span
            class="text-[10px] text-success flex items-center gap-1"
            data-testid="local-tts-saved"
          >
            <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
            Saved
          </span>
        }
      </div>

      @if (isLoadingVoices()) {
        <div
          class="text-[10px] text-base-content/50"
          data-testid="local-tts-voices-loading"
        >
          Loading voices…
        </div>
      } @else {
        <select
          id="local-tts-voice"
          class="select select-bordered select-xs w-full"
          [value]="selectedVoice()"
          [disabled]="isSavingVoice()"
          (change)="onVoiceChange($event)"
          data-testid="local-tts-voice-select"
        >
          @for (group of voiceGroups(); track group.category) {
            <optgroup [label]="group.category">
              @for (voice of group.voices; track voice.id) {
                <option
                  [value]="voice.id"
                  [selected]="voice.id === selectedVoice()"
                >
                  {{ voice.label }}
                </option>
              }
            </optgroup>
          }
        </select>
      }
    </div>

    <div class="mt-2">
      @if (isTtsDownloading()) {
        <div
          class="flex items-center gap-2"
          data-testid="local-tts-download-status"
        >
          <progress
            class="progress progress-primary flex-1 h-2"
            [value]="ttsDownloadPercent() ?? 0"
            max="100"
            data-testid="local-tts-download-progress"
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
          @if (downloaded()) {
            <span
              class="text-[10px] text-success flex items-center gap-1"
              data-testid="local-tts-download-status"
            >
              <span class="text-success">●</span>
              Downloaded
            </span>
          } @else {
            <span
              class="text-[10px] text-base-content/50 flex items-center gap-1"
              data-testid="local-tts-download-status"
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
              data-testid="local-tts-preview-btn"
            >
              <lucide-angular [img]="MicIcon" class="w-3 h-3" />
              <span>{{ isPreviewing() ? 'Playing…' : 'Preview' }}</span>
            </button>
            <button
              class="btn btn-outline btn-xs gap-1"
              [disabled]="isSavingVoice() || !canDownload()"
              (click)="downloadTtsModel()"
              data-testid="local-tts-download-btn"
            >
              <lucide-angular [img]="DownloadIcon" class="w-3 h-3" />
              <span>{{ downloaded() ? 'Ready' : 'Download' }}</span>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class LocalTtsPanelComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly downloadProgress = inject(VoiceDownloadProgressService);

  readonly config = input.required<VoiceProviderConfigLocalDto>();
  readonly changed = output<void>();

  readonly MicIcon = Mic;
  readonly CheckCircleIcon = CheckCircle;
  readonly DownloadIcon = Download;

  readonly sourceOptions: readonly { value: ModelSource; label: string }[] = [
    { value: 'curated', label: 'Curated' },
    { value: 'hf', label: 'HF repo id' },
    { value: 'dir', label: 'Local folder' },
  ];

  readonly selectedVoice = linkedSignal(() => this.config().ttsVoice);
  readonly downloaded = computed(() => this.config().ttsDownloaded);

  // TTS model source is not carried by the `config` input (that DTO's
  // `modelSource`/`customModel` are the Whisper/STT source), so these are seeded
  // from `voice:getTtsConfig` in `ngOnInit` and updated optimistically on save.
  readonly source = signal<ModelSource>('curated');
  readonly customModel = signal('');

  readonly voices = signal<VoiceInfoDto[]>([]);
  readonly isLoadingVoices = signal(true);
  readonly isSavingVoice = signal(false);
  readonly savedRecently = signal(false);
  readonly isTtsDownloading = signal(false);
  readonly isPreviewing = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** True when the custom id/path passes basic shape validation. */
  readonly customModelValid = computed(() => {
    const value = this.customModel().trim();
    if (value.length === 0) return false;
    return this.source() === 'hf' ? HF_REPO_ID_RE.test(value) : true;
  });

  /** Download is only meaningful for the curated Kokoro model. */
  readonly canDownload = computed(
    () => this.source() === 'curated' && !this.downloaded(),
  );

  /** Group the backend voice list by its optional `category` for `<optgroup>`s. */
  readonly voiceGroups = computed<VoiceGroup[]>(() => {
    const groups = new Map<string, VoiceInfoDto[]>();
    for (const voice of this.voices()) {
      const category = voice.category ?? 'Voices';
      const bucket = groups.get(category);
      if (bucket) bucket.push(voice);
      else groups.set(category, [voice]);
    }
    return Array.from(groups, ([category, list]) => ({
      category,
      voices: list,
    }));
  });

  readonly ttsDownloadPercent = computed(() => {
    const tick = this.downloadProgress.progress();
    if (!tick || tick.model !== TTS_PROGRESS_MODEL) return null;
    return tick.percent;
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadVoices(), this.loadTtsConfig()]);
  }

  async loadVoices(): Promise<void> {
    this.isLoadingVoices.set(true);
    try {
      const result = await this.rpc.call('voice:listVoices', {
        providerId: 'local',
      });
      if (result.isSuccess() && result.data.ok) {
        this.voices.set(result.data.voices);
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to load voices'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to load voices',
      );
    } finally {
      this.isLoadingVoices.set(false);
    }
  }

  /** Seed the source toggle + custom id/path from the backend TTS config. */
  async loadTtsConfig(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'voice:getTtsConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok && result.data.config) {
        this.source.set(result.data.config.modelSource);
        this.customModel.set(result.data.config.customModel ?? '');
      }
    } catch {
      // Non-fatal: fall back to the 'curated' default; voice list still loads.
    }
  }

  onSourceChange(source: ModelSource): void {
    this.source.set(source);
    this.savedRecently.set(false);
    // Switching back to curated is an immediate, always-recoverable save.
    if (source === 'curated')
      void this.persist(this.selectedVoice(), 'curated');
  }

  onCustomModelInput(event: Event): void {
    this.customModel.set((event.target as HTMLInputElement).value);
    this.savedRecently.set(false);
  }

  saveCustomSource(): void {
    if (!this.customModelValid()) return;
    void this.persist(
      this.selectedVoice(),
      this.source(),
      this.customModel().trim(),
    );
  }

  async onVoiceChange(event: Event): Promise<void> {
    const voice = (event.target as HTMLSelectElement).value;
    const previous = this.selectedVoice();
    this.selectedVoice.set(voice);
    const customModel =
      this.source() === 'curated' ? undefined : this.customModel().trim();
    const ok = await this.persist(voice, this.source(), customModel);
    if (!ok) this.selectedVoice.set(previous);
  }

  /**
   * Persist the selected voice + model source via `voice:setTtsConfig`. The
   * current voice is always sent so a source change never drops it. Returns
   * `true` on success so callers can revert optimistic UI on failure.
   */
  private async persist(
    voice: string,
    modelSource: ModelSource,
    customModel?: string,
  ): Promise<boolean> {
    this.errorMessage.set(null);
    this.savedRecently.set(false);
    this.isSavingVoice.set(true);
    try {
      const result = await this.rpc.call('voice:setTtsConfig', {
        voice,
        modelSource,
        ...(customModel !== undefined ? { customModel } : {}),
      });
      if (result.isSuccess() && result.data.ok) {
        this.savedRecently.set(true);
        this.changed.emit();
        return true;
      }
      this.errorMessage.set(
        result.isSuccess() && !result.data.ok
          ? result.data.error
          : (result.error ?? 'Failed to save TTS configuration'),
      );
      return false;
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to save TTS configuration',
      );
      return false;
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
      const result = await this.rpc.call(
        'voice:downloadTtsModel',
        {} as Record<string, never>,
        { timeout: DOWNLOAD_MODEL_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        this.changed.emit();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to download TTS model'),
        );
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
      const result = await this.rpc.call(
        'voice:synthesize',
        { text: PREVIEW_TEXT, voice: this.selectedVoice() },
        { timeout: SYNTHESIZE_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        await this.playAudio(result.data.audioBase64, result.data.mimeType);
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to synthesize preview'),
        );
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
