# Code Logic Review — `TASK_2026_586_2b3e`

## Batch 1

- **Batch**: Batch 1 — Event id and newest-first, backend contract
- **Author**: backend-developer (in-process sub-agent)
- **Reviewer**: antigravity CLI lane (code-logic-reviewer role)
- **Verdict**: NEEDS_REVISION
- **Score**: 6/10

---

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 2              |

**Score justification (Band 5–6: works with real gaps)**:
- *Evidence separating from Band 7–8 (sound)*: Dual wire-mapping logic across `skill-synthesis.service.ts` and `skills-synthesis-rpc.handlers.ts` produces divergent payloads for identical events. Specifically, `toEventWire` in `SkillSynthesisService` folds `candidateId` and `reason` into `stats`, whereas the snapshot RPC handler in `skills-synthesis-rpc.handlers.ts` copies `stats: e.stats` only. This directly violates the contract promised in the doc comment of `SkillSynthesisEventWire.id` (`libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:55-57`) and causes data loss on the frontend outcome cell when snapshots refresh.
- *Evidence separating from Band 3–4 (significant problems)*: The core monotonic ULID assignment via `monotonicFactory()`, `recentEvents()` newest-first reversal with non-mutating copy, ring buffer eviction past 200 items, and removal of unsafe casts are well-designed, mathematically monotonic across timestamp regressions, and thoroughly verified by 52 passing unit tests in `skill-synthesis.service.spec.ts` and 246 passing unit tests in `skills-synthesis-rpc.handlers.spec.ts`.

---

## Rulings Required

### 1. Ruling on R14 (Live push vs snapshot wire mapping divergence)
- **Rule**: **Batch 1 must use one mapper before commit (the handler reuses the service's wire mapping).**
- **Reasoning**:
  1. **Contract Inconsistency**: In `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:55-57`, Task 1.1 introduced an explicit contract specification stating that the event identity is:
     > "...identical in the live `SKILL_SYNTHESIS_EVENT` push and in the diagnostics snapshot, so a consumer can dedupe and track rows by it."
     If the live push populates `stats: { reason: 'prefilterTooThin' }` while the snapshot returns `stats: undefined` for the exact same event ULID, the contract's promise is violated at the wire boundary.
  2. **User-Visible UI Degradation**: In `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts:100`, the outcome column for non-error events calls `summarizeStats(ev.stats)`. For an `ineligible` event arriving live, the table displays `reason=prefilterTooThin`. When a 30s poll or user-initiated "Refresh" calls `skillSynthesis:diagnostics`, the snapshot row replaces or matches the event, losing the `reason` and causing the UI outcome cell to flip to `—`.
  3. **Preventing Cross-Layer Tech Debt in Batch 2**: Batch 2 is assigned to `frontend-developer` scoped strictly to `libs/frontend/skill-synthesis-ui` (4 files, 1 lib). If R14 is deferred to Batch 2, the frontend developer would either be forced to write defensive deduplication workarounds (e.g., merging properties across duplicate IDs or preserving live event stats over snapshot stats) or violate Batch 2's boundary by editing backend RPC handlers.
  4. **Low Cost to Fix in Batch 1**: Exporting a single mapping helper (e.g. `toSkillSynthesisEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire`) from `libs/backend/skill-synthesis` and consuming it in `skills-synthesis-rpc.handlers.ts:716` takes less than 15 lines of code and eliminates the dual mapper at its source.

### 2. Ruling on `ulidSeedTime` (Helper ordering safety)
- **Ruling**: **CONFIRMED SOUND.** `ulidSeedTime` combined with `monotonicFactory()` can never produce an id that sorts out of recording order.
- **Analysis**:
  - `ulidSeedTime` (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:200-206`) returns `timestamp` if `Number.isInteger(timestamp) && timestamp > 0 && timestamp <= ULID_MAX_TIME`, and `undefined` otherwise.
  - In `node_modules/ulid/dist/node/index.cjs:257-266`, `monotonicFactory`:
    ```javascript
    const seed = !seedTime || isNaN(seedTime) ? Date.now() : seedTime;
    if (seed <= lastTime) {
        const incrementedRandom = (lastRandom = incrementBase32(lastRandom));
        return encodeTime(lastTime, TIME_LEN) + incrementedRandom;
    }
    lastTime = seed;
    const newRandom = (lastRandom = encodeRandom(RANDOM_LEN, currentPRNG));
    return encodeTime(seed, TIME_LEN) + newRandom;
    ```
    - When `seed > lastTime`: The time prefix `encodeTime(seed, 10)` is strictly greater lexicographically than `encodeTime(lastTime, 10)` because Crockford Base32 encoding preserves standard integer magnitude over fixed 10-character width.
    - When `seed <= lastTime` (clock skew, events in the same millisecond, or backward timestamps): `monotonicFactory` reuses `lastTime` and increments `lastRandom` via `incrementBase32`. The resulting string is strictly greater than the preceding string.
    - When `ulidSeedTime` returns `undefined` (negative, zero, NaN, or non-integer timestamp): `monotonicFactory` falls back to `Date.now()`. If `Date.now() <= lastTime`, it increments the Base32 random suffix; if `Date.now() > lastTime`, the time prefix advances.
    - Therefore, every successive call to `this.nextEventId(...)` generates a ULID strictly greater than all prior ULIDs in recording order.

### 3. Ruling on dropping `as SkillSynthesisEvent` on curator `onEvent` sink
- **Ruling**: **CONFIRMED TYPE-SAFE.**
- **Analysis**:
  - `SkillCuratorStartOptions.onEvent` (`libs/backend/skill-synthesis/src/lib/skill-curator.service.ts:135-139`) emits:
    ```typescript
    event: {
      kind: 'curator-pass-start' | 'curator-pass';
      timestamp: number;
      stats?: Record<string, number | string | boolean | null>;
    }
    ```
  - `pushEvent` accepts `SkillSynthesisEventInput = Omit<SkillSynthesisEvent, 'id'>` (`libs/backend/skill-synthesis/src/lib/diagnostics.types.ts:181`).
  - `SkillSynthesisEventKind` includes `'curator-pass-start'` and `'curator-pass'`.
  - `Record<string, number | string | boolean | null>` is a valid subtype of `Record<string, unknown>`.
  - `id` is omitted from `SkillSynthesisEventInput`.
  - The emitted curator event satisfies `SkillSynthesisEventInput` structurally without casting. Dropping `as SkillSynthesisEvent` is completely type-safe and removes a previously unnecessary type assertion.

### 4. Ruling on TODO/PLACEHOLDER/STUB markers
- **Ruling**: **CONFIRMED CLEAN.** Grep inspection across all modified files revealed zero `TODO`, `FIXME`, `PLACEHOLDER`, or `STUB` markers. Method bodies contain actual implementations rather than mock returns.

---

## Five logic questions

### 1. How does this fail silently?
1. **Divergent snapshot stats (`skills-synthesis-rpc.handlers.ts:716-723`)**:
   When an event is serialized via `skills-synthesis-rpc.handlers.ts`, `e.candidateId` and `e.reason` are dropped, whereas `toEventWire` in `skill-synthesis.service.ts:1056` folds them into `stats`. The snapshot RPC call succeeds without errors, but client state receives stripped metadata.
2. **Unobservable fallback on invalid timestamp (`skill-synthesis.service.ts:200-206`)**:
   If an event is pushed with an invalid timestamp (e.g. `NaN`, float, or negative), `ulidSeedTime` returns `undefined`, which silently substitutes `Date.now()`. No warning or log entry is produced to notify developers of the malformed input timestamp.
3. **Webview broadcast failure suppression (`skill-synthesis.service.ts:1041-1046`)**:
   If `webviewManager.broadcastMessage` throws an error during `pushEvent`, the error is caught and logged only at `debug` level. In a live desktop session, live feed updates stop arriving, but no warning is visible in standard extension logs.

### 2. What user action produces unexpected behaviour?
1. **Refreshing or switching tabs in the Thoth UI**:
   If a user observes an `ineligible` event in the activity feed immediately after a run, the live push renders `reason=prefilterTooThin` in the outcome column. When the user switches tabs or waits for the 30-second poll (`applySnapshot`), the snapshot mapping replaces the event with `stats: undefined`, causing the reason badge to disappear and display `—`.

### 3. What input data produces a wrong answer?
1. **Sub-millisecond float timestamps in `pushEvent`**:
   If a caller passes a non-integer timestamp (e.g. `1700000000500.25`), `Number.isInteger(timestamp)` evaluates to `false`. Instead of encoding `1700000000500`, `ulidSeedTime` falls back to `Date.now()`. If `Date.now()` is significantly different from the event timestamp, the ULID's time prefix will reflect the current clock rather than the event time.

### 4. What happens when a dependency fails?
1. **`monotonicFactory` random bit exhaustion**:
   If more than $2^{80}$ events were generated within a single millisecond, `incrementBase32` would throw `ULIDError(Base32IncorrectEncoding)`. This is physically impossible under standard Node.js event-loop throughput (~$1.2 \times 10^{24}$ calls/ms).
2. **`diagnostics.getSnapshot` or `store.getStats` throw**:
   Caught cleanly at `skills-synthesis-rpc.handlers.ts:737-742` and wrapped into `RpcUserError('Failed to retrieve skill synthesis diagnostics', 'PERSISTENCE_UNAVAILABLE')`. Tested and verified in `skills-synthesis-rpc.handlers.spec.ts:8`.

### 5. What is missing that the requirements never mentioned?
1. **Single canonical wire mapping function**:
   The requirements specified mapping `id: e.id` in `skills-synthesis-rpc.handlers.ts`, but did not specify unifying the wire serialization between `SkillSynthesisService.pushEvent` and `SkillsSynthesisRpcHandlers.diagnostics`.
2. **Handling of sub-millisecond timestamps**:
   The helper `ulidSeedTime` guards against non-integers, but could floor floating timestamps (`Math.floor(timestamp)`) instead of falling back to `Date.now()`.

---

## Failure modes

### Failure Mode 1: Event Outcome Stripped on Diagnostics Snapshot Refresh
- **Trigger**: An event with `reason` or `candidateId` (such as `kind: 'ineligible'`) is recorded. The webview receives it via live broadcast, and later requests a diagnostics snapshot (mount, tab switch, or 30s poll).
- **Symptom**: The event's outcome in the UI changes from `reason=prefilterTooThin` (or `prefilterRejected`) to `—`.
- **Evidence**:
  - `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1056-1063`:
    ```typescript
    const stats = ev.candidateId || ev.reason
      ? { ...(ev.stats ?? {}), ...(ev.candidateId ? { candidateId: ev.candidateId } : {}), ...(ev.reason ? { reason: ev.reason } : {}) }
      : ev.stats;
    ```
  - `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:716-723`:
    ```typescript
    recentEvents: snapshot.recentEvents.map((e) => ({
      id: e.id,
      kind: e.kind,
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      stats: e.stats, // e.reason and e.candidateId omitted!
      error: e.error,
    }))
    ```
- **Current handling**: Live push folds `candidateId`/`reason` into `stats`; snapshot RPC copies `stats: e.stats` as-is.
- **Recommendation**: Export `toSkillSynthesisEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire` from `skill-synthesis` and call it in `skills-synthesis-rpc.handlers.ts:716`.

### Failure Mode 2: Silent Clock Substitution on Non-Integer Timestamps
- **Trigger**: Caller invokes `pushEvent({ kind: '...', timestamp: performance.now() + offset })` where timestamp is a float.
- **Symptom**: The ULID is seeded with `Date.now()` rather than the event's timestamp.
- **Evidence**: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:200-206`:
  ```typescript
  function ulidSeedTime(timestamp: number): number | undefined {
    return Number.isInteger(timestamp) && timestamp > 0 && timestamp <= ULID_MAX_TIME
      ? timestamp
      : undefined;
  }
  ```
- **Current handling**: Non-integer timestamp returns `undefined`, triggering `monotonicFactory`'s fallback to `Date.now()`.
- **Recommendation**: Use `Math.floor(timestamp)` if `Number.isFinite(timestamp) && timestamp > 0 && timestamp <= ULID_MAX_TIME`.

---

## Blocking issues

*None.*

---

## Serious issues

### SERIOUS-1: Dual wire mapping produces divergent event payloads for the same event ID (R14)
- **File**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:716-723` and `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1055-1072`
- **Scenario**: When an ineligible event is created, `SkillSynthesisService.pushEvent` broadcasts the event with `{ id, kind, timestamp, sessionId, stats: { reason: '...' } }`. When `skillSynthesis:diagnostics` is queried, `SkillsSynthesisRpcHandlers` constructs the wire object manually with `stats: e.stats`, discarding `e.reason` and `e.candidateId`.
- **Impact**:
  - Violates the wire contract in `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:55-57`.
  - Causes loss of `reason` in the frontend feed when snapshots load.
  - Forces Batch 2 to either implement asymmetric deduplication workarounds in the frontend state machine or edit backend RPC handlers.
- **Fix**:
  1. Extract and export `toSkillSynthesisEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire` in `libs/backend/skill-synthesis`.
  2. Use `toSkillSynthesisEventWire` in `SkillSynthesisService.pushEvent` (replacing private `toEventWire`).
  3. In `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:716`, replace the manual mapping with `recentEvents: snapshot.recentEvents.map(toSkillSynthesisEventWire)`.
  4. Update `skills-synthesis-rpc.handlers.spec.ts` line 98/106 to reflect the unified wire mapping.

---

## Moderate and minor issues

### MODERATE-1: Non-integer timestamp fallback in `ulidSeedTime` substitutes `Date.now()` without rounding
- **File**: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:200-206`
- **Impact**: Any non-integer floating-point timestamp loses its relative timestamp value and seeds from `Date.now()`.
- **Fix**: `const t = Math.floor(timestamp); return Number.isFinite(t) && t > 0 && t <= ULID_MAX_TIME ? t : undefined;`

### MINOR-1: RPC handler spec fixture lacks realistic event properties
- **File**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:43-61`
- **Impact**: Test fixture passes `ineligible` events with `stats: undefined` and without `reason`, masking the divergence between the live broadcast and the snapshot mapping.
- **Fix**: Provide realistic event fixtures with `reason: 'prefilterTooThin'` in the handler spec to assert that `stats.reason` is mapped.

---

## Data flow

1. **Producer generates event** (`SkillSynthesisService.analyzeSession` or triggers):
   - Constructs `SkillSynthesisEventInput` with `kind`, `timestamp`, `sessionId`, optional `reason`, `candidateId`, `stats`. [OK]
2. **`pushEvent` assigns identity and updates ring**:
   - `id: this.nextEventId(ulidSeedTime(input.timestamp))` generates strictly monotonic ULID. [OK]
   - Event appended to `this.events`; shifted if length > 200. [OK]
3. **Live broadcast to webview**:
   - `toEventWire(ev)` packs `candidateId` and `reason` into `stats`. [OK]
   - Broadcast sent via `webviewManager.broadcastMessage(MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, { event })`. [OK]
4. **Snapshot query** (`skillSynthesis:diagnostics`):
   - `SkillSynthesisDiagnosticsService.getSnapshot()` calls `SkillSynthesisService.recentEvents()`.
   - `recentEvents()` slices newest `limit` events and reverses to newest-first order without ring mutation. [OK]
   - `SkillsSynthesisRpcHandlers` maps `recentEvents`. **[GAP: Fails to fold `candidateId` and `reason` into `stats`, producing a divergent payload from step 3]**
5. **Client consumption**:
   - Frontend receives live push with `stats.reason`, but receives snapshot with `stats: undefined`. **[GAP: Inconsistent state / loss of reason]**

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 1.1: Add real event id to wire type (`SkillSynthesisEventWire`) | COMPLETE | None. JSDoc and type added accurately in `libs/shared`. |
| Task 1.2: Monotonic ULID on push; newest-first window copy | COMPLETE | Fully implemented with `monotonicFactory()` and `slice(-safe).reverse()`. |
| Task 1.3: Carry id through diagnostics snapshot handler | PARTIAL | ID is carried, but wire shape diverges from live push (`stats` mapping divergence, R14). |
| Task 1.4: Backend specs for order, identity, wire id, and eviction | COMPLETE | Comprehensive test coverage added for same-ms events, backwards time, and ring eviction. |

**Implicit requirements not addressed**:
- Single source of truth for `SkillSynthesisEventWire` conversion between `pushEvent` and `getSnapshot` handlers.

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Two events in exact same millisecond | YES | `monotonicFactory` increments 16-char Crockford Base32 random suffix | None. Strictly increasing. |
| Timestamp goes backwards (clock skew) | YES | `seed <= lastTime` in `monotonicFactory` reuses `lastTime` and increments random | None. Verified by unit test. |
| Timestamp <= 0, NaN, or non-integer | YES | `ulidSeedTime` returns `undefined`, triggering `Date.now()` fallback in factory | Sub-millisecond float timestamps lose timestamp value instead of being floored. |
| Limit < buffer size | YES | `slice(-safe).reverse()` takes newest N events | None. Verified by unit test. |
| Limit > 200 (ring eviction) | YES | Oldest events evicted from ring via FIFO `shift()`; newest-first order maintained | None. Verified by unit test. |
| Concurrent reads of `recentEvents()` | YES | Returns shallow copy via `.slice()`, ring is never mutated | None. Verified by unit test. |
| Handler called with invalid `workspaceRoot` | YES | Zod schema validation throws `INVALID_PARAMS` | None. |

---

## Residual Uncertainty / What could not be checked

1. **Monorepo-wide typecheck via `ptah_get_diagnostics`**:
   `ptah_get_diagnostics` timed out after 45s due to workspace monorepo scale (96 projects). Targeted test runs (`skill-synthesis.service.spec.ts` with 52 passed, `skills-synthesis-rpc.handlers.spec.ts` with 246 passed) verified compilation and runtime execution for both modified projects.

---

## Verdict

- **Recommendation**: REVISE (NEEDS_REVISION)
- **Confidence**: HIGH
- **Top risk**: Ineligible event rows will lose their reason text (`prefilterTooThin` / `prefilterRejected`) in the activity feed whenever a snapshot is fetched, because the snapshot RPC handler omits the fields that `pushEvent` folds into `stats`.
- **What a robust implementation would add**:
  1. Export `toSkillSynthesisEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire` from `libs/backend/skill-synthesis`.
  2. Use `toSkillSynthesisEventWire` in both `SkillSynthesisService.pushEvent` and `SkillsSynthesisRpcHandlers['skillSynthesis:diagnostics']`.
  3. Update `skills-synthesis-rpc.handlers.spec.ts` fixture and assertions to expect consistent wire serialization.

---

## Batch 1 - re-review (revision 1)

- **Batch**: Batch 1 — Event id and newest-first, backend contract (revision 1)
- **Author**: backend-developer (in-process sub-agent)
- **Reviewer**: antigravity CLI lane (code-logic-reviewer role)
- **Verdict**: APPROVED
- **Score**: 9/10

### Summary

| Finding | Status | Evidence (`file:line`) |
| --- | --- | --- |
| **SERIOUS-1 (R14)**: Dual wire-mapping logic produces divergent event payloads between live push and snapshot RPC | **fixed** | `libs/backend/skill-synthesis/src/lib/event-wire.ts:13-32` extracts canonical `toSkillSynthesisEventWire()`, exported at `libs/backend/skill-synthesis/src/index.ts:433`, consumed identically by `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1038` and `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:717`. Assertion parity verified in `skill-synthesis.service.spec.ts:881-917` and `skills-synthesis-rpc.handlers.spec.ts:453-458`. |
| **MODERATE-1**: `ulidSeedTime` non-integer timestamp fallback substitutes `Date.now()` without rounding | **fixed** | `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:200-205` checks `!Number.isFinite(timestamp)` and uses `Math.floor(timestamp)` guarded by `ms > 0 && ms <= ULID_MAX_TIME`. Verified in `skill-synthesis.service.spec.ts:919-929`. |
| **MINOR-1**: RPC handler spec fixture lacks realistic event properties with `reason` and `candidateId` | **fixed** | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:397-405` fixtures an ineligible event with `reason`, `candidateId`, and `stats.turns`, asserting exact matching wire shape at lines 453-458 without `expect.any` or type casts. |

### Verification Checks

1. **Fix Confirmation & Anti-Suppression**:
   - Confirmed no `expect.any` or wildcards hiding fields in `skills-synthesis-rpc.handlers.spec.ts:453-458` and `skill-synthesis.service.spec.ts:901-916`. Both test suites assert explicit property shapes and match literals across test files.
   - Zero unsafe type casts added (`as any` or `@ts-ignore` count unchanged; strict compliance preserved).
2. **Circular Dependency & Dependency Boundaries**:
   - `libs/backend/skill-synthesis/src/lib/event-wire.ts` imports only types (`SkillSynthesisEventWire` from `@ptah-extension/shared` and `SkillSynthesisEvent` from `./diagnostics.types`). It imports zero runtime objects.
   - `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:58` imports only the pure function `toSkillSynthesisEventWire` from `@ptah-extension/skill-synthesis`.
   - No circular dependencies exist.
3. **No New Defects**:
   - `toSkillSynthesisEventWire` does not mutate the source event, cleanly spreads existing `ev.stats`, and conditionally folds `candidateId` and `reason` only when present.
   - `ulidSeedTime` correctly floors fractional timestamps while rejecting `NaN`, `+/-Infinity`, negative numbers, 0, and numbers exceeding `ULID_MAX_TIME`.
   - Test suites pass:
     - `skill-synthesis.service.spec.ts`: 54/54 passed (including 2 new tests for wire mapping parity and fractional timestamp flooring).
     - `skills-synthesis-rpc.handlers.spec.ts`: 246/246 passed (including snapshot wire mapping parity).

### New Defects

*None.*

### Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: None remaining in Batch 1 backend contracts. Batch 2 frontend consumers can now safely rely on identical wire payloads between live push and diagnostics snapshot.

## Batch 2

- **Batch**: Batch 2 — Feed data path: ordering, dedupe, grouping, identity
- **Author**: frontend-developer (in-process sub-agent)
- **Reviewer**: Glm CLI lane (code-logic-reviewer role)
- **Verdict**: APPROVED
- **Score**: 8/10

### Summary

| Finding | Status | Evidence (`file:line`) |
| --- | --- | --- |
| MODERATE-1: duplicate push of an out-of-window id re-bumps the histogram | accepted (gap (a)) | `skill-diagnostics-state.service.ts:222-239` |
| MODERATE-2: live event during an in-flight snapshot is dropped until the next poll | accepted (gap (b)) | `skill-diagnostics-state.service.ts:142, 247` |
| Gap (c): last-run timestamps only move forward on the live path | sound, accepted | `skill-diagnostics-state.service.ts:50-52, 228-230` |
| Gap: `SKILL_EVENT_WINDOW` not exported from the lib index | non-issue | only in-lib consumers today |
| MINOR-1: jest worker force-exit warning on suite teardown | observation only | test output, both suites pass |

Score justification (Band 7-8: sound). Evidence separating from Band 5-6: every acceptance path read
correctly end to end (backend `toSkillSynthesisEventWire` through DSS state to feed rows), the acceptance
specs exist and fail on the base code, and 34 tests pass against the changed files. Evidence separating
from Band 9-10: two moderate transient-state gaps remain and the executor ran typecheck and lint but this
review ran tests only, not the typecheck target.

### Check 1: Cross-side contract (producer to consumer)

Confirmed.

- Wire type: `id, kind, timestamp, sessionId?, stats?, error?` (`rpc-curator-diagnostics.types.ts:50-65`).
- Producer: the live broadcast and the handler snapshot both go through
  `toSkillSynthesisEventWire` (`event-wire.ts:13-32`; `skill-synthesis.service.ts:1038`;
  `skills-synthesis-rpc.handlers.ts:717`). One mapper confirmed.
- `recentEvents(limit)` returns newest-first without mutating the ring
  (`skill-synthesis.service.ts:1053-1056`, `slice(-safe).reverse()`).
- Consumer: `normalizeEvents` dedupes, sorts newest-first and caps at 50
  (`skill-diagnostics-state.service.ts:37-48`). `applySnapshot` tolerates a missing `recentEvents`
  (`:247`). The feed reads `sessionId ?? null` and `stats?.['reason']` (`event-feed.component.ts:30, 58`),
  so an absent optional field renders `null`, no crash.
- Live-push path intact: `skill-synthesis-live.service.ts:92-98` forwards the whole wire event, id
  included, to `pushLiveEvent`.

### Check 2: ULID tie-break in `compareNewestFirst`

Confirmed sound (`skill-diagnostics-state.service.ts:27-34`).

- Same millisecond: larger id sorts first, string compare. The backend assigns ids from
  `monotonicFactory` (`skill-synthesis.service.ts:235, 1026`), so within one millisecond ids increase
  strictly in record order. Larger id first is therefore the later record first.
- ULIDs are 26 fixed-length Crockford Base32 chars in one case. Lexicographic and encoded order agree.
- Across different milliseconds the timestamp comparison wins. The tie-break is only a same-ms rule, so
  a clock regression between milliseconds cannot contradict the id order in a visible way.

### Check 3: Duplicate-id handling cannot drop a different event

Confirmed.

- Ids are unique per event: the backend assigns one ULID per record; no persistence exists (Task 587 owns
  the ledger), so the id space never overlaps across restarts.
- `pushLiveEvent` returns early when the id is present (`:223`), before the list update and before any
  side effect (`:224, 227-239`). The kept copy is the identical payload (one mapper, Batch 1).
- Same id from two different events cannot arise under the current producer. See MODERATE-1 for the one
  reachable edge, which counts side effects twice rather than drops an event.

### Check 4: Rulings on the three accepted gaps

1. **(a) Duplicate push older than the window — ACCEPT with a note (MODERATE-1).**
   Trigger conditions are narrow: the backend pushes each event once at record time, so a redelivery of
   an event older than the 50-cap requires a duplicated broadcast, which is not an observed path. Even
   then the list self-heals: `insertNewestFirst` inserts at the tail and `slice(0, 50)` evicts the event
   again (`:59-62`), but the histogram +1 (`:231-238`) was already applied and survives until the next
   snapshot replaces the histogram whole (`:248-250`). The 30 s poll corrects it. Last-run timestamps use
   `latest()` (`Math.max`), so a re-applied old timestamp cannot move them. Cheap future fix: bump side
   effects only when the event is still inside the list after the update.
2. **(b) Live event during an in-flight snapshot — ACCEPT (MODERATE-2).**
   The event vanishes from the list until the next poll: the same-window snapshot replaces the whole
   list (`:247`, C8 replace semantics) and the push is not re-delivered. Base code had the identical
   behaviour (replace-list), so this is not a regression; the bug R3 described was the duplicate row,
   which the id check now closes. Merging live events into the snapshot would be a new race surface and
   would deviate from the accepted contract this batch recorded. One poll period of staleness in a
   diagnostic view is an acceptable cost, and the poll refreshes it.
3. **Additional recorded gap: `SKILL_EVENT_WINDOW` stays unexported from the lib index — ACCEPT as a
   non-issue.** Consumers today import from the module path inside the lib (the spec at
   `skill-diagnostics-state.service.spec.ts:11-14`). An index export becomes relevant only when an
   outside lib needs the constant; none does.

### Check 5: Row identity; acceptance specs exist and fail on base

Confirmed.

- Rows are tracked by `row.id` (`event-feed.component.ts:95`), exposed as
  `[attr.data-event-id]="row.id"` (`:98`). Group ids are the newest member's real event id
  (`:57, :48-52`); ids are unique per event, so two rows can never share a track key. No NG0955 source.
- Spot-check against base: base tracked by `ev.timestamp + '-' + ev.kind` and rendered one row per raw
  event with no `data-event-id`. The specs would fail on base:
  - same-ms non-grouped two-row spec (`event-feed.component.spec.ts:114-140`) asserts `data-event-id`
    equals each real id and no NG0955 - fails on base (equal track keys, no attribute).
  - grouping spec (`:85-97`) - fails on base (five rows, no count badge).
  - normalisation spec (`skill-diagnostics-state.service.spec.ts:240-248`) - fails on base (base
    appended chronologically and never sorted).
- Verification run in this review: `npx jest` on both changed spec files — 2 suites, 34 passed
  (`skill-diagnostics-state.service.spec.ts` and `event-feed.component.spec.ts`).

### Check 6: Stubs and markers

Clean. Grep over the changed lib for `TODO|FIXME|PLACEHOLDER|STUB|not implemented` matched only: jest
mock-helper names (`makeDiagnosticsStub`, test files) and a spec describing the skeleton loading state.
No marker, no empty body, no mock standing in for logic in any production file changed by Batch 2.

### Additional findings

- **MODERATE-1** (also Check 4.1) — `skill-diagnostics-state.service.ts:222-239`: side effects are not
  gated on the event surviving the window. A new-but-ancient event pushed when the list sits at 50 is
  inserted then immediately evicted (`:62`), yet the histogram +1 stays counted. Repeated deliveries
  count repeatedly. Impact: transient inflated histogram, at most until the next poll. Severity kept at
  Moderate because the producer never re-pushes old events today.
- **MODERATE-2** (also Check 4.2) — `skill-diagnostics-state.service.ts:142, 247`: an event that arrives
  while a snapshot request is in flight is overwritten by the snapshot, and its last-run timestamp bump
  regresses with it, until the next poll (30 s). Accepted.
- **MINOR-1** — jest reports a worker force-exit on the state-service suite teardown ("a worker process
  has failed to exit gracefully"). Tests pass; likely a lingering timer handle from polling coverage.
  Observation only; worth a look if CI is noisy, not a Batch 2 defect.

### Could not check

1. `typecheck` and `lint` targets (executor ran them green, per batches.md). This review did not rerun
   them to protect the low-disk constraint; the 34 passing tests compile both changed files, which
   covers the transpile path but not the lib strict typecheck.
2. Cross-batch reachability of the live push into the feed (TAB -> DSS -> feed with real DSS) is Batch
   4 Task 4.3 territory; the state service paths are unit-verified here only.
3. Real duplicate-delivery behaviour on the wire (does a broadcast ever arrive twice in production?).
   MODERATE-1's trigger rests on the assumption that it does not.

### Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: transient histogram inflation (MODERATE-1) and a one-poll-period drop of a live event
  arriving during an in-flight snapshot (MODERATE-2); both self-correct within the 30 s poll, and
  neither loses a durable fact.


---

## Batch 3

- **Batch**: Batch 3 — Surviving status card, Activity feed owner, Settings triggers (unmounted)
- **Author**: frontend-developer (in-process sub-agent)
- **Reviewer**: antigravity CLI lane (code-logic-reviewer role)
- **Verdict**: APPROVED
- **Score**: 9/10

### Summary

| Metric | Value |
| --- | --- |
| Overall score | 9/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Score justification (Band 9–10: exemplary): Full parity with the legacy accordion achieved across all 10 parity rows (B2–B6, B10–B14) and user decisions. Clean Angular 22 standalone architecture with signals and `ChangeDetectionStrategy.OnPush`. Polling ref-counting in `SkillDiagnosticsStateService` is strictly balanced via `ngOnInit`/`ngOnDestroy` lifecycle hooks. All 8 trigger controls preserve exact bounds, keys, payloads, and fallback defaults. Unit tests are comprehensive with 50/50 passing tests for Batch 3 components and 470/470 passing tests across the entire `skill-synthesis-ui` library.

---

### Check 1: Poll ownership and lifecycle ref-counting

**CONFIRMED SOUND.**

- `SkillActivityFeedComponent` (`libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.ts:81-88`) is the sole component in Batch 3 that manages the polling lifecycle:
  - `ngOnInit`: calls `void this.state.refresh()` immediately (refresh-on-mount, user decision 4) followed by `this.state.startPolling()`.
  - `ngOnDestroy`: calls `this.state.stopPolling()`.
- `SkillDiagnosticsStateService` (`libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts:188-207`) manages polling via `_subscriberCount`:
  - `startPolling()` increments subscriber count and arms `setInterval(..., POLL_INTERVAL_MS)` when the count transitions $0 \to 1$.
  - `stopPolling()` decrements subscriber count with an underflow guard (`if (current <= 0) return;`) and clears `pollHandle` when the count drops to 0.
- If `SkillActivityFeedComponent` is destroyed early, `ngOnDestroy` reliably decrements the subscriber count and disposes of the interval timer. Neither `SkillTriggersSettingsComponent` nor `SkillPipelineStatusComponent` attaches to the polling lifecycle.
- Verified in `skill-activity-feed.component.spec.ts:45-61`.

---

### Check 2: Fidelity of the 8 trigger controls

**CONFIRMED SOUND.**

Comparing `SkillTriggersSettingsComponent` (`skill-triggers-settings.component.ts:130-172`) against `SkillDiagnosticsAccordionComponent` (`skill-diagnostics-accordion.component.ts:244-305`):

| Control Key | Type / Bounds | Default When Enabled | Payload Dispatched to `setTriggers` | Accordion Parity |
| --- | --- | --- | --- | --- |
| `sessionEnd` | `boolean` | N/A | `{ sessionEnd: boolean }` | Exact match |
| `idleMs` | `number` / `boolean` | `600_000` | `{ idleMs: number }` (0 when off, 600,000 when toggled on, or typed ms) | Exact match |
| `bootScan` | `boolean` | N/A | `{ bootScan: boolean }` | Exact match |
| `subagentStop` | `boolean` | N/A | `{ subagentStop: { enabled: boolean } }` | Exact match |
| `turnComplete` | `boolean` | N/A | `{ turnComplete: { enabled: boolean } }` | Exact match |
| `postToolUse` | `boolean` | preserves `minEditCount` (default `1`) | `{ postToolUse: { enabled: boolean, minEditCount: number } }` | Exact match |
| `postToolUseMinEditCount` | `number` [1, 20] | N/A | `{ postToolUse: { enabled: boolean, minEditCount: number } }` | Exact match |
| `maxAnalyzesPerHour` | `number` [0, 1000] / `boolean` | `60` | `{ maxAnalyzesPerHour: number }` (0 when off, 60 when toggled on, or typed count) | Exact match |

- All 8 controls map to identical keys, bounds, defaults, and payloads as the legacy accordion.
- Verified in `skill-triggers-settings.component.spec.ts:84-219`.

---

### Check 3: Parity rows B2–B6 and B10–B14 against accordion & user decisions

**CONFIRMED PARITY ACHIEVED.**

- **B2 (Absolute last-run time)**: `SkillPipelineStatusComponent:139-151` shows relative text `lastAnalysisLabel()` and absolute timestamp `lastAnalysisAbsolute()` (`new Date(ts).toLocaleString()` or `"Never"`).
- **B3 (Last curator pass)**: `SkillPipelineStatusComponent:163-170` renders `"Last curator pass: <absolute | 'Never'>"`.
- **B4 (Sessions analyzed today)**: `SkillPipelineStatusComponent:182-198` displays `Sessions analyzed today (<total>): <accepted> accepted, <ineligible> ineligible` where total is the sum of histogram buckets.
- **B5 (Histogram bars)**: Embedded directly via `<ptah-eligibility-histogram [histogram]="histogram()" />` in `SkillPipelineStatusComponent:197`.
- **B6 (Candidates by status)**: Preserved per user decision item 2. `SkillPipelineStatusComponent:201-229` renders `Candidates by status: N Candidates, N Promoted, N Rejected` when `byStatus` is provided.
- **B10 (Analyze current session)**: `SkillActivityFeedComponent:45-55` renders button calling `state.analyzeNow()`, disabled with tooltip hint `"Open a session to analyze it manually"` when `!hasActiveSession()`.
- **B11 ("View logs" -> "Refresh" button)**: Replaced on status card per user decision item 3. `SkillPipelineStatusComponent:172-180` renders `"Refresh"` button emitting `refresh`, disabled while `refreshing()`.
- **B12 (Error text)**: Both `SkillActivityFeedComponent:57-65` and `SkillTriggersSettingsComponent:106-114` render `error()` in an alert container (`role="alert"`).
- **B13 (30s poll)**: Controlled by `SkillActivityFeedComponent:83`.
- **B14 (Refresh on mount)**: Retained per user decision item 4 via `void this.state.refresh()` in `SkillActivityFeedComponent:82`.

---

### Check 4: Reason chip reads the newest event

**CONFIRMED SOUND.**

- `SkillPipelineStatusComponent:424-437`:
  ```typescript
  protected readonly reasonChip = computed<{ label: string } | null>(() => {
    const events = this.recentEvents();
    if (events.length === 0) return null;
    // Input contract is newest-first, so the first event is the latest.
    const latest = events[0];
    if (latest.kind === 'ineligible') return { label: 'ineligible' };
    if (latest.kind === 'rate-limited') return { label: 'rate-limited' };
    return null;
  });
  ```
- Because Batch 2 established the newest-first order contract (`events[0]` is latest), `reasonChip` evaluates the newest event.
- Tested in `skill-pipeline-status.component.spec.ts:642-681`: an older `ineligible` event behind a newer `error` event does not render the chip, while a newer `ineligible` event correctly renders the chip.

---

### Check 5: No overlapping summary inside the status card

**CONFIRMED SOUND.**

- The legacy standalone `Today: N accepted, M ineligible` line was completely deleted. It was replaced by the single unified block `Sessions analyzed today (total): N accepted, M ineligible` with embedded histogram bars (`skill-pipeline-status.component.ts:182-198`).
- Confirmed by test in `skill-pipeline-status.component.spec.ts:597`: `expect(text(root)).not.toContain('Today:');`.
- Absolute timestamp `lastAnalysisAbsolute()` renders conditionally only when `lastAnalyzeRunAt() !== null`, preventing duplicate `"Never"` labels.

---

### Check 6: Shared `state.error()` signal behavior

**CONFIRMED AS INTENDED.**

- `SkillDiagnosticsStateService` exposes a single shared `error` signal (`_error`).
- `refresh()`, `analyzeNow()`, and `setTriggers()` all record failures to `_error`.
- Consequently, an error during `refresh()` will display in both `SkillActivityFeedComponent` and `SkillTriggersSettingsComponent`. This was reviewed against parity row B12 and confirmed to be the recorded design default.

---

### Check 7: Stubs and markers

**CONFIRMED CLEAN.**

- Zero `TODO`, `FIXME`, `PLACEHOLDER`, or `STUB` markers exist in the changed files.
- All template bindings and method handlers contain complete production implementations.

---

### New Defects

*None.*

---

### Could not check

1. **Integrated Tab Mounting**: Components in Batch 3 are unmounted standalone units. Full wiring into `skill-synthesis-tab.component.ts` and deletion of `skill-diagnostics-accordion.component.ts` is explicitly deferred to Batch 4.
2. **E2E Visual Rendering**: Visual verification across light/dark themes will be performed during Batch 6 with Playwright after tab wiring is complete.

---

### Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: None identified in Batch 3. The components are ready for tab-level integration and accordion replacement in Batch 4.


---

## Batch 4

- **Batch**: Batch 4 — Wire Activity and Settings, remove the accordion, tab-level acceptance
- **Author**: frontend-developer (in-process sub-agent)
- **Reviewer**: antigravity CLI lane (code-logic-reviewer role)
- **Verdict**: APPROVED
- **Score**: 9/10

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

**Score justification (Band 9–10: exemplary)**:
- *Evidence separating from Band 7–8 (sound)*:
  1. Full parity achieved across all 14 accordion capabilities (B1–B14) and related touchpoints (A1, A3, C15, D1, D2, E1) with zero dropped capabilities.
  2. The producer-to-screen pipeline (backend RPC → `SkillDiagnosticsStateService` → `SkillSynthesisTabComponent` → `SkillActivityFeedComponent` → `SkillEventFeedComponent`) guarantees strict newest-first ordering end-to-end, with `ineligibleHint` and the status card `reasonChip` reliably evaluating `events[0]`.
  3. Single-caller polling ownership is preserved in `SkillActivityFeedComponent`, cleanly subscribing on mount and unregistering on sub-view switch or destroy with zero timer leaks or double-polling.
  4. All 8 new integration test cases in `skill-synthesis-tab.component.spec.ts` test real end-to-end component trees with real `SkillDiagnosticsStateService`, are strictly non-tautological, and would fail under regression to pre-fix behaviors. All 28 test suites (466 tests) pass cleanly.
- *Evidence separating from Band 10*:
  1. A minor concurrent `refresh()` loading flag reset edge case (MODERATE-1) exists when multiple `refresh()` calls overlap in `SkillDiagnosticsStateService`.
  2. Redundant dual `refresh()` on initial tab mount (MINOR-1) remains due to intentional preservation of both `tab.ngOnInit` and `feed.ngOnInit` refresh calls per recorded decisions.

---

### Parity Table (B1–B14, A1, A3, C15, D1, D2, E1)

| Row | Capability | New Home (`file:line`) | Backing RPC / Path | Status |
| --- | --- | --- | --- | --- |
| **B1** | Accordion mount on Activity | Removed as planned (Task 4.2). Replaced by `ptah-skill-activity-feed` on Activity (`skill-synthesis-tab.component.ts:488`) and `ptah-skill-triggers-settings` on Settings (`skill-synthesis-tab.component.ts:597`) | N/A (Component container replacement) | **INTACT** |
| **B2** | "Last analyze run" absolute time / `Never` | `skill-pipeline-status.component.ts:138-150` via `[lastAnalyzeRunAt]="lastAnalyzeRunAt()"` (`skill-synthesis-tab.component.ts:474`) | `skillSynthesis:diagnostics` snapshot (`lastAnalyzeRunAt`) + live push | **REACHABLE** |
| **B3** | "Last curator pass" absolute time / `Never` | `skill-pipeline-status.component.ts:164-170` via `[lastCuratorPassAt]="lastCuratorPassAt()"` (`skill-synthesis-tab.component.ts:483`) | `skillSynthesis:diagnostics` snapshot (`lastCuratorPassAt`) + live push | **REACHABLE** |
| **B4** | "Sessions analyzed today (N)" total | `skill-pipeline-status.component.ts:183-197` via `[histogram]="eligibilityHistogram()"` (`skill-synthesis-tab.component.ts:475`) | `skillSynthesis:diagnostics` snapshot (`eligibilityHistogram`) + live push | **REACHABLE** |
| **B5** | Eligibility histogram 3 bars | `skill-pipeline-status.component.ts:199` via `<ptah-eligibility-histogram [histogram]="histogram()" />` | `skillSynthesis:diagnostics` snapshot (`eligibilityHistogram`) | **REACHABLE** |
| **B6** | "Candidates by status" (Candidates, Promoted, Rejected) | `skill-pipeline-status.component.ts:203-230` via `[byStatus]="byStatus()"` (`skill-synthesis-tab.component.ts:484`) | `skillSynthesis:diagnostics` snapshot (`totalCandidates`, `totalPromoted`, `totalRejected`) | **REACHABLE** |
| **B7** | "Recent events" hosting feed | `skill-activity-feed.component.ts:29-69` hosting `<ptah-skill-event-feed [events]="events()" />`, mounted at `skill-synthesis-tab.component.ts:488` | `skillSynthesis:diagnostics` snapshot (`recentEvents`) + live push `SKILL_SYNTHESIS_EVENT` | **REACHABLE** |
| **B8** | Triggers panel (8 controls) | `skill-triggers-settings.component.ts:40-105`, mounted at `skill-synthesis-tab.component.ts:597` | Read: `skillSynthesis:diagnostics` (`triggers`). Write: `skillSynthesis:setTriggers` (immediate per control) | **REACHABLE** |
| **B9** | Frontend trigger defaults | `skill-diagnostics-state.service.ts:65-70` (`DEFAULT_TRIGGERS`) | N/A (State service initial signal value) | **INTACT** |
| **B10** | "Analyze current session" button | `skill-activity-feed.component.ts:45-55` | `skillSynthesis:analyzeNow` via `SkillDiagnosticsStateService.analyzeNow()` | **REACHABLE** |
| **B11** | "View logs" -> "Refresh" button | `skill-pipeline-status.component.ts:172-180` via `(refresh)="onRefreshDiagnostics()"` (`skill-synthesis-tab.component.ts:486`) | `skillSynthesis:diagnostics` snapshot | **REACHABLE** |
| **B12** | Diagnostics error text | `skill-activity-feed.component.ts:57-65` & `skill-triggers-settings.component.ts:106-114` | Shared `state.error` from `diagnostics`, `analyzeNow`, `setTriggers` | **REACHABLE** |
| **B13** | 30s diagnostics poll | `skill-activity-feed.component.ts:81-88` (`startPolling()` on init, `stopPolling()` on destroy) | `skillSynthesis:diagnostics` 30s interval | **REACHABLE** |
| **B14** | Accordion's init `refresh()` | `skill-activity-feed.component.ts:82` (`void this.state.refresh()`) and `skill-synthesis-tab.component.ts:944` | `skillSynthesis:diagnostics` snapshot | **REACHABLE** |
| **A1** | Pipeline status card mount | `skill-synthesis-tab.component.ts:474-486` | Same mount point on Activity with updated inputs | **INTACT** |
| **A3** | Status card reason chip from `events[0]` | `skill-pipeline-status.component.ts:151-162, 423-437` | Reads newest event (`events[0]`) from newest-first list | **INTACT** |
| **C15** | Sessions sub-view ineligible hint | `skill-synthesis-tab.component.ts:781-807` (`ineligibleHint`) | Reads newest event (`events[0]`) from newest-first list | **INTACT** |
| **D1** | Weekly digest panel | `skill-synthesis-tab.component.ts:489-492` | Kept immediately following activity feed on Activity | **INTACT** |
| **D2** | Orchestration specs card | `skill-synthesis-tab.component.ts:494-578` | Kept following digest panel on Activity | **INTACT** |
| **E1** | Settings sub-view panels | `skill-synthesis-tab.component.ts:588-597` | Hosts `ptah-skill-settings-panel` and `ptah-skill-triggers-settings` | **INTACT** |

---

### Five Logic Questions

#### 1. How does this fail silently?
1. **Concurrent `refresh()` loading flag premature reset (`skill-diagnostics-state.service.ts:133-148`)**:
   If user clicks the status card "Refresh" button while a background interval poll or mount refresh is in-flight, two `diagnostics()` RPC calls run concurrently. When the first one completes, its `finally` block executes `this._loading.set(false)`. If the second request is still executing, `loading()` returns `false` prematurely. The second snapshot will still update signals when it resolves, but the UI indicator flips to idle prematurely.
2. **Webview broadcast failure suppression on live push (`skill-synthesis.service.ts:1041-1046`)**:
   As identified in Batch 1, any failure in `broadcastMessage` logs at debug level only; if live push drops, the frontend activity feed silently relies on the 30s poll to catch up.

#### 2. What user action produces unexpected behaviour?
1. **Rapid sub-view switching during an in-flight snapshot query**:
   If a user navigates to Activity, triggering `refresh()` and `startPolling()`, and immediately navigates to Settings before the RPC resolves, `<ptah-skill-activity-feed />` is destroyed and `stopPolling()` executes. The in-flight snapshot promise resolves shortly after and updates `SkillDiagnosticsStateService` signals. This does not crash or leak resources, but the background state change occurs while the user is looking at Settings.

#### 3. What input data produces a wrong answer?
- None. Empty events array, missing optional snapshot fields (`totalCandidates`, `lastCuratorPassAt`, `lastAnalyzeRunAt`), and null session IDs are guarded with fallback defaults and null-coalescing operators across `SkillPipelineStatusComponent`, `SkillActivityFeedComponent`, and `SkillDiagnosticsStateService`.

#### 4. What happens when a dependency fails?
1. **`skillSynthesis:diagnostics` RPC error or timeout (10s)**:
   Caught cleanly in `SkillDiagnosticsStateService.refresh()` line 143, recorded in `_error`, and displayed in an accessible `role="alert"` box in `SkillActivityFeedComponent:57-65`.
2. **`skillSynthesis:analyzeNow` RPC error or timeout (60s)**:
   Caught in `analyzeNow()` line 170, populated to `_error`, and displayed in the Activity feed alert.
3. **`skillSynthesis:setTriggers` RPC error or timeout (8s)**:
   Caught in `setTriggers()` line 183, populated to `_error`, and displayed in the Settings Triggers card alert.

#### 5. What is missing that the requirements never mentioned?
1. **Single in-flight request de-duplication in `SkillDiagnosticsStateService.refresh()`**:
   The requirements specified wiring the Refresh button and retaining the mount refresh, but did not specify coalescing concurrent `refresh()` requests into a single in-flight Promise or tracking generation tokens.

---

### Failure Modes

#### Failure Mode 1: Premature Reset of Loading State During Overlapping Refreshes
- **Trigger**: User clicks "Refresh" on the status card during the window when the 30s polling timer or initial mount `refresh()` is already in-flight.
- **Symptom**: The Refresh button and loading spinner reset to idle before all pending network requests complete.
- **Evidence**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts:133-148`:
  ```typescript
  public async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      ...
      const snapshot = await this.rpc.diagnostics(...);
      this.applySnapshot(snapshot);
    } catch (err: unknown) {
      ...
    } finally {
      this._loading.set(false);
    }
  }
  ```
- **Current handling**: Every call unconditionally executes `this._loading.set(false)` in `finally`.
- **Recommendation**: Either coalesce concurrent `refresh()` calls (return the existing active promise) or maintain an active request counter before setting `_loading` to `false`.

---

### Blocking Issues

*None.*

---

### Serious Issues

*None.*

---

### Moderate and Minor Issues

#### MODERATE-1: Overlapping `refresh()` calls can prematurely reset `_loading` signal
- **File**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts:133-148`
- **Scenario**: When two `refresh()` calls run concurrently, the first resolving request clears `_loading` while the second is still in flight.
- **Impact**: Status card `refreshing` indicator clears before all in-flight diagnostics RPCs settle.
- **Fix**: Check active in-flight count or return in-flight promise if `_loading()` is already true.

#### MINOR-1: Redundant diagnostics snapshot RPC on initial tab mount
- **File**: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:944` and `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.ts:82`
- **Scenario**: On initial tab mount, `SkillSynthesisTabComponent.ngOnInit` triggers `this.diagnostics.refresh()`, and `<ptah-skill-activity-feed>` immediately mounts and its `ngOnInit` triggers `this.state.refresh()`.
- **Impact**: Two identical `skillSynthesis:diagnostics` RPCs are dispatched on initial load.
- **Fix**: Retained per explicit user decision 4 and requirement R12; harmless, but represents an unnecessary initial network duplicate.

---

### Verification Checks

#### Check 1: Parity Rows and Screen Reachability
- Confirmed: All 14 parity rows B1–B14 are accounted for. The accordion component is completely deleted from disk and template. All capabilities (panels, stats, histogram, feed, controls, poll, and errors) are present and reachable in their target locations (`SkillPipelineStatusComponent`, `SkillActivityFeedComponent`, and `SkillTriggersSettingsComponent`).
- Touchpoints A1, A3, C15, D1, D2, and E1 are preserved and intact.

#### Check 2: Producer-to-Screen Pipeline & Order
- Traced:
  1. Backend `SkillsSynthesisRpcHandlers` + `toSkillSynthesisEventWire` maps events newest-first.
  2. `SkillDiagnosticsStateService.applySnapshot` normalizes and deduplicates events via `normalizeEvents` using `compareNewestFirst` (timestamp desc, ULID desc).
  3. `SkillDiagnosticsStateService.pushLiveEvent` checks for duplicate IDs, and inserts at sorted newest-first index.
  4. `SkillSynthesisTabComponent` exposes `recentEvents` signal.
  5. `ineligibleHint` in `SkillSynthesisTabComponent:781-807` evaluates `events[0]` as the newest event.
  6. `reasonChip` in `SkillPipelineStatusComponent:423-437` evaluates `events[0]` as the newest event.
  7. `SkillActivityFeedComponent` passes `events()` to `<ptah-skill-event-feed>`.
  8. `SkillEventFeedComponent` groups consecutive events by kind/session and keys rows by newest member's `row.id`.
- Polling: `SkillActivityFeedComponent` is the sole production caller of `startPolling()`. Ref-counting starts on `ngOnInit` and stops on `ngOnDestroy`. Switching sub-views unmounts the feed and decrements subscriber count to 0, canceling the interval handle.

#### Check 3: Spec Validity (Non-Tautological Assertions)
- The 8 new integration tests in `skill-synthesis-tab.component.spec.ts:1010-1269` were inspected:
  - `renders the newest event first`: Seeds 12 events oldest-first; asserts top rows are `evt-12` and `evt-11`, then pushes live event and asserts it becomes first. Fails if oldest-first or append-at-tail is used.
  - `groups five repeated analyze-run events`: Asserts single row with `5 events` badge and `run-5` ID. Fails without grouping.
  - `renders two same-millisecond events`: Asserts distinct rows with correct ULID tie-breaking order. Fails without ULID tie-breaking.
  - `removes the accordion and keeps the triggers card on Settings only`: Verifies DOM element existence/absence across sub-view transitions.
  - `shows candidates by status on the status card and refreshes from its Refresh button`: Asserts rendered text and verifies click triggers `refresh()` spy.
  - `polls while Activity is shown and stops when the sub-view changes`: Asserts `startPolling` and `stopPolling` spies upon switching between Activity and Settings.
  - `drives the Sessions ineligible hint from the newest event`: Asserts hint absence when newest event is not ineligible, and presence once an ineligible event is pushed. Fails if oldest event is read.
  - `drives the status card reason chip from the newest event`: Asserts chip reflects newest event rather than older events in the window.

#### Check 4: Accepted Deviation (Protected Pass-Throughs)
- In `SkillSynthesisTabComponent`:
  - `diagnostics` is private: `private readonly diagnostics = inject(SkillDiagnosticsStateService);`.
  - Protected signal pass-through: `protected readonly diagnosticsLoading = this.diagnostics.loading;`.
  - Protected handler pass-through: `protected onRefreshDiagnostics(): void { void this.diagnostics.refresh(); }`.
  - Bound in template: `[refreshing]="diagnosticsLoading()"` and `(refresh)="onRefreshDiagnostics()"`.
- Confirmed correct, standard Angular encapsulation, and type-safe.

---

### Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: None remaining in Batch 4. Accordion removal is complete, all capabilities are restored in their dedicated locations, and tab-level integration is verified by 28 passing test suites.
- **Verdict**: APPROVED
