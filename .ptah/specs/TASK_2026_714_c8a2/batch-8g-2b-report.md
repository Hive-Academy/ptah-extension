# Task 8g-2b report

Files changed in this fix:

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/activation/shutdown.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-2b-report.md

Chosen fix: option (b), a spec-local Jest factory mock of `@ptah-extension/rpc-handlers`, providing the three control factory exports imported by `codex-session-binding.ts`. The mock does not load the actual barrel.

Why: `shutdown.ts` already imports runtime disposal functions from the lightweight binding registry and imports `BootRefs` as a type. The spec itself needs real session-binding helpers to exercise inactive metadata staging, delayed scope disposal, and pending persistence. Mocking the unrelated RPC control factories preserves those real implementations and existing regression assertions while preventing the reported RPC surface initialization failure. None of these shutdown scenarios invokes the mocked factories.

Existing uncommitted 8g-2 edits were retained. No production modules, allow-lists, RPC handler files, or agent-sdk files were changed by this fix; no deep imports were introduced.

Verification was not run, as explicitly required. The team leader must verify under the lock; test success is not claimed.
