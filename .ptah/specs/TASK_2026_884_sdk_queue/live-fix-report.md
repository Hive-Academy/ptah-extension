# Live follow-up queue fixes

## Defect 1: follow-up and final text ordering

`session-stream-pump.service.ts:163-215` correctly claims a turn before yielding a prompt and emits `delivered` when it yields the next one. `session-registry.service.ts:702-714` clears that claim and wakes the pump. The premature transition was `stream-transformer.ts:776-782`: it called `onTurnEnd` immediately on reading the SDK `result`, before transforming and yielding the result's terminal `turn_state` at lines 1114-1149. The pump could deliver the next prompt and push its user bubble while the previous turn was still being finalized by the renderer.

Moved `onTurnEnd` to `stream-transformer.ts:1150`, after the result's events have been yielded. Assistant text, `tool_use`, `tool_result`, and assistant final text do not clear the pump claim; only the result path does. Abort and teardown remain in their existing paths. `follow-up-queue.service.ts:173-181,461-494` already inserts the user bubble on `delivered` or `steered`, not on `queued`; no renderer queue edit was needed for that part.

Specs: `stream-transformer.spec.ts:2331` checks that release follows consumption of the result `turn_state`, and updates the delayed-pricing ordering assertions. `session-stream-pump.service.spec.ts:127` checks the held prompt remains queued across assistant text, tool use, tool result, and final text boundaries until `result` releases it.

## Defect 2: hidden card Error after completion

`chat-message-handler.service.ts:586-590` routes hidden `statusOnly` terminal events to `TabManagerService.applyHiddenTurnStateStatus`. That method at `tab-manager.service.ts:1999-2009` set `status: loaded` but retained a prior `lastTerminalReason`. `compact-session-card.component.ts:583-587` maps a summary with an error tone to the rail Error state, so a stale failure remained visible until the tab was selected and its retained stream replayed.

The hidden status copy now updates `lastTerminalReason` from the terminal event alongside `status`. `tab-manager.last-terminal-pulse.spec.ts:78-85` covers a hidden failure followed by normal completion and checks the stale error reason is cleared.

## Verification

- `stream-transformer.spec.ts`: 116 passed.
- `session-stream-pump.service.spec.ts`: 26 passed.
- `tab-manager.last-terminal-pulse.spec.ts`: could not start; Jest's esbuild worker failed with `spawn EPERM`.
- Scoped Ptah diagnostics: no errors in changed files. The chat-state project has 27 existing diagnostics in sibling specs; the requested changed files have none. The new pump spec has zero diagnostics.
- No live Electron rerun; Electron e2e files were untouched as requested.

## Decisions

- Release after yielding the result terminal event rather than at result receipt. The SDK result is the definitive turn boundary, and the stream consumer must observe that boundary before the next prompt is admitted. This is reversible.
- Copy the hidden terminal reason into tab status. The hidden card already derives its state from that reason, and the visible path copies it at `tab-manager.service.ts:1947`. This is reversible.
