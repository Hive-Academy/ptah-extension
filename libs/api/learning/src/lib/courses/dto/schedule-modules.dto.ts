import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * THE TWO COHORT-SCHEDULING PAYLOADS — C4.
 *
 * `POST /v1/admin/course-modules/schedule/preview`  → {@link PreviewModuleScheduleDto}
 * `POST /v1/admin/course-modules/schedule`          → {@link ApplyModuleScheduleDto}
 *
 * ── 🔴 THE FAILURE MODE THESE ARE SHAPED AGAINST ──────────────────────────
 * *A mis-typed start date silently shifting ten member-visible dates.* There is
 * no admin UI for courses in `libs/web/admin`, so this action is driven by
 * `curl` — which means a machine-checkable echo is the only guard that actually
 * fires. `ApplyModuleScheduleDto` therefore carries two extra REQUIRED fields
 * the preview does not, and the service compares both against the freshly
 * computed schedule INSIDE the transaction before any write.
 *
 * A `confirm: true` boolean was rejected: a boolean is satisfied by copy-paste.
 * `confirmLastReleaseDate` cannot be supplied correctly without having read a
 * preview or done the weekday arithmetic by hand — and every plausible
 * mis-typing of the start date MOVES the last date: a wrong year, a wrong
 * month, a transposed `2026-01-09` for `2026-09-01`, an off-by-one day.
 * `confirmModuleCount` catches the other half of the same failure: an admin who
 * believes he is scheduling ten modules and is in fact scheduling a course that
 * has twelve.
 *
 * ── 🔴 EXTENSION, NOT ONE CLASS WITH OPTIONAL CONFIRMS ────────────────────
 * `reorder.dto.ts:13-19` rejects the optional-field shape for the reason that
 * applies here too: with one class, `forbidNonWhitelisted` would ACCEPT the two
 * confirm keys on `/preview` — a request naming a guard the endpoint ignores,
 * which looks honoured and is not. Extension gives two classes, no optional
 * fields, and a strict superset, so both directions are a `400`:
 *
 *   apply payload  → `/preview`   400 — two NON-WHITELISTED keys
 *   preview payload → `/schedule` 400 — two MISSING required keys
 *
 * Both directions are spec cases in `admin-course-modules.controller.spec.ts`.
 * They are what prove the classes are genuinely distinct ON THE WIRE rather
 * than only in the type system, which is the part that could rot silently.
 *
 * ── 🔴 NO FIELD IS NULLABLE-OPTIONAL ──────────────────────────────────────
 * `EXPECTED_NULLABLE_OPTIONALS` (`nullable-dto.spec.ts:73`) stays at thirteen. A
 * `null` here would have no meaning: "unschedule everything" is `PATCH :id`
 * with `releaseAt: null`, per module, and it already exists.
 *
 * ⚠️ AND EVERY BINDING IS A WHOLE-OBJECT `@Body(dtoPipe(...))` (PRE-1, RISK-I).
 * A single `@Query('courseId')` would make `MIN_TOTAL_PAYLOAD_PARAMS` read 80
 * against a `NAMED_PRIMITIVE_PARAM_COUNT` of 7 and
 * `controller-validation.spec.ts`'s arithmetic would not close.
 */

/** The rehearsal payload — and the base every apply also carries. */
export class PreviewModuleScheduleDto {
  /**
   * The course whose modules are being scheduled. Missing or soft-deleted → 404.
   *
   * ⚠️ IN THE BODY, AND KEYED ON A COURSE RATHER THAN ON THIS COHORT.
   * `COURSE_SLUG` is `ptah-builders-cohort-1`, so cohort 2 is a NEW course row —
   * C4's requirement is that cohorts 2 and 3 need NO CODE CHANGE, which is only
   * true if the action takes a course id. `ReorderModulesDto.courseId` is the
   * established idiom on this controller for a course-scoped bulk write.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  courseId!: string;

  /**
   * Day 1's LOCAL calendar date in `timeZone`. `YYYY-MM-DD` and nothing else.
   *
   * 🔴 `@Matches`, NOT `@IsISO8601()`. The latter accepts a full datetime, and a
   * caller who supplied one would have their time-of-day SILENTLY OVERRIDDEN by
   * `timeOfDay` — the request would succeed and mean something other than what
   * was typed.
   *
   * ⚠️ THIS REGEX CHECKS THE SHAPE, NOT THE CALENDAR. `2026-02-30` matches it.
   * `computeWeekdaySchedule` rejects a date that does not exist, and rejects a
   * SATURDAY or SUNDAY start outright rather than rolling it forward.
   */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  /**
   * The local wall-clock time each module opens. `HH:mm`, 24-hour.
   *
   * ⚠️ REQUIRED AND DELIBERATELY UNDEFAULTED. A default is a decision about when
   * a member's module unlocks, taken by whoever wrote the constant rather than
   * by the operator running the cohort.
   */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  timeOfDay!: string;

  /**
   * IANA identifier — `Europe/Berlin`, `UTC`.
   *
   * 🔴 THE ADMIN SUPPLIES THE ZONE; IT IS NEVER INFERRED. The server's own zone,
   * the container's `TZ` and UTC-by-assumption are all rejected: a container
   * timezone change would otherwise silently move ten member-visible dates,
   * with no diff anywhere to show it happened.
   *
   * ⚠️ THE REGEX IS A CHEAP BOUNDARY REJECT ON THE SHAPE ONLY. `Mars/Olympus`
   * matches it. The real check is `Intl` resolving the identifier, in the pure
   * helper.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/)
  timeZone!: string;
}

/**
 * The apply payload — the preview's fields PLUS the two echoes.
 *
 * 🔴 BOTH CONFIRM FIELDS ARE REQUIRED. That is the guard. Sending a preview
 * payload here is a `400` for two missing keys, which is exactly the intended
 * outcome: an apply that was never rehearsed cannot be expressed.
 */
export class ApplyModuleScheduleDto extends PreviewModuleScheduleDto {
  /**
   * Must equal the number of LIVE modules the course actually has.
   *
   * `Max(500)` mirrors `MAX_REORDER_IDS` — far beyond any real curriculum, and
   * a bound rather than a hardcoded ten, because C4 must not assume ten.
   */
  @IsInt()
  @Min(1)
  @Max(500)
  confirmModuleCount!: number;

  /** Must equal the computed LOCAL date of the LAST module. `YYYY-MM-DD`. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  confirmLastReleaseDate!: string;
}
