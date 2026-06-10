import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';
import { GatewayPlatformTabsComponent } from './gateway-platform-tabs.component';
import {
  GatewayPlatformPaneComponent,
  type PlatformCardConfig,
} from './gateway-platform-pane.component';
import { GatewaySetupGuideComponent } from './gateway-setup-guide.component';

const PLATFORM_CARDS: readonly PlatformCardConfig[] = [
  {
    id: 'discord',
    label: 'Discord',
    tokenPlaceholder: 'Paste bot token (MTAxNzU...)',
    hasAppToken: false,
  },
  {
    id: 'slack',
    label: 'Slack',
    tokenPlaceholder: 'Paste bot token (xoxb-...)',
    hasAppToken: true,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    tokenPlaceholder: 'Paste bot token (123456:ABC-...)',
    hasAppToken: false,
  },
];

@Component({
  selector: 'ptah-messaging-gateway-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GatewayPlatformTabsComponent,
    GatewayPlatformPaneComponent,
    GatewaySetupGuideComponent,
  ],
  template: `
    @if (!isElectron) {
      <div role="alert" class="alert alert-info">
        <span>
          Messaging gateway is only available in the Ptah desktop app.
          <a
            class="link link-primary ml-1"
            href="https://github.com/ptah-extensions/ptah-extension/releases"
            rel="noopener noreferrer"
            target="_blank"
            >Download Ptah desktop</a
          >
        </span>
      </div>
    } @else {
      <div class="flex h-full w-full flex-col gap-4">
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Gateway master toggle"
        >
          <div class="card-body flex-row items-center justify-between p-4">
            <div>
              <h2 class="card-title text-sm">Messaging gateway</h2>
              <p class="text-xs text-base-content/60">
                {{
                  enabled()
                    ? 'Gateway running. Per-platform adapters managed below.'
                    : 'Gateway stopped. Add a token to a platform to start it.'
                }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="toggleHelp()"
                aria-label="Open gateway setup guide"
              >
                Setup guide
              </button>
              <div class="badge badge-sm" [class.badge-success]="enabled()">
                {{ enabled() ? 'enabled' : 'disabled' }}
              </div>
            </div>
          </div>
        </section>

        @if (globalError(); as msg) {
          <div
            role="alert"
            class="alert alert-error"
            data-testid="gateway-global-error"
          >
            <span class="text-sm">{{ msg }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="onDismissGlobalError()"
            >
              Dismiss
            </button>
          </div>
        }

        @if (voiceDownload(); as v) {
          <div
            role="status"
            aria-live="polite"
            class="alert"
            [class.alert-info]="!v.error"
            [class.alert-error]="!!v.error"
          >
            <div class="flex flex-1 flex-col gap-1">
              <span class="text-sm">
                @if (v.error) {
                  Failed to download Whisper model
                  <span class="font-mono">{{ v.modelName }}</span
                  >: {{ v.error }}
                } @else if (v.done) {
                  Whisper model
                  <span class="font-mono">{{ v.modelName }}</span> ready.
                } @else {
                  Downloading Whisper model
                  <span class="font-mono">{{ v.modelName }}</span> &mdash;
                  {{ v.percent.toFixed(0) }}%
                }
              </span>
              @if (!v.error && !v.done) {
                <progress
                  class="progress progress-primary w-full"
                  [value]="v.percent"
                  max="100"
                ></progress>
              }
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="onDismissVoiceToast()"
            >
              Dismiss
            </button>
          </div>
        }

        <ptah-gateway-platform-tabs
          [platforms]="platforms()"
          [selected]="selectedPlatform()"
          (selectedChange)="selectedPlatform.set($event)"
        />

        @for (cfg of platformCards; track cfg.id) {
          <div
            role="tabpanel"
            [id]="'gateway-pane-' + cfg.id"
            [attr.aria-labelledby]="'gateway-tab-' + cfg.id"
            [hidden]="selectedPlatform() !== cfg.id"
          >
            <ptah-gateway-platform-pane [config]="cfg" />
          </div>
        }

        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Voice and rate-limit settings"
        >
          <div class="card-body p-4">
            <h3 class="card-title text-sm">Voice & rate-limit (read-only)</h3>
            <p class="text-xs text-base-content/60">
              Configure these in
              <span class="font-mono">~/.ptah/settings.json</span>.
            </p>
            <ul class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              <li class="font-mono">
                gateway.voice.enabled =
                <span class="text-base-content/70">{{ voiceEnabled() }}</span>
              </li>
              <li class="font-mono">
                gateway.voice.whisperModel =
                <span class="text-base-content/70">{{ whisperModel() }}</span>
              </li>
              <li class="font-mono">
                gateway.rateLimit.minTimeMs =
                <span class="text-base-content/70">
                  {{ rateLimit().minTimeMs }}
                </span>
              </li>
              <li class="font-mono">
                gateway.rateLimit.maxConcurrent =
                <span class="text-base-content/70">
                  {{ rateLimit().maxConcurrent }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      @if (helpOpen()) {
        <ptah-gateway-setup-guide (closed)="closeHelp()" />
      }
    }
  `,
})
export class MessagingGatewayTabComponent implements OnInit {
  private readonly state = inject(GatewayStateService);
  private readonly vscode = inject(VSCodeService);

  protected readonly platformCards = PLATFORM_CARDS;
  protected readonly enabled = this.state.enabled;
  protected readonly platforms = this.state.platforms;
  protected readonly globalError = this.state.globalError;
  protected readonly voiceEnabled = this.state.voiceEnabled;
  protected readonly whisperModel = this.state.whisperModel;
  protected readonly rateLimit = this.state.rateLimit;
  protected readonly voiceDownload = this.state.voiceDownload;

  protected readonly selectedPlatform = signal<GatewayPlatformId>('discord');
  protected readonly helpOpen = signal(false);

  public get isElectron(): boolean {
    return this.vscode.isElectron;
  }

  public ngOnInit(): void {
    if (!this.isElectron) return;
    void this.state.initialize();
  }

  protected onDismissGlobalError(): void {
    this.state.clearGlobalError();
  }

  protected onDismissVoiceToast(): void {
    this.state.dismissVoiceToast();
  }

  protected toggleHelp(): void {
    this.helpOpen.update((open) => !open);
  }

  protected closeHelp(): void {
    this.helpOpen.set(false);
  }
}
