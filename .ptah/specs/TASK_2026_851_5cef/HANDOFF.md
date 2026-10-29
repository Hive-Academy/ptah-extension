# HANDOFF - TASK_2026_851_5cef

## Goal

Follow-ups to merged PR #842 (fix/claude-account-leases, named Claude account leases). Full request
text: `context.md` in this folder. BUGFIX, Partial depth, orchestration workflow. Electron first.

1. Linux PID namespace (`/proc/self/ns/pid`) in the `CURRENT_LEASE_HOST` machine digest. Unreadable
   namespace -> per-process random value (fail closed). win32/darwin unchanged.
2. Electron quit disposes named-account main-chat sessions (lease release) before SQLite closes,
   with a short deadline.
3. Crash recovery for `provider_account_operations` rows and `pending` profiles: record the host
   (migration 0062), reclaim only when the host is proved gone, restore the prior state.
4. Safe `normalizeAuthMethod` default (`claudeCli` with no key and a connected Claude login) and a
   refusal message that names the auth method setting.

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups`
- Branch: `fix/claude-account-followups`, base `origin/main` 3c70e573c
- Task folder: `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/.ptah/specs/TASK_2026_851_5cef`
- PR body file: `D:/projects/ptah-extension/.claude-worktrees/pr-851-body.md`

## Done

Commits on the branch (all hooks passed, worktree clean):

| Commit | Item |
|---|---|
| 53ab9075f fix(auth-providers): scope the lease host digest to the PID namespace | 1 |
| ba97d5f41 fix(auth-providers,persistence-sqlite): reclaim operations of dead hosts | 3 |
| c1c63276d fix(agent-sdk,electron): release named leases before quit closes SQLite | 2 |
| c50fb2cd2 fix(auth-providers,agent-sdk): default to the Claude login without a key | 4 |
| 24e5b86d1 docs(task-specs): record TASK_2026_851 review and decisions | task folder |

Note: commit 24e5b86d1 does not contain this HANDOFF.md, and `task.md` status is `in_review`.

Verification (combined, after the fix round):
`npm run verify -- -p auth-providers,persistence-sqlite,@ptah-extension/agent-sdk,ptah-electron -- --output-style=static`

- typecheck: all 4 pass
- tests: persistence-sqlite 667, agent-sdk 4246, ptah-electron 1340 pass. auth-providers 2471 pass,
  5 fail, all in `translation-proxy.sdk.integration.spec.ts` (known, also fails on main).
- lint: only known failures (auth-providers `@nx/dependency-checks`; persistence-sqlite errors in
  unchanged 0057/0058 files and `sqlite-connection.service.spec.ts`).
- Degradation audit: no baseline raised.

Review: Codex CLI lane (different family from the Claude implementers).
- `code-logic-review.md`: NEEDS_REVISION 4/10 (1 Blocking, 2 Serious, 3 Moderate).
- One fix round (`fix-report-a/b/c.md`).
- `code-logic-re-review.md`: REVISE 5/10. Defects 2, 3, 4, 6 closed. Revise cap reached.
- Decisions: `decisions.md` rows 1-11.

## In progress at handoff

- Background command: `git push -u origin fix/claude-account-followups` then
  `gh pr create --base main --title "fix(auth-providers,agent-sdk): named account lease follow-ups"
  --body-file ../pr-851-body.md`. Its result is in the final status line below. If no PR exists,
  run those commands again from the worktree.

## Open problems (disclosed in the PR body, not fixed)

1. **Console pid window (reviewer: Blocking, kept as a residual).** The host can crash after the
   sign-in console spawns and before `recordOperationChild` writes its pid. A crash during the kill
   after a failed write has the same effect. In both cases `child_pid` is NULL, and reclaim can run
   while the console is still open. Run leases have the same window. A full fix needs a persisted
   "child unknown" state, plus a way out of `pending` (for example a user cancel that kills the
   console by name, or a timeout). Files: `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
   (~394-428, 613-637), `provider-account.store.ts` (~698-740), `provider-account-host.ts` (`leaseOwnerGone`).
2. The 60 s cache in `ClaudeAmbientLoginStatusReader` (`accounts/claude-ambient-login-status.ts`)
   can choose the old method for up to one minute after a sign-in or sign-out (defect 5).
3. A SecretStorage rejection in `createAuthCredentialProbe` (`auth/active-provider-resolver.ts:41-49`)
   stops the `claudeCli` default. This is not a regression.
4. `reclaimAbandonedOperations` calls listeners after commit without isolation
   (`provider-account.store.ts:708-711`). A throwing listener makes `list()` fail after a correct restore.
5. Profiles left `pending` by crashes before migration 0062 have no host, so they need manual recovery.

These are candidates for one follow-up task. The user decides if they want it.

## Key files

- `libs/backend/auth-providers/src/lib/accounts/provider-account-host.ts` (+spec): `computeLeaseMachine`
- `libs/backend/persistence-sqlite/src/lib/migrations/0062_provider_account_operation_host.ts` (+spec), `index.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`, `provider-account-actions.service.ts`, `provider-account.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.ts`, `session-query-executor.service.ts`, `session-lifecycle-manager.ts`
- `apps/ptah-electron/src/activation/shutdown.ts` (`CHAT_SESSION_DISPOSE_BUDGET_MS`), `boot-coordinator.ts`, `wire-runtime.ts`
- `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts` (`resolveActiveAuthWithDefault`), `auth-manager.ts`, `workspace-provider-profile-resolver.ts`, `auth-method.utils.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

## Next steps

1. Go to the worktree. Run `gh pr view fix/claude-account-followups --json url,headRefOid,state`.
   If no PR exists, run the push and `gh pr create` commands above. Run them in the background, because the pre-push
   hook is slow. If the pre-push hook fails, fix the cause in a new commit and push again.
2. Commit this HANDOFF.md:
   `git add .ptah/specs/TASK_2026_851_5cef/HANDOFF.md` and
   `git commit -m "docs(task-specs): add TASK_2026_851 handoff"`. Then push.
3. Watch CI: `gh pr checks <PR> --watch` (background). On a failure: `gh run view <run-id> --log-failed | tail -80`.
4. Read the reviews: `gh pr view <PR> --comments` and
   `gh api repos/Hive-Academy/ptah-extension/pulls/<PR>/comments`. Fix confirmed task defects in new
   commits. Explain any disputed finding in a reply.
5. Verify the fixes only with `npm run verify -- -p <changed projects>`. Use one foreground run and
   filtered output. Never run workspace-wide checks, build, serve, e2e or package. Inside a `.catch()`, call the logger
   directly. Do not raise degradation-audit baselines.
6. Report the PR URL, the head, the CI and review state, and the open problems above. Do not merge.
   Do not remove the worktree or the branch until the user says to.

## Status at handoff

- Push succeeded (pre-push hook passed). PR opened: https://github.com/Hive-Academy/ptah-extension/pull/843
  (head 24e5b86d1). Step 1 is therefore done. Start at step 2.
- CI and reviews: not yet checked. Nobody watches them now.
- No subagent or CLI lane is running. This HANDOFF.md is not committed yet (step 2).
