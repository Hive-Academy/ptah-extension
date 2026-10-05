# Batch 21 report: Dashboard provider account card

Task: TASK_2026_596_0a19, Batch 21, Task 21.1. Executor: frontend-developer. No git was run.

## Files

- REWRITE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts` (657 lines). It renders one section per owner from `PlanLimitsStore`, and its pure view model `buildOwnerSections` is in the same file.
- REWRITE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.spec.ts` (26 tests).
- DELETE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\services\provider-account-state.service.ts`
- DELETE `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\services\provider-account-state.service.spec.ts`. The batch file list does not name this spec. Deleting it follows from deleting the service, because the spec only imports and tests that service.
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\index.ts`. The `ProviderAccountStateService` export line is removed. The barrel is now 25 lines.

No other file was touched. `chat-streaming`, settings files and backend libs were not opened for editing.

## Capability inventory of the deleted `ProviderAccountStateService`

Line numbers refer to the deleted file as it was before deletion.

| # | Capability (old file:line) | Where it lives now |
|---|---|---|
| 1 | Selection input `providerId = computed(() => auth.persistedProviderId())` (`:15`) | The card reads `AuthStateService.persistedProviderId()` directly: in the `providerWatcher` effect (card `:364`), in `sections` to put the selected owner first (`:355`, `buildOwnerSections` `:428`), and in `refresh()` (`:369`). |
| 2 | `activateProvider` skips a repeated id (`:18-19`) | The effect re-runs only when the signal value changes, so a repeated id causes no reload. |
| 3 | A provider switch bumps the generation, so the earlier response is dropped (`:21`, `:29`, `:36`) | `PlanLimitsStore.load` generation guard (`plan-limits.store.ts:102,109`). Each switch calls `load`, which supersedes the earlier one. |
| 4 | `_result` signal holding the account-usage result (`:9`, `:13`) | `PlanLimitsStore.snapshot()`. Each `PlanLimitOwnerSnapshot` carries `windows`, `status`, `staleSince`, `account`, `activity`, `ownerEvidence` and `cooldown`. |
| 5 | `loading` signal (`:10`, `:14`, `:31`, `:41`) | `PlanLimitsStore.loading()`. It disables Refresh and drives the spinner. |
| 6 | Refresh with `refresh:true` (`:27`, `:34`) | Card `refresh()` calls `load({providerId, refresh:true})` (`:369`). |
| 7 | Re-entrancy guard `if (_loading()) return` (`:28`) | Refresh is disabled while the store is loading. A superseded load is dropped by the store guard (row 3). |
| 8 | Failed RPC gives `{status:'service-unavailable'}` (`:37-39`) | The store sets an empty snapshot on failure (`plan-limits.store.ts:119-126`). The card then renders "Account usage unavailable". A per-owner `service-unavailable` renders the raw status name and its sentence. |
| 9 | Clears the result and loading on a provider switch (`:22-23`) | **Changed.** The previous snapshot stays visible until the next load lands, but section order follows the new selection at once. No stale data is shown under the wrong name, because every section is labelled with its own owner. |
| 10 | Loads only for Codex (`:24`); `isCodex` gate (`:16`) | **Removed on purpose, as the plan requires** (Component 16, "replacing the `isCodex()` gate"). The card now loads and renders for every provider. |
| 11 | RPC `provider:getAccountUsage` (`:33`) | Replaced by `provider:getPlanLimits` through the store, as the plan requires. The backend method is untouched, and its Codex fields are still returned (Req 2.10, backend Batch 15). After this batch, no frontend code calls `provider:getAccountUsage` (grep of `libs/frontend`). |

Capabilities of the old card (`provider-account-card.component.ts`), all kept:

- Section heading and the `aria-label="<label> usage"` pattern. For Codex this still reads "Codex account usage".
- The Refresh button.
- The stale notice "Showing cached account data; refresh failed at …". The time is now local absolute time with the zone, and the notice uses a warning left border instead of `text-warning`, because design §8 forbids semantic colour as text colour.
- The Activity block. Its markup is unchanged (`aria-label="Account activity"`, "Lifetime tokens: … ?? 'Unavailable'", and the disclaimer with its original `text-base-content-muted` class). It renders whenever `owner.activity` is present.
- The int64 counter is rendered as a string, so it keeps full precision (test 3).
- The spinner, and the "Account usage unavailable" text.
- The "Primary used / Secondary used" lines are replaced by named window rows, as Req 6.1 requires. Codex windows render in snapshot order, so `windows[0]` and `windows[1]` keep their primary and secondary meaning (Req 2.10, batch-9-report). No capability was dropped beyond rows 9-11.

## Per-task evidence (Task 21.1)

| Requirement | Evidence |
|---|---|
| One `<section>` per owner, selected provider first | `buildOwnerSections` (`:428`); test "puts the selected provider first and follows a selection change" |
| Effect calls `load({providerId})`, passing exactly that field | `providerWatcher` (`:364`); test "loads exactly {providerId} on start and on every change, and stops after destroy". The real-store test asserts the RPC call `('provider:getPlanLimits', {providerId:'openai-codex'})`. |
| Refresh calls `load({providerId, refresh:true})` | test "Refresh reloads …" |
| Empty snapshot shows "Account usage unavailable" | test "an empty snapshot …" |
| `Used: unknown`, never 0, and no bar without a value | tests 2, 4, 5 and 14 |
| Window row content | Name; state chip as glyph (`aria-hidden`) plus a word; `role="meter"` bar with `aria-valuenow`, `aria-valuetext`, `aria-label` and the P3 tick; value "94% used" or "$3.20 of $50.00 used"; reset line "Resets <local abs> · in …", "Reset unknown" or "Reset passed …"; source chips, dashed and italic for unofficial and estimated sources. Covered by tests 1, 3 and 4. |
| "Limit reached — resets …" or "— reset unknown" | tests 1, 2 and 12 |
| Cooldown shown separately | test 8 (`role="status"`, info border, "a retry delay, not a plan reset") |
| Req 2.8 combined rendering | tests 5, 6 and 7 |
| Raw failure status name | tests 11, 15 and 16 |
| Stale notice kept | test 11 |
| F61, all 16 design states | Spec tests "1." to "16." follow the design §4 list in order. |
| Ledger-only owner (Batch 18 binding: `service-unavailable` with or without `no-open-session`) | Rendered as past evidence, not as a read failure. Covered by test "a ledger-only owner with no open session …". |

Design fidelity: design-spec §4, the prototype `cardHtml`/`winHtml`/`evidenceHtml`/`cooldownHtml` (`prototype/index.html:334-387`), and `dashboard-card-dark.png`. Deviations:

- **Subtitle.** "Subscription quota and account activity" when activity exists, otherwise "Subscription quota", followed by " · Plan: <planType>" when known. The prototype's provider-specific subtitles, such as "ChatGPT account · Plus", are not data the snapshot carries.
- **Status sentences.** The design asks for a sentence for each of `unsupported-config`, `provider-unsupported`, `cli-unavailable` and `cli-version-unsupported` but gives no wording. I wrote them in `STATUS_SENTENCES`.
- **Expired cooldown.** Not shown. The design requires only an *active* cooldown.

A3 (expansion retention) and A1/A2 do not apply here. The card has no expandable tiles and no lane subgroups, and it hides no window: every window in the owner snapshot is rendered.

## Carry-forwards honoured

- **Explicit time zone and locale.** `timeOptions = {timeZone: Intl resolved zone, zoneNameLocale: inject(LOCALE_ID)}` (`:342`). It is passed to every `formatLocal*` call. Test "passes the zone-name locale explicitly (LOCALE_ID)" checks this under `en-GB`.
- **Batch 16: `load` merges named fields.** The card always passes an explicit `providerId`, which is never undefined because `persistedProviderId` is a string signal. It never passes `sessionIds` or `ownerKeys`, so the chat view's scope is untouched.
- **`estimated-limit` is informational.** An active estimated window exhaustion renders as an "Estimated limit hit (unconfirmed, informational)" note. Estimated owner evidence renders with a neutral border. Neither ever renders as "Limit reached" or with a warning border (test "an estimated limit hit is informational …").
- **`model-scope-unknown`.** Not applicable. The card does not evaluate lane state, so no `LaneStateReason` is rendered. Owner evidence that carries a `modelScope` names the scope in its text.
- **Unknown is never 0.** See the evidence table above.
- **Codex `quota.primary/secondary` (Req 2.10).** The backend contract is untouched, and the card keeps the window order.
- **No timers.** The card uses `PlanLimitsStore.now()` and starts no interval.
- **Boundaries.** The dashboard imports only `@ptah-extension/core` and `@ptah-extension/shared`, both existing edges.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard` (foreground, no extra flags): **3/3 targets succeeded** (typecheck, test, lint; cache 0/3 hit).
- `npx nx test @ptah-extension/dashboard --skip-nx-cache`: **12/12 suites and 137/137 tests passed**. The card spec has 26 tests. The deleted service spec's 2 tests are gone.
- `npx nx lint @ptah-extension/dashboard --skip-nx-cache`: no warnings and no errors.
- `grep -rn ProviderAccountStateService libs apps`: no output (exit 1).
- The lucide-angular icons named in the brief were not used. The design uses text glyphs marked `aria-hidden` ("■", "▲", "◷", "?", "↻", "~"), so no icon import was needed.

## Proposed Removals

None deleted beyond the plan. For consideration only:

- `provider:getAccountUsage` has no webview caller after this batch. Do **not** remove it. Req 2.10 and the compatibility NFR require that it keeps returning the Codex fields, and other hosts or tools may call it.

## Out-of-scope observations

- The card file is 657 lines, because the pure view model lives in the component file to stay within the batch's file list. A follow-up could move `buildOwnerSections` and its helpers to `provider-account-card.view-model.ts` in the same folder without changing behaviour.
- Behaviour change for the visual review: the dashboard now shows owners from the shared snapshot, including chat session and lane owners that Batch 20 adds to the scope, after the selected provider. This is per plan ("lane owners follow").
- Batch 16 residual (`applyEmpty` bypasses the `generatedAt` guard) still applies. If an RPC call fails, the card falls back to "Account usage unavailable" until the next load or push.

## Fix round 1

- Trigger: the webview guard `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts:198` (no `text-base-content/NN` in `libs/frontend`).
- Change, only in `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts`:
  - The text classes at `:148, :175, :238, :260, :326` were `text-base-content/70`.
  - The source-chip text at `:251, :279` was `text-base-content/80`.
  - All of them are now `text-base-content-muted`, the same class the Activity disclaimer uses (`:303`).
  - Border classes (`border-base-content/20`) are not text, so they stay as they were.
  - There is no guard exception. The spec was not edited, and `libs/frontend/chat-ui/**` was not touched.
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard ptah-extension-webview`, run in the foreground with no extra flags, ran 6 targets and **all 6 passed** (cache 0/6 hit).
- Deviation from the design, recorded: design-spec §8 picks `text-base-content/70` for new secondary text, because it rates `--bcm` (`text-base-content-muted`) at 4.46:1 on base-200 in the light theme, below 4.5:1. The repository guard takes precedence. The light-theme contrast of these secondary lines should therefore be checked in the Phase 6 visual review.
