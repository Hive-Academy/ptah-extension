# Fallback thread fix report

## Evidence

- `codex-context.ts:275-280` sends `thread/resume` whenever an identity is supplied. The bundled retry previously supplied the identity of a newly started thread even when `turn/start` returned no receipt.
- The frozen protocol schema describes `thread/resume` response fields but gives no zero-turn persistence guarantee. `tools/evidence-cases-round.spec.ts:601` explicitly records resume behavior as `schema present; behavior unverified`.
- OpenAI's [zero-turn resume regression report](https://github.com/openai/codex/issues/42099) reports that `thread/start` can return an ID without creating a rollout, and a later `thread/resume` fails with `no rollout found for thread id`. This supports starting a new thread after a rejected first turn.

## Lane fallback

- **Change:** `codex-app-server-lane.adapter.ts` seeds `hasTurnHistory` from a resumed lane and sets it after an accepted turn receipt. The first-turn installed-binary fallback calls `openFallback` without an identity for a fresh lane, so the bundled process uses `thread/start`. It removes the prior writer entry owned by this writer when it adopts a new thread ID, persists the new identity, and registers the new writer. A resumed lane retains its identity and uses `thread/resume`.
- **Files:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`, `codex-app-server-lane.adapter.spec.ts` in the same directory.
- **Specs:** New fresh-lane case asserts no fallback resume identity, new session ID, old writer removal, new writer registration, and successful retry. New resumed-lane case asserts fallback receives the saved identity and completes.

## Runtime fallback

- **Change:** `codex-context.ts` tracks whether the context was opened with a saved identity or accepted a `turn/start` receipt. `codex-runtime.ts` passes an identity to `open` on bundled retry only when that history exists; otherwise the replacement gets `thread/start` and a newly persisted identity.
- **Files:** `libs/backend/codex-runtime/src/lib/codex-context.ts`, `codex-runtime.ts`, `codex-runtime.spec.ts`.
- **Specs:** New zero-turn case checks a new bundled thread ID and `thread/start`; new saved-history case checks the original ID and `thread/resume`.

## Chat fallback

- **Change:** Chat no longer calls `retryFirstTurnOnBundle` after an installed `turn/start` rejection. The stream displays the precise `CodexUnsupportedMethodError` message, closes the failed session, and does not retain the open-only MCP secrets in its tracked session. This avoids replacing the thread beneath an already published Ptah session ID.
- **Files:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts`, `codex-chat-adapter.ts`, `codex-chat-turn-lifecycle.spec.ts`, `codex-chat-adapter.spec.ts`.
- **Specs:** Installed and bundled unsupported-method cases assert a visible message and no retry; the adapter spec asserts secrets are never stored on the session.

## TypeScript checks

- `npx tsc -p libs/backend/codex-runtime/tsconfig.spec.json --noEmit`: exit 0, no `error TS` lines.
- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.spec.json --noEmit`: first run found an optional method invocation in the new spec; fixed it, then exit 0 with no `error TS` lines.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.spec.json --noEmit`: first run found an old assertion against the removed `secrets` field; updated it, then exit 0 with no `error TS` lines.
- `ptah_get_diagnostics` scoped to one changed source file in each project: zero errors, clean coverage. The initial eight-file calls timed out; the focused calls completed.
- Jest, Nx, build, e2e, verify, package installation, and Git were not run under lane instructions. Specs are compile checked, not executed.

## Decisions

- **Zero-turn retry:** Options were resume the original thread or start a new bundled thread. The evidence suite does not verify zero-turn resume, and the OpenAI issue documents a missing rollout after `thread/start`; chose a new thread. Reversible if Codex guarantees persistence before a turn in all supported versions.
- **Chat first-turn failure:** Options were remap the chat session to a new thread or return a clear unsupported-method error. `codex-chat-adapter.ts:297-340` derives and publishes the Ptah session ID from the initial Codex thread ID, persists metadata, creates the usage owner, and resolves the tab binding before the turn. A remap would have to update all of those owners together; chose the clear failure. Reversible with an atomic session-rebinding contract and tests.
- **Skill loading:** This host exposed no skill-loading tool and assigned no matching skill for this focused backend fix; repository guidance and source contracts governed the change.

## Remaining risk

- The focused unit specs could not be executed under lane instructions; a later permitted test run must confirm their behavior.
- Chat cannot switch to the bundled executable after its first `turn/start` is rejected. It now reports the exact unsupported-method message and retires the failed session instead of attempting a broken resume.

## Follow-up: remember unsupported installed version

- **Change:** `CodexSelectionSnapshot` now records an installed executable's normalized version and missing method when `activateFallback` or `markUnsupported` is called. Later opens re-probe the binaries, choose the bundled executable with the required-method reason when that installed version recurs, and select an upgraded installed version normally. Without a bundle, the installed selection remains available. `current()` reflects the bundled choice when a known unsupported active selection has a fallback.
- **Chat wiring:** `CodexRuntime.markUnsupported(context, method)` finds the context's selection and records an installed `turn/start` failure in the host snapshot. The chat turn stream calls it only before the first turn receipt, before retiring the failed session. When a bundle exists, the short user-facing error says the next session will use bundled Codex.
- **Files:** `libs/backend/codex-runtime/src/lib/select-codex-executable.ts`, `codex-runtime.ts`, their adjacent specs, and `src/lib/di/registration.spec.ts`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`, `codex-chat-turn-stream.ts`, `codex-chat-turn-lifecycle.spec.ts`; `apps/ptah-electron/src/di/codex-runtime-composition.ts`, `codex-lane-composition.ts`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts`; `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts`.
- **Specs added/updated:** Snapshot specs cover remembered failure and reason, upgraded installed version, no bundled executable, and subsequent selection after `activateFallback`. A runtime spec verifies forwarding the context's selected installed version. The chat lifecycle spec spies on the first `turn/start` failure report, checks the next selection is bundled, and checks the next-session notice.
- **TypeScript:** `npx tsc -p <project>/tsconfig.spec.json --noEmit` exited 0 with no `error TS` lines for `apps/ptah-electron`, `libs/backend/cli-engine`, `libs/backend/codex-runtime`, `libs/backend/agent-sdk`, and `libs/backend/auth-providers`. Runtime was checked twice, including after the final spec edit (six calls total). `ptah_get_diagnostics` found zero errors in runtime, agent-sdk and auth-providers; its Electron and CLI checks timed out, so those two use the successful `tsc` results. Jest, Nx, build, e2e, verify, package installation and Git were not run under lane instructions.
- **Decision:** Key the remembered failure by normalized installed version rather than path, because method support follows the binary version. The choice is reversible by removing the in-memory entry; it is not persisted across host restarts.
