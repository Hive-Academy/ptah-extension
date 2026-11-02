# Batch 8h-4b

Implemented names-only diagnostics for changed options on active-session resume.
The original Session record and CodexContext identity exposed none of the three settings; the prepared CodexExecutionProfile contains model, effort, and permissionLevel directly.
The adapter now retains those three profile values in its own TrackedSession settings (codex-chat-adapter.ts:142, :359). All three are therefore comparable, including a defined effort against an initially unset effort.
Successful explicit model/effort/permission setters refresh the retained settings (:673, :682, :691), avoiding comparisons against stale startup values. Failed updates do not change them.
After host option validation, resume compares only defined incoming values (:217). One info log includes code codex-active-resume-options-not-applied and changed key names only; no values. Unchanged/omitted settings produce no log.
Resume does not apply settings natively; the prompt turn proceeds as before. The comment documents this and the limitation for other inputs such as systemPrompt.
Specs (:551, :582) cover one exact names-only log for changed model/effort/permissionLevel, continued prompt execution, no native reapplication, and no log for unchanged/omitted options both initially and after explicit setting updates.

Modified/written absolute paths:
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8h-4b-report.md

No tests, verification, lint, typecheck, build, diagnostics, installation, or git commands were run, as instructed. Specs remain unexecuted.
