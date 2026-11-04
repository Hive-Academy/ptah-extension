# Code Logic Review — TASK_2026_871_0d04 Phase 1 and TASK_2026_606_b6b7

## Verdict

**REVISE — 4/10.** The new extra-file path validates names and bounds reads, but recognized documents still use an unbounded symlink-following read. A failed task switch can display the prior task's detail. These violate safety and identity requirements, placing the score below the sound 7–8 band; the bounded extra-file reader and sequence guards keep it above the foundational 1–2 band.

## Findings

### Blocking

1. **Recognized markdown bypasses the safe-read boundary** — `libs/frontend/tasks-ui/src/lib/services/task-folder.store.ts:248`; `libs/backend/task-specs/src/lib/task-index.service.ts:378–395`. Selecting `context.md`, `implementation-plan.md`, or another `DocFile` calls `tasks:getArtifact`. Its implementation uses unrestricted `readFile` on a joined path. A symlinked document or folder can read outside the selected task; a large file has no 1 MiB cap or binary/UTF-8 state. **Fix:** route every inline document through a bounded, containment-checked read with explicit states, while keeping `DocFile` as the workflow eligibility contract.

2. **Carrier load can follow a task-folder or `task.md` symlink** — `libs/backend/task-specs/src/lib/task-index.service.ts:346–350`. `tasks:get` calls `getDetail`, which reads the carrier without `lstat`, canonical containment, or a size bound. A linked carrier can make the overview render content outside the task; a huge carrier can burden the host. **Fix:** use canonical task containment and a bounded regular-file read before parsing; report link and decode failures distinctly.

### Serious

3. **A rejected task fetch can reveal the previous task under a new selection** — `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1244–1262`; `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:314`. `openTask` clears the folder store but leaves `_taskDetail` while selecting B. A rejected `tasks:get` promise skips the branch that clears detail; `finally` ends loading, so the panel renders A under B's selection. **Fix:** clear `_taskDetail` before awaiting and catch RPC rejection into a visible error state. Test a rejected request after switching A→B.

4. **Directory listing has a path-swap window** — `libs/backend/task-specs/src/lib/task-index.service.ts:449–455`. The service validates each nested directory with `lstat`/`realpath`, then calls `readDirectory` by path. Replacing a validated parent with a junction before the call lets the adapter return names outside the task. The 200-entry cap applies only after enumeration. **Fix:** list through a directory handle bound to the validated inode, or check identity and containment after the read and fail closed on change. Cap enumeration before materializing every name where supported.

### Minor

5. **A date can be mislabeled as a CLI version** — `libs/shared/src/lib/cli-version-label.ts:3`, `:23`. The regex accepts a two-to-four-part numeric token anywhere in a line. `build 2026.11.03` becomes `v2026.11.03` when the CLI gave no version. **Fix:** require a version context or full-line version form; add a date/build-line case.

## Five logic questions

1. **How does this fail silently?** `getDetail` catches a bad carrier read and returns `null` (`task-index.service.ts:356`), making unreadable look missing. `readArtifact` also returns `null` on read failure (`task-index.service.ts:388`).
2. **What user action produces unexpected behavior?** Opening B after A, followed by rejected `tasks:get`, can display A (`tasks-store.service.ts:1238–1262`). Opening a recognized linked document can show external content (`task-folder.store.ts:248`).
3. **What input produces a wrong answer?** A `DocFile` symlink bypasses the safe-read route (`task-index.service.ts:384–387`); `build 2026.11.03` can be mistaken for a version (`cli-version-label.ts:3`).
4. **What happens when a dependency fails?** A rejected RPC leaves stale detail (`tasks-store.service.ts:1260`); a failed artifact read becomes indistinguishable from absence (`task-index.service.ts:388–395`).
5. **What is missing from the requirements?** Atomic path binding is needed to make the stated containment guarantee hold under concurrent filesystem changes (`task-index.service.ts:449–454`).

## Data flow and evidence

`tasks:readFolderMarkdown` parses RPC arguments, authorizes the workspace, validates task and file names, checks canonical containment, then reads up to 1 MiB through the Electron/CLI bounded adapters (`tasks-rpc.handlers.ts:704–710`; `task-index.service.ts:417–438`; `electron-file-system-provider.ts:95–116`; `cli-file-system-provider.ts:97–118`). `TaskFolderStore.readFile` diverts `DocFile` names to `tasks:getArtifact` (`task-folder.store.ts:248–260`). The reader renders through the shared markdown block (`task-document-reader.component.ts:136`); no unsanitized `[innerHTML]` was found there. Document and nested-list sequence counters reject late responses (`task-folder.store.ts:314–322`).

I reviewed the changed-path list, requirements, implementation plan, parity inventory, batch report, and the cited security/state/CLI sources. Existing board controls were inspected at their wiring points; no supported parity removal was established. No tests or builds were run, as directed. `ptah_get_diagnostics` returned unavailable while its TypeScript check was still running, so it supplied no clean result. Visual appearance and complete board interaction parity remain unverified by this logic review.

## Review family

- Reviewer: codex
- Implementer: claude

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Include the old `DocFile` path in Phase 1 safety review. | Only new RPC; all inline markdown. | Acceptance criteria 3/3a and `TaskFolderStore.readFile` route recognized documents through the old RPC. | Yes |
