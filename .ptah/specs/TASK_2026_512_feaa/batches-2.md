# Batches 2 — dual-pane wire console + compact-tall height tier

Chosen after reviewing the prototypes: **Variant 4 (dual-pane wire console)**,
with a **height-tier toggle** rather than a drag handle.

`libs/frontend/chat-types` is **already done** and is the frozen contract.
Neither lane may edit it.

```ts
// libs/frontend/chat-types/src/lib/chat-types.ts
export type TabViewMode = 'full' | 'compact' | 'compact-tall';

export function isCompactViewMode(mode: TabViewMode | undefined): boolean {
  return mode === 'compact' || mode === 'compact-tall';
}
```

## Why a third tier is cheap, and where it is not

Cheap: view mode is **never persisted**. `canvas-layout-persistence.service.ts`
stores tile intent only, and its own CLAUDE.md states "View mode is never
persisted here." So there is no v3 record, no migration, no Zod change.

Not cheap: **13 production sites branch on `=== 'compact'`**, and they do not
all mean the same thing. Two distinct questions are being asked with one
literal:

- *"is this a compact tier"* — controls the responsive minimum width, the
  no-resize rule, the row packer, and whether the compact card renders at all.
  These must become `isCompactViewMode(...)` (or the canvas-local tier
  equivalent). **A missed site silently treats a compact-tall tile as full.**
- *"is the height 2 units"* — only `canvas-layout-intent.ts:480-481` and
  `:602-603`. These must become a `heightUnitsFor(tier)` lookup.

`COMPACT_TALL_TILE_HEIGHT_UNITS = 3` (~352px at `cellHeight: 120`). The
prototypes render the tall tier at 472px / 4 units; that was the brief's number
and the designer's own critique argued it down to 3, because 4 units consumes
most of a laptop viewport and pushes every sibling tile off screen. Build 3.

The complete site list, from `grep -rn "'compact'"` over `libs/frontend`:

| File | Line(s) | Question being asked |
| --- | --- | --- |
| `canvas/canvas-layout-intent.ts` | 67 | the `TileHeightTier` union itself |
| `canvas/canvas-layout-intent.ts` | 380, 407, 422, 724 | is compact tier (width / packing) |
| `canvas/canvas-layout-intent.ts` | 480-481, 602-603 | height in units |
| `canvas/canvas-tile.component.ts` | 390 | is compact tier |
| `canvas/canvas-workspace-grid.component.ts` | 232-233, 257, 267 | mode → tier, and singleton checks |
| `chat-state/tab-manager.service.ts` | 2695-2710 | the binary toggle |
| `chat/chat-view.component.html` | 4 | **renders the compact card at all** |
| `chat/chat-view.component.ts` | 654, 717 | doc comments + resolved mode |
| `chat-ui/session/tab-item.component.ts` | 119 | tab affordance |
| `tribunal-panel/conductor-tile.component.ts` | 176 | tribunal tile |

`ui/native-card.component.ts:67` (`NativeCardDensity`) is unrelated. Leave it.

## Lane D — tier plumbing

Owns: `libs/frontend/canvas/src/**`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
(+ its specs), `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts`.

1. Widen `TileHeightTier` to `'full' | 'compact' | 'compact-tall'`. Add
   `COMPACT_TALL_TILE_HEIGHT_UNITS = 3` and a `heightUnitsFor(tier)` function.
   Replace **every** literal comparison per the table above. Prefer making the
   union exhaustive with `assertNever` where a switch is natural.
2. `canvas-workspace-grid.component.ts`: map `viewMode` → tier for all three
   values. **`noResize` must stay true for BOTH compact tiers** — the reason in
   the comment at line 322 applies unchanged to compact-tall. Same for
   `applyNodeInteractionState` (~line 808).
3. `tab-manager.service.ts`: `toggleViewMode` is a binary flip today. Replace
   the flip with an explicit `setViewMode(tabId, mode)` and keep
   `toggleViewMode` cycling `full → compact → compact-tall → full`, so existing
   callers keep working. `getTabViewMode` is unchanged.
4. `canvas-tile.component.ts`: the tier control. The tile header already has a
   compact/full affordance and a `NativePopoverComponent` menu — put the
   height-tier choice where it belongs in that existing UI rather than adding a
   new floating control. Label the tiers in words ("Compact", "Compact tall"),
   not "2U / 4U" as the mockups do.
5. `conductor-tile.component.ts`: one-line change to `isCompactViewMode`.

**Do not** add geometry to tile intent. **Do not** touch
`canvas-layout-persistence.service.ts` — view mode is not persisted and must
not become persisted. **Do not** touch `libs/frontend/chat-ui` or
`libs/frontend/chat`.

## Lane E — the dual-pane wire console

Owns: `libs/frontend/chat-ui/src/lib/molecules/compact-session/**`,
`libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`,
`libs/frontend/chat/src/lib/components/molecules/compact-session/**`,
`libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html}`
(+ their specs).

### 1. Stop discarding `text` and `timestamp`

`buildSummary` in `compact-session-summary.ts:326` maps `SemanticItem` →
`CompactSemanticMark` keeping only `{ id, kind, tone, label }`. Retain
`timestamp` and `text` as well.

`text` is not optional polish: it is where `Exit code 1: 3 test suites failed`
and the compaction delta live. Without it the feed renders "bash failed" and
says nothing actionable. `label` is the headline, `text` the detail.

Both are already path-redacted by `redactAbsolutePaths`. `marks` is already
bounded at `MAX_MARKS = 24`. Truncate `text` to a single display line in the
COMPONENT, not in the model.

### 2. Rebuild `CompactSessionActivityComponent` as two panes

Reference: `.ptah/specs/TASK_2026_512_feaa/prototypes/variant-4-wire-console.html`
(open it — it is the approved design). Current implementation is a four-row
grid; it becomes a status row, a two-column body, and the metrics row.

- **Left pane (~320px, fixed):** the assistant recap — today's
  `summary().content.text` — plus the outcome badge, the active agent, and the
  existing `Open full view` action when `content.actionable`.
- **Right pane (remainder):** the teletype feed. One row per mark, newest LAST
  (chronological, as the mock shows): monospace timestamp gutter, a dual-coded
  tone badge (glyph **and** colour), the `label`, and `text` as the dimmed
  detail. Error rows get a left rule.
- Row budget comes from the tier: roughly **5 rows at compact**, **10 at
  compact-tall**. Take the tier as an `input()`; do not read it from a service
  — this lib has no services and must not gain one.
- Below ~720px the two panes must stack rather than crush. The mock assumes
  880px; the grid's `MIN_TILE_WIDTH` is 480.

**Fix the mock's bug:** in the 232px variant the left pane's `Open full view`
button is clipped by the metrics row. The left pane must not overflow its
track.

### 3. Render the card for both compact modes

`chat-view.component.html:4` gates on `resolvedViewMode() === 'compact'`. A
`compact-tall` tab currently falls through to the full chat view. Use
`isCompactViewMode`. Same for `tab-item.component.ts:119`.

## Constraints for both lanes

- `ChangeDetectionStrategy.OnPush`, signals, `inject()`. No new RxJS.
- **`chat-ui` has no services and must not gain one.** Inputs and outputs only.
- **Never bind `[innerHTML]`.** `label` and `text` are assistant-derived. They
  are interpolated strings in truncating elements. Do not route a one-line feed
  row through `@ptah-extension/markdown`.
- No `[style]` string literals; Tailwind 3 + daisyUI 4 classes, matching what
  the existing components already use. The prototype's inline CSS is a mockup
  convention — translate it to classes.
- Retro is texture, not a costume: monospace gutter, dual-coded badges, a
  hairline rule. No full-tile phosphor green, no scanline overlay on the recap
  pane.
- 10px floor for metadata; the recap text stays larger.
- TypeScript strict, no `@ts-ignore`.

## Verification

From the worktree root:

```
npx nx run-many -t typecheck -p @ptah-extension/chat-types @ptah-extension/canvas @ptah-extension/chat-state @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/tribunal-panel
npx nx run-many -t test -p <your lane's projects>
npx nx run-many -t lint -p <your lane's projects>
```

Never `nx test projA projB` — Nx turns trailing names into Jest path filters and
reports green with zero tests run. Always `run-many -t test -p`, and check the
`Running target test for N projects` header matches what you asked for.
