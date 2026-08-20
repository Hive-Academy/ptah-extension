import { Type } from 'class-transformer';
import { IsISO8601, IsInt, Max, Min } from 'class-validator';

/**
 * `POST /v1/admin/session-requests/:id/accept` — R4.5, §3.5.
 *
 * 🔴 `durationMinutes` IS REQUIRED AND IS PERSISTED, NOT DERIVED.
 * `SessionRequest.duration_minutes` exists (migration 4) precisely so `endsAt`
 * is reconstructible ON RESCHEDULE without re-reading Google — R4.6 patches the
 * event by its persisted id and rebuilds the end from this number. Without it, a
 * reschedule would have to fetch the event to learn how long it was, which is a
 * second round trip on a path that already has one, and it would silently
 * default to "an hour" the moment that fetch failed.
 *
 * ⚠️ THE BOUNDS ARE NOT DECORATION. 15 minutes is the shortest slot worth
 * booking; 240 is four hours. A typo that booked a four-DAY session would appear
 * on the member's calendar, block the founder's, and be the kind of mistake
 * nobody notices until somebody complains.
 *
 * ⚠️ `@Type(() => Number)` IS LOAD-BEARING even on a `@Body()`, because a client
 * that sends `"60"` is a client that would otherwise fail `@IsInt()`. `dtoPipe`
 * runs with `transform: true` and this is what gives it a target.
 */
export class AcceptSessionRequestDto {
  /** ISO 8601. The instant the private session starts. */
  @IsISO8601()
  startsAt!: string;

  /** 15–240. See the class docblock. */
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes!: number;
}

/**
 * The service input, resolved OUTSIDE the class — see
 * `toCreateLiveSessionInput`'s note on why there are no field initialisers.
 */
export function toAcceptInput(dto: AcceptSessionRequestDto): {
  startsAt: Date;
  durationMinutes: number;
} {
  return {
    startsAt: new Date(dto.startsAt),
    durationMinutes: dto.durationMinutes,
  };
}
