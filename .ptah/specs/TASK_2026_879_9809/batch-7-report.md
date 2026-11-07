# Batch 7 report: O3 host producer and wiring (TASK_2026_879_9809), plus hold-TTL deflake (decision 28)

Executor: backend-developer subagent. I ran no git commands and did not edit `batches.md`.

All edits are inside `libs/backend/lane-outcomes`. I made no Electron, cli-engine, agent-sdk or codex edit.

## Tasks

### 7.1 `declareWrittenDeliverables` in `recordSubagentEnded` (done)

File: `lane-outcome-recorder.service.ts`

**Constructor**
- The recorder takes an optional sixth argument, `fileSystem?: DeliverableFileSystem`.
- `DeliverableFileSystem` is an exported type alias for `Pick<IFileSystemProvider, 'stat' | 'realpath'>` (R1).

**`recordSubagentEnded`**
- When there is a row, a non-blank message and a filesystem, it calls `void this.declareWrittenDeliverables(...).catch(warn)`.
- This runs for every role and follows the `captureReview` pattern. Review capture still runs only for review rows, as before.
- An unexpected rejection logs `reason: 'check-failed'` with the error name only. Nothing throws into the SDK callback.

**`declareWrittenDeliverables(fs, runId, cwd, message)`**
1. Calls `parseWroteLines`. A `none` result returns silently. A `too-many` or `malformed` refusal logs a warn with `reason` set to the refusal and `paths: 0`.
2. A blank `cwd` logs `no-root`.
3. Any entry that fails `containedDeliverablePath` logs `escapes-workspace`. The whole report is refused before any filesystem call.
4. Calls `checkDeliverable(fs, cwd, entry)` for each path (`Promise.all`, at most 20 because of the parser cap). An `outside-root` result logs `escapes-workspace`. Any other `errorCode` logs `stat-failed` with `code`.
5. Otherwise calls `declareSubagentDeliverables({runId}, checks, {origin:'host'}, {reportId: hostDeliverablesReportId(runId)})`.
6. A result with `ok:false` logs `not-applied` with the pipeline's fixed `error` string.

**The warn line**
- Message: `'Subagent deliverables not verified'`.
- Meta: `{runId, reason, code?|error?, paths: <count>}`. No path text is ever logged.

**`declareSubagentDeliverables`**
- `meta.origin?: 'host'` is added and passed into the payload.
- A new fourth parameter `options.reportId` follows the `attachReview` shape.
- Existing callers, including `vscode-lm-tools/.../outcome-report.tool.ts`, are unaffected: the change is additive and typecheck passes.

### 7.2 Recorder spec (done)

File: `lane-outcome-recorder.service.spec.ts`.

- **Change to `harness`:** it takes an optional third `fileSystem` argument.
- **New block:** `describe('LaneOutcomeRecorder host-observed deliverables')` uses a temp dir and a Node-backed port that records each `realpath` and `stat` call. It has 11 tests:
  1. A non-empty file under a worktree-shaped cwd (A3, `checkout/.claude-worktrees/task-n`) produces one host receipt and `delivered`. It also asserts that realpath was called on the root and on the file (R1), and that exactly one stat ran.
  2. A missing file gives `no-deliverable`.
  3. Decision 16 case 1: with cwd at the main checkout, `WROTE: .claude-worktrees/task-n/out/report.md` is counted (`delivered`).
  4. Decision 16 case 2: with cwd at a worktree and the deliverable in the parent checkout (absolute path), the row stays `unverified`. There is no submit and no stat, and the warn is `escapes-workspace`.
  5. With one in-root path and one `../../outside.txt`, the whole report is refused with no stat and `paths: 2`.
  6. A stat `EACCES` logs exactly `{runId, reason:'stat-failed', code:'EACCES', paths:1}`.
  7. A blank cwd logs `no-root`.
  8. 21 `WROTE:` lines log `{runId, reason:'too-many', paths:0}`.
  9. With no `WROTE:` line there is no submit, no realpath and no warn.
  10. A repeated `subagentEnded` gives exactly one applied or joined host report, a `duplicate` on the repeat, an unchanged `deliverablesDeclaredAt`, and no warn.
  11. With no filesystem port the producer is inert: no submit, no receipt, `unverified`.
- **Path-text check:** every warn assertion also checks that the serialised warn calls contain neither the temp dir nor the file names.
- **A4:** `bucketFor` (`lane-routing/src/lib/matrix/local-derivation.ts:131-160`) buckets by `[family, matrixModelKey(model), taskKind]`, and skips null `taskKind`, blank family or blank model.
  - A subagent row has `family: SUBAGENT_FAMILY` and `model: LANE_DEFAULT_MODEL`, which maps to `FAMILY_PROFILE_MODEL`.
  - So a `delivered` subagent row with a mapped or classified task kind lands in the `SUBAGENT_FAMILY` bucket.
  - An unclassified one (null kind) is not bucketed. That behaviour predates this batch.

### 7.3 Integration precedence (done)

File: `subagent-stop.integration.spec.ts`.

- `fixture()` accepts an optional filesystem port and binds it to `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` before `registerLaneOutcomeServices`. Existing tests pass none, so the producer is inert for them.
- New test: an explicit `delivered` report is held before the stop. Then `subagentEnded` arrives with `WROTE: missing.md` (the host alone would say `no-deliverable`), followed by the stop hook. The host receipt is written and the row stays `delivered`, so the explicit report wins.

### 7.4 Optional filesystem resolution (done)

- `di/register.ts`: the recorder factory passes `c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) ? c.resolve<IFileSystemProvider>(...) : undefined`. There is no new token.
- `di/register.spec.ts` (new) resolves the recorder with and without the token. With the token bound, `realpath('/workspace')` and `stat('/workspace/out.md')` are called on a `WROTE:` message. Without it, neither is called.

### Wiring and registration sites

`ptah_lsp_references` timed out, so I used grep for `registerLaneOutcomeServices(` and `new LaneOutcomeRecorder(`.

**`registerLaneOutcomeServices(` call sites**
- `apps/ptah-electron/src/di/phase-2-libraries.ts:312`
- `libs/backend/lane-outcomes/src/lib/di/start.ts:76`
- `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:14`

**`new LaneOutcomeRecorder(` call sites**
- Production: `di/register.ts:79` only.
- Specs: `lane-outcome-recorder.service.spec.ts`, `outcome-early-review.integration.spec.ts`, `cli-agent-runtime/.../lane-terminal-outcomes.integration.spec.ts`. All three stay valid with the optional sixth argument.

**Electron**
- `libs/backend/platform-electron/src/registration.ts:117` binds `FILE_SYSTEM_PROVIDER` in phase 0.
- `container.ts:47` starts lane outcomes after every phase, and the recorder is resolved lazily.
- So Electron receives the filesystem port without a composition-root edit, and `expected-resolvable.ts` is unchanged.

**cli-engine**
- `libs/backend/platform-cli/src/registration.ts:71` binds the port too.
- The benchmark never emits `subagentEnded`, so the producer is never reached there.
- cli-engine test and typecheck pass.

## Deflake (decision 28)

**Cause**
- `holdReport` prunes with `Date.now()` in the in-memory/key-value store (`in-memory-lane-outcome.store.ts:229`) and in the sqlite store (`sqlite-lane-outcome.store.ts:117-119`).
- The fixture `heldReport(i, now)` expires at `now + 1000`.
- When 500 holds take more than 1 s under load, the earlier holds are pruned (the failure was "Expected 497, Received 1").

**Fix**
- Neither store has a clock seam, so production code is unchanged.
- In `store/key-value-lane-outcome.store.spec.ts` and `store/sqlite-lane-outcome.store.spec.ts`, a `freezeDate(now)` helper calls `jest.useFakeTimers({ now, doNotFake: [nextTick, queueMicrotask, set/clearImmediate, set/clearTimeout, set/clearInterval, hrtime, performance] })`. That fakes only `Date`.
- The two 497-plus-one tests call it right after capturing `now`, and restore with `jest.useRealTimers()` in `finally`.
- Their assertions are unchanged.

**Not changed**
- Other tests that hold reports use only a few operations, or my 60 s expiries, so I left them alone.

## Changed files

All paths are under `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/`:

- MODIFIED `lane-outcome-recorder.service.ts`
- MODIFIED `lane-outcome-recorder.service.spec.ts`
- MODIFIED `subagent-stop.integration.spec.ts`
- MODIFIED `di/register.ts`
- CREATED `di/register.spec.ts`
- MODIFIED `store/key-value-lane-outcome.store.spec.ts` (deflake)
- MODIFIED `store/sqlite-lane-outcome.store.spec.ts` (deflake)

`register.ts`, `register.spec.ts` and the recorder service were already prettier-clean at HEAD, so I formatted them whole. For the specs that were not clean at HEAD, I formatted only my own blocks. `git diff -U0` shows no hunk on older lines.

## Risks

- **R1:** the port type is `'stat' | 'realpath'`. Test 1 asserts realpath on both the root and the file, and the register spec asserts it too.
- **R4:** the precedence check runs in the store (Batch 5). Task 7.3 covers it end to end.
- **R5 and no path text:** warn meta is a fixed shape. The tests assert that the serialised warn calls contain no temp-dir or file names.
- **Never throws into the SDK:** the whole chain is `void … .catch(warn)`.
- **At most 20 stats:** the parser caps paths at 20.

## Verification

1. `npm run verify -- -p @ptah-extension/lane-outcomes`
   - First run: `NX 3 tasks: 2 succeeded, 1 failed`. The cause was TS7006 in my new recorder spec, read from the Nx log `~/.nx/.../terminalOutputs/10046136560085678517`. I fixed it by typing the parameter.
   - Second run: `NX 3 tasks: 3 succeeded` (lint, test, typecheck; lock line names only `@ptah-extension/lane-outcomes`). Tests: `Test Suites: 20 passed, 20 total`, `Tests: 333 passed, 333 total`. This includes both deflaked hold-TTL tests.
2. `npm run verify -- -t typecheck -p @ptah-extension/skill-synthesis,@ptah-extension/vscode-lm-tools,@ptah-extension/rpc-handlers,@ptah-extension/cli-agent-runtime`: `NX 4 tasks: 4 succeeded`.
3. `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`: `NX 10 tasks: 10 succeeded`, which includes dependency tasks. I matched these Jest summaries to the two projects by timestamp: Electron `94 passed (1 skipped) suites, 1615 passed / 8 skipped tests`; cli-engine `28 passed suites, 263 passed tests`.

None of the runs printed a "Running target ... for N projects" header. The lock lines name the requested projects.

## Decisions

- **Name of the filesystem port type.** The recorder exports `DeliverableFileSystem` (`Pick<IFileSystemProvider,'stat'|'realpath'>`) instead of repeating the Pick in each place.
  - Options: an inline Pick, or a named alias.
  - The alias keeps the spec, the constructor and the producer in step.
  - It is not added to `src/index.ts` (Batch 2's file); nothing outside the lib needs it.
  - Reversible.
- **Lexical pre-check before any stat.** The producer calls `containedDeliverablePath` on every entry first, so a report with one escaping entry makes no filesystem calls at all. This matches the tool's "refuse the whole report" rule. `checkDeliverable`'s realpath `outside-root` result is still mapped to `escapes-workspace`. Reversible.
- **Field for the `ok:false` warn.** It carries `error` (the pipeline's fixed string), not `code`, because those strings are messages rather than codes. They contain at most a run id, never a path. Reversible.
- **Deflake method.** Jest fake timers fake `Date` only. Every other timer and microtask stays real, because the stores await promises and the pipeline uses `setImmediate`. There is no production clock seam, so production code is unchanged. Reversible.
- **No Electron or cli-engine edit.** Both composition roots already bind `FILE_SYSTEM_PROVIDER` before the lazy recorder resolve. The plan says "no host composition-root edit".
