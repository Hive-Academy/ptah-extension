# Compaction UI consistency

User requested a dedicated worktree and Ollama Cloud CLI implementation, followed by orchestrator review and verification. No commits or pushes authorized.

- Strategy: BUGFIX, Partial. Read-only architecture/batch plan first, user approval, then sequential Ollama Cloud implementation and independent review/tests.
- Worktree: D:/projects/ptah-extension/.claude-worktrees/compaction-ui-consistency
- Branch: fix/compaction-ui-consistency
- Canonical task folder: D:/projects/ptah-extension/.ptah/specs/TASK_2026_414
- CLI delegation: enabled, explicitly requested. Ollama Cloud ptahCliId pc-85830910-3d81-4248-84c1-4fa52752dd19. No substitute provider without user consent.

## Verified evidence

Electron log C:/Users/abdal/AppData/Roaming/Ptah/logs/Ptah Electron-2026-09-10.log lines 10354-10385: after manual compaction, canvas session 8a0a185b-4af2-4327-aa06-9f82605290a4 replay read old boundary534 while separate message reader read new boundary999; response mixed194 events with4 messages. Git session d1808e88-9211-4ba4-822b-406569c21d5b returned609 events/16 messages without new boundary. Later reloads lines10423-10436 found boundaries999/358 with9 events/4 messages. Both compactions completed and summaries persisted.

Boundary metadata preTokens144/68 matches last assistant output usage; input/cache usage was zero. postTokens21930/17369, duration217372/212092ms. Do not invent kilotoken conversion. Provider accounting is distinct from refresh failure.

## Scope and acceptance

1. Boundary-aware reload: do not replace valid visible history with pre-compaction or mixed snapshots. Build messages/replay from consistent data; verify expected new boundary with bounded readiness handling, preserve newer live turns and tab isolation. Avoid arbitrary sleeps as sole fix.
2. Preserve trustworthy current-context metrics, use postTokens appropriately; synthetic zero usage must not overwrite real context. Unknown is not zero. Do not corrupt cumulative cost/tokens.
3. Handle SDK local-command/synthetic artifacts consistently between live and replay, preserve compaction summary semantics. Do not sort all transcript timestamps or blanket-drop genuine assistant/user messages. Specific screenshot 'No response requested.' provenance remains unverified.
4. Recovery timers scoped per session/conversation and cleaned up appropriately. Two concurrent compactions cannot cancel each other.
5. Neutral marker wording if values do not demonstrate shrinkage; avoid unnecessary unrelated refactors.
6. Targeted regression tests for stale then ready JSONL, consistent snapshot, concurrent sessions, zero synthetic usage, artifact replay and existing load deduplication.

## Investigation starting points

- libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts (completion/reload, singleton timer)
- libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts (reload, context hydration)
- libs/frontend/chat-state/src/lib/tab-manager.service.ts (compaction context reset)
- libs/backend/agent-sdk/src/lib/session-history-reader.service.ts (multiple reads/context snapshot)
- libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts (projection drops metadata)
- libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts (artifact handling)
- libs/backend/agent-sdk/src/lib/message-transform/message-transform-helpers.ts (live injected content filter)
- libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts

Read actual code and scoped CLAUDE.md before designing. All product edits and test execution must target the dedicated worktree, not the root checkout. Ptah index defaults to root: use explicit absolute paths and verify cwd for commands. Do not restart the app or modify real session logs. No task carriers in other folders and no nested task creation.
