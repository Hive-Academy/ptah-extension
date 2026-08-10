import type { MemberPack } from '@ptah-contracts/community';

/**
 * Builders "packs" — types for the ADMIN-ONLY pack registry (TASK_2026_169).
 *
 * A pack is a Ptah-authored source-code deliverable: one dedicated GitHub
 * repository containing a production-shaped codebase plus its Claude plugins
 * and MCP servers, shared with a Builders cohort.
 *
 * ⚠️ THIS REGISTRY GATES NOTHING, AND THAT SURVIVES THE CHANNEL CHANGE (R5.7).
 * Ptah never serves pack content and never provisions GitHub access — access is
 * administered entirely on GitHub (collaborator invites, or the repo link
 * handed to the cohort). The table exists so the admin has one place recording
 * which repo belongs to which cohort.
 *
 * That link used to be posted in the cohort's group on the external forum,
 * which TASK_2026_177 P1b deleted. Phase 5 (Batch 14) REPLACED the delivery
 * channel with an in-product `GET /members/packs` filtered on `memberVisible`
 * and NOTHING else (A-1, R5.6). That endpoint SHIPS: `MemberPacksService` reads
 * this table, and `member_visible` / `access_note` (migration 5) are the two
 * columns it reads. Note what did NOT change: delivering a link is not granting
 * access, so the member endpoint is still not a gate.
 *
 * `cohortKey` is a BOOKKEEPING LABEL, NOT AN ACCESS CONTROL. Changing it grants
 * and revokes nothing, and the member endpoint does not filter on it.
 */

/**
 * Outbound shape for every admin pack endpoint. Mirrors the `AdminPack`
 * contract; it is NOT the member shape and nothing derives the member shape
 * from it.
 *
 * - `notes`         — freeform INTERNAL admin note. 🔴 NEVER SHOWN TO A MEMBER,
 *                     and as of Phase 5 that is STRUCTURAL rather than
 *                     circumstantial. A member surface now exists, so "no
 *                     member surface exists" is no longer the reason — the
 *                     reasons are that `MemberPack`
 *                     (`@ptah-api-contracts/community`) is RE-DECLARED rather
 *                     than derived from this interface, so `notes` cannot
 *                     arrive by inheritance (RK-8); that `toMemberPack` names
 *                     its output fields explicitly rather than spreading the
 *                     row; and that `member-packs.service.spec.ts` asserts
 *                     NFR-S5 both ways — `notes` is not a key of the response
 *                     AND the notes VALUE appears nowhere in the serialised
 *                     body. Two audiences, two shapes; collapsing them is the
 *                     leak (R5.2).
 * - `memberVisible` — A-1: the SINGLE control over member visibility. Defaults
 *                     to `false` (`NOT NULL DEFAULT false`, migration 5), so no
 *                     pack became visible when Phase 5 shipped.
 * - `accessNote`    — R5.5: member-facing prose about HOW repo access is
 *                     granted, rendered above `repoUrl` so a GitHub 404 is not
 *                     the member's first signal. Distinct from `notes` and
 *                     mirrored verbatim onto `MemberPack.accessNote`.
 * - `cohortKey`     — bookkeeping label; `null` = not tied to a cohort. It is
 *                     NOT `memberVisible` and never becomes it.
 * - `cohortName`    — denormalised `MemberGroup.name` for the admin table,
 *                     `null` when the pack is unlabelled or the cohort was
 *                     deleted.
 */
export interface PackResponse {
  id: string;
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes: string | null;
  memberVisible: boolean;
  accessNote: string | null;
  tags: string[];
  cohortKey: string | null;
  cohortName: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Filters for `GET /api/v1/admin/packs`. Both optional, ANDed when present. */
export interface ListPacksQuery {
  /** Case-insensitive substring matched against the FIXED columns title+slug. */
  search?: string;
  /** Exact cohort label filter. An unknown cohort simply yields `[]`. */
  cohortKey?: string;
}

/**
 * Service input for pack creation.
 *
 * `memberVisible` is optional and the SERVICE does not default it — the column
 * default (`false`) is the authority (A-1). Omitting it therefore creates a
 * pack members cannot see, which is the safe direction.
 */
export interface CreatePackInput {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes?: string | null;
  memberVisible?: boolean;
  accessNote?: string | null;
  tags?: string[];
  cohortKey?: string | null;
}

/**
 * Service input for a pack patch. Only supplied keys are written; passing
 * `null` for `notes` / `accessNote` / `cohortKey` clears the stored value.
 *
 * ⚠️ `memberVisible` is `boolean`, NOT `boolean | null`. `member_visible` is
 * `NOT NULL` and has no "cleared" state — `UpdatePackDto` rejects an explicit
 * `null` with a `400` before it reaches here (see that DTO's class docblock).
 */
export interface UpdatePackInput {
  slug?: string;
  title?: string;
  description?: string;
  repoUrl?: string;
  notes?: string | null;
  memberVisible?: boolean;
  accessNote?: string | null;
  tags?: string[];
  cohortKey?: string | null;
}

/**
 * Structural shape of the Prisma `pack` row the mapper consumes, with the
 * optional `cohort: { name }` include. Declared structurally (rather than
 * importing the generated Prisma type) so the mapper stays trivially unit
 * testable without a Prisma client.
 */
export interface PackRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes: string | null;
  memberVisible: boolean;
  accessNote: string | null;
  tags: string[];
  cohortKey: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  cohort?: { name: string } | null;
}

/**
 * Map a Prisma pack row (with optional cohort include) to the ADMIN wire shape.
 *
 * ⚠️ THIS MAPPER IS ADMIN-ONLY AND EMITS `notes`. The member mapper is
 * `toMemberPack`, a SEPARATE function producing a SEPARATE type. Neither calls
 * the other and neither is written in terms of the other — that separation is
 * what makes `notes` structurally unable to reach a member (R5.2, NFR-S5).
 */
export function toPackResponse(row: PackRow): PackResponse {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    repoUrl: row.repoUrl,
    notes: row.notes,
    memberVisible: row.memberVisible,
    accessNote: row.accessNote,
    tags: row.tags,
    cohortKey: row.cohortKey,
    cohortName: row.cohort?.name ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Map a Prisma pack row (with optional cohort include) to the MEMBER wire shape
 * — R5.2, R5.3, R5.5, NFR-S4, NFR-S5.
 *
 * 🔴 IT NAMES ITS EIGHT OUTPUT FIELDS EXPLICITLY, AND THAT IS THE WHOLE POINT.
 * There is no `...row` spread, no `omit`, no `delete`. `notes`, `createdBy`,
 * `createdAt`, `updatedAt`, `cohortKey` and `memberVisible` are absent from the
 * result because they were NEVER WRITTEN — not because something removed them.
 * A spread-then-delete mapper is correct exactly until the next migration adds a
 * column, and then it leaks that column to every member with no test failing:
 * the deletion list is a denylist, and a denylist cannot know about a field that
 * did not exist when it was written. An explicit allowlist cannot have that bug.
 *
 * 🔴 IT IS A SEPARATE FUNCTION FROM {@link toPackResponse} AND NEITHER IS
 * WRITTEN IN TERMS OF THE OTHER. Two audiences, two shapes. If this one were
 * `const { notes, ...rest } = toPackResponse(row)` the admin mapper would become
 * the member mapper's base, and widening the admin response — the ordinary,
 * safe-looking change — would widen the member response with it. That is the
 * server-side half of the same refusal `MemberPack` makes in the contracts lib
 * by re-declaring rather than extending `AdminPack` (RK-8).
 *
 * ⚠️ `accessNote` SURVIVES AND `notes` DOES NOT, AND THE PAIR IS NOT A
 * NEAR-DUPLICATE (R5.5). `accessNote` is prose an admin wrote FOR members about
 * how repo access is granted; `notes` is an admin-internal scratchpad. They are
 * two fields with two audiences and collapsing them is the leak.
 *
 * `cohortName` is the denormalised `MemberGroup.name`, never the key: `null`
 * when the pack is unlabelled or its cohort row was deleted (`onDelete:
 * SetNull`). A-1 — the label grants and revokes nothing.
 */
export function toMemberPack(row: PackRow): MemberPack {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    repoUrl: row.repoUrl,
    tags: row.tags,
    cohortName: row.cohort?.name ?? null,
    accessNote: row.accessNote,
  };
}
