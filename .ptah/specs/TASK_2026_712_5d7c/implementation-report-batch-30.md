# Implementation report — TASK_2026_712_5d7c, Batch 30 (Task 30.1)

Prepare the exhaustive avatar and discovery maps before the tuple is activated (P1-E). It runs after Batch 25 and before Batch 26.

**Actual execution family**: Anthropic (in-process frontend-developer subagent, Claude Opus). It was not a CLI lane. The orchestrator dispatched it this way.

## Files (worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`, uncommitted)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-marks.ts`
  - `CLI_PROVIDER_MARK_IDS` is now typed `Readonly<Record<CliType | 'claude', string>>` and has the forward row `claude: 'claude-cli'`.
  - The lookup in `cliMarkFor` now indexes with `keyof typeof CLI_PROVIDER_MARK_IDS` instead of `CliType`.
  - The comment "The Claude mark is never produced here: it belongs to the Orchestrator only" is removed on purpose. The new doc comment explains three things: how the system Claude lane is drawn, how it stays distinct from `ptah-cli` (the configured Ptah CLI/SDK provider) and from `anthropic` (the API provider), and why the key is typed explicitly. The vendored count is corrected from "six" to "seven".
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts`
  - `CLI_DISPLAY_NAMES` is now typed `Readonly<Record<CliType | 'claude', string>>` and has `claude: 'Claude'`. A doc comment says the lane is listed only when `agent:detectClis` reports it installed, and that `ptah-cli` is still named by `ptahCliName`.

No spec was changed. No other file was touched.

## Evidence for the chosen mark (existing assets only)

- `claude-cli` is the existing provider id of the native "Claude (Subscription)" CLI. It appears in `brand-slugs.spec.ts:408`, `provider-mark.component.spec.ts:78` and the provider-settings specs.
- Resolution path: `PROVIDER_BRAND_SLUGS['claude-cli'] = 'claude'` (`libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:76`), then `PROVIDER_BRAND_ART.claude = PROVIDER_ART_CLAUDE` (`provider-brand-art.vendored.ts:43`). `ProviderMarkComponent` looks these up in `provider-mark.component.ts:124-127`.
- No new asset, token or UI surface was added.

## Compiles before and after activation

- **Before** (`CliType` has 7 system members plus `ptah-cli`): `Record<CliType | 'claude', string>` requires all eight existing keys plus `claude`. Exhaustiveness for the existing members is kept.
- **After** Batch 26 adds `'claude'` to `SYSTEM_CLI_TYPES`: the union collapses to `Record<CliType, string>`, and the `claude` row satisfies it. Nothing needs to change.
- Batch 24 used the same pattern for `CLI_LABELS` in `session-stats-source.ts`.
- `CLI_DISPLAY_NAMES[cli.cli]`, where `cli.cli: CliType`, still indexes cleanly in both states.
- The external consumer `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:35-36` already indexes with `keyof typeof CLI_PROVIDER_MARK_IDS`. It is unaffected.

## Behaviour

- Every existing CLI id maps to the same provider id as before. `ptah-cli` still maps to `ptah-cli` (stroke mark) and `pi` to `pi`. The native provider identities are not replaced.
- `cliMarkFor('claude')` now returns `{ kind: 'provider', providerId: 'claude-cli' }` instead of a `claude` monogram. Before activation no lane can carry `cli: 'claude'`, so nothing reaches this path yet.
- Discovery data is unchanged: lanes still come only from the real `agent:detectClis` result, filtered by installed and not disabled. No detection result is fabricated.

## Specs that iterate or snapshot these maps

- None found. A Grep over `libs/frontend/**/*.spec.ts` for `cliMarkFor`, `CLI_PROVIDER_MARK_IDS`, `CLI_DISPLAY_NAMES` and `agent-marks` found no spec that asserts or iterates either table.
- There is no `agent-marks.spec.ts` and no `agent-avatar.component.spec.ts`.
- Related specs that do not pin the maps:
  - `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.spec.ts` (discovery behaviour)
  - `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts` (consumer; its fixtures have no `claude` lane)
  - `libs/frontend/chat-ui/src/lib/dependency-boundaries.spec.ts`

## Verification

- `ptah_get_diagnostics` on the two changed files: **0 errors in the requested files**.
- It also reported 18 errors in sibling files: tasks-ui and chat-ui specs, `core/src/testing/mock-rpc-service.ts`, and the BigInt target in shared. None of these files is touched by this batch. They look like existing type drift or a diagnostics-tool target setting, and they are not caused by this change. Whether they also fail under the projects' own `tsconfig.spec` needs to be confirmed by the orchestrator's scoped typecheck.
- Not run, per the batch instruction (the orchestrator runs checks): `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/tasks-ui','@ptah-extension/chat-ui') -Hosts $H`, which means nx test, typecheck and lint for `@ptah-extension/tasks-ui` and `@ptah-extension/chat-ui`. The post-activation compile can only be confirmed after Batch 26 lands.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Mark id for the `claude` lane is `claude-cli` | (a) `claude-cli`, the existing native-CLI provider id; (b) `anthropic`, the API provider art; (c) a new `claude` provider id | (a) already resolves to the vendored Claude art and names the same native CLI family. (b) would blur the API and CLI distinction. (c) would need a new PROVIDER_BRAND_SLUGS row, outside ownership. | Yes |
| Display name is `Claude` | `Claude` / `Claude CLI` / `Claude (Subscription)` | Matches the Batch 24 `CLI_LABELS` forward key `claude: 'Claude'`, and the sibling rows use the bare vendor name. | Yes |

## Plan deviations

None.

## Out-of-scope observations

- `agent-avatar.component.ts:112` says the Orchestrator glyph is lucide `Workflow`, which confirms the removed comment was misleading. That file was not touched.
- The sibling diagnostics listed under Verification should be checked by the orchestrator's scoped typecheck.
