# Worktree plugin policy and session associations

## User request

The user approved the proposed two-part work: fix worktree plugin inheritance, then check existing session/worktree/change links for integration gaps. Do not use folder symlinks as a policy fix.

## Scope

- Electron first.
- Keep execution cwd, repository file changes, and MCP trust scoped to the worktree.
- Make plugin configuration inheritance explicit. Preserve local choices and parent enable/disable behavior.
- Reuse existing session organization and git review features. Audit TASK_2026_580_9f77, TASK_2026_576_e16a, TASK_2026_584_5e7a and backlog TASK_2026_386. Do not implement that entire backlog task.
- Identify verified association gaps before proposing repairs. No new parallel session metadata system.

## Inputs

Investigation: /home/amun/ptah-extension/.ptah/specs/INVESTIGATE_SKILL_OVERRIDES/report.md.
Main checkout remains untouched. All task writes and checks belong in /home/amun/ptah-extension/.claude-worktrees/worktree-session-policy.

## Workflow

BUGFIX, Full. Scope/architecture analysis, independent document review, user plan approval, implementation, scoped verification, independent code review.
No UI redesign is authorized by the current scope. If needed, present that scope separately.

## Execution

CLI lanes enabled. The live roster includes codex and Ollama Code with confirmed room. Prior preference favors active CLI use for onboarding only. It does not pin this task. Use an in-process architect for bounded scope analysis, an opposite-side lane for document review, then specialist implementation lanes after approval.
No source implementation before plan approval. No commit or push without current explicit authorization under the developer instructions.

## Verification rules

Use only npm run verify with explicit changed projects and dependent hosts. Never run workspace-wide checks, build, serve, dev, e2e or package. Preserve configured Nx/Jest caps and shared cache. Other heavy commands require the verify lock. Do not change real user settings or application state to test inheritance.
