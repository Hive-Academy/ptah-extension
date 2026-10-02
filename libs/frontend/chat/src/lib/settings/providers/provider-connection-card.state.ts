import type { ConnectionCheckRecord, EffectiveRouteProvider } from '@ptah-extension/shared';

/**
 * Pure derivations for the compact connection card (plan :627-636, design-spec state table): the
 * resolved state, its label, one-line copy, tone and dot, and the single inline action the card
 * keeps. The component holds no state logic of its own.
 */

/** Status inputs: the state table's states plus the wire values of `EffectiveRouteProvider['status']`. */
export type ProviderConnectionCardStatus =
  | 'active'
  | 'connected'
  | 'needs-key'
  | 'unauthenticated'
  | 'unreachable'
  | 'not-installed'
  | 'not-configured'
  | 'checking'
  | 'not-checked'
  | 'check-unavailable'
  | EffectiveRouteProvider['status'];

/** Canonical resolved state (design-spec state table). */
export type ResolvedConnectionState =
  | 'active'
  | 'connected'
  | 'needs-key'
  | 'unauthenticated'
  | 'unreachable'
  | 'not-installed'
  | 'not-configured'
  | 'checking'
  | 'not-checked'
  | 'check-unavailable'
  | 'check-failed';

export type ConnectionCardTone = 'neutral' | 'primary' | 'warning' | 'error';

/**
 * Only explicit positive probe evidence justifies Connected or Active. `unknown` → Not checked,
 * `skipped` → Check unavailable, `missing` → Not configured.
 */
export function resolveConnectionState(
  status: ProviderConnectionCardStatus,
  positiveProbeEvidence: boolean | null,
  isActive: boolean,
  isBlocked: boolean,
): ResolvedConnectionState {
  switch (status) {
    case 'active': return positiveProbeEvidence === false ? 'not-checked' : 'active';
    case 'unknown': return 'not-checked';
    case 'skipped': return 'check-unavailable';
    case 'missing': return 'not-configured';
    case 'reachable': return positiveProbeEvidence === true ? 'connected' : 'not-checked';
    case 'connected':
      if (positiveProbeEvidence === false) return 'not-checked';
      return isActive && !isBlocked ? 'active' : 'connected';
    default: return status as ResolvedConnectionState;
  }
}

/** The states a recorded failed check overrides: they claim, or do not deny, that the connection works. */
const CHECK_FAILED_OVERRIDES: ReadonlySet<ResolvedConnectionState> = new Set(['active', 'connected', 'not-checked', 'check-unavailable']);

/**
 * Batch 53.1 (B38-1): the connection's last recorded check (`route.providers[].lastCheck`) on the card, as the drawer
 * shows it. A failed record that is not older than the route's own probe wins over Active, Connected, Not checked and
 * Check unavailable: "Check failed" (D15: never verified after a failure). A more specific state (Needs API key,
 * Unreachable, Not installed, …) or a running check is kept. A later verified record replaces the failed one, so it
 * clears. An unreadable time on either side counts as "not older" for the check: a failure is never hidden.
 */
export function applyRecordedCheck(
  state: ResolvedConnectionState,
  check: ConnectionCheckRecord | null,
  routeProbedAt: string | null,
): ResolvedConnectionState {
  if (!check || check.status !== 'failed' || !CHECK_FAILED_OVERRIDES.has(state)) return state;
  const checkedAt = Date.parse(check.checkedAt), probedAt = routeProbedAt ? Date.parse(routeProbedAt) : Number.NaN;
  return !Number.isNaN(checkedAt) && !Number.isNaN(probedAt) && checkedAt < probedAt ? state : 'check-failed';
}

/** Short status label shown on the card face (prototype `.conn-card` labels). */
export function connectionStateLabel(state: ResolvedConnectionState, credentialRejected: boolean): string {
  switch (state) {
    case 'active': return 'Active for main agent';
    case 'connected': return 'Connected';
    case 'needs-key': return 'Needs API key';
    case 'unauthenticated': return credentialRejected ? 'Credential rejected' : 'Sign-in required';
    case 'unreachable': return 'Unreachable';
    case 'not-installed': return 'Not installed';
    case 'not-configured': return 'Not configured';
    case 'checking': return 'Checking…';
    case 'not-checked': return 'Not checked';
    case 'check-unavailable': return 'Check unavailable';
    case 'check-failed': return 'Check failed';
  }
}

/** The state table's exact one-line copy. */
export function connectionStateCopy(state: ResolvedConnectionState, provider: string, cliName: string): string {
  switch (state) {
    case 'active': return 'Used for new main-agent requests.';
    case 'connected': return 'Connected and available to use.';
    case 'needs-key': return `Add an API key to connect ${provider}.`;
    case 'unauthenticated': return 'Your credential is missing or expired; authenticate again.';
    case 'unreachable': return `Could not reach ${provider}; check the connection and retry.`;
    case 'not-installed': return `Install ${cliName} to use this connection.`;
    case 'not-configured': return `Set up ${provider} when you are ready.`;
    case 'checking': return `Checking ${provider}…`;
    case 'not-checked': return 'Connection has not been verified.';
    case 'check-unavailable': return 'Could not check this connection. Retry.';
    case 'check-failed': return `The last check of ${provider} failed. Retry, or open the details for the reason.`;
  }
}

/**
 * Card tone (spine and border): a blocked main route always warns. The main agent's card uses the primary accent,
 * as in the prototype (Gate V 28): a warm secondary spine read as a warning beside the unreachable one.
 */
export function connectionCardTone(state: ResolvedConnectionState, blockedMain: boolean): ConnectionCardTone {
  if (blockedMain) return 'warning';
  switch (state) {
    case 'active': return 'primary';
    case 'needs-key':
    case 'unreachable': return 'warning';
    case 'unauthenticated':
    case 'check-failed': return 'error';
    default: return 'neutral';
  }
}

/** The spine marks the states that need the eye: the main agent, and attention states. */
export function connectionCardSpine(state: ResolvedConnectionState, blockedMain: boolean): boolean {
  return blockedMain || state === 'active' || state === 'needs-key' || state === 'unreachable' || state === 'check-failed';
}

/**
 * Status dot colour (colour sits on the dot; the label stays text-base-content, deviation 6).
 * Checking pulses (opacity only).
 */
export function connectionStateDot(state: ResolvedConnectionState): string {
  switch (state) {
    case 'active':
    case 'connected': return 'bg-success';
    case 'needs-key':
    case 'unreachable': return 'bg-warning';
    case 'unauthenticated':
    case 'check-failed': return 'bg-error';
    case 'checking': return 'bg-info animate-pulse';
    default: return 'bg-base-content-muted';
  }
}

/** The one inline action a card keeps (plan :631); every other per-state action lives in the drawer. */
export type ConnectionCardAction =
  | 'add-key'
  | 'replace-key'
  | 'sign-in'
  | 'retry'
  | 'check-again'
  | 'set-up'
  | 'check-connection';

/**
 * The state's primary action, a repair only (prototype cards: status and "Used by", Gate V 28):
 * - Active, Checking and Connected keep none: the whole card opens the drawer, and the main agent is changed in the
 *   Main Agent popover (its provider select offers only connections that can be used, parity #3);
 * - a checkable Not checked connection is checked first (RUX-7); a not-checkable one has nothing to repair;
 * - otherwise: Add API key, Replace key / Sign in, Retry, Check again, Set up.
 */
export function primaryConnectionAction(
  state: ResolvedConnectionState,
  options: { readonly uncheckable: boolean; readonly credentialRejected: boolean },
): ConnectionCardAction | null {
  switch (state) {
    case 'active':
    case 'checking':
    case 'connected': return null;
    case 'needs-key': return 'add-key';
    case 'unauthenticated': return options.credentialRejected ? 'replace-key' : 'sign-in';
    case 'unreachable': return 'retry';
    case 'not-installed': return 'check-again';
    case 'not-configured': return 'set-up';
    case 'not-checked': return options.uncheckable ? null : 'check-connection';
    case 'check-unavailable':
    case 'check-failed': return 'retry';
  }
}

/** Short auth modality for the card's top-right badge (prototype "API Key", "OAuth", "CLI auth"). */
export function authModalityBadge(modality: string | null): string | null {
  switch (modality) {
    case null:
    case '': return null;
    case 'api-key':
    case 'apiKey': return 'API key';
    case 'cli': return 'CLI';
    case 'oauth':
    case 'oauth-proxy': return 'OAuth';
    case 'local':
    case 'local-native':
    case 'local-proxy': return 'Local';
    default: return modality;
  }
}

/** Full auth modality label: the card's provenance line when nothing more specific is known. */
export function authModalityLabel(modality: string | null): string | null {
  switch (modality) {
    case null:
    case '': return null;
    case 'api-key':
    case 'apiKey': return 'API key';
    case 'cli': return 'CLI subscription';
    case 'oauth':
    case 'oauth-proxy': return 'OAuth';
    case 'local':
    case 'local-native':
    case 'local-proxy': return 'Local endpoint';
    default: return modality;
  }
}

/** Avatar surfaces (prototype `iconClass`); the initials stay text-base-content (deviation 6). */
const AVATAR_TONES: readonly string[] = [
  'border-primary/30 bg-primary/10',
  'border-secondary/30 bg-secondary/10',
  'border-info/40 bg-info/10',
];

/** Two-letter avatar text: the first letters of the first two words, else the first two letters. */
export function connectionInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Code points, not UTF-16 units, so an astral first letter is never split in half.
  const [first = ['?'], second = ['']] = words.map((word) => Array.from(word));
  const initials = words.length > 1 ? first[0] + second[0] : first.slice(0, 2).join('');
  return initials.toUpperCase();
}

/** Avatar tone picked from the connection id, so a connection keeps its tone on the card and in the drawer. */
export function connectionAvatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
