import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
// Value-free import, but it is ALSO what loads the
// `Express.Request.memberContext` global augmentation — without it
// `req.memberContext` does not typecheck here.
import type { MemberContext } from '@ptah-api/membership';

/**
 * Read `req.memberContext`, or REFUSE LOUDLY.
 *
 * ⚠️ SIBLING FILES — THE THREE MUST CHANGE TOGETHER:
 *   - `libs/api/forum/src/lib/common/member-context.ts`
 *   - `libs/api/learning/src/lib/common/member-context.ts`
 *
 * A re-declaration for the same reason the rest of this directory is one
 * (ASSUMPTION-11). The only difference is the message, which names the live and
 * private session surfaces rather than the community or the curriculum.
 *
 * ⚠️ THIS IS A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL CHECK. `MemberGuard`
 * attaches `memberContext` and is declared at CLASS level on both member
 * controllers in this directory, so the `undefined` branch is unreachable while
 * the guard chain is intact. It is CHECKED rather than asserted with `!` because
 * the failure mode of deleting `@UseGuards(JwtAuthGuard, MemberGuard)` would
 * otherwise be an UNGATED feed reading `undefined` — every visibility decision
 * here derives from this object (`buildLiveSessionVisibilityWhere`).
 *
 * 🔴 AND ON THE SESSION-REQUEST SURFACE THE DEGRADED STATE IS WORSE THAN AN
 * EMPTY LIST. `SessionRequestsService.listOwn` puts `ctx.userId` in the `where`
 * — that IS the R4.3 own-only rule, not a filter applied after the read. With
 * `ctx` undefined the `where` would carry `userId: undefined`, which Prisma
 * treats as "no constraint": the endpoint would return EVERY member's private
 * session requests, including their notes and their scheduled Meet links. There
 * is no version of that which is safe to let through, and it is why this
 * function throws rather than returning a benign empty context.
 *
 * ⚠️ IT IS ONE FUNCTION, SHARED ACROSS THIS DIRECTORY, ON PURPOSE. Written per
 * controller, the copies drift — one throws, the next quietly composes an empty
 * response — and the drift is invisible because none of them is reachable in a
 * passing test.
 *
 * The message the CLIENT sees names nothing (NFR-S7); the reason goes to the
 * server log with the route on it.
 */
export function requireMemberContext(
  req: Request,
  controller: string,
  logger: Logger,
): MemberContext {
  const ctx = req.memberContext;
  if (!ctx) {
    logger.error(
      `No memberContext on ${req.method} ${req.path} — MemberGuard is not ` +
        `applied to ${controller}. Refusing to serve an ungated session ` +
        `request rather than reading an undefined visibility context.`,
    );
    throw new InternalServerErrorException(
      'Sessions are not available right now. Please try again.',
    );
  }
  return ctx;
}
