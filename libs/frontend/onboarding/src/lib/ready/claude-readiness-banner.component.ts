import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Download,
  LogIn,
  LucideAngularModule,
  RefreshCw,
  Terminal,
  TriangleAlert,
  type LucideIconData,
} from 'lucide-angular';
import type { ClaudeReadinessState } from './claude-readiness.store';

type BannerState = Extract<
  ClaudeReadinessState,
  'missing' | 'signed-out' | 'error'
>;

interface BannerCopy {
  readonly lead: string;
  readonly homeAction: string;
  readonly homeIcon: LucideIconData;
}

const COPY: Record<BannerState, BannerCopy> = {
  missing: {
    lead: 'Claude Code is not installed.',
    homeAction: 'Install Claude Code',
    homeIcon: Download,
  },
  'signed-out': {
    lead: 'Claude Code is not signed in.',
    homeAction: 'Sign in',
    homeIcon: LogIn,
  },
  error: {
    lead: 'Ptah could not check Claude Code.',
    homeAction: 'Check again',
    homeIcon: RefreshCw,
  },
};

const BODY: Record<'home' | 'settings', string> = {
  home: 'Analysis and agent generation may fail until it is ready. You can still pick a path.',
  settings: 'You can keep going; some steps may fail until it is ready.',
};

/**
 * The persistent Claude Code warning (spec §12.3, D11). Shown only for
 * `missing`, `signed-out` and `error`; it cannot be dismissed and clears the
 * moment the derived state is no longer one of those. Its one action goes to
 * stage 1.
 */
@Component({
  selector: 'ptah-claude-readiness-banner',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
  template: `
    @if (copy(); as copy) {
      <div
        role="status"
        class="flex flex-wrap items-center gap-3 rounded-[14px] border border-state-need/70 bg-state-need/10 px-4 py-3 text-sm max-[480px]:flex-col max-[480px]:items-stretch"
        data-glass-surface="chrome"
        data-testid="claude-readiness-banner"
        [attr.data-state]="state()"
      >
        <span
          class="grid size-6 flex-none place-items-center rounded-full bg-state-need text-base-100"
          aria-hidden="true"
        >
          <lucide-angular
            [img]="icons.alert"
            [strokeWidth]="3"
            class="size-3.5"
            aria-hidden="true"
          />
        </span>
        <p class="min-w-0 flex-1">
          <strong class="font-semibold">{{ copy.lead }}</strong>
          {{ body() }}
        </p>
        <a
          class="btn btn-sm min-h-9"
          routerLink="/onboarding/ready"
          data-testid="claude-readiness-banner-action"
        >
          <lucide-angular
            [img]="actionIcon()"
            class="size-4"
            aria-hidden="true"
          />
          {{ actionLabel() }}
        </a>
      </div>
    }
  `,
})
export class ClaudeReadinessBannerComponent {
  readonly state = input.required<ClaudeReadinessState>();
  readonly placement = input.required<'home' | 'settings'>();

  protected readonly icons = { alert: TriangleAlert } as const;

  protected readonly copy = computed<BannerCopy | null>(() => {
    const state = this.state();
    return state === 'missing' || state === 'signed-out' || state === 'error'
      ? COPY[state]
      : null;
  });

  protected readonly body = computed(() => BODY[this.placement()]);

  protected readonly actionLabel = computed(() =>
    this.placement() === 'settings'
      ? 'Fix Claude Code'
      : (this.copy()?.homeAction ?? ''),
  );

  protected readonly actionIcon = computed<LucideIconData>(() =>
    this.placement() === 'settings'
      ? Terminal
      : (this.copy()?.homeIcon ?? Terminal),
  );
}
