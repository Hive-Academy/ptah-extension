import { z } from 'zod';

/**
 * MEMBER-facing pack contract — R5.3, plan §3.6.
 *
 * ⚠️ THIS FILE IS THE REASON THIS LIB EXISTS.
 *
 * {@link MemberPack} is declared STANDALONE. It does not `extend` `AdminPack`
 * (`../admin/admin-pack.contract.ts`), it does not `extend` the server's
 * `PackResponse`, and it never will — so `notes`, the admin-internal freeform
 * field, CANNOT arrive by inheritance (R5.2, NFR-S5).
 *
 * The precedent being inverted here is `AdminSession extends BuildersSession`
 * (`libs/api/community/src/lib/google-sessions/google-sessions.types.ts`).
 * That docblock is explicit that admin-only fields — `description` and
 * `attendees` — are kept off the member type precisely so widening the member
 * response cannot leak every other member's email address. That inheritance was
 * safe ONLY because `BuildersSession`, the base, was frozen. For a pair we
 * author fresh, the base is not frozen, and one `extends` makes the leak a
 * one-line accident. Re-declaration removes the hazard entirely (RK-8).
 *
 * `contract-boundary.spec.ts` asserts this structurally, in both directions.
 */

/**
 * A pack as a Builders member sees it — `GET /api/v1/members/packs`, and the
 * hub's `packs` section.
 *
 * ⚠️ FIELD ABSENCE IS THE CONTRACT. `notes`, `createdBy`, `createdAt`,
 * `updatedAt`, `cohortKey` and `memberVisible` are all present on the admin
 * shape and all deliberately absent here. A test in `libs/api/community`
 * asserts `notes` never appears in a member response body (R5.2).
 *
 * ⚠️ VISIBILITY IS `memberVisible` ONLY (A-1). `GET /members/packs` filters on
 * `memberVisible: true` and NOTHING else. It does not filter on `cohortKey`,
 * and the service does not inject `CohortResolver` — that absence is the
 * control, mirroring how `PacksService` refuses to inject
 * `BuildersMembershipService`. Every member-visible pack is shown to every
 * entitled member.
 *
 * This registry still GATES NOTHING. Ptah never serves pack content and never
 * provisions GitHub access (R5.7); only the discovery and link-delivery channel
 * moved in-product when Discourse was deleted.
 */
export interface MemberPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** The GitHub repository. Access is administered on GitHub, not here. */
  repoUrl: string;
  tags: string[];
  /**
   * Display label only. A-1: it grants and revokes nothing, and it is the
   * denormalised `MemberGroup.name`, never the key. `null` when the pack is
   * unlabelled or its cohort was deleted.
   */
  cohortName: string | null;
  /**
   * R5.5: how repo access is granted, shown BEFORE the member follows
   * `repoUrl`, so a GitHub 404 is not the first signal that they lack access.
   *
   * ⚠️ NOT `notes`. `notes` is an admin-internal freeform note and stays on the
   * admin shape (R5.2); `accessNote` is authored deliberately for member
   * display. Two fields, two audiences — collapsing them is the leak.
   */
  accessNote: string | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberPackSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  tags: z.array(z.string()),
  cohortName: z.string().nullable(),
  accessNote: z.string().nullable(),
}) satisfies z.ZodType<MemberPack>;
