# Git Standards Reference

Use this reference when orchestration needs to create a commit or handle a hook failure. The orchestrator owns git operations. Executors and judges report their work and leave the working tree for the orchestrator to verify.

## Repository commit rules

Before composing a commit, **read the repository's commitlint config** and any local contributor instructions. Look for the configuration used by that repository, such as a commitlint config file or a `commitlint` entry in its package metadata. Apply the actual type, scope, subject, length, and body rules found there. If a rule is absent, do not invent an enum or claim it is enforced. Use recent accepted commits as a style guide only after checking the configured rules.

Check the repository's hook configuration before relying on a hook to run lint, tests, or commit message validation. Run the task's scoped verification even if no hook exists. State which checks ran and their outcome in the batch report. A proposed message must describe the staged change, and the staged paths must be inspected before committing.

## Quiet commit window

Commit only after every implementer, reviewer, and judge has stopped writing to the shared worktree. Confirm that no lane has a pending queued turn that can still change a deliverable. Recheck the intended files and status, stage only reviewed paths, then commit while the tree is quiet. Wait for hooks to finish before reopening work on those paths. Hooks or other commit tooling may temporarily save and restore files; simultaneous edits can disappear or be mixed into a commit.

Only the orchestrator creates the commit. Do not ask a worker or CLI lane to run git, stage files, or commit. If a task needs another revision, close the commit window, complete and verify that revision, then open a new quiet window.

## Hook Failure Protocol

When a commit hook fails, capture its specific error and stop the commit attempt. Present the user with these choices, following the orchestration [hook checkpoint](checkpoints.md):

1. **Fix the issue** when it belongs to the current task, verify the fix, and retry.
2. **Bypass the hook** only with the user's explicit choice and a recorded reason. Do not use `--no-verify` automatically.
3. **Stop and report** when the failure is unrelated or cannot be resolved within the task.

Record the selected action and its evidence in the task's batch record. A failed hook is never evidence that the commit succeeded. Recheck git status before any retry because a hook may have changed staged or working files.

## Destructive operations

Do not discard or overwrite work with reset, clean, force push, or equivalent commands without explicit authorization. Inspect the exact paths and current git state before a branch operation, rebase, or restore.

## Related references

- [Fleet mode](fleet.md#commit-window-and-lane-mechanics) uses a quiet window after all fleet work stops.
- [Team-leader modes](team-leader-modes.md) describes who requests and records commits.
- [Task tracking](task-tracking.md) defines the task status and batch record.
