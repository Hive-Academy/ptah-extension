import type {
  ClaudeAmbientStatusView,
  ProviderAccountsView,
} from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  PROVIDER_ACCOUNT_RESERVED_LABEL,
  PROVIDER_ACCOUNT_SCOPES,
  isProviderAccountLabelTaken,
  isSafeProviderAccountLabel,
  type ProviderAccountScope,
  type ProviderAccountState,
  type ProviderAccountSummary,
  type ProviderAccountsSnapshot,
  type ProviderAmbientClaudeStatus,
} from '@ptah-extension/shared';

/**
 * Pure presentation rules of the Claude Accounts tab and the card badge (TASK_2026_719 P5, plan §7).
 * Every value here derives from a host snapshot or a host ambient answer only: nothing pending, attempted
 * or inferred (R1, R2, binding rule B-1).
 */

/** Host state -> status text (design §3.3). Only `signed-in` reads as signed in. */
export const STATE_LABEL: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'Not signed in',
  pending: 'Signing in…',
  cancelled: 'Sign-in cancelled',
  failed: 'Sign-in failed',
  disconnected: 'Disconnected',
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
};

/** States that get the 4px `state-err` spine (design §3.3). */
export const ATTENTION_STATES: ReadonlySet<ProviderAccountState> = new Set<ProviderAccountState>([
  'failed',
  'disconnected',
]);

/** Avatar letter, rendered as text. `?` for a name with no visible character. */
export function accountInitial(label: string): string {
  const first = Array.from(label.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** Ambient row key in the chip map; profile ids are opaque tokens and never equal it. */
export const AMBIENT_ROW_KEY = 'ambient';

export const UNAVAILABLE_ACCOUNT_OPTION = 'Unavailable account - choose another';
export const UNAVAILABLE_ACCOUNT_MESSAGE =
  'The stored account is no longer available. Choose another account. Ptah does not switch to the existing login for you.';

export type UseForValue = 'ambient' | 'unavailable' | `named:${string}`;

export interface UseForOption {
  readonly value: UseForValue;
  readonly label: string;
  readonly disabled: boolean;
}

export interface UseForScopeModel {
  /** Exactly the stored selection: never a pending or attempted value. */
  readonly value: UseForValue;
  readonly options: readonly UseForOption[];
}

/** A host ambient answer that may be shown: a finished read, not a local failure (plan §6). */
function readyAmbient(view: ClaudeAmbientStatusView): ProviderAmbientClaudeStatus | null {
  return view.status === 'ready' && !view.localFailure ? view.result : null;
}

const AMBIENT_SUFFIX: Readonly<Record<ProviderAmbientClaudeStatus['state'], string>> = {
  connected: '',
  'signed-out': ' (not signed in)',
  unknown: ' (status unknown)',
};

/**
 * Per-scope select model (design §3.1, §3.7). `omitted` and `ambient` both show the existing login (R1). A named
 * selection whose id is not in `snapshot.accounts` shows the disabled "unavailable" placeholder, whatever made it
 * absent (B-1): nothing here reassigns a selection.
 */
export function useForModel(
  snapshot: ProviderAccountsSnapshot,
  ambient: ClaudeAmbientStatusView,
): Readonly<Record<ProviderAccountScope, UseForScopeModel>> {
  const status = readyAmbient(ambient);
  const ambientOption: UseForOption = {
    value: 'ambient',
    label: PROVIDER_ACCOUNT_RESERVED_LABEL + (status ? AMBIENT_SUFFIX[status.state] : ''),
    disabled: false,
  };
  const named: UseForOption[] = orderedAccounts(snapshot).map((account) => {
    const signedIn = account.state === 'signed-in';
    return {
      value: `named:${account.profileId}`,
      label: signedIn ? account.label : `${account.label} (sign in first)`,
      disabled: !signedIn,
    };
  });
  const scopeModel = (scope: ProviderAccountScope): UseForScopeModel => {
    const selection = snapshot.selections[scope].selection;
    if (selection.kind !== 'named') {
      return { value: 'ambient', options: [ambientOption, ...named] };
    }
    if (snapshot.accounts.some((account) => account.profileId === selection.profileId)) {
      return { value: `named:${selection.profileId}`, options: [ambientOption, ...named] };
    }
    const placeholder: UseForOption = {
      value: 'unavailable',
      label: UNAVAILABLE_ACCOUNT_OPTION,
      disabled: true,
    };
    return { value: 'unavailable', options: [placeholder, ambientOption, ...named] };
  };
  return { main: scopeModel('main'), lane: scopeModel('lane') };
}

const CHIP: Readonly<Record<ProviderAccountScope, string>> = {
  main: 'Used for: New chats',
  lane: 'Used for: Claude lanes',
};

/**
 * Row key (`'ambient'` or a profile id) -> "Used for" chips, from the snapshot selections only (R2). A named id
 * absent from the accounts gets an entry no row reads.
 */
export function assignmentChips(
  snapshot: ProviderAccountsSnapshot,
): ReadonlyMap<string, readonly string[]> {
  const chips = new Map<string, string[]>();
  for (const scope of PROVIDER_ACCOUNT_SCOPES) {
    const selection = snapshot.selections[scope].selection;
    const key = selection.kind === 'named' ? selection.profileId : AMBIENT_ROW_KEY;
    const list = chips.get(key) ?? [];
    list.push(CHIP[scope]);
    chips.set(key, list);
  }
  return chips;
}

/** Signed-in accounts first, then the rest; host order within each group. */
export function orderedAccounts(
  snapshot: ProviderAccountsSnapshot,
): readonly ProviderAccountSummary[] {
  const signedIn = snapshot.accounts.filter((account) => account.state === 'signed-in');
  const others = snapshot.accounts.filter((account) => account.state !== 'signed-in');
  return [...signedIn, ...others];
}

/** P5-D7: matches `isSafeProviderAccountLabel` (1-64 characters, no control character, no outer space). */
export const UNSAFE_ACCOUNT_NAME_MESSAGE =
  'Use 1 to 64 characters, with no line breaks and no spaces at the start or end.';

/**
 * `message: null` = the field is empty: not submittable, but nothing to announce yet.
 */
export type AccountNameCheck =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly message: string | null };

/**
 * Add and Rename rule (design §3.5): trim, the shared safe-label rule, then case-insensitive uniqueness
 * against the other named accounts and the reserved ambient name. A rename passes its own id as
 * `excludeProfileId`, so a case-only change of its own name is allowed.
 */
export function validateAccountName(
  raw: string,
  accounts: readonly ProviderAccountSummary[],
  excludeProfileId?: string,
): AccountNameCheck {
  const label = raw.trim();
  if (label.length === 0) return { ok: false, message: null };
  if (!isSafeProviderAccountLabel(label)) {
    return { ok: false, message: UNSAFE_ACCOUNT_NAME_MESSAGE };
  }
  const others = accounts
    .filter((account) => account.profileId !== excludeProfileId)
    .map((account) => account.label);
  if (isProviderAccountLabelTaken(label, others)) {
    return { ok: false, message: PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY };
  }
  return { ok: true, label };
}

export type AmbientTone = 'done' | 'need' | 'idle' | 'run';

export interface AmbientRowModel {
  readonly tone: AmbientTone;
  readonly statusText: string;
  readonly checking: boolean;
  /** Help sentence under the status, or null. */
  readonly extraText: string | null;
  /** "Last checked ..." / "Last check failed ...", only from a host `checkedAt`. */
  readonly ageText: string | null;
}

const SIGNED_OUT_HELP =
  'Sign in with the Claude CLI in a terminal. Ptah does not manage this login.';
const UNKNOWN_HELP =
  'The status could not be read. The Claude CLI may be missing or did not answer in time. This does not mean you are signed out.';

/**
 * Relative age with the `checkedAgo` banding of `overview-tab.component.ts` and this row's own copy (P5-D9).
 * `null` for an unreadable time.
 */
export function ambientAge(checkedAt: string, now: number): string | null {
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `on ${new Date(at).toLocaleDateString()}`;
}

/**
 * Ambient row (design §3.2). Connected is never returned while checking, and no age without a host `checkedAt`
 * (P5-D15). `idle` (no read yet) and `inert` say "Not checked yet" rather than claim a result.
 */
export function ambientRowModel(view: ClaudeAmbientStatusView, now: number): AmbientRowModel {
  if (view.status === 'checking') {
    return { tone: 'run', statusText: 'Checking…', checking: true, extraText: null, ageText: null };
  }
  if (view.status !== 'ready') {
    return { tone: 'idle', statusText: 'Not checked yet', checking: false, extraText: null, ageText: null };
  }
  const result = readyAmbient(view);
  if (!result) {
    return { tone: 'idle', statusText: 'Could not check', checking: false, extraText: UNKNOWN_HELP, ageText: null };
  }
  const age = result.checkedAt === null ? null : ambientAge(result.checkedAt, now);
  switch (result.state) {
    case 'connected':
      return {
        tone: 'done',
        statusText: 'Connected',
        checking: false,
        extraText: null,
        ageText: age && `Last checked ${age}`,
      };
    case 'signed-out':
      return {
        tone: 'need',
        statusText: 'Not signed in',
        checking: false,
        extraText: SIGNED_OUT_HELP,
        ageText: age && `Last checked ${age}`,
      };
    case 'unknown':
      return {
        tone: 'idle',
        statusText: 'Could not check',
        checking: false,
        extraText: UNKNOWN_HELP,
        ageText: age && `Last check failed ${age}`,
      };
  }
}

/**
 * Card badge count (D41, P5-D13): signed-in named accounts, plus 1 when the ambient login is `connected`.
 * `null` unless both reads are usable: a ready, non-stale snapshot and a ready, non-failed ambient answer that
 * is `connected` or `signed-out`. The badge is hidden for `null` and `0`.
 */
export function connectedAccountCount(
  accounts: ProviderAccountsView,
  ambient: ClaudeAmbientStatusView,
): number | null {
  if (accounts.status !== 'ready' || accounts.stale || accounts.snapshot === null) return null;
  const status = readyAmbient(ambient);
  if (!status || status.state === 'unknown') return null;
  const named = accounts.snapshot.accounts.filter((account) => account.state === 'signed-in').length;
  return named + (status.state === 'connected' ? 1 : 0);
}
