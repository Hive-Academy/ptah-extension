# Host Verification Disposition — Batch 1

## Scope and disposition

This is a read-only diagnosis of the retained B01-V1/B01-V2 host verification blockers. It does not accept Batch 1, waive a gate, alter `batches.md`, run verification, build artifacts, install dependencies, or change source.

**Disposition:** the current host failures are not shown to be caused by the five additive Batch 1 shared vocabulary files. They remain **open, historical, and not baseline-proven**: no clean-base execution was performed, so neither a baseline pass nor a baseline failure can be claimed. Batch 1 host acceptance must remain open until the separately identified environment/infrastructure work is authorized and the prescribed scoped host gates are run.

The shared correction itself has fresh evidence: `@ptah-extension/shared` typecheck, lint, and 3,748 tests passed according to the retained checkpoint. That evidence does not make host tests pass, and the host results must not be treated as waived.

## Evidence ledger

| Finding | Evidence | Diagnosis |
| --- | --- | --- |
| The only production-source diff from `HEAD` is Batch 1 shared exports plus three untracked shared vocabulary/spec files. | Read-only `git diff --name-status HEAD` showed only `libs/shared/src/index.ts` and `libs/shared/src/schemas.ts` as tracked modifications; `git status --short` listed only the three provider-account files and the task folder as untracked. `batches.md:113-117` limits Batch 1 ownership to those five shared files. | `app.routes.ts`, Jest configuration, all host `project.json` files, host package metadata, and command-center scene test are unchanged from `HEAD` in this worktree. This disproves a direct source edit to the reported host-blocker files by Batch 1; it does not prove a clean baseline outcome. |
| Batch 1 does not activate a runtime consumer or system CLI tuple. | `implementation-report-batch-01.md:78-80`; `batches.md:118-121`. The new public exports are at `libs/shared/src/index.ts:32` and `libs/shared/src/schemas.ts:28`; repository search finds provider-account usages only in the new vocabulary/schema/spec files and those two barrels. | The added declarations/export surfaces have no discovered host runtime consumer. They cannot explain a host test failing before it loads unrelated app source, a missing local package file, or an absent `dist/` artifact. |
| The five historical test configurations all inherit the same root Jest mapper. | `apps/ptah-electron/jest.config.ts:1-16`, `apps/ptah-cli/jest.config.cjs:1-31`, `apps/ptah-tui/jest.config.cjs:1-15`, `apps/ptah-extension-vscode/jest.config.ts:1-21`, and `apps/ptah-extension-webview/jest.config.ts:1-31` each set `preset: '../../jest.preset.js'`. The preset maps `^marked$` to `node_modules/marked/lib/marked.umd.js` at `jest.preset.js:16-35`. | The common failure is configuration-to-installed-files mismatch, not a per-host source failure and not a Batch 1 export relationship. |
| Installed metadata records `marked` 18.0.13, while the test mapper requires a UMD file that the historical logs say is absent. | `package-lock.json:30944-30949` records `node_modules/marked` version 18.0.13. `jest.preset.js:16-23` documents the assumed `lib/marked.umd.js` fallback. Historical TUI diagnostic: `verification-batch-01-ptah-tui-test-direct.log:19-30`; webview diagnostic: `verification-batch-01-ptah-extension-webview-test.log:5-18`; CLI transitive failure: `verification-batch-01-ptah-cli-test-direct.log:760-774`; VS Code diagnostic begins at `verification-batch-01-ptah-extension-vscode-test-direct.log:234-239`. | The logs establish that Jest could not resolve the configured absolute UMD path in this checkout. They do **not** establish whether the lockfile, actual installed `node_modules`, package contents, or mapper expectation is the intended baseline; resolving that requires an authorized, separately scoped dependency/install investigation. |
| Four host test targets are designed to depend on build outputs, and their direct-Jest diagnostics found those outputs absent. | Electron test target depends on six build targets at `apps/ptah-electron/project.json:253-267`; CLI test depends on four build targets at `apps/ptah-cli/project.json:255-267`; TUI test depends on its build at `apps/ptah-tui/project.json:106-113`; VS Code test depends on `build-esbuild` at `apps/ptah-extension-vscode/project.json:197-204`. Direct-log artifacts missing: Electron `verification-batch-01-ptah-electron-test-direct.log:699-712`; CLI `...ptah-cli-test-direct.log:776-789`; TUI `...ptah-tui-test-direct.log:1-14`; VS Code `...ptah-extension-vscode-test-direct.log:219-232`. | Missing `dist/` output is expected on an unbuilt checkout, given the target definitions. Direct Jest deliberately reports it instead of silently passing. These diagnostics are not substitutes for the Nx test gates. |
| Electron has an additional incomplete-install symptom. | `verification-batch-01-ptah-electron-test-direct.log:699-712` reports `ENOENT` opening `node_modules/electron/path.txt`; B01-V2 also records a missing Electron `package.json` at `batches.md:123-124`. | This points to an incomplete/mismatched Electron package installation, not shared type/schema exports. Reinstalling or repairing packages is outside the current permission and must be separately authorized. |
| The webview lint failure is an existing source dependency cycle rooted in the app route’s lazy import and a command-center **spec** reading app configuration. | Lint output: `verification-batch-01-ptah-extension-webview-lint.log:7-12` names `app.routes.ts:224:7` and chain `app.routes.ts` → `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts`. The route lazy-imports command center at `apps/ptah-extension-webview/src/app/app.routes.ts:213-226`. The command-center spec imports the webview’s Tailwind config at `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts:1-10`. The command-center project is `scope:webview,type:feature` (`libs/frontend/command-center/project.json:1-8`); app scope/type constraints are enforced in `eslint.config.mjs:288-300,388-417`. | This is an actual lint-blocking circular dependency in unchanged code. It is not caused by a provider-account import. Because it crosses app/library test configuration and ownership, it needs separately scoped infrastructure/source correction rather than a Batch 1 workaround. |
| The webview target itself is not build-dependent for `test`, but it fails at suite loading before meaningful test execution due to the shared `marked` mapper. | `apps/ptah-extension-webview/project.json:122-128` has no `dependsOn` for `test`; its historical test fails resolving `marked` before the `ngx-markdown` import at `verification-batch-01-ptah-extension-webview-test.log:5-22`. | It is the smallest host test investigation surface once the installed/mapping issue is addressed. It cannot currently provide a valid host acceptance result. |

## Root-cause classification

### 1. Unchanged source

- `apps/ptah-extension-webview/src/app/app.routes.ts:213-226` and `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts:1-10` form the evidence-backed webview lint cycle reported at `app.routes.ts:224:7`.
- The read-only `HEAD` comparison establishes these files were not modified for Batch 1.
- The cycle is real in the retained lint output, but its existence on clean `HEAD` has not been executed or proven. It must therefore be called **historical, unchanged in this worktree, and not baseline-proven**, not a confirmed baseline failure.

### 2. Installed dependency mismatch or incomplete install

- All five retained host test diagnostics converge on the root Jest mapping `node_modules/marked/lib/marked.umd.js`; the configuration assumes it exists while the log says Jest cannot locate it.
- The `package-lock.json` confirms the resolved dependency version, but package metadata alone cannot prove the current on-disk package layout. No broad `node_modules` scan was performed, as required.
- Electron’s missing `node_modules/electron/path.txt` (and recorded missing package metadata) is a separate installation completeness issue. No Batch 1 file imports or configures Electron.

### 3. Expected missing build artifacts

- Electron, CLI, TUI, and VS Code intentionally make their Nx test targets depend on build targets. The direct-Jest artifact gates deliberately fail without generated outputs; their helpers explicitly say missing artifacts fail unless an opt-in skip environment variable is set (for example `apps/ptah-tui/src/build-artifact-gate.ts:27-56`).
- The requested scope forbids builds and forbids inventing or using skip flags. Thus these four gates cannot be completed in the present authorization boundary.
- The configured build chains are nontrivial: Electron’s `build` includes its webview build at `apps/ptah-electron/project.json:274-306`; VS Code post-build copy depends on the webview build at `apps/ptah-extension-vscode/project.json:93-109`; CLI’s full build includes TUI/worker dependencies at `apps/ptah-cli/project.json:218-231`; TUI’s build depends on CLI at `apps/ptah-tui/project.json:8-12`. Build authorization must name the intended target and scope, not be inferred from test failure text.

### 4. Causal relationship to the new exports

No direct causal relationship is evidenced:

1. the changed source inventory is restricted to shared types/schemas/barrels;
2. no runtime consumer is activated (`SYSTEM_CLI_TYPES` and runtime registration remain untouched, per `implementation-report-batch-01.md:78-80`);
3. every claimed host blocker names configuration, a `node_modules` path, `dist/`, Electron installation files, or the unrelated command-center/webview source cycle; and
4. all retained host evidence predates the latest shared correction (`implementation-report-batch-01.md:94-99`; `batches.md:120-124`).

This supports **non-attribution**, not a host-pass claim. The current record cannot distinguish a pre-existing failure from a checkout-local artifact/dependency state without authorized clean-base and environment verification.

## Smallest permitted verification path

No verification command was run for this disposition.

### Available without builds or dependency changes

1. **Batch 1 ownership proof only:** retain the fresh scoped shared checks already recorded in `batches.md:122`—`@ptah-extension/shared` typecheck, lint, and test—because its `project.json` declares those targets without build dependencies (`libs/shared/project.json:19-34`). If re-run later, it must remain serial: `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time.
2. **Host compile/static-gate observation:** each host’s `typecheck` and `lint` target is separately declared (for example Electron `apps/ptah-electron/project.json:237-252`, VS Code `apps/ptah-extension-vscode/project.json:194-210`, webview `apps/ptah-extension-webview/project.json:119-150`) and does not declare a build dependency in its local target definition. These can diagnose compile/static changes without launching builds, but prior historical success is not fresh acceptance evidence.
3. **No valid no-build replacement for four test gates:** Electron, CLI, TUI, and VS Code test targets require their declared build prerequisites. Their direct Jest invocations are diagnostic only and must not replace Nx target acceptance. Do not use `PTAH_ALLOW_SKIP_UNBUILT` or a new skip switch.
4. **Webview test is the one existing test target without declared build dependency**, but it is presently blocked at suite load by the `marked` mapper/install mismatch. It can be used only after that issue is resolved under separately authorized dependency/infrastructure work.

### Work requiring user-authorized build/install or separately scoped correction

| Required action | Why it needs separate scope or permission | Smallest next action |
| --- | --- | --- |
| Repair/verify the `marked` mapper versus the installed package | It concerns root Jest configuration and installed package state shared by all five hosts, not Batch 1’s owned files. Dependency installation/modification is prohibited here. | Authorize a read-only exact-package-layout check first; if mismatch is confirmed, open an infrastructure correction limited to the root Jest mapper/lockfile/install state and affected host checks. |
| Repair Electron package installation | `electron/path.txt`/package metadata absence is an installed-artifact issue, and repair can modify `node_modules`. | Authorize a scoped Electron install-health remediation; then run Electron’s scoped gate only after its prescribed build prerequisites are authorized. |
| Generate host distribution artifacts | The four targets explicitly require them, and the user forbade builds. | Authorize named targets one at a time, Electron first; then run the corresponding `npx nx test <host> --parallel=1 --maxWorkers=2 --coverage=false` with only one heavy check in flight. |
| Fix webview/command-center circular lint dependency | The cycle is unchanged, crosses an app’s route/import boundary and a library’s test configuration, and Batch 1 does not own either file. | Open a separately bounded infrastructure/source task to remove the app-from-library test dependency while preserving the contrast assertion; verify `ptah-extension-webview` and `@ptah-extension/command-center` scoped lint/typecheck/test as applicable. |
| Establish baseline | Existing logs are historical and no baseline execution is permitted in this diagnosis. | After environment remediation, run the exact scoped targets against clean `HEAD` or an equivalent clean worktree, recording the target commands and results; do not retroactively label today’s logs baseline. |

## Sequencing decision for Batch 2

`batches.md:97-104` declares Batch 2 dependent on Batch 1. Therefore Batch 2 must **not silently advance** merely because the shared project passed while host acceptance remains open.

An explicit **sequencing-only decision** by the team-leader/orchestrator could permit Batch 2’s additive, token-only implementation while keeping Batch 1 and all host acceptance gates open, because Batch 2 owns only the backend token port/exports (`batches.md:99-104`) and its stated acceptance prohibits runtime registration (`batches.md:86-89`). That exception should be limited to these conditions:

- record that Batch 1’s five owned shared files have passed fresh shared verification but Batch 1 itself remains `IN_PROGRESS`;
- retain every host gate, release/compatibility/rendered hold, and Batch 1 acceptance condition as unresolved—not skipped or passed;
- allow no Batch 2 runtime registration, host configuration edit, or interaction with the broken `marked`, artifact, Electron-install, or lint surfaces;
- run Batch 2 only through its existing token-project typecheck path, serially; and
- require Batch 1 host disposition/remediation before Phase P1-A acceptance or any host/release claim.

**Recommendation:** make that explicit sequencing decision only if preserving delivery momentum for a declaration-only backend seam outweighs strict batch seriality. It is technically defensible from the absence of runtime consumers, but the safer default is to hold Batch 2 until the team-leader records the exception because the present plan names Batch 1 as its dependency. This diagnosis does not make that decision or edit the ledger.

## Unresolved permission requirements

- User authorization is required before any build, package install/repair, launch, or altered dependency state.
- A separately scoped owner is required for the root Jest/`marked` infrastructure correction, the Electron install-health correction, and the webview/command-center circular-boundary correction.
- Future verification must remain limited to changed and affected projects: Nx `--parallel=1`, Jest `--maxWorkers=2`, one heavy check across lanes at a time. No workspace-wide target, bypass flag, release, compatibility, or rendered-review gate is authorized by this disposition.
