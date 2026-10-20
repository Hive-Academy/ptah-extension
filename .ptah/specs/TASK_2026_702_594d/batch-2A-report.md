# Batch 2A — recent session history

## Files changed

- `libs/frontend/chat/src/lib/services/session-list/recent-sessions.store.ts` — new root-scoped store. It reads pinned and unpinned query pages independently, deduplicates by session ID, sorts by descending activity with an ID tie-break, and exposes the newest three.
- `libs/frontend/chat/src/lib/services/session-list/recent-sessions.store.spec.ts` — focused coverage for combined ranking, archive query behavior, no-organization duplication, dialog independence, stale workspace responses, refresh, and RPC failure.
- `libs/frontend/chat/src/lib/services/index.ts` — exports `RecentSessionsStore`.

## Store API for 2B

Inject `RecentSessionsStore`. Call `load(workspacePath: string): Promise<void>` when the active workspace is selected or changes. Call `refresh(): Promise<void>` to reload the current workspace. Read signals `workspacePath(): string | null`, `sessions(): readonly ChatSessionSummary[]`, `loading(): boolean`, `confirmed(): boolean`, and `error(): string | null`. `confirmed` becomes true only after both RPC reads succeed. `error` is a safe generic message; details go to injected `LoggingService`. A new load invalidates older responses, including A → B → A switches.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Place the store in `services/session-list` and expose workspace selection through `load(workspacePath)` | Component-local store; implicit ChatStore workspace | Existing `session-list-view.store.ts` and `session-organizer.service.ts` live there; the plan assigns a new chat store and the canvas caller already knows its workspace | Yes |
| Keep one state record keyed by workspace and use a request sequence | Separate unrelated signals; workspace-only response check | Plan requires workspace-keyed loading/confirmed/error and stale-response rejection; an A → B → A switch defeats a path-only check | Yes |
| Use the host's default archived exclusion | Add a status filter; filter results locally | `session-list-query.ts:115-119` excludes archived rows in organization query mode; no-organization hosts have no archive filter | Yes |

## Verification and limits

`ptah_get_diagnostics` after edits found no diagnostics in the three changed files. The project-level diagnostic report still contains 269 sibling-file errors outside batch ownership. Per assignment, no Nx, Jest, TypeScript CLI, build, or e2e command was run. The orchestrator owns the chat checks. No runtime integration or board wiring was part of 2A.
