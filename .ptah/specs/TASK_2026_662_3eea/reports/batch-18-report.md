# Batch 18 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\routing-map.component.ts:20,238,274` — removed the four lane IDs and lane DTO dependency; the Background roles preview reads Memory curator and Enhancement from the core enhancement slice, and Retry refreshes only failed live sources. The main route and CLI nodes remain.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\routing-map.component.spec.ts:34,57,190` — fixtures and expectations cover the two live roles, inherited provider, loading, and Enhancement retry.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\providers-settings.component.ts:850` — usage error state tracks Enhancement instead of the removed lane and judging sections. Usage attribution already read Enhancement from the core slice at line 831.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\providers-settings.component.spec.ts:82,309` — removed stale lane and judging fixtures; added a drawer assertion for Enhancement attribution to its selected connection.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\advanced\advanced-settings-group.component.spec.ts:341` — numeric field fixture uses `compaction.toolOutputBudgetTokens`, which survives Batch 65.

## Validation

- `rg -n "SkillLane|refreshLanes|state\.lanes\(\)|judgeProvider" libs/frontend/chat` — zero hits.
- `rg -n 'skillSynthesis:getLanes|skillSynthesis:setLanes' libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts` — zero hits. The routing map contains no lane source or lane entry.
- `rg -n 'skillSynthesis\.' libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts` — zero hits.
- Ptah AST analysis: all five edited TypeScript files parsed with zero error nodes.
- Tests, typecheck, lint, builds, and Nx commands were not run, per executor instruction. Diagnostics were not requested because the CLI diagnostics path invokes the TypeScript compiler, which the instruction also forbids.

## Preserve check

The Main Agent and CLI agent routing nodes, route status, connection drawer usage, and navigation remain. The Background roles node remains and shows Memory curator and Enhancement. No other Providers page content was removed. The old lane IDs in `libs/frontend/core/src/lib/services/app-state.service.ts` were left for Task 53.2.

## UI flag handling

The approved UI change removes lane entries from the Background roles preview and changes its count from six to two. Enhancement now displays the connection name from `skills.enhancement.provider` through `ProvidersSettingsStateService.enhancement()`. The existing load, error, Retry, and inherited-provider states remain available.

## Decisions

- **Role count:** Show two roles in this node: Memory curator and Enhancement. Options were to include other orchestration roles or keep the node's prior role set after deleting the four lanes. The prior node contained only curator, four lanes, and judging; Batch 17 replaced judging with Enhancement. This is reversible if the product later expands the routing map.
- **Advanced fixture:** Use the surviving `compaction.toolOutputBudgetTokens` integer key and assert its numeric input mode and unit suffix. The old decimal `skillSynthesis.replayValidation.minConfidence` key is removed in Batch 65, and the surviving advanced descriptors contain no decimal key. Reversible when a new decimal descriptor exists.

## Proposed Removals

- The `routing-background-more` branch in the Background roles template cannot render with the two current roles and `.slice(0, 2)`. It was preserved because this batch authorizes the lane removal and asks to report any additional removal separately.
