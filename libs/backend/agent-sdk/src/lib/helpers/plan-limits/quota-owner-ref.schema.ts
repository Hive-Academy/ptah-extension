/**
 * Restore-time validation of a persisted quota owner (TASK_2026_596, Gate 2
 * G3).
 *
 * `CliSessionReference.quotaOwner` is read back from workspace storage, so it
 * is untrusted: an older build may have written a different shape (a bare
 * `quotaOwnerKey` string), and a hand-edited or corrupted blob may carry
 * anything. Only a value that is exactly `{providerId, identityKind, key,
 * label}`, with a canonical key, is restored. Anything else becomes
 * `undefined`, which renders as "Unknown owner" — never the current owner.
 *
 * Canonical key (Decision 3): `<providerId>#<identityKind>:<fp>`, where `fp`
 * is the first 16 lowercase hex characters of a SHA-256. The key must agree
 * with the object's own `providerId` and `identityKind`.
 */
import { z } from 'zod';
import type { QuotaOwnerRef } from '@ptah-extension/shared';

const IDENTITY_KINDS = [
  'account',
  'credential',
  'cli-store',
  'unknown',
] as const;

/** Provider ids are lowercase slugs (`anthropic`, `openai-codex`, `ollama-cloud`). */
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const FINGERPRINT = /^[0-9a-f]{16}$/;

const MAX_LABEL_LENGTH = 64;

// `strictObject`: an extra field (a legacy `quotaOwnerKey`, an email, a token)
// rejects the whole value rather than being stripped and restored around.
const QuotaOwnerRefSchema = z
  .strictObject({
    providerId: z.string().regex(PROVIDER_ID),
    identityKind: z.enum(IDENTITY_KINDS),
    key: z.string().max(128),
    // A label is generic text ("Claude account"); one with `@` may be an email.
    label: z
      .string()
      .trim()
      .min(1)
      .max(MAX_LABEL_LENGTH)
      .refine((label) => !label.includes('@')),
  })
  .refine(({ providerId, identityKind, key }) => {
    const prefix = `${providerId}#${identityKind}:`;
    return key.startsWith(prefix) && FINGERPRINT.test(key.slice(prefix.length));
  });

/**
 * The persisted owner if it is a valid {@link QuotaOwnerRef}, else
 * `undefined`. Never throws.
 */
export function parseQuotaOwnerRef(value: unknown): QuotaOwnerRef | undefined {
  const parsed = QuotaOwnerRefSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
