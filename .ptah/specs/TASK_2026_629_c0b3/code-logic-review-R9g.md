# Code Logic Review R9g (TASK_2026_629_c0b3)

Review family: Claude (implementer: codex)

Batch: R9g, opt-in sub-agent tile in the execution tree.
Score: 6/10
Verdict: APPROVE-WITH-FIXES (fix findings 1 and 2 before the batch is accepted; finding 3 is a hard gate on R9n)

Scope read in full: `execution/subagent-tile.component.ts`, its spec, `execution-node.component.ts` (diff plus every
`<ptah-execution-node` site), `execution-node.ptah-ui.spec.ts` (diff), `message-bubble.component.ts/.html/.spec.ts`
(diff). Cross-read: `background-agent-strip.component.ts:96,109`, `background-agent-tray.component.ts:118-150,285-330`,
`compact-lane-rows.ts:30-100`, `agent-monitor.store.ts:531-600,727-760`, `permission-handler.service.ts:208-300`,
`session-context.token.ts`, `canvas-tile.component.ts:610-630`, `chat-ui/src/index.ts:36-42`, `batches-rail-r9.md`.

Checks run (lock runner, one at a time, `--testFile`, no coverage): `subagent-tile.component.spec.ts` 4/4 pass;
`execution-node.ptah-ui.spec.ts` 30/30 pass; `message-bubble.component.spec.ts` 18/18 pass. No typecheck or lint was run (not allowed
for this review), so the module-boundary and rootDir consequences of finding 1 are inferred, not observed.

## Findings

### 1. Serious: relative source-path import across libs (known defect, confirmed)

- File: `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts:5`
  `import { formatAgentElapsed } from '../../../../../../chat-ui/src/lib/molecules/background-agent-strip.component';`
- Why it is wrong: it reaches into another Nx project's source tree. `@nx/enforce-module-boundaries` rejects relative
  imports between projects. A path that escapes the `chat` project root can also trip `rootDir`/`include` in the
  `chat` tsconfig and the Electron `validate-deps` gate that runs on push. The pre-push hook is the first place this
  would show up. It also makes `chat` compile chat-ui's file twice, once through the alias and once through the path.
- Cause: `formatAgentElapsed` is declared at `background-agent-strip.component.ts:96` but the barrel
  `libs/frontend/chat-ui/src/index.ts:37-42` exports only `BackgroundAgentStripComponent` and the three types.
  `chat-ui/src/index.ts` is the correct entry point; `chat` already imports `AgentSummaryComponent` and
  `ThinkingBlockComponent` from `@ptah-extension/chat-ui` in `execution-node.component.ts`.
- Fix: in `chat-ui/src/index.ts` add `formatAgentElapsed,` to the existing export block from
  `./lib/molecules/background-agent-strip.component` (value export, next to `BackgroundAgentStripComponent`). In
  `subagent-tile.component.ts:5` replace the relative import with `import { formatAgentElapsed } from '@ptah-extension/chat-ui';`.
  Do not copy the function into `chat`; the contract wants the shared formatter.
- Ownership: `chat-ui/src/index.ts` is not listed in any R9 batch. I grepped `batches-rail-r9.md`; the only `index.ts`
  entries are `canvas/src/index.ts` (R9i, line 222) and `chat/src/index.ts` (R9h, line 329). R9d and R9o edit other
  chat-ui files, not the barrel. Add `chat-ui/src/index.ts` to the R9g file list (one-line edit, no collision), and
  re-run `chat` and `chat-ui` typecheck plus `lint` after the change.
- Other relative cross-lib imports in the batch: none. The remaining imports in the tile, in `execution-node` and in the
  three specs are `@ptah-extension/*` aliases or in-lib relative paths (`../../../tokens/session-context.token`,
  `./subagent-tile.component`).

### 2. Serious: tile status and lane key are wrong for background agents

- File: `subagent-tile.component.ts:63-70` (status), `:96-97` (lane key).
- Line 67 returns `'background'` when `node.isBackground` is true before line 68 can see `recordStatus === 'completed'`.
  `isBackground` is a permanent flag on the Task placeholder node (`transcript-agent-facts.ts` calls it a placeholder
  whose values belong to the SDK record). Scenario: background agent finishes, record becomes `completed`, tile still shows
  the spinner icon and "In background" forever. A reloaded session with an `isBackground` node and no record does the same.
  The tray handles exactly this case (`background-agent-tray.component.ts:285-292`, `backgroundStatus` at `:124-143`:
  a terminal record overrides a still-`running` background entry). The writer reused the strip's icons but not its
  status reconciliation.
- Lane key: `openLane` picks `bg:` only when `status() === 'background'`. `buildLaneSummary` (`compact-lane-rows.ts:75`)
  builds `bg:` only when `record.status === 'background'`, otherwise `sub:`. For a background node whose record is
  `running` or `completed` the tile asks for `bg:<id>` while the lane list holds `sub:<id>`. The lane cannot be found
  and the click does nothing visible. The inverse mismatch is also possible. The tile's status and the lane kind must
  share one rule.
- Also in the same computed: node status `resumed` (an interrupted node resumed in a new agent) falls through to
  `running`, so the old node shows a permanent spinner. Node `streaming` after the stream ended without a terminal
  event shows the same.
- Fix: order the checks terminal-first (record `completed`/`failed`/`stopped`/`killed`, then node `complete`/`error`/
  `interrupted`/`resumed`), and only then `background`. Derive the lane kind from `record?.status === 'background'`
  with the same predicate as `compact-lane-rows.ts`, or export a shared `laneKeyForAgent(record, toolCallId)` helper
  from `compact-lane-rows.ts` and use it. Map `resumed` to `stopped`. Add spec cases listed under Missing tests.

### 3. Serious (latent, becomes live in R9n): permission can become unanswerable in tile mode

- Files: `subagent-tile.component.ts:36-44,100-103`; `permission-handler.service.ts:275-300`.
- In tile mode the descendant tool cards are not rendered, so their inline permission buttons are gone. The only
  affordance is the "Permission needed" badge, which is `[disabled]` whenever `SESSION_CARD_ACTIONS` is not provided
  (`canOpen`). Descendant tool ids are still in the execution tree, so `unmatchedPermissions` (`:284,300`) counts them as
  matched and `chat-view.component.html` shows no fallback card. Result for a host that sets `agentTileMode=true` without
  a provider: the sub-agent blocks on an approval the user can see but cannot act on. This matches the contract
  ("absent provider -> safe unavailable action") and R9g alone is not reachable, because nothing passes `true` yet. It is
  still a silent dead end, not a safe one.
- Fix for R9n (record as an acceptance gate there): the host that opts in must always provide `SESSION_CARD_ACTIONS`
  (the `skipSelf`+`optional` factory with local fallback described in R9n does this), and R9n needs a test where
  tile mode is on, a descendant permission is pending, and the badge click opens the lane. Optional hardening in R9g: when
  `canOpen()` is false and a permission is pending, render the badge text as "Permission needed (open the agent)" rather than a
  silent disabled control, or have the tile stay inline in that case.

### 4. Moderate: no positive test of the permission click path or of status variants

`subagent-tile.component.spec.ts` covers: running tile, bg routing (only with `isBackground` and no record), expired permission
ignored, no provider. Missing:
- permission still pending, click, `openLane` called with the right key (the only test of that button proves the negative);
- a different permission now pending on another tool: `findPendingPermission().id !== permission.id` must do nothing;
- background node with record `completed`/`failed` (would have caught finding 2);
- node `interrupted`, `resumed`, `error`; record `failed`/`killed`;
- node with no `toolCallId` (button disabled, no lane call);
- `AgentMonitorStore` absent (optional inject returns null; `record()` uses `?.` so it should work, untested);
- pending-permission badge reacts when the lookup's backing signal changes (the spec uses a plain closure, not a signal).
`execution-node.ptah-ui.spec.ts` proves recursion for message, tool and SendMessage. It does not assert that
`getPermissionForTool` is forwarded to the tile, and it does not assert the fade class is present when `isFinalizing` is false
(only absent when true). `message-bubble.component.spec.ts` tests `agentTileMode=true` forwarding but not the default `false`.

### 5. Minor

- `subagent-tile.component.ts:26` renders "1 tools"; pluralize.
- `execution-node.component.ts:375` `[agentTileMode]="agentTileMode()"` inside `bubbleChildTemplate` is in the `@else` branch, so
  the value is always `false` there. Harmless, but it is dead propagation; either drop it or leave a comment that the inline
  bubble always renders its children inline.
- Tile duration is a snapshot (`record.durationMs` or `node.duration`); a running agent shows a stale or empty time. The
  strip behaves the same way, so this is parity, not a regression.
- Whole template is on a few very long lines in the new files (style reviewer's area, not logic).

## Contract and checklist results

| Item | Result |
| --- | --- |
| `agentTileMode` input across message-bubble -> execution-node | OK. `message-bubble.component.ts:111`, `.html:108`, `execution-node.component.ts:456`. |
| Every recursive edge forwards it | OK. All four `<ptah-execution-node` sites in execution-node pass it (`:296-301` SendMessage, `:326-331` tool default, `:370-375` bubble template, `:389-394` message). The agent branch itself is the leaf and swaps to the tile (`:341-348`). |
| Default off keeps inline branch | OK. Input defaults to `false`; `@else` keeps `ptah-inline-agent-bubble`. The four other hosts (`agent-execution.component.ts:179`, cli-agent-output, apps-transcript, analysis-transcript, harness-builder) do not bind the input, so their behaviour is unchanged. `agent-execution.component.ts` has no diff. Test "keeps other hosts inline by default" passes. |
| Nothing passes `true` yet | Confirmed. `chat-transcript.component.html:46` does not bind it. The feature is dormant until R9n. |
| Tile uses strip formatter and icon pattern | PARTIAL. Formatter yes (but wrong import, finding 1); icon pattern yes; status mapping not (finding 2). |
| Tool count from children | OK. Recursive count of `type === 'tool'` descendants, including those under nested agents. |
| Pending-permission badge from descendants | OK. Reactive: the lookup runs inside `computed`, and `getPermissionByToolId` reads a signal. Stale click is guarded by re-lookup and id comparison (`:100-103`). |
| Finalization | OK. Fade class is gated by `isFinalizing()`; tested. |
| Optional inject `SESSION_CARD_ACTIONS`, `openLane` only when present | OK. `canOpen` and `openLane` both guard on `actions` and `toolCallId`. Absent provider disables the button. Key rule wrong in some states (finding 2). |
| `agent-execution.component.ts` untouched | OK (no diff). |
| Decision 77, display dock protected | OK for this batch. No file in scope touches the display dock, and none sets `HIDE_AGENT_SIDEBAR`. Pre-existing `canvas-tile.component.ts:618` still provides `HIDE_AGENT_SIDEBAR: true`; it is outside this batch (unmodified) and belongs to the legacy Grid tile that R9j deletes. Keep it on the R9j checklist. |
| HANDOFF §5 risk (R9d strictness via `SESSION_CARD_ACTIONS` or `SESSION_CONTEXT`) | No interaction today. The tile only injects the token (`:45`); it provides nothing, and the compact card (`compact-session-card.component.ts:181-184`) reads the token from its own injector. Forward risk for R9n: its local-handler factory will provide `SESSION_CARD_ACTIONS` inside the single-chat subtree. Make sure that the factory is not provided at an ancestor of any `CompactSessionCardComponent`, or R9d's strict ownership will turn on for a tolerant host. |
| Change detection | OK. `OnPush`, all derived state is `computed` over inputs and the monitor signal; no stale local state. |

## Five logic questions

1. Silent failure: a finished background agent keeps showing a live spinner (finding 2); a pending permission shows a dead disabled badge with no
   explanation when there is no provider (finding 3); a click on a mismatched lane key does nothing (finding 2).
2. Unexpected user action: clicking the tile of a completed background agent, or of a resumed one, goes to a lane key that may not exist; clicking the permission badge after another
   permission replaced it does nothing, which is intended.
3. Wrong answer from data: node `isBackground` with record `completed`; node `resumed`; node with no `toolCallId` (disabled, name falls back to "Subagent").
4. Dependency failure: `AgentMonitorStore` absent is handled by `?.`; the permission lookup returning null is handled; provider absent is handled (disabled).
5. Missing: a tile-mode escape hatch for unanswerable permissions; surfacing a failed sub-agent's error text (only the status icon is shown; `record.errorMessage` is not used);
   live elapsed time.

## Verdict

APPROVE-WITH-FIXES, score 6/10. Wiring and default-off behaviour are correct and tested, and the recursion and the stale-permission guard are sound. The score
is held down by the cross-lib relative import (blocks lint and the push gate) and by status and lane-key logic that diverges from the existing tray and lane-row rules. Required before
acceptance: finding 1 (barrel export plus alias import, add `chat-ui/src/index.ts` to the batch) and finding 2 (terminal-first status, shared lane-key rule) with the matching spec cases from finding 4. Finding 3 must be written into R9n's
acceptance criteria.
