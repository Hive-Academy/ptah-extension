# Batch 2 report: lib scaffolds and path mapping (Task 2.1)

Executor: frontend-developer. No git commands were run. `batches.md`, `task.md`, `prototype/` and the root
`eslint.config.mjs` were not touched.

## Files

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772`

CREATED (declarative-dashboard, `@ptah-extension/declarative-dashboard`, tags `scope:webview`, `type:ui`, `platform:angular`)

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\project.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\tsconfig.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\tsconfig.lib.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\tsconfig.spec.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\jest.config.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\eslint.config.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\test-setup.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\index.ts` (`export {};`)

CREATED (mcp-apps-page, `@ptah-extension/mcp-apps-page`, tags `scope:webview`, `type:feature`, `platform:angular`)

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\project.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\tsconfig.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\tsconfig.lib.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\tsconfig.spec.json`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\jest.config.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\eslint.config.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\test-setup.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\index.ts` (`export {};`)

MODIFIED

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\tsconfig.base.json`: two path entries
  after `@ptah-extension/harness-builder/services`. They are `@ptah-extension/declarative-dashboard` ->
  `./libs/frontend/declarative-dashboard/src/index.ts` and `@ptah-extension/mcp-apps-page` ->
  `./libs/frontend/mcp-apps-page/src/index.ts`. There is no `/services` subpath.

## How the files were produced

The files were copied from `libs/frontend/harness-builder/` with `harness-builder` replaced by the lib name, and the
tags were replaced. No Nx generator was run, so no sample component was created and none had to be deleted. Each
lib's config matches harness-builder:

- `tsconfig.json` has `"strict": true` plus the same Angular strict-template options.
- Jest uses `jest-preset-angular` with the zone setup in `src/test-setup.ts`.
- `eslint.config.mjs` uses the `ptah` selector prefix and extends the root config.
- `project.json` has no `build` target (non-buildable), and has `test` (`@nx/jest:jest`), `lint` (`@nx/eslint:lint`)
  and `typecheck` (`nx:run-commands`, `npx ngc --noEmit --project libs/frontend/<lib>/tsconfig.lib.json`).

## Deviation from the harness-builder pattern (superseded by Fix round 1)

This deviation no longer applies. Fix round 1 reverted both `typecheck` targets to harness-builder's form (see below).
The original reasoning is kept here as a record.

The `typecheck` target used
`"commands": [{ "command": "npx ngc --noEmit ...", "forwardAllArgs": false }]` in place of harness-builder's
`"command": "..."`. The reason:

- `nx:run-commands` forwards unknown CLI arguments to the command by default. The required batch command therefore ran
  `ngc ... --passWithNoTests`, which failed with `error TS5023: Unknown compiler option '--passWithNoTests'`.
- harness-builder has the same problem. `npx nx run @ptah-extension/harness-builder:typecheck --passWithNoTests`
  exits 1.
- `forwardAllArgs: false` is the documented `nx:run-commands` option for this. No other `project.json` in `libs/`
  uses it yet.

## Evidence

1. First run with the harness-builder-identical `typecheck`:
   `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page --passWithNoTests`
   gave exit 1. The failed tasks were `declarative-dashboard:typecheck` and `mcp-apps-page:typecheck`. Lint and test
   passed.
2. `npx nx run @ptah-extension/declarative-dashboard:typecheck --passWithNoTests` showed the forwarded command
   `npx ngc --noEmit --project libs/frontend/declarative-dashboard/tsconfig.lib.json --passWithNoTests`, which gave
   `TS5023: Unknown compiler option '--passWithNoTests'`. The same command without the flag exits 0.
3. After the `forwardAllArgs: false` change, the same command (with `--parallel=2 --output-style=static`) exited 0:
   - `Linting "@ptah-extension/mcp-apps-page"... ✔ All files pass linting`
   - `Linting "@ptah-extension/declarative-dashboard"... ✔ All files pass linting`
   - `No tests found, exiting with code 0` (x2, expected because the libs are empty)
   - `NX   Successfully ran targets lint, typecheck, test for 2 projects`
4. `npx nx show projects --projects "@ptah-extension/declarative-dashboard,@ptah-extension/mcp-apps-page" --json`
   exited 0 with `["@ptah-extension/declarative-dashboard","@ptah-extension/mcp-apps-page"]`.

Noise that did not affect the result:

- Nx Cloud reported that the organization is disabled (401). This affects remote caching only.
- `@nx/eslint:lint` printed a deprecation notice. harness-builder uses the same executor.

## R8 (no zod or new lib in the initial bundle)

- Both `src/index.ts` files contain only `export {};`. There are no imports, so neither lib brings in zod,
  `@ptah-extension/shared/mcp-apps-contracts*` or any other dependency at this stage.
- No new npm dependency was added, and `package.json` was not touched.
- The two new libs are only mapped in `tsconfig.base.json`. Nothing in the webview app imports them yet, so they
  contribute nothing to the initial bundle. `app.config.ts` is not part of this batch.
- The `mcp-apps-page` path is the lazy-only entry from D6. The `/services` subpath (R7) was left out, so no eager side
  entry exists for a later batch to import by mistake.
- The initial-bundle comparison against `9afac1aa2` is the B19 gate and is not run in this batch.

## Fix round 1

Source: code-style-review.md blocking #1 and code-logic-review.md Batch 2 minor.

- Both `typecheck` targets were reverted to exactly harness-builder's form:
  `"typecheck": { "executor": "nx:run-commands", "options": { "command": "npx ngc --noEmit --project libs/frontend/<lib>/tsconfig.lib.json" } }`.
  The `commands` array and `forwardAllArgs: false` were removed from
  `libs/frontend/declarative-dashboard/project.json` and `libs/frontend/mcp-apps-page/project.json`.
- The workaround is no longer needed. `nx.json` `targetDefaults` already sets `passWithNoTests` for
  `@nx/jest:jest`, and the batch verification command no longer passes `--passWithNoTests`, so no flag gets
  forwarded to `ngc`.

Evidence (from the worktree root):
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page --skip-nx-cache --output-style=static --parallel=2`
exited 0.

- `✔ All files pass linting` (x2)
- `No tests found, exiting with code 0` (x2)
- `NX   Successfully ran targets lint, typecheck, test for 2 projects`
- `Cache: Skipped (--skip-nx-cache)`, run duration 4.2s
