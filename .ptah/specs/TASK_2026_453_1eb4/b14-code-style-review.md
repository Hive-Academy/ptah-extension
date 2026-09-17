# Code Style Review — `TASK_2026_453_1eb4` Batch 14

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 6/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 4                                     |
| Files reviewed  | 6 (1 new, 5 modified)                 |

Scope: `perf-session-fixture.ts`, `perf-page-capture.ts`, `perf-measurement-report.ts`,
`tile-open-longtask-budget.perf.spec.ts` (all modified), `tile-load-older-history.spec.ts` (new),
`apps/ptah-electron-e2e/CLAUDE.md` (one sentence appended).

## Five style questions

### 1. What breaks in six months?

`buildPagingFixture` (`perf-session-fixture.ts:238-283`) feeds its own `GeneratedEvent[]` fixture
type into the real backend pager (`selectHistoryPage`) through `events as unknown as readonly
FlatStreamEventUnion[]` (:242). `GeneratedEvent` (:13-30) has no `parentToolUseId` field at all,
while `buildPagingFixture`'s own cursor-resolution loop reads `event.parentToolUseId` off the cast
result (:255-259) — it works today only because a `GeneratedEvent` object literally lacks that
property, so it reads `undefined` and behaves like "no parent," which happens to be correct for
this fixture's top-level turns. If a real `FlatStreamEventUnion` variant six months from now adds a
required discriminant field `GeneratedEvent` does not produce, or if `selectHistoryPage` starts
reading a second field this fixture never sets, the double-cast means TypeScript will not catch the
drift — the entire reason Batch 14 exists (R-ii-4: "a mock that ignores `historyPage` measures the
old path") degrades one layer, from "wrong mock" to "wrong mock the compiler cannot see."

### 2. What would a new team member misread?

`domDiagnostics` (`tile-open-longtask-budget.perf.spec.ts:216-232`) has no return type annotation,
immediately next to `collectPagingDiagnostics` (:188-212) which is fully typed
(`Promise<PagingDiagnostic[]>`) with a named `PagingDiagnostic` interface. A reader skimming the two
adjacent helpers could read the annotation gap as meaningful (e.g. "this one returns something
looser/less stable") when it is simply an omission — the inferred shape is just as concrete as
`PagingDiagnostic`.

### 3. What does this cost to maintain?

`installStaleHistoryResponder` (`tile-load-older-history.spec.ts:158-190`) hand-builds a raw
`rpc:response` failure envelope (`type`, `correlationId`, `success: false`, `error`, `errorCode`)
by removing and replacing every `ipcMain` `'rpc'` listener for one call. This is the only place in
the diff that reconstructs the wire envelope shape outside `UiDriver`/`rpc-bridge`; if that envelope
shape changes, this test silently stops emulating a real backend failure (it would emit a stale
shape the renderer's RPC client no longer recognizes) with no compiler signal, because the shape is
inlined as an object literal rather than typed against whatever `rpc-bridge.ts` exports. The comment
explaining *why* this exists (`UiDriver.mockRpc` always wraps values in `success: true`) is good;
the shape itself is not type-checked against its source of truth.

### 4. Where is this inconsistent with the rest of the repository?

The batch's stated no-duplication rule ("no duplicated pager logic ... must reuse
`libs/shared` `selectHistoryPage`") is honored substantively — `buildPagingFixture`
(`perf-session-fixture.ts:238-283`) calls the real `selectHistoryPage`/`encodeHistoryCursor` rather
than reimplementing turn-boundary logic, which is the correct reading of R-ii-4. The one
inconsistency is narrower: the escape hatch used to satisfy the type checker while doing so (the
double cast, question 1) is not a pattern used anywhere else in this file or its siblings
(`perf-diagnostics.ts`, `perf-page-capture.ts` use precise types throughout, including the new
`CDPSession | null` return and `catch (error: unknown)` narrowing added in this same diff at
`perf-page-capture.ts:139-172`). The rest of the batch's type discipline is high; this one boundary
is the outlier.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have given `GeneratedEvent` the fields `selectHistoryPage` actually reads
(`parentToolUseId?: string`, and whatever else the real `FlatStreamEventUnion` union members the
fixture emits require) so the cast becomes a real structural narrowing the compiler can verify, or
built the intermediate array as `FlatStreamEventUnion[]` directly with a mapping function from
`GeneratedEvent`. Either removes the "the compiler is not checking this" gap the double-cast
creates, and does so without duplicating `selectHistoryPage`'s own logic — it only makes the input
to that call type-honest. That is better than the status quo because the codebase's stated
verification seam (C6's own spec suite: `history-page.utils.spec.ts`) already checks
`selectHistoryPage` in isolation; feeding it fixture data through an unverified cast is the one
place that isolation guarantee stops covering the mock.

## Blocking issues

None. The reported product defect (top-boundary prepend anchor moving the viewport by thousands of
pixels, `b14-codex-report.md:5,21`) was fixed by Batch 14A's
`TranscriptPrependAnchorDirective` before this diff was finalized — the `tile-load-older-history.spec.ts`
in the current worktree already asserts `offsetDelta <= 2` at both `scrollTop === 0` and a non-zero
offset (:222, :234), and the file no longer carries the codex report's `KNOWN DEFECT` framing
mentioned in its own round-2 notes. This review covers the harness/spec code as it now stands, not
the interim defect.

## Serious issues

### Fixture events are pushed through the real pager via an unverifiable double cast

- File: `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:242, 255-259`
- Problem: `const typedEvents = events as unknown as readonly FlatStreamEventUnion[];` bypasses
  structural type checking between the e2e-only `GeneratedEvent` shape and the real backend's
  `FlatStreamEventUnion`. The subsequent cursor-resolution loop then reads
  `event.parentToolUseId` — a field `GeneratedEvent` never declares — directly off that cast value.
- Impact: this is exactly the boundary Batch 14 was created to hardenpaging fidelity between the
  e2e mock and the real backend pager. A silent drift between `GeneratedEvent` and
  `FlatStreamEventUnion` (a new required discriminant, a renamed field the fixture happens to also
  omit, etc.) would not fail typecheck; it would fail at measurement time in a way that looks like a
  product regression rather than a fixture bug, or — worse — silently produce a plausible but wrong
  page boundary that a reviewer has to notice by eye.
- Recommendation: add the fields `selectHistoryPage` actually consumes to `GeneratedEvent` (at
  minimum `parentToolUseId?: string`) so the cast narrows a real structural match, or write an
  explicit `toFlatStreamEvent(event: GeneratedEvent): FlatStreamEventUnion` mapping function the
  compiler can check end to end. Either keeps the "no duplicated pager logic" property this batch
  correctly pursued while closing the compiler gap around it.

## Minor issues

- `tile-open-longtask-budget.perf.spec.ts:216-232` — `domDiagnostics` has no explicit return type,
  unlike its sibling `collectPagingDiagnostics` two functions above it; add one for consistency.
- `tile-load-older-history.spec.ts:158-190` — `installStaleHistoryResponder` inlines the
  `rpc:response` envelope shape rather than typing it against whatever `rpc-bridge.ts` exports as
  the renderer-side response contract; a shape change there would not be caught here.
- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:292-296` — `perTileDom` is built with
  `replayingPerTile?.map((sample, index) => ({ ...settled: settledPerTile[index] }))`; if
  `settledPerTile` and `replayingPerTile` ever have different lengths (the settled sample throws
  into `measurementError` before this point today, so it cannot currently happen), `settled` would
  silently become `undefined` at runtime with no compile-time signal, because
  `noUncheckedIndexedAccess` is not enabled for this project. Not a new problem introduced by this
  diff (the project-wide flag is unrelated to this batch), but worth flagging since this is a new
  array-index access added by this batch specifically.
- `perf-session-fixture.ts:52-55` — `PrepareCanvasOptions.supportsPaging` inverts to
  `options.supportsPaging !== false` at the call site (:307) rather than defaulting the field itself
  (`supportsPaging = true`); readable either way, but the double-negative default is one extra step
  for a reader compared to giving the interface a documented default value.

## File-by-file

### `perf-session-fixture.ts`

Score 6/10 — 0 blocking, 1 serious, 1 minor. `buildPagingFixture` correctly delegates to
`selectHistoryPage`/`encodeHistoryCursor` from `@ptah-extension/shared` rather than reimplementing
paging (the batch's central requirement), and `makeSparsePagingSessionFixture` is a legitimately
new, nameable fixture builder for the pinned-prepend case rather than a bolt-on to
`makeSessionFixture`. The one real problem is the double-cast at :242 (Serious, above).

### `perf-page-capture.ts`

Score 8/10 — 0/0/1. `startTraceCapture` returning `Promise<CDPSession | null>` with a full
`try/catch (error: unknown)`, session detach, and narrowed `console.warn` (:139-172) matches the
repo's `catch (error: unknown)` + `instanceof Error` narrowing rule exactly, and mirrors the
existing nullable-diagnostic-caller shape the codex report cites. The per-tile DOM sampler runs in
its own macrotask with a measured, enforced 50 ms budget that fails the measurement rather than
silently polluting the long-task sum (:342-367) — a real safeguard, not a comment promising one.

### `perf-measurement-report.ts`

Score 8/10 — 0/0/0. The five-line addition to `assertUsableMeasurement` (:140-144) is a minimal,
correctly-placed guard that throws on `measurementError` before falling through to the existing
`!openResult.ok` check — consistent with the function's existing shape. B7's conditional split
(move `assertScrollSanity` out before an 9th export) correctly did not fire: the file still has 8
exports, confirmed by direct count, so `perf-scroll-sanity.ts` was rightly not created.

### `tile-open-longtask-budget.perf.spec.ts`

Score 7/10 — 0/0/1 (`domDiagnostics` return type). `collectPagingDiagnostics` throws
"measurement unusable" with the exact reason (missing `historyPage`) when a tile resumed without
paging (:196-200), satisfying AC 2's non-negotiable guard. The four call sites that previously
inlined `domNodes: { replaying, settled }` were correctly collapsed into the one `domDiagnostics`
helper rather than left duplicated four times — this is the kind of dedup the file's own history
(Batch 1's `perf-measurement-report.ts` extraction) already established as the norm here.

### `tile-load-older-history.spec.ts`

Score 6/10 — 0/1 (shared with the perf-session-fixture finding above, since the double-cast fixture
feeds this spec) /1 (the envelope-shape minor). Functional coverage matches every listed AC: exact
top-boundary and non-zero-offset anchor cases, no-duplicate-ids, null-cursor button removal, stale
cursor, legacy no-`historyPage` compatibility, no-auto-load-on-open, and the pinned <=120px case are
all present and each asserts on an observed RPC call count or a DOM measurement rather than a timer
guess. `activateLoadEarlierWithoutSentinelRace` (:192-210) is a well-commented, narrowly-scoped fix
for a genuine Playwright/sentinel race (documented in the round-2 section of `b14-codex-report.md`)
rather than a `force: true` workaround — it stays on the accessible-role, enabled-element path.

### `apps/ptah-electron-e2e/CLAUDE.md`

Score 9/10 — 0/0/0. The added sentence ("The tile-open perf mock precomputes the tail and full
older-page chain with the shared `selectHistoryPage` contract before serializing resolver data, so
measurements follow the backend's whole-turn paging rules.") is accurate against
`perf-session-fixture.ts:238-283` and is placed at the top of the existing "Perf specs" section
before the older paragraph it supplements, not duplicating any existing sentence there.

## Pattern compliance

| Repository rule or nearby convention                                         | Status | Evidence                                                                                     |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| No duplicated pager logic — reuse `libs/shared` `selectHistoryPage`            | PASS   | `perf-session-fixture.ts:3-9, 246-251, 268-271`                                              |
| `catch (error: unknown)` + `instanceof Error` narrowing                        | PASS   | `perf-page-capture.ts:167-171, 279-282, 358-363`                                              |
| No `any`                                                                      | PASS   | No `any` token found in the diff; unsafe casts use `as unknown as <Type>`, not `any`          |
| Type precision at the pager boundary                                           | FAIL   | `perf-session-fixture.ts:242` double cast (Serious, above)                                    |
| UiDriver/support-module reuse, no inlined `_electron.launch`/RPC bridging      | PASS (with one exception) | `sessionRowButton`, `prepareCanvasWithSessions`, `ui.getObservedCalls` reused; `installStaleHistoryResponder` is the one hand-rolled envelope (Minor) |
| B7 conditional split rule (move `assertScrollSanity` only if a 9th export is added) | PASS | `perf-measurement-report.ts` — 8 exports confirmed, no split                                  |
| File-size soft ceiling (700 lines)                                             | PASS   | All touched files 351-644 lines after the change                                              |
| CLAUDE.md note accuracy and placement                                          | PASS   | Verified against `buildPagingFixture`, above                                                  |

## Maintenance debt

- Introduced: one new fixture builder (`makeSparsePagingSessionFixture`), one new mock RPC method
  (`chat:history-page`), per-tile DOM sampling with its own budget guard, one new functional spec
  file (351 lines) covering five distinct acceptance criteria, and one unverified type boundary
  (the double cast) at the fixture/pager seam.
- Retired: the previous non-paging `chat:resume` mock resolver (`resumePayloadBySession`), replaced
  by the paging-aware `payloadBySession` shape.
- Net: the paging fidelity this batch was created to deliver is real and substantively achieved; the
  debt is concentrated in one type-safety gap at the exact seam the batch's own risk register
  (R-ii-4) flagged as the thing to get right.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the fixture-to-pager double cast means the one guarantee this batch is supposed to
  buy — "the mock actually runs the real paging algorithm, so a regression there is caught by e2e"
  — is not compiler-checked at its input boundary, only proven correct by the current shape of
  `GeneratedEvent` happening to read as "no parent" when cast.
- What a 10/10 version would do differently: replace the double cast with either an honest
  structural match on `GeneratedEvent` or an explicit typed mapping function into
  `FlatStreamEventUnion`; annotate `domDiagnostics`'s return type; type
  `installStaleHistoryResponder`'s envelope against its real source of truth instead of an inline
  object literal.
