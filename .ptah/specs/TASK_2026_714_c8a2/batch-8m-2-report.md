# Batch 8m-2 report — core passes real tool results and reasoning deltas (G1 core, G3 core)

## Summary

The translator now forwards the real bounded tool results (command output, exit
code, MCP error text and result content, dynamic-tool content items) instead of
the invented "Codex could not complete this operation." text, and models the two
reasoning delta notifications (`item/reasoning/summaryTextDelta`,
`item/reasoning/textDelta`) so reasoning streams as `reasoning` phase `delta`
events. Unknown items and unmodeled notifications still never echo payloads.
Two new OPTIONAL fields (`exitCode`, `errorText`) extend `toolCompleted` so
agent-sdk compiles with no consumer change. No verification was run (per batch
rules; the team-leader verifies).

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-event-translator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`
  (unmodeled-notification list changed: the two reasoning methods left it)

## G1 — real tool results (codex-event-translator.ts)

- `boundText` / `boundJson` (codex-event-translator.ts:63-79) bound every
  forwarded string leaf to `MAX_TOOL_OUTPUT_CHARS` (10 000, named constant,
  exported, codex-event-translator.ts:60); a cut string gets the trailing
  marker `"\n[output truncated]"`. Structure, arrays and non-string leaves
  pass through.
- `commandExecution` completed (codex-event-translator.ts:334): `output` is
  the real `aggregatedOutput` (bounded) or `null` — for completed, failed AND
  declined status; `exitCode` is forwarded whenever the server reported one.
  No text is invented for failures or declines.
- `mcpToolCall` completed (codex-event-translator.ts:353): `output` is
  `{content, structuredContent?}` reconstructed from the server result
  (bounded; `_meta` is protocol plumbing and is NOT forwarded) or `null`, for
  completed and failed calls alike; `errorText` carries the server's
  `error.message` (bounded) when `error` is present; `status` is unchanged
  (`error` present -> `failed`).
- `dynamicToolCall` completed (codex-event-translator.ts:412): `output` is
  its own `contentItems` (bounded) or `null`, for success AND failure; no
  invented text. `status` unchanged (`success === false` -> `failed`).
- `fileChange`, `collabAgentToolCall`, `webSearch` outputs are unchanged
  (out of the named G1 scope; see "Not done").
- The unknown-item rule (codex-event-translator.ts:470) and the
  unknown-notification rule (codex-event-translator.ts:252, plus
  `invalid()` correlation gating) are untouched; `safeError` codes
  `commandFailed`/`toolFailed` no longer exist (no consumer pinned them;
  repo-wide grep found only docs and the translator).

## G3 — reasoning deltas (schemas, validator, translator)

- Schemas (codex-protocol-schemas.ts:423-432): `reasoningSummaryTextDelta`
  `{...itemIds, summaryIndex: integer, delta: string}` and
  `reasoningTextDelta` `{...itemIds, contentIndex: integer, delta: string}` —
  zod strip objects (server notifications drop extensions, required fields
  stay strict), matching the pinned ReasoningSummaryTextDeltaNotification /
  ReasoningTextDeltaNotification (schema.json:17980-18039: all five fields
  required, indices int64).
- Registration (codex-protocol-validator.ts:23-27): the two schemas are merged
  into the exported `codexNotificationSchemas`. Both methods stay in the
  pinned manifest allowlist (like every other modeled method), and
  `isUnmodeledCodexNotification` now returns false for them — they left the
  unmodeled surface. `validateCodexFrame`/`validateCodexParams` now model
  their payloads; a frame with an `id`, or params missing a required field,
  throws `CodexProtocolError` like every other modeled notification.
- Translation (codex-event-translator.ts:140-176): each non-empty delta emits
  `{type: 'reasoning', itemId, phase: 'delta', text: delta}` following the
  `item/agentMessage/delta` pattern; an empty delta emits no event. The
  translator records which item ids streamed summary deltas
  (`summaryItems`, turn-keyed; released on `turn/completed` and `dispose`);
  `item/reasoning/textDelta` is silent for an item once a summary delta
  streamed (the completed item's summary is authoritative). The
  `item/completed` `phase: 'final'` reasoning event is unchanged.

## New optional fields and their exact semantics (8m-4 consumes these)

`codex-runtime.types.ts` `toolCompleted` member:

- `exitCode?: number` — the process exit code the server reported for the
  item (commandExecution today). Present ONLY when the server reported a
  number; wire `null`/absent stays absent (spread-omitted, never `null`).
  `0` is a real exit code — consumers must not test truthiness. Reported for
  every item status; a declined command normally reports none.
- `errorText?: string` — the server-reported error message of a failed tool
  call (mcpToolCall `error.message` today), length-bounded by
  `MAX_TOOL_OUTPUT_CHARS` with the `"[output truncated]"` marker when cut.
  Absent for every other tool kind and when the server reported no error
  object. The failure itself is signaled by `status: 'failed'` alone.
- `output` (existing field, semantics changed): see G1 above. For 8m-4: a
  failed Bash tool_result is built from `output` (real text) + `exitCode` +
  `isError`; a declined tool is `status: 'cancelled'` with `output: null` —
  8m-4 supplies Claude's denial result text itself; MCP failures pair
  `errorText` with the result content in `output`.

### Reasoning contract for 8m-4 (duplication avoidance)

Deltas stream per itemId; the final `phase: 'final'` event for the SAME itemId
carries the authoritative full text and is still emitted even when deltas
streamed. A consumer must REPLACE the accumulated delta text for that itemId
with the final text (never append), and open no thinking block for an empty
final (`text: ''`) or when no delta arrived. `codex-chat-events.ts:166-178`
already keys reasoning blocks per itemId and republishes content on final —
the replace-on-final channel exists.

## Specs

codex-event-translator.spec.ts — new per-case specs:
failed command with output and exit code + MCP error text (spec:418); failed
command with empty output, exit code only, `exitCode: 0` carried and absent
stays absent (spec:457); output above the cap is cut and marked, command text
and MCP content strings (spec:479); declined command -> cancelled, `null`
output, no invented text (spec:514); interrupted -> cancelled vs failed, incl.
collabAgentToolCall `interrupted` (spec:528); MCP error with structured content
plus `_meta` dropped (spec:552); dynamic tool failure with its content items
(spec:584); reasoning summary deltas then a different final text, sequence
preserved (spec:607); textDelta streams, then a summary delta suppresses later
textDelta (spec:635); empty deltas emit nothing, an empty summary delta does
not claim the item, completed empty item still emits final `''` (spec:663);
malformed reasoning deltas error through the boundary (spec:690). The old
"sanitizes retry, terminal, command, and MCP errors" test is split: retry and
terminal errors stay sanitized (spec:390 — turn-level errors keep the generic
text, unchanged scope); command/MCP forwarding moved to the new specs because
D15 replaces the old invented text with the real bounded output.

codex-protocol-validator.spec.ts — the two methods were added to the
hand-written notification list (spec:196-199, required-fields fixtures for the
`covers every modeled method` and `validates %s notification` tests) and a new
test pins the frame boundary: valid params accepted, extensions stripped-not-
rejected, missing index rejected, `id` rejected (spec:552). The existing
field-name tests (`models %s with pinned ServerNotification field names`)
pick the two methods up automatically from the merged table.

## Decisions

- Decision: register the two notification schemas in the validator instead of
  `codex-protocol-methods.ts`.
  Options: (a) add them to the methods table (correct home, file outside this
  batch's allowed set); (b) keep them unmodeled and parse in the translator
  (leaves the frame boundary unmodelled — against D12 and the task); (c)
  register in the validator, which already re-exports the table and owns the
  unmodeled surface.
  Evidence: only `codex-protocol-validator.ts` imports
  `codex-protocol-methods` (repo grep); `codex-runtime.ts` imports the table
  from the validator, so the merge is invisible to every consumer.
  Reversible: a later batch can move the two entries into the methods table as
  a pure move.
- Decision: bound per string leaf (`MAX_TOOL_OUTPUT_CHARS` = 10 000) instead
  of a total byte budget.
  Options: (a) per-string cap (simple, no structure loss); (b) serialize and
  budget the whole output (loses the structured shape 8m-4 needs); (c) also
  cap array lengths (speculative — array sizes come from the pinned server).
  Evidence: the risk table names env-dump strings; the cap covers exactly
  that. Reversible: the constant is exported; tighten later without contract
  change.
- Decision: carry the MCP error as a typed `errorText` field and keep result
  content in `output` (reconstructed, `_meta` dropped).
  Options: (a) `{error: text}` inside `output` (old shape, forces json
  narrowing in 8m-4); (b) typed optional field + content in `output`.
  Evidence: 8m-4 must build Claude's MCP tool_result (content + isError);
  typed fields avoid arbitrary-json digging. `_meta` is modeled json but is
  protocol plumbing, and the G1 rule says never echo arbitrary payloads.
  Reversible: field addition only.
- Decision: suppress `textDelta` for an item after a summary delta streamed
  (translator state, turn-scoped).
  Options: (a) stateless — emit both (double text if a server ever sends both);
  (b) suppress in the translator (task wording: "textDelta used only when the
  item has no summary deltas"); (c) leave it to 8m-4.
  Evidence: the completed item prefers `summary` over `content`
  (codex-event-translator.ts:312-316), so summary deltas win during streaming
  too. Reversible: drop the set to return to stateless.
- Decision: keep the reasoning `phase: 'final'` emission on item/completed
  unchanged (deltas + final both emitted; replace-on-final is the consumer
  contract).
  Evidence: the task text — "The final reasoning on item/completed is still
  emitted". Reversible: 8m-4 could ask for a streamed flag instead.

## Secret-exposure note

Forwarded tool output is the server's real output, bounded to 10 000 chars per
string with a visible `"[output truncated]"` marker — the same exposure
Claude's Bash tool output already has in this app (parity, per the round risk
table). Turn-level errors (`error` notification, `turn/completed` error) stay
generic; unknown items/notifications still never echo payloads. MCP `_meta`
is dropped. This is accepted residual exposure, not a leak fix.

## Not done

- `codex-protocol-methods.ts` was NOT edited (outside the allowed file set):
  the schema registration lives in `codex-protocol-validator.ts`. Recommend a
  pure move of the two entries into the methods table in a later batch.
- `webSearch` results and `fileChange` diffs are not length-bounded (outside
  the named G1 scope; they were forwarded unbounded before too). Tightening
  them is a one-line `boundJson` wrap if the review wants it.
- `collabAgentToolCall` output stays `{receiverThreadIds}`; its agent-state
  messages are not forwarded.
- No verification, lint, typecheck or tests were run (batch rule 1). Expected
  verify: `npm run verify -- -p @ptah-extension/codex-runtime` and
  `npm run verify -- -t typecheck -p @ptah-extension/agent-sdk`. agent-sdk
  compiles unchanged (fields optional); its runtime display text for failed
  codex tools changes until 8m-4 formats the Claude shape — planned.