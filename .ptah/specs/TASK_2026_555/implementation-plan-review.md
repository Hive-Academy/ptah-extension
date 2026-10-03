# Implementation Plan Review — `TASK_2026_555`

## Round 2 (revision of `implementation-plan.md`, 2026-09-29)

Re-review scope: (a) each round-1 finding against the revised plan; (b) new problems introduced by the revision — the re-sequenced S5/S6 batches, the every-batch reachability test, and the `runCommit` "Not saved"/"Not confirmed" states. Read-only; no source modified.

### Verdict

| Metric | Value |
| --- | --- |
| Verdict | **REVISE** (NEEDS_REVISION) — narrow: one record-keeping fix plus two S5 amendments |
| Round-1 findings | 10 of 10 FIXED (plus the round-1 note on the logging channel: FIXED) |
| New problems found | 1 Serious, 2 Moderate, 1 Minor |

The revision is high quality. Every round-1 finding is fixed at the plan line cited below, and the two big new mechanisms are sound: the D14 interim-container re-sequencing genuinely closes the unmount window, and the reachability gate is enforceable and well-guarded (entry-per-capability with real click-through `reach` functions, a frozen count guard, a no-present-to-pending rule, move-edits-`reach`-in-same-commit, kept-selector check, run in both hosts at the end of every batch from S4). D15 is consistent everywhere it appears (D15 at plan:165, Component 5 at plan:349-358, §5 at plan:948, the toast mapping at plan:528), and the three D15 spec cases at plan:363-366 cover exactly the failure round 1 found. REVISE is driven by one Serious provenance defect in "## Resolved decisions" and two under-specified spots in the new S5 interim batch.

### (a) Round-1 findings — status

| # | Round-1 finding | Status | Plan line(s) |
| --- | --- | --- | --- |
| 1 | Serious — S5 unmounts the Ptah CLI instance UI before its replacement exists | **FIXED** | D14 at plan:164; interim container at plan:555-564 (S5 mounts old AOC + assignments + `PtahCliConfigComponent` unchanged on Orchestration; S6 deletes `PtahCliConfigComponent` in the same batch as the matrix); sequencing rows plan:1096-1097; reachability gate plan:782-805; §6 rule 6 plan:1077-1080 |
| 2 | Moderate — `migrateAgentOrchestrationSettings` spec had no owner | **FIXED** | plan:204-206 (spec owned by S1b with the named case); S1b test row plan:1119 |
| 3 | Moderate — S1a verify command missed the 553 blast radius | **FIXED** | S1a command now includes `vscode-core`, `platform-vscode`, `platform-electron`, `platform-cli` (plan:1118); caller-spec updates plan:223-225; close-out `run-many` plan:1238-1239 |
| 4 | Moderate — 551/553 `fix-report.md` deliverables unowned | **FIXED** | 553 report created in S1a (plan:226-228); 551 report in S1b, UI half appended in S2a (plan:359, plan:1119, plan:1121); S7 verifies both (plan:1098, plan:1242) |
| 5 | Moderate — scope badge had no visible field name | **FIXED** | D16 at plan:165; Component 12 badge text "Effort · Workspace", popover header, `data-testid="scope-badge"`, `data-field`, `shortFieldName` input (plan:598-606); automated assertion (plan:1038-1039) |
| 6 | Moderate — Electron secrets delete was an unverified assumption | **FIXED** | S1c's first checklist item with its own spec (plan:1120); Electron implementation joins S1c's MODIFY list only if the check fails (plan:1224) |
| 7 | Moderate — `settings-tour.scene.ts` unchecked | **FIXED** | Kept-selector check inside the reachability spec, run every batch (plan:798-803); S7 owns the tour run and its repair (plan:806-807, plan:811-815, plan:1098) |
| 8 | Moderate — `runCommit` could report "Saved" after a failed write | **FIXED** | D15 at plan:165; Component 5 rules (plan:349-358): `false`/`'conflict'` → `unsaved` with read-back skipped, throw → `unconfirmed` with read-back skipped, read-back only after an acknowledged `true`; three D15 specs (plan:363-366); §5 row (plan:948); toast mapping (plan:528); changed 534 assertions listed in the S2a report (plan:357-358) |
| 9 | Minor — docs-shot ownership split S4/S7 | **FIXED** | S4 makes no docs-shot or tour edits (plan:1095); S7 updates and re-runs both after the selector freeze (plan:806-807, plan:1098) |
| 10 | Minor — D11 quota evidence not independently verified | **FIXED (mitigated)** | S4 re-confirms `agent-process.types.ts:282-313` in its report (plan:1095). This review still did not verify the file; the S4 re-confirmation is the acceptable control |
| (note) | Logging channel for `SettingsPersistError` unnamed | **FIXED** | Keep `console.warn`, reason stated (plan:181-182) |

### (b) New problems introduced by the revision

#### N1. "## Resolved decisions" claims user approvals that no document records

- **Severity:** Serious
- **Plan location:** plan:1153-1163 — "The user answered on 2026-09-29 (`task.md` '## Decisions', last bullet). All four recommended defaults were chosen", including R4 "Approved: colour on icons, dots and badges… Deviations 3-5 accepted".
- **Evidence:** `task.md` "## Decisions" last bullet (task.md:76-80) records deviations #1/#2 REJECTED and #3/#4/#5 as "proposed as technically required; shown to the user with the spec summary" — it contains **no** user answers to R1-R3 and never mentions deviation 6. `design-spec.md:571` (and :247) explicitly marks deviation 6 as "pending user sign-off". The plan is also internally inconsistent: §6's human pass line reads "No `text-primary`/`text-error` text (deviation 6, until the user rules otherwise)" (plan:1060), which treats deviation 6 as not yet ruled on, while R4 says it is approved.
- **Impact:** D5 (tier-modal semantics), D6 (session-end confirm copy), D12 (search scope) and D13 (colour deviation) are built on approvals whose only cited source does not contain them. A spec presented as user-approved when the record shows "proposed" or "pending sign-off" is the exact #575/#523 failure class this task's Gate 1.7 discipline exists to prevent.
- **Fix:** Before decomposition, either record the R1-R4 answers (with their date and channel) in `task.md` "## Decisions", or correct the plan's citation and mark any unanswered item as pending. Reconcile plan:1060 with R4 so one of them states the truth about deviation 6.

#### N2. The S5 `cli-agents` routing row targets a control that does not exist until S6

- **Severity:** Moderate
- **Plan location:** plan:509 (`cli-agents` → "Focus the CLI matrix"); plan:514 (Component 10 verification: "one case per routing-table row"); plan:1096 (S5 carries "Components 10 (all routing rows)"); plan:1127 (S6 test row also lists "shell routing rows").
- **Evidence:** The `cli-matrix` testid is created by `CliOrchestrationMatrixComponent` in Component 13 (plan:700-701), which lands in S6. After S5, Orchestration shows the interim container (old AOC, assignments, `PtahCliConfigComponent` — plan:556-559); no matrix exists. Plan:562 correctly claims the background-role rows resolve in S5, but the `cli-agents` row is not covered by that claim.
- **Impact:** Component 10's S5 verification requirement ("one case per routing-table row") is unsatisfiable as written for the `cli-agents` row, and it is ambiguous whether that case belongs to S5 or S6 (both test rows mention shell routing). An S5 executor either fails the gate or deviates from the plan.
- **Fix:** State the S5 interim focus target for the `cli-agents` row (for example, the CLI section heading in the interim container), and assign the final-target case ("focus the `cli-matrix`") to S6 — the same re-pointing pattern the reachability table already uses (plan:797).

#### N3. The interim `OrchestrationSettingsComponent` is not specified to call `state.open()`

- **Severity:** Moderate
- **Plan location:** plan:558-559 (the interim container "renders the old AOC, `ProviderConsumerAssignmentsComponent` and `PtahCliConfigComponent`, and provides the loader" — no state opening); plan:682 (the final form "calls `state.open()` (a user can land here first)").
- **Evidence:** The plan's own final-form requirement (plan:682) establishes that landing on Orchestration first does not open the providers state today. The interim container mounts state-dependent components (`ProviderConsumerAssignmentsComponent` reads providers-state sections), so in the S5→S6 window a user who lands on Orchestration first gets a tab that never loads. The reachability gate will not catch this: its `reach` functions boot the settings view (default tab) and then click through, so the state is already open when they arrive at Orchestration.
- **Impact:** A silently empty/loading Orchestration tab for direct landings during the S5→S6 window — the same "partially wired" class the interim container was created to prevent.
- **Fix:** One sentence in Component 12: the interim container calls `state.open()` (and forwards `focusTarget` exactly as the final form does, plan:682-683).

#### N4. Wording mismatch: "roles popover" vs the roles `<details>`

- **Severity:** Minor
- **Plan location:** plan:1127 (S6 test row: "deep-link `judge` opens the roles popover") vs plan:508 ("Open the roles `<details>`") and plan:684 (`<details data-testid="background-roles-details">` wrapping `ProviderConsumerAssignmentsComponent`).
- **Fix:** Make the S6 harness row name the `<details>` testid, so the spec and the component cannot diverge.

### Notes on the new mechanisms (no defect)

- The reachability gate (plan:782-805) is enforceable: `reach` performs the user's clicks and asserts visibility plus enablement; the count guard, the frozen baseline and the no-present-to-pending rule close the piecemeal-lane failure mode from the #523 forensics; the sequencing footer (plan:1100-1106) correctly covers batches that commit before S4 exist.
- D15's "Not saved" (`unsaved`) / "Not confirmed" (`unconfirmed`) states are used consistently: field-name lists in commit state, statuses stay `partial`/`failed`/`unconfirmed`/`blocked`, and the toast maps them at plan:528. The S2a change to any TASK_2026_534 assertion is required to be listed in the S2a report (plan:357-358) — the right honesty rule.
- The S5/S6 split of `settings-visual.e2e.spec.ts` (Providers half in S5, Orchestration half in S6, plan:1126-1127) correctly avoids demanding §1.2 fold assertions before the matrix exists.

### Round-2 verdict

**REVISE** — narrow. Fix N1 (record or correct the user-approval provenance; reconcile plan:1060 with R4), N2 (interim `cli-agents` focus target and spec-case ownership) and N3 (interim `state.open()`). N4 is a wording fix. None of these require redesign; all are plan edits of a few lines. Once N1's record exists, the plan is ready for team-leader decomposition.

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: implementation proceeds on decisions (D5/D6/D12/D13) whose user approval no document records.

---

## Round 1 (superseded by Round 2 above)

Review target: `implementation-plan.md` (1140 lines at revision 1), checked against `design-spec.md`, `task.md` "## Decisions", `parity-inventory.md`, the folded tasks `TASK_2026_551..554/task.md`, the `TASK_2026_523` forensics (`investigation/forensics-523-vs-shipped.md`), and the code the plan cites. Read-only review; no source file was modified.

### Verdict

| Metric | Value |
| --- | --- |
| Verdict | **REVISE** (NEEDS_REVISION) |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 7 |
| Minor issues | 2 |
| Verified plan claims | 16 of 16 held; 0 false code claims found |

The plan is unusually well-evidenced: every code claim sampled (16 of the "Verified" markers, all priority items) matched the real code, all 17 restored capabilities plus RUX-1..13 have an implementing file and a named test, the write-path table is correct in every sampled row, and the parallel batches are file-disjoint as stated. REVISE is driven by one Serious sequencing defect (the S5→S6 window unmounts the Ptah CLI instance UI before its replacement exists) and a set of Moderate ownership/verification gaps that the team-leader cannot invent while writing `batches.md`. All fixes are plan edits measured in lines, not redesigns.

---

### Check 1 — "Verified" code claims (16 sampled, all held)

| # | Plan claim | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Spawn-reader defect: writers use `setConfiguration('ptah', 'agentOrchestration.<dotted>')`, readers use `getConfiguration('ptah.agentOrchestration', '<bare>')` | `agent-rpc.handlers.ts:1023-1056` (writer form); `agent-spawn-environment.service.ts:118-179` (`resolveReasoningEffort`/`resolveAutoApprove`/`resolveModel` all read the `'ptah.agentOrchestration'` section form) | HELD — D8's premise is exact |
| 2 | Sibling reads show the correct form | `agent-spawn-environment.service.ts:224-256` — `maxConcurrentAgents` and `preferredCli` read `('ptah', 'agentOrchestration.<dotted>')` | HELD |
| 3 | File-routed keys include `authMethod`, `anthropicProviderId`, all `agentOrchestration.<cli>Model/ReasoningEffort/AutoApprove` and `disabledClis`; `maxConcurrentAgents`/`preferredAgentOrder` are NOT file-routed | `file-settings-keys.ts:154-199` | HELD — §3 table's storage column is correct for both the file rows and the VS Code config rows |
| 4 | File routing happens only for `section === 'ptah' && isFileBasedSettingKey(key)` | `vscode-workspace-provider.ts:75-120` (route test at :80-82, file write path :100-109, VS Code `ConfigurationTarget.Global` :111-113) | HELD — confirms the wrong-section read never reaches the file store |
| 5 | `auth:saveSettings` ends every running session via an unconditional `sdkAdapter.reset()` | `auth-rpc.handlers.ts:920-1019`; reset at :1001-1003; `sdk-agent-adapter.ts:546-568` — `dispose()` → `sessionLifecycle.disposeAllSessions()` | HELD — D6 justified |
| 6 | Empty key string deletes the credential; slots are `ptah.auth.anthropicApiKey` and `ptah.auth.provider.<id>` | `auth-rpc.handlers.ts:961-969`; `auth-secrets.service.ts:122-147, 192-196, 219-229, 256-257, 279-283, 300-309` | HELD — `auth:deleteStoredKey` (D4) is implementable on existing slots |
| 7 | `config:clearScopeOverride` resets sessions only for `authMethod`/`anthropicProviderId`/`provider.*` keys | `config-scope-rpc.handlers.ts:120-145` — auth-key test :120-123, `sdkAdapter.reset()` in `finally` :139-145 | HELD |
| 8 | `runCommit` silently drops a save while another is in flight; RPC errors are swallowed; `refresh()` always runs | `providers-settings-state.service.ts:1000-1110` — `if (status === 'saving') return` at :1022, `void error` at :1058-1061, `refresh()` at :1083 | HELD |
| 9 | `PtahFileSettingsManager.set()` optimistically mutates in memory, `persist()` swallows write failures with `console.warn` | `file-settings-manager.ts:90-120` (value set at :98, chained persist :99-102), `:475-510` (catch logs only, :497-502) | HELD — 553 and Component 1 premises exact |
| 10 | `ptahCli:update` shallow-merges, so a partial `tierMappings` replaces the whole object; effective tiers cascade instance > provider `cliAgent` > `defaultTiers` > static | `ptah-cli-registry.ts:330-385` (spread merge :353-357), `:1595-1655` (cascade :1604-1648) | HELD — D5's "always send the full object" is required, not optional |
| 11 | `provider:setModelTier` params carry no per-instance identifier, so the design-spec §2.2 tier-modal RPC path is not implementable per instance | `rpc-providers.types.ts:103-118` — `ProviderSetModelTierParams` = `tier`, `modelId`, `providerId?`, `scope` only | HELD — Correction 2 confirmed; note the design spec §2.4 row still describes the unimplementable path and must not be followed by an implementer |
| 12 | Cursor credential: env var wins; `detect()` reports installed only when a key resolves | `cursor-cli.adapter.ts:183-243` — env precedence :188-191, resolver failure logs fixed text only :195-200, `installed: false` without key :208-223; `agent-rpc.handlers.ts:1050-1056` (`isCursorApiKeyConfigured` = env OR `hasProviderKey('cursor')`) | HELD — the plan's "Credentials action on the Uninstalled row" and 551's read-back gap are both real |
| 13 | `NativeCardComponent` already supports whole-card click with nested-interactive suppression and an `activated` state | `native-card.component.ts:90-250` — selector :100-101, `clickable` :156, `activated` :178, nested-ignore :214-218 | HELD |
| 14 | Old shell: `viewChild` on the AOC, `applyPendingTab` provider/section routing, `onModelChanged()` no-ops when the AOC is unmounted (#84) | `settings.component.ts:80-250` — `viewChild` :89-91, `isElectron` :115, `applyPendingTab` :143-149, `onModelChanged` :222-224 | HELD — #84 root cause and Component 10's `state.redetectClis()` fix are well-founded |
| 15 | `useAppBuild` worker-scoped option exists and serves the real bundle | `test-fixtures.ts:42, 61-74` — option at :62, `startFixtureServer({ appBuild: useAppBuild })` at :66 | HELD — the visual-gate `useAppBuild: true` precedent is real |
| 16 | `provider-settings.e2e.spec.ts` is hollow | `provider-settings.e2e.spec.ts:36-61` — every action wrapped in `.catch(() => undefined)`, assertions only check `Array.isArray(out)`; also :63-89 the "blank field" test can pass without any input existing | HELD — deleting it (S7) is justified; the marketplace-visual precedent (`scenarios/marketplace/marketplace-visual.e2e.spec.ts`) and `playwright.config.ts` both exist in the harness |

Not re-verified within the sampling ceiling (plan carries its own citations; no contradiction found): `agent-process.types.ts:282-313` (D11's "no quota field on `CliDetectionResult`"), `chat-session.service.ts:526/1230` (effort fallback), the eslint tag lattice `eslint.config.mjs:365-389`, and the `PendingSettingsTab` section-string union at `app-state.service.ts:145-162` (the surrounding contract — `requestSettingsTab`/`openSettingsTab`/`consumePendingSettingsTab` at `app-state.service.ts:1340-1366` — was verified, and lives in `libs/frontend/core` as the plan's 5-lib blast-radius claim requires).

---

### Check 2 — write-path trace (8 rows traced end to end)

| Row | Entry → store → reader → running-session effect | Verdict |
| --- | --- | --- |
| Main Agent provider | popover → `auth:saveSettings` (`auth-rpc.handlers.ts:924-1019`) → `authMethod`+`anthropicProviderId` file keys (:954-999) → spawn/`chat-session` readers → unconditional `sdkAdapter.reset()` (:1001-1003) → `disposeAllSessions` (`sdk-agent-adapter.ts:546-568`) | CORRECT — D6's reset-before-signal is the right fix |
| Matrix system-CLI model | cell → `agent:setConfig` (`agent-rpc.handlers.ts:1023-1056`) → `setConfiguration('ptah', 'agentOrchestration.<cli>Model')` → file store (`vscode-workspace-provider.ts:80-109`, key in `file-settings-keys.ts:162-174`) → reader at `agent-spawn-environment.service.ts:165-179` reads the wrong section form and misses the file store | CORRECT — the row's "dead control today" is real, and D8's sibling form (:224-256) is the proven fix |
| Copilot auto-approve | toggle → `agent:setConfig` → file key (`file-settings-keys.ts:166-168`) → `resolveAutoApprove` (`agent-spawn-environment.service.ts:155-163`) — dead before D8, live after | CORRECT |
| Max concurrent / preferred order | policy bar → `agent:setConfig` → NOT in `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:154-199` has no such entries) → VS Code config Global (`vscode-workspace-provider.ts:111-113`) → sibling readers (:224-256) | CORRECT — the table's storage column is right where it would have been easy to get wrong |
| Scope badge clear | popover → `config:clearScopeOverride` (`config-scope-rpc.handlers.ts:100-171`) → reset only for auth keys (:120-145) | CORRECT — no over-broad session reset |
| Drawer → Delete key | new `auth:deleteStoredKey` → `deleteCredential`/`deleteProviderKey` on confirmed slots (`auth-secrets.service.ts:219-229, 300-309`); no reset by design | CORRECT and implementable |
| Tier mapping modal | modal → `ptahCli:update` with the FULL `tierMappings` object → shallow spread (`ptah-cli-registry.ts:353-357`) → cascade reader (:1604-1648) | CORRECT — D5's full-object requirement matches the merge semantics exactly |
| Cursor credential | credentials tab → `setProviderKey('cursor')` → slot `ptah.auth.provider.cursor` → `resolveCursorApiKey` env-first (`cursor-cli.adapter.ts:188-191`) → `detect()` gates `installed` on a key resolving (:208-223) | CORRECT — and the row honestly inherits 551's known read-back nuance |

No wrong key, wrong scope, wrong reader, or wrong running-session effect was found in any sampled row. The one soft spot is the plan's own flagged assumption: the effort/model fallback for a new chat session (`config:model-switch` row) is marked unverified by the plan itself, which is the correct handling for an unverified claim.

---

### Check 3 — capability and test coverage

All 17 restored capabilities (#7, #8, #12, #25, #27, #28, #30, #34, #38, #43, #44, #47, #49, #53, #54, #70, #71) map to a named implementing component with real file paths, and each has a named proving spec in §7. RUX-1..RUX-13 all appear; RUX-13 ("License/portability, unchanged") correctly has no test because nothing changes. #21 (post-save Reload) is dropped by the user's recorded decision (`task.md` "## Decisions"). The #54 data source (`cliModels[id].tierMappings`) matches the parity inventory's note that STATE already reads `tierMappings` today. Coverage: COMPLETE.

---

### Check 4 — batch sequencing and file disjointness

- S1a / S1b / S1c / S3 / S4 parallel batches are file-disjoint as claimed. The riskiest hidden-shared-file candidate was checked directly: `rpc.types.ts`'s `agent:getConfig` entry references the `AgentOrchestrationConfig` **type** (`rpc.types.ts:1158-1161`), so S1b's field additions in `rpc-agents.types.ts` require no `rpc.types.ts` edit — the S1b/S1c split over the shared types files is genuinely disjoint, not accidentally coupled.
- Registration files are single-owner: `RPC_METHOD_ENTRIES` and the auth handler registration both land in S1c with the new `auth:deleteStoredKey`.
- `settings.component.*` appears in both S5 and S6, which the plan sequences strictly S5 → S6. Disjoint in time, shared in files — the plan acknowledges this. See round-1 Finding 1 for the deeper problem in that pair.
- No batch is missing for Components 1-14; every component maps to S1a..S7. The gaps found are ownership gaps inside assigned steps (round-1 Findings 2, 3, 4, 7).

---

### Check 5 — visual gate enforceability

ENFORCEABLE as written. The tooling exists: `playwright.config.ts` and the settings/marketplace scenario specs are present in `libs/frontend/webview-e2e-harness`; the `useAppBuild` worker option serves the real bundle (`test-fixtures.ts:42, 62-66`); the marketplace-visual spec provides the host+theme matrix precedent. The §6 assertions are measurable (bounding boxes against the 660 px line, card height ≤ 80 px, 3-column grid at 1024, both themes, both hosts) and match the design-spec §1.1/§1.2 budgets. The one hollow artefact in the gate's path is correctly scheduled for deletion (Claim 16). The Electron docs-screenshots command is flagged as an assumption in the plan itself — acceptable as flagged.

---

### Check 6 — boundary lattice and standards

The plan commits to standalone + OnPush + signal inputs/outputs for all new components, no deep imports, and chat→ui-only dependency direction for the picker work; the new `ProviderModelSearchFieldComponent` uses existing `ui` primitives, which keeps `type:ui` tags clean. `agent:getConfig` result typing shows shared-type changes stay type-compatible. Two notes: (a) the new `SettingsPersistError` path in `file-settings-manager.ts` logs "a fixed line" but the plan does not name a channel — platform-core has no injected logger today (`console.warn` at `file-settings-manager.ts:497-502`), so the plan should state whether the new error keeps `console.warn` or adopts the repo's logger token; (b) I did not re-verify the `eslint.config.mjs:365-389` tag lattice within the call ceiling — low risk, cited with lines.

---

### Check 7 — TASK_2026_523 repetition risks

The plan's §6 process rules answer the forensics root causes directly: budgets become automated assertions (lesson 3), components are not built in parallel lanes against stubs and nothing is accepted unmounted (forensics 2.2/2.3), parity and visuals are checked separately (lesson 6), rows are clickable with one primary action (lesson 5), long lists collapse (lesson 7). One root cause is NOT answered: forensics §5 lesson 4 — "Give every strip a visible field name." The plan's `SettingScopeRowComponent` rewrite (badge + popover) never requires the badge or popover to name the field it governs. See round-1 Finding 5.

---

### Numbered findings (round 1)

#### 1. S5→S6 window: the Ptah CLI instance UI is unmounted before its replacement exists

- **Severity:** Serious
- **Plan location:** §5 sequencing, S5 (Components 10, 11, 12) and S6 (Component 13); Component 12 ("The inline background assignments and `<ptah-cli-config>` (:206-211) move to Orchestration").
- **Evidence:** `providers-settings.component.ts` mounts `<ptah-cli-config>` today; S5 removes it from the Providers tab, but the new home (Component 13 matrix, #47 add-instance modal, #53 tier modal) lands only in S6. S5's visual gate covers Providers only; the Orchestration harness scene is scheduled for S6.
- **Impact:** Between the S5 and S6 commits the Ptah CLI instance capability (add/edit/delete/test, delegated model/effort, Cursor key) is unreachable — the exact "capability exists but is unmounted" failure mode this task was opened to repair, and a violation of the plan's own rule that nothing is accepted unmounted. If S6 slips or is interrupted, the branch is mid-regression with a green S5 gate.
- **Fix:** One of: (a) merge S5 and S6 into one batch/commit unit; (b) in S5, temporarily mount `ptah-cli-config` on the Orchestration tab and move it in S6; (c) add to S5's gate an Orchestration smoke scene asserting the CLI instance rows stay reachable. Record the choice in the plan before decomposition.

#### 2. The `migrateAgentOrchestrationSettings` startup spec has no owner batch

- **Severity:** Moderate
- **Plan location:** Component 1 ("Confirm both with specs" for `runCursorApiKeyMigration` and `migrateAgentOrchestrationSettings`); §5 sequencing, S1a and S1b.
- **Evidence:** The migration handler lives in `agent-rpc.handlers.ts:1068+` (S1b's file). S1a (Component 1) runs parallel to S1b, and its file list does not include `rpc-handlers` test files; S1b's scope (Components 2+3) does not include the migration spec.
- **Impact:** A required spec is assigned to no step. Either it is never written, or S1a reaches into rpc-handlers tests while S1b edits the same project in parallel.
- **Fix:** Assign the migration-handler spec explicitly to S1b (it owns `agent-rpc.handlers.ts`), and have S1a's bootstrap specs cover only the bootstrap call sites.

#### 3. S1a's verification command omits the 553 blast-radius projects

- **Severity:** Moderate
- **Plan location:** §5 sequencing, S1a verify command; team-leader handoff close-out command.
- **Evidence:** Component 1's integration points name `vscode-workspace-provider.ts:100-110` (platform-vscode), the Electron workspace provider `:217-226` (platform-electron), the CLI shim `:109-118`, and `config-manager.ts:216-227` (vscode-core) as the callers that must now observe rejections. None of these projects appears in S1a's `nx ... -p` list, and the close-out run-many list also omits them.
- **Impact:** When `PtahFileSettingsManager.set()` starts rejecting, tests in platform-vscode, platform-electron and vscode-core that assume `set` resolves break without being run at the batch gate or at close-out; the first signal becomes CI.
- **Fix:** Add `platform-vscode`, `platform-electron`, and `vscode-core` to S1a's verify command and to the close-out run-many list.

#### 4. The 551 and 553 acceptance deliverables (`fix-report.md` write-path traces) are unowned

- **Severity:** Moderate
- **Plan location:** §5 sequencing, S7 close-out; team-leader handoff deliverables.
- **Evidence:** `TASK_2026_551/task.md` acceptance requires a fix-report.md with a write-path trace; `TASK_2026_553/task.md` acceptance requires the same (value-unchanged, next-set-succeeds evidence). The plan mandates write→reader traces for the new controls but no step produces the 551/553 fix reports.
- **Impact:** The folded tasks close with their acceptance criteria unmet on paper even if the code is correct.
- **Fix:** Add the two fix-report traces to S7's checklist (or fold them into the report document the plan already requires).

#### 5. The scope badge carries no visible field name — the #523 "unlabeled strip" defect can return

- **Severity:** Moderate
- **Plan location:** Component 12, `SettingScopeRowComponent` ("a badge that renders nothing when `!hasOverride()`, plus a popover with the Global/App/Workspace rows").
- **Evidence:** `investigation/forensics-523-vs-shipped.md` §5 lesson 4: "Give every strip a visible field name" — the unlabeled scope strips were a shipped defect of #575.
- **Impact:** If the badge shows only "Workspace" with no field identity, provenance is again invisible and the same user confusion returns in badge form.
- **Fix:** Add a requirement (and a visual-gate assertion) that each badge or its popover names the field it governs.

#### 6. The Electron secret backend for `auth:deleteStoredKey` is an assumption, not a verified fact

- **Severity:** Moderate
- **Plan location:** Component 4, Assumption (EXTENSION_CONTEXT.secrets wiring in `apps/ptah-electron/src/di/`).
- **Evidence:** The plan flags it itself; the VS Code slots are verified (`auth-secrets.service.ts:110-310`) but the Electron wiring was not.
- **Impact:** If the assumption is wrong, Delete silently no-ops or throws on the desktop host after the VS Code host is already shipped behaviour.
- **Fix:** Make the wiring check the first checklist item of S1c, and add the `EXTENSION_CONTEXT.secrets` wiring to S1c's file list if it is missing.

#### 7. `settings-tour.scene.ts` depends on kept selectors but no batch checks it

- **Severity:** Moderate
- **Plan location:** Component 10 (stable selectors kept, citing `settings-tour.scene.ts`); §5 sequencing — no step lists the tour scene in its checks.
- **Evidence:** The tour scene script drives the settings UI by selector; the plan's own deep-link-contract section names it as a dependent consumer.
- **Impact:** Selector churn from the shell rebuild can break the marketing tour with no gate noticing.
- **Fix:** Add a selector-existence assertion (or a tour-scene smoke run) to S5/S6 gates, or assign the scene check to S7 explicitly.

#### 8. `runCommit` read-back after a throw can report "Saved" for a failed write

- **Severity:** Moderate
- **Plan location:** Component 5 (state rework) and the toast+Undo feedback design it feeds.
- **Evidence:** `providers-settings-state.service.ts:1058-1074` — an op that throws still runs its read-back; if the stored value already matches the target (e.g. the value was set earlier and only the latest write failed), the status derives `saved` while a write failed.
- **Impact:** The new "Saved" toast inherits a path where it shows success after a real failure. Pre-existing behaviour, but the plan's feedback work makes it user-visible and does not fix it.
- **Fix:** In the S2 rework, mark a thrown op `failed` and skip its read-back, so read-back only confirms ops that did not throw.

#### 9. Docs-shot ownership is split between S4 and S7

- **Severity:** Minor
- **Plan location:** Component 14 MODIFY list includes `workspace-settings.shot.ts`; §5 sequencing assigns shot updates to S7 while S4 implements Component 14's fixtures.
- **Fix:** State in S4 that docs shots are deferred to S7 and must be re-run there after the selector freeze.

#### 10. D11's quota evidence was not re-verified in this review

- **Severity:** Minor
- **Plan location:** D11 (`agent-process.types.ts:282-313` — no quota field on `CliDetectionResult`).
- **Evidence:** Not re-verified within the call ceiling. The plan's use (drop the quota state, keep "Details") is consistent with the type's purpose, but S4 should confirm the cited lines before the matrix states are finalised.
- **Fix:** Keep the D11 evidence check in S4's checklist.

---

### Residual uncertainty (round 1)

Within the 40-call sampling ceiling I did not verify: `agent-process.types.ts:282-313` (Finding 10), `chat-session.service.ts:526/1230` (effort fallback — flagged by the plan itself), the `PendingSettingsTab` section-string union at `app-state.service.ts:145-162` (surrounding contract verified), and the eslint tag lattice. None of these contradict the plan; all are cited with line numbers by the plan's own text.

### Round-1 verdict

**REVISE.** The architecture, evidence quality, and coverage are sound — 16 of 16 sampled code claims held, the write-path table is correct in every sampled row, and the gates are enforceable. The plan needed Finding 1 resolved (pick one of the three fixes and write it in) and Findings 2-4 assigned to batches before the team-leader writes `batches.md`; Findings 5-8 are plan edits of a few lines each. No blocking issues; nothing requires redesign.

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the S5→S6 window unmounts the Ptah CLI instance UI while the S5 gate is green.
- What a robust plan would add: the four batch-ownership fixes (Findings 1-4), the visible-field-name rule on the scope badge (Finding 5), and the `runCommit` throw/read-back fix (Finding 8).