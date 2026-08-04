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
 * ⚠️ KNOWN NUANCE, DELIBERATELY NOT CHANGED HERE. `listUpcomingSessions` also
 * swallows an upstream Calendar *failure* into `[]` (it logs and returns empty
 * — `sessions.service.ts:172-179`). A live Calendar outage therefore surfaces
 * on the hub as `'empty'` rather than `'unavailable'`. Fixing that means
 * widening `SessionsService`'s return type, which would change the shape of
 * `GET /v1/members/sessions` — a member-facing contract this batch is not
 * scoped to touch. Recorded rather than silently absorbed.
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

    const upcoming = await this.sessions.listUpcomingSessions(ctx.userId);
    const next = earliest(upcoming);
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
