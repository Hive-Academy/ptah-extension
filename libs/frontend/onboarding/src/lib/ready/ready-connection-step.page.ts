import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CodexSignInService, VSCodeService, onboardingReadyTarget } from '@ptah-extension/core';
import { LucideAngularModule, PlugZap, RefreshCw } from 'lucide-angular';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import { ConnectionChoiceComponent } from './connection-choice.component';
import { ConnectionChoiceStore } from './connection-choice.store';
import { ProviderPanelComponent } from './provider-panel.component';
import type { ProviderReadinessView } from './provider-readiness.derive';
import { ProviderReadinessStore } from './provider-readiness.store';
import { ReadyStripComponent } from './ready-strip.component';
import { readyStripSettingsWord } from './ready-strip-state';

@Component({
  selector: 'ptah-ready-connection-step',
  standalone: true,
  imports: [LucideAngularModule, ConnectionChoiceComponent, ProviderPanelComponent, ReadyStripComponent],
  providers: [ConnectionChoiceStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'ready-connection-step' },
  template: `
    <section aria-labelledby="ready-connection-title">
      <ptah-ready-strip class="mb-5" [current]="1" [connection]="store.chosen()" [settings]="settingsWord()" />
      <div class="flex items-center gap-3 max-[480px]:gap-2.5">
        <span class="grid size-11 flex-none place-items-center rounded-xl border border-base-300 bg-base-200 max-[480px]:size-[38px]" data-glass-surface="tile" aria-hidden="true">
          <lucide-angular [img]="icons.plug" class="size-[1.35rem]" aria-hidden="true" />
        </span>
        <h1 id="ready-connection-title" tabindex="-1" class="text-[1.7rem] font-semibold leading-tight tracking-tight outline-none max-[720px]:text-[1.35rem]">Check Claude Code and Codex</h1>
      </div>
      <p class="mt-2 max-w-[62ch] text-base-content-muted">Ptah works with Claude Code or Codex. Pick the one you use as your main connection, and make sure it is installed and signed in. If you skip this, you can fix it later.</p>
      <ptah-connection-choice class="mt-5" />
      <div class="mt-5 grid grid-cols-2 items-start gap-4 max-[720px]:grid-cols-1">
        <ptah-provider-panel [view]="store.claude()" [role]="role('claude-cli')" [platform]="platform" />
        <ptah-provider-panel [view]="store.codex()" [role]="role('openai-codex')" [platform]="platform" />
      </div>
      @if (!chosenReady()) {
        <p class="mt-5 text-sm text-base-content-muted">You can continue without it. A warning stays on the next screens until {{ store.chosen().provider ? store.chosen().name : 'a connection' }} is ready.</p>
      }
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-outline min-h-9" [class.btn-ghost]="chosenReady() || choice.changed()" [attr.aria-disabled]="store.rechecking() ? 'true' : null" (click)="recheck()">
            <lucide-angular [img]="icons.refresh" class="size-4" aria-hidden="true" />{{ store.rechecking() ? 'Checking...' : 'Re-check' }}
          </button>
          @if (mountReading()) { <span class="text-sm text-base-content-muted">Checking your computer...</span> }
        </div>
        @if (chosenReady()) {
          <button #continueButton type="button" class="btn min-h-9" [class.btn-primary]="!choice.changed()" [class.btn-ghost]="choice.changed()" (click)="continue()">Continue</button>
        } @else {
          <button type="button" class="btn btn-ghost min-h-9" data-testid="ready-continue-anyway" (click)="continueAnyway()">Continue anyway</button>
        }
      </div>
    </section>
  `,
})
export class ReadyConnectionStepPage {
  protected readonly store = inject(ProviderReadinessStore);
  protected readonly choice = inject(ConnectionChoiceStore);
  private readonly flags = inject(OnboardingFlagService);
  private readonly router = inject(Router);
  private readonly announcer = inject(OnboardingAnnouncerService);
  private readonly signIn = inject(CodexSignInService);
  private readonly injector = inject(Injector);
  private readonly continueButton = viewChild<ElementRef<HTMLButtonElement>>('continueButton');
  protected readonly icons = { plug: PlugZap, refresh: RefreshCw } as const;
  protected readonly platform = inject(VSCodeService).config().platform ?? '';
  protected readonly settingsWord = computed(() => readyStripSettingsWord(this.flags.flag().ready, false));
  protected readonly chosenReady = computed(() => this.store.chosen().readiness?.state === 'ready');
  protected readonly mountReading = computed(() => this.store.claude().state === 'checking' || this.store.codex().state === 'checking');
  private focusWhenReady = false;
  private previousSignInStatus: string | null = null;

  constructor() {
    effect(() => {
      const status = this.signIn.state()?.status ?? null;
      if (status === 'succeeded' && this.previousSignInStatus !== 'succeeded') {
        this.focusWhenReady = true;
        void this.store.recheckCodex();
      }
      this.previousSignInStatus = status;
    });
    effect(() => {
      if (this.focusWhenReady && this.chosenReady()) {
        this.focusWhenReady = false;
        this.focusContinue();
      }
    });
    void this.store.refresh('mount');
  }

  protected role(provider: ProviderReadinessView['provider']): 'main' | 'information' | 'neutral' {
    const chosen = this.store.chosen();
    return chosen.provider === provider ? 'main' : chosen.provider === null ? 'neutral' : 'information';
  }

  protected async recheck(): Promise<void> {
    if (this.store.rechecking()) return;
    this.focusWhenReady = !this.chosenReady();
    await this.store.refresh('recheck');
    this.announce('Claude Code', this.store.claude());
    this.announce('Codex', this.store.codex());
    if (this.focusWhenReady && this.chosenReady()) {
      this.focusWhenReady = false;
      this.focusContinue();
    } else this.focusWhenReady = false;
  }

  private announce(name: string, view: ProviderReadinessView): void {
    const message = view.state === 'ready' ? `${name} is ready.`
      : view.state === 'missing' ? `${name} is still not installed.`
      : view.state === 'signed-out' || view.state === 'stale' ? `${name} is still not signed in.`
      : `Ptah still could not check ${name}.`;
    this.announcer.announce(message);
  }

  private focusContinue(): void {
    afterNextRender(() => this.continueButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected continue(): void {
    if (!this.chosenReady()) return;
    this.flags.markReady('connectionAt');
    this.toSettings();
  }

  protected continueAnyway(): void {
    this.flags.markReady('skippedAt');
    this.toSettings();
  }

  private toSettings(): void {
    void this.router.navigate(['/onboarding', ...onboardingReadyTarget('settings').subPath]);
  }
}
