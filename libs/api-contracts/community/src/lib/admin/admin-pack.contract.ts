/**
 * ADMIN-facing pack contract — R5.2, R8.4, NFR-S5, RK-8.
 *
 * ⚠️ READ `../member/member-pack.contract.ts` NEXT TO THIS FILE. They are the
 * pair this whole lib was created for, and they are ADJACENT AND INDEPENDENT:
 * `AdminPack` does not `extend` `MemberPack`, `MemberPack` does not `extend`
 * `AdminPack`, and `contract-boundary.spec.ts` fails the build on either.
 *
 * WHY RE-DECLARATION AND NOT INHERITANCE. `AdminSession extends BuildersSession`
 * (`libs/api/community/src/lib/google-sessions/google-sessions.types.ts`) is the
 * precedent, and its own docblock explains that `description` and `attendees`
 * are admin-only specifically so widening the member type cannot leak every
 * other member's email address. That inheritance is safe only in ONE direction
 * and only because the base is frozen: adding a field to `BuildersSession`
 * would silently widen the admin type (harmless), but the shape being protected
 * is the member one, and nothing structural stops the next contributor from
 * putting the new field on the base. For a pair authored fresh, re-declaration
 * removes the hazard rather than documenting it.
 *
 * The concrete failure this prevents: `notes` is a freeform ADMIN-INTERNAL note.
 * One `extends` and it is on `GET /v1/members/packs` for every Builders member.
 *
 * ⚠️ FIELD DUPLICATION HERE IS INTENTIONAL AND IS NOT A DRY VIOLATION. The two
 * types describe two audiences, not one shape used twice. They are permitted to
 * diverge, and the moment they do, an inheritance link would have to be broken
 * anyway — with a member-facing leak already shipped.
 *
 * ⚠️ RELATIONSHIP TO `PackResponse`. `libs/api/community/src/lib/packs/packs.types.ts`
 * declares `PackResponse`, which is the shape the admin endpoints serve TODAY.
 * This is its contract-lib successor: the same fields plus the two R8.4/A-1
 * additions. Batch 14 (P5-BE) adopts it and retires `PackResponse`. Nothing in
 * Batch 2 edits `libs/api/community`.
 */

/**
 * A pack as an admin sees it — `GET/POST /v1/admin/packs`,
 * `PATCH/DELETE /v1/admin/packs/:id`.
 */
export interface AdminPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  /**
   * ⚠️ ADMIN-INTERNAL. Freeform operational note. It has no member-facing
   * counterpart and MUST NOT appear in any member response under any
   * circumstance (R5.2) — `libs/api/community` carries a dedicated test
   * asserting its absence, and `contract-boundary.spec.ts` additionally bans
   * the identifier `notes` from every declaration under `member/`.
   *
   * The member-facing field for "how do I get access" is `MemberPack.accessNote`,
   * a DIFFERENT field authored deliberately for display (R5.5).
   */
  notes: string | null;
  tags: string[];
  /**
   * A-1: a BOOKKEEPING LABEL, NOT AN ACCESS CONTROL. Changing it grants and
   * revokes nothing, and `GET /v1/members/packs` does not filter on it.
   */
  cohortKey: string | null;
  /** Denormalised `MemberGroup.name`; `null` when unlabelled or cohort deleted. */
  cohortName: string | null;
  /**
   * R8.4 + A-1: THE SINGLE control over member visibility. Defaults to `false`
   * so the Phase-5 migration makes no existing pack visible by accident.
   * `cohortKey` is not this control and never becomes it.
   */
  memberVisible: boolean;
  /** R5.5. Mirrored verbatim onto `MemberPack.accessNote`. */
  accessNote: string | null;
  createdBy: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}
