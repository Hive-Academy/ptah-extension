# Task context block — Batch C report

TASK_2026_471_c054, batch C. The Tasks board stops owning task status, and the
Start prompt carries a deterministic context block.

## What changed

- `libs\frontend\tasks-ui\src\lib\services\task-start.service.ts` — deleted the
  30-second resolve guard (`RESOLVE_GUARD_TIMEOUT_MS`, the `setTimeout`, the
  `settled` flag and the hand-rolled settle wrapper). `launchPrompt`
  (task-start.service.ts:111) now awaits the bridge resolve with no timer. The
  `resolve` callback is kept: a tab-creation throw inside the bridge still
  reaches the error banner.
- `libs\frontend\tasks-ui\src\lib\services\task-start.service.ts` — deleted
  `await this.store.updateStatus(taskId, 'in_progress')` and the whole
  `TasksStore` injection and import; no dead dependency stays. The class doc
  (task-start.service.ts:33) states what the service does now — build the
  prompt, publish it for the composer, surface a launch error — and states
  explicitly that the AGENT owns the status transition, so no reader restores
  the write as a "missing feature".
- `libs\frontend\tasks-ui\src\lib\services\task-start.service.ts` —
  `buildPrompt` (task-start.service.ts:130) is now async and appends the
  context block LAST: body, then the isolation directive when `isolate` is
  true, then the context block. The three pinned prompt shapes moved to
  `buildPromptBody` (task-start.service.ts:141) UNCHANGED, character for
  character.
- `libs\frontend\tasks-ui\src\lib\services\task-prompt-context.service.ts`
  (NEW) — `TaskPromptContextService.buildContextBlock`
  (task-prompt-context.service.ts:52) gathers four fact sources over
  `ClaudeRpcService`, three fetchers in one `Promise.all`
  (task-prompt-context.service.ts:54):
  - carrier facts + phase (task-prompt-context.service.ts:65): one `tasks:get`
    result gives status, type and estimate (an absent estimate is ordinary —
    the segment is omitted, never a placeholder), and the phase line derives
    from the SAME result's `artifacts` against `WORKFLOW_ARTIFACTS`
    (task-prompt-context.service.ts:96) — which workflow documents exist and
    which stage is the furthest reached;
  - git (task-prompt-context.service.ts:108): `git:info` for branch and
    working-tree state (honoring `statusUnavailable`, so an empty `files` list
    is not read as clean when the status could not be read) and
    `git:worktrees` for any worktree whose path or branch names the task id;
  - skills and commands (task-prompt-context.service.ts:151): one
    `autocomplete:commands` scan, grouped by the required `source` field —
    `skill` entries under `### Skills`, `command` entries under
    `### Commands` (task-prompt-context.service.ts:177), builtins dropped.
    Live listing at launch time, never hard-coded.
  - Failure posture: every call is wrapped (`safeCall`,
    task-prompt-context.service.ts:194, plus a per-section catch), so a failed
    or empty source omits ITS OWN section and nothing else; the service never
    throws and never blocks a launch. No model call and no delegation
    instruction anywhere in the path. No `*.md` filename is hand-written —
    the CI ratchet holds. Workspace scoping copies the `TasksStore`
    convention (task-prompt-context.service.ts:211): the active root or
    omitted, never `''`.
- `libs\frontend\tasks-ui\src\lib\services\task-start.service.spec.ts` —
  deleted the 30s resolve-guard test; replaced both `updateStatus` assertions
  with `expect(updateStatus).not.toHaveBeenCalled()` (the AGENT owns the
  transition; the `TasksStore` stub provider stays as the regression pin, with
  a comment saying why). The old blanket `expect(rpcCall).not.toHaveBeenCalled()`
  F-D1 guard no longer holds — the context block legitimately reads RPCs — so
  it is narrowed to what F-D1 actually pins:
  `not.toHaveBeenCalledWith('git:addWorktree', ...)` plus a
  `tasks:updateMetadata` absence pin. Prompt tests now flush the microtask
  queue (16 ticks) because `buildPrompt` awaits RPCs. The exact-equality
  prompt assertions STILL HOLD UNCHANGED: with the default failing RPC stub
  the context block comes back `''`, so `toBe` needed no `toContain`
  downgrade. One new wiring test drives the four real RPC names and pins the
  block's position — after the body, and after the isolation directive when
  isolated.
- `libs\frontend\tasks-ui\src\lib\services\task-prompt-context.service.spec.ts`
  (NEW) — covers all four sources in one block; each source failing alone
  (`tasks:get`, `git:info`, `git:worktrees`, `autocomplete:commands`) and
  omitting only its own contribution (`git:info` and `git:worktrees` are
  separate calls, so a failed `git:info` keeps the worktree fact and a failed
  `git:worktrees` keeps the branch facts); every source failing and a
  REJECTING RPC layer both yielding `''`, not a throw; grouping by `source`
  with builtins dropped; absent estimate/type omitted without a placeholder;
  and the workspace-root parameter convention.
- `libs\frontend\tasks-ui\CLAUDE.md` — added guideline 10: Start PREFILLS the
  composer and never sends, and the agent owns the status transition.

## Context block

Real rendered example for THIS task, `TASK_2026_471_c054`, from this worktree
at the time of writing. Carrier facts come from `task.md` (status
`in_review`, type `FEATURE`, estimate `M`), the phase line from the document
set actually in the folder (`context.md`, `implementation-plan.md`,
`batches.md`, `code-logic-review.md` — labels derived from `DOC_FILES`, never
hand-written), and the git facts from this branch's real state (16 changed
files). No `Worktree for this task` line appears: neither the worktree path
nor its branch names the task id — an honest omission, exactly what the
service would print today. The skill and command descriptions below are the
real frontmatter descriptions, abridged to one line.

Appended to `/orchestrate TASK_2026_471_c054`, this is what the composer would
hold:

```markdown
/orchestrate TASK_2026_471_c054

## Task context

Status: In Review · Type: FEATURE · Estimate: Medium
Workflow documents present: Context, Implementation Plan, Batches, Code Logic Review. Furthest stage reached: Code Logic Review.

### Git

Branch: feat/tasks-page-agent-assign.
Working tree: dirty (16 changed files).

### Skills

- agent-lanes — Contract for spawning, resuming and messaging background CLI agent lanes via the ptah*agent*\* tools. Load before any ptah_agent_spawn, or when orchestration or tribunal refers here.

### Commands

- review-code — Code quality review — Phase 1 of triple review protocol. Adapts to detected tech stack with best practices (40% weight).
```

(The full live listing names every skill and command the workspace ships; two
entries are shown here to keep the example readable.)

## Verification

Commands run in the foreground, from the worktree root.

- `npx nx run-many -t test -p @ptah-extension/tasks-ui`
- `npx nx run-many -t typecheck -p @ptah-extension/tasks-ui`

Run history, reported honestly:

1. First test run FAILED: `Test Suites: 1 failed, 18 passed; Tests: 10
failed` — all in the new `task-prompt-context.service.spec.ts`. Two
   defects in the new spec, both mine: a one-token syntax error (a stray `)`
   in the `results` fixture closing — `});` where `};` belonged, which
   detached the tests from the describe), and one wrong expectation (the
   failed-`git:info` test asserted the whole `### Git` section disappears;
   the batch's per-call best-effort posture keeps the worktree fact, so the
   test now pins only the branch and working-tree lines gone).
2. Second run after the syntax fix: `1 failed, 18 passed` — only the wrong
   `git:info` expectation.
3. Final runs, verbatim tails below.

The header the command actually prints is `Running target test for project
@ptah-extension/tasks-ui:` — singular "project", not the `for 1 projects`
wording this batch predicted. One project did run; only the wording differs.

```
$ npx nx run-many -t test -p @ptah-extension/tasks-ui

 NX  Running target test for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:test

Test Suites: 19 passed, 19 total
Tests:       609 passed, 609 total
Snapshots:   0 total
Time:        20.679 s
Ran all test suites


 NX  Successfully ran target test for project @ptah-extension/tasks-ui
```

```
$ npx nx run-many -t typecheck -p @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:typecheck

> npx ngc --noEmit --project libs/frontend/tasks-ui/tsconfig.lib.json


 NX  Successfully ran target typecheck for project @ptah-extension/tasks-ui
```

A `git status` check confirms no stray artifacts: the `.tmp-tsc/` debug
directory from the syntax hunt is deleted.

## Risks

- **No timer on the bridge await.** With the 30-second guard gone, a bridge
  that publishes the request but never settles `resolve` leaves `start()`
  pending and `busyTaskId` latched, so further Start clicks no-op until the
  view resets. The consumer (`TaskPromptBridgeService`) is root-provided and
  settles `resolve` from its `finally` on every path including a caught
  throw, so the only stall is a bridge that never consumes the signal at all
  — a composition-root defect, not a launch-flow one.
- **Context adds launch latency.** `buildPrompt` now awaits three fetchers in
  one `Promise.all`; worst case one RPC timeout window (30 s), not three
  stacked. On a healthy host the calls are local and the block renders in
  well under a second.
- **Status pin depends on the stub.** The `updateStatus` absence pin can only
  fire if a future change re-injects `TasksStore`; the guideline and the
  class doc say the same thing in prose, so the intent is documented in three
  places.
- **`autocomplete:commands` budget is 200.** A workspace with more than 200
  merged entries silently truncates the listings. The facade uses 100; 200
  halves the truncation risk without changing the call shape.
