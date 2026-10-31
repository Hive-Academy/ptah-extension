# Batch 8q-fix-wire-level report

## Changes

- `libs/backend/codex-runtime/src/lib/codex-context.ts:90`: Track the permission level whose policy was last sent to the server, initialized from the opening profile at line 124.
- `libs/backend/codex-runtime/src/lib/codex-context.ts:404`: Snapshot that wire level when an idle context receives `turn/started`; the idle `turnPermissionLevel` getter still shows the staged next-turn level.
- `libs/backend/codex-runtime/src/lib/codex-context.ts:524`: Save the previous wire level, update it for `turn/start` at line 530, and restore it if the request is rejected before a turn starts at line 552. No new RPC was added.

## Specs

- Added `uses the opening plan policy for an idle notification before the next ask turn` (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1633`): The notification-started turn stays on plan, declines a `Get-Content` approval, and the next user turn sends ask policy.
- Added `uses the last sent ask policy for an idle notification after staging plan` (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1671`): A completed ask turn leaves ask on the wire for a subsequent notification-started turn.
- Added `keeps the last sent level after a rejected turn/start` (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1685`): Rejection leaves the opening ask level in force for a later notification-started turn.
- Changed `holds the level of a notification-started turn until it completes` (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1701`): Its old plan expectation relied on the staged next-turn level. It now expects the opening ask level during the notification-started turn and plan only after completion.
- Updated the fake approval helper at `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:135` to accept a command, allowing the read approval case.

## Decisions

- The wire level changes when sending `turn/start`; a rejected request without an active turn restores the prior level.
- The active-turn snapshot remains fixed while the turn runs, including across `updateNextTurn` calls.

## Not done

- No verification ran, as instructed: no tests, builds, lint, Nx, npm, TypeScript checks, or diagnostics.
