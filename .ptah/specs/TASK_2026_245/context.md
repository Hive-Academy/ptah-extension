# TASK_2026_245 — the replay gate has no production producer

Filed 2026-08-15 out of TASK_2026_180 B3.5, on a user decision taken during that
batch. **This is not a bug report. It is a product decision that needs making
before any wiring is worth writing.**

## What exists

`ReplayValidatorService.validate()` (`libs/backend/skill-synthesis/src/lib/gates/replay-validator.service.ts`)
grades a drafted skill against one cluster member that the draft never saw, and
writes `replay_confidence` / `replay_holdout_session_id` onto a row in
`skill_candidates` via `SkillCandidateStore.recordReplay`. It works. It is
specced against a real database, end to end, including the hold-out selection
(`gates/cluster-holdout-end-to-end.spec.ts`).

B3.5 registered its `replay` stage handler on the drain. **It enqueues nothing,
so the gate never runs in production.** That was deliberate and is the same
ordering the hold-out batch took: wiring a gate that could only ever return
`null` would have looked like a working feature.

## Why there is no producer

The gate needs two things that no production path produces together:

- a **`SkillCandidateRow` for the cluster draft**, because `recordReplay` writes
  onto `skill_candidates` and promotion reads `replayConfidence` from there;
- `clusterSessionIds` (the whole cluster) beside that row's `sourceSessionIds`
  (what the draft consumed) — the difference between the two IS the hold-out.

The second half is solved. `SkillCuratorService.runSuggestionPass` persists both
lists on the suggestion row: `memberSessionIds` is the drafted subset,
`memberCandidateIds` is every member including the held-out one.
`cluster-holdout-end-to-end.spec.ts:357` performs the recovery "exactly as a
`cluster-synthesis` stage handler would have to perform it".

The first half is the problem. **The cluster path produces a suggestion, not a
candidate.** `clustering`, `cluster-synthesis` and `judge` are not queue stages
at all — they run inline inside `runSuggestionPass` on the curator's timer, and
the pass ends at `suggestionStore.insertPending`.

## The decision

Calling `registerCandidate` on a cluster draft is what the e2e spec models, and
it is one line. It is also a real product change, and that is why this is its
own task:

A registered candidate re-enters **clustering** (a cluster draft becomes an input
to the next clustering pass), **dedup** (it competes with its own members), and
**`SkillPromotionService`** — which auto-promotes on a judge score. A cluster
skill could therefore ship to the user's library **without the user ever
accepting the suggestion it was drafted as**. The suggestion accept/dismiss flow
exists precisely because cluster drafts are the ones a human should see first.

Options, none of them yet chosen:

1. **Register the draft, exempt it from auto-promotion.** Needs a marker on the
   candidate row (a `status` member, an origin column, or a residency rule) and a
   guard in promotion, clustering and dedup. Most faithful to the gate's design;
   most surface area.
2. **Grade the suggestion, not a candidate.** Move `replay_confidence` onto
   `skill_suggestions` and have promotion read it there when a suggestion is
   accepted. No phantom candidate; needs a migration and splits the gate's write
   target in two.
3. **Grade at accept time.** Run the replay gate when the user accepts a
   suggestion, against the candidate that accept materializes. The measurement
   arrives after the human decision it was meant to inform, which may make the
   gate pointless — decide whether it still earns its cost.

## Constraints inherited from TASK_2026_180 — do not re-open

- **`null` replay confidence is the NORMAL case and promotes on the judge score
  alone.** A cluster at the configured floor (`suggestionMinClusterSize`) has no
  member to spare, so it gets no replay score. A measured `0` blocks; a `null`
  does not. Collapsing the two either blocks almost everything or blocks nothing.
- **Blocking on low confidence does not REJECT.** The row stays a candidate,
  because rejection is terminal and the floor is an untuned midpoint against a
  gate with no measured corpus yet.
- **The replay call sees the ASK and never the ACTUAL.** Merging the two channels
  makes the comparator score a summary against its own source and every candidate
  reads as excellent.
- **The drain owns every queue transition.** A stage handler hands a lane failure
  over verbatim; it never flattens it.

## Where to start

- `libs/backend/skill-synthesis/src/lib/gates/replay-validator.service.ts`
- `libs/backend/skill-synthesis/src/lib/gates/cluster-holdout.ts` and
  `gates/cluster-holdout-end-to-end.spec.ts` (the recovery, already written)
- `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts` —
  `runSuggestionPass`, the inline cluster path
- `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts` — what a
  registered candidate would trigger
- TASK_2026_180 `tasks.md` §6 and `CONTINUATION.md` for the phase-3 decisions
  above in full.
