import { Inject, Injectable } from '@nestjs/common';
import type { HubSection, MemberPack } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import { MemberPacksService } from '@ptah-api/community';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `packs` section — the member-visible Builders packs (R6.1, R5).
 *
 * ── WHAT SHIPS (TASK_2026_177 Phase 5) ────────────────────────────────────
 * Migration 5 added `Pack.memberVisible`, and `MemberPacksService.list` is the
 * member-facing read: `where: { memberVisible: true }` and nothing else (A-1),
 * mapped through `toMemberPack`, which names its eight output fields explicitly
 * and therefore cannot emit `notes` (R5.2 / NFR-S5).
 *
 * ── 🔴 THE STATUS IS DERIVED FROM THE DATA. IT IS NOT PINNED (F-D) ────────
 * The coarse batch text said this section becomes `'ok'`. That is wrong as
 * literally written. `HUB_SECTION_STATUSES` is `['ok', 'empty', 'unavailable']`
 * and `hub-section.ts`'s port docblock states that preserving the distinction is
 * the only reason the vocabulary exists:
 *
 *   - rows present            → `'ok'`
 *   - the query ran, found none → `'empty'`
 *   - the source failed or is off → `'unavailable'`
 *
 * On THIS database, with `packs` at zero rows, the honest answer is still
 * `'empty'` — and a resolver hard-coded to `'ok'` would be a new lie standing
 * exactly where the old one stood. The exit gate seeds packs and watches the
 * same section flip.
 *
 * ── THIS RESOLVER DOES NOT CATCH, AND THAT IS THE PORT'S RULE (R6.4) ──────
 * A resolver returns `'unavailable'` only for a condition it can NAME. There is
 * no such condition here: `MemberPacksService` is unconditionally registered and
 * reads one local table. A `try/catch` would make the composer's
 * `Promise.allSettled` — the single fault boundary — untestable, and would
 * report a Postgres outage as `'empty'`, which is the one thing
 * `HubSectionStatus` exists to prevent. A database failure PROPAGATES.
 *
 * ── ⚠️ IT INJECTS THE SERVICE RATHER THAN READING PRISMA ──────────────────
 * The same rule `CommunitySection` and `LearningSection` follow, and here it is
 * load-bearing rather than stylistic: `toMemberPack` is the NFR-S5 chokepoint. A
 * second query here would need a second mapper, and `notes` would then have two
 * places to leak from instead of none. It is NOT `@Optional()` — packs are
 * unconditionally part of the product, so a missing `MemberPacksModule` is a
 * wiring mistake that should fail at boot rather than degrade this card to
 * `'unavailable'` for ever (the same call `CommunitySection` makes about
 * `ForumModule`).
 *
 * ⚠️ `data: []`, never `null` — R6.3, so one client renderer handles all three
 * statuses.
 */
@Injectable()
export class PacksSection implements HubSectionResolver<MemberPack[]> {
  constructor(
    @Inject(MemberPacksService)
    private readonly packs: MemberPacksService,
  ) {}

  async resolve(ctx: MemberContext): Promise<HubSection<MemberPack[]>> {
    const rows = await this.packs.list(ctx);

    return { status: rows.length > 0 ? 'ok' : 'empty', data: rows };
  }
}
