# Codex binary unpin fix round

## Finding 1 - Chat first-turn bundled retry

- Files: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts`, `codex-chat-adapter.ts`, and `codex-chat-turn-lifecycle.spec.ts`; `libs/backend/codex-runtime/src/lib/codex-runtime.ts`.
- Change: an installed `turn/start` unsupported-method rejection before a receipt closes the original context, consumes its selection's bundled fallback once, reopens with the same execution profile, resume identity, and MCP secrets/CODEX_HOME, and retries the turn once. A bundled rejection produces the safe method error. Once a receipt exists, the turn is never replayed.
- Tests added/replaced: successful bundled retry with old-context close; bundled `turn/start` rejection and safe notice; unsupported error after receipt with no retry.

## Finding 2 - Per-open executable selection

- Files: `libs/backend/codex-runtime/src/lib/select-codex-executable.ts`, `codex-runtime.ts`, and their specs; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-binary.ts` and `codex-app-server-lane.adapter.ts`; `apps/ptah-electron/src/di/codex-lane-composition.ts`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts`.
- Change: every probe yields an immutable selection object. The native binary carries that handle into lane/catalog open and fallback. Electron and CLI compositions validate the selected path against the captured handle and bind runtime opens to it; they no longer validate against mutable `current()`. The snapshot keeps only a generation-guarded latest value for status, while fallback budget is keyed to the selected executable object. History/account-usage reads remain independent of a lane's handle.
- Tests added: out-of-order deferred probes for two lane opens, a lane open overlapping a history read, and selection/budget isolation across overlapping probes.
- Exported contract callers updated: `CodexLaneBinaryProbe`/native binary result; `CodexLaneRuntimeProvider` open, catalog, and fallback calls in the lane adapter; Electron and CLI lane compositions; `CodexRuntime.open` callers remain source compatible through its optional selection argument. No DI registration changed, so DI guard specs needed no update.

## Finding 3 - Optional methods preserve context

- Files: `libs/backend/codex-runtime/src/lib/codex-context.ts` and `codex-runtime.spec.ts`.
- Change: unsupported `turn/steer` and `thread/compact/start` reject only their operations. Unsupported `turn/interrupt` clears its watchdog, restores the running state and turn controller, and returns `false`. Abort-triggered interrupt handles the same unsupported response without closing the context. Other transport/protocol failures still take the failure path.
- Tests added: one regression case for each optional method followed by a basic operation on the same context.

## Finding 4 - Active executable identity in lane fallback

- Files: `libs/backend/codex-runtime/src/lib/codex-runtime.ts` and `codex-runtime.spec.ts`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts` and its spec; both lane compositions named above.
- Change: runtime records the executable that actually opened each context, including an internal `model/list` fallback. Lane first-turn fallback checks the error's `source` and the per-open budget. A bundled error cannot call `openFallback`; the safe bundled-method error reaches the caller.
- Tests added: installed `model/list` fallback followed by bundled `turn/start` rejection and no second fallback; lane adapter safe-error assertion for bundled `turn/start`.

## Observation - Selection logging

- File: `apps/ptah-electron/src/di/codex-runtime-composition.ts`.
- Change: `Codex executable selected` logs at INFO only when source, version, or path differs from the last logged selection; repeated selections log at DEBUG.

## Verification

- Eight permitted filtered `npx tsc -p ... --noEmit` calls: zero `error TS` lines for `codex-runtime/tsconfig.lib.json`, `agent-sdk/tsconfig.lib.json`, `cli-agent-runtime/tsconfig.lib.json`, `cli-engine/tsconfig.lib.json`, `ptah-electron/tsconfig.app.json`, and `codex-runtime/tsconfig.spec.json`. The first `agent-sdk/tsconfig.spec.json` pass found TS2322 in a new mock; the mock was corrected and the eighth call returned zero `error TS` lines.
- After the final edits, scoped `ptah_get_diagnostics` returned zero errors for `codex-runtime.ts`, `codex-runtime.spec.ts`, `codex-chat-turn-lifecycle.spec.ts`, and `codex-app-server-lane.adapter.spec.ts`. Earlier combined diagnostic calls timed out; individual scoped calls completed cleanly.
- No tests, Nx targets, build, npm install, or git commands were run, as instructed.

## Decisions

- **Use a captured selection handle through each open.** Options: validate against shared `current()` or carry the probe result. The review documents the concurrent-open race, and both host compositions already resolved a binary before opening it. Chose the captured handle. Reversible: yes.
- **Keep status separate from fallback authority.** Options: use latest status to decide fallback or key the one-shot budget to each selected executable. The first choice lets a history probe alter a lane's fallback. Chose the per-selection budget and generation-guarded status. Reversible: yes.
- **Treat unsupported optional RPCs as operation-local.** Options: close the context or preserve it while cleaning operation state. The review identifies these methods as optional, and the existing context state machine supports restoration. Chose preservation. Reversible: yes.
- **Use the error source and active context selection for retry.** Options: infer from the original binary probe or use the failing request/context. Internal `model/list` fallback can make the original probe stale. Chose the active identity. Reversible: yes.

## Remaining issues

- Runtime tests were not executed because this fix round explicitly prohibited test commands. Compilation and scoped diagnostics are clean, but behavioral assertions remain unrun.
- The lane host did not expose a skill discovery/loading tool, so no task skill could be loaded; the repository's supplied guidance and source patterns were used.
