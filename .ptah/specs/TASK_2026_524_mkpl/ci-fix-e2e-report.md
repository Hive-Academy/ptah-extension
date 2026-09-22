# CI fix — electron-e2e on PR #569

## Failures

Seven specs failed in CI run 35725088434. One was a locator collision in
`marketplace.spec.ts` (two headings matched "Marketplace"). Six were
canvas-tile interactions that timed out: three in `canvas.spec.ts`,
`compaction-duplicate-session.spec.ts`, `harness-builder.spec.ts`, and
`task-370-concurrent-session-isolation.spec.ts`.

## Root cause (reproduced locally)

A probe spec dumped the grid after "Add new session tile": the new
`gridstack-item` carried no `gs-*` attributes and no size style, while the
first tile kept its singleton geometry `(0,0,12,6)` with `gs-no-move`. The
second tile was never registered with the grid engine, so it overlapped the
first one and intercepted every click.

Renderer console during that step:

```
Angular Error: TypeError: Cannot read properties of undefined (reading 'length')
    at PluginCatalogService.hasEnabledPlugins
    at ChatEmptyStateComponent.hasConfiguredSkills
```

`hasEnabledPlugins` read `config().enabledPluginIds.length`. The e2e harness
has no mock for `plugins:get-config`, so the fake listener answers `{}` and the
field is `undefined`. On main this computed was only evaluated after a click on
the welcome screen's Setup tab, which no spec did. TASK_2026_524 removed the
tab bar, so the "Skills Not Configured" warning evaluates it on first paint in
every tile. The throw inside change detection aborted the render pass that was
creating the new tile.

## Fix

- `libs/frontend/core/src/lib/services/plugin-catalog.service.ts`:
  `hasEnabledPlugins` optional-chains `enabledPluginIds`.
- `plugin-catalog.service.spec.ts`: a partial config record reads as
  "nothing opted in" and does not throw.
- `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts`:
  heading locator uses `exact: true`.

## Verification

Local `build-dev` + `copy-renderer-dev`, then Playwright on the six specs:

```
13 passed (3.2m)
```

Unit tests and lint for marketplace, chat-ui, chat, core, dashboard: green.
