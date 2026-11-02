# D9 12d-2 fixes report

## Changes

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:633`: attached a valid `optional-capability` audit marker to the cancellation observer. The observer still prevents an unhandled rejection if setup fails. At `:659`, removed the malformed marker; disposal failure is still logged with an `Error` and cannot replace the read outcome.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:25,86,105,116`: preserve the original cause on typed route errors for normalization, native read, and projection failures. Public error messages remain fixed. The Electron error is recognized by its `name` because the class lives in the Electron app and importing it into `agent-sdk` or `rpc-handlers` would reverse the lib-to-app boundary.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts:218`: assert that an unknown native failure remains available as the typed error's cause.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:58`: use `Object.hasOwn` before the code lookup, then bracket access for the index signature. This excludes inherited keys and fixes TS4111 for `nativeReadFailed`. Re-reading the file found no other index-signature dot access. At `:67-81`, type injected collaborators by the methods the service actually uses, so specs can pass typed fixtures.
- `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:18`: accept the logger's `warn` method contract used by folder resolution.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts:19-64,191`: replace `as never` casts with complete `SessionMetadata` and `SubagentRecord` fixtures and typed collaborators.
- `libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts:75-80,163`: remove `as never` casts and cover an inherited `toString` error code.
- `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md:47`: add a release-gate decision for native `includeBlockOwners` and `syntheticToolResults`; the native route currently ignores `includeBlockOwners`.

## Degradation audit

Ran exactly `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` from the worktree root; exit 0. Relevant output:

```text
degradation-audit: scanned 4343 file(s)
  apps/ptah-electron: 4 ok (baseline 4)
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/rpc-handlers: 1 ok (baseline 1)
degradation-audit: TOTAL 280 unsuppressed site(s)
```

`libs/backend/codex-runtime` has 0 violations and a baseline of 0; the audit omits directories with neither a violation nor a baseline entry. No violation line points to a task file.

## Files written and line endings

Every file below is under `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`. Byte inspection found CR count 0 and no UTF-8 BOM in each file:

| File | CR |
| --- | ---: |
| `apps/ptah-electron/src/di/codex-runtime-composition.ts` | 0 |
| `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts` | 0 |
| `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts` | 0 |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts` | 0 |
| `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts` | 0 |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts` | 0 |
| `libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts` | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md` | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/batch-D9-12d2-fixes-report.md` | 0 |

`git diff --check` passed. No `as never`, `as unknown as`, `@ts-ignore`, or `eslint-disable` remains in the affected specs.

## UNCONFIRMED

- TypeScript compilation, Jest behavior, lint, Nx checks, Electron runtime behavior, and packaged reload/render remain unconfirmed because the task prohibited those commands.
- The release gate must confirm whether native resume needs block owners or synthetic tool results and inspect authorized pinned-binary paginated and child-thread responses.
