# Batch 12 report: decision-model settings and probe (A6b)

Task 12.1: decision-model config, probe, and `recheckAfterLiveNotFound`. Status: IMPLEMENTED. It is not verified yet. Under decision #53, Jest and Nx belong to the Mode 2 team-leader.

Executor: subagent backend-developer. Working directory: `W` only. No git commands were run.

## Files

All four files are new. No other file was touched. `src/index.ts`, Batch 11 files, `LR\matrix\`, `LR\ranking\` and `LR\reasons\` are unchanged.

- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\decision-model.types.ts` (125 lines). Contents:
  - the selection schema from part-a:724-747
  - the status DTO
  - the probe outcome type
  - the unsupported-mark schema
  - the storage, config, secret and URL constants
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.ts` (803 lines). Contents:
  - `DecisionModelConfig` (a plain class, built by a DI factory): selection, Jev key, locality and status
  - the Ollama probe with the control-path discriminator
  - the persisted unsupported mark
  - the coalesced `recheckAfterLiveNotFound`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\decision-model.config.spec.ts` (686 lines, 30 cases including `it.each` rows). Contents: acceptance cases (a)-(c), the discriminator table, and lifecycle, credential and locality cases.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\decision-model\structured-decision.port.ts` (40 lines). Contents: the `StructuredDecisionCompleter` and `StructuredDecisionRequest` port from part-a:713.

## Stack observed

- **DI:** `DecisionModelConfig` has no decorators and takes plain constructor parameters (`decision-model.config.ts:108-120`). This is the coordinator's fix round. Neither `LANE_ROUTING_TOKENS.LOGGER` nor `LANE_ROUTING_TOKENS.STRUCTURED_DECISION` is registered by any `register*.ts` today (grep over `libs` and `apps` finds no registration; Batch 19 registers `STRUCTURED_DECISION`). `tools/di-lint/check-injects.ts` rejects an `@inject` of an unregistered token, and an `@injectable` class with an un-decorated required parameter (the logger) would be flagged as a missing inject. The three platform tokens are registered in all three `platform-*/src/registration.ts`. A8 builds the class with a factory, following `PlanLimitLedgerService`, which is constructed with `new` in a factory at `auth-providers/src/lib/di/register.ts:223-226`.
- **Ports:** `PLATFORM_TOKENS.STATE_STORAGE` (global) and `SECRET_STORAGE`/`WORKSPACE_PROVIDER` (`platform-core/src/di/tokens.ts:16, :22, :25`). The type exports are at `platform-core/src/index.ts:21, :57, :58, :186`.
- **Delete semantics:** `IStateStorage.update(key, undefined)` deletes the key in every host (`electron-state-storage-worker-host.ts:237`, `cli-state-storage.ts:32-33`; Memento semantics). `clearMark` relies on this.
- **Validation:** zod 4.6.5 (`package.json:207`). The selection is validated on read (invalid reads as unset, with a warning) and on write (an invalid write throws).
- **Logging:** the lib-local structural `LaneRoutingLogger` (`lane-routing-logger.ts`, SC-9), passed by the factory from `LANE_ROUTING_TOKENS.LOGGER` (`di/tokens.ts:433`). No `vscode-core` import.
- **Imports:**
  - `zod`, `@ptah-extension/platform-core` (type-only), `@ptah-extension/shared` (`OLLAMA_PROVIDER_ENTRY`, exported at `libs/shared/src/lib/providers/index.ts:23`)
  - lib-local: `../lane-routing-logger`, `./system-one.client`
  - the spec uses `@ptah-extension/platform-core/testing` mocks (`platform-core/package.json:13-15`)

## Assumption owned by this batch

| Assumption | Result | Evidence |
| --- | --- | --- |
| A6b's probe may reuse A6a's System One client | **Partly true.** The probe reuses `SYSTEM_ONE_PATH` and the `SystemOneFetch` seam type, but not `SystemOneClient.decide()`. `decide()` always sends `{model, state, questions}` to one path. The probe has to send `{}` to two paths (route and control) under one 1500 ms budget, plus a `GET /api/version`. Batch 11 files were not modified. | `system-one.client.ts:9` (path), `:24-36` (fetch type), `:106-111` (fixed body); `decision-model.config.ts:31` (import), `:481-510` (probe) |

Other part-A facts I relied on, each checked against source:

- The selection lives in config section `ptah`, key `agentOrchestration.decisionModel`. The section/key split comes from `agent-rpc.handlers.ts:1328-1335` and `:1396-1400`.
- The Ollama base URL is section `ptah`, key `provider.ollama.baseUrl`, trimmed, with trailing slashes stripped (`ollama-model-discovery.service.ts:271-284`; namespace `ptah` at `config-manager.ts:49`). The default is `OLLAMA_PROVIDER_ENTRY.baseUrl` = `http://127.0.0.1:11434` (`local-provider-entry.ts:37`).
- The version comparison copies `isVersionAtLeast` from `ollama-model-discovery.service.ts:316-327`.

## Per-requirement evidence (`decision-model.config.ts` unless noted)

| Requirement | Evidence |
| --- | --- |
| Probe: version check first; neither POST sent for an old Ollama (≥0.35.0, ≥0.40.0 for `laya*`) | `:497-500`, `checkVersion` `:623-664` (laya at `:655`); spec `:308-326` |
| One 1500 ms budget shared by all three requests | `AbortSignal.timeout` `:492`, passed to every `send` (`:497`, `:505-508`); constant at `decision-model.types.ts:119`; timeout spec `:338-357` |
| `POST /v1/systemone {}` in parallel with control `POST {base}/v1/systemone-ptah-probe-absent {}` | `:501-509` (`Promise.all`, body `'{}'`); control path at `decision-model.types.ts:122`; spec `:174-195` asserts both paths and both `{}` bodies |
| Normalisation: status, plus the body with its own request path masked as `<path>`; JSON compared by value (canonical key order), else trimmed text | `normaliseAnswer` `:719-726` (`split(path)` `:720`), `canonicalJson` `:739-750`; spec `:230-247` (echoed path, reordered keys, whitespace) |
| Route 2xx/400/422 different from control → `ready` | `discriminate` `:672-713` (`:699`, `:712`); spec `:174`, `:265` |
| Route 404/405 different from control → `ready`, detail `route answered <status>` | `:711`; spec `:197-213` |
| Route answer equal to control's normalised answer → `unsupported-endpoint` (`endpoint does not serve /v1/systemone`) | `:701-709`; spec `:215-228` |
| Ambiguous 404/405 (control request failed) → unsupported | `:693-699`; spec `:249-263` (and `:265` for the 400 counter-case) |
| 401/403 and 5xx are not route evidence | `:680-692`; spec `.each` `:278-306`; no mark is written |
| Route network error or timeout → `unreachable` | `:676-678`; spec `:278` (network-error row), `:338` |
| `markUnsupported(base)` persisted under `ptah.decisionModel.unsupported.v1` via `IStateStorage` | `:287-312` (write `:303`); key at `decision-model.types.ts:90`; reloaded at construction `:125`, `loadMark` `:541-557` |
| Mark cleared on a selection change, ignored on a base URL change, cleared by a `ready` probe | `:172-177`, `markMatches` `:559-564`, `:430-432`; spec `:579-603`, `:460-480` |
| `recheckAfterLiveNotFound`: coalesced to one in flight per `(selection, baseUrl)`, at most one per 60 s; a call inside the window reuses the last result | `:322-347`, `coalescedRecheck` `:445-475` (window `:454`, in-flight `:473`, record `:467`); constant at `decision-model.types.ts:125` |
| `ready` re-check: no mark written, existing mark cleared, row `ready` with detail `last call failed: <error>` | `applyProbe` `:409-443` (`:429-441`), `lastFailureDetail` `:584-588`; cleared by `recordLiveSuccess` `:278-280`, by `setSelection` `:170`, and by restart (memory only, `:101`) |
| `unsupported-endpoint` re-check persists the mark with the probe detail plus the live error | `:416-428` (`<probe detail>; last call: <live error>`) |
| `unreachable`/`auth`/`provider-error` re-check: no mark and no clear | `:442`; spec `:482-497` |
| DTO state set unchanged (decision #46) | `decision-model.types.ts:45-50`; `toRowState` `:609-620` |
| Locality (Req 1.4) | `localityOf` `:232-247`, `LOCAL_HOSTNAMES` `:51`; spec `:641-649`, `:651-685` |
| Jev: credential presence only, no paid call; key stored under `ptah.laneRouting.jevApiKey`, never logged or returned to the UI | `:183-199`, `jevStatus` `:350-378`; secret key at `decision-model.types.ts:102`; spec `:617-639` |
| Structured: readiness from the port's `isReady`; port absent → `unreachable`; `reportsConfidence: false` | `structuredStatus` `:380-407`, `dto` `:590-605` |
| `StructuredDecisionCompleter` port per part-a:713 | `structured-decision.port.ts:15-40` |
| No silent swallow | Every `catch (error: unknown)` logs at warn: `:304-310`, `:355-366`, `:393-400`, `:575-581`. The transport catch at `:519-528` turns the failure into a probe outcome that is logged at debug (`:531-539`) and shown in the row detail. The `parseJson` catch (`:729-737`) returns a unique-symbol sentinel, not data. The audit flags none of them (tail below), so no `degradation-audit:` marker was added; a marker on an unflagged construct is itself a violation (`orphaned-suppression`, `check-degradation.ts:46-50`). |

## Acceptance specs (`decision-model.config.spec.ts`)

- **(a)** `:361-385`. Route `400 {"error":"model is required"}` against control `404 page not found` (the fake server's default for an unserved path). Result: `state: 'ready'` and `detail: 'last call failed: model "nimble" not found'`. `storage.update` is never called and the storage has no `ptah.decisionModel.unsupported.v1` entry, so nothing is stored. `isMarkedUnsupported()` is `false`. The detail persists on the next `getStatus` and is cleared by `recordLiveSuccess()`.
- **(b)** `:387-422`. Route and control both answer `404 page not found`. Result: `unsupported-endpoint`, and `storage.update` is called with the key and `{ selection: {kind:'ollama',model:'nimble'}, baseUrl: 'http://127.0.0.1:11434', detail: 'endpoint does not serve /v1/systemone; last call: 404 page not found', at: 1000 }`. A restart is simulated with a new `DecisionModelConfig` over the same storage and a fetch that throws if called. It reports `isMarkedUnsupported() === true`, and the stored value is unchanged. A second restart re-probes, shows the stored detail, and writes nothing.
- **(c)** `:424-444`. Two live 404s 59 999 ms apart produce one re-check: one `/api/version` call and one `/v1/systemone` call. The second call returns its own live error as the detail. At 60 000 ms a third call re-checks again (`/api/version` count is 2).
- **Extra cases:**
  - concurrent re-checks share one probe (`:446`)
  - a `ready` re-check clears a seeded mark through `update(key, undefined)` (`:460`)
  - an `unreachable` re-check leaves a mark untouched (`:482`)
  - a Jev live 404 sends no probe (`:499`)
  - a persistence failure is logged at warn and the mark stays in memory (`:518`)

## Write-path record (Mode 3 trace)

| Item | Value |
| --- | --- |
| Key | `ptah.decisionModel.unsupported.v1` (`DECISION_MODEL_UNSUPPORTED_STORAGE_KEY`, `decision-model.types.ts:90`) |
| Scope | Global `IStateStorage` via `PLATFORM_TOKENS.STATE_STORAGE` (`Symbol.for('PlatformStateStorage')`, `platform-core/src/di/tokens.ts:16`). Not `WORKSPACE_STATE_STORAGE` (`:19`). |
| Value format | JSON object `{ selection, baseUrl, detail, at }`, validated on load by `DecisionModelUnsupportedMarkSchema` (strict, `decision-model.types.ts:76-83`). Fields:<br>- `selection`: a parsed `DecisionModelSelection` (in practice `{kind:'ollama', model}`)<br>- `baseUrl`: trimmed, no trailing slash<br>- `detail`: probe detail, plus `; last call: <live error>` when written by a re-check<br>- `at`: integer epoch ms |
| Write | `markUnsupported` → `storage.update(KEY, mark)` (`decision-model.config.ts:303`). Callers: `applyProbe` `:420-422`, when the probe from `getStatus` or a re-check returns `unsupported-endpoint` and no matching mark exists yet. |
| Delete | `clearMark` → `storage.update(KEY, undefined)` (`:572`). Triggered by a `ready` probe (`:430-432`) or a selection change (`:172-177`). |
| Read | `storage.get(KEY)` once at construction (`:542`). An invalid value is ignored with a warning. A mark for another selection or base URL does not apply (`:559-564`). |
| Related writes | Selection: `IWorkspaceProvider.setConfiguration('ptah', 'agentOrchestration.decisionModel', selection)` (`:165`). Jev key: `ISecretStorage.store/delete('ptah.laneRouting.jevApiKey')` (`:192`, `:195`). |

## Index exports needed (for Batch 33; `src/index.ts` not edited)

From `./lib/decision-model/decision-model.config`:

- `DecisionModelConfig`
- `type DecisionModelConfigSeams`
- `type SystemOneTarget`

From `./lib/decision-model/decision-model.types`:

- schemas: `DecisionModelSelectionSchema`, `DecisionModelUnsupportedMarkSchema`
- constants: `DECISION_MODEL_UNSUPPORTED_STORAGE_KEY`, `DECISION_MODEL_CONFIG_SECTION`, `DECISION_MODEL_CONFIG_KEY`, `DECISION_MODEL_JEV_SECRET_KEY`, `JEV_BASE_URL`, `DECISION_MODEL_PROBE_TIMEOUT_MS`, `DECISION_MODEL_RECHECK_WINDOW_MS`, `SYSTEM_ONE_CONTROL_PATH`
- types: `DecisionModelSelection`, `DecisionModelSelectionInput`, `DecisionModelKind`, `DecisionModelLocality`, `DecisionModelState`, `DecisionModelStatusDto`, `DecisionModelProbeOutcome`, `DecisionModelProbeResult`, `DecisionModelUnsupportedMark`

From `./lib/decision-model/structured-decision.port`:

- `type StructuredDecisionCompleter`
- `type StructuredDecisionRequest`

For A8 registration: register `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG` with a `useFactory` that resolves:

- the three platform tokens
- `LANE_ROUTING_TOKENS.LOGGER`
- `STRUCTURED_DECISION` if `isRegistered(…, true)`

Then call `new DecisionModelConfig(workspace, secrets, storage, logger, structured)` without a seams argument, as `auth-providers/src/lib/di/register.ts:223-226` does. The class has no `@injectable`, so tsyringe cannot auto-construct it. A `LOGGER` registration must exist before A8's factory runs (Batch 33 / AB14).

## Verification

Under decision #53 I ran no Nx or Jest. Batch verification for the team-leader: `J(libs/backend/lane-routing, LR/decision-model/decision-model.config.spec.ts)`.

- **Prettier:** `npx prettier --write` on the 4 files, which is formatting only. It reformatted the types, config and spec files; the port file was unchanged. I ran it so Mode 2 does not hit the `prettier --check` failure Batch 11 had.
- **Diagnostics:** `ptah_get_diagnostics` on the 4 files returned `Errors: 0 | Warnings: 0`, with coverage `clean` but `analyzed: null`. So it is not proof that the spec project was type-checked.
- **ESLint:** `npx eslint <4 files>` produced no output, `eslint exit: 0`.
- **Degradation audit:** `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "lane-routing|FAIL|TOTAL"` printed:

  ```
  degradation-audit: TOTAL 296 unsuppressed site(s)
  audit exit: 0
  ```

  There is no `lane-routing` line and no `FAIL`. TOTAL is 296, the same as at the Batch 13 verify.
- **Typecheck:** not run, since `nx typecheck` is Mode 2's.
- **Fix round (coordinator, di-lint):** I removed `@injectable`/`@inject` and the `tsyringe`/`PLATFORM_TOKENS`/`LANE_ROUTING_TOKENS` imports from `decision-model.config.ts`, and updated one doc comment in `structured-decision.port.ts`. After the fix:
  - `npx prettier --write` on both files: unchanged.
  - `ptah_get_diagnostics` on the config and spec files: 0 errors.
  - `npx ts-node --transpile-only tools/di-lint/check-injects.ts` (the `di-lint:lint` command from `tools/di-lint/project.json`, run once): `di-lint OK: 1838 @inject sites all resolve to a registered token (798 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`, `di-lint exit: 0`.
  - I did not re-run ESLint after the fix, because decision #65 allows one run. The change only removes imports and decorators, and every removed import was confirmed unused by grep. The spec is unchanged: it already called `new DecisionModelConfig(...)` positionally.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Probe `auth` maps to row `no-credential`; probe `provider-error` maps to row `unreachable`, with the status in `detail` | add DTO states (rejected by #46); show `ready` | DTO state set is fixed (`decisions.md` #46). Req 1.5 lists "no credential / cannot be reached". Part A §11 says a probe failure "shows not reachable". | yes |
| D2 | 401/403 and non-route statuses (5xx and others) are classified before the equality comparison, so a proxy that answers 401 to both paths reads `no-credential`, not `unsupported-endpoint` | equality first ("whatever its status") | Part A §5 says these "do not count as route evidence" and use the existing mapping. The "equal" examples given are all 404s. | yes |
| D3 | `GET /api/version` answering 404/405 maps to `unsupported-endpoint` (`endpoint does not serve /api/version`); other non-2xx map to `provider-error` | `provider-error` for all | An endpoint without the Ollama version route cannot be a supported Ollama (Req 1.5). The mark clears when the base URL changes. | yes |
| D4 | A live 404 on a Jev selection runs no probe; the row stays `ready` with `last call failed: …` | run an Ollama-style probe against `api.typesafe.ai` | The version check is Ollama-only. TypeSafe documents its contract (`research-decision-models.md:155`). | yes |
| D5 | `getStatus` also writes the mark when its probe returns `unsupported-endpoint`, not only re-checks do | write only from re-checks | Plan line 744: "probe adds … `markUnsupported(base)`". Decision #42: "a probe returns `ready`" clears it. Decision #46 restricts only *live* evidence. | yes |
| D6 | No rewrite when a matching mark already exists (reused window result, re-probe after restart) | rewrite with a fresh `at` and detail | Fewer storage writes. Spec (b) pins it. | yes |
| D7 | A failed mark write or clear is logged at warn; the in-memory state still applies for the session; `markUnsupported` does not reject | propagate to the pipeline | Part A §5 failure behaviour: "nothing throws past the client". The row stays correct for the session. | yes |
| D8 | Port field `jsonSchema`, per part-a:713 (§10's prose says `schema`) | `schema` | The brief names part-a:713 as the contract. | yes |
| D9 | Added `resolveSystemOneTarget()` so A8 gets base URL, model and Jev key without reading the secret itself | A8 reads `ISecretStorage` directly | Part A §5 puts the Jev key with `DECISION_MODEL_CONFIG`. The key is kept inside the lib. | yes |
| D10 | The 60 s window is measured from the start of the previous re-check, not its end | measure from completion | "at most one per 60 s" bounds re-check starts. | yes |
| D11 | `DecisionModelConfig` is a plain class (no `@injectable`/`@inject`); A8 builds it with a factory | `@inject` of `LOGGER`/`STRUCTURED_DECISION` (blocks every commit: di-lint, no registration yet); plain parameter for the logger on an `@injectable` class (flagged as a missing inject) | Coordinator fix round; `tools/di-lint/check-injects.ts`; grep finds no registration of either token; di-lint OK after the fix | yes, once Batch 19/33 register both tokens |

## Plan deviations

None in behaviour. The `structured-decision.port.ts` field name follows part-a:713 (see D8). Part A §2 says lib services use tsyringe injection. `DecisionModelConfig` is factory-built instead, because of the di-lint constraint (see D11).

## Out-of-scope observations

- `decision-model.config.ts` is 803 lines. The probe and discriminator helpers (`:609-803`) could move to a `decision-model.probe.ts` in a later batch; this batch was limited to four files.
- Part A §5 states that the structured locality is "local" only for a local Ollama provider. The spec pins `providerId === 'ollama'` plus a local base. A Ptah CLI or LM Studio local provider would read `remote`. That is conservative disclosure, but A11/A12 may want a provider-locality source.
