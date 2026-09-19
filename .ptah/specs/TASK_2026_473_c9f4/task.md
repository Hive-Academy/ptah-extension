---
id: TASK_2026_473_c9f4
status: backlog
type: FEATURE
title: >-
  Make skills and memory produce output the user will actually use
description: >-
  Two independent tracks over the same learning subsystem. Track A fixes memory
  retrieval and the merge path: the full-text query joins every token with OR
  and strips no stopwords, which measured 4.5 relevant results out of 20, and
  the merge candidate set is capped at the 200 most recent rows so 98.3 percent
  of memories are singletons. Track B fixes skill generation: the synthesizer is
  instructed to emit only "## Steps" and "## Gotchas" and to strip workspace
  paths, which contradicts skill-creator, the standard this repository already
  names, and produced 2,433 candidates with 0 promoted and 1 suggestion accepted
  of 17. Track A is small and proven on live data. Track B ends in a measured
  experiment that may retire the generator instead.
---

# Make skills and memory produce output the user will actually use

Two tracks. They share no files and can ship in either order. Do Track A first:
it is small, it is proven against live data, and it improves something used
every day.

Read `context.md` before planning either track.

## Track A — memory retrieval and merge

Evidence: `.ptah/specs/TASK_2026_471_b3d1/forensics-memory-quality.md`.

1. `libs/backend/memory-curator/src/lib/fts-query.util.ts:35-37` joins every
   token with `OR` and strips no stopwords. Strip common English stopwords and
   join content terms with `AND`, falling back to `OR` when `AND` returns
   nothing.
2. `libs/backend/memory-curator/src/lib/memory-curator.service.ts:606-612` lists
   the 200 most recent memories and then filters them by exact, case-sensitive
   subject equality. Replace it with a targeted query on lowercased subject, so
   the merge can reach every memory rather than the newest 200.

**Acceptance for Track A.** The four queries in the forensics report return at
least 3 relevant results of 5, measured the same way and recorded in the report.
A spec pins the query builder against stopword-only input and against a query
whose `AND` form returns nothing.

**Out of scope for Track A**: corpus cleanup, salience redesign, and any change
to the cross-encoder reranker at `memory-search.service.ts:311-340`. The
reranker already works and is the local baseline.

## Track B — skill generation

Evidence: `.ptah/specs/TASK_2026_471_b3d1/skill-quality-criteria.md`,
`forensics-skill-funnel.md`, and `metrics-authored-skills.md`.

1. Rewrite the generator prompt from `skill-creator`, not by invention. See the
   alignment section in `context.md`.
2. Replace the judge rubric. Base it on `skill-creator` Step 5 validation plus
   the structural criteria in `skill-quality-criteria.md`. `judge_score` stays a
   float in 1 to 10, so no migration is required. Re-derive the threshold.
3. Stop sending template fallback bodies to the judge.
4. Widen `SYNTHESIZED_SKILL_JSON_SCHEMA` so a skill can be a directory with
   `references/`, not a single string.
5. Run the experiment over 5 existing clusters. Score blind.

**Acceptance for Track B.** At least 2 of 5 regenerated documents score 6.0 or
above against the rubric, judged by a reviewer who does not know which pass
produced which document.

**Track B may also succeed by ending the generator.** If the experiment fails,
retire autonomous generation and keep the archaeology layer as an evidence miner
for skills a person writes. Record that result and close.
