# Review: merge-main fix (defects 1-3 of review-merge-main-a7036819e.md)

Verdict: APPROVE
Score: 8/10
Review family: claude vs codex

## Defects

1. **Low** - A top-level native Codex start stores `[]` where a Claude start stores no roots.
   - Location: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1395` (`input.pluginConfigAncestorRoots ?? []`).
   - Scenario: `chat:start` (`:993`) passes no roots. A Claude row has no roots and reads as `legacy`. A Codex row reads as `valid []`. For a top-level session the execution root is the workspace, so `restoreLineage` resolves both to `[]`. The two runtimes do not behave differently today, but the stored rows are not the same.
   - Fix (optional): pass `input.pluginConfigAncestorRoots` through unchanged and let `withCodexStartLineage` skip the scope when the value is `undefined`. Otherwise, add a comment that `[]` is intentional for native rows.

## Checked

- **Defect 1 (persist roots): fixed.**
  - `session-metadata-store.ts:698-711` adds `withCodexStartLineage`. It validates the roots and runs the launch in an `AsyncLocalStorage` scope.
  - `updateCodexExecution` reads the scope (`:998`) and sets roots only when the existing row has none (`:1128-1130`), so main's immutable-lineage rule holds.
  - The write still goes through the native `persistMetadata` path. The `_saveInternal` direct-write guard is not changed.
  - The adapter awaits `persistMetadata` inside `open()` (`codex-chat-adapter.ts:285`), so the write runs inside the scope.
  - Concurrent starts are isolated by the scope. The store spec covers this case.
- **Defect 2 (legacy lock-in): fixed.** `upgradeLegacyLineage` returns early for rows with `codexExecution.runtime === 'codex-app-server'` (`chat-session.service.ts:2351-2352`). The upgrade is skipped and no derived roots are written. New native rows have real roots from defect 1, so they read as `valid`.
- **Defect 3 (pendingLineage): fixed.** The tab entry is deleted only on the Codex branch, after the start returns (`:1400`). The Claude path still relies on the session-ID-resolved callback, so its entry is not cleared too early. The catch path still clears failed starts.
- **Key leak claim: confirmed.**
  - Codex start (`:1389-1392`) and Codex resume (`:2286-2288`) set `pluginConfigAncestorRoots: undefined`.
  - The Claude start and resume configs keep the key.
  - The Codex classifier skips undefined values (`codex-chat-profile-options.ts:52`).
  - The spec asserts `rejected` is `[]` and the key is undefined.
- **Specs:**
  - The removed lines are fixture changes only: `/original-workspace` became real temporary folders, and the store mocks were completed.
  - No `expect` assertions were removed.
  - New assertions cover lineage handoff, Codex option cleanliness and pendingLineage cleanup.
  - The store spec adds immutability, concurrency and stale-upgrade cases.
- **MCP:** no MCP wiring was removed. The two removed `mcpServerRunning: false` lines are fixture lines that were rewritten with new paths. `mcpServersOverride` and `mcpServerRunning` stay in both configs.
- Not run: tests, typecheck and lint, per the lane rules.
