# Code Logic Review - TASK_2026_714_c8a2, batch 1k (uncommitted diff)

Scope: `libs/backend/codex-runtime/tools/evidence-harness.ts` and `evidence-harness.spec.ts`, full diff read, plus the pinned schema/manifest and bounded `grep -a -o` scans of the bundled codex.exe. The spec ran once: 159/159 pass. The real binary was not executed. No `any`, `ts-ignore` or `as unknown as` in the added spec lines. The harness uses zod `safeParse` throughout.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | REVISE (small, cheap fixes; no Blocking) |
| Blocking | 0 |
| Serious | 2 |
| Moderate | 4 |
| Minor | 2 |

## What checks out

- **Method and response shape.** `mcpServer/elicitation/request` is in the manifest (`manifest.json:132`). The response `{ action: 'accept', content: {} }` matches `McpServerElicitationRequestResponse`: `action` is required and `content` is free-form. The decline `{ action: 'decline' }` at `evidence-harness.ts:750` is schema-correct. It is used for elicitation ids only, via the `elicitations` set populated in `receive` (`:652`). Other requests keep `{ decision }`. The `McpToolCallApprovalDecision` branch is removed cleanly from `markerApprovalDecision` and `schemaDenial`. A stray `item/mcpToolCall/requestApproval` now falls through to the generic decline and fails the case.
- **Hold and gates.**
  - `:1475-1481` runs in the right order: `approvalPending=true`, a marker-absent check, `delay(200)`, `assertHealthy`, then a second marker-absent check.
  - `inspect()` plus the 20 ms guard fail any marker that appears while `approvalPending` is true.
  - `validatedApprovals[0].response='accept'` is set before `respond`, so the later marker is allowed.
  - `approvalRounds !== 0` rejects a second elicitation. `item.kind !== 'mcp'` rejects an elicitation in other cases.
  - `compacting` and manifest membership are also checked. Rejections throw inside the try, so the catch declines (`evidence.response` falls back to 'decline').
  - The marker is written once because of the fixture's `O_EXCL`.
- **Config key.** `default_tools_approval_mode` is real. The binary has it in MCP server serialization (`startup_timeout_sec tool_timeout_sec default_tools_approval_mode`), with the enum `AppToolApproval auto prompt writes approve`. `prompt` is a valid value. The key is added only when `item.kind === 'mcp'` (`:1320`). The mcp case runs the granular policy with `mcp_elicitations: true` (`:929`), so the policy will not suppress elicitation.
- **Event summary.** `type`, `status`, `server`, `tool`, `error` and `McpServerStatusUpdatedNotification.{name,status}` match the schema. The parse is `safeParse`, so it cannot throw. All strings are sanitized and capped at 80 characters. Error contents and arguments are never retained. Notifications whose `status` is an object just skip the summary.
- **Usage limits.** `USAGE_TURN_LIMIT=30_000` is applied at `:540`, cumulative stays 100_000, and the output text and JSON interpolate the constants.
- **Config check timing.** The effective-config check (`:1834`) runs before `thread/start`, so a false negative costs no model turn.

## Serious

### S1. The tool-name correlation can reject a real approval (`:1469-1471`)

`_meta.tool_title` is compared to `'write_marker'`. The binary shows `tool_title` is a separate display field next to `tool_description`, `connector_name` and `tool_params_display`. In Codex it is the MCP annotation or title, not the tool id. The fixture advertises no title (`:828`), so it is probably absent or falls back to the name. If Codex renders it as "Write marker", or fills `_meta.tool` with anything else, the real request is declined and the turn is wasted. The check is also weak where it should be strong: `undefined` passes, so the check only ever rejects.

Fix: remove `tool_title` and `_meta.tool` from the "must equal write_marker" list. Keep `tool` and `toolName` (top-level) and `_meta.toolName` only if present. Rely on thread, turn, server `marker` and `approvalRounds===0`. The fixture exposes exactly one tool, so identity is already pinned. The `mcpToolCall` item check at `:1721` additionally asserts server, tool and arguments.

### S2. `turnId` is required non-null, and `_meta` null is rejected (`:351-364`, `:1470`)

The schema makes `turnId` `string|null` ("if app-server could correlate one") and `_meta` unconstrained (`true`). Rust `Option<Value>` can serialize as `null`. Both `z.string()` for `turnId` and `z.record().optional()` for `_meta` fail on null. A single null makes the whole request "Unexpected request", and the case fails after the paid turn started. The elicitation arrives mid-turn, so `turnId` is likely set, but it is not guaranteed.

Fix:
- `turnId: z.string().nullish()`, `_meta: z.record(z.string(), z.unknown()).nullish()`.
- Accept `params.turnId == null || params.turnId === turnId`. Reject only a non-matching non-null id.
- Keep the thread and server checks as the tightness guard.
- Record `turnId: null` in the evidence note if it happens.

## Moderate

- **M1. Required form fields (focus item 3).**
  - Rejecting `required.length > 0` (`:1472`) is consistent with the evidence. `persist/always/session` and `codex_approval_kind` are `_meta` keys. The approve/cancel choice is the action, not a field.
  - The spec's own fake request carries `requestedSchema.properties: ['persist']` with no required entries.
  - If Codex does send a required field, the harness declines and the turn is wasted. The approval evidence does record property names, so the shape would be learnt.
  - Minimal safe handling if wanted: keep rejecting unless every required property is `type: 'boolean'`, and answer `content: { <name>: true }` for those. Do not invent anything else. Given the evidence I would leave it as is, but this is the residual risk of the run.
- **M2. `openai/form` and `openaiForm` modes (`:354`).** The schema declares `requestedSchema` as untyped (`true`) for these. The harness requires `{type:'object', properties}`. Accepting the mode but failing on its schema is inconsistent. Either drop those two modes or make `properties` optional. Low probability.
- **M3. Effective-config check (`:1834`).** `Config` is `additionalProperties: true`, and `mcp_servers` is not declared in the schema. It is probably present in `additional` as the merged TOML, but this is unverified. The check requires `config.mcp_servers.marker.default_tools_approval_mode === 'prompt'`. A key-shape mismatch fails the case cheaply, before `thread/start`. If it does, downgrade to a recorded note instead of a throw. Optionally also read `thread/start`'s response.
- **M4. Repeated tool call.** The error text says "repeated", but nothing counts `mcpToolCall` items. Repeats are bounded only by the second-elicitation rejection and `O_EXCL`. Acceptable; fix the message or use the existing `toolItems` counter.

## Minor

- `message` (400 characters) is recorded verbatim. It is fixed fixture text today, so it is fine, but it is the only free text from the server in the evidence.
- `evidence.absentBefore = true` is set only after the hold. A rejection path leaves it at its default, which is correct. No action.

## Five questions (short)

1. **Silent failure.** None found. All rejection paths fail the case and decline with the schema-correct body.
2. **Unexpected user action.** n/a (dev harness).
3. **Wrong answer from input.** S1 and S2: a legitimate request is declined, so the evidence is "harness rejected", not "Codex behaviour".
4. **Dependency failure.** If the config shape differs (M3), the case fails before the turn. If `respond` fails after the hold, the catch and the `decline` guard (`answered` set) prevent a double answer.
5. **Missing.** No handling or evidence for a null `turnId`; the URL elicitation mode is intentionally rejected.

## Verdict

REVISE with a minimal patch: fix S1 and S2 (about 4 lines), optionally M2 and M3, and add one spec each for `turnId: null` and an absent `tool_title`. Without the patch, S1 and S2 are the most likely ways the next paid turn is wasted. Everything else (shapes, hold, single accept, usage limits, summary fields, decline shape) is correct against the pinned schema and binary evidence.
