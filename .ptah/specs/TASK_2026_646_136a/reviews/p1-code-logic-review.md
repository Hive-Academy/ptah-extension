# Code Logic Review - P1 Foundations - `TASK_2026_646_136a`

Review family: Anthropic (Claude). Implementers were Zhipu (B2, B4, B7), xAI (B1) and OpenAI (B3, B5), so the reviewer is a different family.

Scope: `git diff 7ea895538 3ada54c23 -- . ':!.ptah'` (Batches 1, 2, 3, 4, 5, 7). No Nx or Jest was run (memory-safe rules); evidence is source reading, the task folder, and the team-leader's recorded check results in `batches.md`. Every changed non-spec source file was read in full; spec files were read only where a claim depended on them.

## Summary

| Metric              | Value                                  |
| ------------------- | -------------------------------------- |
| Overall score       | 7/10                                   |
| Assessment          | APPROVED (with moderate follow-ups)    |
| Blocking issues     | 0                                      |
| Serious issues      | 0                                      |
| Moderate issues     | 6                                      |
| Minor issues        | 6                                      |
| Failure modes found | 6                                      |

Score rationale: the migrations, the tag builder, the callback registry and the strict schemas are sound and their failure behaviour is contained (7-8 band). The score stops at 7 because three signals the outcome loop depends on can be lost with only debug-level or no logging (M1, M2), and two schemas accept shapes the requirements describe as mixed or ambiguous (M4, M5). None of these corrupts data or misleads a user, so none reaches Serious.

## Five logic questions

### 1. How does this fail silently?

- Ptah run tag missing. `runTag()` returns `null` and logs only at `debug` for `missing-agent-id`, `invalid-agent-id` and for a thrown lookup (`post-tool-use-hook-handler.ts:109-120`, reason set in `subagent-run-tag.ts:33-38`). When the SDK's Agent/Task result has neither a registry hit nor a `tool_response.agentId`, the hook returns `{continue: true}` and nothing records that the join key was never issued. The downstream skill then falls back to `{agentId}` targeting or skips the report; the operator sees nothing at default log level. (IA-5 live capture is Batch 31's; this is the observability gap, not the capture.)
- Budget stop not published. `subagent-budget-monitor.ts:1000` publishes only when `prepared.record && registryRecord?.agentId`. Two stops that really happened publish nothing and log nothing: a safety stop whose handoff record could not be written (`prepareHandoff` returns `{ handoff }` with no `record`, monitor `:1115`), and a stop of a subagent whose registry record has no `agentId` (held or unbound start, `subagent-hook-handler.ts:261-275`). The outcome row then gets `budget_stopped = 0` and the failure class is not `timeout` (plan D6).
- Pre-flight result `Answer` allows `{value: null, source: 'model'}` (`route-decide-result.schema.ts:112-120`). Req 2.2 defines "null with source `skill-table`" as the skill-table signal; a null with `model` source validates and means nothing.

### 2. What user action produces unexpected behaviour?

- Booting any dev build (Electron `serve`, CLI dev, extension dev host) on this branch before Batch 25 throws in `registerRpcSurface` (`register-rpc-surface.ts:141-143`, `assertManifestInvariants(RPC_METHOD_NAMES)` -> "RPC manifest is missing an owner for 1 method(s): agent:outcomeSignals", `manifest.ts:508-512`). Production builds do not throw; they log the CRITICAL drift line and report to Sentry through `verifyAndReportRpcRegistration`. This is the known R-5 interim state (`batches.md:112`), so it is not a defect of the batch, but it constrains ordering: the Batch 8 before/after screenshots (decision #58) boot the app and must run after Batch 25 lands.
- A caller who passes `taskKind` or `routingSource` to `ptah_agent_spawn` gets a successful spawn, and both values are dropped at `protocol-dispatcher.ts:1206+` and `agent-tool.dispatcher.ts:437-451` (neither forwards them). Accepted: Batch 29 owns the copy. Noted only so nobody ships Batch 7 alone.

### 3. What input data produces a wrong answer?

- `gate-0.1` args with two pins for the same `phaseId` (different executors) pass validation (`route-decide-args.schema.ts:75-95` only checks that each pin names a phase). Req 3.6 says "the pinned lane"; which of the two wins is left to the service.
- `ptah-cli` agents whose provider is unknown group under `ptah-cli:<id>` (`lane-family.ts:41`), the same agent grouped under its `providerId` once the provider resolves. A rows-versus-record family mismatch is possible if the list builder and the notifier see different `providerId` values for the same agent. The list builder does pass `providerId` (`agent-namespace.builder.ts:470`), so the risk is limited to notifier call sites (Batch 24).
- Subagent family is the constant `claude` (`lane-family.ts:24`) regardless of the provider the parent session runs on. A Ptah session routed to Moonshot, Z.AI or OpenRouter runs its subagents on those models, so the reviewer-family rule (Req 3.3) and the per-family score grouping treat a GLM subagent as Claude. This is plan-sanctioned (part-a:142) but unevidenced for non-Anthropic sessions.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- Registry lookup throws or returns a record without `agentId`: caught (`post-tool-use-hook-handler.ts:113-120`), tool result is untouched, `tool_response.agentId` is used as fallback. Good.
- Registry and response disagree: warned (`:98-104`), registry wins. A wrong registry id would mint a tag that points at another run; low probability, no mitigation, acceptable.
- Hostile `tool_response.agentId`: constrained by `^[A-Za-z0-9_-]{1,200}$` (`subagent-run-tag.ts:15`), so the tag cannot carry newlines or instructions into `additionalContext`. Good.
- Budget-stop listener throws or rejects: `CallbackRegistryBase.register` wraps both the sync and promise case and logs at `error` (`callback-registry.base.ts:21-37`); the stop proceeds. `notifyAll` is synchronous and sits after `stopFired = true` and before `registry.update`, so a listener cannot cause a second stop or skip the completion update. Double fire is blocked by `stopFired` (`monitor:981-983`, `:998`). A failed stop publishes nothing and retries later through `onStopFailed`, and the retry can publish once. Ordering across listeners is `EventEmitter3` registration order. No leak in the library: `register()` returns the unsubscribe, which Batch 24's listener must call on dispose (not in this diff).
- `SUBAGENT_REGISTRY_SERVICE` is registered for every host (`vscode-core/src/di/register-platform-agnostic.ts:77`); the new registry token resolves in the Electron and CLI smoke specs (`container.smoke.spec.ts` in both apps).

### 5. What is missing that the requirements never mentioned?

- No counter or warn-once for "Agent result had no resolvable run id", which is the only evidence the loop is silently not closing on a given SDK version.
- No log when a budget stop is skipped for lack of a record or an `agentId`.
- No guard that `ROTATION_TASK_KINDS`, `PHASE_KINDS` mapping and `OUTCOME_TASK_KINDS` stay in step (see Minor 3); R4j says the rotation key imports the shared union.
- No consumer-visible note that the `ptah_agent_list` table gained a `Family` column; anything that parses the markdown table by column position shifts by one.

## Failure modes

### FM-1 Run tag silently absent
- Trigger: Agent/Task PostToolUse with no registry record at hook time (a held start bound later by the stream, or a completed record already dropped) and a `tool_response` that lacks a string `agentId`.
- Symptom: no `ptah-run:` line; later outcome reports cannot use `runId`.
- Evidence: `post-tool-use-hook-handler.ts:109-120`, `subagent-run-tag.ts:33-38`.
- Current handling: `debug` log, `null`.
- Recommendation: log `missing-agent-id` and `invalid-agent-id` at `warn` once per session (or keep a counter), keep `debug` for the not-an-Agent-tool case.

### FM-2 Budget stop without a record is not published
- Trigger: handoff record write fails during a safety stop (disk full, permission), or the registry record has no `agentId`.
- Symptom: subagent stopped by Ptah is stored with `budget_stopped = 0`; its failure class is not `timeout`.
- Evidence: `subagent-budget-monitor.ts:1000-1006`, `:1109-1115`.
- Current handling: no publish, no log.
- Recommendation: publish when `registryRecord?.agentId` exists regardless of `prepared.record` (the stop happened either way), or log a `warn` naming `toolCallId` when the signal is skipped. The plan wording ("invoked with a record", part-b:383) is narrower than its stated purpose ("Ptah stopped this subagent", part-b:379).

### FM-3 Dev boot throws until Batch 25
- Trigger: `isDevelopment()` host boot with `agent:outcomeSignals` in `RPC_METHOD_NAMES` and no manifest owner.
- Symptom: boot error; production logs CRITICAL drift and a Sentry event.
- Evidence: `register-rpc-surface.ts:141-143`, `manifest.ts:508-512`, `rpc.types.ts` entry added at Batch 2.
- Current handling: tracked as R-5; guard specs deferred to Batch 25.
- Recommendation: keep Batch 25 ahead of any app run in the batch order; record in `batches.md` that Batch 8's visual-reviewer run (decision #58) depends on Batch 25, not only Batch 2.

### FM-4 Duplicate or oversized pin input accepted
- Trigger: two `pins` entries with the same `phaseId`; very long `pin.executor`, `pin.model`, `preferences.prefer[]` or `phases[].reviews[]` strings.
- Symptom: ambiguous pin resolution in A8; inflated decision-model request (later caught by the 64 KB `payload-too-large` check, but only after the service has built it).
- Evidence: `route-decide-args.schema.ts:21-28`, `:34-40`, `:75-95`.
- Current handling: unique-phase-id and unknown-reference checks only.
- Recommendation: add a duplicate-pin-phase `superRefine` issue at `['pins', i, 'phaseId']` and `.max(200)` on the free strings.

### FM-5 Result schema accepts internally inconsistent unavailable and lane entries
- Trigger: a service bug or a model-fed field producing `exclusionReason: 'pin-unavailable'` with `source: 'ranking'` or `pinRule: null`; `reviewer-family` with `needsDisclosedFallback: false`; a chosen `kind: 'lane'` entry with neither `cli` nor `ptahCliId`; a chosen `subagent` with no `role`.
- Symptom: the skill's disclosed fallback is skipped for a reviewer-family miss, or a lane entry cannot be spawned.
- Evidence: `route-decide-result.schema.ts:50-62`, `:66-86`. Req 2.3 lists the specific rejections, and all of them are implemented (non-null model/provenance/score/confidence/fallbackCause, missing exclusion reason, `executor: 'unavailable'` on a chosen entry, including the object form via the refine at `:55`). The cross-field rules from the same criterion text ("set for `reviewer-family`", "`pin` for `pin-unavailable`, otherwise `ranking`", rule named for `pin-unavailable`) are not.
- Current handling: left to A8 service behaviour.
- Recommendation: add a `superRefine` on `UnavailableEntrySchema` and on `executor` (lane requires `cli` or `ptahCliId`, subagent requires `role`), with spec cases.

### FM-6 Subagent family hard-wired to `claude`
- Trigger: parent session on a non-Anthropic provider.
- Symptom: wrong reviewer-family exclusion and wrong score grouping for subagent rows.
- Evidence: `lane-family.ts:24`, `lane-outcome.types.ts:95` comment.
- Current handling: constant.
- Recommendation: keep for Gate 0.1 (no better source at that stage) but have the outcome writer (Batch 24) derive subagent `family` from the active provider where known, with `claude` as the fallback. Record as a decision.

## Blocking issues

None.

## Serious issues

None. Items weighed and kept at Moderate: FM-2 (affects failure classification only, not delivery or verdicts) and FM-3 (interim, tracked, branch-local).

## Moderate and minor issues

Moderate
- M1 `subagent-budget-monitor.ts:1000-1006` budget-stop publication gated on a record and an `agentId`, skip is silent (FM-2).
- M2 `post-tool-use-hook-handler.ts:109-120` run-tag misses logged at `debug` only (FM-1).
- M3 `register-rpc-surface.ts:141-143` dev boot assertion is red until Batch 25; sequencing hazard for Batch 8's visual run (FM-3).
- M4 `route-decide-args.schema.ts:75-95` duplicate pins per phase accepted; unbounded free strings (FM-4).
- M5 `route-decide-result.schema.ts:50-86`, `:112-120` cross-field consistency not enforced (FM-5, and `value: null` with `source: 'model'`).
- M6 `lane-family.ts:24` subagent family constant (FM-6).

Minor
- m1 `mcp-response-formatter.ts` docstring above `formatAgentList` still says "Without `limits` the output is the pre-plan-limits text, byte for byte". The new `Family` column makes that untrue; fix the comment, and call out the added column in the tool description or skill text that lists the table.
- m2 `agent-spawn-args.schema.ts` repeats `['model','ranking','pin']` by hand instead of deriving it from `OUTCOME_ROUTING_SOURCES` minus `'not-routed'`; the next enum change can drift. Same shape in `agent-process.types.ts` (that one derives with `Exclude`, which is right).
- m3 `routing-constants.ts` defines `ROTATION_TASK_KINDS` as its own literal list although R4j says it imports `OUTCOME_TASK_KINDS`; the two are equal today with no spec pinning them together.
- m4 `route-decide-args.schema.ts:11-12` `request` accepts whitespace-only text (`min(1)` without trim); Req 2.5 intends "missing or invalid".
- m5 `post-tool-use-hook-handler.ts:183-185` `[notice, tag].join('\n')` yields a leading newline if `take()` ever returns an empty string; filter on non-empty rather than `undefined`/`null`.
- m6 `lane-routing/src/index.ts` exports no contracts or ports yet; `batch-5-report.md` says A8 (Batch 21) adds them. Fine now; make sure Batch 21's task list names the schema and port exports, since `vscode-lm-tools` cannot import them otherwise.

## Data flow

1. `ptah_agent_spawn` args -> `AgentSpawnArgsSchema` (`.strict()`, `taskKind` and `routingSource` enums) -> OK. Dropped before `agent.spawn` (Batch 29 owns).
2. `ptah_agent_list` rows -> `laneFamilyOf` in the row builder -> `family` -> formatter `Family` cell, `N/A` when absent -> OK.
3. Agent/Task PostToolUse -> `buildSubagentRunTag` (main-thread only, tool name gated, id regex) -> `additionalContext` -> OK; gap at FM-1.
4. Subagent stop at budget -> `notifyAll` after `stopFired` -> listener (Batch 24) -> `budget_stopped` upsert on `subagent:${agentId}` -> gap at FM-2.
5. Outcome write path -> `lane_outcome_records` / receipts / held reports (migration 0054) -> OK: all key columns `NOT NULL` (`0054:40,76,84`, TL-B4-1), all statements `IF NOT EXISTS`, no CHECK on enums (validated at the Zod edge), `expires_at` index at `0054:93-94` serves the R6-1 count and the sweep, `run_id` indexes serve the join and the receipt eviction.
6. `skill_invocation_events.run_id` (migration 0055) -> nullable column plus `IF NOT EXISTS` index -> OK. The bare `ALTER ... ADD COLUMN` is safe because the runner applies each version once (precedent `0037`); the file header says so.
7. Registration -> `MIGRATIONS` entries 54 and 55 are in order, forward-only, appended after 53 (`migrations/index.ts`); the max-version assertions in older specs are updated to 55, and the 0053 spec filters to `<= 53` so its own `appliedVersions` check stays valid. OK.
8. `route.decide` args -> `RouteDecideArgsSchema` -> result -> `RouteDecideResultSchema` -> OK for shapes; gaps at FM-4 and FM-5.
9. RPC `agent:outcomeSignals` -> registry and `RPC_METHOD_ENTRIES` entries present, no handler, no manifest owner -> known red until Batch 25; dev boot consequence at FM-3.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 2.3 chosen/unavailable branches, rejections | COMPLETE for the listed rejections | Cross-field consistency not enforced (FM-5) |
| Req 2.7 unavailable fixtures (zero candidate, not-listed, at-limit, reviewer family) | COMPLETE at schema level | Runtime variants with/without decision model belong to A8 |
| Req 2.5 invalid args name the field | COMPLETE | Whitespace-only request, duplicate pins (m4, FM-4) |
| `ChosenEntry.taskKind` from `OUTCOME_TASK_KINDS` | COMPLETE | Phase-kind to task-kind mapping is A5/A8 work, not in this diff |
| Req 5.x record shape and keys (SC-1, SC-10) | COMPLETE | Subagent family assumption (FM-6) |
| Req 5.2 `taskKind`/`routingSource` on spawn | PARTIAL, by design | Validated here; propagation is Batch 29 |
| Req 8.7 / SC-7 Ptah run tag | PARTIAL | Tag built and appended; live SDK shape unproven (Batch 31); miss is silent (FM-1) |
| SC-5 `laneFamilyOf` | COMPLETE | See below |
| Budget-stop signal (part-b §5) | PARTIAL | Record-less stops unpublished (FM-2) |
| Migrations 0054/0055, TL-B4-1, R6-1 | COMPLETE | None found |
| RPC registry entry `agent:outcomeSignals` | COMPLETE for the contract | Handler in Batch 25; dev boot effect (FM-3) |

`laneFamilyOf` per lane id: system CLIs (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`) return the cli name; `ptah-cli` returns `providerId`, else `ptah-cli:<ptahCliId>`, else `ptah-cli`, with blank strings treated as unset (`lane-family.ts:34-42`). Registered provider ids (`openrouter`, `moonshot`, `z-ai`, plus `anthropic`, `ollama-cloud`, `opencode-go` seen in the limits code) do not collide with any system cli name. A user-defined provider whose id equals a system cli name would merge the two families; low risk, not guarded. The in-process subagent uses `SUBAGENT_FAMILY = 'claude'` (FM-6).

Implicit requirements not addressed: the missing-run-id and skipped-budget-stop observability above; a spec that pins `ROTATION_TASK_KINDS` to `OUTCOME_TASK_KINDS`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Agent result from a subagent (`agent_id` set) | YES | `subagent-run-tag.ts:23` returns null | none |
| Non-Agent/Task tool result | YES | same early return | none |
| Registry throws | YES | try/catch, null | debug only (FM-1) |
| Registry async | N/A | `get()` is synchronous; a promise-returning stand-in would yield `undefined` agentId and fall back to the response | none |
| Hostile or oversized agent id | YES | regex `{1,200}` | none |
| Tag plus existing notice | YES | joined with newline | m5 |
| Budget listener throws | YES | wrapped in base class | none |
| Budget stop fires twice | YES | `stopFired` guard | none |
| Budget stop, session released mid-stop | YES | `liveSession` check returns before notify (`:975-978`) | none |
| Budget stop, record write fails | NO | no publish | FM-2 |
| Migration re-run | YES | `IF NOT EXISTS` on all 0054 statements; 0055 relies on the runner's version bookkeeping | none |
| NULL key insert | YES | `NOT NULL PRIMARY KEY` x3 | none |
| Held-report expiry sweep and capacity count | YES | `expires_at` index | none |
| Upgrade from a DB at version 53 | YES | two forward-only entries appended | none |
| `.strict()` on every schema object | YES | args branches, phase, pin, preferences, all result objects | none |
| Extra property on spawn args | YES | rejected by `.strict()` | none |
| Two pins for one phase | NO | accepted | FM-4 |
| Mixed unavailable shape (reason vs source) | NO | accepted | FM-5 |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH. Source and plan were read in full for every changed non-spec file; no test was run by this reviewer and the live SDK shape for the Agent result (IA-5) remains unproven by design.
- Top risk: the outcome loop can lose its two correlation signals (run tag and budget stop) without any default-level log, so the first sign of trouble would be empty Agents-tab signals rather than an error.
- What a robust implementation would add: `warn`-level, rate-limited logging for FM-1 and FM-2, or publish the budget stop whenever the stop succeeded and an `agentId` exists; a duplicate-pin issue and string length bounds in the args schema; cross-field refinements on `UnavailableEntrySchema` and `executor`; a spec pinning `ROTATION_TASK_KINDS` to `OUTCOME_TASK_KINDS`; the Batch 8 visual run ordered behind Batch 25; a decision recording how subagent family is set when the parent session is not on Anthropic.

## Decisions

- D-1: Dev-mode manifest assertion rated Moderate, not Serious. Options: Serious (forces REVISE for an interim state the plan already stages), Moderate (sequencing note). Evidence: `batches.md:112` (R-5) says "no host is dev-booted before Batch 25"; the production path only logs. Reversible: yes.
- D-2: FM-2 rated Moderate. Options: Serious (silent loss of a failure signal), Moderate (signal only feeds the `timeout` class, plan D6). Evidence: part-b:389-390, 622. Reversible: yes.

VERDICT: APPROVED
