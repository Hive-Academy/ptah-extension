import {
  Component,
  inject,
  input,
  output,
  computed,
  signal,
  linkedSignal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, CheckCircle, Download } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { VoiceProviderConfigLocalDto } from '@ptah-extension/shared';
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

type ModelSource = 'curated' | 'hf' | 'dir';

const DOWNLOAD_MODEL_TIMEOUT_MS = 30 * 60 * 1000;

/** `owner/name` HuggingFace repo id shape (letters, digits, `._-`). */
const HF_REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Local Whisper (STT) settings panel (FR-4.1, FR-6.2). Extracted from the legacy
 * voice-config Whisper section: curated model select PLUS a source toggle
 * (Curated / HF repo id / Local folder) with a validated text input for the
 * custom id/path. The download button + live progress bar are unchanged and
 * still driven by `VoiceDownloadProgressService`, keyed by the model name.
 *
 * The panel persists via `voice:setConfig` (curated name always sent as the
 * last-known-good value; `modelSource`/`customModel` carry the custom source)
 * and emits `changed` so the container re-reads the backend config.
 */
@Component({
  selector: 'ptah-local-stt-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p class="text-xs text-base-content/70 mb-2">
      Whisper model used for voice-to-text. Curated models download to
      <code class="text-[10px] bg-base-300 px-1 rounded">~/.ptah/models/</code>
      on first use.
    </p>

    @if (errorMessage(); as message) {
      <div class="text-xs text-error mb-2" data-testid="local-stt-panel-error">
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
          [disabled]="isSaving()"
          (click)="onSourceChange(opt.value)"
          [attr.data-testid]="'local-stt-source-' + opt.value"
        >
          {{ opt.label }}
        </button>
      }
    </div>

    <div>
      <div class="flex items-center justify-between mb-1">
        <label
          for="local-stt-model"
          class="text-xs font-medium text-base-content/70"
        >
          Whisper Model
        </label>
        @if (savedRecently()) {
          <span
            class="text-[10px] text-success flex items-center gap-1"
            data-testid="local-stt-saved"
          >
            <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
            Saved
          </span>
        }
      </div>

      @if (source() === 'curated') {
        <select
          id="local-stt-model"
          class="select select-bordered select-xs w-full"
          [value]="selectedModel()"
          [disabled]="isSaving()"
          (change)="onModelChange($event)"
          data-testid="local-stt-model-select"
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
      } @else {
        <div class="flex items-center gap-1">
          <input
            id="local-stt-custom"
            type="text"
            class="input input-bordered input-xs w-full"
            [class.input-error]="
              customModel().length > 0 && !customModelValid()
            "
            [value]="customModel()"
            [disabled]="isSaving()"
            [placeholder]="
              source() === 'hf'
                ? 'owner/whisper-model (HF repo id)'
                : 'Absolute path to model folder'
            "
            (input)="onCustomModelInput($event)"
            data-testid="local-stt-custom-input"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs"
            [disabled]="isSaving() || !customModelValid()"
            (click)="saveCustomSource()"
            data-testid="local-stt-custom-save"
          >
            Save
          </button>
        </div>
        @if (customModel().length > 0 && !customModelValid()) {
          <p
            class="text-[10px] text-error mt-1"
            data-testid="local-stt-custom-hint"
          >
            {{
              source() === 'hf'
                ? 'Enter a valid HuggingFace repo id (owner/name).'
                : 'Enter an absolute folder path.'
            }}
          </p>
        }
      }
    </div>

    <div class="mt-2">
      @if (isDownloading()) {
        <div
          class="flex items-center gap-2"
          data-testid="local-stt-download-status"
        >
          <progress
            class="progress progress-primary flex-1 h-2"
            [value]="downloadPercent() ?? 0"
            max="100"
            data-testid="local-stt-download-progress"
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
              data-testid="local-stt-download-status"
            >
              <span class="text-success">●</span>
              Downloaded
            </span>
          } @else {
            <span
              class="text-[10px] text-base-content/50 flex items-center gap-1"
              data-testid="local-stt-download-status"
            >
              <span class="text-base-content/40">○</span>
              Not downloaded
            </span>
          }

          <button
            class="btn btn-outline btn-xs gap-1"
            [disabled]="isSaving() || !canDownload()"
            (click)="downloadModel()"
            data-testid="local-stt-download-btn"
          >
            <lucide-angular [img]="DownloadIcon" class="w-3 h-3" />
            <span>{{ downloaded() ? 'Ready' : 'Download' }}</span>
          </button>
        </div>
      }
    </div>
  `,
})
export class LocalSttPanelComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly downloadProgress = inject(VoiceDownloadProgressService);

  readonly config = input.required<VoiceProviderConfigLocalDto>();
  readonly changed = output<void>();

  readonly CheckCircleIcon = CheckCircle;
  readonly DownloadIcon = Download;

  readonly englishModels = ENGLISH_MODELS;
  readonly multilingualModels = MULTILINGUAL_MODELS;
  readonly sourceOptions: readonly { value: ModelSource; label: string }[] = [
    { value: 'curated', label: 'Curated' },
    { value: 'hf', label: 'HF repo id' },
    { value: 'dir', label: 'Local folder' },
  ];

  // Editable drafts seeded from the config input; reset whenever the container
  // re-reads and passes a fresh config object (backend source of truth).
  readonly selectedModel = linkedSignal(() => this.config().whisperModel);
  readonly source = linkedSignal<ModelSource>(() => this.config().modelSource);
  readonly customModel = linkedSignal(() => this.config().customModel ?? '');
  readonly downloaded = computed(() => this.config().sttDownloaded);

  readonly isSaving = signal(false);
  readonly isDownloading = signal(false);
  readonly savedRecently = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** True when the custom id/path passes basic shape validation. */
  readonly customModelValid = computed(() => {
    const value = this.customModel().trim();
    if (value.length === 0) return false;
    return this.source() === 'hf' ? HF_REPO_ID_RE.test(value) : true;
  });

  /** Download is only meaningful for curated models that aren't present yet. */
  readonly canDownload = computed(
    () => this.source() === 'curated' && !this.downloaded(),
  );

  /** The identifier used both for `voice:downloadModel` and progress keying. */
  private readonly downloadKey = computed(() =>
    this.source() === 'curated'
      ? this.selectedModel()
      : this.customModel().trim(),
  );

  readonly downloadPercent = computed(() => {
    const tick = this.downloadProgress.progress();
    if (!tick || tick.model !== this.downloadKey()) return null;
    return tick.percent;
  });

  onSourceChange(source: ModelSource): void {
    this.source.set(source);
    this.savedRecently.set(false);
    // Switching back to curated is an immediate, always-recoverable save.
    if (source === 'curated')
      void this.persist(this.selectedModel(), 'curated');
  }

  onModelChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedModel.set(value);
    void this.persist(value, 'curated');
  }

  onCustomModelInput(event: Event): void {
    this.customModel.set((event.target as HTMLInputElement).value);
    this.savedRecently.set(false);
  }

  saveCustomSource(): void {
    if (!this.customModelValid()) return;
    void this.persist(
      this.selectedModel(),
      this.source(),
      this.customModel().trim(),
    );
  }

  private async persist(
    whisperModel: string,
    modelSource: ModelSource,
    customModel?: string,
  ): Promise<void> {
    this.errorMessage.set(null);
    this.savedRecently.set(false);
    this.isSaving.set(true);
    try {
      const result = await this.rpc.call('voice:setConfig', {
        whisperModel,
        modelSource,
        ...(customModel !== undefined ? { customModel } : {}),
      });
      if (result.isSuccess() && result.data.ok) {
        this.savedRecently.set(true);
        this.changed.emit();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to save voice configuration'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to save voice configuration',
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  async downloadModel(): Promise<void> {
    if (this.isDownloading()) return;
    this.errorMessage.set(null);
    this.downloadProgress.reset();
    this.isDownloading.set(true);
    try {
      const result = await this.rpc.call(
        'voice:downloadModel',
        { model: this.downloadKey() },
        { timeout: DOWNLOAD_MODEL_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.ok) {
        this.changed.emit();
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to download voice model'),
        );
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
}
