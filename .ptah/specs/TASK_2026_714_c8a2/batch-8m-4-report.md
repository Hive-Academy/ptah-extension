# Batch 8m-4 report — protocol parity for tool inputs, tool results and thinking (D15)

Native Codex chat now produces Claude's UI contracts at the backend
translation layer: Bash input is exactly Claude's `BashToolInput`, failed and
declined commands produce Claude's tool_result shapes (real output, exit-code
line, canned denial text, `isError` true), MCP errors carry the server's error
text, and reasoning follows the 8m-2 replace-on-final contract with no empty
thinking blocks. No frontend file changed; no Codex special case was added to
any renderer; MCP is untouched. No verification was run (batch rule 1; the
team-leader verifies and commits).

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-tool-presentation.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-tool-presentation.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.spec.ts`

## A — tool input parity

Claude reference: `BashToolInput` is `{ command, description? }` and nothing
else (`libs/shared/src/lib/type-guards/guards/exec.ts:7-18`; the render guard
`isBashToolInput` reads `command` only, exec.ts:178-185).

Done in `presentCodexTool` (codex-tool-presentation.ts:64-77):
`commandExecution` with a string `command` now presents
`{ toolName: 'Bash', toolInput: { command, ...(description ? { description } : {}) } }`.
`cwd` and every other native key are dropped, so no "Arguments" section can
appear. A non-string command still falls back to the raw name (total function,
unchanged rule). `presentCodexApproval`'s `command` case (codex-tool-presentation.ts:202-218)
presents the command through the same helper, so the permission card input
matches too.

Other tools checked against Claude, no change possible:
- `Write`: Claude's Write input is `{ file_path, content }` (fs.ts:187-196).
  A Codex change carries only `{ path, diff, kind }` (codex-protocol-schemas.ts:258-276)
  — no content exists, so a faithful mapping is impossible; the current
  `{ file_path, changes }` stays (the header still renders the clickable path).
- `Edit`: Claude's Edit input needs `old_string`/`new_string` (fs.ts:198-209).
  A unified diff cannot supply them; the raw `fileChange` name stays by design.
- `Read`: Codex sends no read item kind; nothing to map.
- MCP: the tree name maps to `mcp__server__tool` and the input passes through
  verbatim, exactly as Claude forwards MCP tool inputs. Unchanged.

## B — tool_result parity

Claude references: a tool_result event is content plus `is_error ?? false`
(`libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts:57-68`);
Claude's hard-deny path substitutes the canned denial string
"The user doesn't want to take this action right now. STOP what you are doing
and wait for the user to tell you how to proceed."
(sdk-permission-handler.ts:1076-1080; the string is pinned in
TASK_2026_471_b3d1 `diagnosis:25` from claude 2.1.270).

Done:
- New `presentCodexToolResult` (codex-tool-presentation.ts:138-158) plus
  `CODEX_DENIED_TOOL_RESULT_TEXT` (codex-tool-presentation.ts:110-111) and the
  `CodexCompletedTool` interface (codex-tool-presentation.ts:114-123).
- `CodexChatEvents.toolCompleted` (codex-chat-events.ts:214-233) now shapes
  the result like Claude's tool_result. `toolCompleted` carries no tool name,
  so the projection records raw native names from `toolStarted` per tool id
  (`tools` map, codex-chat-events.ts:70, set at :197, deleted at :218, cleared
  at terminal :271) and passes the name with the completion.
- Case mapping:
  - cancelled (declined) → `{ output: CODEX_DENIED_TOOL_RESULT_TEXT, isError: true }`
    — Claude's denial result text.
  - failed or non-zero-exit command → content text = real output plus the
    trailing line `Command failed with exit code N`, `isError` true; empty
    output → the line alone; no exit code → the real output alone.
  - completed command with exit code 0 or none → output unchanged,
    `isError` false (today's success shape).
  - failed MCP call → `output` = the server's `errorText`, `isError` true;
    without `errorText` the result content passes through with
    `isError` true.
  - completed MCP and unknown tools → output passthrough, `isError` false.
  - A completion whose `toolStarted` was never seen (name undefined) passes
    the output through with the status's flag.
- `exitCode` is tested as `!== 0`, never truthiness (0 is a real success
  exit code, per the 8m-2 contract).

## C — thinking parity

Claude references: Claude's stream drops empty deltas
(stream-event.transformer.ts:463 and :503), so no empty thinking block opens;
the frontend accumulator SETS a complete-source thinking_delta as the whole
block content (accumulator-core.service.ts:359-367) and the persistence filter
keeps that replace semantics on reload (persisted-content-filter.ts:355-357).

Done:
- One `thinking_delta` per reasoning `delta` phase event
  (codex-chat-events.ts:186-194); the runtime contract guarantees non-empty
  deltas.
- On `final`, no duplicate stream delta: the projection publishes the whole
  final text once through `callbacks.content` (codex-chat-events.ts:170-185),
  which the publish boundary emits as ONE complete-source `thinking_delta`
  (codex-chat-event-callbacks.ts:85-92). The accumulator replaces the streamed
  deltas with it (replace-on-final, per the 8m-2 contract; see decisions).
- An empty reasoning final (`text: ''`) emits no events and calls no callback
  (codex-chat-events.ts:175), so no empty thinking block opens.
- A non-empty final with no deltas still publishes the full text.
- The publish boundary is total as well: empty complete content (text or
  reasoning) publishes nothing (codex-chat-event-callbacks.ts:85), matching
  Claude's empty-delta drop.

## D — parity specs (compare against the Claude path)

codex-tool-presentation.spec.ts:
- `presentCodexTool` command cases pin Claude's `BashToolInput`: cwd dropped,
  description kept, every other native key dropped, non-string command falls
  back to the raw name; `presentCodexApproval` command cards show the command
  only.
- New `presentCodexToolResult` describe (spec:212-323) pins, with the Claude
  reference comment (user-message.transformer.ts:57-68): successful command
  exit code 0; failed command output + exit code; failed command exit code
  only; completed non-zero exit (sandbox denial); failed command without exit
  code; declined → denial text; MCP error → errorText; failed MCP without
  errorText → passthrough; completed MCP; unknown-name completion.

codex-chat-events.spec.ts:
- Reasoning: deltas then final — content called once with the full text, final
  emits no stream delta; final without deltas publishes the text; empty final
  opens no block and calls no callback.
- tool_result projections: failed command (output + exit code), exit-code-only
  line, successful command keeps today's shape with exit code 0, declined
  command → denial text, failed MCP → errorText. The pre-existing
  "preserves stable tool IDs and failed results" test still passes (a failed
  command without exit code keeps its output as content).

codex-chat-event-callbacks.spec.ts:
- Empty complete content (reasoning and text) publishes nothing — the
  boundary counterpart of Claude's empty-delta drop.

## Decisions

- Decision: failed Bash content ends with the line
  `Command failed with exit code N` after the real output.
  Options: (a) output only, no exit line — loses the exit code Claude's Bash
  result carries; (b) a prefix line before the output; (c) trailing line
  after the real output. Evidence: no in-repo fixture pins Claude's exact
  failed-Bash wording; the app's own label is "Command failed"
  (tool-status.utils.ts); the trailing line keeps the real output first, the
  way Claude's Bash content reads. Reversible: one constant
  (`FAILED_COMMAND_EXIT_LINE`, codex-tool-presentation.ts:101) — a wording fix
  is one edit.
- Decision: replace-on-final via the existing complete-source content channel,
  not remainder deltas.
  Options: (a) stream the remainder as deltas after the final; (b) publish the
  whole final text once as a complete-source thinking_delta. Evidence: the
  accumulator SETS complete-source deltas for the whole block
  (accumulator-core.service.ts:359-367) and persistence keeps replace
  semantics (persisted-content-filter.ts:355-357), so (b) cannot duplicate;
  (a) duplicates if a server ever re-sends overlapping text and needs new
  projection state. Reversible: switch the final branch to remainder deltas
  (the textFinal pattern) without a contract change.
- Decision: guard empty content at BOTH the projection (empty final → no
  events) and the publish boundary (empty text → publish nothing).
  Options: (a) projection only; (b) boundary only; (c) both. Evidence: the
  projection is total for its own contract, but the callbacks interface is
  callable by other adapter paths later; Claude's drop
  (stream-event.transformer.ts:463, :503) is at the stream boundary. Both
  guards are two lines and keep each layer total. Reversible: delete either
  guard.
- Decision: a completed command with a non-zero exit code is a failure
  (`commandFailed` includes `exitCode !== 0`).
  Options: (a) trust status alone; (b) also treat non-zero exit as failure.
  Evidence: the 8m-2 contract reports sandbox denials as completed with a
  non-zero exit code; status alone would present them as successes.
  Reversible: drop the `commandFailed` term.
- Decision: Write/Edit/Read inputs keep their current shapes.
  Options: (a) invent Claude-shaped content from a diff; (b) keep the
  diff-based input. Evidence: (a) fabricates file content the server never
  sent — against the G1 no-invented-text rule; the header already renders the
  clickable `file_path`. Reversible: none needed; if Codex ever reports full
  content, `presentFileChange` is the single edit point.

## Not done

- No verification, lint, typecheck or tests were run (batch rule 1). Expected
  scoped checks: `npm run verify -- -t test,typecheck -p @ptah-extension/agent-sdk`
  and `-p @ptah-extension/rpc-handlers` (as the team-leader sees fit).
- The main chat tree keeps the node header label behavior for failing tools
  app-wide: the tree marks any finished tool node 'complete' and preserves
  `isError` (tool-node.fn.ts:216, pinned by builders.spec.ts:305-341); other
  surfaces consume `isError` (agent-monitor-tree-builder.service.ts:730 maps
  it to 'error'). That behavior is identical for the Claude host and out of
  this batch's event-contract scope; the event now carries Claude's shape,
  which fixes every isError-consuming surface and the live-test D-2 body.
- `codex-chat-adapter.ts`, `codex-chat-turn-stream.ts`,
  `codex-chat-native-contract.spec.ts`, `chat-session.service.ts`,
  `libs/shared`, `libs/frontend` and `codex-runtime` were not touched
  (concurrent lanes / committed contract).
- No file outside the allowed set changed; no additional file needs a change
  for this batch.

## Review fix 1

Team-leader verify of agent-sdk found 2 test failures (everything else
green): the failed-Bash tool_result opened a blank line whenever the real
command output already ended with a line break, which is normal for shell
output.

- Root cause: `failedCommandResultText` joined the raw output to the
  exit-code line as `${text}\n${line}` (codex-tool-presentation.ts:168
  before the fix), so `denied\n` read
  `denied\n\nCommand failed with exit code 1`.
- Line changed: the exit-code branch of `failedCommandResultText`
  (codex-tool-presentation.ts:168-171 after the fix). It now strips the
  trailing line breaks (`/(?:\r?\n)+$/`) from the output text before the
  join, and an output that is empty or whitespace-only after the strip
  yields the exit-code line alone. Leading whitespace and inner content
  are untouched, so `denied\n` + exit 1 reads
  `denied\nCommand failed with exit code 1`.
- Behaviour kept: `exitCode` undefined returns the text as-is (`null` when
  empty); `access denied` + exit 1 still yields
  `access denied\nCommand failed with exit code 1`; the success, declined
  and MCP branches are untouched.
- Both failing specs go through the same helper:
  codex-tool-presentation.spec.ts:228-236 calls `presentCodexToolResult`
  directly, and codex-chat-events.spec.ts:183-188 reaches it through the
  `toolCompleted` projection (codex-chat-events.ts:224). No spec changed and
  no other file needed an edit.
- No verification was run (lane rule); the team-leader re-verifies.