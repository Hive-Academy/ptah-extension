# Batch 8k-2 report — codex tool presentation and native approval identity

## Summary

Added the pure Codex-to-Claude tool/approval presentation mapping in agent-sdk
(`presentCodexTool`, `presentCodexApproval`), exported it from the package index,
and gave `CodexApprovalRequest` native identity in codex-runtime: `toolId`
(from `params.itemId`) and `expiresAt` (the bridge's auto-decline deadline,
computed from the same timeout value the timer uses via one shared constant).
Specs cover every mapping, every fallback, the id stamping and the deadline.
No verification was run (per batch rules; the coordinator verifies).

## Task 1 — codex-tool-presentation.ts (new)

`W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-tool-presentation.ts`

- `presentCodexTool` (codex-tool-presentation.ts:61): `commandExecution` → `Bash`
  `{command, ...(cwd ? {cwd} : {})}`, non-string command falls back to the raw
  name and input; `webSearch` → `WebSearch` `{query}`; `fileChange` →
  `presentFileChange` (codex-tool-presentation.ts:101): a single `add` change
  with a non-empty string path → `Write` `{file_path, changes}` (changes kept),
  every other shape (update, delete, multiple changes, missing path) passes
  through as raw `fileChange`; `server/tool` names → `mcp__server__tool`
  (split at the first `/`, both parts non-empty) with the arguments unchanged;
  unknown names pass through unchanged; absent input omits `toolInput`.
- `presentCodexApproval` (codex-tool-presentation.ts:118): `command` reuses
  `presentCodexTool('commandExecution', …)` for name/input from
  `details.command/cwd`, description = non-empty `details.reason`, else
  `Run: <command>`, else `Run a command`; `fileChange` → raw `fileChange`
  name, input `{grantRoot}` when present, description = reason or
  `Apply file changes`, ` (<grantRoot>)` appended when present; `permissions` →
  `Permissions`, input `{cwd?, permissions?}`, description from reason/cwd
  (e.g. `Grant permissions in <cwd>`); `mcpElicitation` →
  `mcp__<serverName>__elicitation` (else `mcpElicitation`), input `{}`,
  description = `details.message`/`details.reason`/`request.message`;
  `userInput` → `userInput`, input `{questions}` when present, description =
  `request.message`. No protocol id (itemId/requestId/threadId/turnId) ever
  enters a description; descriptions are capped at 500 characters
  (`cap`, codex-tool-presentation.ts:42, cut marked with `…`).
- Exports added at `W/libs/backend/agent-sdk/src/index.ts:174-177`, next to the
  other codex-app-server exports.

Spec: `W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-tool-presentation.spec.ts`
— table tests for every tool mapping and fallback (presentCodexTool,
spec:30-202: Bash variants, Write for a single add, raw passthrough for
update/delete/multi-change/missing-path/non-array changes, first-slash mcp
split incl. empty server/tool, unknown names, absent input) and every approval
kind (presentCodexApproval, spec:204-358), plus spec:360 (no protocol id in a
description) and spec:375 (500-char cap).

## Task 2 — CodexApprovalRequest.expiresAt

`W/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:142` — added
`readonly expiresAt?: number; // epoch ms when the bridge auto-declines`
between `toolName` and `message`. `toolId`/`toolName` untouched.

## Task 3 — bridge stamps toolId and expiresAt

`W/libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts`

- `DEFAULT_APPROVAL_TIMEOUT_MS = 240_000` (codex-approval-bridge.ts:29) replaces
  the three duplicated literals; `private approvalTimeout()`
  (codex-approval-bridge.ts:300-303) is the one value both the deadline and the
  timer read.
- Request construction (codex-approval-bridge.ts:181-184): `toolId` is spread
  only when `params.itemId` is a non-empty string, otherwise omitted;
  `expiresAt = this.options.clock.now() + this.approvalTimeout()`.
- Constructor (codex-approval-bridge.ts:137-142) and the auto-decline timer
  (codex-approval-bridge.ts:324-327) now use the same helper. No other behaviour
  changed.

## Task 4 — specs

- New presentation spec (above).
- `W/libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts:198-218`:
  toolId equals `params.itemId` and `expiresAt` equals the fake clock's now plus
  the configured timeout (spec:198); toolId absent for an mcp elicitation
  frame that carries no `itemId` (spec:206); `expiresAt` uses the 240_000 s
  default when no `timeoutMs` is configured (spec:212).

## Decisions

1. **fileChange maps to `Write` only for a single `add` change; `update` (and
   delete/multi/missing-path) keep the raw `fileChange` name.**
   - Options: (a) map add→`Write` and update→`Edit`; (b) keep raw `fileChange`
     for everything; (c) chosen — add→`Write` only.
   - Evidence: a `Write` card renders fully with the fields Codex supplies — the
     header shows the clickable path from the name-based fallback
     (tool-call-header.component.ts:413-426) and the body lists `file_path` and
     `changes` as argument rows (tool-input-display.component.ts:322-341; input
     not suppressed for `Write` at :441-444). An `Edit` card does not: its input
     body is suppressed (tool-input-display.component.ts:441-444) and its diff
     renders only via `isEditToolInput`, which requires `old_string` and
     `new_string` (tool-output-display.component.ts:181-186; shared
     type-guards/guards/fs.ts:198-209) — a Codex change carries a unified diff,
     so those fields cannot be supplied and the card body would render nothing.
     Per the batch instruction, the renderer-requires-old_string/new_string
     case keeps the raw `fileChange`.
   - Reversible: yes — one branch in `presentFileChange`.
2. **`presentCodexApproval` fileChange name is raw `fileChange` (not `Edit`).**
   The batch's parenthetical says "use 'Edit' if you mapped fileChange, else
   'fileChange'"; decision 1 mapped only add→`Write` (never `Edit`), and an
   approval carries no change details at all (reason/grantRoot only,
   codex-protocol-methods.ts:199-206), so it takes the unknown-change name
   `fileChange`. Reversible: yes.
3. **mcpElicitation name `mcp__<serverName>__elicitation`, fallback
   `mcpElicitation`; `toolInput` is `{}`.**
   - Options: bare `serverName`; the `mcp__` form; chosen the `mcp__` form
     because that is the name the tree renders with a `server ·` prefix
     (tool-call-header.component.ts:124-133 via splitMcpToolName,
     tool-target.utils.ts:336-349). `serverName` is the elicitation's server
     field (codex-protocol-schemas.ts:591-597).
   - `toolInput` `{}`: the elicitation has no tool-like input — its message is
     the description and its server is in the name; the `requestedSchema` form
     is answered through the follow-up input, not the card arguments.
   - Reversible: yes.
4. **userInput input `{questions}` when present; permissions input
   `{cwd?, permissions?}`.** The batch names no input fields for these kinds;
   these are the payload fields that identify what is approved (both validated
   shapes, codex-protocol-methods.ts:207-242). No permission-card guard matches
   them, so they only appear as generic argument rows
   (permission-request-card.component.ts:304-339). Reversible: yes.
5. **`webSearch` → `WebSearch` kept although the icon map has no `WebSearch`
   case.** The batch mandates the mapping; the icon falls to the default
   terminal exactly as the raw name would (tool-icon.component.ts:85-87), and
   the query renders as the header target (tool-target.utils.ts:102-110), so
   the mapping strictly improves the card. Reversible: yes.
6. **`expiresAt` is stamped at request construction, before the timer
   starts.** Both read the same `approvalTimeout()` value; the timer starts a
   microtask later, so the deadline can be a fraction earlier than the actual
   auto-decline — it is presentation metadata for a countdown, not a
   guarantee. Reversible: yes.
7. **Description cap cuts to 499 chars + `…` (500 total).** "Cap 500 chars"
   permits either; the marker tells the user text was cut. Reversible: yes.

## Not done

- No verification was run (no verify/nx/jest/tsc/lint, no diagnostics) — the
  batch rules forbid it; the coordinator verifies.
- No other file changed. The consumer wiring that feeds `toolStarted` events
  through `presentCodexTool` and approval requests through
  `presentCodexApproval` (codex-chat-turn-stream.ts, codex-chat-adapter.ts,
  codex-chat-approval-sink.ts, register.ts in agent-sdk) belongs to the
  parallel lane and was not touched.