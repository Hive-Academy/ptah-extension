# Batch 10 report — Lane card account label (U5)

## Frontend implementation — `TASK_2026_719_4f64`, batch 10

**Tasks completed**: Task 10.1 (U5 "Account: <label>" / "Default" / "Removed account").

**Files**:

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
  - :106 `laneAccountProfileId(src)` (module-private): Claude lane only. No binding means `null` (ambient). A valid named binding (`provider === 'claude'`, `profileId` passes the shared `isProviderAccountOpaqueId`) gives the profile ID. A corrupt binding (the backend's `accountBinding: null` sentinel or anything malformed) and non-Claude lanes give `undefined`, so a corrupt binding is never shown as "Default".
  - :131 `mergedLaneAccount`: a later payload with no binding fields keeps the card's known value.
  - :553-557 `MonitoredAgent.accountProfileId?: string | null` (lookup key only, documented as never rendered).
  - :735-750 `openClaudeAccountsFor`: lazily resolves `ProviderAccountsStateService` through `Injector` only for a named lane. It calls `open('claude')` only while the view is `idle`. An inert (non-Electron) host never reads, because `open` returns early.
  - Sites: re-open merge :1286, replacement card :1333, fresh card :1369, open after spawn :1374, exit merge :1589, restored (`loadCliSessions`) :1829, open after restore :1838.
- MODIFIED `.../libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts` — `describe('lane account (U5)')` at :1437 (5 tests): named running→finished, ambient running→failed (no account read), no re-open once ready, corrupt and non-Claude stay `undefined`, restored finished lane.
- MODIFIED `.../libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts` — template badge :110-119, `accountText` computed :204-224 (resolves the label from `ProviderAccountsStateService.state('claude')().snapshot.accounts`; it looks up the state service, through an untracked `Injector`, only for a named profile).
- MODIFIED `.../agent-card-header.component.spec.ts` — `describe('AgentCardHeaderComponent — lane account (U5)')` at :107 (7 tests): label on running and completed, never the profile ID; "Default" on running and failed; "Removed account"; nothing before the list loads or for an unknown account; live rename and removal update the text.

**Acceptance evidence**

- Named binding → `Account: Work` on running and completed cards; the profile ID is absent from `textContent` (header spec :107 block).
- Ambient → `Default` on running and failed cards (header spec); the store records `null` and makes no account read (store spec :1437 block).
- Missing profile → `Removed account` once the snapshot is loaded and lacks the ID; it also covers removal while the card is shown (header spec).
- Finished: the exit merge keeps the account, and restored cards rebuilt from `CliSessionReference.accountBinding` carry it (store spec).
- No new surface. One more badge goes into the existing header row, styled like the model badge (`badge badge-sm badge-ghost text-[9px] text-base-content-muted`). DaisyUI theme tokens only, so it adapts to dark and light themes. Text is interpolated (`{{ }}`); there is no `[innerHTML]`. The label comes from `ProviderAccountSummary.label`, which the shared schema already validates as safe. The UI never renders a profile ID, email, path or org.

**DOM location (for the visual reviewer)**: `ptah-agent-card-header` > first `div.flex` row > `span.badge[data-testid="lane-account"]` (inner `span.truncate` holds the text, `title` repeats it). It sits right after the model badge and before the Stop/Resume button and elapsed time. It shows in both `card` and `flat` presentations. Max width is 10rem; longer labels truncate, and the full text is in `title`.

**Stack observed**: Angular ~22.2 (`package.json:98`); standalone/OnPush/`input()`/`computed()` (`agent-card-header.component.ts`); root signal store (`agent-monitor.store.ts`); account state `ProviderAccountsStateService` (`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:125`, exported from `@ptah-extension/core`, already used by `accounts-section.component.ts`); DaisyUI/Tailwind.

**Design fidelity**: No design handoff exists for U5. Plan U5 (implementation-plan.md:869) was followed and the model badge was used as the typographic reference. No deviation.

**States covered**: named (label), ambient ("Default"), removed ("Removed account"), loading/inert/error with no snapshot (no badge; it never falls back to an ID), corrupt binding and non-Claude lanes (no badge). The badge text is readable by screen readers and is not interactive, so it adds no focus stop.

**Verification**

- `npx tsc --noEmit -p libs/frontend/chat-streaming/tsconfig.lib.json`: 0 errors. Same for `libs/frontend/chat/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p .../tsconfig.spec.json` (both libs): the configs report many errors that were already there (BigInt target in `libs/shared`, `mock-rpc-service.ts`, `AgentOutputDelta` casts at store spec :1707+, `chat-view.component.spec.ts`). Filtering on the new spec ranges (store spec 1437-1560, header spec) shows none in the added code. The repository's typecheck target is the authority; the team-leader's verify runs it.
- `npx eslint` on the 4 files: 0 errors, 2 warnings. Neither warning comes from this batch: `max-lines` on the store was already over 700 lines, and the non-null assertion is at store spec :110.
- `npx jest -c libs/frontend/chat-streaming/jest.config.ts .../agent-monitor.store.spec.ts --maxWorkers=2`: 1 suite, 147/147 passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/agent-card --maxWorkers=2`: 10 suites, 94/94 passed (includes `agent-card-flat-header.spec.ts`, unchanged).
- `ptah_get_diagnostics` was not run; tsc scoped to the two lib configs was used instead.

**Rule 5 (specs that mock or pin changed members)**: `MonitoredAgent` only gains an optional field. The only other renderer of the header is `agent-card-flat-header.spec.ts`; it is unchanged and passes. Its lanes have no account, so it never looks up the state service. Other specs that construct `AgentMonitorStore` are unaffected: the state service is looked up only when a named binding arrives, and their fixtures have none. No ambient-path pin was touched.

## Decisions

- **Where the binding comes from.** `AgentProcessInfo` (shared type, :132) does not declare `accountBinding`. The cited :524 is `CliSessionReference`. The backend broadcasts it on the info object through `laneAccountFields` (`cli-agent-runtime/.../lane-resume-gate.ts:170`). I read it structurally, following the existing `readWorkflowFields` pattern, and did not edit `libs/shared` (out of batch). Options: edit the shared type, or read it structurally. Reversible.
- **Label lookup.** The header resolves the label from `ProviderAccountsStateService`, so renames and removals update live; the store loads the list. The alternative was to copy the label onto the card, which goes stale. I avoided `zod` (`@ptah-extension/shared/schemas`) in the webview and used the barrel's `isProviderAccountOpaqueId`. Reversible.
- **Which cards get a badge.** Only Claude lanes get one. Codex, Copilot and ptah-cli lanes have no Claude account, so "Default" would mislead there. A corrupt binding shows no badge rather than "Default". Reversible.
- **Before the account list loads.** The badge is omitted rather than showing a placeholder or an ID. Reversible.

**Plan deviations**: The plan says the label is read from `AgentProcessInfo.accountBinding` (agent-process.types.ts:524). The field is not typed on `AgentProcessInfo`; :524 is `CliSessionReference`. I read it structurally, as described under Decisions.

**Out-of-scope observations**

- To type `accountBinding` / `accountBindingId` on `AgentProcessInfo` in `libs/shared` would remove the structural read. That is a shared-type change for a later batch.
- The spec tsconfigs of both libs carry pre-existing type errors (listed above).
