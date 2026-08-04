import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { HubSection, HubSessionSummary } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import { SessionsService, type BuildersSession } from '@ptah-api/community';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `sessions` section — THE ONE SECTION PHASE 1 ACTUALLY POPULATES.
 *
 * Answers "what is next", singular, from the Google Calendar path that already
 * ships (`SessionsService.listUpcomingSessions`, cohort-scoped per user). The
 * full feed stays at `GET /v1/members/sessions`; the hub carries one card.
 *
 * ── WHY `@Optional()` (pattern: `members.controller.ts:48-50`) ─────────────
 * `SessionsService` is provided by `GoogleSessionsModule`. `@Optional()` means
 * an unregistered module degrades THIS CARD to `'unavailable'` instead of
 * failing `MemberHubModule`'s construction and taking the whole home screen
 * with it. That is the same posture `MembersController` and `SessionsService`
 * itself already take toward their own optional collaborators.
 *
 * ── NFR-R1: FEATURE-OFF IS `'unavailable'`, NOT AN ERROR AND NOT `'empty'` ─
 * With `GOOGLE_OAUTH_*` unset, `SessionsService.isEnabled()` is `false` and
 * `listUpcomingSessions` returns `[]` (logged once). Reading that `[]` without
 * asking `isEnabled()` first would report `'empty'` — telling the member "you
 * have no upcoming sessions", which is a claim we cannot make when we never
 * looked. So the switch is checked explicitly and the answer is
 * `{ status: 'unavailable', data: null }`, with a `200` hub around it
 * (R6.4, R3.6, NFR-R1/R3).
 *
 * ── THE THIRD STATE: CONFIGURED, ASKED, AND GOOGLE DID NOT ANSWER ─────────
 * Feature-off is not the only way to have no list. Google can be configured
 * and enabled and still fail, and `listUpcomingSessions` used to flatten that
 * failure into `[]` — which this section would then report as `'empty'`, i.e.
 * "you have no upcoming sessions" during an outage. That is the same false
 * claim NFR-R1 forbids for the feature-off case, arriving by a different door.
 *
 * So this reads `readUpcomingSessions`, which answers `{ ok: false, reason }`
 * instead of an empty list, and BOTH non-answers map to `'unavailable'`. The
 * distinction the member needs is "we could not look" vs "we looked and there
 * is nothing" — not which of the two reasons we could not look. `'disabled'`
 * and `'fetch_failed'` are separated in the LOG, where an operator can act on
 * the difference.
 *
 * The failure stays a VALUE rather than a throw, so it never becomes a `500`:
 * the hub answers `200` with this one card degraded (R6.4, R3.6, NFR-R3).
 */
@Injectable()
export class SessionsSection implements HubSectionResolver<HubSessionSummary | null> {
  private readonly logger = new Logger(SessionsSection.name);

  constructor(
    @Optional()
    @Inject(SessionsService)
    private readonly sessions?: SessionsService,
  ) {}

  async resolve(
    ctx: MemberContext,
  ): Promise<HubSection<HubSessionSummary | null>> {
    if (!this.sessions) {
      this.logger.warn(
        'SessionsService is unbound (GoogleSessionsModule not registered) — ' +
          'hub sessions section reports unavailable',
      );
      return { status: 'unavailable', data: null };
    }

    if (!this.sessions.isEnabled()) {
      return { status: 'unavailable', data: null };
    }

    const result = await this.sessions.readUpcomingSessions(ctx.userId);
    if (!result.ok) {
      // Reached when Google IS configured but the Calendar read did not
      // succeed. Reporting `'empty'` here would tell the member they have
      // nothing scheduled on the strength of a request that failed.
      this.logger.warn(
        `Upcoming sessions unavailable for user ${ctx.userId} (${result.reason}) — ` +
          'hub sessions section reports unavailable rather than empty',
      );
      return { status: 'unavailable', data: null };
    }

    const next = earliest(result.sessions);
    if (!next) {
      return { status: 'empty', data: null };
    }

    return { status: 'ok', data: toHubSessionSummary(next) };
  }
}

/**
 * The earliest session by start time, or `null`.
 *
 * ⚠️ SORTED HERE RATHER THAN TRUSTED. Google's list is requested in start
 * order, but the cohort scoping in `SessionsService` filters that list and a
 * future merge (Batch 12 folds `LiveSession` rows and accepted private sessions
 * into this same slot) will concatenate two ordered lists into an unordered
 * one. "Next upcoming" is the section's entire meaning, so it is computed, not
 * assumed.
 *
 * Entries with an unparseable `startsAt` are skipped rather than compared: a
 * `NaN` in a comparator makes the ordering non-transitive and can hand back an
 * arbitrary element, which would silently show the WRONG session.
 */
function earliest(
  sessions: readonly BuildersSession[],
): BuildersSession | null {
  let best: BuildersSession | null = null;
  let bestAt = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    const at = Date.parse(session.startsAt);
    if (!Number.isFinite(at)) continue;
    if (at < bestAt) {
      best = session;
      bestAt = at;
    }
  }
  return best;
}

/**
 * `BuildersSession` (the Calendar-shaped internal type) → `HubSessionSummary`
 * (the wire contract).
 *
 * `kind: 'calendar'` and `youtubeVideoId: null` are constants in Phase 1 —
 * `HUB_SESSION_KINDS` already declares `'live'` and `'private'` so Batch 12
 * adds data here, not a field (R6.6).
 *
 * `recurring` is deliberately DROPPED. It is a Calendar implementation detail
 * that the other two future kinds have no analogue for, and NFR-S4/S5 say a
 * member-facing response carries what the surface renders and nothing else.
 */
function toHubSessionSummary(session: BuildersSession): HubSessionSummary {
  return {
    id: session.id,
    kind: 'calendar',
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt || null,
    meetLink: session.meetLink,
    youtubeVideoId: null,
  };
}
