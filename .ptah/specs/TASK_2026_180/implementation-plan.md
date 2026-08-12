# Implementation Plan — TASK_2026_180

**Agentic skill synthesis: queued execution, provider routing, session archaeologist, replay validation, proactive curator**

Architecture pass covering Phases 0–4 in one design, sliced into five independent commits.
Every technical claim below carries a `file:line` citation into the worktree at
`D:/projects/ptah-extension/.claude-worktrees/task180/`.

---

## 1. Executive summary

Skill synthesis stops being a fire-and-forget inline pipeline and becomes a **durable
work queue drained by the existing cron scheduler**. Session end writes one row to
`skill_synthesis_queue` and returns — zero LLM work, zero added latency
(replaces the inline `analyzeSession` call at `skill-synthesis.service.ts:222-233`).
A `JobHandler` registered from `thoth-runtime` (mirroring the daily-backup handler at
`start-thoth-cron.ts:76-131`) drains that queue on three cron tiers (frequent / nightly /
weekly), gated by foreground activity, battery, and a persisted daily token budget.
Cross-window duplication dies at two layers: `job_runs UNIQUE(job_id, scheduled_for)`
(`0004_cron.ts:28`) means only one window runs a given slot, and a compare-and-swap
claim on each queue row covers manual/catchup overlap.

Every LLM call moves onto a **lane** — a declared capability record
(`{provider, model, structuredOutput, toolUse, timeoutMs, maxInputChars, maxPasses}`)
resolved through the _existing_ curator auth chain, generalized rather than duplicated:
`ICuratorAuthResolver` → `IProviderAuthResolver`, `CuratorAuthResolver` →
`ProviderAuthResolver`, and a third `ProviderTierScope` member `'lane'`. A lane produces
an `OneShotAuthOverride` snapshot passed as `input.auth`; `SdkQueryRunner` already reads
`input.auth?.env ?? this.authEnv` (`sdk-query-runner.service.ts:245`) and **never writes**
`process.env` or the injected `AuthEnv` — verified: `process.env` appears exactly once in
that file, as a read. Global mutation only ever happens in
`ProviderModelsService.setModelTier`/`applyPersistedTiers`, which lanes must never call.

On that foundation: Phase 1 kills the three fail-open `score: 10` paths
(`skill-judge.service.ts:124,152,176`) in favour of a nullable `judge_score` +
`unscored` state, persists per-criterion scores, and replaces the prompt-echo slug
(`trajectory-extractor.ts:136-138`) with a cheap naming pass. Phase 2 replaces the regex
success verdict with a **session archaeologist** producing a structured
`skill_session_verdicts` row. Phase 3 adds replay confidence and a measured trigger score.
Phase 4 joins `skill_invocation_events.session_id` → `skill_session_verdicts.evidence_class`
for a per-skill win rate driving a ranked digest.

---

## 2. Cross-phase data model

This is the section that had to be designed once, up front. Three facts force it:
Phase 0's queue rows carry a `stage` whose members are defined by Phases 2–4; a SQLite
`CHECK` constraint **cannot be extended without a table rebuild**; and Phase 4's win-rate
join needs a column Phase 2 writes. So migration `0032` enumerates every stage and status
for all five phases, even though only some are exercised in commit 0.

**Current highest migration is `31` (`0031_task_specs_metadata`, `migrations/index.ts:255-259`).**
New migrations start at `0032`. Registry entry shape and the `export const sql = \`...\``file
convention are documented at`migrations/index.ts:62-110`; SQL **must** be static text
(ESLint `no-template-curly-in-migration`+ Semgrep`sql-injection-in-migration`,
`index.ts:14-18`). The runner applies each version exactly once inside `BEGIN IMMEDIATE`
(`migration-runner.ts:242-261`), so bare `ALTER TABLE … ADD COLUMN`is the sanctioned
pattern — precedent`0030_skill_event_metrics.ts:13-24`, `0031:23-32`.

### 2.1 Migration map

| Migration                            | Phase | Contents                                                                              |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------- |
| `0032_skill_synthesis_queue`         | 0     | `skill_synthesis_queue`, `skill_synthesis_workspace_cursor`, `skill_synthesis_budget` |
| `0033_skill_candidate_verdicts`      | 1     | judge columns + `display_name` on `skill_candidates`                                  |
| `0034_skill_session_verdicts`        | 2     | `skill_session_verdicts`                                                              |
| `0035_skill_empirical_gates`         | 3     | replay + trigger-eval columns on `skill_candidates`                                   |
| `0036_skill_invocation_session_join` | 4     | `workspace_root` column + `session_id` index on `skill_invocation_events`             |

All five are additive. **Existing installs are unchanged when the new settings are absent**
because (a) every new column is nullable or carries a DEFAULT — `registerCandidate`'s fixed
14-column INSERT (`skill-candidate.store.ts:130-137`) is untouched, exactly as `pinned`
(`0011_skills_v2.ts:2`) and `residency` (`0026_skill_residency.ts:11`) already rely on;
(b) the lane resolver returns `{auth: undefined, model: resolveJudgeModel(settings.judgeModel, ws)}`
when both lane `provider` and `model` are `''`, which is byte-identical to today's call
(`skill-judge.service.ts:59`, `skill-synthesizer.service.ts:107-110`).

### 2.2 `skill_synthesis_queue` (0032)

```sql
CREATE TABLE IF NOT EXISTS skill_synthesis_queue (
  id               TEXT PRIMARY KEY,          -- ULID
  session_id       TEXT NOT NULL,
  workspace_root   TEXT NOT NULL DEFAULT '',  -- round-robin fairness key
  transcript_path  TEXT,                      -- subagent transcripts live off-session
  source           TEXT NOT NULL,             -- AnalyzeSource (skill-synthesis.service.ts:69-75)
  stage            TEXT NOT NULL CHECK (stage IN (
                     'prefilter','archaeology','synthesis','embedding',
                     'clustering','cluster-synthesis','judge','judge-panel',
                     'replay','trigger-eval','digest')),
  depends_on       TEXT REFERENCES skill_synthesis_queue(id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN (
                     'queued','claimed','running','done','failed',
                     'unscored','skipped')),
  turn_count       INTEGER NOT NULL DEFAULT 0,  -- re-open gate; replaces analyzedSessions Map
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  enqueued_at      INTEGER NOT NULL,
  not_before       INTEGER NOT NULL DEFAULT 0,  -- backoff / retry gate (epoch ms)
  claimed_by       TEXT,                        -- worker id: `${pid}:${bootUlid}`
  claimed_at       INTEGER,                     -- heartbeated; drives stale reaping
  finished_at      INTEGER,
  lane             TEXT,                        -- SkillLaneId this stage needs
  reason           TEXT,                        -- SHORT, user-facing; rendered in Activity
  last_error       TEXT,                        -- diagnostic, not user-facing
  candidate_id     TEXT,                        -- set once the stage produces one
  payload          TEXT NOT NULL DEFAULT '{}',  -- JSON, stage-specific
  UNIQUE(session_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_ssq_drain
  ON skill_synthesis_queue(status, not_before, workspace_root);
CREATE INDEX IF NOT EXISTS idx_ssq_stale
  ON skill_synthesis_queue(status, claimed_at);
CREATE INDEX IF NOT EXISTS idx_ssq_session
  ON skill_synthesis_queue(session_id);

CREATE TABLE IF NOT EXISTS skill_synthesis_workspace_cursor (
  workspace_root  TEXT PRIMARY KEY,
  last_drained_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_synthesis_budget (
  day_key       TEXT PRIMARY KEY,   -- 'YYYY-MM-DD' UTC
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
```

**Stage DAG.** `depends_on` is a self-reference to another queue row. The drain's
eligibility predicate joins it:

```sql
SELECT q.* FROM skill_synthesis_queue q
LEFT JOIN skill_synthesis_queue d ON d.id = q.depends_on
WHERE q.status IN ('queued','unscored')
  AND q.not_before <= :now
  AND (q.depends_on IS NULL OR d.status = 'done')
  AND q.workspace_root = :root
ORDER BY q.enqueued_at ASC
LIMIT :perWorkspaceBatch;
```

Canonical chains:
`prefilter → archaeology → synthesis → embedding` (per session, Phases 0–2);
`clustering → cluster-synthesis → judge → judge-panel → replay` (per cluster, Phases 0/3,
`workspace_root = ''` because clustering is cross-project — Phase 0 item 8);
`trigger-eval` and `digest` are dependency-free weekly roots (Phases 3/4).

**Enqueue is idempotent, and it is NOT the at-most-once primitive.** One
`db.transaction`: plain `INSERT`; on `isUniqueConstraintError` fall through to a guarded
re-open `UPDATE … SET status='queued', turn_count=?, attempt_count=0, claimed_by=NULL,
claimed_at=NULL, not_before=0 WHERE session_id=? AND stage=? AND status IN
('done','failed','unscored','skipped') AND turn_count < ?`. This preserves today's
"re-analyze only once the session grew" semantics (`skill-synthesis.service.ts:365-372`)
**durably and cross-window**, which the in-memory `Map` never did. No `INSERT OR IGNORE`,
no UPSERT — matching the rule stated at `run.store.ts:6-9`.

**Claiming IS the at-most-once primitive**, expressed as a compare-and-swap because the
row pre-exists (unlike `job_runs`, where the insert _is_ the claim):

```sql
UPDATE skill_synthesis_queue
   SET status='claimed', claimed_by=:worker, claimed_at=:now,
       attempt_count = attempt_count + 1
 WHERE id=:id AND status IN ('queued','unscored');
```

`stmt.run().changes === 0` ⇒ another worker won; treat as success-by-other-worker and move
on, exactly as `JobRunner` treats `SlotAlreadyClaimedError` (`job-runner.ts:119-125`).
Wrapped in `BEGIN IMMEDIATE` so the CAS is cross-process atomic on the shared
`~/.ptah/ptah.db`.

**Stale-claim reaping** runs at the head of every drain _and_ at
`SkillSynthesisService.start()`:

```sql
UPDATE skill_synthesis_queue
   SET status='queued', claimed_by=NULL, claimed_at=NULL,
       reason='reclaimed after stale claim TTL'
 WHERE status IN ('claimed','running') AND claimed_at < :now - :ttlMs;
```

A live worker calls `touchClaim(id)` (refreshes `claimed_at`) between archaeologist passes
so a long legitimate run is never reaped. Default TTL 15 min, and the drain asserts at
startup that `staleClaimTtlMs >= 3 × max(lane.timeoutMs)`.

**`unscored` is deliberately overloaded, and the two meanings must not be conflated:**

- `skill_candidates.judge_status = 'unscored'` — the candidate has no trustworthy score.
  This is what the UI badge renders.
- `skill_synthesis_queue.status = 'unscored'` — the stage ran and produced no usable
  verdict; the row stays re-eligible (`not_before` gates the retry). This is Phase 0's
  rate-limit backoff mechanism with **no new machinery**, exactly as context.md item 5 asks.

**Fairness.** The drain never orders globally by `enqueued_at`. It reads distinct eligible
`workspace_root` values ordered by `skill_synthesis_workspace_cursor.last_drained_at ASC`
(missing cursor = 0 = highest priority), takes at most `perWorkspaceBatch` (default 1)
items from each, and stops at `maxItemsPerRun` (default 4), bumping each visited root's
cursor. One busy project therefore cannot starve others.

### 2.3 `skill_candidates` additions

`0033` (Phase 1):

```sql
ALTER TABLE skill_candidates ADD COLUMN judge_score           REAL;    -- NULL ⇒ unscored
ALTER TABLE skill_candidates ADD COLUMN judge_status          TEXT;    -- 'scored'|'unscored'|'disabled'
ALTER TABLE skill_candidates ADD COLUMN judge_reason          TEXT;
ALTER TABLE skill_candidates ADD COLUMN judge_novelty         REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_actionability   REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_scope           REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_generalization  REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_trigger_clarity REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_panel_rationales TEXT;   -- JSON []; Phase 3 fills it
ALTER TABLE skill_candidates ADD COLUMN judged_at             INTEGER;
ALTER TABLE skill_candidates ADD COLUMN display_name          TEXT;    -- LLM naming pass
CREATE INDEX IF NOT EXISTS idx_skill_candidates_judge
  ON skill_candidates(status, judge_status);
```

`judge_panel_rationales` is created in `0033` rather than `0035` because it is a judge
column and belongs with its siblings; Phase 3 only starts writing it.

`0035` (Phase 3):

```sql
ALTER TABLE skill_candidates ADD COLUMN replay_confidence         REAL;
ALTER TABLE skill_candidates ADD COLUMN replay_holdout_session_id TEXT;
ALTER TABLE skill_candidates ADD COLUMN replay_at                 INTEGER;
ALTER TABLE skill_candidates ADD COLUMN trigger_score             REAL;  -- measured; replaces judged triggerClarity in ranking
ALTER TABLE skill_candidates ADD COLUMN trigger_precision         REAL;
ALTER TABLE skill_candidates ADD COLUMN trigger_recall            REAL;
ALTER TABLE skill_candidates ADD COLUMN trigger_eval_at           INTEGER;
```

Each migration must also extend `RawCandidateRow` (`skill-candidate.store.ts:37-54`) and
`toCandidateRow` (`:871-899`) — reads use `SELECT *`, so a column is invisible to the store
until both are updated. New writes go through the existing dynamic-fragment pattern in
`updateStatus` (`:304-323`); add a sibling `recordJudgeVerdict(id, verdict)` /
`recordReplay(id, …)` / `recordTriggerEval(id, …)` rather than overloading `updateStatus`.

`skill_suggestions.judge_score` is `REAL NOT NULL` (`0025_skill_suggestions.ts:16`). It
stays non-null; an unscored _suggestion_ is simply not created (the cluster stays queued).
Only the candidate score is nullable.

### 2.4 `skill_session_verdicts` (0034, Phase 2)

```sql
CREATE TABLE IF NOT EXISTS skill_session_verdicts (
  session_id      TEXT PRIMARY KEY,
  workspace_root  TEXT NOT NULL DEFAULT '',
  intent          TEXT,                        -- NULL ⇒ degraded run
  outcome         TEXT,
  evidence_class  TEXT CHECK (evidence_class IN (
                    'tests-green','user-accepted','no-correction',
                    'explicit-confirmation','unverified')),
  friction_map    TEXT NOT NULL DEFAULT '[]',  -- JSON [{turnIndex,kind,note}]
  routine         TEXT,                        -- JSON {summary,steps[],citations:number[]} or NULL
  turn_count      INTEGER NOT NULL DEFAULT 0,
  lane            TEXT,
  model           TEXT,
  passes          INTEGER NOT NULL DEFAULT 0,
  degraded_reason TEXT,                        -- non-NULL ⇒ null-degradation path taken
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ssv_ws       ON skill_session_verdicts(workspace_root, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssv_evidence ON skill_session_verdicts(evidence_class);
```

Nullability contract: `intent`, `outcome`, `evidence_class`, `routine` are all nullable.
A row with `degraded_reason NOT NULL` and `intent IS NULL` is the graceful-degradation
record — it exists so the drain does not re-attempt indefinitely and so the UI can say
_why_ there is no verdict.

### 2.5 The invocation → session-outcome join (0036, Phase 4)

```sql
ALTER TABLE skill_invocation_events ADD COLUMN workspace_root TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_session
  ON skill_invocation_events(session_id);
```

`skill_invocation_events.session_id` already exists (`0021:5`, `TEXT NOT NULL`) but carries
**no index** — the only indexes are on `skill_slug`, `context_id`,
`(skill_slug, source, reconciled_at)` and `(skill_slug, task_id)`. `workspace_root` does
**not** exist: `SkillInvocationRecorder.recordSkillEvent` accepts it in
`RecordSkillEventInput` (`skill-invocation-recorder.ts:10-22`) and then silently drops it
before calling the store (`:45-55`). Phase 4 threads it through.

Win-rate query:

```sql
SELECT e.skill_slug,
       COUNT(*) AS invocations,
       SUM(CASE WHEN v.evidence_class IN
             ('tests-green','user-accepted','explicit-confirmation')
           THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN v.session_id IS NULL OR v.evidence_class = 'unverified'
           THEN 1 ELSE 0 END) AS unknown
FROM skill_invocation_events e
LEFT JOIN skill_session_verdicts v ON v.session_id = e.session_id
GROUP BY e.skill_slug;
```

`winRate = wins / (invocations - unknown)`, **`null` when the denominator is 0** — never
`0`, so an unmeasured skill is not ranked below a measured loser. `no-correction` counts
as neither win nor unknown (it is weak evidence of success and is deliberately excluded
from the numerator).

---

## 3. The lane contract

### 3.1 Types (new file `libs/backend/skill-synthesis/src/lib/lanes/lane.types.ts`)

```ts
export type SkillLaneId = 'archaeologist' | 'synthesis' | 'judge' | 'replay';

export interface SkillLaneConfig {
  readonly id: SkillLaneId;
  /** Registry provider id, or '' = inherit the active workspace provider.
   *  NEVER compared against a literal provider id anywhere in the codebase. */
  readonly provider: string;
  /** Concrete model id, a bare tier alias, or '' = fall back (see resolveLaneModel). */
  readonly model: string;
  /** Bare tier used when `model` is '' and a provider IS configured. */
  readonly defaultTier: 'haiku' | 'sonnet' | 'opus';
  /** Whether this lane's endpoint honours `outputFormat`. */
  readonly structuredOutput: 'sdk' | 'parse';
  /** Whether this lane may run the multi-pass retrieval loop. */
  readonly toolUse: 'required' | 'none';
  readonly timeoutMs: number;
  readonly maxInputChars: number;
  readonly maxPasses: number;
}

/** Structural mirror of agent-sdk's OneShotAuthOverride. Declared locally for the
 *  same reason IInternalQuery is (internal-query.interface.ts:1-9): no circular dep.
 *  `string | undefined` is LOAD-BEARING — see risk R2. */
export interface LaneAuthOverride {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly baseUrl?: string;
}

export interface ResolvedSkillLane {
  readonly config: SkillLaneConfig;
  /** undefined ⇒ ride the active provider (no provider configured, or the
   *  configured provider IS the active one — the resolver returns null then). */
  readonly auth: LaneAuthOverride | undefined;
  /** Value handed to IInternalQuery.model. */
  readonly model: string;
}

export type SkillLaneFailureKind = 'auth-unresolvable' | 'structured-output-unsupported' | 'tool-use-unsupported' | 'timeout';

export interface SkillLaneFailure {
  readonly kind: SkillLaneFailureKind;
  /** SHORT, user-facing. Written verbatim to skill_synthesis_queue.reason. */
  readonly reason: string;
  readonly retryAfterMs: number;
}

export type SkillLaneResolution = { readonly ok: true; readonly lane: ResolvedSkillLane } | { readonly ok: false; readonly failure: SkillLaneFailure };
```

### 3.2 Widened `IInternalQuery`

`libs/backend/skill-synthesis/src/lib/internal-query.interface.ts` — keep the file local
(its header at `:1-9` explains why), add three things:

```ts
export interface IInternalQuery {
  execute(config: {
    cwd: string;
    model: string;
    prompt: string;
    systemPromptAppend?: string;
    mcpServerRunning: boolean;
    maxTurns: number;
    abortController?: AbortController;
    /** Per-call provider snapshot. MUST NOT be applied globally. */
    auth?: LaneAuthOverride;
    /** JSON-Schema constrained output; SDK retries invalid output. */
    outputFormat?: { readonly type: 'json_schema'; readonly schema: Record<string, unknown> };
  }): Promise<{
    stream: AsyncIterable<{
      type: string;
      subtype?: string;
      message?: { content?: Array<{ type: string; text?: string }> };
      /** Present on the `result` message when outputFormat was honoured. */
      structured_output?: unknown;
      result?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      total_cost_usd?: number;
    }>;
    abort(): void;
    close(): void;
  }>;
}
```

Verified assignable: `InternalQueryConfig` already declares `outputFormat?: OutputFormat`
(`internal-query.types.ts:61`) and `auth?: OneShotAuthOverride` (`:69`);
`InternalQueryService.execute` is a pure field-by-field forward to
`SdkQueryRunner.runOneShot` (`internal-query.service.ts`, whole file is 33 lines);
`OutputFormat = { type: 'json_schema'; schema: Record<string, unknown> }`
(vendor `sdk.d.ts:903,1904`); `usage`/`total_cost_usd`/`structured_output` are read off the
`result` message today at `sdk-stream-processor.ts:77-119`.

### 3.3 Resolution chain — generalize, do not duplicate

The chain that already works end-to-end and is **not** curator-specific:

1. settings keys → 2. `ICuratorAuthResolver.resolve(providerId)` (port declared in
   **agent-sdk**, `curator-llm-adapter/curator-auth-resolver.port.ts`, 5 lines) →
2. `CuratorAuthResolver` (impl in **auth-providers**,
   `auth/curator-auth-resolver.ts:83-118`, five-way dispatch off
   `resolveStrategy('thirdParty', provider)` — direct-anthropic / cli / proxy /
   local-native / third-party-key) → 4. `InternalQueryService.execute` → 5.
   `SdkQueryRunner.buildOneShotOptions:245`.

Renames (one commit, all call sites updated, **no compatibility alias**):

| Before                                                                          | After                                                                             | File                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ICuratorAuthResolver`                                                          | `IProviderAuthResolver`                                                           | `agent-sdk/src/lib/auth/provider-auth-resolver.port.ts` (moved)               |
| `SDK_TOKENS.SDK_CURATOR_AUTH_RESOLVER` = `Symbol.for('SdkCuratorAuthResolver')` | `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER` = `Symbol.for('SdkProviderAuthResolver')` | `agent-sdk/src/lib/di/tokens.ts:77`                                           |
| `CuratorAuthResolver`                                                           | `ProviderAuthResolver`                                                            | `auth-providers/src/lib/auth/provider-auth-resolver.ts`                       |
| `CuratorAuthError` (name `'CuratorAuthError'`)                                  | `ProviderAuthError` (name `'ProviderAuthError'`)                                  | same file; update the name check at `sdk-internal-query.curator-llm.ts:36,86` |
| `buildCuratorEnv`                                                               | `buildLaneEnv`                                                                    | same file, `:317-323` — **semantics unchanged**                               |
| `buildTierValues(providerId)`                                                   | `buildTierValues(providerId, scope)`                                              | `:255-279`, forwards `scope` to `getModelTiers`                               |

Port signature widens by one **optional** parameter, so the existing curator call site
(`sdk-internal-query.curator-llm.ts:80`) compiles unchanged and behaves identically:

```ts
export interface IProviderAuthResolver {
  resolve(providerId: string, scope?: ProviderTierScope): Promise<OneShotAuthOverride | null>;
}
```

**Third tier scope.** `ProviderTierScope` (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts:23`)
gains `'lane'`: `'mainAgent' | 'cliAgent' | 'lane'`. This is the single cheapest correct
move in the whole plan, because `ProviderModelsService.setModelTier` already guards its
`this.authEnv[envVar] = …; process.env[envVar] = …` writes with
`if (scope === 'mainAgent')` (`provider-models.service.ts:495-500`) — so a `'lane'` scope
is **inert with respect to globals for free**, by construction rather than by discipline.
`getModelTiers(id, 'lane')` reads `provider.<id>.lane.modelTier.<tier>`; with nothing
persisted it returns all-nulls and `buildTierValues` falls back to
`provider.defaultTiers` (`:266-268`) — which is precisely the "haiku tier of the selected
provider" semantics context.md asks for, with no hardcoded model id anywhere.

One shared `'lane'` scope serves all four lanes; per-lane model pinning is expressed by the
lane's own `model` setting, not by four tier scopes. (Open question Q1.)

**Model resolution** (`lanes/lane-resolver.service.ts`):

```ts
function resolveLaneModel(cfg: SkillLaneConfig, settings: SkillSynthesisSettings, ws: IWorkspaceProvider): string {
  if (cfg.model.trim()) return cfg.model.trim();
  if (!cfg.provider.trim()) return resolveJudgeModel(settings.judgeModel, ws); // legacy inherit
  return cfg.defaultTier; // bare tier alias
}
```

Three lines, zero provider-id branching, and line 2 is the untouched-existing-installs
guarantee (`model-resolver.ts:20-35`). A bare tier alias is the _correct_ value to send:
per `sdk-internal-query.curator-llm.ts:38-55`, a bare alias resolves through both
`ANTHROPIC_DEFAULT_<TIER>_MODEL` and the provider entry's `defaultTiers`, whereas a pinned
dated Claude id 404s against a non-Anthropic endpoint.

### 3.4 The four failure modes

| Kind                                | Detection                                                                                                                                                             | Required behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auth-unresolvable`**             | resolver throws `ProviderAuthError` for a **non-empty** configured provider                                                                                           | Queue row returns to `status='queued'`, `not_before = now + 30 min`, `reason = "Lane <id>: <message>"`. **The drain catches this and continues to the next item — it must never propagate out of `drain()`.** The lane does **not** silently fall back to the active provider. This is a deliberate divergence from the memory curator, which does fall back (`sdk-internal-query.curator-llm.ts:84-91`): falling back here would put background work straight back onto the foreground quota, i.e. the exact defect Phase 1 exists to fix. Document the divergence in `skill-synthesis/CLAUDE.md`. |
| **`structured-output-unsupported`** | lane declares `structuredOutput: 'parse'`; **or** `'sdk'` was declared but the `result` message carried no `structured_output` and `JSON.parse(message.result)` threw | Re-run the same prompt **without** `outputFormat`, parse with the manual extractors. `extractJsonObject` (`skill-synthesizer.service.ts:210-231`) and the judge's `/\{[^{}]*\}/` (`skill-judge.service.ts:118`) are **load-bearing and must not be deleted** — they are the only path for a `'parse'` lane. If the fallback also fails: stage → `unscored`, candidate `judge_status='unscored'`. Cost guard: at most one re-run per item per drain.                                                                                                                                                 |
| **`tool-use-unsupported`**          | lane declares `toolUse: 'none'`; **or** pass 1 of the archaeologist ends with `subtype === 'error_max_turns'` or returns no parseable `requestTurns`                  | Collapse to a **single tail-window pass** (`maxPasses = 1`). Persist `degraded_reason='tool-use-unsupported'` on the verdict and `reason` on the queue row. **Never loop to timeout.** This is a capability guard, not a judgement about any provider.                                                                                                                                                                                                                                                                                                                                              |
| **`timeout`**                       | per-lane `AbortController` fires after `cfg.timeoutMs`                                                                                                                | `abort()`, `handle.close()`, queue → `queued`, `not_before = now + min(2^attempt × 60 s, 6 h)`. At `attempt_count >= maxAttempts` (default 5) → `status='failed'`, `last_error` set, one Activity event.                                                                                                                                                                                                                                                                                                                                                                                            |

`timeoutMs` and `maxInputChars` become **parameters**, replacing the module constants
`JUDGE_TIMEOUT_MS = 15_000` (`skill-judge.service.ts:26`),
`SYNTHESIS_TIMEOUT_MS = 30_000` (`skill-synthesizer.service.ts:15`), the `8000`/`3000`
slices (`skill-synthesizer.service.ts:193,151`) and the `3000` body slice
(`skill-judge.service.ts:69`). When a slice truncates, append a `…(truncated)…` marker and
set `payload.truncated = true` on the queue row.

`requiresProxy: true` providers (e.g. `openrouter`) work unchanged: `resolve()` routes them
through `resolveProxyProvider` → `CuratorProxyManager.ensureProxy`
(`curator-auth-resolver.ts:167-186`). The only requirement is that lanes never bypass the
resolver.

---

## 4. Per-phase implementation plan

### Phase 0 — Execution model: queue, cron drain, survival

**Commit boundary:** may land in parallel with Phase 1. **Blocks Phase 2.**

**Created**

- `libs/backend/persistence-sqlite/src/lib/migrations/0032_skill_synthesis_queue.ts` (+ spec) — §2.2. Register in `migrations/index.ts` `MIGRATIONS`.
- `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.ts` (+ spec) — `enqueue`, `tryClaim` (CAS), `touchClaim`, `markDone/Failed/Unscored/Skipped`, `reapStale`, `listEligibleWorkspaces`, `listEligible(root, limit)`, `listRecent(limit)`.
- `libs/backend/skill-synthesis/src/lib/queue/skill-queue.types.ts` — `SkillQueueStage`, `SkillQueueStatus`, `SkillQueueRow`, `EnqueueInput`.
- `libs/backend/skill-synthesis/src/lib/queue/skill-budget.store.ts` (+ spec) — `spentToday()`, `record(usage)`, UTC day rollover.
- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts` (+ specs) — the whole drain. Signature:
  ```ts
  drain(opts: {
    tier: 'frequent' | 'nightly' | 'weekly';
    signal: AbortSignal;
    onBattery: boolean;            // supplied by the caller, see below
  }): Promise<DrainSummary>;       // never throws
  ```
- `libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.ts` (+ spec) — subscribes to `SessionActivityRegistry` (`Symbol.for('SdkSessionActivityRegistry')`, `agent-sdk/src/lib/di/tokens.ts:46`) and exposes `msSinceLastActivity()`. The registry is push-only (`session-activity-registry.ts:55-57`) — it has no "is active" query — so this five-line stateful tracker is required. No new port.

**Modified**

- `skill-synthesis.service.ts:222-233` — the session-end callback **enqueues** instead of calling `analyzeSession`. This is the P0 acceptance criterion "session end performs no LLM work".
- `skill-synthesis.service.ts:249-264` — `backfillEmbeddings` loses its `setTimeout(…, 5000)`; it becomes an `embedding`-stage drain item.
- `skill-synthesis.service.ts:111,277,354-372` — `analyzedSessions` Map keeps its role as a same-process fast path only; correctness moves to `UNIQUE(session_id, stage)` + `turn_count`.
- `libs/backend/cron-scheduler/src/lib/power-monitor.interface.ts` — widen `IPowerMonitor` with `isOnBattery(): boolean`; `NoopPowerMonitor.isOnBattery()` returns `false`. **Required** — see Correction C6.
- `apps/ptah-electron/src/services/platform/electron-power-monitor.ts` — implement `isOnBattery()` as `powerMonitor.isOnBatteryPower()`.
- `libs/backend/persistence-sqlite/src/lib/…` — **move** `isUniqueConstraintError` here from `cron-scheduler/src/lib/run.store.ts:49-53` and update `run.store.ts` + its spec to import it. It is a pure better-sqlite3 concern and both libs already depend on `persistence-sqlite`; this is what lets `skill-synthesis` reuse it **without depending on `cron-scheduler`**.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` — register three handlers + upsert three jobs, in the exact shape of the daily-backup block at `:76-131`. The handler closure resolves `CRON_TOKENS.CRON_POWER_MONITOR` and `SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE` from the container and calls `drain({tier, signal: ctx.signal, onBattery: monitor.isOnBattery()})`. **`skill-synthesis` therefore never imports `cron-scheduler`** — the same seam `thoth-runtime` already provides for backups.
  - `@ptah/skills-drain-frequent`, `*/15 * * * *`, `handler:skills:drain:frequent`
  - `@ptah/skills-drain-nightly`, `0 3 * * *`, `handler:skills:drain:nightly`
  - `@ptah/skills-drain-weekly`, `0 4 * * 0`, `handler:skills:drain:weekly`
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:366-380` — same registration for the CLI tier.
- `libs/backend/platform-core/src/file-settings-keys.ts` — add the keys below to both the key list (~`:114-133`) and `FILE_BASED_SETTINGS_DEFAULTS` (~`:266+`).
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.{handlers,schema}.ts` — add `skillSynthesis:queue`.
- `libs/shared/src/lib/types/rpc.types.ts` — contract for `skillSynthesis:queue` (add to the method map ~`:1631` and the allow-map ~`:2990`).

**New DI tokens** (`skill-synthesis/src/lib/di/tokens.ts`, registered in `di/register.ts`):
`SKILL_QUEUE_STORE` = `Symbol.for('PtahSkillSynthesisQueueStore')`,
`SKILL_BUDGET_STORE` = `Symbol.for('PtahSkillSynthesisBudgetStore')`,
`SKILL_DRAIN_SERVICE` = `Symbol.for('PtahSkillSynthesisDrainService')`,
`FOREGROUND_ACTIVITY_TRACKER` = `Symbol.for('PtahSkillForegroundActivityTracker')`;
plus cross-lib `SESSION_ACTIVITY_REGISTRY_TOKEN = Symbol.for('SdkSessionActivityRegistry')`
declared the same way as `INTERNAL_QUERY_SERVICE_TOKEN` (`di/tokens.ts:17-19`), injected
`{isOptional: true}`.

**New settings** (flat, added to `SkillSynthesisSettingsSchema` in
`skills-synthesis-rpc.schema.ts` so the schema-driven `getSettings` loop at
`skills-synthesis-rpc.handlers.ts:428-441` picks them up automatically):

| Key                                        | Default          | Notes           |
| ------------------------------------------ | ---------------- | --------------- |
| `skillSynthesis.drain.cronExpr`            | `'*/15 * * * *'` | frequent tier   |
| `skillSynthesis.drain.nightlyCronExpr`     | `'0 3 * * *'`    |                 |
| `skillSynthesis.drain.weeklyCronExpr`      | `'0 4 * * 0'`    |                 |
| `skillSynthesis.drain.maxItemsPerRun`      | `4`              |                 |
| `skillSynthesis.drain.perWorkspaceBatch`   | `1`              | fairness        |
| `skillSynthesis.drain.foregroundBackoffMs` | `300000`         | 0 disables      |
| `skillSynthesis.drain.pauseOnBattery`      | `true`           |                 |
| `skillSynthesis.drain.maxAttempts`         | `5`              |                 |
| `skillSynthesis.drain.staleClaimTtlMs`     | `900000`         |                 |
| `skillSynthesis.budget.maxTokensPerDay`    | `2000000`        | `0` = unlimited |
| `skillSynthesis.trayKeepalive`             | `false`          | Electron only   |

There is **no** `queueEnabled` flag. Phase 0 _replaces_ the inline path; a dual path would
be exactly the parallel-implementation pattern the brief forbids. `skillSynthesis.enabled`
remains the master switch.

**Drain gate order** (each yields a `skipped` `DrainSummary` with a reason, never an
exception): `enabled` → `budget.spentToday >= maxTokensPerDay` →
`pauseOnBattery && onBattery` → `msSinceLastActivity() < foregroundBackoffMs` → reap stale
→ per-workspace round-robin selection → per-item CAS claim → stage dispatch.

**Tier A survival** is free: the queue is SQLite, so it survives app close by definition;
`CatchupCoordinator.replayMissed` already runs before timers are armed
(`cron-scheduler.ts:97-103`) and replays missed slots within `CATCHUP_WINDOW_MAX_MS`;
stale-claim reaping at `start()` returns rows orphaned by a hard kill.

**Tier B (Electron only, default off)** — `apps/ptah-electron/src/main.ts:161-165` currently
`app.quit()`s on `window-all-closed` for non-darwin, and **there is no tray anywhere in the
app** (grep: zero `Tray` references). Tier B therefore means a genuinely new tray surface:
a `Tray` with a "Pause background learning" checkbox and "Quit Ptah", gated on
`skillSynthesis.trayKeepalive`. When the flag is off, `window-all-closed` behaviour is
byte-identical to today. Scope note: this is the single largest net-new UI in Phase 0 —
Open question Q4 asks whether to defer it.

**Tier C is out of scope** (`ptah daemon` on `cli-engine`) — `cli-engine` is `scope:cli`
and `ptah-extension-vscode` is lint-forbidden from depending on it.

---

### Phase 1 — Trust + per-stage provider routing

**Commit boundary:** may land in parallel with Phase 0; consumed by Phases 2 and 3.

**Created**

- `migrations/0033_skill_candidate_verdicts.ts` (+ spec) — §2.3.
- `skill-synthesis/src/lib/lanes/lane.types.ts` — §3.1.
- `skill-synthesis/src/lib/lanes/skill-lane-config.ts` — `SKILL_LANE_KEYS`, `SKILL_LANE_DEFAULTS`, `SKILL_LANE_PREFIXES`, `readSkillLanes(ws)`, `flattenSkillLanes(partial)`. **Direct structural copy of `triggers/skill-trigger-config.ts`** (`:6-24`, `:26-44`, `:46-54`, `:73-140`, `:142-166`) — that file is the house pattern for dotted settings sub-trees, and `skillSynthesis.triggers.*` keys already exist in `file-settings-keys.ts:143-149`, proving dotted keys work.
- `skill-synthesis/src/lib/lanes/lane-resolver.service.ts` (+ spec) — `resolve(laneId): Promise<SkillLaneResolution>`; injects `PROVIDER_AUTH_RESOLVER_TOKEN` `{isOptional: true}` (no-op in CLI/e2e, matching `sdk-internal-query.curator-llm.ts:47`).
- `skill-synthesis/src/lib/lanes/lane-runner.service.ts` (+ spec) — one place that owns: build `AbortController` + `cfg.timeoutMs` timer, call `internalQuery.execute` with `auth`/`outputFormat`, drain the stream, apply the structured-output→manual-parse ladder, record usage into `SkillBudgetStore`, map thrown/aborted outcomes to `SkillLaneFailure`. Every stage goes through it; no stage builds its own timeout again.
- `skill-synthesis/src/lib/naming/candidate-namer.service.ts` (+ spec) — cheap `{name, description}`-only pass on the `judge` lane; writes `display_name`.
- `libs/frontend/ui/src/lib/native/provider-model-picker/` — `provider-models-loader.port.ts` (`PROVIDER_MODELS_LOADER` `InjectionToken` + `ProviderModelsLoader` interface), `provider-model-picker.component.ts`, `index.ts`; exported from `native/index.ts`.

**Modified**

- `skill-judge.service.ts` — return type becomes
  `{ status: 'scored'|'unscored'|'disabled'; score: number | null; criteria: JudgeCriteria | null; reason: string }`.
  The three sites that currently `return { passed: true, score: 10, … }` (`:124`, `:152`,
  `:176`) all return `status:'unscored', score:null` with a distinct `reason`. Promotion
  treats `unscored` as **neither pass nor block**: the candidate stays `candidate`, its
  queue row goes to `status='unscored'` with backoff, and the next drain retries.
  `JUDGE_TIMEOUT_MS` deleted in favour of the lane's `timeoutMs`.
- `skill-promotion.service.ts` — consume the new decision shape; persist via
  `SkillCandidateStore.recordJudgeVerdict`.
- `skill-synthesizer.service.ts` — take `maxInputChars` from the lane; route through
  `LaneRunner`; add `outputFormat` (JSON Schema mirroring `SynthesizedSkillSchema`, `:17-21`).
  **Keep `extractJsonObject` (`:210-231`) — it is the `'parse'` lane's only path.**
- `skill-curator.service.ts` — its own `internalQuery.execute` calls route through
  `LaneRunner` on the `synthesis` lane; `CURATOR_TIMEOUT_MS` becomes lane config.
- `skill-candidate.store.ts` — extend `RawCandidateRow` (`:37-54`) + `toCandidateRow`
  (`:871-899`); add `recordJudgeVerdict(id, verdict)` and `setDisplayName(id, name)` using
  the dynamic-fragment style of `updateStatus` (`:304-323`).
- `internal-query.interface.ts` — §3.2.
- `agent-sdk`: port rename + move, token rename, `curator-llm-adapter` call-site updates (§3.3).
- `auth-providers`: class/file/error/method renames + `scope` parameter; `di/register.ts:143-147`
  registers `ProviderAuthResolver` under `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER`.
- `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:23` — `ProviderTierScope` gains `'lane'`.
- `libs/backend/platform-core/src/file-settings-keys.ts` — 28 new lane keys + defaults.
- `rpc-handlers` — `skillSynthesis:getLanes` / `skillSynthesis:setLanes`, structurally
  identical to the existing `getTriggers`/`setTriggers` pair; extend
  `SkillSynthesisCandidateSummary` (`rpc.types.ts:1908-1920`) with
  `displayName: string | null`, `judgeScore: number | null`,
  `judgeStatus: 'scored'|'unscored'|'disabled'|null`, `judgeReason: string | null`,
  `judgeCriteria: {novelty;actionability;scope;generalization;triggerClarity} | null`.
- `libs/frontend/memory-curator-ui` — **delete** `components/diagnostics/curator-model-picker.component.ts`
  (and the stale footer note at `:105`, "full provider routing coming soon" — routing has
  shipped). Provide `PROVIDER_MODELS_LOADER` → `MemoryDiagnosticsRpcService` (its
  `listModels` at `memory-diagnostics-rpc.service.ts:79-95` already calls the generic
  `provider:listModels`) and render `<ptah-provider-model-picker label="Curator model">`.
- `libs/frontend/skill-synthesis-ui` — `skill-settings-panel.component.ts` gains a **Lanes**
  section with four picker instances (archaeologist / synthesis / judge / replay, each
  defaulting to "Inherit from active provider") plus the Phase-0 knobs; add
  `listModels(providerId?)` to `SkillSynthesisRpcService` and provide it as
  `PROVIDER_MODELS_LOADER`. `skill-candidates-table.component.ts` gains the `unscored`
  badge and the five-criterion scorecard, and titles render
  `displayName ?? 'Captured workflow · ' + date` — **never** `name` (the slug).

**Why the picker MUST take an injected loader.** `libs/frontend/ui` is tagged
`["scope:webview","type:ui"]` and the Nx boundary rule at `eslint.config.mjs:232-234`
restricts `type:ui` to `['type:ui','type:util']`. `@ptah-extension/core` (which owns
`VSCodeService`) is `type:core` — **importing it from `ui` is a lint error**.
`@ptah-extension/shared` is `type:util`, so `ANTHROPIC_PROVIDERS` / `ProviderModelInfo`
are legal. The loader port is a boundary requirement, not a style choice.

**Provider-agnosticism is enforceable, not aspirational.** The picker enumerates
`ANTHROPIC_PROVIDERS` (10 registered ids: `openrouter`, `moonshot`, `z-ai`,
`github-copilot`, `openai-codex`, `ollama`, `ollama-cloud`, `lm-studio`, `claude-cli`,
`sakana`, plus the virtual `anthropic`). `ProviderModelInfo` already carries
`supportsToolUse` and `contextLength` (`rpc-providers.types.ts:34-36`), and
`provider:listModels` already accepts `toolUseOnly` (`:57-62`) — so the UI can _warn_ when
a model selected for a `toolUse: 'required'` lane reports `supportsToolUse: false`, and can
_suggest_ `maxInputChars` from `contextLength`, with zero provider-id branching.

---

### Phase 2 — Session archaeologist

**Commit boundary:** depends on Phase 0 (queue) and Phase 1 (lane).

**Created**

- `migrations/0034_skill_session_verdicts.ts` (+ spec) — §2.4.
- `skill-synthesis/src/lib/archaeology/session-verdict.types.ts` — `SessionVerdict`, `EvidenceClass`, `FrictionEntry`, `RoutineDraft`, plus `SESSION_VERDICT_JSON_SCHEMA` (the `outputFormat` schema).
- `skill-synthesis/src/lib/archaeology/session-verdict.store.ts` (+ spec).
- `skill-synthesis/src/lib/archaeology/transcript-window.reader.ts` (+ spec) — pure, deterministic, in-process windowing over `JsonlReaderService.readJsonlMessages` (`jsonl-reader.service.ts:124`): `head(n)`, `tail(n)`, `range(from,to)`, `search(regex)`, all turn-index addressed and `maxInputChars`-bounded.
- `skill-synthesis/src/lib/archaeology/session-archaeologist.service.ts` (+ specs).

**Design decision — orchestrated multi-pass, not SDK tool calling.**
`OneShotRunInput` (`sdk-query-runner.service.ts:72-85`) has **no** `allowedTools` /
`disallowedTools` field, and `buildOneShotOptions` hardcodes
`tools: { type: 'preset', preset: 'claude_code' }` (`:284-287`). There is no verified
tool-restriction lever on the one-shot path today (Correction C7). Rather than widen the
SDK surface on the critical path, the archaeologist drives retrieval **from TypeScript**:

- **Pass 1** — tail window (default 40 % of `maxInputChars`) + head window (10 %), with an
  `outputFormat`-constrained reply containing an optional
  `requestTurns: Array<{from:number;to:number}>` and `requestSearch: string[]`.
- **Passes 2..`maxPasses`** — `TranscriptWindowReader` serves exactly the requested ranges
  / search hits, re-bounded by `maxInputChars`; the model returns a refined verdict.
- **Terminal pass** — verdict with no further requests, or `maxPasses` reached.
- Between passes, `SkillQueueStore.touchClaim(id)` so a legitimate long run is never reaped.

This satisfies every constraint context.md states for the archaeologist (tail-first,
reads only what it needs, bounded turns, hard timeout, `outputFormat`-constrained) **and**
works on a lane with no tool-calling ability at all — which is exactly what
`toolUse: 'none'` then means: `maxPasses` is forced to 1. One code path, two configurations,
no provider branching. If SDK tool restriction is later verified available, it becomes an
additive optimization, not a rewrite.

**Modified**

- `trajectory-extractor.ts` — `SUCCESS_MARKERS` (`:17-26`) and `hasSuccessMarker` (`:269-281`)
  are **demoted to prefilter signal only**. `ExtractedTrajectory.hasSuccessMarker` is already
  documented "Informational signal" (`:49`); Phase 2 makes that true by removing it from every
  promotion/eligibility decision. The dead `void minTurns;` at `:106` is deleted and `minTurns`
  is honoured (or the parameter removed) — pick one, do not leave it dead.
- `skill-synthesizer.service.ts` — `buildPrompt` (`:187-196`) consumes the verdict
  (`intent` + `routine` + turn citations) instead of `canonicalText.slice(0, 8000)`.
  `canonicalText` stays for embedding/dedup only.
- `skill-synthesis.service.ts` — `passesPrefilter` (`:711-727`) becomes eligibility-to-spend-tokens
  only; **failure sessions with eventual success become eligible** (a friction-rich verdict
  is valuable material), widening today's smooth-success-only harvest.
- `SkillQueueStore` — `archaeology` stage handler wired into the drain.

**Graceful null degradation.** When `LaneResolver` yields no query path (no
`INTERNAL_QUERY_SERVICE_TOKEN` registered — CLI/e2e), the archaeologist writes a verdict row
with `intent = NULL` and `degraded_reason = 'no-query-path'`, and synthesis falls back to
today's extractor path. No exception, no retry storm.

---

### Phase 3 — Empirical gates

**Commit boundary:** depends on Phases 0 + 1. Consumes Phase 2's verdict when present.

**Created**

- `migrations/0035_skill_empirical_gates.ts` (+ spec) — §2.3.
- `skill-synthesis/src/lib/gates/replay-validator.service.ts` (+ specs) — hold out one cluster member; give a fresh `replay`-lane call the drafted skill + the held-out session's **opening user prompt**; **plan-only, no file writes** (enforced by prompt contract _and_ by the fact that `cwd` is `os.homedir()`, as the judge already does at `skill-judge.service.ts:99`); a comparator call scores plan-vs-actual alignment 0–1. Persist `replay_confidence` + `replay_holdout_session_id`.
- `skill-synthesis/src/lib/gates/trigger-eval.service.ts` (+ specs) — generate ~5 should-trigger + ~5 near-miss prompts, run **description-only retrieval against the ACTIVE library using local embeddings** (`IEmbedder` + `SkillCandidateStore.searchActiveByEmbedding`, `:784`) — **zero LLM cost for the retrieval itself**. Persist `trigger_precision`, `trigger_recall`, `trigger_score`. Also emits description-collision findings that cosine dedup misses.
- `skill-synthesis/src/lib/gates/judge-panel.service.ts` (+ specs) — **two plain `IInternalQuery` calls on the `judge` lane**. On any per-criterion delta > 3, escalate that candidate to the `synthesis` lane with both rationales; persist all rationales to `judge_panel_rationales`. **No `tribunal` import** (hard constraint 7).

**Verdict-shape dependency, with the documented fallback.** Replay and trigger-eval prefer
`skill_session_verdicts.routine` + `friction_map` as their evidence base. When the verdict
row is absent or `degraded_reason IS NOT NULL`, they fall back to
`ExtractedTrajectory.canonicalText` + `shortDescription`, and set
`payload.verdictFallback = true` on the queue row so the Activity tab can show that the
gate ran on weaker evidence. Phase 3 therefore ships and passes CI **whether or not**
Phase 2 has landed.

**Promotion rule.** `promoted` requires `judgeStatus === 'scored' && judgeScore >= minJudgeScore`
**AND** (`replayConfidence >= minReplayConfidence` **OR** `replayConfidence IS NULL`).
Replay is an evidence booster, never a hard blocker, until telemetry proves it stable.
New settings: `skillSynthesis.replay.enabled` (default `true`),
`skillSynthesis.replay.minConfidence` (default `0.5`),
`skillSynthesis.triggerEval.enabled` (default `true`),
`skillSynthesis.judgePanel.enabled` (default `true`),
`skillSynthesis.judgePanel.disagreementThreshold` (default `3`).

Ranking uses the **measured** `trigger_score` in place of the judged `triggerClarity`
(which is still persisted, for comparison).

Cost is bounded by promotion candidates (2–4/week), not by session count — replay and
judge-panel are `weekly`-tier stages only.

---

### Phase 4 — Proactive gap-detection curator

**Commit boundary:** depends on Phases 0 + 1; win rate degrades gracefully without Phase 2.

**Created**

- `migrations/0036_skill_invocation_session_join.ts` (+ spec) — §2.5.
- `skill-synthesis/src/lib/digest/skill-gap-curator.service.ts` (+ specs) — the four sweeps: (a) succeeded sessions where a relevant skill existed but was never invoked → description-rewrite suggestion via the existing `SkillSuggestionStore.updatePending` path; (b) friction clusters with no success → skill opportunities from failure; (c) per-skill win rate (§2.5); (d) memory-conditioned relevance via `IMemoryReader.search(query, topK, workspaceRoot)` (`memory-contracts/src/lib/memory-reader.port.ts:30-36`), injected `{isOptional: true}` — `skill-synthesis` already depends on `memory-contracts`.
- `skill-synthesis/src/lib/digest/digest.types.ts` — `DigestItem { kind; title; rationale; score; evidence: { sessionIds: string[]; counts: Record<string, number>; winRate: number | null } }`.

**Modified**

- `skill-invocation-recorder.ts:45-55` — stop dropping `workspaceRoot`; forward it.
- `skill-candidate.store.ts` — `recordSkillEvent` INSERT (`:451-475`) gains `workspace_root`; add `getWinRates()`.
- `skill-scorecard.service.ts` — expose win rate alongside the existing aggregates.
- `skill-enhancer.service.ts` — win rate becomes an auto-enhance eligibility input alongside `MIN_INVOCATIONS_TO_ENHANCE`.
- `skill-promotion.service.ts` — dormancy demotion orders by win rate ascending (nulls last).
- `rpc-handlers` + `libs/shared/.../rpc.types.ts` — `skillSynthesis:digest`.
- `skill-synthesis-ui` — a "This week" panel on the Activity sub-view; nudges ride the existing `pushEvent` → `MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT` broadcast (`skill-synthesis.service.ts:600-620`). **No new notification channel.**

**Autonomy boundary preserved:** the system ranks, evidences and nudges; the user still
accepts/dismisses.

---

### RPC dual-registration — confirmed, no change needed

**`'skillSynthesis:'` is ALREADY present in `ALLOWED_METHOD_PREFIXES`**
(`libs/backend/vscode-core/src/messaging/rpc-handler.ts`, in the block at ~`:79`:
`'skillSynthesis:', // Skills synthesis pipeline (listCandidates, getCandidate, promote, reject, invocations, stats)`).
Every new method in this task (`getLanes`, `setLanes`, `queue`, `digest`) lives under that
prefix. **Do not add a redundant entry.** The compile-time half still applies: each method
needs an entry in `libs/shared/src/lib/types/rpc.types.ts` (method map ~`:1483-1631`) and
in the allow-map (~`:2956-2990`).

---

## 5. Risk register

Ranked by expected damage × likelihood.

**R1 — A background lane repoints the user's live chat session (CRITICAL).**
`ProviderModelsService` has two global-mutating paths: `setModelTier` writes
`this.authEnv[envVar]` **and** `process.env[envVar]` (`:495-500`), and `applyPersistedTiers`
(`:617-643`) does the same for every mapped tier with **no scope guard at all**. If any lane
code calls either, a background drain silently changes the model the foreground chat is using,
mid-conversation.
_Mitigation:_ lanes only ever call `getModelTiers(providerId, 'lane')` and assign onto a
locally-built snapshot — the pattern proven at `workspace-provider-profile-resolver.ts:317-338`
("without touching the global AuthEnv or `process.env`") and
`curator-auth-resolver.ts:255-279`. Enforced by (a) the `'lane'` scope being inert by
construction via the existing `if (scope === 'mainAgent')` guard, (b) an ESLint
`no-restricted-imports`/`no-restricted-syntax` rule in `libs/backend/skill-synthesis/eslint.config.mjs`
banning `applyPersistedTiers` and `setModelTier` in that lib, and (c) the byte-for-byte
immutability spec (§6, P1-5).

**R2 — Silent auth-strip breakage via a `Record<string,string>` type or a JSON round-trip (CRITICAL, subtle).**
`buildCuratorEnv` (`curator-auth-resolver.ts:317-323`) blanks `CHAT_AUTH_KEYS` by **assigning
`undefined`, never `delete`**, because `SdkQueryRunner` re-spreads the whole ambient
`process.env` first (`:295`) and the override lands last — a _deleted_ key lets the chat
provider's value survive into the lane. Any `structuredClone`, `JSON.parse(JSON.stringify())`,
Zod `z.record(z.string())` parse, or `Object.entries(...).filter(([,v]) => v)` over a lane env
silently drops those `undefined` keys and re-leaks the foreground credentials.
_Mitigation:_ `LaneAuthOverride.env` is typed `Readonly<Record<string, string | undefined>>`
(never `Record<string,string>`); the lane env is never serialized, never Zod-parsed, never
cloned; a spec asserts `'ANTHROPIC_API_KEY' in laneEnv && laneEnv.ANTHROPIC_API_KEY === undefined`
(presence-with-undefined, not absence). The `buildCuratorEnv` doc comment (`:289-316`) moves
verbatim to `buildLaneEnv`.

**R3 — Archaeologist cost scales linearly with session count (HIGH).**
It is the only stage that runs once per session; at 3–4 concurrent sessions across projects
it dominates spend. `maxSynthesisTokensPerDay` is a hard stop but a blunt one — hitting it
stalls _all_ stages including cheap ones.
_Mitigation:_ the archaeologist is a **nightly**-tier stage, never frequent; the regex
prefilter still gates _eligibility to spend_ (it is demoted from verdict, not deleted);
`maxItemsPerRun` × `perWorkspaceBatch` caps per-tick fan-out; the budget check runs per item,
not per drain, so cheap stages continue after an expensive one exhausts the budget — order
the eligible set cheap-stages-first once ≥ 80 % of budget is consumed. Ship a per-stage token
counter in the Activity tab from day one so the real cost is observable before it is tuned.

**R4 — Drain starvation / per-workspace unfairness (HIGH).**
A single project that ends 40 sessions in an evening would monopolize every drain tick under
naive `ORDER BY enqueued_at`.
_Mitigation:_ §2.2 round-robin with a durable `skill_synthesis_workspace_cursor`, `perWorkspaceBatch = 1`.
Spec: three workspaces with 10/1/1 queued items each yield 1/1/1 in the first tick.
Residual risk: a workspace whose items always fail fast burns its slot repeatedly — bounded
by `maxAttempts` (5) after which the row is `failed` and stops competing.

**R5 — Stale-claim TTL mistuned (MEDIUM-HIGH).**
Too short and a live archaeologist run is reaped mid-flight, duplicating spend; too long and
a crashed worker's rows sit dark for the TTL.
_Mitigation:_ `touchClaim` heartbeat between passes makes a live run self-defending regardless
of TTL; a startup assertion enforces `staleClaimTtlMs >= 3 × max(lane.timeoutMs)` and logs a
warning otherwise; reaping also runs at `start()`, so the worst case after a crash is
"next launch", not "next TTL". Default 900 000 ms against a 120 000 ms archaeologist timeout ×
3 passes = 360 000 ms gives 2.5× headroom.

**R6 — A lane is pointed at a model that cannot do tool use, or has a small context (MEDIUM).**
The user picks a 4k-context or non-tool-use model for the archaeologist and every run
times out or errors.
_Mitigation:_ three layers. (1) UI: the picker surfaces `ProviderModelInfo.supportsToolUse`
and `contextLength` (`rpc-providers.types.ts:34-36`) and warns on mismatch. (2) Config: the
`toolUse` / `maxInputChars` lane fields let the user declare the limitation, and the
archaeologist collapses to a single tail-window pass rather than looping. (3) Runtime: the
`tool-use-unsupported` failure mode fires on `subtype: 'error_max_turns'` at pass 1 and
degrades **once**, recording the reason. In no configuration does it loop to timeout.

**R7 — Local-proxy lane mis-identified as another provider (MEDIUM, pre-existing).**
`getActiveProviderId(env)` matches registry entries by **hostname substring of
`ANTHROPIC_BASE_URL`, ignoring port** — documented as a known defect at
`curator-auth-resolver.ts:236-253`. A lane on a local proxy at `http://127.0.0.1:<ephemeral>`
matches the Ollama entry at `127.0.0.1:11434` and can inherit the wrong tier defaults.
_Mitigation:_ lanes always set explicit `ANTHROPIC_DEFAULT_*_MODEL` values via
`buildTierValues` before any identification happens, so the tier lookup never depends on
hostname matching. Log the resolved `(providerId, baseUrl, tier models)` triple per lane run.
Fixing the matcher itself is out of scope — record it as a follow-up.

**R8 — Judge-panel and replay double the LLM cost of promotion (MEDIUM).**
Two judges + a replay + a comparator = 4 calls per promotion candidate where there was 1.
_Mitigation:_ both are weekly-tier and gated by `judgePanel.enabled` / `replay.enabled`
(default on but individually switchable); the second judge only runs when the first produced
a `scored` verdict; escalation to the `synthesis` tier only fires above the disagreement
threshold. Volume is 2–4 promotions/week by design.

**R9 — Migration `CHECK` constraints cannot be extended later (MEDIUM, mitigated by design).**
SQLite cannot `ALTER … ADD CONSTRAINT`; a forgotten `stage` member would require a full
table rebuild in a later migration.
_Mitigation:_ this is the whole reason for the single-pass design — `0032` enumerates all
eleven stages and all seven statuses even though commit 0 exercises maybe four of each.
Spec asserts the full enum set via `PRAGMA table_info` / an insert-per-member test.

**R10 — Tier B tray is net-new Electron UI with quit-path risk (LOW-MEDIUM).**
Suppressing `window-all-closed` (`main.ts:161-165`) without a working tray leaves users with
an unkillable background process.
_Mitigation:_ default `trayKeepalive = false`, so the shipped default path is byte-identical
to today; the tray menu always carries an unconditional "Quit Ptah"; the `will-quit` teardown
chain (`main.ts:166+`) is unchanged. See Open question Q4.

---

## 6. Test strategy per phase

Every acceptance criterion from context.md, mapped to a named spec file and its assertion.
Criteria that are not testable as written are flagged and restated.

### Phase 0

| #        | Criterion                                                   | Spec file                                                         | Assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1     | session end performs no LLM work                            | `skill-synthesis/src/lib/skill-synthesis.service.enqueue.spec.ts` | Fire the session-end callback with a stub `IInternalQuery`; assert `internalQuery.execute` has **0** calls and `SkillQueueStore.enqueue` has exactly 1, with `stage='prefilter'`.                                                                                                                                                                                                                                                                                                  |
| P0-2     | two windows drain concurrently, each session processed once | `queue/skill-queue.store.claim.spec.ts`                           | One `better-sqlite3` file DB, **two** `SkillQueueStore` instances (distinct `claimed_by`). Both call `tryClaim(id)`; assert exactly one returns a row and the other returns `null` (`changes === 0`). Then a drain-level variant with two `SkillDrainService` instances asserts the stage handler ran exactly once.                                                                                                                                                                |
| P0-3     | stale claim returns to `queued` after TTL                   | `queue/skill-queue.store.reap.spec.ts`                            | Claim a row, rewind `claimed_at` to `now - ttl - 1`, call `reapStale(ttl)`; assert `status='queued'`, `claimed_by IS NULL`, `attempt_count` incremented. Companion: `touchClaim` before the rewind leaves the row claimed.                                                                                                                                                                                                                                                         |
| P0-4     | drain skipped while a foreground session is active          | `queue/skill-drain.gates.spec.ts`                                 | Stub `ForegroundActivityTracker.msSinceLastActivity()` → `1000` with `foregroundBackoffMs = 300000`; assert `drain()` resolves `{skipped: true, reason: 'foreground-active'}` and `tryClaim` was never called.                                                                                                                                                                                                                                                                     |
| P0-5     | drain skipped while on battery                              | same file                                                         | **UNTESTABLE AS WRITTEN** — `IPowerMonitor` exposes only `onResume`/`onSuspend` (`power-monitor.interface.ts:14-25`); there is no battery query anywhere. **Restatement:** _"`IPowerMonitor` gains `isOnBattery(): boolean`; with `pauseOnBattery: true` and a monitor stub returning `true`, `drain()` resolves `{skipped: true, reason: 'on-battery'}` and issues zero claims."_ Plus `power-monitor.interface.spec.ts`: `NoopPowerMonitor.isOnBattery() === false`.             |
| P0-6     | daily token budget hard-stops the drain                     | `queue/skill-budget.store.spec.ts` + `skill-drain.gates.spec.ts`  | Store: `record()` accumulates per UTC day and rolls over at midnight. Drain: seed `spentToday = maxTokensPerDay`; assert `{skipped: true, reason: 'daily-token-budget-exhausted'}` and zero claims.                                                                                                                                                                                                                                                                                |
| P0-7     | `JobRun` rows visible in Activity                           | —                                                                 | **UNTESTABLE AS WRITTEN** (spans backend + frontend, "visible" is not an assertion). **Restatement, two specs:** (a) `rpc-handlers/.../skills-synthesis-rpc.queue.spec.ts` — `skillSynthesis:queue` returns `{items: QueueRow[], recentRuns: JobRunSummary[]}` with the seeded rows; (b) `skill-synthesis-ui/.../skill-pipeline-status.component.spec.ts` — given N runs in state, the component renders N `[data-testid="skills-drain-run"]` elements carrying status + duration. |
| P0-extra | cron jobs registered idempotently                           | `thoth-runtime/src/lib/start-thoth-cron.spec.ts` (extend)         | Call `startThothCron` twice against the existing container stub; assert `handlerRegistry.register` called once per handler name (guarded by `has()`, as at `:77`) and `jobStore.upsert` called with the three fixed ids.                                                                                                                                                                                                                                                           |

### Phase 1

| #     | Criterion                                                                                | Spec file                                                                                                  | Assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | rate-limited judge → pending candidate, `unscored` badge, null score                     | `skill-judge.service.spec.ts` (extend) + `skill-synthesis-ui/.../skill-candidates-table.component.spec.ts` | Backend: stub `IInternalQuery.execute` to reject with a rate-limit error; assert `{status:'unscored', score:null}` and that `SkillPromotionService` leaves `status='candidate'`. Frontend: a summary with `judgeStatus:'unscored', judgeScore:null` renders `[data-testid="skills-candidate-judge-badge"]` with text `unscored` and **no** numeric score node.                                                                                                                                                                                                                                                                                                                                                                                          |
| P1-2  | per-criterion scores render                                                              | same frontend spec                                                                                         | A `scored` summary renders five `[data-testid="skills-candidate-criterion"]` nodes with the correct labels/values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1-3  | each stage resolves its own provider/model, `auth` reaches `InternalQueryService`        | `lanes/lane-resolver.service.spec.ts` + `lanes/lane-runner.service.spec.ts`                                | Configure four distinct lane providers; assert `IProviderAuthResolver.resolve` called once per lane with that lane's id and `scope === 'lane'`, and that the object passed as `config.auth` to `internalQuery.execute` is the resolver's return value **by identity**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-4  | a lane on any non-Anthropic registry provider issues zero Anthropic calls, parameterized | `lanes/lane-resolver.providers.spec.ts`                                                                    | **Restated for testability** (you cannot assert absence of a network call in Jest): `it.each(ANTHROPIC_PROVIDERS.map(p => p.id))` — for each id, with a stubbed resolver built on the real `ProviderAuthResolver` logic, assert the produced `auth.env.ANTHROPIC_BASE_URL === getProviderBaseUrl(id)` (or the proxy handle url), that `ANTHROPIC_API_KEY` is present-with-`undefined` or `''`, and that no key of `auth.env` equals a chat-tier value seeded into `process.env`. **The test body must contain no provider-id literal** — the list comes from the registry.                                                                                                                                                                              |
| P1-5  | global `AuthEnv` and `process.env` BYTE-FOR-BYTE unchanged                               | `lanes/lane-runner.env-immutability.spec.ts`                                                               | Snapshot `JSON.stringify(process.env)` and a deep clone of the injected `AuthEnv` singleton before the run; execute a full lane run against a fake `IInternalQuery`; assert both compare **strictly equal** afterwards. Run it once per lane id and once for a `requiresProxy` provider. This is the guard against R1 — treat a failure here as release-blocking.                                                                                                                                                                                                                                                                                                                                                                                       |
| P1-6  | `structuredOutput:'parse'` still yields a valid verdict                                  | `lanes/lane-runner.parse-fallback.spec.ts`                                                                 | Lane declares `'parse'`; assert `internalQuery.execute` was called **without** `outputFormat`; feed a stream whose assistant text wraps JSON in prose + a code fence; assert `extractJsonObject` recovered it and the verdict parsed. Second case: lane declares `'sdk'` but the `result` message has no `structured_output` and a non-JSON `result` → assert exactly one re-run without `outputFormat`.                                                                                                                                                                                                                                                                                                                                                |
| P1-7  | unresolvable auth leaves the item `queued` with a reason, no throw                       | `queue/skill-drain.failures.spec.ts`                                                                       | Resolver rejects with `ProviderAuthError`; assert `drain()` **resolves** (does not reject), the row is `status='queued'` with `not_before > now` and a non-empty `reason` containing the lane id, and that a following eligible item in the same tick still ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P1-8  | per-lane `timeoutMs` and `maxInputChars` honored                                         | `lanes/lane-runner.limits.spec.ts`                                                                         | Fake timers: a stream that never yields is aborted at exactly `cfg.timeoutMs`, producing `{kind:'timeout'}`. Separately, a 50 000-char trajectory with `maxInputChars: 6000` yields a prompt whose length is ≤ 6000 + marker and `payload.truncated === true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P1-9  | extracted picker renders in BOTH VS Code webview and Electron                            | —                                                                                                          | **UNTESTABLE AS WRITTEN** in Jest (host cannot be distinguished). **Restatement, three parts:** (a) `libs/frontend/ui/.../provider-model-picker.component.spec.ts` — the component mounts with **only** `PROVIDER_MODELS_LOADER` provided, and the spec asserts the component's injector requests no other token (i.e. no `VSCodeService`, no `isElectron` gate); (b) a lint/dep assertion — `libs/frontend/ui` must not depend on `@ptah-extension/core`, already enforced by `eslint.config.mjs:232-234`, pinned by a `dependency-boundaries.spec.ts`-style check; (c) e2e coverage: one `apps/ptah-electron-e2e` assertion that the Skills > Settings lane pickers render, and one webview-harness assertion in `libs/frontend/webview-e2e-harness`. |
| P1-10 | no raw prompt-echo titles anywhere in the Skills tab                                     | —                                                                                                          | **UNTESTABLE AS WRITTEN** (unbounded negative). **Restatement, two specs:** (a) `naming/candidate-namer.service.spec.ts` — given a 400-char first user message, the produced `display_name` is ≠ `trajectory.slug` and ≤ 60 chars; when the naming lane is unavailable, `display_name` stays `NULL`; (b) `skill-candidates-table.component.spec.ts` — the rendered title is `displayName` when set, and `Captured workflow · {formattedDate}` when `displayName` is `null`; the raw `name` slug is **never** used as the title (assert the slug string does not appear in the title node for a summary whose `displayName` is null).                                                                                                                    |
| P1-11 | Jest specs cover all three former fail-open paths                                        | `skill-judge.service.spec.ts` (extend)                                                                     | Three cases against the three sites at `:124` (no JSON match), `:152` (invalid score values), `:176` (thrown error): each asserts `{status:'unscored', score:null}` with a distinct `reason`, and that **no** case returns `score: 10`. Add a regression assertion that the literal `score: 10` never appears in a `judge-verdict` result.                                                                                                                                                                                                                                                                                                                                                                                                              |

### Phase 2

| #    | Criterion                                                                             | Spec file                                                                                         | Assertion                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | verdict persisted with turn citations                                                 | `archaeology/session-archaeologist.service.spec.ts` + `archaeology/session-verdict.store.spec.ts` | Given a scripted two-pass stream, assert the stored row has `intent`, `evidence_class`, `friction_map` with integer `turnIndex` values, and `routine.citations` as a non-empty `number[]`; round-trip through the store preserves JSON shape.                                                                                                                           |
| P2-2 | regex demoted: a `"done."` tail no longer suffices when the verdict says `unverified` | `archaeology/regex-demotion.spec.ts`                                                              | Trajectory whose final assistant turn matches `SUCCESS_MARKERS` (`trajectory-extractor.ts:19`) → `hasSuccessMarker === true`; archaeologist returns `evidence_class: 'unverified'`; assert promotion/ranking treats the session as unverified and that **no** code path reads `hasSuccessMarker` to decide success (assert via the injected verdict, not via the flag). |
| P2-3 | graceful null degradation                                                             | `archaeology/session-archaeologist.degraded.spec.ts`                                              | With `INTERNAL_QUERY_SERVICE_TOKEN` unregistered, assert a verdict row exists with `intent === null` and `degraded_reason === 'no-query-path'`, that the call resolved (no throw), and that synthesis fell back to the extractor path. Second case: `toolUse:'none'` lane ⇒ `passes === 1` and `degraded_reason === 'tool-use-unsupported'`.                            |
| P2-4 | archaeologist runs only from the queue, never inline                                  | `skill-synthesis.service.enqueue.spec.ts` (extend)                                                | Assert `SessionArchaeologistService.analyze` has 0 calls after a session-end event, and ≥ 1 call after `drain()` processes the `archaeology` stage.                                                                                                                                                                                                                     |

### Phase 3

| #        | Criterion                                                            | Spec file                                                                                                                  | Assertion                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1     | `replayConfidence` + measured `triggerScore` persisted and displayed | `gates/replay-validator.service.spec.ts`, `gates/trigger-eval.service.spec.ts`, `skill-candidates-table.component.spec.ts` | Backend: a scripted replay stream yields a 0–1 confidence written to `replay_confidence` with `replay_holdout_session_id` set to the excluded member; trigger-eval over a stub embedder yields precision/recall and a derived `trigger_score`. Frontend: both values render, and render as "not measured" when `null`.                                                                                    |
| P3-2     | disagreement escalation, scripted judge pair                         | `gates/judge-panel.service.spec.ts`                                                                                        | Judge A returns `novelty: 9`, judge B returns `novelty: 4` (delta 5 > 3): assert a **third** `internalQuery.execute` call whose lane is `synthesis`, whose prompt contains both rationales, and that all three rationales land in `judge_panel_rationales`. Control case delta 2 ⇒ exactly two calls. Also assert `@ptah-extension/tribunal*` is not imported anywhere in `libs/backend/skill-synthesis`. |
| P3-extra | verdict-absent fallback                                              | `gates/verdict-fallback.spec.ts`                                                                                           | With no `skill_session_verdicts` row, replay and trigger-eval still run off `canonicalText` and set `payload.verdictFallback === true`.                                                                                                                                                                                                                                                                   |

### Phase 4

| #    | Criterion                                           | Spec file                                              | Assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P4-1 | digest RPC returns ranked items with evidence links | `rpc-handlers/.../skills-synthesis-rpc.digest.spec.ts` | Seeded DB; assert the result is sorted by `score` descending and every item carries a non-empty `evidence.sessionIds`, a `counts` map, and a `winRate` that is `number                                                                                                                                                                                                                                                                                                                | null`. |
| P4-2 | win-rate join covered by spec                       | `digest/win-rate.spec.ts`                              | Seed `skill_invocation_events` (3 rows, one session with no verdict) and `skill_session_verdicts` (`tests-green`, `unverified`); assert `invocations: 3, wins: 1, unknown: 2` and `winRate === 1` (1/1). A slug with only unverified/absent sessions yields `winRate === null`, **not** `0`.                                                                                                                                                                                          |
| P4-3 | nightly + weekly slots registered and idempotent    | —                                                      | **Restatement** ("idempotent" needs an operationalization): `thoth-runtime/src/lib/start-thoth-cron.spec.ts` — calling `startThothCron` twice results in `handlerRegistry.register` called exactly once per handler name and `jobStore.upsert` called with the same three fixed ids both times, producing one row per id. Plus `skill-drain.idempotency.spec.ts`: running the weekly drain twice for the same slot processes each queue item once (the second run finds them `done`). |

---

## 7. Corrections to context.md

**C1 — `ICuratorAuthResolver` is declared in `agent-sdk`, not `auth-providers`.**
context.md (line ~157) says "`CuratorAuthResolver` is a concrete class registered at
`auth-providers/src/lib/di/register.ts:144`" — that part is exactly right. But the _port_
lives at `agent-sdk/src/lib/curator-llm-adapter/curator-auth-resolver.port.ts` (5 lines),
not in `auth-providers`. The direction (agent-sdk declares, auth-providers implements) is
what keeps the dependency one-way, and the generalization must preserve it.

**C2 — the method is `setModelTier` (singular), not `setModelTiers`, and it is at
`provider-models.service.ts:473-508`, not `:495`.**
context.md cites "`ProviderModelsService.setModelTiers:495` mutates `authEnv` + `process.env`
ONLY for `'mainAgent'`". The behaviour is correct; the name and line are not. `:495-500` is
the `if (scope === 'mainAgent')` block _inside_ `setModelTier`. There is no `setModelTiers`.

**C3 — `ProviderModelsService` lives in `libs/backend/auth-providers`, not `agent-sdk`.**
Not a context.md error, but the root `CLAUDE.md` lists `ProviderModelsService` in agent-sdk's
Public API — that entry is stale and should be corrected in a follow-up doc pass.

**C4 — there is a _fourth_ global-mutating path that context.md does not name:
`ProviderModelsService.applyPersistedTiers` (`:617-643`).**
Unlike `setModelTier` it has **no scope guard at all** — it writes `this.authEnv[envKey]`
_and_ `process.env[envKey]` for every mapped tier unconditionally. This is a live hazard for
any lane implementation and is now risk R1.

**C5 — `analyzedSessions` is a `Map<string, number>`, not a `Set`.**
context.md says "an in-memory `Set` cleared in `stop()`". It is
`private readonly analyzedSessions = new Map<string, number>()`
(`skill-synthesis.service.ts:111`) storing the highest analyzed turn count per session
(`:365-372`), which is why a session can be re-analyzed after it grows. The queue design must
preserve that semantic (`turn_count` column + guarded re-open), which a plain
"already processed" set would not.

**C6 — battery gating is NOT available through the existing `IPowerMonitor` port.**
context.md Phase 0 item 5 says "battery gating via the existing `IPowerMonitor` port". The
port exposes only `onResume(cb)` and `onSuspend(cb)` (`power-monitor.interface.ts:14-25`),
and the Electron adapter wires only `powerMonitor.on('resume'|'suspend')`
(`apps/ptah-electron/src/services/platform/electron-power-monitor.ts:23,37`). There is no
battery query. **The port must be widened with `isOnBattery(): boolean`** (Electron:
`powerMonitor.isOnBatteryPower()`; `NoopPowerMonitor`: `false`), or acceptance criterion
P0-5 is unbuildable as written.

**C7 — there is no tool-restriction lever on the one-shot path.**
context.md Phase 2 says the archaeologist "runs through the widened `IInternalQuery` with a
bounded tool set". `OneShotRunInput` (`sdk-query-runner.service.ts:72-85`) has no
`allowedTools`/`disallowedTools`/`tools` field, and `buildOneShotOptions` hardcodes
`tools: { type: 'preset', preset: 'claude_code' }` (`:284-287`). `SdkQueryOptions = Options`
(`sdk-query-options-builder.ts:479`) so the vendor type may well expose `allowedTools`, but
nothing in this repo uses it and `node_modules` could not be verified during this pass.
**This plan therefore does not put SDK tool restriction on the critical path** — the
archaeologist drives retrieval from TypeScript via `TranscriptWindowReader` (Phase 2). That
is strictly more portable (it works on a lane with no tool calling at all) and makes SDK tool
restriction a purely additive later optimization.

**C8 — the judge has three fail-open sites; context.md cites two.**
context.md names `skill-judge.service.ts:124,176`. The third is `:152` (invalid score values
after a successful parse). All three must be converted; the acceptance criterion already says
"all three fail-open paths", so this is a citation gap, not a scope gap.

**C9 — cron tables are `scheduled_jobs` and `job_runs`.**
Not an error in context.md, but worth pinning: they are created in `0004_cron.ts:3-31`, and
`libs/backend/cron-scheduler/src` contains **zero** DDL. Any new cron-adjacent column is a
`persistence-sqlite` migration.

**C10 — `SkillInvocationRecorder` accepts `workspaceRoot` and silently discards it.**
`RecordSkillEventInput` declares it (`skill-invocation-recorder.ts:10-22`) but it is not
forwarded to `store.recordSkillEvent` (`:45-55`) and there is no `workspace_root` column on
`skill_invocation_events`. context.md's Phase 4 assumes the join is only missing the session
outcome; it is also missing workspace scoping and an index on `session_id`.

**C11 — `skillSynthesis:` is already in `ALLOWED_METHOD_PREFIXES` — confirmed.**
context.md states this and it is correct (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`,
prefix block ~`:79`). Stating it explicitly as requested: **do not add a redundant entry.**
The compile-time half of dual-registration still applies per new method.

**C12 — the Ollama Cloud ~30K req/mo free-tier figure remains unverified.**
context.md flags it as a source-comment assertion needing verification. This pass did not
verify it either. Nothing in this plan depends on it: capacity is governed by
`maxTokensPerDay` and per-tier cron cadence, not by any provider's quota.

---

## 8. Open questions for the user

### Q1 — One `'lane'` tier scope, or one scope per lane?

`ProviderTierScope` is `'mainAgent' | 'cliAgent'` (`rpc-providers.types.ts:23`) and keys
config as `provider.<id>.<scope>.modelTier.<tier>`.

- **Option A (Recommended) — a single `'lane'` member shared by all four lanes.** Per-lane
  model choice is expressed by the lane's own `model` setting; the tier scope only supplies
  the fallback tier map. Smallest surface, one new enum member, `provider:setModelTier` /
  `getModelTiers` unchanged apart from accepting the value. _Trade-off:_ two lanes on the
  same provider cannot have different tier→model maps (they can still have different pinned
  models, which covers the realistic case).
- **Option B — four members (`lane:archaeologist`, …).** Maximum flexibility. _Trade-off:_
  turns a 2-member union into a 6-member one across the RPC contract, the settings UI and
  every consumer; four times the config keys for a capability nobody has asked for.
- **Option C — reuse `'cliAgent'`.** Zero new members. _Trade-off:_ semantically wrong and
  it entangles lane tiers with actual CLI sub-agent config; a user changing a CLI agent's
  tier would silently move background synthesis.

The plan is written for **Option A**.

### Q2 — Should an unresolvable lane auth fall back to the active provider, or stall?

The memory curator falls back and logs (`sdk-internal-query.curator-llm.ts:84-91`).

- **Option A (Recommended) — stall.** Queue item returns to `queued` with a surfaced reason
  and 30-minute backoff; nothing runs on the foreground provider. This is what context.md's
  acceptance criterion P1-7 literally requires, and it preserves the whole point of Phase 1
  (background learning off the foreground quota). _Trade-off:_ a user who misconfigures a
  lane sees synthesis quietly stop until they read the Activity tab.
- **Option B — fall back to the active provider after N failed attempts.** Never stalls.
  _Trade-off:_ silently reintroduces the exact defect being fixed; a user who set a lane to
  Ollama specifically to avoid burning Anthropic quota would burn it anyway.
- **Option C — fall back, but only for the cheap `judge` lane.** Split the difference.
  _Trade-off:_ a per-lane behavioural exception, i.e. a second code path.

The plan is written for **Option A**, with the reason surfaced in Activity and a
`skillSynthesis:queue` item badge so the stall is visible rather than silent.

### Q3 — Is the Phase-2 archaeologist's orchestrated multi-pass acceptable in place of SDK tool calling?

See Correction C7. The plan replaces "give the model a bounded tool set" with "drive
tail-first windowed retrieval from TypeScript across ≤ `maxPasses` `outputFormat`-constrained
one-shot calls".

- **Option A (Recommended) — orchestrated multi-pass, as planned.** Provider-agnostic by
  construction; `toolUse: 'none'` becomes `maxPasses = 1` with no second code path; no
  dependence on an unverified SDK option. _Trade-off:_ the model cannot adaptively search
  mid-turn; it must ask for ranges and wait a round trip.
- **Option B — widen `OneShotRunInput` with `allowedTools`/`disallowedTools` and give the
  archaeologist real SDK tools.** Closer to context.md's literal wording, potentially fewer
  round trips. _Trade-off:_ requires verifying the vendor `Options` surface, adds a field to
  a shared SDK input type, and still needs the multi-pass path as the `toolUse: 'none'`
  fallback — so it is strictly _additional_ work, not alternative work.
- **Option C — both, with SDK tools as an opt-in accelerator on `toolUse: 'required'` lanes.**
  _Trade-off:_ two retrieval paths to test and keep in sync.

The plan is written for **Option A**, structured so **Option C** is purely additive later.

### Q4 — Ship Tier B (Electron tray keep-alive) in Phase 0, or split it out?

There is currently **no tray anywhere in the Electron app** (zero `Tray` references), and
`window-all-closed` unconditionally `app.quit()`s on non-darwin (`main.ts:161-165`). Tier B
is therefore net-new UI plus a quit-path change — meaningfully more Electron work than the
rest of Phase 0, which is all backend.

- **Option A (Recommended) — split Tier B into its own sixth commit, after Phase 0 lands.**
  Phase 0 ships Tier A survival (which is free — SQLite + `CatchupCoordinator` + stale
  reaping) and the `skillSynthesis.trayKeepalive` setting key with its default `false`, so
  the tray commit is purely additive. _Trade-off:_ six commits instead of five.
- **Option B — include Tier B in Phase 0 as specified.** Matches context.md exactly.
  _Trade-off:_ the largest, riskiest, most platform-specific piece rides in the commit that
  everything else depends on; a tray bug blocks Phase 2.
- **Option C — drop Tier B entirely** and let Tier A (resume-on-next-launch) be the answer
  until the Tier C daemon follow-up. _Trade-off:_ loses the "synthesis survives desktop-app
  close" strategic goal for laptop users who close the app nightly.

The plan is written for **Option A** — Phase 0 includes the setting key and the default-off
behaviour, and marks the tray itself as the sixth commit.

### Q5 — Default drain cadence for the frequent tier

`*/15 * * * *` is planned for the cheap inline-ish stages (prefilter, embedding, candidate
row), with archaeology nightly and gates weekly.

- **Option A (Recommended) — `*/15`.** Keeps the Sessions tab feeling live (a session
  analyzed within 15 minutes) while the foreground-backoff gate means it almost never fires
  during active work.
- **Option B — `*/5`.** Sessions tab feels near-real-time. _Trade-off:_ 3× the wake-ups and
  the DB churn, for a tab most users check occasionally.
- **Option C — `0 * * * *` (hourly).** Minimal overhead. _Trade-off:_ a session finished at
  09:05 does not appear until 10:00, which will read as "skill synthesis is broken".

All three are one settings value; the recommendation is **Option A**.
