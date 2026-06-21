import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Mic,
  MessagesSquare,
  RadioTower,
  UserCheck,
  UserPlus,
} from 'lucide-angular';
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
    LucideAngularModule,
    GatewayPlatformTabsComponent,
    GatewayPlatformPaneComponent,
    GatewaySetupGuideComponent,
  ],
  template: `
    @if (!isElectron) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="alert"
      >
        <lucide-angular
          [img]="MessagesSquareIcon"
          class="size-8 text-base-content/30"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">Messaging is desktop-only</p>
        <p class="text-xs text-base-content/60">
          The gateway runs adapters locally, so it needs the Ptah desktop app.
        </p>
        <a
          class="link link-primary text-xs"
          href="https://github.com/ptah-extensions/ptah-extension/releases"
          rel="noopener noreferrer"
          target="_blank"
          >Download Ptah desktop</a
        >
      </div>
    } @else {
      <div class="space-y-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-200/60 text-secondary"
            >
              <lucide-angular
                [img]="RadioTowerIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
            </span>
            <div>
              <h1 class="text-xl font-semibold tracking-tight">Messaging</h1>
              <p class="mt-0.5 text-sm text-base-content/60">
                Drive Ptah agents from Telegram, Discord, and Slack.
              </p>
              <p class="mt-0.5 text-xs text-base-content/50">
                {{
                  enabled()
                    ? 'Gateway running — per-platform adapters managed below.'
                    : 'Gateway stopped — add a token to a platform to start it.'
                }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 text-xs text-base-content/70"
            >
              <span
                class="inline-block size-1.5 rounded-full"
                [class.bg-success]="enabled()"
                [class.bg-base-content/30]="!enabled()"
              ></span>
              {{ enabled() ? 'Running' : 'Stopped' }}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="toggleHelp()"
              aria-label="Open gateway setup guide"
            >
              Setup guide
            </button>
          </div>
        </header>

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
            class="rounded-xl border p-3"
            [class.border-base-300]="!v.error"
            [class.bg-base-200/40]="!v.error"
            [class.border-error/40]="!!v.error"
            [class.bg-error/10]="!!v.error"
          >
            <div class="flex items-start gap-3">
              <div class="flex flex-1 flex-col gap-1.5">
                <span class="text-xs">
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
          </div>
        }

        <div
          class="grid grid-cols-2 gap-3 xl:grid-cols-4"
          aria-label="Gateway statistics"
        >
          <div
            class="stats rounded-2xl bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-success">
                <lucide-angular
                  [img]="RadioTowerIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content/60">
                Adapters running
              </div>
              <div class="stat-value text-2xl text-success">
                {{ runningCount() }}
              </div>
            </div>
          </div>

          <div
            class="stats rounded-2xl bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-warning">
                <lucide-angular
                  [img]="UserPlusIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content/60">
                Pending approvals
              </div>
              <div class="stat-value text-2xl text-warning">
                {{ pendingCount() }}
              </div>
            </div>
          </div>

          <div
            class="stats rounded-2xl bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-primary">
                <lucide-angular
                  [img]="UserCheckIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content/60">
                Approved senders
              </div>
              <div class="stat-value text-2xl text-primary">
                {{ approvedCount() }}
              </div>
            </div>
          </div>

          <div
            class="stats rounded-2xl bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat p-4">
              <div class="stat-figure text-info">
                <lucide-angular
                  [img]="MicIcon"
                  class="w-6 h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="stat-title text-base-content/60">Voice</div>
              <div class="stat-value text-sm font-medium text-info">
                {{ voiceEnabled() ? 'On' : 'Off' }}
              </div>
            </div>
          </div>
        </div>

        <section
          class="overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/30"
          aria-label="Platform configuration"
        >
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-base-content/10 bg-base-200/50 px-3 py-2.5 sm:px-4"
          >
            <ptah-gateway-platform-tabs
              [platforms]="platforms()"
              [selected]="selectedPlatform()"
              (selectedChange)="selectedPlatform.set($event)"
            />
          </div>

          <div class="px-5 py-5 sm:px-6 sm:py-6">
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
          </div>
        </section>

        <section
          class="rounded-2xl border border-base-content/10 bg-base-200/30 p-5 sm:p-6"
          aria-label="Voice and rate-limit settings"
        >
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">Voice & rate limits</h2>
            <p class="text-xs text-base-content/55">
              Read-only — configure these in
              <span class="font-mono">~/.ptah/settings.json</span>.
            </p>
          </div>
          <div
            class="mt-4 grid gap-x-8 gap-y-2 rounded-lg border border-base-content/10 bg-base-100/40 p-4 font-mono text-xs sm:grid-cols-2"
          >
            <p>
              gateway.voice.enabled =
              <span class="text-base-content/70">{{ voiceEnabled() }}</span>
            </p>
            <p>
              gateway.rateLimit.minTimeMs =
              <span class="text-base-content/70">{{
                rateLimit().minTimeMs
              }}</span>
            </p>
            <p>
              gateway.rateLimit.maxConcurrent =
              <span class="text-base-content/70">{{
                rateLimit().maxConcurrent
              }}</span>
            </p>
            <p
              class="pt-1 text-base-content/50 sm:col-span-2"
              data-testid="gateway-voice-model-hint"
            >
              The Whisper voice model is configured in Settings.
            </p>
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

  protected readonly MessagesSquareIcon = MessagesSquare;
  protected readonly RadioTowerIcon = RadioTower;
  protected readonly UserPlusIcon = UserPlus;
  protected readonly UserCheckIcon = UserCheck;
  protected readonly MicIcon = Mic;

  protected readonly platformCards = PLATFORM_CARDS;
  protected readonly enabled = this.state.enabled;
  protected readonly platforms = this.state.platforms;
  protected readonly globalError = this.state.globalError;
  protected readonly voiceEnabled = this.state.voiceEnabled;
  protected readonly rateLimit = this.state.rateLimit;
  protected readonly voiceDownload = this.state.voiceDownload;

  protected readonly runningCount = computed(
    () =>
      Object.values(this.platforms()).filter((p) => p.state === 'running')
        .length,
  );
  protected readonly pendingCount = computed(
    () => this.state.pendingBindings().length,
  );
  protected readonly approvedCount = computed(
    () => this.state.approvedBindings().length,
  );

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
