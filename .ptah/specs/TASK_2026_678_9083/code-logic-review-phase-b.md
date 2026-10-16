# Code Logic Review — `TASK_2026_678_9083` Phase B

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 6 |
| Moderate issues | 7 |
| Failure modes found | 8 |
| Reviewer family | grok |
| Implementer family | codex (B5, B6, B6A, B7, B8) |

Phase B’s paid-spawn gate does not send the literal `Confirm`, and it does not start a launch turn from an auto-resolved question. That is why this is not a 1–3: the dangerous direction (a spawn without an explicit confirm) is closed on the paths that exist in this code. It is not a 5–6 either. Resume can report a restored session that was never restored, a confirmed proposal is burned before registration succeeds, and a Council, Forge, or Race run is projected as a group with no lanes and no stage. Those are the paths Amendment A1, AC15, AC16, and AC25 actually care about. Batch 8F already owns the manifest contract (TL-1, TL-2, TL-3); the serious items below are not in that batch’s task text.

Tests, typecheck, and lint were accepted from the orchestrator’s Batch 8 record. This review did not re-run them. `ptah_get_diagnostics` is not available in this lane, and the task forbids `nx`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| TL-1, TL-2, and TL-3 stay Moderate | (a) Serious, because a real `writeRunManifest` makes Council launches fail; (b) Moderate, because Batch 8F already names the fix | `batches.md` Decision D13 and Tasks 8F.1–8F.3. No production transport calls the coordinator until Batch 13/14. | yes |
| Missing status ages stay Moderate | (a) Serious against AC13; (b) Moderate, because AC13 requires projected state and the plan’s age map has no producer yet | AC13 text is state, not ages. Plan line 32 and `status-context.ts:4` require ages. `CommandWorkNode` (`command-center.store.ts:28-34`) has no timestamp. | yes |
| No Blocking verdict | (a) Blocking on silent post-confirm failure; (b) Serious, because that path withholds the launch | `confirm()` never calls `sendLaunchTurn` after a failed answer, failed discovery, null `createTask`, or failed manifest write (`tribunal-run-coordinator.ts:41-64`). Host timeout still selects Decline first (plan line 31). | yes |

## Five logic questions

### 1. How does this fail silently?

`confirm()` deletes the pending proposal and marks the id consumed before the discovery answer is known to have stuck (`tribunal-run-coordinator.ts:39-40`). A later `discoveryComplete` rejection, a null `createTask`, a `writeManifest` false, or a `sendLaunchTurn` false returns `false` from the `catch` or the early returns (`:48-64`) and writes nothing the user can see. The coordinator has no toast and no store. The proposal cannot be confirmed again (`:38`).

A failed `switchSession` calls `fail()` (`session-coordinator.ts:82-85`). The marked tab and the active-tab record are already written (`:74-75`, `tab-manager.service.ts:1002-1003`). The next `openOrResume` takes the existing-tab branch and sets session status to `running` (`session-coordinator.ts:61-65`) without retrying the restore.

`sessionExists` treats a successful `session:list` whose `sessions` array is missing as “no such session” (`:97-98`, `?? false`) and `openOrResume` then starts a new Command Center (`:73`, `:88`).

### 2. What user action produces unexpected behaviour?

Explicit Confirm on a Council, Forge, or Race card, once `writeManifest` is the real records service: the lane role is `''` (`tribunal-run-coordinator.ts:54`) and the schema requires a non-empty role (`command-center-records.ts:18`), so the write returns false, the launch is withheld, and the proposal is already consumed. Batch 8F.2 owns the schema half of this.

New Command Center while voice is on: `newCommandCenter()` releases the send lock and does not change `voiceState` (`session-coordinator.ts:116-120`). The store can still say `listening` while `isHeld` is false, so regular chat can send into the new root. That is AC25.

Resume when some other open tab already has that SDK id: the coordinator creates and attaches a new marked tab (`:74-75`) and then calls `switchSession` with no target tab (`:78`). The loader may switch to the older live tab and return (`session-loader.service.ts:860-868`) or bind history through `openSessionTab` (`:952-954`), which keeps the first tab that already has that id (`tab-manager.service.ts:900-909`). The store still records the new tab id.

A second delivery of the same `proposalId` while the first question is still pending replaces the pending question id (`tribunal-run-coordinator.ts:28`) and does not answer the first question.

### 3. What input data produces a wrong answer?

Persisted children carry no state. The projector labels every one of them `completed` (`work-projection.ts:27`). A child that is still running and is not yet in the live `children` list is reported completed.

Council, Forge, and Race derive `{ kind: 'none' }` (`tribunal-phase-derivation.ts:51-53`, `NO_PROGRESS` at `tribunal-ui.types.ts:194`). The projector adds phase nodes only for `relay` and `crucible` (`work-projection.ts:46-50`) and never reads `phase.laneBindings`. The group node has no lanes and no stage. The root node is always `running` (`work-projection.ts:20`).

`buildStatusContext` prints `unknown` when the age map has no entry (`status-context.ts:12`). The only production provider calls it with the node list alone (`session-coordinator.ts:28`).

A roster whose first option is Decline, whose nonce and root match, and whose lanes are launchable is accepted even when a lane’s CLI is in `disabledClis`. Nothing in `rankAvailableLanes` or `parseRosterProposal` takes that list (`tribunal-roster-proposal.ts:27-32`, `:67`). An AT LIMIT lane is rejected only when the caller passes `availableLanes`.

### 4. What happens when a dependency fails?

`session:list` is retried three times, five seconds apart, read-only, and then returns null (`session-coordinator.ts:91-107`). Writes and sends are not inside that loop. A thrown list call does not create a tab (`:69-71`). A success payload with no `sessions` array does, as in question 1.

`answer()` false on the fixed discovery text is followed by `answer(..., 'Decline')` on the same function (`tribunal-run-coordinator.ts:41-43`). The second return value is ignored. If the transport is what failed, Decline is not delivered either, and `pageExit` will not try again because the id is already consumed.

`switchSession` rejection is caught and surfaced as a safe toast (`session-coordinator.ts:82-85`). The retry path then hides that failure (question 1). `chat:abort` failure is surfaced (`:149-153`). `send` failure is surfaced (`:162-173`). Tribunal confirm failure is not.

`localStorage` failure in the records service returns false (`command-center-records.ts:69-74`). Tab create, close, and SDK bind surface that through `commandCenterRecordWriteFailure` (`tab-manager.service.ts:1007-1019`). The tribunal coordinator, once wired to `writeRunManifest`, only sees `false` and returns `false`.

### 5. What is missing that the requirements never mentioned?

The coordinator cannot tell “the user denied” from “registration failed after the model was told a launch turn is coming”. Both end as `false` or a Decline, and only the deny path is described as a concise explanation (plan line 31). AC21’s retry of an identified action has no handle: the proposal id is consumed.

There is no provisional node for a spawn that happens during discovery. The coordinator never registers one (that part is right). The projection has no unregistered-run shape, so a live child of the root shows up as ordinary owned work.

`src/index.ts` exports the store and the session coordinator only (`index.ts:1-2`). Batch 13 cannot inject `TribunalRunCoordinator` through the public entry until some batch adds the export. That is a wiring gap, not a behaviour bug in the class.

## Failure modes

### Confirm burns the proposal, then the launch is dropped

- Trigger: Confirm, then `discoveryComplete` rejects, `createTask` returns null, `writeManifest` returns false, or `sendLaunchTurn` returns false.
- Symptom: The caller gets `false`. No toast. A second Confirm is a no-op. For a Council roster the manifest write is the common false, because `role: ''` fails the schema, until Batch 8F.2.
- Evidence: `tribunal-run-coordinator.ts:39-64`, `command-center-records.ts:18`, `tribunal-run-coordinator.spec.ts:14` (the spec stubs `writeManifest` to true).
- Current handling: Launch is withheld. The discovery answer has already been sent when the failure is after line 41.
- Recommendation: Keep the proposal pending until the launch turn is accepted. On failure, answer Decline if the fixed text was not delivered, roll back a manifest written for a launch that did not send, and surface one safe error the page can show. Do not treat a stubbed `writeManifest` as proof the records schema accepts the payload.

### Same proposal id replaces an open question

- Trigger: `receive()` twice with the same `proposalId` before decline, timeout, or confirm.
- Symptom: The first `AskUserQuestion` is never answered by the page. The card now tracks the second question. Confirm answers only the second.
- Evidence: `tribunal-run-coordinator.ts:24-28`. Consumed ids are declined (`:24-26`). Pending ids are overwritten.
- Current handling: The host’s five-minute first-option auto-resolve is the only Decline for the orphaned question.
- Recommendation: If the id is already pending, answer Decline for the new question (or for the old one) and keep a single question id. A replay must be a no-op, which Task 8.3 requires.

### Resume retry looks restored

- Trigger: `switchSession` throws after `createCommandCenterTab` and `attachSession`. The user opens the page again.
- Symptom: Status becomes `running`. History is not loaded. No second tab is created.
- Evidence: `session-coordinator.ts:73-85` then `:61-65`. `createCommandCenterTab` persists the active tab id at `tab-manager.service.ts:1002-1003`.
- Current handling: The first failure toasts. The retry takes the “tab already marked” branch and never calls `switchSession` again.
- Recommendation: Reuse the tab, but do not mark it running until `switchSession` resolves. A tab whose SDK id is attached and whose restore did not finish must retry the restore.

### Resume can bind the SDK id to two tabs

- Trigger: Last-session resume while another tab in the workspace already has that SDK id and `hasLiveSession`.
- Symptom: A new marked tab is attached to that id, then the loader switches to the older tab and returns without loading history into the marked tab. The store still points at the new tab.
- Evidence: `session-coordinator.ts:73-78` (no `targetTabId`, no `activate`). `session-loader.service.ts:860-868` and `:952-954`. `tab-manager.service.ts:900-909`.
- Current handling: On the empty path, `openSessionTab` reuses the tab just created, and the first later send is `chat:continue` with the persona (`message-sender.service.ts:358-362`, `:713-721`). That happy path is correct and is history-only at `chat:resume` (`session-loader.service.ts:995-1008` adds `systemPrompt` and `activate` only when `activate === true`, which this caller does not pass).
- Recommendation: Pass `targetTabId` of the marked tab. If `findTabBySessionId` returns a different tab, adopt that tab or refuse, and do not `attachSession` a second copy.

### Disabled CLIs and omitted capacity lists pass the gate

- Trigger: A proposal includes a CLI the user disabled, or the page calls `parseRosterProposal` without `availableLanes`.
- Symptom: The roster is shown and, on Confirm, launched. AT LIMIT is filtered only when the list is present (`tribunal-roster-proposal.ts:67`). `rankAvailableLanes` drops `AT LIMIT` and sorts `preferredAgentOrder` (`:27-32`) and has no `disabledClis` argument. The persona text tells the model to honor both (`command-center-persona.ts:7`); the parser does not.
- Current handling: `rosterIsLaunchableLocally` checks shape, relay self-review, and crucible family (`tribunal-roster-proposal.ts:36-50`). That part matches `tribunal-roster-rules.ts:62-72` and `:102-110` (`normalizeModel` is `lane.model ?? ''` at `tribunal-roster-rules.ts:124-125`).
- Recommendation: Require the available-lane list at `receive()`, and reject a lane whose CLI is disabled. Re-check capacity at confirm time.

### New Command Center drops the lock and leaves voice “on”

- Trigger: `newCommandCenter()` while `voiceState` is `listening`.
- Symptom: Lock is cleared (`session-coordinator.ts:116`, `:138-140`). `voiceState` stays `listening` (`:117-120` never sets it). `CommandCenterSendLockService.isHeld` is false, so regular chat sends are not held (`message-sender.service.ts:100-102`).
- Current handling: Mute, stop, and `DestroyRef` do release the lock (`session-coordinator.ts:31`, `:132-146`). Stop also calls `chat:abort` when an SDK id exists (`:142-154`).
- Recommendation: Stop voice (state and lock together) or re-engage the lock on the new tab inside the same method. AC25 is “while voice mode is active”.

### Flat Tribunal moves have no lanes or stage

- Trigger: `projectOwnedWork` with a council, forge, or race `OwnedRun`, including one whose `laneBindings.lanes` is populated.
- Symptom: One `tribunal:<runId>` node. No lane nodes. No phase node. `derivePhase` returns `kind: 'none'` for those moves.
- Evidence: `work-projection.ts:41-50`, `tribunal-phase-derivation.ts:51-53`. The spec only asserts the group ids (`work-projection.spec.ts:14-20`).
- Current handling: Relay roles and one Crucible round node are emitted. Agents parent under the group only when `agent.runId` matches (`work-projection.ts:52-56`).
- Recommendation: Project each bound lane under the group for every move, and a stage node for `none` / `unavailable` so AC15 is visible when artifacts are missing.

### Manifest contract (already in Batch 8F)

- Trigger: Two runs under one root; a Council lane with no role; confirmed close of a marked tab.
- Symptom: The second run replaces the first (`command-center-records.ts:111`). The role-less manifest never persists (`:18`, coordinator `:54`). Close never calls `removeRunManifest` (no such call under `tab-manager.service.ts`; close only clears the active tab id at `:1378-1379` and the send lock at `:1403-1404`).
- Current handling: Batch 8F.1–8F.3, Decision D13. Confirmed, not refuted. Not expanded beyond those three.
- Recommendation: Land 8F as written. Do not treat this review as a second owner for the same three edits.

## Check table

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Amendment A1 gate | Fail | Fixed text is exact (`tribunal-run-coordinator.ts:5`) and is what `confirm` sends (`:41`). Decline is sent for parse failure, consumed ids, deny, timeout, and page exit (`:24-26`, `:32-34`, `:68-73`). Launch is after `discoveryComplete` and `writeManifest` (`:46-61`). Nothing in `libs/frontend/command-center/src` references `ASK_USER_QUESTION_AUTO_RESOLVED`; launch exists only inside `confirm`. A discovery spawn is not registered because this class never observes spawns. Fails: pending duplicate overwrite (`:28`); post-answer failures return false with the id consumed and no signal (`:39-64`); Decline retry is the same `answer` (`:41-43`); `disabledClis` absent and AT LIMIT optional (`tribunal-roster-proposal.ts:27-32`, `:67`). |
| 2 | Manifest contract (TL-1, TL-2, TL-3) | Fail | Confirmed. `runs` keyed and replaced by `rootTabId` (`command-center-records.ts:29`, `:59-63`, `:104`, `:111`, `:117`). Schema `role: nonEmpty` (`:18`) vs `role: item.role ?? ''` (`tribunal-run-coordinator.ts:54`). No `removeRunManifest` on close. Owned by Batch 8F. |
| 3 | Session coordinator | Fail | Happy-path resume does not create a second tab when the new tab is the only holder of the SDK id (`tab-manager.service.ts:902-909`), and the first send is `chat:continue` plus persona (`message-sender.service.ts:713-721`), not an activated `chat:resume`. Dedupe shares one promise and the derived `.catch` only swallows the floating chain (`session-coordinator.ts:38-47`). `session:list` is three read-only attempts (`:91-107`). Lock engages on `startVoice` and releases on mute, stop, and destroy (`:31`, `:124-146`). Fails: restore retry reports `running` (`:61-65`); `switchSession` has no target tab (`:78`); `newCommandCenter` drops the lock and leaves voice state (`:116-120`). |
| 4 | Status context (R7 / AC13) | Fail | Block is ids, states, and an age token, capped at 2048 (`status-context.ts:4-17`). Ids outside the allowlist become `[redacted]` (`:7`). No labels, providers, or error strings. Only `sendStatusTurn` prepends it (`session-coordinator.ts:177-179`); `send` does not (`:157-161`). AC13’s projected state is present. Plan line 32’s ages are not: the default provider passes no map (`:28`), so every age is `unknown` (`status-context.ts:12`). |
| 5 | Meter sampling | Fail | Leading-edge 500 ms drop is implemented and specified (`command-center.store.ts:145-147`, spec `:96-105`). `setMuted(true)` zeros input only (`:136-138`). `stop()` does not touch levels (`session-coordinator.ts:142-147`). A final `updateLevels(0, 0)` inside the window is discarded, so Batch 10 cannot clear a stale output by calling `updateLevels`. Nothing in Phase B branches on the level values. |
| 6 | Deferred L2, L3, L4 | Pass | L2: first `chat:start` copies `commandCenterPersonaFor` into `options.systemPrompt` (`message-sender.service.ts:455-473`). L3: `clearForRoot` runs only after a confirmed close (`tab-manager.service.ts:1364-1366` returns on cancel, `:1374` returns when the tab left the active list, `:1403-1404` clears). L4: failed writes warn with record kind and workspace only and set the signal; success clears it (`:1007-1019`), on create (`:1002`), confirmed close (`:1378`), and SDK bind (`:1964-1967`). |
| 7 | Work projection | Fail | Stable id prefixes (`work-projection.ts:19`, `:36`, `:43`, `:47`, `:49`, `:55`). Descendants walk (`:29-35`). Provisional tab id and SDK id collapse through `aliases` and the id map (`:22-23`, `:36`, `:58`). Siblings and unparented agents are skipped (`:33`, `:53`). Terminal states are copied, not dropped (`:39`, `:56`). Tribunal runs are grouped (`:41-44`). Fails AC15 for council, forge, and race (no lanes, no stage) and reports persisted-only children as `completed` (`:27`). |
| 8 | Batch 7 behaviour | Pass | `tribunal-run.service.ts` now calls `buildTribunalFraming` (`:6`, `:86-93`) instead of an in-file copy. The phase-b diff for that file is a move of the framing constants plus that call. `tribunal-progress.service.ts:227-247` still derives council/forge/race without a folder read and relay/crucible from artifacts. `phase.ts` exports framing, `derivePhase`, and their types only. Residual: this review did not re-execute the tribunal-panel specs. |
| 9 | Boundaries (R8) | Pass | No `MESSAGE_HANDLERS` provider and no message-listener registration under `libs/frontend/command-center/src`. Host calls go through `ClaudeRpcService.call` (`session-coordinator.ts:96`, `:150`). No import of `@ptah-extension/command-center` under `libs/frontend/chat` or `libs/frontend/tribunal-panel`. Command Center imports `@ptah-extension/tribunal-panel/phase` (`work-projection.ts:1`, `tribunal-run-coordinator.ts:1`). |
| 10 | Degradation-audit markers | Pass | Markers sit where `check-degradation.ts` consumes them: Zone 1 above the `.catch` call (`session-coordinator.ts:42-45`, audit `:560-563`) and Zone 2 inside the catch blocks (`session-coordinator.ts:83`, `:171`; `tribunal-roster-proposal.ts:60`; `tribunal-run-coordinator.ts:63`; audit `:508-513`). The `sessionExists` catch (`session-coordinator.ts:100-102`) contains a comment, so it is not an empty catch, and it does not return a literal. The audit binary was not run (Decision D12; workspace-wide). |

## Blocking issues

None. No path in this phase sends a launch turn without `confirm()`, and `confirm()` sends `CONFIRMED_DISCOVERY_ANSWER`, never `"Confirm"`. Deny, timeout, page exit, a rejected parse, and a consumed id send `Decline` or send nothing. That does not clear the serious gaps below.

## Serious issues

### S1 — Confirm consumes the proposal before the launch exists

- File: `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:39-64`
- Scenario: The card calls `confirm`. The fixed discovery text is handed to `answer`. Discovery then fails, `tasks:create` returns null, the manifest write returns false (including every Council, Forge, and Race write against today’s schema), or the launch send returns false.
- Impact: The user confirmed a paid run. No launch is sent, which is the safe half. They get no explanation, and the proposal id will never launch. The Decline retry (`:41-43`) uses the transport that just returned false and ignores that second result. A1’s “non-delivery answers Decline” is not met when `answer` cannot deliver.
- Fix: Move `consumed` to after a successful launch. If the fixed text was not delivered, answer Decline and keep the id retryable only when no answer was delivered. Surface `false` through the store toast. Add a coordinator spec that runs the manifest through `manifestSchema` for a role-less Council lane (Batch 8F.2 already asks for this).

### S2 — A still-pending duplicate proposal id drops the first question

- File: `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:24-28`
- Scenario: The model emits the same `proposalId` again before the user acts.
- Impact: The first question stays open until the host auto-declines. Confirm answers whichever question arrived last, which may not be the card the user is looking at. Task 8.3 says a replayed proposal is a no-op.
- Fix: If `pending` already has the id, do not replace it; Decline the duplicate delivery.

### S3 — A failed restore is reported as a running session on retry

- File: `libs/frontend/command-center/src/lib/model/session-coordinator.ts:61-65` and `:73-85`
- Scenario: `chat.switchSession` throws. The user triggers `openOrResume` again.
- Impact: The marked tab is reused, which is required, and then marked `running` without a successful restore. AC16 resume looks successful. The transcript may be empty until some later send happens to `chat:continue`.
- Fix: Remember that this tab’s SDK attach has not finished restoring, and call `switchSession` again with that tab id. Set `running` only after it resolves.

### S4 — Resume does not pin the marked tab, so one SDK id can sit on two tabs

- File: `libs/frontend/command-center/src/lib/model/session-coordinator.ts:73-78`; `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:860-868` and `:952-954`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:900-909`
- Scenario: The last-session id is already open on a live tab. Command Center resume creates another marked tab and attaches the same id.
- Impact: The loader returns the older tab when that tab `hasLiveSession`. The Command Center store follows the new tab. Two tabs share one SDK session. The fresh-tab path does not do this, because `openSessionTab` finds the tab just attached.
- Fix: Call `switchSession(id, { targetTabId })` for the marked tab only. If another tab already owns the id, switch to that tab and mark it, or stop before `attachSession`.

### S5 — Saved `disabledClis` are not enforced, and AT LIMIT is optional

- File: `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts:27-32` and `:67`
- Scenario: The model proposes a disabled CLI, or the future page omits `availableLanes`.
- Impact: Confirm can launch a lane the user turned off, or an AT LIMIT lane, after an explicit click. The host spawn refusal is the only remaining backstop (plan line 31). Preferred-family sort is implemented. One-per-family is left to the model, which matches the discovery prompt.
- Fix: Make `availableLanes` required at `receive`, and pass `disabledClis` into both the ranker and the parser. Reject before the card renders.

### S6 — New Command Center unlocks sends while voice still looks active

- File: `libs/frontend/command-center/src/lib/model/session-coordinator.ts:110-120`
- Scenario: Voice is listening. The user starts a new Command Center session.
- Impact: AC25’s single writer is gone until something calls `startVoice` again. The store still shows the old voice state. Batch 13.4 only emits the intent; it does not own this method.
- Fix: In `newCommandCenter`, set voice to `stopped` or `idle` when releasing, or engage the lock on the new tab with the same owner token.

## Moderate and minor issues

### M1 — Second run under one root replaces the first (TL-1)

- File: `libs/frontend/chat-state/src/lib/command-center-records.ts:29`, `:104`, `:111`, `:117`
- Owned by Batch 8F.1. A restart can show only the latest run.

### M2 — Role-less lanes cannot be stored (TL-2)

- File: `command-center-records.ts:18`; `tribunal-run-coordinator.ts:54`
- Owned by Batch 8F.2. This is also the usual reason S1’s `writeManifest` is false for Council, Forge, and Race.

### M3 — Confirmed close does not remove the run manifest (TL-3)

- File: `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1370-1405` (no `removeRunManifest`)
- Owned by Batch 8F.3. Cancel (`:1364-1366`) and a tab that left the active list during confirm (`:1374`) correctly skip the close. They also skip manifest removal, which 8F.3 says to keep.

### M4 — Every status age is `unknown`

- File: `session-coordinator.ts:28`; `status-context.ts:4` and `:12`; `command-center.store.ts:28-34`
- AC13’s states are in the block. Plan line 32’s ages have no source. No later batch is tasked with filling the map. Truncation reserves 30 characters for the omission line (`status-context.ts:13-16`), which holds for any plausible node count.

### M5 — A trailing meter zero inside 500 ms is dropped

- File: `command-center.store.ts:136-150`; `session-coordinator.ts:142-147`
- Batch 10.2 must push a final zero on stop, mute, and idle. Phase B does not read levels to decide sends or locks. Mute already zeros input. Output stays at the last accepted sample, and `updateLevels(0, 0)` during the window does not clear it. Fix the sampler so a zero is applied, or zero both levels in `mute` and `stop`.

### M6 — Persisted-only descendants are reported completed

- File: `work-projection.ts:27`
- After restart, before a live descriptor arrives, a still-running child is `completed`. Live rows win when `childBySession` has the id (`:24`, `:27`).

### M7 — A success-shaped `session:list` with no `sessions` array starts a new session

- File: `session-coordinator.ts:97-98` and `:88`
- A thrown or `success: false` result becomes null after three tries and does not create a tab (`:69-71`, `:91-107`). A success object missing `sessions` becomes false and falls through to `newCommandCenter()`, which replaces the active-tab pointer.

### Minor

- `libs/frontend/command-center/src/index.ts:1-2` does not export the roster gate, the projector, or the status builder. Batch 14’s export task names the page component only.
- No `TODO`, `PLACEHOLDER`, `STUB`, empty body, or mock standing in for production logic was found in the non-spec model files. Specs do stub `writeManifest` to true, which hides M2.

## Data flow

1. `openOrResume` dedupes on one promise. OK.
2. Existing marked tab: switch, store `running`, return. Gap: this treats a tab whose restore threw as restored (S3).
3. Last session: `session:list` up to three times. OK for a hard failure. Gap: missing `sessions` starts a new session (M7).
4. Create marked tab, `attachSession`, `switchSession(sdkId)` with no target and no `activate`. Happy path reuses that tab and stays history-only. Gap: another live tab with the same id splits the binding (S4). First user send then uses `chat:continue` and the persona. OK on the happy path.
5. `startVoice` engages the lock; mute, stop, and destroy release it. OK. `newCommandCenter` releases it and leaves voice state. Gap (S6).
6. `send` does not prepend status context. `sendStatusTurn` does. OK. Ages are `unknown` (M4).
7. Roster parse. Decline-first, nonce, root, shape, relay/crucible rules. OK. Disabled CLIs and a missing capacity list. Gap (S5).
8. `receive` stores a shallow copy. OK against card mutation of the returned object (`lanes.map`). Gap: same id while pending overwrites the question (S2).
9. `confirm` sends the fixed text, waits for discovery, re-checks launchability, creates a task for relay/crucible, writes the manifest, then sends one launch turn. Order matches A1. Gap: consumption and silence on every failure after the answer (S1), and the manifest key/role/close gaps (M1–M3).
10. `projectOwnedWork` builds the tree and `setProjection` filters to descendants of the root id the caller passes. OK if the caller passes `root:<sdkId>`. Gap: flat moves and persisted state (S7, M6).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| A1 fixed non-answer text | COMPLETE | `tribunal-run-coordinator.ts:5`, `:41` |
| A1 Decline on deny, timeout, exit, bad proposal | PARTIAL | Those methods decline. Non-delivery may not, because the retry shares the failed transport (S1). |
| A1 one launch after discovery and registration | PARTIAL | Order is right. The launch is dropped, and the id burned, when registration fails (S1, M2). |
| A1 replay is a no-op | PARTIAL | True only after the id is consumed (S2). |
| AT LIMIT and saved preferences | PARTIAL | AT LIMIT and `preferredAgentOrder` only. `disabledClis` missing (S5). |
| AC11 owned work only | PARTIAL | Siblings excluded. Persisted rows forced to `completed` (M6). Root forced to `running`. |
| AC13 status to the session | PARTIAL | State block on the status turn only. Ages always `unknown` (M4). |
| AC14 terminal states kept | COMPLETE | States are copied through. |
| AC15 Tribunal group, lanes, stage | PARTIAL | Group id only for council, forge, and race (S7). |
| AC16 resume same identity | PARTIAL | Fresh resume reuses one tab. Failed restore and a pre-existing tab do not (S3, S4). |
| AC22 pending question | MISSING in this phase | `answerQuestion` forwards to `ChatStore` with the marked tab id (`session-coordinator.ts:187-189`). Speech, the card, and awaiting-input marks are Batch 10 and Batch 13. |
| AC25 one writer while voice is on | PARTIAL | Lock works for start, mute, stop, destroy. New session clears it early (S6). |
| L2 persona on first `chat:start` | COMPLETE | `message-sender.service.ts:455-473` |
| L3 lock cleared on confirmed close only | COMPLETE | `tab-manager.service.ts:1364-1404` |
| L4 record-write signal | COMPLETE | `tab-manager.service.ts:1007-1019` and the three call sites |
| R8 no handler or surface claim | COMPLETE | Check 9 |

Implicit requirements not addressed: a user-visible reason and a retry when confirm fails after the discovery answer; a provisional unregistered discovery spawn; status ages; pinning resume to the marked tab.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Second confirm, same id | YES | `consumed` set | Also blocks a retry after a failed launch |
| Replay after consume | YES | `receive` answers Decline | |
| Replay while pending | NO | Map overwrite | S2 |
| Page exit during an in-flight `confirm` | NO | Pending entry already deleted | Decline is not sent again |
| Concurrent `openOrResume` on one coordinator | YES | Shared promise | Two coordinator instances are not deduped; the page is one instance (Batch 14) |
| Cancelled close | YES | Returns before `clearForRoot` | Lock stays, which matches “voice still active” |
| Workspace park during the close dialog | YES | `:1374` returns | Lock and manifest stay |
| Empty workspace | YES | Fail toast, null | |
| Meter burst | YES | 500 ms leading edge | Trailing zero dropped (M5) |
| Discovery spawn | PARTIAL | Not written into a manifest | Shown as a normal child if the caller passes it |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the cited paths; MEDIUM for `session:list` abort honoring, because `ClaudeRpcService.call`’s signal handling was not read line by line
- Top risk: a user can confirm a Council run, the discovery turn is closed with “launch instructions follow”, and no launch is sent and no error is shown
- What a robust implementation would add: the S1–S6 fixes in Batch 8F alongside TL-1–TL-3, a real `manifestSchema` assertion in the coordinator spec, and `switchSession` targeted at the marked tab

Verdict: NEEDS_REVISION
