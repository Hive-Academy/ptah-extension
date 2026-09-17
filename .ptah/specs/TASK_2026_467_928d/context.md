# TASK_2026_467 — ptah-cli agent output is never persisted on Electron

## User report (2026-09-17)

The CLI agent strip lost its agents. After closing and reopening the chat session the
agents came back, but the `ptah-cli` tab had a grey dot and no content, although it had
shown messages before.

## Evidence — `%APPDATA%\ptah\logs\Ptah Electron-2026-09-17.log`

The same failure follows every ptah-cli agent exit today, and never a codex exit:

| Agent | Exit | Persist result |
|-------|------|----------------|
| ptah-cli (ollama cloud) `7d6e89d7-…` | 13:06:22.554Z completed | 13:06:29.892Z `Failed to persist CLI session reference after retries` |
| ptah-cli (ollama cloud) `ff53b537-…` | 14:01:59.221Z completed | 14:02:06.482Z same error |
| ptah-cli (earlier run) | ~11:00Z | 11:00:44.310Z same error |
| codex `3f14fa9f-…` | 13:05:55.972Z completed | 13:05:56.004Z `Stored agent output … segments: 9, streamEvents: 0`, then `CLI session reference persisted` |

Error body:

```
ElectronStateWorkerProtocolError: Worker message contains a non-cloneable JSON value
    at … executeReplaceJsonSequence (main.mjs)
```

## Code

The error is thrown by the value walk in
`libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`
(`:683`, `:831`, `:1056`): the `default` branch of `typeof value`, which catches
`undefined`, functions, `bigint` and `symbol`.

Codex stores `streamEvents: 0`; the ptah-cli run stored 563 stream events
(`PtahCliStreamLoop turn 0 complete: streamEvents 563`). Leading hypothesis: a ptah-cli
stream event carries a property whose value is `undefined` (valid for `JSON.stringify`,
which drops it, but rejected by the worker walk). Confirm by reproducing with a recorded
ptah-cli event set before fixing.

## Scope

- Find the offending value in the ptah-cli output that `SessionMetadataStore` persists
  (search "Stored agent output" and "Failed to persist CLI session reference").
- Fix at the boundary: normalise the persisted payload to JSON-safe values
  (drop `undefined` keys) before it reaches the state worker, OR make the protocol walk
  treat an `undefined` object property the way `JSON.stringify` does. Pick one, with a reason.
- The error must name the offending path (the walk already tracks `path` in the
  generator at `:1031-1047`), so the next failure is diagnosable from the log.

## Acceptance criteria

1. A completed ptah-cli agent on Electron logs `Stored agent output` and
   `CLI session reference persisted`, with no protocol error.
2. After closing and reopening the parent session, the ptah-cli tab shows its segments.
3. A spec reproduces the failure with a ptah-cli event that has an `undefined` property
   (or whatever value the investigation finds) and passes after the fix.
4. A persistence failure logs the JSON path of the rejected value.
