VERDICT: REVISE
SCORE: 6/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 3)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

The Batch 3 implementation successfully delivers the link layer: `AgentSessionOpenedPayload` shared type, session-children port contracts (`session-spawner.port.ts`, `child-chat-session-host.port.ts`), `SessionChildRegistry`, widening of `AgentReportRouter` for `childSessionId` alongside an exact byte-identical extraction of `reportBody()` for the agent path, `LaneCompletionNotifier` session subject delivery with per-turn deduplication, and cleanly ordered DI registrations. All 95 targeted Jest unit tests pass, and Nx lint and typecheck pass without error.

However, two significant logic defects require revision:

1. An unparsable or malformed `startedAt` timestamp in `LaneCompletionNotifier.signalSessionChild` silently causes `writtenAfterSpawn` to be omitted, which in turn causes `sessionChildVerdictOf` to treat pre-existing checkout files in the git worktree as `delivered`, defeating the Revision-1 mtime guard.
2. In `SessionChildRegistry.isChild(id)`, returning `!record.terminalStatus` allows an ended or resumed child session to bypass the depth guard, violating the strict depth-1 invariant ("children never spawn grandchildren").

## Numbered Defects

1. **[MAJOR] Unparsable `startedAt` turns checkout files into false `delivered` verdicts**
   - File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:390` (and lines 553–555, 136–141)
   - When `subject.startedAt` is unparsable or invalid, `Date.parse(subject.startedAt)` returns `NaN`. `Number.isFinite(startedMs)` evaluates to `false`, causing `checkOne` to omit `writtenAfterSpawn`. In `sessionChildVerdictOf`, `check.writtenAfterSpawn !== false` evaluates to `true` (since `undefined !== false`). Consequently, repository files checked out by git into the fresh worktree (which exist and have size > 0) are incorrectly declared `delivered` rather than `no-deliverable`.

2. **[MAJOR] `isChild` excludes ended records, breaking the depth-1 guard for ended/resumed child sessions**
   - File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:175`
   - `isChild(id)` returns `!!record && !record.terminalStatus`. The moment a child ends or its turn completes and stamps `terminalStatus`, `isChild(id)` returns `false`. If the user or model continues in that tab and invokes `ptah_session_start`, the depth guard (`if (registry.isChild(callerId)) return refusal('depth-exceeded')`) evaluates to `false`, allowing a child tab in a temporary worktree to spawn grandchildren.

3. **[MINOR] Non-strict property presence check in `AgentReportRouter.deliver` can misroute agent reports**
   - File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:255`
   - `if ('childSessionId' in input)` checks property existence on the input object. If an upstream caller passes `{ agentId: '...', childSessionId: undefined, message: '...' }`, `'childSessionId' in input` is `true`. The router routes to `deliverFromSessionChild`, which treats `childSessionId` as empty, fails to find the child in the registry, and refuses a valid agent report as `unattributed-caller`.

4. **[MINOR] Bounded ended history prune drops active tab identity without UI awareness**
   - File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:286-295`
   - `pruneEnded(keep = 20)` unconditionally drops ended child records beyond 20 entries. If a child session tab remains open in the webview while 20 other children run to completion, its record is deleted from memory. Subsequent lookups for that open tab (`ptah_session_status`, `findByCwd`, or late turn settle events) will fail to attribute the session.

---

## Deviation Rulings

### (a) `startedAt` in the notifier session subject is an ISO string parsed with `Date.parse`

- **Ruling: DEFECT (MAJOR)**
- **Analysis**: The plan specifies `startedAt` as the deliverable reference timestamp (stamped after worktree creation). In `LaneCompletionNotifier.signalSessionChild` (`lane-completion-notifier.service.ts:390`), `Date.parse(subject.startedAt)` is passed directly to `checkDeliverables`. When `startedAt` is unparsable or malformed, `Date.parse` produces `NaN`. In `checkOne` (`:553`), `Number.isFinite(startedMs)` is `false`, so `writtenAfterSpawn` is omitted. In `sessionChildVerdictOf` (`:140`), `check.writtenAfterSpawn !== false` is `true`. Thus, an unparsable `startedAt` turns tracked checkout files into `delivered`, completely bypassing the Revision-1 mtime guard.
- **Required Fix**: Validate `startedAt` before checking deliverables. If `!Number.isFinite(startedMs)`, `signalSessionChild` must either refuse with a descriptive error or mark `writtenAfterSpawn: false` for all deliverables so that checkout files cannot be classified as `delivered`.

### (b) `SessionChildRecord` stores `terminalStatus`, and the held completion carries the full envelope text

- **Ruling: ACCEPTABLE**
- **Analysis**: Storing `terminalStatus?: SessionChildTerminalStatus` on `SessionChildRecord` provides an explicit, immutable record of terminal transitions without mutating dynamic status. Storing `SessionChildHeldCompletion` with the full `SessionChildCompletionEnvelope` (`text`, `verdict`, `turn`, `childSessionId`) directly fulfills the requirement for `ISessionSpawner.takeHeldCompletions` in Batch 5, allowing the spawner to render held completions into the "while you were away" block without re-rendering or maintaining redundant state. No invariant is broken.

### (c) Three extra registry methods for Batch 5 (`remove`, `live()`, and field-clearing `update` patch)

- **Ruling: ACCEPTABLE**
- **Analysis**:
  - `remove(childSessionId)`: Removes a child record during start rollback. Slot tracking in `reserveSlot` is computed dynamically as `this.liveCount() + this.reservations.size`. Deleting the record immediately decrements `liveCount()`, safely freeing the slot rather than leaking it. All maps (`records`, `bySdkId`, `endedOrder`) are cleaned up consistently.
  - `live()`: A read-only query returning records where `!r.terminalStatus`. Safe and pure.
  - `update(childSessionId, patch)`: Correctly synchronizes `bySdkId` when `sdkSessionId` is modified, respects type-level omitted immutable fields (`childSessionId`, `parentSessionId`, `startedAt`, `terminalStatus`), and enables clearing optional fields (such as `pendingPermission`) by deleting keys whose patch value is `undefined`.

### (d) `isChild` counts LIVE children only

- **Ruling: DEFECT (MAJOR)**
- **Analysis**: The executor reasoned that an ended child resumed by the user runs as an ordinary interactive session and therefore should not be restricted by the depth guard. However, this directly violates the strict depth-1 rule defined throughout the plan (`implementation-plan.md:868`, `980`, `1022`, `1083`): a session running inside a child worktree must never spawn grandchild sessions. Allowing an ended or resumed child to call `ptah_session_start` allows nested worktrees and uncoordinated subagents to be spawned from temporary worktrees.
- **Required Fix**: `isChild(id)` must return `!!this.get(id)` (or check whether the session is recorded in the registry as a child). A separate query (e.g. `isLiveChild` or checking `live()`) should be used if liveness is specifically needed.

### (e) Byte-identical agent-path refactor (`reportBody()`)

- **Ruling: ACCEPTABLE**
- **Analysis**: The executor refactored the body duplication logic into `reportBody(message, summary)`. Comparing the previous inline implementation in `buildEnvelope` against `reportBody()` proves that the logic is byte-identical: `trimmedSummary = summary?.trim(); summaryAddsInformation = !!trimmedSummary && trimmedSummary !== message.trim(); return summaryAddsInformation ? `${trimmedSummary}\n\n${message}` : message;`. The envelope format, attribute escaping, rate keys (`agentId`), deduplication keys, and `AgentReportRefusalReason` union are completely unchanged. All existing unit tests pass without modification.

---

## Five Logic Questions

### 1. How does this fail silently?

1. In `LaneCompletionNotifier.signalSessionChild` (`lane-completion-notifier.service.ts:390`, `553-555`, `140`), an unparsable `startedAt` string produces `NaN`. `checkOne` leaves `writtenAfterSpawn` `undefined`, and `sessionChildVerdictOf` evaluates `check.writtenAfterSpawn !== false` as `true`. Pre-existing files checked out by git into the worktree are marked `delivered`, giving a false-success verdict when no work was actually written.
2. In `SessionChildRegistry.isChild` (`session-child.registry.ts:175`), an ended child session evaluates to `false` for `isChild`. An agent turn in that child tab calling `ptah_session_start` silently bypasses the depth guard and creates a grandchild session.

### 2. What user action produces unexpected behaviour?

A user continues chatting or issues an instruction in an ended child session tab. If the agent in that tab calls `ptah_session_start`, instead of being rejected with `depth-exceeded`, the system permits the spawn attempt, creating a grandchild branch and secondary worktree inside or alongside the child worktree.

### 3. What input data produces a wrong answer?

1. Passing an input with `childSessionId: undefined` and a valid `agentId: 'xyz'` to `AgentReportRouter.deliver` (`agent-report-router.service.ts:255`). The `'childSessionId' in input` test succeeds, causing the router to misroute to `deliverFromSessionChild` and return `unattributed-caller` instead of delivering the agent report.
2. A non-ISO or corrupted `startedAt` string passed to `signalSessionChild` produces `verdict: 'delivered'` instead of an error or `no-deliverable`.

### 4. What happens when a dependency fails?

- When `IAgentAdapter` is `null` (no chat runtime registered), both `AgentReportRouter` and `LaneCompletionNotifier` cleanly refuse with `'chat-runtime-unavailable'`. The notifier returns the refusal with the rendered envelope so it can be held.
- When `IAgentAdapter.sendMessageToSession` rejects or throws, it is caught and returned as `'delivery-failed'`.
- When `IFileSystemProvider.stat` or `exists` throws, `checkOne` catches the error, logs a warning, and returns `{ path, exists: false }`, ensuring the verdict evaluates to `no-deliverable`.
- When `SessionChildRegistry` is absent, `AgentReportRouter` cleanly returns `unattributed-caller`.

### 5. What is missing that the requirements never mentioned?

Retention pinning for open child tabs in `SessionChildRegistry.pruneEnded`: When more than 20 child sessions end, older records are deleted from memory. If a tab corresponding to an older ended session is still open in the webview, its identity in the registry is lost, causing subsequent queries or late events to fail attribution.

---

## Failure Modes

### Failure Mode 1: False Positive Delivery on Corrupted Timestamp

- **Trigger**: `startedAt` contains an invalid date string or unparsable format.
- **Symptom**: Unmodified checkout files are classified as `delivered` by the child.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:390, 553, 140`
- **Current handling**: Omits `writtenAfterSpawn` when `startedMs` is `NaN`; `sessionChildVerdictOf` treats `undefined !== false` as `true`.
- **Recommendation**: Validate `startedAt` in `signalSessionChild` using `Number.isFinite(Date.parse(subject.startedAt))`; if invalid, treat `writtenAfterSpawn` as `false` for session subjects.

### Failure Mode 2: Grandchild Session Spawn via Ended Child

- **Trigger**: An ended or resumed child session calls `ptah_session_start`.
- **Symptom**: `depth-exceeded` guard is bypassed; grandchild worktrees and sessions are spawned.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:175`
- **Current handling**: `isChild(id)` returns `false` if `terminalStatus` is set.
- **Recommendation**: Change `isChild(id)` to `return !!this.get(id);`.

### Failure Mode 3: Misrouted Agent Report on Undefined `childSessionId` Property

- **Trigger**: Caller invokes `deliver({ agentId: 'a', childSessionId: undefined, message: 'm' })`.
- **Symptom**: Report refused as `unattributed-caller` instead of delivering for `agentId`.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:255`
- **Current handling**: Uses `'childSessionId' in input`.
- **Recommendation**: Check `typeof input.childSessionId === 'string' && input.childSessionId.length > 0`.

---

## Blocking Issues

None.

---

## Serious Issues

### 1. Silent False-Success Verdict for Checkout Files on Invalid `startedAt`

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:390`
- **Scenario**: When `startedAt` is not a valid ISO date, `Date.parse` returns `NaN`. `checkDeliverables` does not set `writtenAfterSpawn`. `sessionChildVerdictOf` considers all non-empty files as `delivered`.
- **Impact**: The orchestrator is informed that work was delivered when in fact only initial git checkout files exist.
- **Fix**: Validate `startedMs` in `signalSessionChild`; ensure that for session subjects, deliverables require `writtenAfterSpawn === true`.

### 2. Depth Guard Bypass for Ended Child Sessions

- **File**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:175`
- **Scenario**: `isChild` checks `!record.terminalStatus`. Once a child ends, `isChild` returns `false`.
- **Impact**: Any resumed child tab can call `ptah_session_start` without triggering `depth-exceeded`, violating the depth-1 architecture.
- **Fix**: Change `isChild(id)` to check `!!record` regardless of terminal status.

---

## Moderate and Minor Issues

1. **Non-defensive discrimination in `deliver`**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:255` — replace `'childSessionId' in input` with `typeof input.childSessionId === 'string' && input.childSessionId.length > 0`.
2. **Unpinned ended record pruning**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:286-295` — consider persisting active UI tab IDs or checking worktree containment before discarding ended records.

---

## Data Flow

1. **Session Child Report Delivery**:
   - Entry: `AgentReportRouter.deliver({ childSessionId, message, summary })` -> OK
   - Registry lookup: `this.sessionChildren?.get(reportedId)` -> OK
   - Payload size check: `message.length > MAX_AGENT_REPORT_LENGTH` -> OK
   - Parent resolution: `child.parentSessionId` / `child.parentSdkSessionId` -> OK
   - Adapter check & liveness check: `isSessionActive` -> OK
   - Inactive parent: `markReportRefused` (counted, summary saved, not queued) -> OK
   - Rate limit & duplicate check: namespaced `session:{childSessionId}` -> OK
   - Message injection: `adapter.sendMessageToSession` with `ptah-session:{childSessionId}` origin -> OK
   - State update: `markReportDelivered(childSessionId)` on success -> OK

2. **Session Child Turn Completion Push**:
   - Entry: `LaneCompletionNotifier.signalSessionChild(subject, settle)` -> OK
   - Dedupe check: `{childSessionId}:turn:{settle.turn}` -> OK
   - Deliverable check: `checkDeliverables` against `startedAt` -> **GAP (Defect 1)**: unparsable timestamp defaults to lane behavior (`delivered` for checkout files)
   - Envelope rendering: `buildSessionChildCompletionEnvelope` -> OK
   - Parent check: If parent inactive, refusal returned WITH built envelope -> OK
   - Delivery: `adapter.sendMessageToSession` -> OK

3. **Session Child Concurrency & Depth**:
   - Entry: `SessionChildRegistry.reserveSlot(max)` -> OK (synchronous, race-safe)
   - Depth check: `SessionChildRegistry.isChild(id)` -> **GAP (Defect 2)**: ended children return `false`, bypassing the depth guard.

---

## Requirements Fulfilment

| Requirement                                        | Status   | Gap                                                        |
| -------------------------------------------------- | -------- | ---------------------------------------------------------- |
| Task 3.1: Shared `AgentSessionOpenedPayload`       | COMPLETE | None. Exactly matches plan.                                |
| Task 3.2: Port contracts                           | COMPLETE | None. Types match plan specifications.                     |
| Task 3.3: `SessionChildRegistry`                   | PARTIAL  | `isChild` excludes ended records, breaking depth guard.    |
| Task 3.4: `AgentReportRouter` child branch         | COMPLETE | Refusal union unchanged; agent path byte-identical.        |
| Task 3.5: `LaneCompletionNotifier` session subject | PARTIAL  | Invalid `startedAt` turns checkout files into `delivered`. |
| Task 3.6: Tokens, registration, barrels            | COMPLETE | Registrations ordered properly; tokens match.              |

Implicit requirements not addressed:

- Safeguarding against unparsable timestamps in session deliverable verification.

---

## Edge Cases

| Case                                     | Handled | How                                                                       | Concern  |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------- | -------- |
| Two concurrent starts with cap=1         | YES     | `reserveSlot` is synchronous and checks `liveCount() + reservations.size` | None     |
| Re-binding child SDK id                  | YES     | `bindSdkSessionId` drops old SDK id mapping                               | None     |
| Trailing slash / casing in worktree CWD  | YES     | `pathKey` normalizes casing on Windows and removes trailing slashes       | None     |
| Parent inactive when report arrives      | YES     | Refused with `parent-session-not-active`, counted, last summary saved     | None     |
| Parent inactive when completion arrives  | YES     | Returns refusal with built envelope for holding                           | None     |
| Deliverable mtime == `startedAt`         | YES     | `stat.mtime >= startedMs` treats it as written                            | None     |
| Unparsable `startedAt`                   | NO      | Treated as absent flag -> checkout files become `delivered`               | Defect 1 |
| Ended child calling `ptah_session_start` | NO      | `isChild` returns `false` -> depth guard bypassed                         | Defect 2 |

---

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Ended child sessions could spawn grandchild sessions from within temporary worktrees due to `isChild` excluding ended records, and checkout files could falsely pass verification if `startedAt` parsing fails.
- What a robust implementation would add:
  1. Fix `isChild(id)` in `SessionChildRegistry` to return `!!this.get(id)`.
  2. In `LaneCompletionNotifier`, validate `Date.parse(subject.startedAt)` and ensure missing/unparsable timestamps do not grant false `delivered` verdicts to git checkout files.
  3. Narrow `'childSessionId' in input` to check string type and presence.
