---
id: TASK_2026_293
status: done
type: bugfix
title: >-
  PreCompact is the one hook that trusts its closure over the SDK's payload, so
  auto-compaction on a fresh session curates nothing
description: >-
  `SdkQueryOptionsBuilder.createHooks` builds every hook with `sessionId ?? ''`
  because the SDK's canonical session id does not exist until the system `init`
  message arrives — after the options object is constructed. Twelve of the
  thirteen hook handlers already handle that: each reads `input.session_id` and
  falls back to the closure only when the payload has none. `PreCompact` does
  not — it uses the captured `''` for the callback payload, for
  `usageTracker.getCumulativeTokens()` and for its logs. So on any session that
  was NOT resumed, the first auto-compaction fans out `{ sessionId: '' }`;
  `MemoryCuratorService` hands that to `SdkTranscriptReaderAdapter.read`,
  `validateSessionId` rejects the empty string, and `readHistoryMessages` logs
  `Failed to read history as messages` at ERROR with a full stack and returns
  `[]`. The curator then falls back to placeholder curation, so the compaction
  that was supposed to feed memory feeds it nothing. `PostCompact`, in the same
  file, already resolves `input.session_id ?? sessionId` — the fix is to make
  PreCompact match it.
updated: '2026-08-25T21:21:58.853Z'
---

# PreCompact must resolve its sessionId from the hook payload

Machine-owned metadata carrier. Prose lives in `./context.md`.
