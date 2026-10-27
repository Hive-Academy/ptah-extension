# Code Logic Review — chat-layout-declutter

Score: 5/10
Verdict: REVISE
Review family: reviewer Claude (in-process); implementers codex (A,B,C,D), Glm (E)

Scope read: all non-spec diffs in canvas, chat, chat-ui (git diff main, whitespace ignored), the full
session-inspector component and html, inspector-agents-section, the canvas rail board dock/sheet/split
wiring, focus header and focus area, lane-tiles and plan-limit-tiles, session-stats-view. Not run: tests,
typecheck, build (verify was in progress; batch A report says its own verify was INCOMPLETE, so no
passing evidence exists for A-D). Hygiene checks passed: no edits outside batch scope, chat and chat-ui
never import canvas, no `any` / `@ts-ignore` / console.* added (one `as unknown as` is in a spec only),
`showStats` defaults to true and only the two canvas lane bindings pass false
(canvas-lane-view.component.ts:194, :249), so consumers outside canvas keep stats. The 758px fallback is
kept in chat-view.component.html:83, chat-input:591, lane-column.ts:10, chat-transcript.component.css:67.

## Findings

1. BLOCKING — literal `?` shown instead of `—`, `·` and `≥` in the Active subagents rows.
   `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:471,475,477-478`
   (`'? '` partial prefix, `.join(' ? ')`, fallback `'?'`). Scenario: any row with unknown usage renders the
   bare text `?`; a row with known tokens and cost renders `12k ? $0.10`; a partial CLI row renders `? 12k`.
   This breaks goal 5 (single `—`) and loses the partial/estimate marker (parity requires `≥`). It looks like
   an encoding loss of `—`/`·`/`≥`. The spec asserts the bug:
   `inspector-agents-section.component.spec.ts:226` `.toBe('?')`.
   Fix: partial prefix `'≥ '`, separator `' · '`, empty fallback `'—'` (keep `usageLabel`
   "Tokens unavailable; Cost unavailable" as the accessible name); change the spec to expect `'—'`
   and add a case for known tokens plus cost (`'12k · $0.10'`) and a partial case (`'≥ 12k'`).

2. MAJOR — plan-limit warning lost in single-focus canvas. The 32px tab's `statsTabBadge` (attention plus
   limit dot) was deleted (`canvas-rail-board.component.ts`, the `<ptah-session-inspector presentation="rail">`
   block at :504-513 has no limit input). The rail (`session-inspector.component.html:1-72`) shows only the
   needs-you count on Run. The header limit cue renders only for `splitDisplayed() || compactDetails()`
   (`canvas-focus-header.component.ts`, around :209-225). Scenario: single focus, rail compact, plan at limit —
   no warning anywhere until the user expands. Parity says near/at-limit warnings stay.
   Fix: pass `[limitSummary]="stats.inputs()?.limitSummary"` into the rail and render a `limitAwareDot` /
   warning mark on the expand button and Ctx tile, with the `fullText` in the aria-label (mirror
   `closedDetailsDescription`, board :784-794). Add a rail spec for state `near` and `at`.

3. MAJOR — failed or unsupported plan-usage refresh now shows a bare status code.
   `lane-tiles.ts:443` and `:454` return `text: snapshot.status` (for example `cli-unavailable`,
   `provider-unsupported`) where the text was "Usage unavailable · <status>". Raw enum strings are
   user-facing and no longer say what the failure is. Parity says a failed refresh must never read as empty.
   Fix: `text: \`${PLAN_EMPTY.usage}: ${humanStatus(snapshot.status)}\`` with a small status-to-sentence
   map, and use the generic sentence for the unknown-status default branch.

4. MAJOR — error and running state cues removed from the focus header. `canvas-focus-header.component.ts:164`
   keeps only `needs you`; running, error and done now appear only in the ⋯ menu (:293, hidden) or in the
   expanded inspector identity. The parity-inventory fate row says the urgent running/needs/error cue
   stays by chat controls. A failed session in a compact inspector shows no error cue.
   Fix: render a compact state chip for `state() === 'error'` (and the running cue if the inventory keeps
   it) next to `needs you`, with text and not colour alone.

5. MINOR — empty ⋯ menu. `canvas-focus-header.component.ts:278-322`: with `inspectorExpanded()` true and not
   split, the menu has `role="menu"` and zero items, but the trigger still renders (:257). Fix: render the
   trigger only when `!inspectorExpanded() || splitDisplayed()`.

6. MINOR — the avatar strip is rendered zero times while the expanded inspector is deferred.
   `canvas-focus-area` hides its strip when `inspectorExpanded` (`canvas-rail-board.component.ts:379-383`,
   `canvas-focus-area.component.ts:72-80`), but the dock strip only mounts after `@defer (when dockOpen())`
   (board :545-581). During the placeholder (skeleton) there is no selector. Exactly-once holds in the
   steady state. Fix: derive `inspectorExpanded` from "dock open and the deferred inspector loaded"
   (an `(afterRender)` flag), or use `@defer (on immediate)` or `prefetch`.

7. MINOR — the rail with no session should show only the expand control (design-spec.md:64).
   `session-inspector.component.ts:129` falls back to `EMPTY_STATS`, so Ctx/Tokens/Cost `—` tiles and a Run
   `—` tile render. Fix: `@if (stats())` around the metric loop and the Run tile.

8. MINOR — unknown limit chips are skipped in `laneFaceChips` (`lane-tiles.ts:573`), but `byChip.size`
   (:586) no longer counts those runs. A lane with 1 near-limit run and 2 unknown runs reads plain
   "Near limit" and looks like it applies to the whole lane. Fix: count `total` against known runs, or keep
   the "N of M runs" wording when any subgroup was skipped.

9. MINOR — compact accessible names are raw: `session-stats-view.ts:163` interpolates the unrounded float
   (`Cost 0.2400000001 US dollars`), and `:168` reads `Time 252000 milliseconds`. Fix: use `formatCost` and
   `formatDuration` (in the label, "4 minutes 12 seconds" style) in the aria-label.

10. MINOR — the unavailable-owner tile has label `Usage` and value `Plan usage unavailable`
    (`plan-limit-tiles.ts:76,240`), so it reads "Usage Plan usage unavailable". Fix: use value
    `Unavailable` or label `Plan`.

11. MINOR — review noise and dead export. Prettier reflow turns `canvas-rail-board.component.ts` (about 1028
    changed lines) and the board spec (1741) into mostly formatting churn. `INSPECTOR_TAB_WIDTH` is now 56
    (`inspector-dock-width.ts:32`) but the board no longer imports it, so the constant and its spec are
    dead if width accounting uses `railWidthPx`. Fix: verify the rail width is subtracted exactly once
    (`dockAvailableWidth`, board :823-829, does not subtract the 56px rail) or delete the constant.

## Checks that passed
- 56px is never persisted as the dock width: compact and expanded are one boolean in
  `inspector-open-state.service.ts`, and `dock.width()` is used only in the expanded branch (board :515-543).
- Resume, Details, Stop, Steer, Background and the request lines are retained in subagent-lane and
  agent-card (flat header actions are outside the `showStats` gates) and in the agents section.
- Todos, Task and Git sections are retained in session-inspector.html:166-185.
- Measured zero still renders as `0` (`typeof tokens === 'number'`, `session-stats-view.ts:150-160`).
- Strip placement is mutually exclusive across single, split overlay and compact sheet
  (board :379-383, :445, :562, :613), apart from finding 6.

## Required before approval
Fix 1 (blocking), 2, 3 and 4, and re-run the scoped verify for chat, chat-ui and canvas. The batch A
report states its own verify never finished, so nothing here has been demonstrated by a passing run.
