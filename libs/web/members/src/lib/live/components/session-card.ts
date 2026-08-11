import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CalendarClock,
  LucideAngularModule,
  Play,
  Radio,
  Video,
} from 'lucide-angular';

import type { LiveFeedItem } from '@ptah-contracts/community';

import { formatDuration } from '../../services/member-live-api.service';

/**
 * SessionCard — one entry in the Live feed, in whichever of its three states
 * the SERVER says it is in (R3.3, R3.4, R3.5).
 *
 * ── 🔴 R3.3: DISTINGUISHED BY STATE, NEVER BY SOURCE (ASSUMPTION-15) ───────
 * R3.3 requires the surface to be *"visually distinguished but not requiring
 * the member to know which system produced each"*, and `LiveFeedItem`'s own
 * docblock says the `source` discriminant *"is expected to be used for
 * behaviour, not for a 'source: Google' badge"*.
 *
 * So the visual language is the STATE:
 *   · `live`     — a LIVE NOW marker, and the join affordance is primary.
 *   · `upcoming` — a date and time, and the join affordance is secondary.
 *   · `replay`   — a runtime and a play affordance.
 *
 * **The words "Google", "Calendar" and "Ptah" appear nowhere in the rendered
 * output**, and a spec asserts their absence against an item of each source. A
 * member cannot tell — and has no reason to care — which system produced a row.
 *
 * ── 🔴 `state` COMES FROM THE SERVER AND IS NEVER RECOMPUTED (RISK-AC) ─────
 * There is no `new Date()`, no `Date.now()` and no comparison against
 * `startsAt` in this file. `LiveFeedItem.state`'s docblock is explicit about
 * why: two independent clocks produce a feed where an item is `'live'` in one
 * place and `'upcoming'` in another on the same screen, and the disagreement is
 * invisible in every test that fixes one of them. A spec holds `startsAt` fixed
 * and changes only `state`, which is the assertion a clock-recomputing
 * implementation fails.
 *
 * ── ⚠️ THE EMPTY SHAPE IS THE DEFAULT SHAPE IN THIS WORKSPACE ─────────────
 * `YOUTUBE_API_KEY` is empty (ASSUMPTION-6), so **every** row this product
 * currently serves has `durationSeconds: null` and `youtubeVideoId: null` —
 * measured across all fifty upcoming items on 2026-08-09. This card has to look
 * finished with both absent: no empty runtime slot, no dead play button, no
 * placeholder thumbnail frame. The populated variants are the exception here,
 * not the rule.
 *
 * ── NFR-U2 / NFR-U3 ───────────────────────────────────────────────────────
 * `base-200` surface, `border-hairline` boundary, `bg-surface-high` hover.
 * Title at full `base-content`; metadata at `text-base-content-muted`, whose
 * value is chosen per theme by `--bcm` rather than by an alpha modifier.
 * **No alpha tier appears here** — `/40` measures 3.18:1 and `/60` measures
 * 4.42:1 on `operator-member-light`, so neither clears WCAG AA everywhere.
 */
@Component({
  selector: 'ptah-session-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LucideAngularModule],
  template: `
    <article
      class="flex flex-col gap-3 rounded-xl border border-hairline bg-base-200 p-4 transition-colors hover:bg-surface-high"
      [attr.data-session-state]="item().state"
      [attr.data-session-key]="item().source + ':' + item().id"
      [attr.aria-label]="accessibleName()"
    >
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-base font-semibold text-base-content">
          {{ item().title }}
        </h3>

        @if (isLive()) {
          <!--
            NOT COLOUR-ONLY. The marker carries the words LIVE NOW, so it
            survives a monochrome render and a screen reader, and the dot is
            decorative.
          -->
          <span
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary"
          >
            <span
              class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              aria-hidden="true"
            ></span>
            Live now
          </span>
        }
      </div>

      <p
        class="flex flex-wrap items-center gap-2 font-mono text-sm text-base-content-muted"
      >
        <lucide-angular
          [img]="isReplay() ? PlayIcon : CalendarClockIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        <time [attr.datetime]="item().startsAt">
          {{ item().startsAt | date: 'EEE, MMM d' }} ·
          {{ item().startsAt | date: 'HH:mm' }}
          @if (item().endsAt; as ends) {
            – {{ ends | date: 'HH:mm' }}
          }
        </time>

        <!--
          durationSeconds is NULL on every row this workspace serves. Rendering
          a "0:00" runtime would assert a fact the server never sent, so the
          slot simply does not exist when the value does not.
          (No backticks in an inline-template comment — B7's F-8: one
          terminates the template literal and the error names neither the file
          nor the cause.)
        -->
        @if (runtime(); as duration) {
          <span aria-hidden="true">·</span>
          <span>{{ duration }}</span>
        }
      </p>

      <div class="mt-1 flex flex-wrap items-center gap-3">
        @if (isReplay()) {
          @if (item().youtubeVideoId) {
            <button
              type="button"
              class="btn btn-primary btn-sm min-h-11 gap-2 normal-case"
              (click)="playRequested.emit(item())"
            >
              <lucide-angular
                [img]="PlayIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Watch replay
            </button>
          }
        } @else if (item().meetLink; as meet) {
          <a
            [href]="meet"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-sm min-h-11 gap-2 normal-case"
            [class.btn-primary]="isLive()"
            [class.btn-outline]="!isLive()"
          >
            <lucide-angular
              [img]="isLive() ? RadioIcon : VideoIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
            {{ isLive() ? 'Join now' : 'Join session' }}
          </a>
        } @else {
          <!--
            No conference link on the event. Say so rather than rendering a dead
            Join button: a member who clicks a button that does nothing assumes
            the product is broken, not that the host has not opened the room
            yet. The sentence is next-session-card.ts's, reused verbatim so
            the hub and the feed say the same thing about the same situation.
          -->
          <p class="text-sm text-base-content-muted">
            The join link is published by the host closer to the start time.
          </p>
        }
      </div>
    </article>
  `,
})
export class SessionCard {
  public readonly item = input.required<LiveFeedItem>();

  /**
   * Emitted when the member activates a replay.
   *
   * ⚠️ THE CARD DOES NOT MOUNT A PLAYER AND MUST NOT (NFR-S3, ASSUMPTION-16).
   * `YouTubePlayer` in `../../learning/youtube-player` is the ONE component
   * allowed to construct an embed, pinned there by
   * `youtube-embed-chokepoint.spec.ts`. This card asks; `ReplaysPage` decides,
   * and it mounts at most one player at a time.
   *
   * ⚠️ NAMED `playRequested`, NOT `play`. `@angular-eslint/no-output-native`
   * refuses an output whose name shadows a standard DOM event, and it is right
   * to: `(play)` on a host element is ambiguous between this output and the
   * media event of the same name, and the two are indistinguishable in a
   * template. `youtube-player.ts` renamed `paused` to `playbackPaused` for
   * exactly this reason — same rule, same lib, same resolution.
   */
  public readonly playRequested = output<LiveFeedItem>();

  protected readonly CalendarClockIcon = CalendarClock;
  protected readonly PlayIcon = Play;
  protected readonly RadioIcon = Radio;
  protected readonly VideoIcon = Video;

  /** SERVER-DERIVED. See the class docblock — RISK-AC. */
  protected readonly isLive = computed(() => this.item().state === 'live');
  protected readonly isReplay = computed(() => this.item().state === 'replay');

  /**
   * The rendered runtime, or `null` when the server resolved no metadata.
   *
   * A DURATION, never a position (RISK-O / RISK-AD) — nothing on this surface
   * holds a position at all.
   */
  protected readonly runtime = computed<string | null>(() => {
    const seconds = this.item().durationSeconds;
    return seconds === null ? null : formatDuration(seconds);
  });

  /**
   * The card's accessible name states the STATE, because the visual marker
   * that carries it is a separate element a screen reader may reach after the
   * heading.
   */
  protected readonly accessibleName = computed(
    () => `${STATE_LABEL[this.item().state]}: ${this.item().title}`,
  );
}

/**
 * A `Record` over the union rather than string concatenation.
 *
 * B7's `UnreadPill` lesson: a naive `noun + 's'` shipped "3 unread replys"
 * until a spec caught it. A `Record` also fails to compile when a fourth state
 * is added, which is the point.
 */
const STATE_LABEL: Record<LiveFeedItem['state'], string> = {
  live: 'Live now',
  upcoming: 'Upcoming session',
  replay: 'Replay',
};
