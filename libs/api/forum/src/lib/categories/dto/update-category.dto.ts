import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * `PATCH /api/v1/admin/community/categories/:id` — plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateCategoryDto)` (PRE-1) — see
 * `create-category.dto.ts` for why an unbound param validates nothing.
 *
 * ⚠️ `slug` IS ABSENT FROM THIS DTO, DELIBERATELY. A category slug is its public
 * URL; `/members/community?category=announcements` is shared, bookmarked and
 * written into `Notification.route` at write time (plan §1.6). Renaming the
 * DISPLAY NAME is a copy edit and is allowed here; changing the slug breaks
 * every stored link that points at it and there is no redirect table in this
 * design. R1.2.2 fixes this rule for topic slugs and the same reasoning applies
 * — the only difference is that a topic slug is generated and this one is
 * chosen. Deleting the category and recreating it is the honest way to change a
 * slug, and `onDelete: Restrict` makes an admin confront the topics first.
 *
 * Every field is optional and only supplied keys are written: `PATCH` semantics.
 * `description` accepts `null` to CLEAR the stored value — `@IsOptional()` skips
 * validation for `null` while leaving the key present, so the service can tell
 * "clear it" from "not supplied" (the `packs.service.ts` idiom).
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /**
   * ⚠️ CHANGING THIS CHANGES WHO CAN SEE EVERY TOPIC INSIDE THE CATEGORY, with
   * no per-topic override and no migration — visibility is evaluated on every
   * read from the category row (`common/visibility.ts`). Narrowing
   * `member` → `staff` hides an existing public discussion from every member
   * instantly; widening does the reverse. It is an intentional, audited admin
   * action, and it is the reason the admin surface is the only place it can
   * happen.
   */
  @IsOptional()
  @IsIn(VISIBILITIES, {
    message: `visibility must be one of: ${VISIBILITIES.join(', ')}`,
  })
  visibility?: Visibility;

  /** Replaces the stored array wholesale. Validated against real `MemberGroup` rows in the service. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-z0-9-]{2,40}$/, {
    each: true,
    message:
      'each cohortKey must be a lowercase slug (2-40 chars of a-z, 0-9, -)',
  })
  cohortKeys?: string[];

  /**
   * Present for completeness, but `PATCH categories/reorder` is the operation an
   * admin UI should use (R8.8): it renumbers the whole list in ONE transaction
   * on a sparse scale, where setting one category's `sortOrder` by hand can
   * silently create a tie with another.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
