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
