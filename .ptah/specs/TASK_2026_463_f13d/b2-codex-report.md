# Batch 2 Codex Report

## Result

Implemented Batch 2 (C1 + C3): narrowed the CI skip guard to the three release-bot branch prefixes and added a fail-safe `dry-run` mode to the Electron publish workflow. No Nx, Jest, build, workflow dispatch, `gh`, git write, or push command was run.

## Files Created or Modified

- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\ci.yml`
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\electron-e2e.yml`
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\vscode-e2e.yml`
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\publish-cli.yml`
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\publish-extension.yml`
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\publish-electron.yml`
- Created `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\b2-codex-report.md`
- Created temporary, untracked verification harness `C:\Users\abdal\AppData\Local\Temp\task-463-batch2-assertions.cjs`, as permitted by the Batch 2 verification instructions.

## Task 2.1 Evidence — Narrow CI Bump Guard

- `.github/workflows/ci.yml:41-51` documents the three workflow-owned prefixes, the PR #512 reason, the accepted `chore/bump-electron-v…` residual, and the `head_commit` null behavior; lines 49-51 contain exactly the three narrow prefix exclusions.
- `.github/workflows/electron-e2e.yml:40-49` and `.github/workflows/vscode-e2e.yml:52-61` carry the same contract and explicitly state that an empty `workflow_dispatch` `head_ref` runs.
- `.github/workflows/publish-cli.yml:401`, `.github/workflows/publish-extension.yml:226`, and `.github/workflows/publish-electron.yml:698` cross-reference all three bump guards immediately above their `BRANCH=` assignments.
- The structural evaluator proves the three bot examples skip, while `chore/bump-better-sqlite3-13` and an empty `head_ref` run.
- The old broad `startsWith(github.head_ref, 'chore/bump-')` term is absent from all three guarded jobs. The PR-state and `chore(release)` conditions remain unchanged.

Risk handling: exact-prefix assertions prevent both a broad skip regression and a typo in a release-bot prefix. The accepted residual is documented rather than silently broadened.

## Task 2.2 Evidence — Electron Dry Run

- Header safety notice: `.github/workflows/publish-electron.yml:15-18` states what runs and is skipped, zero eSigner signatures, approximately three runner legs of cost, and that unsigned artifacts must never be distributed.
- Input and concurrency: lines 62-66 add the optional boolean `dry-run` input with default `false`; line 69 separates `dry-run` and `publish` concurrency groups.
- Mode resolution: line 91 exports `release_mode`; lines 93-116 make `Resolve release mode` the first step, pass event/input through `env`, write the output and step summary, and reject a non-publish push mode.
- Paid/outward actions: lines 489, 509, 539, 546, 576, 587, and 648 add an explicit positive `needs.prepare.outputs.release_mode == 'publish'` condition to all seven signing/check/retry/copy-back steps. This includes both retries whose negative completion checks would otherwise evaluate true after a skipped check.
- Dry-run packaging remains intact: no other build step received a mode condition. In particular, staging, NSIS repack, packed-native verification, and installer discovery remain runnable. Line 671 changes only artifact retention to 30 days for publish or 5 days otherwise.
- Release lock: lines 673-675 positively gate the whole release job; lines 678-686 add `Refuse unless publishing` as its first step. Thus a missing or invalid downstream `release_mode` matches neither positive publish gate: signing and release stay skipped. The second lock also refuses execution if job gating is ever bypassed.
- YAML aliases remain valid: both retry steps resolve their aliased `with.command` to `batch_sign`.

Risk handling:

- Billing retry: each of the seven relevant steps has its own positive publish-mode term, including all checks and retries.
- Fail-open publication: the release job has a positive mode condition plus a first-step runtime lock. Missing/invalid output values do not sign or release.
- Dry-run/real-run cancellation: concurrency groups differ by mode.
- Push and sync paths: a push resolves to publish and is self-checked; a dispatch without `dry-run` resolves to publish; only an explicit dispatch value of `true` resolves to dry-run.
- Windows dry run: copy-back is skipped, while unsigned repack and verification continue.
- Artifact confusion: dry-run artifacts retain for 5 days and the header marks them unsigned and non-distributable.
- Anchor damage: strict YAML parse and resolved-alias assertions passed.

## Mode Evaluation

- Push: `EVENT_NAME=push`; the dry-run conjunction is false, so `release_mode=publish`; the push self-check passes.
- Dispatch without the input (including Sync Release Branch, whose default is false): the conjunction is false, so `release_mode=publish`.
- Dispatch with `dry-run=true`: both terms are true, so `release_mode=dry-run`; every paid/signing step and the release job skip.

## Verification

Steps 1-4 are N/A for this workflow-only batch. Final verification ran in the requested order.

### 1. Strict YAML parse

Exit code 0. Literal output:

```text
YAML parse OK: ci.yml
YAML parse OK: electron-e2e.yml
YAML parse OK: vscode-e2e.yml
YAML parse OK: publish-cli.yml
YAML parse OK: publish-extension.yml
YAML parse OK: publish-electron.yml
```

### 2. Structural guard assertions

Exit code 0. Literal output:

```text
guard OK: ci.yml jobs.main
guard OK: electron-e2e.yml jobs.electron-e2e
guard OK: vscode-e2e.yml jobs.vscode-e2e
branch OK: publish-cli.yml chore/bump-cli-v${VERSION}
branch OK: publish-electron.yml chore/bump-electron-v${VERSION}
branch OK: publish-extension.yml chore/bump-extension-v${VERSION}
guard evaluation OK: "chore/bump-cli-v1.2.3" -> skip
guard evaluation OK: "chore/bump-electron-v0.9.1" -> skip
guard evaluation OK: "chore/bump-extension-v2.0.0" -> skip
guard evaluation OK: "chore/bump-better-sqlite3-13" -> run
guard evaluation OK: "" -> run
publish gate OK: Sign main app executable with SSL.com eSigner
publish gate OK: Check batch-sign output (attempt 1)
publish gate OK: Batch-sign retry (attempt 2)
publish gate OK: Check batch-sign output (attempt 2)
publish gate OK: Batch-sign retry (attempt 3)
publish gate OK: Copy signed binaries back into win-unpacked
publish gate OK: Sign Windows installer with SSL.com eSigner
release job gate OK
build mode-term allowlist OK: 7 protected steps + upload retention only
anchor resolution OK: Batch-sign retry (attempt 2) command=batch_sign
anchor resolution OK: Batch-sign retry (attempt 3) command=batch_sign
dry-run input OK: type=boolean default=false
prepare output OK: ${{ steps.mode.outputs.release_mode }}
release second lock OK: first step is Refuse unless publishing
concurrency group OK: publish-electron-${{ github.event.inputs.dry-run == 'true' && 'dry-run' || 'publish' }}
STRUCTURAL ASSERTIONS OK
```

The first attempt to launch the temporary harness failed before parsing because Node resolves modules relative to the temp script and could not find `yaml`. The harness was corrected to resolve `W\node_modules\yaml` explicitly, and the complete four-step verification sequence was restarted from the YAML parse. No product or workflow assertion failed.

### 3. Prettier

Command covered all six changed workflow files. Exit code 0. Literal output:

```text
Checking formatting...
All matched files use Prettier code style!
```

### 4. Git diff whitespace check

`git diff --check` exited 0 with no output.

## Clarifications Needed

None.

## Revise round 1

### Findings addressed

1. Logic moderate — duplicated dry-run predicate

   - `.github/workflows/publish-electron.yml:69-70` now documents that the workflow-level concurrency expression must match `Resolve release mode` and derives its value solely from `github.event.inputs.dry-run == 'true'`.
   - `.github/workflows/publish-electron.yml:101-102` points back to `concurrency.group` and uses the same sole input predicate, `DRY_RUN = "true"`. `EVENT_NAME` remains separate only for the required push-path safety check.
   - `C:\Users\abdal\AppData\Local\Temp\task-463-batch2-assertions.cjs` now structurally asserts both predicate forms and both cross-reference comments, then evaluates push/no-input, dispatch/no-input, `false`, `true`, and invalid input cases through both interpretations and requires identical modes.
   - GitHub Actions cannot make workflow-level `concurrency.group` consume a job output, so the input itself is the shared source of truth and the equivalence assertion is the drift guard.

2. Style minor — release-mode invariant

   - `.github/workflows/publish-electron.yml:92-93` now states beside the output that every paid or outward-facing step must positively require publish and that a missing value means no signing or release.

3. Style minor — guard-comment consistency

   - `.github/workflows/ci.yml:41-46`, `.github/workflows/electron-e2e.yml:40-45`, and `.github/workflows/vscode-e2e.yml:52-57` now use identical prose for the bot sources, three prefixes, human-branch behavior, PR #512, accepted residual, and null `head_commit` explanation.
   - Only the final trigger-specific clause differs: `ci.yml:46` preserves the check for a future non-PR trigger, while the two dispatchable e2e workflows state that an empty `workflow_dispatch` `head_ref` runs (`electron-e2e.yml:45`, `vscode-e2e.yml:57`).

### Files changed in revise round 1

- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\ci.yml`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\electron-e2e.yml`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\vscode-e2e.yml`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.github\workflows\publish-electron.yml`
- `C:\Users\abdal\AppData\Local\Temp\task-463-batch2-assertions.cjs` (temporary verification harness)
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\b2-codex-report.md`

### Verification

The complete Batch 2 verification was rerun in the requested order. No Nx, Jest, build, workflow dispatch, `gh`, or git write command was run.

#### 1. Strict YAML parse

Exit code 0. Literal output:

```text
YAML parse OK: ci.yml
YAML parse OK: electron-e2e.yml
YAML parse OK: vscode-e2e.yml
YAML parse OK: publish-cli.yml
YAML parse OK: publish-extension.yml
YAML parse OK: publish-electron.yml
```

#### 2. Structural guard assertions

Exit code 0. Literal output:

```text
guard OK: ci.yml jobs.main
guard OK: electron-e2e.yml jobs.electron-e2e
guard OK: vscode-e2e.yml jobs.vscode-e2e
branch OK: publish-cli.yml chore/bump-cli-v${VERSION}
branch OK: publish-electron.yml chore/bump-electron-v${VERSION}
branch OK: publish-extension.yml chore/bump-extension-v${VERSION}
guard evaluation OK: "chore/bump-cli-v1.2.3" -> skip
guard evaluation OK: "chore/bump-electron-v0.9.1" -> skip
guard evaluation OK: "chore/bump-extension-v2.0.0" -> skip
guard evaluation OK: "chore/bump-better-sqlite3-13" -> run
guard evaluation OK: "" -> run
publish gate OK: Sign main app executable with SSL.com eSigner
publish gate OK: Check batch-sign output (attempt 1)
publish gate OK: Batch-sign retry (attempt 2)
publish gate OK: Check batch-sign output (attempt 2)
publish gate OK: Batch-sign retry (attempt 3)
publish gate OK: Copy signed binaries back into win-unpacked
publish gate OK: Sign Windows installer with SSL.com eSigner
release job gate OK
build mode-term allowlist OK: 7 protected steps + upload retention only
anchor resolution OK: Batch-sign retry (attempt 2) command=batch_sign
anchor resolution OK: Batch-sign retry (attempt 3) command=batch_sign
dry-run input OK: type=boolean default=false
prepare output OK: ${{ steps.mode.outputs.release_mode }}
release second lock OK: first step is Refuse unless publishing
concurrency group OK: publish-electron-${{ github.event.inputs.dry-run == 'true' && 'dry-run' || 'publish' }}
mode predicates agree: push / no input -> publish
mode predicates agree: dispatch / no input -> publish
mode predicates agree: dispatch / false -> publish
mode predicates agree: dispatch / true -> dry-run
mode predicates agree: dispatch / invalid -> publish
STRUCTURAL ASSERTIONS OK
```

#### 3. Prettier

The check covered all six Batch 2 workflow files. Exit code 0. Literal output:

```text
Checking formatting...
All matched files use Prettier code style!
```

#### 4. Git diff whitespace check

`git diff --check` exited 0 with no output.
