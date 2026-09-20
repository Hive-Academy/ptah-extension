# Review response — PR #533 follow-up

Worktree: `D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents`
(branch `feat/tasks-page-agent-assign`). Nothing is committed; all changes sit
in the working tree.

## CI fix

The degradation audit failed with:

```text
libs/frontend/tasks-ui: 7 FAIL (baseline 3)
```

Four NEW `catch-return-sentinel` sites in
`libs/frontend/tasks-ui/src/lib/services/task-prompt-context.service.ts` are the
service's deliberate best-effort posture: a failed launch-time lookup omits its
own section and never blocks the launch. The behaviour is correct; the audit
just had no way to know it is intentional. Each catch now carries a
`// degradation-audit: optional-capability - <reason>` marker as the first
comment lines inside the catch body (the Zone-2 placement the checker's contract
allows), with a DISTINCT reason per site:

| Location | Catch                  | Reason recorded                                                                                                                                                                    |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| line 86  | `fetchCarrierSection`  | a `tasks:get` that throws drops only the carrier facts (status, type, estimate, workflow phase); the launch proceeds with the git and listing sections instead of failing.         |
| line 149 | `fetchGitSection`      | git facts (branch, working-tree state, a task-named worktree) only orient the receiving agent; the block ships without the git section rather than blocking the launch.            |
| line 180 | `fetchListingsSection` | the skills and commands listing only suggests capabilities the agent may use; the prompt still reaches the composer when it throws.                                                |
| line 218 | `safeCall`             | `rpc.call` resolves with a failure result rather than throwing; this guards only a stubbed or future-throwing provider, where null already means "section absent" to every caller. |

The baseline was not touched (no `--update-baseline`, no edit to
`tools/degradation-audit/baseline.json`). Audit line before and after:

```text
before: libs/frontend/tasks-ui: 7 FAIL (baseline 3)
after:  libs/frontend/tasks-ui: 3 ok (baseline 3)
```

`libs/backend/task-specs: 11 ok (baseline 12)` reads BELOW its baseline. The
ratchet is one-way: a directory's count may only go down or stay flat, so this
is permitted and was left alone.

## Findings

| ID         | File:line                                                                         | Verdict  | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4050008152 | `.ptah/specs/TASK_2026_471_c054/context.md:19`                                    | fixed    | The stack trace after "(`Ptah Electron-2026-09-18.log:1104`):" sat in a plain `fence, so it rendered as prose; it is now a`text fence.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4050008177 | `.ptah/specs/TASK_2026_471_c054/implementation-plan.md:21`                        | fixed    | All 18 `file:///D:/projects/ptah-extension/...` links were machine-local and dead on any other checkout; replaced with repo-relative `../../../...` links (anchors kept). Two of them pointed at `.agents/skills/orchestration/...`, which does not exist in this repository — corrected to the real `.claude/skills/orchestration/` paths.                                                                                                                                                                                                                                |
| 4050008182 | `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:573`      | fixed    | Verified first: the row's `(click)` handler (`onRowClick`, line 1018) emits `taskSelect` on a plain click, so a click on the "Assign to agent…" `<summary>` DID bubble up and open the task while toggling the menu. The summary now carries `(click)="$event.stopPropagation()"`, the same posture as every sibling action button. Regression test added in `task-list.component.spec.ts` ("toggles the agent menu without opening the task").                                                                                                                            |
| 4050008192 | `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:45`      | skipped  | `ClaudeRpcService.call` never rejects — its Promise executor only calls `resolve` (timeout, abort and response paths alike, `claude-rpc.service.ts:145-205`); failures arrive as an `RpcResult` with `success: false`, and each roster's `success` check guards it independently, so one method failing cannot wipe the other's entries. The `Promise.all` catch is documented future-proofing of a path that today cannot throw.                                                                                                                                          |
| 4050641287 | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:848`      | fixed    | Verified: a matching prefill stayed in the `composerPrefillRequest` signal forever, so a surface recreated for the same tab (a canvas tile removed and re-added) replayed the stale prompt over the current draft in its own constructor effect. `AppStateManager.clearComposerPrefill()` (new, mirroring `clearCanvasTabRequest`/`clearChatPromptRequest`) resets the request, and the effect consumes it after applying. Tests: `app-state.service.spec.ts` (clear resets to seq 0) and `chat-view.component.spec.ts` (apply-once-then-consume, plus the not-mine case). |
| 4050641300 | `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:74` | deferred | See `## Deferred`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4050641304 | `libs/frontend/tasks-ui/src/lib/services/task-prompt-context.service.ts:112`      | fixed    | `git:info` and `git:worktrees` were awaited back-to-back; `safeCall` waits out a full RPC timeout on a dead transport, so two dead calls stacked two timeouts while the launch's `busyTaskId` stayed set. Both now run in one `Promise.all`. Concurrency regression test added in `task-prompt-context.service.spec.ts` ("issues both git RPCs before either answers").                                                                                                                                                                                                    |

Out-of-scope check: `task-card.component.ts` was inspected for the same
`<details>/<summary>` bubbling pattern as 4050008182 — it uses a daisyui
dropdown `<button>` (already `stopPropagation`, line 441), not a disclosure
summary. No defect there; nothing touched.

## Deferred

**4050641300 — the bridge can prefill a composer for a tab that was not adopted as a tile.**

The rejection path is real: `CanvasStore.adoptTab(tabId)` returns `null` at the
tile cap (`MAX_TILES = 9`, `libs/frontend/canvas/src/lib/canvas.store.ts:219`),
and in grid layout the bridge fires `requestComposerPrefill(prompt, tabId)` for
the created tab at the same moment. When the cap rejects adoption, the prefill
targets a tab whose composer is not on screen (the canvas consuming effect in
`orchestra-canvas.component.ts:362-371` calls `clearCanvasTabRequest()` and
treats the cap case as "the tab simply stays in the tab list" — its own comment
calls it "the graceful fallback").

Why deferred rather than fixed:

1. The fix cannot stay contained to "the canvas store and this bridge". The
   signal that carries the request is `canvasTabRequest` on `AppStateManager`
   (`libs/frontend/core`), the adoption attempt and its rejection happen in the
   consuming effect inside `orchestra-canvas.component.ts` (the canvas lib's
   component, not the store), and the prefill is issued by the bridge
   (`libs/frontend/chat`). An honest fix needs the adoption result to travel
   back across all three — a request→response contract change spanning three
   libraries.
2. The canvas already documents the cap case as deliberate: the tab stays in
   the tab list and stays reachable. What the prefill should do instead (drop
   it? retarget the main panel? surface a notice that the tile cap blocked the
   launch surface?) is a design decision, not a mechanical repair, and the
   single-layout path (tabId `null`, main panel) — the common case — is already
   correct.

### Update — the cap is now 20, and the gap is still open

`MAX_CANVAS_TILES` went from 9 to 20 (`canvas-layout-intent.ts`) at the user's
direction, with more tiles planned. `MAX_COLUMNS` stays 3, so the grid grows
downward into more rows rather than wider.

State this plainly: **raising the cap does NOT fix finding 4050641300.** It
moves the threshold from the 10th tile to the 21st. A user at the new cap still
gets a prefill aimed at a tab no mounted tile owns, and still sees nothing. The
failure is that `adoptTab`'s refusal is never reported back to the caller — a
missing return path, not a number. The real fix is still the three-library
contract change described above.

What the raise buys is that the case becomes rare in practice. What it costs is
that it becomes rarer to notice, so the gap is now also recorded at the refusal
site itself (`orchestra-canvas.component.ts:360`) where a future reader meets
it.

Backward compatibility: a layout written with more than 9 tiles fails an older
client's Zod schema. That client reports `writable: false` and declines to
overwrite, so the record survives instead of being truncated.

## Verification

The lane left this section with the three commands listed and their output
fences EMPTY. It did not run them. The orchestrator ran every command below in
the foreground and reports the real results.

```text
$ npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts
  libs/frontend/tasks-ui: 3 ok (baseline 3)
  degradation-audit: TOTAL 302 unsuppressed site(s)
  exit code 0
```

`git diff tools/degradation-audit/` is empty, so the baseline was not touched.

```text
$ npx nx run-many -t test -p @ptah-extension/tasks-ui @ptah-extension/chat @ptah-extension/core
  core:     30 suites, 722 tests passed
  chat:     82 suites, 1313 passed, 2 skipped
  tasks-ui: 19 suites, 611 tests passed
  NX   Successfully ran target test for 3 projects
```

```text
$ npx nx run-many -t lint -p @ptah-extension/tasks-ui @ptah-extension/chat @ptah-extension/core
  0 errors (warnings are pre-existing: max-lines, non-null assertions)

$ npx nx run-many -t typecheck -p @ptah-extension/tasks-ui @ptah-extension/chat @ptah-extension/core
  NX   Successfully ran target typecheck for 3 projects
```

### Removed: the two `chat-view.component.spec.ts` tests

The lane added two tests for finding 4050641287 and never ran them. Both
FAILED. They call `fixture.detectChanges()`, which renders the template, and
this spec cannot render: its header states the template is deliberately not
rendered, and its stubs cover component logic only. Each flush surfaced one
more missing stub in turn — `visibleTabIds`, `pendingSessionLoad`,
`SessionLoaderService`, `activeTabViewMode`, `unmatchedPermissions`,
`questionRequests` — with no end in sight. Making this 80-test shared harness
render-capable is an open-ended change well outside a review-comment fix, and
the same wall stopped the Batch A lane earlier on this branch.

The spec was reverted to its committed state. The PRODUCTION fix stays.

**Coverage gap, stated plainly**: the consume call in
`chat-view.component.ts:850` has no test on the chat side. What is covered is
`AppStateManager.clearComposerPrefill()` resetting the request to `seq: 0`
(`app-state.service.spec.ts`), and the effect already ignores `seq === 0`. The
one added line is mechanical, but it is not pinned by a test.

## Risks

1. **Scope deviation, deliberate**: `libs/frontend/core/src/lib/services/app-state.service.ts`
   is not a file named in a finding, but the consume fix for 4050641287 required
   a `clearComposerPrefill()` on the service that owns the
   `_composerPrefillRequest` signal — mirroring the established
   `clearCanvasTabRequest` / `clearChatPromptRequest` consume pattern. The
   consuming side lives in `chat-view.component.ts`, a finding file. Its spec
   sibling was touched for the test.
2. ~~The two new `chat-view.component.spec.ts` tests render the template.~~
   They failed for exactly that reason and were removed. See
   `## Verification`. The consume fix ships without a chat-side test.
3. The suppression markers record intent, not enforcement. If one of the four
   catches later grows real failure handling, its marker becomes stale; the
   audit will still pass. Behaviour was not changed by any marker.
4. The rewritten links in `implementation-plan.md` assume the repository root as
   their base (`../../../`), which is correct wherever the repo is checked out
   but not if the document is copied elsewhere.

## Review round 2

| Finding ID | Verdict | Change                                                                                                                                                                                                                                                  |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4053502192 | fixed   | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:843-853` now tracks `chatInputRef`, keeps a matching prefill pending while the input is unavailable, restores the text once the input exists, and only then clears the request. |
| 4053502178 | fixed   | `.ptah/specs/TASK_2026_471_c054/implementation-plan.md:11-23,28,31,34,37,40` now has complete Markdown link destinations; the two orchestration labels now visibly match their real `.claude/skills/...` targets.                                       |
| 4053502184 | fixed   | `.ptah/specs/TASK_2026_471_c054/review-response.md:11,34,96,105,113` now labels each formerly untyped opening fence as `text`.                                                                                                                          |
| 4053502185 | fixed   | `.ptah/specs/TASK_2026_471_c054/review-response.md:62` now says “for a tab that was not adopted as a tile.”                                                                                                                                             |
| 4053502187 | fixed   | `.ptah/specs/TASK_2026_471_c054/review-response.md` ends with exactly one newline.                                                                                                                                                                      |

For 4053502192, the effect first reads the current composer request. For a
non-zero request it also reads the signal-based `chatInputRef` outside
`untracked`, so Angular reruns the effect when that view child becomes
available. The existing `SESSION_CONTEXT` predicate is unchanged: a concrete
request `tabId` must match the tile context, while `null` still targets only the
main panel. A matching request with no input returns without clearing; once the
input exists, `restoreContentToInput` runs and `clearComposerPrefill` follows.

**Coverage gap:** no chat-side regression test was added. This component spec
deliberately does not render its template, and exercising a signal-based
`viewChild` effect requires the prohibited `fixture.detectChanges()` or
`TestBed.flushEffects()` path in that harness. The production behavior is
covered by the required project test, typecheck, and lint commands below, but
the input-availability transition is not pinned by a focused unit test.

### Review round 2 verification

All commands ran in the foreground from the worktree root. Their real output
tails were:

```text
$ npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core
Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1313 passed, 1315 total
Snapshots:   0 total
Time:        28.928 s, estimated 33 s
Ran all test suites.

NX   Successfully ran target test for 2 projects

Nx read the output from the cache instead of running the command for 1 out of 2 tasks.
```

The same command's cached core task output reported `30 passed` suites and
`722 passed` tests.

```text
$ npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/core
> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

NX   Successfully ran target typecheck for 2 projects
```

```text
$ npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/core
✖ 17 problems (0 errors, 17 warnings)

NX   Successfully ran target lint for 2 projects

Nx read the output from the cache instead of running the command for 1 out of 2 tasks.
```

The same lint command's cached core task output reported `11 problems (0
errors, 11 warnings)`. The warnings are existing `max-lines`, unused-symbol,
non-null-assertion, and empty-function findings; this change introduced no lint
error.
