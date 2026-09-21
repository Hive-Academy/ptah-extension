# Context

## Reported symptom

Every card in the Notification Center reads **"Failed"**, whatever the session
did. Observed on two unrelated sessions in the `ptah-extension` workspace
(`session lags`, `evaluate openbot`), both of which had finished normally.

## Root cause — `terminalReason` is structurally always null

The label is decided by one expression,
`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1283`:

```ts
state.phase === 'idle' && state.terminalReason === 'completed'
  ? 'success'
  : 'error';
```

`terminalReason` never holds `'completed'` in production. The chain:

1. `SessionTurnStateRegistry.settleTurn` commits
   `terminalReason: failure?.terminalReason ?? stop?.terminalReason ?? null`
   (`session-turn-state.registry.ts:372`).
2. `stop.terminalReason` is whatever the `Stop` hook recorded
   (`stop-hook-handler.ts:58`, `narrowTerminalReason(input)`).
3. `narrowTerminalReason` casts the hook input and reads `.terminal_reason`
   (`claude-sdk.types.ts:630`).
4. **`StopHookInput` has no `terminal_reason` field.** Verified against the
   installed `@anthropic-ai/claude-agent-sdk@0.3.278`: `sdk.d.ts:9058-9074` for
   `StopHookInput`, `sdk.d.ts:9051-9056` for `StopFailureHookInput`, and
   `sdk.d.ts:171-197` for `BaseHookInput`. None declares it. The cast yields
   `undefined`, the helper returns `null`.

So a healthy turn settles as `phase: 'idle'`, `terminalReason: null`, and the
frontend classifies it as an error.

The stale comment on `narrowTerminalReason` ("SDK 0.3.150 does not expose
`terminal_reason` on the typed hook input interfaces **today**") records the
assumption that the field was present at runtime behind an incomplete type. It
is not. The SDK puts `terminal_reason` on the **result message**
(`sdk.d.ts:5401` and `sdk.d.ts:5471`), and the SDK bridge builds it there —
`bridge.mjs` composes `{type:"result", … terminal_reason}`.

Ptah already receives that message. `ResultMessageTransformer.transform` takes
it as `_sdkMessage` and discards it
(`result-message.transformer.ts:16`). The correct value passes through the
process and is thrown away one call before it is needed.

## Why no test caught it

`tab-manager.notification-pulse.spec.ts:74` builds its success case by passing
`terminalReason: 'completed'` directly into the fake turn state. The value the
spec supplies by hand is the one production can never produce.

## Scope of the classification rule

`shouldEmitTerminalPulse` (`tab-manager.service.ts:1230`) only fires for
`phase === 'idle' | 'failed'`, so `awaiting-background` and `sleeping` never
reach the classifier. `terminalReason` is the single discriminator, and it is
the only thing that has to be fixed for the label to become correct.

## Requested enhancement

Beyond the fix, the card should carry a **recap** and a **session link**:

- Recap text: the turn's last assistant message, truncated. The `Stop` hook
  already delivers it as `last_assistant_message` and `StopHookHandler` already
  reads it for `StopCallbackRegistry` — `recordStop` drops it.
- Outcome text: a human-readable rendering of `terminalReason`
  ("Hit the turn limit", "API error", …) instead of the bare "Failed".
- The session name becomes the affordance that opens the session. The store
  already focuses on activation (`activateCompletion` →
  `NOTIFICATION_FOCUS_ROUTER`); the name is not presented as a link today.

Decision (user, 2026-09-21): recap = **last assistant message + outcome**.
Activity statistics (tool counts, files touched, duration, cost) were offered
and **declined** — they need new aggregation out of `chat-execution-tree` and
are not part of this task.

## Unrelated findings from the same investigation

Real, separate, NOT the cause of these cards. Recorded so they are not lost:

- `@ptah/skills-backlog-cleanup` fails hourly at minute 41 — 37 runs with
  `error_message: 'unexpected-error'`.
- `@ptah/daily-backup` fails with `No handler registered under 'backup:daily'`
  — 8 runs.

Both are in `job_runs` in `~/.ptah/state/ptah.sqlite`.
