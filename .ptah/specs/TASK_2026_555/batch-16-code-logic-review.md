# Code Logic Review — `TASK_2026_555` (Batch 16: webview e2e harness baseline + Gate G reachability spec)

## Round 2

**Disclosure:** this re-review was performed by an in-process reviewer while every CLI lane
was out of quota, reviewing an in-process senior-tester's revision — a same-side review, not
an independent-vendor one. Findings below are evidence-based (file:line) precisely because
that disclosure is on the record; treat the verdict with that in mind.

### Verdict: APPROVED

Score: 8/10 (up from 5/10). Every round-1 Blocking and Serious finding is fixed with a real,
verifiable mechanism, not a relabeling. The remaining gaps are disclosed in the code's own
comments rather than hidden behind a passing assertion, which is the behaviour Gate G exists
to force. Nothing found in this round rises to Blocking; three are Moderate and one is Minor.

### (a) Round-1 findings — fixed / partial / not fixed

| # | Round-1 finding | Status | Evidence |
|---|---|---|---|
| Blocking 1 | `BASELINE_PRESENT_IDS` dynamically derived; `undefined` passes `.not.toBe('pending')` | **FIXED** | `settings-reachability.table.ts:794-802` is now a literal 64-string array with a doc comment explaining why (`:775-793`). `settings-reachability.e2e.spec.ts:38-43` asserts `toBeDefined()` before `toContain(['present','restored'])`. A new independent guard, `settings-reachability.e2e.spec.ts:51-54`, pins the frozen list's own length/uniqueness (64, no dupes) so the literal array itself can't silently shrink or duplicate either. |
| Blocking 2 | 14 hollow reach steps (`#13,#19,#20,#26,#29,#32,#33,#36,#37,#39,#56,#77,#79,#83`) | **FIXED (12/14), PARTIAL (2/14)** | 12 entries now drive and assert the real interactive control: `#13` asserts the oauth sign-in controls (`table.ts:365-369`), `#19`/`#20` advance to `wizard-step-verify` and run a real verify/failed-probe (`:406-430`), `#26`/`#29`/`#32`/`#33`/`#36` advance to `wizard-step-models` and assert real tier controls or perform a real tier edit (`:447-531`), `#37` asserts the actual resolved-model text (`:533-540`), `#56` asserts a real write RPC fired and the read-back mutated (`:596-617`, backed by `settings.fixtures.ts` `FixtureState`), `#77` boots a second page with an empty CLI list to reach the true empty state (`:655-668`, via `throughVariantBoot`), `#83` drives the real in-app deep-link button rather than a manual tab click (`:698-710`). `#39` and `#79` are IMPROVED but not fully fixed — see (c) below: each now asserts a real, different reachable surface (the CLI's own model picker; the loaded-state text plus absence of an error banner) but the specific *error/retry* behaviour named in their own capability label is still unreached, and the code says so in its own comments (`:542-550`, `:671-679`) rather than passing silently. |
| Serious 3 | Write resolvers stateless, no call recording, no read-back mutation | **FIXED** | `settings.fixtures.ts:334-556`: `FixtureState` holds mutable `agentConfig`/`authStatus`/`ptahCliAgents`/`modelTiers`/`clearedOverrides`; every write resolver (`agent:setConfig`, `auth:saveSettings`, `ptahCli:create/update/delete`, `provider:setModelTier`, `config:model-switch`, etc.) calls `record()` and mutates the shared state; read resolvers close over the same object (`:417,450,456`). `getFixtureState(page)` (`:569-573`) lets a reach step assert both the call and the read-back, exercised for real in `#56` (`table.ts:603-616`). |
| Serious 4 | Monolithic 64-step run with no fault isolation; `closeWizard` could throw unhandled in a `finally` and cascade | **FIXED** | `settings-reachability.e2e.spec.ts:81-98` wraps every step in `try/catch/finally`; the `finally` runs best-effort recovery (`wizard-cancel` click, `Escape`, forced tab remount) with every action `.catch(() => undefined)`'d, so the recovery itself cannot throw. See NW-1 below for a related but distinct residual risk in `closeWizard`'s own final assertion. |
| Moderate 5 | `storedAuthMethodScope: 'global'` vs BRIEF's `'app'` | **FIXED** | `settings.fixtures.ts:214`, `'app' as const`, with the BRIEF citation kept in the comment. |
| Moderate 6 | No guard that both hosts actually run | **FIXED** | `settings-reachability.e2e.spec.ts:56-61`, `expect(HOSTS).toEqual(['vscode','electron'])`. |
| Moderate 7 | Missing stubs for `auth:deleteStoredKey`/`auth:copilotLogout`/`provider:removeCustomEntry` | **FIXED** | `settings.fixtures.ts:469-481`, all three present with call recording; `copilotLogout` also mutates `authStatus.copilotAuthenticated`. |

### (b) New weaknesses

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| NW-1 | Moderate | `closeWizard`'s final line, `await expect(wizardBody(page)).toHaveCount(0)` (`table.ts:110`), runs inside the `finally` of `throughCatalog`/`throughCard`/`throughBlankWizardCustomOption` (`:243,268,289`). JS `finally`-block exceptions replace a pending exception from the `try` block. If a reach step's own `assertion(page)` throws for the real product reason (e.g. a verify control never renders) AND the wizard is left un-closeable, the failure recorded in `failures[]` (spec:80) is `closeWizard`'s generic "wizard-body count !== 0" timeout, not the real defect that caused it. The step still fails — nothing passes silently — but whoever reads the Gate G failure list is pointed at the wrong symptom. Not blocking (the round-1 concern was cascading collateral failures across all 64 entries, which is fixed); this is a debuggability regression on the one entry that legitimately fails. |
| NW-2 | Moderate | Fixture-state leakage across table entries within one host run. `bootSettings` creates exactly one `FixtureState` per `page` (`settings.fixtures.ts:561,587-588`), shared by all 64 sequential entries. `#56`'s reach (`table.ts:601-617`) performs a toggle-off write, an assertion, then a toggle-on "restore" write — if the assertion between the two throws, the restoring click never runs and `ptahCliAgents[0].enabled` stays `false` for every remaining entry in that host's run. No other entry currently reads that field, so today's blast radius is zero, but this is the same class of problem FM-4 named for DOM state, reintroduced for fixture state, and the file's own doc comment on `throughVariantBoot` (`table.ts:156-164`) argues explicitly for isolating exactly this kind of shared-session side effect rather than pushing a stateful toggle-and-restore through it. A future entry that reads `enabled`, or a future author copying `#56`'s pattern for a less trivially-reversible field, would fail for a reason having nothing to do with its own reach step. |
| NW-3 | Minor | The spec-level recovery in the `finally` block (`spec.ts:89-98`) can leave the page on the "Advanced" tab as a last-resort remount, with no guarantee the next entry's `reach()` re-navigates before asserting. Every entry sampled does either navigate its own tab first or asserts something tab-independent (`#82`'s `settings-back`), so there is no live failure today — but this is an unenforced assumption, not a structural guarantee, and a future entry appended without its own tab navigation could pass or fail depending on unrelated leftover recovery state from an earlier, different entry's crash. |
| NW-4 | Minor | The author's stated table size (785 lines) does not match the file on disk (802 lines, confirmed by `wc -l`). Not a logic defect, but a discrepancy between the reported evidence and the artifact worth noting since Gate G's whole premise is trusting self-reported "green" status. |

### (c) `#39`/`#79`: is the auto-responder substitution acceptable?

Read `marketplace.fixtures.ts:116-216` (`installRpcAutoResponder`, shared verbatim by
`settings`, `thoth/*`, and `boot/boot-progress.e2e.spec.ts`): `respond()` (`:164-173`)
hardcodes `success: true` into every `rpc:response` envelope, and a resolver that
throws/rejects is only `console.error`'d (`:198-205`) — the call is left **unanswered**
rather than answered with `success: false`. There is no per-call opt-in error path anywhere
in this shared helper today, for any of the three scenario folders that use it. This confirms
the gap `#39`/`#79`'s comments describe (`table.ts:543-550,671-679`) is real, is not local to
Settings, and is not something Batch 16 could have closed by itself without changing shared
infrastructure three other scenario folders depend on.

Given that, the substitution is **acceptable for this batch** — with a condition. What tips it
from "acceptable" to actually acceptable is that the code says so, at the exact line, instead
of quietly asserting a heading and calling it done (which is what round 1 correctly flagged).
Gate G's stated purpose is catching a capability silently disappearing while its own gate
stays green (TASK_2026_523), not exhaustively proving every error branch; `#39`/`#79` now each
assert a *different real* reachable surface rather than nothing, and their own capability's
error path is named as future work, not asserted-around. The condition: this should not be
allowed to stay a comment forever. Recommend a follow-up batch add an opt-in error envelope to
`installRpcAutoResponder` (e.g. a resolver returning a recognized sentinel, or throwing a typed
error, causes `respond()` to dispatch `{ success: false, error }` instead of leaving the call
unanswered) — once that exists, `#39`/`#79` should be revised to actually exercise the branch
named in their own capability label, and this condition should be tracked, not re-discovered
by a future round-3 review.

### (d) Should the 802-line table be split now?

No, not yet. The file is organized into five clearly banner-commented sections
(`providersAuth`, `mainAgentModel`, `cliAgents`, `orchestrationPolicy`, `other`) plus the
frozen `restoredPending`/`KEPT_SELECTORS`/`EXPECTED_CAPABILITY_COUNT`/`BASELINE_PRESENT_IDS`
constants, all exported from one module. D14's own rule is that this is a frozen S4 baseline:
future batches only ever ADD (flip a `pending` entry to `restored` with a real `reach`) or
extend the literal `BASELINE_PRESENT_IDS` array — they don't reorganize it. Splitting now would
multiply the files the frozen-baseline invariant has to be re-verified across, for a file that
is not yet unmanageable to read in one sitting. Revisit if the file crosses roughly 1200 lines,
or once several of the 17 `pending` entries start flipping to `restored` with `reach` bodies
of the `#19`/`#29`-style multi-step length (~10-15 lines each), whichever comes first.

---

## Round 1

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 5/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 2                                    |
| Serious issues      | 2                                    |
| Moderate issues     | 3                                    |
| Failure modes found | 4                                    |

Score justification:
- Separating 5/10 from 7-8: The harness infrastructure, tab navigation, kept-selector verification, smoke capture spec, and ~50 real capability reach steps are well structured. However, the regression guard contains a critical design flaw that permits capabilities to be silently demoted or deleted without failing, 14 of the 64 "present" capabilities rely on hollow heading-only checks, comma-fallback selectors, or step-1 continue buttons, and write resolvers fail to record calls or mutate read-back state.
- Separating 5/10 from 3-4: The file suite is functionally runnable, type-clean, correctly maps the 81 capabilities (82 minus dropped #21), correctly deletes the hollow `provider-settings.e2e.spec.ts`, and establishes the foundation for Gate G once the guards and weak reach steps are tightened.

## Five logic questions

### 1. How does this fail silently?
- [`settings-reachability.table.ts:564-566`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L564-L566): `BASELINE_PRESENT_IDS` is dynamically derived by concatenating the present arrays (`...providersAuth, ...mainAgentModel, ...`). If a later batch moves an entry from `providersAuth` to `restoredPending`, `BASELINE_PRESENT_IDS` automatically omits that ID from the baseline set.
- [`settings-reachability.e2e.spec.ts:31-36`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L31-L36): `expect(byId.get(id)).not.toBe('pending')` evaluates to `true` when `byId.get(id)` is `undefined`. If an ID is deleted from `REACHABILITY_TABLE` or replaced by a dummy entry, the guard passes silently.
- [`settings-reachability.table.ts:314,318`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L314-L319): Entries `#19` and `#20` use comma fallback selectors (`[data-testid="wizard-verify-start"], [data-testid="wizard-api-key"]` and `[data-testid="wizard-credential-error"], [data-testid="wizard-api-key"]`). In both cases, `.first()` matches the visible `wizard-api-key` input, meaning neither verification start nor error diagnostics copy is ever asserted.
- [`settings.fixtures.ts:364-376`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts#L364-L376): Write RPC resolvers (`auth:saveSettings`, `agent:setConfig`, `ptahCli:create`, etc.) are pure stateless stubs returning `{ success: true }`. They do not mutate read-back fixture state, meaning read-after-write bugs fail silently because read RPCs return static initial data.

### 2. What user action produces unexpected behaviour?
- Running the reachability suite when a capability step throws inside a modal: [`settings-reachability.e2e.spec.ts:46-65`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L46-L65) executes all 64 capabilities in a single continuous Playwright session without page reboots. If step `N` fails before closing a wizard or leaves the DOM in an unexpected state, steps `N+1` through `64` cascade into failures due to dirty DOM state.

### 3. What input data produces a wrong answer?
- Modifying `settings-reachability.table.ts` by removing a broken capability ID and adding an unused dummy capability ID: the guard test `REACHABILITY_TABLE.length === EXPECTED_CAPABILITY_COUNT` passes (81 === 81), and the baseline check passes because `byId.get(deletedId)` is `undefined` (which is `.not.toBe('pending')`).

### 4. What happens when a dependency fails?
- If `auth:verifyDraftConnection` or `agent:getConfig` returns an unexpected payload or error during a reach step, the reach assertion throws. In `settings-reachability.e2e.spec.ts:57-62`, the error is caught, recorded in `failures`, and asserted at the end of the test. However, if the failure occurred inside `throughCatalog` or `throughCard`, the `finally` block invokes `closeWizard(page)` ([`settings-reachability.table.ts:70-87`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L70-L87)), which attempts to click `[data-testid="wizard-cancel"]`. If the modal was in a crashed or unmounted state, `closeWizard` throws an unhandled error that terminates the entire loop prematurely.

### 5. What is missing that the requirements never mentioned?
- Isolation / reset between reachability table entries. Running 64 interactive actions sequentially against a single SPA instance requires robust teardown between each step (or resetting view state if an action fails).
- Static or runtime validation that newly flipped `restored` capabilities do not provide a no-op reach step (`async () => {}`).

---

## Failure modes

### FM-1: Bypassing Gate G by Moving a Failing Capability to Pending
- Trigger: A developer in a future batch encounters a failing test on capability `#3` and moves `{ id: '#3', ... status: 'pending' }` from `providersAuth` to `restoredPending`.
- Symptom: Gate G passes completely green; the regression guard does not alarm; capability `#3` silently disappears from automated test coverage.
- Evidence: [`settings-reachability.table.ts:564-566`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L564-L566) and [`settings-reachability.e2e.spec.ts:31-36`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L31-L36).
- Current handling: `BASELINE_PRESENT_IDS` dynamically inspects the present arrays at execution time, so removing an item from the present array automatically removes it from `BASELINE_PRESENT_IDS`. Additionally, `byId.get(id)` returns `undefined`, which satisfies `.not.toBe('pending')`.
- Recommendation: Hardcode `BASELINE_PRESENT_IDS` as a literal array of 64 string IDs frozen in Batch 16, and assert `expect(['present', 'restored']).toContain(byId.get(id))`.

### FM-2: False Confidence via Hollow Reach Steps (Heading and Continue Button Checks)
- Trigger: A regression breaks the UI for capabilities `#13`, `#19`, `#20`, `#26`, `#29`, `#32`, `#33`, `#36`, `#37`, `#39`, `#56`, `#77`, `#79`, or `#83`.
- Symptom: Gate G remains green despite the capability being completely missing or broken.
- Evidence:
  - `#13` (`:275-276`): asserts only `wizard-step-heading`.
  - `#19` (`:314`): comma-selector matches `wizard-api-key`, never testing verification start.
  - `#20` (`:318`): comma-selector matches `wizard-api-key`, never testing error copy.
  - `#26` (`:341`): asserts `wizard-custom-name` or `wizard-continue`, identical to #24.
  - `#29` (`:348`): matches `wizard-continue` on step 1; never asserts Models step.
  - `#32`, `#33`, `#36` (`:363, 367, 379`): matches `wizard-continue` on step 1; never reaches model mapping or tier commit.
  - `#37` (`:383`): asserts `#providers-main-heading` (heading only).
  - `#39` (`:387`): asserts global 'Refresh settings' button, not model list retry.
  - `#56` (`:429`): asserts `#providers-cli-heading` (heading only).
  - `#77` (`:473`): asserts `System CLIs` (heading only).
  - `#79` (`:478`): asserts `Agent Orchestration` (heading only).
  - `#83` (`:493`): switches tabs manually and asserts `#providers-main-heading` (heading only).
- Current handling: Weak assertions pass because elements matching the relaxed selectors remain in the DOM.
- Recommendation: Replace heading and step-1 continue button checks with assertions on the actual interactive controls or text nodes representing the capability.

### FM-3: Read-After-Write Masking Due to Stateless Fixture Resolvers
- Trigger: An interaction scenario in a later batch modifies settings via RPC (e.g. `agent:setConfig` or `auth:saveSettings`) and queries state via `agent:getConfig` or `auth:getEffectiveRoute`.
- Symptom: The UI renders stale initial state instead of the updated configuration, but tests pass if they only check RPC response status rather than read-back state.
- Evidence: [`settings.fixtures.ts:364-376`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts#L364-L376).
- Current handling: Write resolvers return `{ success: true }` without mutating the fixture objects or recording calls.
- Recommendation: Follow the `marketplace.fixtures.ts:969-982` stateful resolver pattern: hold mutable local state inside `baseSettingsFixtures()`, mutate the state on writes, and return the mutated state on reads.

### FM-4: Cascading Step Failures in Single-Session Reachability Run
- Trigger: An unexpected failure or timeout occurs during reach step 5 out of 64 while a wizard dialog is open.
- Symptom: Step 5 fails, `closeWizard` encounters an unmounted cancel button and throws, leaving the remaining 59 steps to cascade fail with timeout or obscured-element errors.
- Evidence: [`settings-reachability.e2e.spec.ts:46-65`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L46-L65) and [`settings-reachability.table.ts:70-87`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L70-L87).
- Current handling: Errors inside `entry.reach(page)` are caught into an array, but the browser page is not reset to a clean baseline between entries.
- Recommendation: Wrap step cleanup in a resilient recovery helper that navigates back to `#settings-back` or reloads the settings view if a modal is detected still open after a step failure.

---

## Blocking issues

### 1. Regression Guard Can Be Silently Bypassed by Moving or Deleting Present Capabilities
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:564-566`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L564-L566) and [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts:31-36`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L31-L36)
- Scenario: A developer in a subsequent batch moves a failing entry from `providersAuth` into `restoredPending`, or removes an entry from `REACHABILITY_TABLE`.
- Impact: Gate G (designed specifically to prevent the TASK_2026_523 failure where capabilities disappeared while tests stayed green) fails to catch the regression. The guard test passes because `BASELINE_PRESENT_IDS` is dynamically calculated from the arrays, and `expect(byId.get(id)).not.toBe('pending')` evaluates to true when `byId.get(id)` is `undefined`.
- Fix:
  1. Freeze `BASELINE_PRESENT_IDS` as a literal array of 64 string IDs:
     ```ts
     export const BASELINE_PRESENT_IDS: readonly string[] = [
       '#1', '#2', '#3', '#4', '#5', '#6', '#9', '#10', '#11', '#13', '#14', '#15',
       '#16', '#17', '#18', '#19', '#20', '#22', '#23', '#24', '#26', '#29', '#31',
       '#32', '#33', '#35', '#36', '#37', '#39',
       '#42', '#45', '#46', '#48', '#50', '#51', '#52', '#55', '#56', '#57', '#58',
       '#59', '#60', '#61', '#62', '#63', '#64', '#65', '#66', '#67', '#68', '#69',
       '#72', '#73', '#74', '#75', '#76', '#77', '#78', '#79',
       '#80', '#81', '#82', '#83', '#84',
     ];
     ```
  2. In `settings-reachability.e2e.spec.ts`, assert that each baseline ID exists and has status `'present'` or `'restored'`:
     ```ts
     test('every baseline id is still present or restored, never pending (D14 rule 3)', () => {
       const byId = new Map(REACHABILITY_TABLE.map((entry) => [entry.id, entry.status]));
       for (const id of BASELINE_PRESENT_IDS) {
         const status = byId.get(id);
         expect(status, `${id} is missing from table`).toBeDefined();
         expect(['present', 'restored'], `${id} regressed to ${status}`).toContain(status);
       }
     });
     ```

### 2. Hollow / Fallback Reach Assertions Across 14 Present Capabilities
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:275-494`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts#L275-L494)
- Scenario: The reach steps for 14 present capabilities do not verify the capability's actual interactive control.
  - Entry `#13` (:275): Codex auth-file status checks only `wizard-step-heading`.
  - Entry `#19` (:314): Save & Test verify states uses `[data-testid="wizard-verify-start"], [data-testid="wizard-api-key"]`; matches `wizard-api-key`.
  - Entry `#20` (:318): 401 diagnostics copy uses `[data-testid="wizard-credential-error"], [data-testid="wizard-api-key"]`; matches `wizard-api-key`.
  - Entry `#26` (:341): Custom provider test asserts `wizard-custom-name` or `wizard-continue`, identical to #24.
  - Entry `#29` (:348): Custom provider tier mapping asserts `wizard-continue` on step 1.
  - Entries `#32`, `#33`, `#36` (:363, 367, 379): Tier mapping inside wizard asserts `wizard-continue` on step 1.
  - Entry `#37` (:383): Resolved model/mapping checks only `#providers-main-heading`.
  - Entry `#39` (:387): Model list refresh checks global `Refresh settings` button.
  - Entry `#56` (:429): Success/error commit feedback checks only `#providers-cli-heading`.
  - Entry `#77` (:473): "No CLI agents found" install help checks only `System CLIs` heading.
  - Entry `#79` (:478): Loading and error states checks only `Agent Orchestration` tab text.
  - Entry `#83` (:493): Tab deep linking manually navigates tabs and checks `#providers-main-heading`.
- Impact: A regression breaking any of these 14 capabilities will pass Gate G unnoticed, directly violating the reachability gate contract (implementation-plan.md:801-803).
- Fix:
  - For `#19` and `#20`: Remove the `, [data-testid="wizard-api-key"]` fallback. If `#19` requires advancing to verify, click Continue to reach the verify step. If `#20` requires an error state, drive an invalid key probe or check the specific error container.
  - For `#29`, `#32`, `#33`, `#36`: Advance past the credential step (using the verified fixture probe) to reach and assert the actual Models step (`[data-testid="wizard-step-models"]`, tier pickers).
  - For `#37`: Assert the actual rendered resolved model badge or route indicator (`[data-testid="status-badge"]` or text node displaying the active model), not `#providers-main-heading`.
  - For `#56`, `#77`, `#79`: Target the feedback/alert or install help container rather than the section headings `#providers-cli-heading` or `System CLIs`.
  - For `#83`: Inject `{ type: 'switchView', payload: { view: 'settings', tab: 'orchestration' } }` via bridge and assert the Orchestration tab activates automatically.

---

## Serious issues

### 3. Write Resolvers Are Stateless and Do Not Record Calls or Mutate Read State
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:364-376`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts#L364-L376)
- Scenario: `agent:setConfig`, `auth:saveSettings`, `ptahCli:create`, `ptahCli:update`, and `ptahCli:delete` return static `{ success: true }`.
- Impact: Violates the explicit requirement in `batches.md:803` and `implementation-plan.md:788` ("Every write resolver records its call and mutates the read-back state, following the stateful-resolver precedent `marketplace.fixtures.ts:969-982`"). Downstream tests in Batches 17-36 cannot assert write payloads or verify read-back consistency.
- Fix: In `baseSettingsFixtures()`, create local mutable copies of `AGENT_CONFIG_FIXTURE`, `AUTH_STATUS_FIXTURE`, and `PTAH_CLI_LIST_FIXTURE`. Update the write handlers to mutate these copies and record call arguments in an exported array or map.

### 4. Monolithic Single-Session Test Execution Lacks Fault Isolation
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts:46-65`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L46-L65)
- Scenario: 64 capabilities run in a single test under one 180s timeout. If any reach step leaves a modal, dropdown, or form open due to a failure, subsequent tests fail as collateral damage.
- Impact: Debugging failures becomes difficult due to cascading false positives, and Playwright reports the entire 64-capability suite as a single pass/fail test item.
- Fix: Add a resilient post-step cleanup hook (e.g. in the `catch` block or step boundary) that closes any stray modals by clicking `[data-testid="wizard-cancel"]` or pressing `Escape`, and re-navigates to the appropriate tab root if needed.

---

## Moderate and minor issues

### 5. `storedAuthMethodScope` Discrepancy with `prototypes/BRIEF.md`
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:213`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts#L213)
- Detail: `EFFECTIVE_ROUTE_FIXTURE.storedAuthMethodScope` is set to `'global'`, whereas `prototypes/BRIEF.md:48-49` specifies that the provider is from `App · Desktop`. Fix: change to `'app'`.

### 6. No Guard Ensuring Both Execution Hosts Run
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts:44`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts#L44)
- Detail: The test loop iterates over `['vscode', 'electron']`. If a future modification accidentally comments out or removes `'electron'`, the suite passes with only one host. Fix: add a guard asserting `['vscode', 'electron']` are both executed.

### 7. Missing Stubs for Upcoming New RPCs
- File: [`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:336-383`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts#L336-L383)
- Detail: New RPCs declared in plan Component 2a (`auth:deleteStoredKey`, `auth:copilotLogout`, `provider:removeCustomEntry`) are not yet present in `baseSettingsFixtures`. While currently pending, adding default success responders now prevents premature breakage when Batches 17-25 flip those entries to restored.

---

## Data flow

1. `bootSettings(page, url, host)`:
   - Injects CSP stub and postMessage bridge -> OK
   - Calls `installHost(page, host, 'chat')` and `installRpcAutoResponder` -> OK
   - Sets `localStorage['ptah-theme']` -> OK
   - Injects `switchView` payload `{ view: 'settings' }` -> OK
   - Waits for `[data-testid="settings-back"]` -> OK
2. Guard suite:
   - Asserts table length === 81 -> OK
   - Asserts baseline IDs present/restored -> **DEFECT (FM-1)**: passes on undefined; baseline IDs dynamically computed.
   - Asserts ID uniqueness -> OK
3. Reachability loop:
   - Iterates through 64 present entries sequentially -> OK
   - Executes helper (`throughCatalog`, `throughCard`, `openThenClose`) -> OK
   - Assertions executed -> **DEFECT (FM-2)**: 14 entries assert headings, continue buttons, or comma fallback selectors.
4. Kept selectors suite:
   - Asserts `settings-back`, `provider-connection-card`, `#providers-connections-heading`, `assignments-heading` -> OK
   - Navigates through 4 tabs by exact name -> OK
   - Asserts "Export settings" and `settings-toggle-web-search-provider` -> OK
5. Visual smoke suite (`settings-visual.e2e.spec.ts`):
   - Boots 1024x768 in vscode/electron × anubis/anubis-light -> OK
   - Writes `baseline-*` PNGs to `.ptah/specs/TASK_2026_555/screenshots/angular/` -> OK

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 81 capability entries in table (82 minus #21 dropped) | COMPLETE | Correctly counts 64 present + 17 pending = 81 entries. |
| 64 present entries assert real user paths | PARTIAL | 14 entries rely on hollow heading-only, continue-button, or comma fallback checks. |
| Regression guard stops silent weakening | MISSING | Baseline IDs are dynamic and undefined passes the status check. |
| 17 pending entries structured for restoring batches | COMPLETE | Use `notYetBuilt` thrower; cannot be flipped without providing a reach implementation. |
| Realistic fixtures matching `prototypes/BRIEF.md` | PARTIAL | Reference data is accurate (excluding D11 quota), but write resolvers are stateless stubs. |
| Hollow `provider-settings.e2e.spec.ts` deleted | COMPLETE | Deleted file asserted fake `settings:update` and swallowed errors with `count()`. |
| Kept selectors verified | COMPLETE | All 7 kept selector families asserted in `settings-reachability.e2e.spec.ts:67-85`. |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Capability deleted from table | NO | `EXPECTED_CAPABILITY_COUNT` checks length, but replacing with a dummy ID goes undetected | `byId.get(deletedId)` returns `undefined` which passes `.not.toBe('pending')` |
| Capability flipped present -> pending | NO | Moving from `providersAuth` to `restoredPending` removes it from `BASELINE_PRESENT_IDS` | The baseline list is not frozen as literal strings |
| Wizard discard review on cancel | YES | `closeWizard()` awaits `wizard-discard-confirm` with 2s timeout | If cancel button itself is missing, throws unhandled |
| Catalog disclosure already open | YES | `openCatalogDisclosure()` inspects `details.open` before clicking | Cleanly handled |
| Disabled "Move up" on top agent | YES | Entry `#73` targets "Move down" on the first row | Cleanly handled |
| Key prefix hint visibility | YES | Entry `#9` types `wrong-prefix-key` before asserting hint | Cleanly handled |

---

## Deleted spec verification: `provider-settings.e2e.spec.ts`

The deletion of `provider-settings.e2e.spec.ts` is fully justified and correct:
1. Fake RPC method: Lines 40-54 and 75-88 filtered for outbound `settings:update`, an RPC that does not exist in the Ptah codebase (real settings RPC is `auth:saveSettings` / `agent:setConfig`).
2. Hollow assertions: Lines 46-52 and 60-66 wrapped interactions in `if (await locator.count())` and `.catch(() => undefined)`, followed by `expect(Array.isArray(out)).toBe(true)` — an assertion that passed unconditionally even when zero elements existed and zero RPCs fired.
3. Server error test: Injected `settings:update:error` and asserted `expect(webviewPage).toHaveURL(/127\.0\.0\.1/)`, which asserted only that the page did not navigate away.

---

## Verdict

- Recommendation: NEEDS_REVISION
- Confidence: HIGH
- Top risk: Gate G is intended to be the permanent safety ratchet protecting against regressions across 23 upcoming batches, but in its current state it allows capabilities to be silently demoted or deleted while 14 present capabilities pass unconditionally on heading checks.
- What a robust implementation would add:
  1. Literal, hardcoded array of 64 `BASELINE_PRESENT_IDS` in `settings-reachability.table.ts`.
  2. Strict assertion in `settings-reachability.e2e.spec.ts`: `expect(['present', 'restored']).toContain(byId.get(id))`.
  3. Replace the 14 weak reach steps (especially `#19`, `#20`, `#29`, `#32`, `#33`, `#36`, `#37`, `#56`, `#77`, `#79`) with assertions on the capability's actual interactive controls or contents.
  4. Implement stateful write resolvers in `settings.fixtures.ts` that record calls and mutate read-back fixture state.
