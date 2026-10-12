# Batch C / D handoff

## Files changed

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.ts` — decides whether a named spawn is clear, unknown, or blocked and formats refusals.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.spec.ts` — covers gate decisions, refusal text, model targeting, and malformed snapshots.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts` — distinguishes unknown causes and gate-blocked states; ignores malformed rows without snapshots.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts` — covers the new state, cause, alternative, and forced-spawn wording.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts` — accepts optional boolean `force`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts` — checks boolean `force` acceptance and rejection.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts` — verifies refusals, forced spawns, metadata, lookup timing, and text parity on both transports.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` — passes forced-spawn context to limit formatting.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts` — guards byte-identical spawn text when limits are absent.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` — gates named HTTP spawns before calling the spawn API.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` — checks HTTP `force` validation and that it is not forwarded.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` — documents limit states, refusals, and the `force` property.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts` — checks list-description budget and limit guidance.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` — gates named stdio spawns and returns structured refusal metadata.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts` — checks stdio `force` validation and that it is not forwarded.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.limits.spec.ts` — uses the Batch B async lane-owner contract.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` — tells the main agent to inspect plan limits and skip AT LIMIT lanes.
- `.claude/skills/agent-lanes/SKILL.md` — adds per-row limit-state guidance to discovery.
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` — mirrors the same discovery guidance.

## Decisions

- Kept the existing gate and transport implementation, completing its missing specs and guidance in place.
- A row with no snapshot cannot block a spawn, even if a malformed state claims `at-limit`.
- The new skill sentence is identical in both copies; it names no vendor and adds no table row.
- The tool-description budget assertion covers `ptah_agent_list`; the spawn description has no existing budget assertion.

## Not done

- Jest, Nx typecheck, lint, build, and other heavy checks were not run, as instructed while another lane runs Jest.
- `ptah_get_diagnostics` and `ptah_agent_report` were unavailable in this session's tool catalog; no report call could be made.

## Jest specs for the orchestrator

Run with `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <specs> --coverage=false --maxWorkers=2`:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.spec.ts`
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts`
3. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`
4. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts`
5. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts`
6. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts`
7. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
8. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
9. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts`
10. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.limits.spec.ts`
11. `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-rule-single-home.spec.ts`
12. `libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts`
13. `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`
14. `libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts`
