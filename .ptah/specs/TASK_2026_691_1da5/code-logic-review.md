# Code Logic Review — `TASK_2026_691_1da5`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 4              |
| Failure modes found | 6              |

Scope: full read of `command-center-projection.source.ts` (diff), `command-overlay.component.ts`,
`command-work-list.component.ts` (diff), `command-state-icon.ts`, the three changed specs, and the
producers of `modelUsageList` in `libs/backend/agent-sdk`. I did not run jest (orchestrator already did).

## Five logic questions

### 1. How does this fail silently?

- The restored-session provider fallback (`command-center-projection.source.ts:121-125`, `:234-239`)
  looks correct but is fed by data that carries no provider for restored sessions. Result: the
  node still shows a monogram, with no error (see S1).
- `onEscape` returns early when `activeNodeId()` is null (`command-overlay.component.ts:383`), so
  Escape on a plate whose preview has not opened yet (inside the 150 ms open delay) does nothing
  and the preview opens afterwards. Minor.

### 2. What user action produces unexpected behaviour?

- Hover a canvas sphere (`hoveredNodeId` input = X), press Escape: it only works if keyboard focus is
  on a plate or the card (`:71`, `:128`). Escape on the document/canvas does not close the
  canvas-driven preview, so the "Escape closes hover preview" fix covers only the focused case (M2).
- `dismissedHoverId` stuck check: set at `:385` from `hoveredNodeId() ?? labelHoverId`. It clears on
  (a) label enter of another id `:323`, (b) label leave when canvas hover is not the same id `:332`,
  (c) the effect at `:226-231` when canvas hover changes away and no plate hover holds it.
  I found no path that suppresses forever while the pointer is away. Residual hole: if a plate is
  hidden (`visibility:hidden` via `visibleLabelIds`) or removed while hovered, `pointerleave` may
  never fire, so `labelHoverId` stays equal to `dismissedHoverId` and condition (c) is blocked; the
  node stays suppressed until another label is entered (a) (M3). Self-heals on next hover of any
  other node; cannot block permanently.
- Escape when pinned and pointer rests on the plate: unpins and also suppresses; the user must
  leave and re-enter to see the preview. Intended.

### 3. What input data produces a wrong answer?

- `modelUsageList[0]` is the highest-cost row of the whole session including subagents
  (`session-usage-aggregator.ts:411-413` sorts by `costUSD` desc and aggregates descendants
  `:331-345`). It is not the root's model. A root on provider A with an expensive subagent model on
  provider B shows B's mark; unknown-price rows sort last (-1) (S2).
- `cliProvider('ptah-cli', ptahCliId)` with an id that is not a known brand (e.g. a UUID agent-config
  id) falls to `CLI_PROVIDER_MARK_IDS['ptah-cli']` = `ptah-cli` mark (`:25-39`). Behaviour is
  right; ids resolve through `provider()`, which now also accepts `PROVIDER_MARKS` keys. OK.
- `Object.hasOwn` guards keep `__proto__`/`constructor` out. OK.

### 4. What happens when a dependency fails?

- `sessionStats` null/absent: optional chaining yields undefined, falls to monogram. OK.
- Row present, `contextCapacity.providerId` null: `provider(null)` undefined. OK, but see S1.
- Import `@ptah-extension/chat-ui` from command-center: command-center already imports
  `chat`, `chat-state`, `chat-streaming`, `ui`. `chat-ui` has no import of command-center or `chat`
  (grep clean), so no cycle and direction is consistent (feature lib depends on shared UI lib).
  Pulling a whole barrel for one constant is heavy; acceptable. No Nx tag violation was seen
  (lint reported passing).

### 5. What is missing that the requirements never mentioned?

- Canvas label plates: scope item 1 lists "canvas label plates"; those are the DOM overlay plates
  and are covered by `knownProvider` in the overlay. No change under `scene/`, consistent with the
  stated constraint.
- No test covers the sphere/plate state word or reduced-motion `animate-spin` toggle.

## Failure modes

### Restored session still has no provider mark

- Trigger: restore a session from transcript with no live stats.
- Symptom: monogram tile instead of provider mark; fix appears to do nothing.
- Evidence: `session-history-reader.service.ts:1147-1161` documents that transcripts carry no
  provider evidence and sets `contextCapacity: resolveContextCapacity({ model })` with no route, so
  `providerId` is null (`pricing.utils.ts:~520`, `providerId = route?.providerId ?? null`).
- Current handling: fallback reads `modelUsageList[0].contextCapacity.providerId` (null).
- Recommendation: use a tab-level source that persists the provider (tab provider/route setting,
  session metadata) or accept and document the limit; the unit test passes only because it
  hand-builds `providerId: 'openrouter'`.

### Fallback row is the costliest row, not the root's

- See S2.

### Stale dismissal after a missed pointerleave

- See M3.

### Canvas-hover preview ignores Escape unless focus is on a plate

- See M2.

### Flex + truncate on the plate label

- See M1.

### Spec asserts the happy path only

- See M4.

## Blocking issues

None.

## Serious issues

### S1. Provider fallback is fed by data that has no provider for restored sessions

- File: `command-center-projection.source.ts:121-125`, `:234-239`; evidence
  `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1153-1161`
- Scenario: restored/sleeping session (the stated purpose, context.md scope 1) whose snapshot came
  from the history reader. `contextCapacity.providerId` is `null` there by design.
- Impact: the requested "proper provider icon for each session" is not delivered for the very case
  motivating the change; the fallback is dead code for restored sessions and only duplicates live
  data otherwise. The spec at `command-center-projection.source.spec.ts:21-86` hides this with a
  synthetic `providerId: 'openrouter'`.
- Fix: find where a restored tab records its provider (tab/session metadata, active provider id at
  creation) and fall back to that; or verify with a real history-reader fixture and state the
  limitation. At minimum make the test use a snapshot shaped like the reader's output.
- Confidence: PLAUSIBLE (live-stream rows at `stream-transformer.ts:818-828` may carry a provider;
  I did not trace the persisted path past `tab-manager.service.ts:2579`).

### S2. `modelUsageList[0]` is not the root session's model

- File: `command-center-projection.source.ts:123-124`, `:236-238`
- Scenario: subagents use a pricier model on another provider (aggregation spans descendants).
- Impact: wrong provider mark on the root, which is worse than a monogram because it misattributes.
- Fix: restrict to a row matching the tab's own model (`tab.sessionStats.model`) before taking its
  provider, falling back to nothing when there is no match.

## Moderate and minor issues

- M1 (Moderate) `command-overlay.component.ts:73`: `truncate` on `flex` container. `text-overflow:
  ellipsis` does not apply to flex items, so a long label is clipped by `overflow:hidden` with no
  ellipsis and the mark can be squeezed (add `min-w-0` + `truncate` on an inner span for the label).
  Same applies at `:140` only if the row is flex (it is `min-w-0 flex-1`, fine there).
- M2 (Moderate) `:71`, `:128`: Escape handled only on the plate/card. A canvas-driven preview
  (`hoveredNodeId` input) with focus elsewhere cannot be dismissed from the keyboard; WCAG 1.4.13
  wants dismissal without moving the pointer. A document-level `keydown.escape` (host listener while
  `activeNodeId()` is set) would cover it. `onEscape` also does not `stopPropagation`.
- M3 (Moderate) `:332`: `dismissedHoverId` clears only through `pointerleave`/hover change. Add
  clearing when the dismissed node leaves the projection (effect at `:240-246`) or becomes hidden.
- M4 (Moderate) Tests: `command-overlay.component.spec.ts` Escape test calls `onLabelLeave`
  directly and never exercises the canvas `hoveredNodeId` path or the effect clearing at
  `:226-231`; no test for Escape on the card; no test that a stuck dismissal clears when the canvas
  hover moves. Work-list spec drops the old glyph check and only asserts the icon element exists
  (`command-work-list.component.spec.ts:142`), not the icon, the color or reduced-motion
  (`animate-spin` absent when `reducedMotion` true). Projection spec has one case; no `ptah-cli`
  with unknown `ptahCliId`, no empty `modelUsageList`.
- m1 (Minor) `command-state-icon.ts`: `default` swallows unknown states into `CircleDashed`; fine,
  but a `never` check on `CommandWorkState` would break compile on a new state.
- m2 (Minor) Static `class="h-3 w-3"` with `[class.animate-spin]` and `[class]` on the parent span
  merge correctly in Angular (`[class]` does not drop static classes). a11y is fine: state word is
  visible text, icon is `aria-hidden`. `aria-label` on the plate repeats the state; acceptable.
- m3 (Minor) `knownProvider` is duplicated across overlay, work list and projection source with
  slightly different shapes; drift risk.

## Data flow

1. Tab/agent data -> `provider()` / `cliProvider()` (`source.ts:18-39`): OK for live and CLI lanes;
   gap S1/S2 for the root fallback.
2. Projection -> overlay/work list `knownProvider` -> mark or monogram: OK.
3. Overlay membership effect (`overlay:240-246`): pin released when node leaves; `close()` also
   cleared (spec `overlay.spec: releases a pin`). OK.
4. Escape -> `dismissedHoverId` -> `requestOpen` guard (`:418`): OK except M2/M3.
5. `aria-controls` -> `#command-node-card` rendered whenever pinned (`activeNode` set by `pin`
   `:369`): OK. If the pinned node is hidden by `visibleLabelIds` the effect at `:248-267` unpins.

## Requirements fulfilment

| Requirement                         | Status   | Gap                                               |
| ----------------------------------- | -------- | ------------------------------------------------- |
| Provider mark vs monogram           | COMPLETE | -                                                 |
| Restored-session provider fallback  | PARTIAL  | S1, S2                                            |
| Lucide state icons + visible word   | COMPLETE | M1 layout nit; icon test weak                     |
| Pin outlives node                   | COMPLETE | -                                                 |
| Escape closes hover preview         | PARTIAL  | focus-only (M2)                                   |
| aria-controls                       | COMPLETE | -                                                 |
| Hover preview grows page (N2)       | n/a      | Card is `fixed`; no layout growth; not listed     |

Implicit requirements not addressed: keyboard dismissal independent of focus (M2).

## Edge cases

| Case                                  | Handled | How                             | Concern                         |
| ------------------------------------- | ------- | ------------------------------- | ------------------------------- |
| Empty `modelUsageList`                | YES     | optional chaining               | no test                         |
| `ptah-cli` with unknown id            | YES     | falls to `ptah-cli` mark        | no test                         |
| Pinned node removed                   | YES     | effect `:244`                   | -                               |
| Escape during open delay              | NO      | early return `:383`             | preview opens after Escape      |
| Hidden/removed hovered plate          | PARTIAL | no pointerleave                 | M3                              |
| Reduced motion                        | YES     | `animate-spin` gated            | untested                        |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (S1 depends on the persisted-stats path not fully traced)
- Top risk: the restored-session provider fallback reads data that carries no provider and the wrong row, so the headline fix may not show a mark.
- What a robust implementation would add: a model-matched row selection, a real provider source for restored tabs with a fixture matching the history reader output, a focus-independent Escape, dismissal cleanup when the node leaves, and tests for the canvas-hover and reduced-motion paths.

## Re-review (fix round 1)

Scope: only the changed code. No checks run; orchestrator facts accepted.

- S2 (resolved): `tabProvider()` (`command-center-projection.source.ts:42-52`) uses the live provider
  first, then the usage row whose `model` equals `liveModelStats.model || sessionModel ||
  overrideModel`; no match or no model yields undefined (monogram), never the costliest row. Used
  for child tabs (`:134`) and root (`:243`). Residual: if `liveModelStats.model` is an alias that
  differs from the row's `model` string, the match misses and the monogram shows; this fails
  safe (no misattribution). Moderate at most.
- S1: accepted by the user as a known limit; not re-raised.
- Label ellipsis (resolved): `command-overlay.component.ts:73-82` puts `min-w-0 truncate` on an
  inner label span with the mark outside it, so ellipsis now applies.
- Escape during open delay (resolved): `onEscape` (`:382-393`) now proceeds when `openTimer` is
  pending, sets `dismissedHoverId`, calls `cancelOpen()`, then closes. Dismissal clears via the
  existing leave/hover-change paths. No new stuck path found.
- Still open, not re-raised as blocking: M2 (Escape only when focus is on plate/card, so a
  canvas-hover preview cannot be dismissed from elsewhere) and M3 (missed `pointerleave` on a
  hidden plate). Both are Moderate, user-visible only in narrow cases.
- Tests: new cases cover the higher-cost different-provider row first, empty list, null provider
  on a matching row, unknown `ptahCliId`, Escape in the open delay, label structure, state words,
  icons and `animate-spin` with reduced motion on/off. This closes M4 except the canvas-hover
  Escape path.

Updated score: 8/10. Verdict: APPROVED. Remaining Blocking: 0. Remaining Serious: 0.
