# Backend implementation — `TASK_2026_538_3ccf`, batch 9

**Tasks completed**: 9.1 `SurfaceOperationLedger`, 9.2 `SurfaceStateStore`, 9.3 `surface-state-reader.ts`

**Executor**: backend-developer subagent. No CLI lanes were used, so codex has not touched this batch and can review it
independently.

## Files

All new files. Nothing existing was modified. Line counts are after prettier; every file is under the 700-line
ceiling.

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-operation-ledger.ts` (421 lines): the ledger, `fingerprintSurfaceOperation` (sha-256 via `node:crypto`), `canonicalSurfaceJson` and `surfaceOperationIssuedAt`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-operation-ledger.spec.ts` (409 lines, 22 cases).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.store.ts` (417 lines): the store, `SurfaceRecord`, `createSurfaceRecord`, and the ticket and room reservations.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.store.spec.ts` (398 lines, 20 cases).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state-reader.ts` (288 lines): `SurfaceStateReader` (`read` and `describeForAgent`), `collectSurfaceFormValues` and `toSurfaceStateView`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state-reader.spec.ts` (405 lines, 15 cases).

Not touched, as instructed (Batch 10): `surface/index.ts`, `di/register.ts`, the facade and `src/index.ts`. No edit to
`surface.index.ts` was needed. Every v2 value used is already exported there: `SURFACE_STORE_LIMITS`,
`SURFACE_OPERATION_ID_PATTERN`, `SURFACE_LIMITS`, `createSurfaceWriteLog`, `appendWrite` (spec only),
`checkSubmitValues`, `collectSurfaceInputs`, `readSurfacePath` and `describeSurfaceSelection`.

## Stack observed

- TypeScript `strict: true`, CommonJS: `libs/backend/vscode-lm-tools/tsconfig.json`.
- Jest through Nx, specs colocated: the `surface-push.spec.ts` precedent.
- Imports follow the R8 rule:
  - v2 values come from `@ptah-extension/shared/mcp-apps-contracts/surface`.
  - Plain types come from `@ptah-extension/shared`. `libs/shared/src/index.ts:35` does `export type * from surface.types`.
  - `jsonUtf8Bytes` comes from `@ptah-extension/platform-core`, with the same import as `dashboard-namespace.builder.ts:26`.
  - There are no deep imports.
- The three units are plain classes with injectable options (limits, clock, charge source, byte counter). This is
  deliberate: the plan makes the facade (`SurfaceStateService`, Batch 10) the only DI singleton, and it constructs
  these units.

## Task 9.1: ledger evidence

Each rule below is followed by where the spec proves it.

- **Look up first.** An existing id answers `replay` for the same fingerprint (pending or terminal) or `conflict`
  (`operation-conflict`), whatever its issue time.
  - Specs: "replays the same fingerprint…", "answers conflict…", and "replays and conflicts whatever the issue time,
    even past the expiry window". The last one also shows that a fresh id with the same issue time is refused
    `operation-expired` at that moment.
- **Expiry for absent ids only**, over the window `[now - retention, now + skew]`, fail closed.
  - Specs: both window edges at the limit and one millisecond past it (the past edge and the future-dated edge).
  - An id with no readable issue time is refused `operation-expired`.
- **`forgetAt = max(settledAt, issuedAt) + retention`**, and a record is forgotten only when `now > forgetAt`.
  - I chose the strict `>` on purpose. At `now == forgetAt` the id's issue time equals `now - retention`, which would
    still pass the absent-id check.
  - Specs: "keeps a future-dated terminal id until issuedAt + retention, then it stays expired" and "forgets a
    terminal record strictly after forgetAt, so the id cannot come back". Both test the exact boundary and +1 ms.
- **Pending records are never forgotten.** The spec advances 30 days: still pending, still `replay`, still charged.
- **Monotonic clock**: `now = max(clock(), lastNow)`.
  - The spec rolls the clock back 1 hour. `now()` stays at T0, and an id that is valid only against the rolled-back
    clock is refused.
  - Settlement during the rollback stamps `settledAt` and `forgetAt` from ledger time.
- **Capacity, refused `too-many-operations`.**
  - Pending: `maxPendingOperationsPerRoutingId` fills exactly; one more is refused; it is accepted again after a
    settle.
  - Records: `maxOperationRecordsPerRoutingId` fills; one more is refused until the records are forgotten.
  - Routing ledgers: when the ledger count is full, a new routing id is refused. A ledger is dropped only when every
    record in it is forgotten. One spec keeps a ledger with a young record and drops the fully-forgotten one; another
    shows a ledger with a pending record is never dropped.
- **Store byte cap.** `reserve(routingId, request, admit?)` calls `admit(operationRecordBytes)` only when a NEW record
  would be created. A refusal is `too-many-operations` and leaves no record behind. A replay never calls it.
- **Other API.** `lookup()` returns `{ status: 'unknown' }` when the id is absent, including under another routing
  id. `settle()` works once and then answers `already-settled`, or `unknown`. `pendingCount(routingId, kind?)` serves
  the busy rule. `chargedBytes()` is `operationRecordBytes` for each unforgotten record.
- **Fingerprint.** It is sha-256 hex over canonical JSON: sorted keys, and `undefined` handled the way JSON handles it.
  - Keys are written as string literals, so a `__proto__` key stays data. A spec pins this and checks
    `Object.prototype` is not polluted.

## Task 9.2: store evidence

- **LRU touch.** `get`, `list` and `commit` touch both the surface and its routing id; `delete` touches the routing
  id. Recency is a tick counter, so eviction is a linear scan over at most 256 surfaces.
  - Specs: the per-routing and routing-bound cases change the victim by touching a surface first. The reader spec
    "touches recency" shows the same through `describeForAgent`.
- **Eviction order, as the plan gives it.**
  1. The LRU surface of the committing routing id, while it holds more than `maxSurfacesPerRoutingId`.
  2. The LRU routing id, with all of its surfaces, while more than `maxRoutingIds` routing ids exist.
  3. Global LRU surfaces while the total is over `maxStoreBytes`.
  - The committed record is never evicted. The spec "never evicts the record being committed, even when it is the
    oldest" grows the oldest record past the cap and a different surface goes.
- **Evictions returned.** `commit`, `makeRoom` and `reserveTicket` return `evicted: (routingId, surfaceId)[]`, and an
  evicted surface reads as not found (`get` returns `undefined`, `list` returns `[]`).
- **Bounds at the limit and one over**, each tested with the real defaults for routing and per-routing, and with a
  byte cap set to exactly 3 records for bytes:
  - per-routing: 8 surfaces, then the 9th;
  - routing ids: 32, then the 33rd;
  - bytes: 3 units, then the 4th.
- **`highWaterRevision`** is the maximum revision ever committed. It survives replace, delete and eviction (spec).
  `createSurfaceRecord(id, content, revision)` sets `incarnation = revision` and
  `writeLog = createSurfaceWriteLog(revision)`.
- **Byte accounting.** Each record counts the `jsonUtf8Bytes` of content (which carries the data model), selection,
  last submit and write log. On top of the records the total adds:
  - `charges.chargedBytes()`, the ledger records (the ledger implements `SurfaceStoreChargeSource`);
  - pending tickets, through `reserveTicket` and `releaseTicket`.
  - Specs: exact byte equality with selection, last submit and a log entry; a replace is not counted twice; ledger
    charges and tickets are added to `totalBytes`; a real `SurfaceOperationLedger` wired as the charge source evicts
    a surface through the admission callback.
- **Reservations over the cap are refused**, changing nothing:
  - `reserveTicket` and `makeRoom` refuse `too-many-operations` when the fixed bytes plus the protected record plus
    the request exceed the cap after evicting everything evictable. The spec tests the request at exactly the room
    left and one byte over.
  - A second ticket for the same `(routingId, operationId)` is refused.
  - `commit` refuses `budget` when the record plus the non-evictable bytes cannot fit. The spec shows `usage()` and
    `highWaterRevision` are unchanged.
- **Worst-case memory.** The file's doc comment states it: 24 MiB of accounted JSON, including 8 MiB of ledger
  charges and 4 MiB of tickets. Surfaces alone could reach about 64 MiB, so the byte cap is the binding limit. Heap is
  estimated at 2-3x, about 48-72 MiB.

## Task 9.3: reader evidence

- **`read`** is complete, for RPC.
  - A named surface gives `{ status: 'found', routingId, surfaces: [SurfaceStateView] }`, or `not-found` when absent
    or held under another routing id.
  - Without an id it returns every view, sorted by id. An empty routing id gives `found` with `[]`.
- **`describeForAgent`, `view: 'state'` for one surface.** It returns one complete JSON state. Its budget follows plan
  Component 1:
  - id, revision and contract;
  - `dataModel`;
  - `formValues`;
  - `selection` with its `describeSurfaceSelection` description;
  - `lastSubmit`.
  - The title and tree are structure and are left out.
  - The spec "keeps a worst-case single state within maxStateReadBytes" builds a near-worst case and asserts it stays
    within 320 KiB: 100 inputs with 128-char ids, each carrying a submit issue, about 60 KiB of data model, and a
    last submit of about 31 KiB.
- **Without a surface id** the text is, in order:
  1. an index line for every id and revision;
  2. as many complete states as fit;
  3. `[truncated: … "b", "c". Read each one with its surfaceId.]`.
  - Room for the widest possible marker is reserved up front, so the whole text is `<= maxStateReadBytes`. The spec
    checks the line order, that the included state parses as whole JSON, the omitted ids, and the byte bound.
    Another spec checks that there is no marker when everything fits.
- **`view: 'structure'`** returns `{ surfaceId, revision, contract, structure }`. For v2, `structure` is the envelope
  without the data model; for v1 it is the spec. The spec covers both.
- **Form values are keyed by unique path.** Two inputs on `form.name` give one entry with
  `inputs: ['name', 'name-again']`. An absent required select reads `null` with `submitIssues: ['plan: is required.']`.
  An absent checkbox reads `false`. v1 content gives `{}`. Entries are built with `Object.fromEntries`, so a key can
  never reach a prototype.
- **Defensive outcomes:**
  - `too-large`: a single state or tree above the bound returns a message, never a partial state (spec).
  - `rejected`: structure without a surface id (spec). The schema already rejects this upstream.
  - `not-found`: an empty or unknown routing id (spec).
- **Line separators.** U+2028 and U+2029 are escaped in the agent text, as `surface-text-fallback.ts` does. The spec
  asserts no raw separator is present.

## R12 and R13

- **R13** (ledger idempotency and fail-closed expiry, plan lane findings 4 and 5): all handled in Task 9.1. It uses the
  exact rule set of plan Component 10 (`implementation-plan.md:531-547`) and the full spec list above:
  - replay and conflict whatever the issue time;
  - a future-dated id;
  - a clock rollback;
  - fail-closed expiry, including the exact `forgetAt` boundary;
  - pending records never forgotten;
  - every capacity refusal;
  - a ledger dropped only when fully forgotten.
  Ticket settlement across incarnations (lane finding 2) is Task 10.3. This batch provides what it needs:
  `SurfaceRecord.incarnation`, the ledger `incarnation` field, and `reserveTicket` / `releaseTicket` bound to the
  operation id. Tickets survive surface eviction.
- **R12** items that fall in this batch:
  - **Cross-routing reads.** The store and the ledger are keyed by routing id. A surface or operation under another
    routing id is not found or `unknown`: store spec, reader specs for `read` and `describeForAgent`, and the ledger
    lookup spec.
  - **Prototype pollution.** The fingerprint writes keys as literals (spec with a `__proto__` key). Form values use
    `Object.fromEntries`. The store and the ledger hold data only in `Map`s.
  - Spoofing labels and forged renderer parameters are not in this batch (Tasks 6.3 and 11.3).

## Verification

Command:
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --output-style=static` (the batch command,
with static output so the counts are visible). Tailed and filtered:

```
exit=0
Test Suites: 56 passed, 56 total
Tests:       1276 passed, 1276 total
✖ 44 problems (0 errors, 44 warnings)
 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/vscode-lm-tools
```

- Tests: the Batch 8 baseline was 53 suites and 1,219 tests. This batch adds 3 suites and 57 tests.
- Lint: 0 errors. None of the 44 warnings is in a Batch 9 file. A grep of the lint output for `lib\surface\` finds 0
  hits. The warnings are the same pre-existing set, for example `preserve-caught-error` in the
  `providers/*.provider.ts` files.
- Jest prints "A worker process has failed to exit gracefully". The same message appeared before these specs ran
  (first run). Nothing in these three units opens a timer or a handle.
- `@ptah-extension/shared` was not added to `-p`, because `surface.index.ts` was not touched.
- Prettier was run on the 6 files, using the repository `.prettierrc`.
- U+2028 and U+2029: a script check confirms that no raw separator exists in any file in `surface/`. They appear only
  as `\u2028` / `\u2029` escapes.

## Plan deviations and decisions for Batch 10

1. **Store-to-ledger coupling.** The plan does not say how ledger charges reach the store's byte cap. I chose this
   wiring:
   - The ledger implements `SurfaceStoreChargeSource` (`chargedBytes()`), and the store reads it on every total.
   - The ledger's `reserve` takes an optional `admit(bytes)` callback. The facade passes
     `(b) => store.makeRoom(b, protect)` and collects its `evicted` pairs to push.
   - This keeps both units pure and file-disjoint, and it avoids a reserve-then-undo step. Batch 10 must construct the
     store with `charges: ledger`.
2. **`SurfaceRecord` shape.** It has no separate `dataModel` field. The v2 `SurfaceContent` already carries
   `dataModel`, so there is one source of truth. It adds `surfaceId` and `incarnation`. `bytes` is store-internal.
3. **Local read type.** `SurfaceStoreReadResult` is defined in the reader because `SurfaceReadResult` in
   `rpc-surface.types.ts` does not exist yet (Task 11.1). Its shape is the plan's
   `{ status:'found'; routingId; surfaces } | { status:'not-found' }`. Batch 11 should either reuse it or make the
   shared type identical.
4. **Ledger operation kinds** are `'change' | 'select' | 'submit'`. These are the app-started mutations that reserve
   ids. Batch 10/11 widens the union if `surface:action` needs to record other actions.
5. **`renderSurfaceText` is not used by the reader.** The agent's state and structure views are JSON, because the
   agent needs component ids and paths to author patches, and the state-read budget math does not include rendered
   text. `renderSurfaceText` remains for the update tool text (Batch 12).
6. **Store limits and ledger limits are typed `number`** (not the catalog literals) so specs can override single
   values. Defaults are `SURFACE_STORE_LIMITS`.

## Out-of-scope observations

- Two Batch 10 questions come from this design: the facade must pass `charges: ledger` when it builds the store, and
  it must push the `evicted` pairs from `makeRoom` and `reserveTicket` as well as those from `commit`. Recorded in
  Plan deviations above.
- None beyond those.

## Revision 1 (findings 1, 3, 4)

Source: `code-logic-review-batch-9.md`. Finding 2 (escaped-output read budget) is left for the architect's decision;
the escaping and the read budget are unchanged.

### Finding 1 (BLOCKER): callback-safe ledger publication

- `surface-operation-ledger.ts` `reserve()`: after the admission callback returns, the record is published into the
  Map registered for the routing id at that moment (`this.ledgers.get(routingId)`, re-registered when housekeeping
  dropped it), never into the reference read before the callback. Before writing, it re-checks the id in that Map
  (replay or conflict) and, when the routing ledger must be registered again, re-checks `maxLedgerRoutingIds`.
  Every refusal still returns before any write. The count and pending checks still run before admission.
- Specs (`surface-operation-ledger.spec.ts`, "admission that re-enters ledger housekeeping"): a real
  `SurfaceStateStore({ charges: ledger })` with `store.makeRoom` admission at retention + 1 (old record forgotten)
  and at the exact forgetAt boundary (old record kept). Each asserts `reserved`, lookup `pending`, `pendingCount` 1,
  `chargedBytes`, replay on retry, settlement `ok`, and replay after settlement. Also an admission callback that calls
  `routingIdCount()`, and one that registers another routing id under `maxLedgerRoutingIds: 1` (refused, nothing
  written).

### Finding 3: marker only when needed, sized to the actual omitted ids

- `surface-state-reader.ts` `describeAll()`: if the index and every complete state fit, all are returned with no
  marker. Otherwise states are packed in index order, each accepted only when it fits with the marker naming the ids
  still omitted after it. That marker only shrinks as states are added, so the final text stays within the bound.
- Spec: eight surfaces `"0"`..`"7"` whose fixtures pass `validateSurfaceDocument` (with `jsonUtf8Bytes`); the complete
  text lands 73 bytes under the default 327,680-byte bound. All eight states are returned, `truncated: false`, no
  marker.

### Finding 4: enforced minimum read bound and bounded variants

- `SURFACE_READER_MIN_STATE_READ_BYTES` = 40 KiB (exported, derivation documented in the source). The constructor
  throws `RangeError` for a bound below it or not a safe integer. That is a wiring error, so it fails fast at
  construction. The repository's validators return typed results for runtime input, and this value is
  configuration, not input. Reads never throw.
- Error texts quote at most 256 characters of a caller-supplied id. A final `bounded()` guard replaces any variant
  above the bound with a short fixed text (`not-found`, `rejected` or `too-large`). With default store limits this
  guard does not fire.
- Specs: construction rejects 100, min - 1, 1.5 and NaN, and accepts the minimum. Every response variant stays within
  the default bound, including a 100,000-character missing id. A store configured beyond the defaults (200 surfaces
  with 128-character ids) answers a bounded `too-large` at the minimum bound.

### Verification

- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools`: all three targets succeeded.
  Test Suites: 56 passed, 56 total; Tests: 1285 passed, 1285 total. Lint: 0 errors. The 44 warnings are all
  pre-existing `preserve-caught-error` warnings in other files.
- `npx eslint` on the six Batch 9 files: no output (clean).
- File sizes: ledger 454, ledger spec 504, reader 387, reader spec 540, store 417, store spec 398 lines.

## Revision 1 (finding 2)

Applied the architect's decision, option (a), from implementation-plan.md "## Batch 9 read-budget decision". The read
budget is raised to the proven escaped worst case. The escaping and the reader logic are unchanged.

### Changes

- `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`: `maxStateReadBytes: 548 * 1024` (561,152). The comment names
  T1 metadata 4 KiB, T2 data model 128 KiB, T3a form values 128 KiB, T3b form keys/ids/issues 100 KiB, T4 selection
  140 KiB, T5 last submit 48 KiB, and the structure bound 2 x maxSurfaceBytes + 4 KiB = 516 KiB.
- `libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts`: the state-read sum is rewritten as the named terms
  T1-T5. It asserts `sum === 548 KiB` and `sum <= maxStateReadBytes`. A second test asserts
  `2 * maxSurfaceBytes + 4096 <= maxStateReadBytes`.
- `libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts`: deleted the stale duplicate budget test. The budgets
  spec is now the single place this is tested.
- `surface-state-reader.ts`: doc comments only. The header now cites the escaped worst case and the appendix, and
  covers the structure view. The `SURFACE_READER_MIN_STATE_READ_BYTES` comment now says 548 KiB and states that a bound
  between 40 KiB and the default answers `too-large` rather than cutting. The 40 KiB minimum is unchanged: it bounds
  the index, marker and error texts, and does not depend on the default.
- NEW `surface-state-reader.budget.spec.ts` (339 lines): appendix cases 1-4. They are in a sibling file because
  `surface-state-reader.spec.ts` is already 550 lines, and adding them would go well past the ~700-line limit.
  Separators are built with `String.fromCharCode`. Every fixture passes `validateSurfaceDocument(..., jsonUtf8Bytes)`.
  Every read is checked for `found`, bytes <= `maxStateReadBytes`, no raw U+2028/U+2029, and a lossless JSON
  round trip of the stored model or structure.
  1. Reviewer reproduction A, verbatim: 6-segment paths, 210 separators per value, a prior submit that
     `formatSurfaceSubmitMessage` accepts. State read is found, above 327,680 bytes.
  2. Reviewer reproduction B: 40 stats titled with 2,000 separators each. Structure read is found, above 327,680
     bytes.
  3. Maximal structure: separator-titled stats are added until the byte breach names `maxSurfaceBytes`. The last
     stat is then shortened until the document is accepted (within 64 bytes of 256 KiB). Structure read is found,
     above 2 x 256 KiB - 64 KiB.
  4. Maximal state: 100 text inputs (128-character ids, 5-segment paths). Separator values are the longest that keep
     the model admissible, and the model is within 1 KiB of 64 KiB. A 50-column table has separator labels and
     first-row cells, with the selection on row 0. `lastSubmit` values are separators, and the formatter's message is
     within 1 KiB of 32 KiB. State read is found, above 327,680 bytes. T3a: form-value bytes <= escaped model bytes.
     T4: embedded selection <= 143,360 bytes.
- `surface-state-reader.spec.ts`: two existing tests depended on the old 320 KiB default and were updated:
  - The finding-3 "all fit just under the bound" regression now passes an explicit 320 KiB bound, which is the
    reviewer's scenario. Stat-only admissible states cannot approach 548 KiB.
  - "keeps every response variant within the default bound" now uses 20,000-separator models (60 KB raw, 120 KB
    escaped), so eight of them still overflow and the all-surfaces read still truncates.
  - The escaping test and the never-partial test are unchanged.
- Grep for `327680`, `320 * 1024`, `320 KiB` and `maxStateReadBytes` across `libs/shared/src` and
  `libs/backend/vscode-lm-tools/src` found no other occurrences that fix the state-read value.
  None of the changed files contains a raw separator (byte-level grep).

### Verification

- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/shared @ptah-extension/vscode-lm-tools`: all targets
  succeeded for both projects.
  - shared: 77 suites / 2,097 tests passed.
  - vscode-lm-tools: 57 suites / 1,289 tests passed.
  - Lint: 0 errors. The warnings (5 in shared, 44 in vscode-lm-tools) are all pre-existing and outside the changed
    files.
- `npx eslint` on the six changed files: clean.

## Revision 2 (finding 5)

Source: "# Re-review after revision round 1" in `code-logic-review-batch-9.md`, finding 5 and the non-blocking
missing-value qualification.

### Finding 5: re-check per-routing capacity after admission

- `surface-operation-ledger.ts`: the per-routing record and pending caps are now in one private helper,
  `routingCapacityRefusal()`. `reserve()` runs it twice: before admission against the original Map, and after
  admission against the re-acquired Map. After admission, `reserve()` re-checks identity (replay or conflict), then the
  per-routing caps when the routing ledger exists, and otherwise the routing-id cap before it registers a new ledger.
  Every refusal returns before any write, and an existing full ledger is never re-registered or modified.
- The `SurfaceLedgerAdmission` doc now states the callback contract. Re-entry (housekeeping or nested reservations) is
  allowed and cannot break a ledger bound. A `true` answer is byte room for this one record; spending it on nested
  reservations is outside the store contract. The reviewer's broader byte-reservation protocol is not added: the
  planned callback only calls `store.makeRoom`.
- Specs (`surface-operation-ledger.spec.ts`, "admission that re-enters ledger housekeeping"):
  - Reviewer case 1: the callback reserves 4 same-routing operations (the default pending cap). The outer call is
    refused `too-many-operations`, `pendingCount` stays 4, and the outer id is `unknown`.
  - Reviewer case 2: the callback reserves and settles 128 same-routing operations (the default record cap). The outer
    call is refused, `chargedBytes` stays 128 x 1,024, and the outer id is `unknown`.
  - Normal path: the callback leaves one pending slot free. The outer call is reserved, `pendingCount` reaches the cap
    exactly, and the outer id is `pending`.
  - The round-1 retention, boundary, `routingIdCount()` and routing-id-cap regressions are unchanged and still pass.

### Missing-value qualification (non-blocking)

- New case in `surface-state-reader.budget.spec.ts`: 100 checkboxes (a validated fixture) bound to paths absent from an
  empty model. Each form value reads `false`. The test asserts that the literal "values <= model bytes" fails here, and
  that the value bytes stay within 5 x 100. Its comment records the proof correction: absent-binding defaults (at most
  5 bytes per input) are charged to T3b's 1,024-byte per-input allowance (about 875 used), not to T3a, so the 548 KiB
  total holds. No limit or source change.

### Verification

- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools`: all targets succeeded. 57 suites /
  1,293 tests passed (4 new). Lint: 0 errors; the 44 warnings are pre-existing and outside the changed files.
- `npx eslint` on the ledger, ledger spec and budget spec: clean. Byte-level grep: no raw U+2028/U+2029 in the surface
  directory.
- Line counts: ledger 474, ledger spec 563, budget spec 383.
