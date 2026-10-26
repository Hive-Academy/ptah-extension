/**
 * Provider-account vocabulary shared by profile metadata, routing requests,
 * immutable run bindings and safe results.
 *
 * This module stays free of `zod`. `provider-account.schemas.ts` validates the
 * same shapes. Absolute directories, environment bags, credentials and raw
 * owner identities are intentionally absent: a label is display text, and a
 * binding carries only an opaque fingerprint plus hashed or unknown evidence.
 */

/** Account providers this vocabulary can name. Not a system-lane tuple. */
export const PROVIDER_ACCOUNT_PROVIDERS = ['claude', 'codex'] as const;

export type ProviderAccountProvider = (typeof PROVIDER_ACCOUNT_PROVIDERS)[number];

/** Independent future-start targets. Default is an action, not a scope. */
export const PROVIDER_ACCOUNT_SCOPES = ['main', 'lane'] as const;

export type ProviderAccountScope = (typeof PROVIDER_ACCOUNT_SCOPES)[number];

/** Design §3.5 sign-in states. `signed-out` is distinct from `not-signed-in`. */
export const PROVIDER_ACCOUNT_STATES = [
  'not-signed-in',
  'pending',
  'cancelled',
  'failed',
  'disconnected',
  'signed-in',
  'signed-out',
] as const;

export type ProviderAccountState = (typeof PROVIDER_ACCOUNT_STATES)[number];

/**
 * Closed action outcomes. UI copy comes from {@link isSafeProviderAccountSummary},
 * never from an exception, a path, or process output.
 */
export const PROVIDER_ACCOUNT_RESULT_CODES = [
  'ok',
  'missing-profile',
  'wrong-provider',
  'unsupported-store',
  'unsupported-source',
  'identity-mismatch',
  'identity-unproved',
  'route-changed',
  'busy',
  'unavailable-storage',
  'conflict',
  'cancelled',
  'timeout',
  'release-held',
  'invalid-bound',
] as const;

export type ProviderAccountResultCode =
  (typeof PROVIDER_ACCOUNT_RESULT_CODES)[number];

/** Summary marker. The hashed owner key stays on the binding, not here. */
export const PROVIDER_ACCOUNT_OWNER_MARKERS = ['verified', 'unknown'] as const;

export type ProviderAccountOwnerMarker =
  (typeof PROVIDER_ACCOUNT_OWNER_MARKERS)[number];

export const PROVIDER_ACCOUNT_BINDING_VERSION = 1 as const;

export const PROVIDER_ACCOUNT_LABEL_MAX_LENGTH = 64;

export const PROVIDER_ACCOUNT_SUMMARY_MAX_LENGTH = 160;

export const PROVIDER_ACCOUNT_OPAQUE_ID_MIN_LENGTH = 8;

export const PROVIDER_ACCOUNT_OPAQUE_ID_MAX_LENGTH = 64;

export const PROVIDER_ACCOUNT_FINGERPRINT_MIN_LENGTH = 32;

export const PROVIDER_ACCOUNT_FINGERPRINT_MAX_LENGTH = 128;

/** Exact safe copy for a duplicate canonical route. No path is included. */
export const PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY =
  'This local account directory is already represented by another profile. Rename that profile instead.';

/**
 * Characters kept out of a sanitized result sentence.
 * Display labels do not use this set: a label is bounded user text, not a
 * path segment or a command argument.
 */
const UNSAFE_SUMMARY_TEXT = new Set([
  '/',
  '\\',
  ':',
  '=',
  '$',
  '%',
  '@',
  '`',
  '|',
  '&',
  ';',
  '<',
  '>',
  '"',
  '{',
  '}',
  '[',
  ']',
  '\0',
]);

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasUnsafeSummaryText(value: string): boolean {
  if (value.includes('..')) return true;
  if (hasControlCharacter(value)) return true;
  for (const char of value) {
    if (UNSAFE_SUMMARY_TEXT.has(char)) return true;
  }
  return false;
}

function isAsciiAlphanumeric(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

/**
 * Bounded display label. Length and C0/DEL controls are checked.
 * Slashes, colons and ampersands are ordinary user text.
 */
export function isSafeProviderAccountLabel(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > PROVIDER_ACCOUNT_LABEL_MAX_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }
  return !hasControlCharacter(value);
}

/** Bounded result sentence. Rejects addresses, paths, env assignments and secrets. */
export function isSafeProviderAccountSummary(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > PROVIDER_ACCOUNT_SUMMARY_MAX_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }
  const first = value.codePointAt(0);
  if (first === undefined || !isAsciiAlphanumeric(first)) return false;
  return !hasUnsafeSummaryText(value);
}

/**
 * Display name of the ambient (unnamed) Claude login. No named account may use
 * it, so the ambient row and a named row never read the same.
 */
export const PROVIDER_ACCOUNT_RESERVED_LABEL = 'Existing Claude login';

/** Exact safe copy for an Add or Rename whose name is already taken. */
export const PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY =
  'That name is already used. Names must be different.';

/** Comparison key for account names: surrounding space and case are ignored. */
export function providerAccountLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * True when `label` matches the reserved ambient name or any of
 * `existingLabels` by {@link providerAccountLabelKey}. The caller passes only
 * the labels to compare against; a rename leaves out the renamed account's
 * own label so a case-only change of its own name is allowed.
 */
export function isProviderAccountLabelTaken(
  label: string,
  existingLabels: readonly string[],
): boolean {
  const key = providerAccountLabelKey(label);
  if (key === providerAccountLabelKey(PROVIDER_ACCOUNT_RESERVED_LABEL)) {
    return true;
  }
  return existingLabels.some(
    (existing) => providerAccountLabelKey(existing) === key,
  );
}

/** Opaque profile or run id: ASCII token, never a path or flag. */
export function isProviderAccountOpaqueId(value: string): boolean {
  if (
    value.length < PROVIDER_ACCOUNT_OPAQUE_ID_MIN_LENGTH ||
    value.length > PROVIDER_ACCOUNT_OPAQUE_ID_MAX_LENGTH ||
    value.startsWith('-')
  ) {
    return false;
  }
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || !isOpaqueIdChar(code)) return false;
  }
  return true;
}

function isOpaqueIdChar(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 0x5f || code === 0x2d;
}

/** Canonical-route fingerprint. Slashes, dots and colons cannot appear. */
export function isProviderAccountFingerprint(value: string): boolean {
  if (
    value.length < PROVIDER_ACCOUNT_FINGERPRINT_MIN_LENGTH ||
    value.length > PROVIDER_ACCOUNT_FINGERPRINT_MAX_LENGTH
  ) {
    return false;
  }
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || !isOpaqueIdChar(code)) return false;
  }
  return true;
}

/** Lowercase hex digest. An email or display name is not owner evidence. */
export function isProviderAccountOwnerKey(value: string): boolean {
  if (value.length !== 64) return false;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    const hex =
      (code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66);
    if (!hex) return false;
  }
  return true;
}

/**
 * How a caller asks for a route.
 * `omitted` is an explicit wire value. A missing field is classified separately
 * and is not treated as a malformed named selection.
 */
export type ProviderAccountSelection =
  | { readonly kind: 'omitted' }
  | { readonly kind: 'ambient' }
  | { readonly kind: 'named'; readonly profileId: string };

/** Public routing request. No path, env, epoch, owner or completed binding. */
export interface ProviderAccountSelectionRequest {
  readonly provider: ProviderAccountProvider;
  readonly scope: ProviderAccountScope;
  readonly selection: ProviderAccountSelection;
}

/** Ambient Claude login states. `unknown` is never read as signed out. */
export const PROVIDER_AMBIENT_CLAUDE_STATES = [
  'connected',
  'signed-out',
  'unknown',
] as const;

export type ProviderAmbientClaudeState =
  (typeof PROVIDER_AMBIENT_CLAUDE_STATES)[number];

/** Why an ambient status is `unknown`. */
export const PROVIDER_AMBIENT_CLAUDE_REASONS = [
  'cli-missing',
  'timeout',
  'unreadable',
] as const;

export type ProviderAmbientClaudeReason =
  (typeof PROVIDER_AMBIENT_CLAUDE_REASONS)[number];

/**
 * Ambient (unnamed) Claude login status. No identity, directory or output.
 * `reason` is present only with `unknown`. `checkedAt` is the ISO time at which
 * a host probe attempt for the current ambient environment completed, and
 * `null` when none has completed; a read that ran no probe never mints one.
 */
export interface ProviderAmbientClaudeStatus {
  readonly state: ProviderAmbientClaudeState;
  readonly checkedAt: string | null;
  readonly reason?: ProviderAmbientClaudeReason;
}

/** RPC/list row. Never a directory, email, organization or token. */
export interface ProviderAccountSummary {
  readonly profileId: string;
  readonly label: string;
  readonly provider: ProviderAccountProvider;
  readonly state: ProviderAccountState;
  readonly owner: ProviderAccountOwnerMarker;
  readonly revision: number;
  readonly activeRunCount: number;
}

export interface ProviderAccountActionResult {
  readonly code: ProviderAccountResultCode;
  readonly summary: string;
}

/** Version-1 baseline identity. `known` carries a hash, never a raw identity. */
export type ProviderAccountIdentityEvidence =
  | { readonly kind: 'known'; readonly ownerKey: string }
  | { readonly kind: 'unknown' };

/**
 * Immutable linkage for one run. The canonical directory stays backend-only;
 * `routeFingerprint` is the public stand-in.
 */
export interface ProviderAccountBinding {
  readonly version: typeof PROVIDER_ACCOUNT_BINDING_VERSION;
  readonly provider: ProviderAccountProvider;
  readonly profileId: string;
  readonly routeRevision: number;
  readonly routeFingerprint: string;
  readonly authEpoch: number;
  readonly runId: string;
  readonly identity: ProviderAccountIdentityEvidence;
}

/**
 * A missing binding is legacy absence. A present value that fails validation
 * is `invalid-bound` and must not be read as unbound.
 */
export type ProviderAccountBindingPresence =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid-bound' }
  | { readonly status: 'bound'; readonly binding: ProviderAccountBinding };

/** A missing selection field means omitted. Any other failure stays invalid. */
export type ProviderAccountSelectionField =
  | { readonly status: 'omitted' }
  | { readonly status: 'invalid' }
  | { readonly status: 'present'; readonly selection: ProviderAccountSelection };
