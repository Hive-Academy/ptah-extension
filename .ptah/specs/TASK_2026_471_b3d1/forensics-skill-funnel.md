## Verdict

The primary cause is a **design break in the automatic-promotion feedback loop**, not tuning and not skill quality. Candidates are created with `success_count=0` and one source session (`skill-candidate.store.ts:200-216`; `skill-synthesis.service.ts:891-905`). The only automatic caller of `SkillPromotionService.evaluate()` is `SkillInvocationTracker`, after its own counter reaches 3 (`skill-invocation-tracker.ts:48-84`), but that tracker has no production caller. Runtime usage telemetry instead goes through `SkillInvocationRecorder` into `skill_invocation_events` (`skill-trigger.service.ts:625-683`; `skill-invocation-recorder.ts:35-62`), a different table that never increments candidate counters. Thus automatic promotion is theoretically executable but not reachable through current real usage. Threshold/drain tuning cannot repair a disconnected signal.

## The 44

The apparent premise “judge score >= 6 should promote” is not the implemented path. A successful prefilter enqueues the weekly `judge-panel` independently (`queue/stage-handlers.service.ts:415-426`). The panel persists the verdict (`gates/judge-panel.service.ts:588-605`), and a scored result merely finishes its queue row as `done` (`queue/stage-handlers.service.ts:515-547`). It does **not** call promotion. The 44 therefore acquired qualifying scorecards without ever entering the automatic promotion pipeline.

`SkillSynthesisService` itself registers each candidate with exactly one `sourceSessionIds` member (`skill-synthesis.service.ts:891-905`); the store inserts `status='candidate', success_count=0` (`skill-candidate.store.ts:200-216`). Its promotion entry points are user actions; for example bulk promotion explicitly calls `promoteManually` and bypasses recurrence (`skill-synthesis.service.ts:1194-1211`). Automatic entry is elsewhere: a successful invocation must increment the counter and reach `successesToPromote` before `evaluate()` is called (`skill-invocation-tracker.ts:59-84`). No production call site invokes `SkillInvocationTracker.recordInvocation`; runtime trigger telemetry uses the separate recorder cited above.

Once `evaluate()` is actually called, every condition between entry and `status='promoted'`, in code order, is:

| Condition | Code | Live result for the 44 |
| --- | --- | --- |
| Candidate exists and is neither already promoted nor rejected | `skill-promotion.service.ts:216-225` | Pass: all 44 exist and remain `candidate`. |
| Nearest active-skill cosine similarity is below `dedupCosineThreshold` (default 0.85) | `skill-promotion.service.ts:227-241`; exact lookup at `:634-649`; default at `skill-synthesis.service.ts:130-138` | Pass in the present DB: there are zero promoted candidate rows, hence no active candidate match. All 44 have embeddings, so this is not missing evidence. |
| Automatic recurrence threshold: `success_count >= 3`; only after 3 distinct contexts would it halve to `ceil(3/2)=2` | `skill-promotion.service.ts:242-250`; defaults at `skill-synthesis.service.ts:130-138` | **Fail for all 44:** every `success_count` is 0 and each has only one distinct invocation context. This return occurs before either judge gate. |
| Cluster-level dedup does not find a duplicate | `skill-promotion.service.ts:252-260` | Pass on current data for the same reason: no promoted candidate exists to be an active cluster duplicate. |
| Judge is enabled, returns `scored`, and score is at least 6.0; `unscored` stays pending and below 6 is rejected | `skill-promotion.service.ts:541-592`; defaults at `skill-synthesis.service.ts:141-143` | Stored evidence passes for all 44 (`scored`, 6.0-8.4). However this gate is never reached automatically, and when reached it invokes the judge again rather than treating the weekly panel score as a promotion event (`skill-promotion.service.ts:548-562`). |
| Replay is either unmeasured (`NULL`) or at least 0.5 | `skill-promotion.service.ts:469-518` | Pass: all 44 are `NULL`; `NULL` explicitly passes at line 473. |
| Residency cap handling | `skill-promotion.service.ts:276-302`; default cap 200 at `skill-synthesis.service.ts:134` | Pass: zero promoted candidate residents, far below 200. At cap this code demotes a resident; it does not reject the incoming candidate merely for being at cap. |
| Candidate body materializes, and the atomic transition still finds a `candidate` row | `skill-promotion.service.ts:303-347`; SQL transition at `skill-candidate.store.ts:467-540` | Not reached. All 44 have body paths and remain transition-eligible candidates; a filesystem or concurrent-write failure could still produce `write-failed`, but there is no live evidence that this is their blocker. |

The decisive fact is ordering: recurrence is at `skill-promotion.service.ts:242-250`, while judging is at `:261-266`. A qualifying weekly score is neither sufficient nor even consulted until recurrence has already passed.

## Is repetition reachable

The documented constant is `successesToPromote: 3` (`skill-synthesis.service.ts:130-138`). The only counter increment is `SkillCandidateStore.incrementSuccess()` (`skill-candidate.store.ts:933-943`), called by `SkillInvocationTracker.recordInvocation()` on a successful invocation (`skill-invocation-tracker.ts:59-78`). The tracker then calls promotion only at the full threshold (`:74-84`). Inside promotion, `countDistinctContexts()` counts non-NULL distinct `context_id` values (`skill-candidate.store.ts:987-1000`) and may lower the effective gate to 2 after three distinct contexts (`skill-promotion.service.ts:242-249`). That optimization is itself unreachable at 2: the outer tracker refuses to call `evaluate()` until the full count is 3.

Live reachability is zero, not merely low:

- No candidate has `success_count >= 2` or `>= 3`; the maximum is 0.
- Every one of 2,433 candidates has exactly one `source_session_ids` element; none has two or three.
- `skill_invocations` contains 2,433 rows across 2,433 skills: exactly one successful row per candidate. No candidate has two successes, three successes, two contexts, or three contexts; maximum distinct contexts is one. The 44 qualifying candidates have the same one-row/one-context pattern.
- The separate live telemetry given in the task—2,790 `skill_invocation_events`, all naming authored agents and no synthesized skill—explains why real use cannot fill this gap: candidates are not surfaced as runnable skills before promotion, and the runtime recorder does not update candidate success counters anyway.

For the gate to fire under current code, some production component would have to call `SkillInvocationTracker.recordInvocation()` successfully three times for the **same candidate id** while it is still a candidate. Those invocations would also need to be possible before promotion, even though synthesized candidates are not active skills. Neither prerequisite exists. Manually invoking the RPC path can promote because it explicitly skips recurrence; that is not automatic promotion.

## The unjudged 2,328

Judging is a weekly downstream stage, not a sweep over all candidate rows. A successful prefilter creates `judge-panel` and `trigger-eval` rows (`queue/stage-handlers.service.ts:357-426`). Of 2,328 NULL-judge candidates, only 134 have any judge-panel row, and all 134 are still queued. The other 2,194 have no panel work item at all, so drain-rate changes alone cannot judge them. This includes historical/directly created candidates that were never linked into the newer gate chain.

The drain arithmetic is:

- Frequent stages include prefilter; weekly-only stages include judge-panel and trigger-eval (`queue/skill-drain.service.ts:400-418`). Defaults are 4/frequent tick, 40/nightly tick, and 400/weekly tick, with one row per workspace per round (`queue/skill-drain.service.ts:321-342`, `:513-523`). Cron defaults are every 15 minutes, daily 03:00, and Sunday 04:00 (`thoth-runtime/src/lib/skill-drain-jobs.ts:40-64`).
- The 605 queued prefilters are all in one workspace. Because frequent is single-round and `perWorkspaceBatch=1`, that workspace can contribute only one prefilter per frequent tick despite the nominal cap of four (`queue/skill-drain.service.ts:871-895`, `:940-958`). Its best-case frequent supply is therefore 96 rows/day while the host is running and all gates pass.
- Weekly is multi-round and capped at 400, so its configured capacity can cover the current 134 panel + 136 trigger rows in one tick. But it only runs weekly, and every relevant stage spends tokens (`queue/skill-drain.service.ts:584-595`).
- Boot deferral is only a five-minute row filter for `source='boot'` (`queue/skill-drain.service.ts:909-922`, `:961-980`); it cannot explain rows queued since August 28. Foreground activity, battery, cancellation, network backoff, and process/cron availability can reduce realized throughput (`queue/skill-drain.service.ts:758-840`).
- The daily token budget is not binding. Default `maxTokensPerDay` is 2,000,000 (`queue/skill-drain.service.ts:337-343`), with hard-stop checks at tick start and per item (`:783-790`, `:821-832`). September 17 spent 6,808 tokens (0.340%); the maximum recorded day spent 551,960 (27.598%).

The backlog is **growing**. From September 12 through the query time on September 18, 227 prefilter rows were added but only one prefilter row finished; all stages added 236 rows and finished 16. Current oldest queued rows date to August 28-31. The configured caps are now ample on paper, and budget is mostly idle; realized scheduling/gating is not consuming the backlog. Even a perfect drain would judge only the 134 already-linked candidates plus candidates produced by future successful prefilters, not automatically backfill the other 2,194 NULL-judge rows.

## Judge distribution by criterion

The composite is the unweighted mean of all five criteria (`skill-judge.service.ts:344-350`). Generalization is the largest drag: 3.743, 1.053 below the 4.796 composite and 2.171 below scope. The rubric is not inherently asking for something the model synthesizer never produces: its prompt explicitly requires a reusable, repo-agnostic workflow, a “Use when” trigger, imperative steps, and removal of paths and one-off details (`skill-synthesizer.service.ts:228-248`), which mirrors the judge rubric (`skill-judge.service.ts:121-132`).

| Population | n | Composite | Novelty | Actionability | Scope | Generalization | Trigger clarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All scored | 105 | 4.796 | 4.600 | 5.076 | 5.914 | **3.743** | 4.648 |
| Template/trajectory fallback | 60 | 2.930 | 3.433 | 3.217 | 4.433 | **1.333** | 2.233 |
| Model-synthesized | 45 | 7.284 | 6.156 | 7.556 | 7.889 | 6.956 | 7.867 |

The distribution instead exposes a mixed-input problem. The fallback body literally embeds the normalized trajectory and says “Edit the body below to make it reusable” (`skill-synthesizer.service.ts:316-342`), while the rubric explicitly scores 1-3 for echoing a session or retaining file/session specifics (`skill-judge.service.ts:124-129`). Sixty of 105 judged bodies contain that fallback marker. The 45 model-synthesized bodies average 7.284 and 44 of all 105 pass 6.0, so the synthesizer can satisfy the rubric. Judge strictness is a secondary quality signal, not the reason qualifying candidates fail to promote.

## What would have to change

1. **Connect real invocation outcomes to the promotion counter and evaluator.** The owner is `skill-invocation-tracker.ts` together with the runtime seam in `triggers/skill-trigger.service.ts` / `skill-invocation-recorder.ts`. A real, identified synthesized skill use must increment the same candidate's `success_count` and call `evaluate()`. This is the primary fix; lowering thresholds without it still yields zero.
2. **Make pre-promotion repetition a coherent product state.** Owned by `skill-promotion.service.ts` and the skill exposure/trigger surface. Either candidates must be safely trial-runnable before promotion, or “three repetitions” must be derived from repeated independent trajectories/clusters rather than invocations of an inactive skill. Today `source_session_ids` never grows beyond one.
3. **Unify the recurrence checks.** Owned by `skill-invocation-tracker.ts:74-84` and `skill-promotion.service.ts:242-250`. If three contexts are intended to lower the threshold to two, the caller cannot block evaluation until three successes.
4. **Backfill/schedule judge work for existing unjudged candidates and ensure the host actually services cron.** Owned by `queue/stage-handlers.service.ts`, `queue/skill-drain.service.ts`, and `thoth-runtime/src/lib/skill-drain-jobs.ts`. Raising caps or budget is not first-line: current budget use is below 28% even on the maximum recorded day.
5. **Do not send raw trajectory fallbacks to the same promotion-quality rubric, or label/transform them first.** Owned by `skill-synthesizer.service.ts:316-342` and the boot template path in `skill-synthesis.service.ts:776-789`. This improves candidate quality, but it will not make automatic promotion reachable.

## Queries used

Every query was executed through repository `better-sqlite3` with `{readonly:true}` against `%USERPROFILE%/.ptah/state/ptah.sqlite`.

```sql
SELECT status, COUNT(*) n FROM skill_candidates GROUP BY status ORDER BY status;

SELECT COALESCE(judge_status,'NULL') judge_status, COUNT(*) n,
       ROUND(AVG(judge_score),3) avg_score, MIN(judge_score) min_score,
       MAX(judge_score) max_score
FROM skill_candidates GROUP BY judge_status ORDER BY judge_status;

SELECT COUNT(*) n, MIN(success_count) min_success, MAX(success_count) max_success,
       SUM(success_count>=3) ge3, SUM(success_count>=2) ge2,
       SUM(status='candidate') candidates,
       SUM(embedding_rowid IS NULL) no_embedding,
       SUM(replay_confidence IS NULL) replay_null,
       SUM(replay_confidence<0.5) replay_below,
       SUM(replay_confidence>=0.5) replay_pass
FROM skill_candidates
WHERE judge_status='scored' AND judge_score>=6.0;

SELECT success_count, COUNT(*) n
FROM skill_candidates
WHERE judge_status='scored' AND judge_score>=6.0
GROUP BY success_count ORDER BY success_count;

SELECT json_array_length(source_session_ids) source_sessions, COUNT(*) n,
       SUM(judge_status='scored' AND judge_score>=6.0) passing44
FROM skill_candidates GROUP BY source_sessions ORDER BY source_sessions;

SELECT SUM(success_count>=2) candidates_success_ge2,
       SUM(success_count>=3) candidates_success_ge3, MAX(success_count) max_success,
       SUM(json_array_length(source_session_ids)>=2) source_sessions_ge2,
       SUM(json_array_length(source_session_ids)>=3) source_sessions_ge3,
       MAX(json_array_length(source_session_ids)) max_source_sessions
FROM skill_candidates;

SELECT COUNT(*) total, COUNT(DISTINCT skill_id) skills, SUM(succeeded=1) successes,
       COUNT(DISTINCT CASE WHEN context_id IS NOT NULL THEN context_id END) contexts
FROM skill_invocations;

SELECT COUNT(*) candidates_with_invocations,
       SUM(successes>=2) candidates_success_inv_ge2,
       SUM(successes>=3) candidates_success_inv_ge3,
       MAX(successes) max_success_invocations,
       SUM(contexts>=2) candidates_contexts_ge2,
       SUM(contexts>=3) candidates_contexts_ge3,
       MAX(contexts) max_contexts
FROM (
  SELECT skill_id, SUM(succeeded=1) successes,
         COUNT(DISTINCT context_id) contexts
  FROM skill_invocations GROUP BY skill_id
);

SELECT COUNT(*) passers, SUM(COALESCE(i.successes,0)>=2) success_ge2,
       SUM(COALESCE(i.successes,0)>=3) success_ge3,
       MAX(COALESCE(i.successes,0)) max_success,
       SUM(COALESCE(i.contexts,0)>=2) contexts_ge2,
       SUM(COALESCE(i.contexts,0)>=3) contexts_ge3,
       MAX(COALESCE(i.contexts,0)) max_contexts
FROM skill_candidates c
LEFT JOIN (
  SELECT skill_id, SUM(succeeded=1) successes,
         COUNT(DISTINCT context_id) contexts
  FROM skill_invocations GROUP BY skill_id
) i ON i.skill_id=c.id
WHERE c.judge_status='scored' AND c.judge_score>=6;

SELECT COALESCE(CAST(replay_confidence AS TEXT),'NULL') replay_confidence,
       COUNT(*) n
FROM skill_candidates
WHERE judge_status='scored' AND judge_score>=6
GROUP BY replay_confidence ORDER BY replay_confidence;

SELECT COUNT(*) promoted_rows, SUM(residency='resident') resident,
       SUM(residency='dormant') dormant
FROM skill_candidates WHERE status='promoted';

SELECT stage,status,COUNT(*) n
FROM skill_synthesis_queue GROUP BY stage,status ORDER BY stage,status;

SELECT COUNT(*) null_judge,
       SUM(EXISTS(SELECT 1 FROM skill_synthesis_queue q
                  WHERE q.stage='judge-panel'
                    AND (q.candidate_id=c.id OR json_extract(q.payload,'$.candidateId')=c.id))) has_panel_any,
       SUM(EXISTS(SELECT 1 FROM skill_synthesis_queue q
                  WHERE q.stage='judge-panel' AND q.status='queued'
                    AND (q.candidate_id=c.id OR json_extract(q.payload,'$.candidateId')=c.id))) has_panel_queued
FROM skill_candidates c WHERE judge_status IS NULL;

SELECT stage, COUNT(*) queued,
       datetime(MIN(enqueued_at)/1000,'unixepoch') oldest_utc,
       datetime(MAX(enqueued_at)/1000,'unixepoch') newest_utc
FROM skill_synthesis_queue WHERE status='queued'
GROUP BY stage ORDER BY stage;

SELECT stage,COUNT(DISTINCT workspace_root) workspaces,COUNT(*) queued
FROM skill_synthesis_queue WHERE status='queued' GROUP BY stage;

SELECT SUM(stage='prefilter') prefilter_added,
       SUM(stage='judge-panel') panel_added,
       SUM(stage='trigger-eval') trigger_added,
       SUM(stage='archaeology') archaeology_added, COUNT(*) total_added
FROM skill_synthesis_queue
WHERE enqueued_at>=strftime('%s','2026-09-12')*1000;

SELECT SUM(stage='prefilter') prefilter_finished,
       SUM(stage='judge-panel') panel_finished,
       SUM(stage='trigger-eval') trigger_finished,
       SUM(stage='archaeology') archaeology_finished, COUNT(*) total_finished
FROM skill_synthesis_queue
WHERE finished_at>=strftime('%s','2026-09-12')*1000;

SELECT day_key,SUM(input_tokens+output_tokens) total_tokens,
       ROUND(SUM(cost_usd),4) cost_usd
FROM skill_synthesis_budget GROUP BY day_key ORDER BY day_key DESC;

SELECT SUM(input_tokens+output_tokens) total_tokens,
       ROUND(100.0*SUM(input_tokens+output_tokens)/2000000,3) pct_of_default_budget
FROM skill_synthesis_budget WHERE day_key='2026-09-17';

SELECT MAX(day_total) max_daily_tokens,
       ROUND(100.0*MAX(day_total)/2000000,3) max_pct
FROM (
  SELECT day_key,SUM(input_tokens+output_tokens) day_total
  FROM skill_synthesis_budget GROUP BY day_key
);

SELECT COUNT(*) n, ROUND(AVG(judge_score),3) overall,
       ROUND(AVG(judge_novelty),3) novelty,
       ROUND(AVG(judge_actionability),3) actionability,
       ROUND(AVG(judge_scope),3) scope,
       ROUND(AVG(judge_generalization),3) generalization,
       ROUND(AVG(judge_trigger_clarity),3) trigger_clarity
FROM skill_candidates WHERE judge_status='scored';
```

For the template/model rows in the criterion table, the read-only Node query was:

```js
const rows = db.prepare(`
  SELECT id, body_path, judge_score, judge_novelty, judge_actionability,
         judge_scope, judge_generalization, judge_trigger_clarity
  FROM skill_candidates WHERE judge_status='scored'
`).all();
const variant = fs.readFileSync(row.body_path, 'utf8')
  .includes('## Trajectory (normalized)') ? 'template' : 'model';
// Group by variant and compute the arithmetic mean of each selected column.
```
