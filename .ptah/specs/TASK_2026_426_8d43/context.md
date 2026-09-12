# Context — TASK_2026_426_8d43

## User intent

Enhance the Skills tab so a user manages user-layer clones from the Electron UI.
The user must not hand-edit files under `~/.ptah/user`.

## Trigger — the observed defect

The user merged a change that adds a random suffix to task folder ids
(`TASK_YYYY_NNN_xxxx`). At every application start, git reported that
`.codex/agents/*.toml` and `.claude/skills/orchestration/**` reverted to the old
form.

Root cause, measured on 2026-09-12:

1. The workspace copies are manifest-owned output of `HarnessReconcilerService`.
   It runs at activation
   (`apps/ptah-electron/src/activation/boot-heavy-services.ts:261`,
   `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:88`).
2. When the on-disk hash differs from the recorded output hash, the reconciler
   rewrites the file and only reports it
   (`libs/backend/harness-sync/src/lib/targets/workspace-target.ts:525-530`,
   `:886`). Source wins over local edits. There is no reverse sync.
3. The source is the user layer. `~/.ptah/user/skills/orchestration` is stale
   (15764 bytes, 2026-08-09) while the upstream cache
   `~/.ptah/plugins/ptah-core/skills/orchestration` is current (15986 bytes,
   2026-09-10) and carries the suffix rule.
4. The clone sidecar holds `"diverged": true` with a `pendingSourceHash`.
   `UserLayerMirrorService` fast-forwards only an unmodified clone
   (`user-layer-mirror.service.ts:1434-1465`), so the clone never advances.
5. The 15 agent clones under
   `~/.ptah/user/agents/ptah-extension-f3f2fa6ea9b593a6/` are in the same state.

## What already exists

- Per-clone actions in the drawer: Rebase
  (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts:190`),
  Keep mine (`:206`), Revert to a `.history` snapshot (`:319`).
- Backing primitives: `UserLayerMirrorService.rebaseClone`
  (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:473`)
  and `keepClone` (`:484`).
- The clone body is read-only in the drawer (`:246`, `:365`).
- The harness health row shows an "N local edits" badge from
  `overwrittenLocalEdit`
  (`libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts:124-130`).
  The badge does not route anywhere.

## Gaps in scope

Confirmed by the user at Checkpoint 0:

1. **Divergence control** — bulk "Rebase all diverged", a diverged filter and
   count on the clones list, and a deep link from the harness health local-edit
   badge into the Skills tab.
2. **Edit clone body in the app** — a markdown editor in the clone detail
   drawer, plus a write RPC that saves a user-supplied body into `~/.ptah/user`.
   No such RPC exists today. All user-layer writes are path-guarded by
   `user-layer-fs-ops.ts:42-54`.

## Out of scope

- Diff preview before rebase (offered, not selected).
- VS Code host parity for `skillSynthesis:*` (offered, not selected). The
  handlers stay in `apps/ptah-extension-vscode/src/di/expected-absent.ts:38`.
- Any reverse sync from a workspace copy back into the user layer.

## Orchestration

- Task type: FEATURE. Workflow depth: Full.
- Agent sequence: project-manager → software-architect → team-leader → executors
  → reviewers → QA.
- `cli_delegation: enabled`. Available: codex (installed), antigravity
  (installed), claude cli (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`), ollama
  cloud (`pc-85830910-3d81-4248-84c1-4fa52752dd19`). copilot is disabled.
  Maximum 3 concurrent.
- Worktree: `.claude-worktrees/skills-tab-clone-management-681582aee5c4`,
  branch `skills-tab-clone-management-681582aee5c4`.
