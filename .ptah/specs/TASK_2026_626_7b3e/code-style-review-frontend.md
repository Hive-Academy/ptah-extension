# Code Style Review — Frontend (TASK_2026_626_7b3e)

Scope: `git diff 9f9a3f04f..820e89eda -- libs/frontend/` (chat-state, chat, chat-ui). Committed diff only; non-spec files read, specs skimmed by name only. No jest/nx run. Nearest siblings compared: `installSessionStats`, `handleSessionStats`, the other `is*` validators in `session-stats-snapshot.ts`.

**Score: 7/10** — sound. The change follows the established shape and keeps the boundaries. The gaps are duplication and size, not structure.

## Verdict: NEEDS_FIXES
0 Blocking, 1 Serious, 3 Moderate, 3 Minor. Nothing breaks an invariant. The Serious and Moderate items are cheap to fix and cost maintenance later.

## Checks passed (evidence)
- **Nx boundaries:** the chat-ui diff touches only `session-stats-summary.component.{ts,html}` and reads `snapshot()?.provisional`. It adds no import from `chat`. Types come from `@ptah-extension/shared` via the barrel, with `import type` or inline `type`, in all three libs.
- **Component conventions:** OnPush and signals are kept. `isEstimate` is a `computed` and the tooltips stay `computed`. The marker uses `aria-hidden="true"` on `~` plus an `sr-only` "estimated", so it is accessible. The tooltip text explains the marker.
- **Validator:** `provisional` is added with `isOptional(..., isBoolean)`, which matches the neighbouring `isOptional` entries. The helper is named like its siblings (`isRevision`, `isAmount`). The doc comment is updated.
- **Naming:** `handleSessionStatsLive` (ChatStore), `handleLiveSessionStats` (aggregator) and `installLiveSessionStats` (tab manager) follow the existing `handleSessionStats` and `installSessionStats` pairs. ChatStore stays a thin delegate like its neighbours.
- **Refactor:** `tabsForSession` extracts the background-workspace fallback that `handleSessionStats` used to inline, so there is no copy. The explanatory comment moved with it.

## Findings

### 1. Serious — `tab-manager.service.ts` keeps growing past its limit
`libs/frontend/chat-state/src/lib/tab-manager.service.ts` was 2982 lines at base and is about 3038 lines after this work (+56: `installLiveSessionStats` at ~L2265-2318, plus the `normalizeModelKey` import). The file is already far over max-lines. The new method has its own responsibility (context-window fill derivation) in an already god-object service.
**Fix:** at minimum, keep the addition minimal (see #2). Preferably put the "tab's live reading + context tokens → `LiveModelStatsPayload`" derivation in a pure function next to `deriveLiveModelStats`. Do not add more private helpers (`liveContextStats`) to the service.

### 2. Moderate — `installLiveSessionStats` duplicates `installSessionStats`
`tab-manager.service.ts` ~L2253-2262 and ~L2283-2300. Both call `acceptSessionStats` and then `updateTabInternal({ sessionStats, ...budgetPatch(snapshot, undefined) })`. The only difference is the optional `liveModelStats` spread. Two public install paths now drift independently. For example, a future change to the budget patch must be made twice.
**Fix:** give `installSessionStats` an optional `context` parameter and return a boolean. Alternatively, have `installLiveSessionStats` be the only copy and have `installSessionStats` delegate to it. If the two are kept separate on purpose, say so in the doc comment.

### 3. Moderate — Estimate marker markup is copy-pasted 4 times
`session-stats-summary.component.html` repeats the same `@if (isEstimate()) { <span …>~ / sr-only estimated</span> }` block four times, for tokens and cost in each of the two layouts. Only the `data-testid` and a font class differ. A copy-edit (for example, an aria change) must be repeated four times, and drift is likely.
**Fix:** define one `<ng-template #estimateMark let-testid>` and use `ngTemplateOutlet`. Or make a tiny presentational atom in `atoms/`.

### 4. Moderate — Inline `context` shape duplicated instead of reusing the wire type
`tab-manager.service.ts` writes `{ model: string; contextTokens: number }` twice, on `installLiveSessionStats` and on `liveContextStats`. It re-declares the shape of `SessionStatsLiveWire['context']`, so a contract change would not be caught here.
**Fix:** use `NonNullable<SessionStatsLiveWire['context']>`, or a named type exported from `shared`.

### 5. Minor — `snapshotFor` takes the caller's name as a string
`session-stats-aggregator.service.ts` `snapshotFor(stats, handler: 'handleSessionStats' | 'handleLiveSessionStats')` passes identity only to build warning text. That mixes caller identity into a validator.
**Fix:** drop the parameter and use a neutral prefix such as `[ChatStore] session stats:`. The log still names the session. If the handler name is wanted, let the caller log.

### 6. Minor — Double warning on a malformed live payload
The message handler warns and drops a payload that fails parsing. `handleLiveSessionStats` then warns again on a malformed `sessionId` and again on a bad snapshot. A malformed `sessionId` logs the raw id. Other warnings in the file log only the session id after validation.
**Fix:** consider logging once per layer, or log `typeof`, not the raw value, for the unvalidated id (L~210).

### 7. Minor — sr-only text sits flush against the value
In `session-stats-summary.component.html`, `<span class="sr-only">estimated</span>` has no trailing whitespace before the value. Some screen readers will read "estimated12.3k".
**Fix:** use `estimated ` with a trailing space, or `aria-label` on the chip.

## Five style questions
1. **Change in six months:** a second estimate source (for example a different channel) forces another `install*` variant. #2 and #4 are the places that will break.
2. **New team member:** `installLiveSessionStats` silently skips `context` for non-provisional snapshots. The doc says so, but the call site in the aggregator passes `event.context` unconditionally.
3. **Maintenance cost:** four template copies, two near-identical install methods, 56 more lines in the over-limit file.
4. **Inconsistency:** none structural. Naming, barrel imports and validators match the siblings.
5. **Alternative:** one `installSessionStats(tabId, snapshot, context?)`, a pure context-fill helper outside the service, and one estimate-mark template. That gives fewer public entry points and no extra growth of the god-service.

## Remaining uncertainty
I did not read the committed spec files or the message-handler routing registration (the handler body was seen in the diff). I did not run diagnostics, because the task forbids heavy checks.
