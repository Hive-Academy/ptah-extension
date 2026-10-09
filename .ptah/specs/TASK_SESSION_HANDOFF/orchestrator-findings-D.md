# Orchestrator findings — Batch D (verified by running checks)

Checks run by the orchestrator after Batch D:

- cli-agent-runtime session-children Jest: 6 suites, 147 pass (after the orchestrator fixed a TS2339 narrow in `session-spawner.service.spec.ts:232`).
- agent-sdk Jest (hand-over set): 21 suites, 698 pass.
- rpc-handlers Jest (hand-over set): 25 suites, 374 pass.
- vscode-lm-tools code-execution Jest: 2 suites FAIL (below).
- typecheck pass: shared, agent-sdk, cli-agent-runtime, rpc-handlers, vscode-lm-tools.

## Open defects

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:74` — `inputSchemaOf(SessionStartArgsSchema)` now publishes a top-level `anyOf` (zod union). The Anthropic tool API rejects `oneOf`/`anyOf`/`allOf` at the top level of `input_schema`, and several MCP clients require `type: "object"` at the top. Publish one flat object schema (mode enum `child | successor`, all child fields optional at the JSON-schema level, `handoff` optional, `additionalProperties: false`); keep the strict zod union for validation in the handler.
2. `session-tools.spec.ts:92` — TS4111: `schema.anyOf` must use bracket access (moot after fix 1; update the test to the flat schema).
3. `mcp-contract.sweep.spec.ts:2413` — `ptah_session_start` description is 1047 chars, budget 984. Shorten it.
4. Full-auto end to end: no test covers `session-lifecycle-manager.ts` `sourceSnapshot` copying `rec.permissionLevel = 'yolo'` into `successorConfig.permissionLevel`, nor `chat-session.service.spec.ts` with `'yolo'` reaching `launchSdkSession`. Add both.
