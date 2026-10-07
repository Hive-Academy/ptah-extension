# B-P PD — dead-key removal report

## Files changed

Changed only under `apps/ptah-docs/`, `libs/backend/platform-core/`, `libs/backend/memory-curator/`, `libs/backend/skill-synthesis/`, `libs/backend/rpc-handlers/`, `libs/shared/`, `libs/frontend/memory-curator-ui/`, `libs/frontend/skill-synthesis-ui/`, `libs/frontend/core/`, and `libs/frontend/webview-e2e-harness/` in `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`. No `tools/` files were touched.

## Removed

- `memory.curatorEnabled`: registration/default and Memory settings documentation.
- `memory.triggers.preCompact`: registration/default, memory trigger DTO/config read/flattening, diagnostics and RPC schema/response member, accordion control, fixtures, specs, and docs.
- `skillSynthesis.triggers.sessionEnd`: registration/default, skill trigger DTO/config read/flattening, diagnostics and RPC schema/response member, Skills control, fixtures, specs, and docs.

Persisted unknown keys remain harmless: `PtahFileSettingsManager.loadSync()` flattens arbitrary JSON keys and does not validate or reject them.

## Done-check

```text
rg -n 'memory\.curatorEnabled' apps libs -g '!tools/**'
(no output)
rg -n 'memory\.triggers\.preCompact' apps libs -g '!tools/**'
(no output)
rg -n 'skillSynthesis\.triggers\.sessionEnd' apps libs -g '!tools/**'
(no output)
```

## Checks

```text
npx nx run-many -t typecheck -p platform-core,memory-curator,skill-synthesis,shared,rpc-handlers,memory-curator-ui,skill-synthesis-ui,webview-e2e-harness --parallel=2
NX   Successfully ran target typecheck for 8 projects (50s)
```

Lint, tests, and Prettier were not run before the lane time limit.

## Deviations

None. The preserved memory `sessionEnd` trigger and all PreCompact hook/compaction symbols were left intact.
