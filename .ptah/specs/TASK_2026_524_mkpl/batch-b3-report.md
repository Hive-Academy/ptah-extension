# Batch B3 report — TASK_2026_524_mkpl

**Status: implementation complete, verification BLOCKED by an out-of-scope
regression in `@ptah-extension/core`.** See "Blocking regression" below. No file
outside `libs/frontend/marketplace` was touched.

Specs 5, 6, 7, 8 and 9 of `implementation-plan.md` implemented.

## Files changed

CREATED

- `libs/frontend/marketplace/src/lib/sections.registry.ts`
- `libs/frontend/marketplace/src/lib/connected-surface.component.ts`
- `libs/frontend/marketplace/src/lib/connected-surface.component.spec.ts`
- `libs/frontend/marketplace/src/lib/apps-section.component.ts`
- `libs/frontend/marketplace/src/lib/skills-section.component.ts`

REWRITTEN

- `libs/frontend/marketplace/src/lib/marketplace-state.service.ts`
- `libs/frontend/marketplace/src/lib/marketplace-state.service.spec.ts`
- `libs/frontend/marketplace/src/lib/marketplace-hub.component.html`
- `libs/frontend/marketplace/src/lib/marketplace-hub.component.ts`

MODIFIED

- `libs/frontend/marketplace/src/lib/marketplace-hub.component.spec.ts` —
  re-pointed at the section strip; the five connector-row cases kept verbatim.
- `libs/frontend/marketplace/src/index.ts` — registry and new component exports.
- `libs/frontend/marketplace/jest.config.ts` — comment only (named a deleted file).
- `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` —
  doc comment only (`{@link PluginsSurfaceComponent}` no longer resolves).

DELETED

- `libs/frontend/marketplace/src/lib/providers.registry.ts`
- `libs/frontend/marketplace/src/lib/provider-spec.ts`
- `libs/frontend/marketplace/src/lib/plugins-surface.component.ts`
- `libs/frontend/marketplace/src/lib/coming-soon-placeholder.component.ts`

## Public API

### `sections.registry.ts` (spec 6)

```ts
interface MarketplaceSourceSpec {
  readonly id: MarketplaceSourceId;
  readonly label: string;
  readonly icon: LucideIconData;
}
interface MarketplaceSectionSpec {
  readonly id: MarketplaceSection;
  readonly label: string;
  readonly icon: LucideIconData;
  readonly sources: readonly MarketplaceSourceSpec[];
}
const MARKETPLACE_SECTIONS: readonly MarketplaceSectionSpec[];
function marketplaceSourcesOf(section: MarketplaceSection): readonly MarketplaceSourceSpec[];
```

`connected` → no chips. `apps` → `connectors`, `smithery`, `mcp-registry`,
`custom-url`. `skills` → `ptah-plugins`, `community`, `marketplaces`. No
`surface` field.

### `MarketplaceStateService` (spec 5)

```ts
readonly activeSection: Signal<MarketplaceSection>          // never null
readonly activeSource:  Signal<MarketplaceSourceId | null>  // null only for 'connected'
readonly refreshTrigger: Signal<number>
select(section: MarketplaceSection, source?: MarketplaceSourceId): void
selectSource(source: MarketplaceSourceId): void
notifyContentChanged(): void
consumeDeepLink(): void
```

`activeSection` is a `computed` over `AppStateManager.marketplaceActiveProvider()`
through `parseMarketplaceTarget` — retired ids and anything unparsable land on
`connected` (AC5). Only the bare section id persists; the chip is in-memory and
falls back to the section's first chip whenever it is null or belongs to
another section.

### `ConnectedSurfaceComponent` (spec 7) — `ptah-connected-surface`

```ts
refreshTrigger    = input(0)
connectorServers  = input<InstalledMcpServer[]>([])
contentChanged    = output<void>()
navigateRequested = output<{ section: MarketplaceSection; source: MarketplaceSourceId }>()
readonly groups: Signal<readonly ConnectedGroup[]>
```

Also exported (types): `ConnectedRowKind`, `ConnectedRemoveAction`,
`ConnectedRow`, `ConnectedGroupId`, `ConnectedGroup`.

Four groups under one `Promise.allSettled`, each owning its own
`state`/`error`/Retry:

| Group          | Read                                                                                        | Remove                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps`         | `mcpDirectory:listInstalled` only, plus `connectorServers`, through `groupInstalledServers` | `removeInstalledGroup(rpc, group)`; `Disconnect` for smithery/oauth, `Uninstall` for ptah-managed/direct, blocked reason for `none` |
| `plugins`      | `PluginCatalogService.ensureLoaded()` → `enabledPlugins()`                                  | `Manage` → `skills`/`ptah-plugins`                                                                                                  |
| `community`    | `skillsSh:listInstalled`                                                                    | `skillsSh:uninstall { name }`                                                                                                       |
| `marketplaces` | `plugins:list-marketplaces` → `installed`                                                   | `plugins:uninstall-external { pluginId }`                                                                                           |

Status decoration from `mcpDirectory:listSmitheryConnections` (once) and
`mcpDirectory:oauthStatus` (per oauth row), both failing silently into "no
status badge" and never setting a group's `state`. Connector rows are re-derived
with `toConnectorRows` against **this** surface's own `listInstalled` keys, so
the two reads can never disagree.

### `AppsSectionComponent` (spec 8) — `ptah-apps-section`

```ts
activeSource = input.required<MarketplaceSourceId>();
refreshTrigger = input(0);
connectorServers = input<InstalledMcpServer[]>([]);
sourceSelected = output<MarketplaceSourceId>();
contentChanged = output<void>();
```

Chip strip is a `join` of `btn-sm` buttons with `aria-pressed` and
`role="group"`. One surface mounted at a time behind `@if`:
`ptah-connectors-surface` / `ptah-smithery-surface` /
`ptah-mcp-directory-browser` / `ptah-oauth-surface`.

### `SkillsSectionComponent` (spec 8) — `ptah-skills-section`

Same inputs/outputs minus `connectorServers`. Header carries
`<ptah-harness-health-badge>` and the `{enabled}/{total} enabled` line
(`data-testid="skills-enabled-count"`). Mounts
`ptah-plugin-catalog-panel` / `ptah-skill-sh-browser` /
`ptah-external-marketplaces`. `onSaved()` runs
`commandDiscovery.clearCache()` + `harnessHealth.refresh({ refresh: true })`.

### `MarketplaceHubComponent` (spec 9)

Keeps back-to-chat, the Store icon and the `Marketplace` `<h1>`. Adds
`<ptah-native-tab-group [tabs]="sectionTabs" [activeId]="activeSection()"
(tabSelected)="onSection($event)">` wrapping an `@switch` over
`activeSection()`. Keeps `connectorServers` and `onContentChanged`. Keeps
`installedServerKeys` + `loadInstalledServerKeys`, now gated on
`activeSection() === 'apps' && activeSource() === 'mcp-registry'`. New public
`onSection(id)`, `onSource(source)`, `onNavigateRequested({section, source})`.
`backToOverview`, `isGenericSurface`, `iconOf`, `selectProvider` and the three
surface refs are gone.

## Verification

Two passes, either side of a concurrent edit to `libs/frontend/core/src/index.ts`
that this batch does not own.

### Pass 1 — before the regression (all source + hub/state/connected specs in place)

| Command                                                                                        | Result                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/marketplace --skip-nx-cache --output-style=static` | **PASS** — header `Running target test for project @ptah-extension/marketplace` (1 project). **13 suites passed, 13 total; 279 tests passed, 279 total.**                                            |
| `npx nx run-many -t lint -p @ptah-extension/marketplace --skip-nx-cache`                       | **PASS** — 0 errors, 4 warnings, all pre-existing (`max-lines` on `smithery-surface` 753, `oauth-surface`… 722, `external-marketplaces` 1277; one `explicit-member-accessibility` on a constructor). |
| `npx tsc -p libs/frontend/marketplace/tsconfig.lib.json --noEmit`                              | **PASS** — no output.                                                                                                                                                                                |
| `npx nx run @ptah-extension/marketplace:typecheck` (ngc, templates included)                   | **PASS** — one pre-existing NG8107 warning in `chat-ui`.                                                                                                                                             |

### Pass 2 — after the regression (current tree)

| Command                                                           | Result                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx nx run-many -t test -p @ptah-extension/marketplace`          | **FAIL** — 2 suites failed, 11 passed; 35 failed, 244 passed. Every failure is `TypeError: (0, core_2.parseMarketplaceTarget) is not a function` in `marketplace-state.service.ts:47`.           |
| `npx tsc -p libs/frontend/marketplace/tsconfig.lib.json --noEmit` | **FAIL** — 11 × `TS2305: Module '"@ptah-extension/core"' has no exported member 'MarketplaceSection' / 'MarketplaceSourceId' / 'parseMarketplaceTarget'`. Zero errors in this batch's own logic. |
| `npx nx run-many -t lint -p @ptah-extension/marketplace`          | **PASS**, unchanged.                                                                                                                                                                             |

## Blocking regression (NOT fixed here — outside B3's ownership)

`libs/frontend/core/src/index.ts` no longer re-exports B1a's
`./lib/marketplace/marketplace-section`. The module file itself is intact at
`libs/frontend/core/src/lib/marketplace/marketplace-section.ts`; only the barrel
line is gone. `git diff --cached` on that file shows the surviving change is an
unrelated `export * from './lib/services/providers-settings-state.service';`
addition from another lane, so B1a's block was overwritten rather than
deliberately removed.

Restoring this block in `libs/frontend/core/src/index.ts` returns the tree to
Pass 1:

```ts
export { MARKETPLACE_SECTION_IDS, encodeMarketplaceTarget, parseMarketplaceTarget, type MarketplaceSection, type MarketplaceSourceId, type MarketplaceTarget } from './lib/marketplace/marketplace-section';
```

B2 (`chat`) imports `encodeMarketplaceTarget` from the same barrel and is
broken by the same regression.

## Deviations from the plan

1. **`MarketplaceSectionSpec.icon` is typed `LucideIconData`, not `unknown`, and
   `MarketplaceSourceSpec` gained an `icon`.** `NativeTabGroupComponent` renders
   no icon, so a section icon would have been dead weight at `unknown`; the chip
   strip does render one, which is what pays for the field. Typing it concretely
   also removes the `iconOf(icon: unknown)` cast the old hub needed — that cast
   was the only `as`-shaped narrowing in the file and it is now gone.
2. **`marketplaceSourcesOf(section)` is exported alongside `MARKETPLACE_SECTIONS`.**
   The state service and both composers need "the chips of section X"; a helper
   beats three `.find(...)?.sources ?? []` copies. B1a deliberately kept its own
   `SECTION_SOURCES` private and told B3 to own the registry — this is that
   ownership.
3. **Deep-link consumption is an `effect` that calls a public `consumeDeepLink()`,
   rather than either alternative alone.** Angular 22 allows the signal write, so
   the effect works (verified by the new spec). It is an effect and not a
   one-shot hub call because the hub is kept alive across view switches: a chip
   deep-link written by `chat` while the hub is already mounted must still be
   adopted. `consumeDeepLink()` stays public so a host can force it.
4. **`ConnectedGroup.error` is also used for a failed REMOVAL on an otherwise
   `ready` group.** The plan asks for "an inline error on the row's group,
   leaving the row in place"; reusing the field keeps one error slot per group
   rather than adding a second. The Retry button renders only for
   `state === 'error'`, so a removal failure never offers a Retry that would
   re-run a load the user did not ask for.
5. **The Apps empty state points at `apps`/`connectors`, not `mcp-registry`.**
   The plan does not name the four empty-state targets. Connectors is the first
   Apps chip and the shortest path from "nothing connected" to "connected".
6. **`connectorServers` input is round-tripped through `toConnectorRows`.** The
   input arrives as `InstalledMcpServer[]` (the hub already mapped it), but the
   plan requires re-filtering against this surface's own `listInstalled` keys.
   The rows are mapped back to `{ name, status: 'connected' }` entries and
   re-run through `toConnectorRows`, so the normalisation and the set-difference
   rule stay in one place instead of being re-implemented as an inline filter.

## Quality

Zero `as any`, zero `@ts-ignore`, zero `eslint-disable` added. Every new
component is standalone + `OnPush` + signals. Neither the deleted
`PluginBrowserModalComponent` nor `PluginStatusWidgetComponent` is imported
anywhere in this lib any more — `skills-section.component.ts` uses
`PluginCatalogPanelComponent`.

Accessibility: the section strip is `NativeTabGroupComponent`
(`role=tablist`/`tab`/`tabpanel`, roving tabindex, arrow/Home/End). Both chip
strips are `role="group"` with an `aria-label` and per-button `aria-pressed`.
Connected rows give each Remove/Manage button an `aria-label` of
`"<action> <title>"`, each group `aria-busy` while loading, and each group error
`role="alert"`.

## Out-of-scope observations

- `hasEnabledPlugins` in `core` still reads `config()?.enabledPluginIds.length`,
  so it is false for a workspace whose only live plugins are opt-out while
  `enabledCount()` is non-zero (flagged by B1a). The Skills header renders
  `enabledCount()`/`pluginTotal()` and never touches `hasEnabledPlugins`, so
  this batch is not affected.
- `apps/ptah-electron-e2e/src/specs/marketplace/{marketplace,external-marketplace}.spec.ts`
  and `src/showcase/marketplace-tour.scene.ts` still assert `Open <provider>`
  aria-labels and `ptah-plugins-surface`, both of which are gone. That is B4's row.
- `smithery-surface.component.ts` (753), `oauth-surface.component.ts` (722) and
  `external-marketplaces.component.ts` (1277) remain over the 700-line
  `max-lines` warning. Pre-existing; `context.md` keeps them unrewritten.
