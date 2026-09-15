# Tribunal verdict — Thoth: memory lifecycle, skill synthesis, UI

Council, 2 rounds, 3 families. Arbiter: Claude (orchestrator).
P1 = codex · P2 = antigravity · P3 = Ollama Cloud (opus tier).
Inputs: `brief.md` (live-DB measurements), `round1-P{1,2,3}.md`, `round2-P{1,2,3}.md`.
P2 exited without its Round 1 file on the first run and was resumed once; it is not dropped.

## Verdict

The main defect is not bad algorithms. **Thoth ships lifecycle features that are built, unit-tested and
documented, but never connected to a production caller.** Four independent cases, all confirmed by
the arbiter in code:

| Built and tested | Production caller | Effect measured in the live DB |
| --- | --- | --- |
| `ObservationQueueStore.purgeOlderThan` (`observation-queue.store.ts:155,648`) | none (spec only) | 200,725 processed rows, ~1 GB, 80% of the DB |
| `MemoryDecayJob.run` (`memory-decay.job.ts`) | none — `diagnostics.service.ts:45` only reads `lastDecayInfo()`; no cron job in `start-thoth-cron.ts` | 0 archival, 0 expired, 33,415 memories kept forever |
| `CandidateNamerService.nameCandidate` (`candidate-namer.service.ts:117`) | none — registered in DI (`register.ts:98,196`) only | every candidate shows a first-prompt slug |
| `SkillInvocationTracker.recordInvocation` (the only code that increments `success_count` and calls promotion) | none | 0 promotions ever, manual Promote included |

Each one had specs, and `memory-curator/CLAUDE.md` even states the decay job is "registered with
cron-scheduler". Unit tests prove a unit works. Nothing proves the unit is *reached*. That is the
systematic fix the user asked for: every fix below ships with a **reachability proof**, meaning a
boot/integration spec that asserts the scheduled job exists or the production path calls the
service. It does not ship with more unit specs.

The second pattern: **the skill pipeline authors before it has evidence**, then asks for a proof no path
can produce. That is why it records a lot and outputs session-shaped noise.

## A — Memory: why it only grows, and the fix

### Root causes (consensus P1, P2, P3; arbiter-verified)

1. Processed observations are never deleted (table above). ~756 MB of it is `tool_response_text`.
2. The decay job never runs (table above).
3. Even if it ran, it could not archive. `scoreMemory` feeds the stored composite salience back in as
   `base` (`salience-scorer.ts:55-71`), all terms are additive and non-negative, so the score floors at
   about 0.65, while archival needs `< 0.1` (`memory-decay.job.ts:91`). (P1, P2 arithmetic, P3)
4. Nothing deletes memories. The sweep deletes only rows with `expires_at`, and no writer sets it
   (`memory.store.ts:198`, `memory-decay.job.ts:72`).
5. The disk cost is multiplied: `rotate('pre-migration', 3)` keeps three full copies of an already
   bloated DB (~3.2 GB), and the daily `incremental_vacuum(100)` frees about 400 KB
   (`start-thoth-cron.ts:344-355`).
6. Migration `0039` reaped unprocessed rows older than 30 days **once**; it is not recurring, so 5,106
   stuck rows (oldest 2026-07-28) came back.

### Fix (settled)

- **Lifecycle uses age, not salience** (P1, P2, P3 converged in Round 2). Unpinned `recall` not used for
  N days → `archival`. `archival` not used for M more days → delete (chunks, FTS, vec rows too).
  `core`/pinned rows are exempt. Plus a per-workspace count cap. Start with N=30, M=60 (P2) as
  settings, with a dry-run preview.
- **Salience is for ranking only.** Delete the feedback loop and store an immutable base. A
  multiplicative form (`base * recency + use terms`) makes it decay (P2, P3). Delete the `< 0.1`
  lifecycle branch.
- **One `memory-retention` daily cron job** that runs, in bounded batches: the processed-observation
  purge at **7 days** (unanimous in Round 2), the recurring stale-unprocessed reap, and the memory age
  rule. It is idle/power-gated like the skill drain.
- **Stuck unprocessed rows**: never mark them processed (P1, correct — that fakes consumption). After
  14 days stuck, keep `session_id/kind/error` in a small ledger and delete the payload (P3, P1's
  original quarantine shape).
- **Disk**: after the first purge, reclaim by incremental vacuum in large steps during idle time, not a
  full `VACUUM` in a startup migration on a 1.28 GB file (P1 over P2 — a boot-path VACUUM is exactly the
  class of boot stall TASK_2026_380/383 removed). Cut pre-migration rotation from 3 to 1. Bound the
  `reset` kind.
- **Reachability proof**: a spec that boots `startThothCron` and asserts `@ptah/memory-retention` is
  upserted, plus an integration spec with a fake clock that proves rows actually leave the table.

## B — Skills: why it investigates a lot and produces noise, and the fix

### Root causes

1. **Author-before-evidence.** The `prefilter` stage calls `analyzeSession`, which drafts the candidate,
   then enqueues archaeology and the gates afterward (`stage-handlers.service.ts:266-286`). The
   synthesizer reads a verdict that does not exist yet (`skill-synthesis.service.ts:781-786`), and its
   prompt says to produce a skill even for a one-off session (`skill-synthesizer.service.ts:243`).
   (P1 found this; P2 and P3 adopted it.)
2. **Loose eligibility.** `passesPrefilter` passes on turn depth alone (`skill-synthesis.service.ts:1188-1196`),
   so resume letters, HubSpot questions and tribunal prompts become candidates. (P3, P2)
3. **Names are the first prompt.** Slug from the first user message (`trajectory-extractor.ts:230-232`),
   boot sessions skip the LLM (`skill-synthesis.service.ts:776-780`), and the namer is dead. (P2, P3)
4. **Fake telemetry.** Every new candidate writes one `succeeded: true` invocation
   (`skill-synthesis.service.ts:916-924`) — the 2,432/2,432. (P1, P2, P3)
5. **Promotion cannot happen.** `evaluate` returns `below-threshold` under `successesToPromote`
   (`skill-promotion.service.ts:209-216`). The manual Promote RPC calls the same `evaluate`
   (`skill-synthesis.service.ts:1208-1213`). Real usage *is* captured, but into the slug-keyed
   `skill_invocation_events` (`skill-trigger.service.ts:514-543`), which never feeds candidate counters.
   (P1's precision on this point is the correct one.)

### Fix

**Now (unblocks the user, small):**
- A separate manual promote path that bypasses only the frequency threshold and keeps dedup, schema
  and write checks. (unanimous)
- Delete the creation-time fake invocation. Delete the depth-only prefilter branch. Require edit, tool
  or test evidence. (unanimous)
- Run a one-time cleanup of the 2,426-candidate backlog with a report: reject anything with no code
  evidence and no verdict.
- Namer: call it after registration, or delete it. Do not leave it registered and unused. (P1, P3)

**Target design (the systematic fix):** evidence-first. prefilter → archaeology → reject
degraded/no-routine verdicts (visible reason) → cluster routines across ≥ 2 sessions → author ONE
draft from the cited steps → judge + trigger eval → probation → promote on real usage from
`skill_invocation_events`. Delete the "still produce a skill" instruction and the single-session
auto-candidate. (P1, adopted by P2 and P3)

**Live disagreement:** P2 warns that archaeology-first stalls, because archaeology is backlogged and
56/136 verdicts are degraded. The arbiter sides with P1: the backlog exists *because* every loose
session drafts first and chains two or three paid stages. With the tighter prefilter, archaeology runs
on far fewer sessions. Stage it anyway: ship "Now" first, then invert the stage order.

**Reachability proof:** an integration spec in which a real (fake-lane) session that is eligible twice
across contexts ends `promoted`, and a conversation-only session produces nothing.

## C — Thoth UI: why it is unusable, and the fix

### Root causes (arbiter-verified)

1. **The activity feed shows the wrong end.** The backend returns the newest window oldest-first
   (`skill-synthesis.service.ts:1052-1055`), live events append at the tail
   (`skill-diagnostics-state.service.ts:163`), the feed renders `slice(0, limit)`
   (`event-feed.component.ts:54-64`), and the status card treats `events[0]` as latest
   (`skill-pipeline-status.component.ts:316-328`). New activity never reaches the screen. (P3, P1)
2. **Unstable row identity.** `track ev.timestamp + '-' + ev.kind` collides on same-millisecond events of
   the same kind. **It does not crash:** Angular 21 logs NG0955 in dev mode only and reuses DOM nodes
   (P1 and P3 verified this in the framework source; P2's NG0956-throw claim is wrong).
3. **Repeated rows are real events.** Every drain tick emits one `analyze-run` per session, 96 ticks/day,
   with no grouping. (P3)
4. **Overlapping summaries, not duplicated feeds.** Activity mounts `ptah-skill-pipeline-status` and
   `ptah-skill-diagnostics-accordion` together (`skill-synthesis-tab.component.ts:476-490`). "Last
   analysis" and accepted counts appear in both, but the histogram and the event feed appear only in the
   accordion (arbiter grep). P2's "duplicate histograms and feeds" is overstated, and P3 endorsed it
   without checking.
5. **Internals as the product.** Four implementation-named tabs with 5+5 subviews, trigger toggles and
   lane settings ahead of outcomes. Storage health (DB bytes, queue bytes, stuck age, retention) appears
   nowhere (`diagnostics.service.ts:62`, `memory-stats-strip.component.ts:25`). (P1)
6. The shell tiles load once and freeze (`thoth-shell.component.ts:214-216`,
   `thoth-status.service.ts:263-266`), and the Skills tile counts all workspaces. (P3)

### Fix

- **Now:** newest-first plus a real event id as the track key. Group repeated events with counts. Remove
  the overlapping summary from Activity. Move the trigger toggles to Settings. Refresh the tiles on tab
  switch.
- **Target:** open Thoth on one **Overview**: *Health* (DB size, reclaimable bytes, last/next retention,
  skill funnel with oldest queued age, failed jobs, gateway status), *Needs your attention* (reclaimable
  storage, candidates to review with evidence, failed jobs), and *Recent outcomes* (one durable,
  newest-first, cross-subsystem activity ledger with ULID ids and bounded retention). Tabs become task
  pages, and diagnostics go under Advanced. (P1, with P2's plain-language event rows)
- An evidence card per skill: sessions, projects, cited routine, verdict, judge and trigger scores, and
  the exact reason it is pending, rejected or promoted.

## Recommended order

1. Stop disk growth: the retention job (processed purge at 7 days, stuck-row quarantine), pre-migration
   rotation to 1, and an idle vacuum. Includes reachability specs.
2. Memory age lifecycle and ranking-only salience.
3. Skills "Now": manual promote, no fake invocations, stricter prefilter, backlog cleanup, namer
   resolved.
4. Activity feed correctness (ordering, ids, grouping, no overlap).
5. Skills evidence-first pipeline.
6. Thoth Overview and the durable activity ledger.

## Panel

- **P1 codex** — the most complete and most careful. Found the stage inversion, the migration-0039
  predicate and the manual/auto telemetry split. Corrected three of its own Round 1 overclaims.
- **P2 antigravity** — found the dead namer and the salience arithmetic. Overstated the UI duplication
  and the Angular error. Pushed back on archaeology-first because of throughput. Needed a resume to
  deliver.
- **P3 Ollama Cloud** — found the wrong-end feed slice and the frozen shell tiles. Withdrew its crash
  claim and its 14-day retention. Endorsed P2's duplication claim without checking.
- Anonymization was by label only. It is best-effort, and panelists may still infer vendors.
