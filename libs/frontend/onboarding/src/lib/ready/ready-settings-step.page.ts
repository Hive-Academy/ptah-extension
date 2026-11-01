import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Provider,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CliOrchestrationMatrixComponent,
  ProvidersModelsLoader,
  ProvidersSettingsComponent,
  SettingsSaveFeedbackService,
  SettingsToastComponent,
  type ProvidersSettingsDrawerRequest,
} from '@ptah-extension/chat/settings-embed';
import {
  ONBOARDING_READY_QUERY,
  ProvidersSettingsStateService,
  parseOnboardingReadyArea,
  parseOnboardingReadyOpen,
  type OnboardingReadyArea,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { LucideAngularModule, PlugZap, RotateCw } from 'lucide-angular';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { ClaudeReadinessBannerComponent } from './claude-readiness-banner.component';
import { ClaudeReadinessStore } from './claude-readiness.store';
import { ReadyStripComponent } from './ready-strip.component';
import { readyStripSettingsWord } from './ready-strip-state';

/**
 * The page scope the embedded settings components need (the same contract
 * `settings.component.ts` fulfils): save feedback for the toast and the
 * models loader. Provided on the `ready/settings` route, so they live exactly
 * as long as this page.
 */
export const READY_SETTINGS_PROVIDERS: Provider[] = [
  SettingsSaveFeedbackService,
  { provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader },
];

/** The stage-1 named-account request: Claude (Subscription), Accounts tab. */
const CLAUDE_ACCOUNTS_REQUEST: ProvidersSettingsDrawerRequest = {
  connection: 'claude-cli',
  tab: 'accounts',
};

interface AreaTab {
  readonly id: OnboardingReadyArea;
  readonly label: string;
}

const AREA_TABS: readonly AreaTab[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'cli', label: 'CLI tools' },
];

/**
 * Get ready stage 2 (`/onboarding/ready/settings`): the existing Providers
 * page and CLI tools matrix, embedded unchanged as two tabs (spec §12.5).
 * Both load in their own deferred chunk. Onboarding adds no provider, model,
 * account or CLI form and no settings RPC of its own.
 */
@Component({
  selector: 'ptah-ready-settings-step',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    ProvidersSettingsComponent,
    CliOrchestrationMatrixComponent,
    SettingsToastComponent,
    ClaudeReadinessBannerComponent,
    ReadyStripComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'ready-settings-step' },
  template: `
    <section aria-labelledby="ready-settings-title">
      <ptah-ready-strip
        class="mb-5"
        [current]="2"
        [claude]="readiness().state"
        [settings]="settingsWord()"
      />

      <div class="flex items-center gap-3 max-[480px]:gap-2.5">
        <span
          class="grid size-11 flex-none place-items-center rounded-xl border border-base-300 bg-base-200 max-[480px]:size-[38px]"
          data-glass-surface="tile"
          aria-hidden="true"
        >
          <lucide-angular
            [img]="icons.plugZap"
            class="size-[1.35rem]"
            aria-hidden="true"
          />
        </span>
        <h1
          id="ready-settings-title"
          tabindex="-1"
          class="text-[1.7rem] font-semibold leading-tight tracking-tight outline-none max-[720px]:text-[1.35rem]"
        >
          Connect providers and tools
        </h1>
      </div>
      <p class="mt-2 max-w-[62ch] text-base-content-muted">
        Choose what Ptah can use besides Claude Code. This is the same screen as
        Settings, so you can skip now and come back any time.
      </p>

      <ptah-claude-readiness-banner
        class="mt-5"
        placement="settings"
        [state]="readiness().state"
      />

      <div
        class="mt-4 rounded-[22px] border border-base-300 bg-base-200 p-4 max-[480px]:p-3"
        data-glass-surface="content"
      >
        <div
          role="tablist"
          aria-label="Settings area"
          class="inline-flex gap-1 rounded-full border border-base-300 p-1"
          data-testid="ready-area-tablist"
        >
          @for (tab of areaTabs; track tab.id; let i = $index) {
            <button
              type="button"
              role="tab"
              class="min-h-8 rounded-full px-3 text-sm"
              [class.bg-base-300]="area() === tab.id"
              [class.font-semibold]="area() === tab.id"
              [id]="'ready-area-tab-' + tab.id"
              [attr.aria-controls]="'ready-area-panel-' + tab.id"
              [attr.aria-selected]="area() === tab.id"
              [attr.tabindex]="area() === tab.id ? 0 : -1"
              (click)="selectArea(tab.id)"
              (keydown)="onAreaKey($event, i)"
            >
              {{ tab.label }}
            </button>
          }
        </div>

        @if (area() === 'providers') {
          <div
            role="tabpanel"
            tabindex="0"
            class="mt-4"
            id="ready-area-panel-providers"
            aria-labelledby="ready-area-tab-providers"
            data-testid="ready-area-panel-providers"
          >
            @defer (on immediate) {
              <ptah-providers-settings [requestedDrawer]="drawerRequest()" />
            } @placeholder {
              <div class="min-h-24" aria-busy="true"></div>
            } @error {
              <div
                class="flex flex-col items-start gap-3 rounded-lg border border-base-300 p-4"
                data-testid="ready-providers-load-error"
                role="alert"
              >
                <p class="text-sm text-base-content">
                  The Providers page could not load. Reload the window to try
                  again.
                </p>
                <button
                  type="button"
                  class="btn btn-sm btn-primary gap-1.5"
                  (click)="reloadWindow()"
                >
                  <lucide-angular
                    [img]="icons.reload"
                    class="size-3.5"
                    aria-hidden="true"
                  />
                  Reload
                </button>
              </div>
            }
          </div>
        } @else {
          <div
            role="tabpanel"
            tabindex="0"
            class="mt-4"
            id="ready-area-panel-cli"
            aria-labelledby="ready-area-tab-cli"
            data-testid="ready-area-panel-cli"
          >
            @defer (on immediate) {
              <ptah-cli-orchestration-matrix />
            } @placeholder {
              <div class="min-h-24" aria-busy="true"></div>
            } @error {
              <div
                class="flex flex-col items-start gap-3 rounded-lg border border-base-300 p-4"
                data-testid="ready-cli-load-error"
                role="alert"
              >
                <p class="text-sm text-base-content">
                  The CLI tools page could not load. Reload the window to try
                  again.
                </p>
                <button
                  type="button"
                  class="btn btn-sm btn-primary gap-1.5"
                  (click)="reloadWindow()"
                >
                  <lucide-angular
                    [img]="icons.reload"
                    class="size-3.5"
                    aria-hidden="true"
                  />
                  Reload
                </button>
              </div>
            }
          </div>
        }
      </div>

      <div
        class="mt-5 flex flex-wrap items-center justify-between gap-3 max-[480px]:flex-col max-[480px]:items-stretch"
      >
        <a
          class="btn btn-ghost min-h-9"
          routerLink="/onboarding/ready"
          data-testid="ready-settings-back"
          >Back</a
        >
        <div
          class="flex flex-wrap gap-2 max-[480px]:grid max-[480px]:grid-cols-1"
        >
          <button
            type="button"
            class="btn btn-ghost min-h-9"
            data-testid="ready-settings-skip"
            (click)="leave('skippedAt')"
          >
            Skip for now
          </button>
          <button
            type="button"
            class="btn btn-primary min-h-9"
            data-testid="ready-settings-continue"
            (click)="leave('settingsAt')"
          >
            Continue to setup
          </button>
        </div>
      </div>
      <p class="mt-4 text-sm text-base-content-muted">
        More options (voice, search, lane guards) are in Settings after setup.
      </p>
    </section>

    <ptah-settings-toast />
  `,
})
export class ReadySettingsStepPage {
  private readonly store = inject(ClaudeReadinessStore);
  private readonly flags = inject(OnboardingFlagService);
  private readonly router = inject(Router);
  private readonly settingsState = inject(ProvidersSettingsStateService);
  private readonly document = inject(DOCUMENT);

  protected readonly icons = { plugZap: PlugZap, reload: RotateCw } as const;
  protected readonly areaTabs = AREA_TABS;

  protected readonly readiness = this.store.view;
  protected readonly settingsWord = computed(() =>
    readyStripSettingsWord(this.flags.flag().ready, false),
  );

  protected readonly area = signal<OnboardingReadyArea>('providers');
  /**
   * Seeded once from the URL. Any tab change clears it, so a remounted
   * Providers panel never reopens the drawer.
   */
  protected readonly drawerRequest =
    signal<ProvidersSettingsDrawerRequest | null>(null);

  constructor() {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const rawArea = query.get(ONBOARDING_READY_QUERY.area);
    const area = parseOnboardingReadyArea(rawArea);
    this.area.set(area);
    if (
      rawArea === 'providers' &&
      parseOnboardingReadyOpen(query.get(ONBOARDING_READY_QUERY.open)) ===
        'claude-accounts'
    ) {
      this.drawerRequest.set(CLAUDE_ACCOUNTS_REQUEST);
    }
    if (area === 'cli') this.openCliState();
    void this.store.refresh(false);
  }

  protected selectArea(area: OnboardingReadyArea): void {
    if (area === this.area()) return;
    this.drawerRequest.set(null);
    this.area.set(area);
    if (area === 'cli') this.openCliState();
  }

  /** Left/Right move between tabs and wrap; selection follows focus. */
  protected onAreaKey(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + AREA_TABS.length) % AREA_TABS.length;
    this.selectArea(AREA_TABS[next].id);
    const tablist = (event.currentTarget as HTMLElement).parentElement;
    tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  protected leave(key: 'skippedAt' | 'settingsAt'): void {
    this.flags.markReady(key);
    void this.router.navigate(['/onboarding']);
  }

  protected reloadWindow(): void {
    this.document.defaultView?.location.reload();
  }

  /**
   * The matrix reads the settings state its host page opened (RD5), as
   * `orchestration-settings.component.ts` does: once per CLI panel mount.
   */
  private openCliState(): void {
    void this.settingsState.open();
  }
}
