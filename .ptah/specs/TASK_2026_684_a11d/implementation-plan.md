# Implementation Plan - TASK_2026_684_a11d

Ollama Cloud decision model (clef) through the existing `ollama-cloud` key, a generic custom `/v1/systemone`
endpoint, a decision-capability picker filter, and a gated live eval.

## Inputs and constraints

- Requirements used: `context.md` (user request, final decisions D1-D4, research), `task-description.md`
  (45 criteria, Requirements 1-9). D4 answers the open question of criterion 2.2 with option (a). D1-D4 are not
  reopened.
- Code read: branch `feat/decision-model-routing` (PR #731), read-only, in
  `D:/projects/ptah-extension/.claude-worktrees/decision-model-routing`, at commit `5474665e6` plus the staged but
  uncommitted Batch 41i (`file-settings-keys.ts`, `file-settings-manager.ts` and their specs). All `file:line`
  citations below refer to that tree. Paths without a library prefix are under `libs/backend/lane-routing/src/lib/`.
- Conventions: task 646 `implementation-plan.md`, `batches.md` Batch 41i (`:2235-2290`).
- Corrections applied: none.
- Design handoff used: none (no UI design artifacts exist; the row extends the 646 row and its tokens).
- Missing decision-critical input:
  - The client timeout for remote targets (Requirement 5) needs a keyed live run. No agent handles the key (8.3).
    `workflow_dispatch` only runs a workflow that is on the default branch (Assumption A5). Resolution: the plan ships
    a locality-based timeout whose remote value starts at 3000 ms (the 5.3 outcome) and a fixed derivation formula
    (Component 16). The value is set from the first keyed run. See "Needs the user" at the end.
  - The model id the direct API accepts (6.10). Resolution: the product sends the canonical cloud id
    (`clef:27b-cloud`) on both paths, which is what chat already sends in direct mode (evidence below). The live spec
    records both forms (Assumption A1).
- Prerequisite (context.md, task-description Risks): merge `origin/main` into this worktree after #731 and Batch 41i
  are on `main`, before any code change. Every file and line in this plan must be re-checked after that merge.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Selection union: `unset`, `ollama{model}`, `jev{model}`, `structured{providerId,model}`; Zod discriminated union, `.strict()` | `decision-model/decision-model.types.ts:10-28` | New kinds are two more union members; the schema stays the boundary validator |
| Selection stored at section `ptah`, key `agentOrchestration.decisionModel` | `decision-model.types.ts:98-99` | Custom endpoint fields can live inside this one value |
| 41i: the key is file-based and kept as a whole object on load | `platform-core/src/file-settings-keys.ts:216-219,493-505`; `file-settings-manager.ts:25,679` | No new settings key is needed; nested `baseUrl` survives a restart |
| 41i round-trip spec writer -> disk -> fresh reader | `platform-core/src/file-settings-manager.spec.ts:243-265` (per `batches.md:2275-2277`) | The provider-level persistence spec for 7.2 extends this spec |
| Jev key in `ISecretStorage` at `ptah.laneRouting.jevApiKey`; Jev URL fixed | `decision-model.types.ts:101-105` | The custom key gets a sibling slot outside `ptah.auth.` |
| `DecisionModelConfig` depends on `IWorkspaceProvider`, `ISecretStorage`, `IStateStorage`, logger, optional structured port | `decision-model/decision-model.config.ts:106-118` | The `ollama-cloud` key can be read through the port the class already holds |
| `resolveSystemOneTarget` returns `{baseUrl, model}` for Ollama (no key) and `{JEV_BASE_URL, model, apiKey?}` for Jev, read per call | `decision-model.config.ts:212-225` | Per-call reads give criterion 1.4 for free; resolution must grow two kinds |
| `localityOf`: `ollama` is local when the base URL is loopback, regardless of model | `decision-model.config.ts:242-256` | Criterion 1.5 defect: a `-cloud` model on a loopback daemon reads `local` |
| Status: probe only for `ollama`; Jev reads key presence; structured asks the port | `decision-model.config.ts:270-295,398-450` | Status must branch by probe mode, not by kind |
| Probe: `GET /api/version`, then `POST {}` to route and control under one 1500 ms budget; no Authorization header | `decision-model.config.ts:547-576`; `decision-model.probe.ts:46-136`; `decision-model.types.ts:119-122` | Endpoint mode skips the version step and adds the key |
| Probe classification: 401/403 -> `auth`; route equals control -> `unsupported-endpoint`; `toRowState(auth) = no-credential` | `decision-model.probe.ts:32-43,95-136` | 3.2-3.5 reuse the existing classifier unchanged |
| Mark and recheck logic is typed for `ollama` only | `decision-model.config.ts:298-304,362-397,462-509,679-740` | Generalise to every probed kind |
| URL join `new URL(SYSTEM_ONE_PATH, baseUrl)` drops any base path | `system-one.client.ts:124`; `decision-model.probe.ts:138-149`; `failure-class/decision-model-failure-classifier.ts:231` | Criterion 2.3 (`{baseUrl}/v1/systemone`) needs a path-preserving join in all three places |
| Client: one POST, 3000 ms default, Bearer only when `apiKey` is set, logs the URL at debug | `system-one.client.ts:12,106-198` | Custom URLs must refuse userinfo and query so no secret reaches a log |
| The pipeline passes `DECISION_REQUEST_TIMEOUT_MS` (3000) to every System One call | `pipeline/model-refine.ts:90-99`; `routing-constants.ts:109-111` | The timeout becomes a property of the resolved target |
| `openCaller`: `provider: selection.kind` typed `'ollama' \| 'jev'`; Jev without key -> blocked `auth` | `route-decide.service.ts:330-363`; `pipeline/phase-plan.ts:55-66` | New kinds map onto an option-limit provider |
| `PROVIDER_OPTION_LIMIT`: ollama 26, jev 255, structuredOutput 8 | `routing-constants.ts:98-104` | Custom and Ollama Cloud use 26 (clef serves 2-26 options, context.md) |
| Classifier `SystemOneSelection = 'ollama' \| 'jev'`; timeout 3000 + 250 | `failure-class/decision-model-failure-classifier.ts:51-52,104-107,190-260` | Extend the selection type and use the target timeout |
| Lane-routing DI: plain classes built with `instanceCachingFactory`; optional ports via `isRegistered` | `di/register.ts:43-140`; `di/tokens.ts:9-34` | The catalog is one more lib-owned factory token |
| Lane-routing imports only `platform-core` and `shared`; tags `scope:extension`, `type:feature` | `decision-model.config.ts:1-6`; `lane-routing/project.json` | Do not add `vscode-core` or `auth-providers` imports |
| `ollama-cloud` key slot is `ptah.auth.provider.ollama-cloud`; `PROVIDER_KEY_SECRET_PREFIX` exported from platform-core | `platform-core/src/provider-key-slots.ts:4,24`; `platform-core/src/index.ts:362` | The slot name has a published constant |
| VS Code `ISecretStorage` wraps `context.secrets`; `AuthSecretsService` reads `context.secrets` at `ptah.auth.provider.<id>` | `platform-vscode/src/registration.ts:72`; `vscode-core/src/services/auth-secrets.service.ts:137-142,262-276` | Same store in VS Code |
| Electron and CLI `EXTENSION_CONTEXT.secrets` delegates to `PLATFORM_TOKENS.SECRET_STORAGE` | `vscode-core/src/di/register-storage-shims.ts:50-75` | Same store in Electron and CLI (7.3) |
| A key outside `ptah.auth.` never triggers SDK re-auth | `platform-core/src/provider-key-slots.ts:60-64` | `ptah.laneRouting.customEndpointApiKey` is safe to write |
| Chat: key present and no override -> direct `https://ollama.com` with the key; otherwise the daemon at override or `127.0.0.1:11434` | `auth-providers/.../local-native.strategy.ts:73-83,213-243`; `shared/.../local-provider-entry.ts:17,114-138` | Decision routing mirrors the key/no-key split (D1) |
| Chat direct mode sends suffixed ids (`kimi-k2.6:cloud`) to ollama.com; the cloud list is canonicalised with `toCloudId` | `local-provider-entry.ts:133-137`; `ollama-cloud-metadata.service.ts:127-148,256-265` | Canonical cloud ids are the evidence for A1 |
| `isCloudTag`/`toCloudId` live in auth-providers (imports `vscode-core`); no consumer outside auth-providers | `ollama-cloud-metadata.service.ts:127-148`; `auth-providers/.../local/index.ts:17-18` | Move the two pure functions to `shared` so lane-routing can use them |
| `fetchCloudTags` keeps only `{id}`, caches `[]` for 1 h on failure, logs full tag lists | `ollama-cloud-metadata.service.ts:198-298` | Not a fit for the picker filter (Decision DC4) |
| `ProviderModelInfo.capabilities` is the SDK capability allowlist | `shared/src/lib/types/rpc/rpc-providers.types.ts:70-78` | Do not put `decision` there |
| RPC: `agent:setConfig` takes `decisionModel` and write-only `decisionModelJevApiKey` | `shared/src/lib/types/rpc/rpc-agents.types.ts:345-363` | Add `decisionModelCustomApiKey` the same way |
| `writeDecisionModel` key-then-selection rollback, `storedSelectionState`, `setConfigQueue` | `rpc-handlers/.../agent-rpc.handlers.ts:337,601-605,856-939`; `sameDecisionModelSelection` `:293-311` | Generalise over a key slot; extract out of a 1746-line file |
| Validation before any write; invalid selection -> `'Unsupported decisionModel value'` | `agent-rpc.handlers.ts:618-650` | 2.2 field-named errors go here |
| Precedent for a separate `agent:` handler class: `AgentOutcomeRpcHandlers` (101 lines), manifest entry, `registerSingleton` | `rpc-handlers/.../agent-outcome-rpc.handlers.ts:42-60`; `host-profile/manifest.ts:120-129`; `register-shared-rpc-handlers.ts:82-84` | The catalog RPC follows it |
| Registry entries for an `agent:` method; prefix already allowlisted | `shared/src/lib/types/rpc.types.ts:1291-1306,3890-3903`; `rpc-allowlist.spec.ts` | Add one entry in each block |
| Host-source baseline guards only names matching `turn\|recap\|ptah-ui\|change-set\|host-source\|usage` | `shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-55` | `agent:listDecisionModels` needs no baseline change |
| Guard constants per app for lane-routing tokens; smoke spec resolves `DECISION_MODEL_CONFIG` | `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:39-47`; `container.smoke.spec.ts:352-368` (same in electron, cli) | Add `DECISION_MODEL_CATALOG_TOKEN` and a resolve assertion in all three |
| `settings:set` refuses `agentOrchestration.decisionModel` | `rpc-handlers/.../settings-rpc.handlers.ts:68-78` | Custom endpoint fields cannot bypass validation through the generic writer |
| Row: kind select, free-text model + `<datalist>` from `PROVIDER_MODELS_LOADER.listModels('ollama')`, Jev password field, setup deep link output | `frontend/chat/.../decision-model-row.component.ts:182-300,355-365,660-697` (709 lines) | New kinds extend it; the file must be split first |
| Decision view helpers (kinds, draft, row text, parse) inside `provider-consumer-rows.ts:398-651` (651 lines) | same file | Move them to their own file before extending |
| Setup link emits any provider id up to the Providers page | `provider-consumer-assignments.component.ts:495-498,733` | `ollama-cloud` deep link works unchanged (1.1) |
| Live probe pattern: `describe.skip` unless `PTAH_LIVE_PROBES=1`; workflow with schedule, dispatch, one issue | `auth-providers/src/lib/model-lists.live.spec.ts:1-35`; `.github/workflows/model-lists-probe.yml` | Copy for the lane-routing live eval |
| System One wire schema: `choice` only; answer `{type, choice, probabilities?, confidence?}` `.strict()` | `decision-model/system-one.schema.ts:19-100` | The live eval checks the real answer passes this schema (A4) |

## Architecture decision

- Chosen approach: extend lane-routing in place with two selection kinds, `ollama-cloud{model}` and
  `custom{baseUrl, model}`, resolved by one target resolver into a single endpoint shape
  `{baseUrl, model, apiKey?, probe: 'daemon' | 'endpoint', locality, timeoutMs}`. Every consumer (status, probe,
  pipeline, failure classifier) uses that shape, so no consumer branches on kind beyond the resolver. The
  `ollama-cloud` key is read through the existing `ISecretStorage` port at `PROVIDER_KEY_SECRET_PREFIX + 'ollama-cloud'`.
  The custom key gets its own slot, bound to the endpoint origin. A new lane-routing `DecisionModelCatalog` lists
  decision-capable models for `ollama` (daemon `/api/tags` + cached `/api/show`) and `ollama-cloud`
  (`https://ollama.com/api/tags`), served by a new `agent:listDecisionModels` RPC. A gated live spec plus a weekly
  workflow prove clef on Ollama Cloud.
- Rationale: one resolver keeps the per-kind rules (D1 key/no-key split, D2 custom endpoint, D4 transport rule,
  locality, timeout) in one unit with one spec. Reading the key through `ISecretStorage` needs no new port and no
  composition-root change, and it reads the same store in all three hosts (evidence rows 18-20). The catalog in
  lane-routing keeps the library free of `vscode-core` and keeps the decision picker away from chat's caches.
- Rejected alternatives:
  - A new optional port `DECISION_PROVIDER_KEY` implemented over `IAuthSecretsService` (the `STRUCTURED_DECISION`
    pattern, task-description Risks). Loses: three composition-root bindings, three guard updates and a new
    `vscode-core` consumer for a value the lib can already read through a port it holds; the slot name is a published
    platform-core constant.
  - Custom endpoint fields as separate settings keys (`agentOrchestration.decisionEndpoint.baseUrl` etc.). Loses: new
    file-based keys, a second write that can half-succeed, and a selection that no longer validates as one value.
  - Decision filter inside `OllamaModelDiscoveryService`/`OllamaCloudMetadataService` (auth-providers). Loses: grows a
    766-line file, bends a metadata cache that short-circuits cloud ids to a static table and caches failures for an
    hour, and puts the result in `ProviderModelInfo.capabilities`, which is the SDK allowlist.
- Assumptions (each has a check in the live spec or a named step):
  - A1: `POST https://ollama.com/v1/systemone` accepts the suffixed id `clef:27b-cloud`. Check: live spec records
    both forms (6.10). If only `clef:27b` works, a fix batch strips the suffix on the direct path only (one function
    in Component 5).
  - A2: a keyed `POST /v1/systemone {}` to ollama.com answers 400 or 422 without inference, and the control path
    answers 404, so the probe reports `ready` without spending quota. Check: live spec probe case.
  - A3: an unknown model on ollama.com answers 404 (`provider-error`, `notFound: true`). Check: 6.7 live case.
  - A4: clef's answer objects pass the `.strict()` answer schema. Check: every live answer is parsed by the client.
  - A5: `workflow_dispatch` needs the workflow file on the default branch. Check: GitHub docs or a dispatch attempt on
    the feature branch.
  - A6: the daemon's `/api/show` returns `capabilities`; older daemons omit it. Handled as "undetermined" (4.3).
- Effect on existing code: the four existing kinds keep their behaviour, with two deliberate changes: an `ollama` (or
  structured `ollama`) selection whose model is a cloud tag now reads `remote` (1.5), and URL joins preserve a base
  path (identical output for today's path-less base URLs). Jev key methods are replaced by slot methods (no V2 copies).
  `writeDecisionModel` moves out of `agent-rpc.handlers.ts`. Decision helpers move out of `provider-consumer-rows.ts`.
  `isCloudTag`/`toCloudId` move from auth-providers to shared. Nothing is removed.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| DC1 | Read the `ollama-cloud` key with `ISecretStorage.get(PROVIDER_KEY_SECRET_PREFIX + 'ollama-cloud')`, per call, read-only | port + adapter / injected resolver / existing port | Rows 18-20 of the evidence table; `decision-model.config.ts:110,212-225` | Yes |
| DC2 | Custom endpoint lives in the selection value `{kind:'custom', baseUrl, model}`; no new settings key | separate keys / inside selection | 41i whole-object key, `file-settings-keys.ts:493-505` | Yes (unreleased) |
| DC3 | Custom key slot `ptah.laneRouting.customEndpointApiKey`; the secret value is JSON `{origin, key}`; the key is sent only when the selection's origin equals the stored origin | unbound key / origin-bound key | NFR "a key only to the base URL configured for that key"; criterion 2.3 "and nowhere else"; `provider-key-slots.ts:60-64` | Yes |
| DC4 | The picker filter is served by a lane-routing catalog with its own `/api/tags` and `/api/show` fetches. `OllamaCloudMetadataService.fetchCloudTags` is not changed. Criterion 4.1's "the cloud tag fetch shall keep capabilities" is met by the catalog's cloud fetch, the fetch the picker uses | change fetchCloudTags / own fetch | DC4 rejected-alternative text; changing `fetchCloudTags` would add a field nothing reads | Yes |
| DC5 | Ollama Cloud model ids are canonical cloud ids (`toCloudId`), sent unchanged on both paths; `isCloudTag`/`toCloudId` move to `@ptah-extension/shared` | duplicate in lane-routing / import auth-providers / move to shared | `ollama-cloud-metadata.service.ts:127-148`; no external importer | Yes |
| DC6 | Ollama Cloud with a key and a `provider.ollama-cloud.baseUrl` override sends the key to the override (criterion 1.2). Chat ignores the key when an override is set (`local-native.strategy.ts:76`); routing follows 1.2. The D4 transport rule also guards the override: an override that is neither https nor loopback gets no key, and the row reads `unsupported-endpoint` with a fixed detail | follow chat / follow 1.2 / 1.2 + transport rule | Criterion 1.2 text; D4 | Yes |
| DC7 | Locality is `remote` when the base URL is not loopback or the model is a cloud tag, for `ollama`, `custom` and structured `ollama`; `ollama-cloud` and `jev` are always `remote` | per kind / one rule | Criterion 1.5, 2.6 | Yes |
| DC8 | Timeout follows locality: `local` 3000 ms, `remote` `DECISION_REQUEST_TIMEOUT_REMOTE_MS` (starts at 3000, set by Component 16) | per kind / per locality | Criterion 5.2 "remote targets"; `routing-constants.ts:109-111` | Yes |
| DC9 | `ollama-cloud` and `custom` use the `ollama` option limit (26) | 26 / 255 | `routing-constants.ts:98-104`; clef choice limit 2-26 (context.md) | Yes |
| DC10 | `agent:setConfig` refuses a request that sets both key fields; a non-empty custom key needs a custom selection (sent or saved) to bind to; `''` always deletes | allow both / refuse | Keeps the 646 rollback rules to one key per request | Yes |
| DC11 | `systemOneUrl(baseUrl, path)` joins `normaliseBaseUrl(baseUrl) + path`; base URLs refuse userinfo, query and fragment | keep `new URL(path, base)` / path-preserving | Criterion 2.3; `system-one.client.ts:124,139-144` logs the URL | Yes |
| DC12 | Field-named save errors are fixed shared constants that the row may repeat, like `DECISION_MODEL_KEY_MAY_HAVE_CHANGED` | host text / fixed constants | `rpc-agents.types.ts:155-161`; row rule `decision-model-row.component.ts:636-651` | Yes |
| DC13 | `apiKeyStored?: boolean` on the status DTO, set for `jev` and `custom` only | new field / derive from state | Criterion 2.4, 2.7; a custom endpoint may legitimately have no key, so state cannot encode it | Yes |
| DC14 | The probe keeps one 1500 ms budget in endpoint mode | longer remote budget / same | Probe makes no inference call; live spec measures it (A2) | Yes |

## Component specifications

### 1. Shared contracts

- Purpose: the plain-type mirror of the new kinds, the write-only key field, the status key indicator, the fixed
  error texts, and the catalog RPC types.
- Responsibilities:
  - `DecisionModelSelectionDto` and `DecisionModelSelectionInputDto` gain
    `{ kind: 'ollama-cloud'; model: string }` and `{ kind: 'custom'; baseUrl: string; model: string }`.
  - `DecisionModelStatusDto` gains `readonly apiKeyStored?: boolean` (DC13).
  - `AgentOrchestrationConfig` gains `decisionModelCustomApiKey?: string` (write-only, `''` deletes), documented like
    `decisionModelJevApiKey` (`rpc-agents.types.ts:357-362`).
  - New fixed constants beside `DECISION_MODEL_KEY_MAY_HAVE_CHANGED`: `DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED`,
    `DECISION_MODEL_INVALID_BASE_URL`, `DECISION_MODEL_INVALID_MODEL`, `DECISION_MODEL_KEY_NEEDS_HTTPS`,
    `DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT`. Each text names its field (2.2).
  - New file `rpc-decision-model-catalog.types.ts`: `DecisionModelCatalogSource = 'ollama' | 'ollama-cloud'`,
    `AgentListDecisionModelsParams { source }`, `AgentListDecisionModelsResult { models: string[];
    filter: 'applied' | 'partial' | 'unavailable'; undetermined: number }`. Precedent: `rpc-lane-outcome.types.ts`.
  - The registry entries in `rpc.types.ts` are NOT in this component: they land with Component 10, because
    `assertManifestInvariants` fails while a registry method has no handler.
- Verified contracts and entry points: `rpc-agents.types.ts:104-161,345-363`; `rpc.types.ts:17` (re-export).
- Dependencies: none new (shared depends only on shared).
- Integration points: frontend row (Components 12-13), rpc-handlers (9-10), lane-routing types mirror these shapes
  (the lane-routing Zod schema stays the validator, `rpc-agents.types.ts:105-109`).
- Failure behaviour: types only.
- Quality requirements: no secret field on any read DTO.
- Verification seam: `npx nx typecheck @ptah-extension/shared`; a type-level spec is not needed.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/types/rpc.types.ts` (re-export line only)

### 2. Cloud model id helpers (move to shared)

- Purpose: one definition of the Ollama cloud tag convention for chat and routing (DC5).
- Responsibilities: move `isCloudTag` and `toCloudId` unchanged
  (`ollama-cloud-metadata.service.ts:127-148`) into `libs/shared/src/lib/providers/ollama-cloud-model-id.ts`, export
  them from `providers/index.ts`; auth-providers imports them from `@ptah-extension/shared`; drop the two re-exports
  from `auth-providers/.../local/index.ts:17-18` (no external importer, verified by search); move the spec.
- Verified contracts: `ollama-cloud-metadata.service.ts:127-148`; `ollama-model-discovery.service.ts:16-19` (imports
  `isCloudTag`); `ollama-cloud-metadata.cloud-id.spec.ts` (42 lines); `shared/src/lib/providers/index.ts:25-27`.
- Dependencies: auth-providers -> shared (exists).
- Integration points: lane-routing Components 3, 5, 8 import from shared.
- Failure behaviour: pure functions.
- Quality requirements: behaviour identical; the moved spec cases pass unchanged.
- Verification seam: moved spec in shared; `npx nx test @ptah-extension/auth-providers --parallel=1` still green.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/providers/ollama-cloud-model-id.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/providers/ollama-cloud-model-id.spec.ts` (moved cases)
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/providers/index.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/auth-providers/src/lib/providers/local/ollama-model-discovery.service.ts` (import line)
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/auth-providers/src/lib/providers/local/index.ts`
  - DELETE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.cloud-id.spec.ts`

### 3. Selection schema and endpoint URL policy (lane-routing)

- Purpose: validate the two new kinds at the boundary and own the base URL rules (2.2, D4, DC11).
- Responsibilities:
  - `DecisionModelSelectionSchema` gains `ollama-cloud { model: string 1..128 }` and
    `custom { baseUrl: EndpointBaseUrlSchema, model: string 1..128 }`, both `.strict()`.
  - New `decision-endpoint.url.ts` (pure): `parseEndpointBaseUrl(raw)` accepts an absolute `http:`/`https:` URL,
    at most 2048 characters, with no username, password, query or fragment, and returns the normalised base
    (trimmed, trailing slashes removed) or an error code; `isLoopbackBase(url)` (reuses the loopback host set of
    `decision-model.probe.ts:20`); `keyTransportAllowed(url) = protocol === 'https:' || isLoopbackBase(url)` (D4);
    `systemOneUrl(baseUrl, path)` path-preserving join (DC11); `originOf(url)`.
  - New constants in `decision-model.types.ts`: `DECISION_MODEL_CUSTOM_SECRET_KEY =
    'ptah.laneRouting.customEndpointApiKey'`, `OLLAMA_CLOUD_SECRET_KEY = PROVIDER_KEY_SECRET_PREFIX + 'ollama-cloud'`,
    `OLLAMA_CLOUD_BASE_URL_CONFIG_KEY = 'provider.ollama-cloud.baseUrl'`; `DecisionModelStatusDto.apiKeyStored?`.
  - `DecisionModelUnsupportedMarkSchema` needs no change (it embeds the selection schema, `:76-83`).
- Verified contracts: `decision-model.types.ts:10-28,48-57,76-83,98-105`; `decision-model.probe.ts:20,151-159`;
  `platform-core/src/provider-key-slots.ts:24`.
- Dependencies: lane-routing -> platform-core (exists), shared (exists).
- Integration points: rpc-handlers validation (Component 9) runs the same schema; frontend mirrors the URL rule for
  inline hints only.
- Failure behaviour: `safeParse` failure carries the issue path (`baseUrl` or `model`), which Component 9 maps to a
  field-named constant.
- Quality requirements: no secret can be carried inside a stored base URL (no userinfo, no query).
- Verification seam: `decision-endpoint.url.spec.ts` (table of accepted/refused URLs, loopback hosts, transport
  rule, path join); schema cases in a new `decision-model.types.spec.ts`.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.spec.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.types.spec.ts`

### 4. Decision keys (lane-routing)

- Purpose: one owner for every key the decision model reads or writes.
- Responsibilities:
  - New `decision-model.keys.ts`, class `DecisionModelKeys` over `ISecretStorage`, slots `'jev' | 'custom'`
    (exported type `DecisionKeySlot`):
    - `has(slot, origin?)`, `get(slot, origin?)` (custom: only when the stored origin equals `origin`, DC3),
      `set(slot, key, origin?)` (blank deletes; custom requires an origin), `snapshot(slot)` and
      `restore(slot, snapshot)` (opaque raw value, for the RPC rollback; `null` restores "no key").
    - Custom secret value is JSON `{ origin, key }` validated with Zod on read; an invalid value reads as "no key"
      and logs a warn with no value.
    - `readOllamaCloudKey()`: trimmed value of `OLLAMA_CLOUD_SECRET_KEY` or `null`. Never writes that slot.
  - `DecisionModelConfig` exposes `readonly keys: DecisionModelKeys` and drops `hasJevApiKey`, `readJevApiKey`,
    `setJevApiKey` (`decision-model.config.ts:181-206`); callers and mocks move to slot methods.
- Verified contracts: `decision-model.config.ts:181-225`; `ISecretStorage` `get/store/delete` as used there.
- Dependencies: `ISecretStorage` (platform-core port).
- Integration points: Component 5 (resolution), Component 6 (status `apiKeyStored`), Component 9 (writer).
- Failure behaviour: a rejected secret read propagates to the caller; status maps it to `unreachable` with
  `DECISION_MODEL_DETAIL.credentialStore` (existing pattern `decision-model.config.ts:398-418`). No method logs, returns
  across RPC, or embeds a key in an error.
- Quality requirements: criterion 1.6. A changed `ollama-cloud` key is seen by the next read (no cache, 1.4).
- Verification seam: `decision-model.keys.spec.ts` with an in-memory `ISecretStorage`: origin binding, delete,
  snapshot/restore, invalid JSON, `readOllamaCloudKey` asserts the literal `'ptah.auth.provider.ollama-cloud'` (7.3),
  sentinel-key search over logger calls and thrown errors (1.6).
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.keys.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.keys.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`

### 5. Target resolution (lane-routing)

- Purpose: turn the current selection plus settings plus keys into one endpoint, the single place where kind rules
  live.
- Responsibilities: new `decision-model.target.ts`, `resolveDecisionEndpoint(selection, deps)` returning
  `DecisionEndpoint | { blocked: true; detail: string } | null` (`null` for `unset`/`structured`):

  | Kind | Base URL | Key | Probe | Locality |
  | --- | --- | --- | --- | --- |
  | `ollama` | `ollamaBaseUrl()` (unchanged, `config.ts:230-239`) | none | `daemon` | DC7 |
  | `ollama-cloud`, key stored | override `provider.ollama-cloud.baseUrl`, else `OLLAMA_CLOUD_DIRECT_BASE_URL` | `ollama-cloud` key (blocked when the override fails `keyTransportAllowed`, DC6) | `endpoint` | `remote` |
  | `ollama-cloud`, no key | override, else `OLLAMA_CLOUD_PROVIDER_ENTRY.baseUrl` | none | `daemon` | `remote` |
  | `jev` | `JEV_BASE_URL` | Jev key when stored | none (key-presence status, unchanged) | `remote` |
  | `custom` | `selection.baseUrl` | custom key bound to its origin; blocked when a key would cross a non-https, non-loopback URL | `endpoint` | DC7 |

  - `model`: `ollama-cloud` sends `toCloudId(selection.model)` on both paths (DC5, A1).
  - `timeoutMs`: `local` -> `DECISION_REQUEST_TIMEOUT_MS`; `remote` -> `DECISION_REQUEST_TIMEOUT_REMOTE_MS` (DC8).
  - `SystemOneTarget` (`config.ts:41-47`, internal only, verified no importer outside lane-routing) becomes this
    endpoint shape with required `timeoutMs`.
  - `DecisionModelConfig.resolveSystemOneTarget()` and `localityOf()` delegate to the resolver; a blocked result
    returns `null` to callers (existing null handling, `route-decide.service.ts:351`, classifier `:195-201`).
- Verified contracts: `decision-model.config.ts:212-256`; `shared` exports `OLLAMA_CLOUD_DIRECT_BASE_URL`,
  `OLLAMA_CLOUD_PROVIDER_ENTRY`, `OLLAMA_PROVIDER_ENTRY` (`local-provider-entry.ts:17,114-138`;
  `providers/index.ts:25-27`); `IWorkspaceProvider.getConfiguration(section, key)` (`config.ts:130-133,231-234`).
- Dependencies: Components 2, 3, 4; `IWorkspaceProvider`.
- Integration points: status (6), pipeline and classifier (7), live spec (14).
- Failure behaviour: secret read rejection propagates (callers already catch: `route-decide.service.ts:349-362`);
  blocked results carry fixed detail text only.
- Quality requirements: the key goes only to the base URL resolved for it (1.2, 2.3, NFR); a `-cloud` model never
  reads `local` (1.5).
- Verification seam: `decision-model.target.spec.ts`, a table over every row above: URL, header presence, model id,
  locality, timeout, blocked cases, override with and without key, key added or removed between two calls (1.4).
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.target.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.target.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`

### 6. Probe and status for every probed kind (lane-routing)

- Purpose: correct row state for daemon and non-daemon hosts (Requirement 3) without growing the config class.
- Responsibilities:
  - New `decision-model.prober.ts`, class `DecisionEndpointProber`: the `probe` and `send` bodies move out of
    `decision-model.config.ts:547-604` unchanged, plus an `endpoint` mode that skips `checkVersion` and sends
    `authorization: Bearer <key>` on the route and control POSTs when the endpoint has a key. One 1500 ms budget
    (DC14). The config keeps its constructor seams (`fetch`, `now`, `probeTimeoutMs`, `config.ts:50-56`) and passes
    them to the prober.
  - `buildProbeUrls` uses `systemOneUrl` (DC11); `discriminate`, `checkVersion`, `toRowState` are unchanged.
  - Config status: `statusForCurrent`, `applyProbe`, `isMarkedUnsupported`, `recheckAfterLiveNotFound`,
    `currentProbeKey`, `currentRowWithoutProbe` switch on the resolved endpoint's probe mode instead of
    `kind === 'ollama'` (`config.ts:270-304,362-397,462-509,679-740`). Marks stay keyed by `keyOf(selection, baseUrl)`,
    so a key change that switches the Ollama Cloud path also switches the mark key.
  - `dto()` sets `reportsConfidence` for every System One kind and `apiKeyStored` for `jev`/`custom` (DC13).
  - Fixed row details (new entries in `decision-model.detail.ts`): key refused (401/403 with a key), key required
    (401/403 without a key), key needs https (blocked custom or override).
- Verified contracts: `decision-model.probe.ts:32-149`; `decision-model.config.ts:462-604,715-740`;
  `decision-model.detail.ts:10-19`; `decision-model.types.ts:44-46` (state set unchanged, 3.4).
- Dependencies: Components 3-5.
- Integration points: `agent:getConfig` (`agent-rpc.handlers.ts:508,535-560`), pipeline live-404 recheck
  (`route-decide.service.ts:286-299`).
- Failure behaviour: never rejects (existing contract); unreachable or timed-out probe -> `unreachable` (3.3); 401/403
  -> `no-credential` (3.2); control match -> `unsupported-endpoint` with mark (3.4); the probe never sends request text.
- Quality requirements: no `/api/version` call in endpoint mode (3.1); daemon paths keep the version floor; no key
  in a log line or detail (1.6).
- Verification seam: `decision-model.prober.spec.ts` (fake fetch: call list per mode, headers, budgets); new
  `decision-model.config.endpoint.spec.ts` for 3.1-3.5 per kind and the sentinel-key DTO search; the existing
  `decision-model.config.spec.ts` (1018 lines) keeps passing with mock renames only.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.prober.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.prober.spec.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.endpoint.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.probe.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.detail.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.spec.ts` (mock/method renames only)

### 7. Call path: client, pipeline, classifier (lane-routing)

- Purpose: send the resolved endpoint with its key, URL and timeout on every decision call.
- Responsibilities:
  - `system-one.client.ts:124`: build the URL with `systemOneUrl`. Doc comment for `apiKey` no longer says "Jev only".
  - `pipeline/model-refine.ts:90-99`: `systemOneClientOptions` uses `target.timeoutMs`.
  - `routing-constants.ts`: add `DECISION_REQUEST_TIMEOUT_REMOTE_MS` (initial 3000, comment cites Component 16) and
    derive the doc constant `OVERALL_CALL_BUDGET_MS` from the larger of the two.
  - `route-decide.service.ts:330-363`: `provider` maps `ollama | ollama-cloud | custom -> 'ollama'`, `jev -> 'jev'`
    (DC9); the Jev missing-key block stays.
  - `failure-class/decision-model-failure-classifier.ts`: `SystemOneSelection` covers the new kinds (`:104-107`); URL
    via `systemOneUrl` (`:231`); per-request budget `target.timeoutMs + DECISION_RETURN_MARGIN_MS` unless the seam
    overrides it (`:262-264`).
  - Test call sites `route-decide.preflight.spec.ts:169`, `route-decide.gate.spec.ts:330` pass `timeoutMs`.
- Verified contracts: listed lines.
- Dependencies: Component 5.
- Integration points: unchanged callers of `RouteDecideService` and the classifier.
- Failure behaviour: a call past its timeout returns cause `timeout` and the 646 fallback applies (5.4); no retry.
- Quality requirements: payload field set unchanged (`decision-payload.spec.ts` still passes, NFR).
- Verification seam: `system-one.client.spec.ts` gains path-join and custom-key header cases (2.3); `model-call.spec.ts`
  or a new `model-refine.spec.ts` asserts the client receives the target timeout and that a timed-out remote call
  falls back (5.4); classifier spec gains a new-kind case.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/system-one.client.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/pipeline/model-refine.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/routing-constants.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/route-decide.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/failure-class/decision-model-failure-classifier.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/failure-class/decision-model-failure-classifier.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/route-decide.preflight.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts`
  - MODIFY or CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/pipeline/model-call.spec.ts`

### 8. Decision-model catalog (lane-routing)

- Purpose: list the models a host reports as `decision`-capable, for the picker only (Requirement 4, D3).
- Responsibilities:
  - New `decision-model.catalog.ts`, plain class `DecisionModelCatalog`, method
    `list(source: 'ollama' | 'ollama-cloud'): Promise<{ models: string[]; filter; undetermined }>`.
    - `ollama`: `GET {ollamaBaseUrl}/api/tags`, then `POST /api/show {model}` per tag, at most 5 in flight; a model is
      listed when `capabilities` includes `decision`. A missing `capabilities` field or a failed lookup counts as
      undetermined and is not listed (4.3).
    - `ollama-cloud`: `GET https://ollama.com/api/tags` with no key (public, context.md); list entries whose
      `capabilities` include `decision`; ids returned as `toCloudId(name)`.
    - `filter`: `applied` when every model was determined, `partial` when some were not, `unavailable` when the
      listing failed.
  - Cache: `/api/show` answers keyed by `[baseUrl, name, digest]`, 10 min for answers, 60 s for failures (same TTLs
    as `ollama-model-discovery.service.ts:248-251`); entries not in the latest tag list for that base URL are pruned
    and a base URL change clears the cache, so the cache is bounded by the daemon's model count (4.2). Cloud tags
    cached 10 min on success only.
  - Budget: one 4000 ms abort signal per `list` call (the row's RPC timeout is 5000 ms,
    `decision-model-row.component.ts:57`); models not answered in time are undetermined.
  - Boundary schemas in `ollama-catalog.schema.ts` (Zod): `/api/tags` `{ models: [{ name?, model?, digest?,
    capabilities? }] }`, `/api/show` `{ capabilities?: string[] }`, passthrough, ids 1..128 chars.
  - New token `LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG = Symbol.for('LaneRoutingDecisionModelCatalog')`, built in
    `registerLaneRoutingServices` with `instanceCachingFactory` from `DECISION_MODEL_CONFIG` (for `ollamaBaseUrl`) and
    the logger. Exported from `index.ts` with its result types.
- Verified contracts: `di/tokens.ts:9-34`; `di/register.ts:84-98`; `decision-model.config.ts:230-239`;
  `SystemOneFetch` seam `system-one.client.ts:24-36`.
- Dependencies: Component 2 (`toCloudId`), Component 5 (base URL via config); no `vscode-core`.
- Integration points: Component 10 RPC handler; Component 14 live spec (catalog check 6.3).
- Failure behaviour: never rejects; network or schema failure -> `filter: 'unavailable'`, `models: []`, warn log with
  error name only; no host text reaches the result.
- Quality requirements: at most one `/api/show` per model per TTL (4.2); no model name in code (4.6); no write path to
  the selection (4.5).
- Verification seam: `decision-model.catalog.spec.ts` with a fake fetch: filter, undetermined handling, cache hit
  counts, pruning, budget expiry, cloud id canonicalisation, a fixture without clef proving no fixed list. Register
  spec gains a resolve case.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/ollama-catalog.schema.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/di/tokens.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/di/register.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/di/register.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/index.ts`

### 9. Decision-model writer and `agent:setConfig` / `agent:getConfig` (rpc-handlers)

- Purpose: write the selection and either key with the 646 rollback rules, and enforce D4 and DC10 before any write.
- Responsibilities:
  - New `handlers/decision-model-writer.ts`, plain class `DecisionModelWriter(config, logger)` constructed by
    `AgentRpcHandlers`. `writeDecisionModel`, `storedSelectionState` and `sameDecisionModelSelection` move here from
    `agent-rpc.handlers.ts:293-311,856-939`, generalised over `DecisionKeySlot` with `keys.snapshot/restore`. The
    equality covers `ollama-cloud` and `custom` (`baseUrl` + `model`). The restore-failure text is
    `DECISION_MODEL_KEY_MAY_HAVE_CHANGED` (jev) or `DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED` (custom).
  - Validation in `applySetConfig` before any write (`agent-rpc.handlers.ts:618-650`): `decisionModelCustomApiKey`
    must be a string; both key fields together are refused (DC10); a selection `safeParse` failure maps its issue
    path to `DECISION_MODEL_INVALID_BASE_URL` / `DECISION_MODEL_INVALID_MODEL`, else the existing
    `'Unsupported decisionModel value'`; the writer then refuses `DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT` and
    `DECISION_MODEL_KEY_NEEDS_HTTPS` (effective key = new non-empty key, or a stored key bound to the same origin,
    against the custom selection being saved or already saved).
  - `agent:getConfig` needs no change: it returns `config.getStatus()` (`:508,535-560`), which now carries
    `apiKeyStored`.
  - `AgentRpcHandlers` still runs every write through `setConfigQueue` (`:337,601-605`).
- Verified contracts: `agent-rpc.handlers.ts:293-316,337,365-368,594-700,856-939`.
- Dependencies: Components 1, 3, 4 (exports `DecisionKeySlot`, schema, `DecisionModelConfig.keys`).
- Integration points: frontend row writes (Component 13).
- Failure behaviour: validation failures change nothing (2.2); a selection write that rejects after a new key restores
  the previous key; a selection stored before the rejection reports success; a failed restore reports the
  "may have changed" constant (2.5). Logs carry error types only.
- Quality requirements: no key in any response or log (1.6, 2.4).
- Verification seam: `agent-rpc.handlers.decision-model.spec.ts` (863 lines) keeps its cases with slot-method mocks
  and turns its rollback cases into `describe.each` over both key fields (2.5 "the existing rollback specs gain
  equivalent cases"). New `agent-rpc.handlers.decision-endpoint.spec.ts` for validation (2.2, D4, DC10), `getConfig`
  key indicator (2.4), sentinel-key search over logs and DTOs (1.6). Other handler specs that mock the config
  (`list-rows`, `migration`, `resume-parent-session`, `set-config`, base spec: 2 references each) get the renamed mocks.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.decision-endpoint.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.decision-model.spec.ts`
  - MODIFY (mock renames) `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.list-rows.spec.ts`, `agent-rpc.handlers.migration.spec.ts`, `agent-rpc.handlers.resume-parent-session.spec.ts`, `agent-rpc.handlers.set-config.spec.ts`, `agent-rpc.handlers.spec.ts` (same directory)

### 10. `agent:listDecisionModels` RPC (rpc-handlers, shared registry, app guards)

- Purpose: serve the catalog to the webview in every host.
- Responsibilities:
  - New `handlers/decision-model-catalog-rpc.handlers.ts`, class `DecisionModelCatalogRpcHandlers`
    (`METHODS = ['agent:listDecisionModels']`), injecting `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`,
    `LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG`; params validated with Zod (`source` enum); delegates to
    `catalog.list`; an unexpected rejection returns `filter: 'unavailable'` and logs the error type.
  - Registry: `rpc.types.ts` gains `'agent:listDecisionModels': { params; result }` (after `:1306`) and the name entry
    (after `:3892`).
  - Manifest entry `{ key: 'decisionModelCatalog', methods, requires: [], handler }` after `agentOutcome`
    (`host-profile/manifest.ts:120-129`); `container.registerSingleton(DecisionModelCatalogRpcHandlers)` in
    `register-shared-rpc-handlers.ts:84`; exports in `handlers/index.ts` and `src/index.ts`.
  - App guards: `DECISION_MODEL_CATALOG_TOKEN` in each `expected-resolvable.ts` (pattern `:39-47`) and a resolve
    assertion in each `container.smoke.spec.ts` (pattern `:352-368`).
- Verified contracts: listed lines; `agent:` prefix allowlisted (`vscode-core/src/messaging/rpc-handler.ts:44`,
  `rpc-allowlist.spec.ts`); baseline unaffected (evidence row).
- Dependencies: Components 1, 8.
- Integration points: frontend suggestions (Component 13).
- Failure behaviour: never throws to the webview for a valid source; an invalid source returns a validation error.
- Quality requirements: no network call on registration; only on request.
- Verification seam: `decision-model-catalog-rpc.handlers.spec.ts`; `rpc-allowlist.spec.ts` and
  `assertManifestInvariants` pass; three smoke specs pass.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/handlers/index.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/shared/src/lib/types/rpc.types.ts` (registry entries)
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/apps/ptah-extension-vscode/src/di/expected-resolvable.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/apps/ptah-electron/src/di/expected-resolvable.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/apps/ptah-cli/src/di/expected-resolvable.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts`

### 11. Persistence proof (platform-core spec)

- Purpose: prove the new selection shapes survive a restart through the real file manager (2.7, 7.2), the check
  Batch 41i lacked.
- Responsibilities: extend the 41i round-trip case (`file-settings-manager.spec.ts:243-265`) with
  `{ kind: 'ollama-cloud', model: 'clef:27b-cloud' }` and
  `{ kind: 'custom', baseUrl: 'https://decide.example.com/gw', model: 'm1' }`: writer -> disk -> fresh reader returns
  the whole object, no `.baseUrl` leaf. `file-settings-keys.spec.ts` needs no new key case (DC2); 7.1 is satisfied
  by "no new key", and the existing 41i assertions (`:305-328`) keep the one key file-based.
- Verified contracts: `file-settings-manager.ts:25,248,471,679`; `file-settings-keys.ts:493-505`.
- Dependencies: none (fixtures are literal objects).
- Failure behaviour: not applicable.
- Verification seam: `npx nx test @ptah-extension/platform-core --parallel=1`.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/platform-core/src/file-settings-manager.spec.ts`

### 12. Decision row view helpers (frontend)

- Purpose: pure view logic of the row in its own file, extended for the new kinds.
- Responsibilities:
  - Move `provider-consumer-rows.ts:398-651` (decision section) to new `decision-model-row.view.ts`, and the matching
    spec cases to `decision-model-row.view.spec.ts`, with no behaviour change in the move step. Only
    `decision-model-row.component.ts` imports these helpers (verified by search).
  - Extend: `DECISION_KIND_OPTIONS` order Unset, Ollama decision model, Ollama Cloud, TypeSafe Jev, Custom endpoint
    (`/v1/systemone`), Structured-output model (1.1); draft gains `baseUrl`; `decisionModelInput` builds the new
    shapes; `sameDecisionSelection` compares them; `parseSelection`/`parseDecisionModelStatus` accept the new kinds and
    the optional `apiKeyStored`; `servedBy` -> `Ollama Cloud` and the custom endpoint's host; `stateMessageOf` for
    `no-credential` points Ollama Cloud to its provider setup and the custom endpoint to its key field (3.2);
    `setupProviderOf('ollama-cloud') = 'ollama-cloud'`, custom -> `null`; `endpointFieldError(draft, keyPresent)`
    mirrors Component 3's URL rule and D4 for inline hints (the host stays the authority).
- Verified contracts: `provider-consumer-rows.ts:398-651`.
- Dependencies: Component 1 types.
- Integration points: Component 13.
- Failure behaviour: invalid host shapes parse to `null` ("not read"), as today.
- Quality requirements: fixed sentences; host `detail` stays plain text.
- Verification seam: `decision-model-row.view.spec.ts` (moved cases plus new-kind cases: labels, locality text,
  setup target, input building, field errors).
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.spec.ts`

### 13. Decision row component (frontend)

- Purpose: the editor for the two new kinds, the filtered picker, and the custom key, with signals, OnPush and
  `inject()` as the row already uses (`decision-model-row.component.ts:84-89,395-430`).
- Responsibilities:
  - Ollama Cloud: no key input; help text says the Ollama Cloud provider key is used (direct to ollama.com) or, with no
    key, the signed-in local Ollama, and that chat and routing share the plan; a "Set up Ollama Cloud" action emits
    `setupProviderRequested('ollama-cloud')` (1.1).
  - Custom endpoint: base URL input, model input (free text, no suggestions), key field; inline field errors from
    `endpointFieldError`; Save disabled while a field is invalid; host constants from Component 1 shown by equality
    (DC12, 2.2).
  - New dumb `decision-model-key-field.component.ts` (password input never prefilled, help text, optional remove
    button; inputs `label`, `value`, `disabled`, `showRemove`; outputs `valueChange`, `remove`) used for Jev and
    custom; the row's `jevKey` signal becomes one `apiKey` signal for the active kind; the save sends
    `decisionModelJevApiKey` or `decisionModelCustomApiKey` accordingly; "Remove stored key" sends `''` for that field.
    `keyMayBeStored` uses `status.apiKeyStored` when present.
  - New `decision-model-suggestions.ts`: `loadDecisionSuggestions(kind, providerId, rpc, loader)`; `ollama` and
    `ollama-cloud` call `agent:listDecisionModels`; `structured` keeps `PROVIDER_MODELS_LOADER`; `jev`/`custom` idle.
    The row keeps its "newer request wins" counter (`:660-687`). Help text: `partial` -> "Some models could not be
    checked for decision support, so they are not listed. Type a model name to use one."; `unavailable` -> "Could not
    check decision support. Type a model name." (4.3).
  - No preselection: opening the editor or receiving suggestions never writes `draft.model` (4.5).
- Verified contracts: `decision-model-row.component.ts:57-60,182-300,355-365,396-697`;
  `ClaudeRpcService.call` usage `:509,634`.
- Dependencies: Components 1, 10, 12.
- Integration points: `provider-consumer-assignments.component.ts:495-498` (unchanged).
- Failure behaviour: an RPC failure shows the fixed failed-save sentence; a suggestions failure shows the
  "could not check" text and never blocks saving.
- Quality requirements: accessibility as the existing row (labels, `aria-describedby`, focus return,
  `role="alert"` for attention states); no timer or listener added.
- Verification seam: new `decision-model-row.endpoint.spec.ts` (Ollama Cloud: no key input, setup emit, filtered
  datalist, no preselect; custom: field errors, key field, remove, save params; free text accepted 4.4); the existing
  `decision-model-row.component.spec.ts` keeps passing (selector-level updates only where the key field moved).
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-key-field.component.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-suggestions.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-row.endpoint.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts`

### 14. Live eval spec (lane-routing)

- Purpose: prove, with a key, that clef on Ollama Cloud answers correctly, stably and in time (Requirement 6).
- Responsibilities:
  - `system-one.live.spec.ts`: `describe.skip` unless `PTAH_LIVE_PROBES === '1'` and `OLLAMA_API_KEY` is set (6.2,
    pattern `model-lists.live.spec.ts:30-31`).
  - Catalog (6.3): `DecisionModelCatalog.list('ollama-cloud')` returns at least one model; the model under test
    (`PTAH_LIVE_DECISION_MODEL`, else the first catalog entry) is in it.
  - Model id (6.10): one request with the hosted form and one with the suffixed form; print which are accepted;
    assert the form the product sends (`toCloudId`) is accepted (A1).
  - Probe (A2): `DecisionEndpointProber` endpoint mode against `https://ollama.com` with the key -> `ready`; with a bad
    key -> `auth`; print its duration.
  - Correctness (6.4): `system-one.live.fixtures.ts` holds about 10 routing questions, each one `choice` question
    with one unambiguous expected option, each body checked against `SystemOneRequestBodySchema`; 3 runs; pass only
    when every fixture returns its expected choice in every run.
  - Answer checks (6.5): confidence present and in [0, 1]; probabilities present and summing to 1 within 0.01.
  - Latency (5.1, 6.6): first call is cold; warm p50 and p95 over the remaining calls; printed as one line
    `DECISION_LIVE_LATENCY {"coldMs":..,"p50Ms":..,"p95Ms":..,"probeMs":..}`.
  - Error mapping (6.7): bad key -> cause `auth`; unknown model -> `provider-error` with `notFound: true`; `timeoutMs:
    1` -> `timeout`.
  - The spec calls `SystemOneClient` with a generous timeout (30 s) so latency is measured, not cut. It never prints
    the key or request headers.
- Verified contracts: `system-one.client.ts:67-198`; `system-one.schema.ts:64-100`; Components 6, 8.
- Dependencies: Components 2-8.
- Integration points: Component 15 workflow.
- Failure behaviour: assertion failures name the fixture and run; no retry inside the spec.
- Quality requirements: about 40 calls per run (quota, D1); weekly schedule.
- Verification seam: locally without env the suite is skipped (`npx jest -c libs/backend/lane-routing/jest.config.ts
  libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts --coverage=false --maxWorkers=2` reports
  skipped).
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/decision-model/system-one.live.fixtures.ts`

### 15. Live eval workflow

- Purpose: run Component 14 on demand and weekly, and file one issue on a keyed failure (6.8, 6.9).
- Responsibilities: `.github/workflows/decision-model-live-eval.yml` modelled on `model-lists-probe.yml`:
  - Triggers: `workflow_dispatch` and `schedule` weekly (`'41 5 * * 1'`, clear of 02:00, 03:17 and 04:23). No
    `pull_request`/`push` trigger. Not referenced from `ci.yml`.
  - `permissions: actions: read, contents: read, issues: write`; `concurrency` group without cancel; job
    `timeout-minutes: 20`; env `PTAH_LIVE_PROBES: 1`, `OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}`.
  - A first step checks the secret: when empty it writes `::notice title=Decision model live eval skipped::The
    OLLAMA_API_KEY repository secret is not set.` and sets an output; every later step runs only when the key is
    present, so a missing secret ends green with the notice and no issue.
  - Run: `./node_modules/.bin/nx test @ptah-extension/lane-routing --testPathPatterns system-one.live
    --passWithNoTests=false`, tee to a temp file.
  - Issue step (only `failure() && steps.probe.outcome == 'failure'`): same open-or-update-one-issue script, title
    `[decision-model-live-eval] Decision model live eval failed`. Before posting, if the output file contains the
    key value (`grep -qF`), the body replaces the output with a fixed sentence.
- Verified contracts: `.github/workflows/model-lists-probe.yml` (whole file).
- Dependencies: Component 14 file name.
- Failure behaviour: as above; one issue kept, duplicates closed.
- Quality requirements: no secret in logs or issue bodies.
- Verification seam: YAML lint by review; `rg -n "system-one.live|PTAH_LIVE_PROBES" .github/workflows/ci.yml` returns
  nothing (6.9); the first dispatch after merge.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/.github/workflows/decision-model-live-eval.yml`

### 16. Remote timeout calibration (Requirement 5)

- Purpose: set `DECISION_REQUEST_TIMEOUT_REMOTE_MS` from measurement.
- Responsibilities:
  - After the first keyed run, `test-report.md` records cold, warm p50 and p95 (5.1) and the accepted model id (6.10).
  - Rule: if `p95 <= 3000` and `cold <= 3000`, keep 3000 and record the margin (5.3). Otherwise set
    `REMOTE = min(8000, max(3000, roundUpTo500(max(1.5 x p95, 1.2 x cold))))` and cite the numbers in the batch record
    (5.2). 8000 ms keeps the worst routing call at `GATHER_BUDGET_MS + 2 x (8000 + 250) = 18.5 s`
    (`routing-constants.ts:113-125`). If the formula exceeds 8000, keep 8000, record that cold calls fall back, and
    raise it as a follow-up.
  - The local timeout stays 3000 (5.2).
- Verified contracts: `routing-constants.ts:109-125`.
- Dependencies: Components 7, 14, 15 and a keyed run (A5).
- Failure behaviour: any call over its timeout falls back (5.4, covered in Component 7).
- Verification seam: `routing-constants` value plus the Component 7 timeout spec; `test-report.md` numbers.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/libs/backend/lane-routing/src/lib/routing-constants.ts` (one value, only if 5.2 applies)

### 17. Documentation correction (9.1)

- Purpose: dated correction notes on task 646's "no decision model on Ollama Cloud" statements.
- Responsibilities: once #731 is on `main`, add a dated note citing this task's `context.md` "Ollama Cloud API" under
  `research-decision-models.md:209` and `:545` and beside the rationale at `task-description.md:125-126` of
  `TASK_2026_646_136a`; the original text stays.
- Verified contracts: the three lines exist (read on the 646 branch).
- Failure behaviour: not applicable.
- Verification seam: review of the diff.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/.ptah/specs/TASK_2026_646_136a/research-decision-models.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/.ptah/specs/TASK_2026_646_136a/task-description.md`

## Integration architecture

- Data flow (decision call): MCP `route_decide` -> `RouteDecideService.openCaller` -> `DecisionModelConfig.
  resolveSystemOneTarget` -> resolver reads selection (`IWorkspaceProvider`), overrides, and keys
  (`ISecretStorage`: `ptah.auth.provider.ollama-cloud` or `ptah.laneRouting.customEndpointApiKey` or the Jev slot) ->
  endpoint `{baseUrl, model, apiKey?, timeoutMs}` -> `SystemOneClient.decide` POST `{base}/v1/systemone` -> answer
  validated by `SystemOneResultSchema` -> pipeline (unchanged).
- Data flow (status): webview `agent:getConfig` -> `getStatus` -> resolver -> prober (daemon or endpoint mode) or
  key-presence (Jev) or structured port -> five-state DTO with `apiKeyStored`.
- Data flow (picker): webview `agent:listDecisionModels {source}` -> `DecisionModelCatalogRpcHandlers` ->
  `DecisionModelCatalog.list` -> daemon `/api/tags` + cached `/api/show`, or `ollama.com/api/tags` -> ids + filter
  state -> `<datalist>`.
- Data flow (save): webview `agent:setConfig` -> validation (schema, field errors, DC10) -> `DecisionModelWriter`
  (D4, key-then-selection, rollback) -> `ISecretStorage` + `setConfiguration('ptah', 'agentOrchestration.decisionModel')`
  -> file-based whole-object value (41i).
- State or persistence: selection in `~/.ptah/settings.json` (all hosts, 41i); keys in host secret storage; the
  unsupported mark in global `IStateStorage` (unchanged); catalog caches in memory, bounded, per process.
- External boundaries: ollama.com (`/v1/systemone` with Bearer, `/api/tags` without), the local daemon, any custom
  host. Controls: Zod on every response; base URL rules (no userinfo, query, fragment); D4 transport rule; key bound to
  origin; fixed detail texts; timeouts on every request (probe 1500 ms, catalog 4000 ms, call per locality).
- Failure and rollback: a failed decision call falls back (646 Requirement 4); a failed save leaves selection and key
  as before or reports "key may have changed"; a failed catalog leaves free text usable.
- Observability: lane-routing warn logs with cause and error name only (existing `[lane-routing]` prefix); the row
  detail shows fixed text; the workflow issue records live failures.

## Architecture-level quality requirements

- Functional: every criterion in the traceability table below has a named spec or step.
- Performance: one decision request is bounded by its locality timeout; the catalog by 4000 ms and at most one
  `/api/show` per model per 10 min; no new timer, poll or listener in the webview.
- Security: keys only in secret storage, write-only over RPC, never logged or echoed (sentinel specs in lane-routing
  and rpc-handlers); a key is sent only to its own origin and only over https or loopback; `settings:set` still refuses
  the selection key.
- Maintainability: lane-routing imports stay `platform-core` + `shared`; no new `vscode-core` consumer; files split
  rather than grown (`decision-model.config.ts` shrinks or stays near 741; `agent-rpc.handlers.ts` and
  `provider-consumer-rows.ts` shrink; the row grows by less than it sheds).
- Testability: unit specs per new module with fake fetch and in-memory ports; one provider-level persistence spec;
  a gated live spec.

## Acceptance criteria traceability

| # | Component / file | Proof |
| --- | --- | --- |
| 1.1 | C12 `decision-model-row.view.ts`, C13 row | `decision-model-row.endpoint.spec.ts`: option present, no key input, setup emits `ollama-cloud` |
| 1.2 | C5 `decision-model.target.ts`, C7 client | `decision-model.target.spec.ts` (URL + header, with and without override); `system-one.client.spec.ts` header case |
| 1.3 | C5 | `decision-model.target.spec.ts`: no key -> daemon URL, no header, `clef:27b-cloud` |
| 1.4 | C4, C5 (per-call reads) | `decision-model.target.spec.ts` and `decision-model.config.endpoint.spec.ts`: key added/removed between two calls/probes |
| 1.5 | C5 locality (DC7) | `decision-model.target.spec.ts`: `-cloud` model on loopback -> `remote`; `ollama-cloud` both paths `remote` |
| 1.6 | C4, C6, C9 | sentinel-key searches in `decision-model.keys.spec.ts`, `decision-model.config.endpoint.spec.ts`, `agent-rpc.handlers.decision-endpoint.spec.ts`; C3 forbids keys in URLs |
| 2.1 | C3, C9, C12, C13 | `decision-model.types.spec.ts`; `decision-model-row.endpoint.spec.ts` save params; existing Jev/Ollama specs unchanged |
| 2.2 | C3, C9 (D4) | `decision-endpoint.url.spec.ts`; `agent-rpc.handlers.decision-endpoint.spec.ts` field errors, previous selection kept |
| 2.3 | C3 `systemOneUrl`, C5, C7 | `decision-model.target.spec.ts` origin binding; `system-one.client.spec.ts` path join and header |
| 2.4 | C1, C4, C9 | `agent-rpc.handlers.decision-endpoint.spec.ts`: `apiKeyStored` only, `''` deletes, secret storage only |
| 2.5 | C9 writer | `agent-rpc.handlers.decision-model.spec.ts` rollback cases `describe.each` over both key fields |
| 2.6 | C5 | `decision-model.target.spec.ts` locality table |
| 2.7 | C11, C4 | `file-settings-manager.spec.ts` round-trip; `decision-model.config.endpoint.spec.ts` fresh config reports `apiKeyStored` |
| 3.1 | C6 prober | `decision-model.prober.spec.ts`: no `/api/version` in endpoint mode; daemon keeps the floor |
| 3.2 | C6, C12 | `decision-model.config.endpoint.spec.ts` 401/403 -> `no-credential`; view spec setup target / key-field message |
| 3.3 | C6 | config endpoint spec: transport failure and budget expiry -> `unreachable` |
| 3.4 | C6 | config endpoint spec: control match -> `unsupported-endpoint`, state set unchanged |
| 3.5 | C6 | config endpoint spec: valid key + route -> `ready` |
| 4.1 | C8 cloud fetch (DC4), C13 | `decision-model.catalog.spec.ts` cloud filter; endpoint row spec datalist |
| 4.2 | C8 | catalog spec: at most one `/api/show` per model within TTL |
| 4.3 | C8, C13 | catalog spec undetermined -> not listed, `partial`; row spec help text |
| 4.4 | C13 | row spec: unlisted typed id saves; status reports its state |
| 4.5 | C8 (no write path), C13 | row spec: no preselect; `decision-model.config.spec.ts` fresh profile reads `unset` (add the case if absent) |
| 4.6 | C8 | catalog spec with a fixture lacking clef; code review: no model list literal |
| 5.1 | C14, C16 | `DECISION_LIVE_LATENCY` line; `test-report.md` entry |
| 5.2 | C16, C7 | batch record cites numbers; timeout spec |
| 5.3 | C16 | `test-report.md` margin |
| 5.4 | C7 | timeout fallback spec |
| 6.1 | all | every spec above; existing decision-model specs pass |
| 6.2 | C14 | skip gate in the spec |
| 6.3 | C14 | catalog live case |
| 6.4 | C14 | 3-run fixture loop |
| 6.5 | C14 | answer checks, tolerance 0.01 |
| 6.6 | C14 | latency print |
| 6.7 | C14 | error-mapping live cases |
| 6.8 | C15 | workflow notice step and issue step |
| 6.9 | C15 | no PR trigger; `ci.yml` search empty |
| 6.10 | C14, C16 | id-form live case; `test-report.md` entry |
| 7.1 | C11 (DC2) | no new key; 41i spec keeps the key file-based |
| 7.2 | C11 | provider-level round-trip spec |
| 7.3 | C4 | `decision-model.keys.spec.ts` literal slot; host evidence rows 18-20 |
| 8.1 | user | user selects Ollama Cloud -> clef; row shows `ready` and `remote` |
| 8.2 | user / orchestrator | one `/orchestrate` pre-flight with decision-model provenance, recorded in `test-report.md` |
| 8.3 | user | user adds `OLLAMA_API_KEY` repository secret |
| 9.1 | C17 | dated notes in the two 646 files |

## Blast radius

- Libraries changed: `lane-routing` (most), `rpc-handlers`, `shared`, `auth-providers` (import move only),
  `platform-core` (spec only), `frontend/chat`, three apps (guard constants and smoke specs only), one workflow.
- Behaviour changes for existing users: an `ollama` selection with a cloud-tag model now reads `remote`; nothing else
  changes for `unset`, `ollama`, `jev`, `structured`.
- Public exports changed: lane-routing adds the catalog token, catalog types and `DecisionKeySlot`;
  `DecisionModelConfig` loses the three Jev key methods (only rpc-handlers uses them); auth-providers stops exporting
  `isCloudTag`/`toCloudId` (no importer); shared adds them.
- Not touched: the structured kind and its adapter, chat's Ollama strategies and caches, the payload builder, the
  646 question and request budgets, `ci.yml`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Direct API rejects `clef:27b-cloud` (A1) | MEDIUM | MEDIUM | 6.10 live case; one-function fix on the direct path |
| Keyed probe `{}` spends quota or answers 401 for a valid key (A2) | LOW | MEDIUM | Live probe case; if so, endpoint-mode status falls back to key presence like Jev (one branch in C6) |
| clef answers carry extra fields, so the strict schema rejects them (A4) | LOW | HIGH | Live spec catches it; the fix would relax `.strict()` on the answer object only |
| The keyed run cannot happen before merge (A5) | HIGH | MEDIUM | Ship remote timeout at 3000 (5.3 path); calibrate in a follow-up batch after the user runs the spec locally or dispatches after merge |
| Large shared files collide with other open work (`agent-rpc.handlers.ts`, `rpc.types.ts`) | MEDIUM | LOW | Extraction first; registry edits are two lines |
| Webview e2e harness does not mock `agent:listDecisionModels` | MEDIUM | LOW | The call happens only when the editor opens on an Ollama kind; team-leader checks the settings scenarios at review (no e2e run without the user's ask) |
| Cold Ollama Cloud latency exceeds 8000 ms | LOW | MEDIUM | Fallback absorbs it; recorded as a follow-up |
| Merge of `origin/main` after #731 moves the cited lines | HIGH | LOW | Re-verify cited lines at the start of each batch |

## Team-leader handoff

- Recommended executors:
  - Components 1, 2: backend-developer (shared types and a pure-function move).
  - Components 3-8: backend-developer (lane-routing domain, ports, Zod).
  - Components 9-10: backend-developer (RPC handlers, DI guards).
  - Component 11: senior-tester (spec-only persistence proof).
  - Components 12-13: frontend-developer (Angular signals, OnPush).
  - Component 14: senior-tester (live eval design and fixtures).
  - Component 15: devops-engineer (workflow).
  - Component 16: senior-tester records numbers, backend-developer changes the constant.
  - Component 17: backend-developer or the orchestrator (docs only).
- Complexity: HIGH. Three hosts, a credential crossing a library boundary, a rollback-sensitive write path, a new
  RPC, and an external dependency that has not been called with a key yet.
- Dependencies and ordering (component level):
  - Gate 0: merge `origin/main` after #731 and 41i; re-verify cited lines.
  - 2 before 3, 5, 8 (`isCloudTag`/`toCloudId` in shared). 1 before 9, 10, 12.
  - 3 -> 4 -> 5 -> 6 and 7 (6 and 7 both after 5; 6 and 5 share `decision-model.config.ts`, so 4, 5, 6 are
    sequential on that file).
  - 8 after 5 (uses config base URL); 8 touches `di/*` and `index.ts`, so any `index.ts` export of `DecisionKeySlot`
    from 4 lands before 8 or within 8.
  - 9 after 4 (slot API) and 3 (schema); 10 after 8 and 1.
  - 12 after 1; 13 after 10 (typed registry entry) and 12.
  - 14 after 6, 7, 8. 15 any time after the spec file name is fixed. 16 after a keyed run. 17 after #731 is on `main`.
- Parallel-safe work: 11 with anything; 1 with 2 (different files in shared: `types/rpc/*` vs `providers/*`); 7 with
  6 once 5 is done (disjoint files); 12 with 3-9; 15 with 14.
- Files affected:
  - CREATE: `libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts`;
    `libs/shared/src/lib/providers/ollama-cloud-model-id.ts` (+ spec);
    lane-routing `decision-model/decision-endpoint.url.ts` (+ spec), `decision-model.types.spec.ts`,
    `decision-model.keys.ts` (+ spec), `decision-model.target.ts` (+ spec), `decision-model.prober.ts` (+ spec),
    `decision-model.config.endpoint.spec.ts`, `decision-model.catalog.ts` (+ spec), `ollama-catalog.schema.ts`,
    `system-one.live.spec.ts`, `system-one.live.fixtures.ts`; rpc-handlers `handlers/decision-model-writer.ts`,
    `handlers/agent-rpc.handlers.decision-endpoint.spec.ts`, `handlers/decision-model-catalog-rpc.handlers.ts`
    (+ spec); chat `decision-model-row.view.ts` (+ spec), `decision-model-key-field.component.ts`,
    `decision-model-suggestions.ts`, `decision-model-row.endpoint.spec.ts`;
    `.github/workflows/decision-model-live-eval.yml`. All under
    `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/`.
  - MODIFY: shared `rpc-agents.types.ts`, `rpc.types.ts`, `providers/index.ts`; auth-providers
    `ollama-cloud-metadata.service.ts`, `ollama-model-discovery.service.ts`, `providers/local/index.ts`; lane-routing
    `decision-model.types.ts`, `decision-model.config.ts`, `decision-model.config.spec.ts`, `decision-model.probe.ts`,
    `decision-model.detail.ts`, `system-one.client.ts` (+ spec), `pipeline/model-refine.ts`, `pipeline/model-call.spec.ts`,
    `routing-constants.ts`, `route-decide.service.ts`, `route-decide.preflight.spec.ts`, `route-decide.gate.spec.ts`,
    `failure-class/decision-model-failure-classifier.ts` (+ spec), `di/tokens.ts`, `di/register.ts` (+ spec),
    `index.ts`; rpc-handlers `agent-rpc.handlers.ts`, its five mocking specs, `agent-rpc.handlers.decision-model.spec.ts`,
    `handlers/index.ts`, `src/index.ts`, `host-profile/manifest.ts`, `register-shared-rpc-handlers.ts`; platform-core
    `file-settings-manager.spec.ts`; chat `provider-consumer-rows.ts` (+ spec), `decision-model-row.component.ts`
    (+ spec); apps `expected-resolvable.ts` and `container.smoke.spec.ts` in vscode, electron, cli; task 646
    `research-decision-models.md`, `task-description.md`.
  - DELETE: `libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.cloud-id.spec.ts` (moved).
- Verification points (memory-safe, one heavy check at a time, CLAUDE.md):
  - Per batch: `npx nx test <project> --parallel=1`, `npx nx typecheck <project>`, `npx nx lint <project>` for the
    changed project only; for several projects `npx nx run-many -t test -p A B --parallel=1` and confirm the header
    count. Projects: `@ptah-extension/shared`, `@ptah-extension/auth-providers`, `@ptah-extension/lane-routing`,
    `@ptah-extension/rpc-handlers`, `@ptah-extension/platform-core`, the chat frontend project, and the three app
    projects for the smoke specs.
  - Contracts to confirm at batch start: every `file:line` in "Codebase evidence" after the Gate 0 merge;
    `PROVIDER_KEY_SECRET_PREFIX` export; `assertManifestInvariants`; di-lint on push (pre-push hook).
  - Searches: no `vscode-core` import under `libs/backend/lane-routing/src`; no model-name literal in
    `decision-model.catalog.ts`; `ci.yml` has no `system-one.live` or `PTAH_LIVE_PROBES`.
  - Data: no migration (selection shape is additive; secret slot is new).
  - User-run: 8.1-8.3, the keyed live run feeding Component 16.

## Needs the user

- One keyed live run is needed before Requirement 5 and 6.10 can close, and no agent may handle the key (8.3).
  Options: (a) the user runs the live spec once locally with `PTAH_LIVE_PROBES=1` and `OLLAMA_API_KEY` set and shares
  the printed `DECISION_LIVE_LATENCY` line and id-form result (Recommended: closes the task in one PR); (b) merge first,
  add the secret, dispatch the workflow, then a follow-up batch sets the remote timeout. The plan supports both; only
  the timing of Component 16 differs.
