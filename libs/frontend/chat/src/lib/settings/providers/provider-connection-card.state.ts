import type { EffectiveRouteProvider } from '@ptah-extension/shared';

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
  | 'check-unavailable';

export type ConnectionCardTone = 'neutral' | 'secondary' | 'warning' | 'error';

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
  }
}

/** Card tone (spine and border): a blocked main route always warns. */
export function connectionCardTone(state: ResolvedConnectionState, blockedMain: boolean): ConnectionCardTone {
  if (blockedMain) return 'warning';
  switch (state) {
    case 'active': return 'secondary';
    case 'needs-key':
    case 'unreachable': return 'warning';
    case 'unauthenticated': return 'error';
    default: return 'neutral';
  }
}

/** The spine marks the states that need the eye: the main agent, and attention states. */
export function connectionCardSpine(state: ResolvedConnectionState, blockedMain: boolean): boolean {
  return blockedMain || state === 'active' || state === 'needs-key' || state === 'unreachable';
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
    case 'unauthenticated': return 'bg-error';
    case 'checking': return 'bg-info animate-pulse';
    default: return 'bg-base-content-muted';
  }
}

/** The one inline action a card keeps (plan :631); every other per-state action lives in the drawer. */
export type ConnectionCardAction =
  | 'activate-main'
  | 'add-key'
  | 'replace-key'
  | 'sign-in'
  | 'retry'
  | 'check-again'
  | 'set-up'
  | 'check-connection';

/**
 * The state's primary action:
 * - Active and Checking keep none (the whole card opens the drawer);
 * - Use for main agent where activation is offered (connected; a not-checkable Not checked / Check
 *   unavailable connection, since not checkable is not failed). A checkable Not checked connection is
 *   checked first (RUX-7, unchanged by design);
 * - otherwise the repair for the state: Add API key, Replace key / Sign in, Retry, Check again, Set up.
 */
export function primaryConnectionAction(
  state: ResolvedConnectionState,
  options: { readonly canActivateMain: boolean; readonly uncheckable: boolean; readonly credentialRejected: boolean },
): ConnectionCardAction | null {
  const activate = options.canActivateMain;
  switch (state) {
    case 'active':
    case 'checking': return null;
    case 'connected': return activate ? 'activate-main' : null;
    case 'needs-key': return 'add-key';
    case 'unauthenticated': return options.credentialRejected ? 'replace-key' : 'sign-in';
    case 'unreachable': return 'retry';
    case 'not-installed': return 'check-again';
    case 'not-configured': return 'set-up';
    case 'not-checked': return activate && options.uncheckable ? 'activate-main' : 'check-connection';
    case 'check-unavailable': return activate && options.uncheckable ? 'activate-main' : 'retry';
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
