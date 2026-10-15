### 4277283760 apps/ptah-extension-webview/tailwind.config.js:115
**📐 Maintainability & Code Quality** | **🟡 Minor** | **⚡ Quick win**

**Raise the `anubis` idle ink to at least 4.5:1.**

`--state-ink-idle: #6b7280` has relative luminance of about 0.167. The `anubis` `base-100` (`#131317`) is about 0.0067. The ratio is about 3.8:1 on `base-100`. On `base-200` (`#1a1a20`), the ratio is about 3.6:1.

Several places use this ink as small text:
- the `.state-idle` chip in `canvas-rail.component.ts`
- the state chip in `canvas-focus-header.component.ts`, which sits on `bg-base-200`

Both are `text-xs`, so they fail WCAG AA for normal text. The other `anubis` inks and all `anubis-light` inks pass. A value such as `#9ca3af` gives about 7:1 on `base-100`.



### 4277283797 libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:169
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Map `bg:` lane keys to `sub:` keys as well as `sub:` to `bg:`.**

`groups()` decides each sub-agent's key from its current record status. A `background` record gets `bg:<id>`. Any other status gets `sub:<id>`. A background store entry with a matching sub-agent record is filtered out of the Background group.

The fallback on Line 168 maps only `sub:` to `bg:`. This causes two failures:
- A user opens a background agent's lane while its record status is `background`. The stored lane key is `bg:<id>`. When the agent completes, the record status changes, the tab key becomes `sub:<id>`, and `selectedKey()` returns `'orchestrator'`.
- `CanvasDetailService.open` accepts `bg:<id>` when the `BackgroundAgentStore` holds the agent, even if its sub-agent record is no longer `background`. The tab strip then has no `bg:<id>` key and falls back to `'orchestrator'`.

In both cases, the effect on Lines 173-176 emits `'orchestrator'`. The user is sent back to the conversation while the lane is still valid. `CanvasLaneViewComponent.selectedSubagent` still resolves the agent for both key kinds.



### 4277283810 libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:298
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Expand the CLI lane once per agent, not on every `expanded` change.**

This effect tracks `selectedCli()`. That object changes when `agent.expanded` changes. Suppose the user collapses the card through `(toggleExpanded)` on Line 112. The store sets `expanded` to false, the effect runs again, and it calls `toggleAgentExpanded` at once. As a result, the collapse control in the lane does nothing. The effect also changes the shared store state that other surfaces read.

Key the auto-expand on the agent id, and run it only when the selected id changes.



### 4277283818 libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:113
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Announce "in focus" only for the focused collapsed card.**

The collapsed button label always ends with `', in focus'`. Every collapsed card in the rail therefore tells screen-reader users that it is in focus. This contradicts `aria-current` on Line 114, which is set only when `focused()` is true.



### 4277283828 libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts:66
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Limit board-level ArrowLeft/ArrowRight to targets inside the canvas.**

`OrchestraCanvasComponent` registers this handler on `window:keydown`. When the target is not inside a card, plain ArrowLeft and ArrowRight switch the focused session and call `preventDefault()`. The only exclusions are form fields, tablists, menus, listboxes, dialogs and popovers.

So any other focused element on an active canvas surface triggers a session switch. Examples are a transcript button, a scrollable code block or diff with `tabindex`, or an element outside the canvas. The keystroke also loses its native behavior, such as horizontal scrolling.

Pass the canvas host or session viewport into `CanvasRailKeyboardContext`. Ignore events whose target is outside that element or inside a scrollable content region.



### 4277283841 libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:399
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Report a tile-bound refusal for `newCanvasSessionRequest`.**

This effect checks only the running cap. At `MAX_CANVAS_TILES`, `canvasStore.addTile(name)` returns `null`. The request is then cleared with no message. `handleCreateSession` on Line 597 reports `TILE_BOUND_MESSAGE` for the same refusal, so this path is inconsistent with it.



### 4277283869 libs/frontend/chat-types/src/lib/chat-types.ts:66
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Retain the TodoWrite input with its marker.**

When the event cap evicts a `TodoWrite` start event, `latestTodoWrite` still holds its ID, but the input from that event can be gone. `summarizeTodos` follows the marker and returns without using its message fallback, so the compact-session todo summary loses the latest list. The compaction replacement also copies this marker into a state with empty event maps. Preserve the latest todo data with the marker, or fall back when its input cannot be recovered.



### 4277283882 libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:156
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Make keyboard focus visible on the card select button.**

`.rc-select` has `opacity: 0`. The opacity also applies to the button's outline. The `.rc-select:focus-visible` outline therefore never shows. The focused-card frame shows which session is active. It does not show when keyboard focus lands on the card button, for example after `ngDoCheck` moves focus to `.rc-select`. Draw the focus ring on the host with `:host(:has(.rc-select:focus-visible))`.



### 4277283899 libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:377
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Round the context percentage before display.**

`contextPercent` comes from `liveModelStats.contextPercent` without rounding (`compact-session-card.component.ts` Lines 227-231). Line 377 shows the raw number, so the card can show text such as `ctx 37.41666%`. The board activity view rounds this value through `roundedContextPercent`. Round it here as well.



### 4277283908 libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts:122
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Use a stable turn identity for disclosure state.**

When a turn has no files or test runs, `turnKeyOf` returns the same key for every such turn. If a user closes the section and the dock shows another file-less turn, `sectionOpen` keeps the old choice instead of reopening. A test run added during a file-less turn can also change the key and discard that turn’s choices. Pass a turn identity from the summary source rather than deriving it from optional card contents.



### 4277283912 libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:1499
**🗄️ Data Integrity & Integration** | **🟠 Major** | **⚡ Quick win**

**Clear the draft for the tab that sent the message.**

If tab A starts a send and the user switches to tab B before `sendOrQueueMessage()` resolves, the draft effect restores B's content. These lines then delete B's stored draft, and the preceding clears remove B's visible content. Capture the sending tab before the await. Clear local content only if the composer still shows that submitted draft.



### 4277283915 libs/frontend/chat/src/lib/services/workspace-root.ts:4
**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**

**Keep drive-root paths case-folded after trailing-slash removal.**

Line 3 strips the trailing slash before Line 4 tests `/^[a-z]:\//i`. For a drive-root workspace, `C:\` becomes `C:`. The regex then fails, so the value is not lowercased. As a result, `C:\` and `c:\` normalize to different keys.

Both `SessionGitStatsStore` and `ChangeSetStore` match status pushes by this key. A drive-root workspace whose push uses different drive-letter casing is therefore dropped.



