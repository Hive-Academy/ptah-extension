# Context

## What the user saw

The AI Team Builder was building a harness for the `website-manager` workspace,
targeting an Egypt-focused Shopify operator persona. The panel header read
`0 agent(s) enabled` while the chat pane said "Configuration looks ready to
apply". The user reported it as "AI team builder still fails".

## What the log says

Source: `%APPDATA%/Ptah/logs/Ptah Electron-2026-09-21.log`, session
`6a17aa38-8fb5-46c3-804a-54541c21cd39`, workspace `D:\projects\website-manager`,
model `gpt-5.6-sol` through the Codex proxy.

Six `ptah_harness_propose_config` calls, three rejected:

| Time | Field | Message |
| --- | --- | --- |
| 14:34:12 | `mcp.enabledTools` | `expected record, received array` |
| 14:34:45 | `agents.enabledAgents` | `expected record, received array` |
| 14:35:18 | `prompt.enhancedSections`, `claudeMd.customSections` | `expected record, received array` |

At 14:33:49 the agent had called `ptah.help('harness.proposeConfig')` — the help
text did not state the shapes either, so the call after it still guessed.

The three accepted calls applied 4, 1 and 2 fields. The last set
`isConfigComplete=true`. No `harness:apply` error appears in the log; apply logs
only on failure, so the log cannot say whether the user pressed Apply.

## Why the agent guessed wrong

Four fields of `HarnessConfig` are `Record<string, …>` keyed by name. Three
surfaces describe `proposeConfig` to the authoring agent, and none of them
stated the shape of those four fields:

1. `tool-description.builder.ts` — `buildHarnessProposeConfigTool`, which named
   only `mcp {servers[], enabledTools}`.
2. `system-namespace.builders.ts` — the `ptah.help('harness')` text.
3. `harness-workflow-prompt.service.ts` — the authoring agent's system prompt.

The Zod message named the offending path and the wrong container, but not the
wanted shape, so each retry was a fresh guess.

## Why it is worse than a failed call

`proposeConfig` is an incremental partial update. A rejected call leaves the
agent's own belief and the surface's state divergent, and nothing reconciles
them. The agents field was rejected once and never re-sent, so the surface
rendered a persona with no agents and still let the agent assert
`isConfigComplete: true`. The user was shown a configuration that looked
finished and was not.

## Decision

Accept the list shape where its entries carry their own key, and fold it into
the record. Refuse a keyless list — `['firecrawl_scrape']` under `enabledTools`
names no server, and keying it would store the agent's guess as the user's
configuration. Teach the wanted shape in the rejection message, and state the
shapes on all three description surfaces.

## Lanes

- `codex` — systematic audit of the propose→apply path for the same defect
  class beyond the four observed fields → `harness-contract-audit.md`
- `antigravity` — independent cross-family review of the change →
  `independent-review-harness.md`
