# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: none.

## Deliverables

1. Shared contract lib with Zod schemas: envelope (`schemaVersion`, `catalogVersion`, `specId`, `revision`, `generatedAt`), component tree, data references. Components: stat, line chart, bar chart, table, list.
2. Limits at the boundary: component count, tree depth, unique ids, string length, row and column count, total UTF-8 bytes. Reuse `libs/backend/platform-core/src/utils/json-budget.ts`.
3. Atomic specs only. No render of a partial stream. An unknown version or component fails closed with a text fallback.
4. One MCP tool on the Ptah server that validates a spec and sends it to the UI. Model: `ptah_harness_propose_config` (`tool-description.builder.ts:1521`, `harness-namespace.builder.ts:934-959`). Generate the JSON Schema from Zod (`toJSONSchema`), do not write it by hand.
5. The tool always returns meaningful text content, so the CLI and VS Code hosts operate without the UI.

## Rules

- A new RPC namespace needs the dual registration: `libs/shared/.../rpc.types.ts` and `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`.
- Text that allows markdown goes through `libs/frontend/markdown`. No second parser.
- New libs need the two Nx tag axes. Proposed names and tags are in `.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 3.

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, Track A. `.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 5.
