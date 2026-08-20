import { IsString, MaxLength, MinLength } from 'class-validator';

import {
  IsOptionalNotNull,
  NullMeansAbsent,
} from '../../live-sessions/common/optional-field';

/**
 * `POST /v1/admin/session-requests/:id/decline` — R4.7, R4.8.
 *
 * 🔴 `declineReason` IS MEMBER-VISIBLE BY DESIGN (R4.8). It is the ONE column
 * migration 4 added that appears on `MemberSessionRequest` as well as on
 * `AdminSessionRequest` — every other one of the four is admin-only. So this
 * field is not an internal note: whatever an admin types here is shown to the
 * person whose request was refused.
 *
 * ⚠️ THAT IS WHY IT IS BOUNDED AND WHY THE BOUND IS SHORT. 500 characters is a
 * sentence or two of explanation, not a place to paste an internal thread.
 *
 * ⚠️ AND IT IS OPTIONAL. A decline with no stated reason is a real, supported
 * action — R4.8 gives the member a reason WHEN THERE IS ONE, and forcing a
 * sentence produces a filler sentence rather than an honest silence.
 * `@IsOptionalNotNull()` + `@NullMeansAbsent()` keeps `null` out of the service
 * (which writes `null` itself for the absent case), so the census in
 * `nullable-dto.spec.ts` stays `[]`.
 */
export class DeclineSessionRequestDto {
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declineReason?: string;
}
