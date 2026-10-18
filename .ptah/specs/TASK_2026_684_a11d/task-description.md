# Requirements - TASK_2026_684_a11d

## Context

TASK_2026_646_136a (PR #731, branch `feat/decision-model-routing`, not on `main` yet) added an optional decision model
to Settings → Agent Orchestration → Background Model Roles. It offers four kinds: `unset`, `ollama{model}`,
`jev{model}` and `structured{providerId,model}` (`libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:10-28`).
`ollama` posts to `{provider.ollama.baseUrl}/v1/systemone` with no API key (`decision-model.config.ts:212-216`), and its
status probe needs Ollama's `GET /api/version` (`decision-model.probe.ts`, context.md "Current decision-model kinds"),
so a cloud host without a daemon fails the probe. `jev` uses a fixed base URL, `https://api.typesafe.ai`
(`decision-model.types.ts:105`). The client has a 3000 ms timeout, sends one POST and does not retry
(`system-one.client.ts:12`). The model picker is free text plus a list of every local Ollama model, with no
decision-capability filter (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:672,694-695`).

The user wants three things. First, our own decision model set to clef on the Ollama Cloud subscription that is
already in the providers list (`OLLAMA_CLOUD_PROVIDER_ENTRY`, `libs/shared/src/lib/providers/entries/local-provider-entry.ts:114-138`).
Second, users can bring their own decision provider (Jev or any other). Third, the picker lists only decision models,
the way Ollama does. The user also wants evals and tests that prove the setup works. The user's final decisions are in
context.md D1-D3 and are not reopened here. D1: reuse the `ollama-cloud` provider key. D2: one generic custom
`/v1/systemone` endpoint, with the Jev and Ollama presets kept. D3: offer only, with no auto-select and no default.

Research (context.md "Ollama Cloud API") found that `POST https://ollama.com/v1/systemone` exists and requires a key
(it answers 401 without one). `GET https://ollama.com/api/tags` is public and lists `capabilities`. Only `clef:27b`
carries `"decision"`. Through a local daemon the same model is `clef:27b-cloud`. No call with a key has been made yet.
No existing capability is removed: the Jev, Ollama and structured kinds stay, and free-text model entry stays. This
task therefore needs no `parity-inventory.md`.

## Classification

- Type: FEATURE. It adds new decision-model targets, a new endpoint kind, a picker filter and a live eval.
- Estimate: L. The work spans lane-routing (target resolution, probe, client timeout), credential access across a
  library boundary (the `ollama-cloud` key lives behind `IAuthSecretsService` in vscode-core, context.md), the RPC
  contract and its key handling, the Angular row, auth-providers metadata (capabilities), and a new live spec plus
  workflow. All of this runs on three hosts.
- Priority: not defined here.

## Scope

In scope:

- Ollama Cloud as a decision-model target that uses the existing `ollama-cloud` key: direct to `https://ollama.com`
  when a key exists, and through the local daemon otherwise (D1).
- A generic custom `/v1/systemone` endpoint kind: base URL, an API key in secret storage, and a model (D2). The Jev and
  Ollama presets stay.
- A probe and status for hosts that are not an Ollama daemon, and mapping a 401 to the existing `no-credential` state.
- A decision-capability filter in the picker for Ollama local and Ollama Cloud, with free text kept (D3).
- Unit specs for every new path; a gated live eval spec; a scheduled/dispatch workflow.
- A decision on the client timeout for cloud targets, based on live-eval evidence.
- A user-run acceptance step: set our decision model to clef on Ollama Cloud.
- A documentation correction of task 646's "no decision model on Ollama Cloud" statement.

Out of scope:

- A separate decision-key slot for Ollama Cloud (D1 rejected it).
- Auto-selecting a decision model or defaulting to clef (D3 rejected it).
- The `noul` and `score` question types, image input and `keep_alive`. The client sends `choice` questions only
  (`system-one.schema.ts`); extending it is a separate task.
- Changes to the `structured` kind and its adapter.
- Retries, or quota management for the shared Ollama Cloud plan. 646 Requirement 4 already falls back when a call fails
  or is rate-limited.
- Running the live eval in `ci.yml` or on pull requests. It needs a paid key and network access.
- Capability filtering for custom endpoints and Jev. A generic host has no agreed capability API, so its model stays
  free text.
- Turning on `skillSynthesis.enabled`. It stays `false` in our settings (D3).

## Requirements

### 1. Ollama Cloud as a decision-model target

Requirement: the routing pipeline can use an Ollama Cloud decision model with the subscription key the user already
entered for the Ollama Cloud chat provider. Chat and routing share that quota (D1).

Acceptance criteria:

1.1. When the user opens the Decision model row, the system shall offer an Ollama Cloud choice beside unset, Ollama,
     Jev, custom endpoint and structured. The row shall have no API-key input for this choice. It shall point to the
     existing Ollama Cloud provider setup (the set-up-provider deep link of 646 criterion 1.5).
1.2. When an `ollama-cloud` key is stored, a decision call shall go to `https://ollama.com/v1/systemone` with
     `Authorization: Bearer <key>`. A `provider.ollama-cloud.baseUrl` override, when set, shall replace that base URL.
     A unit spec asserts the URL and the header for both cases.
1.3. When no `ollama-cloud` key is stored, a decision call shall go to the local daemon's `/v1/systemone` with no
     Authorization header, using the daemon model id (for example `clef:27b-cloud`). A unit spec covers this path.
1.4. When the user changes or removes the `ollama-cloud` key in the Providers settings, the next decision call and the
     next status probe shall use the new state, with no step in the Decision model row.
1.5. When the target is Ollama Cloud, through either path, the row shall show `remote`. A cloud model reached through
     a loopback daemon still sends data off the machine. Today the locality check reports such a model as `local`
     (`decision-model.config.ts:248-249`). A unit spec asserts `remote` for a `-cloud` model on a loopback base URL.
1.6. When the Ollama Cloud key, or the custom-endpoint key of Requirement 2, is used, the key shall never appear in a
     log line, an RPC response, a status `detail`, an error message or a settings file. A unit spec asserts this by
     searching the captured logs and DTOs for a sentinel key.

### 2. Bring-your-own `/v1/systemone` endpoint

Requirement: a user can point the decision model at any host that serves the System One wire shape (Jev, local
Ollama, Ollama Cloud, or another compatible host) by giving a base URL, an optional API key and a model (D2).

Acceptance criteria:

2.1. When the user chooses the custom endpoint, the row shall accept a base URL, an API key and a model id, and save
     them. The Jev and Ollama presets shall stay and behave as before.
2.2. When the user saves an invalid base URL (not absolute, or not `http`/`https`) or an empty model, the system shall
     reject the save, name the invalid field, and keep the previous selection.
2.3. When the custom endpoint has a key, each decision call to it shall carry `Authorization: Bearer <key>` and go to
     `{baseUrl}/v1/systemone`, and nowhere else. When it has no key, the call shall have no Authorization header.
2.4. The custom-endpoint key shall travel write-only over `agent:setConfig`, like `decisionModelJevApiKey`
     (`rpc-agents.types.ts:356-362`): `agent:getConfig` never returns it and shows at most whether a key is stored.
     An empty string deletes it. The key is stored only in secret storage.
2.5. When a save writes a new custom-endpoint key and the selection write then fails, the system shall follow the
     `writeDecisionModel` rules (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:856-909`). It
     restores the previous key, reports success if the selection was stored before the rejection, and reports
     "key may have changed" if the restore also fails. The existing rollback specs shall gain equivalent cases for
     this key.
2.6. When the base URL is not loopback, the row shall show `remote`. When it is loopback, it shall show `local`
     (646 criterion 1.4).
2.7. When the user saves a custom endpoint and restarts the application, the base URL, the model and the stored-key
     indicator shall come back, in VS Code, Electron and CLI.

### 3. Status probe for hosts that are not a daemon

Requirement: the status row reports a correct state for Ollama Cloud and custom endpoints without asking for an
Ollama daemon version.

Acceptance criteria:

3.1. When the target is Ollama Cloud direct, or a custom endpoint, the probe shall not call `/api/version`, and it
     shall not mark the endpoint `unsupported-endpoint` because a version is missing. The local Ollama and daemon paths
     keep the version check (>= 0.35.0; 0.40.0 for `laya*`).
3.2. When the endpoint answers 401 or 403, the row shall show `no-credential` and offer the provider-setup link
     (Ollama Cloud) or the key field (custom endpoint).
3.3. When the endpoint cannot be reached, or the probe times out, the row shall show `unreachable`.
3.4. When the endpoint does not serve `/v1/systemone` (by the existing control-path comparison), the row shall show
     `unsupported-endpoint`. The row state set stays the five states of decision #46
     (`decision-model.types.ts:45-46`).
3.5. When the key and the endpoint are valid, the row shall show `ready`. Unit specs cover 3.1-3.5 with a fake fetch.

### 4. Decision-capability filter in the picker (offer only)

Requirement: when the user opens the model picker for Ollama local or Ollama Cloud, it lists only models whose host
reports the `decision` capability. The user still chooses (D3).

Acceptance criteria:

4.1. When the target is Ollama Cloud, the picker shall list the models whose `capabilities` from `/api/tags` include
     `decision`, and no others. The cloud tag fetch shall keep `capabilities` (today `fetchCloudTags` drops them,
     context.md Gap 4).
4.2. When the target is local Ollama, the picker shall list the local models whose `/api/show` capabilities include
     `decision`. Each model's capability answer shall be cached, so the picker does not send one `/api/show` per model
     every time it opens. A unit spec asserts at most one lookup per model while the cache is valid.
4.3. When a model's capabilities cannot be determined (the lookup fails, or an older Ollama returns no capabilities
     field), the picker shall not show that model as decision-capable, and it shall say that the filter could not be
     applied.
4.4. When the user types a model id that is not in the filtered list, the system shall accept it (free text, 646
     criterion 1.2). The status row then reports the model's real state.
4.5. When the picker opens, no model shall be preselected. When the user has not chosen, the selection stays as it
     was (`unset` for a new user). No path sets clef by default. A spec asserts a fresh profile reads `unset`.
4.6. No model name shall be fixed in code as the decision list. The list comes from the host.

### 5. Client timeout for cloud targets

Requirement: the client timeout fits cloud latency, and the timeout chosen is backed by measurement.

Acceptance criteria:

5.1. When the live eval (Requirement 6) has run against clef on Ollama Cloud, `test-report.md` shall record the p50
     and p95 latency of the warm calls and the latency of the first (cold) call.
5.2. When the recorded p95 or the cold-call latency is above the current 3000 ms timeout (`system-one.client.ts:12`),
     the system shall use a longer timeout for remote targets. Its value shall be derived from the recorded numbers and
     cited in `implementation-plan.md` or the batch record. The local Ollama timeout stays at 3000 ms.
5.3. When both values are at or below 3000 ms, the timeout shall stay 3000 ms for all targets, and `test-report.md`
     shall record the margin.
5.4. When a call exceeds whichever timeout applies, the system shall fall back as 646 Requirement 4.1 states, and the
     routing call shall not block.

### 6. Evals and tests

Requirement: maintainers can prove, with a key and on demand or on a schedule, that clef on Ollama Cloud returns
correct, stable and timely routing answers. Every new path also has unit coverage.

Acceptance criteria:

6.1. Every criterion in Requirements 1-4 shall have at least one unit spec in the library that owns the behaviour. The
     existing decision-model specs (`system-one.client.spec.ts`, `decision-model.config.spec.ts`,
     `agent-rpc.handlers.decision-model.spec.ts` and the others in context.md "Tests and evals") shall still pass.
6.2. A live spec shall exist in lane-routing. It is skipped unless `PTAH_LIVE_PROBES=1` and `OLLAMA_API_KEY` are both
     set, following `libs/backend/auth-providers/src/lib/model-lists.live.spec.ts`.
6.3. When the live spec runs, it shall check that the cloud catalog lists at least one model with the `decision`
     capability, and that the model under test is one of them.
6.4. When the live spec runs, it shall send a fixed set of about 10 routing questions, each with one unambiguous
     expected `choice`. It shall pass only when every question returns its expected choice in each of 3 repeated runs.
     A miss is either an ambiguous fixture (fix the fixture) or a broken path (fix the code). No threshold is lowered.
6.5. For every answer, the live spec shall check that the confidence is in [0, 1] and that the option probabilities
     sum to 1 within a tolerance stated in the spec.
6.6. The live spec shall measure and print the cold-call latency and the warm p50 and p95 that Requirement 5 needs.
6.7. The live spec shall check error mapping: a bad key returns cause `auth`; an unknown model returns cause
     `provider-error` with `notFound` true; a timeout far below the measured latency returns cause `timeout`.
6.8. A workflow shall run the live spec on `workflow_dispatch` and on a schedule, modelled on
     `.github/workflows/model-lists-probe.yml`. A failed run with the key set shall open or update one issue. When the
     `OLLAMA_API_KEY` repository secret is missing, the job shall end with a notice that names the missing secret, and
     it shall open no issue.
6.9. The live spec and the workflow shall not appear in `ci.yml` or in any pull-request trigger.
6.10. The first successful run with a key shall record in `test-report.md` which hosted model id the direct API accepts
      (`clef:27b` or `clef:27b-cloud`, context.md "Risks and open points").

### 7. Hosts and persistence

Requirement: the new kinds and the filter behave the same in VS Code, Electron and CLI.

Acceptance criteria:

7.1. When a new setting key is introduced (for example the custom endpoint's base URL or model, if they are stored
     outside the existing `agentOrchestration.decisionModel` value), it shall be listed in `FILE_BASED_SETTINGS_KEYS`
     (`libs/backend/platform-core/src/file-settings-keys.ts`). A `platform-core` spec asserts `isFileBasedSettingKey`
     for it. Reason: VS Code refuses keys that are not registered (task 646 Batch 41i, `batches.md:2235-2261`).
7.2. When each of the three hosts saves a selection of each new kind and restarts, the selection shall come back
     (646 criterion 1.6). At least one check shall run in a real VS Code host, or a provider-level spec shall prove it.
     Batch 41i was missed because the specs mocked `setConfiguration`.
7.3. In each host, the Ollama Cloud target shall read the same `ollama-cloud` key slot that the chat provider uses
     (`ptah.auth.provider.ollama-cloud`).

### 8. Our own setup (user-run)

Requirement: after the feature ships, our Ptah installation routes with clef on Ollama Cloud.

Acceptance criteria:

8.1. When the feature is merged and released to the user's build, the user (not an agent or a script) shall select
     Ollama Cloud → clef in the Decision model row, using the user's existing Ollama Cloud key. The row shall then show
     `ready` and `remote`.
8.2. When that is set, one `/orchestrate` Pre-flight shall return a result whose source is the decision model, not
     the fallback. `skillSynthesis.enabled` stays `false`. The user records the outcome in `test-report.md`, or tells
     the orchestrator, who records it.
8.3. The user adds the `OLLAMA_API_KEY` repository secret for Requirement 6.8. This is a user-run step, and no agent
     handles the key.

### 9. Documentation correction

Acceptance criteria:

9.1. Task 646's statements that Ollama Cloud serves no decision model (`research-decision-models.md:209,545` and the
     rationale in `task-description.md` criterion 1.2) shall each carry a dated correction note that cites this task's
     research. The original text is left in place. This is done once #731 is on `main`.

## Non-functional requirements

- Security and privacy: keys follow 646's rule. They live in secret storage, are write-only over RPC, and are never
  logged or echoed (1.6, 2.4). The outbound payload's field set is unchanged from 646 (its payload test still passes).
  The row discloses `remote` for every target that leaves the machine (1.5, 2.6). A decision call sends a key only to
  the base URL configured for that key (1.2, 2.3).
- Performance: every call stays bounded by the timeout that Requirement 5 decides. The 646 request and question budgets
  (Requirement 12) are unchanged. The capability lookups are cached (4.2).
- Compatibility: VS Code, Electron and CLI (Requirement 7). Local Ollama >= 0.35.0 keeps working unchanged.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| The user / our team | Routing on clef with the existing subscription | 8.1-8.2 pass on our install |
| Users with their own provider | Use Jev, a remote Ollama or any compatible host | 2.1-2.7; the key is never shown back |
| Users who care where data goes | Know when routing text leaves the machine | `remote` shown for cloud and daemon `-cloud` models (1.5) |
| Maintainers / QA | Proof that the cloud path works and keeps working | Live workflow green; failures file one issue (6.8) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Cold-start latency on the cloud exceeds 3 s, so routing always falls back | MEDIUM | MEDIUM | Measure first (6.6), then decide the timeout from the data (5.2); owner: architect + senior-tester |
| The direct API accepts a different model id than the daemon (`clef:27b` vs `clef:27b-cloud`) | MEDIUM | LOW | 6.10 records the accepted id before the picker and preset text are finalised; owner: senior-tester |
| Routing calls use up the Ollama Cloud quota that chat shares (D1); 429s seen earlier (646 decisions #63) | MEDIUM | MEDIUM | The 646 fallback absorbs 429s; the workflow schedule is kept low (weekly, see Decisions); owner: devops-engineer |
| The `ollama-cloud` key cannot be reached from lane-routing (it lives in vscode-core) | HIGH | MEDIUM | Architect defines the credential access across the boundary, like `STRUCTURED_DECISION`; owner: architect |
| A new settings key is not file-based, so VS Code cannot save it again (Batch 41i) | MEDIUM | HIGH | 7.1 spec plus a check in a real host (7.2); owner: team-leader at batch review |
| Prerequisite: #731 and Batch 41i are not merged yet | HIGH | HIGH | Merge `origin/main` after #731 before any code change (context.md); owner: orchestrator |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Live eval pass bar: every fixed question correct in all 3 runs | all runs / majority / a percentage | The questions are built to be unambiguous (context.md); a looser bar would hide a broken path | Yes |
| A missing secret ends the workflow with a notice and no issue | fail + issue / notice / silent skip | The user adds the secret later (8.3); daily issues before then would be noise | Yes |
| Schedule weekly plus dispatch, not daily | daily / weekly / dispatch only | D1 shared quota; the model catalogue changes rarely compared with model lists | Yes |
| Custom endpoints and Jev get no capability filter | filter / free text | No common capability API for generic hosts; D3 targets the Ollama hosts | Yes |
| No parity inventory | write / skip | No existing capability is removed; presets and free text stay (D2, 4.4) | Yes |

## Open questions

- (User, security) Should a custom endpoint accept a plain `http://` base URL that is not loopback when an API key is
  set? Options: (a) refuse, and require `https` except on loopback (recommended, since the key would cross the network
  in clear text); (b) allow, with a warning on the row; (c) allow silently. This does not block the architect: the
  rest of Requirement 2 holds either way, and the answer adds or removes one check in 2.2.

## Handoff

- Next specialist: software-architect.
- Why: the external facts are researched (context.md). What is left is the design: how lane-routing reads the
  `ollama-cloud` key, how a target is resolved for each kind, the probe branch, the capability cache, and the place to
  store custom-endpoint settings.
