import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Upper bound on a guest list supplied in one request.
 *
 * Not a Google limit (it allows far more) — a blast-radius limit. The
 * invitations endpoint emails every address on this list, so a typo'd paste of
 * an entire mailing list should be refused at the boundary rather than
 * delivered. 100 comfortably covers any real Builders cohort.
 */
const MAX_ATTENDEES = 100;

/**
 * Query DTO for GET /api/v1/admin/sessions.
 *
 * `daysAhead` widens the member endpoint's fixed 60-day window so an admin can
 * see further out. Capped at 365 to bound the upstream Calendar query.
 */
export class ListSessionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  daysAhead?: number = 60;
}

/**
 * Body DTO for POST /api/v1/admin/sessions.
 *
 * `startsAt` / `endsAt` are ISO-8601 timestamps; the service rejects a range
 * that does not strictly advance. `createMeetLink` mints a Google Meet link.
 *
 * `attendees` records the guest list on the event. It does NOT email anyone —
 * creation is sent with `sendUpdates=none`. Notifying is a separate, explicit
 * call to `POST /api/v1/admin/sessions/:eventId/invitations`.
 */
export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  createMeetLink?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDEES)
  @IsEmail({}, { each: true })
  attendees?: string[];
}

/**
 * Body DTO for PATCH /api/v1/admin/sessions/:eventId.
 *
 * All fields optional — only supplied keys are sent upstream.
 *
 * `createMeetLink` IS accepted here: Google attaches conferencing to an
 * existing event when the request carries `conferenceDataVersion=1`, which the
 * provider now sends on patch as well as create, so an event that shipped
 * without a Meet link can gain one. Passing `false` does not remove an existing
 * link — Google needs a null `conferenceData` for that, which no caller wants.
 *
 * `attendees` REPLACES the guest list wholesale, so the client must send the
 * complete list it wants the event to end up with. Still emails nobody.
 */
export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  createMeetLink?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDEES)
  @IsEmail({}, { each: true })
  attendees?: string[];

  /**
   * ⚠️ SENDS EMAIL when true. Patches with `sendUpdates=all`, so Google mails
   * the guest list about the change.
   *
   * Defaults to false, which is the whole point: a rescheduling drag, a typo
   * fix, or a description tweak must not reach a customer's inbox as a side
   * effect. This flag exists for the one case where notifying IS the intent —
   * a real time change, where everyone's plans just moved.
   *
   * Unlike the invitations route this IS a flag on the patch, because "move the
   * session and tell people" is one action, not two: notifying separately would
   * mean the guest list learns about a new time in a second email that arrives
   * after the calendar entry already moved under them.
   */
  @IsOptional()
  @IsBoolean()
  notifyGuests?: boolean;
}

/**
 * Body DTO for POST /api/v1/admin/sessions/:eventId/invitations.
 *
 * ⚠️ THIS IS THE ONLY REQUEST IN THIS MODULE THAT SENDS EMAIL. It patches the
 * event with `sendUpdates=all`, so Google mails every guest on the resulting
 * list — including ones already on it, who receive the invitation again.
 *
 * `attendees` are MERGED into the existing guest list rather than replacing it
 * (unlike the PATCH route), because the mental model here is "invite these
 * people", not "the guest list is now exactly this". Omitting it re-sends to
 * whoever is already invited.
 */
export class SendInvitationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDEES)
  @IsEmail({}, { each: true })
  attendees?: string[];
}
