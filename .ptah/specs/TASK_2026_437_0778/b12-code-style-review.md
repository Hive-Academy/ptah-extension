# Code Style Review — `TASK_2026_437_0778` Batch 12 (C11 git process supervision)

## Summary

| Metric          | Value                                |
| ---------------- | ------------------------------------ |
| Overall score    | 6/10                                  |
| Assessment       | NEEDS_REVISION                        |
| Blocking issues  | 0                                     |
| Serious issues   | 3                                     |
| Minor issues     | 3                                     |
| Files reviewed   | 4 (exec-git.ts, exec-git.spec.ts, git-info.service.ts, git-info.service.spec.ts) |

## Five style questions

### 1. What breaks in six months?

`GitProcessGate` is reached through a private module-level singleton
(`libs/backend/vscode-core/src/utils/exec-git.ts:169-179`, `gitProcessGate()`)
instead of the tsyringe DI graph every other gate/semaphore of this shape uses
(`InternalQueryConcurrencyGate`, `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:167,332` is `@injectable()`). The next person who needs to
surface `liveCount`/`queuedCount` on a diagnostics panel, or wants a
per-workspace override, will either reach into module state through another
test-only export or duplicate the class inside the DI graph. `PTAH_GIT_MAX_CONCURRENT`
is read once, lazily, at first call (`exec-git.ts:155-161`, `:169-171`) — a
value changed after the first git call in a process has no effect until
`resetGitProcessGateForTests()` runs, which is exported for tests only.

### 2. What would a new team member misread?

`vscode-core/CLAUDE.md:51-61` carries a table of every env var this exact lib
uses to tune background supervision thresholds (`PTAH_LOOP_LAG_WARN_MS`,
`PTAH_RPC_SLOW_WARN_MS`, etc.), with the explicit framing "on by default,
costs one timer wakeup." `PTAH_GIT_MAX_CONCURRENT` is the same shape of knob —
introduced in this batch, undocumented anywhere in that file. A reader who
greps the CLAUDE.md table for it (the documented way to discover these knobs)
will conclude it doesn't exist.

### 3. What does this cost to maintain?

`exec-git.ts` grows from ~213 to 590 lines in this batch, all of it the gate,
its error type, and its env parsing living inside a file whose stated purpose
(`exec-git.ts:1-9` original doc) was "run git and return stdout." That is
within the repo's 700-line soft ceiling and matches the plan's explicit file
assignment (`implementation-plan.md:601`), so it isn't a violation — but it's
the reason `GitProcessGate`'s own dependencies (a logger, a clock) had to be
passed as optional constructor params with `console.warn` defaults rather than
resolved from the container the rest of the lib uses, which is the real cost:
one more state machine that can't be wired the way its siblings are.

### 4. Where is this inconsistent with the rest of the repository?

- `GitProcessGate.warn` defaults to `console.warn` (`exec-git.ts:89-90`) while
  `GitInfoService`, constructed one file over with the same `Logger` type,
  logs every warn/error through `this.logger.warn(...)` /
  `.error(...)` with a `[GitInfoService]` prefix (e.g.
  `git-info.service.ts:528`, `:809`, `:1389`). `[GitProcessGate] saturated`
  (`exec-git.ts:118-122`) never reaches that logger or its transports (file
  output, Sentry breadcrumbs) — it goes to raw stdout. `GitInfoService` never
  threads its own logger down into `execGit`/`execGitBuffer` to close that
  gap; `ExecGitOptions` has no `warn`/`logger` field.
- `InternalQueryConcurrencyGate` (`libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:167`)
  is the closest sibling in the codebase — a FIFO concurrency gate with
  queue/in-flight introspection and env-driven limits — and it is
  `@injectable()`, reached through the DI container like every other service
  in this repo (per `CLAUDE.md` Coding Standards: "Always use constructor
  injection"). `GitProcessGate` solves the identical shape of problem with a
  hand-rolled `??=` singleton instead.
- The new public surface (`GitProcessGate`, `GitOutputLimitError`,
  `DEFAULT_GIT_MAX_OUTPUT_BYTES`, `GIT_STATUS_MAX_OUTPUT_BYTES`,
  `DEFAULT_GIT_MAX_CONCURRENT`, `GitSlotRelease`) is not re-exported from
  `libs/backend/vscode-core/src/index.ts:96-105`, which exports
  `execGit`/`execGitBuffer`/`DEFAULT_GIT_TIMEOUT_MS`/`WORKTREE_GIT_TIMEOUT_MS`
  and the `ExecGitOptions`/`ExecGitResult` types from the same file. A
  consumer outside `vscode-core` that wants to special-case
  `GitOutputLimitError` (`error.code === 'GIT_OUTPUT_LIMIT'`) cannot import it
  through the lib's public surface today; it would have to reach past the
  barrel. `vscode-core/CLAUDE.md`'s "Public API" section (lines 27-36) is
  also not updated to list the new error type or gate.

### 5. What would you have done differently?

Register `GitProcessGate` in the DI container the way `InternalQueryConcurrencyGate`
is registered, injecting the existing `Logger` for `warn` and letting
`GitInfoService`/callers resolve it instead of calling a private
`gitProcessGate()` accessor. That would also let `PTAH_GIT_MAX_CONCURRENT` be
read once at registration time (matching how other env-driven thresholds in
this lib are documented and read) rather than lazily inside a getter that
tests have to reset around. Short of a full DI wiring, threading an optional
`warn`/`logger` callback down from `GitInfoService` into `ExecGitOptions`
would at least route the one production warn line through the same transport
as every other line this service emits.

## Blocking issues

None. The behavioural contract (slot release timing, output cap, priority,
env parsing) matches `implementation-plan.md:575-602` and
`batches.md:614-623`, and the test suite pins the documented edge cases
(queued-timeout-clock, forced-kill grace, sync spawn throw, output cap,
priority).

## Serious issues

### `GitProcessGate` bypasses the DI container the rest of the lib uses

- File: `libs/backend/vscode-core/src/utils/exec-git.ts:76-179`
- Problem: every comparable concurrency gate in the codebase
  (`InternalQueryConcurrencyGate`, `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:167,332`)
  is `@injectable()` and reached through tsyringe. `GitProcessGate` is
  reached through a private module-level `let processGate` guarded by
  `??=` (`exec-git.ts:169,178`), with a test-only `resetGitProcessGateForTests`
  export to undo the caching. `CLAUDE.md` Coding Standards: "Always use
  constructor injection."
- Tradeoff: the module-singleton shape means the gate can never receive the
  project's `Logger`, so its one production log line goes to `console.warn`
  instead of the logger every sibling class uses (see next finding), and any
  future consumer that wants to read `liveCount`/`queuedCount` for
  diagnostics has to import a hidden singleton accessor rather than resolve
  a token.
- Recommendation: register `GitProcessGate` behind a `TOKENS` entry (or, if
  DI wiring for a plain-function utility module is judged out of scope for
  this batch, say so explicitly in the plan/CLAUDE.md rather than leaving the
  inconsistency uncommented).

### `[GitProcessGate] saturated` warns to `console.warn`, not the injected `Logger`

- File: `libs/backend/vscode-core/src/utils/exec-git.ts:89-90`, `:118-122`;
  compare `libs/backend/vscode-core/src/services/git-info.service.ts:528`,
  `:809` (`this.logger.warn(...)`, `[GitInfoService] ...` prefix)
- Problem: `GitInfoService` — the only current caller that matters for the
  watcher path this gate exists to protect — already carries a `Logger`
  through constructor injection and uses it for every warn/error in the same
  file. The gate's one warn line instead defaults to raw `console.warn`,
  which the `Logger`'s file transport, structured fields and any
  Sentry/telemetry breadcrumb wiring never see.
- Tradeoff: a maintainer debugging saturation from a shipped log bundle (the
  scenario `src/diagnostics/` exists for, per `vscode-core/CLAUDE.md:38-46`)
  loses this line entirely unless they also have raw stdout.
- Recommendation: thread a `warn`/`logger` callback from `GitInfoService`
  (or whichever caller constructs the gate) through to `GitProcessGate`,
  the same way `ExecGitOptions.spawner` is already threaded to avoid a hard
  VS Code/platform dependency.

### New public types are not exported from the lib barrel or documented in the Public API section

- File: `libs/backend/vscode-core/src/index.ts:96-105` (exports
  `execGit`, `execGitBuffer`, `DEFAULT_GIT_TIMEOUT_MS`,
  `WORKTREE_GIT_TIMEOUT_MS`, `ExecGitOptions`, `ExecGitResult` — all from the
  same source file as this batch's additions); `libs/backend/vscode-core/CLAUDE.md:27-36`
  ("Public API" section, not updated)
- Problem: `GitProcessGate`, `GitOutputLimitError`, `GitSlotRelease`,
  `DEFAULT_GIT_MAX_OUTPUT_BYTES`, `GIT_STATUS_MAX_OUTPUT_BYTES`,
  `DEFAULT_GIT_MAX_CONCURRENT` are new exported symbols from
  `exec-git.ts` that the barrel does not re-export and the CLAUDE.md Public
  API list does not mention, unlike every sibling symbol from the same file.
  No caller outside `vscode-core` currently imports them (confirmed by
  repo-wide grep), so nothing is broken today, but a consumer that wants to
  special-case `GitOutputLimitError.code === 'GIT_OUTPUT_LIMIT'` has no
  supported import path.
- Tradeoff: leaving a typed error uncrossed at the lib boundary usually means
  it gets caught by a bare `catch` downstream and its `code` is never
  checked — exactly the failure mode a typed error exists to prevent.
- Recommendation: add the new symbols to the barrel and the CLAUDE.md Public
  API line, or state explicitly that `GitOutputLimitError` is intentionally
  internal-only (in which case it should not need a discriminated `code`
  field at all).

## Minor issues

- `PTAH_GIT_MAX_CONCURRENT` is missing from the env var table in
  `vscode-core/CLAUDE.md:51-61`, which documents every other threshold env
  var this lib reads, including its default and effect columns.
  `exec-git.ts:155-161` parses it with the same "malformed → ignored, default
  applies" contract the CLAUDE.md already states as a rule for this class of
  var (`:63-65`) — the code follows the convention, the doc doesn't record
  the new instance of it.
- `resetGitProcessGateForTests` (`exec-git.ts:174-179`) mirrors the existing
  `resetResolvedGitBinaryForTests` (`exec-git.ts:233-238`) in the same file,
  so it has direct local precedent and is not itself a new pattern — noted
  only because it compounds the DI-bypass finding above (a DI-registered gate
  would use the container's own per-test child scope instead of a manual
  reset export).
- `GitOutputLimitError` (`exec-git.ts:41-51`) is the first typed git error in
  this file; existing failures in `execGit`/`execGitBuffer` (timeout, spawn
  error) still reject with a plain `Error` and a message-only contract
  (`exec-git.ts:307-311` timeout, `onError` path). The new error's `code`
  literal convention is sound in isolation but is not applied consistently to
  the sibling timeout/spawn-error paths in the same function, so a caller
  now has to know which git failures are typed and which are not.

## File-by-file

### `libs/backend/vscode-core/src/utils/exec-git.ts`

Score 6/10 — 0 blocking, 2 serious, 2 minor. The gate's own logic (FIFO,
round-robin, slot-vs-child ownership, output cap, priority) is correct and
well-commented, matching the plan's failure-behaviour contract
(`implementation-plan.md:596-597`) line for line. The two serious findings
are both about how the gate is reached and how it reports, not about what it
does once reached.

### `libs/backend/vscode-core/src/utils/exec-git.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Coverage matrix at the top
(`:14-25`) matches the actual `it` blocks; concurrency cap, timeout-clock,
forced-kill grace, output cap, spawn-error and priority paths are each
directly asserted against fake-timer-controlled children, consistent with the
existing suite's style (`makeHeldChild`, `drain()`).

### `libs/backend/vscode-core/src/services/git-info.service.ts`

Score 7/10 — 0 blocking, 0 serious, 1 minor (the untyped-error inconsistency
above touches this file's callers too, since `computeGitInfo` now has to
special-case `GitOutputLimitError` implicitly through the generic catch at
`:561-569` without ever checking `.code`). The `singleFlight` rewrite
(`:443-459`) is a real readability improvement over the previous
try/catch-to-reject pattern and is well-commented on why the executor must
run `compute` synchronously. `refreshGitInfo` threading `priority:
'background'` through `computeGitInfo`/`isGitRepo`/`readNumstat`
(`:389-395`, `:504-541`) is a clean, minimal-surface change that reuses the
existing single-flight key rather than inventing a new one — consistent with
the file's own idiom.

### `libs/backend/vscode-core/src/services/git-info.service.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. New `describe` block
(`:1900+`) is scoped to exactly the two new behaviours (background priority,
untracked cap) with its own fake spawner, and the coverage-matrix comment
block at the top is kept in sync with the new `it`s, matching the file's
existing documentation convention.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `catch (error: unknown)` | PASS | `exec-git.ts:415` (`catch (error: unknown)` around spawn), `git-info.service.ts` unchanged catches |
| Env var read directly (not via `ConfigService` — this is a non-NestJS lib, so `process.env` is the established idiom) | PASS | `exec-git.ts:156-161`, consistent with `vscode-core/CLAUDE.md`'s own `readMsEnv` pattern |
| `// degradation-audit:` marker on a swallowed catch | PASS | `exec-git.ts:420-424` (`lowerProcessPriority`), correctly kinded `optional-capability` with a reason on its own line |
| New RPC/DI namespace dual-registration | NOT_APPLICABLE | No RPC surface touched in this batch |
| Constructor injection for new stateful classes (`CLAUDE.md` Coding Standards) | FAIL | `GitProcessGate` reached via module-level singleton, not DI; see Serious issue 1 |
| Public API section kept current with lib's exported surface | FAIL | `vscode-core/CLAUDE.md:27-36` not updated; see Serious issue 3 |
| Env var documented in the lib's own threshold table | FAIL | `PTAH_GIT_MAX_CONCURRENT` missing from `vscode-core/CLAUDE.md:51-61`; see Minor issues |
| File size soft ceiling (700 lines, warn-level) | PASS | `exec-git.ts` at 590 lines, under the ceiling; growth matches the plan's file assignment |
| Test-only reset export pattern | PASS (local precedent) | `resetGitProcessGateForTests` mirrors existing `resetResolvedGitBinaryForTests` in the same file |

## Maintenance debt

- Introduced: a second concurrency-gate shape in the codebase
  (module-singleton) alongside the existing DI-registered one
  (`InternalQueryConcurrencyGate`), and a typed error (`GitOutputLimitError`)
  not yet reachable from outside the lib.
- Retired: the previously-undocumented "bounding that concurrency is a
  separate, unmade change" comment (`exec-git.ts` original doc) is now
  resolved and the JSDoc updated to point at `GitProcessGate` — a genuine
  cleanup.
- Net: slightly negative. The behavioural gap (INV-3/INV-4) this batch closes
  is real and well-tested; the two ways it was wired in (bypassing DI,
  bypassing the barrel/CLAUDE.md Public API contract) add a second pattern
  for the next person to reconcile rather than reusing the one the repo
  already has for this exact problem shape.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `GitProcessGate` solves a problem this codebase has already
  solved once (`InternalQueryConcurrencyGate`) with a different, DI-bypassing
  pattern, and its one log line silently misses the project's Logger as a
  result — a debugging aid for exactly the saturation this batch exists to
  surface.
- What a 10/10 version would do differently: register `GitProcessGate` in DI
  with the injected `Logger`; export it and `GitOutputLimitError` from the lib
  barrel with a Public API line in the CLAUDE.md; add `PTAH_GIT_MAX_CONCURRENT`
  to the existing env-var table alongside its siblings.
