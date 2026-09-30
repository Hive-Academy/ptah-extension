# Code Style Review — `TASK_2026_583_c0a1`

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 1              |
| Minor issues    | 6              |
| Files reviewed  | 25 (diff + 2 untracked utils files) |

Scope: read the diff of all modified files plus untracked `tool-target.utils.ts` and its spec in full; read the activity component's changed regions and its surroundings; grepped the repo for `compact-tall`, `CompactActivityTier`, `[tier]`, `as any`, `ts-ignore`, `innerHTML`, `ng-deep`, `eslint-disable`. I did not re-run the test suites.

## Five style questions

### 1. What breaks in six months?

`compact-session-activity.component.ts` (1213 lines) now owns the row builders, constants, a ~300-line inline style block and the template. The next row kind needs edits in three places in one file (`toolFeedRow`/`markFeedRow` at ~158-200, the template at ~755-800, the style block). `TONE_TOOL_STATUS` (`:118-124`) re-derives an `ExecutionStatus` from a summary tone; if the normal view adds a status colour, the compact feed will not follow unless someone remembers this map.

### 2. What would a new team member misread?

`CompactFeedRow.text` means "the target" for tool rows but "detail or label" for others (`:42-47`). The comment documents it, but there are now two row shapes behind one interface, distinguished by `tool: CompactFeedToolBadge | null`. `restoredCompactView` (`tab-persistence.ts`) applies the default height 2 only to `'compact'` tabs while `'full'` tabs keep `undefined`. That is intentional, but it is not obvious from the return shape.

### 3. What does this cost to maintain?

Two path shorteners in the same feature: `shortenToolPath` (`tool-target.utils.ts`, `.../a/b`) and `shortenPathToken` (`compact-wire-text.ts:15`, `…/a/b`). A path goes through both (`compact-session-summary.ts:685`, then `shortenRowText`). They use different ellipsis characters and different thresholds. That is drift in the making. `permission-request-card.component.ts:377` keeps a third copy, which the task explicitly left out of scope.

### 4. Where is this inconsistent with the repo?

Mostly consistent. The new util lives beside `agent-color.utils.ts` in `lib/utils/`, is named `*.utils.ts`, and has a spec beside it. It is not exported from `chat-ui/src/index.ts`, and no outside consumer needs it, so this is correct. `ToolCallHeaderComponent` now delegates to it (`tool-call-header.component.ts:258-300,327-346`). Its `getStreamingDescription` still re-dispatches on the input type guards (`:282-310`). That is the same type dispatch as `describeToolTarget`, only with verbs. This is acceptable (different output) but it is the residue of the duplication.

### 5. What would I have done differently?

Move the pure feed-row code (`CompactFeedRow`, `CompactFeedToolBadge`, constants, `markFeedRow`, `toolFeedRow`) into `compact-feed-rows.ts` beside `compact-wire-text.ts`, and leave the component to do template and state. The builders are already module-level pure functions, so this is a cut-and-paste move, and it makes them unit-testable without TestBed.

## Blocking issues

None. Module boundaries hold: chat-ui has no import from `@ptah-extension/chat` (grep empty); the changed canvas, chat-state, chat-types and chat files use barrels only.

## Serious issues

### Activity component is over the facade-rule size and this change pushes it further

- File: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:1-1213` (+204 lines in this diff; 1085-line spec beside it)
- Problem: the file mixes four responsibilities: pure row construction (`:158-200`), style constants, a large inline CSS block (`:290-500`), and the component class. This change added a second row shape and a second recap variant, so the file is now clearly over the 700-line mark and is not a single-responsibility unit.
- Tradeoff: a split is warranted, and it is cheap. The row builders and the `CompactFeedRow` types are pure and already module-level. A split costs one new file and some import lines; leaving it costs a file that grows with every row kind.
- Recommendation: extract `compact-feed-rows.ts` (types, `TONE_TOOL_STATUS`, `TOOL_BADGE_BASE_CLASSES`, `markFeedRow`, `toolFeedRow`) and optionally move the recap-markdown CSS into a sibling styles constant. Re-export the two interfaces from the existing path if the barrel needs them (barrel at `chat-ui/src/index.ts:49`).

## Minor issues

- `tool-call-header.component.ts:~270`: the `toolTarget` computed is declared between methods, after the methods that read it. Move it up with the other field declarations.
- `compact-session-activity.component.ts` template (~780-800): the check and cross `lucide-angular` blocks are duplicated; a single `@if` with a computed icon would be shorter. Low cost.
- `compact-session-activity.component.ts:118-124`: `TONE_TOOL_STATUS` maps `warning` and `idle` both to `'pending'`. This is fine now. A comment saying why would help, since the normal view has no `idle`.
- Two path shorteners (see Q3): pick one ellipsis and one threshold, or have `compact-wire-text.ts` reuse `shortenToolPath` for tool rows.
- `tab-persistence.ts`: `const storedMode: string | undefined = tab.viewMode` widens the type on purpose to read the legacy value. It works and is commented, but a one-line note on why the type is widened would prevent a "fix" back to `TabViewMode`.
- `canvas.spec.ts`: `releaseResizeHover` and `waitForSettledHeight` encode Gridstack internals (`DDManager.overResizeElement`). They are documented and justified, but they are fixed 150 ms polls and `waitForSettledHeight` keeps state in a closure; if these helpers are reused a third time, move them to `support/`.

## File-by-file

### tool-target.utils.ts (new)

Score 9/10 — 0 B, 0 S, 0 M. Pure, total, typed with the shared type guards, no `any`. Shared by both the normal header and the compact summary, which removes the previous private copies (`tool-call-header.component.ts` diff shows ~90 lines deleted). Correctly not exported through the barrel.

### tool-call-header.component.ts

Score 8/10 — 0 B, 0 S, 1 M. Good reuse. Left over: type-guard dispatch in the streaming description and a mid-class computed.

### compact-session-activity.component.ts

Score 6/10 — 0 B, 1 S, 2 M. Standalone, OnPush, signals, `input.required`, control-flow syntax all retained. No `[innerHTML]`. Markdown goes only through `ptah-markdown-block`, and the new `'snippet'` format renders with text interpolation into a `<pre>`, not as markdown, as the task requires. `::ng-deep .cs-recap-md ...` follows the existing pattern in this file and is needed to restyle the markdown lib's output. The size problem is above.

### compact-session-summary.ts

Score 7/10 — 0 B, 0 S, 1 M. Uses the shared target helper. The path is shortened here and again in `shortenRowText` (see Q3). File is 735 lines: close to the line, and not the same degree as the component; watch it.

### canvas-workspace-grid.component.ts / canvas-tile.component.ts / canvas-layout-intent.ts / canvas-layout.service.ts

Score 8/10 — 0 B, 0 S, 0 M. The new `::ng-deep gridstack-item.ptah-compact-item > .ui-resizable-*` rules target third-party DOM, so `::ng-deep` is the only option, and the file already used it (HEAD line 163). Height clamping stays in canvas; chat only holds an opaque number (`chat-types.ts` TabState doc), which respects the boundary comment on `isCompactViewMode`.

### chat-types.ts, tab-manager.service.ts, tab-persistence.ts

Score 8/10 — 0 B, 0 S, 1 M. `'compact-tall'` is removed from the union; the legacy string lives only in `tab-persistence.ts` as a named constant for migration. Persisted JSON is validated (`isPositiveInteger`). Constants are named and commented.

### chat-view.component.ts (+spec)

Score 9/10 — trivial change.

### canvas.spec.ts (e2e)

Score 8/10 — 0 B, 0 S, 1 M. Uses `expect.poll`, real pointer drags, clamping at both bounds, locked-canvas no-handle and no-commit assertion, reload persistence. Assertions test the behaviour named in AC6/AC7, not implementation details. Workarounds are documented with their cause.

### spec files (chat-ui, canvas, chat-state, chat)

Score 8/10. Tests cover both the new and legacy paths. One CSS test asserts rules via a `rule(...)` helper on stylesheet text (`compact-session-activity.component.spec.ts` ~2919 in diff). That is brittle against a reformat but covers AC4, which cannot be covered otherwise in jsdom.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| chat-ui must not import chat; barrels only | PASS | grep `@ptah-extension/chat'` in chat-ui/src: no hits |
| Standalone + OnPush + signals | PASS | activity component keeps `input.required`, `computed`, `signal`; header uses `computed` |
| No `[innerHTML]` | PASS | none added; only a spec `.innerHTML` read |
| Markdown only via `@ptah-extension/markdown` | PASS | `ptah-markdown-block` only; snippet is plain text in `<pre>` |
| `::ng-deep` only where needed, following precedent | PASS | recap md overrides and Gridstack handles; both pre-existing patterns |
| No new `as any` / `@ts-ignore` / eslint-disable | PASS | diff grep empty |
| Shared helper in `lib/utils/*.utils.ts` with a spec | PASS | `tool-target.utils.ts` beside `agent-color.utils.ts` |
| File-size facade rule (~700 lines) | FAIL | activity component 1213, summary 735 |
| No leftover `compact-tall` | PASS | repo grep (excluding `.ptah/specs`): only `tab-persistence.ts:153,166,176` (migration); historical task docs only |
| No `CompactActivityTier` / `[tier]` leftovers | PASS | grep empty |
| Single path-shortening implementation | FAIL (minor) | `tool-target.utils.ts` vs `compact-wire-text.ts:15` vs `permission-request-card.component.ts:377` |

## Maintenance debt

- Introduced: a second row shape in the feed; a 200-line growth of an already oversized component; a second path shortener in the same feature.
- Retired: `'compact-tall'` mode and `CompactActivityTier`; ~90 lines of private helpers in the normal view's tool header; the `isMarkdownContent` branch.
- Net: slightly down for the tool header and the view-mode union, up for the activity component.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the activity component is 1213 lines and grew by 204 in this change; the pure row builders should move to their own file.
- What a 10/10 version would do differently:
  - Extract `compact-feed-rows.ts` with unit tests that need no TestBed.
  - Reuse `shortenToolPath` in `compact-wire-text.ts` so one path shortener exists in the feature.
  - Collapse the duplicated check/cross icon blocks.
  - Move the `toolTarget` computed to the field block in the header.
  - Note in `TONE_TOOL_STATUS` why `idle` and `warning` map to `pending`.
