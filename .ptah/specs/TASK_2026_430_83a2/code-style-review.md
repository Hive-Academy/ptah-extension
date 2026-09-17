# Code Style Review — `TASK_2026_430_83a2`

## Summary

| Metric          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Overall score   | 8/10                                                                   |
| Assessment      | APPROVED                                                               |
| Blocking issues | 0                                                                      |
| Serious issues  | 1                                                                      |
| Minor issues    | 4                                                                      |
| Files reviewed  | 46 (all touched files read; 16 core implementation files read in full) |

Scope: `git log --oneline main..HEAD` (6 commits), `git diff main...HEAD` (46
files, +8080/-2461). Read in full: `libs/backend/platform-core/src/utils/json-budget.ts`,
`state-storage-errors.ts`, `async-state-storage.interface.ts`,
`state-storage-maintenance.interface.ts`, `index.ts` diff;
`libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`,
`-worker-runtime.ts`, `-worker-host.ts`, `-worker-loop.ts`, `-worker.ts`,
`-value-store.ts`, `-array-split.ts`, `-commit-store.ts`, `electron-state-storage.ts`;
`libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts`;
diffs of `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`,
`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`,
`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`,
`apps/ptah-electron/src/di/phase-1-infra.ts`,
`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`,
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
(the last read with `git diff -a`, since grep reports it binary — a pre-existing
control byte the batch was told to preserve, confirmed untouched by this diff).
`code-logic-review.md` (g-code-logic-review.md, b3-code-logic-review.md) already
covers runtime correctness in depth; this review does not repeat their findings
and defers to them on failure-mode behaviour.

## Five style questions

### 1. What breaks when requirements change in six months?

The sequence-page "pack items into a byte budget, shrink the first oversized
item, else break" algorithm is now written out by hand three times with three
slightly different budget shapes: `electron-state-storage-worker-runtime.ts:777-809`
(dual estimator: `estimateElectronStateJsonBytes` for `maxBytes`,
`jsonUtf8Bytes` for `maxJsonBytes`), `workspace-aware-state-storage.ts:108-137`
(single `jsonUtf8Bytes` estimator, three-way check), and
`session-metadata-store.ts:834-865` (single `jsonUtf8Bytes` estimator, one
budget). A future change to the packing rule — e.g. accounting for the page
envelope more precisely, or changing what happens when the very first item
doesn't fit — has to be found and re-applied in three places, in three
different libraries, by someone who has to first notice all three exist. See
Serious #1.

Second: `StateStorageSequenceReadOptions` (`async-state-storage.interface.ts:22-30`)
now carries four independently-optional byte budgets (`maxBytes`,
`maxJsonBytes`, `jsonEnvelopeBytes`, `maxItemBytes`) with no doc comment
explaining which are inclusive of which, or why an implementer needs more than
one. The team's own `completion-report.md` (§5 item 8) already names this "the
`maxBytes` vs `maxJsonBytes` envelope asymmetry" and defers unifying it — a
correct call for this release, but a caller six months out who adds a second
consumer of `readJsonSequence` with only `maxBytes` set (the case the B3 logic
review's Minor #4 already flagged as the one that would turn a currently-inert
asymmetry into a real bug) has nothing in the type signature warning them.

### 2. What would a new team member misread here?

`StateStorageRecoveryReason` vs `ElectronStateWorkerRecoveryReason`
(`worker-protocol.ts:14-44`) is easy to conflate — the file's own doc comment
explains the subset relationship well, so this is a credit, not a fault, but a
reader skimming call sites (`isElectronStateWorkerRecoveryReason`) without that
comment could reasonably assume the two are interchangeable. The `RpcUserError`
code reused for `StateStorageValueTooLargeError` — `'PERSISTENCE_UNAVAILABLE'`
(`session-rpc.handlers.ts:840-846`) — reads oddly next to `AgentOutputCursorStaleError`'s
purpose-built `'OUTPUT_CURSOR_STALE'`, until you check that `PERSISTENCE_UNAVAILABLE`
is already this repository's generic "the storage layer refused" code
(`corpus-rpc.handlers.ts`, `mem-rpc.handlers.ts`, ten-plus other call sites) —
consistent, but a reader unfamiliar with that convention will wonder why a
"too large" failure maps to an "unavailable" code.

### 3. What does this cost to maintain that a simpler shape would not?

The triplicated packing loop (Q1) is the concrete cost: three independent
places to keep synchronized, and the shape has already drifted once inside
this very branch — the B3 logic review's own Minor finding recorded that
`workspace-aware-state-storage.ts`'s `pageBytes` accumulator starts at a flat
`2` while its sibling `jsonBytes` accumulator (in the same function) correctly
starts from the caller-supplied `jsonEnvelopeBytes`, an inconsistency that
would not exist if there were one packer with one accumulator-seeding rule.
That the drift was caught and found harmless this time is not something a
third or fourth caller is guaranteed.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally significant. Layer boundaries hold exactly as documented:
`platform-electron` has zero `agentId`/`sessionId`/`cliSession` vocabulary in
any production file touched by this branch (verified by grep across all eight
touched implementation files); `platform-core` gained only pure helpers,
types and error classes — no adapter code, no new dependency; the agent-sdk
dual-barrel rule was checked correctly (`AgentOutputCursorStaleError` added to
`src/index.ts`; `src/lib/helpers/index.ts` does not re-export
`session-metadata-store` symbols, so no second export site was needed — the
batch's own risk-4 note in `batches.md` is resolved correctly, not just
asserted). `catch (error: unknown)` discipline is 100% across every new
`catch` in the diff (checked with `git diff -a` across every touched `.ts`
file, prod and spec). Zero new inline `//` or `/**` comments were added
anywhere in the 46-file diff except the two `degradation-audit:` markers,
both correctly formatted with kind and reason — a genuinely clean result
against this repository's zero-comment default.

### 5. What would you have done differently, and why is that better rather than merely other?

Extract the packing loop into `platform-core/src/utils/json-budget.ts` as a
generic `packSequencePage(sequence, start, { maxBytes, maxJsonBytes,
maxItemBytes, jsonEnvelopeBytes, estimate })` returning
`{ items, truncatedItem, nextIndex }`, parameterized the same way
`shrinkJsonStringLeaves` already is (an `estimate` callback). All three call
sites already import `jsonUtf8Bytes` and `shrinkJsonStringLeaves` from that
same module, so the dependency edge already exists; only the control flow
itself is unshared. This is better than the current shape because the file
that already houses "the one place JSON budget arithmetic lives" would then
actually be that, and a future estimator change would be a one-file edit
verified once instead of a three-file edit verified three times (or missed
once).

## Blocking issues

None.

## Serious issues

### Sequence-page packing algorithm duplicated across three libraries

- File: `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:777-809`
  (new in this branch — confirmed via `git show main:...worker-runtime.ts`,
  which has no `shrinkJsonStringLeaves` import at all, i.e. the old
  `readSequencePage` threw on the first oversized item rather than packing
  with a dual budget)
- File: `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts:108-137`
  (new function `readSyncSequencePage`, added by this branch)
- File: `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:834-865`
  (new `readRecordOutputPage` body, replacing the old widen/narrow-search
  implementation this branch deletes)
- Problem: the same algorithm — walk a sequence from an offset, admit an item
  while `estimator + item <= maxBytes` and `json + item <= maxJsonBytes` and
  `item <= maxItemBytes`, otherwise (on the first item of the page) shrink via
  `shrinkJsonStringLeaves` and stop — is hand-written three times, in three
  different libraries, by three different batches of this same task, with
  three slightly different budget shapes (two estimators vs one; three budget
  fields vs one). None of the three imports or calls the other two.
- Impact: a correctness fix or a semantics change to the packing rule (e.g.
  how the envelope is accounted for, what "the first item" means when the page
  is a continuation) has three places to find and three places to re-verify.
  The B3 logic review already caught one instance of exactly this risk inside
  this same branch (the `pageBytes` vs `jsonBytes` accumulator-seeding
  asymmetry in the vscode-core copy) and rated it harmless only because every
  current caller happens to set both budgets equal. A shared implementation
  would have made that class of bug structurally unreachable instead of
  contingently absent.
- Fix: add a generic packer to `libs/backend/platform-core/src/utils/json-budget.ts`
  (same module that already owns `jsonUtf8Bytes` and `shrinkJsonStringLeaves`,
  and that all three call sites already import from) parameterized by an
  `estimate` callback and the four budget fields already defined on
  `StateStorageSequenceReadOptions`; have the worker runtime, the vscode-core
  sync proxy and `session-metadata-store.ts`'s sync path all call it instead of
  re-implementing the loop. Not required before merge — logic correctness is
  independently verified by two passing code-logic reviews and the perf/regression
  suite — but worth doing before a fourth call site appears.

## Minor issues

1. **`StateStorageSequenceReadOptions`'s four-budget shape is unexplained in
   the port itself.** `async-state-storage.interface.ts:22-30` — `maxBytes`,
   `maxJsonBytes`, `jsonEnvelopeBytes`, `maxItemBytes` have no doc comment on
   the interface stating which subsumes which or why a caller needs more than
   one. Already tracked as `completion-report.md` §5 item 8; recorded here
   only because it is squarely "new port vocabulary, precision of types."
2. **`SessionRpcHandlers.mapCliOutputPageError` returns `unknown`**
   (`session-rpc.handlers.ts:834-849`) for a helper whose only call site
   immediately `throw`s the result. Two of its three branches return a
   concrete `RpcUserError`; only the passthrough branch needs `unknown`
   (the caught `error` could theoretically be a non-`Error` throw). Typing it
   `Error | RpcUserError` plus a `throw error as Error` fallback would be more
   precise, though this is a defensible choice given the source is a `catch
(error: unknown)`.
3. **`worker-protocol.ts` is 1084 raw / 992 lint-effective lines**, above the
   700-line warn ceiling, and contains three separable concerns: the Zod
   protocol contract (~600 lines), payload-budget measurement (~150 lines:
   `assertElectronStateWorkerPayloadWithinBudget`, `estimateElectronStateJsonBytes`,
   `electronStateWorkerPayloadFits`, `assertJsonCompatibleValue`), and the
   snapshot-operation codec (~180 lines: `generateUtf8StringSlices`,
   `generateSnapshotOperations`, `setSnapshotPath`, `canSendDirectUpdate`).
   Each would clear the ~150-line guardrail and has a real, nameable identity
   (`electron-state-storage-worker-payload-budget.ts`,
   `electron-state-storage-worker-snapshot-codec.ts`) if split. Deferral is
   fine for this merge: the file is fundamentally a wire-protocol contract
   barrel (the kind CLAUDE.md explicitly says can legitimately run long), the
   three concerns are already visually grouped and independently tested, and
   this exact deferral is disclosed in `completion-report.md` §5 item 10
   alongside `worker-runtime.ts` (805) and `worker-host.ts` (749) — both of
   which, by contrast, are single-class facades that already correctly
   followed the facade rule this task (collaborators `ElectronStateCommitStore`,
   `ElectronStateValueStore`, `computeElectronStateArraySplit`,
   `createElectronStateWorkerMessageLoop` were extracted), so their remaining
   size is inherent to the state machine, not a missed split.
4. **`session-metadata-store.ts`'s module CLAUDE.md is silent on the fourth
   error class.** `agent-sdk/CLAUDE.md` "Public API" lists `SdkError,
SessionNotActiveError, ModelNotAvailableError` but not the new
   `AgentOutputCursorStaleError` it exports from the same barrel line
   (`src/index.ts`). Documentation drift, not a code defect; worth a one-line
   addition whenever that file is next touched.

## File-by-file

### `libs/backend/platform-core/src/utils/json-budget.ts` (new)

Score 9/10 — 0B, 0S, 1M (the shared-packer opportunity, credited against
Serious #1 rather than duplicated here). Binary-search shrink (`shrinkWalk` +
bisection over `largestLeafJsonBytes`) is a clean, testable approach; UTF-8
code-point boundary handling is correct and covered. `omitJsonPaths` clone-walk
is straightforward and non-mutating as required.

### `libs/backend/platform-core/src/state-storage-errors.ts`, `interfaces/*.ts`

Score 9/10 — 0B, 0S, 1M (Minor #1). New error classes follow the exact shape
of the two pre-existing ones (`override readonly name`, `readonly code`).
`index.ts` barrel additions are purely additive, correctly typed.

### `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`

Score 8/10 — 0B, 0S, 1M (Minor #3, size). Zod coverage of every new request/response
shape, failure code and cursor field is complete and `.strict()` throughout.
The `superRefine` cross-field invariants (`landed` only on `commit-failed`,
`valueBytes` only on `value-too-large`, `done`⇔`nextCursor===null`) are a
genuinely good pattern for keeping a wire contract internally consistent.

### `electron-state-storage-worker-runtime.ts` (rewrite)

Score 8/10 — 0B, 1S (Serious #1, one of three sites), 0M. Facade rule
respected exactly: class keeps its name and `handle` signature; `OperationPacker`
and `SnapshotAssembly` are appropriately-sized private collaborators, not
extracted to their own files (correctly avoiding the sub-150-line-file trap).

### `electron-state-storage-worker-host.ts`

Score 8/10 — 0B, 0S, 0M. Single class, well-decomposed private methods,
every `degradation-audit` marker carries a real kind and reason. The `assembleOperations`
function here duplicates the shape of `SnapshotAssembly.apply` in
worker-runtime.ts, but that duplication predates this branch (confirmed via
`git show main:...worker-host.ts` and `...worker-runtime.ts`, both already
had inline `setSnapshotPath` switches before this task) and is out of this
task's scope — not counted against this batch.

### `electron-state-storage-worker-loop.ts`, `-value-store.ts`, `-array-split.ts` (new)

Score 9/10 each — 0B, 0S, 0M. All three are small, single-purpose, correctly
named (no `helpers`/`utils`/`misc`), and none leaks domain vocabulary.

### `electron-state-storage-commit-store.ts`, `electron-state-storage.ts`, `electron-state-storage-worker.ts`

Score 8/10 — 0B, 0S, 0M. `worker.ts` is now bootstrap-only as planned.
`electron-state-storage.ts`'s `finally`-based cache resync (closing the G
review's confirmed pre-existing bug) is a clean fix at the facade boundary.

### `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts`

Score 7/10 — 0B, 1S (Serious #1, one of three sites), 0M. Correctly stays a
domain-agnostic proxy (`StateStorageFactory` indirection, no `platform-electron`
import), and the sync-path budget/cursor logic is independently correct (both
logic reviews verified this in detail) — the only deduction here is the
unshared packing loop.

### `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`

Score 8/10 — 0B, 1S (Serious #1, one of three sites), 0M. The deletion of
`leanCliSessions`/`migrateRefOutput`/the widen-narrow search in favour of a
single `readJsonSequence` call with worker-computed budgets is a large,
well-executed simplification; the file shrinks net (deletions exceed
additions, matching the plan's explicit quality requirement).

### `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`

Score 9/10 — 0B, 0S, 0M. `bulkInline` gate is a precise, minimal way to keep
old-store compatibility without adding a version field.

### `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`

Score 8/10 — 0B, 0S, 2M (Minor #2 and the code-reuse note in Q2). Error
mapping correctly never forwards raw `error.message` to the client.

### `apps/ptah-electron/src/di/phase-1-infra.ts`

Score 9/10 — 0B, 0S, 0M. `logMigrationReceipt` correctly logs only counters,
switches level on `lostCount`, matches the plan's "no content in logs"
requirement exactly.

### `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`

Score 9/10 — 0B, 0S, 0M. `cliOutputDemand`'s custom `equal` avoids re-firing
the consuming effect on a structurally-identical array, consistent with this
lib's documented equality-sensitivity conventions (`computeGlobalEpoch`,
`mixNumber`). Signals + `providedIn: 'root'` unchanged.

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

Score 8/10 — 0B, 0S, 0M. The widening of `CliOutputLoadState.sessionId` from
`SessionId` to `string` looks at first read like a loss of branded-ID
discipline, but it correctly matches the pre-existing `string`-typed
`MonitoredAgent.parentSessionId` in chat-streaming (verified: that field was
already `string`, not `SessionId`, before this diff), which is the value this
new code actually receives via `cliOutputDemand`. Effect wrapping follows the
existing `untracked(...)` pattern used elsewhere in the same constructor. The
file's pre-existing non-UTF-8 byte was correctly left untouched (`git diff -a`
shows only textual hunks; no binary corruption introduced).

## Pattern compliance

| Repository rule or nearby convention                          | Status         | Evidence                                                                                                                              |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `platform-electron` stays domain-agnostic                     | PASS           | grep across all touched implementation files for `cliSession\|agentId\|sessionId` returns nothing outside specs                       |
| `platform-core` stays a leaf                                  | PASS           | `json-budget.ts`, `state-storage-errors.ts` additions have zero `@ptah-extension/*` imports                                           |
| `catch (error: unknown)` everywhere                           | PASS           | zero non-conforming `catch (...)` with a bound parameter in the entire diff                                                           |
| No explanatory comments added                                 | PASS           | zero new `//`/`/**` lines except two correctly-formed `degradation-audit:` markers                                                    |
| `degradation-audit` markers carry kind + reason               | PASS           | both new markers (`worker-loop.ts:56-59`, `electron-state-storage.ts:283-285`) conform                                                |
| Zod at every new worker boundary                              | PASS           | every new request/response field, failure code and cursor shape is schema-validated with `.strict()`                                  |
| kebab-case file names                                         | PASS           | all 6 new implementation/util files, all new spec files                                                                               |
| No `helpers`/`utils`/`misc` fragment names                    | PASS           | `array-split`, `value-store`, `worker-loop`, `json-budget` are all domain-named                                                       |
| Facade rule (runtime split)                                   | PASS           | `ElectronStateWorkerRuntime` keeps name/`handle`; loop, value store, array split are injected/imported collaborators, not inheritance |
| agent-sdk dual barrel export                                  | PASS           | root `src/index.ts` updated; `src/lib/helpers/index.ts` correctly left untouched (does not re-export this module)                     |
| RPC dual-registration (namespace + `ALLOWED_METHOD_PREFIXES`) | NOT_APPLICABLE | no new RPC method added; `session:cli-output-page` already existed                                                                    |
| chat → chat-streaming one-way dependency                      | PASS           | `session-loader.service.ts` only reads `AgentMonitorStore`'s public signals/methods; no reverse import                                |
| Angular signals + `inject()`                                  | PASS           | new `AgentMonitorStore`/`SessionLoaderService` code uses `computed`, `signal`, `effect`, `untracked` exclusively                      |
| Shared budget/packing logic not duplicated                    | FAIL           | Serious #1 — three independent implementations                                                                                        |

## Maintenance debt

- Introduced: one Serious duplication (three-way packing loop) and one
  disclosed-but-real interface ambiguity (four-field budget shape on
  `StateStorageSequenceReadOptions`).
- Retired: `leanCliSessions`, `migrateRefOutput`, `leanCliSessionRef`,
  `getAgentOutput`, `MAX_PERSISTED_REF_SEGMENTS`, the widen/narrow output-page
  search, the `128 +` write-packing heuristic, `extractLargeStrings`'s
  whole-item send, `snapshotCursors`, `append-json-string-slice`, and
  `retainedSourceCount`/`retain-source` — all confirmed absent by grep and by
  reading the files that replaced them. This is a substantial net reduction in
  bespoke, hard-to-reason-about machinery.
- Net: strongly positive. The one Serious finding is real but bounded (three
  files, one algorithm, no behavioural risk since two independent logic
  reviews verified each site's correctness); it does not offset the scale of
  what this branch removed.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH — every finding above cites `file:line`, and the two
  "predates this branch" claims (host/runtime `assembleOperations` duplication,
  the pre-existing commit-store comment) were verified against `git show
main:...` rather than assumed.
- Key concern: the three-way packing-loop duplication is the one piece of new
  structure in this branch that will cost real effort if it needs to change
  again, and the class of bug it risks (accumulator-seeding drift) already
  showed up once inside this same branch, caught only by an unusually careful
  logic review.
- What a 10/10 version would do differently: extract the shared packer into
  `platform-core/src/utils/json-budget.ts` before or shortly after merge (Serious
  #1's fix), add a one-line doc comment on `StateStorageSequenceReadOptions`
  stating the relationship between its four budget fields (Minor #1), and
  update `agent-sdk/CLAUDE.md`'s Public API list to include
  `AgentOutputCursorStaleError` (Minor #4).
