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
- Stable row identity: a spec with two events of the same kind in the same millisecond asserts two distinct rows,
  each tracked by its real event id (not `timestamp + kind`).
- Tile refresh: a spec that switches tabs and then workspaces asserts that the shell tiles reload, and that the
  Skills tile counts only the current workspace.
- UI change: visual-reviewer before/after screenshots, dark and light.

## User Decisions (2026-10-01)

- CLI lanes (Gate 0.1): antigravity + Glm for cross-side reviews. Codex not used (usage limit). Max 2 lanes in flight.
- Parity removals (parity-inventory.md `## Proposed Removals`):
  - Item 1, the `ptah-skill-diagnostics-accordion` component as a unit: APPROVED. Every capability inside it moves per B2-B14.
  - Item 2, "Candidates by status" panel: NOT approved. Keep it; move it to the surviving status card (`ptah-skill-pipeline-status`).
  - Item 3, "View logs" button: keep it, relabelled "Refresh", on the surviving status card.
  - Item 4, refresh on mount: NOT approved for removal. The component that takes over the moved 30-second poll also refreshes on mount.
- Coordinator agreement (cross-session, TASK_2026_580/584): `libs/shared/src/lib/types/rpc.types.ts` is a hot file. If Batch 5 needs a `workspaceRoot` param, add it as an optional field on the existing params type in the domain file under `libs/shared/src/lib/types/rpc/` (skills/curator rpc types). Leave `rpc.types.ts` untouched. A new method entry there is a last resort: one additive line, and the coordinator is told first.
