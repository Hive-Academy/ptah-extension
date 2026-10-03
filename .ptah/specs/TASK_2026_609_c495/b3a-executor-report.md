# B-3a executor report (frontend-developer, 2026-10-03)

Verdict: B-3a.1-B-3a.3 are implemented. Scoped typecheck, lint and test all pass. Only the six batch files were touched. No git command was run.

## Files (absolute)

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-sync-chips.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-sync-chips.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\components\clones\reconcile-guard.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\components\clones\reconcile-guard.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`

`git status --short` also lists B-2c's in-flight files (`libs/shared/.../rpc.types.ts`, `rpc-setup.types.ts`, `libs/backend/rpc-handlers/.../wizard-generation-rpc.*`). I did not touch them.

## B-3a.1 `agent-sync-chips.ts`

- Pure functions, no Angular: `agentSyncChips(health, slug)` returns one chip per `HARNESS_AGENT_CHIP_TARGETS` entry, in that order. `agentSyncChip(health, target, slug)` returns a single chip. Each chip is `{ target, state, label, path, reason? }`, and `path` comes from `harnessAgentRelPath`. Both helpers are imported from `@ptah-extension/shared`.
- The first matching state wins, in this order:
  1. `unknown`: no report, or the target is not in the report.
  2. `not-detected`
  3. `source`: Claude, or an agents facet of `source-managed`.
  4. `unsupported`: the facet is unsupported, or the path is null.
  5. `failed`: the path is in `writeFailed`; the chip carries the reason.
  6. `edited`: the path is in `localEdit`.
  7. `missing`: the path is in `missing`.
  8. `in-sync`: the path is in `agentsInSync`.
  9. `not-synced`: everything else.
- "in sync" comes only from `agentsInSync`. A clean report that has no `agentsInSync` gives `not-synced`.
- Spec has 11 tests:
  - Exact chips for the risk-table fixture: `reviewer` missing on codex and edited on opencode, copilot in sync, cursor undetected, claude `source`, antigravity `unsupported`, no vscode chip.
  - A second slug on the same report is not affected.
  - An undetected cursor stays `not-detected` even when its path is in `missing` and `agentsInSync`.
  - Null report, and a target missing from the report.
  - An undetected Claude shows `not-detected`, not `source`.
  - `failed` carries its reason and wins over the later states.
  - `edited` beats `missing`, and `missing` beats `in-sync`.
  - A report with no `agentsInSync` gives `not-synced`.

## B-3a.2 `reconcile-guard.ts` (PR7)

- `ReconcileGuardComponent` (`ptah-reconcile-guard`): standalone, OnPush, signals plus `inject()`. It is built on `NativeModalComponent` (imported from `@ptah-extension/ui`, PA-4) and has no `[innerHTML]`.
  - `HarnessHealthStore` is imported via `@ptah-extension/marketplace/services`, the exempt path at `eslint.config.mjs:248-251`. Lint passes.
- Callers in B-3b and B-6 place `<ptah-reconcile-guard />` once, then do this:
  - `if (!(await guard().confirm({ confirmLabel: 'Sync' }))) return;`
  - then the mutation, then `store.reconcile()`.
  - With `onlyWhenEdits: true` (the B-6 model save), `confirm` resolves `true` without a modal when the fresh report lists no edits.
- How PR7 is handled:
  1. Every `confirm` calls `store.refresh({ refresh: true })`. It never reads the cached report.
     - `HarnessHealthStore.refresh` returns silently when a read is already in flight. So if `store.busy()` is true when `confirm` starts, the guard does not trust the report. It shows "Another harness check or sync is still running…" and resolves `false`.
  2. If the fresh read fails (`store.error()`), or there is no report (`health === null`), the guard says so with "Nothing was changed." and resolves `false`. This also applies with `onlyWhenEdits`, so no mutation ever goes through on stale or missing data.
     - B-6 should know: if harness health cannot be read, the model save is blocked.
  3. `localEdit` is collected from every target and every facet of the fresh report (`groupLocalEdits`), de-duplicated per target.
  4. The whole-workspace sentence is the plan's wording verbatim (`RECONCILE_WHOLE_WORKSPACE_NOTICE`, with a closing period). A spec asserts the literal string.
  5. Cancel, Escape (native `cancel`), the backdrop, and component destroy all resolve `false`. A second `confirm` while one is open also resolves `false`. Only the Confirm button resolves `true`.
- How the FU-1 wording rule is handled:
  - Edited paths are grouped per target.
  - **Snapshotted:** any target other than `claude`, and not an MCP fragment key (no `#`; MCP entries are `<configRelPath>#<serverKey>` per `harness-target.port.ts:39-41`). Every non-Claude target is a `WorkspaceHarnessTarget` (`rival-targets.ts`), and its non-MCP writes go through `snapshotBeforeOverwrite` (`workspace-target.ts:975`). The group shows "Each edited copy is saved to .ptah/harness/.history/ before it is overwritten."
  - **Overwrite only:** `claude` target paths and MCP entries. The group shows only "These hand edits will be overwritten." with no snapshot promise.
  - When both kinds are present, each sentence sits inside its own group's `<section>`.
  - A path wrongly classified as MCP can only lose a snapshot promise; it can never gain a false one.
  - When FU-1 lands, merge the groups and widen the note (recorded in the file header).
- Spec has 15 tests:
  - Cancel: resolves `false`, the only RPC called is `harness:health`, and the modal is closed.
  - Escape: no reconcile.
  - Confirm: `harness:health` then `harness:reconcile`.
  - Fresh data: the tab load uses `{}` and returns no edits. An edit is then made. The guard's call uses `{ refresh: true }` and the Codex path is listed.
  - Unrelated edits: a codex skill edit and a cursor `mcp.json#github` edit are both listed.
  - Mixed fixture: one Codex agent edit, one Claude skill edit and one Codex MCP edit. The `.history` note appears exactly once, in the Codex-copy section only. The overwrite section contains the Claude and MCP paths and no `.history` text.
  - Claude-only edit: no `.history` text anywhere.
  - Verbatim notice, plus the no-edits copy.
  - `onlyWhenEdits`: passes without a modal when there are no edits, and still asks when there is an edit.
  - Failed read: blocks the mutation, also with `onlyWhenEdits`.
  - In-flight read: blocks the guard.
  - Concurrent `confirm`: resolves `false`.
  - Two pure `groupLocalEdits` cases.

## B-3a.3 RPC client methods

- `listQuarantinedAgents()` calls `skillSynthesis:listQuarantinedAgents` with `{}`. `restoreQuarantinedAgent(slug)` calls `skillSynthesis:restoreQuarantinedAgent` with `{ slug }`.
- Types come only from `@ptah-extension/shared` (`SkillSynthesisListQuarantinedAgentsResult` and `SkillSynthesisRestoreQuarantinedAgentResult` from `rpc-skill-clone.types.ts`, `c674de486`).
- Both follow the service convention: return `result.data` on success, otherwise throw `Error(result.error || fallback)`.
  - An RPC error such as `INVALID_PARAMS` or `PERSISTENCE_UNAVAILABLE` is never turned into a success or an empty listing.
  - Every restore outcome, including `conflict` and `copy-failed`, is returned as data for B-3b to present.
  - `workspaceRoot: null` is passed through untouched.
- Spec: 6 new tests:
  - list call shape plus a pass-through of the whole listing, including `recordUnreadable`;
  - `workspaceRoot: null` is kept;
  - a list RPC error throws;
  - the restore call shape sends exactly `{ slug }` and returns a `conflict` outcome as data;
  - an `INVALID_PARAMS` restore throws with the handler's message;
  - an error with no message throws the fallback text.
- Note: the existing service convention drops `errorCode` (only the message is thrown). B-3b gets the message ("Open a workspace folder…"), not the code.

## Verification

- `npx prettier --write` on the six files. Reformatted the two guard files only.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui`: "Successfully ran targets typecheck, lint". No warnings in the six files.
- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --maxWorkers=2 --skip-nx-cache`: "Successfully ran target test".
  - My first run showed 33 suites / 539 tests, with 10 failed in my own new guard spec. The cause was my `settle()` helper using `whenStable`; I fixed it to drain one macrotask.
  - After the fix: guard spec 15/15, and chips plus RPC specs 45/45 (direct jest).
  - The project target passes. No failure was found in any file owned by another batch.

## Out of scope (not touched)

- `HarnessHealthStore.refresh` returns early, without signalling, when a read is already in flight. The guard works around this (see PR7 step 1). The store itself is unchanged; it is outside this batch.
