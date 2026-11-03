# CLI session reference replacement lane

## Files and changes

- `libs/shared/src/lib/types/agent-process.types.ts`: added optional abandoned CLI ID history to the live agent record and persisted CLI reference.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`: publishes the opened thread ID through the existing `onSessionResolved` callback, including the new thread after fallback.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: captures each previous nonempty CLI ID when a live lane changes thread, whether via callback or output segment.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`: includes the abandoned ID history in the persisted reference.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`: replaces the first matching abandoned ID in place, removes other abandoned IDs, merges prior history on later writes, and ignores delayed writes for superseded IDs. Displaced agent output is deleted only after the replacement metadata is durable.

## Specs

- `session-metadata-store.spec.ts`: in-place replacement, removal of other abandoned IDs, and stale old-ID write.
- `codex-app-server-lane.adapter.spec.ts`: first-turn bundled fallback emits the old and new thread IDs.
- `agent-process-manager.account-binding.spec.ts`: live resolution immediately records the old ID and updates the current ID.
- `agent-events.spec.ts`: persisted reference carries the abandoned ID history.
- Jest was not run, as required by the fix-lane instructions.

## TypeScript checks

- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit`: no `error TS` output.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.lib.json --noEmit`: no `error TS` output.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.spec.json --noEmit`: no `error TS` output.
- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json --noEmit`: no `error TS` output.
- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.spec.json --noEmit`: no `error TS` output.
- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings, clean coverage across nine changed TypeScript files. The first call timed out; the cached repeat completed.

## Decisions

- Use `onSessionResolved` for the Codex adapter's fallback notification. The manager already subscribes to this callback; changing the adapter and reusing the manager path is reversible.
- Store abandoned IDs on the running `AgentProcessInfo` so agent-event persistence can include them. Matching remains limited to explicit abandoned IDs, never general `agentId` equality; reversible.
- Preserve abandoned-ID history across later writes to the same current ID so a delayed old write remains suppressed; reversible.

## Remaining risk

- The new specs have type-checked but were not executed because Jest is prohibited in this lane.
- No Zod schema for `cliSessions`/`CliSessionReference` was found in the shared or agent-sdk source, so no schema change was needed.
