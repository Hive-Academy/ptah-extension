# Lane A review report

## Findings

- **A1 — valid.** `bootstrap.ts:209-216` only checked `statSync().isDirectory()`, so a directory without read/traverse access could win argv selection. Added `accessSync(R_OK | X_OK)` inside the existing try/catch. `initial-workspace-arg.ts` remains pure; its existing spec already covers skipping a predicate-rejected candidate, so no permission-dependent spec was added.
- **A2 — valid.** `chat-session.service.ts:888` passes `options.systemPrompt` into the session, while `chat-rpc.schema.ts:64-71` previously passed the entire options object through. Added a passthrough options schema that applies the existing 16 KiB `SystemPromptSchema` to `options.systemPrompt`; outer passthrough remains. Added `chat-rpc.schema.spec.ts` cases for the maximum accepted size, oversized and non-string rejection, and preservation of other options and outer fields.
- **A3 — valid.** `message-dispatch.service.ts:189-210` queues while the send lock is held; `session-coordinator.ts:214` releases the lock, while the existing `sendQueuedMessage` path (`message-dispatch.service.ts:234-286`) only ran at turn end. Added a lock-state effect in `message-dispatch.service.ts` that flushes the former root tab's queued prompt on release only if the tab is idle; it uses the existing guarded flush path. Added focused release and still-streaming cases to `message-dispatch.command-center-lock.spec.ts`.
- **A4 — valid.** `tribunal-phase-derivation.ts:326-328` contained an unreferenced local `describe` helper (the only occurrence in the file). Removed it. No spec is needed for deleting dead code; the copy in `tribunal-progress.service.ts` is unchanged.

## Files changed

- `apps/ptah-electron/src/activation/bootstrap.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.command-center-lock.spec.ts`
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts`

## Verification

`git diff --check` passed. Nx, Jest, tsc, build and other package checks were not run per lane instructions. Scoped `ptah_get_diagnostics` was attempted after edits, but its TypeScript compiler check remained unavailable after the 45-second tool timeout; it reported all six changed TypeScript files unchecked. Other working-tree changes from parallel lanes were left untouched.

## Decisions

- **A1 predicate:** Chose a direct access check in the Electron callback over changing the pure argv resolver. Evidence: the callback already catches inaccessible path errors, and the resolver accepts an injected predicate. Reversible: yes.
- **A2 schema:** Chose an optional passthrough options object over a strict object or top-level prompt rule. Evidence: `ChatStartParams.options` is optional and carries other fields; the existing continue/resume schemas share `SystemPromptSchema`. Reversible: yes.
- **A3 release handling:** Chose a dispatch-side effect on the existing lock signal over changing Command Center code or creating a new lock API. Evidence: the lock exposes read-only reactive state and the dispatch service owns `sendQueuedMessage`; the idle predicate already defines when a tab can send. Reversible: yes.
