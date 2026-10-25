import { z } from 'zod';

import { SessionId } from './branded.types';
import type { SessionRuntimeIdentity } from './session-runtime.types';

const identityFields = {
  version: z.literal(1),
  sessionId: z.string().refine(SessionId.validate).transform(SessionId.from),
  providerId: z.string().min(1),
  workspaceId: z.string().min(1),
};

export const SessionRuntimeIdentitySchema: z.ZodType<SessionRuntimeIdentity> =
  z.discriminatedUnion('runtime', [
    z.object({ ...identityFields, runtime: z.literal('claude-sdk') }).strict(),
    z
      .object({
        ...identityFields,
        runtime: z.literal('codex-app-server'),
        codex: z.object({ normalizedHome: z.string().min(1) }).strict(),
      })
      .strict(),
  ]);

export type SessionRuntimeIdentityParseOutcome =
  | { readonly ok: true; readonly value: SessionRuntimeIdentity }
  | { readonly ok: false; readonly code: 'rejected' };

/** Reject invalid boundary data without exposing it in an error. */
export function parseSessionRuntimeIdentity(
  value: unknown,
): SessionRuntimeIdentityParseOutcome {
  const parsed = SessionRuntimeIdentitySchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, code: 'rejected' };
}
