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
import { LucideAngularModule, AlertCircle, Mic, Download } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  VoiceProviderConfigLocalDto,
  VoiceInfoDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

/** Matches the backend TTS download-progress sentinel (`TTS_PROGRESS_MODEL`). */
const TTS_PROGRESS_MODEL = 'tts';
const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog.';
const DOWNLOAD_MODEL_TIMEOUT_MS = 30 * 60 * 1000;
const SYNTHESIZE_TIMEOUT_MS = 60 * 1000;

// F1: the backend returns raw error.message on failure, so a visible message
// is always one of these fixed sentences — never host error text.
const SAVE_FAILED_MESSAGE = 'Could not save the text-to-speech configuration.';
const LOAD_VOICES_FAILED_MESSAGE = 'Could not load the voices.';
const DOWNLOAD_FAILED_MESSAGE = 'Could not download the text-to-speech model.';
const PREVIEW_FAILED_MESSAGE = 'Could not play the preview.';

/** `owner/name` HuggingFace repo id shape (letters, digits, `._-`). */
const HF_REPO_ID_RE = /^[\w.-]+\/[\w.-]+$/;

type ModelSource = 'curated' | 'hf' | 'dir';
type WriteResult = { ok: true } | { ok: false; message: string };

interface VoiceGroup {
  readonly category: string;
  readonly voices: readonly VoiceInfoDto[];
}

/**
 * Local Kokoro (TTS) panel, drawer D-VOICE tab "Text-to-speech" (pattern map
 * V13, V15, V17-V20; FR-4.1, FR-6.2): the existing controls reflowed as
 * `table-xs` rows. Saves run through
 * {@link SettingsSaveFeedbackService.saveGeneric} — "Saved" only after the
 * write's own result, a failed write reverts the control and raises an alert
 * toast (D15), the "Saved" chip is gone (V20). The voice list comes from
 * `voice:listVoices {providerId:'local'}` (backend-owned).
 *
 * A source toggle (Curated / HF repo id / Local folder) with a validated text
 * input points Kokoro at a custom HF repo id or an absolute model folder.
 * Unlike STT, the Kokoro model source is TTS-specific, so `modelSource` /
 * `customModel` are seeded from `voice:getTtsConfig` (the `config` input's
 * fields are the Whisper/STT source and must not be reused here); the saved
 * values are tracked in `savedSource` / `savedCustom` for the Curated-return
 * Undo. A voice write is voice-only: it never persists an unsaved source draft
 * as a side effect (FR-4.4).
 *
 * Preview + download are preserved and the TTS download-progress sentinel
 * `'tts'` is unchanged. Persists via `voice:setTtsConfig` and emits `changed`
 * so the container re-reads the backend config.
 */
@Component({
  selector: 'ptah-local-tts-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p class="text-xs text-base-content-muted mb-3">
      Kokoro voice used to read replies aloud. Apache-licensed, runs locally;
      the ~80 MB model downloads to
      <code class="text-[10px] bg-base-300 px-1 rounded">~/.ptah/models/</code>
      on first use.
    </p>

    @if (errorMessage(); as message) {
      <div
        role="alert"
        data-testid="local-tts-panel-error"
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

    <table class="table table-xs" data-testid="local-tts-panel-table">
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
                  [attr.data-testid]="'local-tts-source-' + opt.value"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </td>
        </tr>

        <!-- V15: custom id or folder (only for non-curated sources) -->
        @if (source() !== 'curated') {
          <tr>
            <th
              scope="row"
              class="w-24 align-top font-medium text-base-content"
            >
              Custom model
            </th>
            <td class="align-top">
              <div class="flex items-center gap-1">
                <input
                  id="local-tts-custom"
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
                      ? 'owner/kokoro-model (HF repo id)'
                      : 'Absolute path to model folder'
                  "
                  (input)="onCustomModelInput($event)"
                  data-testid="local-tts-custom-input"
                />
                <button
                  type="button"
                  class="btn btn-primary btn-xs"
                  [disabled]="saving() || !customModelValid()"
                  (click)="saveCustomSource()"
                  data-testid="local-tts-custom-save"
                >
                  Save
                </button>
              </div>
              @if (customModel().length > 0 && !customModelValid()) {
                <p
                  class="mt-1 flex items-center gap-1 text-[10px] text-base-content"
                  data-testid="local-tts-custom-hint"
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
            </td>
          </tr>
        }

        <!-- V17: Kokoro voice -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            Voice
          </th>
          <td class="align-top">
            @if (isLoadingVoices()) {
              <div
                class="text-[10px] text-base-content-muted"
                data-testid="local-tts-voices-loading"
              >
                Loading voices…
              </div>
            } @else {
              <select
                id="local-tts-voice"
                aria-label="Voice"
                class="select select-bordered select-xs w-full"
                [value]="selectedVoice()"
                [disabled]="saving()"
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
          </td>
        </tr>

        <!-- V18/V19: preview + download + live progress -->
        <tr>
          <th scope="row" class="w-24 align-top font-medium text-base-content">
            Download
          </th>
          <td class="align-top">
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
                <span class="text-[10px] text-base-content-muted w-20 text-right">
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
                    class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                    data-testid="local-tts-download-status"
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
                    data-testid="local-tts-download-status"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-warning"
                      aria-hidden="true"
                    ></span>
                    Not downloaded
                  </span>
                }

                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs gap-1"
                    [disabled]="isPreviewing() || saving()"
                    (click)="previewVoice()"
                    data-testid="local-tts-preview-btn"
                  >
                    <lucide-angular
                      [img]="MicIcon"
                      class="w-3 h-3"
                      aria-hidden="true"
                    />
                    <span>{{ isPreviewing() ? 'Playing…' : 'Preview' }}</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline btn-xs gap-1"
                    [disabled]="saving() || !canDownload()"
                    (click)="downloadTtsModel()"
                    data-testid="local-tts-download-btn"
                  >
                    <lucide-angular
                      [img]="DownloadIcon"
                      class="w-3 h-3"
                      aria-hidden="true"
                    />
                    <span>{{ downloaded() ? 'Ready' : 'Download' }}</span>
                  </button>
                </div>
              </div>
            }
          </td>
        </tr>
      </tbody>
    </table>
  `,
})
export class LocalTtsPanelComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly downloadProgress = inject(VoiceDownloadProgressService);

  readonly config = input.required<VoiceProviderConfigLocalDto>();
  readonly changed = output<void>();

  readonly AlertCircleIcon = AlertCircle;
  readonly MicIcon = Mic;
  readonly DownloadIcon = Download;

  readonly sourceOptions: readonly { value: ModelSource; label: string }[] = [
    { value: 'curated', label: 'Curated' },
    { value: 'hf', label: 'HF repo id' },
    { value: 'dir', label: 'Local folder' },
  ];

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  readonly selectedVoice = linkedSignal(() => this.config().ttsVoice);
  readonly downloaded = computed(() => this.config().ttsDownloaded);

  // The TTS model source is not carried by the `config` input (that DTO's
  // `modelSource`/`customModel` are the Whisper/STT source), so the draft is
  // seeded from `voice:getTtsConfig` in `ngOnInit` and the saved values are
  // tracked separately for the Curated-return Undo.
  readonly source = signal<ModelSource>('curated');
  readonly customModel = signal('');
  private readonly savedSource = signal<ModelSource>('curated');
  private readonly savedCustom = signal<string | undefined>(undefined);

  readonly voices = signal<VoiceInfoDto[]>([]);
  readonly isLoadingVoices = signal(true);
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
        this.errorMessage.set(LOAD_VOICES_FAILED_MESSAGE);
      }
    } catch {
      this.errorMessage.set(LOAD_VOICES_FAILED_MESSAGE);
    } finally {
      this.isLoadingVoices.set(false);
    }
  }

  /** Seed the source toggle, custom id/path and the saved-value tracking from the backend. */
  async loadTtsConfig(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'voice:getTtsConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok && result.data.config) {
        this.source.set(result.data.config.modelSource);
        this.customModel.set(result.data.config.customModel ?? '');
        this.savedSource.set(result.data.config.modelSource);
        this.savedCustom.set(result.data.config.customModel);
      }
    } catch {
      // Non-fatal: fall back to the 'curated' default; voice list still loads.
    }
  }

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
    if (this.savedSource() === 'curated') {
      this.source.set('curated');
      return;
    }
    const previousSource = this.savedSource();
    const previousCustom = this.savedCustom();
    void this.feedback.saveGeneric({
      label: 'text-to-speech model source',
      write: () => this.writeSource('curated', undefined, previousSource),
      undo: () => this.writeSource(previousSource, previousCustom, 'curated'),
    });
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
      label: 'text-to-speech model source',
      write: async () => {
        const result = await this.setTtsConfig({
          voice: this.selectedVoice(),
          modelSource,
          customModel,
        });
        if (result.ok) {
          this.savedSource.set(modelSource);
          this.savedCustom.set(customModel);
        }
        return result;
      },
      undo: null,
    });
  }

  /** V17: saves on selection with Undo; a failed write reverts the select (D15). */
  async onVoiceChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const next = select.value;
    const previous = this.selectedVoice();
    if (next === previous) return;
    await this.feedback.saveGeneric({
      label: 'text-to-speech voice',
      write: () => this.writeVoice(next, previous),
      undo: () => this.writeVoice(previous, next),
    });
    // The binding alone does not repaint when the signal ends where it started.
    select.value = this.selectedVoice();
  }

  /**
   * Voice-only write: the Kokoro model-source keys stay untouched so an unsaved
   * source draft is never persisted as a side effect (FR-4.4). Shows `next`
   * while it saves; restores `fallback` when the write fails (D15).
   */
  private async writeVoice(
    next: string,
    fallback: string,
  ): Promise<WriteResult> {
    this.selectedVoice.set(next);
    const result = await this.setTtsConfig({ voice: next });
    if (!result.ok) this.selectedVoice.set(fallback);
    return result;
  }

  /** Same as {@link writeVoice}, for the model-source fields. */
  private async writeSource(
    next: ModelSource,
    nextCustom: string | undefined,
    fallback: ModelSource,
  ): Promise<WriteResult> {
    this.source.set(next);
    if (nextCustom !== undefined) this.customModel.set(nextCustom);
    const result = await this.setTtsConfig({
      voice: this.selectedVoice(),
      modelSource: next,
      ...(nextCustom !== undefined ? { customModel: nextCustom } : {}),
    });
    if (!result.ok) {
      this.source.set(fallback);
      return result;
    }
    this.savedSource.set(next);
    if (nextCustom !== undefined) this.savedCustom.set(nextCustom);
    return result;
  }

  /**
   * `voice:setTtsConfig`. Emits `changed` on success so the container re-reads
   * the backend config.
   */
  private async setTtsConfig(params: {
    voice: string;
    modelSource?: ModelSource;
    customModel?: string;
  }): Promise<WriteResult> {
    this.errorMessage.set(null);
    try {
      const result = await this.rpc.call('voice:setTtsConfig', params);
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
        this.errorMessage.set(DOWNLOAD_FAILED_MESSAGE);
      }
    } catch {
      this.errorMessage.set(DOWNLOAD_FAILED_MESSAGE);
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
        this.errorMessage.set(PREVIEW_FAILED_MESSAGE);
      }
    } catch {
      this.errorMessage.set(PREVIEW_FAILED_MESSAGE);
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