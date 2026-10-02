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
import { LucideAngularModule, AlertCircle, Download } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { VoiceProviderConfigLocalDto } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
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
type WriteResult = { ok: true } | { ok: false; message: string };

const DOWNLOAD_MODEL_TIMEOUT_MS = 30 * 60 * 1000;

// F1: the backend returns raw error.message on failure, so a visible message
// is always one of these fixed sentences — never host error text.
const SAVE_FAILED_MESSAGE = 'Could not save the voice configuration.';
const DOWNLOAD_FAILED_MESSAGE = 'Could not download the voice model.';

/** `owner/name` HuggingFace repo id shape (letters, digits, `._-`). */
const HF_REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Local Whisper (STT) panel, drawer D-VOICE tab "Speech-to-text" (pattern map
 * V13-V16, V20): the existing controls reflowed as `table-xs` rows. Saves run
 * through {@link SettingsSaveFeedbackService.saveGeneric} — "Saved" only after
 * the write's own result, a failed write reverts the control and raises an
 * alert toast (D15), the "Saved" chip is gone (V20). Returning to Curated saves
 * immediately with Undo (V13); a custom HF id / folder is committed by its Save
 * button (V15). The download button + live progress bar are unchanged and still
 * driven by `VoiceDownloadProgressService`, keyed by the model name.
 */
@Component({
  selector: 'ptah-local-stt-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p class="text-xs text-base-content-muted mb-3">
      Whisper model used for voice-to-text. Curated models download to
      <code class="text-[10px] bg-base-300 px-1 rounded">~/.ptah/models/</code>
      on first use.
    </p>

    @if (errorMessage(); as message) {
      <div
        role="alert"
        data-testid="local-stt-panel-error"
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

    <table class="table table-xs" data-testid="local-stt-panel-table">
      <tbody>
        <!-- V13: source. Returning to Curated saves immediately; a custom source
             is committed by its Save button (V15). -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            Source
          </th>
          <td class="align-top">
            <div
              class="flex items-center gap-1"
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
                  [disabled]="saving()"
                  (click)="onSourceChange(opt.value)"
                  [attr.data-testid]="'local-stt-source-' + opt.value"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </td>
        </tr>

        <!-- V14 curated model select / V15 custom id or folder -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            Whisper model
          </th>
          <td class="align-top">
            @if (source() === 'curated') {
              <select
                id="local-stt-model"
                aria-label="Whisper model"
                class="select select-bordered select-xs w-full"
                [value]="selectedModel()"
                [disabled]="saving()"
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
                  aria-label="Custom model id or folder"
                  class="input input-bordered input-xs w-full"
                  [class.input-error]="
                    customModel().length > 0 && !customModelValid()
                  "
                  [value]="customModel()"
                  [disabled]="saving()"
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
                  [disabled]="saving() || !customModelValid()"
                  (click)="saveCustomSource()"
                  data-testid="local-stt-custom-save"
                >
                  Save
                </button>
              </div>
              @if (customModel().length > 0 && !customModelValid()) {
                <p
                  class="mt-1 flex items-center gap-1 text-[10px] text-base-content"
                  data-testid="local-stt-custom-hint"
                >
                  <lucide-angular
                    [img]="AlertCircleIcon"
                    class="w-3 h-3 text-error shrink-0"
                    aria-hidden="true"
                  />
                  {{
                    source() === 'hf'
                      ? 'Enter a valid HuggingFace repo id (owner/name).'
                      : 'Enter an absolute folder path.'
                  }}
                </p>
              }
            }
          </td>
        </tr>

        <!-- V16: download + live progress -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            Download
          </th>
          <td class="align-top">
            @if (isDownloading()) {
              <div
                class="flex items-center gap-2"
                data-testid="local-stt-download-status"
              >
                <progress
                  class="progress progress-primary h-2 flex-1"
                  [value]="downloadPercent() ?? 0"
                  max="100"
                  data-testid="local-stt-download-progress"
                ></progress>
                <span
                  class="text-[10px] text-base-content-muted w-20 text-right"
                >
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
                    class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                    data-testid="local-stt-download-status"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-success"
                      aria-hidden="true"
                    ></span>
                    Downloaded
                  </span>
                } @else {
                  <span
                    class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                    data-testid="local-stt-download-status"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-warning"
                      aria-hidden="true"
                    ></span>
                    Not downloaded
                  </span>
                }

                <button
                  type="button"
                  class="btn btn-outline btn-xs gap-1"
                  [disabled]="saving() || !canDownload()"
                  (click)="downloadModel()"
                  data-testid="local-stt-download-btn"
                >
                  <lucide-angular
                    [img]="DownloadIcon"
                    class="w-3 h-3"
                    aria-hidden="true"
                  />
                  <span>{{ downloaded() ? 'Ready' : 'Download' }}</span>
                </button>
              </div>
            }
          </td>
        </tr>
      </tbody>
    </table>
  `,
})
export class LocalSttPanelComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly downloadProgress = inject(VoiceDownloadProgressService);

  readonly config = input.required<VoiceProviderConfigLocalDto>();
  readonly changed = output<void>();

  readonly AlertCircleIcon = AlertCircle;
  readonly DownloadIcon = Download;

  readonly englishModels = ENGLISH_MODELS;
  readonly multilingualModels = MULTILINGUAL_MODELS;
  readonly sourceOptions: readonly { value: ModelSource; label: string }[] = [
    { value: 'curated', label: 'Curated' },
    { value: 'hf', label: 'HF repo id' },
    { value: 'dir', label: 'Local folder' },
  ];

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  // Editable drafts seeded from the config input; reset whenever the container
  // re-reads and passes a fresh config object (backend source of truth).
  readonly selectedModel = linkedSignal(() => this.config().whisperModel);
  readonly source = linkedSignal<ModelSource>(() => this.config().modelSource);
  readonly customModel = linkedSignal(() => this.config().customModel ?? '');
  readonly downloaded = computed(() => this.config().sttDownloaded);

  readonly isDownloading = signal(false);
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

  /**
   * V13: returning to Curated saves immediately (S-sel, Undo restores the
   * previous source). Picking a custom source only switches the view; the
   * Save button commits it (V15, S-explicit). Abandoning an unsaved custom
   * draft needs no write — the backend is already on Curated.
   */
  onSourceChange(next: ModelSource): void {
    if (next === this.source()) return;
    if (next !== 'curated') {
      this.source.set(next);
      return;
    }
    const cfg = this.config();
    if (cfg.modelSource === 'curated') {
      this.source.set('curated');
      return;
    }
    const previousSource = cfg.modelSource;
    const previousCustom = cfg.customModel;
    void this.feedback.saveGeneric({
      label: 'speech-to-text model source',
      write: () => this.writeSource('curated', undefined, previousSource),
      undo: () => this.writeSource(previousSource, previousCustom, 'curated'),
    });
  }

  /** V14: saves on selection with Undo; a failed write reverts the select (D15). */
  async onModelChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const next = select.value;
    const previous = this.selectedModel();
    if (next === previous) return;
    await this.feedback.saveGeneric({
      label: 'speech-to-text model',
      write: () => this.writeModel(next, previous),
      undo: () => this.writeModel(previous, next),
    });
    // The binding alone does not repaint when the signal ends where it started.
    select.value = this.selectedModel();
  }

  onCustomModelInput(event: Event): void {
    this.customModel.set((event.target as HTMLInputElement).value);
  }

  /**
   * V15: explicit save of the custom id/path (S-explicit, no Undo). The draft
   * stays in the field on failure so it can be retried, like the web-search key
   * editor (Batch 45); the failure shows inline and as an alert toast.
   */
  saveCustomSource(): void {
    if (!this.customModelValid()) return;
    const modelSource = this.source();
    const customModel = this.customModel().trim();
    void this.feedback.saveGeneric({
      label: 'speech-to-text model source',
      write: () =>
        this.setConfig({
          whisperModel: this.selectedModel(),
          modelSource,
          customModel,
        }),
      undo: null,
    });
  }

  /** Shows `next` while it saves; restores `fallback` when the write fails (D15). */
  private async writeSource(
    next: ModelSource,
    nextCustom: string | undefined,
    fallback: ModelSource,
  ): Promise<WriteResult> {
    this.source.set(next);
    if (nextCustom !== undefined) this.customModel.set(nextCustom);
    const result = await this.setConfig({
      whisperModel: this.selectedModel(),
      modelSource: next,
      ...(nextCustom !== undefined ? { customModel: nextCustom } : {}),
    });
    if (!result.ok) this.source.set(fallback);
    return result;
  }

  private async writeModel(
    next: string,
    fallback: string,
  ): Promise<WriteResult> {
    this.selectedModel.set(next);
    const result = await this.setConfig({
      whisperModel: next,
      modelSource: 'curated',
    });
    if (!result.ok) this.selectedModel.set(fallback);
    return result;
  }

  /**
   * `voice:setConfig` (curated name always sent as the last-known-good value;
   * `modelSource`/`customModel` carry the custom source). Emits `changed` on
   * success so the container re-reads the backend config.
   */
  private async setConfig(params: {
    whisperModel: string;
    modelSource: ModelSource;
    customModel?: string;
  }): Promise<WriteResult> {
    this.errorMessage.set(null);
    try {
      const result = await this.rpc.call('voice:setConfig', params);
      if (result.isSuccess() && result.data.ok) {
        this.changed.emit();
        return { ok: true };
      }
      this.errorMessage.set(SAVE_FAILED_MESSAGE);
      return { ok: false, message: SAVE_FAILED_MESSAGE };
    } catch {
      this.errorMessage.set(SAVE_FAILED_MESSAGE);
      return { ok: false, message: SAVE_FAILED_MESSAGE };
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
        this.errorMessage.set(DOWNLOAD_FAILED_MESSAGE);
      }
    } catch {
      this.errorMessage.set(DOWNLOAD_FAILED_MESSAGE);
    } finally {
      this.isDownloading.set(false);
      this.downloadProgress.reset();
    }
  }
}