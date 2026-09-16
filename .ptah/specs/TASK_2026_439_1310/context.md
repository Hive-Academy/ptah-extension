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

| # | Phase | Task | Status |
| --- | --- | --- | --- |
| 1 | Stop disk growth: daily retention job (processed observations after 7 days, stuck-row quarantine), pre-migration rotation 3 to 1, idle incremental vacuum, storage numbers in diagnostics | TASK_2026_440_834c | in_review |
| 2 | Memory age lifecycle (recall to archival after N days unused, delete after M more), salience for ranking only, per-workspace cap | TASK_2026_443_40ec | in_review |
| 3 | Skills unblock: manual promote path, delete the fake creation invocation, stricter prefilter, backlog cleanup, namer wired or deleted | not filed | backlog |
| 4 | Activity feed correctness: newest-first, real event ids, grouping, remove the overlapping summary, tiles refresh | not filed | backlog |
| 5 | Skills evidence-first pipeline: archaeology before authoring, cross-session clustering, promotion from real `skill_invocation_events` | not filed | backlog |
| 6 | Thoth Overview (Health / Needs attention / Recent outcomes) and a durable, bounded activity ledger | not filed | backlog |

## Already done outside the phases (2026-09-14)

- Deleted two older pre-migration snapshots from `~/.ptah/state` (2026-08-25, 2026-08-30), about 2 GB.
  The 2026-09-09 snapshot is kept. The user approved this.

## Related

- TASK_2026_438_a942 — lane completion contract (found during this tribunal run).
