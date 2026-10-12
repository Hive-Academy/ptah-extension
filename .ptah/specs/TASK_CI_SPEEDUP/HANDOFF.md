# Handoff — finish PR #682 and PR #683, then merge both

Written 2026-10-09. Two PRs are open from this session. The user authorized: fix CI, push, and **merge both PRs once all their CI checks pass**. Do not merge a PR with a failing or pending check.

## PRs

| PR                                                                                     | Branch                         | Worktree                                                                | Head at hand-over | State                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| #683 `fix(chat): show the agent-origin note as a collapsible top hint` (+ CI speed-up) | `fix/agent-origin-hint`        | `D:\projects\ptah-extension\.claude-worktrees\agent-origin-hint`        | `d3f9c83e2`       | **All checks pass, SonarCloud gate OK** (16:26 UTC). Ready to merge after one more `gh pr checks 683` confirms nothing changed. |
| #682 `fix(chat): automatic session hand-over to a successor`                           | `fix/session-handoff-workflow` | `D:\projects\ptah-extension\.claude-worktrees\session-handoff-workflow` | `061107aa4`       | `main` check FAILS on the degradation-audit ratchet (see below). All other checks pass.                                         |

Merge order: **#683 first** (it carries the faster CI), then #682. The repository merges with merge commits (`Merge pull request #… from …`), so use `gh pr merge <n> --merge`. Do not delete the branches unless the user asks.

After #683 is merged, #682 needs a NEW run to use the new workflows: push the fix below (that is a new run), or use `gh pr update-branch 682`. A re-run reuses the old merge commit and the old workflows.

## PR #683 — what it contains

1. `libs/frontend/chat/.../agent-origin-banner.component.ts` (+ spec) and `chat-view.component.html`: the agent-origin note is a one-line collapsible hint at the top of the chat view.
2. CI speed-up:
   - `.github/actions/setup-ci/action.yml` (new composite action): shared setup. `npm ci --ignore-scripts` (no `|| npm install` fallback), pinned Linux platform binaries, `npm rebuild better-sqlite3 node-pty`, `node_modules/.bin/nx` for Prisma.
   - `.github/workflows/ci.yml`: job `checks` (di-lint, degradation-audit, scripts tests, affected build, eager-closure gate), job `test-shard` (4 shards of affected test projects, `--coverage --parallel=2 --maxWorkers=2`), summary job `main`.
   - `.github/workflows/electron-e2e.yml`: 4 Playwright shards with `--grep-invert @perf`, run in `dbus-run-session`; summary job `electron-e2e`; `electron-e2e-perf` job runs only the `@perf` benchmark on a nightly cron (02:30 UTC) or `workflow_dispatch` (`run_perf`, default true). Workflow-level `permissions: {}`, per-job permissions. On a node_modules cache miss the E2E jobs run the root postinstall scripts explicitly (`rebuild-native.js`, `patch-transformers-onnx-dep.js`) so better-sqlite3 is built for the Electron ABI.
   - `apps/ptah-electron-e2e/.../review-canvas-large.spec.ts`: benchmark title tagged `@perf`. `visual-review.spec.ts`: caret step uses `getByTestId('open-in-caret')`.

Measured: CI on PR #683 went from ~27 min (`main`) to ~4 min total (test shards 2.4–4.0 min; only `chat` and its dependents were affected). Electron E2E with 3 shards was 8.3 / 20.3 / 9.3 min. With 4 shards and `@perf` excluded (`d3f9c83e2`): 10.2 / 13.0 / 8.2 / 6.2 min, so ~13 min wall time (was 26–28 min). CI on `d3f9c83e2`: test shards 2.3–4.0 min, `checks` 3.0 min, ~4 min total. `electron-e2e-perf` is skipped on PRs as designed.

### PR #683 — what to check

1. `gh pr checks 683`. Expect: `checks`, `test (shard 1..4/4)`, `main`, `electron-e2e (shard 1..4/4)`, `electron-e2e`, `webview-e2e`, `git-real-git (3 OS)`, `SonarCloud Code Analysis`, GitGuardian.
2. If `electron-e2e` shows no jobs, the workflow file did not parse. Lint it: `/tmp/actionlint.exe -shellcheck= .github/workflows/electron-e2e.yml .github/workflows/ci.yml` (download: `https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_windows_amd64.zip`). A YAML comment inside an `if: |` block breaks the expression.
3. SonarCloud gate: `curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=Hive-Academy_ptah-extension&pullRequest=683"` and issues: `curl -s "https://sonarcloud.io/api/issues/search?componentKeys=Hive-Academy_ptah-extension&pullRequest=683&resolved=false"`. The last open findings were S8543 on the `|| npm install` fallbacks; commit `d3f9c83e2` removed all four. The Sonar MCP issue search returned nothing for this PR; use the public API above.
4. If an Electron shard fails, read its log; the D-Bus flood is gone, so `gh run view <id> --log-failed` is readable. A known flaky/real failure seen on another branch: `thoth-skills` "pinned lane renders pinned".
5. If the Electron shards are still unbalanced (one shard far longer), report the times; do not change `workers` or `fullyParallel` without the user.

## PR #682 — the failing gate and its fix

`degradation-audit:lint` ratchet: `libs/backend/agent-sdk: 5 FAIL (baseline 4)`, `libs/backend/rpc-handlers: 2 FAIL (baseline 1)`. The two NEW sites are from this PR:

1. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:494` — `catch { return undefined; }` in the owned-handoff capture (the history read that collects the agent's handoff text). A failure falls back to the deterministic builder by design, so do not throw. Log the error through the coordinator's logger if it has one, and add the audit marker comment on the line above the catch: `// degradation-audit: <kind> - <reason>`. Read the marker grammar and the allowed `<kind>` values in `tools/degradation-audit/check-degradation.ts` (lines ~27-60, `SUPPRESSION_MARKER_RE` at ~102) and copy an existing example (e.g. `session-spawner.service.ts`: `// degradation-audit: reported - a release failure never blocks an end …`).
2. `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts:64` — `previous.catch(() => undefined)` in `scheduleStateBroadcast`. It only keeps the per-source broadcast chain alive after a failed broadcast; the failure itself is handled in the `try` below. Add the marker with that reason, or log the error.

Do NOT raise the baselines. Verify locally (worktree `session-handoff-workflow`, one at a time):

```
npx nx run degradation-audit:lint
npx nx run di-lint:lint
npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff --coverage=false --maxWorkers=2
npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts --coverage=false --maxWorkers=2
npx nx typecheck agent-sdk --parallel=1
npx nx typecheck rpc-handlers --parallel=1
npx nx lint agent-sdk --parallel=1
npx nx lint rpc-handlers --parallel=1
```

Commit (conventional, e.g. `fix(agent-sdk): report swallowed hand-over failures to the degradation audit`), push, then wait for `gh pr checks 682`.

PR #682 background (only if a reviewer asks): requirements and reviews are in the worktree under `.ptah/specs/TASK_SESSION_HANDOFF/` (`HANDOFF.md`, `code-logic-review-final*.md`). The last lease-transfer fix (`closed` is published before the source end) was not reviewed by an outside lane; the PR body says so.

## Rules (from CLAUDE.md and from this session)

- Memory-safe checks only: changed projects only, `--maxWorkers=2`, `--parallel=1`, no workspace-wide runs, no build/serve/e2e/package locally. One heavy check at a time.
- **Never run `npm ci` or `npm install` inside a worktree.** Each worktree's `node_modules` is a junction to `D:\projects\ptah-extension\node_modules`; `npm ci` deletes the main checkout's packages (this happened once in this session and was repaired with `npm install` in the main checkout). Put this rule in every lane task.
- Lanes: `codex` implements, `antigravity` reviews with `model: "gemini-3.1-pro-high"` and `effort: "high"`. Codex lanes cannot finish Jest/Nx in their shell window: tell them not to run checks and run the checks yourself. Verify every lane claim.
- The GitHub API from this machine times out now and then (`dial tcp 140.82.121.6:443`). Retry `gh` calls a few times before you conclude anything.
- Untracked scratch files in the worktrees are not part of any PR: `old-banner-spec.ts`, `test_flex.html`, `.ptah/specs/TASK_*` reports, lane `agent-output-*.md`, `pr-body.md`. Do not stage them; do not delete files you did not create.
- Do not merge with a failing check, and do not bypass checks or branch rules.
