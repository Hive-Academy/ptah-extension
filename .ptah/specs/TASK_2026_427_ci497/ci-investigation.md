# CI investigation — pull request #497 (three failing jobs)

Date: 2026-09-12. Worktree: `.claude-worktrees/agent-messaging`, branch `feat/agent-two-way-messaging`.

## Preface: worktree state did not match the task brief

The task brief claimed the CI commit was `3e09e38551d9c3fa8794553b463d1feefc739593`
and that the worktree was behind the pull request head. Both claims are false.

- `git fetch origin` found no commit `3e09e3855` anywhere in the repository.
- `gh pr view 497` reports the head is `69c03977fac39ef6e921aac7a834376cd3845053`,
  which equals the local HEAD. The base `630be28d88064fb81088407708e40ed712692ce7`
  matches. The worktree is current.
- The worktree holds uncommitted work from another session (a peer-sessions
  work-in-progress under `libs/backend/agent-sdk/src/lib/peer-sessions/` plus
  modified `agent-sdk`, `rpc-handlers`, `vscode-core`, and `shared` files, and
  three `tmp-*.log` files). This investigation did not touch any of those
  files. They are untouched.

All three failures were investigated at the real pull request head `69c03977f`.

---

## Failure 1 — job `check`: content-manifest.json drift

### Root cause

Branch commit `b521a92ba` ("docs(vscode-lm-tools): retire agent_steer from the
harness text and docs") changed three plugin skill reference files without
regenerating `content-manifest.json`:

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/agent-cli.md`
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/internal-mcp.md`
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/mcp-serve.md`

`git diff 630be28d..HEAD` over both manifest-covered trees shows exactly these
three modified files and nothing else.

### Caused by pull request #497?

Yes. The three files were edited by a commit on this branch.

### What changed

`npm run manifest:generate` was run. The diff to `content-manifest.json` is
exactly two lines: `contentHash` and `generatedAt`.

**No entries dropped.** File lists are identical before and after: 203 plugin
files and 20 template files (223 total). Nothing was removed, so
`ContentDownloadService` will prune nothing.

The regenerated hash `sha256:502d5c0745e406f7213ac331b9094732374d555bd7de7a165b671f7943992b93`
matches the "actual" hash from the CI failure output exactly, which confirms the
regeneration is byte-equivalent to what CI computed.

### Verification

- `npm run manifest:check` → PASS ("content-manifest.json is up to date,
  sha256:502d5c07…, 223 files").
- `npm run manifest:self-test` → PASS (all five assertions).

### Remains

`content-manifest.json` is modified in the working tree and must be committed
with the pull request. No commit was created per the task rules.

---

## Failure 2 — job `main`, step `degradation-audit`

### The exact exit condition

`tools/degradation-audit/check-degradation.ts`, function `runLint`
(line 823): the run sets `failed = true` only when a directory's unsuppressed
site count is **greater than** its baseline (`count > base`). Improvements
(`count < base`) and stale entries (directory absent) both print `ok` and never
set `failed`. Verified against the real CI log, not the task brief's summary:
the run failed on

```
libs/backend/agent-sdk: 5 FAIL (baseline 4)
```

This line exists in the actual CI log of run 34698254830. The task brief's
transcript omitted it.

### The two "anomalies" are not failures

- `libs/frontend/chat: 11 ok (baseline 12)` — fewer swallowed-failure sites
  than the baseline. An improvement. Prints `ok`. Does not fail the run.
- `libs/frontend/editor: 0 ok (baseline 2) — directory not found by this scan` —
  the baseline entry is stale. Prints `ok` with a note. Does not fail the run.

So the answer to the brief's question: **the tool does not fail when code gets
better, and does not fail when a baseline entry is stale.** It fails only when a
count rises above the baseline. The design flaw the brief hypothesized does not
exist.

### Root cause of the actual failure

Branch commit `7b7829cbf` ("feat(agent-sdk): give a session the name its user
chose, on both surfaces") added
`libs/backend/agent-sdk/src/lib/helpers/session-title.service.ts`. Its
`retitle()` catch block (line 80) logs at `warn` and returns `false`. The audit
tool recognizes only `.error(...)` as a handled report, so the site counted as a
new `catch-return-sentinel`. Agent-sdk rose from 4 sites to 5, over its
baseline of 4, and the ratchet failed — correctly.

**Caused by pull request #497: yes.**

### Control measurement at the base commit

A temporary git worktree was created at base `630be28d` inside this directory
and the audit was run there, then the worktree was removed.

**Control result: the audit PASSES at the base (exit 0).** Key lines:

```
libs/backend/agent-sdk: 4 ok (baseline 4)
libs/frontend/chat: 11 ok (baseline 12)
libs/frontend/editor: 0 ok (baseline 2) — directory not found by this scan; run --update-baseline to prune
TOTAL 304 unsuppressed site(s)
```

Both "anomalies" — the chat improvement and the stale editor entry — already
exist at the base commit and do not fail the run there. The editor library was
deleted on `main` by commit `05e725865`, before the base. The chat improvement
also predates this branch. Neither is caused by pull request #497, and neither
needs a fix on this branch for the check to pass.

### What changed

A suppression comment was added inside the catch block of
`session-title.service.ts`, using the tool's documented mechanism. The site is
deliberate and documented in the file header ("Every failure is logged and
swallowed. A title is a convenience…"), and the catch does report the failure at
`warn` level, so the suppression kind is `reported`:

```ts
} catch (error: unknown) {
  // degradation-audit: reported - the failure is logged at warn below and
  // retitle() returns false by contract; a session title is a convenience,
  // and Ptah's own metadata rename has already succeeded by this point.
  this.logger.warn(
```

Note: raising the baseline was not an option — `--update-baseline` only lowers
counts or prunes stale entries; it cannot raise a number. The suppression
comment is the tool's one intended path for a new, justified site.

### Verification

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  → exit 0. `libs/backend/agent-sdk: 4 ok (baseline 4)`, TOTAL 304.
- Self-test: 12 fixture violations detected, exit code 1 — the expected pass
  condition per `run-self-test.js` (CI's `degradation-audit:self-test` target).

### Ratchet recommendation

How the ratchet should behave, with reasoning:

1. **Count rises above baseline** — must fail. This is a real regression: a new
   swallowed failure entered the codebase. The tool does this today and this
   investigation confirms the behavior is correct: it caught a real new site
   added by this pull request.
2. **Count falls below baseline** — should not fail. The tool is correct: it
   prints `ok` and keeps the old baseline. Auto-tightening on every run would
   be reasonable but has a cost: a detector change (not a code improvement) can
   lower counts silently, and a lowered baseline makes an honest re-check
   impossible later. The current "surface it, tighten via --update-baseline"
   design is sound. Fail-on-improvement would train people to run
   `--update-baseline` reflexively, which destroys the ratchet. That failure
   mode does **not** exist here.
3. **Baselined directory no longer exists** — should not fail the build; the
   entry is stale, not a regression. The tool is correct: it prints a note and
   points at `--update-baseline`. Auto-pruning would be more convenient but
   would let a directory rename (not a deletion) silently delete its ratchet.
   Surfaced-not-pruned is the honest choice.

Housekeeping that belongs on `main`, not in this pull request: run
`--update-baseline` once to prune `libs/frontend/editor` and tighten
`libs/frontend/chat` from 12 to 11. Left untouched here because it changes
shared ratchet state for improvements this pull request did not make.

---

## Failure 3 — job `electron-e2e`: one Playwright spec

Failing test: `src/specs/canvas/canvas.spec.ts:132:7 — Canvas › real Gridstack
drag keeps an explicit 2+1 row through resize and workspace switch`
(1 failed, 8 skipped, 166 passed, 7.4m). Error: `TimeoutError:
locator.getAttribute: Timeout 30000ms exceeded`.

### Verdict: pre-existing flake. Not caused by pull request #497.

Evidence:

1. **The branch touches no canvas code.** `git diff --name-only 630be28d..HEAD`
   filtered for `canvas|gridstack|electron|dashboard|shell` returns zero
   matches.
2. **The same code passed and failed on this branch with only a docs commit
   between.** Electron E2E PASSED at `7b7829cbf` (run 34696450484) and FAILED
   at `69c03977f` (run 34698254796). The only commit between them
   (`69c03977f`, "docs(specs): answer Batch 10.1") changed two markdown files
   under `.ptah/specs/`. Identical code, different outcome.
3. **The same test failed alone on an unrelated branch.** On
   `fix/codex-context-efficiency` (2026-09-10, run 34512814613) the identical
   test (then at line 129, before a spec edit shifted the line number) failed
   alone — 1 failed, 166 passed — with a 30 s predicate timeout.
4. **The branch also failed it earlier the same day.** Run 34693326482 at
   `213dcdc13` failed the same test.
5. **The test is timing-dependent by construction.** It performs real mouse
   drags with `steps`, viewport resizes awaited through `expect.poll` on layout
   metrics, and workspace switches; one locator is
   `ptah-canvas-workspace-grid:visible`, whose visibility can change mid-poll
   when a workspace switch hides the grid. A `locator.getAttribute` on it can
   legitimately stall for the full 30 s expect timeout.

Not all failing Electron E2E runs are this flake — `fix/task-411-profile-performance`
runs failed many specs (a broken branch), and `fix/git-review-controls` failed
`agent-file-links.spec.ts:123`. Those are separate causes on separate branches.

### What changed

Nothing. Per the task rules, the test was not weakened, skipped, or
retry-wrapped.

### Remains / recommendation

1. Re-run the Electron E2E job on this pull request. The pass at `7b7829cbf`
   shows the suite passes on this branch's code.
2. Fix the flake in a dedicated task on `main`. Start from the CI
   error-context artifact
   (`dist/apps/ptah-electron-e2e/test-results/canvas-canvas-Canvas-real--…-resize-and-workspace-switch/error-context.md`)
   to pin which `getAttribute` call stalled, then make the poll target
   resilient to the grid's transient hidden state, or await an explicit
   post-switch settled state before reading geometry. Do not add a blanket
   retry.

---

## Files modified

1. `content-manifest.json` — regenerated (hash + timestamp only; no entry
   added or dropped). Fails check before, passes after.
2. `libs/backend/agent-sdk/src/lib/helpers/session-title.service.ts` — added a
   `degradation-audit: reported` suppression comment inside the `retitle()`
   catch block. No behavior change.
3. `.ptah/specs/TASK_2026_427_ci497/ci-investigation.md` — this report.
4. `.ptah/specs/TASK_2026_427_ci497/task.md` — task carrier so the folder is
   visible on the Tasks board.

No git commit was created. No push was made. No `project.json` was edited. No
`nx reset` was run. The uncommitted work-in-progress from another session is
untouched.

## Check status

| Check | Passes locally | Command |
|---|---|---|
| Content manifest check | Yes | `npm run manifest:check` |
| Content manifest self-test | Yes | `npm run manifest:self-test` |
| degradation-audit lint | Yes (exit 0) | `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` |
| degradation-audit self-test | Yes (exit 1 = expected pass) | `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --self-test` |
| Electron E2E canvas spec | Not re-run locally — verdict: pre-existing flake; recommend CI re-run | — |