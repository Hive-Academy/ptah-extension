import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { AlertTriangle, LucideAngularModule } from 'lucide-angular';

import { StatTile } from '@ptah-web/panel-ui';
import type { MemberHubResponse } from '@ptah-contracts/community';

import { MemberHubApiService } from '../services/member-hub-api.service';
import { CommunityActivityCard } from './sections/community-activity-card';
import { ContinueLearningCard } from './sections/continue-learning-card';
import { NextSessionCard } from './sections/next-session-card';
import { PacksCard } from './sections/packs-card';

/**
 * HubPage — `/members/hub`, the first screen a Builders member sees.
 *
 * ⚠️ EXACTLY ONE DATA REQUEST ON INITIAL RENDER (R6.2). Everything on this
 * page — greeting, cohort chips, the three metrics, and all four section cards
 * — is derived from the single `GET /api/v1/members/hub` response held in
 * {@link hub}. No child fetches. If a future section needs data, it goes into
 * that envelope on the server; it does not become a second call here. The
 * aggregate endpoint's entire purpose is defeated the moment this page issues
 * two requests, and `member-hub-api.service.spec.ts` plus the e2e network count
 * both assert it does not.
 *
 * ⚠️ SECTION STATUS IS NOT PAGE STATUS. A section reporting `'unavailable'`
 * degrades ONE card and the page still renders (R6.4, NFR-R3). The error state
 * below is reserved for the hub request itself failing — at which point five
 * empty cards would read as "you have nothing", which is the wrong message to a
 * paying member, so we say the load failed instead.
 */
@Component({
  selector: 'ptah-hub-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StatTile,
    LucideAngularModule,
    NextSessionCard,
    ContinueLearningCard,
    CommunityActivityCard,
    PacksCard,
  ],
  template: `
    @if (hub(); as data) {
      <div class="flex flex-col gap-6">
        <header>
          <h1
            class="text-3xl font-bold tracking-tight text-base-content sm:text-4xl"
          >
            {{ greeting() }}
          </h1>

          <p class="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span
              class="h-2 w-2 rounded-full bg-primary"
              aria-hidden="true"
            ></span>
            <span class="text-base-content/60">Membership status:</span>
            @for (cohort of data.member.cohorts; track cohort.key) {
              <span class="badge badge-primary badge-sm font-mono">
                {{ cohort.name }}
              </span>
            } @empty {
              <!--
                An entitled member with no MemberGroupAssignment is a valid,
                normal state (R7.8, A-2) — it is the live default today. Say
                what is true rather than leaving the row blank.
              -->
              <span class="badge badge-primary badge-sm font-mono">
                Full access member
              </span>
            }
          </p>
        </header>

        <ptah-next-session-card [section]="data.sections.sessions" />

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ptah-stat-tile
            label="Course progress"
            [value]="courseProgress()"
            [emphasis]="true"
          />
          <ptah-stat-tile label="Packs available" [value]="packCount()" />
          <ptah-stat-tile
            label="Unread replies"
            [value]="unreadReplies()"
            link="/members/notifications"
          />
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <ptah-community-activity-card [section]="data.sections.community" />
          </div>
          <div class="flex flex-col gap-6">
            <ptah-continue-learning-card [section]="data.sections.learning" />
            <ptah-packs-card [section]="data.sections.packs" />
          </div>
        </div>
      </div>
    } @else if (errorMessage(); as message) {
      <div
        class="mx-auto max-w-lg rounded-xl border border-hairline bg-base-200 p-6 text-center"
        role="alert"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="mx-auto h-8 w-8 text-warning"
          aria-hidden="true"
        />
        <h1 class="mt-3 text-lg font-semibold text-base-content">
          We couldn't load your hub
        </h1>
        <p class="mt-1 text-sm text-base-content/60">{{ message }}</p>
        <button
          type="button"
          class="btn btn-primary btn-sm mt-4"
          (click)="load()"
        >
          Try again
        </button>
      </div>
    } @else {
      <!-- Skeleton mirrors the real layout so the page does not jump on load. -->
      <div class="flex flex-col gap-6" aria-busy="true" aria-live="polite">
        <span class="sr-only">Loading your hub</span>
        <div class="h-10 w-72 animate-pulse rounded-lg bg-base-200"></div>
        <div class="h-48 animate-pulse rounded-xl bg-base-200"></div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (tile of skeletonTiles; track tile) {
            <div class="h-24 animate-pulse rounded-lg bg-base-200"></div>
          }
        </div>
        <div class="grid gap-6 lg:grid-cols-3">
          <div
            class="h-72 animate-pulse rounded-xl bg-base-200 lg:col-span-2"
          ></div>
          <div class="h-72 animate-pulse rounded-xl bg-base-200"></div>
        </div>
      </div>
    }
  `,
})
export class HubPage {
  private readonly api = inject(MemberHubApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly skeletonTiles = [0, 1, 2];

  private readonly _hub = signal<MemberHubResponse | null>(null);
  protected readonly hub = this._hub.asReadonly();
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Falls back to a generic greeting rather than rendering "Welcome back,
   * null". `firstName` is null for a member who never supplied one, which is
   * common for OAuth signups.
   */
  protected readonly greeting = computed(() => {
    const firstName = this._hub()?.member.firstName;
    return firstName ? `Welcome back, ${firstName}` : 'Welcome back';
  });

  /**
   * `null` (rendered as an em-dash by `StatTile`) when there is no course in
   * progress. `0%` would claim the member has started something and made no
   * progress, which is a different and wrong statement.
   */
  protected readonly courseProgress = computed<string | null>(() => {
    const learning = this._hub()?.sections.learning;
    if (!learning || learning.status !== 'ok' || !learning.data) return null;
    return `${learning.data.percent}%`;
  });

  protected readonly packCount = computed<number | null>(() => {
    const packs = this._hub()?.sections.packs;
    if (!packs) return null;
    // An unavailable registry is unknown, not zero. "0 packs" is a claim.
    return packs.status === 'unavailable' ? null : packs.data.length;
  });

  protected readonly unreadReplies = computed<number | null>(() => {
    const notifications = this._hub()?.sections.notifications;
    if (!notifications) return null;
    return notifications.status === 'unavailable'
      ? null
      : notifications.data.unreadCount;
  });

  public constructor() {
    this.load();
  }

  /**
   * Issues THE request. Called once from the constructor; the only other caller
   * is the member pressing "Try again", which is a deliberate user action and
   * not part of the initial render R6.2 measures.
   */
  protected load(): void {
    this.errorMessage.set(null);
    this._hub.set(null);

    this.api
      .getHub()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this._hub.set(response),
        error: (error: unknown) => {
          this.errorMessage.set(
            error instanceof Error
              ? error.message
              : 'Something went wrong loading your hub.',
          );
        },
      });
  }
}
