# Context - TASK_2026_863_26b1

Bug: idle `/compact` before prompt-cache expiry fires only for the session shown in the chat view.
Background sessions (other tab, other workspace) do not get it.

Prior work: PR #909 (merge 7531c509d, TASK_2026_863_cfae). Notes read from git history
(`git show 7531c509d:.ptah/specs/TASK_2026_863_cfae/...`), the folder is not on main's disk.

- Worktree: `.claude-worktrees/idle-compact-background`, branch `fix/idle-compact-background`.
- node_modules: junction to the main checkout.
- Dev run: `PTAH_DEV_IDLE_CACHE_TTL_MS=60000 PTAH_DEV_IDLE_MIN_TOKENS=1000 npm run dev`
  (watch build) and the Electron launcher, logs in this folder.

## Gate 0.1

- Mode: full auto (user). Lanes `enabled`. Approval: `lane-review`.
- Spawnable lanes (ptah_agent_list): codex, antigravity, opencode, grok, Glm (ptah-cli).
  kimi code AT LIMIT. copilot and claude disabled.

## Flow

BUGFIX, Partial: live evidence (orchestrator) -> fix lane (codex) -> code-logic review
(different vendor) -> verify -> live re-run B and C -> PR.
