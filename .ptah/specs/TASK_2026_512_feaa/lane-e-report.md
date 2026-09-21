# Lane E — Dual-Pane Wire Console (the card)

## Changes

- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:27` — `CompactSemanticMark` now carries `timestamp: number` and `text?: string` (previously stripped in `buildSummary`).
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:325` — `buildSummary`'s final `.map(...)` retains `timestamp` and `text` instead of discarding them.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` — full rebuild: four-row pulse-pill grid replaced by status row → two-column body (320px recap pane + teletype feed) → metrics row. New exported type `CompactActivityTier = 'compact' | 'compact-tall'`, a required `tier` input, row-budget slicing (`feedRows`), per-mark tone glyph + kind-label badge, single-line text truncation, and a container-query breakpoint (`@container (max-width: 720px)`) that stacks the panes instead of crushing them.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts` — rewritten for the two-pane structure: zone list, feed label/text rendering, no-text → no detail element, tone-by-more-than-colour, row-budget-by-tier, and mark ordering.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts:218` — two new tests: a mark retains `timestamp`/`text`; a mark with no extra detail leaves `text` `undefined`.
- `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts:119` — `isCompactMode` now calls `isCompactViewMode(this.tab().viewMode)` instead of `=== 'compact'`.
- `libs/frontend/chat-ui/src/index.ts:45` — exports the new `CompactActivityTier` type alongside `CompactSessionActivityComponent`.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:65` — new `tier` computed (`'compact-tall'` iff `tab().viewMode === 'compact-tall'`, else `'compact'`), bound to the child's `[tier]` input at line 49.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` — one new test asserting `tier()` resolves per tab view mode.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:4` — gate changed from `resolvedViewMode() === 'compact'` to `isCompactViewMode(resolvedViewMode())`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:71` — imports `isCompactViewMode` from `@ptah-extension/chat-types`; exposes it as a `protected readonly` class field (line ~721) for the template; updates the two stale doc comments (near `mainPanelShowing` and `resolvedViewMode`) that said "'full' or 'compact'".
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — widened the `activeTabViewMode` stub to `TabViewMode`, added a `renderCompactTemplate` harness option (mirrors the existing `renderOverlayTemplate` pattern: swaps `CompactSessionCardComponent` out via `NO_ERRORS_SCHEMA` so the gate can be exercised without wiring that component's own DI graph), and a new `describe` block with three tests: compact renders the card, compact-tall renders the card too, full does not.

## Card anatomy

### Compact tier (232px, ~5 feed rows)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ⚙ Using tools                                        ptah-extension│ status
├───────────────────────────┬────────────────────────────────────────┤
│ ASSISTANT RECAP  [FINISHED]│ Teletype wire stream          5 of 9   │
│                             ├────────────────────────────────────────┤
│ Decision noted: last        │17:24:41 [✓ TOOL] Searching term...    │
│ assistant message + human-  │17:24:50 ┃[✖ TERM] bash failed         │ recap│feed
│ readable outcome. Fixed...  │         ┃ Exit code 1: 3 test suit... │
│                             │17:25:02 [✓ AGENT] Agent completed...  │
│ [backend-developer turn 4] │17:25:15 [▲ COMP] Context compaction...│
│ [ Open full view        ]  │17:25:22 [▶ PROSE] Turn completed: ... │
├───────────────────────────┴────────────────────────────────────────┤
│ claude-3-7-sonnet  3.1M tokens  $3.14  2 agents        1 compacted │ metrics
└──────────────────────────────────────────────────────────────────────┘
```

- Recap pane is a `grid`/`flex` column with `justify-between`: recap text (line-clamped) at the top, agent context + `Open full view` pinned at the bottom via `min-h-0 overflow-hidden` on the text block — the button cannot be pushed under the metrics row because the metrics row is a sibling grid row (`auto`), not a flow element inside the recap pane's own flex box. This is the prototype-bug fix.
- Feed pane shows the newest 5 marks, oldest first / newest last (chronological). The `✖ TERM` row carries a left rule (`border-l-2 border-error`) and a dimmed detail line under the label.

### Compact-tall tier (352px per Lane D's `COMPACT_TALL_TILE_HEIGHT_UNITS = 3`, ~10 feed rows)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ⚙ Using tools                                        ptah-extension│ status
├───────────────────────────┬────────────────────────────────────────┤
│ ASSISTANT RECAP  [FINISHED]│ Teletype wire stream         10 of 12  │
│                             ├────────────────────────────────────────┤
│ Decision noted: last        │17:24:02 [✓ TOOL] Reading tab-manager...│
│ assistant message + human-  │17:24:08 [✓ TOOL] Editing session-tu...│
│ readable outcome. Root      │17:24:19 [✓ TOOL] Running npx nx run..│
│ cause analysis confirmed... │17:24:35 [✓ AGENT] Agent started: ba..│ recap│feed
│ (no line-clamp at this      │17:24:41 [✓ TOOL] Searching termina..│ (scrolls
│  tier — more vertical room) │17:24:50 ┃[✖ TERM] bash failed         │  y-auto)
│                             │         ┃ Exit code 1: 3 test suit...│
│ [backend-developer turn 4] │17:25:02 [✓ AGENT] Agent completed...  │
│ [ Open full view        ]  │17:25:15 [▲ COMP] Context compaction...│
│                             │17:25:22 [▶ PROSE] Turn completed: ...│
├───────────────────────────┴────────────────────────────────────────┤
│ claude-3-7-sonnet  3.1M tokens  $3.14  2 agents        1 compacted │ metrics
└──────────────────────────────────────────────────────────────────────┘
```

### Narrow tile (< ~720px pane-track width, either tier)

```
┌───────────────────────────┐
│ ● ⚙ Using tools            │ status
├───────────────────────────┤
│ ASSISTANT RECAP  [FINISHED]│
│ Decision noted: ...        │ recap (stacked on top)
│ [ Open full view ]         │
├───────────────────────────┤
│ Teletype wire stream 5/9   │
│ 17:24:50 [✖ TERM] bash...  │ feed (below, scrolls)
│ ...                        │
├───────────────────────────┤
│ claude-3-7-sonnet  ...     │ metrics
└───────────────────────────┘
```

The stack breakpoint is a real CSS container query (`container-type: inline-size` on the body host, `@container (max-width: 720px)`), not a viewport media query — it reflects the tile's own track width, matching the pattern already used in `git-review-panel.component.ts` and `session-stats-summary.component.ts`.

## Verification

All commands run from `D:\projects\ptah-extension\.claude-worktrees\feat-notification-recap-d23df5594475`.

```
$ npx nx run-many -t typecheck -p @ptah-extension/chat-ui @ptah-extension/chat
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat-ui
- @ptah-extension/chat

√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/chat:typecheck

NX   Successfully ran target typecheck for 2 projects
```

```
$ npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --output-style=static
NX   Running target test for 2 projects:
- @ptah-extension/chat-ui
- @ptah-extension/chat

> nx run @ptah-extension/chat-ui:test
Test Suites: 28 passed, 28 total
Tests:       206 passed, 206 total
Snapshots:   0 total

> nx run @ptah-extension/chat:test
Test Suites: 86 passed, 86 total
Tests:       2 skipped, 1344 passed, 1346 total
Snapshots:   0 total

NX   Successfully ran target test for 2 projects
```

(The 2 skipped tests in `chat` predate this change — unrelated to compact-session/chat-view.)

```
$ npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/chat
NX   Running target lint for 2 projects:
- @ptah-extension/chat-ui
- @ptah-extension/chat

√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/chat:lint

NX   Successfully ran target lint for 2 projects
```

## Notes

1. **Prototype's row order for the compact tier is inverted from the tall tier and from the written brief.** The HTML mock's compact section lists rows newest-first (top); its tall section lists them newest-last (bottom). `batches-2.md` states explicitly: "One row per mark, newest LAST (chronological, as the mock shows)." I implemented newest-last for **both** tiers, consistent with the written instruction and with `marks` already arriving in ascending-timestamp order from `compact-session-summary.ts` — this needed no extra sort in the component. If the intended behavior was actually "newest first at compact, newest last at tall," that was not stated anywhere and would need explicit confirmation.
2. **The "outcome badge" reuses `summary().status`** (`text` + `tone`), not a separate finalized-outcome field. The mock's compact view shows a live status row ("Using tools ▶ RUN") and a distinct outcome tag ("FINISHED") side by side, implying two different data sources — but `CompactSessionSummary` only carries one `status`. Introducing a second "outcome" concept would mean touching `compact-session-summary.ts`'s `buildSummary`/`selectStatus` beyond the one change the brief scoped (retaining `text`/`timestamp`), so I did not. Both the status row and the recap-pane badge now show the same status text/tone.
3. **"Active agent" in the recap pane is derived from the newest `agent`-kind mark's `label`** (e.g. "Agent completed: code-logic-reviewer"), read from the full `marks` array (not the row-budget-sliced feed). There is no dedicated "current agent name" field on `CompactSessionSummary`, so this reuses existing, real data rather than fabricating a placeholder.
4. **`text` truncation is CSS single-line clamp (`truncate`) plus whitespace collapsing**, not a hard character-count cut. A collapsed-whitespace `title` attribute exposes the full text on hover. This satisfies "truncate for display in the component" without inventing an arbitrary character limit; flag if a hard limit was intended instead.
5. **Removed the old "reduced-motion fallback" test.** It asserted `motion-reduce:transition-none` on the pulse-pill row's `motion-safe:transition-[...]` classes; that row (and its only animated/transitioning element) no longer exists in the dual-pane design, so the assertion had nothing left to cover. No CSS transition/animation was added in its place.
6. Deep-dived only `libs/frontend/chat-ui` and `libs/frontend/chat`, per scope. Did not touch `canvas`, `chat-state`, or `tribunal-panel` (Lane D's `TileHeightTier` plumbing, the tier toggle UI, and `conductor-tile.component.ts`'s `isCompactViewMode` line) — those are out of scope for this lane and were left untouched.
