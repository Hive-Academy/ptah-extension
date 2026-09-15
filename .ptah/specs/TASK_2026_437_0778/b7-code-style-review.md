# Code Style Review — `TASK_2026_437_0778` Batch 7

## Summary

| Metric          | Value                                |
| ---------------- | ------------------------------------ |
| Overall score    | 7/10                                 |
| Assessment       | APPROVE_WITH_FIXES                   |
| Blocking issues  | 0                                     |
| Serious issues   | 2                                     |
| Minor issues     | 3                                     |
| Files reviewed   | 8 (2 created source + 2 spec + 2 CLAUDE.md/index diffs + tokens.ts diff + rpc-degradation.types.ts diff) |

## Five style questions

### 1. What breaks in six months?

The duplicated matching primitives are the risk. `equalsIgnoringAsciiCase` in `workspace-change-coalescer.ts:443-454` and the one in `libs/shared/src/lib/utils/nested-repo-roots.ts:222-233` already diverged before this batch landed: the coalescer's version folds case with `charCodeAt`, the shared version folds with `codePointAt` and carries an explicit non-BMP-surrogate comment (`nested-repo-roots.ts:216-221`). A future change to the case-fold rule (say, a Turkish-I edge case or a new script) that gets applied to one copy and not the other will pass both test suites and silently diverge in production. Same risk for the segment-rule matcher: `matchesSegmentRule` (`workspace-change-coalescer.ts:386-403`) reimplements `ruleMatchesAt` (`workspace-scan.constants.ts:190-211`) with a different internal shape (loop-and-continue vs a shared skip-empty cursor).

### 2. What would a new team member misread?

`runWorkspaceWatcherContract`'s signature (`run-workspace-watcher-contract.ts:123-126`, one `setup` object with `teardown` folded inside) looks like a natural evolution of the contract-runner family, but it is the only one of 16 that puts `teardown` inside the options bag instead of as its own trailing parameter. Someone editing `run-workspace-lifecycle-contract.ts` or `run-http-server-provider-contract.ts` right after this file would carry the wrong mental model into it, and vice versa.

### 3. What does this cost to maintain?

Two things must be kept in lockstep with zero automated coupling: (a) the exclusion-primitive algorithms in `shared` vs `platform-core`, both self-contained and untested against each other; (b) `platform-core/CLAUDE.md`'s token table vs `tokens.ts` — verified accurate for this batch (28 real `Symbol.for(` entries, `EDITOR_LAUNCHER` present, `PTY_HOST` correctly absent), but nothing enforces that going forward beyond a reviewer re-counting by hand.

### 4. Where is this inconsistent with the rest of the repository?

- `runWorkspaceWatcherContract`'s `(name, setup)` shape vs. every sibling contract runner's `(name, createXxx, teardown?)` — including `runFileSystemContract`, the file the plan (`batches.md:443`, Task 7.3 "Pattern to follow: `run-file-system-contract.ts:145-155`") explicitly named as the pattern to follow, which itself keeps `teardown` as a standalone third parameter (`run-file-system-contract.ts:31-35`) even though it also carries a fourth `options` bag.
- The duplicated case-fold and segment-rule algorithms vs. the rest of platform-core, which otherwise takes policy purely as opaque data (globs, segment arrays) with no algorithmic overlap against `shared`.

### 5. What would you have done differently, and why is that better rather than merely other?

Keep `teardown` as its own trailing parameter on `runWorkspaceWatcherContract` (`(name, setup, teardown?)` or leave `setup.teardown` out and add a fourth positional arg) so the 16 contract runners keep one shared shape; a maintainer scanning the file list for "how do these all work" stays right every time instead of right 15 times out of 16. For the duplicated primitives, either (a) add a self-spec-style property test in `workspace-change-coalescer.spec.ts` that runs both implementations against the same fuzzed input set and fails on divergence (cheap, catches drift immediately, needs no import), or (b) accept the duplication explicitly in both files' doc comments with a "keep these behaviourally identical" pointer to each other — the current state states the *reason* for duplication (`workspace-watcher.interface.ts:28-33`) but never flags that the algorithms themselves, not just the ignore lists, are now duplicated and must stay in sync.

## Blocking issues

None.

## Serious issues

### Contract-runner signature diverges from all 15 siblings and from its own cited precedent

- File: `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.ts:123-126`
- Problem: every other `run*Contract` function in this directory (`runCommandRegistryContract`, `runHttpServerProviderContract`, `runMasterKeyProviderContract`, `runWorkspaceLifecycleContract`, and the plan's own cited precedent `runFileSystemContract`) takes `(name, createXxx, teardown?, …)` with `teardown` as a distinct trailing parameter. `runWorkspaceWatcherContract` instead takes one `setup: WorkspaceWatcherContractSetup` object with `teardown` folded inside it (interface at `run-workspace-watcher-contract.ts:21-53`, `teardown?(): Promise<void> | void;` at line 52).
- Tradeoff: the richer option surface (timeouts, cadence tolerance, `subscribeSettleMs`) is a legitimate reason for an options bag, but grouping `teardown` into that bag specifically breaks the one convention every other runner in the same directory — including the file the plan named as this task's own pattern to follow — keeps.
- Recommendation: keep `teardown` as a standalone trailing parameter (`runWorkspaceWatcherContract(name, setup, teardown?)`), or explicitly note in the file header why this contract's shape needed to depart from the other 15.

### Segment-matching and case-fold algorithms are duplicated between `platform-core` and `shared`, and have already diverged

- File: `libs/backend/platform-core/src/utils/workspace-change-coalescer.ts:386-403` (`matchesSegmentRule`) and `:442-454` (`equalsIgnoringAsciiCase`), vs. `libs/shared/src/lib/constants/workspace-scan.constants.ts:190-211` (`ruleMatchesAt`) and `:222-233` (`equalsIgnoringAsciiCase`)
- Problem: this is a deliberate, plan-recorded decision (D5 in `implementation-plan.md`, restated at `batches.md:431` — "mirroring the shared predicate. ... No import from `@ptah-extension/shared`"), and the direction is correct: both `platform-core/CLAUDE.md:131` ("This imports nothing from `@ptah-extension/*`") and `libs/shared/CLAUDE.md:53` ("must not import any other `@ptah-extension/*` lib") declare themselves zero-internal-dependency leaves, so neither can import the other's pure helper without breaking its own documented invariant, and there is no lower shared library either can import from instead. Duplicating the ALGORITHM (not just accepting the DATA as parameters, which the interface doc at `workspace-watcher.interface.ts:28-33` correctly frames as the reason platform-core takes segment rules/globs rather than the named constants) was therefore close to unavoidable given both libs' stated architecture — but it is real duplication of non-trivial logic (not the ignore-list values, the matching algorithm itself), and the two `equalsIgnoringAsciiCase` implementations already differ: `charCodeAt` (coalescer) vs `codePointAt` with an explicit non-BMP-surrogate note (shared).
- Tradeoff: nothing currently proves the two stay behaviourally identical; a fix or an edge case landed in one will not automatically surface in the other, and both are tested only against themselves.
- Recommendation: at minimum, cross-reference both implementations in their doc comments ("this must stay behaviourally identical to `<other file>`'s equivalent"); ideally add a differential test (fuzz both functions with the same inputs, assert equal results) in one of the two spec files so a future divergence fails CI instead of shipping silently.

## Minor issues

- `libs/backend/platform-core/CLAUDE.md:52` states "Exclusions arrive as segment rules + globs because this lib cannot import `shared`" without cross-referencing that the *algorithms* for applying those rules are also independently reimplemented here — a reader who takes the doc's data/algorithm distinction at face value could assume the coalescer's exclusion logic and shared's are the same code path.
- `workspace-change-coalescer.ts:196` / `:379` mix `caseInsensitive ? relative.toLowerCase() : relative` (allocating) with the allocation-free `equalsIgnoringAsciiCase` used elsewhere in the same file (`:393`) for essentially the same case-fold job on the hot path (`push`); not a correctness issue, just an inconsistency of technique within one file worth a second look if `push` throughput ever matters (it is documented as "cheap for excluded and storming events", and pending-path dedup is not on that documented fast path, so this is genuinely minor).
- `run-workspace-watcher-contract.self.spec.ts:32-35` passes `onListenerError: (error) => { throw error; }` — reasonable for a self-test that wants failures loud, but it is the only contract self-spec that rethrows from a hook rather than pushing to a collected-errors array the way `workspace-change-coalescer.spec.ts` does (`listenerErrors: unknown[]`); harmless given the contract suite already asserts on delivered batches, not listener-error content, but a very minor deviation from the sibling file's own test-double pattern.

## File-by-file

### `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (folded into the CLAUDE.md item above, since it originates from this file's doc comment). Textbook port definition: `I`-prefixed, one method, every guarantee written down as a doc comment with the invariant ID (`INV-1`) and the concrete 2026-09-14 incident that motivated it, cited exactly the way `boot-readiness.interface.ts` and other existing ports do. `export type` used correctly for a type-only interface.

### `libs/backend/platform-core/src/utils/workspace-change-coalescer.ts`

Score 7/10 — 0 blocking, 1 serious (duplication), 1 minor (case-fold technique inconsistency). Clean state machine, correctly separates `push`/`flush`/storm handling, matches the `EventStormBreakerOptions`/`StormRecordResult`/`StormPollResult` API from `event-storm-breaker.ts` exactly. 455 lines, well under the 700-line soft ceiling. `dispose()` idempotency and "never call listener synchronously" are both directly testable and directly tested.

### `libs/backend/platform-core/src/utils/workspace-change-coalescer.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Covers cadence, cap/truncation, exclusion (segment rules, globs, Windows path folding, nested roots — both seeded and detected), storm/overflow (including "storm that never quiets"), and dispose/listener-failure paths — exactly the INV-1 checklist the batch's own "Done when" criterion (`batches.md:449`) names. `FakeClock` is a reasonable, self-contained deterministic-timer double consistent with how other specs in this codebase avoid real timers for cadence assertions.

### `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.ts`

Score 6/10 — 0 blocking, 1 serious (signature shape), 0 minor. Content-wise this is a strong contract: it exercises real time, drives the adapter through its own file I/O rather than internals, and skips (visibly, via `it.skip`) the overflow case when an adapter offers no injection point rather than silently omitting it. The `setup` object shape is the one place it steps outside the established family pattern.

### `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.self.spec.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (listed above). Matches the `.self.spec.ts` convention exactly: minimal in-memory adapter built the same way a real adapter would be (one coalescer per subscription, fed raw events), doc comment explains the fix-the-right-side reasoning the same way `run-editor-provider-contract.self.spec.ts` and siblings do.

### `libs/backend/platform-core/src/di/tokens.ts`, `src/index.ts`, `src/testing/contracts/index.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `WORKSPACE_WATCHER: Symbol.for('PlatformWorkspaceWatcher')` follows the `Symbol.for('Platform*')` convention exactly; barrel exports split `export type` (interfaces/types) from `export` (`WorkspaceChangeCoalescer`, `WORKSPACE_WATCH_LIMITS` — runtime values) exactly as the rest of `index.ts` does; contract barrel appended in the same append-only style as its 12 siblings.

### `libs/backend/platform-core/CLAUDE.md`

Score 8/10 — 0 blocking, 0 serious, 1 minor (cross-reference gap noted above). Token count verified: 28 real `Symbol.for(` entries in `tokens.ts` (line-anchored regex count, excluding the two `Symbol.for(` mentions inside the file's own header comment) matches the stated "28 tokens" in both the Public API line and the DI Tokens section. `EDITOR_LAUNCHER` correctly added to the table (verified present in `tokens.ts:45` and used at `index.ts:64`); `PTY_HOST` correctly removed (verified absent from current `tokens.ts`). The correction is accurate, not new drift.

### `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`

Score 10/10 — 0 blocking, 0 serious, 0 minor. `'workspace-watcher'` appended to both `DegradationSource` and `DEGRADATION_SOURCE_VALUES` in the same diff, exactly the paired-edit rule `libs/shared/CLAUDE.md:28` states ("Widening `DegradationSource` means appending to the union **and** to `DEGRADATION_SOURCE_VALUES` together"). Correctly does NOT touch `ALLOWED_METHOD_PREFIXES` — `rpc-degradation.types.ts` is documented push-only with no RPC method, so the dual-registration rule does not apply here, and the batch correctly leaves it alone.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `I`-prefix for platform ports, `export type` for type-only interfaces | PASS | `workspace-watcher.interface.ts:142`, `index.ts:106-113` |
| `PLATFORM_TOKENS` entries use `Symbol.for('Platform*')` | PASS | `tokens.ts:126` |
| New port registered: interface + token + index export (adapters deferred per plan) | PASS | `tokens.ts`, `index.ts`, `CLAUDE.md` all updated together; adapters explicitly deferred to Batches 8–9 per `batches.md:425` |
| Contract runner + `.self.spec.ts` pattern present for every port | PASS | `run-workspace-watcher-contract.ts` + `.self.spec.ts`, barrel export added |
| Contract runner signature matches sibling `(name, createXxx, teardown?)` shape | FAIL | `run-workspace-watcher-contract.ts:123-126` folds `teardown` into `setup` |
| platform-core takes exclusion policy as data, not by importing `shared` | PASS (by design, data channel) / PARTIAL (algorithm duplicated) | `workspace-watcher.interface.ts:28-33`; `workspace-change-coalescer.ts:386-403,443-454` vs `workspace-scan.constants.ts:190-211,222-233` |
| `DegradationSource` union + `DEGRADATION_SOURCE_VALUES` widened together | PASS | `rpc-degradation.types.ts` diff |
| RPC dual-registration (`ALLOWED_METHOD_PREFIXES`) for the new degradation source | NOT_APPLICABLE | `rpc-degradation.types.ts` is push-only per `libs/shared/CLAUDE.md:28`; no method added |
| File size soft ceiling (700 lines) | PASS | Largest non-spec file is 455 lines (`workspace-change-coalescer.ts`) |
| Colocated `.spec.ts` next to `.ts` in `utils/` | PASS | `workspace-change-coalescer.ts` + `.spec.ts`, matching every sibling in the directory listing |
| `catch (error: unknown)` / no untyped catch | PASS | `workspace-change-coalescer.ts:332` (`catch (error: unknown)`) |
| CLAUDE.md token table accuracy | PASS | 28 counted, `EDITOR_LAUNCHER` present, `PTY_HOST` absent — verified against `tokens.ts` directly |

## Maintenance debt

- Introduced: one new port (`IWorkspaceWatcher`), one new pure utility (`WorkspaceChangeCoalescer`) with a colocated spec, one new contract runner + self-spec, one widened closed union (`DegradationSource`); a second, independent implementation of "case-insensitive segment-sequence matching" alongside the one already in `shared`.
- Retired: nothing.
- Net: the port and coalescer are additive and self-contained (no adapter wiring lands until Batches 8–9, so nothing downstream depends on this yet). The one real cost carried forward is the un-cross-referenced algorithmic duplication between `platform-core` and `shared`, which is architecturally justified but currently undocumented as a "keep these in sync" pair and untested against each other.

## Verdict

- Recommendation: APPROVE (with the two serious findings as strongly recommended follow-ups, not blockers — neither breaks a stated invariant, both are consistency/drift-prevention gaps)
- Confidence: HIGH
- Key concern: the contract-runner signature is the one place this batch visibly breaks an established, otherwise 16-for-16 consistent pattern in its own directory, including the file the plan named as its pattern to follow.
- What a 10/10 version would do differently: keep `teardown` as `runWorkspaceWatcherContract`'s own trailing parameter; add one differential/property test (or at minimum a paired doc cross-reference) tying the coalescer's segment-rule/case-fold logic to `shared`'s equivalent so the two cannot silently diverge further than they already have.
