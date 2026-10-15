# Code Style Review: TASK_2026_629_c0b3 (Phase A, B2a/B2b/B2c)

Score: 7/10. Verdict: APPROVED WITH FIXES. No blocking issues, 2 serious, 3 moderate, 3 minor.

Scope: commits b8f529c74, 15bf287d5, df07eb2b5. I read the new files in full (lane types, responder, lane rows, token diff, both barrels) and the card diff with -w. The activity component's template was only sampled for structure. Plan D3/D4 and batches.md 170-244 were checked. No tests were run, per instructions.

## Passes

- Dependency direction holds. `chat-ui` has no import of `chat`, canvas or any orchestrator lib. The lane types are plain data in `compact-lane.types.ts`. `chat` imports types from the `chat-ui` barrel. `chat` does not import canvas.
- The type-only barrel export uses `export type {}` (chat-ui/src/index.ts:51-59). The imports use `import type` / `type` modifiers.
- Idiom is current: `inject()`, `input()`/`output()`, signals, `computed`, OnPush. There is no `as any`.
- Public functions have explicit return types (`laneKey`, `buildLaneSummary`, `respond`, `openLane`).
- The responder matches D3. It passes `requestId` to `clearPermission` (agent-permission-responder.ts:29) and keeps the same postMessage protocol as the mini panel. It is `providedIn: 'root'`.
- The elapsed timer has a release path. It is a single interval, only while a lane runs, and cleared in `onDestroy` (card:282-296).

## Findings

### 1. SERIOUS: duplicated elapsed formatter in chat-ui
`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:89-99` defines a private `formatElapsed`. The same lib already has `formatDuration(ms)` in `molecules/session/session-stats-format.ts:34`, and `duration-badge.component.ts` also formats durations. Reuse or extend `formatDuration`. If the `3m 05s` padding really differs, add that variant next to the existing one. Do not keep a third private copy in a component that is already very large. The fix is to move any new variant into the formatter module and add a spec case there.

### 2. SERIOUS: activity component is 1413 lines, template about 540
`compact-session-activity.component.ts` has the `template:` at line 420 and the closing of the class decorator at 957, so the inline template is roughly 540 lines. It also holds lane lookup tables (49-87) and a formatter. B2a/B2c added about 850 lines in total.

The component now mixes the recap, the feed, the resize and splitter logic, and the lanes/callout zones. Extract the lane zone (summary line, rows, callout) into a presentational `compact-lane-zone.component.ts` in the same folder. Its inputs would be `lanes`, `callout` and `now`. It would emit `allow`, `deny` and `laneSelected`. The lookup tables and `formatElapsed` move with it. This is the biggest maintenance cost in the change. Do it now, because the later board tile will build on this component. At the very least move the template to a `.html` file if the repo convention allows it. Check a sibling first, since inline templates are the norm here.

### 3. MODERATE: `SESSION_CARD_ACTIONS` shape should be a named, exported interface
`libs/frontend/chat/src/lib/tokens/session-context.token.ts:46-50` uses an anonymous inline type. Canvas must implement this shape for the tile provider (D4), and it needs to name the type. The token is exported from the barrel (chat/src/index.ts:32) but its type is not. Add `export interface SessionCardActions { openLane(laneKey: string): void; openSession(): void; }`, type the token with it, and export it from the barrel. The other tokens in this file are typed `Signal<boolean>` and similar, so a named type does not break the file's conventions.

### 4. MODERATE: lane-key format is an undocumented string contract
`compact-lane-rows.ts:21-25`. `laneKey()` builds `sub:`, `bg:` and `cli:` prefixes. Canvas `CanvasDetailService` must parse them (D4), but there is no inverse (`parseLaneKey`) and no exported prefix constants. Parsing in canvas by `split(':')` creates drift risk. Export a `parseLaneKey` next to `laneKey`, or export the prefix map. Also note the key is an `id` on `CompactLaneRow` that is documented as a "lane key" (types:15), which overloads the field name. Rename `id` to `key` or keep the doc comment strict.

### 5. MODERATE: file naming and placement of the responder
`libs/frontend/chat/src/lib/services/agent-permission-responder.ts` is an `@Injectable` service. Most siblings in that folder carry the `.service.ts` suffix (`agent-follow-up-queue.service.ts`, `action-banner.service.ts`, `message-sender.service.ts`). Rename to `agent-permission-responder.service.ts` (spec too) and update the barrel (chat/src/index.ts:27). The batch plan chose the unsuffixed name, so this is a plan-versus-convention call. I recommend following the convention, since it is a rename in one place now and costly after canvas imports it.

`compact-lane-rows.ts` lives under `components/molecules/compact-session/` but is a pure helper, not a component. Its name is fine, and it matches the `compact-*` helpers in chat-ui (`compact-feed-rows.ts`).

### 6. MINOR: Deny reason differs from the mini panel
`compact-session-card.component.ts` `respond()` calls `respondLane(agentId, requestId, decision)` with no reason. The mini panel (`canvas/src/lib/tile-agent-mini-panel.component.ts:135-140`) sends `reason: 'User denied'` on deny. D3 says "same protocol". Pass the same reason on deny, or default it inside the responder so every caller gets it.

### 7. MINOR: card duplicates agent lookup
`card.component.ts` calls `agentStore.agentsForSession(this.sessionIdentity())` in both `laneSummary` and `callout`. This is a small duplication. Use a private `sessionAgents` computed and feed both.

### 8. MINOR: `buildLaneSummary` has a positional `max = 3` and a long inline status-to-end derivation
`compact-lane-rows.ts:44-83` and `:62-70`. The `endedAt` terminal-status check repeats status strings that `laneStatus` already maps. Derive `endedAt` from the mapped status (`done`/`error`/`stopped`) instead of repeating raw strings. This is a small cost, but it avoids drift between the two lists.

## Boundary and plan check

| Rule | Status | Evidence |
| --- | --- | --- |
| chat-ui is presentational, no orchestrator imports | PASS | compact-lane.types.ts has no imports |
| chat must not import canvas | PASS | card imports only local and lib barrels |
| D3 responder lives in chat, passes requestId | PASS | responder:29 |
| D4 token shape, optional injection, fallback to `expandToFull` | PASS (shape anonymous, see #3) | card:105-107, `openLane` |
| D4 key builder in chat and exported | PASS | chat/index.ts:28-31 |
| `import type` for types | PASS | all type imports |
| Barrel exports for new public API | PASS | both index.ts; the token type is missing (#3) |
| kebab-case, role suffix | PARTIAL | responder lacks `.service` (#5) |
| File size / inline template | FAIL | activity component 1413 lines (#2) |
| No duplication with chat-ui helpers | FAIL | `formatElapsed` (#1) |
| Prettier reformat noise | NOTE | B2c reformatted the B2a template. It is harmless with `-w`, but it inflates the B2c diff and review cost |

## Five style questions

1. Six months out: canvas parses the lane key by string convention (#4), and a second anonymous token shape would be needed in the canvas tile (#3). The 1400-line component will absorb each further board zone (#2).
2. A newcomer would misread `CompactLaneRow.id` as the entity id when it is a prefixed lane key. They would also wonder why `now` is a card input and the card owns a 1 s timer, though the plan explains it.
3. Maintenance cost: a duplicate formatter, a duplicated status string list, and the oversized component.
4. Inconsistent with the repo: unsuffixed service filename, anonymous token type, deny reason difference.
5. I would extract the lane zone as its own presentational component, name the token interface, and reuse `formatDuration`. This keeps each unit to one responsibility, and the card then owns data and the zone owns rendering.

## Verdict

APPROVED WITH FIXES. Address #1 to #5 before the canvas batches consume this API, because #3, #4 and #5 are cheap now and expensive after canvas imports them. #6 to #8 can ride along.
