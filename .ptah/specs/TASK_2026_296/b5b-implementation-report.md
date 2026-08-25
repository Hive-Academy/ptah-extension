# Batch 5b (B5b) — Item 6 Part B: reconciliation, backfill, migration 0039. Implementation report

**Status**: COMPLETE. Full gate green — typecheck **20/20**, test **19/19 projects,
10,572 passed / 197 skipped / 0 failed**, lint `agent-sdk` + `memory-curator` +
`skill-synthesis` + `persistence-sqlite` = **0 errors**.

**Comparison against the stated baseline** (10,332 passed / 128 skipped / 0 failed
across 18 projects, typecheck 19/19):

|                                        | passed                               | skipped            | projects |
| -------------------------------------- | ------------------------------------ | ------------------ | -------- |
| Baseline (18 test projects, post-B5a)  | 10,332                               | 128                | 18       |
| B5b adds to those 18                   | **+48**                              | 0                  | —        |
| 18-project subtotal now                | **10,380**                           | **128**            | 18       |
| `persistence-sqlite` (new to the list) | **192** (+9 vs its own 183 baseline) | **69** (unchanged) | 1        |
| **Measured total**                     | **10,572**                           | **197**            | **19**   |

Nothing dropped. Nothing was committed, staged, stashed or reverted. I stayed out of
`apps/ptah-cli` and `libs/backend/rpc-handlers/src/index.ts` (TASK_2026_297) — neither
was opened.

---

## 1. Files created / modified

### Created (6)

| File                                                                                                                  | What                                                            |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-id-resolved-callback-registry.ts`          | The twelfth SDK callback registry + `SessionIdResolvedPayload`. |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-id-resolved-callback-registry.spec.ts`     | Sibling spec, 7 tests.                                          |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\observation-queue.store.rekey.spec.ts`                | `backfillSessionId` against real SQLite, 6 tests.               |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\queue\skill-queue.store.rekey.spec.ts`               | R5 constraint collision against real SQLite, 6 tests.           |
| `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.ts`      | Migration 0039.                                                 |
| `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts` | Migration spec, 9 tests (4 registry + 5 behaviour).             |

### Modified — production (10)

| File                                                                                                | Change                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`                            | `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY = Symbol.for('SdkSessionIdResolvedCallbackRegistry')`.                                 |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`                          | Import + `container.register(..., { useClass: ... }, { lifecycle: Lifecycle.Singleton })`, placed beside `SDK_COMPACTION_CALLBACK_REGISTRY`. |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts`                        | Barrel export.                                                                                                                               |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`                                    | Public API export (class + 2 types).                                                                                                         |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`                    | 17th ctor param + `notifyAll` at **both** emit sites.                                                                                        |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`                                       | New class in Public API; one new Guidelines bullet stating the alongside-never-instead rule and the three subscriber obligations.            |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-curator.service.ts`          | `rekeySession(from, to)` — migrates `inFlight`.                                                                                              |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\episode-tracker.ts`        | `rekey(from, to)` with refuse-overwrite.                                                                                                     |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts` | Inject + subscribe/dispose + `rekeySession`; `SessionState.idleDueAt`.                                                                       |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\observation-queue.store.ts`         | `backfillSessionId(from, to)` — backfill method only.                                                                                        |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`        | `rekeySession(from, to)` — `analyzedSessions` + queue backfill.                                                                              |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts` | Inject + subscribe/dispose + `rekeySession`; `SessionState.idleDueAt`, `TurnCompleteState.dueAt`.                                            |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\queue\skill-queue.store.ts`        | `backfillSessionId(from, to)` — backfill method only.                                                                                        |
| `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`            | Import + `{ version: 39, name: '0039_reap_orphaned_queue_rows', sql: sql0039ReapOrphanedQueueRows }`.                                        |

### Modified — specs (9)

| File                                                                                              | Change                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `...\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`                                                 | Harness gains the registry; +3 Part B specs (both emit sites + the blank-id sibling).            |
| `...\memory-curator\src\lib\memory-curator.service.spec.ts`                                       | +5 `rekeySession` specs incl. the Q3 double-curate guard.                                        |
| `...\memory-curator\src\lib\triggers\memory-trigger.service.spec.ts`                              | Harness gains the registry, `curator.rekeySession`, `queue.backfillSessionId`; +7 specs.         |
| `...\memory-curator\src\lib\triggers\memory-trigger.integration.spec.ts`                          | Ctor arg (real registry).                                                                        |
| `...\memory-curator\src\lib\triggers\memory-trigger.coalesce.spec.ts`                             | Ctor arg (noop registry double).                                                                 |
| `...\memory-curator\src\lib\triggers\episode-tracker.spec.ts`                                     | +3 `rekey` specs.                                                                                |
| `...\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts`                              | Harness gains the registry + `synthesis.rekeySession`; +7 specs.                                 |
| `...\skill-synthesis\src\lib\triggers\skill-trigger.integration.spec.ts`                          | Ctor arg (real registry).                                                                        |
| `...\skill-synthesis\src\lib\skill-synthesis.service.enqueue.spec.ts`                             | Queue double gains `backfillSessionId`; +4 `rekeySession` specs.                                 |
| `...\persistence-sqlite\src\lib\migrations\0028_...spec.ts`, `0030_...spec.ts`, `0038_...spec.ts` | **Adapted, not deleted**: the "is the highest bundled version" ratchet bumped `38 → 39`. See §8. |

**Zero specs deleted.**

---

## 2. Task 5b.1 / 5b.2 / 5b.3 — the registry, its token, and both emit sites

### 2.1 Shape — and one deliberate, documented deviation from the brief's wording

The brief prescribed `compaction-callback-registry.ts`'s literal shape (`private readonly
callbacks = new Set<...>()`, `register` → disposer, `get size()`, `notifyAll` with
per-callback try/catch, `logger.error`). I implemented it by extending
**`CallbackRegistryBase`** (`helpers/callback-registry.base.ts`), which is that exact
shape extracted, and I want the reason on the record because it looks like a deviation:

- Every property the brief enumerated is present and unchanged: `register(cb): () => void`
  returning a disposer, `get size()`, synchronous `notifyAll`, per-callback try/catch,
  `this.logger.error('[<Scope>] subscriber threw', ...)`.
- The base additionally catches a **rejected async** subscriber (`'[<Scope>] async
subscriber threw'`), which a raw `Set` loop does not. That is strictly better here.
- **All 8–11 registries both trigger services already consume are built on this base** —
  `SessionStartCallbackRegistry`, `StopCallbackRegistry`, `PostToolUseCallbackRegistry`,
  `PreToolUseCallbackRegistry`, `SubagentStopCallbackRegistry`,
  `UserPromptSubmitCallbackRegistry`, `UserPromptExpansionCallbackRegistry`,
  `ToolFailureCallbackRegistry`, `SessionEndCallbackRegistry`,
  `SessionEndHookCallbackRegistry`. `CompactionCallbackRegistry` is the **one** that
  predates the extraction and still hand-rolls its `Set`. Hand-rolling a twelfth copy
  would have been the shape _nobody else uses_ — i.e. the actual invention.
- Dispatch is `eventemitter3.emit`, which is **synchronous**, so the rekey's synchrony
  contract holds. Pinned explicitly by a spec ("dispatches synchronously — the rekey
  contract depends on it").

If a reviewer prefers the literal `Set`, the change is mechanical and behaviour-identical;
I would argue against it on the consistency grounds above.

### 2.2 Payload

```
interface SessionIdResolvedPayload {
  readonly tabId: string | undefined;   // mirrors emitSessionIdResolved's 1st arg
  readonly realSessionId: string;       // mirrors its 2nd
  readonly timestamp: number;
}
```

`tabId` is `string | undefined` **on purpose**: it mirrors
`SdkAdapterCallbackRegistry.emitSessionIdResolved(tabId: string | undefined,
realSessionId: string)` exactly, so the registry is a faithful fan-out twin of the
single-slot call rather than a second, differently-shaped contract. Subscribers no-op on
`undefined` — there is nothing to reconcile when the query carried no tabId.

### 2.3 Both emit sites — alongside, never instead of

| Site                      | Path        | Line (current tree)                                              |
| ------------------------- | ----------- | ---------------------------------------------------------------- |
| `resumeCallback`          | resume      | `emitSessionIdResolved` at **`:641`**, `notifyAll` at **`:646`** |
| `createSessionIdCallback` | new session | `emitSessionIdResolved` at **`:708`**, `notifyAll` at **`:714`** |

`grep -n "emitSessionIdResolved" sdk-agent-adapter.ts` → `:641`, `:708` (plus `:159`, a
JSDoc reference). `grep -n "sessionIdResolvedRegistry.notifyAll"` → `:646`, `:714`. Two
and two. Neither `emitSessionIdResolved` call was altered — same arguments, same order,
same position relative to `bindRealSessionId` and `flushPendingUserActivity`.

On the new-session path the notify sits **after** the §0 init-callback blank refusal
(`blankToUndefined(realSessionId) === undefined`, `:687`), so a blank SDK id fires **no**
rekey signal at all. Pinned by a spec. That is the right ordering: a rejected bind leaves
`rec.realSessionId` null, so teardown will resolve to the tabId, and migrating state onto
a non-id would break the agreement between the two ends.

---

## 3. The rekey design, reviewable without the diff

### 3.1 What is migrated, and in what order

The handler registered in each `start()` is a synchronous arrow:

```
register((payload) => {
  if (payload.tabId === undefined) return;
  this.rekeySession(payload.tabId, payload.realSessionId);
});
```

`rekeySession(from, to)` in both services begins with the same three-line rejection —
`blankToUndefined(from)`, `blankToUndefined(to)`, and `from === to` — using the shared
primitive B3b added to `@ptah-extension/shared`.

**`MemoryTriggerService.rekeySession` — strict order:**

1. **`inFlightCurates`** (Set) — `if (this.inFlightCurates.delete(from)) this.inFlightCurates.add(to)`.
2. **`lastCurateAt`** (Map) — moved unless `to` already has a value, in which case `to`'s wins.
3. **`MemoryCuratorService.rekeySession(from, to)`** — the real double-curate guard (§3.3).
4. **`EpisodeTracker.rekey(from, to)`** — the episode buffer.
5. **`sessions`** (+ its idle timer) — §3.4.
6. **`ObservationQueueStore.backfillSessionId(from, to)`** — the durable half.

**`SkillTriggerService.rekeySession` — strict order:**

1. **`SkillSynthesisService.rekeySession(from, to)`** — `analyzedSessions` (the turn-count
   high-water mark) **and**, inside it, `SkillQueueStore.backfillSessionId`.
2. **`editTestStates`** (no timer of its own).
3. **`sessions`** (+ idle timer) — §3.4.
4. **`turnCompleteStates`** (+ the 90 s debounce timer) — §3.4.

**Why suppression state goes first (R-Q3).** The plan requires `inFlightCurates` /
`lastCurateAt` to move **before** `sessions`. The reason is that the ordering guarantees
there is no instant at which a curate is un-suppressed under _either_ key: the suppression
markers are already on the destination before anything that could fire a new trigger is
moved. On the skill side the analogue is the turn-count mark and the durable
`UNIQUE(session_id, stage)` row, which go first for the same reason.

### 3.2 How synchrony is guaranteed

There is **no `await`, no `.then`-chaining on the critical path, and no promise** anywhere
in `rekeySession` or in anything it calls:

- `EpisodeTracker.rekey` — three Map operations.
- `MemoryCuratorService.rekeySession` — Map operations plus one `void work.then(clear, clear)`
  that is _registered_, not awaited (§3.3).
- `SkillSynthesisService.rekeySession` — Map operations + `this.queue?.backfillSessionId(...)`,
  which is synchronous better-sqlite3.
- Both `backfillSessionId` methods — synchronous `BEGIN IMMEDIATE` / statements / `COMMIT`.
- `CallbackRegistryBase.notifyAll` — `eventemitter3.emit`, synchronous, pinned by a spec.

So the whole migration completes inside one turn of the event loop, from the adapter's
`notifyAll` call.

### 3.3 `MemoryCuratorService.inFlight` — the one non-obvious hazard, and how it is handled

The coalescing key is `` `${workspaceRoot ?? ''}::${sessionId}` `` (`:244`), so one session
can hold **several** entries. The migration splits each key on its **last** `::` and
compares the tail to `from` — a session id is a UUID v4 and never contains `::`, whereas a
Windows workspace root plausibly could, so `lastIndexOf` is precise where `endsWith` would
be merely likely-correct.

**The hazard nobody had written down.** `curate()` stores
`work = tracer.startSpan(...).finally(() => this.inFlight.delete(key))` with the
**original key captured in the closure** (`:216-218`). Move the map entry and that delete
becomes a no-op, so the migrated entry would sit under `toId` **forever** — and every
later curate for that session would be handed a long-settled promise and silently never
run. That is strictly worse than the double-curate the rekey exists to prevent.

The fix re-arms the cleanup under the new key:

```
this.inFlight.delete(key);
this.inFlight.set(nextKey, work);
const clear = (): void => {
  if (this.inFlight.get(nextKey) === work) this.inFlight.delete(nextKey);
};
void work.then(clear, clear);
```

`then(clear, clear)` supplies an `onRejected`, so no unhandled rejection is created; the
identity guard (`=== work`) means it cannot delete a newer entry that replaced it. Pinned
by the spec _"drains the migrated key when the run settles, so the session is curatable
again"_ — which fails outright without the re-arm.

Refuse-overwrite here means the `fromId` entry is **left in place** rather than deleted:
it still owns a real in-flight run whose own `.finally` will clear it. Deleting it would
throw away a live suppression handle.

### 3.4 Timers: re-armed with the remaining delay, never carried

Three timers exist across the two services, and all three are treated identically.

Each timer's owning state gained a wall-clock due-instant recorded at arm time —
`SessionState.idleDueAt` (both services) and `TurnCompleteState.dueAt` (skill side) —
set to `Date.now() + <window>` beside the `setTimeout`, and reset to `null` wherever the
existing code already set the handle to `null` (`fireIdle`, `fireTurnComplete`).

The migration for each is:

```
const state = map.get(from);
if (state) {
  map.delete(from);
  if (state.timer) clearTimeout(state.timer);          // always cleared
  if (map.has(to)) {                                    // refuse-overwrite
    state.timer = null; state.dueAt = null;             // fromId entry discarded
  } else {
    const remaining = state.dueAt === null ? null : state.dueAt - Date.now();
    state.timer = remaining === null ? null
      : setTimeout(() => this.fire<X>(to), Math.max(0, remaining));
    map.set(to, state);
  }
}
```

Three properties, each load-bearing:

- **The `fromId` timer is cleared on every branch**, including the discard branch. An
  orphaned timer whose closure holds the old id is exactly the defect being fixed.
- **The new closure captures `to`.** `setTimeout(() => this.fireIdle(to), ...)` — a carried
  timer would call `fireIdle(tabId)` against a map that no longer has that key, which is a
  silent no-op that loses the trigger entirely (worse than a wrong fire, because nothing
  surfaces).
- **`remaining`, not the full window.** Pinned by two specs that advance the fake clock
  two-thirds through the window _before_ firing the rekey and then assert the trigger
  fires after only the remainder. A full-window re-arm fails both.

`Math.max(0, remaining)` covers the case where the due instant has already passed (fake
timers, a long GC pause): the timer fires on the next tick rather than being armed with a
negative delay.

### 3.5 How refuse-overwrite is enforced, uniformly

Mirroring `SessionRegistry.bindRealSessionId`'s set-once discipline. Every migrated
structure asks the same question — _does `toId` already hold something?_ — and if so
**keeps it** and discards the `fromId` entry:

| Structure                                                                | Enforcement                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `MemoryTriggerService.sessions`                                          | `if (this.sessions.has(to))` → discard `from`, clear its timer             |
| `MemoryTriggerService.lastCurateAt`                                      | `if (!this.lastCurateAt.has(to))` guards the write                         |
| `MemoryTriggerService.inFlightCurates`                                   | Set — "keep" and "add" coincide; idempotent                                |
| `EpisodeTracker.rekey`                                                   | `if (this.sessions.has(toId)) return false` after deleting `from`          |
| `MemoryCuratorService.inFlight`                                          | `if (this.inFlight.has(nextKey)) continue` — `from` left to self-clean     |
| `SkillTriggerService.sessions` / `turnCompleteStates` / `editTestStates` | `if (map.has(to))` → discard `from`                                        |
| `SkillSynthesisService.analyzedSessions`                                 | `if (!this.analyzedSessions.has(to))` guards the write                     |
| `skill_synthesis_queue` (SQL)                                            | `UPDATE OR IGNORE` + `DELETE` remainder — the pre-existing `toId` row wins |

Five specs pin it directly (memory trigger, skill trigger, episode tracker, curator
in-flight, skill queue store), each asserting both halves: the destination is _unchanged_
and the discarded entry's timer/handle is _cleared_, not merely orphaned.

On `analyzedSessions` the "keep `toId`" choice deserves its own sentence, because it is the
one place where the two candidate values are both plausible: the surviving value was
recorded under the canonical id, and a stale **higher** count would suppress legitimate
re-analysis, while a stale **lower** one costs at most one redundant round trip against
`UNIQUE(session_id, stage)`'s durable guard. Pinned by _"keeps the destination mark and
discards the tabId one when toId already exists"_.

### 3.6 What was deliberately NOT folded in

The three existing tabId→UUID remaps — `SessionRegistry.bindRealSessionId`,
`SubagentRegistryService.resolveParentSessionId`, `AgentProcessManager.resolveParentSessionId`
— are untouched and are not consumers of the new registry. They are already correct.

---

## 4. The SQLite backfill: transaction boundary and the R5 collision

### 4.1 `observation_queue` — `ObservationQueueStore.backfillSessionId`

```
BEGIN IMMEDIATE;
UPDATE observation_queue SET session_id = ? WHERE session_id = ?;
COMMIT;
```

Returns the row count; a throw rolls back, logs a `warn`, and returns `0` rather than
unwinding out of the rekey handler.

**Why there is no collision here at all**: migration `0016` declares no UNIQUE key on
`observation_queue` beyond the `INTEGER PRIMARY KEY AUTOINCREMENT`. Rows already under
`toId` are simply _joined_ by the migrated ones. Pinned by _"joins rows already present
under the destination id rather than replacing them"_.

**Why this matters at all**: `drainForSession`, `peekForSession` and `countUnprocessed` all
filter `WHERE session_id = ?`, and `purgeOlderThan` deletes only rows that WERE processed —
so an un-migrated row is un-drainable **and** un-reapable. That is the same sentence the
§0 `insert` guard's own doc comment uses, and it is why the backfill exists.

I switched from `db.transaction(fn)` (better-sqlite3-only) to the explicit
`BEGIN IMMEDIATE` idiom that `SkillQueueStore` already uses. Two reasons: both halves of a
rekey now commit the same way, and the explicit form runs under `node:sqlite`, which is
what lets the spec actually execute on a machine where better-sqlite3 is built for
Electron's ABI (§7.2). `markProcessed`'s existing `db.transaction` call is untouched.

### 4.2 `skill_synthesis_queue` — `SkillQueueStore.backfillSessionId` (R5)

```
BEGIN IMMEDIATE;                                   -- via inImmediateTransaction
UPDATE OR IGNORE skill_synthesis_queue SET session_id = ? WHERE session_id = ?;
DELETE FROM skill_synthesis_queue WHERE session_id = ?;   -- the un-migrated remainder
COMMIT;
```

Returns `{ migrated, discarded }`.

**The collision is the normal case, not a corner.** `UNIQUE(session_id, stage)`
(`skill-queue.store.ts:7` and `:197`, both exact at the tree) means a row for
`(toId, stage)` very likely already exists — the same session enqueues the same stage under
its canonical id the moment that id exists. A bare `UPDATE` raises
`SQLITE_CONSTRAINT_UNIQUE`, the exception unwinds out of `SkillTriggerService.rekeySession`,
and **the in-memory half of the migration is abandoned half-done**. That is R5, and it is
why the two-statement form is required rather than merely tidy.

`UPDATE OR IGNORE` migrates everything that does not collide; the `DELETE` then removes
what could not move. **The pre-existing `toId` row wins** — the same refuse-overwrite rule
the maps follow, and the correct one here because that row was enqueued under the canonical
id, so its `turn_count` is the value the guarded re-open should be comparing against.

Both statements run inside the **one** `BEGIN IMMEDIATE`, so a second host draining the
shared `~/.ptah/state/ptah.sqlite` can never observe the intermediate state in which both
rows exist. That matters: `CLAIM_SQL` gates on `status` alone, so a mid-transaction claim
would be exactly the defect `enqueue`'s own single-transaction design was fixed to prevent.

**Verified against a real SQLite engine**, not a mock — the spec drives the real
`SkillQueueStore` over a real file DB (`queue-db.test-support.ts`), asserts
`expect(() => ...).not.toThrow()`, and asserts the surviving row is the one with
`source: 'session-end'` / `turnCount: 9` rather than the stale `turnCount: 2`. Also
asserted: a three-row case where one stage collides and another does not migrates the
non-colliding one and discards only the colliding one (`{ migrated: 1, discarded: 1 }`).

### 4.3 The transaction boundary as a whole

The plan asks for the SQL "in the same transaction as the map migration". A JavaScript
`Map` has no transaction, so the honest statement of what was built is:

> The whole rekey — every map migration and both SQL writes — executes inside **one
> synchronous turn of the event loop**, with no suspension point anywhere. The SQL half of
> each store commits inside **one `BEGIN IMMEDIATE` … `COMMIT`**. Nothing can observe a
> partially-migrated in-memory state, and no other process can observe a partially-migrated
> table.

A SQL failure is contained: `observation_queue` rolls back, warns and returns `0`;
`skill_synthesis_queue` rolls back and rethrows through `inImmediateTransaction` — but by
construction the only error it can raise is one `UPDATE OR IGNORE` + `DELETE` cannot
produce, which is why the R5 spec asserts `not.toThrow()` directly.

### 4.4 With B5a landed, this finds zero rows in the common case

Correct, and the specs are written so it is still correct when it does find rows. The
residual it exists for is a hook payload that genuinely lacks `session_id` and falls back
to the tabId-bearing closure — verified-assumptions row 9's path.

### 4.5 No `LIKE 'tab\_%'` anywhere

`grep -rn "LIKE" ` over every file I touched returns **four hits, all inside comments**
explaining that such a predicate must never be written
(`observation-queue.store.ts:274`, `skill-queue.store.ts:271`,
`0039_reap_orphaned_queue_rows.ts:20` and `:21`). Zero executable occurrences.

Two specs pin the absence **mechanically** rather than by diff inspection, by reading the
compiled method bodies with `Function.prototype.toString()`:

```
expect(SkillQueueStore.prototype.backfillSessionId.toString()).not.toMatch(/LIKE/i);
expect(ObservationQueueStore.prototype.backfillSessionId.toString()).not.toContain('tab_');
```

plus a third over the migration's SQL text.

---

## 5. Migration 0039 — the reaping rationale, reproduced in full

**File**: `0039_reap_orphaned_queue_rows.ts`. Registered as
`{ version: 39, name: '0039_reap_orphaned_queue_rows', sql: sql0039ReapOrphanedQueueRows }`.
Verified before writing: `index.ts`'s last entry was
`{ version: 38, name: '0038_gateway_message_turn_state' }`. **0039 is correct.**

### 5.1 Why this REAPS and does not RECONCILE

- **The tabId→UUID mapping lives only in the in-memory `SessionRegistry` and is never
  persisted.** Nothing on disk records which tabId belonged to which session, so a
  migration has **nothing to join on**. Reconciliation of historical rows is
  **impossible, not merely deferred.** Do not attempt one, and do not let a reviewer ask
  for one. **This is a recorded USER DECISION** (plan §6c Q1).
- **A shape test is no help either.** A tabId is itself a UUID v4 (`TabId.create()` →
  `uuidv4()`), so a tabId and an SDK session id are indistinguishable by inspection; the
  legacy `tab_<ts>_<id>` format is retired and rejected at the chat RPC boundary, so a
  `LIKE 'tab\_%'` predicate would match only long-dead rows and is wrong by construction.
- **The orphaned rows are internal work-queue entries** — pending observations to curate,
  pending synthesis stages — **not user data**. Conversations live in the SDK's JSONL files
  under `~/.claude/projects/` and are untouched by this migration and by every other part
  of TASK_2026_296. The cost of reaping is some un-curated memories and un-synthesised
  skills from old sessions.
- **Nothing else would ever reclaim them.** `ObservationQueueStore.purgeOlderThan` deletes
  only rows that WERE processed, and `skill_synthesis_queue` has no purge at all — so an
  orphan sits in the table forever, counted by `countUnprocessed` for a session that can
  never be curated. This is not a hypothetical leak; it is the exact wording of the §0
  `insert` guard's own doc comment, applied to a row that got past it under a real but
  non-canonical id.
- **`SqliteMigrationRunner` applies numbered, forward-only migrations automatically at
  boot**, atomic per migration, idempotent via `schema_migrations`, with
  `SqliteBackupService` available for pre-migration backup. **There is no manual
  post-deploy step.**
- **`SessionImporterService` is NOT the mechanism.** It scans `~/.claude/projects/*.jsonl`
  and imports session _metadata_ for the UI. It never touches `observation_queue` or
  `skill_synthesis_queue`. It was **not** wired into this task.

### 5.2 Exactly which rows it deletes

```sql
DELETE FROM observation_queue
 WHERE processed_at IS NULL
   AND captured_at < (CAST(strftime('%s', 'now', '-30 days') AS INTEGER) * 1000);

DELETE FROM skill_synthesis_queue
 WHERE status = 'queued'
   AND attempt_count = 0
   AND finished_at IS NULL
   AND depends_on IS NULL
   AND enqueued_at < (CAST(strftime('%s', 'now', '-30 days') AS INTEGER) * 1000)
   AND NOT EXISTS (
         SELECT 1 FROM skill_synthesis_queue AS dependent
          WHERE dependent.depends_on = skill_synthesis_queue.id
       );
```

Static text; the cutoff is computed by SQLite, so there is no `${...}` interpolation
(ESLint `no-template-curly-in-migration` / Semgrep `sql-injection-in-migration`). The
`* 1000` is because both `captured_at` and `enqueued_at` are written in epoch
**milliseconds** by `Date.now()`.

### 5.3 Exactly which rows it provably does NOT delete

| Category                                                                                     | Guard                       |
| -------------------------------------------------------------------------------------------- | --------------------------- |
| Every **processed** observation                                                              | `processed_at IS NULL`      |
| Every **advanced** queue row — `claimed`, `running`, `done`, `failed`, `skipped`, `unscored` | `status = 'queued'`         |
| Every queue row that has been **attempted**                                                  | `attempt_count = 0`         |
| Every queue row that **finished**                                                            | `finished_at IS NULL`       |
| Every row **inside the retention window**, in both tables                                    | the `< cutoff` clause       |
| Every queue row that **depends on** another                                                  | `depends_on IS NULL`        |
| Every queue row that is **depended upon**                                                    | the `NOT EXISTS` sub-select |

`unscored` deserves the explicit call-out: a row that RAN and produced no usable verdict is
re-eligible under `not_before` and is **not** an orphan. Pinned by name in the spec.

The last two guards are belt-and-braces against stranding: `0032` declares
`depends_on ... ON DELETE SET NULL`, but that only fires when `PRAGMA foreign_keys` is on,
and `ELIGIBLE_SQL` requires an ancestor to be `done` — so a dangling `depends_on` would
strand a dependent forever. Declining to reap either end costs nothing (no current producer
sets `dependsOn`) and removes the failure mode entirely. Pinned by _"never strands a
dependent — ancestors and dependents survive"_.

### 5.4 The retention window — and a documented drift

The brief and the plan both say "older than **the existing retention window**". **There is
no existing retention window.** Verified: `ObservationQueueStore.purgeOlderThan` has **zero
production callers** anywhere in `libs/` or `apps/` (it is called only from a spec double),
and `skill_synthesis_queue` has no purge at all. A repo-wide grep for
`retentionDays|maxAgeDays|Retention` across `memory-curator`, `skill-synthesis` and
`persistence-sqlite` returns nothing. So the window had to be **chosen**, and the choice is
recorded here and in the migration's own header rather than being smuggled in as
"the existing one".

**30 days**, deliberately generous:

- It is more than four times the longest retention precedent in the repo
  (`VOICE_RETENTION_MS`, 7 days, `messaging-gateway`).
- It is far longer than any session can plausibly stay open, which is what makes "must not
  touch rows inside the window" hold with room to spare for a live install upgrading
  mid-session.
- Erring long follows the same "miss rather than wrongly delete" rule the in-memory rekey
  follows (R4): leaving an orphan behind is recoverable at the next boot; deleting a live
  row is not.

### 5.5 Behaviour verified against a real SQLite engine

The behaviour block does not merely skip. It uses a `better-sqlite3` → `node:sqlite`
fallback opener (§7.2) and all five behaviour tests execute:

| Spec                                                      | Asserts                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| reaps only unprocessed observations older than the window | of 4 seeded rows, only the ancient-unprocessed one goes                                                                     |
| reaps only un-advanced queue rows older than the window   | of 6 seeded rows, only `a-stale` goes; `c-attempted`, `d-running`, `e-done`, `f-unscored` and the in-window row all survive |
| never strands a dependent                                 | an ancestor+dependent pair, both ancient and un-advanced, both survive                                                      |
| is a no-op on a database with nothing stale               | **the paired-isolation sibling** — everything survives                                                                      |
| re-run is a no-op via the runner ledger                   | `appliedVersions [39]` then `[]` / `skippedVersions [39]`                                                                   |

I additionally executed the migration SQL out-of-band against `node:sqlite` directly before
writing the spec, to confirm the result set independently of my own harness.

---

## 6. Diff audit against the §6d invariant table

Every file below was checked with `git status --porcelain` (absent from the modified list =
not modified by anyone) **and** by reading the exact line at the tree.

| #   | Invariant                                                            | Location (verified now)                                                                   | Status                                                                                                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `const trackingId = tabId as SessionId;`                             | `sdk-agent-adapter.ts:490` (brief said `:480`; my +10 lines above it shifted it — see §8) | **UNTOUCHED.** Statement byte-identical; my diff contains no hunk near it.                                                                                    |
| 2   | `const registerKey = sessionConfig?.tabId ?? (sessionId as string);` | `helpers/session-lifecycle/session-query-executor.service.ts:118`                         | **UNTOUCHED.** File not modified. Line exact.                                                                                                                 |
| 3   | MCP URL routing segment; a missing id throws `SdkError`              | `sdk-query-options-builder.ts:1153-1184`, guard at `:1164`                                | **UNTOUCHED.** File not modified. `:1164` still reads `if (!routingSessionId \|\| routingSessionId.trim().length === 0) {` — the B3b hard exclusion, unswept. |
| 4   | `extractCallerSessionId` parses `[^/?]+`                             | `vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:145`              | **UNTOUCHED.** File not modified.                                                                                                                             |
| 5   | `resolveHookSessionId` returns `null`, never `''`                    | `agent-sdk/.../helpers/hook-session-resolver.ts`                                          | **UNTOUCHED.** File not modified.                                                                                                                             |
| 6   | `IAgentAdapter.setSessionIdResolvedCallback`                         | `libs/shared/src/lib/types/agent-adapter.types.ts:253`                                    | **UNTOUCHED.** File not modified; `:253` still exact: `setSessionIdResolvedCallback(cb: SessionIdResolvedCallback): void;`                                    |

Additional §0 / §6f checks:

- **`cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`** — **not modified**; `:155` still
  `sdkAdapter.setSessionIdResolvedCallback(`. It keeps working unchanged: the single-slot
  setter's behaviour is byte-identical and a spec asserts it still fires with
  `(TAB_ID, REAL_ID)` on both paths, _alongside_ the new registry.
- **`sdk-adapter-callback-registry.ts`** (the single-slot registry) — **not modified**. The
  audit's proposal to promote it into a fan-out remains REJECTED; a twelfth registry was
  added alongside.
- **`SdkAgentAdapter` init-callback blank refusal** (§0) — intact at `:687`,
  `blankToUndefined(realSessionId) === undefined`, with its `logger.warn` and early return.
  Strengthened, not bypassed: my notify sits after it, and a spec pins that a blank init id
  fires no rekey signal.
- **`ObservationQueueStore.insert` blank refusal** (§0) — intact at `:130-137`, B3b's
  `blankToUndefined(...) === undefined` form, with its warn and early return. A spec in the
  new file (_"still refuses a blank sessionId at insert — the §0 guard is intact"_) pins
  that the backfill is not a licence to start writing blank rows.
- **`SessionRegistry.bindRealSessionId` blank refusal** (§0) — not modified by me; intact
  at `session-registry.service.ts:158`.
- **`skill-candidate.store.ts:604`, `subagent-rpc.handlers.ts:143`,
  `hook-session-resolver.ts:32,:35`, `sdk-permission-handler.ts:1030`** — none opened.
- **`agent-monitor.store.ts`** — not opened, not split (plan §7).
- **No `LIKE 'tab\_%'` anywhere in the diff** — §4.5.
- **The three existing tabId→UUID remaps** — not folded in, not modified.

Files in `git status` that are **B3b's / B5a's uncommitted work, not mine**, and which I did
not open for writing: `agent-sdk/.../session-registry.service.ts`,
`agent-sdk/.../session-importer.service.ts`, `agent-sdk/.../session-metadata-store.ts`,
`memory-curator/.../memory.store.ts`, `skill-synthesis/.../skill-candidate.store.ts`,
`skill-synthesis/.../skill-invocation-recorder.ts`. (`agent-sdk/CLAUDE.md` was B5a's; I
added two lines to it — §1.)

---

## 7. The Part B specs (task 5b.6)

### 7.1 The five required assertions, and where each lives

| #   | Required                                                                                                                      | Where                                                                                                                                                                                                                              | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Rekey + teardown**: state under the tabId, fire rekey, `SessionEnd` under the UUID → tabId timer cleared, no entry survives | `memory-trigger.service.spec.ts` _"a SessionEnd under the UUID clears state registered under the tabId, timer included"_ + `skill-trigger.service.spec.ts` _"...both timers included"_                                             | ✅ ×2  |
| 2   | **Refuse-overwrite** (R4): `toId` kept, `fromId` discarded, its timer cleared, `toId` unchanged                               | `memory-trigger`, `skill-trigger`, `episode-tracker`, `memory-curator.service` (in-flight), `skill-synthesis.service.enqueue` (turn-count mark), `skill-queue.store.rekey` (SQL)                                                   | ✅ ×6  |
| 3   | **Double-curate guard** (Q3): start a curate, rekey mid-flight, exactly one curate ran                                        | `memory-curator.service.spec.ts` _"runs exactly one curate when the rekey lands mid-flight"_ — drives the **real** `MemoryCuratorService` with a gated LLM double                                                                  | ✅     |
| 4   | **Constraint collision** (R5): no throw, pre-existing row wins, remainder deleted                                             | `skill-queue.store.rekey.spec.ts` — **real SQLite**, real `UNIQUE(session_id, stage)`                                                                                                                                              | ✅     |
| 5   | **Paired-isolation sibling**: a session whose id never resolves is torn down under its tabId                                  | `memory-trigger.service.spec.ts` + `skill-trigger.service.spec.ts`, both _"a session whose id never resolves is still torn down under its tabId"_ (written fresh rather than reusing B5a's, so each service pins its own teardown) | ✅ ×2  |

Beyond the five: the **remaining-delay** re-arm gets its own spec per service (the memory
one advances 66 s of a 100 s window then asserts firing after 35 s more; the skill one
covers both the 90 s debounce and the idle timer in one run); `subscribes on start() and
disposes on stop()` per service; a blank/absent/identical-id no-op sibling per service and
per store; and the curator's map-drain spec from §3.3.

**Every "must reject" assertion has a legitimate-path sibling.** Examples: the
refuse-overwrite specs each assert the destination _still works_ (its timer fires, its
promise still serves callers, its mark still suppresses); the `analyzedSessions`
refuse-overwrite has _"re-enqueues once the session grows past the migrated count"_ so the
migration cannot degrade into a permanent seen-set; migration 0039's reap specs are paired
with _"is a no-op on a database with nothing stale"_.

**Real UUID v4 strings on both sides, in every spec.** `TAB_ID =
'4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21'`, `REAL_ID =
'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70'`, `OTHER_ID =
'f31c8a2d-55b6-4e19-9a07-1d8c4b2e6f93'`. `tab_N` appears nowhere — it would have made the
specs pass for the wrong reason by implying a detectable shape that does not exist.

### 7.2 One methodological choice worth flagging

`better-sqlite3` in this repo is rebuilt against Electron's ABI by postinstall
(`NODE_MODULE_VERSION 143` vs Node's `137` — I hit the exact error), so the native-only
probe that `0038_gateway_message_turn_state.spec.ts` uses causes its whole behaviour block
to **skip permanently** on a normal dev machine and in this runner.

For the two store backfills and for migration 0039 — whose behaviour _is_ the deliverable,
and specifically whose "which rows it provably does not touch" half is the thing a reviewer
most needs pinned — I used the `better-sqlite3` → `node:sqlite` fallback opener that
`skill-synthesis/src/lib/queue/queue-db.test-support.ts` already establishes for exactly
this reason ("the assertions these specs exist for … are exactly the ones that must not be
permanently skipped"). Same SQLite engine, different binding. The reasoning is written into
each spec header. Result: **all 9 migration-0039 tests, all 6 skill-queue tests and all 6
observation-queue tests actually execute** rather than reporting a green skip.

---

## 8. Line-number drift and factual errors found in the docs

| #   | Claim                                                                                                                                                                   | Reality at the tree                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Delete rows **older than the existing retention window**" (plan §6c Q1, brief 5b.7)                                                                                    | **There is no existing retention window.** `ObservationQueueStore.purgeOlderThan` has **zero production callers**; `skill_synthesis_queue` has no purge at all; no `retention`/`maxAge` constant exists in any of the three libs. The window had to be chosen — 30 days, justified in §5.4 and in the migration header rather than presented as inherited. **This is the most substantive doc error in the batch.** |
| 2   | `memory-curator.service.ts` `inFlight` key at `:243` (plan §6b, tasks.md 5b.4)                                                                                          | **`:244`** — the brief's re-derivation was right and the plan is stale. `:242` is `const sessionId = blankToUndefined(input.sessionId);`, `:243` the `return null`, `:244` the template literal.                                                                                                                                                                                                                    |
| 3   | `sdk-agent-adapter.ts` resume `bindRealSessionId` / `emitSessionIdResolved` at `:628` / `:631` (brief)                                                                  | ✅ exact **before** my edit. Now `:628` / `:641`.                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | new-session `bindRealSessionId` / flush / `emitSessionIdResolved` at `:682` / `:685` / `:689` (brief)                                                                   | `:682` ✅ and `:689` ✅; the flush is at **`:686`**, not `:685` (`:683-685` are its three-line comment). Trivial, recorded for completeness. Now `:701` / `:705` / `:708`.                                                                                                                                                                                                                                          |
| 5   | `trackingId = tabId as SessionId` at `:480` (brief)                                                                                                                     | ✅ exact before my edit. Now **`:490`** — my ctor parameter added 10 lines above it. **Not modified.**                                                                                                                                                                                                                                                                                                              |
| 6   | `session-query-executor.service.ts:118`, `agent-adapter.types.ts:253`, `session-control.service.ts:126`/`:212`, `skill-queue.store.ts:7`/`:197`, migrations index at 38 | ✅ all exact, all confirmed.                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Path: the brief and plan cite `session-query-executor.service.ts` bare                                                                                                  | It is at `libs/backend/agent-sdk/src/lib/helpers/**session-lifecycle**/session-query-executor.service.ts`. Minor, but it cost a lookup.                                                                                                                                                                                                                                                                             |
| 8   | B5a report §7: "`agent-sdk` lint = 37 × `no-non-null-assertion` + **1** × `max-lines` on `sdk-agent-adapter.ts` (891)"                                                  | The 38 total is right, the breakdown is not: `agent-sdk` has **three** `max-lines` warnings — `sdk-query-options-builder.ts` (822), `sdk-agent-adapter.ts` (**823**, not 891) and `sdk-permission-handler.ts` (**891**). The 891 figure belongs to a different file. `agent-sdk` is still at exactly 38 warnings / 0 errors after B5b, i.e. **my additions produced zero new lint warnings there**.                 |
| 9   | Plan §6a Correction 2 / tasks.md 5a.2: "the hook closure holds `undefined`"                                                                                             | **Not reasserted.** Verified-assumptions row 9 is correct — it holds the **tabId** — and that is precisely the residual path this batch's rekey reconciles. The design is built on row 9, and the new `CLAUDE.md` bullet says tabId, not `undefined`.                                                                                                                                                               |
| 10  | Not a doc error, but an undocumented hazard nobody had written down                                                                                                     | `MemoryCuratorService.curate`'s `.finally` closure captures the ORIGINAL in-flight key, so a naive map migration strands the destination entry permanently — a _worse_ failure than the double-curate the rekey exists to prevent. §3.3.                                                                                                                                                                            |

---

## 9. Explicit answers to the questions the brief asked

### 9.1 Does the rekey cover state armed via `sdk-agent-adapter.ts:718` / `:753`? — **Yes, completely.**

Those two call sites (`sendMessageToSession` and `executeSlashCommand`, now `:737` / `:772`
after my +19 lines) are B5a report §3.2's narrower second instance of the same pre-resolve
window: a caller sending a second message before `init` lands finds `rec.realSessionId ===
null`, so `resolveActivityIds` returns the **tabId** and `notifyActivity` publishes under
it.

The rekey covers this for a concrete structural reason, not by coincidence: **it is
id-agnostic.** It does not care _which_ emitter armed the state or _why_ — it migrates
every entry found under `fromId`, whatever put it there. A `notifyActivity(tabId, 'user')`
from `:718`/`:753` reaches `MemoryTriggerService.onActivity` and `SkillTriggerService.onActivity`,
which arm exactly `sessions` (+ its idle timer) — and `sessions` and its timer are the first
thing both `rekeySession` implementations migrate, timer re-armed with the remaining delay.

Two boundary conditions, both satisfied:

- **Ordering.** Both call sites are pre-`init` by construction in the scenario B5a
  describes, and the rekey fires _from_ the `init` callback. So the state is armed strictly
  before the migration runs. If the message instead lands _after_ `init`, the id is already
  canonical and there is nothing to migrate — the rekey is a no-op either way.
- **The never-resolves case.** If `init` never arrives, no rekey fires, the state stays
  under the tabId, and `SessionEnd` also resolves to the tabId
  (`realSessionId ?? rec.tabId`). Both ends agree. Pinned by the paired-isolation sibling in
  both trigger specs.

The one thing the rekey does **not** do is un-publish an activity payload already delivered
to a subscriber under the tabId — no correction event, by design (§2.3 of B5a's report).
That is not a gap: the _state_ those payloads armed is what matters, and that state is
migrated. I did **not** add buffering to `:718`/`:753`; B5a's reasoning that it would need
an unbounded queue and would delay legitimate post-init activity in the overwhelmingly
common case still holds, and the rekey is the cheaper and complete answer.

### 9.2 `teammateIdle` — left subscriber-less and undeleted. **Confirmed.**

`sdk-adapter-events.service.ts` is **not in my diff at all**. It still declares
`teammateIdle` (`:92`), emits it (`:136`) and exposes `onTeammateIdle` (`:191-195`). I did
not subscribe to it, did not treat it as a consumer, and did not delete it. It remains
confirmed intentional aspirational surface with a documented reason for having no
subscriber.

---

## 10. Verification — raw numbers

### Typecheck

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core,persistence-sqlite --skip-nx-cache
```

**`NX Successfully ran target typecheck for 20 projects`** — 20/20, 0 errors.
(19 at baseline + `persistence-sqlite`.)

### Test

```
npx nx run-many -t test -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core,persistence-sqlite --skip-nx-cache
```

**19 projects — 10,572 passed · 197 skipped · 0 failed.**

Per project: 1093 · 365 · 530 · **1027** (`agent-sdk`) · **192 + 69 sk** (`persistence-sqlite`) ·
241 · 402 · **348 + 57 sk** (`memory-curator`) · 805 · 21 · **1312 + 37 sk** (`skill-synthesis`) ·
329 + 1 sk · 112 · 845 + 2 sk · 36 · 333 · 37 · 143 · **2401 + 31 sk** (`rpc-handlers`).

**`persistence-sqlite` broken out**, so the baseline comparison stays honest:

|                                 | passed                                                 | skipped |
| ------------------------------- | ------------------------------------------------------ | ------- |
| `persistence-sqlite` before B5b | 183                                                    | 69      |
| `persistence-sqlite` after B5b  | **192**                                                | **69**  |
| its contribution                | **+9** (migration 0039 spec: 4 registry + 5 behaviour) | 0       |

**The 18-project set against the 10,332 / 128 baseline: 10,380 / 128 — exactly +48, all
accounted for by name:**

| Project             | baseline | now      | delta   | new specs                                                                          |
| ------------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `agent-sdk`         | 1017     | **1027** | **+10** | 7 registry spec + 3 adapter emit-site specs                                        |
| `memory-curator`    | 327      | **348**  | **+21** | 7 memory-trigger + 6 observation-queue rekey + 5 curator rekey + 3 episode-tracker |
| `skill-synthesis`   | 1295     | **1312** | **+17** | 7 skill-trigger + 6 skill-queue rekey + 4 synthesis-service rekey                  |
| every other project | —        | —        | **0**   | —                                                                                  |

Skipped unchanged at 128 for the 18-project set. **Nothing dropped.**

### Flake observed — R10, and how it was re-run

`rpc-handlers:test` failed **once**, in the full parallel run:
`libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.spec.ts` —
**1 failed / 31 skipped / 2400 passed**, with `A worker process has failed to exit
gracefully` on the same worker.

Re-run isolated: `npx nx run rpc-handlers:test --skip-nx-cache` →
**86 suites passed, 2401 passed / 31 skipped / 0 failed.** An _earlier_ full uncached run of
the same gate also reported `rpc-handlers` at 2401 / 31 / 0. So it reproduced neither
isolated nor on a second full run.

This is the known R10 parallel-load flake, and the file involved
(`skills-sh-legacy-adoption.spec.ts`) is one I did not touch and which is in a lib this
batch does not modify. **Reported, not swallowed.** `chat:test`, the other known flake, did
not fire.

### Lint

```
npx nx run-many -t lint -p agent-sdk,memory-curator,skill-synthesis,persistence-sqlite --skip-nx-cache
```

**`NX Successfully ran target lint for 4 projects` — 0 errors across all four.**

| Project              | result                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `agent-sdk`          | 38 problems (0 errors, 38 warnings) — **identical to B5a's 38**; my additions added none                                       |
| `memory-curator`     | 6 problems (0 errors, 6 warnings) — all pre-existing except the `max-lines` note below                                         |
| `skill-synthesis`    | 35 problems (0 errors, 35 warnings)                                                                                            |
| `persistence-sqlite` | **✔ All files pass linting** (0 problems) — the new migration + spec are clean under the `no-template-curly-in-migration` rule |

`memory-contracts` is not in this batch's touched set, so the
`@ptah-extension/memory-contracts:eslint:lint` special case did not apply.

`libs/frontend/core` coverage floor (statements 85% / lines 85%): `core:test` passed at
143/143. **No threshold was lowered anywhere.**

**One new warning I introduced**, disclosed rather than fixed:
`skill-trigger.service.ts` crossed the 700-line warn-level soft ceiling (now **754** by
eslint's count). It was ~644 before. See §11.1 — plan §7 forbids opportunistic splitting in
this task. `memory-trigger.service.ts` (899) and `skill-synthesis.service.ts` (937) were
already over before this batch; `sdk-agent-adapter.ts` moved 813 → 823, already over.

---

## 11. Deliberately left alone — follow-ups

1. **`skill-trigger.service.ts` crossed the 700-line soft ceiling** (644 → 754). I created
   that condition and did not fix it, because plan §7 forbids opportunistic splitting in
   this task. If it is ever split, the facade rule applies: `SkillTriggerService` keeps its
   name, DI token and method signatures, and the nameable single concern to extract is the
   **trigger timer bookkeeping** — `sessions` / `turnCompleteStates` / `editTestStates`,
   their arm/clear/re-arm logic and `rekeySession`'s timer half (~150 lines) — as an
   injected collaborator, e.g. `SessionTimerRegistry`. Note the same collaborator would
   serve `MemoryTriggerService`, which has the identical shape and is at 899.
2. **`sdk-agent-adapter.ts` at 823** — pre-existing (B5a's §9 item 1 already recorded the
   `SessionActivityPublisher` extraction). My additions there are 1 ctor param + 2 notify
   calls + comments; kept minimal as instructed.
3. **The 0039 retention window is a new constant with no home.** 30 days lives as a literal
   inside the migration's SQL, which is correct for a one-shot migration but means a future
   _recurring_ reaper would have to re-derive it. If `purgeOlderThan` ever gains a caller,
   the two should agree and the value should move to a named export. Recorded, not done —
   giving `purgeOlderThan` a caller is a behavioural change with its own justification.
4. **`ObservationQueueStore.purgeOlderThan` has zero production callers.** Genuinely dead
   today, and it means unprocessed observations are never reclaimed by anything except this
   one migration. Not deleted (it is a correct, tested API and deleting it would be exactly
   the "the type/absence prevents it" mistake in another register), and not wired up. Filed
   as an observation for whoever owns memory-curator retention.
5. **`agent-monitor.store.ts` (~1,610 lines)** — not opened, not split (plan §7).
6. **B5a report §7's lint breakdown** should be annotated with §8 item 8, so the "891"
   figure is not carried forward against the wrong file.
7. Still outstanding from earlier batches and untouched here: the 9 `?? undefined` no-ops
   (census §Latent), `agent-card.component.ts:229-236` swallowing its RPC result, and F1
   (`ptah agent-cli resume` is dead).

---

## 12. Standing-rules compliance

| Rule                                                                          | Status                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. No §0 guard deleted; none deleted on "the type prevents it" grounds        | ✅ Two §0 guards sit directly in my blast radius (`ObservationQueueStore.insert`, the `SdkAgentAdapter` init-callback refusal). Both intact, and each now has a **new spec asserting the B5b code respects it** — the backfill does not license blank inserts, and a blank init id fires no rekey. |
| 1b. A widened type does not mean the runtime value IS `undefined` (row 9)     | ✅ The `undefined` claim was not reasserted anywhere; the design is built on the closure holding the **tabId**, and the new `CLAUDE.md` bullet says so.                                                                                                                                            |
| 2. Spot-check every line number before editing                                | ✅ All 14 read at the tree first. Found one substantive doc error (§8 item 1), two line drifts and one wrong lint attribution.                                                                                                                                                                     |
| 3. Zero specs deleted                                                         | ✅ Three pre-existing assertions were **adapted** (the migration-version ratchet, `38 → 39`), which is what that assertion's own comment says it is for. Nothing removed.                                                                                                                          |
| 4. Every "must reject" assertion has a legitimate-path sibling                | ✅ Enumerated in §7.1.                                                                                                                                                                                                                                                                             |
| 5. No git commits / staging / stashing / reverting                            | ✅ Only read-only `git status --porcelain` was run.                                                                                                                                                                                                                                                |
| 6. No stubs, placeholders, TODOs, hardcoded mock data                         | ✅                                                                                                                                                                                                                                                                                                 |
| 7. No opportunistic refactoring or file splitting                             | ✅ Recorded in §11 instead. The one idiom change (`db.transaction` → explicit `BEGIN IMMEDIATE`) is confined to the new method and justified in §4.1.                                                                                                                                              |
| Stayed out of `apps/ptah-cli` and `rpc-handlers/src/index.ts` (TASK_2026_297) | ✅ Neither opened. `rpc-handlers` appears in my report only as the flaky test I re-ran.                                                                                                                                                                                                            |
| No `LIKE 'tab\_%'` predicate anywhere                                         | ✅ §4.5 — four comment-only mentions, zero executable, three mechanical specs pinning the absence.                                                                                                                                                                                                 |
| Real UUID v4 strings for both ids in every spec                               | ✅ §7.1.                                                                                                                                                                                                                                                                                           |
