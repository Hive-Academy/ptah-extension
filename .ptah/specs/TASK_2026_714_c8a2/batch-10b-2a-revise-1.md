# Batch 10b-2a revise 1

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-rejection.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
- This report.

## 1. Essential retry settings

`codex-app-server-lane-rejection.ts:20-49` now removes budgets and the agents, plugins, apps, and skill-instruction overrides. The Ptah MCP server, effort, role instructions, web-search setting, approval policy, and sandbox policy remain. The notice at line 10 describes the actual reduction. Specs: `retries a pre-turn config rejection once with essential settings and one notice`; `keeps reasoning effort on the essential retry profile` (`codex-app-server-lane.adapter.spec.ts:370,395`).

## 2. Named user-server notice gate

`codex-app-server-lane-rejection.ts:31-34,45-49,53-59` re-enables user MCP servers and adds the notice only when the lane disabled at least one and the rejected key names a non-Ptah MCP server. Specs: `mentions re-enabled user MCP servers when rejection identifies one`; `omits the user-server notice when the lane disabled no user servers`; `keeps MCP tool suppressions when no user server was disabled` (`codex-app-server-lane.adapter.spec.ts:457,471,490`).

## 3. Open-level retry

`codex-app-server-lane.adapter.ts:252-284` retries one `runtime.open` rejection; the runtime closes a failed open before returning the typed error. The second rejection throws a visible essential-config error. `codex-app-server-lane.adapter.ts:331-366` has no turn-level retry; a start-turn failure emits an error and rejects. Specs: `retries a pre-turn config rejection once with essential settings and one notice`; `closes the old context once before opening the essential retry`; `reports a second config rejection visibly without a third attempt`; `does not retry a turn-start failure after an event` (`codex-app-server-lane.adapter.spec.ts:370,406,427,441`).

## 4. Rejected key

`codex-runtime.ts:20-37,153-159` adds a backward-compatible readonly `rejectedKey` and extracts only a key matching `/^[A-Za-z0-9_.-]{1,128}$/` from the stderr tail using the legacy named-key pattern. It never attaches raw stderr to the error. `codex-app-server-lane.adapter.ts:254,267` consumes that key for the notice and essential reduction. Specs: `exposes %s safely on pre-turn config rejection` with named, unsafe, and absent key cases (`codex-runtime.spec.ts:2216-2229`); `mentions re-enabled user MCP servers when rejection identifies one` (`codex-app-server-lane.adapter.spec.ts:457`).

## Decisions

The retry uses the existing `essentialCodexConfigEntries` and `codexRejectionNamesUserServer` helpers. No runtime profile fingerprint logic or other host behavior changed. The adapter stays under 450 lines. Ptah AST inspection reported clean parses for all five changed TypeScript files. Per lane rules, no tests, typecheck, lint, build, Nx, npm, diagnostics, or verification targets were run.

## Clarifications Needed

None.
