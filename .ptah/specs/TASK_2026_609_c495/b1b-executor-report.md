# Backend implementation — TASK_2026_609_c495, Batch B-1b

Task B-1b.1 implemented: exported pure `isAgentSelectedForSync({ agentSyncEnabled, disabledAgentIds }, slug)` and reused it in `HarnessManifestBuilder.buildAgents`.

## Files written

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts — extracted selection predicate; builder calls it.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\index.ts — public function export.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\manifest\harness-manifest.agent-enablement.spec.ts — 13 pure-function cases and six real-filesystem builder cases.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b1b-executor-report.md — this report.

No existing builder/reconciler specs, agent-generation files, task states, or batches.md were edited. No git commands were run. Check logs were captured outside the repository in the process TEMP directory.

## Evidence of unchanged behaviour

The predicate returns false only for explicit `agentSyncEnabled === false` or exact raw membership of the slug in disabledAgentIds. Absent flags remain enabled and absent disabled lists remain empty. Array includes and the previous Set.has have identical membership semantics for the declared string IDs. Case, whitespace and filename extensions are not normalized.

The builder retains its existing workspace-gate early return before reading agent files, and still normalizes the optional flag with `!== false` at its existing call site. Its slug rejection, collision handling, hashing, cancellation and ordering are untouched. Six integration cases assert explicit expected manifest slugs for disabled/enabled/absent flags and exact/case-variant IDs. Pure cases also cover missing options, unrelated IDs, suffixes, whitespace and frozen inputs. The new spec has no failed tests in the full run; all six failing suites are existing reconciler specs.

## Stack and repository evidence

- package.json / package-lock.json: Node 24.x, TypeScript 6.0.3, Nx 23.2.1, Jest 30; tsyringe 4.10 dependency. This is the runtime-agnostic harness-sync library, not a Nest HTTP service.
- harness-sync/project.json: scope:extension/type:feature; tsc, ESLint and Jest targets. eslint.config.mjs enforces scope/type boundaries. No new cross-library dependency.
- lib/di/register.ts: constructs HarnessManifestBuilder directly in the existing tsyringe composition. No registration change is needed for a pure export.
- lib/sources/harness-source.port.ts and HarnessManifestBuildOptions supply typed internal inputs. No external input boundary was added.
- state/agent-sync-gate.ts owns consent migration; the extracted function preserves the builder's absent-flag semantics instead of implementing migration.
- CONTRIBUTING.md and existing manifest builder/slug-rules specs informed style and tests. No applicable AGENTS.md or CLAUDE.md was found by the file-search tool. No direct ptah_read_file tool is listed; native targeted reads were used.

## Verification

- PASS: `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync` (exit 0).
- PASS: scoped `ptah_get_diagnostics` on all three changed source/spec files: TypeScript compiler, zero errors and warnings, clean coverage.
- FAIL: `npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2` (exit 1): 48 suites passed / six failed; 470 tests passed / 18 failed / 488 total. The full suite is not green.
- Baseline comparison: batches.md “Batch 1a result” records 17 failures: agent-consent (2), skill-consent (7), gitignore E23 (5), cancellation B8 (2), write-failure E21 (1). This run has the same groups and counts. Its eighteenth failure is capability-policy `[C3] keeps only MCP writes and removals, and no migration or adoption`, the additional flaky test explicitly documented in that same baseline result (main failed 3/4 runs). No other failures observed. The baseline document records groups/counts and the flaky title, not the full seventeen titles; the observed exact titles follow below. No new main checkout run was made.
- Nx Cloud reports organization disabled / free-plan quota (401); local targets still ran. Typecheck/lint exit 0, tests exit 1 from the actual assertions. Jest executor deprecation warning is unrelated.

## Typecheck/lint tail

```text
 NX   Running targets typecheck, lint for project @ptah-extension/harness-sync:

- @ptah-extension/harness-sync


√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck



 NX   Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   Nx Cloud encountered some problems

This Nx Cloud organization has been disabled due to exceeding the FREE plan.
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at 
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)

  Run duration:      4.9s
  Cache:             0/2 hit (0%)
  Critical path:     4.8s (1 task)
  Recoverable time:  <1ms
```

## Test tail

```text
    +   "ok-entry": Object {
    +     "hash": "hash-ok",
    +     "kind": "skill",
    +     "source": "/src/ok",
    +   },
    + }

      456 |     expect(applied[0].migrations).toEqual([]);
      457 |     expect(applied[0].adopted).toEqual([]);
    > 458 |     expect(applied[0].baseEntries).toEqual({});
          |                                    ^
      459 |   });
      460 |
      461 |   it('[C3] a known policy hands the plan through untouched', async () => {

      at Object.<anonymous> (src/lib/reconciler/harness-reconciler.capability-policy.spec.ts:458:36)


Test Suites: 6 failed, 48 passed, 54 total
Tests:       18 failed, 470 passed, 488 total
Snapshots:   0 total
Time:        15.139 s
Ran all test suites.


node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   Running target test for project @ptah-extension/harness-sync failed

Failed tasks:

- @ptah-extension/harness-sync:test


 NX   Nx Cloud encountered some problems

This Nx Cloud organization has been disabled due to exceeding the FREE plan.
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at 
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)

  Run duration:      15.8s
  Critical path:     15.8s (1 task)
  Recoverable time:  <1ms
```

## Observed failing test names

- ● HarnessReconcilerService — the agents consent gate › a workspace that never propagated agents gets none, and the derived decision is recorded so the evidence walk runs once
- ● HarnessReconcilerService — the agents consent gate › the wizard grant is what opens the gate, and the next pass fans the agents out
- ● HarnessReconcilerService — the skills selection gate › the migration › U2: a fresh workspace with no manifests at all resolves `selected` with `[]` and propagates nothing
- ● HarnessReconcilerService — the skills selection gate › the filter is a conjunction, outermost first › a slug in the allowlist AND in disabledSkillIds is NOT propagated
- ● HarnessReconcilerService — the skills selection gate › the filter is a conjunction, outermost first › a slug in the allowlist whose plugin is disabled is NOT propagated
- ● HarnessReconcilerService — the skills selection gate › the filter is a conjunction, outermost first › under 'selected', an overlay opt-out (harness) plugin skill outside the allowlist is NOT propagated — the selection gates the overlay loop too
- ● HarnessReconcilerService — the skills selection gate › the filter is a conjunction, outermost first › under 'all', behaviour is exactly Batch 1's — the selection level is inert
- ● HarnessReconcilerService — the skills selection gate › the reap › a workspace at 'all' with propagated copies, switched to 'selected' with a subset, has the excluded copies removed from every target directory while survivors are untouched — and the user-layer clone survives
- ● HarnessReconcilerService — the skills selection gate › 'selected' with `[]` is a legitimate state, not an error: zero skills propagated, no throw
- ● HarnessReconcilerService × .gitignore (E23) › lists the directories of detected targets after a full pass
- ● HarnessReconcilerService × .gitignore (E23) › omits an undetected target — no rule about a directory that will not exist
- ● HarnessReconcilerService × .gitignore (E23) › never ignores an MCP config file — those are committed on purpose
- ● HarnessReconcilerService × .gitignore (E23) › a full pass over an already-reconciled workspace rewrites nothing
- ● HarnessReconcilerService × .gitignore (E23) › verify() reports the gap a full pass would close
- ● HarnessReconcilerService — write failure reporting and manifest consistency › [E21] a failed write is reported in writeFailed AND is never recorded in the persisted manifest, while the other entry writes normally
- ● HarnessReconcilerService — pass cancellation (B8) › THE COMMIT POINT: an abort arriving after planning never reaches apply
- ● HarnessReconcilerService — pass cancellation (B8) › a target that has already applied is not undone by a later target being cancelled
- ● HarnessReconcilerService — the frozen plan › [C3] keeps only MCP writes and removals, and no migration or adoption

## Deviations and unfinished work

No implementation deviation. All assigned source changes and the report are written. Full test validation remains failing due to the recorded 17 baseline cases and documented capability-policy flake; these out-of-scope tests were neither modified nor repaired. No unrelated edits were reverted.