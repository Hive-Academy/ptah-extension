import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
// Value-free import, but it is ALSO what loads the
// `Express.Request.memberContext` global augmentation — without it
// `req.memberContext` does not typecheck here.
import type { MemberContext } from '@ptah-api/membership';

/**
 * Read `req.memberContext`, or REFUSE LOUDLY.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/member-context.ts`. A
 * re-declaration for the same reason the rest of this directory is one; the two
 * must change together. The only difference is the message, which names the
 * course surface rather than the community.
 *
 * ⚠️ THIS IS A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL CHECK. `MemberGuard`
 * attaches `memberContext` and is declared at CLASS level on every member
 * controller in this lib, so the `undefined` branch is unreachable while the
 * guard chain is intact. It is CHECKED rather than asserted with `!` because
 * the failure mode of deleting `@UseGuards(JwtAuthGuard, MemberGuard)` would
 * otherwise be an UNGATED curriculum reading `undefined` — every visibility
 * decision in this lib derives from this object (`buildCourseVisibilityWhere`),
 * and every progress read and write keys on `ctx.userId`. "The guard was
 * removed" has to fail, not degrade.
 *
 * 🔴 AND IN THIS LIB THE DEGRADED STATE WOULD BE WORSE THAN AN EMPTY LIST.
 * With `ctx` undefined, a progress write would key on `userId: undefined` —
 * which `LessonProgress`'s composite primary key would either reject at the
 * database or, in a permissive read path, turn into "somebody's progress".
 * There is no version of that which is safe to let through.
 *
 * ⚠️ IT IS ONE FUNCTION, SHARED, ON PURPOSE. Written per controller, the copies
 * drift — one throws, the next quietly composes an empty response — and the
 * drift is invisible because none of them is reachable in a passing test. One
 * construction site, one behaviour, asserted once.
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
        `applied to ${controller}. Refusing to serve an ungated course ` +
        `request rather than reading an undefined visibility context.`,
    );
    throw new InternalServerErrorException(
      'Courses are not available right now. Please try again.',
    );
  }
  return ctx;
}
