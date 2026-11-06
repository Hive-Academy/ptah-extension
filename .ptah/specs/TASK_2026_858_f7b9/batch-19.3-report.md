# Batch 19.3 report

## Files changed

- `apps/ptah-electron/project.json` — worker host esbuild target, implicit dependency, and production/development build wiring.
- `apps/ptah-electron/tsconfig.worker-host.json` — worker host entry and runtime source coverage.
- `apps/ptah-electron/worker-host/ptah-worker` — executable POSIX launcher with symlink resolution and RunAsNode execution.
- `apps/ptah-electron/worker-host/ptah-worker.service` — systemd user unit template.
- `apps/ptah-electron/electron-builder.yml` — Linux extra resource copy to `resources/bin/`.
- `apps/ptah-electron/scripts/validate-deps.js` — scans external imports from `worker-host.mjs` as well as `main.mjs`.
- `apps/ptah-electron/src/config/worker-host-packaging.spec.ts` — packaging contract checks.
- `.ptah/specs/TASK_2026_858_f7b9/batch-19.3-report.md` — this report.

## Decisions

| Decision                                                                                             | Options                                                    | Evidence                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Use the existing workspace watch host esbuild shape, with the mcp-bench `vscode` shim and ESM banner | New bundling mechanism; existing esbuild target            | `project.json` targets and `tools/mcp-bench/project.json:99-125`                                             |
| Externalize native or large runtime packages already declared by the desktop app                     | Bundle every dependency; externalize selected dependencies | Every selected external exists in `apps/ptah-electron/package.json`; static assertion passed                 |
| Copy the launcher and unit from the source directory to `resources/bin/`                             | Put executable inside asar; copy outside asar              | Existing builder `extraResources` paths are relative to the dist app directory; static path assertion passed |
| Preserve the requested `linux.extraResources` location                                               | Use an unverified deb-specific setting                     | Task 19.3 explicitly names `linux.extraResources`; see AppImage limitation below                             |

## Spec coverage

| Requirement                                                                              | Status    | Evidence                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build target and `worker-host.mjs` output                                                | Done      | `build-worker-host` target and packaging spec                                                                                                                  |
| Production/development build wiring and implicit dependency                              | Done      | `project.json` and packaging spec                                                                                                                              |
| Worker host tsconfig                                                                     | Done      | `tsconfig.worker-host.json`                                                                                                                                    |
| Symlink-aware POSIX launcher, RunAsNode, argument forwarding, exit 127 on missing bundle | Done      | Executable `ptah-worker`; `sh -n` passed                                                                                                                       |
| systemd user unit fields                                                                 | Done      | `ptah-worker.service` and packaging spec                                                                                                                       |
| Copy launcher and unit outside asar                                                      | Done      | `linux.extraResources` entry and packaging spec                                                                                                                |
| Scan worker host external imports                                                        | Done      | `validate-deps.js` and packaging spec                                                                                                                          |
| No RunAsNode-disabling fuse                                                              | Done      | Packaging spec checks parsed fuse keys and builder text                                                                                                        |
| No AppImage launcher                                                                     | **Unmet** | The requested `linux.extraResources` setting applies to both configured Linux targets, AppImage and deb; no package target was run to inspect actual artifacts |

## Not done / Clarifications needed

- AppImage remains in `linux.target`; `linux.extraResources` is shared by Linux targets. A deb-only resource rule would need a verified builder mechanism or a packaging flow change outside the requested static scope.
- The orchestrator will run `npm run verify -- -p @ptah-extension/worker-host,ptah-electron`. No Nx, Jest, verify, build, serve, package target, or socket operation was run here.
- No separate worktree or branch was created because the caller supplied this isolated worktree and restricted task edits to it. No commit or push was made.

## Static checks

- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.spec.json` — passed.
- `npx eslint apps/ptah-electron/src/config/worker-host-packaging.spec.ts apps/ptah-electron/scripts/validate-deps.js` — passed.
- `node --check apps/ptah-electron/scripts/validate-deps.js` — passed.
- `sh -n apps/ptah-electron/worker-host/ptah-worker` — passed.
- `git diff --check` — passed.
- Static Node assertion for external dependency subset and builder source path — passed.
- `ptah_get_diagnostics` timed out before serving a result; scoped `tsc` and ESLint passed instead.

## Orchestrator verification and corrections

- Defect fixed: the launcher tested `[ ! -f "$appdir/resources/app.asar/worker-host.mjs" ]`.
  `app.asar` is an archive file, so that shell test is always true and the launcher always
  exited 127. It now checks that `resources/app.asar` and `ptah-desktop` exist; Electron reads
  `worker-host.mjs` inside the archive. A spec assertion forbids a shell test of the inner path.
  Checked by hand in a fake `/opt/Ptah` tree through a `/usr/bin` symlink: argv and
  `ELECTRON_RUN_AS_NODE=1` reach `ptah-desktop`; a missing archive exits 127.
- Defect fixed: the spec used an undefined `builderText` (TS2304), so the suite did not run.
  The lane's `tsc -p apps/ptah-electron/tsconfig.spec.json` claim did not cover this file.
- Decision (orchestrator, reversible): keep `linux.extraResources`. The AppImage also carries
  `resources/bin/ptah-worker`, but the supported install path is the deb only (`/opt/Ptah`);
  `docs/worker.md` (Task 19.4) states this. A deb-only `deb.extraResources` split can follow if
  the review asks for it.
- `npm run verify -- -t test -p ptah-electron -- --testPathPatterns=worker-host-packaging`:
  2 tests pass. The full `ptah-electron` verify runs after Task 19.2 lands.

## Orchestrator corrections (verify round 2)

The first full `ptah-electron` verify failed. Fixes:

- `esm-bundle-gate.spec.ts`: `build-worker-host` added to `EXPECTED_ESM_TARGETS`,
  `OWN_PROJECT_BUILD_TARGETS` and `WORKER_ENTRY_GUARDS` (guard = the usage line). `project.json`:
  added to `test.dependsOn` and `serve:watch` commands (three-place rule).
- `worker-host/src/lib/dispatch.ts`: an empty command now fails with the usage line before any
  engine import, so a bare run of the bundle exits 1 at once (gate self-test).
- `tsconfig.worker-host.json` now extends `tsconfig.app.json`. `tsconfig.build.json` has its own
  `paths` list without `cli-engine` and the `worker-*` libs, so esbuild could not resolve them.
- `build-worker-host` gets `production` (minify, default) and `development` configurations like
  `build-main`. The unminified bundle kept comments such as `"removed" from "refused"`, which the
  `validate-deps` import scanner read as packages. Production bundle: 5.5 MB.
- `validate-deps` now depends on `build-worker-host`; otherwise CI runs it with no bundle. The
  worker-host scan skips `OPTIONAL_WORKER_HOST_IMPORTS = {keytar}` (platform-cli
  `tryLoadKeytar()` falls back to an HKDF key). The packaging spec pins that set.
- Results: `node apps/ptah-electron/scripts/validate-deps.js` exit 0; bare
  `node --input-type=module < worker-host.mjs` prints the usage line, exit 1; `npm run verify -- -p
@ptah-extension/worker-host,@ptah-extension/worker-runtime,ptah-electron` passes (102, 24 and
  1623 tests).
