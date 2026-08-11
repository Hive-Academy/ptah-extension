import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CalendarClock,
  LucideAngularModule,
  Radio,
  Video,
} from 'lucide-angular';

import { EmptyState, StatusBadge } from '@ptah-web/panel-ui';
import type { HubSection, HubSessionSummary } from '@ptah-contracts/community';

/**
 * NextSessionCard — the hub's hero: the single next upcoming session (R6.1).
 *
 * ⚠️ SINGULAR BY CONTRACT. `HubSessionSummary` answers "what is next", not
 * "show me the calendar"; the full feed is `/members/live`. Rendering a list
 * here would need a second request and would break R6.2.
 *
 * ⚠️ `'unavailable'` HERE MEANS THE CALENDAR INTEGRATION IS DOWN OR
 * UNCONFIGURED, NOT THAT NOTHING IS SCHEDULED (R3.6, R6.4, NFR-R3). Those are
 * opposite messages to a member deciding whether to keep their evening free,
 * so the two states get different copy and a different icon. The hub still
 * returns `200` in both cases — a disabled Calendar integration must never
 * blank the home screen.
 *
 * `kind` is declared with all three discriminants in Phase 1 (`calendar`,
 * `live`, `private`) although only `calendar` is emitted yet, so Phase 4 adds
 * data here rather than a field.
 */
@Component({
  selector: 'ptah-next-session-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, EmptyState, StatusBadge, LucideAngularModule],
  template: `
    <section
      class="rounded-xl border border-hairline bg-base-200 p-5 sm:p-6"
      aria-labelledby="hub-next-session"
    >
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary"
        >
          <lucide-angular
            [img]="RadioIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
          Next live session
        </span>
        @if (isUnavailable()) {
          <ptah-status-badge variant="warning" label="Unavailable" size="xs" />
        }
      </div>

      @if (session(); as next) {
        <h2
          id="hub-next-session"
          class="mt-4 text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          {{ next.title }}
        </h2>

        <p
          class="mt-2 flex flex-wrap items-center gap-2 font-mono text-sm text-base-content-muted"
        >
          <lucide-angular
            [img]="CalendarClockIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          <time [attr.datetime]="next.startsAt">
            {{ next.startsAt | date: 'EEEE, MMM d' }} ·
            {{ next.startsAt | date: 'HH:mm' }}
            @if (next.endsAt) {
              – {{ next.endsAt | date: 'HH:mm' }}
            }
          </time>
        </p>

        <div class="mt-5 flex flex-wrap items-center gap-3">
          @if (next.meetLink; as meet) {
            <a
              [href]="meet"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-primary btn-sm gap-2"
            >
              <lucide-angular
                [img]="VideoIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Join session
            </a>
          } @else {
            <!--
              No conference link on the event. Say so rather than rendering a
              dead "Join" button: a member who clicks a button that does nothing
              assumes the product is broken, not that the host has not opened
              the room yet.
            -->
            <p class="text-sm text-base-content-muted">
              The join link is published by the host closer to the start time.
            </p>
          }
        </div>
      } @else {
        <h2 id="hub-next-session" class="sr-only">Next live session</h2>
        @if (isUnavailable()) {
          <ptah-empty-state
            [icon]="CalendarClockIcon"
            message="The session calendar could not be reached."
            hint="Nothing has been cancelled — we just cannot read the schedule right now. The rest of this page is up to date."
          />
        } @else {
          <ptah-empty-state
            [icon]="CalendarClockIcon"
            message="No sessions scheduled yet."
            hint="Live sessions are announced in the community; the next one will appear here."
          />
        }
      }
    </section>
  `,
})
export class NextSessionCard {
  public readonly section =
    input.required<HubSection<HubSessionSummary | null>>();

  protected readonly RadioIcon = Radio;
  protected readonly VideoIcon = Video;
  protected readonly CalendarClockIcon = CalendarClock;

  /**
   * `data` is only trusted when the section reports `'ok'`. A section can carry
   * a stale payload alongside a non-ok status, and rendering it would show a
   * session we were explicitly told we could not confirm.
   */
  protected readonly session = computed<HubSessionSummary | null>(() => {
    const section = this.section();
    return section.status === 'ok' ? section.data : null;
  });

  protected readonly isUnavailable = computed(
    () => this.section().status === 'unavailable',
  );
}
