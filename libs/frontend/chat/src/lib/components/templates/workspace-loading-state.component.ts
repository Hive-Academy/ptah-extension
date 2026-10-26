/**
 * Workspace Loading State Component
 *
 * The L1 loading state of the Electron shell (TASK_2026_721 11a, design
 * screen 05b): shown while the first host workspace sync has not settled
 * (`ElectronLayoutService.workspaceResolved()` is false), so the shell never
 * flashes the welcome or an empty workspace at a returning user.
 *
 * With a pending workspace name it paints the workspace skeleton: the name, an
 * empty activity grid that fades in, three pending steps and a disabled
 * New session button. Without a name it paints the medallion and a shimmer.
 *
 * The host is a polite `role="status"` region with no `aria-busy` (the host
 * is removed, never flipped to idle, so a busy flag would only hold the
 * announcement back). Its visually hidden line is filled after the first
 * render, so screen readers hear "Opening <name>" as a change rather than as
 * content that was already there. When the host is slow (over
 * {@link SLOW_HINT_MS}) a short visible hint joins the region. The skeleton
 * is `aria-hidden` and carries `aria-busy` (its pending steps are fixed, not
 * progress). New session stays visible but `aria-disabled` and inert until
 * the workspace resolves. No card or frame: the content sits on the
 * tinted scene over a frameless local text scrim (`--glass-scrim-text`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import {
  ActivityGridComponent,
  StagedStepsComponent,
  type StagedStep,
} from '@ptah-extension/chat-ui';
import { localDayKey } from '../../services/vitals/usage-vitals.model';

/** After this long without a resolved workspace, a calm hint shows. */
export const SLOW_HINT_MS = 10_000;

/** The three workspace preparation steps of screen 05b, none started yet. */
const PENDING_STEPS: readonly StagedStep[] = [
  { id: 'git', label: 'Git status', state: 'pending' },
  { id: 'scan', label: 'Scanning files', state: 'pending' },
  { id: 'usage', label: 'Usage history', state: 'pending' },
];

@Component({
  selector: 'ptah-workspace-loading-state',
  standalone: true,
  imports: [LucideAngularModule, ActivityGridComponent, StagedStepsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'data-testid': 'workspace-loading-state',
  },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    .ptah-loading__stage {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 36px;
      padding: 40px 64px;
      background: radial-gradient(
        ellipse farthest-corner at center,
        var(--glass-scrim-text, transparent) 0%,
        var(--glass-scrim-text, transparent) 86%,
        transparent 100%
      );
    }
    .ptah-loading__title {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .ptah-loading__zone {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 32px 64px;
    }
    .ptah-loading__steps {
      width: 340px;
      max-width: 100%;
    }
    .ptah-loading__bar {
      display: block;
      height: 12px;
      border-radius: 99px;
      background: oklch(var(--bc) / 0.1);
    }
    .ptah-loading__bar--name {
      width: 80px;
    }
    .ptah-loading__bar--medallion {
      width: 160px;
    }
    @media (prefers-reduced-motion: no-preference) {
      .ptah-loading__grid {
        animation: ptah-loading-wave-in 900ms var(--ptah-ease-soft, ease-out)
          both;
      }
      .ptah-loading__bar {
        animation: ptah-loading-shimmer 1.6s ease-in-out infinite;
      }
    }
    @keyframes ptah-loading-wave-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    @keyframes ptah-loading-shimmer {
      50% {
        opacity: 0.45;
      }
    }
  `,
  template: `
    <span class="sr-only" data-testid="workspace-loading-label">{{
      announced() ? statusLabel() : ''
    }}</span>
    <div class="ptah-loading__stage" aria-busy="true">
      @if (workspaceName(); as name) {
        <div class="ptah-loading__title" aria-hidden="true">
          <span
            class="text-base font-semibold text-base-content"
            data-testid="workspace-loading-name"
            >{{ name }}</span
          >
          <span class="ptah-loading__bar ptah-loading__bar--name"></span>
        </div>
        <div class="ptah-loading__zone" aria-hidden="true">
          <ptah-activity-grid
            class="ptah-loading__grid"
            [days]="[]"
            [today]="today"
            ariaLabel="Activity, loading"
          />
          <ptah-staged-steps
            class="ptah-loading__steps"
            [steps]="steps"
            ariaLabel="Preparing workspace"
          />
        </div>
        <button
          type="button"
          class="btn btn-primary gap-2 rounded-full px-6 cursor-not-allowed"
          aria-disabled="true"
          data-testid="workspace-loading-new-session"
        >
          <lucide-angular [img]="PlusIcon" class="size-4" aria-hidden="true" />
          New session
        </button>
      } @else {
        <img
          [src]="ptahIconUri"
          alt=""
          aria-hidden="true"
          class="size-12"
          width="48"
          height="48"
          data-testid="workspace-loading-medallion"
        />
        <span
          class="ptah-loading__bar ptah-loading__bar--medallion"
          aria-hidden="true"
        ></span>
      }
    </div>
    @if (slow()) {
      <p
        class="text-sm text-base-content-muted"
        data-testid="workspace-loading-slow"
      >
        Still opening. This can take a moment.
      </p>
    }
  `,
})
export class WorkspaceLoadingStateComponent {
  private readonly vscodeService = inject(VSCodeService);

  /** The workspace being restored; `null` when the host named none. */
  readonly workspaceName = input<string | null>(null);

  protected readonly PlusIcon = Plus;
  protected readonly steps = PENDING_STEPS;
  protected readonly today = localDayKey(new Date());
  protected readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  /** The hidden status line is filled after the first render. */
  protected readonly announced = signal(false);
  /** The host has taken longer than {@link SLOW_HINT_MS}. */
  protected readonly slow = signal(false);

  protected readonly statusLabel = computed(() => {
    const name = this.workspaceName();
    return name ? `Opening ${name}` : 'Loading workspace';
  });

  constructor() {
    const timer = setTimeout(() => this.slow.set(true), SLOW_HINT_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    afterNextRender(() => this.announced.set(true));
  }
}
