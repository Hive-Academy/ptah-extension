# HANDOFF - TASK_2026_593_7c2e Attention-first notifications (snackbars, OS notifications, bell)

Written 2026-10-20 by orchestrator session `notification-final` (continued the earlier
`task-593-702` handoff). Sibling task: TASK_2026_702_594d (Chat start screen), handoff at
`D:/projects/ptah-extension/.claude-worktrees/chat-needs-you-removal/.ptah/specs/TASK_2026_702_594d/HANDOFF.md`.

## Goal

Show only things that need the user (permission requests, ask-user questions, failures) in small
snackbars, a bell with Needs you / Recent, and OS / VS Code host notifications; Clear all; no
"Finished" notifications. Host notifications always include the session title (decision #21).

## Where

- Task folder `.ptah/specs/TASK_2026_593_7c2e/` (decisions #1-#47).
- PR #780 MERGED (phases A + B).
- **PR #783 OPEN** https://github.com/Hive-Academy/ptah-extension/pull/783 (A8 + phase C), branch
  `feat/attention-phase-c`, worktree `D:/projects/ptah-extension/.claude-worktrees/attention-notifications`
  (node_modules junction). Head `1666f93a6`.
- Extra worktree `.claude-worktrees/attention-pr780` (merged branch). Remove only when the user says.

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| CI diagnosis | `checks` + `webview-e2e` failed: initial webview bundle 4.14 MB > 4.00 MB budget (main 3.75 MB). Cause: `app.config.ts` statically imported the root barrels of `@ptah-extension/mcp-apps-page` (AppsFocusRouter -> 700-line AppsSessionService, AppsPageComponent) and `@ptah-extension/git-ui` (ReviewShellComponent); both lazy-only on main | job logs |
| Bundle fix | codex lane: new light entry `@ptah-extension/mcp-apps-page/focus` (`src/focus.ts`, tsconfig path), `AppsFocusTarget` holder that AppsSessionService registers into, router reads the holder; `provideGitStatusAttention` moved to `@ptah-extension/git-ui/services`; one `checkDynamicDependenciesExceptions` entry in `eslint.config.mjs`; registration spec added | `lane-bundle-fix.md`, commit `a8c623238` |
| Review | Anthropic code-logic review APPROVED 8/10; its one Moderate item (registration test) fixed | `code-logic-review-bundle-fix.md`, commit `1666f93a6` |
| Local checks | `mcp-apps-page` + `git-ui` typecheck/lint/test pass; `ptah-extension-webview` typecheck pass | this session |
| CI after push | **`webview-e2e` PASS** (budget fixed). New failures below | `gh pr checks 783` |
| CodeRabbit | no review on #783: free OSS review limit reached | PR comments |

## Electron visual check (first run done, incomplete)

Codex lane `090f2f52` (role visual-reviewer) built `ptah-electron`, launched it isolated on port
9347 (temp dirs removed, port free; "Electron: free" + "checks: free" sent to peers). Result
`visual-review.md`: **REVISE 5/10**. Script `visual-check/shoot.cjs`, `capture-results.json`, and
4 real PNGs (dark/light baseline, dark/light empty panel; PNG is git-ignored). Not yet viewed by
the orchestrator or shown to the user.

1. **Serious:** empty bell panel shows two empty section messages + a disabled Clear all beside
   Recent; the prototype shows one centered "All clear" state and a header "Clear all notices"
   (`libs/frontend/notification-center/src/lib/notification-center.component.ts:43-92`). Check
   against `design-spec.md` / decisions before fixing (it may be an approved deviation).
2. **Moderate:** panel is 320px (`w-80`, same file `:40`); prototype says 340px (lane-proposed rule).
3. **Coverage gap:** no populated state could be captured (permission, question, lane, stack,
   failure, badge, populated panel, git warning, 800px): the isolated profile has no live events,
   and the production renderer exposes no `window.ng` to inject items. The next run needs a way to
   inject attention items without production changes, e.g. faked main-process RPC/push messages
   through the Playwright `_electron` harness (`apps/ptah-electron-e2e/` has RPC fakes), or a
   dev-mode renderer build where `window.ng` exists. Snackbar width (348px), actions,
   provider/tool context and Clear all with items remain unverified.

## Open problems (CI on #783 at handoff: 2 fail, 9 pass, 5 pending incl. `checks`)

1. **`test (shard 3/4)`**: `apps/ptah-extension-webview/src/app/review-shell-message-handlers.spec.ts:91`
   "imports both from the services-only entry, never the main git-ui barrel" reads the FIRST
   `from '@ptah-extension/git-ui/services'` import in `app.config.ts`; the bundle fix added a
   second, separate import for `provideGitStatusAttention`. Likely fix: merge
   `provideGitStatusAttention` into the existing `@ptah-extension/git-ui/services` import block in
   `apps/ptah-extension-webview/src/app/app.config.ts` (one import statement). Verify the spec.
2. **`electron-e2e (shard 1/4)`**: `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts:370`
   "stale cursor hides the button and tells the user to reopen the session" fails at line 383
   (`tile.getByRole('alert')` with /reopen the session/ not found). Phase C (C1) moved ActionBanner
   failures to attention, so this may be a real regression: check whether the stale-cursor
   message still renders inline in the tile or now only goes to the bell; then fix the code or
   update the e2e per decisions (do not weaken the user-visible message). Job log:
   `gh api repos/Hive-Academy/ptah-extension/actions/jobs/118412064040/logs`.
3. Fix 1 + 2 with ONE bounded codex lane, independent Anthropic code-logic review, scoped checks,
   commit, push; then re-watch CI (`checks` was still in progress at handoff).

## Next steps after CI is green

1. Visual check (above): view the 4 PNGs next to the prototype and show them to the user; settle
   defects 1-2 (fix with one codex lane + review, or record as approved deviation); plan a second
   run that injects populated states, then compare dark + light with the prototype.
2. Propose the deferred later tasks to the user (decision #44, carry-forward #37): M4 git warning
   cannot clear while the git dock is closed, and a first-read failure without last-good data
   raises no warning (accepted limit #43); M6 stable voice key per direction; M7 ActionBanner API
   cleanup + dedupe; M8 Open routability computed at projection time; M9 wizard/harness Open
   disabled for another workspace (confirm against #30); X2 no `isReplayMessage` guard on the
   result branch (`sdk-message-transformer.ts`); Minors in `code-logic-review.md`; bundle-fix
   review minors (holder is last-writer-wins without unregister).
3. This HANDOFF.md, `visual-review.md` and `visual-check/` (script + JSON) were committed and
   pushed at the end of the `notification-final` session; check `git log -1`.
4. No local-only branch at the end.

Scoped re-check commands (from the worktree, one heavy job at a time on the machine):

```bash
npx nx run-many -t typecheck,lint,test -p @ptah-extension/mcp-apps-page @ptah-extension/git-ui --parallel=1
npx nx typecheck ptah-extension-webview
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/review-shell-message-handlers.spec.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -2   # must stay <= 291
```

Full phase C scope if needed: `npx nx run-many -t typecheck,lint,test -p @ptah-extension/core
@ptah-extension/chat @ptah-extension/git-ui @ptah-extension/setup-wizard
@ptah-extension/harness-builder @ptah-extension/mcp-apps-page @ptah-extension/agent-sdk --parallel=1`.
The bundle budget can only be measured by CI (`webview-e2e`); no local build unless the user asks.

## Standing user rules

Orchestration + agent-lanes skills; the user said "fix with our cli tools": codex CLI lanes
implement (`ptah_agent_list` before every spawn, never AT LIMIT, max 3, parallel lanes run no
nx/jest); Anthropic subagents do code-logic reviews; memory-safe scoped checks only; one heavy job
at a time on the machine (coordinate with ListAgents/SendMessage, "checks: free" hand-offs);
announce Electron launches and send "Electron: free" after; never `text-base-content/NN`; audit
must not rise (291); commit foreground with hooks, push background; no `--no-verify`; never edit
`orchestra-canvas.component.ts` from this task; `BackOfficeActivityService` public API stays. The
user accepts pushing without a full local re-run and letting CI check. Do not waste tokens
waiting on lanes: the completion signal wakes the session. Codex weekly 65% at handoff
(resets 2026-10-24 20:40 UTC).
