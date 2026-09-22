## Files changed

- CREATED `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.ts` — root-provided signal state, scoped snapshots, commits/read-back, and draft verification.
- CREATED `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.spec.ts` — 35 behavioral cases, including parameterized connection-status cases.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\core\src\index.ts` — exports the service and its public types.
- MODIFIED `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — two read DTO fields and the separate write DTO. No RPC method registration or boolean-table changes.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts` — the existing update caller accepts the write DTO.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts` — the form-to-wire mapper returns a partial write DTO, matching the controls the form actually owns.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts` — read fixture includes the new fields; the real form round-trip test verifies that Providers-only fields are left untouched.
- REWROTE `D:\projects\ptah-extension\.ptah\specs\TASK_2026_523_c3df\batch-d1-state-service-report.md` — this handoff replaces the earlier blocker report.

The service is not mounted. No file under `libs/frontend/chat` was touched. No git command was run.

Stack evidence: Angular 22.1.7 (`package.json:93`), private writable/public readonly signal patterns in `EffortStateService` and `PtahCliStateService`, and typed `ClaudeRpcService.call` at `claude-rpc.service.ts:129`. Workspace generation comes from the existing `WorkspaceScopeService`. Imports are Angular, shared DTOs through the package barrel, and local core services; no backend dependency, RxJS, storage, or polling was introduced. The Angular frontend patterns skill was applied.

## Public surface

All types below are exported by the core barrel:
`ProvidersSettingsStateService`, `ProvidersSettingsSection<T>`, `ProvidersEffectiveRoute`, `ProvidersJudgingSettings`, `ProvidersJudgingPatch`, `ProvidersEditContext`, `ProvidersSettingsCommit`, and `ProvidersSettingsPatch`.

The shared write type is available through the existing shared barrel's export of `rpc.types.ts`.

Every section signal has this exact envelope:

```ts
interface ProvidersSettingsSection<T> {
  readonly status: 'unloaded' | 'loading' | 'ready' | 'error';
  readonly data: T | null;
  readonly error: 'Could not load this section. Retry.' | null;
}
```

Public readonly section signals:

| Signal | Data |
| --- | --- |
| `route` | `ProvidersEffectiveRoute`: `AuthGetEffectiveRouteResult` without `storedAuthMethodDiagnostic`; the resolver blocker that echoes that raw value is replaced with safe route-selection copy |
| `scopes` | `ConfigGetScopesResult` |
| `model` | `RpcMethodResult<'config:model-get'>` |
| `effort` | `RpcMethodResult<'config:effort-get'>` |
| `memory` | `RpcMethodResult<'memory:getTriggers'>['triggers']` |
| `lanes` | `RpcMethodResult<'skillSynthesis:getLanes'>['lanes']` |
| `judging` | `Pick<SkillSynthesisSettingsDto, 'judgeProvider' \| 'judgeModel' \| 'enhanceTimeoutMs'>`; model `'inherit'` is adapted to picker `''` |
| `cliAgents` | `RpcMethodResult<'ptahCli:list'>['agents']` |
| `orchestration` | Only the model/effort fields listed below, selected from `agent:getConfig`; detected CLI diagnostics are not exposed |
| `tiers` | `RpcMethodResult<'provider:getModelTiers'>` for the last explicitly requested provider/usage scope |
| `verification` | `AuthVerifyDraftConnectionResult`; its classified reason and handler-sanitized detail are preserved |

The orchestration fields are `codexModel`, `copilotModel`, `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel`, `codexReasoningEffort`, `copilotReasoningEffort`, and `piReasoningEffort`.

Other readonly signals:

- `activeProviderId: Signal<string | null>` — one identity, never a per-card collection of active flags. Requires a ready route, positive successful-probe timestamp, no equally recent/newer failed probe, and connected/reachable evidence for its driver. It is null during refresh/error/save, for unresolved routes, or for unknown/skipped evidence.
- `commit: Signal<ProvidersSettingsCommit>` — `status` is `idle | saving | saved | partial | failed | unconfirmed | blocked`; `saved`, `unsaved`, and `unconfirmed` are field-name arrays; `refreshFailed` is boolean; `message` is fixed safe text or null.

Lifecycle and independent retry methods, all returning `Promise<void>`:

- `open()` — call on every page entry; construction performs no I/O.
- `refresh()` — refresh all page sections independently, plus tiers when a tier request exists.
- `checkConnection()`, `refreshRoute()` — call `auth:getEffectiveRoute({ refresh: true })`.
- `refreshScopes(keys?: readonly string[])` — initially reads all concrete/static `SCOPED_SETTING_KEYS`, excluding pattern entries. Explicit keys replace the tracked request list; include the auth keys when subsequent auth editing is needed. Supply concrete provider/auth-key paths for dynamic fields, never literal `<...>` families.
- `refreshModel()`, `refreshEffort()`, `refreshMemory()`, `refreshLanes()`, `refreshJudging()`, `refreshCliAgents()`, `refreshOrchestration()`.
- `refreshTiers(params: RpcMethodParams<'provider:getModelTiers'>)` — maintains provider and tier usage-scope identity; retries retain saved mappings, while switching identity clears the previous provider's data.

Scope and edit-review methods:

- `scopeEntry(key: string): ScopedSettingEntry | null`.
- `groupScope(keys: readonly string[]): SettingScope | 'mixed' | null`. Render `mixed` as **Mixed sources**, with individual strips. Missing entries return null.
- `writeScopes(key: string): readonly SettingScope[]` — returns currently available host-supported targets; no targets while scope loading/error, and no Workspace target without an active path. The raw entry still carries all `supportedTargets` so the editor can display supported-but-disabled choices.
- `reviewContext(): ProvidersEditContext | null` — returns `{ scopeKey, activePath }` only after scope metadata is ready. Capture when reviewing the draft; retain this context until commit.

Commit methods, all returning `Promise<void>`; components render the signals, not a returned payload:

- `saveSettings(patch: ProvidersSettingsPatch, context: ProvidersEditContext)`.
- `clearWorkspaceOverride(context: ProvidersEditContext)` — one auth bundle clear.
- `clearScopeOverride(key: string, target: 'nearest' | 'all-above-global', context: ProvidersEditContext)` — one host clear, followed by scope read-back. Global success requires the fresh entry to agree with the host clear result and actually resolve from Global.

`ProvidersSettingsPatch` accepts these optional domains:

- `auth: AuthSaveSettingsParams`.
- `model: RpcMethodParams<'config:model-switch'>`.
- `effort: RpcMethodParams<'config:effort-set'>`.
- `memory: { curatorProvider?: string; curatorModel?: string }`.
- `lanes: Partial<Record<SkillLaneIdDto, { provider?: string; model?: string }>>`.
- `judging: Partial<Pick<SkillSynthesisSettingsWriteDto, 'judgeProvider' | 'judgeModel' | 'enhanceTimeoutMs'>>`.
- `orchestration`: partial `agent:setConfig` fields from the nine-field list above.
- `tiers: readonly RpcMethodParams<'provider:setModelTier'>[]`.
- `cli`: readonly discriminated commands `{ action: 'create' | 'update' | 'delete', params }`, each paired with its corresponding `ptahCli:*` RPC parameter type.

Background and tier configuration writes have no invented workspace target. Tier `scope` remains the existing main-agent/CLI/lane usage dimension. Main model and effort use their actual existing config RPCs rather than adding unsupported fields to `AuthSaveSettingsParams`.

Draft methods:

- `verifyDraft(params: AuthVerifyDraftConnectionParams): Promise<void>`.
- `cancelVerification(): Promise<void>`.

Verification uses the non-mutating draft RPC and a real host cancellation request. New generations supersede old checks, mismatched probe IDs are rejected, and cancelled checks cannot publish later success. Cancellation clears verification state; a failed cancellation request exposes a safe section error. The caller still owns and clears its credential input on closing the wizard.

## Failure behaviour

Each read owns its own status, data, error, request generation, and workspace generation. A rejected read cannot reject the page refresh or erase another section. Null distinguishes unloaded data from a successful empty collection. Same-section retries preserve the last saved configuration; active badges are withheld until a successful fresh route snapshot.

Workspace changes immediately hide snapshots from the preceding generation. Stale asynchronous responses are discarded. Commits refresh scope metadata before writing, reject stale edit contexts/unsupported auth targets, stop subsequent writes after a workspace change, and do not publish a context-ambiguous acknowledgement as a confirmed save.

Every plain background setting is written and checked by field through its owning RPC. Read-back detects a write that persisted before its response failed, and detects a rejected field that retained its old value. A mixed outcome exposes the precise field names in `saved` and `unsaved`, followed by a refresh.

Auth and CLI handlers can perform several writes but return only a success boolean. On rejection, the service cannot prove which credential/subfields reached storage: those field names are explicitly `unconfirmed`, rather than falsely claiming rollback. CLI updates name each affected field. Failed read-back is also unconfirmed. A failed unrelated section refresh is recorded separately as `refreshFailed`.

All commit paths re-read the effective route and section values before releasing save state. This covers auth save, auth bundle clear, and auth-key scope clear. Explicit check and page entry also refresh the route. No polling timer exists. Concurrent commits do not start a second writer.

No request credential or raw RPC error is stored in signals. The raw stored-auth diagnostic is omitted from the renderable route altogether, including the known blocker-string echo. Probe detail is consumed only through the shared handler-sanitized result contract.

The host currently returns null successful/failed probe timestamps (`auth-rpc.handlers.ts:541-545`). Consequently this service deliberately does not manufacture a healthy Active badge from key presence or CLI installation. Draft verification does not itself activate a saved route.

## Verification

Every Nx command used:

```powershell
$env:NX_DAEMON='false'
$env:NX_CACHE_DIRECTORY='D:\projects\ptah-extension\.nx\verify-cache'
```

The required four projects and the repaired caller project were checked:

```powershell
npx nx run-many -t typecheck,lint -p @ptah-extension/core @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis @ptah-extension/skill-synthesis-ui --parallel=2 --output-style=static
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis @ptah-extension/skill-synthesis-ui --parallel=2 --runInBand --output-style=static
```

Observed typecheck/lint output, exit 0:

```text
 NX   Running targets typecheck, lint for 5 projects:

- @ptah-extension/core
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/skill-synthesis
- @ptah-extension/skill-synthesis-ui

 NX   Successfully ran targets typecheck, lint for 5 projects

Nx read the output from the cache instead of running the command for 3 out of 10 tasks.
```

Observed full test output excerpts, exit 0:

```text
 NX   Running target test for 5 projects:

- @ptah-extension/core
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/skill-synthesis
- @ptah-extension/skill-synthesis-ui

@ptah-extension/shared
Test Suites: 60 passed, 60 total
Tests:       1579 passed, 1579 total

@ptah-extension/rpc-handlers
Test Suites: 103 passed, 103 total
Tests:       4 skipped, 3136 passed, 3140 total

@ptah-extension/skill-synthesis
Test Suites: 1 skipped, 81 passed, 81 of 82 total
Tests:       1 skipped, 1587 passed, 1588 total

@ptah-extension/core
Test Suites: 31 passed, 31 total
Tests:       763 passed, 763 total

@ptah-extension/skill-synthesis-ui
Test Suites: 27 passed, 27 total
Tests:       433 passed, 433 total

 NX   Successfully ran target test for 5 projects

Nx read the output from the cache instead of running the command for 3 out of 5 tasks.
```

The project labels in that excerpt identify the corresponding output blocks. Shared, rpc-handlers, and skill-synthesis results were replayed from this turn's earlier successful uncached runs; core and skill-synthesis-ui executed again.

After the final CLI field-feedback refinement, core was checked again:

```powershell
npx nx run-many -t typecheck,lint -p @ptah-extension/core --parallel=2 --output-style=static
npx nx run @ptah-extension/core:test --runInBand --output-style=static
```

Final core output, both commands exit 0:

```text
 NX   Successfully ran targets typecheck, lint for project @ptah-extension/core

  Cache:             0/2 hit (0%)

Test Suites: 31 passed, 31 total
Tests:       764 passed, 764 total
Snapshots:   0 total
Time:        15.293 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/core

  Cache:             0/1 hit (0%)
```

Final suite counts: core 764 passed; shared 1579 passed; rpc-handlers 3136 passed/4 skipped; skill-synthesis 1587 passed/1 skipped; skill-synthesis-ui 433 passed. The new service contributes 35 cases.

Lint passes with warnings. The new service has one soft size warning (`772` counted lines versus the `700` warning threshold); core reports `13 problems (0 errors, 13 warnings)`. This is one page's state/commit owner kept within its assigned file; no suppression or artificial helper-file split was added. Other lint warnings are in existing code.

Scoped Ptah diagnostics initially reported 100 pre-existing errors in core specs/testing helpers. It caught one new mock-Map inference error while developing the spec; that was fixed. The subsequent diagnostics returned to 100 existing errors with no new service/spec diagnostic. These broader spec diagnostics are distinct from the declared production `ngc` target, which passes.

One early focused Nx invocation failed before running tests because plugin workers failed to connect. The serialized retry passed. The first full caller suite exposed the obsolete expectation that its form round-tripped Providers-only read fields; the corrected real-form test passed in subsequent full runs. Final required targets are passing, not waived.

No rendered-page check applies: this batch intentionally contains an unmounted state service.

## Deviations

- The caller-authorized repair of the shared DTO and its existing Skills caller is included; no handler implementation, method-map entry, or boolean-table entry was changed.
- The plan's target-key table names `auth:saveSettings` for model/effort, but the actual shared auth params do not accept them. The service uses existing `config:model-switch` and `config:effort-set`, which already support scoped writes.
- Tier write targets follow the actual shared allowlist: Global only. Tier usage scope is passed unchanged to the existing provider RPC family.
- Added explicit `unconfirmed` feedback because a rejected multi-write auth/CLI RPC does not prove that nothing was saved. No fabricated per-secret read-back or rollback claim is made.
- No visual design deviation: no component, token, or rendered layout was created.

## Not done

- Mounting, Providers page/components, and removal of the old editors remain later batches. No consumer imports this service yet.
- This batch does not add host inference-evidence bookkeeping; the route handler's null timestamps remain an honest limitation.
- Existing unrelated diagnostic/lint warnings and skipped tests were not changed.
- No git staging, commits, pushes, or history operations.

## Contract repair

The shared read shape now matches the existing host result:

```ts
interface SkillSynthesisSettingsDto {
  // Existing fields retain their types.
  judgeProvider: string;
  enhanceTimeoutMs: {
    value: number;
    default: number;
    min: number;
    max: number;
  };
}
```

The write shape is explicitly distinct:

```ts
export type SkillSynthesisSettingsWriteDto = Omit<
  SkillSynthesisSettingsDto,
  'enhanceTimeoutMs'
> & { enhanceTimeoutMs: number };

export interface SkillSynthesisUpdateSettingsParams {
  settings: Partial<SkillSynthesisSettingsWriteDto>;
}
```

Source locations: read additions at `libs/shared/src/lib/types/rpc.types.ts:2715`; write DTO at line 2754; update params at line 2760. The existing shared barrel already exports these through `export * from './lib/types/rpc.types'`.

Host evidence, read before changing the types:

- `skills-synthesis-rpc.schema.ts:41-68`: `EnhanceTimeoutDtoSchema` describes the four numeric fields, and `EnhanceTimeoutSettingSchema` transforms a numeric stored value into that object using the existing platform-core bounds/default constants.
- `skills-synthesis-rpc.schema.ts:85-86`: the read schema includes `judgeProvider: z.string()` and the timeout metadata schema.
- `skills-synthesis-rpc.handlers.ts:524-549`: `registerGetSettings` parses the host values with that read schema and returns `{ settings }`.
- `skills-synthesis-rpc.schema.ts:186-199`: the update schema omits the read timeout shape, makes the settings partial, and accepts a bounded numeric timeout.
- `skills-synthesis-rpc.handlers.ts:557-577`: the update handler parses that write schema and persists the parsed values.

No timeout bound/default was copied into production frontend code. The judging snapshot exposes the host metadata unchanged; a component can render seconds from it. Picker model `''` maps to persisted `'inherit'` on write and back on read, with comments naming `model-resolver.ts:171` at both adapters.

