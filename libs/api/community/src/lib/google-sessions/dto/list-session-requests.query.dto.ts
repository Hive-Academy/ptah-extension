import { IsIn } from 'class-validator';
import {
  SESSION_REQUEST_STATUSES,
  type SessionRequestStatus,
} from '@ptah-contracts/community';

import { IsOptionalNotNull } from '../../live-sessions/common/optional-field';

/**
 * `GET /v1/admin/session-requests` — R4.4's queue filter.
 *
 * 🔴 A WHOLE-OBJECT QUERY DTO, NOT `@Query('status') status: string` — AND THAT
 * IS A BUILD-BREAKING RULE (RISK-I). `controller-validation.spec.ts` asserts
 * `NAMED_PRIMITIVE_PARAM_COUNT` by EXACT EQUALITY at 6, so a single named
 * primitive here would make the total read 7 and fail the build. The carve-out
 * exists for six pre-existing OAuth/ticket params and must not grow.
 *
 * 🔴 `@IsIn(SESSION_REQUEST_STATUSES)` IS NOT DECORATION EITHER.
 * `SessionRequest.status` is a bare Postgres `String` (RISK-X), so `?status=x`
 * would reach a `where` unvalidated and answer `200 []` — "there are no requests
 * in that state" — for a state that does not exist. A `400` naming the four
 * legal values is the honest answer, and it is the same vocabulary the service's
 * `satisfies SessionRequestStatus` pins on the write side.
 */
export class ListSessionRequestsQueryDto {
  /**
   * Omit to read the whole queue.
   *
   * ⚠️ OMITTED MEANS "EVERYTHING", NOT "PENDING". Defaulting to `pending` here
   * would make `GET …/session-requests` a different endpoint from what its path
   * says, and an admin looking for a request they declined last week would get
   * an empty list with no clue why.
   */
  @IsOptionalNotNull()
  @IsIn(SESSION_REQUEST_STATUSES, {
    message: `status must be one of: ${SESSION_REQUEST_STATUSES.join(', ')}`,
  })
  status?: SessionRequestStatus;
}

/** The service filter, resolved OUTSIDE the class. */
export function resolveQueueFilter(query: ListSessionRequestsQueryDto): {
  status?: SessionRequestStatus;
} {
  return { status: query.status };
}
