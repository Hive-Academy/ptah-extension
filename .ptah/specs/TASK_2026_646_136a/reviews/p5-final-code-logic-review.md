# Code Logic Review (final P5 re-review) - TASK_2026_646_136a, Batches 39a-39d

Verdict: **NEEDS_REVISION**, score **7/10**.
Review family: reviewer Anthropic (Sonnet 5.5); implementer codex (OpenAI) plus small orchestrator spec fixes.
Scope: commits b5e38c780 (39a), 40dcfb9ae (39b), 7f8f93adf (39c), 81c1f5af9 (39d), read in full at the worktree HEAD,
against `reviews/p5-code-logic-review.md` and `reports/batch-39a..39d-report.md`.
Checks executed by me: none (tests, typecheck, lint and host DI guards were verified earlier, as stated in the task).
One local `node` probe of the new auth regexes against sample lines (see defect 2).

| Metric | Value |
| --- | --- |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 0 |
| Minor | 4 |

## Item table

| Item | Status | Evidence |
| --- | --- | --- |
| S-1 raw reader error rethrown | CLOSED | `agent-outcome-rpc.handlers.ts:88-99`: the catch logs the `Error` (host log only) and throws `RpcUserError('Outcome signals are unavailable.', 'PERSISTENCE_UNAVAILABLE')`. The code is in the shared union (`rpc-error-codes.types.ts:13`). `rpc-handler.ts:224-236` returns only `error.message` for `RpcUserError` and logs it at warn, so the webview and Sentry no longer get the reader text. The `Pick<LaneOutcomeQueries, ...>` type (`:37-40`) closes style S3. |
| S-2 failure / non-durable shown as "no data yet" | CLOSED (Minor residue, defect 5) | `skill-clones-state.service.ts:119-130`: `loading` set before the call, `ready` / `not-persistent` from `persistent`, and the catch keeps `agentOutcomeSignals` and `outcomeWindowDays` and sets `unavailable`. `agent-outcome-signals.ts:41-58` renders loading and unavailable only when this slug has no figures; otherwise the figures stay. `clone-card.component.ts:192-206` and `clone-detail-drawer.component.ts:181-197` render the `unavailable` and `not-persistent` notes. The state is passed down in `skill-clones-view.component.ts` (`[outcomeStatus]` on card and drawer). |
| S-3 bare `401` / "unauthorized" gives `auth` | CLOSED for the reported inputs (Minor residue, defect 2) | `lane-auth-classifier.ts:2-5`: `file.ts:401:15`, `line 4012` and a bare "unauthorized" in prose no longer match. Moved into `cli-agents/limits/`; `index.ts` and both importers updated (`agent-process-manager.service.ts:91`, `lane-completion-outcome.ts:9`). |
| M-2 invalid `taskKind` / `routingSource` drops the row | CLOSED | `agent-namespace.builder.ts:199-211` and `:239-245` reject before any spawn, naming the field and the allowed values. The MCP and stdio dispatchers already parse through `agent-spawn-args.schema.ts:45,50`. |
| M-6 stat error stored as "missing" | PARTIAL | `outcome-report.tool.ts:139-154`: other errors now return `recorded: false` (EACCES is covered), but "not found" is recognised only by `code` `ENOENT` / `ENOTDIR` (`:68-71`). On the VS Code host a missing file does not carry that code (defect 1), so every genuine "missing" report is now rejected instead of stored. |
| M-8 drive-relative path passes the fence | CLOSED | `outcome-report.tool.ts:130-138`: `win32.isAbsolute`, `/^[A-Za-z]:/` and `isAbsolute(rel)` are checked before any stat. The rejection returns `recorded: false` with the entry named. No stat or write happens. |
| Style S1 tool schema from Zod | CLOSED | `outcome-report.tool.ts:42-66` merges the generated branch schemas. It throws at tool-build time if the shape changes, which fails loudly rather than publishing a wrong schema. |
| Style S2 hook log and unbounded Set | CLOSED (Minor residue, defect 3) | `post-tool-use-hook-handler.ts:26,158-163`: FIFO cap of 256, oldest evicted first; non-Agent tools return before any log (`:146-148`). |
| Style S5 raw SQL on foreign tables | CLOSED | `skill-telemetry-seam.adapter.ts` has no SQL. `skill-candidate.store.ts:1618-1685` (`findSubagentRuns`, `listSkillsForScopes`) and `session-verdict.store.ts:208-235` (`evidenceClassForSessions`) parse rows with Zod and skip bad rows with a warn. Both stores take the connection through the lazy `get db()`, so resolving them early cannot open the database early. `register.ts:72-76` registers the stores before the seam and the Electron and CLI smoke specs now register the new Logger and VecStatus tokens. |
| Style S4 one `limits/` directory | CLOSED | Files moved with 100% (failure class) and 72% (classifier) similarity; no `../limits/` import remains in the lib. |

## Numbered defects

### 1. Serious - missing deliverables are refused, not recorded, on the VS Code host

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:68-71` (`isNotFound`) and `:144-153`.
- Cause: 39a replaced `checkLaneDeliverable` (which used `fileSystem.exists()`, host independent) with a direct `fileSystem.stat()` and
  recognises "not found" only by `error.code === 'ENOENT' | 'ENOTDIR'`. The port contract promises nothing about error codes
  for `stat`; it only says "stat on missing path rejects" (`run-file-system-contract.ts:70-71`). The VS Code provider does
  `await vscode.workspace.fs.stat(...)` with no translation (`vscode-file-system-provider.ts:79-87`). That call rejects with a
  `vscode.FileSystemError` whose `code` is `'FileNotFound'`. The repository already knows this: `capability-matrix.store.ts:629` and
  `task-scanner.service.ts:80` both accept `'FileNotFound'`.
- Failure scenario: on VS Code the orchestrator calls `ptah_outcome_report { kind: 'deliverables', paths: ['plan.md'] }` for a lane that
  never wrote `plan.md`. `stat` rejects with `FileNotFound`; `isNotFound` is false; the tool logs `Deliverable stat failed`
  (code `FileNotFound`) and returns `{ recorded: false, reason: 'deliverable stat failed for plan.md' }`. The negative verdict
  (the main purpose of this report) is never stored; the orchestrator is told the stat failed, not that the file is missing. A
  multi-path report with one missing file is refused as a whole. Before 39a this case stored `exists: false` on every host. The new
  spec only exercises `code: 'ENOENT'` (`outcome-report.tool.spec.ts:37,128`), so it passes while the primary host regresses.
  Electron and CLI use Node `fs` and are fine.
- Fix: in the catch, treat the error as not found when `code` is `ENOENT`, `ENOTDIR` or `FileNotFound`, or (host independent) when
  `await fileSystem.exists(path)` is false after a stat failure. Add a spec with `{ code: 'FileNotFound' }`.

### 2. Minor - auth regex is still imprecise in both directions

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-auth-classifier.ts:3-5`.
- I ran the patterns on sample lines. Still `auth`: `return { status: 401, body }` (source printed by a lane that edits auth code) and
  `// error handling: unauthorized users get a 403` (the third pattern matches any "error", "status" or "http" followed by "unauthorized"
  within 80 characters). Now not `auth` although it is one: `Error: 401 {"type":"error",...authentication_error...}`,
  `{"statusCode":401}` (`status` does not match inside `statusCode`) and `401 UNAUTHENTICATED`. The first scenario of S-3 is closed; a failed
  lane working on auth code can still be labelled `auth`, and some real auth failures fall to `crash`. A misclassified label only, no
  data loss, so Minor. A later round can tighten it with anchored line patterns.

### 3. Minor - the hook warns "no reason" for an intentional nested skip and shares the dedup key

- File: `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:127-128,145-170`.
- `buildSubagentRunTag` returns `{ tag: null }` with no reason on purpose when `input.agent_id` is set (`subagent-run-tag.ts:21`). The new
  code warns for any null tag on an Agent or Task tool, logging `reason: 'no reason'`, and records the same `session:<id>` key that a
  real `missing-agent-id` warning uses. A nested Agent call that arrives first would warn spuriously and then suppress the real
  lost-join-key warning for that session. Reachable only if a subagent can call Agent or Task, which current Claude Code does not
  allow, so Minor. Fix: return early when `reason` is undefined (the original rule), or key the dedup by reason.

### 4. Minor - `ptah.agent.spawn` check is stricter in one place and looser in another than the sibling schema

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:199-211`.
- `routingSource` is checked against all of `OUTCOME_ROUTING_SOURCES`, which includes `'not-routed'`; the MCP and stdio spawn schema allows
  only `model | ranking | pin` (`agent-spawn-args.schema.ts:50`) and the manager types exclude `'not-routed'`
  (`agent-process-manager.service.ts:753`). An `execute_code` caller can therefore label a run `not-routed`. Also, an explicit
  `taskKind: null` (accepted by the row schema, `lane-outcome.schema.ts:46`) is now rejected. Neither loses data.

### 5. Minor - Agents tab: notice duplicated, failure counter unread

- Files: `clone-card.component.ts:192-198` with `agent-outcome-signals.ts:50-58`; `skill-clones-state.service.ts:57,128`.
- For an agent with no figures and a failed read, the card shows the metric "Outcome data unavailable" and the same sentence again in the
  warning paragraph. `outcomeReadFailures` is incremented but no component or service reads it; the audit comment says it
  "carries the failure" while only `outcomeStatus` reaches the user. Harmless; drop one of the two.

## Five logic questions, for the changed code

1. Silent failure: none new. Stat failures, reader failures and invalid spawn fields now surface as `recorded: false`, a coded RPC error or an
   explicit UI state. Invalid seam rows are skipped with a warn (they degrade a run to `unmatched`, which is visible in the join status).
2. Unexpected user action: reporting a missing file on VS Code (defect 1); refreshing the Agents tab while offline (handled, figures kept).
3. Wrong answer instead of error: a lane that prints `status: 401` in source is still labelled `auth` (defect 2).
4. Dependency failure: reader throws (coded error, closed); store resolution fails inside the seam factory is outside this round (the hosts
   register the same tokens that `SkillCandidateStore` already needed, and the three host smoke specs pass).
5. Missing and unmentioned: a test that runs the report tool against a provider whose error shape is not Node's (defect 1).

## Notes on what was verified

- Read the full changed source of all four commits and the unchanged context they depend on (`rpc-handler.ts` user-error branch,
  `subagent-run-tag.ts`, `lane-completion-notifier.service.ts` `checkLaneDeliverable`, the three file-system providers, the skill-synthesis
  `register.ts` and lane-outcomes reader factory, SQLite column types for `skill_invocation_events`).
- No Blocking issue found. The concurrency of overlapping `refreshClones` calls (an older failure can overwrite a newer success) is
  unchanged by this round and is not counted.
