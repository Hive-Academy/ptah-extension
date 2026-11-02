# D9 fix 8 — native Codex child recovery after resume

## Findings and fixes

1. **Native history cache had a sliding two-minute TTL.** A hit rewrote `expiresAt`, so frequent page requests could keep a stale parent snapshot indefinitely. `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:108,138-165` now retains the original expiry and uses a 15-second absolute maximum age from the completed read. The eight-entry LRU and in-flight read deduplication remain. Missing child starts or empty child histories clear the parent's cache entry (`:208-220`); native not-found and both stale-cursor paths clear it before returning (`:545-580`). This lets a client retry read fresh history.

2. **The frontend recovery gate depended solely on the tab's provider ID.** Older or mistimed tabs may have no `providerId`. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:224-229` emits replayed native `agent_start` events with `source: 'history'` and a six-part JSON ID ending in the mapped event type, item phase, and ordinal. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:365-376` accepts either `openai-codex` or that projected marker. Claude-style events do not satisfy the marker; the Claude-negative fixture uses a Claude-style ID.

3. **A partial child execution blocked recovery.** `restoreHistoryChild` returned as soon as state or a finalized fragment existed. `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts:110,225,416-450` now checks the monitor lifecycle, merges a complete native snapshot into partial state, replaces finalized fragments with that snapshot, and records restored event IDs so an unchanged replay is idempotent. Running and loading children remain protected. The existing history merger deduplicates overlapping routed and snapshot events by event ID.

## Synthetic specs added

- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts:357-444`: absolute expiry despite hits, capacity eviction, concurrent in-flight deduplication, stale-cursor invalidation, and missing-child invalidation.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts:177-241`: projector-shaped marker, missing-provider Codex recovery, and Claude-negative coverage.
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts:143-184`: partial-state merge with event-ID deduplication and replacement of a finalized partial tree.

## Verification and limits

I inspected the edited source and fixture call paths. Ptah AST analysis parsed all six edited TypeScript files with zero error nodes. I did not run npm, Nx, Jest, TypeScript checks, lint, builds, verify, git writes, or UI rendering under the task's command restrictions. No live Codex session data was used. The `angular-frontend-patterns` skill could not be loaded: this lane has no invocable skill loader and the local skill inventory does not include it; I applied the supplied Angular guidance directly.

## Changed files

- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts`
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix8-report.md`
