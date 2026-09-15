# Batch 1 — `@parcel/watcher` packaging spike (report)

Executor: devops-engineer, throwaway worktree `D:\projects\ptah-437-spike` (nothing committed).

## Verdict

- **Electron (A2): GO.** `@parcel/watcher` 2.5.6 loads and subscribes inside a real asar'd,
  electron-builder-packaged app (`npmRebuild: false`, prebuilt `@parcel/watcher-win32-x64`),
  run under `ELECTRON_RUN_AS_NODE=1`.
- **CLI (A3): GO.** Resolves and subscribes from both `main.mjs` and `tui.mjs` after `npm pack`
  and a clean-dir `npm install --omit=dev` of the tarball. One resolution path serves both (D7).

## Config changes required (feed into Batch 10)

1. `apps/ptah-electron/electron-builder.yml` `asarUnpack` — the plan (implementation-plan.md:494-496)
   lists only `@parcel/watcher/**` and `@parcel/watcher-*/**`. **Insufficient: runtime crash.**
   `@parcel/watcher/wrapper.js` requires `picomatch` and `is-glob`; from the unpacked location Node
   cannot resolve siblings still packed in `app.asar` (`MODULE_NOT_FOUND: picomatch` reproduced).
   Also unpack:
   ```yaml
   - 'node_modules/picomatch/**'
   - 'node_modules/is-glob/**'
   - 'node_modules/is-extglob/**'
   - 'node_modules/detect-libc/**'
   ```
2. Root `package.json` and `apps/ptah-electron/package.json`: add `"@parcel/watcher": "2.5.6"` as a
   direct dependency (today only transitive via `sass`).
3. `apps/ptah-electron/project.json` `build-main.options.external`: add `"@parcel/watcher"`.
4. `apps/ptah-cli/package.json` `dependencies`: add `"@parcel/watcher": "2.5.6"`.
5. `apps/ptah-cli/project.json` `build-esbuild.options.external`: add `"@parcel/watcher"`.

## Corrections and new findings

- **D3 mechanism not reproduced.** Once declared in `apps/ptah-electron/package.json`,
  `generatePackageJson` keeps `@parcel/watcher` with or without a source import;
  `prune-dist-deps.js` and `validate-deps.js` passed both ways. Keep the batch ordering rule
  (Batch 10 after adapter code) as a precaution, but the stated cause does not hold in isolation.
- **New — CLI manifest clobber (extends D7).** `ptah-tui:build` writes into `dist/apps/ptah-cli`
  and regenerates `package.json`, overwriting the CLI manifest (name, `bin`, `files`, new deps).
  `restore-cli-manifest` fixes it. **Task 10.4 must build `ptah-tui`, then run
  `npx nx restore-cli-manifest ptah-cli`, before packing or smoke-installing.**

## Evidence (abridged)

- `nx build-main ptah-electron`: dist `package.json` contains `@parcel/watcher`;
  `prune-dist-deps.js` kept it (41 packages left); `validate-deps.js` all externals covered.
- electron-builder 26.8.1 / Electron 40.10.1 `--dir --win` sandbox:
  `resources/app.asar.unpacked/node_modules/@parcel/watcher-win32-x64/watcher.node` present;
  packaged exe printed `subscribed OK` and a `create` event.
- `nx build ptah-cli` + `nx build ptah-tui` + `nx restore-cli-manifest ptah-cli` → `npm pack`
  `hive-academy-ptah-cli-0.2.6.tgz` → clean install → ESM import subscribed, `create` and
  `update` events received.

## Not done

- 75k-file mass-delete measurement: not performed. Fold into Task 15.1
  (`workspace-watch-host.stress.spec.ts`, `PTAH_PERF_SPECS=1`).

## Platform risk (D10)

Only the win32-x64 prebuild was verified. Before P2 is done, add to the release CI package matrix:
electron-builder for mac/linux (or `npm install` with `npm_config_platform` / `npm_config_arch`)
plus a `require('@parcel/watcher')` smoke per runner, like `verify-packed-native.js` does for
`better-sqlite3`.
