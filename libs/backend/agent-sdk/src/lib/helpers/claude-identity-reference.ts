import { createHash } from 'node:crypto';

const IDENTITY_DOMAIN = 'ptah-quota-owner';

/**
 * Opaque reference to one Claude identity: SHA-256 hex of
 * `ptah-quota-owner\0<email>\0<organization>` over trimmed values. This is the
 * owner-key formula the main-chat executor and the Claude lane runner use, so a
 * reference taken at certification compares equal to the run's evidence.
 * Returns `null` when no email is known: an unknown identity has no reference.
 */
export function claudeIdentityReference(
  email: string | null | undefined,
  organization: string | null | undefined,
): string | null {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;
  const trimmedOrganization = organization?.trim() ?? '';
  return createHash('sha256')
    .update(
      `${IDENTITY_DOMAIN}\0${trimmedEmail}\0${trimmedOrganization}`,
      'utf8',
    )
    .digest('hex');
}
