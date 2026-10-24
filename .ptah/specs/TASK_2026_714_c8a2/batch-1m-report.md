# Batch 1m: evidence cases for run 7a

Implemented harness support and fake-child specs. No real binary, paid turn, git action or production source change. Fake tests do not prove runtime parity.

## Case table

| id                       | parity-gate item                      | turnCost | gates                                                                                                                                   | what counts as observed                                                                                                                               |
| ------------------------ | ------------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| subagent-and-rewind      | subagents; history-rewind             |        0 | Checked-in pinned manifest                                                                                                              | Method presence/absence only, never behavior                                                                                                          |
| different-home-isolation | configuration-auth-usage-isolation    |        1 | Separate copied auth; both initialize homes verified; distinct threads; incoming thread ownership; exact command approval; usage bounds | First child completes command with attributed usage; second only initializes/starts thread; both stop and extra home is deleted                       |
| profile-inputs           | profile-inputs                        |        1 | Bounded config; thread approval policy; reasoningEffort low; configured stdio MCP ready before paid turn                                | Exact developer marker PTAH_PROFILE_CONFIRMED; effort echoed; profile_probe ready event; completed turn and usage                                     |
| usage-semantics          | stream-usage-controls                 |        1 | Existing MCP approval/marker gates; natural completion; two increasing usage totals                                                     | All last/total counts retained, plus boolean comparing last against successive total increments; mismatch is evidence rather than silently normalized |
| same-home-isolation      | configuration-auth-usage-isolation    |        2 | Two live children, same home, different threads; exact independent command approvals; config.toml byte snapshots                        | Each child completes own command and reports own usage; no cross-thread events/approvals; config unchanged; both stop                                 |
| resume-history           | history-rewind; stream-usage-controls |        2 | Non-ephemeral first thread; first turn completes; first child closes; new child resumes same ID with excludeTurns false                 | Returned history contains items; second turn completes with usage; schema-supported rollback removes one conversation turn without another paid turn  |
| always-allow-scope       | always-allow-scope                    |        2 | Exact command accepted with acceptForSession; marker reset by harness; same command then different command                              | Three successful command executions, exactly two approvals; repeated command does not prompt and different command does                               |

Global guards remain 30000 observed tokens per turn, 100000 cumulative, and a 60-second case deadline. Existing RPC timeout, framing limits, redaction, allowed child environment and tracked shutdown are reused. Extra homes are registered for fatal/keep cleanup before auth copy, copied auth is chmod 0600, and teardown removes the home. Config snapshots remain in memory; artifacts store only equality booleans. New decisions use accept/acceptForSession or existing decline handling. No invented wire decision.

## Schema-probe results

Pinned 0.155.1 manifest contains thread/read, thread/items/list, thread/turns/list, thread/resume, thread/rollback and thread/revert. It contains no thread/rewind or subagent/start request. This does not prove model-driven subagent tools are absent; there is no standalone subagent request contract to probe here. No paid subagent case is scheduled.

The schema defines thread/rollback with threadId and numTurns; the harness passes numTurns=1 after two completed turns and checks one returned turn remains. Both rollback and revert explicitly change conversation history only, not local files. File restoration parity remains unproved. Rollback is a zero-additional-turn behavioral check attached to resume-history, not an observation made during this batch.

## Run 7a plan

Order: schema-handshake, modified-input-schema, subagent-and-rewind, different-home-isolation, profile-inputs, usage-semantics, same-home-isolation, resume-history, always-allow-scope.

REMAINING=17; planned=9; CAP=10 (planned plus one steer reserve). These cases do not themselves steer. Seven approved turns remain outside this cap. Default harness cap remains 8; explicit caps may now be up to 17. Runner checks cap against remaining approval. Failed gates stop later paid cases.

Planning estimate: roughly 60-100k observed tokens across nine short turns, with substantial model/context uncertainty. This is not a spending guarantee. The 100k cumulative guard may end the round before every case. Usage notifications can overshoot a threshold. MCP and the three-command scope case are the most expensive; cheaper probes precede multi-turn cases. No usage ceiling was raised.

## Spec list

- evidence-harness.spec.ts: retained existing coverage; new catalog/cap accounting, two-request MCP usage capture without early interrupt, single-notification non-proof, additional-home fatal/keep cleanup.
- evidence-cases-round.spec.ts: all five round case success paths with fake ChildProcess streams; scope response sequence; per-child usage; extra-home cleanup; manifest presence/absence; wrong home, cross-thread events, cross-thread approvals, config mutation, missing developer marker, wrong effort, empty history, wrong rollback count, repeated approval, wrong command, usage overflow.

## Verification

All 196 scoped tests pass. Nx typecheck/lint pass with 8 warnings and 0 errors. Scoped ptah_get_diagnostics after final source edits reports typescript-compiler clean coverage, 0 errors, 0 warnings. Degradation audit has no FAIL lines and TOTAL 276 unsuppressed sites. Prettier --write ran on all eight changed files (final source files unchanged).

PowerShell Select-Object/Select-String implement the requested tail/head/grep filters. Tee-Object retained logs in the OS temp directory. Exact commands and final filtered output follow.

```powershell
npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts --coverage=false --maxWorkers=2 2>&1 | Tee-Object -FilePath $env:TEMP/ptah-1m-jest.log | Select-Object -Last 20
```

```text
D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\jest.config.ts. Make sure
to set "type": "module" in the nearest package.json file or use the .mjs extension.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:26968) Wa....mjs extension.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

(Use `node --trace-warnings ...` to show where the warning was created)
SKIP symlink file: OS forbids symlink creation.
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due
to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure
that .unref() was called on them.

Test Suites: 2 passed, 2 total
Tests:       196 passed, 196 total
Snapshots:   0 total
Time:        24.407 s, estimated 25 s
Ran all test suites matching libs/backend/codex-runtime/tools/evidence-harness.spec.ts|libs/backend/codex-runtime/tools
/evidence-cases-round.spec.ts.
```

```powershell
npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Tee-Object -FilePath $env:TEMP/ptah-1m-nx.log | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10
```

```text
  120:7  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  561:7  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  589:9  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  694:9  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  1781:7  warning  There is no `cause` attached to the symptom error being thrown        preserve-caught-error
✖ 8 problems (0 errors, 8 warnings)
 NX   Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime
```

```powershell
npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run 2>&1 | Tee-Object -FilePath $env:TEMP/ptah-1m-dry.log | Select-Object -First 40
```

```text
runner: 9 cases, planned turns 9, cap 10, budget left 17
{
  "mode": "dry-run",
  "cap": 10,
  "worstCaseTurns": 9,
  "turnBudgetNote": "A steer-created turn can cause later cases to be skipped.",
  "outputBounds": {
    "model_reasoning_effort": "low",
    "model_verbosity": "low",
    "tool_output_token_limit": 2000
  },
  "usageBounds": {
    "perTurn": 30000,
    "cumulative": 100000
  },
  "caseDeadlineMs": 60000,
  "cases": [
    {
      "id": "schema-handshake",
      "turnCost": 0,
      "observations": [
        1,
        3,
        5
      ],
      "kind": "schema",
      "purpose": "Manifest methods, initialize, model/list, config/read; user-input, plan, subagent and history presence only"
    },
    {
      "id": "modified-input-schema",
      "turnCost": 0,
      "observations": [
        1,
        2
      ],
      "kind": "schema",
      "purpose": "Find modifiedInput in exported schemas; behavioral replacement remains blocked until exact response contract is reviewed"
    },
    {
      "id": "subagent-and-rewind",
```

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Tee-Object -FilePath $env:TEMP/ptah-1m-audit.log | Select-String 'FAIL|TOTAL'
```

```text
degradation-audit: TOTAL 276 unsuppressed site(s)
```

Initial checks caught a missing fake manifest version, obsolete cap assertion, RPC generic error expectation mismatches and no-unsafe-finally errors. Fixed before final results above. Jest still reports an ES-module config warning, an OS-disabled symlink test, and forced worker shutdown. Worker warning remains unresolved; passing tests do not prove leak-free test teardown. No build, e2e, workspace-wide tests, install, or paid execution occurred.

## Decisions

| Decision                                                                | Options                                                          | Evidence                                                                  | Reversible                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Reuse RpcChild and isolate new orchestration in evidence-cases-round.ts | Extend existing transport vs duplicate it                        | Existing framing, timeout, budgets, redaction and process cleanup         | Yes                                                    |
| Different-home second child is handshake/thread-only                    | One vs two paid turns                                            | User explicitly permits schema-only second child; both homes are verified | Yes; second paid usage remains unproved                |
| Keep same-home children alive together but run turns sequentially       | Simultaneous paid turns vs sequential with both observers active | Early stop minimizes wasted spend while both streams are checked          | Yes; simultaneous in-flight turns remain unproved      |
| Probe conversation rollback only                                        | Invent rewind vs supported history rollback                      | Pinned schema explicitly excludes file restoration                        | Yes                                                    |
| Let usage MCP turn finish naturally                                     | Marker interrupt vs final model response                         | Early interrupt can prevent the second model request                      | Yes; existing MCP approval interrupt behavior retained |
| Preserve default cap 8, permit explicit approved cap up to 17           | Raise default vs explicit override                               | User approved 17 remaining; runner requires cap 10                        | Yes                                                    |

## Clarifications Needed

None required to prepare the harness. Before paid execution, review the remaining proof limits: second different-home child has no paid usage; same-home turns are sequential; profile proof covers low effort/instructions/stdio only; no standalone subagent request exists in the manifest; rollback does not restore files. Existing 17-turn authorization is not expanded. This batch spent zero.

## Files written

- libs/backend/codex-runtime/tools/evidence-harness.ts
- libs/backend/codex-runtime/tools/evidence-harness.spec.ts
- libs/backend/codex-runtime/tools/evidence-cases.json
- libs/backend/codex-runtime/tools/evidence-failure-notes.ts
- libs/backend/codex-runtime/tools/evidence-cases-round.ts
- libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts
- .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts
- .ptah/specs/TASK_2026_714_c8a2/batch-1m-report.md
