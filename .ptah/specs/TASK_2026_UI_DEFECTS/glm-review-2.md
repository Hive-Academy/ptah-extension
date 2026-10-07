# GLM review, part 2 (areas 6–8)

**Verdict: PASS with notes — no blocking defect in areas 6–8. Four low-severity findings: provider cache semantics (6.1), token/cost scope (6.2), duplicated cacheReported (6.3), divider grip does not track the pointer (7.4); plus one low handoff-body copy change in the budget banner (8.5). All checked deltas, stop reasons and usage math are correct.**

## Area 6 — Lane guards, stop reason, agents panel usage

### Checked against the backend

- Frontend bounds (`lane-guards-settings.logic.ts:23-52`) match `invalidLaneGuard` in `agent-rpc.handlers.ts:183-234`: safe integers, steer >= 1, stop >= 2, repeat >= 2, stop > steer. Defaults 40/60/20 match `LANE_GUARD_DEFAULTS` on both sides. Keys exist on both `AgentOrchestrationConfig` and `AgentSetConfigParams` (`rpc-agents.types.ts:149-153, 259-263`).
- Frontend pair check uses the draft value when valid, else the saved value (`laneGuardWrite`), which mirrors the backend's `readStored` fallback for a single-key write. Consistent. The backend stays authoritative on rejection, and the component maps a rejection naming a key back to that field (`laneGuardKeyInError`). Sound.

### Stop reason

- `laneGuardStopText` (`agent-card-header.component.ts:15-21`) maps both `LaneStopReason` values and returns null otherwise. The span renders only when `status !== 'running'` (`stopText` computed). Hidden-while-running and no-reason cases are pinned by the spec.
- Store copies `stopReason` at re-open, replacement, fresh spawn, and exit (`agent-monitor.store.ts` diff). Re-open assigns `info.stopReason`, which is normally absent on a spawn, so a previous reason clears on a new attempt. Sound.

### Usage numbers

- Fold (`cli-usage.utils.ts:22-41`): input/output/cache summed, context/cost/model/duration keep latest, absent stays absent — no zero substitution. Display (`cli-lane-usage-summary.component.ts`, `stats-bar.utils.ts:17-22`) uses em dash for undefined, so a provider reporting `0` shows `0`. Correct.
- Double counting: verified the SDK contract in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (SDKResultSuccess). `result.usage` is documented as per-turn in streaming-input sessions, so the fold's sum across result messages is correct for Ptah CLI. `total_cost_usd` is documented cumulative and the fold keeps the latest value, not the sum. Codex emits one usage segment per `turn.completed` (per-turn delta). No double counting found.

### Findings (area 6)

1. **Low — provider semantics differ for "in" vs "cache read" side by side.** `codex-cli.adapter.ts:1160-1164`: OpenAI's `input_tokens` includes `cached_input_tokens`, while Anthropic's `input_tokens` (Ptah CLI, `ptah-cli-stream-loop.service.ts:674-679`) excludes cache reads. The summary strip shows both fields with the same labels for all providers. Failure scenario: a Codex lane reports in 1500 / cache read 1200 and a reader adds them for a "true input" of 2700, which is wrong for Codex. No arithmetic double count inside the UI; a label or provider hint would remove the ambiguity.
2. **Low — Ptah CLI token totals and cost cover different scopes.** `ptah-cli-stream-loop.service.ts:670-685` reads `result.usage`, which the SDK documents as main-agent-loop only (excludes Task subagent and sidechain calls) while `total_cost_usd` covers the whole query pipeline including subagents. Failure scenario: a lane that delegates heavily to subagents shows a high cost next to small token counts; the user cannot reconcile them. The SDK doc says to prefer `modelUsage`. Informational for this batch; the numbers shown are never wrong, only scoped.
3. **Low — `cacheReported` duplication.** `agent-monitor.store.ts:1316-1321` sets `cacheReported` from the folded totals, while `cli-lane-usage-summary.component.ts:59-63` recomputes the same condition from `usageTotals` and ignores the store flag. Failure scenario: none today; the two definitions can drift if one is later changed without the other. The store flag is still consumed by other surfaces, so this is a note, not a defect.

### Areas found sound (area 6)

- Settings bounds, validation, defaults and error-key mapping against the backend handler.
- Stop-reason mapping, hidden while running, cleared on re-open.
- Usage fold: no zero substitution, cache summed per turn, cumulative cost kept latest, no cross-turn double counting.
- Removed `lane-cache-not-reported` header badge: the spec now asserts its absence and the state lives in the usage strip. Consistent.

## Area 7 — Sidebar divider

### Checked

- Delta math: `onSessionsDividerMouseDown` (`electron-shell.component.ts:379-391`) records `event.clientX` and the sessions width; `onSessionsDividerDrag` applies `sessionSidebarWidthFromDividerDrag(startWidth, anchor.pointerX, pointerX)` = start width + pointer delta (`session-sidebar-width.ts:53-61`). The handle emits viewport X for `direction="left"` (`electron-resize-handle.component.ts:83-86`), so the delta is direction-independent and correct. `setWorkspaceSidebarWidth` is never called; the workspace width is untouched.
- Clamp: `applyExternalSidebarResize` guards on `_sidebarResizing`, then goes through `applySidebarWidth` → `nextChosenSessionSidebarWidth(width, chosen, sidebarMaxWidth())` (`app-shell.component.ts:563-566, 593-601`) — the same min/cap/max clamp as the sessions pane's own handle. No separate clamp logic to drift.
- Escape: the handle's `endDrag(true)` re-emits `dragMoved` with the pointer-down X (`electron-resize-handle.component.ts:91-100`), so the delta becomes 0 and the start width is reapplied; `dragEnded` then persists it. Escape reverts the drag. Window blur follows the same path. `mouseup` without a move still emits `dragEnded`, so the anchor is always cleared and `commitExternalSidebarResize` always runs; no leaked resize state.
- Persistence: `commitExternalSidebarResize` → `persistSidebarWidth` stores `chosenSidebarWidth` under `SESSION_SIDEBAR_WIDTH_STORAGE_KEY` (`app-shell.component.ts:572-576, 616-625`) — the same key as the in-pane handle. One key, one writer per release, guarded by `_sidebarResizing`.

### Findings (area 7)

4. **Low (UX, documented) — the divider grip does not track the pointer.** The grip sits in document flow between the workspace sidebar and the chat column. Dragging it widens the sessions sidebar, whose left edge is at the grip, so the grip itself stays fixed while the sessions pane's right edge moves into the chat area. Failure scenario: the user drags the grip right, the cursor shows `col-resize`, but the grip stays in place — the resize happens at the sessions pane's opposite edge. The report (`sidebar-resizer-report.md`) names this as a deliberate decision and the workspace sidebar no longer has any drag handle. Functional correctness is not affected; flagging because it is the one visible oddity of the migration.

### Areas found sound (area 7)

- Delta math, clamp path, Escape/blur revert, and persistence key all verified against source.

## Area 8 — Elevation migration functional regressions

Ranked by change volume (`git diff --stat -- libs/frontend`, templates only): `session-budget-banner.component.ts` (417), `compaction-notification.component.ts` (173), `electron-shell.component.ts` (120 — reviewed in area 7). First two reviewed in full.

### session-budget-banner.component.ts

- Bindings: every previous input/output kept (`busy`, `dismiss`, `extend`, `restoreWindow`, `previewRequested`, `continueInNewSession`, `rotate`); `compact`, `usage`, `compacting` added. No lost binding.
- aria: `role` alert/status kept, `aria-live` added (`assertive` on limit); the meter `progress` carries `aria-valuemin/max/now` and a label; the sparkline `svg` is `role="img"` with a label; button aria-labels kept or added (`Dismiss`, `Dismiss and keep working`, `Compact this session`). Net improvement.
- `@if`/`@for`: structure intact; the body splits on the literal `/compact` and renders it as `code` — safe for the fixed copy set. `track $index` on a fully derived array is fine.
- test ids: `session-budget-banner`, `-title`, `-body`, `-write-error`, `-read-status` kept; `-icon`, `-meter`, `-sparkline`, `-stats`, `-used`, `-limit`, `-percent`, `-compactions` added. None removed.
- Meter clamps the bar to 0–100 and the label says "over the limit" above 100. `aria-valuenow` reports the clamped 100 when the real figure is higher — acceptable, the label carries the truth.
- Tone mapping changed on purpose (tighten info→warning; handoff warning→error; rotation stays info), documented in the component comment. Visual only.

### compaction-notification.component.ts

- Additive rework. `isCompacting` went from `input.required` to `input(false)`; the only host (`chat-view.component.html:53-58`) binds all four inputs (`isCompacting`, `completed`, `preTokens`, `postTokens`), so nothing silently hides. `stats()` guards `before < after` to null and shows nothing rather than a negative freed count. Progress semantics (indeterminate in flight, full bar when done) are correct. `animate-indeterminate` width moved from the keyframe to the element — compositor-friendly, no regression.

### Findings (area 8)

5. **Low — handoff body can render with no text where it previously showed the used/limit sentence.** `session-budget-banner.component.ts` (`handoffBody`): the old fallback `if (parts.length === 0) parts.push(\`${amount}.\`)`was removed with the`amount`helper. Failure scenario: handoff stage with zero compactions and a handoff missing or carrying`writeError` — the body renders empty and only the write-error line shows; the old banner showed the "X of Y" sentence there. The stats row now carries those figures, so no data is lost — a copy edge case, not a functional break.

### Areas found sound (area 8)

- Both largest templates: no lost bindings, no removed aria/labels, no broken control flow, no removed test ids beyond the intentional ones already covered by updated specs.

## Summary

- Areas 6 and 7: sound; findings 1–4 are low-severity notes.
- Area 8: sound; finding 5 is a copy edge case.
- Read-only review; no build, test or Nx run was executed, per the task rules.
