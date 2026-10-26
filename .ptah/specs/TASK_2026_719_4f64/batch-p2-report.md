# Batch P2 report: presentation additions (TASK_2026_719, plan P6 component 1)

Executor: frontend-developer. Scope: additive only. Every old export (`useForModel`, `UseFor*`,
`UNAVAILABLE_ACCOUNT_*`, `assignmentChips`, `ambientRowModel`/`AmbientRowModel`, `SIGNED_OUT_HELP`,
`UNKNOWN_HELP`, and the rest) is unchanged. P9 removes the superseded exports.

## Changed files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.ts`
  - New type imports: `ProviderAccountActionOutcome` and `ProviderAccountChoice` from `@ptah-extension/core`.
  - New value import: `isSafeProviderAccountSummary` from `@ptah-extension/shared`.
  - The P6 block is appended after `connectedAccountCount`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.spec.ts`
  - New top-level `describe('account presentation (P6)')` with table tests. The existing cases are unchanged.

## New exports (later batches code against these)

```ts
export const ACCOUNT_COPY: {
  // status toasts
  accountAdded: 'Account added'; signedIn: 'Signed in'; signedOut: 'Signed out';
  signInCancelled: 'Sign-in cancelled'; statusChecked: 'Status checked'; nameSaved: 'Name saved';
  accountRemoved: 'Account removed'; copied: 'Copied'; accountChangedElsewhere: 'Account changed elsewhere';
  accountGone: 'That account is no longer in the list';
  // alert toasts
  saveFailed: 'Could not save the account. Try again.';
  providerSavedAccountNot: 'Provider saved. Account not saved.';
  unconfirmed: 'May not have saved. Accounts reloaded.';
  actionFailed: 'That did not work. Try again.'; nameTaken: 'That name is already used.';
  copyFailed: 'Could not copy'; hostUnsupported: 'Named accounts are not available on this host.';
  // selector option
  removedOption: '⚠ Removed account';
  // aria / title / sr-only
  removedAccount: 'The saved account no longer exists. Choose another account.';
  signInSavedAccount: 'Sign in to the saved account';
  signInLocked: 'Locked while sign-in is in progress.';
  resumeUnavailable: 'Runs bound to this account cannot resume until it is signed in again.';
  notAvailableOnHost: 'Not available on this host';
}; // declared `as const`

export type AccountSelectorValue = 'ambient' | 'stored' | `named:${string}`;
export interface AccountSelectorOption { readonly value: AccountSelectorValue; readonly label: string; readonly disabled: boolean; }
export type AccountSelectorStored =
  | { readonly kind: 'ambient' }
  | { readonly kind: 'named'; readonly profileId: string; readonly label: string }
  | { readonly kind: 'signed-out'; readonly profileId: string; readonly label: string }
  | { readonly kind: 'removed'; readonly profileId: string };
export interface AccountSelectorModel {
  readonly visible: boolean;
  readonly value: AccountSelectorValue;
  readonly stored: AccountSelectorStored;
  readonly options: readonly AccountSelectorOption[];
  readonly selectedText: string;
}
export function accountSelectorModel(view: ProviderAccountsView, ambient: ClaudeAmbientStatusView, scope: ProviderAccountScope): AccountSelectorModel | null;

export function accountChoiceOf(value: AccountSelectorValue): ProviderAccountChoice | null;
export function toastName(label: string): string;

export type AccountFeedbackTone = 'status' | 'alert';
export interface AccountFeedback { readonly message: string; readonly tone: AccountFeedbackTone; }
export function selectionFeedback(outcome: ProviderAccountActionOutcome, scope: ProviderAccountScope, opts: { readonly providerSaved: boolean }): AccountFeedback | null;

export type UsedByChip = 'Chat' | 'Lanes';
export function usedByChips(snapshot: ProviderAccountsSnapshot): ReadonlyMap<string, readonly UsedByChip[]>;

export interface AmbientStatusModel { readonly tone: AmbientTone; readonly word: string; readonly checking: boolean; readonly hint: string | null; }
export function ambientStatusModel(view: ClaudeAmbientStatusView, now: number): AmbientStatusModel;
```

### How they behave

- `accountSelectorModel` returns `null` when `view.status === 'inert'` or `snapshot === null`. A stale snapshot keeps the model.
- Options are built in this order:
  1. The `'stored'` option, selected and disabled, only when the stored account is signed out ("{name} (not signed in)") or removed ("⚠ Removed account").
  2. `ambient`: `Existing Claude login`, with a suffix only when the ambient answer is ready and not a local failure.
  3. Signed-in named accounts, enabled.
  4. The other named accounts, disabled, as "{name} (sign in first)". A signed-out stored profile is left out here because it is already listed first.
  - Order within each group follows `orderedAccounts` (host order).
- `value` is `'ambient'` for an `omitted` or `ambient` selection, `named:{id}` for a signed-in named selection, and `'stored'` otherwise. `selectedText` is the label of the selected option.
- `visible` is true when some account is signed in or `stored.kind !== 'ambient'`.
- `accountChoiceOf('stored')` returns `null`. `'named:a:b'` gives `profileId: 'a:b'`, because only the first prefix is removed.
- `toastName` counts code points (`Array.from`), so it never splits a surrogate pair. Names over 40 characters are cut to 40 and `…` is added.
- `selectionFeedback` gives:
  - `saved`: status "Chat uses {name}" or "Lanes use {name}". The name comes from `outcome.snapshot`; for ambient it is `PROVIDER_ACCOUNT_RESERVED_LABEL`.
  - `failed` and `unavailable`: alert "Provider saved. Account not saved." when `providerSaved` is true. Otherwise the alert is the host summary if it passes `isSafeProviderAccountSummary`, or "Could not save the account. Try again." (`unavailable` has no summary, so it always gets the fallback).
  - `unconfirmed`: alert "May not have saved. Accounts reloaded." in both cases.
- `usedByChips` uses the same keys as `assignmentChips`: `AMBIENT_ROW_KEY` or a profile id. Chips come in scope order: `Chat`, then `Lanes`.
- `ambientStatusModel` (tone reuses the existing `AmbientTone`):

  | State | tone | word | hint |
  |---|---|---|---|
  | checking | `run` | `Checking…` | none |
  | idle or inert | `idle` | `Not checked yet` | none |
  | local failure | `idle` | `Status unknown` | unknown cue, no age |
  | connected | `done` | `Signed in` | "Last checked {age}." or `null` |
  | signed-out | `need` | `Not signed in` | "Sign in with the Claude CLI in a terminal." + " Last checked {age}." |
  | unknown | `idle` | `Status unknown` | "The status could not be read. This does not mean you are signed out." + " Last check failed {age}." |

  An age appears only when the host sent a `checkedAt`.

## Verification

- Command, run from the worktree root:
  `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=account-presentation`
  - It exited 0, but the result came from the Nx cache.
  - I re-ran it with `--skip-nx-cache --outputStyle=stream` and got real counts: "Running target test for project @ptah-extension/chat", `Test Suites: 1 passed, 1 total`, `Tests: 79 passed, 79 total`.
- `ptah_get_diagnostics` reported no errors in either changed file.
  - The project shows 253 errors in other spec files (agent-card, chat-input, compact-session and others). I did not touch those files.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| `selectionFeedback` returns `null` for a `saved` outcome whose snapshot names a profile the snapshot does not list. | Name it "⚠ Removed account"; use an empty name; return `null`. | The plan allows `\| null` and gives no case for it. B-1 says nothing may be inferred. | yes |
| The `saved` toast name goes through `toastName`, so it is cut to 40 characters. | Use the raw label. | Design state contract 4: "name truncated to 40 chars". | yes |
| `ACCOUNT_COPY` also holds the selection alerts (`saveFailed`, `providerSavedAccountNot`, `unconfirmed`), `removedOption` and `signInSavedAccount`. | Keep those as private literals. | The design "Copy" list names them, and P4/P5 need them for assertions and aria text. | yes |
| A local ambient failure gives the unknown cue as the hint, with no age. | No hint. | Plan: the word `Status unknown` covers "unknown or local failure", and the cue belongs to that word. P5-D15: no age without a host `checkedAt`. | yes |

## Open points

- `ACCOUNT_COPY.nameTaken` is "That name is already used." (design copy). The existing `validateAccountName` still returns `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY` ("That name is already used. Names must be different."). AF and DV (P7/P8) must pick one string for the alert toast. I left the old function unchanged, as additive-only requires.
- The lane copy list shows `Existing Claude login` without a suffix. `accountSelectorModel` applies the ambient suffix rule to both scopes, as plan component 1 says. P5 can drop the suffix in the cell if the design means it.
- There is no new catch block, no `any`, no `process.cwd()` and no `jest.spyOn`. No git writes were made.
