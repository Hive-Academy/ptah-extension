import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
  Mic,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type {
  VoiceProviderCapabilityDto,
  VoiceProviderConfigDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  VoiceDetailsDrawerComponent,
  type VoiceDirection,
} from './voice-details-drawer.component';

type VoiceProviderId = 'local' | 'elevenlabs';
type WriteResult = { ok: true } | { ok: false; message: string };

interface EngineStatus {
  readonly label: string;
  readonly dot: string;
}

/** One matrix row per direction (pattern map V10-V12). */
interface EngineRow {
  readonly direction: VoiceDirection;
  readonly name: string;
  readonly providerId: VoiceProviderId;
  readonly providerLabel: string;
  readonly options: readonly VoiceProviderCapabilityDto[];
  readonly modelLabel: string;
  readonly detail: string;
  readonly status: EngineStatus;
}

const READY: EngineStatus = { label: 'Ready', dot: 'bg-success' };
const NOT_DOWNLOADED: EngineStatus = { label: 'Not downloaded', dot: 'bg-warning' };
const NO_KEY: EngineStatus = { label: 'No key', dot: 'bg-warning' };

function asProviderId(value: string | undefined): VoiceProviderId {
  return value === 'elevenlabs' ? 'elevenlabs' : 'local';
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Voice engines card on the Search & Voice tab (pattern map V9-V12, P2 + P4).
 *
 * A `table-xs` matrix with one row per direction: the provider cell opens a P5 popover listing every
 * provider for that direction (an unavailable one stays disabled with its reason as visible text), the
 * Model / Voice cell shows the active choice, the Status cell summarises readiness from the provider
 * config, and Details opens drawer D-VOICE on that direction's tab. A provider change saves on
 * selection through {@link SettingsSaveFeedbackService.saveGeneric}: "Saved" only after the write's
 * own result, a failed write reverts the row and raises an alert toast, Undo writes the previous
 * provider (D15). The drawer, which hosts the existing panels, is loaded only when first opened.
 */
@Component({
  selector: 'ptah-voice-config',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, VoiceDetailsDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="card bg-base-200 border border-base-300 p-3" aria-labelledby="voice-engines-heading">
      <div class="flex items-center gap-1.5 mb-2">
        <lucide-angular [img]="MicIcon" class="w-4 h-4 text-secondary" aria-hidden="true" />
        <h2 id="voice-engines-heading" class="text-xs font-bold uppercase tracking-wider text-base-content">
          Voice engines
        </h2>
      </div>

      <p class="text-xs text-base-content-muted mb-3">
        Pick the speech-to-text and text-to-speech engines used by the chat
        mic and messaging-gateway voice notes. Local engines run offline;
        cloud engines require an API key.
      </p>

      @if (errorMessage(); as message) {
        <div role="alert" data-testid="voice-config-error"
          class="mb-3 flex items-center gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content">
          <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
          {{ message }}
        </div>
      }

      @if (isLoading()) {
        <p class="text-xs text-base-content-muted" role="status" data-testid="voice-config-loading">
          Loading voice providers…
        </p>
      } @else if (rows().length) {
        <div class="overflow-x-auto">
          <table class="table table-xs" data-testid="voice-engines-matrix">
            <thead>
              <tr>
                <th scope="col">Direction</th>
                <th scope="col">Provider</th>
                <th scope="col">Model / Voice</th>
                <th scope="col">Status</th>
                <th class="text-right" scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.direction) {
                <tr [attr.data-testid]="'voice-engine-row-' + row.direction">
                  <th scope="row" class="font-bold text-base-content">{{ row.name }}</th>
                  <td>
                    <ptah-native-popover [isOpen]="picker() === row.direction" placement="bottom-start"
                      backdropClass="transparent" (closed)="picker.set(null)">
                      <button type="button" trigger class="btn btn-ghost btn-xs gap-1 px-1.5 font-normal text-base-content"
                        [disabled]="saving()" (click)="picker.set(row.direction)"
                        [attr.aria-label]="row.name + ' provider: ' + row.providerLabel + '. Change provider'"
                        aria-haspopup="dialog" [attr.aria-expanded]="picker() === row.direction"
                        [attr.data-testid]="'voice-provider-btn-' + row.direction">
                        {{ row.providerLabel }}
                        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3 text-base-content-muted" aria-hidden="true" />
                      </button>
                      <div content class="w-72 p-3 text-xs" role="dialog" [attr.aria-label]="row.name + ' provider'">
                        <p class="mb-2 font-bold text-base-content">{{ row.name }} provider</p>
                        <div role="radiogroup" [attr.aria-label]="row.name + ' provider'" class="space-y-1">
                          @for (option of row.options; track option.id) {
                            <button type="button" role="radio" [attr.aria-checked]="option.id === row.providerId"
                              class="flex w-full items-start gap-2 rounded border border-base-300 p-2 text-left text-base-content hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60"
                              [disabled]="!option.available || saving()"
                              [attr.aria-describedby]="option.available ? null : 'voice-reason-' + row.direction + '-' + option.id"
                              (click)="chooseProvider(row.direction, option.id)"
                              [attr.data-testid]="'voice-provider-option-' + row.direction + '-' + option.id">
                              <lucide-angular [img]="CheckIcon" class="mt-0.5 w-3 h-3 shrink-0 text-primary"
                                [class.invisible]="option.id !== row.providerId" aria-hidden="true" />
                              <span class="min-w-0">
                                <span class="block font-semibold">{{ option.label }}</span>
                                @if (!option.available) {
                                  <span class="block text-[10px] text-base-content-muted"
                                    [id]="'voice-reason-' + row.direction + '-' + option.id"
                                    [attr.data-testid]="'voice-provider-reason-' + row.direction + '-' + option.id">
                                    Unavailable: {{ option.unavailableReason ?? 'not available on this machine' }}
                                  </span>
                                }
                              </span>
                            </button>
                          }
                        </div>
                      </div>
                    </ptah-native-popover>
                  </td>
                  <td>
                    <span class="font-mono text-base-content" [attr.data-testid]="'voice-engine-model-' + row.direction">{{ row.modelLabel }}</span>
                  </td>
                  <td>
                    <span class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                      [attr.data-testid]="'voice-engine-status-' + row.direction">
                      <span [class]="'w-1.5 h-1.5 rounded-full ' + row.status.dot" aria-hidden="true"></span>
                      {{ row.status.label }}
                    </span>
                  </td>
                  <td class="text-right">
                    <button type="button" class="btn btn-ghost btn-xs btn-square" (click)="openDetails(row.direction)"
                      [attr.aria-label]="row.name + ' details: ' + row.detail"
                      [attr.data-testid]="'voice-engine-details-' + row.direction">
                      <lucide-angular [img]="ChevronRightIcon" class="w-3.5 h-3.5 text-base-content" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <!-- Lazy: the drawer and the panels it hosts load the first time a Details button is used. -->
    @defer (when drawerDirection() !== null) {
      <ptah-voice-details-drawer [(direction)]="drawerDirection" [config]="config()"
        (closed)="drawerDirection.set(null)" (changed)="reloadConfig()" />
    }
  `,
})
export class VoiceConfigComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly MicIcon = Mic;
  readonly AlertCircleIcon = AlertCircle;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly CheckIcon = Check;

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  readonly providers = signal<VoiceProviderCapabilityDto[]>([]);
  readonly config = signal<VoiceProviderConfigDto | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isLoading = signal(true);
  /** Direction whose provider popover is open. */
  readonly picker = signal<VoiceDirection | null>(null);
  /** Direction whose drawer tab is open; `null` closes drawer D-VOICE. */
  readonly drawerDirection = signal<VoiceDirection | null>(null);

  readonly sttProviders = computed(() => this.providers().filter((p) => p.supports.stt));
  readonly ttsProviders = computed(() => this.providers().filter((p) => p.supports.tts));
  readonly sttProviderId = computed(() => asProviderId(this.config()?.sttProvider));
  readonly ttsProviderId = computed(() => asProviderId(this.config()?.ttsProvider));

  readonly rows = computed<EngineRow[]>(() => {
    const cfg = this.config();
    if (!cfg) return [];
    const label = (id: VoiceProviderId) =>
      this.providers().find((p) => p.id === id)?.label ?? (id === 'elevenlabs' ? 'ElevenLabs' : 'Local');
    const stt = this.sttProviderId();
    const tts = this.ttsProviderId();
    const keyStatus = cfg.elevenlabs.apiKeyConfigured ? READY : NO_KEY;
    return [
      {
        direction: 'stt',
        name: 'Speech-to-text',
        providerId: stt,
        providerLabel: label(stt),
        options: this.sttProviders(),
        modelLabel: stt === 'elevenlabs' ? cfg.elevenlabs.sttModelId : localSttModel(cfg),
        detail: 'model, download and source',
        status: stt === 'elevenlabs' ? keyStatus : cfg.local.sttDownloaded ? READY : NOT_DOWNLOADED,
      },
      {
        direction: 'tts',
        name: 'Text-to-speech',
        providerId: tts,
        providerLabel: label(tts),
        options: this.ttsProviders(),
        modelLabel: tts === 'elevenlabs' ? (cfg.elevenlabs.voiceId ?? 'No voice chosen') : cfg.local.ttsVoice,
        detail: 'voice, preview and download',
        status: tts === 'elevenlabs' ? keyStatus : cfg.local.ttsDownloaded ? READY : NOT_DOWNLOADED,
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadProviders(), this.reloadConfig()]);
    this.isLoading.set(false);
  }

  async loadProviders(): Promise<void> {
    try {
      const result = await this.rpc.call('voice:listProviders', {} as Record<string, never>);
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
      this.errorMessage.set(errorText(error, 'Failed to load voice providers'));
    }
  }

  async reloadConfig(): Promise<void> {
    try {
      const result = await this.rpc.call('voice:getProviderConfig', {} as Record<string, never>);
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
      this.errorMessage.set(errorText(error, 'Failed to load voice configuration'));
    }
  }

  openDetails(direction: VoiceDirection): void {
    this.picker.set(null);
    this.drawerDirection.set(direction);
  }

  /** Popover choice: closes the popover, then saves on selection with Undo (S-sel). */
  async chooseProvider(direction: VoiceDirection, providerId: string): Promise<void> {
    this.picker.set(null);
    const current = this.config();
    if (!current) return;
    const next = asProviderId(providerId);
    const previous = asProviderId(direction === 'stt' ? current.sttProvider : current.ttsProvider);
    if (previous === next) return;

    this.errorMessage.set(null);
    const name = direction === 'stt' ? 'speech-to-text' : 'text-to-speech';
    await this.feedback.saveGeneric({
      label: `${name} provider`,
      write: () => this.writeProvider(direction, next, previous),
      undo: () => this.writeProvider(direction, previous, next),
    });
  }

  /**
   * Shows `next` while it saves and re-reads the config after a confirmed write, so the row and the
   * drawer reflect the backend (downloaded state, saved fields). A failed write puts `fallback` back.
   */
  private async writeProvider(
    direction: VoiceDirection,
    next: VoiceProviderId,
    fallback: VoiceProviderId,
  ): Promise<WriteResult> {
    this.setProvider(direction, next);
    let message: string;
    try {
      const result = await this.rpc.call(
        'voice:setProviderConfig',
        direction === 'stt' ? { sttProvider: next } : { ttsProvider: next },
      );
      if (result.isSuccess() && result.data.ok) {
        await this.reloadConfig();
        return { ok: true };
      }
      message =
        result.isSuccess() && !result.data.ok
          ? result.data.error
          : (result.error ?? 'Failed to switch voice provider');
    } catch (error: unknown) {
      message = errorText(error, 'Failed to switch voice provider');
    }
    this.setProvider(direction, fallback);
    this.errorMessage.set(message);
    return { ok: false, message };
  }

  private setProvider(direction: VoiceDirection, id: VoiceProviderId): void {
    this.config.update((cfg) =>
      cfg ? (direction === 'stt' ? { ...cfg, sttProvider: id } : { ...cfg, ttsProvider: id }) : cfg,
    );
  }
}

function localSttModel(cfg: VoiceProviderConfigDto): string {
  const { modelSource, customModel, whisperModel } = cfg.local;
  if (modelSource === 'curated') return whisperModel;
  return customModel ?? (modelSource === 'hf' ? 'No Hugging Face model set' : 'No model folder set');
}
