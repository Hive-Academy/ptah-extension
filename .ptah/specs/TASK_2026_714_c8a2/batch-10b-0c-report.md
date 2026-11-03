# Batch 10b.0c — lane profile bridge

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.ts`: projects required lane controls into the typed core profile, verifies each projection, and refuses unsupported turn and money limits.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts`: covers every projection, missing handlers, a mismatched core field, exact public native thread config, zero and invalid limits, absent Ptah port, and role replacement.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10b-0c-report.md`: this report.

## Requirement to `settings.lane` mapping

| Requirement | Core projection |
| --- | --- |
| `agentsEnabled: false` | `lane.agentsEnabled: false`; `agents` remains suppressed |
| `pluginsEnabled: false` | `lane.pluginsEnabled: false`; `plugins` remains suppressed |
| `appsEnabled: false` | `lane.appsEnabled: false`; `apps` remains suppressed |
| `includeSkillInstructions: false` | `lane.includeSkillInstructions: false`; `skills` remains suppressed |
| `disabledUserMcpServers` | `lane.disabledUserMcpServers`, matching each `mcp:<name>` suppression after deduplication and sorting |
| `autoCompactTokens` | `lane.autoCompactTokens` when positive and valid; zero omitted |
| `toolOutputTokenLimit` | `lane.toolOutputTokenLimit` when positive and valid; zero omitted |
| `webSearch` | `lane.webSearch` as `live` or `disabled` |
| `ptahToolTimeoutSeconds` | `lane.ptahToolTimeoutSeconds` when a valid Ptah port attaches; Ptah HTTP URL remains in `mcpServers` |
| `roleDelivery: replace` | The typed core `developerPrompt` field receives the current role as one scalar on first turn and eligible resume; absent when delivery is disabled or the role is empty. This requirement has no `lane` field. |

`lane.explicitFullAccess` remains `false`. Positive `maxTurns` or `maxBudgetUsd` is rejected before settings are available; zero is omitted. The bridge does not set a chat budget or an approval policy. The core retains D26's `never` approval and restricted workspace-write policy.

## Core support assertion

`assertAllRequirementsHandled` first rejects any present requirement omitted from the caller's handled keys. It then runs a `Record<keyof CodexLaneRequirements, RequirementHandler>`: every handler reads and compares its corresponding typed core field, including array contents for disabled MCP servers and the replacement `developerPrompt` for the role. Adding a requirement without a handler fails TypeScript's `satisfies` check. A failed call revokes access to settings. The spec derives handled keys from the present requirements, so it has no stale fixture list; it tests both a missing key and a changed core field.

The contract spec builds a profile through `buildCodexExecutionProfile`, then calls the public `buildCodexLaneThreadConfig` and asserts the exact agents, features, skills, web search, approval, token limits, and MCP table, including disabled user servers and Ptah URL plus timeout. It also covers the no-port table and omitted zero limits.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the existing handled-key API and add typed field checks | Retain API with checks; remove API | The plan requires a missing-handler refusal and real core support; the typed handler map provides both. | Yes, within this bridge. |
| Reject every nonzero turn or money limit | Forward unsupported fields; reject | P10 requires fail-closed positive limits, and the native thread schema has no turn or money budget field. | Yes, once the core adds support. |
| Use `buildCodexLaneThreadConfig` in the contract spec | Use `buildCodexThreadConfig`; use exported lane builder | `codex-runtime/src/index.ts` exports the lane builder but does not export `buildCodexThreadConfig`. The user explicitly allows this fallback. | Yes. |
| Keep D26 policy in core | Set policy in bridge; use core policy | `resolveCodexLevelPolicy` fixes lane approval to `never` and workspace-write with network disabled. | Yes. |

## Anything not done

- Verification commands, tests, lint, typecheck, build, Nx, npm, and `ptah_get_diagnostics` were not run because the lane rules prohibit them. The coordinator owns verification.
- No callable CLI skill loader was available. I read the repository's `agent-lanes` `SKILL.md` directly as the skill fallback.
