import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import {
  isNotificationKind,
  NOTIFICATION_TARGET_TYPES,
  type HubNotificationSummary,
  type MemberNotification,
  type NotificationKind,
  type NotificationTargetType,
  type Paged,
} from '@ptah-contracts/community';

/**
 * ASSUMPTION-22 — what a notification says when the actor has no name.
 *
 * 🔴 IT IS NEVER AN EMAIL. The actor is another member, and their email address
 * is exactly the class of field NFR-S4 keeps off member-facing responses; a
 * notification list is the last place it should surface, because it is rendered
 * to a member who has no other relationship with that person.
 *
 * 🔴 IT IS NEVER `null` EITHER, WHEN AN ACTOR EXISTS. `User.firstName` and
 * `User.lastName` are both `String?` and both-null is a REAL row in this
 * database — the WorkOS profile does not always carry a name. `null` is reserved
 * for a genuinely actor-less notification (an announcement), because the client
 * branches on it to choose between "X replied to your topic" and a subject-less
 * sentence. Letting a nameless member collapse into the system case would render
 * "replied to your topic" with nothing in front of it.
 */
export const UNNAMED_ACTOR = 'A member';

/** Everything a producer supplies. `tx` enlists the write in its transaction. */
export interface CreateNotificationInput {
  /** Who receives it. */
  readonly recipientId: string;
  /** Who caused it. `null` for a system-generated notification. */
  readonly actorId: string | null;
  readonly kind: NotificationKind;
  readonly targetType: NotificationTargetType;
  readonly targetId: string;
  readonly title: string;
  /**
   * A short PLAIN-TEXT excerpt, or `null`. Never HTML and never markdown that
   * anything will render — the contract says in terms that this string is not
   * sanitized, and the client renders it as an escaped text node.
   */
  readonly bodyPreview?: string | null;
  /** MUST come from `buildNotificationRoute` (RISK-AJ). */
  readonly route: string;
  /**
   * The producer's transaction client (ASSUMPTION-21, PRE-6's shape). Supplied,
   * the notification commits or rolls back with the event that caused it.
   * Omitted, it is its own statement — which is correct for `accept()`, where
   * §3.5 mandates Calendar-first / DB-second and a notification is not worth
   * deleting a real Calendar event over.
   */
  readonly tx?: Prisma.TransactionClient;
}

/** Effective paging, already validated and defaulted by the query DTO. */
export interface NotificationPageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** The row shape both reads select. Structural, so the mapper unit-tests bare. */
export interface NotificationRow {
  id: string;
  kind: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  title: string;
  bodyPreview: string | null;
  route: string;
  readAt: Date | null;
  createdAt: Date;
  actor?: { firstName: string | null; lastName: string | null } | null;
}

const ACTOR_INCLUDE = {
  actor: { select: { firstName: true, lastName: true } },
} as const;

/**
 * `NotificationsService` — R10.2, R10.3, R10.4, NFR-S4, NFR-S7, NFR-S8, NFR-P5,
 * RISK-AH, RISK-AI, ASSUMPTION-21, ASSUMPTION-22.
 *
 * ── 🔴 WHY THIS IS A SERVICE AND NOT FOUR INLINE `prisma.notification.create`
 *    CALLS ──────────────────────────────────────────────────────────────────
 * Because of {@link NotificationsService.create}'s first three lines. R10.2 says
 * a member never gets a notification for their own action, and that rule has to
 * live in EXACTLY ONE PLACE or it does not hold: with four producers, "check
 * that the recipient is not the actor" is four chances to forget, and forgetting
 * is invisible — the notification looks correct to everyone except the one
 * person who receives it. Concentrating it here is the whole design.
 *
 * ── EVERY WRITE IS OWNERSHIP-SCOPED IN THE `where` (RISK-AH, NFR-S8) ───────
 * `markRead` and `markAllRead` are `updateMany` with `userId: ctx.userId` in the
 * `where`, never `findUnique` → check → `update`. A cuid is not a secret: it is
 * short, it appears in a client-side list, and `POST :id/read` is the lowest-
 * value write on the surface, which is precisely why it is the one that gets
 * written without an ownership clause. The two-step version also has a window
 * between the read and the write, and it READS as correct, which is worse.
 *
 * ── THE MEMBER NEVER LEARNS ANOTHER MEMBER'S IDENTITY (NFR-S4) ─────────────
 * `MemberNotification` carries `actorName` and no `actorId`, and the mapper
 * composes that name from `firstName`/`lastName` — never from `email`. The
 * response has no `userId` own key either: a member's own id is not news to
 * them and putting it on the wire invites a client to filter on it.
 *
 * ── SANITIZED FAILURES (NFR-S7) ───────────────────────────────────────────
 * Prisma messages name columns, constraints and sometimes values. None reaches
 * a client; {@link NotificationsService.mapPrismaError} maps the one code that
 * can realistically occur to a fixed sentence, and everything else rethrows for
 * the global filter to turn into a 500.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Write one notification — R10.2, ASSUMPTION-21.
   *
   * 🔴 IT RETURNS `null` WITHOUT WRITING WHEN `recipientId === actorId`, AND
   * THAT SUPPRESSION LIVES HERE AND NOWHERE ELSE. A producer must NEVER
   * pre-check the equality itself: a second copy of the rule is a second place
   * for it to drift, and the copy that drifts is the one that stops suppressing.
   * Producers ignore the return value entirely — "did it write?" is not a
   * question any of them has a use for, and treating a suppression as a failure
   * is how a correct suppression turns into a rolled-back reply.
   *
   * ⚠️ IT RETURNS `null` RATHER THAN THROWING. Self-notification is the NORMAL
   * case for three of the four producers — a member replying to their own topic
   * is ordinary behaviour, not an error — so an exception here would make every
   * producer wrap the call in a `try`, and one of them would eventually swallow
   * a real failure with it.
   *
   * @returns the new notification's id, or `null` when suppressed.
   */
  async create(input: CreateNotificationInput): Promise<string | null> {
    if (input.actorId !== null && input.recipientId === input.actorId) {
      // R10.2 — exit-gate clause 2. Not a warning: this is the designed path.
      return null;
    }

    const db = input.tx ?? this.prisma;

    try {
      const row = await db.notification.create({
        data: {
          userId: input.recipientId,
          actorId: input.actorId,
          kind: input.kind,
          targetType: input.targetType,
          targetId: input.targetId,
          title: input.title,
          bodyPreview: input.bodyPreview ?? null,
          route: input.route,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error: unknown) {
      throw this.mapPrismaError(error);
    }
  }

  /**
   * This member's inbox, newest first — R10.3, `GET /v1/members/notifications`.
   *
   * TWO QUERIES, ISSUED IN PARALLEL: the page and its matching `count`. The
   * count runs under the SAME `where`, so `total` can never report rows the
   * member cannot read.
   *
   * ⚠️ `pageSize` IS TRUSTED, NOT CLAMPED. `ListNotificationsQueryDto` rejects
   * `> MAX_PAGE_SIZE` with a `400` (NFR-P5), and clamping here as well would
   * make the DTO's bound unobservable — a client that asked for 500 rows would
   * get 50 and believe it had them all.
   *
   * ⚠️ THE ENVELOPE IS BUILT INLINE RATHER THAN THROUGH A COPIED `toPaged`.
   * `forum`, `learning` and `community` each carry a `common/pagination.ts`
   * (ASSUMPTION-11); this lib deliberately copies no `common/` helper
   * (ASSUMPTION-19), and there is exactly ONE paged read in it. A fourth copy of
   * a five-line envelope, for one call site, would be the symmetry doing the
   * thinking.
   */
  async list(
    ctx: MemberContext,
    { page, pageSize }: NotificationPageRequest,
  ): Promise<Paged<MemberNotification>> {
    const where = { userId: ctx.userId } as const;

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: ACTOR_INCLUDE,
        // `createdAt desc` alone is not a total order — two notifications from
        // one event share a millisecond — so `id` breaks the tie and keeps two
        // identical requests returning the same page.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const items: MemberNotification[] = [];
    for (const row of rows) {
      const mapped = toMemberNotification(row);
      if (mapped) {
        items.push(mapped);
        continue;
      }
      // 🔴 ONE UNREADABLE ROW MUST NOT TAKE THE WHOLE INBOX WITH IT. `kind` and
      // `targetType` are `String` columns (Prisma has no enum for them), and
      // this service is the only writer, so a value outside the contract's
      // vocabulary means something wrote SQL directly. The client parses the
      // page with `memberNotificationSchema`, whose `z.enum` would reject the
      // WHOLE response — so emitting the bad row breaks every notification the
      // member has, while skipping it loses one and logs why.
      this.logger.warn(
        `Skipping notification ${row.id}: kind=${JSON.stringify(row.kind)} ` +
          `targetType=${JSON.stringify(row.targetType)} is outside the ` +
          `contract vocabulary. Only NotificationsService.create writes this ` +
          `table, so this row did not come through it.`,
      );
    }

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * Mark ONE notification read — R10.4, RISK-AH, NFR-S8.
   *
   * 🔴 `updateMany` WITH `userId` IN THE `where`, AND THE OWNERSHIP CLAUSE IS
   * THE POINT. Filtering on `id` alone would let any member mark any other
   * member's notification read, using an id they can guess.
   *
   * 🔴 `readAt: null` IS ALSO IN THE `where`, SO A SECOND READ IS A NO-OP. Every
   * navigation to the inbox re-issues this call for rows the client already
   * marked; without the clause each one would push `readAt` forward and the
   * member's history would say they read a three-week-old notification today.
   *
   * 🔴 NOT-FOUND AND NOT-YOURS ARE INDISTINGUISHABLE, DELIBERATELY. Both answer
   * `{ readAt: null }` and neither throws a `404`. A distinguishable response is
   * an existence oracle over guessable cuids — "this id is real but not yours"
   * is a fact a member has no use for and an attacker does.
   */
  async markRead(
    ctx: MemberContext,
    id: string,
  ): Promise<{ readAt: string | null }> {
    await this.prisma.notification.updateMany({
      where: { id, userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });

    // Re-read under the SAME ownership clause. An already-read row returns its
    // ORIGINAL `readAt`; a row that is not this member's returns nothing, and
    // `null` is then the same answer a caller gets for an id that never existed.
    const row = await this.prisma.notification.findFirst({
      where: { id, userId: ctx.userId },
      select: { readAt: true },
    });

    return { readAt: row?.readAt?.toISOString() ?? null };
  }

  /**
   * Mark every unread notification read — R10.4, RISK-AH.
   *
   * One statement, ownership-scoped, and `readAt: null` in the `where` so the
   * timestamps of already-read rows are not rewritten. `marked` is the count the
   * client uses to decide whether the badge changed at all.
   */
  async markAllRead(ctx: MemberContext): Promise<{ marked: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { marked: count };
  }

  /**
   * The badge — R10.4, R10.5, AD-14, **RISK-AI**.
   *
   * 🔴 A `count`, AND NOTHING ELSE. Not `findMany().length`. This is the
   * most-called endpoint in the product: every open member tab issues it every
   * 60 seconds, forever, for every member. Written as a fetch-then-length it
   * degrades linearly with a member's history and transfers the whole inbox to
   * compute one integer. `@@index([userId, readAt, createdAt])` serves this
   * `where` on its two leading columns.
   *
   * It returns the ENVELOPE rather than a bare number because
   * `HubNotificationSummary` is both this endpoint's body and the hub's
   * `notifications` section payload — one shape, one construction site, so the
   * badge and the hub card cannot disagree about their own field name.
   */
  async unreadCount(ctx: MemberContext): Promise<HubNotificationSummary> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId: ctx.userId, readAt: null },
    });

    return { unreadCount };
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Translate a Prisma failure into a typed Nest exception. Raw Prisma messages
   * are NEVER forwarded to a client (NFR-S7) — they name columns, constraints
   * and sometimes the offending value.
   *
   * Only ONE code is mapped, because only one can realistically occur on the
   * single write this service performs: `P2003`, the foreign-key violation a
   * `recipientId` or `actorId` with no `users` row produces. Anything else keeps
   * its own identity and reaches the global filter as a 500 — inventing a
   * friendly sentence for an unknown failure is how a real outage gets reported
   * as a validation error.
   */
  private mapPrismaError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      this.logger.error(
        `Notification write failed on a foreign key: ${error.code}. The ` +
          `recipient or actor has no users row.`,
      );
      return new BadRequestException(
        'That notification could not be created right now.',
      );
    }

    return error instanceof Error
      ? error
      : new Error('Notification write failed');
  }
}

/**
 * One persisted row as the member sees it — NFR-S4, ground truth 3,
 * ASSUMPTION-22.
 *
 * 🔴 IT NAMES ITS TEN OUTPUT FIELDS EXPLICITLY. No spread of the row, so
 * `userId` and `actorId` are absent because they were never written — the same
 * allowlist-not-denylist reasoning `toMemberPack` records. A member receives a
 * NAME and nothing that identifies the other person.
 *
 * 🔴 `actorName` IS COMPOSED FROM `firstName`/`lastName` AND NEVER FROM
 * `email`. `User` has no `name` column (`schema.prisma:27-28`), so this is a
 * composition rather than a passthrough, and the tempting third source — the one
 * field that is always populated — is the one NFR-S4 forbids.
 *
 * @returns `null` when the row's `kind` or `targetType` is outside the contract
 * vocabulary. See {@link NotificationsService.list} for why that is a skip
 * rather than a throw or a cast.
 */
export function toMemberNotification(
  row: NotificationRow,
): MemberNotification | null {
  if (
    !isNotificationKind(row.kind) ||
    !isNotificationTargetType(row.targetType)
  ) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind,
    actorName: resolveActorName(row),
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    bodyPreview: row.bodyPreview,
    route: row.route,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `null` ONLY for a genuinely actor-less row; {@link UNNAMED_ACTOR} for an actor
 * who exists but has no name on file.
 *
 * ⚠️ THE `actor` RELATION, NOT `actorId`, IS WHAT DECIDES. They agree today —
 * `onDelete: SetNull` nulls the column when the actor's account is deleted, so
 * there is no such thing as an `actorId` pointing at nothing — and reading the
 * relation means this stays true even if that ever changes.
 */
function resolveActorName(row: NotificationRow): string | null {
  const actor = row.actor;
  if (!actor) return null;

  const composed = [actor.firstName, actor.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();

  return composed.length > 0 ? composed : UNNAMED_ACTOR;
}

/**
 * Runtime narrowing for a persisted `target_type`.
 *
 * The contracts lib exports `isNotificationKind` and deliberately no target-type
 * twin — this is the only reader that needs one, and declaring it here keeps the
 * vocabulary itself single-sourced: the list below is not a copy, it IS
 * `NOTIFICATION_TARGET_TYPES`.
 */
function isNotificationTargetType(
  value: unknown,
): value is NotificationTargetType {
  return (NOTIFICATION_TARGET_TYPES as readonly unknown[]).includes(value);
}
