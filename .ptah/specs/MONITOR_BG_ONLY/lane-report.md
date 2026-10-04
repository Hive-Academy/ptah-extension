## Current data flow (file:line)

- `agent-monitor.store.ts:765-789` derives the session-subagent list used only by the monitor panel (`agent-monitor-panel.component.ts:753-756`) and its specs.
- `agent-monitor-panel.component.ts:767-805` removes workflow duplicates, preserves an explicitly selected non-workflow record, and turns the result into tiles.
- `agent-monitor-panel.component.ts:831-845` derives the header/rail count and selectable keys from the same effective CLI, workflow, and session lists.

## Background test used and key check

- `BackgroundAgentStore.isBackgroundAgent(toolCallId)` (`background-agent.store.ts:205-220`) scans entries by `BackgroundAgentEntry.toolCallId`.
- `SubagentRecord.parentToolUseId` is the Task tool-call key (`agent-monitor.store.ts:574-579`), so it is the correct argument. No new background flag was needed.
- The selectors read `BackgroundAgentStore.revision()` before the lookup, making a `background_agent_started` mutation reactive even while the subagent record remains `running`.

## Changes (file:line)

- `agent-monitor.store.ts:41,520,765-798` injects `BackgroundAgentStore` and limits both session selectors to non-workflow records that are either status `background` or background-store members. Store membership retains completed background records until the existing background-store retention removes them.
- No panel production code changed: its counts, empty state, and badges consume the selector results.

## Selection path finding

- User selection enters through `pickStandalone` / `selectAgent` / `applyAgentSelection` (`agent-monitor-panel.component.ts:1101-1137`).
- `sessionSubagents` deliberately preserves an explicitly selected visible non-workflow record (`:779-799`) even when it is no longer selector-listed. This remains unchanged, so an inline/open-in-monitor flow that has selected a foreground record can retain it for detail viewing.
- Automatic selection is limited to CLI/workflow keys (`:848-991`); session subagents do not steal selection.

## Counts/badges

- `totalCount` (`agent-monitor-panel.component.ts:831-836`), the header badge (`:231-233`), and the empty-state branches (`:285,596`) all use `sessionSubagents()`. They now count only background session records while preserving CLI lanes and workflow groups.

## Tests added

- `agent-monitor.store.spec.ts:1005-1075`: foreground running/pending/paused exclusion; status-background inclusion; reactive running-to-background inclusion through `BackgroundAgentStore`; completed background retention; workflow exclusion and session scoping.
- `agent-monitor-panel.component.spec.ts:439-458`: real-path-shaped panel input keeps the background record `running`, counts it with one CLI lane (total `2`), and does not count a foreground record. Existing workflow-group and explicit-selection coverage remains separate (`:671-705`, `:555-596`).

## Verification (tail)

`$env:NX_NO_CLOUD='true'; $env:NX_DAEMON='false'; npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-streaming,@ptah-extension/chat`

The first scoped run passed all six targets. After the corrected panel fixture, the focused panel spec passed (28 tests). The final complete run passed typecheck/lint for both projects and all `chat-streaming` targets, but `@ptah-extension/chat:test` reported one failing test elsewhere in its 2,978-test suite; the changed panel spec passed in that same worktree.

## Not done / risks

- The final complete Nx verification has one unexplained `@ptah-extension/chat:test` failure outside the focused changed spec; all relevant focused coverage passed. The repository-wide diagnostic snapshot also contains unrelated existing test typing errors.
- No CLI lane, workflow grouping, permission prompt, or background-store retention behavior was modified.

## Revision 1

### Fix

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:792-798` now requires a non-workflow session subagent to have an active status (`running`, `pending`, `paused`, or `background`) before accepting either explicit background status or `BackgroundAgentStore` membership. Terminal backgrounded records therefore leave the automatic monitor selectors.

### Test changes

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts:1055-1073` now verifies a completed record remains excluded from both `activeSessionSubagents` and `sessionSubagentsForSession` even when its Task tool call is backgrounded.
- Existing coverage remains for `running` with no `BackgroundAgentStore` entry being excluded (`:1018-1035`) and for `running` becoming listed after background-store membership (`:1037-1053`).
- The panel explicit-selection test was not changed.

### Verification (tail)

`$env:NX_NO_CLOUD='true'; $env:NX_DAEMON='false'; npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-streaming,@ptah-extension/chat`

Not run: Nx exited before scheduling targets because its `js`, `package-json`, `project-json`, and `@nx/eslint/plugin` workers failed to connect/load. Tail: `NX Failed to load 3 default Nx plugin(s)` and `Failed to load 1 Nx plugin(s): @nx/eslint/plugin`.

## Revision 2

### Review follow-up

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:493-494` defines the module-level `ACTIVE_SESSION_SUBAGENT_STATUSES` `ReadonlySet`; `:798` now uses `.has(r.status)`.
- `agent-monitor.store.ts:800-801` retains the `status === 'background'` type-level guard and documents that `BackgroundAgentStore` is the real production source of background membership.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts:1004-1094` changes all behavioral background fixtures to running records registered via `BackgroundAgentStore.onStarted`, while retaining one isolated status-background guard test.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts:439` now names the mocked-selector assertion for what it actually covers: panel list/count reflection.

### Verification (tail)

`$env:NX_NO_CLOUD='true'; $env:NX_DAEMON='false'; npx nx run-many -t typecheck,test,lint -p chat-streaming,chat`

Passed: typecheck, test, and lint for `@ptah-extension/chat-streaming` and `@ptah-extension/chat` (6 successful tasks; 1m41s). No retry was needed because Nx workers started normally.
