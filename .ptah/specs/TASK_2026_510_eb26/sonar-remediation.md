## Changes

1. **Duplication:** Created `apps/ptah-electron/scripts/lib/native-addon.js`, lines 1–162, as a CommonJS module containing the shared workspace root, ABI fallback table, version/ABI readers, musl detection, prebuild target and addon resolution, probe prefix, and Electron SQLite probe. Updated `apps/ptah-electron/scripts/rebuild-native.js`, lines 30–41 and 129–143, and `apps/ptah-electron/scripts/verify-packed-native.js`, lines 39–48 and 68–82, to use it. Both existing export lists are unchanged. Rebuild retains its three-argument wrapper, optional ABI validation, root package path, and exact success log; verification retains its four-argument wrapper and strict ABI validation. The shared version reader preserves the explicit missing-Electron error. No new dependency was added.
2. **javascript:S3776:** Extracted `validatePackedAddon` in `apps/ptah-electron/scripts/verify-packed-native.js`, lines 191–234, and replaced the loop body in lines 280–290. SHA-256 comparison, ABI marker reading, runtime probing, success output, and failure messages remain intact; orchestration and final reporting remain in `main()`. Manual cognitive-complexity review gives the helper 3 (one unnested `if`, one `catch`, one conditional expression) and `main()` 10, both below 15. These are local counts, not a SonarCloud scan result.
3. **javascript:S4036:** Added the absolute-path guard immediately before launching Electron in `apps/ptah-electron/scripts/lib/native-addon.js`, lines 118–124. A relative executable path throws before execution. The `execFileSync` line carries `// NOSONAR`; its adjacent comment explains that the executable comes from `node_modules`, is asserted absolute, and requires no PATH search.
4. **javascript:S7772:** All built-in imports in `apps/ptah-electron/scripts/lib/native-addon.js`, lines 3–6, use `node:`. Replaced the touched child-process import in `apps/ptah-electron/scripts/rebuild-native.js`, line 30. The verifier's former inline unprefixed child-process require was removed with the extracted probe. Unrelated existing imports were left unchanged.
5. **Docstring coverage:** Every function in `apps/ptah-electron/scripts/lib/native-addon.js` has JSDoc at lines 31, 39, 49, 56–60, 76, and 92. Updated wrapper documentation in `apps/ptah-electron/scripts/rebuild-native.js`, line 129, and `apps/ptah-electron/scripts/verify-packed-native.js`, line 68. Documented the extracted validator and changed main function in the verifier at lines 191 and 236. Unchanged functions received no additional comments.

The build surface follows `CLAUDE.md` (Setup and Development Commands), `apps/ptah-electron/CLAUDE.md` (Build & Run), `apps/ptah-electron/project.json` (existing `rebuild-native`, `package`, `package-local-production`, `test`, and `lint` targets), and root `package.json` (`postinstall`). No trigger, release destination, secret, or environment-variable requirement changed. Only the three authorized script files and this requested report were written. Work remains on `codex/fix-electron-builder-windows-packaging`; nothing was staged, committed, pushed, or branched. Rollback is to restore the two script edits and remove the new shared module together.

## Verification

All three required commands ran from `D:\projects\ptah-extension`. Each exited with code 0. The exact requested test command ran all suites: 47 passed, one skipped; 640 tests passed, three skipped. Lint completed with 0 errors and 12 warnings. Its quoted output below is from the final rerun after the last edit.

1. `npx nx test ptah-electron --testPathPattern=better-sqlite3-packaging`

> NX Running target test for project ptah-electron and 6 tasks it depends on:
>
> > nx run ptah-electron:build-main:production
>
> > nx run ptah-electron:build-integrity-worker
>
> > nx run ptah-electron:build-workspace-watch-host
>
> > nx run ptah-electron:build-embedder-worker
>
> > nx run ptah-electron:build-state-storage-worker
>
> > nx run ptah-electron:build-voice-worker
>
> > nx run ptah-electron:test --testPathPattern=better-sqlite3-packaging
>
> The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
> ts-jest[ts-compiler] (WARN) Got a `.js` file to compile while `allowJs` option is not set to `true` (file: D:\projects\ptah-extension\apps\ptah-electron\scripts\rebuild-native.js). To fix this:
>
> - if you want TypeScript to process JS files, set `allowJs` to `true` in your TypeScript config (usually tsconfig.json)
> - if you do not want TypeScript to process your `.js` files, in your Jest config change the `transform` key which value is `ts-jest` so that it does not match `.js` files anymore
>   ts-jest[ts-compiler] (WARN) Got a `.js` file to compile while `allowJs` option is not set to `true` (file: D:\projects\ptah-extension\apps\ptah-electron\scripts\lib\native-addon.js). To fix this:
> - if you want TypeScript to process JS files, set `allowJs` to `true` in your TypeScript config (usually tsconfig.json)
> - if you do not want TypeScript to process your `.js` files, in your Jest config change the `transform` key which value is `ts-jest` so that it does not match `.js` files anymore
>   ts-jest[ts-compiler] (WARN) Got a `.js` file to compile while `allowJs` option is not set to `true` (file: D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-native.js). To fix this:
> - if you want TypeScript to process JS files, set `allowJs` to `true` in your TypeScript config (usually tsconfig.json)
> - if you do not want TypeScript to process your `.js` files, in your Jest config change the `transform` key which value is `ts-jest` so that it does not match `.js` files anymore
>   Test Suites: 1 skipped, 47 passed, 47 of 48 total
>   Tests: 3 skipped, 640 passed, 643 total
>   Snapshots: 0 total
>   Time: 126.217 s
>   Ran all test suites.
>
> NX Successfully ran target test for project ptah-electron and 6 tasks it depends on
>
> Run duration: 2m 22s
> Cache: 0/7 hit (0%)
> Critical path: 2m 15s (2 tasks)
> Recoverable time: 6.4s (4% of the run)
>
> Recommendations: - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/oKQgx56UDH. - Speed up or split the longest tasks on the critical path:
> ptah-electron:test 2m 9s

2. `npx nx lint ptah-electron`

> > nx run ptah-electron:lint
>
> The `@nx/eslint:lint` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/eslint:convert-to-inferred` to migrate to the `@nx/eslint/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
> Linting "ptah-electron"...
> D:\projects\ptah-extension\apps\ptah-electron\scripts\backup-local-production-data.js
> 162:5 warning There is no `cause` attached to the symptom error being thrown preserve-caught-error
> D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-native.js
> 153:7 warning There is no `cause` attached to the symptom error being thrown preserve-caught-error
> 181:7 warning There is no `cause` attached to the symptom error being thrown preserve-caught-error
> D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-wasm.js
> 71:9 warning The value assigned to 'size' is not used in subsequent statements no-useless-assignment
> D:\projects\ptah-extension\apps\ptah-electron\src\activation\post-window.ts
> 63:7 warning The value assigned to 'updateManager' is not used in subsequent statements no-useless-assignment
> 64:7 warning The value assigned to 'messagingGateway' is not used in subsequent statements no-useless-assignment
> D:\projects\ptah-extension\apps\ptah-electron\src\activation\workspace-restore.ts
> 32:7 warning The value assigned to 'flushWorkspacePersistence' is not used in subsequent statements no-useless-assignment
> D:\projects\ptah-extension\apps\ptah-electron\src\di\electron-adapters.ts
> 253:19 warning Unexpected empty method 'dispose' @typescript-eslint/no-empty-function
> D:\projects\ptah-extension\apps\ptah-electron\src\integration\wizard-seed.integration.spec.ts
> 306:5 warning The value assigned to 'nativeAvailable' is not used in subsequent statements no-useless-assignment
> D:\projects\ptah-extension\apps\ptah-electron\src\services\electron-browser-capabilities.ts
> 398:7 warning There is no `cause` attached to the symptom error being thrown preserve-caught-error
> 501:33 warning Unexpected empty arrow function @typescript-eslint/no-empty-function
> 611:36 warning Unexpected empty arrow function @typescript-eslint/no-empty-function
> ✖ 12 problems (0 errors, 12 warnings)
> ✖ 12 problems (0 errors, 12 warnings)
>
> NX Successfully ran target lint for project ptah-electron
>
> Run duration: 10.2s
> Cache: 0/1 hit (0%)
> Critical path: 9.9s (1 task)
> Recoverable time: <1ms

3. `node -e "const r=require('./apps/ptah-electron/scripts/rebuild-native.js'); const v=require('./apps/ptah-electron/scripts/verify-packed-native.js'); console.log(Object.keys(r), Object.keys(v));"`

> [
> 'getPrebuildTarget',
> 'getElectronRebuildEnv',
> 'resolveBetterSqliteRuntimeAddon',
> 'promoteRebuiltAddon',
> 'probeAddonWithElectron',
> 'main'
> ] [
> 'getPrebuildTarget',
> 'resolveBetterSqliteRuntimeAddon',
> 'findPackedFiles',
> 'probeAddonWithElectron',
> 'main'
> ]

Additional in-memory checks passed for strict and optional ABI handling (including null/undefined and mismatches), missing probe markers, unexpected SQLite results, rejection of a relative executable before launching it, absence of logging from the shared probe, and correct workspace-root resolution. The wrapper arities are 3 and 4. Direct calls through both wrappers also executed SQLite successfully:

> [verify] better-sqlite3 loaded under Electron 44.4.3 (ABI 149, N-API 10) and queried SQLite 3.53.4
> Strict verifier result: { modules: '149', napi: '10', value: 42, sqlite: '3.53.4' }

`git diff --check` exited 0 with no output. Final source review confirmed the existing failure strings and console output were preserved.

## Correction applied after this report

`prettier --check` rejected the new shared module, and `.lintstagedrc.mjs` runs
`nx format:write` on staged files. Formatting moved `// NOSONAR` onto its own
line, which would have detached it from the `execFileSync` call it suppresses.
The probe arguments and options were hoisted into `probeArgs` and
`probeOptions` so the call fits one line and the trailing `// NOSONAR` stays
anchored under Prettier. The `path.isAbsolute` guard moved up to sit directly
after the executable is resolved. All three files now pass `prettier --check`.

## Residual risk

SonarCloud and CodeRabbit were not rerun remotely. The final duplication percentage, SonarCloud issue status/security rating, and CodeRabbit docstring-coverage percentage remain unverified. All six shared functions are documented, and the identified duplicate implementations were removed.

The requested test command ran the whole Electron test suite despite its singular `--testPathPattern` argument. Existing skips remain; they are not counted as passes. The test output also reports ts-jest warnings about JavaScript files being transformed without `allowJs`, including the new CommonJS module. Lint's 12 warnings concern unchanged code; none is a lint error.

Ptah's scoped TypeScript diagnostics remained unavailable after its 45-second limit, including on retry. This is not a successful diagnostic check. The required Nx tests and lint did complete successfully.

No complete installer build or post-package verification against a newly built release tree was run. Live addon verification used the installed Windows Electron 44.4.3 runtime and SQLite 3.53.4; other operating systems were not exercised.
