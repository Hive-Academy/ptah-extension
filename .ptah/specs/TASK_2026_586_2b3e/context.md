# Task Context - TASK_2026_586_2b3e

## Origin

Phase 4 of the Thoth umbrella TASK_2026_439_1310. Filed 2026-10-01. Requirements source:
`../TASK_2026_439_1310/tribunal/verdict.md` section C ("Root causes" 1-4 and 6, "Fix / Now").

## Task Type

BUGFIX (webview Thoth page + skill-synthesis activity backend).

## Root causes (from the verdict; re-verify line numbers on the working branch)

1. Wrong end of the feed: the backend returns the newest window oldest-first
   (`skill-synthesis.service.ts:1052-1055`), live events append at the tail
   (`skill-diagnostics-state.service.ts:163`), the feed renders `slice(0, limit)` (`event-feed.component.ts:54-64`),
   and the status card treats `events[0]` as latest (`skill-pipeline-status.component.ts:316-328`).
2. Unstable row identity: `track ev.timestamp + '-' + ev.kind` collides on same-millisecond events.
3. Repeated rows are real events: one `analyze-run` per session per drain tick (96 ticks/day), no grouping.
4. Overlapping summaries: Activity mounts `ptah-skill-pipeline-status` and `ptah-skill-diagnostics-accordion`
   together (`skill-synthesis-tab.component.ts:476-490`).
6. Shell tiles load once and freeze (`thoth-shell.component.ts:214-216`, `thoth-status.service.ts:263-266`), and
   the Skills tile counts all workspaces.

## Scope ("Now" fix from the verdict)

- Newest-first ordering end to end, and a real event id as the track key.
- Group repeated events with counts.
- Remove the overlapping summary from Activity.
- Move the trigger toggles to Settings.
- Refresh the tiles on tab switch; scope the Skills tile to the current workspace.

## Out of scope

- The Thoth Overview and the durable activity ledger: phase 6, TASK_2026_587_bffd. Keep the event id shape
  compatible with a later ULID ledger (phase 6 will own persistence).

## Acceptance

- Reachability proof (umbrella rule): a spec that fails if the production feed path does not render the newest
  event first, and one that fails if repeated same-kind events are not grouped.
- UI change: visual-reviewer before/after screenshots, dark and light.
