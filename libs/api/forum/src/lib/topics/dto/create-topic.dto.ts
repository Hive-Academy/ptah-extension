import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /api/v1/members/community/topics` — R1.2.1, AD-9, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateTopicDto)` AT THE CONTROLLER (PRE-1). Unbound,
 * every limit below is inert — esbuild emits no `emitDecoratorMetadata`, so the
 * global `ValidationPipe` short-circuits and a 2 MB body reaches Postgres.
 *
 * ⚠️ THE LIMITS LIVE HERE, NOT IN `TopicsService` (§3.3, Task 6.7). Title 3–200,
 * body 1–50 000. Enforcing them in the service would mean the check runs AFTER
 * the visibility query and inside the create path, so an oversized body is
 * transported, deserialised and carried through a database round trip before
 * being rejected — and the same rule would then have to be repeated in
 * `UpdateTopicDto`'s service path. In the DTO it runs before the service is
 * entered, once.
 *
 * ⚠️ THERE IS NO `slug` FIELD AND THERE MUST NEVER BE ONE. Topic slugs are
 * GENERATED from the title at creation and are stable for life (R1.2.2,
 * `common/slug.ts`). A caller-supplied slug would let a member squat
 * `/members/community/topics/announcements` or collide deliberately with
 * another member's thread.
 *
 * ⚠️ THERE IS NO `pinned` OR `locked` FIELD EITHER. Both are moderation state
 * (R1.2.5, R1.2.6, R8.2) and live on `ModerateTopicDto`, behind `AdminGuard`.
 * `forbidNonWhitelisted: true` in `dtoPipe` means a member who sends
 * `{ pinned: true }` gets a `400` rather than a silently ignored field.
 */
export class CreateTopicDto {
  /**
   * The category to post in.
   *
   * ⚠️ A CATEGORY THE MEMBER CANNOT SEE IS A `404`, NOT A `403` (R1.2.1 +
   * R1.1.3) — decided in `TopicsService.create` by a query that filters on
   * visibility, so an invisible category simply produces no row. No validator
   * here can make that decision; it needs the request's `MemberContext`.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId!: string;

  /**
   * 3–200 characters (§3.3).
   *
   * The floor is 3 rather than 1 because a one-character title produces a
   * one-character slug, and because "?" is not a thread anyone can find again.
   * `slugify` handles a title that normalises to nothing (emoji, non-Latin
   * script) with `FALLBACK_SLUG_STEM` — that case is legal and is not what this
   * limit is for.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /**
   * The opening post's body — 1–50 000 characters (§3.3).
   *
   * ⚠️ THIS BECOMES POST #1, NOT A `Topic` COLUMN (AD-9). There is no
   * `Topic.body`; `TopicsService.create` writes the `Topic` and its post #1 in
   * ONE transaction, because a create that writes them separately can leave a
   * bodyless topic that nothing downstream can render.
   *
   * ⚠️ RAW MARKDOWN, NEVER HTML. It is stored as written and rendered by
   * `libs/frontend/markdown`'s `'member'` preset — the one sanitizer (PRE-4,
   * AD-1). The server does not sanitize it on the way in and must not: escaping
   * at write time corrupts legitimate markdown and moves the security boundary
   * away from the single chokepoint that owns it.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown!: string;
}
