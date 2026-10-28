Verdict: REVISE
Score: 6/10
Review family: codex (implementer: Claude)

## Findings

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/`. B = 0, S = 0, M = 2. Three failure modes: missing terminal-result announcement, lost focus on terminal completion, duplicate live-region updates.

1. **Moderate — Sign-in completion is not announced, and a terminal push can strand keyboard focus.**

   **Locations:** `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:467`, `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:349`, `libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts:107`, `libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts:143`.

   **Scenario:** Start sign-in and receive a successful start response whose snapshot says `pending`. The handler announces “Signing in…” and finishes. Finish authentication in the external Claude window, or let that operation fail. The later `provider:accountsChanged` snapshot changes the row/detail state, but no terminal-transition observer announces its result. The tab's snapshot effect handles removal only; the detail's state word is plain text. In particular, the approved design explicitly requires a “Signed in” completion toast (`design-spec-p6.md:118`), which this normal two-stage path never emits. A failure similarly changes the visible word without an alert.

   If focus is on “Cancel sign-in” when that terminal push arrives, Angular removes that button and focus falls to the body. The initial action's focus restoration has already finished; no handler repairs focus for this later transition. The same problem applies to focused fallback script/copy controls when the pending fallback disappears.

   **Evidence:** `accounts-tab.component.ts:468` derives feedback only from the start response. `accounts-tab.component.ts:538` announces only when a write promise settles. `account-detail-view.component.ts:339` closes the terminal disclosure without a waiting-target check or replacement focus target. The existing test at `accounts-tab.component.spec.ts:338` stops at the pending response; it does not deliver a later terminal snapshot.

   **Suggested fix:** Observe authoritative transitions of sign-ins started/observed by this view, announce terminal success or failure exactly once through the feedback service, and deduplicate explicit cancellation/write responses. Preserve B-2 on disappearing pending controls: move to the detail heading only when that control held focus and focus fell to the body; do nothing after navigation/destruction or when focus moved elsewhere. Add tests that first resolve the start RPC to pending, then separately push signed-in/failed states, including duplicate pushes and focus both inside and outside the pending controls.

2. **Moderate — Each mounted toast independently announces the shared message, including the page and inline copies.**

   **Locations:** `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts:49`, `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts:130`.

   **Scenario:** Open a connection's Models & Tiers tab and save a tier. The settings page mounts a toast at `libs/frontend/chat/src/lib/settings/settings.component.html:210`; the tab simultaneously mounts another at `libs/frontend/chat/src/lib/settings/providers/connection-drawer/models-tiers-tab.component.ts:97`. Both consume the same feedback service. Each unconditionally renders two live regions and schedules the same message after 50 ms. Consequently one save produces two live-region mutations, with no announcement-owner selection or suppression for the inline/page pair. This does not meet the requested no-double-announcement behavior; assistive technology that processes both live regions can speak the result twice.

   The drawer uses a manual popover and an ARIA dialog (`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:69`, `:84`, `:287`), not native `showModal()` inertness. Relying on every screen reader to suppress the page's region is not an implemented ownership contract. Actual speech behavior remains an Electron/accessibility verification item.

   **Evidence:** The `inline` flag changes visual placement and test IDs, not the announcement effect. The inline tests at `settings-toast.component.spec.ts:218` change the input on a single fixture; they never mount the real page-plus-inline combination. Removing the visual card's role eliminates one duplicate within a component, not duplicate announcements across instances.

   **Suggested fix:** Elect one active announcement owner per feedback service, preferring the accessible instance inside the active dialog/drawer, while retaining both visual cards where needed for Undo access. Clear pending timers/text when an instance relinquishes ownership. Add a two-instance integration test sharing one service and assert that exactly one live region receives each message; cover mounting an inline copy while a toast already exists.

## Five logic questions

1. **How does this fail silently?** A successful sign-in start is announced, but later completion/failure is not (finding 1). The visual state changes at `account-detail-view.component.ts:116`; no terminal-result toast follows.
2. **What user action produces unexpected behavior?** Leaving keyboard focus on Cancel sign-in while completing authentication externally removes the focused control without restoring focus (finding 1). Saving a tier with both toast instances mounted duplicates the live-region update (finding 2).
3. **What input produces a wrong answer rather than an error?** The concrete problematic input is a pending-to-terminal pushed snapshot after the initial RPC has resolved: the UI omits the requested completion feedback. For account selection itself, removed and signed-out named selections remain disabled placeholders at `account-presentation.ts:238`; no silent ambient reassignment was identified in those examined paths.
4. **What happens when a dependency fails or times out?** The account service converts transport loss/host timeout to unconfirmed and starts a refresh at `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:595`. The new selector feedback preserves uncertainty at `account-presentation.ts:319`; main Save stops before model/effort at `main-agent-reassign-popover.component.ts:660`. The findings concern the later pushed operation result and announcement ownership, not a proven optimistic account write.
5. **What is missing from the requirements?** A shared ownership policy for multiple toast renderers and an explicit B-2 policy for unsolicited terminal snapshots. Completion feedback itself is already required by `design-spec-p6.md:118`.

## Reviewed behavior and verification limits

- Traced the main popover's account draft, click-time intent, provider/account/model ordering, refusal lock, close handling, and revision guard: `main-agent-reassign-popover.component.ts:630`, `:784`, `:795`. Its deferred-provider tests at `main-agent-reassign-popover.component.spec.ts:903` mutate scope/profile revisions and remove the profile before resolving the provider write; these are substantive assertions, not merely checks of initial state.
- Traced lane gating, disabled placeholders, keyboard commit, stored-value rendering and destruction handling: `cli-orchestration-matrix.component.ts:346`, `claude-lane-account-cell.component.ts:159`, `:249`, `:259`. The write explicitly targets only `lane`. Tests at `claude-lane-account-cell.component.spec.ts:345` exercise actual DOM activation and deferred responses.
- Read the account presentation, tab action/focus paths, flat detail, add form, ambient row, and toast implementation; consulted relevant integration hunks and selected specs. The toast clears its timer on replacement/dismiss and destruction at `settings-toast.component.ts:135`, `:144`, `:202`; repeated-message tests exercise the clear/set interval at `settings-toast.component.spec.ts:105`.
- Searched added lines of the supplied diff for catches, `process.cwd()`, and `jest.spyOn`. No new catch or `process.cwd()` was found. The added spies are on the feedback service instance, not module namespaces (`main-agent-reassign-popover.component.spec.ts:774` vicinity).
- No git, build, test or lint commands were run. The role-required, file-scoped `ptah_get_diagnostics` reported no diagnostics in the requested main-popover source and 254 sibling TypeScript errors; those sibling errors were not triaged or attributed to P6. No passing suite, Electron interaction, real screen-reader speech, or zoom result is claimed.
- This is a targeted behavioral review, not exhaustive approval of every line of the approximately 8,000-line diff or every pre-existing integration file. No P6 style/test report was found by the scoped filename search. The findings above are source-traced; runtime reproduction and the proposed regression tests remain to be done.

The score is below 7 because an explicitly required asynchronous completion path and the no-double-announcement contract have gaps. It is above 4 because the examined selection paths preserve stored identities, guard the awaited-provider revision race, and stop on confirmed refusal; the identified failures are localized feedback/focus problems rather than evidence that account routing is fundamentally wrong.

## Decisions

- Treat D56/D57's revision guard and refusal lock, and D60's null-feedback behavior, as approved contracts. Options: reopen their design or review the implementation against them. Evidence: `decisions.md` D56–D60 and `implementation-plan-p6.md` Revision 1. Chosen: review against the approved contracts; reversible through a subsequent design decision.
- Report multi-instance live-region mutations as a concrete implementation gap, while leaving actual speech duplication across assistive technologies unverified. Options: assume ARIA modal suppression or require explicit ownership. Evidence: the two mounts and unconditional announcement effect in finding 2. Chosen: explicit ownership; reversible frontend change.

