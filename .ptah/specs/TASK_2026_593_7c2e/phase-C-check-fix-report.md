# Phase C check fixes

| Item | Cause | Fix file:line | Tests / lint result |
| --- | --- | --- | --- |
| Review shell TS2304 and related spec failures | `untracked` was used without an Angular import. | `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts:12` | Review shell spec: 51 passed; ESLint: 0 errors. |
| Setup wizard TS2322 | The second tab lookup could have an undefined workflow despite the earlier `canFocus` check. | `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.ts:21` | ESLint: 0 errors. |
| Chat spec prefer-const | The injected banner reference was declared with `let` and assigned once. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:559` | Chat view spec: 89 passed; ESLint: 0 errors. |
| Late branch failure tests | Failures now publish attention notices through `NotificationService`; the old tests expected a local error banner, and one referenced a removed `actionError` property. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1449`, `:1483` | Chat view spec: 89 passed; ESLint: 0 errors. The tests check originating `tabId` and that a newer notice is not followed by a stale upsert. |
| PR #780 lane release race | Releasing during the awaited metadata read occurred before the lane failure generation was claimed. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:180`, `:212`; regression spec `host-attention-coordinator.spec.ts:295` | Coordinator spec: 38 passed; ESLint: 0 errors. |

Audit: `degradation-audit: TOTAL 291 unsuppressed site(s)`; no `FAIL` line.

## Decisions

- Mirrored the session release version guard for lanes, with a bounded per-agent release map.
- Kept the chat notice assertion scoped to the originating tab and checked that a later failure adds no new notice after a newer action.
- Left the edits uncommitted. ESLint returned 6 warnings in the scoped files and 0 errors; the warnings are on existing lines.

## Not done

- No separate Nx typecheck run; verification followed the requested three Jest specs, scoped ESLint, and degradation audit.
