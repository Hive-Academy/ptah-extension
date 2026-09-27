# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 10/10 |
| Assessment | APPROVED |
| Requested verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Monorepo Batch 37b1d (`9b2586e5b`) implements host profiles and DI wiring for the opt-in `go vet` diagnostics checker across Electron (`ptah-electron`) and the CLI/TUI engine (`@ptah-extension/cli-engine`), fulfilling O2 §2 ("DI timing"), O2 §3, and O2 §7.3 ("Host wiring") of `TASK_2026_559_8ca9`.

Score justification: Placed in the 10/10 exemplary band. The wiring is strictly lazy, fail-closed, and isolated:
- **Lazy Spawner Resolution:** In both hosts (`apps/ptah-electron/src/di/phase-2-libraries.ts:183-186` and `libs/backend/cli-engine/src/lib/container.ts:630-633`), the process spawner is passed as a lazy getter closure (`() => container.resolve<IProcessSpawner>(SDK_TOKENS.SDK_PROCESS_SPAWNER)`). This solves the circular initialization constraint: `SDK_PROCESS_SPAWNER` is registered during Phase 4 (`registerSdkServices`), while diagnostics providers are configured during Phase 2. The getter is never invoked at startup.
- **Fail-Closed Startup Guarantee:** Host startup initiates no child processes, stats no binaries, and executes no toolchains. Go vet execution occurs strictly when Go diagnostics are requested AND consent has been affirmatively granted (`state: 'on'`) for the specific workspace. Default state for newly opened workspaces is verified to be `'off'`.
- **Host Isolation:** `goVetDiagnostics` capability is enabled strictly in Electron (`rpc-host-profile.ts:44`) and CLI/TUI (`cli-host-profile.ts:38`). VS Code remains disabled (`goVetDiagnostics: false` in `ALL_DISABLED`), with consent methods explicitly verified absent in `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:59-60`.
- **Wiring Specs & Fault-Based Evidence:** Both host override specs (`phase-2-diagnostics-override.spec.ts` and `container-diagnostics-override.spec.ts`) were rewritten to test real host-shaped containers, verifying Phase 0 stub fallback, lazy spawner detachment at registration, capability/surface activation, and real `RpcHandler` GET dispatch yielding `supported: true` and `state: 'off'`.

---

## Verification evidence

- **Full Nx checks (test, lint, typecheck across changed projects):**
  - Executed: `node_modules\.bin\nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/cli-engine ptah-cli --skip-nx-cache`.
  - All 48 project tasks and dependent builds passed with exit code 0 in 3m 17s:
    - `ptah-electron`: `test`, `lint`, `typecheck` passed.
    - `@ptah-extension/cli-engine`: `test`, `lint`, `typecheck` passed.
    - `ptah-cli`: `test`, `lint`, `typecheck` passed.
- **Focused test execution:**
  - Ran Electron diagnostics override spec: `nx test ptah-electron --testFile=phase-2-diagnostics-override.spec.ts`. All 5 tests passed (6.7s).
  - Ran CLI container diagnostics override spec: `nx test @ptah-extension/cli-engine --testFile=container-diagnostics-override.spec.ts`. All 6 tests passed (6.8s).
- **Inspection of commit `9b2586e5b`:**
  - `apps/ptah-electron/src/rpc-host-profile.ts:44`: `goVetDiagnostics: true` enabled.
  - `apps/ptah-electron/src/di/phase-2-libraries.ts:183-186`: Passed lazy `getProcessSpawner` getter to `registerTypeScriptDiagnosticsProvider`.
  - `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`: 5 tests covering Phase 0 stub, call-site source pinning, lazy spawner detachment, capability surface, and real RPC GET dispatch.
  - `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:38`: `goVetDiagnostics: true` enabled for both CLI and TUI profiles.
  - `libs/backend/cli-engine/src/lib/container.ts:630-633`: Passed lazy `getProcessSpawner` getter to `registerTypeScriptDiagnosticsProvider`.
  - `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts`: 6 tests covering Phase 0 stub, call-site source pinning, lazy spawner detachment, CLI/TUI capabilities, and real RPC GET dispatch.

---

## Specific Questions Judged

### 1. Spec Temp Directory Cleanup Deviation
- **Files & Lines:**
  - `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:98-108`
  - `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:115-125`
- **Where they write:** Both specs create directories inside `os.tmpdir()` (`fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-govet-'))` and `fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-govet-'))`).
- **Parallel collisions:** Impossible. `mkdtempSync` generates 6 cryptographically random alphanumeric characters on each invocation, ensuring process- and thread-isolated paths.
- **Disk footprint:** Negligible (< 10 KB per run containing folder skeletons and minimal state files).
- **Why cleanup was omitted:** In Phase 0 bootstrap, `registerPhase0Platform` (in Electron) and `registerPlatformCliServices` (in CLI) instantiate an output channel / file logger that maintains an active file handle on `path.join(userData, 'logs')`. Calling `fs.rmSync(tmp, { recursive: true, force: true })` in `afterEach` while the stream remains open causes Windows file-locking errors (`EPERM` / `EBUSY`), and subsequent unhandled `ENOENT` stream errors crash the Jest runner. Sibling DI specs in both libraries adopt the exact same pattern.
- **Judgement:** **ACCEPTABLE.** Because writes are confined to the operating system's designated temporary directory with unique prefixes and zero risk of cross-test collision, omitting cleanup is the standard, pragmatic pattern in this monorepo to avoid asynchronous Jest crashes. (Noted as Minor Observation 1).

### 2. Spawner Getter and Host Startup Process Isolation
- **Files & Lines:**
  - `apps/ptah-electron/src/di/phase-2-libraries.ts:183-186`
  - `libs/backend/cli-engine/src/lib/container.ts:630-633`
  - Tested: `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:130-147`
  - Tested: `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:147-164`
- **Evaluation:** Does wiring the spawner getter start any process or load the Go binary at host startup?
  - **No.** The closure `() => container.resolve<IProcessSpawner>(SDK_TOKENS.SDK_PROCESS_SPAWNER)` is stored on the `LanguageAwareDiagnosticsProvider` instance without being called at registration time.
  - In both override specs, a mock spawner getter that throws `Error('the spawner is read at the first run, not here')` is provided to `registerTypeScriptDiagnosticsProvider`; both specs assert `expect(getProcessSpawner).not.toHaveBeenCalled()`.
  - Furthermore, `resolveGoBinary` is only called when diagnostics are run on Go files, and the process spawner is only called when consent is affirmatively `'on'`. On fresh workspaces, consent is `'off'` (`it('answers GET with supported:true and consent off for the open workspace')`).
  - Therefore, host startup is 100% fail-closed and initiates zero external processes.

### 3. Capability Isolation & VS Code Containment
- **Files & Lines:**
  - `apps/ptah-electron/src/rpc-host-profile.ts:44`
  - `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:38`
  - `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:83`
  - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:59-60`
- **Evaluation:** Is the capability exposed only on Electron/CLI/TUI, and could VS Code accidentally receive it?
  - **Exposed strictly on Electron and CLI/TUI.** Electron's `createElectronRpcHostProfile` and CLI's `createCliRpcHostProfile` are isolated factory functions that construct distinct profile objects.
  - VS Code constructs its profile independently and relies on `createBaseRpcHostProfile()`, where `ALL_DISABLED.goVetDiagnostics` is explicitly `false`.
  - There is no shared mutable profile singleton.
  - In `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:59-60`, both `'diagnostics:go-vet-consent-get'` and `'diagnostics:go-vet-consent-set'` are asserted to be strictly absent from VS Code's served RPC surface.
  - Therefore, VS Code cannot accidentally receive or register this capability.

### 4. Robustness of Source-Reading Specs
- **Files & Lines:**
  - `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:117-128`
  - `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:134-145`
- **Evaluation:** Are source-reading specs ("read the call site from source") robust or brittle to formatting?
  - **Context:** Neither host's complete bootstrap file (`phase-2-libraries.ts` or `container.ts`) can be directly loaded in Jest without triggering module-evaluation failures from heavy downstream native dependencies (`better-sqlite3`, `persistence-sqlite`, `messaging-gateway`). Reading the file directly is an established repository precedent (e.g. `main.metadata-flush.spec.ts`, `permission-policy.spec.ts`).
  - **Brittleness Assessment:** The regex checks `match(/registerTypeScriptDiagnosticsProvider\(/g)` for count 1 and uses flexible whitespace `\s*` matching the closure. While regex assertions on source code are theoretically susceptible to major formatting changes (e.g., introducing a block body `() => { return ... }` or renaming variables), this monorepo enforces standardized Prettier formatting in CI.
  - **Mitigation:** The source-reading test does not stand alone; it is accompanied by behavioral integration tests on real host-shaped containers (`buildHostContainer`) validating that `LanguageAwareDiagnosticsProvider` is resolved and correctly configured. (Noted as Minor Observation 2).

---

## Part 1 — Verification of Previous Review Findings

Batch 37b1c had 0 findings, so there are no open issues or regressions from prior reviews to verify.

---

## Part 2 — Review of Batch 37b1d (commit 9b2586e5b)

### Five logic questions

#### 1. How does this fail silently?
Nowhere.
- If `SDK_TOKENS.SDK_PROCESS_SPAWNER` were not registered by the time a granted Go diagnostics check runs, the getter throws during `container.resolve()`, which is caught by the checker's execution guard and surfaces as a structured checker failure.
- If the host profile does not enable `goVetDiagnostics`, the RPC router returns method not found, and diagnostics runs in syntax-only mode with truthful coverage disclosures.

#### 2. What user action produces unexpected behaviour?
None identified:
- On first launch of Electron, CLI, or TUI, the workspace has consent `'off'`. No background processes are spawned.
- When a user opens a workspace that has no Go files, diagnostics runs TypeScript checks normally without querying Go toolchains.

#### 3. What input data produces a wrong answer?
None found:
- If a workspace has corrupt settings or state, the fallback in `buildHostContainer` and `CliStateStorage` defaults safely to empty state (`state: 'off'`), requiring explicit user consent before any execution.

#### 4. What happens when a dependency fails?
- **DI spawner resolution failure:** Handled lazily. If `SDK_PROCESS_SPAWNER` fails to resolve when called, it fails closed inside `runGoVet`.
- **State storage inaccessible:** If the per-workspace store fails to initialize, `diagnostics:go-vet-consent-get` returns `supported: false` or `state: 'off'`.

#### 5. What is missing that the requirements never mentioned?
All requirements and DI constraints are addressed:
- Electron and CLI hosts have different container architectures (`WorkspaceContextManager` resolution vs direct instantiation). The wiring accommodates both architectures cleanly.
- TUI host profile explicitly inherits the capability alongside stdio CLI (`createCliRpcHostProfile('tui')`).

---

## Failure modes

No unhandled failure modes identified.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Moderate and minor issues

### 1. Minor / Observation — Spec Temp Directory Cleanup Omission
- **Files:** `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:98-108`, `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:115-125`
- **Context:** Both test suites create temporary directories in `os.tmpdir()` and intentionally omit `afterEach` directory deletion to prevent Windows file-locking crashes caused by open output channel log streams.
- **Disposition:** Carry as an acceptable repository pattern for integration specs touching Phase 0 logging.

### 2. Minor / Observation — Source-Reading Regex Maintenance
- **Files:** `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:123-127`, `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts:140-144`
- **Context:** Asserting call-site presence via regex is sensitive to syntax refactoring (such as expanding the single-line arrow function into a multi-line block).
- **Disposition:** Carry as a maintenance note if these DI registration files are refactored in future tasks.

---

## Data flow

1. **Host Container Bootstrap:**
   - Host runs Phase 0 and Phase 1 registrations.
   - Host reaches Phase 2: calls `registerTypeScriptDiagnosticsProvider(container, logger, { getProcessSpawner: () => container.resolve<IProcessSpawner>(SDK_TOKENS.SDK_PROCESS_SPAWNER) })`.
   - `LanguageAwareDiagnosticsProvider` is bound to `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` with the lazy spawner getter attached.
   - Host reaches Phase 4: `registerSdkServices` binds `SDK_TOKENS.SDK_PROCESS_SPAWNER`.
2. **RPC Host Profile & Surface Construction:**
   - Host profile factory (`createElectronRpcHostProfile` or `createCliRpcHostProfile`) sets `capabilities.goVetDiagnostics = true`.
   - `deriveRpcSurface` and `resolveRpcHandlerPlan` detect `goVetDiagnostics` requirement on `diagnosticsConsent` manifest entry and bind `DiagnosticsConsentRpcHandlers`.
3. **Execution at Runtime:**
   - Initial `diagnostics:go-vet-consent-get` queries consent store: answers `state: 'off'`.
   - No external process is spawned.

---

## Requirements fulfilment

| Requirement | Status | Verification & Evidence |
| --- | --- | --- |
| Lazy spawner getter in Electron Phase 2 | COMPLETE | Verified in `phase-2-libraries.ts:183-186` and `phase-2-diagnostics-override.spec.ts`. |
| Lazy spawner getter in CLI Phase 2 | COMPLETE | Verified in `container.ts:630-633` and `container-diagnostics-override.spec.ts`. |
| Enable `goVetDiagnostics` in Electron profile | COMPLETE | Verified in `rpc-host-profile.ts:44` and surface plan tests. |
| Enable `goVetDiagnostics` in CLI/TUI profile | COMPLETE | Verified in `cli-host-profile.ts:38` for both `'cli'` and `'tui'`. |
| VS Code remains disabled | COMPLETE | Verified in `ALL_DISABLED` and `rpc-surface.spec.ts:59-60`. |
| Consent off by default | COMPLETE | Verified in both host specs returning `state: 'off'`. |
| No eager spawner read or process execution | COMPLETE | Verified via throwing spawner mock during registration in both specs. |

---

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| SdkServices registered after Phase 2 | YES | Getter is evaluated lazily inside `check()`, not during registration | None. |
| Host opened without Go files | YES | Provider skips Go vet check; getter is never called | None. |
| Fresh workspace opened | YES | Default consent is `'off'`; getter is never called | None. |
| Host is VS Code extension | YES | Capability is `false`; methods absent; getter never wired | None. |
| TUI mode active | YES | `createCliRpcHostProfile('tui')` enables `goVetDiagnostics: true` | None. |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None for this batch. The wiring is clean, lazy, properly tested, and completely decoupled from host startup.
