import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { memberPackSchema, type MemberPack } from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';
import { z } from 'zod';

/**
 * MemberPacksApiService — `GET /api/v1/members/packs`, the member-visible pack
 * registry (§3.6, R5.1, R5.3, NFR-S1).
 *
 * ⚠️ PURE DATA ACCESS, exactly as `member-live-api.service.ts` is. No signals,
 * no cached state, no routing. `PacksPage` owns the four-cell branch and the
 * `MemberNotificationsStore` owns the only piece of state in this batch; a
 * service that also held rows would give the page and any future hub consumer
 * two different ideas of what a member can see.
 *
 * ── 🔴 ONE METHOD, A BARE ARRAY, AND NO `?page` AT ALL ─────────────────────
 * `MemberPacksController` declares NO `@Query()` (verified at
 * `libs/api/community/src/lib/packs/member-packs.controller.ts`) and plan §1.2
 * rejects an index on `member_visible` because the table is "tens of rows,
 * always read in full". `Paged<MemberPack>` is not the contract — `MemberPack[]`
 * is — so a client that sent `?page` would be describing a different endpoint.
 *
 * ⚠️ AND THE SERVER WOULD NOT TELL US. Measured live against this batch's own
 * server on `:3011`: `GET /v1/members/packs?page=1` answers **`200`**, not
 * `400`. `forbidNonWhitelisted` only bites where a DTO is bound, and this
 * controller binds none. So unlike `member-live-api.service.ts` — whose
 * `pageParams` guard mirrors a real server-side `400` — there is nothing here to
 * mirror: the discipline has to be that no parameter is ever constructed, and
 * the spec asserts `request.request.params.keys()` is empty rather than assuming
 * a rejection that would never come. That is the whole reason this service has
 * no `HttpParams` import.
 *
 * ⚠️ THE SCHEMA IS IMPORTED, NEVER RE-DECLARED. `memberPackSchema` is exported
 * by `@ptah-contracts/community` and is the SAME object the server's own
 * contract spec witnesses. A second copy of the wire type on the client is
 * exactly the drift the contracts lib exists to remove.
 *
 * ── 🔴 `notes` CANNOT ARRIVE, AND THIS IS THE SECOND END OF THAT (NFR-S5) ──
 * `MemberPack` is declared standalone — it does not `extend` `AdminPack` — and
 * the server's `toMemberPack` maps explicit fields, so `notes` is structurally
 * unable to reach a member. `z.object()` STRIPS unknown keys, so even a server
 * that regressed and started sending `notes` would have it removed here before
 * any component saw it. The spec feeds a body that DOES carry `notes` and
 * asserts it is gone — the client half of the same guarantee, asserted rather
 * than assumed, because "the server does not send it" is a claim about someone
 * else's code.
 *
 * URLs stay relative — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true`, so the `ptah_auth` COOKIE is attached. The
 * server's `JwtAuthGuard` reads that cookie and never looks at an
 * `Authorization` header.
 */

const PACKS = '/api/v1/members/packs';

/**
 * The bare-array response schema.
 *
 * ⚠️ `z.array(...)` OF THE CONTRACT'S ITEM SCHEMA, NOT A HAND-WRITTEN OBJECT.
 * The envelope is the only thing declared here, and it is declared because the
 * contracts lib exports the ITEM (`memberPackSchema`) and deliberately does not
 * export an array wrapper for it — there is no `Paged` envelope to reuse.
 */
const packListSchema = z.array(memberPackSchema);

/**
 * What a pack with no `accessNote` says instead (R5.5, ASSUMPTION-27).
 *
 * ⚠️ IT LIVES BESIDE THE SERVICE, NOT IN THE TEMPLATE, AND IT IS ONE STRING.
 * `accessNote` is nullable and EVERY pack in this workspace has it null on day
 * one (measured: the seeded unlabelled pack returns `"accessNote":null`).
 * Silence at the exact spot R5.5 exists to fill is the failure mode the
 * requirement names — a member follows the link, gets a GitHub 404, and learns
 * about access administration from the 404. A single shared constant means the
 * sentence cannot drift between a list and any later surface, and means the
 * fallback is greppable.
 *
 * ⚠️ IT IS DELIBERATELY NOT A PROMISE. It says access is administered on
 * GitHub and where to ask — it does NOT say the member is entitled to the repo,
 * because Ptah grants nothing (R5.7).
 */
export const DEFAULT_ACCESS_NOTE =
  'Access is granted on GitHub — ask in the community if the link 404s.';

/**
 * The line shown above a pack's repository link.
 *
 * A free function beside the class, in this file's established shape
 * (`feedItemKey` / `formatDuration` in `member-live-api.service.ts`), so the
 * null-collapse is unit-testable without a component and so exactly one place
 * decides what "no access note" reads as.
 */
export function accessNoteFor(pack: MemberPack): string {
  return pack.accessNote ?? DEFAULT_ACCESS_NOTE;
}

@Injectable({ providedIn: 'root' })
export class MemberPacksApiService {
  private readonly http = inject(HttpClient);

  /**
   * `GET packs` — every member-visible pack, alphabetical by title (R5.1).
   *
   * ⚠️ ALREADY FILTERED AND ALREADY ORDERED SERVER-SIDE, AND THE FILTER IS
   * `memberVisible` ONLY (A-1). The service behind this endpoint injects
   * neither `CohortResolver` nor `MembershipService`; `cohortName` is a DISPLAY
   * LABEL that grants and revokes nothing. Measured live: a member holding ZERO
   * cohort assignments receives the pack labelled `Founding Members`. There is
   * therefore no field here to re-filter on and there must not be — a
   * client-side cohort filter would invent an access rule the server does not
   * have and hide a pack the member is entitled to see.
   */
  public list(): Observable<MemberPack[]> {
    return this.http
      .get<unknown>(PACKS)
      .pipe(map(validate(packListSchema, 'GET /members/packs')));
  }
}
