import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `PATCH /api/v1/admin/community/categories/reorder` — R8.8, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(ReorderCategoriesDto)` (PRE-1).
 *
 * ⚠️ THE ROUTE MUST BE DECLARED BEFORE `categories/:id` (RI-3). Nest matches
 * routes in declaration order, so a `PATCH categories/:id` declared first
 * swallows `categories/reorder` with `id === 'reorder'` — a 404 or, worse, an
 * update of nothing that answers `200`. Task 6.13 owns that ordering; it is
 * recorded here because this DTO is the thing that stops working.
 *
 * ⚠️ ONE REQUEST, ONE TRANSACTION, SPARSE RENUMBER (R8.8). The alternative — a
 * `PATCH` per row from a drag-and-drop UI — is N requests that can interleave
 * with another admin's reorder and leave the list in a state neither of them
 * chose. `CategoriesService.reorder` renumbers to 100, 200, 300 … so a single
 * later insert can be placed between two neighbours without renumbering
 * anything.
 */
export class ReorderCategoriesDto {
  /**
   * EVERY category id, in the order they should appear.
   *
   * ⚠️ THE LIST MUST BE COMPLETE, AND THE SERVICE REJECTS A PARTIAL ONE WITH
   * `400`. This is a decision the spec leaves open (`{ ids: string[] }` is all
   * §3.3 says) and the strict reading is the safe one: `sortOrder` is a TOTAL
   * ordering over the categories, so renumbering a subset onto the sparse scale
   * would interleave the renumbered rows with the untouched ones at values
   * nobody chose — and could produce ties, which then break the `orderBy` into
   * a non-deterministic order that changes between two identical requests. A
   * complete list makes the operation total, deterministic, and idempotent.
   *
   * Duplicates are rejected for the same reason: one id cannot hold two
   * positions, and silently taking the last would reorder the list into
   * something the admin did not ask for.
   *
   * The `1000` ceiling is a denial-of-service bound, not a product limit — a
   * reorder opens a transaction that writes one row per id.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
