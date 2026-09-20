# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: none.

## Deliverables

1. Shared contract lib with Zod schemas: envelope (`schemaVersion`, `catalogVersion`, `specId`, `revision`, `generatedAt`), component tree, data references. Components: stat, line chart, bar chart, table, list.
2. Limits at the boundary: component count, tree depth, unique ids, string length, row and column count, total UTF-8 bytes. Reuse `libs/backend/platform-core/src/utils/json-budget.ts`. The numbers, the measurement points and the rejection are in "Budgets" below.
3. Atomic specs only. No render of a partial stream. An unknown version or component fails closed with a text fallback.
4. One MCP tool on the Ptah server that validates a spec and sends it to the UI. The transport is in "Transport contract" below. Model: `ptah_harness_propose_config` (`tool-description.builder.ts:1521`, `harness-namespace.builder.ts:934-959`). Generate the JSON Schema from Zod (`toJSONSchema`), do not write it by hand.
5. The tool always returns meaningful text content, so the CLI and VS Code hosts operate without the UI.
6. Tests for each control in "Trust boundary" below.

## Budgets

Starting values - the task must confirm them with a render test and record the final numbers.

| Limit               | Starting value      |
| ------------------- | ------------------- |
| Max components      | 200                 |
| Max tree depth      | 8                   |
| Max string length   | 2,000 characters    |
| Max table rows      | 1,000               |
| Max table columns   | 50                  |
| Max series points   | 5,000               |
| Max total spec size | 256 KB, UTF-8 bytes |

- Unique ids have no number. A duplicate id is a rejection.
- Measurement points: at the MCP tool boundary before the broadcast, and again at the RPC boundary in the webview.
- Rejection: the tool returns an error result with a plain-text reason. The UI shows the text fallback.
- `json-budget.ts` supplies the byte check only. The other limits are Zod refinements.
- Tests: for each limit, one spec at the limit passes and one spec above the limit is rejected.

## Trust boundary

A fixed catalog limits component types. It does not make agent-controlled values safe. It does not make the action channel safe. See `research-report.md` Revision 6, entry 1. The contract must have these controls, and the task must test each one:

1. Action allowlist. A spec can name only actions from a fixed list in the contract. An unknown action is a rejection.
2. Zod validation of every value. No value goes to a component before validation. No `any` and no passthrough objects.
3. Output escaping. No `innerHTML`. Text binds as text. Text that allows markdown goes only through `libs/frontend/markdown`.
4. URL scheme limits. A URL value is valid only with a scheme from an allowlist (start with `https:`). `javascript:`, `data:` and `file:` are rejections.
5. Host mediation of every action. The renderer sends an action to the host. The host validates it and decides. The renderer never calls a tool or an RPC method directly from a spec value.

## Transport contract (producer interface for TASK_2026_494_ca38)

- One push message type: `dashboard:spec-proposed`, constant `DASHBOARD_SPEC_PROPOSED`. The name follows the convention of `harness:config-proposed` in `libs/shared/src/lib/types/messages/message-constants.ts:165`.
- The payload is typed and registered in `libs/shared/src/lib/types/messages/payload-map.ts`: `{ spec, sessionId, toolCallId }`. `spec` is the validated envelope from deliverable 1.
- Tool success result: the text content is a plain-text rendering of the dashboard. It has the title, each stat as "label: value", and each table as a short text table with a maximum of 20 rows.
- Tool error result: `isError: true` plus the validation reason in plain text. The tool sends no push message.
- The UI never parses the text content. It uses the push message only.

## Rules

- A new RPC namespace needs the dual registration: `libs/shared/.../rpc.types.ts` and `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`.
- Text that allows markdown goes through `libs/frontend/markdown`. No second parser.
- New libs need the two Nx tag axes. Proposed names and tags are in `.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 3.

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, Track A. `.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 5.
