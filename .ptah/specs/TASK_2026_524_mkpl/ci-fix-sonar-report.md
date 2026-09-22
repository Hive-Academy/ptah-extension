# PR #569 Sonar and Electron assertion fixes

All four required verification commands passed (exit code 0). No commit, push, or history-changing git command was run.

## Files changed

- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-removal.ts`
- `libs/frontend/marketplace/src/lib/connected-surface.component.spec.ts`
- `libs/frontend/marketplace/src/lib/marketplace-hub.component.spec.ts`
- `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts`
- `.ptah/specs/TASK_2026_524_mkpl/ci-fix-sonar-report.md`

## Changes and helpers

- Added the explicit `localeCompare` comparator to `skillSelectionKey`.
- Introduced private `applyCatalogConfig(plugins, config)` to extract configuration-to-selection application from `loadPlugins`. Skill-selection application remains before and outside the catalogue try; the catalogue catch never clears skill selection. Error/loading signal semantics are unchanged.
- Introduced module-private `removeManaged(rpc, group)` for the ptah-managed/direct removal branch. Return values and message text are unchanged.
- Converted exactly the three requested length assertions to `toHaveLength`.
- Added `exact: true` to the Marketplace heading locator; no other change in the Electron spec.
- No `as any`, `@ts-ignore`, or `eslint-disable` added. `git diff --check` passed.

## Verification output

Nx's default output suppressed the successful tasks' internal logs. The actual task success and summary lines are reproduced below; no suite counts are inferred. Both requested test targets passed. The Electron check was TypeScript compilation, not an Electron browser run. SonarCloud itself was not rerun locally.

### `npx tsc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit`

Exit code: 0.

No stdout or stderr; TypeScript emitted no summary lines.

### `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/marketplace --skip-nx-cache`

Exit code: 0.

```text

 NX   Running target test for 2 projects:

- @ptah-extension/chat-ui
- @ptah-extension/marketplace


√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/marketplace:test



 NX   Successfully ran target test for 2 projects


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      42.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     42.6s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Cache: drop --skip-nx-cache to restore unchanged tasks instantly.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/marketplace:test    42.6s
```

### `npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/marketplace --skip-nx-cache`

Exit code: 0.

```text

 NX   Running target lint for 2 projects:

- @ptah-extension/chat-ui
- @ptah-extension/marketplace


√  nx run @ptah-extension/marketplace:lint
√  nx run @ptah-extension/chat-ui:lint



 NX   Successfully ran target lint for 2 projects


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      20.1s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     19.8s (1 task)
  Recoverable time:  <1ms
```

### `npx tsc -p apps/ptah-electron-e2e/tsconfig.spec.json --noEmit`

Exit code: 0.

No stdout or stderr; TypeScript emitted no summary lines.
