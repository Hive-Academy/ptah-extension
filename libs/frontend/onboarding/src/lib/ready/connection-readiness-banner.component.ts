import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Download, LogIn, LucideAngularModule, RefreshCw, Terminal, TriangleAlert, type LucideIconData } from 'lucide-angular';
import type { ChosenConnectionView, ProviderKind } from './provider-readiness.derive';

interface BannerCopy {
  readonly lead: string;
  readonly homeAction: string;
  readonly homeIcon: LucideIconData;
}

const COPY: Record<ProviderKind, Record<'missing' | 'signed-out' | 'stale' | 'error', BannerCopy>> = {
  'claude-cli': {
    missing: { lead: 'Claude Code is not installed.', homeAction: 'Install Claude Code', homeIcon: Download },
    'signed-out': { lead: 'Claude Code is not signed in.', homeAction: 'Sign in', homeIcon: LogIn },
    stale: { lead: 'Claude Code is not signed in.', homeAction: 'Sign in', homeIcon: LogIn },
    error: { lead: 'Ptah could not check Claude Code.', homeAction: 'Check again', homeIcon: RefreshCw },
  },
  'openai-codex': {
    missing: { lead: 'Codex is not installed.', homeAction: 'Install Codex', homeIcon: Download },
    'signed-out': { lead: 'Codex is not signed in.', homeAction: 'Sign in', homeIcon: LogIn },
    stale: { lead: 'Codex needs you to sign in again.', homeAction: 'Sign in', homeIcon: LogIn },
    error: { lead: 'Ptah could not check Codex.', homeAction: 'Check again', homeIcon: RefreshCw },
  },
};

@Component({
  selector: 'ptah-connection-readiness-banner',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
  template: `
    @if (copy(); as copy) {
      <div role="status"
        class="flex flex-wrap items-center gap-3 rounded-[14px] border border-[color-mix(in_srgb,var(--state-ink-need)_70%,transparent)] bg-[color-mix(in_srgb,var(--state-ink-need)_10%,oklch(var(--b1)))] px-4 py-3 text-sm max-[480px]:flex-col max-[480px]:items-stretch"
        data-glass-surface="chrome" data-testid="connection-readiness-banner"
        [attr.data-state]="chosen().readiness?.state">
        <span class="grid size-6 flex-none place-items-center rounded-full bg-state-need text-base-100" aria-hidden="true">
          <lucide-angular [img]="icons.alert" [strokeWidth]="3" class="size-3.5" aria-hidden="true" />
        </span>
        <p class="min-w-0 flex-1"><strong class="font-semibold">{{ copy.lead }}</strong>
          {{ chosen().name }} is your main connection. {{ placement() === 'home' ? 'You can still pick a path.' : 'You can keep going.' }}
        </p>
        <a class="btn btn-sm min-h-9" routerLink="/onboarding/ready" data-testid="connection-readiness-banner-action">
          <lucide-angular [img]="actionIcon()" class="size-4" aria-hidden="true" />
          {{ actionLabel() }}
        </a>
      </div>
    }
  `,
})
export class ConnectionReadinessBannerComponent {
  readonly chosen = input.required<ChosenConnectionView>();
  readonly placement = input.required<'home' | 'settings'>();
  protected readonly icons = { alert: TriangleAlert } as const;
  protected readonly copy = computed<BannerCopy | null>(() => {
    const { provider, readiness } = this.chosen();
    if (!provider || !readiness) return null;
    const state = readiness.state;
    return state === 'missing' || state === 'signed-out' || state === 'stale' || state === 'error'
      ? COPY[provider][state] : null;
  });
  protected readonly actionLabel = computed(() => this.placement() === 'settings'
    ? `Fix ${this.chosen().name}` : this.copy()?.homeAction ?? '');
  protected readonly actionIcon = computed<LucideIconData>(() => this.placement() === 'settings'
    ? Terminal : this.copy()?.homeIcon ?? Terminal);
}
