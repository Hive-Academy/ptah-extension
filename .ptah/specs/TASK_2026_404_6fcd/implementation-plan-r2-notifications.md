## Summary

This plan delivers Track R pieces R2 and R6 as two parallel, file-disjoint lanes. Implementer A owns the new notification-center library, the accepted terminal pulse, reactive prompt-target metadata, shell placement, and the acknowledged cross-workspace focus transaction. Implementer B owns the in-place compact-card redesign and its `chat-ui` children. The lanes share only published contracts: A publishes `TerminalTurnPulse`, reactive prompt-target access, and `NotificationCenterComponent`; B consumes the prompt-target access from `PermissionHandlerService` but does not edit that service.

The split follows the enforced dependency direction: `type:feature` may consume feature/data-access/ui/util/core, while `chat-state` is `type:data-access` and may consume only data-access/util (`eslint.config.mjs:345-368`). The new library is therefore `scope:webview` + `type:feature`, while `chat-state` remains limited to the typed pulse and its existing cross-workspace lookup. Existing cross-workspace lookup returns both the tab and owning workspace (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:20-26`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts:496-508`).

R2 replaces the current mini-transcript rather than adding a second compact implementation. Today the card composes a duplicate header, scrolling 50-entry activity feed, mini input, and footer (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:62-134`); the activity child itself uses `overflow-y-auto` and post-render auto-scroll (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:194-198`, `:490-504`). The replacement is a fixed-height four-zone status card with no inner scrolling or transcript controls.

R6 separates current truth from history. Permission and AskUserQuestion requests already live in readonly signals (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:39-43`, `:100-115`) and are removed when answered (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:506-525`), so the notification center derives them. Completion is captured exactly at the accepted `applyTurnState()` command boundary, whose existing revision acceptance precedes its single tab update (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1192-1205`, `:1232-1245`).

## File ownership — Implementer A

Only Implementer A may create, modify, rewrite, or delete the files in this manifest.

| Action | File                                                                                         | Owned change                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE | `libs/frontend/notification-center/project.json`                                             | Nx project named `@ptah-extension/notification-center`, tagged `scope:webview`, `type:feature`; test/lint/typecheck targets matching peer frontend libraries. |
| CREATE | `libs/frontend/notification-center/eslint.config.mjs`                                        | Angular standalone-component lint configuration matching `canvas`.                                                                                            |
| CREATE | `libs/frontend/notification-center/jest.config.ts`                                           | Jest preset-angular configuration.                                                                                                                            |
| CREATE | `libs/frontend/notification-center/tsconfig.json`                                            | Strict Angular library configuration.                                                                                                                         |
| CREATE | `libs/frontend/notification-center/tsconfig.lib.json`                                        | Production compilation boundary.                                                                                                                              |
| CREATE | `libs/frontend/notification-center/tsconfig.spec.json`                                       | Jest compilation boundary.                                                                                                                                    |
| CREATE | `libs/frontend/notification-center/src/test-setup.ts`                                        | Angular Jest setup.                                                                                                                                           |
| CREATE | `libs/frontend/notification-center/src/index.ts`                                             | Sole public API: component and public notification/focus-facing types only.                                                                                   |
| CREATE | `libs/frontend/notification-center/src/lib/notification-center.types.ts`                     | Completion-ledger, derived-prompt, group, and row view-model types.                                                                                           |
| CREATE | `libs/frontend/notification-center/src/lib/notification-center.store.ts`                     | Root-scoped projection/ledger/read/group/coalescing store; localStorage mute preference.                                                                      |
| CREATE | `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts`                | Pulse dedupe, bounds, grouping, prompt projection, read semantics, and storm tests.                                                                           |
| CREATE | `libs/frontend/notification-center/src/lib/notification-sound.service.ts`                    | Gesture-gated Web Audio oscillator/envelope, cooldown, mute, and test suppression.                                                                            |
| CREATE | `libs/frontend/notification-center/src/lib/notification-sound.service.spec.ts`               | Suspended-context, gesture, cooldown, mute, and automated-test suppression tests.                                                                             |
| CREATE | `libs/frontend/notification-center/src/lib/notification-center.component.ts`                 | Standalone OnPush bell/panel/live-region UI.                                                                                                                  |
| CREATE | `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts`            | Keyboard, focus, ARIA, exact accessible count, visual `9+`, and activation tests.                                                                             |
| CREATE | `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts`                    | Accepted busy→terminal edge, cross-workspace pulse, failure classification, replay, and terminal-heal regression tests.                                       |
| CREATE | `libs/frontend/core/src/lib/tokens/notification-focus-router.token.ts`                       | `NotificationFocusTarget`, `NotificationFocusResult`, outcome union, router interface, and DI token.                                                          |
| CREATE | `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`              | Shell-owned transaction coordinating view/layout, workspace switch, canvas acknowledgement, and full-view fallback.                                           |
| CREATE | `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts`         | Ordering and all structured outcome/fallback/race tests.                                                                                                      |
| CREATE | `libs/frontend/chat/src/lib/components/templates/app-shell.notification-center.spec.ts`      | VS Code placement/provider wiring test.                                                                                                                       |
| CREATE | `libs/frontend/chat/src/lib/components/templates/electron-shell.notification-center.spec.ts` | Electron global-nav placement/provider wiring test.                                                                                                           |
| MODIFY | `tsconfig.base.json`                                                                         | Add `@ptah-extension/notification-center` → `./libs/frontend/notification-center/src/index.ts`.                                                               |
| MODIFY | `libs/frontend/chat-state/src/lib/tab-manager.service.ts`                                    | Publish a readonly typed terminal pulse from accepted `applyTurnState()`.                                                                                     |
| MODIFY | `libs/frontend/chat-state/src/index.ts`                                                      | Type-export `TerminalTurnPulse` and its classification type.                                                                                                  |
| MODIFY | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts`                         | Make permission and question routing-target attachment reactive without duplicating request state.                                                            |
| MODIFY | `libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts`                    | Pin target-map invalidation and cleanup behavior.                                                                                                             |
| MODIFY | `libs/frontend/core/src/index.ts`                                                            | Export the narrow notification focus token and types.                                                                                                         |
| MODIFY | `libs/frontend/core/src/lib/services/app-state.service.ts`                                   | Add the FIFO acknowledged canvas-focus bridge carrying target + structured result; do not expose `CanvasStore`.                                               |
| MODIFY | `libs/frontend/core/src/lib/services/app-state.service.spec.ts`                              | Validate FIFO, timeout/missing result, exact request removal, and structured outcomes.                                                                        |
| MODIFY | `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`                     | Import the notification component and provide the focus-router implementation.                                                                                |
| MODIFY | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`                   | Place the bell beside the VS Code theme toggle/header actions only for the non-Electron shell.                                                                |
| MODIFY | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`                | Import/place the bell beside the Electron global theme toggle and provide the same router.                                                                    |
| MODIFY | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`                                 | Consume the structured focus request after workspace/grid mount, focus/adopt/open, acknowledge only after the tile shell render, and return an outcome.       |
| MODIFY | `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`                            | Existing-tile, adopt, open, cap, missing, timeout, mount acknowledgement, and no-extra-load tests.                                                            |

The A lane intentionally does not edit any compact-session or `chat-ui` file. It publishes one cross-lane prompt-target contract: `PermissionHandlerService` must expose a readonly reactive routing revision/snapshot that changes after either `attachPromptTargets()` or `attachQuestionTargets()` and after target cleanup. This repairs the current asymmetry where question attachment republishes the request array but permission attachment only mutates a plain `Map` (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:320-345`, `:528-545`). Implementer B may read this contract from the compact card but must not edit the service.

## File ownership — Implementer B

Only Implementer B may create, modify, rewrite, or delete the files in this manifest. No file intersects Implementer A's manifest.

| Action  | File                                                                                                     | Owned change                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFY  | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`      | Smart per-tab orchestration: targeted prompts, identity/color/workspace, compaction state, summary inputs, and expand action; remove transcript/input/footer composition. |
| CREATE  | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` | Per-tab prompt targeting/fallback, one-frame update, compaction, identity, fixed-height, and response-routing tests.                                                      |
| REWRITE | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`          | Replace scrolling feed with the four-zone bounded status-card body; retain the existing public selector/class as the in-place replacement.                                |
| CREATE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts`     | Four-zone rendering, precedence, no-scroll, reduced-motion, and prompt-action tests.                                                                                      |
| CREATE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`                     | Pure live and finalized adapters plus semantic-mark reducer, with a single bounded view model.                                                                            |
| CREATE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts`                | Live/finalized fixtures, coalescing, stable identities, nested agent, error, path-redaction, Unicode, and high-rate bounds.                                               |
| MODIFY  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts`             | Convert to the non-scrolling metrics footer required by the four-zone card; remove horizontal scrolling.                                                                  |
| CREATE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.spec.ts`        | Bounded metrics and overflow assertions.                                                                                                                                  |
| DELETE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-header.component.ts`            | Canvas already owns title/mode chrome; the status line replaces this child.                                                                                               |
| DELETE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-input.component.ts`             | Compact is summary-only; no mini composer.                                                                                                                                |
| DELETE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-text.component.ts`              | Superseded by the bounded primary-content slot and otherwise unreferenced.                                                                                                |
| DELETE  | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-tool-row.component.ts`                  | Superseded by semantic pulse marks/one content slot and otherwise unreferenced.                                                                                           |
| MODIFY  | `libs/frontend/chat-ui/src/index.ts`                                                                     | Remove deleted exports; export only the retained activity/stats components and summary types/functions needed by `chat`.                                                  |
| MODIFY  | `libs/frontend/chat/src/lib/components/index.ts`                                                         | Remove deprecated re-exports of deleted compact children.                                                                                                                 |

The canvas files belong exclusively to A for this branch. B consumes the existing canvas contract: the tile already owns title, focus ring, layout menu, and compact/full toggle (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:90-106`, `:196-217`), and `TabManagerService` remains the sole view-mode authority (`libs/frontend/canvas/CLAUDE.md`, “View Modes”; current toggle writes through `TabManagerService` at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2631-2639`). B must not add view mode to `TileIntent`, canvas persistence, or layout math.

## Notification-center architecture

### Library and dependency shape

`@ptah-extension/notification-center` is a standalone Angular feature library. Its public `src/index.ts` exports `NotificationCenterComponent` and presentation types only. Internally it may import `@ptah-extension/chat-state`, `@ptah-extension/chat-streaming`, `@ptah-extension/core`, `@ptah-extension/chat-ui` utilities, and `@ptah-extension/shared`; this is legal for `type:feature` under the existing boundary table (`eslint.config.mjs:345-352`). It must not import `@ptah-extension/chat`, because both shell components import the notification library and that reverse edge would create a feature cycle.

The two existing shell composition points import the standalone component directly. `AppShellComponent` already composes standalone header dependencies in its `imports` array (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:102-120`) and owns the VS Code header action cluster (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:567-575`). `ElectronShellComponent` owns a distinct global action row whose theme control is at `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:208-216`; add the Electron bell there, not inside the nested app shell. The non-Electron app-shell placement must be guarded so Electron renders exactly one bell.

### State model

`NotificationCenterStore` owns two shapes:

1. `completionEntries`: an append-only-in-memory ledger capped at 75 session records. A record stores stable id `${sessionId}:${revision}`, revision, tab id, session id, workspace path/label, frozen display title, stable session color, phase, terminal reason, classification, timestamp, `readAt`, and dismissal state. Store individual records first, then group presentation by workspace and a 350 ms burst id; grouping must never erase a navigation target.
2. `pendingEntries`: a `computed()` projection over live permission/question arrays and reactive router target metadata. It is never appended to the completion ledger, persisted, or marked read. When a response, auto-resolution, timeout, cancellation, or cleanup removes the source request, the row disappears because the source signal changes (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:506-525`, `:600-619`).

Sort actionable questions first, permissions second, failed completions third, successful completions fourth; within prompts use source FIFO, and within completion groups newest first. A completion burst groups records whose accepted timestamps are within 350 ms and workspace paths match. The panel may collapse a group visually but must expose each contained session as an actionable child. The ledger bound applies after dedupe and evicts the oldest completion records only; unresolved prompts are outside the bound and therefore remain reachable.

The unread count is the number of unread completion sessions plus current actionable prompt rows. “Mark all read” only stamps completion records; it never answers or hides prompts. Completion activation marks the record read only after the focus router returns `success: true`. Prompt activation routes focus but leaves the prompt actionable until its actual response path removes it.

### Completion edge

`TabManagerService.applyTurnState()` already obtains the tab across workspaces before acceptance (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1192-1201`) and writes the new revision/session together with state (`:1203-1229`). Add a private monotonically increasing pulse sequence and readonly `terminalTurnPulse` signal. Emit this exact shape synchronously after the accepted tab update:

```ts
export interface TerminalTurnPulse {
  readonly seq: number;
  readonly tabId: string;
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly revision: number;
  readonly phase: 'idle' | 'failed';
  readonly terminalReason: SdkTerminalReason | null;
  readonly classification: 'success' | 'error';
  readonly title: string;
  readonly occurredAt: number;
}
```

The edge predicate is: previous tab status is one of `streaming | awaiting-background | sleeping`; accepted new phase is `idle | failed`; and the incoming `(sessionId, revision)` is strictly newer than the tab's recorded revision for that same session. The busy statuses are existing turn-state projections (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1163-1169`), while `SessionTurnState.revision` is documented monotonic per session (`libs/shared/src/lib/types/execution/stream-background.ts:259-269`). This means a replayed equal/older revision produces no pulse even if the terminal-heal state-repair rule accepts it; terminal heal may repair the tab, but it must not manufacture history. The pulse identity is session+revision, so tab fan-out remains one completion record in the feature ledger.

Classification is total: `phase === 'failed'` is `error`; `phase === 'idle' && terminalReason === 'completed'` is `success`; every other idle terminal reason (including `aborted_streaming`, `aborted_tools`, limits, hook stops, and null) is `error`. The terminal-reason union includes aborts, blocking limits, max turns, and completed (`libs/shared/src/lib/types/sdk-hook.types.ts:61-73`), so no abort/limit is presented as a pleasant finish.

The feature store consumes pulse `seq` in one narrow effect and tracks the last consumed sequence; it does not watch `tabs()`. The active `tabs()` projection cannot represent all background workspaces, whereas the pulse already carries the workspace returned by the cross-workspace lookup (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:511-527`).

### Derived prompt projection

For each permission or question, resolve targets in this order:

1. Read router-attached ids from `targetTabsFor(prompt.id)` or `questionTargetTabsFor(question.id)`. These maps are explicitly populated by the router (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:46-59`, `:117-125`) and question routing prefers a valid originating tab before fallback (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:645-672`). Resolve every id through `TabManagerService.findTabByIdAcrossWorkspaces()` and create one row per real target tab (or one row with multiple target choices if the same request fans out).
2. If attached metadata exists but none of its ids resolves to a tab, treat it as a surface-only prompt and omit it from the bell; do not fall back and leak it into an unrelated chat.
3. Only when no attached target metadata exists, use `request.sessionId` with `findTabBySessionIdAcrossWorkspaces()`. This is the legacy/unresolved fallback, not the primary filter.
4. If neither route resolves, expose one disabled “target unavailable” row only when the request is chat-owned; otherwise omit it. Never silently retarget it to the active tab.

The metadata-first rule is load-bearing because the handler documents that raw session ids may not match the tab's Claude session id (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:169-178`) and the router describes stale ids after compaction/rebinding (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:474-482`). The A-lane reactive target revision ensures a computed that first observes an enqueued request reruns after routing attaches metadata; no copied prompt event is introduced.

### Focus routing

`NOTIFICATION_FOCUS_ROUTER` is a core-owned inversion token so notification-center never imports chat. Its contract is:

```ts
type NotificationFocusOutcome = 'focused' | 'adopted' | 'opened' | 'cap-reached' | 'missing';

interface NotificationFocusTarget {
  readonly workspacePath: string;
  readonly tabId?: string;
  readonly sessionId: string;
}

interface NotificationFocusResult {
  readonly success: boolean;
  readonly outcome: NotificationFocusOutcome;
}
```

`NotificationFocusCoordinator` implements the token as one awaited transaction:

1. Validate/resolve the target again through `TabManagerService`; prefer `tabId`, then session fallback. A target that no longer resolves returns `{success:false,outcome:'missing'}`.
2. Set current view to chat and layout mode to grid. Those are current `AppStateManager` operations (`libs/frontend/core/src/lib/services/app-state.service.ts:535-539`, `:676-681`).
3. Await `WorkspaceCoordinatorService.switchWorkspace(workspacePath)`. That method switches the scope, tab partition, session cache, pickers, and app view slice before its asynchronous continuation (`libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:131-178`).
4. Send the target through a new FIFO `AppStateManager.requestCanvasFocus()` bridge. The request carries `workspacePath` as a stale-consumer guard and settles exactly once with `NotificationFocusResult`.
5. The mounted `OrchestraCanvasComponent` consumes only requests matching its active path. It first waits until the switched workspace grid is mounted/hydrated. If the tile exists, call `focusTile` and return `focused`; if the tab exists but tile does not, call `adoptTab`, then focus after the next render and return `adopted`; if no tab exists but the session is resolvable, open/switch it through the existing canvas/chat path, wait for the tile shell, focus, and return `opened`. `CanvasStore.focusTile()` already synchronizes canvas focus with the global active tab (`libs/frontend/canvas/src/lib/canvas.store.ts:356-364`), and `adoptTab()` deliberately reuses an existing tab (`:213-224`).
6. If the canvas cap prevents adopt/open, return `cap-reached` without mutating canvas intent. The coordinator then sets layout mode to single and focuses/opens the same session through the full chat path. Return `{success:true,outcome:'cap-reached'}` only if that fallback succeeds; otherwise `{success:false,outcome:'cap-reached'}`. This makes the entry non-dead while preserving the diagnostic outcome.
7. A removed workspace, missing session, canvas timeout, or failed session open returns `missing`. Concurrent activations are serialized by the FIFO request bridge; each resolver belongs to its exact request, preventing a later workspace switch from acknowledging the earlier click.

The shell never injects `CanvasStore`: it is component-scoped on `OrchestraCanvasComponent` (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:59-67`). The AppState signal bridge is the narrow port across that injector boundary. Do not move the store to root and do not write view mode or focus state into canvas v2 persistence.

### Sound, announcements, and accessibility

`NotificationSoundService` creates no asset. On the first trusted pointer or keyboard gesture, it lazily creates/resumes `AudioContext`; if the context remains suspended, it returns without playing. A sound is a short oscillator/gain envelope and is scheduled at most once per coalesced side-effect burst, with a two-second cooldown. The same 350 ms side-effect aggregator covers newly accepted completions and newly observed prompt ids; prompt rows themselves remain separate and immediately actionable. No replay/restoration sound occurs because only a new pulse sequence or newly appearing source request enters the side-effect aggregator.

Mute is a UI-only boolean persisted under one versioned localStorage key such as `ptah:notification-center:sound-muted:v1`, guarded by try/catch. There is no RPC, backend setting, or second settings store. Automated tests provide the service's local audio-enabled injection token as false; browser automation additionally treats `navigator.webdriver === true` as suppressed. `prefers-reduced-motion` controls visual motion only, not mute.

The component contract is:

- Bell is a real `<button>` with `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`, and an accessible label containing the exact count; only the visible badge caps at `9+`.
- Panel is a non-modal labelled region/dialog using normal tab order, not menu semantics. Opening moves focus to its heading or first actionable/unread row. Escape closes and restores focus to the bell. Each row is keyboard activatable with a visible focus indicator.
- One visually hidden `role="status"`/`aria-live="polite"` node sits outside the panel. A 350 ms burst publishes one phrase such as “12 sessions finished; 3 need attention,” never twelve DOM insertions.
- Status is never color-only: rows include text such as “Needs permission,” “Needs an answer,” “Failed,” and “Finished.” Motion uses opacity/transform only, has a non-motion icon/border fallback, and is disabled by `prefers-reduced-motion`.
- A burst of twelve completions yields twelve navigable completion records, one workspace grouping per workspace, one announcement, and one sound (subject to gesture/unmuted/context conditions).

## Compact card (R2) architecture

### Fixed four-zone view model

Rewrite the existing `CompactSessionActivityComponent` in place as a presentational, bounded renderer. Its input is a `CompactSessionSummary` created by two pure adapters in `compact-session-summary.ts`:

- `summarizeLive(streamingState, context)` reads live semantic events and accumulators.
- `summarizeFinalized(messages, context)` reads finalized `ExecutionNode` trees.

Both feed one reducer that returns exactly four zones:

1. **Status line:** stable session-color dot, workspace label, total status text, and a non-color icon. Status mapping is total: blocking prompt → “Needs input”; compaction state → “Compacting”; streaming tool/agent/prose → a tested live verb; last terminal reason → success/error/abort/limit text; otherwise idle/draft. Stable session color reuses the existing OKLCH hash utility (`libs/frontend/chat-ui/src/lib/utils/agent-color.utils.ts:75-83`), and workspace label reuses the pure path derivation already exported from chat-state (`libs/frontend/chat-state/src/index.ts:64-69`).
2. **Pulse strip:** at most 24 marks keyed by stable semantic identity. Marks represent meaningful tool start/completion/error, agent start/end, coalesced prose block, prompt, compaction, or terminal state—not raw text deltas or partial JSON. Oldest marks fall off deterministically. Each mark has an accessible label; animation is opacity/transform only and disabled for reduced motion.
3. **One content slot:** precedence is oldest targeted AskUserQuestion, oldest targeted permission, newest error, newest non-empty assistant prose, newest meaningful tool/agent result, then idle/starting. Multiple prompts show the oldest actionable summary plus “+N more.” Prompt content is a one-line/two-line summary with a single “Open full view” action; it never embeds the full question/permission form.
4. **Metrics footer:** bounded model/tokens/cost/agent count/compaction metadata. It uses truncation/wrapping appropriate to the fixed height and never `overflow-x-auto` (the current stats child scrolls horizontally at `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts:24-29`).

The card root remains `h-full overflow-hidden`, contains no `overflow-auto`, no `afterRenderEffect`, no textarea, no collapse state, and no inner header/footer chrome. The containing canvas tile already clips its fixed projected geometry (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:90-98`, `:235-243`); geometry and the compact height tier remain untouched.

### Smart-card orchestration

`CompactSessionCardComponent` remains the smart `chat` molecule. It derives the current tab's workspace through `findTabByIdAcrossWorkspaces()` rather than assuming the active workspace, obtains router targets directly from `PermissionHandlerService`, and reacts to A's routing revision contract. Prompt resolution uses attached target ids first and session-id fallback only when target metadata is absent. This replaces the current session-id-only filters (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:166-177`), which can miss prompts after id rotation/mismatch.

The card reads conversation-scoped compaction through `TabSessionBinding.conversationFor(tabId)`, `ConversationRegistry.compactionStateFor()`, and `compactionMarkerFor()`. Those registry reads are reactive/conversation-scoped (`libs/frontend/chat-state/src/lib/conversation-registry.service.ts:240-260`) and return persisted recap metadata when available (`:306-317`). Do not copy compaction state into the compact summary or `TabState`.

The one-frame prompt criterion is met by a direct computed chain: source request signal or reactive target revision → targeted prompt computed → summary computed → OnPush template. There is no timer, debounce, event queue, or animation gate on the content slot. The test advances one `requestAnimationFrame` after request+target attachment and requires the blocking summary/action to be present.

Clicking “Open full view” emits the existing `expandToFull` output. `ChatViewComponent` already maps that output to `TabManagerService.toggleTabViewMode()` (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:4-13`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1328-1334`), so the full prompt form appears through the existing full-chat path. Permission and question response routing remains in `ChatStore`; the compact summary does not invent a second response path.

### Live/finalized adapter rules

The live adapter coalesces repeated updates by stable ids and exposes only basenames or workspace-relative paths. Missing validated tool fields degrade to a generic verb such as “Running Edit”; absolute home paths never enter the view model. The finalized adapter walks each execution root once, treats an agent node's summary/direct text as one semantic item, and does not recurse into that same direct text a second time. The current implementation's immediate agent-branch return is why finalized prose is not presently duplicated (`.ptah/specs/TASK_2026_404_6fcd/task-description.md:122-125`); preserve that behavior with a summary-child regression fixture.

No adapter performs markdown rendering, builds a 50-entry feed, or retains unbounded delta history. AI prose is rendered as escaped Angular text with line clamp, never `[innerHTML]`; the compact view has no reason to invoke the markdown pipeline for a two-line glanceable excerpt.

## Contracts

| Contract                    | Producer                                | Consumer                                     | Required invariant                                                                                                                                  |
| --------------------------- | --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalTurnPulse`         | A: `TabManagerService.applyTurnState()` | A: `NotificationCenterStore`                 | Busy→accepted idle/failed only; session+revision replay safe; background workspace metadata included; failed/non-completed idle classified error.   |
| Reactive prompt targets     | A: `PermissionHandlerService`           | A notification projection and B compact card | Request arrays remain source of truth; route target attachment/cleanup invalidates computeds; metadata first, session fallback only if no metadata. |
| `NOTIFICATION_FOCUS_ROUTER` | A: chat shell provider/coordinator      | A: notification component/store              | One Promise returns `{success,outcome}` with `focused \| adopted \| opened \| cap-reached \| missing`; read state changes only when `success`.      |
| Canvas focus request        | A: coordinator/AppState                 | A: mounted `OrchestraCanvasComponent`        | FIFO, workspace-addressed, exactly-once acknowledgement after tile shell render; component-scoped `CanvasStore` never escapes.                      |
| `CompactSessionSummary`     | B: pure live/finalized adapters         | B: rewritten activity/stats renderer         | Four bounded zones, ≤24 semantic marks, deterministic prompt precedence, no raw transcript/scroll/input.                                            |
| `expandToFull`              | B: compact content-slot action          | Existing `ChatViewComponent`                 | Blocking prompt becomes actionable through the full existing UI; view mode remains owned by `TabManagerService`.                                    |

No shared file requires both implementers. The only sequencing dependency is contractual: A must publish the reactive routing revision/snapshot signature before B finalizes its import. B can build against a local typed test double until that signature lands, then consume it without editing A-owned files.

## Test plan

### Implementer A — notification center

| Spec                                                                                  | Nx project                            | Assertions                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tab-manager.notification-pulse.spec.ts`                                              | `@ptah-extension/chat-state`          | Background workspace busy→idle emits once; same/lower replay emits none; failed is error; idle completed is success; idle abort/limit/null is error; awaiting-background/sleeping alone do not complete; terminal heal repairs state without a second pulse.            |
| `permission-handler.service.spec.ts`                                                  | `@ptah-extension/chat-streaming`      | Permission and question target attachment both invalidate reactive readers; response/cleanup clears targets; session-id mismatch still resolves by router metadata.                                                                                                     |
| `notification-center.store.spec.ts`                                                   | `@ptah-extension/notification-center` | 75-record cap; session+revision dedupe; 350 ms workspace grouping; twelve records remain individually navigable; prompt state disappears with source; prompts are never evicted/coalesced into unreachable rows; exact unread semantics; read only on successful focus. |
| `notification-sound.service.spec.ts`                                                  | `@ptah-extension/notification-center` | No context before gesture; suspended resume failure is silent; one envelope per burst; two-second cooldown; mute localStorage round trip; automated tests suppressed; no asset/media path.                                                                              |
| `notification-center.component.spec.ts`                                               | `@ptah-extension/notification-center` | Real button, exact accessible count, visual `9+`, ARIA linkage/state, Enter/Space, Escape focus restoration, initial panel focus, row keyboard activation, one live-region phrase for twelve completions, text labels/reduced motion.                                   |
| `app-state.service.spec.ts`                                                           | `@ptah-extension/core`                | Structured FIFO requests, exact resolver ownership, timeout→missing, stale request removal, all five outcomes preserved.                                                                                                                                                |
| `notification-focus-coordinator.service.spec.ts`                                      | `@ptah-extension/chat`                | Strict view→grid→workspace→canvas order; existing/adopt/open; cap fallback to full single view; missing workspace/session; failed fallback; rapid competing clicks serialize; only successful result is eligible to mark read.                                          |
| `app-shell.notification-center.spec.ts`, `electron-shell.notification-center.spec.ts` | `@ptah-extension/chat`                | One bell in VS Code header and one in Electron global nav; no duplicate in nested Electron app shell; router provider available.                                                                                                                                        |
| `orchestra-canvas.component.spec.ts`                                                  | `@ptah-extension/canvas`              | Focus existing without `session:load`; adopt existing tab; open missing tab/session; cap outcome; missing outcome; workspace mismatch ignored; acknowledgement after render/hydration; view mode/layout intent/persistence unchanged.                                   |

Run after A's project files land and before trusting Nx's graph (do not reset while B is actively using the shared daemon):

```text
npx nx reset
npx nx run-many -t test -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/canvas --skip-nx-cache
```

The run must report six projects. Follow with the same six-project `run-many` commands for `typecheck` and `lint`.

### Implementer B — compact card

| Spec                                         | Nx project                | Assertions                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compact-session-summary.spec.ts`            | `@ptah-extension/chat-ui` | Equivalent live/finalized summaries; semantic-delta coalescing; ≤24 marks; total verb fallback; errors/terminal reasons; nested agents; one prose item for summary-child fixture; Unicode and absolute-path redaction; bounded results under 50 high-rate session fixtures.                                                                  |
| `compact-session-activity.component.spec.ts` | `@ptah-extension/chat-ui` | Four zones only; deterministic question→permission→error→prose→tool→idle precedence; oldest prompt + count; no `overflow-auto`; no prompt form/markdown/transcript; accessible mark labels; reduced-motion fallback.                                                                                                                         |
| `compact-session-stats.component.spec.ts`    | `@ptah-extension/chat-ui` | Metrics remain bounded, readable, and have no horizontal scrollbar.                                                                                                                                                                                                                                                                          |
| `compact-session-card.component.spec.ts`     | `@ptah-extension/chat`    | Router target beats mismatched session id; no-target session fallback; surface-only target does not leak; multiple prompt FIFO; request+target appears within one RAF; compaction state/marker; stable session color/workspace label; action emits expand; no input/collapse/duplicate header/footer; fixed-height/no-inner-scroll contract. |

Run:

```text
npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --skip-nx-cache
```

The run must report two projects. Follow with the same two-project `run-many` commands for `typecheck` and `lint`.

### Integrated acceptance

After both lanes merge, rerun all seven affected projects in one command:

```text
npx nx run-many -t test -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas --skip-nx-cache
```

Acceptance evidence must explicitly show: compact fixed height/no internal scrollbar and prompt summary within one frame; one background-workspace completion and no replay duplicate; cross-workspace click focuses and marks read only on success; keyboard-operable bell; and twelve completions producing one announcement and one sound.

## Risks

| Risk                                                         | Impact                                                                     | Mitigation                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission target `Map` mutation is non-reactive             | Bell/card can briefly or permanently use the unsafe session fallback       | A makes both target attachments/cleanup publish one readonly reactive revision/snapshot and tests request-before-target ordering.                                                |
| Terminal-heal accepts a low/equal terminal revision          | A state repair could look like a second completion                         | Pulse requires strict newer same-session revision even when `applyTurnState` accepts a heal; regression test separates state repair from notification history.                   |
| Fan-out tabs duplicate a completion                          | One backend turn produces several rows/sounds                              | Ledger identity is session+revision; retain target tab choices inside one record/group.                                                                                          |
| Workspace switch races a newly mounted canvas                | Request acknowledges before the tile exists or targets the wrong workspace | Workspace-addressed FIFO request, post-switch consume, hydration/render acknowledgement, exact resolver per request.                                                             |
| Canvas cap leaves a dead notification                        | User clicks but cannot reach the prompt/session                            | Structured `cap-reached` outcome triggers full single-session fallback; read only after fallback success.                                                                        |
| Audio autoplay restrictions                                  | First background event before interaction is silent                        | Gesture-gated create/resume and documented silent fallback; never bypass browser policy.                                                                                         |
| Notification storm causes repeated sound/ARIA noise          | Twelve completions become disruptive                                       | Store individual history, but coalesce only external sound/announcement for 350 ms and apply a two-second audio cooldown.                                                        |
| Compact reducer recreates transcript cost invisibly          | UI looks smaller but still walks/renders unbounded history                 | Pure adapters return bounded semantic output; no markdown, 50-entry feed, auto-scroll, or hidden old component; high-rate bound test.                                            |
| Removing compact input/header breaks non-canvas compact mode | Main single-chat compact view loses its old escape hatch                   | Blocking summary retains `expandToFull`; component spec mounts the existing `ChatViewComponent` contract. Deleted exports are removed only after repository-wide usage is clean. |
| Parallel implementers collide through shared Nx daemon reset | One lane invalidates the other's active test process                       | A performs the required reset once at a coordinated boundary after creating `project.json`; neither lane resets while the other runs Nx.                                         |

## Unverified

- No `libs/frontend/notification-center` directory or existing Web Audio implementation was found in the worktree (`Test-Path` was false; repository search found no `AudioContext`/oscillator use). The implementer must therefore validate `AudioContext` behavior in both the production VS Code webview and Electron renderer; the plan assumes the code-generated oscillator requires no CSP `media-src` because it fetches no media.
- The exact visual height in pixels is derived by the already-landed compact height tier; this plan deliberately does not modify or re-measure canvas geometry. The browser-level assertion should check the rendered compact tile at the existing two-unit tier rather than hard-code a duplicate pixel constant.
- There is no existing general automated-test flag for audio in the inspected frontend. The plan resolves this with a notification-local injectable enablement seam plus `navigator.webdriver`; if the application exposes an authoritative e2e flag before implementation, use that flag through the same seam rather than adding a second global.
- Unit coverage can prove focus transaction ordering and render acknowledgement, but actual keyboard focus transfer into a Gridstack tile after a cross-workspace remount should receive one host-level browser test when the existing webview/electron e2e harness has an appropriate multi-workspace fixture. No new e2e project is in scope for these two implementation lanes.
