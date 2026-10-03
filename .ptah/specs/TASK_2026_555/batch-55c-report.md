# Batch 55c report: UI for M-5 (CONNECTION_IN_USE) and M-6 (keyUnreadable)

Worktree `feat/task-555-settings-redesign`. No commits. Backend contracts come from `batch-55a-report.md`, sections M-5 and M-6. Other batches' uncommitted edits in the touched files (for example `providers-settings.component.ts`) were kept as they were.

## M-5: the host refuses to remove the main agent's connection

**Change**
- `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts`
  - `:49-50`: a new constant, `SWITCH_MAIN_AGENT_FIRST = 'Switch the main agent first.'`. The existing client-side check (`:379-381`) now uses it. That check is unchanged otherwise.
  - `:366-399` `removeCustomEntry`: the write now calls `this.rpc.call('provider:removeCustomEntry')` directly instead of going through `require`.
    - If the call fails with `errorCode === 'CONNECTION_IN_USE'`, the write sets a local `inUse` flag and returns `false`. To the commit pipeline that is an unsaved write, so no read-back runs and nothing is claimed as removed.
    - Any other failure still throws the fixed `'Settings request failed'`, so it is reported as unconfirmed, exactly as before.
    - After `commits.run` finishes (it still refreshes, so the entry stays in the list), an `inUse` result calls `this.commits.block(['Custom connection'], SWITCH_MAIN_AGENT_FIRST)`. That is the same blocked state and text the client-side check produces. The host's `error` text is never read.
  - `requireRpcData` is unchanged, so other callers behave as before.
- Drawer: no change was needed. `advanced-tab.component.ts:137` (`advanced-delete-blocked`) depends on `isDriver`, so it only covers the client-side case. The host refusal reaches the user through the drawer's write outcome: `runDrawerWrite` copies `commit()`, and `outcomeView` renders a `blocked` commit as `Not saved. Switch the main agent first.` (`role="alert"`, error dot). The page-level commit feedback shows the same message.

**Specs**
- `providers-connection-setup.service.spec.ts:342`, "maps the host refusal CONNECTION_IN_USE to "Switch the main agent first.", removes nothing and shows no host text (final review M-5)". It checks:
  - the commit is `blocked` with the fixed message and `saved: []`, never `saved`;
  - only `provider:removeCustomEntry` is called (no read-back), and refresh runs, so the entry stays listed;
  - no host text appears in the commit.
- `:359`, "another host error code on remove stays a generic unconfirmed result, not the main-agent block (M-5)".
- `advanced-tab.component.spec.ts:217`, "a host refusal (CONNECTION_IN_USE, final review M-5) on a connection the route did not mark as driver shows the same block". With `isDriver` false, the alert reads exactly `Not saved. Switch the main agent first.`, there is no "Connection deleted.", and the Delete action is still shown.
- The existing table cases for `removeCustomEntry` (saved, rejected, unconfirmed with no host text, read-back mismatch) still pass.

## M-6: auth:getApiKeyStatus rows with keyUnreadable

**Change**
- `providers-settings.types.ts:150-155`: `ProvidersConnection` gets `keyUnreadable?: true`, which mirrors the host type. It is optional so existing literals are not affected.
- `providers-settings-state.service.ts:335-337` (`readConnections`): sets `keyUnreadable: true` from the host row, and the row counts as `configured`. `hasKey` stays false and no hint is set. This is +2 lines, so the file is now 729 lines (was 727), within the ~10-line allowance.
- `providers-connection-setup.service.ts:344-358` `deleteStoredKey` read-back: a `keyUnreadable` row after a delete counts as not deleted, because an unknown state is not proof of deletion. The Anthropic slot is unchanged.
- `provider-connection-card.state.ts:39-44`: new `KEY_UNREADABLE_TEXT = 'Could not read the stored key.'`, shared by the card and the drawer.
- `provider-connection-card.component.ts`
  - New input `keyUnreadable` (`:186`) and new output `keyRetryRequested`.
  - When the input is set, the status row shows a warning icon (`text-warning`, icon only), the text `Could not read the stored key.` (`data-testid="card-key-unreadable"`, text-base-content), and a Retry button (`card-key-unreadable-retry`). Retry uses the existing inline-link look and focus ring (`inlineActionClass`, :135) and has the aria-label "Retry reading the stored key for <name>".
  - That Retry replaces the state label and the state's single inline action, so "Needs API key" and "Add API key" never show. The tooltip and the card's accessible name use the fixed text too.
- `providers-settings.component.ts`
  - `:132`: binds `[keyUnreadable]` and `(keyRetryRequested)="state.refreshConnections()"`. This is the same refresh the page's "Retry providers" uses.
  - `:198`: drawer `(keyRetryRequested)="state.refreshConnections()"`.
- `connection-detail-drawer.component.ts`
  - Forwards `keyRetryRequested` from the Credentials tab.
  - The subtitle reads `API key · Stored key unreadable` (`:208`) and Overview "Credential storage" reads `Could not read the stored key.` (`:220`). Neither says "No key stored".
- `connection-drawer/credentials-tab.component.ts:186-207`
  - For an unreadable row, the key area shows the warning icon, the fixed text (`credentials-key-unreadable`) and Retry (`credentials-key-unreadable-retry`, same focus ring), in place of the `No key stored` mask.
  - Replace stays available and is labelled `Replace`, not `Add key`, so the user can overwrite the key.
  - Delete key stays hidden, as for any `hasKey: false` row.
  - New output `keyRetryRequested`.

**Specs**
- `providers-settings-state.service.spec.ts:1618`, "maps a keyUnreadable row as configured with an unknown key: keyUnreadable set, hasKey false, no hint (final review M-6)". A readable row carries no flag.
- `providers-connection-setup.service.spec.ts:366`, "deleteStoredKey: a row the host could not read after the delete is not proof of deletion (final review M-6)". The result is `failed` with `unsaved: ['Stored key']`.
- `provider-connection-card.component.spec.ts:252`, describe "unreadable stored key (final review M-6)":
  - the fixed text and Retry render, with no "Not set", "Add API key", "Needs API key" or `btn-add-key`, even when the route status is `needs-key`; the accessible name uses the fixed text; colour is on the icon only;
  - Retry emits `keyRetryRequested` only, not `detailsRequested` or `addKeyRequested`;
  - a readable connection renders no unreadable state.
- `credentials-tab.component.spec.ts:104`, describe "unreadable stored key (final review M-6)":
  - text, icon colour, Retry and its focus ring render; Replace is present; no "No key stored", "Not set", "Add API key" or "Add key";
  - Retry emits `keyRetryRequested`.
- `connection-detail-drawer.component.spec.ts:108`: the subtitle and Overview storage show the unknown state, the Credentials tab shows the fixed text and none of the "no key" wording, and Retry is forwarded.
- `providers-settings.component.spec.ts:266`, "an unreadable stored key (final review M-6): card and drawer Retry re-read the connections". Card Retry, then drawer Retry, each call `state.refreshConnections` once.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/core @ptah-extension/chat --parallel=2` passed: "Successfully ran targets typecheck, lint for 2 projects".
- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat --parallel=2 --skip-nx-cache -- --maxWorkers=2` passed:
  - core: 36/36 suites, 1133 tests passed;
  - chat: 158/158 suites, 2927 passed, 2 skipped (already skipped before this batch).
- Running the new tests alone (`-t "M-5|M-6"`) gave 4 in core and 8 in chat, all passing.
- nx build and Playwright were not run, per the brief.

## Skipped, and why

- **`prettier --write`: not run.** HEAD versions of every touched file are not prettier-formatted: the repo keeps a compact style and its `.prettierrc` only sets `singleQuote`. Checked with `git show HEAD:<file> | npx prettier --stdin-filepath … | diff`. Running `--write` would:
  - reformat whole files, including other batches' uncommitted code;
  - push `providers-settings-state.service.ts` and others far past their 700-line budgets.

  Lint passes. If the orchestrator still wants it, it is a separate formatting-only step.
- **E2E fixture (`settings.fixtures.ts`): skipped.** `API_KEY_STATUS_FIXTURE` feeds many scenes. A `keyUnreadable` row changes a card's face (text and Retry instead of the state label and action), and that would change grid captures and fold budgets. This is the "if in doubt, skip" case.
- **Card: no Replace key for an unreadable row.** The compact card keeps one inline action (plan :631, ≤ 80 px), and for an unreadable key that action is the Retry. Replace is one click away: the card opens the drawer, and the Credentials tab offers Replace.

## Out-of-scope observations

- The Overview tab's status label comes from the route (`drawerStatus` and `connectionStatus`). If the host route reports `needs-key` for a provider whose key read failed, Overview still reads "Needs API key". No "Add API key" action is rendered there. Whether the route can report `needs-key` for an unreadable key is a backend question.
- A local-server row (`kind: 'local'`) with `keyUnreadable` still shows "No key needed: this connection runs on a local server." without the optional-key sentence. It never says "no key stored".

## Files changed

- `libs/frontend/core/src/lib/services/providers-settings.types.ts`
- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts`
- `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts`
- `libs/frontend/core/src/lib/services/providers-connection-setup.service.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.state.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/advanced-tab.component.spec.ts`
- `.ptah/specs/TASK_2026_555/batch-55c-report.md` (this report)
