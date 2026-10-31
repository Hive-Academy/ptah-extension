# Batch 3 Fix Report — Round 1

## Changes

- `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:805` now clears `sessionNotice` synchronously whenever the session effect runs. The clear occurs before the null-session return and before each new `plugins:get-config` RPC. The existing `sessionNoticeRequestId` stale-reply guard remains unchanged.
- `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts:603` adds a regression spec for a resolved session A notice, a switch to session B with a pending RPC, and the later session B result.
- Created `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/.ptah/specs/FIX_PLUGIN_SESSION_ROOT/batch-3-fix-report.md`.

## Regression spec

- `clears the current notice as soon as the session changes`
- The spec asserts that the signal is null and the banner is absent before session B resolves. It then asserts that session B's notice renders.

## Verification

Command:

```sh
npm run verify -- -t test,lint,typecheck -p chat-ui | tail -40
```

Result:

```text
NX   3 tasks: 3 succeeded
Run duration:      4m 11s
Cache:             0/3 hit (0%)
[verify 2026-10-31T14:27:50.638Z] lock released after 260.1s, exit code 0
```

## Decisions

- The `angular-frontend-patterns` skill is not available in this session. The fix follows the existing component and spec patterns.
- The notice clears on every session effect run. This covers null-session changes and changes between two non-null session ids.
- The request counter remains the guard against late replies from earlier sessions.
- Scope is limited to the catalog panel component, its spec, and this report.
