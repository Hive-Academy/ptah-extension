import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertTriangle,
  CalendarClock,
  LucideAngularModule,
  MessageSquarePlus,
  Video,
} from 'lucide-angular';

import {
  type MemberSessionRequest,
  type SessionRequestStatus,
} from '@ptah-contracts/community';
import { SESSION_TOPICS, isMembershipRequiredError } from '@ptah-web/core';
import {
  BadgeVariant,
  DetailDrawer,
  EmptyState,
  StatusBadge,
} from '@ptah-web/panel-ui';

import { describeLoadFailure } from '../learning/courses-page';
import {
  MemberSessionRequestsApiService,
  isNotCancellableError,
} from '../services/member-session-requests-api.service';

/** `CreateSessionRequestDto.additionalNotes` is `@MaxLength(5000)`. */
const MAX_NOTES_LENGTH = 5000;

/**
 * How a status reads to a member, and how it is coloured.
 *
 * ⚠️ A `Record` OVER THE UNION, NOT A `switch` AND NOT STRING CONCATENATION.
 * Adding a fifth status to `SESSION_REQUEST_STATUSES` fails to compile here,
 * which is the point — B7's `UnreadPill` shipped "3 unread replys" because a
 * naive concatenation had nothing to fail against.
 *
 * ⚠️ `canceled` IS `neutral`, NOT `error`. A declined request is an outcome,
 * not a fault, and R4.8 makes the admin's reason member-visible precisely so
 * the member reads an explanation rather than a red badge.
 */
const STATUS_PRESENTATION: Record<
  SessionRequestStatus,
  { label: string; variant: BadgeVariant }
> = {
  pending: { label: 'Awaiting review', variant: 'warning' },
  scheduled: { label: 'Scheduled', variant: 'success' },
  completed: { label: 'Completed', variant: 'info' },
  canceled: { label: 'Closed', variant: 'neutral' },
};

/**
 * RequestSessionPage — `/members/live/request` (R4.2, R4.3, R4.8, R9.7).
 *
 * ── 🔴 OWN REQUESTS ONLY, AND THE ABSENCE IS INVISIBLE (R4.3, NFR-S4) ──────
 * `GET /v1/members/session-requests` puts `ctx.userId` into the server's
 * `where`, and `MemberSessionRequest` HAS NO REQUESTER FIELD — so a leak would
 * render here as one of your own requests with nothing to see. That is why the
 * exit-gate proof uses two seeded identities rather than inspecting a payload.
 * Verified live 2026-08-09: identity A holds one pending request; identity B's
 * list is `[]`.
 *
 * ── 🔴 THE COPY PROMISES NO PRICE AND NO FREE SESSION ──────────────────────
 * There are TWO request paths in this product and this is not the older one.
 * `POST /v1/sessions/request` (the marketing site's, driven by
 * `libs/web/account/.../sessions-grid.component.ts`) checks
 * `GET /v1/sessions/eligibility` and opens a Paddle checkout when the member
 * has no free session left. THIS endpoint consults no eligibility and takes no
 * payment — `is_free_session` defaults to `false` and `payment_status` to
 * `'none'` in the column defaults, measured.
 *
 * That is R4.10 working exactly as written: Phase 4 adds a member-facing flow
 * and redesigns no monetization. But it means this screen must not quote a
 * price and must not promise a free session, because it is not the screen that
 * decides either. It says the request is reviewed and scheduled by the team,
 * and a spec asserts the rendered copy carries no currency symbol and neither
 * "free" nor an amount. **The open decision is recorded in the batch report.**
 *
 * ── 🔴 NO MARKDOWN RENDERER LIVES HERE (ASSUMPTION-17, PRE-4, NFR-S2) ──────
 * `additionalNotes` is member-authored free text with no markdown affordance in
 * this composer, and `declineReason` is admin-authored plain prose (R4.8). The
 * contract names neither `bodyMarkdown`. Both render as ESCAPED TEXT NODES.
 * There is no `[innerHTML]` and no renderer import in this file, so
 * `markdown-chokepoint.spec.ts`'s importer list is unchanged.
 *
 * ── THE FORM CARRIES NO `FormsModule`, DELIBERATELY ────────────────────────
 * B7's finding: `ngModel` writes its value back through a microtask, so a
 * keystroke and the derived `canSubmit()` are one tick apart — invisible in a
 * browser and it made every spec race. Two consequences, both of which cost B7
 * time and both of which are honoured here: `(submit)` is the NATIVE event, not
 * `(ngSubmit)` (which without `FormsModule` binds a listener for a DOM event
 * that never fires, silently breaking Enter-to-submit), and `maxlength` is
 * `[attr.maxlength]`, not `[maxlength]` (a `FormsModule` directive input — it
 * fails with `NG0303`).
 *
 * ── THE `<select>` DRIVES ITS CHOICE THROUGH `[selected]` PER OPTION ───────
 * Not `[value]` on the select. Options that come from an `@for` in the same
 * change-detection pass are not in the DOM when a `[value]` binding runs, and
 * the select silently resets to the first one.
 */
@Component({
  selector: 'ptah-request-session-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LucideAngularModule,
    DetailDrawer,
    EmptyState,
    StatusBadge,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Request a session
        </h1>
        <p class="text-sm text-base-content/60">
          Ask for one-to-one time on a topic. We review every request and reply
          with a confirmed time and a video link.
        </p>
      </header>

      <form
        class="flex flex-col gap-4 rounded-xl border border-hairline bg-base-200 p-5"
        (submit)="submit($event)"
      >
        <div class="flex flex-col gap-1">
          <label
            class="text-sm font-medium text-base-content"
            [attr.for]="topicFieldId"
          >
            Topic
          </label>
          <select
            [id]="topicFieldId"
            class="select select-bordered w-full bg-base-100 text-sm"
            [disabled]="submitting()"
            (change)="onTopicChange($event)"
          >
            <option value="" [selected]="topicId() === ''">
              Choose a topic…
            </option>
            @for (option of topics; track option.id) {
              <option [value]="option.id" [selected]="option.id === topicId()">
                {{ option.title }}
              </option>
            }
          </select>
          @if (selectedTopic(); as chosen) {
            <p class="text-xs text-base-content/60">
              {{ chosen.description }}
            </p>
          }
        </div>

        <div class="flex flex-col gap-1">
          <label
            class="text-sm font-medium text-base-content"
            [attr.for]="notesFieldId"
          >
            Anything we should know? <span class="font-normal">(optional)</span>
          </label>
          <textarea
            [id]="notesFieldId"
            class="textarea textarea-bordered min-h-28 w-full bg-base-100 text-sm"
            placeholder="What you are building, where you are stuck, anything you want covered."
            [attr.maxlength]="maxNotesLength"
            [disabled]="submitting()"
            [value]="notes()"
            (input)="onNotesInput($event)"
          ></textarea>
          <p class="text-xs text-base-content/60">
            {{ notes().length }} / {{ maxNotesLength }}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            class="btn btn-primary btn-sm min-h-11 gap-2 normal-case"
            [disabled]="!canSubmit()"
          >
            <lucide-angular
              [img]="MessageSquarePlusIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
            {{ submitting() ? 'Sending…' : 'Send request' }}
          </button>
        </div>

        @if (submitError(); as message) {
          <p class="text-sm text-error" role="alert">{{ message }}</p>
        }
        @if (submitNotice(); as message) {
          <p class="text-sm text-success" role="status">{{ message }}</p>
        }
      </form>

      <section class="flex flex-col gap-3" aria-label="Your requests">
        <h2 class="text-lg font-semibold text-base-content">Your requests</h2>

        @if (listError(); as message) {
          <div
            class="rounded-xl border border-hairline bg-base-200 p-6 text-center"
            role="alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="mx-auto h-8 w-8 text-warning"
              aria-hidden="true"
            />
            <p class="mt-3 text-sm text-base-content">{{ message }}</p>
            <button
              type="button"
              class="btn btn-primary btn-sm mt-4 min-h-11 normal-case"
              (click)="reload()"
            >
              Try again
            </button>
          </div>
        } @else if (loading()) {
          <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading your requests</span>
            @for (row of skeletonRows; track row) {
              <div class="h-20 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else if (requests().length === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="CalendarClockIcon"
              message="You have not requested a session yet."
              hint="Pick a topic above and tell us what you want to cover."
            />
          </div>
        } @else {
          <ul class="flex flex-col gap-3">
            @for (request of requests(); track request.id) {
              <li
                class="flex flex-col gap-3 rounded-xl border border-hairline bg-base-200 p-4"
                [attr.data-request-id]="request.id"
                [attr.data-request-status]="request.status"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex flex-col gap-1">
                    <h3 class="text-base font-semibold text-base-content">
                      {{ topicTitle(request.sessionTopicId) }}
                    </h3>
                    <p class="font-mono text-xs text-base-content/60">
                      Requested
                      <time [attr.datetime]="request.createdAt">{{
                        request.createdAt | date: 'MMM d, y'
                      }}</time>
                    </p>
                  </div>
                  <ptah-status-badge
                    [variant]="statusVariant(request.status)"
                    [label]="statusLabel(request.status)"
                  />
                </div>

                @if (request.scheduledAt; as when) {
                  <p
                    class="flex flex-wrap items-center gap-2 font-mono text-sm text-base-content"
                  >
                    <lucide-angular
                      [img]="CalendarClockIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    <time [attr.datetime]="when">
                      {{ when | date: 'EEE, MMM d' }} ·
                      {{ when | date: 'HH:mm' }}
                    </time>
                    @if (request.durationMinutes; as minutes) {
                      <span>· {{ minutes }} min</span>
                    }
                  </p>
                }

                @if (request.declineReason; as reason) {
                  <!--
                    R4.8 — the admin's reason is member-visible by design, and
                    it is plain prose. Rendered as an escaped text node; there
                    is no renderer on this page (ASSUMPTION-17).
                  -->
                  <p class="text-sm text-base-content">{{ reason }}</p>
                }

                <div class="flex flex-wrap items-center gap-2">
                  @if (request.meetLink; as meet) {
                    <a
                      [href]="meet"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn btn-primary btn-sm min-h-11 gap-2 normal-case"
                    >
                      <lucide-angular
                        [img]="VideoIcon"
                        class="h-4 w-4"
                        aria-hidden="true"
                      />
                      Join session
                    </a>
                  }
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm min-h-11 normal-case"
                    (click)="openDetail(request)"
                  >
                    Details
                  </button>
                  @if (request.status === 'pending') {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-11 normal-case"
                      [disabled]="withdrawing() === request.id"
                      (click)="withdraw(request)"
                    >
                      {{
                        withdrawing() === request.id
                          ? 'Withdrawing…'
                          : 'Withdraw'
                      }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        }

        @if (listNotice(); as message) {
          <p class="text-sm text-base-content/60" role="status">
            {{ message }}
          </p>
        }
      </section>

      <ptah-detail-drawer
        [open]="detail() !== null"
        title="Session request"
        (closed)="closeDetail()"
      >
        @if (detail(); as request) {
          <dl class="flex flex-col gap-4 text-sm">
            <div class="flex flex-col gap-1">
              <dt class="text-base-content/60">Topic</dt>
              <dd class="text-base-content">
                {{ topicTitle(request.sessionTopicId) }}
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-base-content/60">Status</dt>
              <dd>
                <ptah-status-badge
                  [variant]="statusVariant(request.status)"
                  [label]="statusLabel(request.status)"
                />
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-base-content/60">Requested</dt>
              <dd class="font-mono text-base-content">
                <time [attr.datetime]="request.createdAt">{{
                  request.createdAt | date: 'MMM d, y · HH:mm'
                }}</time>
              </dd>
            </div>
            @if (request.scheduledAt; as when) {
              <div class="flex flex-col gap-1">
                <dt class="text-base-content/60">Scheduled for</dt>
                <dd class="font-mono text-base-content">
                  <time [attr.datetime]="when">{{
                    when | date: 'EEEE, d MMMM y · HH:mm'
                  }}</time>
                </dd>
              </div>
            }
            @if (request.additionalNotes; as notes) {
              <div class="flex flex-col gap-1">
                <dt class="text-base-content/60">Your notes</dt>
                <dd class="whitespace-pre-wrap text-base-content">
                  {{ notes }}
                </dd>
              </div>
            }
            @if (request.declineReason; as reason) {
              <div class="flex flex-col gap-1">
                <dt class="text-base-content/60">Reply from the team</dt>
                <dd class="whitespace-pre-wrap text-base-content">
                  {{ reason }}
                </dd>
              </div>
            }
          </dl>
        }
      </ptah-detail-drawer>
    </div>
  `,
})
export class RequestSessionPage {
  private readonly api = inject(MemberSessionRequestsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CalendarClockIcon = CalendarClock;
  protected readonly MessageSquarePlusIcon = MessageSquarePlus;
  protected readonly VideoIcon = Video;
  protected readonly skeletonRows = [0, 1];

  protected readonly topicFieldId = 'session-request-topic';
  protected readonly notesFieldId = 'session-request-notes';
  protected readonly maxNotesLength = MAX_NOTES_LENGTH;

  /**
   * ⚠️ THE EXISTING CATALOGUE, IMPORTED (ASSUMPTION-18). `sessionTopicId` is a
   * FREE STRING server-side — `create-session-request.dto.ts` says so in terms,
   * there is no `SessionTopic` table, and the DTO validates membership of
   * nothing. `SESSION_TOPICS` in `@ptah-web/core` is what the public sessions
   * grid already offers, so authoring a second catalogue here would fill the
   * admin queue with two vocabularies for one column.
   */
  protected readonly topics = SESSION_TOPICS;

  protected readonly topicId = signal('');
  protected readonly notes = signal('');
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitNotice = signal<string | null>(null);

  protected readonly loading = signal(true);
  protected readonly listError = signal<string | null>(null);
  protected readonly listNotice = signal<string | null>(null);
  protected readonly requests = signal<readonly MemberSessionRequest[]>([]);
  protected readonly withdrawing = signal<string | null>(null);
  protected readonly detail = signal<MemberSessionRequest | null>(null);

  protected readonly selectedTopic = computed(() =>
    this.topics.find((topic) => topic.id === this.topicId()),
  );

  protected readonly canSubmit = computed(
    () => this.topicId() !== '' && !this.submitting(),
  );

  public constructor() {
    this.load();
  }

  protected statusLabel(status: SessionRequestStatus): string {
    return STATUS_PRESENTATION[status].label;
  }

  protected statusVariant(status: SessionRequestStatus): BadgeVariant {
    return STATUS_PRESENTATION[status].variant;
  }

  /**
   * The topic's human title, or the raw id.
   *
   * ⚠️ THE RAW ID IS THE FALLBACK, NOT A BLANK. `sessionTopicId` is a free
   * string with no foreign key, so a request submitted through the OTHER path
   * — or through an older catalogue — can carry an id this build does not
   * know. Showing the id is honest; showing nothing would make the member's own
   * request unidentifiable.
   */
  protected topicTitle(sessionTopicId: string): string {
    return (
      this.topics.find((topic) => topic.id === sessionTopicId)?.title ??
      sessionTopicId
    );
  }

  protected onTopicChange(event: Event): void {
    this.topicId.set((event.target as HTMLSelectElement).value);
    this.submitError.set(null);
  }

  protected onNotesInput(event: Event): void {
    this.notes.set((event.target as HTMLTextAreaElement).value);
  }

  protected openDetail(request: MemberSessionRequest): void {
    this.detail.set(request);
  }

  protected closeDetail(): void {
    this.detail.set(null);
  }

  protected reload(): void {
    this.load();
  }

  protected submit(event: Event): void {
    // ⚠️ THE NATIVE `submit` EVENT. Without `FormsModule` there is no
    // `(ngSubmit)` to bind, and binding it would silently break
    // Enter-to-submit.
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.submitError.set(null);
    this.submitNotice.set(null);

    this.api
      .submit({
        sessionTopicId: this.topicId(),
        additionalNotes: this.notes(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.topicId.set('');
          this.notes.set('');
          this.submitNotice.set(
            'Request sent. We will reply with a time and a video link.',
          );
          // 🔴 THE WITHDRAW NOTICE IS ABOUT THE PREVIOUS ACTION AND IS NOW
          // STALE. It was cleared only at the top of `withdraw()`, so without
          // this a member who failed to withdraw one request and then
          // successfully submitted another kept reading "That request has
          // already been answered" under a list that had just changed for an
          // unrelated reason.
          this.listNotice.set(null);
          // ⚠️ RE-READ RATHER THAN SPLICE. The list is the only thing that can
          // be authoritative about what the server now holds.
          this.load();
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.submitError.set(describeSubmitFailure(error));
        },
      });
  }

  protected withdraw(request: MemberSessionRequest): void {
    // 🔴 ONE WITHDRAW IN FLIGHT AT A TIME. `withdrawing` holds a SINGLE id, so
    // a click on row B while row A's DELETE was still open overwrote it — which
    // re-enabled row A's button and let the same request be cancelled twice
    // before the first response landed. The signal is the disabled-state source
    // for every row, so it has to gate entry as well as describe it.
    if (this.withdrawing() !== null) return;

    this.withdrawing.set(request.id);
    this.listNotice.set(null);

    this.api
      .cancel(request.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.withdrawing.set(null);
          this.load();
        },
        error: (error: unknown) => {
          this.withdrawing.set(null);
          // 🔴 THE ENTITLEMENT GATE IS CHECKED FIRST. Both are `403`s and they
          // have OPPOSITE dispositions — one means "you are not a member any
          // more", the other means "this request was already answered". The
          // order is the whole distinction.
          if (isMembershipRequiredError(error)) {
            this.listError.set(
              'Your membership could not be confirmed. Reload the page to continue.',
            );
            return;
          }
          if (isNotCancellableError(error)) {
            // ⚠️ NO "forbidden", NO "not allowed", NO "permission". The server
            // answers 403 for "not yours", "already scheduled" and
            // "nonexistent" indistinguishably, so the overwhelmingly likely
            // cause is that the request was answered while this page was open.
            this.listNotice.set(
              'That request has already been answered, so it can no longer be withdrawn. The list below is up to date.',
            );
            this.load();
            return;
          }
          this.listNotice.set(
            'We could not withdraw that request. Please try again.',
          );
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.listError.set(null);

    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          this.requests.set(requests);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          // Cleared, so a failed retry leaves nothing stale under the banner.
          this.requests.set([]);
          this.detail.set(null);
          // 🔴 AND THE WITHDRAW NOTICE GOES WITH THEM. Its copy ends "The list
          // below is up to date", which a failed reload makes untrue — and the
          // notice block sits OUTSIDE the error/loading/list chain, so without
          // this the member reads a retryable error and a claim that the list
          // is current, at the same time.
          this.listNotice.set(null);
          this.listError.set(
            describeLoadFailure(error, 'We could not load your requests.'),
          );
        },
      });
  }
}

/**
 * A member-facing sentence for a failed submit.
 *
 * ⚠️ A `429` GETS ITS OWN SENTENCE. The create is throttled at 10/min
 * (`CONTENT_CREATION`), and "please try again" is actively wrong advice for a
 * rate limit — it invites the one action that keeps it firing.
 *
 * ⚠️ A `400` IS NOT SHOWN VERBATIM. `forbidNonWhitelisted` produces messages
 * like "property status should not exist", which name a wire field a member
 * never typed.
 */
function describeSubmitFailure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429) {
      return 'You have sent several requests in a short time. Please wait a minute and try again.';
    }
    if (isMembershipRequiredError(error)) {
      return 'Your membership could not be confirmed. Reload the page to continue.';
    }
  }
  return 'We could not send that request. Please try again.';
}
