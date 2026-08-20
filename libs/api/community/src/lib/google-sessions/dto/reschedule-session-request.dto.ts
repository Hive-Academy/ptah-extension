import { Type } from 'class-transformer';
import { IsISO8601, IsInt, Max, Min } from 'class-validator';

import { IsOptionalNotNull } from '../../live-sessions/common/optional-field';

/**
 * `POST /v1/admin/session-requests/:id/reschedule` — R4.6.
 *
 * ⚠️ `durationMinutes` IS OPTIONAL HERE AND REQUIRED ON ACCEPT, AND THE
 * ASYMMETRY IS THE POINT. A reschedule normally moves a session without changing
 * its length, so omitting it means "keep the length the accept recorded" — which
 * the service reads off `SessionRequest.duration_minutes` rather than guessing.
 * Supplying it changes both at once, which is the other thing an admin
 * legitimately wants to do in one action.
 *
 * ⚠️ AND THE SERVICE REFUSES RATHER THAN DEFAULTING when the column is somehow
 * null and the body omits it (`session_duration_unknown`). Guessing a length
 * would move somebody's session to an end time nobody chose.
 *
 * ⚠️ THERE IS NO `calendarEventId` FIELD, DELIBERATELY (R4.6, AD-2). The event
 * is located by the PERSISTED id. A body-supplied id would let a caller point a
 * reschedule at any event on the calendar.
 */
export class RescheduleSessionRequestDto {
  /** ISO 8601. The new start instant. */
  @IsISO8601()
  startsAt!: string;

  /** Omit to keep the recorded length. 15–240 when supplied. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;
}

/** The service input, resolved OUTSIDE the class. */
export function toRescheduleInput(dto: RescheduleSessionRequestDto): {
  startsAt: Date;
  durationMinutes?: number;
} {
  return {
    startsAt: new Date(dto.startsAt),
    durationMinutes: dto.durationMinutes,
  };
}
