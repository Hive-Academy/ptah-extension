import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Mic, Volume2 } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  VoiceProviderCapabilityDto,
  VoiceProviderConfigDto,
} from '@ptah-extension/shared';
import { LocalSttPanelComponent } from './local-stt-panel.component';
import { LocalTtsPanelComponent } from './local-tts-panel.component';
import { ElevenLabsPanelComponent } from './elevenlabs-panel.component';

type VoiceProviderId = 'local' | 'elevenlabs';

/**
 * Voice settings container (FR-6). Renders one provider `<select>` per direction
 * (STT / TTS) populated from `voice:listProviders`, then delegates the concrete
 * controls to exactly one panel per direction via `@switch` on the selected
 * provider. Provider changes persist through `voice:setProviderConfig` with an
 * optimistic-revert pattern; on success the provider config is re-read so the
 * panels reflect the backend truth (downloaded state, saved fields).
 *
 * No provider-specific markup lives here — the legacy Whisper/Kokoro sections
 * moved into `LocalSttPanelComponent` / `LocalTtsPanelComponent` (FR-6.6).
 * Signals + `inject()`, OnPush, new control flow, no `[innerHTML]`, shared types
 * only (frontend↔backend isolation).
 */
@Component({
  selector: 'ptah-voice-config',
  standalone: true,
  imports: [
    LucideAngularModule,
    LocalSttPanelComponent,
    LocalTtsPanelComponent,
    ElevenLabsPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="MicIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Voice Providers
          </h2>
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Pick the speech-to-text and text-to-speech engines used by the chat
          mic and messaging-gateway voice notes. Local engines run offline;
          cloud engines require an API key.
        </p>

        @if (errorMessage(); as message) {
          <div class="text-xs text-error mb-2" data-testid="voice-config-error">
            {{ message }}
          </div>
        }

        @if (isLoading()) {
          <div
            class="text-xs text-base-content/50"
            data-testid="voice-config-loading"
          >
            Loading voice providers…
          </div>
        }

        <!-- Speech-to-Text -->
        <div class="mb-3">
          <div class="flex items-center gap-1 mb-1">
            <lucide-angular
              [img]="MicIcon"
              class="w-3 h-3 text-base-content/60"
            />
            <label
              for="voice-stt-provider"
              class="text-xs font-medium text-base-content/70"
            >
              Speech-to-Text Provider
            </label>
          </div>
          <select
            id="voice-stt-provider"
            class="select select-bordered select-xs w-full"
            [value]="sttProviderId()"
            [disabled]="isSavingStt()"
            (change)="onSttProviderChange($event)"
            data-testid="voice-stt-provider-select"
          >
            @for (provider of sttProviders(); track provider.id) {
              <option
                [value]="provider.id"
                [selected]="provider.id === sttProviderId()"
                [disabled]="!provider.available"
                [title]="provider.unavailableReason ?? ''"
              >
                {{ provider.label
                }}{{ provider.available ? '' : ' (unavailable)' }}
              </option>
            }
          </select>
        </div>

        @if (config(); as cfg) {
          @switch (sttProviderId()) {
            @case ('local') {
              <ptah-local-stt-panel
                [config]="cfg.local"
                (changed)="reloadConfig()"
              />
            }
            @case ('elevenlabs') {
              <ptah-elevenlabs-panel
                direction="stt"
                [config]="cfg.elevenlabs"
                (changed)="reloadConfig()"
              />
            }
          }
        }

        <div class="divider my-3 text-[10px] text-base-content/40">
          Text-to-Speech
        </div>

        <!-- Text-to-Speech -->
        <div class="mb-3">
          <div class="flex items-center gap-1 mb-1">
            <lucide-angular
              [img]="Volume2Icon"
              class="w-3 h-3 text-base-content/60"
            />
            <label
              for="voice-tts-provider"
              class="text-xs font-medium text-base-content/70"
            >
              Text-to-Speech Provider
            </label>
          </div>
          <select
            id="voice-tts-provider"
            class="select select-bordered select-xs w-full"
            [value]="ttsProviderId()"
            [disabled]="isSavingTts()"
            (change)="onTtsProviderChange($event)"
            data-testid="voice-tts-provider-select"
          >
            @for (provider of ttsProviders(); track provider.id) {
              <option
                [value]="provider.id"
                [selected]="provider.id === ttsProviderId()"
                [disabled]="!provider.available"
                [title]="provider.unavailableReason ?? ''"
              >
                {{ provider.label
                }}{{ provider.available ? '' : ' (unavailable)' }}
              </option>
            }
          </select>
        </div>

        @if (config(); as cfg) {
          @switch (ttsProviderId()) {
            @case ('local') {
              <ptah-local-tts-panel
                [config]="cfg.local"
                (changed)="reloadConfig()"
              />
            }
            @case ('elevenlabs') {
              <ptah-elevenlabs-panel
                direction="tts"
                [config]="cfg.elevenlabs"
                (changed)="reloadConfig()"
              />
            }
          }
        }
      </div>
    </div>
  `,
})
export class VoiceConfigComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);

  readonly MicIcon = Mic;
  readonly Volume2Icon = Volume2;

  readonly providers = signal<VoiceProviderCapabilityDto[]>([]);
  readonly config = signal<VoiceProviderConfigDto | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isSavingStt = signal(false);
  readonly isSavingTts = signal(false);

  readonly sttProviders = computed(() =>
    this.providers().filter((p) => p.supports.stt),
  );
  readonly ttsProviders = computed(() =>
    this.providers().filter((p) => p.supports.tts),
  );
  readonly sttProviderId = computed<VoiceProviderId>(
    () => (this.config()?.sttProvider as VoiceProviderId) ?? 'local',
  );
  readonly ttsProviderId = computed<VoiceProviderId>(
    () => (this.config()?.ttsProvider as VoiceProviderId) ?? 'local',
  );

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadProviders(), this.reloadConfig()]);
    this.isLoading.set(false);
  }

  async loadProviders(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'voice:listProviders',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok) {
        this.providers.set(result.data.providers);
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to load voice providers'),
        );
      }
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to load voice providers',
      );
    }
  }

  async reloadConfig(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'voice:getProviderConfig',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data.ok) {
        this.config.set(result.data.config);
      } else {
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to load voice configuration'),
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

  onSttProviderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as VoiceProviderId;
    void this.changeProvider('stt', value);
  }

  onTtsProviderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as VoiceProviderId;
    void this.changeProvider('tts', value);
  }

  /**
   * Persist a provider change with optimistic UI + revert-on-failure. On success
   * the full config is re-read so downstream panels reflect the backend state.
   */
  private async changeProvider(
    direction: 'stt' | 'tts',
    providerId: VoiceProviderId,
  ): Promise<void> {
    const current = this.config();
    if (!current) return;
    const previous =
      direction === 'stt' ? current.sttProvider : current.ttsProvider;
    if (previous === providerId) return;

    const saving = direction === 'stt' ? this.isSavingStt : this.isSavingTts;
    this.errorMessage.set(null);
    saving.set(true);

    // Optimistic update so the @switch flips immediately.
    this.config.set(
      direction === 'stt'
        ? { ...current, sttProvider: providerId }
        : { ...current, ttsProvider: providerId },
    );

    try {
      const result = await this.rpc.call(
        'voice:setProviderConfig',
        direction === 'stt'
          ? { sttProvider: providerId }
          : { ttsProvider: providerId },
      );
      if (result.isSuccess() && result.data.ok) {
        await this.reloadConfig();
      } else {
        this.config.set(current);
        this.errorMessage.set(
          result.isSuccess() && !result.data.ok
            ? result.data.error
            : (result.error ?? 'Failed to switch voice provider'),
        );
      }
    } catch (error: unknown) {
      this.config.set(current);
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to switch voice provider',
      );
    } finally {
      saving.set(false);
    }
  }
}
