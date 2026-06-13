import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Mic, CheckCircle } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

interface WhisperModelOption {
  readonly value: string;
  readonly label: string;
}

const ENGLISH_MODELS: readonly WhisperModelOption[] = [
  { value: 'tiny.en', label: 'tiny.en (~75 MB, fastest)' },
  { value: 'base.en', label: 'base.en (~140 MB, default)' },
  { value: 'small.en', label: 'small.en (~470 MB, more accurate)' },
  { value: 'medium.en', label: 'medium.en (~1.5 GB)' },
] as const;

const MULTILINGUAL_MODELS: readonly WhisperModelOption[] = [
  { value: 'tiny', label: 'tiny (~75 MB, fastest)' },
  { value: 'base', label: 'base (~140 MB)' },
  { value: 'small', label: 'small (~470 MB)' },
  { value: 'medium', label: 'medium (~1.5 GB)' },
  { value: 'large-v3', label: 'large-v3 (~3 GB, most accurate)' },
] as const;

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
      </div>
    </div>
  `,
})
export class VoiceConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  readonly MicIcon = Mic;
  readonly CheckCircleIcon = CheckCircle;

  readonly englishModels = ENGLISH_MODELS;
  readonly multilingualModels = MULTILINGUAL_MODELS;

  readonly selectedModel = signal<string>('base.en');
  readonly isSaving = signal(false);
  readonly savedRecently = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
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
}
