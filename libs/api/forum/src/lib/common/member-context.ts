import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
// Value-free import, but it is ALSO what loads the
// `Express.Request.memberContext` global augmentation — without it
// `req.memberContext` does not typecheck here.
import type { MemberContext } from '@ptah-api/membership';

/**
 * Read `req.memberContext`, or REFUSE LOUDLY.
 *
 * ⚠️ THIS IS A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL CHECK.
 * `MemberGuard` attaches `memberContext` and is declared at CLASS level on
 * every member controller in this lib, so the `undefined` branch is unreachable
 * while the guard chain is intact. It is CHECKED rather than asserted with `!`
 * because the failure mode of deleting `@UseGuards(JwtAuthGuard, MemberGuard)`
 * would otherwise be an UNGATED forum reading `undefined` — every visibility
 * decision in this lib is derived from this object, so "the guard was removed"
 * has to fail, not degrade.
 *
 * ⚠️ IT IS ONE FUNCTION, SHARED, ON PURPOSE. `MemberHubController` writes this
 * check inline and it is eight lines; two controllers here need it at fourteen
 * handlers between them, and Phases 3–5 add more. Written per controller, the
 * copies drift — one throws, the next quietly composes an empty response — and
 * the drift is invisible because none of them can be reached in a passing test.
 * One construction site, one behaviour, asserted once.
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
        `applied to ${controller}. Refusing to serve an ungated community ` +
        `request rather than reading an undefined visibility context.`,
    );
    throw new InternalServerErrorException(
      'The community is not available right now. Please try again.',
    );
  }
  return ctx;
}
