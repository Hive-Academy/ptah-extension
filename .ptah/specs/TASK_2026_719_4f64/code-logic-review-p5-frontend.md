# P5 frontend logic review — F1–F5

Verdict: REVISE
Score: 5/10

Counts: 0 Blocking, 3 Serious, 2 Moderate, 0 Minor. Five concrete failure scenarios are documented below.

## Scope and evidence

Reviewed the F1–F5 runtime components, presentation helpers and ambient service, the saved `.ptah/tmp/p5-frontend-F1-F5.diff`, relevant test cases, and the live `accounts-tab.component.ts` (which is absent from that saved patch). Traced the account-state service and native modal/drawer dependencies. Read the task requirements, P5 plan/design, D41/D42 and batch reports. Legacy components and `setDefault` were excluded as instructed. Paths below are relative to this worktree.

No source edits, git commands, tests, builds or install commands were run. Scoped `ptah_get_diagnostics` initially timed out; retrieving its completed result reported no diagnostics in the two requested files (`accounts-tab.component.ts` and `claude-ambient-status.service.ts`), with 348 errors in sibling files. That is not a project-wide clean result, and those sibling errors were not attributed to this patch. Author-reported passing suites are supporting history, not independent execution or proof of integrated Electron focus behaviour. No existing style review was found by `ptah_search_files`; `ptah_code_search_symbols` returned no hits for `providersConnections`, so native free-text search was used to trace the connection filter.

## Findings

### F1 — Serious: Check status never enters the required busy or result state

**Evidence:** `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:571` fires `refreshAccountStatus` without a guard, busy assignment or awaited outcome. In contrast, account writes acquire their latch at `accounts-tab.component.ts:581`. The Check status button is disabled only by `busyNow()` at `account-detail-view.component.ts:264`. Its focus-return effect at `account-detail-view.component.ts:454` therefore sees no pending operation and immediately returns focus. `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:331` returns `Promise<void>` and silently returns on transport/refusal failure at line 343.

**Failure scenario:** On a slow or failing host, click Check status twice, then Sign out. Both status requests and the write can start; the detail never shows Working or disables the account actions for the check. A timed-out/refused read leaves the previous status with no failure announcement. This violates design §3.7(b) and the requested same-handler busy rule. The F4 report explicitly acknowledges this deviation; the existing action-kind union does not waive the requirement.

**Suggested fix:** Represent a status check in the per-account pending state, set it synchronously, reject repeats and clear it in `finally`. Return a usable status-read outcome from the service and show safe success/failure feedback without synthesizing an account snapshot. Cover a deferred read, a repeated click and a refused/timeout reply through the real tab/detail integration.

### F2 — Serious: Escape in Remove confirmation closes the enclosing connection drawer

**Evidence:** The new confirmation is projected into `ptah-native-modal` at `libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts:312`, inside the drawer at `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:66`. `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts:71` handles bubbling keydown events, but its handler at line 177 handles only Tab. The enclosing panel listens for keydown at `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:89`; lines 272–277 prevent Escape's default action and emit drawer close unconditionally.

**Failure scenario:** Open Profile → Remove account, then press Escape while Cancel has focus. Escape bubbles through the modal to the drawer, which closes the entire Accounts view instead of cancelling only confirmation and returning focus to Remove account. Native top-layer rendering does not change that DOM ancestry. This violates plan §11 and design §5.

**Suggested fix:** Contain Escape at the open modal boundary while preserving its native cancel path, or make the drawer ignore Escape from an open descendant modal. Verify an actual bubbling Escape with both components mounted. `account-detail-view.component.spec.ts:369` currently dispatches `cancel` directly at line 374 and cannot exercise the failing keydown path.

### F3 — Serious: Removing the standalone section makes Accounts inaccessible without an installed CLI

**Evidence:** The standalone section is removed in the saved patch at `.ptah/tmp/p5-frontend-F1-F5.diff:3446`; the Accounts tab is now mounted only inside the Claude connection drawer (`libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:85`). The page still filters cards to configured or selected providers at `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:767`. Native Claude configuration depends on `claudeCliInstalled` at `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:455` and lines 471–476; saved endpoint setup is collected only for local providers at line 441. Catalog selection opens the setup wizard, not this drawer (`providers-settings.component.ts:1313`).

**Failure scenario:** In Electron, select another provider and uninstall/lose detection of Claude CLI, with no Claude API key or custom connection. Named account records can still exist, but the Claude subscription card disappears. There is then no normal page entry to its Accounts tab to inspect, rename or remove those records, change the future Claude selections, or read the missing-CLI status. The old standalone entry was independent of that connection filter. Design §3.2 explicitly includes the missing-CLI ambient state; parity requires account management to remain reachable.

**Suggested fix:** Preserve an Electron entry to the Claude subscription drawer when named-account support exists, including the unconfigured/missing-CLI case. For example, keep that card visible in the account-enabled host. Add coverage with another selected provider, `claudeCliInstalled: false`, no key/setup and existing named accounts.

### F4 — Moderate: Add/removal focus restoration checks an area, not the waiting target

**Evidence:** `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:488` decides add completion navigation using `focusWithin(addArea)`, and line 497 opens the new detail on that basis. Account disappearance uses the same area predicate at lines 409–411. `focusWithin` at lines 645–649 accepts every descendant and explicitly treats `document.body` as eligible whenever the area exists. `focusAfterRender` at lines 652–656 checks destruction only; it does not revalidate the waiting element or view identity before focusing.

**Failure scenario:** Start Add, then click non-focusable content elsewhere in the drawer so the waiting status loses focus to the document body. On success the body branch still treats focus as inside the add form, opens the new detail and moves focus to its heading. B-2 requires leaving focus alone and announcing completion after the user leaves the waiting target. The same overly broad predicate is used when an open account disappears.

**Suggested fix:** Capture the exact waiting element and list/detail view identity when starting the operation. Require both to match at completion and immediately before the render-time focus move; do not treat body or arbitrary descendants as the waiting target. Keep the toast announcement when that predicate fails. Existing removal coverage at `accounts-tab.component.spec.ts:271` distinguishes live status from an outside select, but does not exercise body focus or a different control within the detail.

### F5 — Moderate: Successful sign-in/sign-out/cancel operations omit B-2 completion announcements

**Evidence:** `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:541`, line 545 and line 549 call `run` without saved feedback. On success, `run` stores `feedback: null` and emits no toast unless explicitly supplied (`accounts-tab.component.ts:594`). The detail's live region at `account-detail-view.component.ts:136` renders only Working or `feedback ?? ''` (`account-detail-view.component.ts:418`). The component test at `account-detail-view.component.spec.ts:428` manually supplies `Signed in.` at line 435; the production parent never supplies that value.

**Failure scenario:** Start Sign out and move focus to the Claude lanes selector while the host is pending. After a successful response, focus correctly stays on the selector, but the detail's live region changes from Working to empty and the tab provides no completion toast. The user receives no completion announcement, contrary to B-2. The same missing parent feedback affects sign-in initiation and cancellation.

**Suggested fix:** Supply safe action-specific completion feedback/toasts for these saved outcomes, accurately distinguishing a started sign-in from a completed sign-in. Verify the real parent-child wiring with focus outside the detail; a test host that invents the missing feedback is insufficient.

## Binding checks and parity

| Requirement | Result | Evidence |
| --- | --- | --- |
| B-1: no local selection assignment on removal; retain authority; arbitrary missing targets | PASS in reviewed frontend | `accounts-tab.component.ts:562` delegates removal only. `account-presentation.ts:102` checks membership against the supplied snapshot and uses a disabled unavailable placeholder for any missing named ID. `account-use-for.component.ts:165` reasserts the authoritative DOM value. |
| B-2: exact waiting target, active view and completion announcement | FAIL | F4/F5; F1 additionally completes the focus cycle before its request completes. Exact-element guards are present in `account-use-for.component.ts:187` and `ambient-account-row.component.ts:156`, but do not repair the parent paths. |
| D41: count, visibility, display-only card, read lifecycle | PASS for a rendered Claude card | `account-presentation.ts:269` requires ready/non-stale accounts and ready/non-failed ambient status, rejects unknown, counts only signed-in named accounts plus connected ambient. `provider-connection-card.component.ts:123` renders plain `N connected` and hides zero/null. Page wiring at `providers-settings.component.ts:328`, line 570, line 1029 and line 1161 limits the badge to Claude, reads on open/close and reacts to account-state signals. F3 separately blocks access to the card in a supported state. |
| Capability parity: add, rename, remove, sign in/out, both use-for scopes and status | FAIL overall | The handlers and both scope controls exist (`accounts-tab.component.ts:163`, line 471, line 508, lines 541–572), but F3 removes the entry path in the missing-CLI case, F1 breaks status interaction and F2 breaks confirmation Escape. |

## Five logic questions

1. **How does it fail silently?** A failed named-account status read returns without feedback (F1); successful account actions also clear rather than populate the completion live region (F5).
2. **What user action is unexpected?** Escape closes the entire drawer while a removal modal is open (F2). Leaving Add's waiting target can still trigger completion navigation (F4).
3. **What input produces a wrong result instead of an error?** A valid missing-CLI/unconfigured Claude connection with another selected provider produces a page with no account-management entry (F3). Missing named selection IDs themselves are handled generally by `account-presentation.ts:102`, not fixture-specific reassignment.
4. **What happens on dependency failure, timeout or malformed output?** Ambient reads catch/reject unusable replies and publish null/local failure; sequence and destruction guards prevent obsolete completion (`claude-ambient-status.service.ts:71`, line 86). Named-account status failure remains silent (F1). Runtime Electron and host deadline behaviour were not independently exercised.
5. **What was left unspecified or unverified?** Moving the only Accounts entry inherits the existing configured-card filter (F3). Nested native-modal/drawer keyboard integration was expressly deferred in the F3 report; the actual Escape path demonstrates why that integration matters (F2).

## Other traced boundaries and remaining uncertainty

- Ambient out-of-order replies use a request sequence and destruction guard (`libs/frontend/core/src/lib/services/claude-ambient-status.service.ts:73`). The reply copies only state/checkedAt/reason at line 95; it does not manufacture a successful check timestamp. The frontend RPC timeout is 30 seconds; verification of the host's 25-second deadline is outside this frontend review.
- The elapsed-age timer is registered once and cleared on destruction (`libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.ts:132`). Focus-related signal effects terminate their waiting state (`account-use-for.component.ts:185`, `account-detail-view.component.ts:467`); these inspected paths do not establish an effect loop.
- Add and writes acquire pending state before awaiting (`accounts-tab.component.ts:472`, line 581); per-scope changes do so at line 508. F1 is the status-check exception. Delayed parent focus scheduling checks destruction at line 653, but that is weaker than B-2's active-target/view requirement.
- The card's new badge contains only a number and fixed text (`provider-connection-card.component.ts:123`). Account and fallback-script content use text interpolation in the new detail template; the intentionally retained sign-in-script surface is distinct from exposing account metadata on the card. No new raw-HTML rendering was identified in the reviewed templates.
- Browser-native focus restoration, screen-reader announcement delivery and actual RPC/process timing remain unexecuted. Passing author suites do not settle these boundaries: the direct-cancel test and fabricated feedback above specifically bypass two production integrations.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the Check status deviation as a defect | Accept a void read without pending UI; enforce the binding busy rule | Design §3.7 explicitly includes Check status; F4 admits the implementation difference | Yes; add UI/read outcome handling |
| Treat missing-CLI reachability as parity, not new scope | Require setup/reinstallation first; retain access to stored account management | P5 retains all old capabilities; missing-CLI ambient state is specified; existing connection filter is now the only entry gate | Yes; adjust entry visibility |
| Accept snapshot-authoritative selection and display-only badge logic separately from integration failures | Reject all related logic; distinguish confirmed passing contracts | B-1 and D41 evidence in the checklist | Yes; reassess on changed code |

The score is below 7 because common interactions can close the wrong view, hide the feature, or give no status feedback. It is above the 3–4 band because the core authoritative-selection contract, ambient reply sequencing, timer disposal and badge calculation are implemented coherently at the cited boundaries. The five confirmed scenarios require another implementation pass before approval.
