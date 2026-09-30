# P1 Approval — TASK_2026_576_e16a

## Approver

Independent approval lane per the standing authorization (context.md:71). Model family: glm-5.3:cloud via Ollama. The prior batch reviews were done by antigravity lanes (Batches 1, 5, 8) and same-side in-process subagents (Batches 2, 3, 4, 6, 7). This approval is from a third family that authored and reviewed none of the P1 code.

- Branch: `feat/task-2026-576-git-review`, HEAD 56499b822, base main 722d921ab.
- Scope of this approval: phase P1 only (RC1-RC8, Batches 1-8).

## RC evidence table

| RC  | Requirement (short)                                                                                                                         | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC1 | Git mutation results surface in the dock; a failed stage shows a dismissible row error with the fixed lock message, never raw stderr        | COMPLETE | `git-status.service.ts` (Batch 7, round 1: `pending` key, `canRunRow`/`canRunBulk` guards); `git-dock.component.ts` row error; e2e `apps/ptah-electron-e2e/src/specs/git/row-stage-failure.spec.ts:199-244` asserts RPC `success:false, code:'LOCKED'`, `error === GIT_LOCKED_MESSAGE`, row error visible within the default 5 s, exact text, no `index.lock`/`fatal:` text — 5 passing runs (test-report-p1-row-error.md:27-32); `commit-hook-failure.spec.ts` regression `1 passed` |
| RC2 | A cancel or timeout during a hook shall not leave `.git/index.lock` behind                                                                  | COMPLETE | Batch 5 write lock + `GitCommitKillGuard`; `exec-git.ts:782-797` bounded kill try/finally with SIGTERM fallback; hooks real-git spec 6 consecutive passes; reviews/batch-5-code-logic-review.md round 2 APPROVED 10/10, zero findings                                                                                                                                                                                                                                                 |
| RC3 | Transient `isGitRepo` failure shall not render "not a Git repository"; status-unavailable tri-state; stale status kept on transport failure | COMPLETE | `git-status.service.ts:440-458` round-0 serious fixed via `readFailureReason`/`markReadFailed` + 11 new specs, 443 tests green; tri-state chip with AA contrast gate `git-error-tint-contrast.spec.ts` 8/8 (visual-review.md round 1)                                                                                                                                                                                                                                                 |
| RC4 | Non-ASCII and special-character paths parse correctly; staged-rename discard cannot report success after a failed read                      | COMPLETE | porcelain v2 `-z` parsing (Batch 4); `discardChanges` read-failure closure on both reads, LOCKED/GIT_ERROR checked before any write; failure-injection real-git case `git-info.service.paths.real-git.spec.ts:220-258`; 778/778 green. POSIX-only filename cases (`a"b`, `a\b`, leading/trailing space) ride the CI matrix (see Open finding 1)                                                                                                                                       |
| RC5 | Recursive git-dir watcher with a pure classifier                                                                                            | COMPLETE | Batch 3, watcher + classifier in ptah-electron; round 2 recheck all 5 items VERIFIED, 119/119 + real-git 9/9                                                                                                                                                                                                                                                                                                                                                                          |
| RC6 | Mutations serialize through a write lock; `index.lock` contention retries ~3.1 s; the user sees `GIT_LOCKED_MESSAGE`, never raw stderr      | COMPLETE | `libs/shared/src/lib/constants/git-operation.constants.ts:29-33` (`GIT_INDEX_LOCK_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600]`); `GIT_LOCKED_MESSAGE` at git-operation.constants.ts:38-39; `GitRepoWriteLock` (Batch 5); e2e row-stage-failure.spec.ts pins the user-facing text end to end                                                                                                                                                                                          |
| RC7 | Diff flags pinned (`--no-textconv --src-prefix=a/ --dst-prefix=b/`)                                                                         | COMPLETE | DIFF_FLAGS constants (Batch 4); used by the diff assembly; typecheck/lint green                                                                                                                                                                                                                                                                                                                                                                                                       |
| RC8 | Renderer RPC timeout always exceeds the backend git timeout so the typed result arrives first                                               | COMPLETE | `gitRpcTimeoutFor(backendMs) = backendMs + GIT_RPC_TIMEOUT_MARGIN_MS` at git-operation.constants.ts:41-43; `GIT_HOOK_TIMEOUT_MS = 600_000` → renderer 615,000; `GIT_FETCH_TIMEOUT_MS = 300_000` → renderer 315,000; verified by direct read of the constants file                                                                                                                                                                                                                     |

## Open findings

None blocking. None serious. Open items, numbered:

1. **First `git-real-git` CI run happens on the P1 PR itself.** Linux and macOS real-git evidence, and the POSIX-only filename cases of RC4, have not yet been observed green on a runner. The job is wired (`.github/workflows/ci.yml:202-262`, matrix ubuntu/windows/macos, `--testPathPatterns=real-git --passWithNoTests=false`, `[slow]` excluded on windows/macos). Evidence: batches.md:699-710 lists this as the open item for the PR. Severity: Moderate — open by design; the task brief classifies it as "not a blocker for opening a PR".
2. **GIT_ERROR row-failure path not separately pinned.** The e2e pins the `LOCKED` mapping; a raw `GIT_ERROR` row failure follows the same `setError`/render path but has no dedicated e2e. Evidence: test-report-p1-row-error.md:41. Severity: Minor.
3. **Carried minors with named owners.** The `'RPC timeout'` literal coupling at `rpc-call.util.ts:132` (Batch 6 review, labelling only); rail-width squeeze after narrow resize and focus-ring legibility (both reproduce on base 722d921ab, pre-existing) — carried to the cutover visual review per visual-review.md. Severity: Minor.
4. **Known unrelated rpc-handlers spec failure** (harness skill selection, state.json) — pre-existing, on the HANDOFF ignore list, not a P1 defect. Severity: not a finding against P1.

## Row-stage-failure spec judgment

**Sound.** Reasons:

- **Deterministic.** The spec owns a plain `.git/index.lock` file (`row-stage-failure.spec.ts:195`). Real git cannot take the index lock on every OS, every run. Nothing is mocked.
- **Cleans up.** `finally { fs.rmSync(lockPath, { force: true }) }` plus an `existsSync` assertion after (`row-stage-failure.spec.ts:245-248`). The scratch repo is cleaned by the fixture.
- **Separates backend from UI.** The RPC wait uses a named 30 s budget (`STAGE_RPC_BUDGET_MS`, line 37); the row-error visibility uses Playwright's default 5 s with no sleep (line 216). "RPC failed" and "UI rendered" are distinct assertions, so a late-render regression fails the spec.
- **Asserts the right things.** RPC targeted `['src/calc.ts']`; outcome `{success:false, code:'LOCKED'}` with `error === GIT_LOCKED_MESSAGE` exactly; no `index.lock` or `fatal:` text leaks; error count 1; Stage re-enabled and not `aria-busy`; dismiss target >= 24x24 with a section-unique aria-label; git state verified directly (`repo.stagedDiff()`).
- **Causation control.** Lock removed, the same button clicked again, the stage succeeds and the file lands under Staged files (lines 251-259). The failure is proven to come from the held lock.
- **Observer is additive.** It taps `ipcMain.on('rpc')` and wraps `webContents.send` without intercepting (lines 57-101); the real listener keeps answering.

Minor note, not a defect: the refresh-survival check (lines 227-228) re-asserts visibility without first awaiting completion of the post-mutation refresh. It is a weak check for that specific race, but the regression the spec targets — late or missing error render — is bounded by the default 5 s at line 216, which is the correct and strict assertion.

## Scope check

`git diff --name-status main...HEAD`: 43 non-task files, all P1 paths — `.github/workflows/ci.yml`, e2e git specs (including the new `row-stage-failure.spec.ts`), ptah-electron watcher files, the webview contrast spec, rpc-handlers git spec, vscode-core git services and `exec-git.ts`, git-ui services and components, shared git contracts. Plus 101 task-document files under `.ptah/specs/TASK_2026_576`. **Zero deleted files.** Nothing outside P1 is in the diff. The 4 approved parity removals (P4 component removals) are untouched. The new HEAD commit 56499b822 adds the row-stage spec and the cadence note only.

## Verdict

**Verdict: APPROVED**

Reasons:

1. Every RC1-RC8 requirement for P1 has file:line or test-name evidence, verified in the review documents and spot-checked directly against the code (constants file, CI job, e2e spec read in full).
2. Every batch review ends APPROVED with all blocking and serious findings resolved and recheck-verified: Batch 1 9/10, Batch 2 8/10, Batch 3 9/10 (round 2), Batch 4 8/10 (round 1), Batch 5 10/10 (rounds 1-2), Batch 6 8/10 (round 1), Batch 7 8/10 (round 1), Batch 8 9/10 (round 1). No unresolved BLOCKING or SERIOUS finding remains in any review file.
3. The row-stage-failure spec is deterministic, cleans up after itself, and asserts the right behaviour at the right strictness (judgment above).
4. The scope is clean: no file removals at all, no paths outside P1, no unapproved parity removal.
5. The only open verification item — the first `git-real-git` CI run on the matrix — closes on the PR itself by design, which the task brief explicitly classifies as not a blocker for opening the PR.

The branch is ready for the user to open the P1 pull request.
