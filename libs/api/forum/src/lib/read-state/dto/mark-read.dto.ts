import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The largest `postNumber` a client may claim to have read.
 *
 * A sanity ceiling, not a product limit: `postNumber` is a 1-based counter
 * within one topic, so a value in the millions is a malformed client, not a
 * long thread. It exists so a `lastReadPostNumber` of `Number.MAX_SAFE_INTEGER`
 * cannot be written into an `Int` column and overflow it.
 */
const MAX_READ_POST_NUMBER = 1_000_000;

/**
 * `POST /api/v1/members/community/topics/:id/read` — R1.6.1, A-6, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(MarkReadDto)` (PRE-1).
 *
 * ⚠️ `@Type(() => Number)` IS LOAD-BEARING EVEN THOUGH THIS IS A JSON BODY.
 * `dtoPipe` sets `transform: true`, and a client that sends
 * `{ "lastReadPostNumber": "12" }` — which several HTTP clients do for numeric
 * fields — would otherwise fail `@IsInt()` with a `400` on a request that is
 * semantically fine. The same decorator is what makes the equivalent QUERY DTOs
 * in this lib work at all, where every value arrives as a string.
 *
 * ⚠️ THE SERVICE IS MONOTONIC, AND THIS DTO CANNOT ENFORCE THAT. A validator
 * sees one request; "never move the marker backwards" is a comparison against
 * stored state. `ReadStateService.markRead` is where an out-of-order client
 * request is prevented from UN-READING a thread — see its docblock.
 */
export class MarkReadDto {
  /**
   * The highest `postNumber` this member has now read in the topic.
   *
   * `0` is legal and meaningful: it is the `@default(0)` state, "read nothing".
   * Sending it does NOT reset a marker — the service only ever moves forwards —
   * so it is accepted rather than rejected, and is simply a no-op on any topic
   * the member has already opened.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_READ_POST_NUMBER)
  lastReadPostNumber!: number;
}
