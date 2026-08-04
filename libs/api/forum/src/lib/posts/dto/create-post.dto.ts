import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /api/v1/members/community/topics/:id/posts` — R1.3.1, R1.3.3, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreatePostDto)` AT THE CONTROLLER (PRE-1).
 *
 * ⚠️ THERE IS NO `postNumber` FIELD AND THERE MUST NEVER BE ONE. It is allocated
 * SERVER-SIDE, inside the write transaction, under
 * `@@unique([topicId, postNumber])` (MG-1.7). A client-supplied number would let
 * a member insert themselves anywhere in the thread's ordering, or collide with
 * an existing post and take a `500`.
 *
 * ⚠️ THERE IS NO `depth` FIELD EITHER — see {@link CreatePostDto.parentId}.
 * Depth is a property of the tree the server repairs, not a value the client
 * asserts.
 */
export class CreatePostDto {
  /**
   * 1–50 000 characters (§3.3) — the same bounds as a topic's opening post,
   * because AD-9 makes them the same kind of row.
   *
   * ⚠️ RAW MARKDOWN, NEVER HTML. Stored as written; rendered through
   * `libs/frontend/markdown`'s `'member'` preset, the one sanitizer (PRE-4,
   * AD-1). The server neither escapes nor sanitizes on the way in.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown!: string;

  /**
   * The post being replied to. Omit for a top-level reply.
   *
   * ⚠️ DEPTH IS CAPPED AT 2 BY REPAIR, NOT BY REJECTION (R1.3.3, RK-12). If this
   * names a post that ITSELF has a parent, the server re-points the new reply at
   * that post's parent, so it lands as a SIBLING at depth 2 — and the reply is
   * SAVED. There is no validator here that could do that, and there must not be
   * a `400`: the member typed a reply to something they can see, and losing it
   * over a nesting rule they cannot see is a worse outcome than a reply
   * appearing one level up.
   *
   * A `parentId` naming a post in a DIFFERENT topic, or a soft-deleted one, is a
   * `404` — that is not a depth question, it is a "no such parent here".
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  parentId?: string;
}
