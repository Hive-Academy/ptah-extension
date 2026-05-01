/**
 * Custom matcher: `expect(value).toBeSessionId()`.
 *
 * Asserts that the value is a string matching the `SessionId` brand contract
 * (UUID v4 format — see `libs/shared/src/lib/types/branded.types.ts:28-29`).
 */

import { SessionId } from '../../lib/types/branded.types';

type MatcherResult = { pass: boolean; message: () => string };

export function toBeSessionId(received: unknown): MatcherResult {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () =>
        `Expected a SessionId (UUID v4 string), but received ${typeof received}.`,
    };
  }

  const pass = SessionId.validate(received);
  return {
    pass,
    message: () =>
      pass
        ? `Expected "${received}" NOT to match the SessionId brand, but it did.`
        : `Expected "${received}" to match the SessionId brand (UUID v4), but it did not.`,
  };
}
