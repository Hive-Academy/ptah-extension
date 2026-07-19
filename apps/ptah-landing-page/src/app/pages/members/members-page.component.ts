import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BookOpen,
  Code2,
  ExternalLink,
  FileStack,
  GraduationCap,
  LucideAngularModule,
  Users,
} from 'lucide-angular';
import { NavigationComponent } from '../../components/navigation.component';
import {
  BuildersSession,
  isMembershipRequiredError,
  MembersApiService,
} from '../../services/members-api.service';
import {
  getMemberGroupBadgeLabel,
  isFoundingMemberGroup,
  MemberGroupBadge,
} from '../profile/models/license-data.interface';
import { BuildersPitchComponent } from './components/builders-pitch.component';
import { SessionCardComponent } from './components/session-card.component';

/** One honest, link-free placeholder for the "Course & artifacts" section. */
interface ArtifactPlaceholder {
  readonly icon: typeof BookOpen;
  readonly title: string;
  readonly body: string;
}

/**
 * MembersPageComponent — `/members`, AuthGuard-protected.
 *
 * A single call to `GET /api/v1/members/sessions` does double duty as both
 * the data fetch and the membership gate: a 403 `membership_required`
 * response (see `isMembershipRequiredError`) routes non-Builders viewers to
 * {@link BuildersPitchComponent} instead of a dead end; any other failure
 * shows a retry state (same pattern as `ProfilePageComponent.errorMessage`).
 * A 200 response renders the three Builders sections: upcoming live
 * sessions, the community link, and course & artifacts placeholders.
 */
@Component({
  selector: 'ptah-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    NavigationComponent,
    SessionCardComponent,
    BuildersPitchComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100">
      <ptah-navigation />

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="min-h-screen flex items-center justify-center">
          <div class="text-center">
            <span
              class="loading loading-spinner loading-lg text-secondary"
            ></span>
            <p class="mt-4 text-neutral-content">Loading the members area...</p>
          </div>
        </div>
      }

      <!-- Error State (real failures only — the 403 gate renders the pitch below) -->
      @if (errorMessage() && !isLoading()) {
        <div class="min-h-screen flex items-center justify-center p-4">
          <div
            class="max-w-md w-full bg-base-200/95 backdrop-blur-xl border border-error/30 rounded-3xl p-8 shadow-2xl"
          >
            <div class="alert alert-error mb-4">
              <h3 class="font-bold">Couldn't Load Members Area</h3>
              <p>{{ errorMessage() }}</p>
            </div>
            <button class="btn btn-error w-full" (click)="loadSessions()">
              Retry
            </button>
          </div>
        </div>
      }

      <!-- Non-member pitch (403 membership_required) -->
      @if (membershipRequired() && !isLoading()) {
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
          <ptah-builders-pitch />
        </div>
      }

      <!-- Member content -->
      @if (!isLoading() && !errorMessage() && !membershipRequired()) {
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
          <header class="mb-8">
            <p
              class="font-mono text-xs uppercase tracking-[0.2em] text-secondary/80 mb-2"
            >
              Ptah Builders
            </p>
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">
                Members' Area
              </h1>
              @if (memberGroups().length > 0) {
                <div class="flex flex-wrap gap-2">
                  @for (group of memberGroups(); track group.key) {
                    <span
                      class="badge badge-lg gap-1"
                      [class]="
                        isFoundingGroup(group) ? 'badge-warning' : 'badge-ghost'
                      "
                    >
                      {{ groupBadgeLabel(group) }}
                    </span>
                  }
                </div>
              }
            </div>
            <p class="mt-2 text-neutral-content">
              Live sessions, the private community, and what's coming with the
              founding cohort.
            </p>
          </header>

          <!-- (a) Upcoming live sessions -->
          <section aria-labelledby="sessions-heading" class="mb-8">
            <div
              class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
            >
              <div
                class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
              >
                <lucide-angular
                  [img]="GraduationCapIcon"
                  class="w-5 h-5 text-secondary"
                  aria-hidden="true"
                />
                <h2
                  id="sessions-heading"
                  class="font-display text-lg font-semibold"
                >
                  Upcoming Live Sessions
                </h2>
              </div>

              @if (sessions().length > 0) {
                <div class="divide-y divide-secondary/10">
                  @for (session of sessions(); track session.id) {
                    <ptah-session-card [session]="session" />
                  }
                </div>
              } @else {
                <div class="px-6 py-8 text-center text-neutral-content text-sm">
                  No sessions scheduled in the next 60 days. Check back soon.
                </div>
              }
            </div>
          </section>

          <!-- (b) Community -->
          <section aria-labelledby="community-heading" class="mb-8">
            <div
              class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
            >
              <div
                class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
              >
                <lucide-angular
                  [img]="UsersIcon"
                  class="w-5 h-5 text-secondary"
                  aria-hidden="true"
                />
                <h2
                  id="community-heading"
                  class="font-display text-lg font-semibold"
                >
                  Community
                </h2>
              </div>

              <div class="px-6 py-5">
                @if (communityUrl(); as url) {
                  <div
                    class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <p class="text-sm text-neutral-content">
                      Ask questions, share your build, and get help from other
                      Builders in the private community.
                    </p>
                    <a
                      [href]="url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn btn-secondary btn-sm shrink-0"
                      aria-label="Open the Builders community"
                    >
                      <lucide-angular
                        [img]="ExternalLinkIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                      Open Community
                    </a>
                  </div>
                } @else {
                  <p class="text-sm text-neutral-content">
                    Your community space is being set up — check back soon.
                  </p>
                }
              </div>
            </div>
          </section>

          <!-- (c) Course & artifacts -->
          <section aria-labelledby="artifacts-heading">
            <h2
              id="artifacts-heading"
              class="font-display text-lg font-semibold mb-4"
            >
              Course &amp; Artifacts
            </h2>
            <div class="grid sm:grid-cols-3 gap-4">
              @for (item of artifactPlaceholders; track item.title) {
                <div
                  class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl p-5"
                >
                  <lucide-angular
                    [img]="item.icon"
                    class="w-6 h-6 text-secondary mb-3"
                    aria-hidden="true"
                  />
                  <h3 class="font-semibold text-sm">{{ item.title }}</h3>
                  <p class="mt-1 text-xs text-neutral-content leading-relaxed">
                    {{ item.body }}
                  </p>
                  <span class="badge badge-sm badge-ghost mt-3">
                    Coming with the founding cohort
                  </span>
                </div>
              }
            </div>
          </section>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class MembersPageComponent implements OnInit {
  protected readonly GraduationCapIcon = GraduationCap;
  protected readonly UsersIcon = Users;
  protected readonly ExternalLinkIcon = ExternalLink;

  /** Cohort chip helpers, shared with `ProfileHeaderComponent`. */
  protected readonly isFoundingGroup = isFoundingMemberGroup;
  protected readonly groupBadgeLabel = getMemberGroupBadgeLabel;

  private readonly membersApi = inject(MembersApiService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly isLoading = signal(true);
  public readonly errorMessage = signal<string | null>(null);
  public readonly membershipRequired = signal(false);
  public readonly sessions = signal<BuildersSession[]>([]);
  public readonly communityUrl = signal<string | null>(null);
  public readonly memberGroups = signal<MemberGroupBadge[]>([]);

  /** Honest, link-free placeholders — no fake URLs. */
  protected readonly artifactPlaceholders: readonly ArtifactPlaceholder[] = [
    {
      icon: GraduationCap,
      title: 'PRD-to-Production Course',
      body: 'A structured path from a one-page PRD to a production-shaped SaaS.',
    },
    {
      icon: Code2,
      title: 'Reference Codebase',
      body: 'A production-shaped example build to learn the delivery patterns from.',
    },
    {
      icon: FileStack,
      title: 'Workflow Assets',
      body: 'Skill packs and delivery patterns extracted from real Builder sessions.',
    },
  ];

  public ngOnInit(): void {
    this.loadSessions();
  }

  public loadSessions(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.membershipRequired.set(false);

    this.membersApi
      .getSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sessions.set(res.sessions);
          this.communityUrl.set(res.communityUrl);
          this.memberGroups.set(res.memberGroups ?? []);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.isLoading.set(false);
          if (isMembershipRequiredError(error)) {
            this.membershipRequired.set(true);
            return;
          }
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load the members area. Please try again.';
          this.errorMessage.set(message);
        },
      });
  }
}
