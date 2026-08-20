import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MAX_BULK_MARK_READ_IDS,
  type MarkNotificationsReadRequest,
} from '@ptah-contracts/community';

/**
 * `POST /v1/members/notifications/read` — mark exactly the named notifications
 * read (R10.4).
 *
 * ⚠️ THE ONLY `@Body()` ON THIS CONTROLLER, AND IT BINDS `dtoPipe` (PRE-1). A
 * bare `@Body() dto: X` is SILENTLY UNVALIDATED here: esbuild does not
 * implement `emitDecoratorMetadata`, so `metadata.metatype` is `undefined` and
 * `ValidationPipe.transform` short-circuits before ANY decorator on this class
 * runs — every cap below would be inert and `forbidNonWhitelisted` would let an
 * arbitrary body through. The controller supplies the type explicitly.
 *
 * ⚠️ NO `@Type(() => …)`, UNLIKE {@link ListNotificationsQueryDto}. That DTO
 * needs it because Express hands QUERY parameters over as strings; this one
 * reads a JSON BODY, where `["a","b"]` is already an array of strings. A
 * `@Type` here would be cargo, and `@IsString({ each: true })` is what makes
 * `{"ids":[1,2]}` a `400` rather than a Prisma type error.
 *
 * ── 🔴 EVERY BOUND BELOW IS LOAD-BEARING ─────────────────────────────────────
 *
 * `@IsArray()` — `{"ids":"n_1"}` must not reach the service. A bare string
 * would be spread by `[...ids]` into its CHARACTERS, and `in: ['n','_','1']`
 * matches nothing, so the failure would be a silent `{ marked: 0 }` rather than
 * an error anyone sees.
 *
 * `@ArrayNotEmpty()` — an empty array is a `400`, NOT a no-op. See
 * {@link MarkNotificationsReadRequest}: "these, where these is empty" is the
 * one phrasing that could ever be re-read as "all", and conflating those two is
 * the irreversible mistake this endpoint exists to make impossible.
 *
 * `@ArrayMaxSize(MAX_BULK_MARK_READ_IDS)` — an unbounded id array is a DoS
 * vector: it lands in a single `IN (…)` list, and nothing else on this route
 * bounds how long it is. The cap is IMPORTED from the contract, never
 * re-declared, so the server and the client cannot disagree about it.
 *
 * `@MaxLength(64, { each: true })` — notification ids are cuids, not uuids, so
 * they are validated as bounded strings rather than with `@IsUUID` (the same
 * call every cuid-keyed admin DTO in this server makes). Without it, 50 ids of
 * a megabyte each satisfy the array cap.
 *
 * `@MinLength(1, { each: true })` — `""` is not an id under any encoding.
 *
 * ⚠️ REJECTING A MALFORMED ID IS NOT AN EXISTENCE ORACLE, and the distinction
 * matters because the whole surface is built to avoid being one. These
 * decorators answer "is this the SHAPE of an id?", which the caller already
 * knows before it asks. They never answer "is this id real?" or "is it yours?"
 * — a well-formed id that does not exist, is already read, or belongs to
 * another member all produce the identical `200 { marked: … }`, with that id
 * contributing zero.
 *
 * ⚠️ DUPLICATES ARE NOT REJECTED. `@ArrayUnique()` would turn a harmless client
 * quirk into a `400`: the service matches with `in`, which is set membership,
 * so a repeated id is counted once and the array cap already bounds the payload.
 */
export class MarkNotificationsReadDto implements MarkNotificationsReadRequest {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_MARK_READ_IDS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
