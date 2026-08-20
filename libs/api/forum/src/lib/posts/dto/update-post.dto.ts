import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /api/v1/members/community/posts/:id` — R1.3.2, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdatePostDto)` (PRE-1).
 *
 * ⚠️ `bodyMarkdown` IS THE ONLY EDITABLE FIELD, AND THAT IS THE POINT.
 * `parentId` is absent: re-parenting a post after people have replied to it
 * silently rewrites the conversation's structure and can orphan or re-order
 * replies that were written in a context that no longer exists. Depth is
 * decided once, at creation, by the server's repair rule (R1.3.3) — never
 * afterwards by the author.
 *
 * `postNumber` is absent for the same reason plus a stronger one: it is the
 * thread's ordering and it is under a unique constraint.
 *
 * ⚠️ REQUIRED, NOT OPTIONAL. A `PATCH` with an empty body would be a request
 * that means nothing; making the one field mandatory turns that into a `400` at
 * the DTO rather than a `200` in the service that changed nothing but still set
 * `editedAt` — which would put a spurious "edited" marker on a post nobody
 * edited.
 *
 * Author only, inside the ASSUMPTION-5 window; both refusals are `403` (§3.3),
 * and both are decided by `PostsService` through the single guard in
 * `common/edit-window.ts`. There is no admin bypass on this path — an admin
 * edits through the moderation surface behind `AdminGuard`.
 */
export class UpdatePostDto {
  /** 1–50 000 characters (§3.3). Raw markdown, never HTML — see `CreatePostDto`. */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown!: string;
}
