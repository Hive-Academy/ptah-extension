# Code logic review — B2 fix, B3 and B4

## Verdict

**NEEDS_REVISION — 4/10.** The ordinary handoff path is wired: the transport caller is supplied by the namespace, the tool schema rejects forged caller keys, the host uses the caller's cwd and permission level, and the webview adopts a top-level tab (`session-namespace.builder.ts:156-161`; `session-tool-args.schema.ts:89-99`; `chat-session.service.ts:706-743`; `tab-manager.service.ts:1059-1089`). The score is in the 3–4 band because a prompt can still reach logs and telemetry, and common failure and queued-message paths can mislead the user. It is above 1–2 because the end-to-end ordinary path and key caller guards exist.

## Earlier B2 findings

| Earlier finding | Status | Evidence and impact |
| --- | --- | --- |
| Blocking: prompt in logs, Sentry and chat error text | **PARTIAL** | B2 now uses `safeErrorKind` in the handoff start and announce paths (`chat-session.service.ts:745-753`; `child-chat-session-host.adapter.ts:203-219`). But `safe-error-kind.ts:22-30` accepts any `E[A-Z0-9_]{1,30}` code. With a prompt of `SECRET`, a dependency error whose code is `ESECRET` yields `Error (ESECRET)`, which reaches the output log, logger, Sentry and/or chat error text through `session-handoff.service.ts:119,187,247` and `chat-session.service.ts:745-753`. The concrete VS Code sender still logs a raw failed `postMessage` error (`webview-manager.ts:217-224`), and stream failures still log and capture the raw error and may publish its message as `chat:error` (`chat-stream-broadcaster.service.ts:314-335,362-369`). A failure quoting the descriptor or first prompt therefore still breaches the no-prompt rule. Use a finite code allowlist or fixed failure categories, and sanitize the concrete delivery and streaming boundaries. |
| Serious: `tabOpened: true` with no adopted tab | **PARTIAL** | The adapter now returns `uiAnnounced: false` for zero enumerated surfaces or every `sendMessage` returning false (`child-chat-session-host.adapter.ts:197-230`); tests cover those mocked outcomes (`child-chat-session-host.adapter.spec.ts:412-453`). The concrete VS Code sender ignores `postMessage`'s boolean result and returns true when it resolves false (`webview-manager.ts:217-219`). During a disposal race, the adapter can still report `tabOpened: true` even though no webview received the descriptor, prompting the user to close the source session. Return the actual `postMessage` result and test that concrete false result. |

## New findings

### 1. Blocking — B3 tool error handler exposes a thrown prompt

**Evidence:** `session-tool-handlers.ts:438-440,470-482`; `session-namespace.builder.ts:156-161`; `ptah-api-builder.service.ts:1163-1167`; `session-tools.spec.ts:692-707`.

**Failure scenario:** If lazy DI resolution or a handoff implementation throws `new Error('failed for SECRET-CONTINUATION')`, `handleSessionToolCall` copies the raw message into both `logger.warn` and the agent-facing error. The test uses only the fixed text `Session handoff is unavailable`, so it cannot detect this. `takeHeld` also logs a raw thrown message at `session-tool-handlers.ts:448-460`. A dependency failure can disclose the continuation prompt or task text despite the B3 claim that the tool never logs it.

**Suggested fix:** For the handoff tool, map unexpected errors to fixed text or a genuinely finite safe category in both the main catch and held-completion catch; test a thrown message, name and code containing the prompt.

### 2. Serious — the banner command is swallowed by an existing queue

**Evidence:** `session-budget-actions.service.ts:178-193`; `conversation.service.ts:119-135`; `message-dispatch.service.ts:222-249`; `slash-command-interceptor.ts:47-49`; `chat-session.service.ts:943-972`.

**Failure scenario:** During a streaming turn, the user queues `Please check tests` and then clicks **Wrap up & hand off**. The queue becomes `Please check tests\n/session-handoff ...`; the flush sends one combined message. The slash interceptor only recognizes a slash command at the beginning, so the command is plain text and the skill is not invoked. The banner marks the action sent even though no handoff started. B4's A2 caveat is a defect: the user explicitly requested a handoff, and queued text is a routine state. The banner tests mock `sendOrQueueMessage` and do not exercise queue composition.

**Suggested fix:** Preserve a slash command as a distinct queued turn after existing text, then flush messages in order through the same slash-command router. Keep the banner pending until command dispatch is confirmed, or report dispatch failure and re-enable it. Add an integration-level queue test with existing text and the banner action.

### 3. Serious — a failed launch leaves a focused, live-looking tab

**Evidence:** `child-chat-session-host.adapter.ts:134-179`; `tab-manager.service.ts:1059-1089,1175-1196`; `chat-message-handler.service.ts:600-636`; `chat-lifecycle.service.ts:311-361`.

**Failure scenario:** The host announces before it calls `startHandoffSession`. The webview immediately creates a `streaming`, `hasLiveSession: true` tab and focuses it when the source was active. If SDK launch then fails, the host broadcasts `chat:error`, but the webview's error path only logs the error, clears queued input and refreshes sessions. It neither removes the tab nor changes its live/streaming state. The user sees a continuation tab for a session that never started, potentially with no visible error. A lost or late error broadcast makes the same symptom worse.

**Suggested fix:** Give the announce/start protocol a terminal failed-start event with tab cleanup or an explicit failed state and visible reason. Ensure a failed launch does not leave `hasLiveSession` true, and test the announce-success/start-failure path across host and webview.

### 4. Moderate — execute-code namespace bypasses handoff input bounds

**Evidence:** `session-tool-args.schema.ts:83-99`; `session-tool-handlers.ts:427-433`; `session-namespace.builder.ts:156-161`; `session-handoff.service.ts:161-162,213-242,309-335`.

**Failure scenario:** The MCP tool handler validates nonempty bounded prompt, label and absolute path. The exposed `ptah.session.handoff` namespace calls the same service directly without that schema, and the service checks the file path but never checks prompt length or nonemptiness. A direct execute-code call can therefore open a continuation session with an empty prompt or send an arbitrarily large prompt to every webview and the SDK. Its TypeScript input type is not runtime validation.

**Suggested fix:** Validate the shared request at the namespace or service boundary before creating the descriptor, with the same prompt, label and path limits as the MCP tool. Add a direct namespace test for empty and oversized prompts.

## Five logic questions

1. **Silent failure:** An existing queue turns the banner command into ordinary text while `sendWrapUp` records it as sent (`conversation.service.ts:122-126`; `session-budget-actions.service.ts:184-193`).
2. **Unexpected user action:** Clicking the banner after queuing another message does not invoke the handoff skill (`conversation.service.ts:119-135`; `message-dispatch.service.ts:240-249`).
3. **Wrong answer from input:** A prompt fragment shaped like a short uppercase system code passes `safeErrorKind` and enters error reporting (`safe-error-kind.ts:22-30`; `chat-session.service.ts:745-753`).
4. **Dependency failure:** A failed SDK start after a successful announcement leaves a live-looking tab; a thrown namespace or streaming error can expose the prompt (`child-chat-session-host.adapter.ts:134-179`; `tab-manager.service.ts:1175-1196`; `session-tool-handlers.ts:470-482`).
5. **Missing requirement detail:** The protocol has no failed-start state or acknowledgement that a webview actually adopted the tab; it relies on `sendMessage` resolution (`child-chat-session-host.adapter.ts:197-230`; `webview-manager.ts:217-219`).

## Scope and verification

Reviewed the combined diff `cb01a5f16..HEAD`, the requested plan and batch reports, the two earlier B2 findings, root `CLAUDE.md`, changed code and focused specs, and direct callers for the queue, webview delivery, stream error and chat-error paths. The task folder has no `context.md`, `task-description.md` or `code-style-review.md`. B2, B3 and B4 reports record passing focused Jest suites; their mocks do not cover the concrete false `postMessage`, prompt-bearing B3 exception, queued command composition, or failed-start tab state (`child-chat-session-host.adapter.spec.ts:412-453`; `session-tools.spec.ts:692-707`; `session-budget-actions.service.spec.ts:229-249`). No test or build was run for this read-only review. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript window, so it provides no further evidence.


