# TASK_2026_704_8918 — Recurring RPC timeouts: `agent:getLanePlanLimits` and `git:info` at app startup

## Summary (root cause)

1. **Deadline inversion.** The renderer's RPC deadlines (10 s for `agent:getLanePlanLimits`, 15 s for `git:info`) are shorter than the backend's own designed worst-case service times: the lane lookup waits for its slowest lane and allows a cold Codex/Antigravity lane **12 s** (`SLOW_LIMIT_LOOKUP_DEADLINE_MS`) on top of an unbounded cold `agent.list()` CLI detection, while a git read's budget under host contention is **30 s** per read (`GIT_STATUS_TIMEOUT_MS`) behind a 4-slot gate. A backend-budget-legal cold start therefore always answers after the caller gave up.
2. **Shared cold-start contention.** Both calls fire concurrently at startup into one extension-host event loop (`RpcHandler.handleMessage` has no serialization queue); on Windows every process creation blocks that loop 300–900 ms (`CreateProcessW`, measured in TASK_2026_367), so each call's subprocess storm delays the other's reply past its deadline too.
3. **The late success is dropped and the error repeats.** On timeout the renderer deletes the pending correlation (`claude-rpc.service.ts:154-166`), so the backend's successful reply is discarded; the sources show "unavailable", and their armed watchers/refresh timers re-issue the call — hence "each repeats" in the console.

A longer renderer timeout is not the fix: the other branch raised the plan-limits deadline to 15 s (commit 6e28fe6a2) and the user still sees the timeout, which matches the analysis — cold detection is not deadline-bounded at all, so 15 s is still below the true worst case.

## Evidence (file:line, pre-fix line numbers where noted)

| Claim | Source |
| --- | --- |
| Renderer deadline for the plan-limits call is 10 s | `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:18` (`LANE_PLAN_LIMITS_TIMEOUT_MS = 10_000`) |
| Renderer deadline for `git:info` is 15 s | `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts:23` (`RPC_TIMEOUT_MS = 15_000`); default RPC timeout 30 s at `claude-rpc.service.ts:135` |
| On timeout the renderer drops the pending call, so a late success is discarded | `claude-rpc.service.ts:154-166` (timer deletes `pendingCalls`, resolves failure); `:240-245` (unknown correlationIds are ignored) |
| The handler reads `agent.list()` then `agent.limits(rows)` with no deadline (pre-fix) | `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:105-119` |
| `agent.list()` runs cold CLI detection for 7 adapters **sequentially** | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:464-465` → `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:114` (`for … await adapter.detect()`); adapters: codex, copilot, cursor, antigravity, opencode, pi, grok (`cli-detection.service.ts:57-75`) |
| Windows process creation blocks the host event loop 300–900 ms per launch | `cli-detection.service.ts:41-47` (comment citing TASK_2026_367: "`child_process.spawn` is a synchronous `CreateProcessW` on Windows") |
| The lane lookup waits for the slowest lane; a cold Codex/Antigravity read can hold the response up to 12 s | `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:129-139` (`Promise.all` over per-lane races), `:152-163` (per-lane deadline), docstring `:9-19` ("The whole lookup still waits for the slowest lane…") |
| The slow-lane budget is 12 s, normal is 3 s | `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts:23` (`SLOW_LIMIT_LOOKUP_DEADLINE_MS = 12_000`), `:17` (`LIMIT_LOOKUP_DEADLINE_MS = 3_000`), `:32-37` (codex/antigravity pick 12 s) |
| The lookup accepts a caller deadline (`deadlineMs`) and returns late lanes as 'timeout' rows, never rejecting | `lane-limit-lookup.service.ts:71-76` (`LaneLimitLookupOptions.deadlineMs`), `:128` ("Never rejects"), `:250` (timed-out lanes become rows) |
| Before this fix the namespace dropped that option (only rows were passed) | `agent-namespace.builder.ts:531-534` (pre-fix: `getLaneLimits(rows)`); type at `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts:321-324` (pre-fix: `limits?: (rows) => …`) |
| `git:info` runs a worktree-resolution read plus status + 2 `diff --numstat` reads, each gated | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:203-222` (handler → `resolveReadRoot` → `getGitInfo`), `:324-348` (worktree resolution may list worktrees) |
| A git read's budget is 30 s under contention, and the repo documents exactly this "unavailable (timeout)" symptom | `libs/backend/vscode-core/src/utils/exec-git.ts:24-36` (`GIT_STATUS_TIMEOUT_MS = 30_000`; comment: "under host contention … every refresh then reports 'unavailable (timeout)'"), `:39` (`DEFAULT_GIT_MAX_CONCURRENT = 4` gate), `:1` (cross-spawn on the main thread) |
| The RPC dispatcher runs handlers concurrently in one event loop (no queue serializing them) | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:196-218` (`handleMessage` awaits its own handler per call) |
| Why the errors repeat: the sources stay armed and re-read | `ptah-ui-lane-limits.source.ts:55-57` (failed read sets unavailable; the watcher stays armed, next snapshot change re-reads), `session-git-stats.store.ts:20-22` (`DEBOUNCE_MS = 1_000`, `FRESHNESS_MS = 5_000`, rerun on `entry.rerun` at `:335-341`) |
| Backend has slow-handler instrumentation (> 2 s warn) that can confirm this in the app log | `rpc-handler.ts:105` (`DEFAULT_RPC_SLOW_WARN_MS = 2000`, TASK_2026_323) |

## Prior attempts

- **Other branch, commit 6e28fe6a2** ("LANE_PLAN_LIMITS_TIMEOUT_MS", raised the renderer deadline to 15 s): not in this checkout's history (`git log --all` has no such commit), and the user reports the timeout persists — consistent with this analysis, because cold `agent.list()` detection is unbounded and the 12 s slow-lane budget alone nearly exhausts 15 s.
- **TASK_2026_415** (`.ptah/specs/TASK_2026_415/`): "Boot readiness timeout / startup freeze" — repeated `boot:getReadiness` RPC timeouts at startup; the research report names five boot RPCs that previously blocked the main thread, **including `git:info`** (autocomplete:agents, git:info, config:models-list, session:list, auth:getAuthStatus). Same symptom class: startup event-loop contention + renderer deadlines shorter than handler service times. Merged history exists on main (`Merge pull request #415`).
- **TASK_2026_464_021a** (status: done): `tasks:reindex` timed out after the default 30 s client deadline because the handler ran serially — the same renderer-deadline vs handler-time pattern, fixed in its own task.

## Repro spec

Path: `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.deadline.spec.ts`

- **Before the fix: 3/3 failed** (proving the defect). With fake timers and a `agent.limits` stub emulating the real `LaneLimitLookupService` (a cold Codex lane that resolves at `SLOW_LIMIT_LOOKUP_DEADLINE_MS` = 12 s, or at a caller deadline when given one):
  - "bounds the lane lookup inside the renderer deadline…" — the handler promise was still pending after 10 s, i.e. the renderer has already logged the timeout and dropped the reply.
  - "passes a deadline no larger than the renderer budget…" — the handler passed no options at all.
  - (One assertion in the third test was corrected during the run: `formatPlanLimitRows` returns 6 cells, not 5 — cell 5 is the Source cell the handler drops.)
- **After the fix: all pass**, together with the full existing handler contract spec (32 tests) and the vscode-lm-tools agent-namespace specs (76 tests).

Verification (memory-safe, per project rules):
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts src/lib/handlers/lane-plan-limits-rpc.deadline.spec.ts src/lib/handlers/lane-plan-limits-rpc.handlers.spec.ts --coverage=false --maxWorkers=1` → 32 passed.
- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts src/lib/code-execution/namespace-builders/agent-namespace.limits.spec.ts src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts --coverage=false --maxWorkers=1` → 76 passed.

## Fix

**Implemented for `agent:getLanePlanLimits` (3 source files + 2 spec files):**

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` — `AgentNamespace.limits` now takes an optional `LaneLimitLookupOptions` (backwards compatible: callers passing only rows keep the previous 12 s slow-lane budget).
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` — `limits` forwards the options to `getLaneLimits(rows, options)` instead of dropping them.
3. `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts` — new `LANE_PLAN_LIMITS_LOOKUP_DEADLINE_MS = 8_000`, passed as `{ deadlineMs }`. A lane that misses it comes back as a 'timeout' row (partial result) the panel shows as unknown, instead of a successful reply after the renderer gave up. The "no `refresh`" contract (decisions.md #18) is untouched — the existing no-refresh test still passes.
4. `…/lane-plan-limits-rpc.deadline.spec.ts` (new) and `…/lane-plan-limits-rpc.handlers.spec.ts` (one assertion updated: `limits` now receives rows plus the deadline-only options object; the test's title and the no-refresh intent are preserved).

**Proposed, NOT implemented — `git:info`:**

- The same inversion: 15 s renderer deadline (`session-git-stats.store.ts:23`) vs 30 s per-read budget × 3 reads (`exec-git.ts:36`) plus the 4-slot gate queue (`exec-git.ts:39`) and worktree-resolution reads for worktree roots (`git-rpc.handlers.ts:324-348`).
- Options: (a) raise `RPC_TIMEOUT_MS` in `session-git-stats.store.ts` to sit above `GIT_STATUS_TIMEOUT_MS`, or (b) bound the `git:info` handler's total work to the caller's budget and return a structured degraded state. Needs an in-app measurement first (see Open questions); not implemented here because choosing between them needs the log data and the running app was off-limits for this task.

**Proposed, NOT implemented — cold detection:**

- `agent.list()`'s cold `detectAll()` (7 sequential adapters, `cli-detection.service.ts:114`) is still outside any deadline. Warming `CliDetectionService` at host startup (off the RPC path), or bounding it the same way, is the remaining cold-start risk for the plan-limits read.

## Decisions

- **Bound the backend inside the caller's budget (partial 'timeout' rows) instead of raising the renderer deadline again.** Evidence: the other branch's 15 s raise (6e28fe6a2) did not fix the symptom, and the backend worst case is unbounded above it (cold detection + 12 s). Reversible: one constant and one optional parameter.
- **8_000 ms deadline**: 10 s caller budget minus ~2 s margin for `agent.list()` and response formatting. Tunable constant; spec asserts only "≤ renderer budget".
- **Widen the optional `limits` signature** rather than adding a parallel method: every existing caller (MCP `ptah_agent_list`, the handler, spec stubs) keeps compiling, and a narrower function stays assignable.
- **Left `git:info` as a proposal.** The fix choice needs app-log evidence; launching Electron was out of scope for this task. Reported as an open question instead of guessing.

## Open questions

- How long does a cold `detectAll()` actually take on the user's machine (7 sequential version-check spawns)? Smallest experiment: read the backend log's slow-handler warnings (`DEFAULT_RPC_SLOW_WARN_MS = 2 s`, `rpc-handler.ts:105`) for `agent:getLanePlanLimits` total time across a cold start — it distinguishes "detection ate the budget" from "the lookup did".
- Is `git:info`'s 15 s timeout caused by a 30 s-budget read stalling (index.lock / large repo) or by gate-queue wait behind the 4 slots? The same log (the exec-git saturation warning, `exec-git.ts:62`) answers it; until then, do not raise the renderer deadline blindly.
- Whether the Electron host warms `CliDetectionService` anywhere before the first `$limits` read — if it does, the implemented fix alone covers cold starts; if not, cold detection remains the residual risk (proposed follow-up above).
- TASK_2026_415's five boot-blocking RPCs included `git:info`; its startup-contention work may already cover part of the `git:info` story — worth re-reading its section 5 ("Confirmed synchronous main-thread work remaining on the boot path") before choosing the git fix.