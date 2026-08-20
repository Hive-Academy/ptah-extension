import { IsString, MaxLength, MinLength } from 'class-validator';

import {
  IsOptionalNotNull,
  NullMeansAbsent,
} from '../../live-sessions/common/optional-field';

/**
 * `POST /v1/members/session-requests` — R4.2.
 *
 * 🔴 IT CARRIES TWO FIELDS AND MUST KEEP CARRYING TWO. Everything else about a
 * `SessionRequest` is decided by the server: `userId` comes from
 * `requireMemberContext(req)`, `status` is `'pending'` by construction, and the
 * four scheduling columns are written only by an admin accept. A body that could
 * set any of them would let a member schedule their own session — and
 * `forbidNonWhitelisted` turns an attempt into a `400` precisely because they
 * are absent here.
 *
 * ⚠️ AND `isFreeSession` / `paymentStatus` / `paddleTransactionId` ARE ABSENT
 * FOR A SECOND REASON (R4.10): this batch changes NOTHING about payment. Those
 * columns keep their exact current semantics and nothing in the Phase-4 path
 * writes them.
 *
 * ⚠️ EVERY DECORATOR HERE IS INERT UNLESS THE PARAMETER BINDS `dtoPipe(...)`
 * (PRE-1) — esbuild emits no `emitDecoratorMetadata`.
 */
export class CreateSessionRequestDto {
  /**
   * The topic the member selected when requesting.
   *
   * ⚠️ A FREE STRING, NOT A FOREIGN KEY, BECAUSE THE COLUMN IS ONE. There is no
   * `SessionTopic` table in the schema (plan §1.x adds none), so the DTO bounds
   * the shape and nothing validates membership of a list. Recorded rather than
   * invented: adding a topic table is a design event, and guessing an allow-list
   * here would reject a topic the frontend legitimately offers.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sessionTopicId!: string;

  /**
   * ⚠️ `@IsOptionalNotNull()` + `@NullMeansAbsent()`. On a create, "no notes"
   * and "the key was omitted" are the same request, so `null` is normalised to
   * absent rather than earning a census entry in `nullable-dto.spec.ts`.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(5000)
  additionalNotes?: string;
}
