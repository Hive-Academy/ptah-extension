# Implementation Plan - TASK_2026_524_mkpl

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_524_mkpl/task.md`,
  `.ptah/specs/TASK_2026_524_mkpl/context.md` (D1-D5 taken as settled).
- Corrections applied: none.
- Design handoff used: none (no `visual-design-specification.md` in the folder).
- Missing decision-critical input: none. Three points where **source contradicts
  `context.md`** are resolved below and flagged inline: the D2 RPC table, the
  "lift into `libs/frontend/marketplace`" instruction, and the claim in D3 that
  nothing outside the deleted set depends on the modal.

## Codebase evidence

| Evidence                                                                                                                                                                                              | Location                                                                                                                                                                | Architectural implication                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `listInstalled` already concatenates `harnessConfigRows + claudeUserRows + smitheryRows + oauthRows` and dedupes on `(origin, configPath, serverKey)`                                                 | `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:237-258`, `:329-384`                                                                       | One RPC is the row source of truth for the whole Apps group. `listSmitheryConnections` / `listOAuthConnected` are **status decoration only**. |
| `McpServerOrigin` = `harness-config \| claude-user \| smithery \| oauth \| claude-connector`; `McpRemovalKind` = `ptah-managed \| direct \| smithery \| oauth \| none`                                | `libs/shared/src/lib/types/mcp-directory.types.ts:235-257`                                                                                                              | The row `kind`/`origin`/`removeAction` model needs no new shared type.                                                                        |
| `installedGroups` groups on `` `${origin} ${serverKey}` ``                                                                                                                                            | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:554-584` (type at `:31-47`)                                                   | The de-duplication rule to reuse, verbatim.                                                                                                   |
| `performRemoval` routes `smithery`→`uninstallSmithery`, `oauth`→`disconnectOAuth`, `ptah-managed`/`direct`→`uninstall` (+`force`)                                                                     | same file `:784-848`                                                                                                                                                    | The remove-action routing to reuse, verbatim.                                                                                                 |
| `marketplace` imports `@ptah-extension/chat-ui`; chat-ui imports nothing from marketplace                                                                                                             | `libs/frontend/marketplace/src/lib/providers.registry.ts:10-13`                                                                                                         | A function both libs share **must live in chat-ui**, not marketplace. Contradicts `context.md:65-67`.                                         |
| `marketplace/src/index.ts` is the wide barrel, reachable only by dynamic `import()` (`checkDynamicDependenciesExceptions`)                                                                            | `libs/frontend/marketplace/src/harness.ts:1-41`, `libs/frontend/marketplace/src/services.ts:1-18`                                                                       | Section-id types consumed by `chat` **cannot** live in marketplace. They go in `core`.                                                        |
| `AppStateManager.marketplaceActiveProvider` is a per-workspace slice field                                                                                                                            | `libs/frontend/core/src/lib/services/app-state.service.ts:199,207,390-391,676-680`                                                                                      | Storage key unchanged; only its value grammar changes.                                                                                        |
| `mcp-status-chip` deep-links by writing `'connectors'` / `'smithery'` then `setCurrentView('marketplace')`                                                                                            | `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts:340,356,376-379`                                                                          | Both ids die with the registry. AC6 forces this file into scope.                                                                              |
| `NativeTabGroupComponent` (`ptah-native-tab-group`) — `tabs` (`readonly NativeTab[]`), `activeId` model, `tabSelected` output, `role=tablist` + projected `role=tabpanel`, keyboard nav, count badges | `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:51-66,70-122,132-166`                                                                          | The segmented control exists. No daisyui `tabs-boxed` fallback needed.                                                                        |
| Both libs already import `@ptah-extension/ui`; `scope:webview`→`scope:webview` and `type:feature`→`type:ui` are permitted                                                                             | `eslint.config.mjs:264-266,365-372`; `libs/frontend/{marketplace,chat-ui,ui}/project.json:7`                                                                            | No boundary work required.                                                                                                                    |
| Hub template already special-cases three of six surfaces; only one reaches `NgComponentOutlet`                                                                                                        | `libs/frontend/marketplace/src/lib/marketplace-hub.component.html:55-81`; `marketplace-hub.component.ts:180-188`                                                        | `MarketplaceProviderSpec.surface?: Type<unknown>` never paid for itself. Drop it.                                                             |
| `PluginCatalogService` exposes `enabledCount` (a number) but no enabled-plugin list; `countEnabledPlugins` is private                                                                                 | `libs/frontend/core/src/lib/services/plugin-catalog.service.ts:122-133,242-255`                                                                                         | The Connected view needs names → one additive `core` change.                                                                                  |
| `SkillSelectionCardComponent` mounts `<ptah-plugin-browser-modal [isOpen]="true" (closed)=...>`                                                                                                       | `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts:11,69,115`                                                           | **Real production dependency** on the component D3 deletes. `context.md:88-90` asked for this check; the answer is yes.                       |
| `plugin-browser-modal.component.spec.ts` uses `isOpen` (`:96,302,322`) and `.modal-action .btn-primary` (`:104`); no backdrop/`closed` assertions                                                     | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.spec.ts`                                                                          | All 5 tests port to a panel; only the save selector and the `setInput` need changing.                                                         |
| No `chat-empty-state.component.spec.ts` exists; the two stubs assert only selector `ptah-chat-empty-state` + `promptSelected`                                                                         | `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:91-99,165-168`; `.../transcript/testing/transcript-spec-harness.ts:38-46,81-86`            | D4 breaks zero tests provided the selector and the one output survive.                                                                        |
| e2e/showcase hard-coded `Open <provider>` aria-labels and `ptah-plugins-surface`                                                                                                                      | `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts:51`; `.../external-marketplace.spec.ts:82-83`; `src/showcase/marketplace-tour.scene.ts:46,94,113,198` | These **do** break on the new structure, so D5's "update only if they break" is triggered.                                                    |

## Architecture decision

- **Chosen approach.** A three-entry _section_ registry in `marketplace` drives a
  `ptah-native-tab-group` strip; each section is a thin composer that mounts one
  already-existing surface at a time, chosen by an in-memory source signal. The
  Connected section is a new surface that aggregates read-only state from
  existing RPCs, grouped by a function **lifted into `chat-ui`** and shared with
  the MCP Registry Installed tab. The plugin modal body becomes
  `PluginCatalogPanelComponent` in `chat-ui`, consumed by the Skills section and
  by the dashboard card. Section/source id _types and encoding_ live in `core`.

- **Rationale.**
  - The registry loses `surface?: Type<unknown>` because the hub already
    hand-wires three of six surfaces (`marketplace-hub.component.html:55-73`) —
    the generic outlet cannot express per-surface inputs/outputs, and the new
    composers need `connectorServers`, `skillInstalled`, `serverConnected` and
    `refreshTrigger` bound differently per source.
  - Section ids live in `core` and not in `marketplace` because
    `marketplace/src/index.ts` is dynamic-import-only
    (`marketplace/src/harness.ts:1-41`) and `chat` must not import marketplace at
    all (`context.md:123-124`). `core` already owns the storage field
    (`app-state.service.ts:676-680`), so it owns its grammar.
  - The shared grouping function goes in `chat-ui`, not `marketplace`, because
    the dependency edge runs `marketplace → chat-ui`
    (`providers.registry.ts:10-13`). Putting it in marketplace would force a
    verbatim copy inside `McpDirectoryBrowserComponent` — the accumulation this
    task exists to remove.

- **Rejected alternatives.**
  - _Keep `MARKETPLACE_PROVIDERS` with three entries and a `surface` ref._
    Rejected: three of three sections need bespoke child bindings, so every
    entry would carry a `surface` nothing reads.
  - _Four RPCs for the Apps group, per `context.md:57`._ Rejected as the row
    source: `listInstalled` already returns smithery and oauth rows
    (`mcp-install.service.ts:242-243,329-384`), so the extra reads would produce
    duplicate rows the de-duplicator cannot merge (different shapes, same
    server). They are kept **only** as status decoration (below), which preserves
    the D2 outcome — every connected thing is listed, with its live state.
  - _Put the section ids in `@ptah-extension/shared`._ Rejected: `context.md:112`
    puts shared types out of scope, and this is frontend-only view state.
  - _Delete the MCP Registry Installed tab._ See below.
  - _Duplicate the plugin catalogue UI for the dashboard card._ Rejected:
    "Replace, do not accumulate."

- **Assumptions.**
  1. `plugins:list-marketplaces` can be called by the Connected view without a
     registered marketplace. _Check:_ `ExternalMarketplacesComponent` calls it
     unconditionally on load and tolerates an empty `installed`
     (`external-marketplaces.component.ts:622-634`).
  2. Angular 22 permits signal writes inside an `effect` without
     `allowSignalWrites`. _Check:_ run the new `MarketplaceStateService` spec;
     if it errors, move the deep-link consumption into an explicit
     `consumeDeepLink()` the hub calls once.

- **Effect on existing code.** Replaced: `providers.registry.ts`,
  `provider-spec.ts`, `marketplace-state.service.ts`, the hub template's overview
  grid and two-level back button. Deleted: `coming-soon-placeholder.component.ts`,
  `plugins-surface.component.ts`, `plugin-browser-modal.component.ts`,
  `plugin-status-widget.component.ts` and their specs. Left alone:
  `connectors-surface`, `smithery-surface`, `oauth-surface`,
  `external-marketplaces`, `external-*` rows/dialogs, all of `harness/`,
  `mcp-connector-rows.ts`, `harness.ts`, `services.ts`.

## Component specifications

### 1. `marketplace-section.ts` (core)

- **Purpose.** Own the grammar of the `marketplaceActiveProvider` storage field.
- **Responsibilities.** Declare `MarketplaceSection`, `MarketplaceSourceId`,
  `MARKETPLACE_SECTION_IDS`; encode and parse a deep-link target.
- **Verified contracts.**
  `AppStateManager.marketplaceActiveProvider` / `setMarketplaceActiveProvider`
  (`libs/frontend/core/src/lib/services/app-state.service.ts:390-391,676-680`).
- **Contract to add** (no class, pure module):
  - `type MarketplaceSection = 'connected' | 'apps' | 'skills'`
  - `type MarketplaceSourceId = 'connectors' | 'smithery' | 'mcp-registry' | 'custom-url' | 'ptah-plugins' | 'community' | 'marketplaces'`
  - `encodeMarketplaceTarget(section, source?): string` → `'apps'` or `'apps:smithery'`
  - `parseMarketplaceTarget(raw: string | null): { section: MarketplaceSection; source: MarketplaceSourceId | null }`
    — returns `{ section: 'connected', source: null }` for `null`, for any of the
    seven retired provider ids, and for any unparsable value. **This is AC5.**
- **Dependencies.** None (no Angular, no injection). Direction: `chat` → `core`
  and `marketplace` → `core`, both already established
  (`chat-empty-state.component.ts:21-25`, `marketplace-hub.component.ts:17-21`).
- **Integration points.** `MarketplaceStateService`, `McpStatusChipComponent`,
  `ChatEmptyStateComponent`.
- **Failure behaviour.** Total: every malformed input degrades to `connected`.
  Never throws.
- **Quality.** Zero `as any`. The source union must be exhaustive over the chips
  in `MARKETPLACE_SECTIONS` — a chip id with no union member is a compile error.
- **Verification seam.** Pure-function spec over the seven retired ids, the three
  live ids, `null`, `''`, `'apps:'`, `'apps:nonsense'`, `'skills:community'`.
- **Files.** CREATE `D:\projects\ptah-extension\libs\frontend\core\src\lib\marketplace\marketplace-section.ts`;
  MODIFY `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`.

### 2. `PluginCatalogService.enabledPlugins` (core, additive)

- **Purpose.** Expose _which_ plugins are active, not just how many.
- **Contract.** Add `readonly enabledPlugins = computed<readonly PluginInfo[]>(...)`
  using the existing opt-in/opt-out rule, and redefine
  `enabledCount = computed(() => this.enabledPlugins().length)`. Convert the
  private `countEnabledPlugins` (`plugin-catalog.service.ts:242-255`) into
  `filterEnabledPlugins` returning the array; the count derives from it so the
  two can never drift — the exact hazard its own doc comment names at `:238-240`.
- **Failure behaviour.** Unchanged: `config() === null` → empty array / `0`.
- **Verification seam.** Extend `plugin-catalog.service.spec.ts`: an opt-out
  plugin absent from `enabledPluginIds` appears in `enabledPlugins`; a plugin in
  `disabledPluginIds` does not; `enabledCount === enabledPlugins().length`.
- **Files.** MODIFY `libs\frontend\core\src\lib\services\plugin-catalog.service.ts`.

### 3. `installed-mcp-groups.ts` + `installed-mcp-removal.ts` (chat-ui, lifted)

- **Purpose.** One implementation of "group installed MCP rows" and "remove one
  group", used by the Installed tab and by the Connected view.
- **Responsibilities.**
  - `groupInstalledServers(servers: readonly InstalledMcpServer[]): InstalledServerGroup[]`
    — the body of `mcp-directory-browser.component.ts:554-584`, moved verbatim.
  - `export interface InstalledServerGroup` — moved verbatim from `:31-47`.
  - `mcpTargetLabel(target: McpInstallTarget): string` — from the module const at
    `:58` plus `getTargetLabel`.
  - `removeInstalledGroup(rpc: ClaudeRpcService, group: InstalledServerGroup): Promise<string | null>`
    — the body of `performRemoval` (`:784-848`) with `this.rpcService` and
    `this.getTargetLabel` passed in. Returns a user-facing message on any
    non-success, `null` only on full success. That contract is load-bearing and
    documented at `:776-783`.
- **Dependencies.** `@ptah-extension/shared` types, `ClaudeRpcService` **as a
  parameter, never injected** — `setup-plugins/` is a grandfathered exception to
  chat-ui's no-injected-state rule and must not be widened
  (`mcp-directory-browser.component.ts:498-502`).
- **Integration points.** `McpDirectoryBrowserComponent` (rewired to call both),
  `ConnectedSurfaceComponent`.
- **Failure behaviour.** `groupInstalledServers` is total.
  `removeInstalledGroup` never throws for a `removal: 'none'` group — it returns
  `null` without calling (matching the guard at `:743`, which stays in the
  component because it is a UI arming rule).
- **Verification seam.** New pure spec: two origins with the same `serverKey`
  stay two groups; five targets of one key collapse to one group with five
  `targets`; `configPaths` dedupes and drops empties; each `removal` kind routes
  to the right RPC and surfaces a refusal string.
- **Files.** CREATE
  `libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-groups.ts`,
  `...\installed-mcp-removal.ts`;
  MODIFY `...\mcp-directory-browser.component.ts` (delete `:31-47`, `:554-584`,
  `:784-848`, `getTargetLabel`; import instead);
  MODIFY `libs\frontend\chat-ui\src\index.ts`.

### 4. `PluginCatalogPanelComponent` (chat-ui)

- **Purpose.** The plugin catalogue as an inline panel.
- **Public API.**
  - Inputs: none. (No `isOpen`. `context.md:82-84`.)
  - Outputs: `saved = output<string[]>()` — unchanged semantics, emits the
    enabled bundled plugin ids.
  - No `closed` output, no `<dialog>`, no `.modal-box`, no `.modal-backdrop`, no
    `handleClose()`, no `XIcon` close button.
- **Extracted verbatim** from `plugin-browser-modal.component.ts`: `CategoryGroup`
  (`:37-41`), `CATEGORY_LABELS`/`CATEGORY_ORDER` (`:52-68`), `isOptOutPlugin`
  (`:82-84`), `SKILL_SELECTION_SAVE_TIMEOUT_MS` (`:94`), `skillSelectionKey`
  (`:104-112`), the whole skill-selection section (`:195-312`), the search box
  (`:340-354`), the grouped plugin list (`:356-551`), and every method from
  `isSelected` (`:787`) through `loadPlugins` (`:1113-1211`) **except**
  `handleClose`.
- **Changed, and only here:**
  1. `loadPlugins()` is driven by `ngOnInit` (`void this.loadPlugins()`) instead
     of the `isOpen` effect (`:771-781`). The `else` branch that reset
     `searchQuery`/`expandedPlugins` on close is deleted — a panel has no close.
  2. The header becomes a flat row (no `modal-box` chrome) carrying the
     `{{catalog.enabledCount()}}/{{catalog.pluginTotal()}} enabled` line the
     status widget rendered (`plugin-status-widget.component.ts:76-84`), per
     `context.md:84`.
  3. `saveConfiguration()` (`:918-975`) drops the `this.closed.emit()` at `:961`;
     everything else — the `await this.catalog.refresh()` before emitting
     (`:943-949`), the `saveSkillSelection` sequencing (`:952-959`) — is
     unchanged.
  4. The footer keeps the Save button but loses Cancel; the container changes
     from `.modal-action` to `[data-testid="plugin-catalog-save"]` on the button,
     so specs no longer key on modal chrome
     (`plugin-browser-modal.component.spec.ts:104`).
- **Dependencies.** `ClaudeRpcService`, `PluginCatalogService` (both already
  injected at `:612-618`). Unchanged direction.
- **Failure behaviour.** Unchanged and load-bearing: the skill-selection read is
  applied _before_ and _outside_ the catalogue `try` (`:1118-1147`), and a
  catalogue failure must not call `clearSkillSelection()` (`:1203-1207`). That
  ordering is the TASK_2026_345 gate regression and must survive the extraction
  byte-for-byte.
- **Quality.** OnPush, standalone, no `as any`. The panel is ~1000 lines and that
  is correct — it owns one responsibility with a long contract.
- **Verification seam.** New `plugin-catalog-panel.component.spec.ts` porting all
  five tests from `plugin-browser-modal.component.spec.ts` (`:126,161,196,295,312`),
  dropping `setInput('isOpen', ...)` and re-pointing the save click at
  `[data-testid="plugin-catalog-save"]`.
- **Files.** CREATE
  `libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-catalog-panel.component.ts`
  (selector `ptah-plugin-catalog-panel`), `...\plugin-catalog-panel.component.spec.ts`;
  MODIFY `libs\frontend\chat-ui\src\index.ts`.

### 5. `MarketplaceStateService` (marketplace, rewritten)

- **Purpose.** Own the active section, the active source chip, and the refresh
  trigger.
- **New API** (replaces `selectedProviderId`, `selectedProvider`,
  `clearSelection` at `marketplace-state.service.ts:32-60`):
  - `readonly activeSection: Signal<MarketplaceSection>` — `computed` over
    `appState.marketplaceActiveProvider()` through `parseMarketplaceTarget`.
    Never `null`.
  - `readonly activeSource: Signal<MarketplaceSourceId | null>` — `computed`
    over a private in-memory `_source` signal, falling back to the _first_ source
    of `activeSection()` when `_source` is `null` or belongs to another section.
    Not persisted (`context.md:42-44`).
  - `select(section: MarketplaceSection, source?: MarketplaceSourceId): void` —
    writes the bare section id to `appState`, sets `_source`.
  - `selectSource(source: MarketplaceSourceId): void` — sets `_source` only.
  - `readonly refreshTrigger` / `notifyContentChanged()` — unchanged
    (`:38-40,62-65`).
  - A constructor `effect` that consumes a `section:source` deep link: when the
    stored value parses to a non-null `source`, set `_source` and write the bare
    section back to `appState`. It cannot loop — the written value has no `:`.
    (See Assumption 2.)
- **Dependencies.** `AppStateManager` (`core`) and the section registry. Keeps
  `providedIn: 'root'` and keeps deriving from `AppStateManager` rather than
  snapshotting — the workspace-partitioning reason at `:6-22` is unchanged.
- **Failure behaviour.** No I/O. Every unknown id → `connected`.
- **Verification seam.** Rewrite `marketplace-state.service.spec.ts`: each of the
  seven retired ids yields `connected`; `select('skills','community')` then
  `select('apps')` leaves `activeSource()` at `'connectors'`; a `'apps:smithery'`
  deep link lands on `apps`/`smithery` and normalises storage to `'apps'`. Keep
  the workspace-partitioning cases at `:86-128` verbatim, re-pointed at new ids.
- **Files.** REWRITE `libs\frontend\marketplace\src\lib\marketplace-state.service.ts`,
  `...\marketplace-state.service.spec.ts`.

### 6. `sections.registry.ts` (marketplace, replaces `providers.registry.ts` + `provider-spec.ts`)

- **Purpose.** Declare the three sections, their labels/icons, and their chips.
- **Contract.**
  ```
  interface MarketplaceSourceSpec { id: MarketplaceSourceId; label: string }
  interface MarketplaceSectionSpec {
    id: MarketplaceSection; label: string; icon?: unknown;
    sources: readonly MarketplaceSourceSpec[];   // [] for 'connected'
  }
  const MARKETPLACE_SECTIONS: readonly MarketplaceSectionSpec[]
  ```
  - `connected` — "Connected", sources `[]`.
  - `apps` — "Apps", sources `connectors` "Connectors", `smithery` "Smithery",
    `mcp-registry` "MCP Registry", `custom-url` "Custom URL".
  - `skills` — "Skills", sources `ptah-plugins` "Ptah Plugins", `community`
    "Community", `marketplaces` "Marketplaces".
    There is **no** `surface` field — see Architecture decision.
- **Failure behaviour.** None; a static const.
- **Files.** CREATE `libs\frontend\marketplace\src\lib\sections.registry.ts`;
  DELETE `...\providers.registry.ts`, `...\provider-spec.ts`.

### 7. `ConnectedSurfaceComponent` (marketplace, new)

- **Purpose.** List everything currently connected or enabled, with its removal
  action.
- **Inputs / outputs.**
  - `refreshTrigger = input(0)` — same convention as every surface
    (`smithery-surface.component.ts:752`, `oauth-surface.component.ts:456`,
    `external-marketplaces.component.ts:496`).
  - `connectorServers = input<InstalledMcpServer[]>([])` — same reason and same
    shape as `mcp-directory-browser.component.ts:504`; the hub owns the
    `SessionMcpStatusRegistry` wiring (`marketplace-hub.component.ts:108-115`).
  - `contentChanged = output<void>()` — emitted after a successful removal so the
    hub runs `commandDiscovery.clearCache()` + `notifyContentChanged()`
    (`marketplace-hub.component.ts:175-178`).
  - `navigateRequested = output<{ section: MarketplaceSection; source: MarketplaceSourceId }>()`
    — for "Manage" and for the per-group empty-state buttons (`context.md:70-72`).
- **Aggregation model** (exported from the component file, frontend-only):
  ```
  type ConnectedRowKind = 'mcp' | 'ptah-plugin' | 'community-skill' | 'marketplace-plugin';

  type ConnectedRemoveAction =
    | { kind: 'mcp';                 label: 'Disconnect' | 'Uninstall'; group: InstalledServerGroup }
    | { kind: 'community-skill';     label: 'Uninstall'; name: string }
    | { kind: 'marketplace-plugin';  label: 'Uninstall'; listing: ExternalPluginListing }
    | { kind: 'navigate';            label: 'Manage'; section: MarketplaceSection; source: MarketplaceSourceId }
    | { kind: 'blocked';             reason: string };

  interface ConnectedRow {
    id: string;            // @for track; unique across groups
    kind: ConnectedRowKind;
    title: string;
    subtitle?: string;
    origin: string;        // originLabel / 'skills.sh' / 'owner/repo' / 'Ptah'
    status?: string;       // live state, when one is known
    removeAction: ConnectedRemoveAction;
  }

  interface ConnectedGroup {
    id: 'apps' | 'plugins' | 'community' | 'marketplaces';
    label: string;
    state: 'loading' | 'ready' | 'error';
    error?: string;
    rows: readonly ConnectedRow[];
    emptyAction: { label: string; section: MarketplaceSection; source: MarketplaceSourceId };
  }
  ```
- **Which RPC each group calls.**

  | Group          | Read                                                                                         | Rows                                                                                               | Remove                                                                                                                                                                                                    |
  | -------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `apps`         | `mcpDirectory:listInstalled` **only**, plus the `connectorServers` input                     | `groupInstalledServers([...result.servers, ...connectorServers()])` → one row per group            | `removeInstalledGroup(rpc, group)`; label `Disconnect` for `removal` `'smithery'`/`'oauth'`, `Uninstall` for `'ptah-managed'`/`'direct'`, `{kind:'blocked'}` for `'none'` carrying `removalBlockedReason` |
  | `plugins`      | `PluginCatalogService.ensureLoaded()` → `enabledPlugins()` (spec 2)                          | one row per enabled plugin, `origin: 'Ptah'`                                                       | `{kind:'navigate', label:'Manage', section:'skills', source:'ptah-plugins'}`                                                                                                                              |
  | `community`    | `skillsSh:listInstalled` (`rpc.types.ts:1246-1249`)                                          | one row per `InstalledSkill`, `title: name`, `origin: source`, tracked on `path`                   | `skillsSh:uninstall { name }` (`rpc.types.ts:1276-1279`)                                                                                                                                                  |
  | `marketplaces` | `plugins:list-marketplaces` → `result.installed` (`rpc-plugin-marketplace.types.ts:269-285`) | one row per `ExternalPluginListing`, `title: name`, `origin: source`, `subtitle: installedVersion` | `plugins:uninstall-external` (`rpc.types.ts:1126-1129`)                                                                                                                                                   |

  **Status decoration** — two extra reads, fired once per load, each optional and
  each failing silently into "no status text":
  `mcpDirectory:listSmitheryConnections` (`rpc.types.ts:1340-1343`) supplies
  `status` for rows whose `origin === 'smithery'`; `mcpDirectory:oauthStatus`
  per `origin === 'oauth'` row supplies `status`, exactly the pattern already
  proven at `connectors-surface.component.ts:672-702`. They never contribute
  rows, so they cannot duplicate anything `listInstalled` already returned.
  _This is the resolution of the `context.md:57` table against
  `mcp-install.service.ts:237-258` — same visible outcome, one row source._

- **How rows de-duplicate.** Through `groupInstalledServers` (spec 3), i.e. the
  Installed tab's own rule: identity is `` `${origin} ${serverKey}` ``, never the
  key alone, because a `github` disk entry and a `github` account connector have
  different removal paths (`mcp-directory-browser.component.ts:23-30`). The
  connector rows are pre-filtered by `toConnectorRows(entries, knownKeys)`
  (`mcp-connector-rows.ts:73-104`) with `knownKeys` = the `serverKey`s from this
  surface's own `listInstalled` result — so unlike the hub today
  (`marketplace-hub.component.ts:94-150`) the two reads are the same read and can
  never disagree. The four groups are disjoint by construction (MCP servers,
  bundled plugins, skills.sh skills, external plugins), so no cross-group
  de-duplication is needed or attempted.

- **Reload.** `ngOnInit` + an `effect` on `refreshTrigger()` that skips the
  initial `0`, matching every sibling surface
  (`mcp-directory-browser.component.ts:592-598`,
  `external-marketplaces.component.ts:573-576`). The component only mounts while
  its section is active, so an unselected section fires zero RPC — the hub's
  standing rule (`marketplace-hub.component.ts:117-132`).

- **Failure behaviour (AC/requirement 5).** The four group loads run under one
  `Promise.allSettled`; **each group owns its own `state`**. A group whose read
  rejects or returns non-success renders `state: 'error'` with the RPC's message
  and a Retry button that re-runs _only that group's_ loader; every other group
  renders its rows normally. There is no surface-wide error banner and no
  surface-wide spinner. A failed removal sets an inline error on the row's group
  and leaves the row in place; a successful one re-runs that group's loader and
  emits `contentChanged`. The decoration reads never set `state: 'error'`.

- **Quality.** OnPush, standalone, no `as any`. Row identity stable across
  reloads so `@for` does not remount mid-removal.

- **Verification seam.** New `connected-surface.component.spec.ts` (the most
  important new spec in this task): all four groups populate from mocked RPCs;
  one failing group renders an inline error while the other three render rows
  (**requirement 5**); a connector row already present in `listInstalled` renders
  once; a `removal: 'none'` row renders no button and shows its
  `removalBlockedReason`; each remove action calls the right RPC; a per-group
  empty state emits `navigateRequested` with the right section+source.

- **Files.** CREATE
  `libs\frontend\marketplace\src\lib\connected-surface.component.ts`,
  `...\connected-surface.component.spec.ts`.

### 8. `AppsSectionComponent` and `SkillsSectionComponent` (marketplace, new composers)

- **Purpose.** Render one section's chip strip and mount exactly one surface.
- **Inputs / outputs (identical on both).** `activeSource = input.required<MarketplaceSourceId>()`,
  `refreshTrigger = input(0)`, `connectorServers = input<InstalledMcpServer[]>([])`
  (Apps only), `sourceSelected = output<MarketplaceSourceId>()`,
  `contentChanged = output<void>()`.
- **Chip → surface mapping** (each mounted behind an `@if`, one at a time, so an
  unselected chip fires zero RPC):

  | Section | Chip           | Mounts                                                                   | Bindings                                                                                                                                |
  | ------- | -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
  | Apps    | `connectors`   | `<ptah-connectors-surface>` (`connectors-surface.component.ts:122`)      | `refreshTrigger`                                                                                                                        |
  | Apps    | `smithery`     | `<ptah-smithery-surface>` (`smithery-surface.component.ts:105`)          | `refreshTrigger`, `serverInstalled`/`serverUninstalled` → `contentChanged` (`:752-757`)                                                 |
  | Apps    | `mcp-registry` | `<ptah-mcp-directory-browser>`                                           | `refreshTrigger`, `connectorServers`, `serverInstalled`/`serverUninstalled` → `contentChanged` (`marketplace-hub.component.html:56-61`) |
  | Apps    | `custom-url`   | `<ptah-oauth-surface>` (`oauth-surface.component.ts:118`)                | `refreshTrigger`, `serverConnected`/`serverDisconnected` → `contentChanged` (`:456-461`)                                                |
  | Skills  | `ptah-plugins` | `<ptah-plugin-catalog-panel>` (spec 4)                                   | `saved` → `onSaved()`                                                                                                                   |
  | Skills  | `community`    | `<ptah-skill-sh-browser>` (`skill-sh-browser.component.ts:44`)           | `refreshTrigger`, `skillInstalled`/`skillUninstalled` → `contentChanged` (`:402-407`)                                                   |
  | Skills  | `marketplaces` | `<ptah-external-marketplaces>` (`external-marketplaces.component.ts:88`) | `refreshTrigger` (`:496`)                                                                                                               |

- **Skills header.** Carries `<ptah-harness-health-badge>`
  (`harness-health-badge.component.ts:55`) and the `{enabled}/{total} enabled`
  line, taking over the header block at `plugins-surface.component.ts:50-71`.
  `onSaved()` keeps the surviving behaviour of
  `plugins-surface.component.ts:116-120`: `commandDiscovery.clearCache()` plus
  `harnessHealth.refresh({ refresh: true })` — the reason is unchanged
  (`:104-115`) and dropping it would leave the badge reporting a pre-save answer.
- **Dependencies.** `CommandDiscoveryFacade` (`core`), `HarnessHealthStore`
  (local), chat-ui surfaces. No new edges.
- **Failure behaviour.** None of its own — each mounted surface keeps its
  existing error handling. `context.md:113-115` keeps them unrewritten.
- **Verification seam.** Covered through `marketplace-hub.component.spec.ts`
  (chip click swaps the mounted surface; the non-selected surface never mounts).
- **Files.** CREATE `libs\frontend\marketplace\src\lib\apps-section.component.ts`,
  `...\skills-section.component.ts`;
  DELETE `...\plugins-surface.component.ts`.

### 9. `MarketplaceHubComponent` (marketplace, rewritten shell)

- **Purpose.** Header, section strip, and the `SessionMcpStatusRegistry` wiring.
- **Changes.**
  - Template: delete the overview grid (`marketplace-hub.component.html:83-135`)
    and the `backToOverview` branch (`:6-17`); keep back-to-chat (`:18-30`), the
    Store icon and the `Marketplace` heading (`:31-45`) — the e2e smoke test
    asserts that heading (`marketplace.spec.ts:32`). Insert
    `<ptah-native-tab-group [tabs]="sectionTabs" [activeId]="activeSection()" (tabSelected)="onSection($event)">`
    wrapping the section body.
  - TS: delete `backToOverview`, `isGenericSurface`, `iconOf`, `selectProvider`,
    `McpSurface`/`SkillsSurface`/`OAuthSurface` refs
    (`marketplace-hub.component.ts:76-79,152-188`) and the
    `ComingSoonPlaceholderComponent` import (`:32,60`).
  - **Keep** `connectorServers` (`:108-115`) and `onContentChanged` (`:175-178`).
  - **Keep** `installedServerKeys` + `loadInstalledServerKeys`
    (`:94,125-150`) but re-gate the effect on
    `activeSection() === 'apps' && activeSource() === 'mcp-registry'`. It still
    exists for the MCP Registry chip; the Connected view does its own read.
  - `onSection(id)` → `state.select(id as MarketplaceSection)`;
    `navigateRequested` from the Connected surface →
    `state.select(section, source)`.
- **Failure behaviour.** Unchanged: a failed `listInstalled` keeps the previous
  key set rather than resurrecting duplicate rows (`:141-149`).
- **Verification seam.** `marketplace-hub.component.spec.ts`, re-pointed: three
  tabs render; the default section is `connected`; selecting `apps` +
  `mcp-registry` mounts the browser and fires the key read; selecting `skills`
  fires none (replacing the `'composio'` case at `:228`).
- **Files.** MODIFY `...\marketplace-hub.component.ts`, `...\marketplace-hub.component.html`,
  `...\marketplace-hub.component.spec.ts`; MODIFY `...\src\index.ts`;
  DELETE `...\coming-soon-placeholder.component.ts`.

### 10. `ChatEmptyStateComponent` (chat) — the after-state

- **What remains.** The hero block (`chat-empty-state.component.ts:82-109`); the
  Intelligent Project Setup glass card with `<ptah-setup-status-widget>`
  (`:222-267`); **one** `<ptah-prompt-suggestions>` (the second copy at `:183-185`
  goes with the skills tab); the hieroglyph footer (`:276-282`); the `Skills Not
Configured` warning (`:193-220`) with `hasConfiguredSkills()` (`:373-375`)
  unchanged — including its deliberate suppression until the catalogue loads.
- **What goes.** The tab bar (`:111-143`), the Ptah Skills card (`:146-187`),
  `<ptah-plugin-status-widget>` (`:176-178`), `<ptah-plugin-browser-modal>`
  (`:285-290`), `activeTab` (`:362`), `setActiveTab` (`:378-385`),
  `isPluginBrowserOpen` (`:359`), `openPluginBrowser`/`closePluginBrowser`
  (`:388-395`), `onPluginsSaved` (`:405-408`), the `PuzzleIcon` (`:352`), the
  `.tab*` styles (`:317-329`), and the `CommandDiscoveryFacade` injection
  (`:335`) which only `onPluginsSaved` used. `.tab-content-animated` (`:302-315`)
  is kept and applied to the remaining content block.
- **The warning button, without importing marketplace.** It becomes:
  ```
  this.appState.setMarketplaceActiveProvider(
    encodeMarketplaceTarget('skills', 'ptah-plugins'),
  );
  void this.navigation.navigateToView('marketplace');
  ```
  `encodeMarketplaceTarget` comes from `@ptah-extension/core` (spec 1) — chat
  never names `marketplace`. `WebviewNavigationService.navigateToView` is used
  rather than `appState.setCurrentView` because it honours the
  `canNavigate()` busy guard (`webview-navigation.service.ts:66-69,96-103`) and
  is the hub's own choice (`marketplace-hub.component.ts:166`). The catalogue
  read that `setActiveTab('setup')` performed (`:380-384`) moves to
  `ngOnInit` → `void this.catalog.ensureLoaded()`; without it the warning would
  never evaluate.
- **Contract preserved.** Selector `ptah-chat-empty-state` and
  `promptSelected = output<string>()` (`:348`) are unchanged, which is the whole
  of what the two test stubs bind
  (`chat-view.keepalive.spec.ts:91-99,165-168`;
  `transcript-spec-harness.ts:38-46,81-86`). **Neither stub file needs editing**
  — they use empty templates and a `remove: { imports: [...] }` that still
  resolves. They are listed in B2 as _verify-only_.
- **Files.** MODIFY `libs\frontend\chat\src\lib\components\molecules\setup-plugins\chat-empty-state.component.ts`;
  MODIFY `libs\frontend\chat\src\lib\components\molecules\mcp-status-chip.component.ts`
  (`navigateToMarketplace` at `:376-379` now takes
  `'smithery' | 'connectors'` and writes
  `encodeMarketplaceTarget('apps', source)`; call sites `:340,356` unchanged —
  **this is AC6**).

### 11. `SkillSelectionCardComponent` (dashboard) — rehost

- **Why it is in scope.** It is the one production consumer of
  `PluginBrowserModalComponent` outside the deleted set
  (`skill-selection-card.component.ts:11,69,115`), and D3 explicitly asked for
  this check (`context.md:88-90`).
- **Change.** The card owns the dialog chrome it used to borrow:
  `@if (pickerOpen()) { <dialog class="modal modal-open"><div class="modal-box max-w-2xl"><button …(click)="onPickerClosed()">×</button><ptah-plugin-catalog-panel (saved)="onPickerClosed()" /></div><div class="modal-backdrop" (click)="onPickerClosed()"></div></dialog> }`.
  `onPickerClosed()` (`:172-175`) is unchanged and still re-reads
  `harness:get-skill-selection` — its reasoning at `:163-171` ("the picker
  reports neither what was chosen nor whether anything was") holds identically
  for the panel.
- **What is preserved.** The modal stays a **sibling** of the card section
  (`:57-61`) so a spec asserting "this card contains no checkboxes" keeps
  holding, and so the picker outlives the card.
- **Files.** MODIFY
  `libs\frontend\dashboard\src\lib\components\skill-selection-card\skill-selection-card.component.ts`
  and its spec.

## The MCP Registry Installed tab — keep

**Decision: keep it**, unchanged in behaviour. Reasons, in order of weight:

1. Removing it is not a clean excision. `loadInstalled()` also feeds
   `installedKeySet` → `isServerInstalled()`
   (`mcp-directory-browser.component.ts:586-588,850-853`), which drives the
   _browse_ tab's "Installed" badge and its disabled Install button. Deleting the
   tab means keeping the read, so the saving is template-only.
2. The component lives in `chat-ui` — the lib batch B1 owns. Removing the tab in
   the same window as the panel extraction puts two large edits in one 1014-line
   file for no functional gain.
3. `connectorServers` (`:504`) exists only to feed that tab. Deleting the tab
   orphans the input and leaves `toConnectorRows` (`mcp-connector-rows.ts:73`)
   with one caller in a different lib.
4. The duplication with the Connected view is intentional and local: the
   Registry chip answers "what do I have _from this registry_" next to its
   browse results; Connected answers "what do I have _at all_". They share one
   grouping function (spec 3), so they cannot drift.

## Integration architecture

- **Data flow.** `AppStateManager.marketplaceActiveProvider` (string, workspace
  slice) → `parseMarketplaceTarget` → `MarketplaceStateService.activeSection` /
  `activeSource` → `MarketplaceHubComponent` tab strip → one section composer →
  one mounted surface → `ClaudeRpcService` → extension host. Removals flow back
  as `contentChanged` → `commandDiscovery.clearCache()` +
  `notifyContentChanged()` → `refreshTrigger` → every mounted surface reloads
  (`marketplace-hub.component.ts:175-178`).
- **State and persistence.** Only the section id persists, in the existing key.
  The source chip and `refreshTrigger` are in-memory, owned by the root-provided
  `MarketplaceStateService` and therefore partitioned per workspace only through
  `AppStateManager` — which is why `activeSection` must stay a `computed` over
  app state and must not be snapshotted (`marketplace-state.service.ts:6-22`).
- **External boundaries.** No new RPC, no new wire type, no new backend handler.
  Every method named here is already in `RPC_METHODS`
  (`rpc.types.ts:3520-3573`). Nothing user-supplied crosses a boundary in this
  change.
- **Failure and rollback.** Per-group in the Connected view (spec 7). Elsewhere
  unchanged. There is no multi-step write in this task, so no rollback path.
- **Observability.** Existing `console.error` / `console.warn` on the paths that
  already have them. The new Connected-view group errors are user-visible inline,
  which is the evidence path that matters here.

## Architecture-level quality requirements

- **Functional.** The seven acceptance criteria in `context.md:130-143`, with
  AC5 pinned by `parseMarketplaceTarget` (spec 1) and AC6 by the
  `mcp-status-chip` edit (spec 10).
- **Performance.** An unselected section and an unselected chip fire zero RPC.
  The Connected view issues at most `4 + 1 + n(oauth rows)` reads per load; the
  per-row OAuth read is the pattern already shipped at
  `connectors-surface.component.ts:678-695`.
- **Security.** Not applicable — no secret crosses this code. `toConnectorRows`
  keeps emitting `config.url: ''` for account connectors
  (`mcp-connector-rows.ts:94`).
- **Maintainability.** `marketplace` must not gain a static importer of its wide
  barrel (`harness.ts:1-41`). `chat` must not import `marketplace`. `chat-ui`
  must not import `chat` and must not inject state into `setup-plugins/`
  (`mcp-directory-browser.component.ts:498-502`). One grouping function and one
  removal router, not two. Zero `as any`, zero `@ts-ignore`.
- **Testability.** Behaviour that must be covered: retired provider id →
  `connected`; a `section:source` deep link lands on the right chip; the four
  Connected groups populate and one failing group does not suppress the other
  three; grouping keeps two origins of one key apart; each removal kind routes to
  its RPC; the panel renders and saves the skill selection with both plugin reads
  failing. No percentage target.

## Team-leader handoff

- **Recommended executors.** All batches `frontend-developer` — every file is an
  Angular component, a signal service or a frontend pure module. B4's e2e and
  showcase edits are Playwright/TypeScript in `apps/` and still frontend work.
- **Complexity: HIGH.** Five libraries, ~1200 lines extracted verbatim under a
  documented ordering constraint (spec 4, failure behaviour), four deletions with
  live consumers, and two e2e suites plus a narrated showcase scene to re-point.
- **Dependencies and ordering.** B1a → { B1, B2 } → B3 → B4. B1 and B2 are
  file-disjoint and may run together once B1a has landed
  (`encodeMarketplaceTarget` is B2's only import from it). B3 consumes B1's panel
  and grouping exports and B1a's types. B4 deletes only what B2 and B3 stopped
  using.
- **Parallel-safe work.** B1 (chat-ui) ∥ B2 (chat). Nothing else.

| Batch   | Lib                                             | May touch — exactly these files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Runs after |
| ------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **B1a** | `core`                                          | CREATE `libs/frontend/core/src/lib/marketplace/marketplace-section.ts`, `…/marketplace-section.spec.ts`; MODIFY `libs/frontend/core/src/index.ts`, `libs/frontend/core/src/lib/services/plugin-catalog.service.ts`, `…/plugin-catalog.service.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —          |
| **B1**  | `chat-ui`                                       | CREATE `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/{installed-mcp-groups.ts, installed-mcp-groups.spec.ts, installed-mcp-removal.ts, plugin-catalog-panel.component.ts, plugin-catalog-panel.component.spec.ts}`; MODIFY `…/mcp-directory-browser.component.ts`, `libs/frontend/chat-ui/src/index.ts`. **Does not delete the modal or the widget** — both stay exported so `chat` and `dashboard` keep compiling.                                                                                                                                                                                                                                                                                    | B1a        |
| **B2**  | `chat`                                          | MODIFY `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts`, `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts`. Verify-only (expect no edit): `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`, `libs/frontend/chat/src/lib/components/organisms/transcript/testing/transcript-spec-harness.ts`. **Must not touch** `libs/frontend/chat/src/lib/components/index.ts` — that is B4's.                                                                                                                                                                                                                         | B1a        |
| **B3**  | `marketplace`                                   | CREATE `libs/frontend/marketplace/src/lib/{sections.registry.ts, connected-surface.component.ts, connected-surface.component.spec.ts, apps-section.component.ts, skills-section.component.ts}`; REWRITE `…/marketplace-state.service.ts`, `…/marketplace-state.service.spec.ts`; MODIFY `…/marketplace-hub.component.{ts,html,spec.ts}`, `libs/frontend/marketplace/src/index.ts`; DELETE `…/providers.registry.ts`, `…/provider-spec.ts`, `…/plugins-surface.component.ts`, `…/coming-soon-placeholder.component.ts`                                                                                                                                                                                           | B1, B1a    |
| **B4**  | cleanup: `chat-ui`, `chat`, `dashboard`, `apps` | DELETE `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/{plugin-browser-modal.component.ts, plugin-browser-modal.component.spec.ts, plugin-status-widget.component.ts}`; MODIFY `libs/frontend/chat-ui/src/index.ts` (drop `:74-75`), `libs/frontend/chat/src/lib/components/index.ts` (drop `:124-125`), `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts` + its spec, `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` (`:44-51`), `apps/ptah-electron-e2e/src/specs/marketplace/external-marketplace.spec.ts` (`:16-27, 73-77, 80-87`), `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts` (`:46, 94, 113, 166, 198`) | B2, B3     |

- **Files affected.**
  - CREATE (12): `core/src/lib/marketplace/marketplace-section.{ts,spec.ts}`;
    `chat-ui/.../setup-plugins/{installed-mcp-groups.ts, installed-mcp-groups.spec.ts, installed-mcp-removal.ts, plugin-catalog-panel.component.ts, plugin-catalog-panel.component.spec.ts}`;
    `marketplace/src/lib/{sections.registry.ts, connected-surface.component.ts, connected-surface.component.spec.ts, apps-section.component.ts, skills-section.component.ts}`.
  - MODIFY (17): `core/src/index.ts`, `core/.../plugin-catalog.service.{ts,spec.ts}`;
    `chat-ui/.../mcp-directory-browser.component.ts`, `chat-ui/src/index.ts`;
    `chat/.../chat-empty-state.component.ts`, `chat/.../mcp-status-chip.component.ts`, `chat/src/lib/components/index.ts`;
    `marketplace/src/lib/marketplace-hub.component.{ts,html,spec.ts}`, `marketplace/src/index.ts`;
    `dashboard/.../skill-selection-card.component.ts` + spec;
    `apps/ptah-electron-e2e/src/specs/marketplace/{marketplace,external-marketplace}.spec.ts`,
    `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts`.
  - REWRITE (2): `marketplace/src/lib/marketplace-state.service.{ts,spec.ts}`.
  - DELETE (7): `marketplace/src/lib/{providers.registry.ts, provider-spec.ts, plugins-surface.component.ts, coming-soon-placeholder.component.ts}`;
    `chat-ui/.../setup-plugins/{plugin-browser-modal.component.ts, plugin-browser-modal.component.spec.ts, plugin-status-widget.component.ts}`.

- **Spec plan.**
  - _New (required):_ `connected-surface.component.spec.ts` — the four-group
    aggregation and the partial-failure requirement;
    `installed-mcp-groups.spec.ts` — grouping and removal routing;
    `plugin-catalog-panel.component.spec.ts` — the five ported cases;
    `marketplace-section.spec.ts` — id validation and deep-link parsing.
  - _Must change:_ `marketplace-state.service.spec.ts` (8 of 9 tests hard-code
    `'skills-sh'` / `'official-mcp'`; the workspace-partitioning cases at
    `:86-128` port verbatim with new ids); `marketplace-hub.component.spec.ts`
    (`:137` and the `'composio'` second-id case at `:228`);
    `plugin-catalog.service.spec.ts` (add `enabledPlugins`);
    `skill-selection-card.component.spec.ts`;
    `marketplace.spec.ts:51`; `external-marketplace.spec.ts:80-87` (only
    `openPluginsSurface` — every `external-*` testid and copy assertion survives
    untouched).
  - _Deleted:_ `plugin-browser-modal.component.spec.ts`, after its five cases are
    ported.
  - _Unchanged, verify only:_ `chat-view.keepalive.spec.ts`,
    `transcript-spec-harness.ts`, `mcp-directory-browser.component.spec.ts`,
    `connectors-surface.component.spec.ts`, `smithery-surface.component.spec.ts`,
    `oauth-surface.component.spec.ts`, `external-marketplaces.component.spec.ts`,
    all of `harness/`.

- **Verification points.**
  - `npx nx run-many -t test -p @ptah-extension/marketplace @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/dashboard` — read the
    "Running target test for 5 projects" header. **Five, not the four in
    `context.md:126-128`**: `dashboard` is pulled in by the
    `SkillSelectionCardComponent` rehost.
  - `npx nx run-many -t lint -p …` — the module-boundary rule must still reject
    any static import of `@ptah-extension/marketplace`
    (`checkDynamicDependenciesExceptions`, `marketplace/src/harness.ts:1-41`).
  - `npx nx run-many -t typecheck -p …` — zero `as any`, zero `@ts-ignore`.
  - Contracts to honour: the panel's skill-selection read stays outside and
    before the catalogue `try` (`plugin-browser-modal.component.ts:1118-1147`,
    `:1203-1207`); `saveConfiguration` still awaits `catalog.refresh()` before
    emitting (`:943-949`); group identity stays `` `${origin} ${serverKey}` ``
    (`mcp-directory-browser.component.ts:554-564`); `ChatEmptyStateComponent`
    keeps selector `ptah-chat-empty-state` and `promptSelected`.
  - Data change: `marketplaceActiveProvider` values written before this task
    must open Connected, not a blank page. No migration is written — that is
    what `parseMarketplaceTarget`'s default is for.
  - The showcase scene fails _soft_ (`isVisible().catch(() => false)` guards), so
    B4 must diff the beat indices against
    `apps/ptah-electron-e2e/src/showcase/scripts/marketplace-tour.json` — its 9
    VO lines are pinned 1:1 to indices 0-8 and line 6 ("more providers landing
    soon") has no referent once the Composio tile is gone. Re-scripting means
    re-narrating; if that is out of budget, B4 should drop beats 6-8 and record
    the shortened script rather than leave narration over dead footage.
