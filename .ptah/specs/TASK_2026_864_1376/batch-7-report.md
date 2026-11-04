# Batch 7 report

## Files written

- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts` — optional service injections, registrations, manifest ownership.
- `libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts` — in-app login, cancel, status push, fallback.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts` — response mapping, cancellation, no-service regression, real service with fake spawner.
- `libs/backend/rpc-handlers/src/test-utils/codex-fakes.ts` — typed login and readiness fakes.
- `.ptah/specs/TASK_2026_864_1376/batch-7-report.md` — this report.

## Order and fallback

| Priority | Condition | Result |
| --- | --- | --- |
| 1 | CodexLoginService injected | Validate mode/restart, start service, push states |
| 2 | No service, runner present | Existing `runAuthCommand` flow and side effects |
| 3 | Neither present | Fixed failure; no `openTerminal` |

## Response mapping

| Service state | Response |
| --- | --- |
| starting, running, awaiting-user, succeeded | `{ success: true, state }` |
| failed | `{ success: false, error: fixed copy for errorCode, state }` |
| cancelled | `{ success: false, state }` |

`auth:codexLoginCancel` returns `{ cancelled: codexLogin?.cancel() ?? false }`. A succeeded push clears the auth cache, starts adapter reset, and invalidates status cache. Broadcast and reset failures are contained with fixed log lines.

## METHODS change

Added `auth:codexLoginCancel` and `auth:getCodexReadiness` to `AuthRpcHandlers.METHODS`, registration, and the debug method list. The readiness handler is the Batch 6 implementation.

## Decisions

- Decision: retain the existing CLI runner branch and prefer the injected service. Options were service first or runner first; the plan and decision row 13 specify service first. Reversible: yes.
- Decision: use fixed copy keyed by `errorCode` for failed service responses. Options were service `state.error` or keyed copy; R1-4 and the no-raw-error rule favor keyed copy. Reversible: yes.
- Decision: keep optional constructor dependencies appended. Options were inserting near existing provider dependencies or appending; the task requires existing positional specs to compile unchanged. Reversible: yes.

## Risks and verification

`ptah_get_diagnostics` was called after edits, but its TypeScript compiler timed out at 45 seconds and reported all four files unchecked on repeated calls. No green typecheck or test result is claimed. The orchestrator owns `npm run verify -- -p @ptah-extension/rpc-handlers`; this lane was expressly prohibited from running it or any other test/build command. The fake-spawner regression does not run a real Codex process.
