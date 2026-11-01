import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink, RouterOutlet } from '@angular/router';
import { AppStateManager } from '@ptah-extension/core';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from './onboarding-announcer.service';
import { OnboardingFocusService } from './onboarding-focus.service';
import { OnboardingRunPillService } from './onboarding-run-pill.service';
import { WorkspaceHeaderComponent } from './workspace-header.component';

/**
 * The frame every onboarding page renders in: a 1120px column, the top bar
 * (breadcrumb and the read-only provider/model pill of a running flow), the
 * page outlet and the one polite status region.
 *
 * On Home the breadcrumb is "Back to chat", which dismisses onboarding. On
 * every other page its first crumb returns to Home, followed by the page
 * route's `data.crumb` when it has one ("Onboarding / Get ready").
 */
@Component({
  selector: 'ptah-onboarding-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, WorkspaceHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-h-0 w-full overflow-y-auto overflow-x-hidden',
    'data-testid': 'onboarding-shell',
  },
  template: `
    <div
      class="mx-auto w-full max-w-[1120px] px-5 pb-16 pt-5 text-base-content max-[720px]:px-3.5 max-[720px]:pt-4"
    >
      <div class="mb-6 flex flex-wrap items-center gap-3">
        <nav aria-label="Breadcrumb" class="flex items-center gap-2 text-sm">
          @if (onHome()) {
            <button
              type="button"
              class="link link-hover text-base-content-muted hover:text-base-content"
              data-testid="onboarding-back-to-chat"
              (click)="backToChat()"
            >
              Back to chat
            </button>
          } @else {
            <a
              routerLink="/onboarding"
              class="link link-hover text-base-content-muted hover:text-base-content"
              data-testid="onboarding-crumb-home"
              >Onboarding</a
            >
            @if (crumb(); as crumb) {
              <span class="text-base-content-muted" aria-hidden="true">/</span>
              <span aria-current="page" data-testid="onboarding-crumb-page">{{
                crumb
              }}</span>
            }
          }
        </nav>
        @if (runPill.label(); as label) {
          <span
            class="ml-auto inline-flex items-center rounded-full border border-base-300 bg-base-200 px-3 py-0.5 text-xs"
            title="Provider and model for this run"
            data-glass-surface="tile"
            data-testid="onboarding-run-pill"
            >{{ label }}</span
          >
        }
      </div>
      @if (!onHome() && !onEntryPage()) {
        <ptah-workspace-header class="mb-5 block" />
      }

      <router-outlet (activate)="onPageActivated()" />

      <div
        class="sr-only"
        role="status"
        aria-live="polite"
        data-testid="onboarding-announcer"
      >
        {{ announcer.message() }}
      </div>
    </div>
  `,
})
export class OnboardingShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focus = inject(OnboardingFocusService);
  private readonly flag = inject(OnboardingFlagService);
  private readonly appState = inject(AppStateManager);

  protected readonly announcer = inject(OnboardingAnnouncerService);
  protected readonly runPill = inject(OnboardingRunPillService);

  /** Whether the outlet shows Home (the bare `/onboarding` route). */
  protected readonly onHome = signal(true);
  protected readonly onEntryPage = signal(false);
  /** The second crumb, from the active child route's `data.crumb`. */
  protected readonly crumb = signal<string | null>(null);

  /** A new page is in the outlet: update the crumb and focus its h1. */
  protected onPageActivated(): void {
    const child = this.route.firstChild;
    this.onHome.set(child?.routeConfig?.path === '');
    const path = child?.routeConfig?.path;
    this.onEntryPage.set((path === 'new-project' || path === 'team-builder') && child?.firstChild?.routeConfig?.path === '');
    const crumb: unknown = child?.snapshot.data['crumb'];
    this.crumb.set(typeof crumb === 'string' ? crumb : null);
    this.focus.focusHeading(this.host.nativeElement);
  }

  protected backToChat(): void {
    this.flag.markDismissed();
    this.appState.setCurrentView('chat');
  }
}
