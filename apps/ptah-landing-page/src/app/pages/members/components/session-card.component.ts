import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { Calendar, LucideAngularModule, Repeat, Video } from 'lucide-angular';
import { BuildersSession } from '../../../services/members-api.service';

/**
 * SessionCardComponent — one `BuildersSession` row on `/members`:
 * date/time rendered in the viewer's locale + timezone (the "calendar
 * hint"), a Join CTA when `meetLink` is present, and a Recurring badge.
 */
@Component({
  selector: 'ptah-session-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-semibold truncate">{{ session().title }}</h3>
          @if (session().recurring) {
            <span
              class="badge badge-sm badge-ghost gap-1"
              aria-label="Recurring session"
            >
              <lucide-angular
                [img]="RepeatIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              Recurring
            </span>
          }
        </div>
        <p class="mt-1 text-sm text-neutral-content flex items-center gap-1.5">
          <lucide-angular
            [img]="CalendarIcon"
            class="w-3.5 h-3.5 shrink-0"
            aria-hidden="true"
          />
          {{ dateLabel() }} · {{ timeRangeLabel() }}
        </p>
      </div>

      @if (session().meetLink) {
        <a
          [href]="session().meetLink"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-secondary btn-sm shrink-0"
          [attr.aria-label]="'Join ' + session().title + ' via Google Meet'"
        >
          <lucide-angular
            [img]="VideoIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Join
        </a>
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
export class SessionCardComponent {
  protected readonly CalendarIcon = Calendar;
  protected readonly RepeatIcon = Repeat;
  protected readonly VideoIcon = Video;

  public readonly session = input.required<BuildersSession>();

  /** Locale-aware date, e.g. "Tue, Jul 21". Uses the viewer's browser locale. */
  protected readonly dateLabel = computed(() =>
    new Date(this.session().startsAt).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
  );

  /**
   * Locale-aware start–end time range with the viewer's timezone name, e.g.
   * "2:00 PM – 3:30 PM PDT" — the "calendar hint" that lets a member place
   * the session on their own calendar without a conversion.
   */
  protected readonly timeRangeLabel = computed(() => {
    const start = new Date(this.session().startsAt);
    const end = new Date(this.session().endsAt);
    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
    };
    const tzLabel =
      new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(start)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleTimeString(undefined, timeOpts)} ${tzLabel}`.trim();
  });
}
