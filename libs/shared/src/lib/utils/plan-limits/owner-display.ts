/**
 * Owner display labels (TASK_2026_615, FU-PHASE6).
 *
 * The owner label is generic ("Claude account"), so two owners of one
 * provider read identically in the dashboard card and the session tiles.
 * The owner key's fingerprint is already non-secret (lowercase hex of a
 * salted SHA-256), so its last 4 characters are a safe distinguishing
 * suffix: "Claude account · a1b2". Pure: nothing throws, and the full key
 * is never returned or displayed.
 */
import type { QuotaOwnerRef } from '../../types/plan-limit.types';

/** A real fingerprint: 8 or more lowercase hex characters after the last `:`. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{8,}$/;

/**
 * The last 4 characters of a hashed owner key's fingerprint
 * (`<providerId>#<kind>:<fingerprint>`), or `null` when the key has no
 * readable fingerprint (no `:`, an empty or short tail, or non-hex
 * characters — a label mistakenly used as a fingerprint, for example).
 */
export function ownerKeySuffix(key: string): string | null {
  const colon = key.lastIndexOf(':');
  if (colon < 0) return null;
  const fingerprint = key.slice(colon + 1);
  return FINGERPRINT_PATTERN.test(fingerprint) ? fingerprint.slice(-4) : null;
}

/**
 * The owner label with its distinguishing key suffix for display
 * ("Claude account · a1b2"), or just the label when the key has no
 * readable fingerprint. Never the full key.
 */
export function ownerDisplayLabel(owner: QuotaOwnerRef): string {
  const suffix = ownerKeySuffix(owner.key);
  return suffix === null ? owner.label : `${owner.label} · ${suffix}`;
}
