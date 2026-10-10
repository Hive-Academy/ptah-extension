# Task Context - TASK_2026_439_1310

## User Request

> for the skill corpus task, i would like to rebase it to latest main as a start then i would like to
> review and criticize the whole thoth page basically the memory is being too big over time and without
> an easy and automated way you promised to enhance it so old unused memories get removed and proper
> memory management gets applied,
> 2- for skills i think its making huge investigation and recording but rather produce poor and session
> based investigation, despite all of that i don't know if it works properly or not
> those 2 parts i need to focus deeply on them to understand what we are doing wrong and how to fix
> systematically
> also the ui is completely unusable from where i stand and i don't know how to get the most out of it,
> also the activity log seems to be broken or repeating components in a bad layout

Follow-up decision: "File tasks + start phase 1" — one umbrella with phased work, phase 1 orchestrated
first in its own worktree.

## Task Type

FEATURE (umbrella)

## Complexity

Complex

## Strategy

Umbrella. Each phase is its own task and branch, orchestrated separately.

## Evidence

- `tribunal/brief.md` — ground-truth numbers from the live `~/.ptah/state/ptah.sqlite`.
- `tribunal/round1-P{1,2,3}.md`, `tribunal/round2-P{1,2,3}.md` — Council panel (codex, antigravity,
  Ollama Cloud).
- `tribunal/verdict.md` — the cited verdict. **This is the requirements source for every phase.**

## The systematic rule for every phase

The root pattern is features that are built, tested and documented but unreachable. Every phase ships a
**reachability proof**: a boot or integration spec that fails if the production path does not call
the new code or the scheduled job is not registered. Unit specs alone do not close a phase.

## Phases

| #   | Phase                                                                                                                                                                                     | Task                                                | Status         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------- |
| 1   | Stop disk growth: daily retention job (processed observations after 7 days, stuck-row quarantine), pre-migration rotation 3 to 1, idle incremental vacuum, storage numbers in diagnostics | TASK_2026_440_834c                                  | done (PR #513) |
| 2   | Memory age lifecycle (recall to archival after N days unused, delete after M more), salience for ranking only, per-workspace cap                                                          | TASK_2026_443_40ec                                  | done (PR #521) |
| 3   | Skills unblock: manual promote path, delete the fake creation invocation, stricter prefilter, backlog cleanup, namer wired or deleted                                                     | [TASK_2026_461_639c](../TASK_2026_461_639c/task.md) | done (PR #526) |
| 4   | Activity feed correctness: newest-first, real event ids, grouping, remove the overlapping summary, tiles refresh                                                                          | [TASK_2026_586_2b3e](../TASK_2026_586_2b3e/task.md) | done (PR #620) |
| 5   | Skills evidence-first pipeline: archaeology before authoring, cross-session clustering, promotion from real `skill_invocation_events`                                                     | [TASK_2026_620_a13e](../TASK_2026_620_a13e/context.md) (was 588; promotion part shipped in 578, PR #626) | backlog        |
| 6   | Thoth Overview (Health / Needs attention / Recent outcomes) and a durable, bounded activity ledger                                                                                        | [TASK_2026_587_bffd](../TASK_2026_587_bffd/task.md) | backlog        |

## Already done outside the phases (2026-09-14)

- Deleted two older pre-migration snapshots from `~/.ptah/state` (2026-08-25, 2026-08-30), about 2 GB.
  The 2026-09-09 snapshot is kept. The user approved this.

## Related

- TASK_2026_438_a942 — lane completion contract (found during this tribunal run).

## Resume point (status audit 2026-09-26)

Status: PARTIAL. Phases 1-3 are merged on main. Phases 4-6 have no task and no code.

Shipped:

- Phase 1 — TASK_2026_440_834c, PR #513 (`dbffc1938`)
- Phase 2 — TASK_2026_443_40ec, PR #521 (`5ebebee76`)
- Phase 3 — TASK_2026_461_639c, PR #526 (`06b08e6c5`)

Remaining targets:

- [ ] Phase 4 — activity feed correctness (newest-first, real event ids, grouping, tile refresh). File a child task.
- [ ] Phase 5 — evidence-first skills pipeline (archaeology before authoring, cross-session clustering, promotion from real invocation events). File a child task.
- [ ] Phase 6 — Thoth Overview (Health, Needs attention, Recent outcomes, bounded activity ledger). File a child task.

Close the umbrella when phases 4-6 are merged, each with its reachability proof.

## Curation follow-ups (filed 2026-09-30)

Filed after a review of the live database and the 2026-09-30 log. Merge today runs only at write time,
nothing retires unused skills, and curation stalls when its one provider is rate-limited.

- TASK_2026_577_cbfb — scheduled, reversible merge of near-duplicate memories already in the corpus.
- TASK_2026_578_3b00 — skill lifecycle: umbrella merge, deciding judge gate, promote on accept, usage-based
  retirement. Covers the "promotion from real invocation events" part of phase 5.
- TASK_2026_579_f2e2 — curator provider fallback on rate limit or unreachable provider.

Existing memory follow-ups from TASK_2026_563 stay open: 565, 566, 567, 568, 569, 572, 573.

## Child tasks filed (2026-10-01)

- Phase 4 — TASK_2026_586_2b3e (backlog): activity feed correctness.
- Phase 5 — TASK_2026_588_f4f8 (backlog): archaeology before authoring and cross-session clustering. The user
  decided phase 5 gets its own task, because TASK_2026_578_3b00 excludes the archaeology-first pipeline. 578 keeps
  promotion, judge gate, umbrella merge and retirement; 588 depends on it.
- Phase 6 — TASK_2026_587_bffd (backlog): Thoth Overview and the durable activity ledger. Depends on phase 4.

The umbrella stays `in_progress` until phases 4-6 are merged, each with its reachability proof.
