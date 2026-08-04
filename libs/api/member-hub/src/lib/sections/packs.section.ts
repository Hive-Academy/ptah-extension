import { Injectable } from '@nestjs/common';
import type { HubSection, MemberPack } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `packs` section — the member-visible Builders packs (R6.1, R5).
 *
 * ── PHASE 1: `{ status: 'empty', data: [] }` ───────────────────────────────
 * The `Pack` table EXISTS today, and this section still reports `'empty'` on
 * purpose. `packs.types.ts` states that the registry is admin-only, gates
 * nothing, and has no member-facing endpoint BY DESIGN — delivery happens on
 * GitHub by hand. Reading that table here would quietly overturn a written
 * product decision as a side effect of building a home screen.
 *
 * Batch 14 (P5) revisits it explicitly: it adds a `memberVisible` column and a
 * `toMemberPack` mapper that drops the admin-only fields (the NFR-S5
 * field-absence assertion), and only THEN does this resolver read anything.
 * Until that lands, "no member-visible packs" is the honest answer — and it is
 * also the live answer, since the table currently holds zero rows.
 *
 * ⚠️ `data: []`, never `null` — see {@link CommunitySection}.
 */
@Injectable()
export class PacksSection implements HubSectionResolver<MemberPack[]> {
  async resolve(_ctx: MemberContext): Promise<HubSection<MemberPack[]>> {
    return { status: 'empty', data: [] };
  }
}
