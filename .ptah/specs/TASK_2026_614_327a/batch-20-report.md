# Batch 20 report: Agent monitor store eviction and rekey (F.5 M2, M4, M5)

Executor: frontend-developer | Project: `@ptah-extension/chat-streaming` | Not committed.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-streaming\src\lib\agent-monitor.store.spec.ts`

## Fixes

Shared: a new constant `MAX_UNMATCHED_SUBAGENT_ENTRIES = 100` caps the entries kept for a subagent that has no record yet. Two
new private helpers serve both clear paths and the rekey path: `dropUnmatchedSubagentEntries(sessionId)` and
`rekeyUnmatchedSubagentEntries(tabId, realSessionId)`.

### Task 20.1 (M2): drop and cap request usage that has no record

- `_subagentRequestUsage` values change from a bare `Map<messageId, usage>` to a `SubagentUsageEntry`
  (`{ parentSessionId?, requests }`). The entry records the session named by its first `message_complete`, through
  `knownSessionId`. The two `sumRequestUsage` call sites now read `.requests`.
- `onSubagentMessageComplete`: when it creates an entry, it calls `evictUnmatchedUsage()`. This keeps at most 100 entries
  whose subagent has no record and drops the oldest first. An entry that has a record is never evicted, because the
  record's totals are re-summed from it.
- `clearSessionAgents` and `forceClearSessionAgents` both drop entries with no record whose session is the cleared one.
  `forceClearSessionAgents` already removed the entries of records it deletes.

### Task 20.2 (M4): rekey pending entries with the placeholder rewrite

- `resolveParentSessionId` now also rewrites `parentSessionId` from the tab id to the real session id in two places: in
  `_pendingBackgroundIdentity`, and in usage entries that have no record. The record created later is then owned by the
  real session, and a later clear of that session finds these entries.

### Task 20.3 (M5): evict pending identities on clear and by size

- `clearSessionAgents` now drops the session's pending identities, as `forceClearSessionAgents` does. Both use the shared
  helper, which replaced the inline loop in `forceClearSessionAgents`.
- `onBackgroundAgentStarted` (no-record branch): a repeated event deletes the key and sets it again, so it moves to the
  newest slot. The map is then trimmed to 100 entries, oldest first.

## Specs added

New block `entries for subagents without a record (F.5 M2, M4, M5)`, 7 tests:

- `clearSessionAgents` drops early usage and pending identities of the cleared session only.
- `forceClearSessionAgents` drops early usage of the cleared session.
- Usage of a subagent that has a record survives a tab close and is still summed.
- The usage cap is 100. The oldest entry is dropped and an entry with a record is never dropped.
- The pending identity cap is 100. The oldest entry is dropped.
- The rekey moves pending identities and early usage from the tab id to the real session.
- A clear of the resolved session drops the entries that had held the tab id.

## Checks

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p chat-streaming --parallel=2` | 0 |
| `npx nx test chat-streaming --skip-nx-cache --testPathPatterns=agent-monitor.store.spec --maxWorkers=2` | 0 (1 suite, 111 tests passed) |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

The first run-many attempt passed `-- --maxWorkers=2` through to every target. `ngc` rejected it with TS5023, an error in
the invocation and not in the code. The rerun without the flag exited 0.

No baseline PNGs were rewritten (`git status` shows none).

## Open notes

- Both caps use one value, 100, and evict by insertion order. The usage cap scans the usage map only when a new subagent
  key appears, not on every message.
- A usage entry whose first message had an empty `sessionId` cannot be matched by a session clear. Only the cap bounds it.
- I touched no files outside the batch. The other modified files in the tree belong to Batches 16-19.
