# Code Style Review — TASK_2026_372

## Verdict

**CHANGES REQUIRED**

The multi-provider implementation is generally well-shaped: the intended
`webSearch:getConfig`, `webSearch:setConfig`, and `webSearch:test` payloads agree
field-for-field across the shared registry, RPC handler, and Angular consumer;
the changed backend code keeps the platform boundary; and the component remains
standalone, signal-based, and `OnPush` with no `innerHTML` binding. The commit is
not ready to accept, however, because it contains one unrelated, incomplete RPC
registration and leaves the VS Code configuration contribution and an Electron
E2E test on the old single-provider contract.

**Finding count: 6** — 2 high, 3 medium, 1 low.

## Findings

### 1. An unrelated RPC method is added to the shared registry without its types or handler

**Severity: High**

- `libs/shared/src/lib/types/rpc.types.ts:273` imports
  `McpDirectoryGetOAuthRedirectUriParams` and
  `McpDirectoryGetOAuthRedirectUriResult`, but commit `1e812d663` contains no
  declarations for either symbol in `mcp-directory.types.ts` or elsewhere.
- `libs/shared/src/lib/types/rpc.types.ts:1262` and
  `libs/shared/src/lib/types/rpc.types.ts:3511` nevertheless register
  `mcpDirectory:getOAuthRedirectUri` as a supported RPC method.
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:108`
  still ends its `METHODS` tuple at `mcpDirectory:listOAuthConnected` on line
  125; it neither owns nor registers the added method.

This violates the repository's RPC dual-registration/manifest rule and leaves
an orphaned method in a commit scoped to web search. It also makes the committed
shared source fail independently of later worktree changes because its named
type imports do not exist. Remove the accidental registry hunks from this commit
or include the complete method contract, handler ownership, registration, and
tests in the correctly scoped task.

### 2. VS Code still contributes only the legacy single-provider setting

**Severity: High**

- `libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.ts:263`
  writes `webSearch.providers`, and the user documentation names that setting at
  `apps/ptah-docs/src/content/docs/providers/web-search.md:33`.
- `apps/ptah-extension-vscode/package.json:280` still contributes
  `ptah.webSearch.provider` as a single string and has no contribution for
  `ptah.webSearch.providers`.
- The VS Code adapter delegates non-file settings to
  `vscode.workspace.getConfiguration(...).update(...)` at
  `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:111`;
  its contract test explicitly shows that an unregistered setting is rejected
  at
  `libs/backend/platform-vscode/src/implementations/vscode-workspace-dirty-settings.spec.ts:119`.

This is both documentation drift and a single-provider remnant with a concrete
cross-host cost: the new configuration can be persisted by the other adapters,
but is not a registered VS Code configuration key. Replace the contributed
setting with the array-shaped key and retain the old key only in the one legacy
read migration required by the task.

### 3. The Electron E2E test still asserts the removed single-provider UI and RPC shape

**Severity: Medium**

- The component now gives each checkbox a suffixed test id at
  `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts:114`.
- `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts:25` still mocks
  `webSearch:getConfig` with `{ provider: 'tavily' }`, line 34 still searches for
  the removed unsuffixed select, and lines 39–43 still use `selectOption()` and
  assert `params.provider`.

The task explicitly requires existing specs to move off the single-provider
shape and requires changed test ids to retain the prefix. The component did the
latter, but the existing consumer was not migrated. Update this test to mock
`providers`, operate the checkboxes, and assert `params.providers`.

### 4. The `PtahAPI` structural contract widens every new closed union to `string`

**Severity: Medium**

- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts:63` declares the
  provider override as `string[]`; lines 69, 77, and 82 do the same for provider
  values and sources; line 71 widens the result status to `string`; and lines
  83–87 widen outcome status and failure reason.
- The real contract is closed: provider ids are
  `'tavily' | 'serper' | 'exa'` at
  `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search-provider.interface.ts:21`,
  outcome status is `'ok' | 'failed'` at line 44, and failure reason is the
  three-member union at lines 33–36. `WebSearchResult.status` is likewise
  `'ok' | 'partial'` at
  `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts:57`.

The task requires the structural `PtahAPI.webSearch.search` signature to match
the actual options and result. These widenings permit impossible values at the
main API seam and make future provider/status changes drift silently. Keep the
structural shape, but use the existing provider and failure-reason types and the
exact status literal unions.

### 5. Failed providers lose required count/timing details in the agent-visible status section

**Severity: Medium**

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:684`
  accepts `resultCount` and `durationMs` for every outcome.
- The success branch renders both at line 715, while the failed branch at lines
  716–718 renders only the reason and message.
- `apps/ptah-docs/src/content/docs/providers/web-search.md:43` tells users that
  every provider's status includes duration and result count, and the task
  contract requires the formatter to list the result count for every outcome.

The data contract is correct, but the formatter drops part of it at the final
agent-facing seam. Include the failed outcome's result count; include its timing
as well so the documentation remains accurate for both branches.

### 6. The library public-API documentation omits the newly exported types

**Severity: Low**

- `libs/backend/vscode-lm-tools/src/index.ts:74` newly exports
  `WebSearchFailureReason`, `WebSearchProviderOutcome`, and
  `WebSearchAttributedResultItem`.
- The Public API inventory in `libs/backend/vscode-lm-tools/CLAUDE.md:30` still
  lists only `WebSearchProviderType` and `IWebSearchProvider` for web search.

The document otherwise describes the new behavior accurately, but its explicit
public API inventory has drifted from the barrel. Add the three new public type
exports to that inventory.

## Cross-cutting checks

- **RPC payload agreement:** The six web-search methods agree field-for-field
  between `rpc.types.ts`, `WebSearchRpcHandlers`, and the Angular component. The
  precision issue above is widening, not a missing or renamed field.
- **`VALID_PROVIDERS` duplication:** Accepted. The service-local array at
  `web-search.service.ts:70` owns search-option/config normalization, while the
  schema-local set at `web-search-rpc.schema.ts:26` owns RPC boundary validation.
  `rpc-handlers` already depends on the public `vscode-lm-tools` barrel, but the
  reverse dependency would violate the graph, and neither existing definition
  is public. Making either private module the source would therefore require a
  forbidden private import or a cycle. A new public runtime tuple would avoid
  the literals but would expand the library API solely for three stable boundary
  values; the present duplication is acceptable and is explicitly pinned by the
  schema tests and task contract.
- **Hexagonal boundary:** No changed platform-agnostic backend file imports
  `vscode` or a concrete `platform-*` adapter. Ports remain sourced from
  `platform-core`.
- **Angular:** The component is standalone and `OnPush`, uses `inject()` and
  signals, and introduces neither `BehaviorSubject` nor `[innerHTML]`.
- **Error/type hygiene:** New caught error values that are inspected use
  `catch (error: unknown)` and narrowing. No new `any`, `@ts-ignore`, or
  `@ts-expect-error` was introduced.
- **File shape:** The changed service, handler, and component remain below the
  700-line soft ceiling. The long shared RPC barrel was already an intentional
  contract barrel and grew only by the reviewed contract entries, so its length
  is not itself a finding.

## Verification note

The current checkout has unrelated uncommitted TASK_2026_373 changes in the
same shared/RPC areas. Current-worktree typechecks pass because those later
changes supply the two missing OAuth redirect types and handler. The findings
above were verified against `git show 1e812d663` and commit-local searches, not
against those uncommitted repairs.
