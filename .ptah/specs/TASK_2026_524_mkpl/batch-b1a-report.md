# Batch B1a — `@ptah-extension/core` — COMPLETE

Specs implemented: implementation-plan.md spec 1 (`marketplace-section.ts`) and
spec 2 (`PluginCatalogService.enabledPlugins`). No file outside the B1a row of
the handoff table was touched.

## Files changed

- CREATED `libs/frontend/core/src/lib/marketplace/marketplace-section.ts`
- CREATED `libs/frontend/core/src/lib/marketplace/marketplace-section.spec.ts`
- MODIFIED `libs/frontend/core/src/index.ts` (barrel export block added above
  `SESSION_DATA_PROVIDER`)
- MODIFIED `libs/frontend/core/src/lib/services/plugin-catalog.service.ts`
- MODIFIED `libs/frontend/core/src/lib/services/plugin-catalog.service.spec.ts`

## Exported symbols (available from `@ptah-extension/core`)

| Symbol                                | Kind      | Shape                                                                                                             |
| ------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `MarketplaceSection`                  | type      | `'connected' \| 'apps' \| 'skills'`                                                                               |
| `MarketplaceSourceId`                 | type      | `'connectors' \| 'smithery' \| 'mcp-registry' \| 'custom-url' \| 'ptah-plugins' \| 'community' \| 'marketplaces'` |
| `MarketplaceTarget`                   | interface | `{ section: MarketplaceSection; source: MarketplaceSourceId \| null }`                                            |
| `MARKETPLACE_SECTION_IDS`             | const     | `readonly ['connected','apps','skills']`                                                                          |
| `encodeMarketplaceTarget`             | function  | `<S extends MarketplaceSection>(section: S, source?: SourceOf<S> \| null) => string`                              |
| `parseMarketplaceTarget`              | function  | `(raw: string \| null) => MarketplaceTarget`                                                                      |
| `PluginCatalogService.enabledPlugins` | signal    | `Signal<readonly PluginInfo[]>`                                                                                   |

Section→chip ownership (`connected: []`, `apps: connectors, smithery,
mcp-registry, custom-url`, `skills: ptah-plugins, community, marketplaces`) is a
module-private `SECTION_SOURCES` const, declared
`as const satisfies Record<MarketplaceSection, readonly MarketplaceSourceId[]>`
so a chip id with no union member is a compile error (spec 1 "Quality").

### Notes for B2 and B3

- `parseMarketplaceTarget` is total and never throws. `null`, `''`, whitespace,
  and all seven retired ids (`connectors`, `plugins`, `official-mcp`,
  `skills-sh`, `smithery`, `oauth-mcp`, `composio`) return
  `{ section: 'connected', source: null }` — AC5.
- A live section with an unknown, empty, or wrong-section source keeps the
  section and nulls the source (`'apps:community'` → `{ apps, null }`).
- `encodeMarketplaceTarget` is strict when the section is a literal:
  `encodeMarketplaceTarget('apps', 'community')` is a **compile error**. When
  the section is only known as the widened union the type check cannot fire, so
  a mismatched source is also dropped at runtime (emits `'apps'`), which keeps
  encode/parse round-tripping.
- `enabledCount` is now `computed(() => this.enabledPlugins().length)`. The
  private `countEnabledPlugins` became `filterEnabledPlugins` returning
  `readonly PluginInfo[]`; it is still NOT exported (it remains the store's own
  derivation). `enabledPlugins()` is `[]` while `config()` is `null`, i.e. before
  a read lands, after a failed config read, and immediately after a workspace
  switch.

## Verification

| Command                                                           | Result                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/core`                 | PASS — header `Running target test for project @ptah-extension/core` (1 project). Re-run with `--skip-nx-cache --output-style=static`: **32 suites passed, 813 tests passed**, 0 failed. |
| `npx nx run-many -t lint -p @ptah-extension/core`                 | PASS — `Successfully ran target lint for project @ptah-extension/core`.                                                                                                                  |
| `npx jest --config libs/frontend/core/jest.config.ts --listTests` | Confirms `marketplace-section.spec.ts` is collected by the project's jest config (the new directory needed no config change).                                                            |

Note: `-- --testPathPattern=...` was not honoured by the `@nx/jest:jest`
executor, so the 813-test figure is the whole `core` suite, not just the two
touched specs. That is a stronger result, not a weaker one — nothing else in
`core` regressed.

Zero `as any`, zero `@ts-ignore`, zero `eslint-disable` added.

## Deviations from the plan

1. **`MarketplaceTarget` is exported as a named interface.** The plan writes
   `parseMarketplaceTarget`'s return as an inline object type. Naming it costs
   nothing and lets `MarketplaceStateService` (B3) hold one in a signal without
   restating the shape. The structure is exactly as specified.
2. **`encodeMarketplaceTarget` is generic in its section.** The plan's signature
   is `(section, source?) => string`. The generic form accepts every call the
   plain signature would accept except a literal section paired with another
   section's chip, which it rejects at compile time. This is the plan's own
   "Quality" requirement applied to the call site as well as the declaration.
3. **`SECTION_SOURCES` is not exported.** The plan's export list does not name
   it and B3 owns `MARKETPLACE_SECTIONS` (the chip registry with labels and
   icons). Export it from here later only if B3 finds it genuinely needs the
   ownership map separately from its own registry — say so rather than
   duplicating the mapping.

## Out-of-scope observations

- `libs/frontend/marketplace/src/lib/providers.registry.ts:25-79` still holds
  the seven retired ids; B3 deletes it. Nothing in `core` imports it.
- `hasEnabledPlugins` still reads `config()?.enabledPluginIds.length`, so it is
  false for a workspace whose only live plugins are opt-out (harness/skills.sh)
  while `enabledCount()` is non-zero. Pre-existing, outside spec 2's contract,
  and not changed here — but if the Skills section header uses it as an
  "anything configured?" test it will read wrong. Flagging for B3.
