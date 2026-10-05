# S4-a fix round: S1, S2, M1 (`TASK_2026_597_ab22`)

Scope: findings S1, S2 and M1 in `reviews/s4a-code-logic-review.md`. M2 (`libs/backend/memory-curator`) was left alone; the diff in that lib belongs to the other developer.

## S1: `ptah_run_check` runs in the caller's declared root, with no fallback

Changes:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
  - ~172: imports `isMcpRequestInFlight`.
  - ~1361-1376: the `RUN_CHECK_TOOL_NAME` case now calls the new `resolveRunCheckRoot`. If that returns an error, the tool returns an error result and runs nothing. Otherwise it runs, and `structuredContent` is attached to both the success and the error reply.
  - New `resolveRunCheckRoot`, `findDirectoryInsideKnownFolder` and `attachStructuredContent`, placed above `knownWorkspaceFolders`. The rules:
    1. If the declared root canonically equals an open folder, the host's record of that folder is used.
    2. If the declared root is an existing directory strictly inside an open folder (a worktree), its real path is used. A UNC path is never stat'd and only rule 1 can match it.
    3. If no root is declared, a folder is used only off the MCP request path (stdio or internal) and only when exactly one folder is open.
    4. Every other case is an error that names the declared root and the open folders. There is no `known[0]` fallback and no tmpdir fallback.
  - `resolveSpoolRoot` is unchanged. The spool-file policy still uses it.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts`
  - `RunCheckOutcome.structured` is new: `RunCheckStructuredResult { cwd, project, targets, verdict: passed|failed|timed_out|not_run, exitCode, logPath? }`. It is set on every return path.
  - The summary has a new line, `Ran in: <cwd>`. Both error texts ("Nx not found" and "could not start") also name the folder.
  - The tool description now says it runs in "your declared workspace (worktrees too)". It is 516 chars, under the 540-char per-tool budget.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` (`handleRunCheck`, ~794-803): on stdio, `structuredContent` is now `outcome.structured`, so it includes `cwd`, and the error data carries `cwd`. The stdio root is still the launching process's cwd. Nothing else declares a root on that surface.

Specs:

- `protocol-dispatcher.spec.ts`: new describe at the end of the file, `ptah_run_check workspace root (S4-a S1)`, 5 tests:
  - a worktree inside an open folder runs there, and text and `structuredContent.cwd` name it;
  - a declared open folder resolves to the host's record;
  - a declared root outside every open folder is refused, with no fallback;
  - a declared directory that does not exist is refused;
  - an MCP call with no declared root is refused, even with one folder open.
- `run-check.tool.spec.ts`: asserts `Ran in:`, the full `structured` payload on a pass, `not_run` when Nx is missing, and `cwd` in the summary inputs.
- `agent-spawn-surface-parity.spec.ts`: `callOverHttp` takes an optional `declaredRoot`. The run_check parity test now declares its root, as a real caller does. It previously relied on the first-folder fallback that this fix removes.

## S2: the resume decision is reported to the caller

Changes:

- `libs/shared/src/lib/types/agent-process.types.ts`
  - New `AgentResumeOutcome { decision: 'resumed' | 'fresh'; reason; sessionKnown }`.
  - New optional field `SpawnAgentResult.resumeDecision`.
  - Both changes are additive and optional.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - New internal `GatedSpawn` type (~130). `SdkSpawnOptions` gains `resumeDecision` and `originalTask` (~121).
  - `gateResume` (~362-430) returns `resumeDecision` on both branches. `sessionKnown` is `lane.length > 0`.
  - `doSpawnSdk` adds `resumeDecision` to its result (~565-571).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`
  - `LaneHandoffInput.sessionKnown` is new (~191).
  - When the session is unknown, the brief now says so directly: "This host holds no record of the previous lane (it ran in another window or before a restart), so its original task, the files it changed and its final text are unknown here…". The Original task line reads `(unknown: this host holds no record of the previous lane)`; the old text was "(not available…)".
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`: `formatAgentSpawn` adds a `**Resume:**` line through `formatResumeDecisionLine`:
  - resumed: `resumed (<reason>)`;
  - fresh: `NOT resumed — a fresh lane was started with a handoff brief (<reason>). It does not have the previous conversation; give it complete instructions.`;
  - fresh with an unknown session: the line also says `This host holds no record of that session, so the brief has no original task, changed files or final text.`

  The HTTP path (`protocol-dispatcher.ts:1166`) and the stdio path (`agent-tool.dispatcher.ts:385`) both use this formatter, so both replies show the line.

Specs:

- `agent-process-manager.service.spec.ts`:
  - new test: a `resumed` decision appears on the spawn result;
  - the existing fresh test now asserts `resumeDecision` with `sessionKnown: true`;
  - the existing unknown-session test now asserts the plain-language brief and `sessionKnown: false`.
- `lane-resume-gate.spec.ts`: existing calls pass `sessionKnown: true`; a new test covers the unknown-session wording.
- `mcp-response-formatter.spec.ts`: 3 new tests (fresh, fresh with an unknown session, resumed). The role-less test also asserts there is no `Resume:` line.

## M1: the original task survives successive fresh lanes

Changes:

- `libs/shared/src/lib/types/agent-process.types.ts`: new optional `AgentProcessInfo.originalTask`.
- `agent-process-manager.service.ts`:
  - `gateResume` takes the chain's first task from `lane[0].info.originalTask ?? lane[0].info.task` and returns it.
  - `doSpawnSdk` stores it on the new record as `originalTask` (~493).
  - `info.task` still holds the caller's message, so existing behaviour and the existing assertion are unchanged.

Specs (`agent-process-manager.service.spec.ts`):

- The fresh test asserts `info.originalTask === 'Implement the parser'`.
- New test `keeps the original task across two successive fresh lanes (M1)`: the first fresh lane reports session `thread-2`, and a second resume of `thread-2` (also fresh) produces a brief with `Original task:\nImplement the parser`. The second record keeps `originalTask` as well.

## Checks

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p cli-agent-runtime vscode-lm-tools shared` | Successfully ran typecheck and lint for 3 projects. Lint shows warnings only, 0 errors. |
| `npx nx run-many -t test -p cli-agent-runtime vscode-lm-tools --maxWorkers=2` | Passed. cli-agent-runtime: 87 suites, 1752 passed, 1 skipped. vscode-lm-tools: 84 suites, 2758 passed. |
| Shared-type importers: `npx nx run-many -t typecheck -p rpc-handlers vscode-core agent-sdk chat-streaming chat-state cli-engine ptah-cli ptah-electron ptah-extension-vscode ptah-extension-webview --parallel=2` | Successfully ran for 10 projects. The full affected list (about 80 projects) was not run; the type change is additive and optional. |
| `npx nx run di-lint:lint` | Success. |
| `npx nx run degradation-audit:lint` | Exit 0; `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`. The first run failed at 3 against a baseline of 2 because of the new catch in `findDirectoryInsideKnownFolder`. A `degradation-audit: reported` marker fixed it. |
| Re-run after the final comment-only and line-ending fixes | S1 describe: 5 passed. Touched cli-agent-runtime specs: 159 passed. run-check and formatter specs: 170 passed. |

## Deviations

1. On S1, the review suggested also accepting "the lane's `scopedWorkspaceRoot`". That value lives in `cli-agent-runtime`'s spawn environment, which `vscode-lm-tools` cannot reach. A spawned lane already declares its cwd in the MCP URL, and rule 2 accepts that cwd when it is a worktree inside an open folder, so the extra source was not needed.
2. On S1, an HTTP call that declares no root is refused even when only one folder is open, because a worktree lane in that folder would otherwise be checked against the main checkout. The only no-declaration path is stdio or internal with exactly one folder open.
3. On S2, a `fresh` decision for an unknown session is reported, not refused. The review's "consider refusing … unless forced" would need a new spawn flag that the brief did not ask for.
4. The shared type is named `AgentResumeOutcome`, not `LaneResumeDecision`. `lane-resume-gate.ts` already exports an internal `LaneResumeDecision` (`'resume' | 'fresh'` plus figures), and reusing the name would be confusing.
5. Housekeeping: three spec files had CRLF line endings in the working tree; they were LF at HEAD. I converted them back to LF. Content is unchanged.

## Out of scope / not touched

- M2, in `libs/backend/memory-curator`, belongs to the other developer.
- M3 to M6 and the minor findings are not part of this round.
