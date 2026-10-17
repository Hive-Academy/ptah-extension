# TASK_2026_684_a11d - context

Follow-up to TASK_2026_646_136a (decision-model routing, PR #731). This task depends on #731. The
decision-model code is on branch `feat/decision-model-routing` (worktree
`.claude-worktrees/decision-model-routing`) until #731 merges. Before any code change in this
worktree, merge `origin/main` after #731 is merged.

## User request (2026-10-16, verbatim)

> a follow up for this task is that i want to set our decision model to one from ollama cloud we
> have a subscription for its already included in our providers list
> https://ollama.com/library/clef:27b-cloud and make evals and tests to make sure everythign works
> as expected , also we will need to make sure users can bring their own providers whether its jev
> or anyone also ollama model filters decision models so we can do so as well

## User decisions (final)

| # | Decision |
| --- | --- |
| D1 | The decision model reuses the existing `ollama-cloud` provider key (`ptah.auth.provider.ollama-cloud`). No separate decision key slot for Ollama Cloud. Chat and routing share the subscription quota. |
| D2 | Bring-your-own provider: one generic "custom `/v1/systemone` endpoint" kind (base URL + API key in secret storage + model) that works for Jev, local Ollama, Ollama Cloud and any compatible host. The named Jev and Ollama presets stay for easy setup. |
| D4 | (Orchestrator default, user may override) A custom endpoint with an API key must use `https`, except on a loopback host; the save is refused otherwise. Without a key, `http` is allowed (e.g. a LAN Ollama host). Answers task-description criterion 2.2 open question, option (a). |
| D3 | Offer only: users see decision-capable models in a filtered picker and choose. No auto-select and no default to clef. We set clef in our own settings (keep `skillSynthesis.enabled=false`). |

## Research findings (researcher-expert, session 11 of task 646; read-only)

### Current decision-model kinds (branch feat/decision-model-routing)

- Kinds: `unset | ollama{model} | jev{model='jev-1.13.0'} | structured{providerId,model}`
  (`libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:10-28`). Selection in
  settings `ptah`/`agentOrchestration.decisionModel`; Jev key in secret storage
  `ptah.laneRouting.jevApiKey` (`:98-102`).
- `ollama`: `POST {provider.ollama.baseUrl}/v1/systemone`, default `http://127.0.0.1:11434`
  (`decision-model.config.ts:212-239`). No API key is sent (`resolveSystemOneTarget` returns
  `{baseUrl, model}` only, `:214-216`). Status probe: `GET /api/version` (>= 0.35.0; 0.40.0 for
  `laya*`), then `POST /v1/systemone {}` control comparison (`probe.ts:46-136`,
  `config.ts:547-576`). A cloud URL without a daemon fails the `/api/version` step.
- `jev`: same wire call to fixed `https://api.typesafe.ai` with `Authorization: Bearer <key>`
  (`config.ts:217-222`, `types.ts:105`). No custom base URL.
- `structured`: not systemone. `StructuredDecisionAdapter` runs an Agent-SDK query with
  `outputFormat: json_schema`, tools off
  (`libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts:128-139`);
  credentials via `IProviderAuthResolver.resolve(providerId)`; `confidence: null`.
- `SystemOneClient`: 3 s timeout, 64 KiB request cap, one POST, no retries, sends
  `{model, state, questions}` with `choice` questions only (`system-one.client.ts:12,106-111`,
  `system-one.schema.ts`). No `images`, `keep_alive`, `noul`, `score`.
- Picker: free-text input + `<datalist>` from `PROVIDER_MODELS_LOADER.listModels('ollama')`
  (`decision-model-row.component.ts:672,694-695`). `ProviderModelInfo` has optional capabilities,
  but there is no decision filter.
- RPC: `agent:setConfig` takes `decisionModel` + write-only `decisionModelJevApiKey`
  (`rpc-agents.types.ts:356-362`); `writeDecisionModel` (`agent-rpc.handlers.ts:856-909`).

### The "Ollama Cloud" provider

- `OLLAMA_CLOUD_PROVIDER_ENTRY` id `ollama-cloud`, `supportsOptionalApiKey: true`
  (`libs/shared/src/lib/providers/entries/local-provider-entry.ts:114-138`);
  `OLLAMA_CLOUD_DIRECT_BASE_URL = 'https://ollama.com'` (`:17`).
- Key: `ptah.auth.provider.ollama-cloud`, read via `authSecrets.getProviderKey('ollama-cloud')`
  (`local-native.strategy.ts:76-79`, `provider-key-slots.ts`). Key present: direct mode at
  ollama.com. No key: local daemon (`ollama signin`) proxy. `provider.ollama-cloud.baseUrl`
  override wins.
- Reuse in lane-routing needs a secrets port or an injected resolver (like `STRUCTURED_DECISION`);
  `IAuthSecretsService` lives in vscode-core.

### Ollama Cloud API (probed without a key)

- Direct API: `https://ollama.com`, `Authorization: Bearer <key>` (https://docs.ollama.com/cloud).
- `POST https://ollama.com/v1/systemone {}` returns 401 `{"error":"Unauthorized"}`; an unknown
  `/v1/` path returns 404. So the route exists and is key-gated. A successful keyed call is not
  verified yet.
- `GET https://ollama.com/api/tags` is public; each entry has `capabilities`. Only `clef:27b` has
  `"decision"` (`["decision","vision"]`). Hosted ids have no `-cloud` suffix; the local daemon
  uses `clef:27b-cloud`. `POST https://ollama.com/api/show {"model":"clef:27b"}` works without a
  key (`capabilities:["decision","vision"]`, context 65536); `clef:27b-cloud` is an alias.
- `CapabilityDecision = "decision"` in ollama `types/model/capability.go`.
- TypeSafe `/v1/systemone` (https://docs.typesafe.ai/introduction/quickstart) and Ollama's clef
  use the same wire shape; the existing Zod schema serves both. Differences: base URL, auth
  header, model id.
- clef model page: 27B, vision + decision, 64K context, question types `choice` (2-26),
  `noul` (probability), `score` (2-26 levels); requires Ollama >= 0.35.1; median ~209 ms.

### Gaps

1. No arbitrary Bearer-authenticated `/v1/systemone` endpoint (D2).
2. `ollama` sends no key; cannot reach ollama.com direct mode (D1).
3. Probe always runs the Ollama `/api/version` check; must be skipped for non-Ollama hosts.
4. Picker has no decision filter; `OllamaCloudMetadataService.fetchCloudTags` drops capabilities.
   Local daemon needs `/api/show` per model (cached, as `OllamaModelDiscoveryService` does).
5. 3 s client timeout may be tight for cloud cold start.

### Tests and evals

- Unit specs exist: `system-one.client.spec.ts` (18 cases), `decision-model.config.spec.ts`,
  `decision-payload.spec.ts`, `model-call.spec.ts`, `decision-model-failure-classifier.spec.ts`,
  `agent-rpc.handlers.decision-model.spec.ts`.
- Live pattern to copy: `libs/backend/auth-providers/src/lib/model-lists.live.spec.ts`
  (`describe.skip` unless `PTAH_LIVE_PROBES=1`), run by `.github/workflows/model-lists-probe.yml`
  (schedule + `workflow_dispatch`, files an issue on failure). `tools/mcp-bench` is not a routing
  eval.
- Proposed `system-one.live.spec.ts` in lane-routing, gated by `PTAH_LIVE_PROBES=1` and
  `OLLAMA_API_KEY`: catalog check (`decision` capability present), ~10 routing questions with
  unambiguous expected `choice`, confidence in [0,1], probabilities sum ~1, 3 runs for stability,
  p50/p95 latency vs timeout, error mapping (bad key -> auth, unknown model -> provider-error
  notFound, tiny timeout -> timeout). Never in `ci.yml`. Needs a repo secret `OLLAMA_API_KEY`
  (the user adds it).

### Risks and open points

- First keyed call decides whether the hosted id is `clef:27b` or `clef:27b-cloud`.
- task 646 research (`research-decision-models.md:209,545`) said no decision model exists on
  Ollama Cloud; that is now false (`task-description.md:125-126,662` of task 646).
- Privacy: routing text, lane roster and outcome counts go to a third party; the row shows
  `remote` for non-loopback hosts. Accepted by the user's request (D3 keeps it opt-in).
- Quota: an Ollama Cloud plan is shared by chat and routing (D1); Glm hit a 429 earlier
  (task 646 decisions.md #63).
