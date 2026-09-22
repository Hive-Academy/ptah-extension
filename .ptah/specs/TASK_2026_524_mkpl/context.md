# Context — TASK_2026_524_mkpl

## The complaint

The Marketplace page (`libs/frontend/marketplace`) shows seven tiles:
Connectors, Plugins, MCP Registry, Skills, Smithery, Connected Apps, Composio
(coming soon). These are only two or three concepts split by _source_:

- **Skills for the agent**: bundled Ptah plugins, GitHub plugin marketplaces,
  skills.sh community skills.
- **Apps / MCP servers**: curated connectors, Smithery hosted servers, the
  official MCP registry, custom OAuth remote servers, claude.ai account
  connectors.

Nothing on the page says what is actually connected or enabled. Each surface
keeps its own private "installed" list. The Ptah plugins flow goes through a
1212-line modal (`PluginBrowserModalComponent`). The chat welcome screen
duplicates the plugin widget and modal behind a "Ptah Skills" tab.

## Decisions

### D1 — Three sections, no drill-in tiles

The hub header keeps the title and the back-to-chat button. Below it a
persistent segmented control switches between three sections:

| Section id  | Label     | Content                                                                                              |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `connected` | Connected | Aggregated list of everything active. Default section.                                               |
| `apps`      | Apps      | Curated connectors first. Source chips: Connectors, Smithery, MCP Registry, Custom URL.              |
| `skills`    | Skills    | Ptah plugins inline first. Source chips: Ptah Plugins, Community (skills.sh), Marketplaces (GitHub). |

The seven-tile overview grid is deleted. `MARKETPLACE_PROVIDERS` becomes a
three-entry section registry (or is replaced by a section union). The Composio
placeholder and `ComingSoonPlaceholderComponent` are deleted. The
`backToOverview` two-level back button is deleted; only back-to-chat remains.

Persisted selection: `AppStateManager.marketplaceActiveProvider` keeps its
storage key and now stores the section id. `MarketplaceStateService`
validates the id against the three sections, so any old persisted id
(`connectors`, `official-mcp`, ...) degrades to `connected`. The active source
chip inside a section is an in-memory signal on `MarketplaceStateService`,
not persisted.

Deep links: `MarketplaceStateService.select(id)` is what external callers
(mcp-status-chip, the welcome screen warning) use. `AppStateManager.
setMarketplaceActiveProvider('skills')` from a lib that cannot import
`marketplace` is acceptable because `core` owns the state.

### D2 — Connected view

A new `ConnectedSurfaceComponent` in `libs/frontend/marketplace` aggregates
read-only state from existing RPCs only. No backend change.

| Group                | Source of truth                                                                                                                                                                                           | Row action                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Apps and MCP servers | `mcpDirectory:listInstalled`, `mcpDirectory:listSmitheryConnections`, `mcpDirectory:listOAuthConnected` (+ `oauthStatus` per server), `SessionMcpStatusRegistry` account connectors via `toConnectorRows` | Disconnect / Uninstall    |
| Ptah plugins         | `PluginCatalogService` (`enabledCount`, `pluginTotal`, enabled plugin names)                                                                                                                              | "Manage" → skills section |
| Community skills     | `skillsSh:listInstalled`                                                                                                                                                                                  | Uninstall                 |
| Marketplace plugins  | `plugins:list-marketplaces` installed entries (reuse what `ExternalMarketplacesComponent` reads)                                                                                                          | Uninstall                 |

Rows are de-duplicated the same way the MCP Registry Installed tab does today
(`installedGroups` in `mcp-directory-browser.component.ts`, and the
`installedServerKeys` guard in the hub). If the Installed-tab grouping logic can
be lifted into a shared, testable function in `libs/frontend/marketplace`, do
that rather than copying it. The MCP Registry surface keeps its Installed tab
only if removing it costs more than keeping it; the architect decides and
records why.

Empty state: one line per group with a button that jumps to the matching
section and source chip.

Reload: the surface re-reads on the existing `refreshTrigger` and when the
section becomes active. An unselected section fires zero RPC (keep the hub's
standing rule).

### D3 — Ptah plugins inline, no modal

In `libs/frontend/chat-ui`, extract the modal body into
`PluginCatalogPanelComponent` (selector `ptah-plugin-catalog-panel`). Same
behaviour: category groups, opt-in/opt-out toggles, skill list per plugin,
skill selection mode, search, Save. No `isOpen` input, no overlay, no
`closed` output. It keeps the `saved` output. The header row shows the
`{enabled}/{total} enabled` count that `PluginStatusWidgetComponent` showed.

After the Skills section mounts the panel, delete `PluginBrowserModalComponent`,
`PluginStatusWidgetComponent`, their specs and barrel exports. Port the modal
spec assertions that still apply to a panel spec. Check
`libs/frontend/dashboard/.../skill-selection-card` for a real dependency before
deleting anything.

`PluginsSurfaceComponent` is replaced by the Skills section composer. The
`HarnessHealthBadgeComponent` stays in the Skills section header.

### D4 — Chat welcome screen

`ChatEmptyStateComponent` (`libs/frontend/chat/.../chat-empty-state.component.ts`):

- Delete the tab bar, the "Ptah Skills" card, `PluginStatusWidgetComponent`,
  `PluginBrowserModalComponent`, `activeTab`, `isPluginBrowserOpen`,
  `openPluginBrowser`, `closePluginBrowser`, `onPluginsSaved`.
- Keep the hero, the Intelligent Project Setup card, `SetupStatusWidget`, one
  `PromptSuggestionsComponent`, and the footer.
- Keep the "Skills Not Configured" warning. Its button now opens the
  Marketplace Skills section (navigate to `'marketplace'` and set the section
  id to `skills`).
- Update the test stubs in `chat-view.keepalive.spec.ts` and
  `transcript-spec-harness.ts` if their stub contract changes.

### D5 — Out of scope

- Backend RPC handlers, shared types (except removing dead frontend-only types).
- Visual redesign of the individual surfaces (Smithery, OAuth form, connectors
  cards). They are re-hosted, not rewritten.
- The Electron showcase scene `marketplace-tour.scene.ts` and the e2e spec
  `marketplace.spec.ts`. Update only if they break on the new structure.

## Constraints

- Angular 22 standalone, signals, OnPush. `libs/frontend/ui` primitives for
  the segmented control if one exists (check `Native*` components) else
  daisyui `tabs-boxed`.
- Lib boundaries: `marketplace` → `chat-ui`, `core`, `chat-state`, `shared`.
  `chat` must not import `marketplace`. `chat-ui` must not import `chat`.
- Zero new `as any`, zero `@ts-ignore`.
- Tests: `npx nx run-many -t test -p @ptah-extension/marketplace
@ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/core` and read
  the "Running target test for 4 projects" header.

## Acceptance criteria

1. The Marketplace page shows exactly three sections and no tile grid.
2. The Connected section lists installed MCP servers, OAuth apps, Smithery
   connections, account connectors, enabled Ptah plugins, installed community
   skills and installed marketplace plugins, each with a working remove action
   where one exists today.
3. The Ptah plugin catalog is editable inline in the Skills section. No modal
   component remains in the repo.
4. The chat welcome screen has no tab bar and no plugin widget or modal.
5. An old persisted provider id opens the Connected section, not a blank page.
6. `mcp-status-chip` still opens the Marketplace on a valid section.
7. Lint, module-boundary lint and the four projects' tests pass.
