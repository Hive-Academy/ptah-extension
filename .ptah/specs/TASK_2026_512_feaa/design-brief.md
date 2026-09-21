# Design brief — compact session tile as a "retro newsbar"

## The ask

> Enhance the compacted view. Allow resizing. Make a retro newsbar-like
> notification — there is room in the panel if we used smaller fonts and listed
> just recaps of what the agent is doing.

## What the compact tile is today

`CompactSessionActivityComponent`
(`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`)
is a four-zone CSS grid, `grid-rows-[auto_auto_1fr_auto]`:

```
┌──────────────────────────────────────────────┐
│ ● ⚙ Using tools              ptah-extension  │  data-zone="status"   auto
├──────────────────────────────────────────────┤
│ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬ ▬▬  │  data-zone="pulse"    h-5 (20px)
├──────────────────────────────────────────────┤
│                                              │
│  Decision noted: last assistant message +    │  data-zone="content"  1fr
│  human-readable outcome. Let me pin the...   │  (line-clamp-2)
│                                              │
├──────────────────────────────────────────────┤
│ 3.1M tokens   $3.14                          │  data-zone="metrics"  auto
└──────────────────────────────────────────────┘
```

The `1fr` content row holds **one** line-clamped excerpt and nothing else. At a
2-unit tile height (~240px) most of that row is empty. That empty band is the
"room in the panel" the request is about.

## The finding that makes this cheap

The pulse row already has the data a newsbar needs, and throws it away.

`summarizeLive` / `summarizeFinalized`
(`compact-session-summary.ts`) build a `SemanticItem[]` where every item carries:

```ts
interface SemanticItem {
  readonly id: string;
  readonly kind: 'tool' | 'agent' | 'prose' | 'prompt' | 'compaction' | 'terminal';
  readonly tone: 'idle' | 'live' | 'success' | 'warning' | 'error';
  readonly label: string;      // "Reading tab-manager.service.ts"
                               // "Agent started: backend-developer"
                               // "bash failed"
                               // "Context compaction completed"
  readonly text?: string;
  readonly timestamp: number;  // <-- dropped
  readonly contentKind?: 'error' | 'prose' | 'result';
}
```

`buildSummary` then maps them to `marks` with **`{ id, kind, tone, label }`
only** — `timestamp` and `text` are discarded — and the template renders each
one as an anonymous 6-pixel pill whose label survives only as a `title`
tooltip.

So the feed already exists, already sorts by time, already redacts absolute
paths (`redactAbsolutePaths`), and is already bounded at `MAX_MARKS = 24`. A
newsbar is mostly a **rendering** change plus re-admitting `timestamp` to the
mark type. No new backend plumbing, no new streaming subscription.

## Constraint: "allow resizing" is not a small change

Two deliberate decisions block it. Neither is a bug, and a prototype that
assumes free resize is not implementable as drawn.

1. **Vertical resize is off grid-wide.**
   `canvas-workspace-grid.component.ts:207` sets `resizable: { handles: 'e, w' }`.
   The comment: intent carries a *named span*, rows must stay height-aligned for
   the cell-height scroll rule, and "vertical resize has no field to write into".
   Tile height is not a stored value — it is derived from a height tier.

2. **Compact tiles are not resizable at all.**
   `canvas-workspace-grid.component.ts:322-324` sets `noResize` for every
   compact tile, because "compact width is derived, not stored: a resize handle
   would write a hidden span the user cannot see until returning to full mode."
   `applyNodeInteractionState` (~line 808) enforces the same at the node level.

**The affordance that DOES fit the existing model is a height tier.**
`TileViewConstraints` already carries `heightTier`, and the projector already
speaks it: full = 6 units, compact = 2 units. A third value (compact-tall,
3 or 4 units) is a tier the existing machinery can express, persists nothing
new, and needs no resize handle. Design for a **tier toggle**, not a drag
handle.

## What to prototype

Static, self-contained HTML mockups. Assume a tile **880px wide**, and produce
each layout at **two heights**: 232px (compact, 2 units) and 472px
(compact-tall, 4 units).

Required in every variant:

- The status row must survive in some form (session colour dot, state text,
  workspace label). It is how a user tells two tiles apart at a glance.
- The metrics row must survive (tokens, cost).
- The newsbar must show **recaps with their text**, not anonymous pills — that
  is the whole point of the request.
- Tones must be distinguishable without relying on colour alone (an error must
  not read as "just another line" to a colour-blind user).
- Smaller type is wanted, but 10px is the floor for anything a user must read.
  Timestamps and metadata may go to 10px; recap text should not.

Suggested directions — do not treat this list as exhaustive, and do not produce
four near-identical variants:

1. **Ticker.** One line, horizontally scrolling, newest entering from the right.
   Genuinely "retro newsbar". Show how it looks paused on hover, and say
   honestly whether a moving line is readable enough to be the only view.
2. **Stacked log.** Newest-first vertical list, 5-9 rows at 11px, monospace
   timestamps in a left gutter, tone as a leading glyph plus colour. Closest to
   a terminal/CRT feel and the most readable.
3. **Split.** A one-line ticker for history plus the current assistant excerpt
   retained beneath it — keeps today's most useful element and adds the feed.
4. Your own, if you see a better one.

Retro is the aesthetic direction: CRT/teletype/ticker-tape. It must still sit
inside a modern daisyUI dark theme without looking like a costume. Phosphor
green on black over the whole tile is too far; a monospace face, a scanline
hairline, and a blinking cursor are about right.

## Palette and type (use these literal values)

The app is Tailwind 3 + daisyUI 4, dark theme. Approximate tokens with:

```
base-100            #1a1d23   page
base-200            #21252b   tile body
base-300            #2a2f37   borders / gutters
base-content        #c8cdd5   primary text
base-content-muted  #7b8494   secondary text
primary             #7c6cf7   live / in-flight
success             #34b981   completed
warning             #f0b429   needs input / compaction
error               #ef4b5a   failed
```

Monospace: `ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace`.

## Deliverable format

One self-contained `.html` file per variant. Inline `<style>`, no CDN, no
network fetch, no JavaScript build step. Plain CSS — do NOT pull in the
Tailwind CDN; write the literal CSS. A little vanilla `<script>` for the
ticker animation is fine.

Each file must render standalone in a browser at 1000x700 with the variants
laid out on a dark page background, labelled, both heights visible.

Use realistic content taken from the label shapes this codebase actually
produces:

```
Reading tab-manager.service.ts
Editing session-turn-state.registry.ts
Running npx nx run-many -t test -p @ptah-extension/agent-sdk
Agent started: backend-developer
Searching terminalReason
bash failed
Agent completed: code-logic-reviewer
Context compaction completed
Turn completed
```
