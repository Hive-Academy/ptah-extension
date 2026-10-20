## Root cause

`libs/shared/project.json:12-15` used `@nx/esbuild:esbuild` to emit `dist/libs/shared`, but did not set `declarationRootDir`. Nx's esbuild executor sets the declaration `rootDir` to the workspace root by default (`node_modules/@nx/esbuild/dist/src/executors/esbuild/esbuild.impl.js:168`). The workspace TypeScript base config also specifies that root (`tsconfig.base.json:4`). Consequently, declarations emitted by the shared build land under `dist/libs/shared/libs/shared/src`, while `libs/shared/package.json:8,15` advertises `./src/index.d.ts`. Angular's buildable dependency remap points `@ptah-extension/shared` at `dist/libs/shared`, so the UI production build resolves the wrong declaration view. A direct pre-fix declaration emit confirmed the nested `libs/shared/src/index.d.ts` layout.

The missing names are present in source and declaration emit: `libs/shared/src/index.ts:16` exports `rpc.types.ts`; that file re-exports provider, git, and peer session contracts at lines 18, 22, and 41. The purge did not delete those contracts. The TS7053 and TS7006 errors follow from the missing imported types.

## Fix

- `libs/shared/project.json:15` — set `declarationRootDir` to `libs/shared`, aligning emitted declarations with the package's existing `./src/index.d.ts` entry.

## Checks

- `NX_NO_CLOUD=true npx nx run-many -t typecheck lint test -p @ptah-extension/shared --parallel=1` — passed, 3/3 targets.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/ui --parallel=1` — passed.
- `npx tsc -p libs/shared/tsconfig.lib.json --declaration --emitDeclarationOnly --noEmit false --rootDir libs/shared --outDir <temp>` — passed; emitted `src/index.d.ts`, and provider, git, and peer session declarations include all seven missing names. Temporary output removed.
- `git diff --check` — passed.

## Decisions

The change is restricted to the shared build configuration. No skill synthesis, skill judge, or curator diagnostics types were restored. The source exports are intact, so explicit re-exports would only mask the declaration layout problem.

## Risks

The production build target was prohibited for this investigation. CI must confirm a clean shared build writes `dist/libs/shared/src/index.d.ts` and the UI production build resolves it successfully. Existing local `dist` files may be stale and were not used as proof of the new build output.