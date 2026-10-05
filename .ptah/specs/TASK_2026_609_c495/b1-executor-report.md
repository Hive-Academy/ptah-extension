# Batch B-1 executor report — TASK_2026_609_c495

Executor: backend-developer (sub-agent). Worktree `W = D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`. No git operations.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\harness-sync.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\health\harness-health.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\harness-target.port.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\workspace-target.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.local-edit-report.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\transformers\agent-rel-path.guard.spec.ts`

`git status --short` also shows three `libs/backend/agent-generation/.../user-layer/*` files (Batch B-2a, not mine), plus `test-results/` and the task folder (B-0 visual-reviewer artefacts). I did not touch any of them.

## Task B-1.1 — shared contract: COMPLETE

- `HarnessTargetHealth.localEdit?: string[]`: owned paths of any facet whose on-disk copy differs from what Ptah wrote. On verify, these are what a repair would overwrite. On reconcile, they are what the pass found edited.
- `HarnessTargetHealth.agentsInSync?: string[]`: agent copy paths that are on disk exactly as Ptah would write them, either unchanged or written this pass. A disabled agent is never listed.
- Both fields are optional. This follows the `adopted?` precedent (R12), so no fixture needed editing.
- `harnessAgentRelPath(target, slug)` returns:
  - codex: `.codex/agents/<slug>.toml`
  - copilot: `.github/agents/<slug>.agent.md`
  - cursor: `.cursor/agents/<slug>.md`
  - opencode: `.opencode/agent/<slug>.md`
  - claude, antigravity, vscode: `null`
  - The `switch` is exhaustive over `HarnessTargetId`.
- `HARNESS_AGENT_CHIP_TARGETS = ['claude','codex','copilot','cursor','opencode','antigravity']`, typed `satisfies readonly HarnessTargetId[]`. Choice recorded in the doc comment:
  - Claude is included so it can show the `source` chip.
  - Antigravity is included so it can show the `unsupported` chip.
  - `vscode` is excluded because it has no agent concept at all.
  - Change this list if B-3a wants fewer chips.
- Exported through the existing `export * from './lib/types/harness-sync.types'` (`libs/shared/src/index.ts:47`).

## Task B-1.2 — fill `localEdit` / `agentsInSync`: COMPLETE

- `HarnessPlan.unchangedAgents?: string[]` added to `harness-target.port.ts`.
- `WorkspaceHarnessTarget.plan` adds `relPath` to `unchangedAgents` in the `unchanged` branch when `entry.kind === 'agent'`, and returns it on the plan.
- `harness-health.ts`:
  - New private `localEditPaths(plan)` = `plan.writes.filter(w => w.overwritesLocalEdit).map(relPath)`. It covers every facet, MCP writes included.
  - `plannedTargetHealth` emits `localEdit` and `agentsInSync = unchangedAgents`.
  - `appliedTargetHealth` emits `localEdit` and `agentsInSync = unchangedAgents + keys of result.written whose entry.kind === 'agent'`.
  - A write that failed (including a failed snapshot) is not in `written`, so it is not listed as in sync.
- `undetectedTargetHealth` omits both fields, as it already does for `adopted` and `removedLocalEdit`. Every planned or applied row always emits arrays (R12: one choice per producer).
- The frozen plan (`freezeToMcp`, policy-unknown) keeps `unchangedAgents` through its spread. Those agents really are unchanged on disk, so reporting them in sync is correct. Its `localEdit` only names the MCP writes the frozen pass would still make.

## Task B-1.3 — snapshot before overwrite: COMPLETE

`applyWrite` in `workspace-target.ts` now calls `snapshotBeforeOverwrite` before writing whenever `write.overwritesLocalEdit` is set. `snapshotBeforeOverwrite` is a new module-level helper of about 20 lines. It reuses the existing `lstatSyncOrNull`, `hashArtifact` and `snapshotLocalEdit`:

- Path absent at apply time: there is no edit left to save. It writes and does not report `overwrittenLocalEdit`.
- Path is a symlink, or cannot be hashed as the recorded kind: it throws, and `applyWrite` writes nothing.
- Otherwise it calls `snapshotLocalEdit` with the on-disk hash. That step re-hashes the snapshot and throws on a mismatch.
- Any throw becomes `writeFailed`, reason `could not save local edit before overwrite: …`, and `return` happens before any write.
- `overwrittenLocalEdit` is pushed only when a verified snapshot exists and the write succeeded.

The manifest entry of a failed write is not touched. The reconciler only merges `result.written`, so the entry keeps the old hash and the next pass retries; spec (c) checks this.

## Spec evidence

`harness-reconciler.local-edit-report.spec.ts` uses the real reconciler with real Codex and Copilot targets in a temp workspace, and no fs mocks. Case by case:

- **(a)** Verify over a hand-edited Codex agent:
  - `localEdit=[CODEX_ONE]`, and the path is still in `missing`.
  - `agentsInSync=[CODEX_TWO]`.
  - The file is byte-unchanged, the manifest hash is unchanged, and no `.history` is created.
- **(a2)** Hand-edited owned skill directory `.agents/skills/tuned` plus a hand-edited agent: both are in `localEdit` (exactly 2), and the unchanged agent is not listed.
- **(b)** Reconcile over the edited agent and the edited skill directory:
  - Both are snapshotted under `.ptah/harness/.history/<slug>/<ts>/<relPath>` with the edited bytes, then overwritten with Ptah output.
  - `overwrittenLocalEdit` = both paths, and `writeFailed=[]`.
  - The following verify shows `localEdit=[]` and both agents in sync.
- **(c)** `.ptah/harness/.history` exists as a regular file, so the snapshot fails:
  - The edit stays `HAND EDITED`, and `writeFailed` matches `/^could not save local edit before overwrite: /`.
  - `overwrittenLocalEdit=[]`, `localEdit=[CODEX_ONE]`, and the path stays in `missing`.
  - `agentsInSync` excludes it, and the manifest hash is unchanged.
  - Copilot in the same pass has no failure.
  - After the blocking file is removed, the retry snapshots and overwrites.
- **(d)** `agentsInSync`:
  - It lists written agents (first pass) and unchanged agents (second pass and verify).
  - With `agent-two` disabled, only `harnessAgentRelPath(id,'agent-one')` is listed, for both codex and copilot, on reconcile and on verify.

`agent-rel-path.guard.spec.ts` covers **(e)**:

- `harnessAgentRelPath === transformer.relPathFor` for codex, copilot, cursor and opencode, over 4 slugs.
- `null` exactly for the targets with no transformer.
- The rival targets whose `facets.agents === 'supported'` are exactly those four, and each target's agent dir is in its `managedDirs()`.
- Chip targets are distinct, exclude vscode, and include all four.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/harness-sync`: all 4 tasks succeeded.
  - The first attempt failed on the Nx project graph with `ProjectsWithNoNameError` for `.ptah/specs/TASK_2026_609_c495/b0-capture`. That is B-0's capture harness `package.json`; I messaged visual-reviewer, who renamed it to `package.json.disabled`.
  - Before the rename, I ran the same checks directly: `tsc --noEmit` on both `tsconfig.lib.json` and the harness-sync `tsconfig.spec.json` came back clean; `eslint` on the six files gave 0 errors.
- Lint: one warning, `workspace-target.ts` max-lines (848 > 700, counted from line 1030 on). This warning already existed (batches.md:128). It is not an error, so PR1's fallback of moving the helper did not apply.
- `npx nx run-many -t test -p @ptah-extension/shared,@ptah-extension/harness-sync --maxWorkers=2`:
  - shared: 83/83 suites, 2277/2277 tests passed.
  - harness-sync: 5 suites / 17 tests failed, 452 passed, 469 total.
  - The 17 failing names are exactly the baseline set in batches.md "Batch 1a result": agent-consent (2), skill-consent (7), gitignore E23 (5), cancellation B8 (2), write-failure E21 (1).
  - **No new failures.** The flaky `capability-policy [C3]` passed on this run.
- Targeted jest run of local-edit-report + agent-rel-path.guard + retire-local-edit: 21/21 passed. The 1a spec is unchanged and still green.

## Risks and edge cases

- **PR1 (`workspace-target.ts` size):** the additions are minimal — about 40 lines: the `unchangedAgents` push, the guard in `applyWrite`, and the helper that reuses `snapshotLocalEdit`. Max-lines stays a warning, so the helper was not moved.
- **PR2 (overwrite without a usable snapshot):**
  - The snapshot runs before the write and must verify.
  - If it fails, nothing is written and the path goes to `writeFailed` with the original byte-unchanged, pinned by spec (c).
  - A symlink or an unreadable copy is refused rather than followed or overwritten.
- **Edge case "non-agent owned file in `localEdit`":** spec (a2), with a skill directory. MCP writes flow through the same `plan.writes` filter, but MCP fragments are snapshotted by neither 1a nor this batch (see out-of-scope).
- **Edge case "disabled agent excluded from `agentsInSync`":** spec (d).
- **R12:** the fields are optional, planned and applied rows always emit arrays, and the undetected row omits them.

## Plan deviations

None. One judgement call: when a hand-edited path disappears between plan and apply, the write proceeds with no snapshot and is not reported in `overwrittenLocalEdit`, because nothing was overwritten. It is still listed in `localEdit` from the plan.

## Out-of-scope observations (not touched)

- `claude-target.ts:381` also overwrites hand-edited owned Claude copies (`overwritesLocalEdit`) with no snapshot. C1 covers only `WorkspaceHarnessTarget`. B-3a's guard text says "a copy is saved to `.ptah/harness/.history/` first", which is not true for the Claude target's skill and command copies, or for MCP fragments (`mcp-facet-planner.ts:184`). The architect or team-leader should either extend the snapshot or narrow the guard wording.
- `test-results/` at the worktree root and `b0-capture/` in the task folder are B-0 artefacts and should not be committed.
