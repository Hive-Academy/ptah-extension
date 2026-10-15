# R9e fix report

## Fixes

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:669,733-742,765-787,815-827,1266-1280`: `SESSION_CONTEXT` now keeps a null or empty session ID scoped. The panel returns no CLI agents, workflow or session subagents, retained selected subagents, or permissions for an unresolved scoped host. Clear completed returns before any global clear. Hosts without `SESSION_CONTEXT` retain their tolerant main-panel behavior.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.scope.spec.ts:106-154,184-202,224-276`: added scoped null coverage for foreign and unowned records, active-selector avoidance, terminal selection and global-clear avoidance; corrected global cases to remove `SESSION_CONTEXT`; retained empty-string coverage; added a `SESSION_CARD_ACTIONS`-only tolerant host case.
- The prior R9e dock state and component specs remain as written. Their pin, close and per-tab cases were rerun. Width restoration in ChatView belongs to R9h, as the review notes.

## Spec results

Each command ran from the worktree through the lock runner, sequentially:

- `node .ptah/tmp/check-run.mjs fix-R9e -- npx nx test @ptah-extension/chat --testFile=agent-monitor-panel.scope.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 17 passed.
- `node .ptah/tmp/check-run.mjs fix-R9e -- npx nx test @ptah-extension/chat --testFile=display-dock.state.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 26 passed.
- `node .ptah/tmp/check-run.mjs fix-R9e -- npx nx test @ptah-extension/chat --testFile=display-dock.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 22 passed. This passing run printed a `this.store.agents is not a function` console error from its mock.

`ptah_get_diagnostics` reported no errors in the two edited files. It reported 262 errors in sibling chat files. No broad typecheck or lint was run, per the fix instructions.

## Decisions

- Scope is defined by `SESSION_CONTEXT` presence, never by a non-null session ID or `SESSION_CARD_ACTIONS`.
- A scoped unresolved session owns no agent records and cannot clear completed agents globally. The no-token main panel remains tolerant for both null and resolved session IDs.
- The duplicated owner equality rule stays in place as instructed. The ChatView dock badge, running count and auto-open issue is left to R9h; no ChatView file was changed.
