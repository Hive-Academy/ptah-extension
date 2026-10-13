# Git Standards Reference

Use this reference when orchestration needs to create a commit or handle a hook failure. The orchestrator owns git operations. Executors and judges report their work and leave the working tree for the orchestrator to verify.

## Repository commit rules

Before composing a commit, **read the repository's commitlint config** and any local contributor instructions. Look for the configuration used by that repository, such as a commitlint config file or a `commitlint` entry in its package metadata. Apply the actual type, scope, subject, length, and body rules found there. If a rule is absent, do not invent an enum or claim it is enforced. Use recent accepted commits as a style guide only after checking the configured rules.

Check the repository's hook configuration before relying on a hook to run lint, tests, or commit message validation. Run the task's scoped verification even if no hook exists. State which checks ran and their outcome in the batch report. A proposed message must describe the staged change, and the staged paths must be inspected before committing.

### Default commit types and examples

Use the repository's commitlint configuration whenever it exists; it overrides every example and default below. If there is no commitlint configuration, use these conventional commit types as a starting point: `feat` (feature), `fix` (bug fix), `docs` (documentation), `style` (formatting), `refactor` (internal restructuring), `perf` (performance), `test` (tests), `build` (build or dependencies), `ci` (automation), `chore` (maintenance), and `revert` (reversal). Check local contributor instructions and recent accepted commits for any additional format conventions. Do not assume that a scope, subject case, or length limit is required without a repository rule.

The generic form is `type(scope): subject`; omit `(scope)` when the repository does not require it and a scope adds no useful context. Neutral examples for repositories without stricter rules:

| Message | Why |
| --- | --- |
| `feat(search): add query filters` | Describes a new capability. |
| `fix(parser): handle empty input` | Describes a corrected behavior. |
| `docs: clarify setup steps` | Describes a documentation change. |
| `feature(search): add query filters` | Invalid under the default types: `feature` is not a listed type. |
| `fix(parser) handle empty input` | Invalid conventional format: missing the colon. |
| `feat(search):` | Invalid conventional format: missing the subject. |

These examples do not override a repository's configured types, scopes, or message rules.

## Branch operations

Before any branch operation, inspect the current branch, working tree, and repository instructions. The orchestrator performs these operations in the quiet commit window when shared work is involved.

1. **New task branch:** Branch from the repository's intended base using its naming convention. Create a task branch only when the workflow calls for one; verify the base and destination before switching.
2. **Continue an existing task branch:** Switch to the named task branch after checking for local changes. Fetch its upstream if needed, then integrate remote changes according to the repository's policy. Inspect conflicts before continuing.
3. **Commit changes:** Inspect the diff and staged paths, run scoped checks, stage only reviewed files, and commit with a message that follows the repository's rules.
4. **Create a PR:** Use the repository host CLI when available (for example, `gh pr create` for GitHub). Give the PR a descriptive title and a body with `## Summary` and `## Test plan`, including the checks actually run and their results. Verify the base and branch before submitting.

Never commit to or merge into the default branch without the user's authorization.

## Pre-commit checks

Discover the hooks configured by this repository and read what each hook runs. Inspect the repository's hook directory or configured hook manager, relevant scripts, and commit message checks; do not infer hook behavior from another repository. Run the task's scoped formatting, lint, type, test, or other applicable checks yourself and record their outcomes. A hook's presence does not prove it ran: inspect the actual commit output, and verify the resulting commit and working tree before reporting success.

## Quiet commit window

Commit only after every implementer, reviewer, and judge has stopped writing to the shared worktree. Confirm that no lane has a pending queued turn that can still change a deliverable. Recheck the intended files and status, stage only reviewed paths, then commit while the tree is quiet. Wait for hooks to finish before reopening work on those paths. Hooks or other commit tooling may temporarily save and restore files; simultaneous edits can disappear or be mixed into a commit.

Only the orchestrator creates the commit. Do not ask a worker or CLI lane to run git, stage files, or commit. If a task needs another revision, close the commit window, complete and verify that revision, then open a new quiet window.

## Hook Failure Protocol

When a commit hook fails, capture its specific error and stop the commit attempt. Present the user with these choices, following the orchestration [hook checkpoint](checkpoints.md):

1. **Fix the issue** when it belongs to the current task, verify the fix, and retry.
2. **Bypass the hook** only with the user's explicit choice and a recorded reason. Do not use `--no-verify` automatically.
3. **Stop and report** when the failure is unrelated or cannot be resolved within the task.

Record the selected action and its evidence in the task's batch record. A failed hook is never evidence that the commit succeeded. Recheck git status before any retry because a hook may have changed staged or working files.

### Option actions

| Choice | Action |
| --- | --- |
| Fix the issue | For a task-related failure, fix the cause, run the relevant scoped check, inspect changed and staged paths, and retry the commit. |
| Bypass the hook | Only after the user explicitly chooses bypass, use the repository's supported bypass mechanism for this one attempt. Keep the failed check visible in the report. |
| Stop and report | Stop the commit attempt, record the exact error and affected check in the batch record, and report what blocks progress. |

### Agent behavior rules

- Present the specific failure and all three choices; wait for the user's decision before another commit attempt.
- Do not bypass a hook, fix unrelated work, or switch to an alternative commit path on your own.
- If the user chooses a fix, work only within the authorized task scope, verify the fix, and restage reviewed paths before retrying.
- If the user chooses bypass or stop, record the decision and the evidence in the task's batch record. A bypass does not turn a failed check into a passing one.

### Documentation when bypassing

When the user chooses a bypass, record **who chose it**, **why**, and **which hook or check failed**, along with its error, the bypass mechanism used, the resulting commit if one succeeded, and any follow-up needed. For example: "User chose to bypass the pre-commit type check because it fails in an unrelated project; check remains failing and needs separate repair." Use the task's batch record so the decision is visible to reviewers.

### Example scenarios

| Failure | Appropriate user choice and action |
| --- | --- |
| Lint error in a file changed by this task | **Fix the issue:** correct the file, run the relevant scoped lint check, inspect the staged diff, then retry. |
| Type error in an unrelated project | **Bypass the hook**, if the user explicitly chooses it: record the failing type check, reason, and decision; then use the supported bypass mechanism for the commit attempt. The user may instead choose to stop. |
| Complex build failure with multiple unresolved errors | **Stop and report:** capture the errors and affected check in the batch record, then ask for direction before further commit attempts. |

## Destructive operations

Do not discard or overwrite work with reset, clean, force push, or equivalent commands without explicit authorization. Inspect the exact paths and current git state before a branch operation, rebase, or restore.

## Related references

- [Fleet mode](fleet.md#commit-window-and-lane-mechanics) uses a quiet window after all fleet work stops.
- [Team-leader modes](team-leader-modes.md) describes who requests and records commits.
- [Task tracking](task-tracking.md) defines the task status and batch record.
