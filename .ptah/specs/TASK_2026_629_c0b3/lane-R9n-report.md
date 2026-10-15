# Lane report: R9n, single chat sub-agent full view (item 7)

Executor: Claude frontend-developer. Root W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Paths below are under `W\libs\frontend\chat\src\lib\components\organisms\transcript\`. No git was run that changes state.

## Files changed

- MODIFIED `chat-transcript.component.ts`
  - `:24-31` imports (`DOCUMENT`, `SESSION_CARD_ACTIONS`, `SessionCardActions`, `parseLaneKey`, the new view).
  - `:158-184` `OpenSubagent`, `SubagentReturn` and `findAgentNode()`, which finds the `agent` node of a tool call id at any depth.
  - `:215` imports `SingleChatSubagentViewComponent`.
  - `:229-239` the `SESSION_CARD_ACTIONS` provider factory: `inject(SESSION_CARD_ACTIONS, { skipSelf: true, optional: true }) ?? inject(ChatTranscriptComponent).singleChatCardActions()`. The parent (Rail) wins. The local handler is built only when there is no parent.
  - `:681-775` the in-place view state:
    - `openSubagentId`, `subagentNotice` and `subagentOpen`.
    - `openSubagent`, a computed re-resolved from the gated `vm`, so it is live and frozen while inactive.
    - `singleChatCardActions()`: `openLane` opens the view and `openSession` acts as Back.
    - `closeSubagent()` restores the pin, `savedScrollTop` and opener focus.
    - `openSubagentLane()` parses the lane key, refuses `cli:` and unknown ids, and announces instead of routing.
    - `findSubagent()` searches newest message first.
- MODIFIED `chat-transcript.component.html`
  - `:12` adds `[attr.inert]` to the scroller while the view is open.
  - `:50` passes `[agentTileMode]="true"` to `ptah-message-bubble`. This is the only host that opts in.
  - `:169-183` the `ptah-single-chat-subagent-view` overlay (`absolute inset-0 z-10`) and a `sr-only` `role="status"` notice.
- CREATED `single-chat-subagent-view.component.ts`: standalone, OnPush and signals.
  - It renders `<ptah-execution-node [agentTileMode]="false">` for the live node.
  - Permission lookup and response go through `ChatStore`, the same path as `message-bubble.component.ts:327-339`.
  - The header has a Back button, which takes focus on entry, plus the agent name. Escape also goes back unless the event was already `defaultPrevented`.
  - If the node is gone it shows an unavailable state (`role="status"`), and Back still works.
  - Styling uses DaisyUI/Tailwind tokens only (`btn btn-ghost btn-xs`, `bg-base-100`, `bg-base-200/40`, `border-base-content/10`, `text-base-content-muted`), so it works in dark and light themes.
- CREATED `single-chat-subagent-view.component.spec.ts`: 5 cases.
- MODIFIED `chat-transcript.component.spec.ts`
  - `:12-25`, `:58-72` imports.
  - `:1003-1420` the R9n stubs, hosts and the `describe('ChatTranscriptComponent — single chat sub-agent view (R9n)')` block with 8 cases (`:1234-1420`).
- MODIFIED `chat-transcript.display.spec.ts`
  - Imports `:7`, `:88-93`.
  - `SubagentViewStub` before the harness.
  - The decision-77 case `describe('single chat view keeps the protected display dock (decision 77, R9n)')` at `:801`.
- MODIFIED `testing/transcript-spec-harness.ts:35`: `@Input() agentTileMode = false;` on `TranscriptMessageBubbleStub`. This file is outside the batch list; the coordinator approved it (see Decisions).

## Cases and the specs that cover them

| Case | Spec |
| --- | --- |
| Only the main transcript opts in | `chat-transcript.component.spec.ts` "opts every main-transcript bubble into agent tile mode". Every other `ptah-execution-node` host is untouched. |
| Tile -> live full view -> Back (scroll, draft, focus) | `chat-transcript.component.spec.ts` "tile -> live full view in place -> Back restores scroll, focus and the draft". It covers: live node; growth followed by the same view instance; scroller `inert` while open; unpinned `scrollTop` 300 restored after drift to 0; focus back on the opener; composer draft value and element unchanged; transcript instance not torn down. A second case covers a pinned transcript returning to the bottom. `single-chat-subagent-view.component.spec.ts` covers the live node in full with tile mode off, in-place updates, focus on Back, the Back click, Escape, and the unavailable state. |
| Parent provider wins | `chat-transcript.component.spec.ts` "parent provider wins". A Rail-like host provides `SESSION_CARD_ACTIONS`. A descendant resolves the Rail instance, a real `SubagentTileComponent` click calls `railActions.openLane('sub:agent-1')`, and no in-place view opens. |
| Fenced display opens and updates in place in single chat (decision 77) | `chat-transcript.display.spec.ts` "a fenced display opens and updates in place while a sub-agent is open in place". It uses the real `DisplaySurfaceSyncComponent` and `DisplayDockState`. `ptah-ui display stats` opens as `id:stats`. A later same-id fence (turn `u2`) updates the same surface: same `key` and `createdSeq`, higher `updatedSeq`, new `fenceKey`, status `applied`. The update happens while a sub-agent is open in place. `HIDE_AGENT_SIDEBAR` resolves to null inside the transcript. |
| Pending permission answerable in tile mode (decision 84, R9g finding 3) | `chat-transcript.component.spec.ts` "a pending descendant permission in tile mode is answerable". With no host provider, the real tile's "Permission needed" badge is enabled (it was disabled before because `SESSION_CARD_ACTIONS` was missing). The click opens the full agent holding the pending tool, and focus returns to the badge on Back. `single-chat-subagent-view.component.spec.ts` "keeps a pending descendant permission answerable through ChatStore" shows the full node gets the `ChatStore` lookup, which returns the pending request, and that the response reaches `ChatStore.handlePermissionResponse`. |
| Main-panel compact card stays tolerant (HANDOFF §5) | `chat-transcript.component.spec.ts` "main-panel compact card stays tolerant". A ChatView-shaped host puts a probe that injects exactly like `compact-session-card.component.ts:181-184,230` as a SIBLING of the transcript: `cardActions` null, `sessionContext` null, `strict` false. The transcript's descendants do get the handler. Source check: in `chat-view.component.html` the compact card (`:9`) and `ptah-chat-transcript` (`:81`) sit in sibling `@if`/`@else` branches, so the card is never a descendant of the transcript's element injector. |
| Lane cannot be opened here | `chat-transcript.component.spec.ts` "keeps the transcript and announces…". Unknown id and `cli:` produce no view, no `inert`, and the polite notice. Another case shows the unavailable state when the open agent leaves the tab. |

## Spec results (lock runner, one at a time, `--testFile`, `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`)

- `single-chat-subagent-view.component.spec.ts`: 5/5 passed. It was rerun after prettier formatted the new files: 5/5.
- `chat-transcript.component.spec.ts`: 35/35 passed (27 existing plus 8 new). The first run failed 1 case, which was a fixture issue: a reused host class kept the transcript definition from its first compile. Fixed with a dedicated `SingleChatTileHost`.
- `chat-transcript.display.spec.ts`: 15/15 passed (14 existing plus 1 new).
- Not run, as instructed: typecheck, lint, full suite. Note that `tsconfig.spec.json` sets `isolatedModules: true`, so these spec runs do not type-check. Types were reviewed by hand. Mode 2 TC(chat) is the first real type and template check.

## Decisions

1. **Harness file added to the batch (coordinator approved).** `testing/transcript-spec-harness.ts:35` gains `@Input() agentTileMode = false;`. Reason: `chat/src/test-setup.ts` sets `errorOnUnknownProperties: true`. Without the input, the required `[agentTileMode]="true"` binding throws NG0303 in every spec that uses `TranscriptMessageBubbleStub`: component, display, ptah-ui, change-set, older-history, replay-mount and replay-motion. One line, test-only.
2. **Overlay plus `inert`, not unmount or `display:none`.** The transcript stays mounted and laid out under the view. Native `scrollTop` survives, the render window keeps its measurements, and the display sync keeps publishing (decision 77). `inert` removes the covered transcript from tab order and the accessibility tree. Back still restores an explicit snapshot (`scrollTop`, pin) taken at open, because a pinned stream can move the covered scroller.
3. **The draft is preserved by structure.** The composer and its `ComposerDraftStore` live in ChatView, outside the transcript, and the view replaces nothing there. The spec proves a sibling composer's value and element survive open and Back.
4. **Live node source.** The node is resolved from this transcript's gated `vm` slots (`record().streamingState`), newest first. There is no RPC, no second `buildTree`, and it follows the node from the streaming tree into its finalized message. It is frozen while inactive, the same rule as `vm`.
5. **Local `openSession()` closes the in-place view.** The session is already open in single chat.
6. **Unroutable lane.** For `cli:` or an id not in this tab, the transcript stays as it is and announces "This agent is not available in this conversation." (`role="status"`). It never routes elsewhere (plan, data-flow section).
7. **The provider sits on `ChatTranscriptComponent.providers`, not on ChatView.** That way only the transcript's descendants (tiles) see it, and sibling compact cards keep the tolerant rule.
8. **`HIDE_AGENT_SIDEBAR` is never set.** It was checked in the spec.

## Risks

- **Escape vs nested inputs.** Escape closes the view unless the event was `defaultPrevented`. If the inline agent bubble's "Message this agent" textarea does not prevent Escape, Escape while typing there leaves the view. That textarea's `sendDraft` is component-local (`inline-agent-bubble.component.ts:1035`, outside this batch), so its text is lost on Back. The main composer draft is not affected.
- **Other hosts of ChatView now get tiles.** Every ChatView transcript renders tiles (contract: the main transcript opts in).
  - The Tribunal conductor provides no `SESSION_CARD_ACTIONS`, so it uses the in-place view.
  - The Rail focus area (`canvas-detail-transcript.component.ts`) uses the in-place view until R9f provides its Rail `SESSION_CARD_ACTIONS`; after that the Rail parent wins with no change here.
  - The Grid `canvas-tile.component.ts:620` already provides actions (deleted in R9j).
- **Specs not run by this lane.** The harness change and the new transcript provider and binding also reach `chat-transcript.ptah-ui.spec.ts`, `.change-set.spec.ts`, `.older-history.spec.ts`, `.replay-mount.spec.ts` and `.replay-motion.spec.ts`. I found no `agent` nodes in the ptah-ui spec, but these runs belong to Mode 2.
- **Prettier.** The two new files are prettier-formatted. The edited existing files already had prettier drift at HEAD (5 to 30 lines each); lint-staged (`nx format:write`) will format them at commit.
- **Cost of the covered transcript.** It keeps rendering stream updates under the overlay, the same cost as before opening. The node lookup walks the slots newest first on each `vm` update while the view is open.

## Fix round (codex-review-R9n.md)

Paths are under `libs/frontend/chat/src/lib/components/organisms/transcript/`. No other file was
touched. The display dock is unchanged (decision 77): there is no `HIDE_AGENT_SIDEBAR` change.

### Finding 1 (Serious): Escape discarded an agent message draft

- `single-chat-subagent-view.component.ts:134-147`: `onEscape` now ignores an Escape that
  was already `defaultPrevented` or that started in an editable element. The new `isEditable`
  helper treats a target as editable when it sits inside an `input`, `textarea`, `select` or
  `[contenteditable]:not([contenteditable="false"])` element. Escape anywhere else in the view
  still calls `preventDefault` and goes Back. `inline-agent-bubble` is unchanged.
- New case at `single-chat-subagent-view.component.spec.ts:214`. The execution-node stub now
  renders a nested `textarea` that stands in for "Message this agent".
  - Escape in that textarea: Back is not emitted, the event is not prevented, the same
    textarea stays mounted and its text is kept.
  - Escape inside a nested `contenteditable` element: Back is not emitted.
  - Escape on the view body: Back is emitted once.

### Finding 2 (Serious): a vanished agent left the transcript inert

Rule chosen (Decisions):

- **Tab or session switch closes the view automatically, with no restore.** A switch is any of:
  - the `tabId` input changes;
  - the tab's `claudeSessionId` changes from one non-null value to a different value, including
    to null.

  The saved scroll position and the opener belong to the previous conversation, so they are
  dropped, and no notice is shown. When a null id becomes the first id, that counts as the same
  conversation, because a new conversation can receive its id after it opens. Any change after
  that counts as a switch. The rule applies whether or not the transcript is visible.
- **Same-session disappearance closes the view automatically, like Back.** This applies when
  the transcript is active and the agent can no longer be resolved. Scroll is restored, the
  polite notice says "This agent is no longer available in this conversation." and the view
  does not reopen if the agent comes back. There is no lingering "unavailable" overlay, so the
  transcript can never stay inert.
- **A hidden transcript keeps its frozen view.** This follows the existing `vm` freeze rule. The
  check runs again on reactivation, which closes the view if the agent is gone.
- **The inert flag and the overlay are derived from the same value.** Both come from the
  resolved agent: `subagentOpen = openSubagent() !== null`. So even before the close effect
  runs, a missing agent never leaves an inert scroller.
- **Focus.** On close, focus returns to the opener only when focus was lost (it is on
  `body`/null). An auto-close therefore never takes focus from a field the user is typing in.

Changes in `chat-transcript.component.ts`:

- `:160`: `OpenSubagent.node` is now `ExecutionNode` and can no longer be null.
- `:176`: new `SubagentOwner` holds the tab id and session id of the open agent.
- `:707-722`: `openSubagent` returns null when the agent is missing, and `subagentOpen` is
  derived from it.
- `:740-768`: `closeSubagent` uses the new `discardSubagent` and restores focus only when focus
  was lost. `discardSubagent` clears the open state without restoring.
- `:789-790`: opening records the owner and seeds the frozen resolution.
- `:801-826`: new `syncOpenSubagent` applies the rule above.
- `:921-927`: one constructor effect over `tabId`, `sessionId` and `openSubagent` calls it.

Other changes:

- `chat-transcript.component.html:170-175`: comment only.
- `single-chat-subagent-view.component.ts:97`: `node` is now `input.required<ExecutionNode>()`.
  The `@else` unavailable branch was removed because nothing can reach it any more.

Spec changes:

- `chat-transcript.component.spec.ts`:
  - The stub's `node` is now non-null.
  - `configure` now has a `sessionSig` (`:1179`) and a second tab, `tab-2`.
  - New `SwitchingHost` (`:1121`) with signal `tabId` and `active` inputs.
  - The case that pinned the stale behaviour ("shows the unavailable state when the open agent
    leaves the tab") is replaced.
- New cases in `chat-transcript.component.spec.ts`:
  - `:1354` The agent leaves the same session: the view closes, the scroller is not inert, the
    notice is announced, and the view does not reopen when the agent comes back.
  - `:1380` Session switch while open: the view closes and the scroller is not inert, even
    though the tree still carries the same tool call id. No notice is shown.
  - `:1398` A null session id becoming the first id keeps the view open, and a later change
    closes it.
  - `:1416` Tab switch while open (the `tabId` input changes): the view closes, the scroller is
    not inert, and switching back does not reopen it.
  - `:1435` Hidden transcript: the view stays frozen while the agent is removed, and it closes
    with the notice on reactivation.
- `chat-transcript.display.spec.ts`:
  - The stub's `node` is now non-null.
  - `:886`: growth in the same conversation keeps the agent open while the dock updates.
- `single-chat-subagent-view.component.spec.ts`: the "unavailable state" case was removed
  because that branch no longer exists.

### Minor items

Questions 3 and 4 of the review were left as recorded:

- Duplicate tool-call ids within one tab are assumed unique.
- A real permission card is an integration check for Mode 2/R9f.
- The Tribunal and Rail `HIDE_AGENT_SIDEBAR` hosts are outside these files and are protected.

### Checks

Each command was run from W through the lock runner, one at a time:

| Command | Result |
| --- | --- |
| `node .ptah/tmp/check-run.mjs fix-R9n -- npx nx test @ptah-extension/chat --testFile=single-chat-subagent-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, **5/5 passed** |
| same with `--testFile=chat-transcript.component.spec.ts` | 1 suite, **39/39 passed** (35, minus 1 replaced case, plus 5 new) |
| same with `--testFile=chat-transcript.display.spec.ts` | 1 suite, **15/15 passed** |
| `ptah_get_diagnostics` (the 4 edited .ts files, errors only) | no diagnostics in the requested files; sibling spec errors are pre-existing and unrelated |
| `prettier --check` on the two view files | clean |

Not run (Mode 2, as before): `chat-transcript.ptah-ui.spec.ts`, `.change-set.spec.ts`,
`.older-history.spec.ts`, `.replay-mount.spec.ts`, `.replay-motion.spec.ts`,
`transcript-render-window.spec.ts`.
