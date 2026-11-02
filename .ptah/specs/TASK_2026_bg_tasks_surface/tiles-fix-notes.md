# Background task tiles round 2 fixes

## Fixes

1. **Command order:** `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:267,466,664-804` now retains task-to-tool links, bounded Bash commands, and the last session snapshot. A late link queues a refreshed snapshot. `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts:42-68` resolves and caches commands on ordinary snapshots. `libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts:351-381` covers snapshot before task start, snapshot before tool use, and both task/tool orders before snapshot.
2. **Cleanup and length:** `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1240` clears command and snapshot state on query teardown before the terminal empty event. `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:692-695,731-766` truncates commands to 2000 characters with an ellipsis and clears all command/link/cache entries on an empty snapshot. `libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts:382-393` covers both.
3. **Tile accessibility:** `libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles.component.ts:25-88,117-121` gives the row/list items explicit roles, stable tooltip IDs linked by `aria-describedby`, short labels, and Escape dismissal that blurs the tile. `background-task-tiles.component.spec.ts:44-95` checks these attributes and dismissal.
4. **One filter:** `libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles-container.component.ts:44` remains the sole `isAgentTaskType` filter. `background-task-tiles.component.ts:98-103` renders every supplied tile; `background-task-tiles.component.spec.ts:100-114` checks that contract.

## Checks run

- Ran `npx prettier --write` on the changed tile component/spec and backend transformer/state files. Avoided formatting large existing spec and stream files to prevent unrelated churn.
- Scoped `ptah_get_diagnostics` found five backend TypeScript errors; fixed the new UUID and optional lookup errors plus two affected state mocks. The second backend check reported **0 errors, 0 warnings**.
- Scoped frontend diagnostics twice; both attempts timed out after 45 seconds with the files unchecked.
- Reviewed the round 2 findings and changed source manually.

## Decisions

- **Refresh timing:** Late command links publish a replacement snapshot only when its cached task row gains or changes a command. This uses the store's existing replace semantics and keeps the original first-seen timestamp. Reversible.
- **Session lifetime:** Cache and command maps survive compact boundaries, then clear on SDK query teardown or an empty SDK snapshot. This follows the process-scoped snapshot lifetime. Reversible.
- **Escape:** The tooltip element keeps its stable ID while an inline `display:none` hides it after dismissal; a new focus or pointer entry reopens it. Reversible.

## Not done

- Per request, did not run Jest, Nx, build, serve, or `npm run verify`; CI must execute the specs and Angular template checks.
- No rendered screenshot because starting the app was prohibited. Frontend diagnostics remained unavailable after two scoped attempts.
- The host still exposes no skill-loading tool, so `angular-frontend-patterns` was unavailable.
