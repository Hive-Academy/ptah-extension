# Design addendum: Codex/terra recordings and model-panel labels

## Summary

The four pending recordings use the product host, Codex subscription, and gpt-5.6-terra; they are never CLI-lane or fabricated predictions. U1--U4 use blinded non-OpenAI model-panel labels, not human labels. **[user-requested]** No bench, corpus run, or Electron launch occurs before 619 says “Batch 11 runs done”; rebase on its probe-fix commit before B24. **[user-requested]**

## Part A Codex/terra recording

### Carrier and product settings

Add a non-secret settings: Record<string, string | number | boolean> to the strict runner plan and derived strict host plan. The current runner plan has no field (tools/mcp-bench/src/memory-skills/runner/runner-plan.ts:64-75) and neither does the host plan (tools/mcp-bench/src/memory-skills/host/plan.schema.ts:107-133). runner/run-memory-skills.ts copies it into the host plan. **[lane-proposed]**

host/memory-skills-host.ts owns application: after withEngine opens isolated product config and before suites/providers resolve, write each map entry through workspace provider section ptah, read it back, and fail on mismatch. This writes real product config under PTAH_CONFIG_PATH, rather than guessing a config-file format. That is engine config directory (libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:258) and it is inside isolated home (tools/mcp-bench/src/transport/bench-host.entry.ts:15-19). Completion metadata holds names and canonical-map hash only. **[lane-proposed]**

| Recording | Required ptah settings | Cassette model |
| --- | --- | --- |
| extraction.v1, B18 curator cassettes, scope-write | memory.curatorProvider=openai-codex; memory.curatorModel=gpt-5.6-terra | curator: gpt-5.6-terra; B18 unused lane runner: none |
| funnel.v1 | skillSynthesis.{archaeologist,synthesis,judge,replay}.provider=openai-codex; corresponding .model=gpt-5.6-terra | laneRunner: gpt-5.6-terra |

Curator keys are ptah.memory.curatorProvider/curatorModel (libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:53-55,220-226). Skill lanes expose provider/model below skillSynthesis.<lane> (libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:48-67). B18 is curator-only with lane cassette model none (batch-18-report.md:180,187-191); do not describe it as skill-lane work. judgeModel is inherit-only (lane-resolver.service.ts:107,161,282-291). Provider/model ids are established (settings-export.types.ts:96-99; opencode-model-routes.ts:78-81; sdk-model-service.spec.ts:162-174).

### Isolated Codex authentication and provenance

A1 alone adds an ephemeral codexAuthSource runner invocation option: an operator-supplied absolute path to freshly refreshed real ~/.codex/auth.json. It is outside repo and never serialized to plans, cassettes, fixtures, logs, or private bench-data. **[lane-proposed]**

In beforeEngineBoot, new 620-owned host/recording-bootstrap.ts copies that one regular auth file to <isolated-home>/.codex/auth.json, rejects links, restricts permissions, sets child-only process.env.CODEX_HOME=<isolated-home>/.codex, then asserts resolved Codex home/auth file is inside that directory before engine/provider construction. Existing hook receives isolation.home (memory-skills-host.ts:217-224). This overrides inherited parent value: CODEX_HOME wins over homedir() (libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts:23-25) and launcher otherwise spreads parent environment (tools/mcp-bench/src/transport/host-launcher.ts:355-357). No 619 transport edit is needed. **[lane-proposed]**

Chosen policy: operator uses normal Codex CLI to refresh/login immediately before record; A1 rejects copied token below recording deadline plus ten minutes, and record mode aborts on refresh rather than writing. Refresh writes temp-file-and-rename and can persist rotated refresh token (codex-auth.service.ts:418-421,500-514), so a refresh of a copy could invalidate real login. Residual risk: expiry fails recording and might require codex login. Do not set CODEX_HOME to real ~/.codex: 619 guard watches .ptah, not .codex (host-launcher.ts:15-18). **[lane-proposed]**

A2 adds a read-only dispatch callback from curator/lane-runner after final route resolution: resolvedProviderId/resolvedModelId. A1 recorder subscribes and adds it to staged cassette entry; request/result bytes do not change. Specs prove callback correctness and unchanged observable behavior without it. Missing value, auth error, refresh attempt, provider/model mismatch, or alias fails and discards staging. Curator auth errors silently ride-active (sdk-internal-query.curator-llm.ts:236-251). **[user-requested]**

After the 619 gate:

    npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/extraction.record.json --run-id extraction-record-v1
    npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/b18-record.json --run-id b18-record-v1
    npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/scope-write.record.json --run-id scope-write-record-v1
    npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/funnel-record.plan.json --run-id funnel-record-v1

All use record mode, private paths, synthetic input, pinned map. Record mode refuses committed fixtures (plan.schema.ts:201-214). Validate all staged provenance before acceptance, then replay once. **[project-rule]**

## Part B Model-panel ground truth

### Eligibility, blinding, and agreement

Recordings are OpenAI-family, so no OpenAI lane labels output or rates product-judge agreement. **[user-requested]** Verify actual provider/model/family before each activity. Preferred panel is Grok/xAI and Antigravity/Google raters, Glm/Ollama Cloud/GLM adjudicator; substitute only verified non-OpenAI families and escalate only if fewer than two eligible families remain. **[user-requested]**

Packets are shuffled and opaque: no stratum, slug, source path, product score/provenance, or other rater answer. **[user-requested: R2]** Retry invalid structured output once. A second invalid/declined answer is unresolved-model-panel; retain it in frozen-population denominator/private manifest. More than 10% unresolved marks activity ground-truth-untrusted and blocks affected metric pending escalation. **[lane-proposed]**

U1 prompt: “You are rater <raterId>. Apply attached 471 eight-criterion rubric. Return one CSV row per document, no header or other text: opaqueId,raterId,c1,c2,c3,c4,c5,c6,c7,c8,total,pass,ratedAt. Criteria integer 0–10; total sum; pass true iff total >=64 and every criterion >=6; ratedAt ISO-8601 UTC. Do not report provenance.” This matches loader (rubric-ground-truth.ts:88-102; label-schemas.ts:282-301). Adjudicate if pass differs or totals differ by more than 12 (benchmark-design.md:237-239).

### U1--U4 mapping

| Activity | Runnable prompt and private output | Adjudication / frozen output |
| --- | --- | --- |
| U1 | 105 documents, six chunks/rater, using U1 CSV prompt. | GLM receives document/rubric/two numeric rows only; returns opaqueId,adjudicatorId,c1..c8,total,pass,triggers,decidedAt (rubric-ground-truth.ts:104-119). |
| U2 | For every JSONL candidate return JSONL only: {"id":string,"decision":"accept|edit|reject","replacement":string|null,"raterId":string,"ratedAt":ISO}. Accept unchanged-valid; edit needs replacement; reject excludes. Preserve fact|merge|update|temporal|abstention; accepted abstention remains excluded. | Different decisions, or edit replacement hash disagreement, triggers GLM. It returns same row with adjudicatorId,triggers,decidedAt. Accepted rows become existing strict gt-memory@v1/gt-merge@v1 objects including labeller,labelledAt (ground-truth/label-schemas.ts:25-178). |
| U3 | After B24 replay/re-draw: for every opaque matcher pair return JSONL only: {"id":string,"factId":string,"humanMatch":boolean,"raterId":string,"ratedAt":ISO}. | Boolean disagreement triggers GLM output with adjudicatorId,triggers:[match-differs],decidedAt. Frozen row includes packet subject,content,chunk and follows matcherSampleRowSchema (label-schemas.ts:180-191); document legacy humanMatch as panel-labelled. |
| U4 | Re-draw after 2026-10-07T00:00Z. Session JSONL: {"opaqueId":string,"sha256":string,"lineRefs":positive-integers[],"raterId":string,"ratedAt":ISO}; sorted unique factual-memory lines. Trigger JSONL: {"skillId":string,"shouldTrigger":string[],"nearMiss":string[],"raterId":string,"ratedAt":ISO}. | Unequal lineRefs or prompt-array hashes trigger GLM with adjudicatorId,triggers,decidedAt. Commit exact session {opaqueId,sha256,lineRefs} (realSessionLabelSchema, label-schemas.ts:197-215) and trigger {skillId,description,shouldTrigger,nearMiss} (triggerLabelSchema, trigger-human-eval.ts:79-87); raw data stays private. |

## Scorecard honesty

Set groundTruth.method=model-panel:xAI+Google;adjudicator=GLM (actual verified families) and raterCount=2, never human. **[user-requested]** skill.rubric.inter-rater becomes model-panel agreement; skill.judge-agreement, skill.enhancer, R-M4 matcher, and mem.extraction real slice use panel labels. Display skill.trigger-eval.panel; retain legacy human id only if 619 compatibility requires it, annotated “model-panel, formerly human-named.” README/scorecard disclose families/models/timestamps, blinding, adjudication, unresolved share, private storage, non-human status. **[user-requested]**

## New or changed batches

All batches are one Grok executor lane, <=40 tool calls, file-disjoint, scoped Jest only under memory-skills or touched library. **[user-requested] [project-rule]**

| Batch | Executor | Exclusive files | Scoped check |
| --- | --- | --- | --- |
| A1 plan/config/auth recording seam | grok | runner/runner-plan.ts, runner/run-memory-skills.ts and specs; host/plan.schema.ts, host/memory-skills-host.ts; new host/recording-bootstrap.ts and spec; host/fixture-seeder.ts and spec; recorder/provider-provenance.ts and spec | targeted runner/host/recorder Jest |
| A2 product provenance taps | grok | curator implementation/spec; skill-synthesis lane-runner service/spec | touched-library Jest |
| B1 panel schemas/import | grok | new labelling/model-panel.ts/spec; ground-truth/label-schemas.ts/spec; suites/skills/rubric-ground-truth.ts/spec | targeted memory-skills Jest |
| B2 terminology/docs | grok | suites/skills/trigger-human-eval.ts/spec; tools/mcp-bench/README.md | targeted trigger Jest |

A1 is only batch owning auth-copy/CODEX_HOME. It uses recording-bootstrap.ts, not bench-host-process.ts, avoiding 619-owned transport/bench-host-process.ts. **[lane-proposed]**

## Requests to 619

620 will not edit scorecard/, transport/, corpus/, or bench-data.ts. **[user-requested]** No CODEX_HOME transport change is requested; A1 sets it in child before engine boot. Request backward-compatible display-note field permitting skill.trigger-eval.panel and groundTruth.method=model-panel:<families> without normalization.

## Privacy and data flow

Packets, sessions, candidate bodies, results, manifests, credential source/copy remain in C:\Users\abdal\AppData\Local\ptah-mcp-bench or disposable child home; none committed. **[user-requested]** U1--U4 send private packets to xAI, Google, and/or Ollama Cloud/GLM: new external data flow requiring operator/provider-data approval. Recording sends synthetic fixtures to Codex proxy. Repo artifacts contain opaque ids, hashes, aggregates, provenance, reviewed synthetic cassettes only. **[user-requested]**

## Cost

U1 is 12 rating spawns (105 docs, max 20 each, twice) plus adjudication; U2--U4 same ceiling. Every lane <=40 tool calls. **[user-requested]** Private manifests capture provider/model, packet count, prompt hash, response/failure count, unresolved share, timestamp. **[lane-proposed]**

## Risks

- Curator ride-active fallback contaminates provenance; fail closed. **[user-requested]**
- Refresh-token rotation on copied Codex auth can invalidate operator login; preflight/no-refresh reduces but does not remove re-login risk. **[lane-proposed]**
- OpenCode may route OpenAI; verify before use. **[user-requested]**
- Model consensus is not human judgment; disclose it and cap unresolved labels. **[user-requested]**
- Private content leaves machine for panel providers; obtain approval. **[user-requested]**

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Pinned-settings carrier | typed runner-to-host map and workspace-provider write (chosen); undocumented config JSON | runner-plan.ts:64-75; plan.schema.ts:107-133; with-engine.ts:258 | yes |
| Codex auth | fresh copy plus no refresh (chosen); real .codex; copied refresh | codex-home-resolver.ts:25; codex-auth.service.ts:500-514 | yes, before record |
| Panel | xAI+Google raters, GLM adjudicator | user eligibility rule | yes, before freeze |
| Unresolved cap | >10% blocks metric | rubric-ground-truth.ts:371-372,433-465 | yes, before freeze |

## Clarifications Needed

None; escalate only if fewer than two eligible non-OpenAI families are installed. **[user-requested]**
