# Code Logic Review — Batch 10c (TASK_2026_714_c8a2)

Review family: claude
Implementer family: codex

VERDICT: REVISE

Score: 7/10

Scope: `git diff -- libs/backend/cli-agent-runtime` (index.ts, cli-adapter.interface.ts,
cli-detection.service.ts + spec, di/register.ts, di/tokens.ts), the untracked
`codex-native-selection.spec.ts`, `batch-10c-report.md`, plan-p10.md "### 10c", and
plan-p10-review.md R1-R4. Read-only review. No checks were run (hard rule). The coordinator
must confirm defect 1 with the scoped test run.

Score rationale: the production logic is correct and minimal (not 5-6). Two real gaps keep it
out of 8-9: a probable spec compile failure and a factory-failure blast radius that the
10d hosts will inherit.

## Verified defects

### 1. MAJOR (blocking if the test run confirms) — spec casts probably fail TS2352 under ts-jest

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts:118`
  `authSecrets as IAuthSecretsService`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts:82`
  `{ getProviderKey: jest.fn(async () => undefined) } as IAuthSecretsService`

The implementer replaced `as unknown as` with a direct assertion. Neither direction is
comparable: the source lacks the required `getCredential`, `setCredential`, ... members of
`IAuthSecretsService` (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:23-82`),
and the interface's `getProviderKey` method type lacks the `mock`/`mockClear` members of
`jest.Mock`. TypeScript reports TS2352 for this. `jest.config.ts` runs ts-jest with
diagnostics on (only 151002 is ignored), so both suites fail to compile. The only repository
precedent for a direct cast is `{} as IAuthSecretsService`, which is comparable because it is
empty.

Fix: use the same prototype pattern the spec already uses for `Logger`:
`const secrets = Object.create(AuthSecretsService.prototype) as AuthSecretsService;`
`Object.defineProperty(secrets, 'getProviderKey', { value: jest.fn(async () => undefined) });`
(or declare `const secrets: IAuthSecretsService = { ...all members as jest.fn() }`). Keep the
`authSecrets.getProviderKey` mock handle that the Cursor test reads.

### 2. MAJOR (non-blocking for 10c, must be settled before 10d) — a factory throw takes down every CLI adapter

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:77-82`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts:135-138`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:325-328`

`codexAdapterFactory.create()` runs inside the constructor of the `TOKENS.CLI_DETECTION_SERVICE`
singleton (`register.ts:296-299`). If `create()` throws, the singleton never resolves. Then
Copilot, Cursor, Antigravity, OpenCode, Pi and Grok detection also fail, and so does every
consumer that injects the detector (`provider-rpc.handlers.ts:139`,
`agent-rpc.handlers.ts:394`, `ptah-api-builder.service.ts:388`, Electron `wire-runtime.ts:521`).
The new spec at line 135 makes this the asserted contract. 10d.C lists "missing pin refusal"
and 10d.V lists "unavailable native binary fails visibly". If a host does that check in
`create()`, a missing Codex pin breaks all lanes and RPC handlers, not only Codex.

Fix (pick one, record it in the interface doc comment):
- Contract: `create()` must be pure and must not throw for environment conditions
  (pin, binary, auth). Those surface through `detect()` (installed: false) and `runSdk()`
  (rejection). State this on `CodexAdapterFactory`.
- Or contain it: catch in the constructor, `sentryService.captureException`, and install an
  unavailable Codex adapter whose `detect()` returns `installed: false` and whose `runSdk()`
  rejects with the original error. Never construct `CodexCliAdapter` in that branch (keeps
  "no silent fallback"). Change the spec at line 135 to assert that peers still resolve.

### 3. MINOR — second optional-injection mechanism instead of the repository convention

- `libs/backend/cli-agent-runtime/src/lib/di/register.ts:152-159`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:73-75`

The comment at register.ts:152 is correct: without options, tsyringe 4.10 throws
"unregistered dependency token" for a symbol token and ignores the JS default. The guard
(`isRegistered(token, true)` + `useFactory: () => null`) is also correct: `useValue: null`
is rejected by `isValueProvider` (`!= undefined`), and a later host `register` wins because
`getRegistration` returns the last registration. All three hosts and the CLI/TUI engine call
`registerCliAgentRuntimeServices` before they resolve the detector
(`apps/ptah-electron/src/di/phase-2-libraries.ts:298`,
`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:261`,
`libs/backend/cli-engine/src/lib/container.ts:768`), and the smoke specs call it too.
But tsyringe 4.10 supports `@inject(token, { isOptional: true })`, which 117 files in this
repository use. That gives the same result with the existing `= null` default, without the
register.ts change that is outside the plan's 10c file list.

Fix: `@inject(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { isOptional: true })` and drop
the register.ts block and its import. Then change the spec "registers a null DI default"
to assert that a child container without the token constructs the legacy adapter. If the
coordinator keeps the current approach, this finding needs no change.

### 4. MINOR — "no silent fallback" is proven only for runSdk, and only trivially

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts:136-147`

The legacy constructor is never called when a factory is present, so the
`adapter('codex').runSdk` not-called assertion cannot fail. There is no case for a native
`detect()` rejection or a native `listModels()` rejection. These are the realistic native
failure paths (`doDetectAll` catch at cli-detection.service.ts:162-179, and
`listModelsForAll` catch at :233-242).

Fix: add one case where `native.detect` rejects. Assert that `getDetection('codex')` returns
`installed: false`, `CodexCliAdapter` was not constructed, and `captureException` was called.
Add one case where `native.listModels` rejects. Assert that codex is absent from the model
map and peers are present.

## Checks with no defect

- Absent or null factory: legacy `new CodexCliAdapter(this.logger)` exactly as before
  (cli-detection.service.ts:77-82). Native routing is not activated: no `apps/*` or
  cli-engine file registers the token.
- Selected adapter: one `create()` per detector. The same instance serves `getAdapter`,
  `detectAll`/`getDetection`, `listModelsForAll` and `capabilities`, so both caches follow it,
  and `invalidateCache` clears both (cli-detection.service.ts:257-261).
- Laziness: `create()` is deferred to detector construction, not to first Codex use. The
  native constructor only stores ports and builds two probe objects
  (`codex-app-server-lane.adapter.ts:111-118`), so construction starts no process.
- Barrel exports: `CodexAppServerLaneAdapter` is a new value export, but
  `@ptah-extension/codex-runtime` was already in the barrel's load graph through
  `codex-cli.adapter.ts:52-55` → `codex-lane-config.builder.ts`, and codex-runtime imports no
  `@openai/*` module. No new SDK load. Import direction is lib-internal plus a declared
  dependency (`package.json:12`). No cycle: `di/tokens.ts` has no imports.
- Host DI guards: smoke specs call `registerCliAgentRuntimeServices` before they resolve
  `TOKENS.CLI_DETECTION_SERVICE`. The null default satisfies them. No guard change is needed
  in 10c.
- Decorator metadata: `CodexAdapterFactory` is a type-only import, and the union emits
  `Object`. No TS1272.
- Spec rules: `import 'reflect-metadata'` first, no `any`, `as unknown as`, `@ts-ignore` or
  `eslint-disable`; readonly members are set with `Object.defineProperty`; no timers;
  `makeAdapter` literals contain only `CliAdapter`/`SdkHandle` members.

## Five logic questions

1. Silent failure: a native `detect()` throw becomes `installed: false` with a Sentry capture.
   That is visible and not a fallback. No success-looking path routes to legacy.
2. User action: none new in 10c, because no host binds the factory.
3. Wrong answer from input: none found. Model and detection results come from one adapter.
4. Dependency failure: a factory throw crashes the whole detector (defect 2).
5. Missing from requirements: the failure contract of `create()` (defect 2).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Rate defect 1 as "blocking if confirmed" instead of certain. | Certain blocking; minor. | TS2352 analysis plus ts-jest diagnostics on; hard rule forbids running the check. | Yes |
| Rate defect 2 non-blocking for 10c. | Blocking now. | No host binds the factory until 10d; the contract must be fixed before 10d. | Yes |

## Re-review (revision 1)

Review family: claude. Read-only. No test, lint, typecheck or diagnostics run (hard rule). The
coordinator must confirm the compile items with the scoped run.

VERDICT: APPROVED

Score: 8/10

Scope: `git diff -- libs/backend/cli-agent-runtime` (index.ts, cli-adapter.interface.ts,
codex-app-server-lane-rejection.ts, codex-app-server-lane.adapter.spec.ts,
cli-detection.service.ts + spec, di/tokens.ts), the untracked `codex-native-selection.spec.ts`,
`batch-10c-report.md` "## Revision 1", `node_modules/tsyringe` 4.10.0
`dist/cjs/dependency-container.js`, and `tools/degradation-audit/check-degradation.ts`.
`di/register.ts` has no diff now.

Score rationale: all four earlier defects are closed with correct code and a spec that can fail.
Not 9: the only remaining items are cosmetic, and the compile fixes are unconfirmed by a run.

### Per-item status

| Item | Status | Evidence |
| --- | --- | --- |
| 1. TS2352 spec mocks (defect 1) | Fixed | `cli-detection.service.spec.ts:104-126` and `codex-native-selection.spec.ts:76-93` use `Object.create(AuthSecretsService.prototype)` / `SentryService.prototype` with `Object.defineProperty`. No direct cast of a partial literal remains. The Cursor case keeps the `authSecrets.getProviderKey` mock handle (spec:126). |
| 2. TS4111 `process.env` access | Fixed | `codex-app-server-lane-rejection.ts:67` uses bracket access. `codex-app-server-lane.adapter.spec.ts:608-624` read, write and cleanup also use bracket access. A grep for `process\.env\.[A-Z]` in `cli-adapters/codex/` returns no hits. |
| 3. Factory throw takes down the detector (defect 2) | Fixed | `cli-detection.service.ts:93-110`: `create()` runs in a try. The catch logs, sends the cause to Sentry (`errorSource: 'CliDetectionService.codexAdapterFactory'`) and installs `unavailableCodexAdapter` (:35-50). The legacy `CodexCliAdapter` is constructed only in the `else` branch (:107). Peers construct after this block, so they are not affected. Contract is written on `CodexAdapterFactory` (`cli-adapter.interface.ts:325-332`). Spec `cli-detection.service.spec.ts:139-157` asserts a peer resolves, Codex detects `installed: false`, Codex is absent from models, and `runSdk` rejects with the cause text. If legacy were used, the `runSdk` rejection assertion would fail, so the spec proves "no fallback". |
| 4. Optional injection (defect 3) | Fixed | `cli-detection.service.ts:91-92`: `@inject(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { isOptional: true })` with `= null`. Same pattern as `agent-process-manager.service.ts:376-387` in this library. The register.ts null registration and its import are gone (no diff, no other token reference). Child-container spec `codex-native-selection.spec.ts:113-135` covers unregistered → legacy and bound → native. |
| 5. Native detect / listModels rejection (defect 4) | Fixed | `codex-native-selection.spec.ts:166-180` (detect rejects → `installed: false`, Sentry `doDetectAll`, no legacy construct) and `:182-199` (listModels rejects → codex absent, copilot present, Sentry `listModelsForAll`, no legacy construct). Both paths go through the real catches at `cli-detection.service.ts:190-206` and `:262-272`. |

### Specific confirmations

- tsyringe `isOptional` with a Symbol token: in 4.10.0, `resolve(token, context, isOptional)`
  returns `undefined` when there is no registration and `isNormalToken(token)` is true (a symbol
  is a normal token) (`dependency-container.js:101-108`). `construct` passes that through
  `this.resolve(param.token, context, param.isOptional)` (`:321`). The decorator stores
  `isOptional: options && options.isOptional` (`decorators/inject.js:8`). The class is then
  called with an explicit `undefined` argument, and a JS parameter default applies to
  `undefined`, so `codexAdapterFactory` is `null`. Even without the default, the `if
  (codexAdapterFactory)` test treats `undefined` as absent. The prior `claudeAdapter = null`
  parameter shows that default parameters do not break tsyringe's param-count path here.
- Unavailable adapter conformance against `CliAdapter` (`cli-adapter.interface.ts:262-323`):
  all required members are present (`name`, `displayName`, `roleChannel`, `capabilities`,
  `detect`, `parseOutput`, `runSdk`). `detect()` returns `messagingMode: 'none'`, which is a
  member of `AgentMessagingCapability` (`agent-process.types.ts:400`) and equals
  `bestMessagingCapability` of the all-false capabilities, so the catch path and the normal
  path agree. `supportsMcp: false` differs from native `true`
  (`codex-app-server-lane.adapter.ts:109`), but `agent-process-manager.service.ts:511` reads it
  only on spawn, and spawn needs an installed detection, which this adapter never reports.
  `displayName: 'Codex'` differs from native and legacy `'Codex CLI'` (see N1). `new Error(...,
  { cause })` is valid under `lib: es2022` (`tsconfig.base.json:13`).
- Degradation-audit comments: both added markers use the `reported` kind accepted by
  `check-degradation.ts:107`, sit in Zone 2 (first line inside the catch body, :512-513), and
  describe the catches correctly. The `doDetectAll` catch (`cli-detection.service.ts:190-206`)
  sends to Sentry, logs an error and records `installed: false`. The `listModelsForAll` catch
  (:262-272) sends to Sentry, logs a warning and omits the CLI. The new factory catch marker
  (:98) is also correct.

### New defects

1. NIT (non-blocking) — `cli-detection.service.ts:40`: `displayName: 'Codex'` differs from
   `'Codex CLI'` in both real Codex adapters (`codex-app-server-lane.adapter.ts:107`,
   `codex-cli.adapter.ts:322`). The effect is only the detection log text
   (`cli-detection.service.ts:181,187,203`). Fix: use `'Codex CLI'`.
2. NIT (non-blocking) — `cli-detection.service.ts:36-38`: the unavailable adapter puts
   `cause.message` into a user-visible `runSdk` error. If a 10d `create()` puts a secret or a
   full path in its error text, it surfaces in the lane error. Fix: none needed in 10c. Record
   in the 10d factory that `create()` errors must not contain credentials.

No blocking, serious or moderate defects.

### Five logic questions (revision 1)

1. Silent failure: a factory throw is now a logged, Sentry-captured `installed: false` row
   with a failing `runSdk`. No success-looking path.
2. User action: none new, because no host binds the token yet.
3. Wrong answer from input: none found.
4. Dependency failure: a factory throw is contained to Codex. Native detect/listModels
   rejections are contained and tested.
5. Missing from requirements: only the 10d error-text rule (N2).
