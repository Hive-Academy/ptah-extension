import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PUT /api/v1/members/community/topics/:id/accepted-answer` — R1.5.1–R1.5.3,
 * plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(AcceptAnswerDto)` (PRE-1).
 *
 * ⚠️ `PUT`, NOT `POST`, AND THERE IS NO "UNACCEPT THE PREVIOUS ONE" FIELD.
 * `Topic.acceptedPostId` is a single `@unique` column, so marking a second post
 * clears the first BY ASSIGNMENT (R1.5.2) — one write, not a write plus a
 * compensating clear that a failure could skip and leave two accepted answers.
 * Clearing is the separate `DELETE` on the same path.
 *
 * ⚠️ THE ACTOR CHECK IS NOT HERE AND CANNOT BE. R1.5.3 allows the TOPIC AUTHOR
 * or an ADMIN, which needs the request's `MemberContext` and the topic row —
 * `AcceptedAnswerService.accept` owns it, and answers `403` for anyone else
 * (never `404`: the member can see the topic, so its existence is not a secret).
 */
export class AcceptAnswerDto {
  /**
   * The post to mark as the accepted answer.
   *
   * It must belong to THIS topic and must not be soft-deleted — both are `404`
   * from the service, because a post that is not in this thread, or that has
   * been removed, is not a post this request can refer to.
   *
   * Post #1 is rejected with a `400`: the opening post is the QUESTION (AD-9),
   * and accepting it as its own answer is a request that cannot mean anything.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  postId!: string;
}
