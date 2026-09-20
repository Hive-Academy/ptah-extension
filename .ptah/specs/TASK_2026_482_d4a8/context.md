# Context — renderer typewriter drives full change detection

Full prior analysis: `.ptah/specs/TASK_2026_480_c2d8/renderer-analysis.md`.

## The measurement

On a live host, 16 logical cores, 7 sessions open:

| Process | Role | Lifetime average (67 min) | RAM |
|---|---|---|---|
| 14932 | **renderer** | **94% of one core** | 1,051 MB |
| 13840 | main | 7% of one core | 295 MB |

The main process is nearly idle. The renderer never is.

## The mechanism, established by three independent agents

1. **`StreamingQuotesComponent` has no terminating branch.**
   `libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.ts:90-129`.
   It types at 50 ms, pauses 2,000 ms, deletes at 30 ms, then calls
   `startTyping()` again — forever. `displayedText.set(...)` fires on nearly
   every tick. Only `ngOnDestroy` stops it.

2. **It is mounted per streaming bubble.**
   `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:184`
   renders it under `@if (isStreaming())`, and `isStreaming` resolves to
   `i >= finalized.length` — true when the tab **holds a `streamingState`**, not
   when a turn is actually live. `chat-streaming/CLAUDE.md` documents how a tab
   strands an unclearable `streamingState` (TASK_2026_382 B5).

3. **The renderer is Zone-based, and the timer is not exempted.**
   `apps/ptah-extension-webview/src/app/app.config.ts:117` uses
   `provideZoneChangeDetection`. No `runOutsideAngular` anywhere in this
   component. So each signal write schedules a full `ApplicationRef.tick()` —
   a whole view-tree traversal across every open tile.

Seven stranded bubbles at 20–33 Hz is roughly 200 full traversals per second.
That is the pegged core.

## Two further defects in the same file

- **Period bug.** When the delete cycle ends (`isDeleting = false`, line 121)
  the interval is never re-armed, so it keeps running at the 30 ms delete
  period while typing the next quote. It is permanently 33 Hz rather than the
  intended 20 Hz.
- **Dangling handle.** Line 107 clears the interval but does not null
  `this.typingInterval`, so the field holds a dead handle during the pause.

## Two dead timer sources found alongside, both verified

- **`StreamingTextRevealComponent`** is never mounted. A repository-wide search
  for `ptah-streaming-text-reveal` and `StreamingTextRevealComponent` returns
  only the component, its spec, and two barrel exports
  (`chat-ui/src/index.ts:20`, `chat/src/lib/components/index.ts:40`). It
  contains a genuine 50 Hz idle spin plus an effect that re-enters at 50 Hz,
  but the code is unreachable.
- **`BackgroundAgentStore.tick`** has zero consumers. A word-boundary sweep for
  `\btick\b` across `libs/frontend` and `apps/*/src` finds no read outside the
  store itself. It still drives a 1 Hz zone-patched interval.

## Scope

1. Stop the change-detection amplification in `StreamingQuotesComponent`.
   The original hypothesis — that running the interval and signal writes
   outside `NgZone` would remove `ApplicationRef.tick()` — was verified and
   rejected: Angular's `ChangeDetectionSchedulerImpl` still schedules
   `ApplicationRef._tick()` for dirty signal consumers even when written outside
   the Angular zone. The shipped fix removes the signal and template binding
   entirely, runs the interval outside `NgZone`, and writes quote fragments
   directly to the owned DOM element via `textContent`, avoiding change
   detection passes completely.
2. Fix the period bug and the dangling handle.
3. Delete `StreamingTextRevealComponent` and its spec and barrel exports.
4. Delete `BackgroundAgentStore.tick` and the interval that drives it, if and
   only if you re-confirm it has no consumers.

## Explicitly OUT of scope

Do **not** change `isStreaming()` or the stranded-`streamingState` lifecycle.
That is the deeper root cause and it belongs to the TASK_2026_382 B5 area. A
change there has a much larger blast radius and needs its own task. This task
makes the per-tick cost cheap and the timers honest; it does not change when
the component mounts.

## Constraints

- `ChangeDetectionStrategy.OnPush` is mandatory and already present. Keep it.
- Repository convention: unused code is deleted completely, not renamed,
  re-exported or commented out.
- `catch (error: unknown)`, narrow with `instanceof Error`. No `@ts-ignore`.
