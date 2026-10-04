# Batch 32 report: lane resume gate (S4, component 14)

Executor: backend-developer. Worktree `task-597-s4` (branch `fix/task-597-s4-lane-guards`). No git commands were run.

## Tasks completed

32.1, 32.2, 32.3, 32.4. All are done and verified (see Verification).

## Files

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/`.

- MODIFIED `libs/shared/src/lib/types/agent-process.types.ts`: adds `AgentProcessInfo.lastRequestContext?: LaneRequestContext` and the exported `LaneRequestContext { tokens; source }` and `LaneRequestContextSource = 'rollout' | 'stream' | 'estimate'` (Task 32.1).
- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-rollout-usage.reader.ts`: `readCodexRolloutUsage(threadId)` (Task 32.2).
- CREATED `.../codex/codex-rollout-usage.reader.spec.ts` and the fixture `.../codex/__fixtures__/rollout-tail.jsonl`.
- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`: `LaneResumeGate`, `RESUME_GATE_MAX_CONTEXT_TOKENS = 60_000`, `RESUME_GATE_MAX_IDLE_MS = 600_000`, plus `collectHandoffCarryOver` / `buildLaneHandoffTask` (Task 32.3).
- CREATED `.../cli-agents/lane-resume-gate.spec.ts`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`: adds `LANE_RESUME_GATE: Symbol.for('LaneResumeGate')`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.ts`: registers the gate with an `instanceCachingFactory` that is given `PLATFORM_TOKENS.OUTPUT_CHANNEL`. This is the same pattern as the capability store in the same file.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (Task 32.4):
  - injects the gate;
  - adds `gateResume` and `laneRecordsForSession`;
  - adds `recordRequestContext` on every segment;
  - removes the stale warning.
- MODIFIED `.../cli-agents/agent-process-manager.service.spec.ts`: adds a gate stub to the harness and a new `resume gate (TASK_2026_597, R9.1)` describe with 5 tests.
- MODIFIED, constructor arity only (a stub gate as the 9th argument): `.../agent-process-manager.restore.spec.ts`, `.../agent-process-manager.workspace-scope.spec.ts`, `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`: registers a stub `PLATFORM_TOKENS.OUTPUT_CHANNEL`. All three hosts already register it (`platform-vscode`, `platform-electron` and `platform-cli` `registration.ts`). The smoke container did not, and the manager's gate now needs it.

## What each task does

- **32.1**: the record carries the last known per-request input figure and says where it came from.
- **32.2**:
  - The reader searches `<codexHomeDir()>/sessions/YYYY/MM/DD/` for `rollout-*-<threadId>.jsonl`. It walks the date directories newest first, numerically, and stops at the first match. `codexHomeDir` comes from `@ptah-extension/harness-sync`, which this lib already depends on.
  - It reads the file from its tail, using windows of 64 KiB, then 1 MiB, then 16 MiB. It returns `info.last_token_usage.input_tokens` from the last `event_msg`/`token_count` that has one. A rate-limit-only `token_count` (`info: null`) is skipped, and so is a torn last line. It never reads the `turn.completed` sum. The field names match `scripts/agent-usage/codex-rollout.reader.ts`.
  - It returns `null` when there is no rollout or no figure. It throws on an I/O failure, and the gate turns that into an estimate.
  - A thread id that does not match `^[A-Za-z0-9-]+$` returns `null`. The id is only ever compared against file names, never joined into a path.
- **32.3**: `LaneResumeGate.evaluate({cli, cliSessionId, lastActivityAt?, lastRequestContext?})` returns `{decision, reason, contextTokens, source, idleMs}`.
  - **Codex** reads the rollout. Its source is `rollout`, and the idle time falls back to the rollout's modification time. A missing or unreadable rollout falls back to the recorded figure, labelled `estimate`, and the log line names the reason.
  - **Every other CLI, OpenCode included**, uses the recorded figure with its own label.
  - **No figure at all** gives `contextTokens: null` and the label `estimate`, and the decision then rests on idle time only.
  - The lane goes `fresh` when tokens > 60,000 or idle > 600,000 ms. Exactly 60k and exactly 10 minutes both resume.
  - Every decision is logged as one `IOutputChannel.appendLine` line that includes the source.
- **32.4**: on a `resumeSessionId` spawn, `doSpawn` calls `gateResume` once the CLI is resolved.
  - **Inputs to the gate.** The manager collects every record it holds with that `cliSessionId`, live or restored, oldest first. The last activity is the latest record's `completedAt ?? startedAt`. The `lastRequestContext` passed is the most recent one recorded in that chain.
  - **On `resume`** the request is unchanged.
  - **On `fresh`** the resume id is dropped and `runSdk` receives a handoff task. The task contains the gate reason, the original task (the first record's task), the files changed (deduplicated `file-change` segment paths across the chain), and the previous lane's final text (the last 2,000 characters of its text segments, or of stdout when there are none). The new message comes last.
  - **Record and process.** The new record keeps the caller's message as its `task`, and does not take over the old session. No git process is started.
  - **Wording.** The handoff reuses the Batch 41 cold-agent guidance: do not resume; start fresh with "a short brief of the work that remains".
  - **Recording the figure.** `recordRequestContext` stores the latest positive `segment.usage.inputTokens` as `{tokens, source: 'estimate'}`.
  - **Stale warning.** The "does not support session resume" warning (it was at `:342`) is removed. Every adapter `doSpawn` can reach (antigravity, codex, copilot, cursor, opencode, pi) accepts `resumeSessionId`. The gate's `Resume gate` log line replaces the warning.

## Stack observed

- **Wiring:** tsyringe, through `register.ts` and `di/tokens.ts`. The factory registration follows `registerCapabilityServices` in the same file.
- **Logging:** the manager uses the `Logger` from `TOKENS.LOGGER`. The gate uses `IOutputChannel`, as the batch requires and as `capability-toggle-store.ts` does.
- **Tests:** Jest. The manager spec harness is in `agent-process-manager.service.spec.ts:346-395`.

## Verification

All commands were run from the worktree root.

| Check | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/shared` | PASS: 4/4 tasks, 0 errors. The warnings are existing ones; my new files lint clean with `npx eslint` run on them directly. |
| `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared --maxWorkers=2` | PASS. shared: 86 suites, 2503 tests passed. cli-agent-runtime: 86 suites, 1742 passed, 1 skipped (already skipped before this batch). |
| New tests on their own (`npx jest -c libs/backend/cli-agent-runtime/jest.config.ts lane-resume-gate codex-rollout-usage agent-process-manager.service.spec -t ...`) | PASS: 3 suites, 28 tests. |
| `npx nx run-many -t typecheck -p $(npx nx show projects --affected --files=libs/shared/src/lib/types/agent-process.types.ts --sep=,)` | 62 of 75 PASS, including every project the batch names: ptah-extension-vscode, ptah-electron, ptah-cli, vscode-lm-tools, platform-electron, rpc-handlers, cli-engine. 13 FAIL, and the cause is not this batch (see below). |
| `npx nx run di-lint:lint --skip-nx-cache` | PASS: "1719 @inject sites all resolve to a registered token". |
| `npx nx run degradation-audit:lint` (run directly, as `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`) | PASS (exit 0). The first run failed: `cli-agent-runtime: 1 FAIL (baseline 0)` on the torn-line `JSON.parse` catch in the reader. I fixed it with a `degradation-audit: optional-capability` justification. |

**The 13 affected-typecheck failures:**

- **Projects:** the `api-*` libs, `ptah-license-server` and `ptah-landing-page-e2e`.
- **Errors:** every error is `Cannot find module '../generated-prisma-client/client'` or a `PrismaService` property that follows from it, in `libs/api/**`. The Prisma client has not been generated in this new worktree.
- **Cause:** environment only. None of these projects reaches the changed code, and none of the errors is in a file this batch touched.
- **Not regenerated:** I did not run `prisma generate`, because it writes files outside this batch.

## Plan deviations

1. **OpenCode is labelled `estimate`, as the S4 stage-start note says.** Batch 13 is deferred, so no adapter reports a per-request figure. The manager labels every streamed figure `estimate`. The gate already passes a `stream` label through unchanged when one is recorded, and a test covers that. When Batch 13 lands, the only change needed is in `recordRequestContext`.
2. **A continuation of an idle lane is not gated.**
   - The plan (implementation-plan.md:1060) says the manager consults the gate "on a `resumeSessionId` spawn or a continuation of an idle lane". The batch task names only the "resume entry", and that is what I gated.
   - Gating `continueConversation` / `sendToAgent` would make a message to agent X start agent Y. `AgentMessageOutcome` (shared) has no mode that can report that, so it is a contract change outside this batch.
   - In practice an idle lane's subprocess is released after `SDK_IDLE_RELEASE_MS` (5 minutes by default). A continuation then gets `released`, and the caller falls back to `resume_session_id`, which is gated. Two cases stay ungated: a lane over 60k that is continued within 5 minutes, and a host that configures the idle release above 10 minutes.
3. **The Ptah CLI resume path (`spawnFromSdkHandle`) is not gated.** Its handle, with the resume already built in, is created by the caller before the manager sees it, so the manager cannot replace the task.
4. **`contextTokens` is `number | null`, not `number`.** `null` means no figure was known. That is more accurate than reporting 0 under the `estimate` label.
5. **The stale warning is removed, not reworded.** The claim it made is false for every adapter `doSpawn` reaches, and the gate's decision log replaces it.
6. **Four existing spec files outside the task file list were edited** for the new constructor argument or DI token. Each edit is a stub or a registration only (listed under Files).

## Out-of-scope observations

- The worktree has no generated Prisma client, so the affected typecheck fails on 13 `libs/api/**` projects (see Verification).
- The rollout reader is only used inside this lib, so it is not exported from `libs/backend/cli-agent-runtime/src/index.ts`. Export it if a later batch (for example 35) needs it.
