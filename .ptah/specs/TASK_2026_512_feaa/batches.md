# Batches

`libs/shared` is **already done** and is the frozen contract between the two
lanes. Neither lane may edit it.

```ts
// libs/shared/src/lib/types/execution/stream-background.ts
export interface SessionTurnState {
  readonly phase: SessionTurnPhase;
  readonly revision: number;
  readonly backgroundTasks: readonly SdkBackgroundTaskSummary[];
  readonly sessionCrons: readonly SdkSessionCronSummary[];
  readonly terminalReason: SdkTerminalReason | null;
  readonly lastAssistantMessage?: string | null; // NEW
  readonly error?: SdkAssistantMessageError;
  readonly timestamp: number;
}

export const TURN_RECAP_MAX_CHARS = 280; // NEW
```

`TurnStateEvent extends FlatStreamEvent, SessionTurnState`, so both new fields
ride the existing `turn_state` chunk-stream event with no further plumbing.
`TurnStateApplier` passes the whole event into
`TabManagerService.applyTurnState` and whitelists nothing.

## Lane A — backend (`@ptah-extension/agent-sdk`)

Make `terminalReason` real and carry the recap text.

| File | Change |
| --- | --- |
| `message-transform/result-message.transformer.ts` | Stop discarding `_sdkMessage`. Narrow it to the `result` message, read `terminal_reason`, pass it to `settleTurn`. |
| `helpers/session-turn-state.registry.ts` | `settleTurn(sessionId, terminalReason?)`. The result message's reason is authoritative; fall back to the snapshots. Carry `lastAssistantMessage` out of the Stop snapshot onto the committed state, and into `toTurnStateEvent`. |
| `helpers/stop-hook-handler.ts` | Put `input.last_assistant_message` into `recordStop`, truncated to `TURN_RECAP_MAX_CHARS`. |
| `helpers/stop-failure-hook-handler.ts` | Same for the failure snapshot. |
| `types/sdk-types/claude-sdk.types.ts` | `narrowTerminalReason` reads a hook input that has no such field. Replace it with a narrow over the **result message**. Delete the stale "SDK 0.3.150 … today" comment. |
| the matching `*.spec.ts` | See "Tests" below. |

Rules:

- `settleTurn`'s new parameter is optional. Every other caller keeps working.
- `forceIdle` is unchanged: a stream error or abort has no Stop snapshot and no
  result message, so it still commits `terminalReason: null` and no recap.
- Truncate at the **producer**. Nothing unbounded reaches the chunk stream.
- Do not touch `libs/shared`, `libs/frontend`, or any other backend lib.

## Lane B — frontend (`chat-state` + `notification-center`)

Render the recap and make the session name the link.

| File | Change |
| --- | --- |
| `chat-state/src/lib/tab-manager.service.ts` | `TerminalTurnPulse` gains `lastAssistantMessage: string \| null`, populated from the turn state. Classification logic is unchanged — it becomes correct once Lane A lands. |
| `chat-state/src/lib/tab-manager.notification-pulse.spec.ts` | Add a case for `terminalReason: null` on an `idle` phase, asserting `'error'`, so the real production shape is pinned and this defect cannot return silently. |
| `notification-center/src/lib/notification-center.types.ts` | `CompletionNotificationEntry` gains `lastAssistantMessage` and an `outcomeLabel`. |
| `notification-center/src/lib/notification-center.store.ts` | Carry both through `appendCompletion`. Derive the outcome label here, not in the template. |
| `notification-center/src/lib/notification-center.component.ts` | Replace the bare `'Failed' : 'Finished'` with the outcome label. Render the recap under the session name. Present the session name as the link that opens the session. |

Outcome labels — map every `SdkTerminalReason`, exhaustively, with
`assertNever` on the default so a future SDK member is a compile error:

| Reason | Label |
| --- | --- |
| `completed` | Finished |
| `max_turns` | Hit the turn limit |
| `budget_exhausted` | Out of budget |
| `blocking_limit` / `rapid_refill_breaker` | Rate limited |
| `api_error` / `model_error` / `image_error` | Provider error |
| `prompt_too_long` | Prompt too long |
| `aborted_streaming` / `aborted_tools` | Stopped |
| `stop_hook_prevented` / `hook_stopped` | Stopped by a hook |
| `tool_deferred` / `tool_deferred_unavailable` | Waiting on a tool |
| `background_requested` | Moved to the background |
| `malformed_tool_use_exhausted` / `structured_output_retry_exhausted` | Gave up retrying |
| `turn_setup_failed` | Could not start |
| `null` | Finished (unknown outcome) |

Rules:

- **The recap is assistant-authored text.** It MUST NOT be bound with
  `[innerHTML]`. Render it as an interpolated string in a truncating element.
  Do not pull in `@ptah-extension/markdown` for a one-line recap.
- `ChangeDetectionStrategy.OnPush`, signals, `inject()`. No new RxJS.
- A `null` recap renders nothing — no empty row, no placeholder.
- Keep the existing grouping, burst, read/dismiss and focus behaviour intact.
- Do not touch `libs/shared` or `libs/backend`.

## Tests

Each lane writes the specs for its own files, in the existing spec files where
they exist.

Lane A must cover, at minimum:

1. A `result` message carrying `terminal_reason: 'completed'` settles the turn
   with `terminalReason: 'completed'` — the case production has never produced.
2. A result message with no `terminal_reason` still settles, at `null`.
3. The result message's reason wins over the Stop snapshot's.
4. `last_assistant_message` reaches the committed state, truncated at
   `TURN_RECAP_MAX_CHARS`.
5. `forceIdle` still commits `null` for both new fields.
