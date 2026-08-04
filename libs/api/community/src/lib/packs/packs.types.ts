/**
 * Builders "packs" — types for the ADMIN-ONLY pack registry (TASK_2026_169).
 *
 * A pack is a Ptah-authored source-code deliverable: one dedicated GitHub
 * repository containing a production-shaped codebase plus its Claude plugins
 * and MCP servers, shared with a Builders cohort.
 *
 * ⚠️ THIS REGISTRY GATES NOTHING, AND THAT SURVIVES THE CHANNEL CHANGE.
 * Ptah never serves pack content and never decides who may access a pack —
 * access is administered entirely on GitHub (collaborator invites, or the repo
 * link handed to the cohort). The table exists so the admin has one place
 * recording which repo belongs to which cohort.
 *
 * That link used to be posted in the cohort's group on the external forum,
 * which TASK_2026_177 P1b deleted. Phase 5 (Batch 14) replaces the delivery
 * channel with an in-product `GET /members/packs` filtered on `memberVisible`
 * and NOTHING else (A-1, R5.6). Until that lands there is no member-facing
 * endpoint reading this table. Note what does NOT change either way: delivering
 * a link is not granting access, so a member endpoint here is still not a gate.
 *
 * `cohortKey` is a BOOKKEEPING LABEL, NOT AN ACCESS CONTROL. Changing it grants
 * and revokes nothing.
 */

/**
 * Outbound shape for every admin pack endpoint.
 *
 * - `notes`      — freeform INTERNAL admin note (never shown to a member; no
 *                  member surface exists).
 * - `cohortKey`  — bookkeeping label; `null` = not tied to a cohort.
 * - `cohortName` — denormalised `MemberGroup.name` for the admin table, `null`
 *                  when the pack is unlabelled or the cohort was deleted.
 */
export interface PackResponse {
  id: string;
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes: string | null;
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

/** Service input for pack creation. */
export interface CreatePackInput {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes?: string | null;
  tags?: string[];
  cohortKey?: string | null;
}

/**
 * Service input for a pack patch. Only supplied keys are written; passing
 * `null` for `notes`/`cohortKey` clears the stored value.
 */
export interface UpdatePackInput {
  slug?: string;
  title?: string;
  description?: string;
  repoUrl?: string;
  notes?: string | null;
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
  tags: string[];
  cohortKey: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  cohort?: { name: string } | null;
}

/** Map a Prisma pack row (with optional cohort include) to the wire shape. */
export function toPackResponse(row: PackRow): PackResponse {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    repoUrl: row.repoUrl,
    notes: row.notes,
    tags: row.tags,
    cohortKey: row.cohortKey,
    cohortName: row.cohort?.name ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
