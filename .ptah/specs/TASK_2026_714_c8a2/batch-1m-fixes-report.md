# Batch 1m fixes, round 1 ? TASK_2026_714_c8a2

226 scoped tests pass; typecheck and lint pass (8 warnings). No paid turns were used; no real binary was executed. The 30000 per-turn and 100000 cumulative bounds remain unchanged.

**One plan decision remains pending:** the four cases explicitly requested for 7a estimate 95?96k tokens, above the requested 85k ceiling. The prepared, dry-run-verified proposal moves resume-history to the beginning of 7b, preserving the overall priority order. This is a reviewable proposal, not approval to spend. An asynchronous clarification was requested; no response was received at report time. The exact requested four-case grouping cannot honestly meet the estimate ceiling without changing case scope or estimates.

## Findings and changes

Paths below are relative to the workspace. H = libs/backend/codex-runtime/tools/evidence-harness.ts; R = libs/backend/codex-runtime/tools/evidence-cases-round.ts; P = libs/backend/codex-runtime/tools/evidence-round-plan.ts.

| Finding                              | Change and location                                                                                                                                                                                                                                                                                                                                   | Spec                                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Cumulative planning bound         | P:5 records per-case estimates; P:17 rejects estimates over 85000 or caps beyond remaining approval; P:42 defines the proposed two-run order. spike-runner.ts:23 selects a run, computes its own cap, and prints estimates and prior usage. Exact requested grouping rejected at 96000.                                                               | evidence-round-plan.spec.ts:10 and :50 cover over-budget grouping, both plans, reserve slots, missing/invalid recorded usage, cap overrides and shared budget exhaustion.                 |
| 2. Unverified stops later cases      | H:49 / :2413 continue on unverified observations. Failed status still stops, and thrown protocol/approval/isolation gates still enter the existing stopping catch. Usage-exceeded check remains before every paid case.                                                                                                                               | evidence-harness.spec.ts:2867 tests observed/unverified continuation and failed/cap stopping. Existing fake-child gate-failure specs remain passing.                                      |
| 3. Deadline too short                | H:46 computes max(60000, turnCost ? 75000), capped at 225000; H:1566 and R:125 apply it. H:2271 and :2453 expose each case deadline in dry-run and real artifacts. Two-turn cases get 150 seconds.                                                                                                                                                    | evidence-harness.spec.ts:2867 covers 0, 1, 2 and excessive turnCost values.                                                                                                               |
| 4. Same-home grant isolation         | R:143 uses the identical script and marker command in both children. R:250 grants acceptForSession only to child 1; R:458 removes its marker before child 2 executes, and R:461 records the required new prompt. R:119 records config presence explicitly; R:524 compares original and final bytes when present, or checks absence remains unchanged. | evidence-cases-round.spec.ts happy path checks both decisions; :376 simulates leaked grant/no second prompt; :373 tests mutation of existing config; :393 tests preserved existing bytes. |
| 5. Profile effort discriminator      | R:382 requests medium at thread/start while global OUTPUT_BOUNDS stays low. R:405 requires medium in the response.                                                                                                                                                                                                                                    | evidence-cases-round.spec.ts:354 checks request and echo; profile-effort fault now echoes low and must fail.                                                                              |
| 6. Honest partial-evidence claims    | Case table below explicitly limits each observation; no parity-gate source or ledger changed.                                                                                                                                                                                                                                                         | Documentation limits, not behavioral assertions.                                                                                                                                          |
| Reviewer 8. Resumed usage undercount | R:286 keys usage by case + child label + thread, preventing restarted totals from disappearing beneath the previous child's maximum. Continuing totals may conservatively overcount.                                                                                                                                                                  | evidence-cases-round.spec.ts:353 asserts 200 cumulative tokens from two children each reporting total=100 for the same resumed thread.                                                    |

Reviewer 7's extra home-B hashes were not added: the account and home-B file-integrity limitations are explicitly retained below. Reviewer 11's existing Windows cleanup fallback remains unchanged; the outer fatal cleanup still owns extra homes if local removal fails.

## Proposed run plans

Both runs begin with schema-handshake, modified-input-schema, subagent-and-rewind (each costs zero turns and zero estimated model tokens). Schema presence is not behavioral proof.

| Run / order after schema probes | Case                     | turnCost | Estimated tokens | Run cap |
| ------------------------------- | ------------------------ | -------: | ---------------: | ------: |
| 7a / 1                          | different-home-isolation |        1 |            12000 |       6 |
| 7a / 2                          | always-allow-scope       |        2 |            36000 |       6 |
| 7a / 3                          | same-home-isolation      |        2 |            24000 |       6 |
| **7a total**                    |                          |    **5** |        **72000** |   **6** |
| 7b / 1                          | resume-history           |        2 |            24000 |       5 |
| 7b / 2                          | profile-inputs           |        1 |            15000 |       5 |
| 7b / 3 (last)                   | usage-semantics          |        1 |            25000 |       5 |
| **7b total**                    |                          |    **4** |        **64000** |   **5** |

Nine planned turns, eleven total cap slots including one reserve per run, within the shared seventeen approved turns. Adding a nominal 12000-token reserve gives 84000/76000 estimated tokens. These are planning estimates, not guarantees. Resumed totals that continue across children can conservatively inflate the observed usage counter by approximately one prior turn. Existing live guards still stop on bound breaches.

Run 7b requires --7a-turns-used N; N must be the actual turnsConsumed from the completed 7a JSON artifact, including failures or steers. The runner prints N and computes remaining=17?N. The dry-run example uses N=6 to model the full 7a cap; it is **not** a record of six turns spent. Actual turns spent in this fix round: zero. If 7a has no trustworthy artifact after a fatal failure, reconcile usage before selecting N. No automatic retry is authorized by this runner; repeated attempts must also be reconciled against the shared allowance.

## Case evidence limits

| Case                     | Parity item / observed criteria                                                                                                                                               | Limits to retain in the ledger                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| different-home-isolation | configuration-auth-usage-isolation: separate children echo their own codexHome, first child completes its gated command; second remains schema-only                           | Same copied account in both homes. No home-B config/auth hashes or unchanged checks. No paid second-child usage observation or different-account billing isolation proof.                                                                                 |
| always-allow-scope       | always-allow-scope: exact command prompts once, repeat does not, different command prompts                                                                                    | Codex native session grant only; does not prove Ptah remembered-rule thread/home/workspace scoping.                                                                                                                                                       |
| same-home-isolation      | configuration-auth-usage-isolation: identical command prompts in child 2 despite child 1 session grant; separate threads, correctly attributed events/usage; config preserved | Separate-process streams alone are weak evidence. Config presence is recorded as absent or present; absent-to-absent is not byte-content evidence. This proves only this exact command/thread discriminator.                                              |
| resume-history           | history-rewind: history items return after restart, another turn completes, schema-supported rollback returns one turn                                                        | Rollback changes conversation history, not files. Usage keys are now per child; continued totals may overcount conservatively. No file rewind proof.                                                                                                      |
| profile-inputs           | profile-inputs: deterministic developer marker, medium effort echoed over global low, local stdio MCP startup ready                                                           | Instructions + effort echo + local stdio MCP only. Does not prove actual reasoning quality, Ptah skills/output style/attachments/model/max/resume roles or remote MCP. Keep profile-inputs and remote-mcp unproved.                                       |
| usage-semantics          | usage-semantics: natural completion, two increasing usage totals with last/total samples                                                                                      | Missing samples produce unverified and do not stop unrelated later cases. Still last in 7b. No billing guarantee.                                                                                                                                         |
| subagent-and-rewind      | Schema-only presence/absence                                                                                                                                                  | Existing pinned manifest probe remains unchanged. No binary/schema regeneration was run in this fix round. Previously reported thread/read, items/list, turns/list, resume, rollback and revert are schema-only; thread/rewind and subagent/start absent. |

## Verification

Commands used PowerShell output capture followed by the requested tail/filter, keeping complete logs outside the repository. Only the named project and tools specs were checked. No git, install, build, serve, workspace-wide tests or e2e.

Final scoped Jest command:

```powershell
npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts libs/backend/codex-runtime/tools/evidence-round-plan.spec.ts --coverage=false --maxWorkers=2 *> $env:TEMP/ptah-1m-fixes-jest-final.txt
Get-Content $env:TEMP/ptah-1m-fixes-jest-final.txt -Tail 20
```

```text
D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat\libs\backend\codex-runtime\jest.config.ts. Make sure
to set "type": "module" in the nearest package.json file or use the .mjs extension.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:13220) Wa....mjs extension.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

(Use `node --trace-warnings ...` to show where the warning was created)
SKIP symlink file: OS forbids symlink creation.
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due
to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure
that .unref() was called on them.

Test Suites: 3 passed, 3 total
Tests:       226 passed, 226 total
Snapshots:   0 total
Time:        23.048 s, estimated 31 s
Ran all test suites matching libs/backend/codex-runtime/tools/evidence-harness.spec.ts|libs/backend/codex-runtime/tools
/evidence-cases-round.spec.ts|libs/backend/codex-runtime/tools/evidence-round-plan.spec.ts.
```

The worker-shutdown warning and OS-forbidden symlink check remain. The first two-spec pass had 206 passing tests; the final three-spec pass above has 226. A dry-run compilation initially exposed widened string inference for the selected round (TS7053/TS7006); an explicit strict union return type fixed it. Successful typecheck and dry runs below include that correction; no runtime logic changed after the final Jest pass.

```powershell
npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static *> $env:TEMP/ptah-1m-fixes-nx.txt
Get-Content $env:TEMP/ptah-1m-fixes-nx.txt | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10
```

```text
  120:7  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  561:7  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  589:9  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  694:9  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  1787:7  warning  There is no `cause` attached to the symptom error being thrown        preserve-caught-error
✖ 8 problems (0 errors, 8 warnings)
 NX   Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime
```

Dry run 7a (first 40 lines):

```powershell
npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --round 7a --dry-run *> $env:TEMP/ptah-1m-fixes-dry-7a.txt
Get-Content $env:TEMP/ptah-1m-fixes-dry-7a.txt -Head 40
```

```text
runner 7a: 6 cases, planned turns 5, cap 6, estimated tokens 72000, budget left 17, prior turns used 0
{
  "mode": "dry-run",
  "cap": 6,
  "worstCaseTurns": 5,
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
  "caseDeadlinesMs": {
    "schema-handshake": 60000,
    "modified-input-schema": 60000,
    "subagent-and-rewind": 60000,
    "different-home-isolation": 75000,
    "always-allow-scope": 150000,
    "same-home-isolation": 150000
  },
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
      "purpose": "Manifest methods, initialize, model/list, config/read; user-input, plan, subagent and history presence only",
      "deadlineMs": 60000
    },
    {
      "id": "modified-input-schema",
      "turnCost": 0,
      "observations": [
```

Dry run 7b (first 40 lines):

```powershell
npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --round 7b --7a-turns-used 6 --dry-run *> $env:TEMP/ptah-1m-fixes-dry-7b.txt
Get-Content $env:TEMP/ptah-1m-fixes-dry-7b.txt -Head 40
```

```text
runner 7b: 6 cases, planned turns 4, cap 5, estimated tokens 64000, budget left 11, prior turns used 6
{
  "mode": "dry-run",
  "cap": 5,
  "worstCaseTurns": 4,
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
  "caseDeadlinesMs": {
    "schema-handshake": 60000,
    "modified-input-schema": 60000,
    "subagent-and-rewind": 60000,
    "resume-history": 150000,
    "profile-inputs": 75000,
    "usage-semantics": 75000
  },
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
      "purpose": "Manifest methods, initialize, model/list, config/read; user-input, plan, subagent and history presence only",
      "deadlineMs": 60000
    },
    {
      "id": "modified-input-schema",
      "turnCost": 0,
      "observations": [
```

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts *> $env:TEMP/ptah-1m-fixes-audit.txt
Select-String -Path $env:TEMP/ptah-1m-fixes-audit.txt -Pattern 'FAIL|TOTAL'
```

Matching line contents (no FAIL matches):

```text
degradation-audit: per-directory totals
degradation-audit: TOTAL 276 unsuppressed site(s)
```

Prettier --write was applied to all seven changed TypeScript files and this report. This report is the explicitly requested deliverable exception to the task-folder code scope.

## Decisions

- Preserve the user's hard usage limits; do not inflate them to hide the planning conflict.
- Prepare the 72k/64k split as a proposal. Moving resume-history into 7b still needs the caller's grouping decision before paid execution, because it differs from the requested membership of 7a. The original 96k grouping is rejected by the planner spec.
- Use explicit CLI accounting instead of a mutable ledger file. The source of truth is the existing artifact's actual turnsConsumed; 7b cannot silently reset remaining approval to 17. This avoids writing budget state during dry runs and makes the carried count visible. Manual accuracy/reconciliation remains the operator's responsibility.
- Continue merely unverified observations; retain failed-gate and usage/cap stopping.
- Count resumed usage independently by child, favoring conservative overcount over undercount.
- Keep all partial-evidence limitations in the parity ledger. No production source or parity gate was edited.
- No paid turns, real app-server execution, or live schema probes were performed.
