# Context — TASK_2026_180

## Orchestration metadata

- **Strategy**: FEATURE, Full depth (software-architect design pass required for
  Phases 0 and 2–4; Phase 1 is mechanical).
- **Ships as five independent commits**, one per phase.
- **Order**: Phase 0 MUST land before Phase 2. Phase 1 may land in parallel with
  Phase 0. Phases 3 and 4 depend on 0+1; Phase 3 consumes Phase 2's verdict
  shape when present, with a documented fallback.
- **cli_delegation**: allowed for Phase 1 grunt work only.

## Background

The skill-synthesis lib (`libs/backend/skill-synthesis`) currently works as a
fixed pipeline: regex success markers → `.slice(0, 8000)` trajectory truncation
→ one-shot Haiku synthesis (`maxTurns: 1`) → five-criterion single-call judge
averaged into one number → cosine clustering. A diagnostic session (2026-08-04)
confirmed two trust-breaking defects visible in the shipped UI:

1. **Fake scores.** `SkillJudgeService` fails OPEN — any LLM error, rate limit,
   or unparseable reply returns `{ passed: true, score: 10 }`
   (`skill-judge.service.ts:124,176`). The Recommended tab renders these as
   real "judge 10.0" verdicts while the Sessions tab simultaneously shows
   "Analysis was rate-limited".
2. **Prompt-echo names.** Candidate slug = slugified first 140 chars of the
   first user message (`trajectory-extractor.ts:136-138`), producing names like
   `you-are-analyzing-the-ptah-nx-monorepo-at-d-projects-...` in the Sessions
   tab.

Additionally the synthesizer and judge share one `judgeModel` setting
(`skill-synthesizer.service.ts:107`), so skill _authoring_ — the creative step —
defaults to `JUDGE_DEFAULT_MODEL_ID = 'claude-haiku-4-5-20251001'`
(`types.ts:9`), and neither ever passes an `auth` override, so background
synthesis silently competes with the user's foreground coding for the same
Anthropic quota.

Strategic goals (user-stated):

- Stop relying on fixed scores and "brutal" regex session reads; make each
  stage agentic and evidence-based.
- Give users proactive, ranked, professional recommendations instead of a
  passive review queue.
- Keep it performant when 3–4 sessions across multiple projects run
  concurrently.
- Let the user point synthesis at their own provider/model (Ollama Cloud,
  local Ollama, Z.AI, Moonshot) for control, cost, and quota isolation.
- Let synthesis survive desktop-app close.

## Verified code facts — TRUST THESE

### Synthesis pipeline

- `TrajectoryExtractor` (`trajectory-extractor.ts`) reads session JSONL via
  `JsonlReaderService`, compresses tool_use into markers, detects "success"
  with regex phrases (`:17-26`, e.g. `\bdone[!.\s]/`) over the last 25% of
  turns. `minTurns` param is dead (`void minTurns;` at `:106`); the real floor
  is `MIN_ROLE_TURNS_FLOOR = 2`.
- `SkillSynthesizerService.runSynthesis` — single `internalQuery.execute` call,
  `maxTurns: 1`, 30s timeout, trajectory sliced to 8,000 chars
  (`buildPrompt`, `:193`), cluster members sliced to 3,000 chars each.
  Fallback dumps raw trajectory into the body (`synthesizeBody`, `:244`).
- `SkillJudgeService.judge` — five criteria (novelty, actionability, scope,
  generalization, triggerClarity) scored 1–10 in ONE call, averaged vs
  `settings.minJudgeScore`. 15s timeout. Three fail-open paths return
  score=10: no JSON match, invalid score values, thrown error. `reason` field
  exists on `JudgeDecision` but per-criterion scores are NOT persisted.
- Judge + synthesizer both resolve model via `resolveJudgeModel(settings.judgeModel, …)`
  (`model-resolver.ts`); `'inherit'` reads `ptah.llm.vscode.model`, else falls
  back to Haiku.
- Clustering: `SkillClusteringService.clusterCandidates` → `agglomerate` over
  candidate embeddings (`cosine-similarity.ts`), gated on `VecStatusService`.
  Cluster synthesis lives in `SkillSynthesizerService.synthesizeFromCluster`.
- Invocation telemetry already exists: `SkillInvocationRecorder` writes
  slug-keyed `skill_invocation_events` (sources: `tool-use`,
  `prompt-expansion`, `subagent`); `SkillScorecardService` +
  `SkillEnhancerService` (`MIN_INVOCATIONS_TO_ENHANCE`, `ENHANCE_COOLDOWN_MS`)
  consume it. There is NO join from invocation to session outcome today.

### Execution model (the Phase 0 problem)

- `SkillSynthesisService.start` (`skill-synthesis.service.ts:222`) registers a
  session-end callback that calls `analyzeSession` **inline, fire-and-forget**.
  No queue, no concurrency cap, no backoff.
- `analyzedSessions` is an in-memory `Set` cleared in `stop()` (`:277`) —
  per-process dedup ONLY. Multiple windows (multiple projects) each run their
  own `SkillSynthesisService` + own curator interval against the shared
  `~/.ptah/ptah.db`. Same session can be analyzed twice; curator work is
  duplicated N times.
- `backfillEmbeddings` is a `setTimeout(…, 5000)` fire-and-forget at start
  (`:249`).
- `cron-scheduler` provides everything needed: `CronScheduler`, `JobRunner`
  (concurrency cap), `CatchupCoordinator` (replays missed runs within
  `CATCHUP_WINDOW_MAX_MS`), `JobStore`/`RunStore` with **slot claim via unique
  constraint** (`SlotAlreadyClaimedError`, `isUniqueConstraintError`), and an
  `IPowerMonitor` port (`NoopPowerMonitor` default). Slot claim is the existing,
  correct answer to cross-window duplication.
- `SkillCuratorService` already runs on a background interval when
  `curatorEnabled`.

### Provider / auth routing (the Phase 1 gap)

- Precedent exists in memory-curator and is NOT used by skill-synthesis:
  - Settings keys `memory.curatorProvider` + `memory.curatorModel`
    (`memory-curator/src/lib/triggers/memory-trigger-config.ts:35-36`,
    defaults `''` at `:78-79`, read in `readMemoryTriggers` `:205-219`).
  - `ICuratorAuthResolver` port + `sdk-internal-query.curator-llm.ts:60`
    `resolveCuratorAuth()` builds an `OneShotAuthOverride { env, baseUrl }`
    and passes it as `auth` into `InternalQueryService.execute`.
- `InternalQueryConfig` already carries `auth?: OneShotAuthOverride`
  (`internal-query.types.ts:69`) and `outputFormat?: OutputFormat` (JSON-Schema
  constrained output with automatic SDK retry, `:61`) — **neither is used by
  skill-synthesis today**.
- Skill-synthesis's local `IInternalQuery` interface
  (`internal-query.interface.ts:11`) declares only
  `{ cwd, model, prompt, systemPromptAppend, mcpServerRunning, maxTurns,
abortController }` — it must be widened before `auth`/`outputFormat` are
  reachable. The interface is deliberately local to avoid a circular dep; keep
  it local, just widen it.
- Provider registry is data-driven (`libs/shared/src/lib/providers/provider-registry.ts:153`,
  "To add a new provider: 1. Add an entry to this array. 2. No other code
  changes required"). Registered and usable today: `openrouter`, `moonshot`
  (Kimi), `z-ai` (GLM), plus `ollama` (`entries/local-provider-entry.ts:35`,
  `authType: 'none'`, `isLocal: true`) and `ollama-cloud` (`:114`,
  Anthropic-native, `requiresProxy: false`, `supportsOptionalApiKey: true`,
  `:cloud`-suffixed models). Free-tier claim (~30K req/mo) is a source-comment
  assertion — VERIFY before planning capacity on it.
- `AnthropicProvider.defaultTiers` + `ProviderModelsService.getModelTiers` back
  bare tier resolution (`auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:327-337`).
  Reuse for "haiku tier of the selected provider" semantics rather than
  hardcoding a model id.
- **Lanes vs the main agent's auth — same mechanism, different scope.**
  `sdk-query-runner.service.ts:245` reads
  `const authEnv = input.auth?.env ?? this.authEnv;` where `this.authEnv` is
  the injected singleton `AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV` — the SAME
  `AuthEnv` the interactive chat agent uses. Because skill-synthesis never
  passes `auth`, every judge/synthesis call today runs on the main agent's
  provider, key, base URL and tiers. That is the root cause of background
  synthesis consuming foreground quota.
  The main agent additionally goes through
  `WorkspaceProviderProfileResolver.applyProviderTiers` (`:322-337`), which
  builds a per-workspace SNAPSHOT and applies
  `getModelTiers(providerId, 'mainAgent')` over `provider.defaultTiers`
  "without touching the global AuthEnv or `process.env`" (`:319-320`). The
  one-shot path has no such scoping.
  `ProviderTierScope` already distinguishes `'mainAgent' | 'cliAgent'`, and
  `ProviderModelsService.setModelTiers:495` mutates `authEnv` + `process.env`
  ONLY for `'mainAgent'` — explicitly "so that CLI sub-agent configurations
  cannot poison the main agent's runtime environment" (`:477-479`).
  **Lanes are therefore a third scope, not a parallel auth stack.** Reuse the
  scoped config keys and the snapshot pattern.
  **HARD CONSTRAINT**: a lane MUST NOT mutate the global `AuthEnv` or
  `process.env`. It builds a snapshot and passes it as `input.auth`. Violating
  this would let a background lane silently repoint the user's live chat
  session mid-conversation.
- Provider routing is ALREADY wired end-to-end and is NOT curator-specific:
  `CuratorAuthResolver` is a concrete class registered at
  `auth-providers/src/lib/di/register.ts:144` under
  `SDK_TOKENS.SDK_CURATOR_AUTH_RESOLVER`, injected `{ isOptional: true }` at
  `sdk-internal-query.curator-llm.ts:47`. Any provider in the registry works
  today; skill-synthesis simply never called it. Rename/generalize the port
  rather than adding a second parallel resolver.
- **Codex** (`@openai/codex-sdk`) does not ride the one-shot
  `SdkQueryRunner.runOneShot` path used by `InternalQueryService`, and
  `cli-agent-runtime` orchestrates the Codex CLI separately. A Codex lane is
  therefore not free — but the lane interface in Phase 1 MUST be
  provider-agnostic so a Codex lane adapter can be added later without
  reworking the lane contract. Building that adapter is a follow-up.

### Runtime / persistence facts

- `cli-engine` hosts the full backend headless in-process for `ptah-cli` and
  `ptah-tui`. It is `scope:cli`; `ptah-extension-vscode` is **structurally
  forbidden** (lint-enforced) from depending on it. Any daemon feature is
  therefore Electron/CLI-only — consistent with Thoth's existing Electron-only
  tabs.
- Memory observations are behind `@ptah-extension/memory-contracts`;
  skill-synthesis already depends on that lib.
- RPC: `SkillsSynthesisRpcHandlers` in `rpc-handlers`; prefix
  `skillSynthesis:` is already in `ALLOWED_METHOD_PREFIXES`.
- Settings shape: `SkillSynthesisSettings` (`types.ts:117+`), read in
  `SkillSynthesisService.readSettings` (`skill-synthesis.service.ts:834-926`).
- Frontend: `libs/frontend/skill-synthesis-ui` (Skills tab, VS Code +
  Electron).

## Phase 0 — Execution model: queue, cron drain, survival

Rationale: with 3–4 concurrent sessions across projects, the current inline
fire-and-forget model bursts N synthesis calls at once, steals foreground
quota, and duplicates work per window. Running the Phase 2 archaeologist under
that model would be strictly worse than today. **Phase 0 blocks Phase 2.**

1. **Enqueue instead of analyze.** Session end writes a queue row
   (`skill_synthesis_queue`: session id, workspace root, transcript path,
   source, enqueued-at, status, attempt count, claimed-by, claimed-at). No LLM
   work at session end — zero added latency, no burst.
2. **Cron drain job.** Register a `JobHandler` with `cron-scheduler` that
   drains the queue. `JobRunner` concurrency cap 1–2. Tiering:
   - inline / real-time: prefilter, hash, embedding, candidate row (cheap,
     keeps the Sessions tab live)
   - nightly: archaeologist drain, clustering, cluster synthesis, judge panel
   - weekly: replay validation, trigger retrieval eval, library collision scan,
     win-rate recompute, gap digest
3. **Slot claim replaces the in-memory Set.** Cross-window dedup comes from the
   unique-constraint claim; treat `SlotAlreadyClaimedError` /
   `isUniqueConstraintError` as success-by-other-worker. Delete reliance on
   `analyzedSessions` for correctness (keep only as a same-process fast path).
4. **Stale-claim reaping.** A row claimed by a process that died must return to
   `queued` after a TTL. Required for Tier A survival below.
5. **Gating knobs** (new `SkillSynthesisSettings` fields):
   - `foregroundBackoff` — no drain while an agent session is active. Biggest
     single win for perceived performance.
   - `maxSynthesisTokensPerDay` — persisted spent-counter, HARD stop.
   - battery gating via the existing `IPowerMonitor` port.
   - per-workspace round-robin fairness so one busy project cannot starve
     others.
   - rate-limit backoff reuses Phase 1's `unscored` status — a rate-limited
     item stays queued and retries next drain. No new machinery.
6. **Survival tiers**:
   - **Tier A (in scope)** — SQLite queue survives app close by definition;
     next launch resumes and `CatchupCoordinator` replays missed slots within
     `CATCHUP_WINDOW_MAX_MS`. Needs stale-claim reaping (item 4).
   - **Tier B (in scope, Electron only)** — suppress quit on
     `window-all-closed`, keep the drain alive behind a tray icon with a
     "pause background learning" toggle. Setting-gated, default off.
   - **Tier C (OUT OF SCOPE — follow-up task)** — `ptah daemon` drain mode on
     `cli-engine` with OS autostart (login item / Task Scheduler / launchd).
     Note it in the follow-ups section; do not build it here.
7. **DAG ordering.** Queue rows carry a stage and optional dependency so
   archaeologist → clustering → cluster synthesis → replay run in order rather
   than by implicit call sequence.
8. **Cross-project batching.** Clustering runs over ALL workspaces at once
   (skills are global under `~/.ptah/skills/`), not per-window fragments.
9. **Observability.** `JobRun` rows already record status/duration/error —
   surface them in the Activity tab instead of the bare rate-limit banner.

## Phase 1 — Trust + per-stage provider routing

1. **Judge unscored verdict.** On the three fail-open paths, do NOT fabricate
   score=10 and do NOT hard-block promotion. Introduce `unscored`: candidate
   stays pending with `judgeScore = null` and persisted `judgeReason`; the next
   pass retries it (natural retry queue, reused by Phase 0 item 5). UI renders
   an "unscored" badge, never a fabricated 10.0.
2. **Persist per-criterion scores** (novelty/actionability/scope/
   generalization/triggerClarity) on the candidate row; expose via the existing
   suggestion RPC so the UI can render a scorecard instead of one number.
3. **Per-stage provider + model routing.** Mirror the memory-curator pattern
   (`curatorProvider`/`curatorModel` + `ICuratorAuthResolver` +
   `OneShotAuthOverride`). Each stage gets an independent `{provider, model}`
   pair; unset inherits from the workspace default:
   - `skillSynthesis.archaeologist.{provider,model}` — high volume, cheap;
     local `ollama` is the intended default target
   - `skillSynthesis.synthesis.{provider,model}` — capable model
   - `skillSynthesis.judge.{provider,model}` — cheap tier
   - `skillSynthesis.replay.{provider,model}` — capable model
     Implementation: widen the local `IInternalQuery` interface with
     `auth?` and `outputFormat?`; inject an auth-resolver port
     (`{ isOptional: true }`, no-op in CLI/e2e); resolve bare tier names through
     `defaultTiers`/`ProviderModelsService` rather than hardcoding model ids.
     Migration: absent per-stage setting falls back to today's `judgeModel`
     behavior, so existing installs are unchanged.
     **Outcome: background learning moves off the foreground Anthropic quota.**
     Every registry provider works with zero registry changes — `ollama-cloud`
     (the reference setup: capable cloud models such as `glm-5.2`, `kimi-k2.7`,
     `kimi-3`), `ollama`, `z-ai`, `moonshot`, `openrouter`. Treat no provider as
     privileged; the lane contract is provider-agnostic so a Codex lane adapter
     can be added later without reworking it.

   **Lane contract** — each lane carries more than `{provider, model}`,
   because provider capability varies:
   - `structuredOutput: 'sdk' | 'parse'` — whether the lane's provider honors
     `outputFormat`. When `'parse'`, fall back to the manual extractors. The
     fallback parsers are therefore load-bearing, not belt-and-braces; do NOT
     delete them.
   - `toolUse: 'required' | 'none'` — the archaeologist needs multi-turn tool
     calling. If a lane is pointed at a model that fails tool use, degrade to
     the single-shot text path and record the reason on the queue row; never
     loop to timeout. This is a capability guard, not a judgement about any
     provider — capable cloud models on any registry provider satisfy it.
   - `timeoutMs` per lane. Today's 30s synthesis / 15s judge constants are
     global and too tight for slower endpoints. Background work tolerates long
     runs; the timeout must be lane config, not a constant.
   - `maxInputChars` per lane, sized to the model's context window, so a
     small-context endpoint receives a tighter slice instead of a hard error.
   - Auth-resolution failure (missing key for a configured lane) leaves the
     queue item `queued` with a surfaced reason. It must never throw out of
     the drain.
   - `requiresProxy: true` providers (e.g. `openrouter`) work as-is provided
     the resolver is not bypassed.

4. **Settings UI — promote the picker, do not duplicate it.**
   `CuratorModelPickerComponent`
   (`memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.ts`)
   already renders a provider select over `ANTHROPIC_PROVIDERS` plus a model
   select fed by an RPC `listModels(providerId)`. It lives in an Electron-only
   lib; `skill-synthesis-ui` ships to VS Code AND Electron, so copying it would
   fork the component and strand VS Code users.
   - Extract a generic `ptah-provider-model-picker` into `libs/frontend/ui`:
     inputs `{provider, model, label}`, a change output, and an injected
     models-loader port so each consumer supplies its own RPC.
   - Re-point `memory-curator-ui` at it and DELETE the local copy. Also delete
     its stale footer note at `curator-model-picker.component.ts:105`
     ("full provider routing coming soon") — routing has shipped.
   - Thoth > Settings tab
     (`skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts`)
     renders four instances — archaeologist / synthesis / judge / replay — each
     defaulting to "Inherit from active provider".
   - The same panel hosts the Phase 0 knobs: daily token budget, foreground
     backoff, battery gating, tray-keepalive toggle (Electron only), and drain
     schedule.
   - The general Settings view LINKS to the Thoth settings tab rather than
     duplicating the controls. One source of truth.

5. **Structured output.** Use `outputFormat` (JSON Schema) for judge and
   synthesizer instead of hand-rolled brace-matching
   (`extractJsonObject`, `skill-synthesizer.service.ts:210`) and the
   `/\{[^{}]*\}/` regex (`skill-judge.service.ts:118`). The SDK retries on
   invalid output, which removes two of the three fail-open paths at the
   source. Keep the manual parsers as a fallback for providers that ignore
   `outputFormat`.
6. **Kill prompt-echo names.** Candidates get a cheap LLM naming pass
   (name + description only) at registration when a query path is available;
   the slugified first message is retained as an internal id ONLY, never as a
   display title. UI falls back to `Captured workflow · {date}`.

## Phase 2 — Session archaeologist (replace brutal read)

Replace regex-and-truncate analysis with a tool-equipped subagent pass
producing a structured **session verdict**:

- `intent` — what the user actually wanted (not first-message echo)
- `outcome` — delivered result + evidence class (`tests-green`,
  `user-accepted`, `no-correction`, `explicit-confirmation`, `unverified`)
- `frictionMap` — correction turns, retries, dead ends, with turn indices
- `routine` — transferable workflow candidate with turn citations, or null

Constraints:

- Runs through the widened `IInternalQuery` with a bounded tool set: windowed
  JSONL read + in-session search. Do NOT hand it the raw 8k slice; it reads
  what it needs, tail-first.
- Bounded `maxTurns` (~6–8), hard timeout, `outputFormat`-constrained verdict.
- Regex heuristics DEMOTED to prefilter only (eligibility to spend tokens),
  never the success verdict.
- Runs on the `archaeologist` provider/model lane from Phase 1 — the only
  stage that scales linearly with session count, so it must be the cheapest.
- Drains from the Phase 0 queue. Never inline at session end.
- Failure sessions with eventual success are ELIGIBLE (friction-rich material)
  — deliberately widens today's smooth-success-only harvest.
- Synthesis consumes the verdict (intent + routine + citations) instead of
  truncated canonical text; canonical text stays for embedding/dedup.
- Graceful null degradation when no query path exists (falls back to the
  current extractor).

## Phase 3 — Empirical gates (replace fixed scoring)

1. **Validation-by-replay** at the cluster promotion gate: hold out one member
   session; give a fresh subagent the drafted skill + the held-out session's
   opening user prompt; plan-only dry run (no file writes); a comparator scores
   plan-vs-actual-trajectory alignment. Persisted as `replayConfidence` with
   the held-out session id as evidence. Promotion requires judge-pass AND
   (replay pass OR replay unavailable) — an evidence booster, not a hard
   blocker, until telemetry proves it stable. Cost is bounded by promotion
   candidates (2–4/week), not sessions.
2. **Trigger retrieval eval**: generate ~5 should-trigger + ~5 near-miss
   prompts; run description-only retrieval against the ACTIVE library;
   precision/recall persisted as a measured `triggerScore`, replacing the
   judged `triggerClarity` in ranking. Retrieval is local embeddings — no LLM
   cost. Also flags description collisions cosine dedup misses.
3. **Judge panel escalation**: two cheap judges; on per-criterion disagreement
   > 3 points, escalate that candidate to the synthesis-tier lane with both
   > rationales. Persist rationales for the review UI. Plain `IInternalQuery`
   > calls — do NOT import tribunal.

## Phase 4 — Proactive gap-detection curator

Nightly/weekly cron jobs (Phase 0 infrastructure) producing a ranked
**digest**:

- Session sweep vs library: succeeded sessions where a relevant skill existed
  but was never invoked → auto-suggest a description rewrite (feeds the
  existing `SkillSuggestionStore.updatePending` path).
- Friction clusters without success → skill opportunities from failure.
- Join `skill_invocation_events` → session outcome (written by the Phase 2
  archaeologist) → per-skill win-rate. Win-rate drives Recommended ranking,
  `SkillEnhancerService` auto-enhance eligibility, and dormancy demotion order
  in `SkillPromotionService`.
- Memory-conditioned relevance: query memory observations via the
  `memory-contracts` port (optional-injected) so recommendations cite the
  user's actual recurring stack/pain, not just trajectory similarity.
- Surfaced as Activity-tab entries plus a `skillSynthesis:digest` RPC for a
  "This week" panel; each item carries evidence links (session ids, counts,
  win-rates). Nudges ride the existing webview event push (`pushEvent` /
  `MESSAGE_TYPES`) — no new notification channel.

## Non-goals

- No change to hexagonal boundaries: `skill-synthesis` keeps zero direct SDK
  imports (everything through the local `IInternalQuery` + injected ports).
- No tribunal-lib dependency; "panel" is two internal-query calls.
- No new frontend lib. The extracted `ptah-provider-model-picker` goes into the
  existing `libs/frontend/ui`; the rest of the UI work stays inside
  `skill-synthesis-ui`.
- No provider is privileged. No provider-specific branching anywhere — lanes
  differ only by the declared capability fields (`structuredOutput`, `toolUse`,
  `timeoutMs`, `maxInputChars`). If a code path names a provider id, it is
  wrong.
- No Codex lane ADAPTER in this task — but the lane contract must not assume
  the one-shot Claude-SDK path, so adding one later is additive.
- No `ptah daemon` (Tier C) in this task.
- No autonomy over promotion: the user still accepts/dismisses; the system
  ranks, evidences, and nudges.

## Follow-ups (separate tasks, do not build here)

- **Tier C daemon** — `ptah daemon` drain mode on `cli-engine` + OS autostart.
  Electron/CLI only; `ptah-extension-vscode` cannot depend on `cli-engine`.
- **Codex lane adapter** — implement a lane backed by `@openai/codex-sdk` or
  the `cli-agent-runtime` Codex CLI path, satisfying the Phase 1 lane contract.
  Users who already run Codex should be able to point a lane at it.
- **Ollama Cloud free-tier verification** — confirm the ~30K req/mo figure
  asserted in `local-provider-entry.ts` before it is used for capacity
  planning or marketing. Not a blocker: the reference setup uses capable
  cloud models (`glm-5.2`, `kimi-k2.7`, `kimi-3`) on that provider.

## Acceptance criteria (per phase)

- **P0**: session end performs no LLM work (spec asserts zero query calls);
  two simulated windows draining concurrently process each session exactly once
  (slot-claim spec); stale claim returns to `queued` after TTL; drain is
  skipped while a foreground session is active and while on battery; daily
  token budget hard-stops the drain; `JobRun` rows visible in Activity.
- **P1**: a rate-limited judge run yields a pending candidate with an
  `unscored` badge and null score in the UI; per-criterion scores render for
  scored candidates; each stage resolves its own provider/model with an `auth`
  override reaching `InternalQueryService`; a lane pointed at any non-Anthropic
  registry provider issues zero Anthropic calls (spec with a stubbed resolver,
  parameterized over provider ids — not hardcoded to one); running a lane on a
  non-default provider leaves the global `AuthEnv` and `process.env` BYTE-FOR-BYTE
  unchanged (spec asserts this directly — it is the guard against a background
  lane repointing the live chat session); a lane declaring
  `structuredOutput: 'parse'` still yields a valid verdict via the fallback
  parser; a lane whose auth cannot resolve leaves its queue item `queued` with
  a surfaced reason and does not throw out of the drain; per-lane `timeoutMs`
  and `maxInputChars` are honored; the extracted picker renders in BOTH the VS
  Code webview and Electron; no raw prompt-echo titles anywhere in the Skills
  tab. Jest specs cover all three former fail-open paths.
- **P2**: archaeologist verdict persisted with turn citations; regex demoted to
  prefilter (spec proves a `"done."` tail no longer suffices when the verdict
  says `unverified`); graceful null degradation spec; archaeologist runs only
  from the queue, never inline.
- **P3**: `replayConfidence` + measured `triggerScore` persisted and displayed;
  disagreement escalation covered by a spec with a scripted judge pair.
- **P4**: digest RPC returns ranked items with evidence links; win-rate join
  covered by spec; nightly + weekly slots registered and idempotent.

## Approved decisions (Checkpoint 2, user-approved)

`implementation-plan.md` APPROVED as written. All five open questions resolved to
the architect's recommended option:

- **Q1** — one shared `'lane'` `ProviderTierScope` member (not four, not reused
  `'cliAgent'`).
- **Q2** — unresolvable lane auth STALLS: queue item returns to `queued` with a
  surfaced reason + backoff. No fallback to the foreground provider, ever —
  falling back would silently reintroduce the defect Phase 1 exists to fix.
- **Q3** — orchestrated multi-pass retrieval driven from TypeScript
  (`TranscriptWindowReader`), NOT SDK tool calling. See correction C7.
  Structured so SDK tool restriction is additive later, never a rewrite.
- **Q4** — Tier B Electron tray keep-alive SPLITS into a sixth commit. Phase 0
  ships Tier A survival plus the `skillSynthesis.trayKeepalive` setting key
  defaulted off, so the tray commit is purely additive.
- **Q5** — frequent drain tier cadence `*/15 * * * *`.

**Delivery is therefore SIX commits, not five.**

Two corrections in the plan change scope versus this document as originally
written, both verified directly against the code:

- **C6** — `IPowerMonitor` (`cron-scheduler`) exposes only `onResume`/`onSuspend`.
  It MUST be widened with `isOnBattery(): boolean` (Electron
  `powerMonitor.isOnBatteryPower()`; `NoopPowerMonitor` → `false`) or the P0
  battery-gating criterion is unbuildable.
- **C7** — `OneShotRunInput` has no `allowedTools`/`disallowedTools` and
  `buildOneShotOptions` hardcodes the full `claude_code` preset, so "a bounded
  tool set" is not available on the one-shot path. Hence Q3.

See `implementation-plan.md` §7 for the full 12 corrections.

### Decomposition questions (tasks.md §5) — orchestrator-decided

The user delegated these to the orchestrator's recommendation:

- **Q-A** — Option A: **C0 lands before C1.** Keeps B1.7 buildable as written
  (criterion P1-7 is only assertable once the drain exists). No renumbering.
  Most of C1 is still design-independent of C0; only B1.7 carries the
  cross-commit edge to B0.4.
- **Q-B** — Option A: the tray "Pause background learning" checkbox writes
  **`skillSynthesis.enabled`**, the drain's existing first gate. No new pause
  mechanism, no twelfth settings key, and the pause is honoured by every runtime
  rather than Electron alone. Accepted trade-off: pausing from the tray also
  pauses a VS Code window sharing the same `~/.ptah/settings.json`, which
  matches the user intent "stop background learning".

**Landing order: C0 → C1 → C2 → C3 → C4 → C5.**
