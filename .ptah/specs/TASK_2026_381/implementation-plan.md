# Implementation Plan - TASK_2026_381

Bound renderer memory: window the chat transcript, and cap the payloads a
finalized `ExecutionChatMessage` retains.

All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\transcript-memory`. Every
`file:line` was opened in that worktree.

---

## Inputs and constraints

- **Requirements used:**
  - `.ptah/specs/TASK_2026_381/context.md` (measurements, ranked causes, scope
    boundary)
  - `.ptah/specs/TASK_2026_381/task.md`
  - `CLAUDE.md`, `libs/frontend/chat/CLAUDE.md`,
    `libs/frontend/chat-streaming/CLAUDE.md`,
    `libs/frontend/chat-state/CLAUDE.md`,
    `libs/frontend/chat-execution-tree/CLAUDE.md`,
    `libs/frontend/chat-ui/CLAUDE.md`, `libs/frontend/chat-types/CLAUDE.md`,
    `libs/shared/CLAUDE.md`
- **Corrections applied:** two, both to `context.md`'s ranked cause #1. See
  _Corrections to the stated diagnosis_ below. Neither changes the task's
  conclusion; both change the design.
- **Design handoff used:** none — this task has no UI design artifact. The one
  new visible element (a truncation marker) is specified inline in component 7.
- **Missing decision-critical input:** none. The one question that could not be
  answered from `context.md` — "are dropped payloads re-readable?" — was
  answered from source and is settled in _Decision 3_.
- **Coordination inventory read:**
  `D:\projects\ptah-extension\.claude-worktrees\electron-cold-start-380\.ptah\specs\TASK_2026_380\implementation-plan.md:1618-1705`.
  (The path given in the task brief,
  `D:\projects\ptah-extension\.ptah\specs\TASK_2026_380\`, does not exist — 380's
  plan lives only in its own worktree.) Result: **zero file overlap**. See
  _Coordination conflicts_.

### Corrections to the stated diagnosis

`context.md:40-49` states the transcript "is not virtualized … There is no
`cdkVirtualFor` and no windowing", citing
`chat-transcript.component.ts:62` and `:270`.

1. **Neither cited line says that.** `:62` is the start of the component's
   doc-comment (`ChatTranscriptComponent - Per-tab message list …`) and `:270`
   is the "Why unified" comment on `totalMessageCount`. The line that actually
   speaks to windowing is `chat-transcript.component.ts:128-134`, and it says
   the **opposite**: _"Off-screen message bubbles are skipped by the browser via
   `content-visibility: auto` … so this gives virtual-scroll-class performance
   without the experimental autosize estimator."_
2. **Browser-native windowing is already shipped, at two levels.**
   `chat-transcript.component.css:39-42` (`.chat-msg-cv { content-visibility:
auto; contain-intrinsic-size: auto 120px; }`) and
   `message-bubble.component.css:11-12` / `:16-17` (finalized bubbles get it,
   the streaming bubble is opted out).

This matters because `content-visibility: auto` skips **layout and paint** for
off-screen subtrees. It does not destroy the DOM nodes, the Angular component
instances, the view/CD graph, or the parsed markdown output. It buys frame time,
not bytes. The conclusion of `context.md` stands — the transcript is unbounded
in memory — but the fix cannot be "add windowing"; the windowing that exists is
the wrong kind. The fix must **unmount** views, and it must not throw away the
`content-visibility` layer, which remains complementary inside the mounted
window.

---

## Codebase evidence

| Evidence                                                                                                                                                                                                                                      | Location                                                                                                                                                                                      | Architectural implication                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One `@for` over `vm().messages`, one `<ptah-message-bubble>` per message, no mount gate                                                                                                                                                       | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:7-23`                                                                                              | The mount decision has exactly one insertion point. A render window is an `@if` here plus a placeholder `@else`, and nothing above or below has to change.                                                                                                               |
| `content-visibility: auto; contain-intrinsic-size: auto 120px` on every bubble wrapper                                                                                                                                                        | `chat-transcript.component.css:39-42`                                                                                                                                                         | Off-screen bubbles already skip layout+paint. Retained bytes are unaffected. The `120px` fallback is the height the browser already guesses for an unrendered bubble — a placeholder that reuses it introduces no new scroll-estimate behaviour.                         |
| Same pair, applied per-bubble, with an explicit opt-out for the streaming bubble                                                                                                                                                              | `message-bubble.component.css:11-12`, `:16-17`                                                                                                                                                | The repository already treats "the streaming message is exempt from windowing" as the correct rule. The render window must inherit that exemption, not invent one.                                                                                                       |
| Collapse is a CSS grid `0fr/1fr` transition, explicitly _not_ an `@if` swap                                                                                                                                                                   | `message-bubble.component.html:91-99`                                                                                                                                                         | **Auto-collapse buys no memory.** Every finalized assistant message instantiates its whole recursive `ExecutionNodeComponent` tree even when collapsed.                                                                                                                  |
| Old messages auto-collapse (`index < total - 4`)                                                                                                                                                                                              | `message-bubble.component.ts:154-162`                                                                                                                                                         | Confirms the intent (bound what the user sees) and confirms it was never carried through to instantiation.                                                                                                                                                               |
| Tool cards default collapsed and gate their body on `@if (!isCollapsed())`                                                                                                                                                                    | `tool-call-item.component.ts:75`, `:116`                                                                                                                                                      | Tool input/output **DOM** is not created by default. The retained cost of a tool payload is the JS string, not the render tree. This is what makes the two causes genuinely independent problems needing two independent bounds.                                         |
| `toolOutput: resultEvent?.output`, `toolInput` parsed from the accumulator, both stored on the node                                                                                                                                           | `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:216-228`                                                                                                                  | The finalized tree holds a live reference to every tool result payload. Once `streamingState` is cleared, the tree is the only thing keeping them alive — and it is per-message, for the life of the window.                                                             |
| `ToolResultEvent.output: unknown`                                                                                                                                                                                                             | `libs/shared/src/lib/types/execution/stream.ts:157-163`                                                                                                                                       | The cap must handle strings and non-strings differently. There is no type guarantee to lean on.                                                                                                                                                                          |
| `MessageFinalizationService` attaches the built tree as `streamingState` at two sites                                                                                                                                                         | `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:133`, `:265`                                                                                                            | Exactly two places mint a finalized tree. A retention pass has two call sites, not many.                                                                                                                                                                                 |
| `finalizeSessionHistory` already runs a copy-on-write map over finalized messages, returning the same reference when unchanged                                                                                                                | `message-finalization.service.ts:275-285`                                                                                                                                                     | The retention pass folds into an existing loop of the identical shape, and the "same reference when nothing changed" idiom is already the house style here.                                                                                                              |
| `markStreamingNodesAsInterrupted` / `markResumableAgentsAsInterrupted` are recursive copy-on-write tree rewrites returning `node` unchanged when nothing moved                                                                                | `message-finalization.service.ts:323-341`, `:527-552`                                                                                                                                         | The exact traversal shape the retention pass needs already exists three times in this file. Copy-on-write is mandatory anyway (see next row).                                                                                                                            |
| `ExecutionNode` is `readonly` in every field                                                                                                                                                                                                  | `libs/shared/src/lib/types/execution/node.ts:85-163`                                                                                                                                          | In-place mutation is not an option even before the identity-map argument.                                                                                                                                                                                                |
| The builder's `nodesById` / `fingerprintsById` hold the same node objects the finalized message holds                                                                                                                                         | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:81`, `:428` (`pruneNodeMaps`)                                                                                         | Mutating a finalized node would corrupt the incremental builder's identity and fingerprint state. And: the memo still holds the **uncapped** nodes after the message is capped — see risk R3 and component 5.                                                            |
| `agent-output-retention.ts` — the one rule: _a cap the user cannot see is indistinguishable from data corruption_; every cap folds or marks, and the marker is emitted even when the fold fails                                               | `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts:8-19`                                                                                                                         | Binding precedent. The new cap obeys it. The precedent constrains the _rule_, not the slice geometry — `capBuffer` keeps the tail, `capSegments` keeps a tail plus landmarks. Choosing head+tail for a finalized tool result is within the precedent, not against it.    |
| `capBuffer` strips and re-issues its own head notice so the count is cumulative and the notice can never be eaten by the next trim                                                                                                            | `agent-output-retention.ts:64-76`                                                                                                                                                             | A marker must be idempotent under re-application. The design uses a structured field instead of a re-parsed regex, which gets the same property for free — justified in component 6.                                                                                     |
| `MAX_FRONTEND_BUFFER = 50 KB` bounds an agent card's **whole** stdout                                                                                                                                                                         | `agent-output-retention.ts:31`                                                                                                                                                                | Calibration anchor: a per-node cap in a transcript of hundreds of nodes must be materially below the whole-card budget.                                                                                                                                                  |
| `STREAMING_EVENT_CAP = 5000` with FIFO eviction and cascade clean                                                                                                                                                                             | `libs/frontend/chat-types/src/lib/chat-types.ts:191`, `:265-286`                                                                                                                              | The **live** state is already bounded. The unbounded thing is the finalized side. Nothing in this plan touches the live cap.                                                                                                                                             |
| `TranscriptRetentionService` — component-scoped LRU, `RETAINED_TRANSCRIPT_CAP = 8`, insertion-ordered ids so `@for` never reorders live DOM, disposal also clears the builder's `tab-${tabId}` memo                                           | `libs/frontend/chat/src/lib/services/transcript-retention.service.ts:19`, `:34`, `:50-53`, `:120-127`                                                                                         | **The tab level is already bounded, by exactly the mechanism the message level needs.** Provided in `ChatViewComponent.providers`, not root. This is the precedent the render window copies: component-scoped, insertion-ordered, disposal releases the associated memo. |
| `transcriptTabIds()` renders the retained set, appending the active tab if the effect has not touched it yet                                                                                                                                  | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:511-525`; `chat-view.component.html:74-82`                                                                            | Up to 8 transcripts are mounted at once. Whatever a single transcript retains is multiplied by up to 8. The message window therefore compounds with a bound that already exists.                                                                                         |
| `projectTabForPersist` drops `streamingState`, keeps `messages` **including each finalized `ExecutionNode` tree, verbatim**; rationale: _"nothing re-fetches a restored tab's transcript … Dropping it would blank every restored tool call"_ | `libs/frontend/chat-state/src/lib/tab-persistence.ts:24-31`, `:93-101`                                                                                                                        | The finalized tree is also the `localStorage` payload. Capping it shrinks the persisted blob and the debounced `JSON.stringify` — a second, free win. It also means a cap is **permanent for a restored tab** unless the resume path changes.                            |
| `SessionLoaderService.refreshResumableSubagentsForSession` calls `chat:resume` on a restored tab and reads only `resumableSubagents` + `cliSessions`, discarding `events`/`messages`                                                          | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:817-871`                                                                                                            | Today there is no re-fetch on reload. Permanence is the current behaviour of the whole transcript, not something this task introduces.                                                                                                                                   |
| `chat:resume` is the only RPC returning turn payloads; `ChatResumeParams` has no offset/limit/since/range field                                                                                                                               | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:210-230`, `:233-288`; registry `libs/shared/src/lib/types/rpc.types.ts:629`                                                                  | **Recovery is whole-session or nothing.** No per-message re-read exists, and adding one would mean editing `rpc.types.ts`, `rpc-handler.ts` and `manifest.ts` — all owned by TASK_2026_380. Out of scope by coordination as well as by design.                           |
| `session:load` documents `messages: []` and `agentSessions: []` as always empty                                                                                                                                                               | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:96-102`                                                                                                                                   | Confirms `chat:resume` is the sole payload path.                                                                                                                                                                                                                         |
| `SessionMetadataStore` stores UI metadata only — no messages, no history, no content                                                                                                                                                          | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1-31`, `:51-97`                                                                                                                     | Rules out the metadata store as a recovery source.                                                                                                                                                                                                                       |
| The SDK JSONL at `~/.claude/projects/<workspace>/<sessionId>.jsonl` holds tool inputs verbatim; `readSessionHistory` replays them to `FlatStreamEvent`s                                                                                       | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:135`, `:169`; `helpers/history/jsonl-reader.service.ts:197-199`; `helpers/history/session-replay.service.ts:79`, `:402-412` | The bytes are not destroyed on disk. Only the renderer's copy is dropped. That is what the marker must tell the user.                                                                                                                                                    |
| The replay path is lossy at two edges: everything before the last `compact_boundary` is dropped, and non-text blocks inside a `tool_result` are dropped                                                                                       | `session-replay.service.ts:87-100`; `helpers/history/agent-correlation.service.ts:266-282`                                                                                                    | "Reload the session" is a _degraded_ recovery, not a perfect one. The marker must not promise more than the system delivers.                                                                                                                                             |
| `@angular/cdk` `21.2.4` is in **devDependencies**, not dependencies                                                                                                                                                                           | `package.json:200`; lock `package-lock.json:1285-1288`                                                                                                                                        | A shipped webview lib importing `@angular/cdk/scrolling` at runtime would depend on a dev-only package. Adopting CDK virtual scroll means moving the dependency first.                                                                                                   |
| `@angular/cdk-experimental` `21.2.4` is in **dependencies** and is imported by **zero** source files                                                                                                                                          | `package.json:86`                                                                                                                                                                             | `AutoSizeVirtualScrollStrategy` is technically available. Nothing uses it.                                                                                                                                                                                               |
| Zero imports of `@angular/cdk/scrolling`, `cdkVirtualFor`, `ScrollingModule`, `VIRTUAL_SCROLL_STRATEGY` or `AutoSizeVirtualScroll` anywhere in `libs/**` or `apps/**`                                                                         | verified by repo-wide search (no matches)                                                                                                                                                     | CDK virtual scroll would be a greenfield introduction with no in-repo pattern to follow.                                                                                                                                                                                 |
| _"there is no estimator to go stale … the position can't oscillate as it did with the autosize strategy"_                                                                                                                                     | `chat-transcript.component.ts:436-441`; corroborated at `:128-134`                                                                                                                            | **The autosize strategy was tried in this component and removed.** This is decisive against re-adopting it.                                                                                                                                                              |
| Zero `IntersectionObserver` usages in `libs/frontend/**`                                                                                                                                                                                      | verified by repo-wide search                                                                                                                                                                  | Introducing one is new for this scope. It is a platform API with no dependency cost, unlike the CDK option.                                                                                                                                                              |
| `overflow-anchor: none` on the scroll container; pinning reads the element's real `scrollTop`/`scrollHeight`                                                                                                                                  | `chat-transcript.component.css:11`, `chat-transcript.component.ts:426-427`, `:441-455`                                                                                                        | Any windowing scheme must preserve real `scrollHeight`. A placeholder carrying the measured height does; a viewport that virtualizes the scroller does not.                                                                                                              |
| `ResizeObserver` on `#messageContent` re-sticks a pinned transcript on any real height change                                                                                                                                                 | `chat-transcript.component.ts:486-500`                                                                                                                                                        | Mount/unmount changes content height. The existing observer already handles that class of event — no new re-stick machinery is needed.                                                                                                                                   |
| The `vm` computed is gated on `active()` and returns a frozen snapshot while hidden                                                                                                                                                           | `chat-transcript.component.ts:315-340`                                                                                                                                                        | Established discipline: an inactive transcript does no reactive work. The render window must be frozen on the same gate for the same reason.                                                                                                                             |
| No `findInPage` call anywhere in `apps/**` or `libs/**`                                                                                                                                                                                       | verified by repo-wide search (no matches)                                                                                                                                                     | **Electron has no find-in-page wiring.** `Ctrl+F` does nothing over the transcript in the desktop app today.                                                                                                                                                             |
| Webviews are created with `retainContextWhenHidden: true` and **no** `enableFindWidget`                                                                                                                                                       | `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:30`, `:112-113`; `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:126`                                     | VS Code's webview find widget is off (it defaults to false). `Ctrl+F` finds nothing over the transcript in the extension either.                                                                                                                                         |
| No jump-to-message / anchor navigation exists — the only scroll drivers are `scheduleStickToBottom` and `restoreScrollOnActivation`                                                                                                           | `chat-transcript.component.ts:441-479`                                                                                                                                                        | There is no jump-to-message feature to break. The design must only avoid making one impossible.                                                                                                                                                                          |
| `ExecutionNodeSchema` is a plain `z.object` (strip, not strict) behind an `as unknown as z.ZodType<ExecutionNode>` cast, and has **zero consumers** outside `schemas.ts`. It already omits `parentToolUseId`, `agentId`, `cost`, `model`      | `libs/shared/src/lib/types/execution/schemas.ts:39-66`, `:85-95`; consumer search: no matches                                                                                                 | Adding a field to the `ExecutionNode` interface compiles without a schema change and breaks no parse, because nothing parses. The schema is updated anyway for consistency; it is not load-bearing.                                                                      |
| `tab-persistence.ts` restores via plain object spread + `sanitizeRestoredTab`, with no Zod parse on the path                                                                                                                                  | `tab-persistence.ts:152-170`                                                                                                                                                                  | A new optional node field survives the `localStorage` round-trip.                                                                                                                                                                                                        |
| `libs/frontend/chat-ui` is `type:ui`; `type:ui` may depend only on `type:ui` and `type:util`                                                                                                                                                  | `eslint.config.mjs:241-244`; `libs/frontend/chat-ui/project.json:7`                                                                                                                           | `chat-ui` cannot import `chat-streaming` (`type:feature`). A truncation marker rendered in `chat-ui` must be carried on data from `libs/shared`, not by importing a predicate from the capping module.                                                                   |
| `chat-state` is `type:data-access` (may depend only on `type:data-access` / `type:util`)                                                                                                                                                      | `libs/frontend/chat-state/project.json:7`; `eslint.config.mjs:237-240`                                                                                                                        | Nothing UI-shaped can be added to `chat-state`. The render window belongs in `chat` (`type:feature`).                                                                                                                                                                    |
| `max-lines` is `warn` at 700, `skipBlankLines`/`skipComments` on, spec files ignored                                                                                                                                                          | `eslint.config.mjs:333-343`                                                                                                                                                                   | `message-finalization.service.ts` is 568 lines; a call and two imports keep it inside the ceiling. The retention logic still gets its own module, for cohesion rather than for the counter.                                                                              |
| `startup-tti.spec.ts` — the house pattern for a performance number: informational, `console.log`, sanity bounds only, re-runnable with one command, explicitly "not a regression gate"                                                        | `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts:1-27`, `:60-80`                                                                                                                    | The measurement harness has a precedent to copy exactly.                                                                                                                                                                                                                 |
| The e2e harness drives the real renderer and asserts on renderer-side observables captured via `page.on('console')` / `page.evaluate`                                                                                                         | `apps/ptah-electron-e2e/src/specs/chat/streaming-message-handlers.spec.ts:1-60`                                                                                                               | Seeding synthetic turns and reading DOM counts from the running renderer is an established capability, not a new one.                                                                                                                                                    |

---

## Architecture decision

### Chosen approach

Two independent bounds, each placed in a seam the repository already owns, plus
one measurement harness.

1. **A render window inside `ChatTranscriptComponent`.** Every message stays in
   the `@for` and in DOM order. Only messages inside an
   `IntersectionObserver`-driven window (viewport ± ~2 viewports), plus an
   always-mounted tail, mount a `<ptah-message-bubble>`. Everything else renders
   a bare placeholder `<div>` carrying that message's last measured height. The
   scroll container, its real `scrollHeight`, `overflow-anchor: none`, the pin
   logic and the `content-visibility` layer are all untouched.

2. **A payload retention pass on finalized trees.** A pure module in
   `chat-streaming`, sibling to `agent-output-retention.ts` and obeying its one
   rule, copy-on-write-rewrites a finalized `ExecutionNode` tree so no node
   retains more than a bounded number of characters of `toolInput` /
   `toolOutput`. What is dropped is folded (head + tail preserved) and marked
   both in-band and on a new structured node field, and the marker is emitted
   even when the fold cannot preserve anything.

3. **A measurement harness** with two deterministic gates and one reported
   figure, so the reduction is measured rather than asserted.

### Decision 1 — Virtualization strategy

**Chosen: an `IntersectionObserver` render window over the existing scroll
container, with height-preserving placeholders and an exempt streaming tail.**

Why this and not the alternatives:

- **Fixed-height `cdkVirtualFor` — rejected.** Message heights vary by orders of
  magnitude, as the task states. Nothing further needed.
- **`AutoSizeVirtualScrollStrategy` (`@angular/cdk-experimental`) — rejected on
  repository evidence, not on taste.** This component already ran an autosize
  estimator and removed it: `chat-transcript.component.ts:436-441` says _"there
  is no estimator to go stale, so the streamed content is always reachable
  without a manual scroll, and the position can't oscillate as it did with the
  autosize strategy"_, and `:128-134` repeats it. Re-adopting it would reinstate
  a defect the file documents having fixed. Secondary: `@angular/cdk` is a
  **devDependency** (`package.json:200`) while `@angular/cdk-experimental` is a
  dependency (`package.json:86`) that nothing imports — adopting CDK scrolling
  means fixing that inconsistency first, in a repo with zero existing CDK
  scrolling usage.
- **A custom `VirtualScrollStrategy` — rejected.** `CdkVirtualScrollViewport`
  replaces the scroll container. That invalidates `#messageContainer`, the
  `(scroll)` handler's `scrollTop`/`scrollHeight`/`clientHeight` arithmetic
  (`chat-transcript.component.ts:426-427`), `scheduleStickToBottom`'s
  `el.scrollTop = el.scrollHeight` (`:450`), the saved-offset restore (`:461-479`)
  and the `ResizeObserver` on `#messageContent` (`:486-500`). The blast radius is
  the entire scroll-and-pin subsystem, for a strategy that still needs the
  estimator the component already rejected.
- **Intrinsic-size CSS containment alone — rejected because it is already
  shipped and is not the fix.** `content-visibility: auto` +
  `contain-intrinsic-size` is live at `chat-transcript.component.css:39-42` and
  `message-bubble.component.css:11-12`. It skips layout and paint; it does not
  free component instances, DOM nodes, event bindings or parsed markdown. It
  stays — inside the mounted window it still skips paint for bubbles scrolled
  just past — but it cannot be the answer to a memory task.
- **Chosen hybrid — accepted.** It keeps every property the component's own
  comments call load-bearing: the scroll container is a plain element, positions
  are real `scrollTop`/`scrollHeight`, there is no estimator. It unmounts, which
  is what actually frees bytes. And it is the _same shape one level down_ as
  `TranscriptRetentionService` (`transcript-retention.service.ts:19-53`), which
  already bounds mounted transcripts per `ChatViewComponent` — component-scoped,
  insertion-ordered so the `@for` never reorders live DOM, disposal releases the
  associated memo. That is the repository's own answer to this exact problem at
  the tab level, and it is being applied at the message level.

**Trade-offs, stated:**

- **Scroll anchoring.** A placeholder carries the message's last _measured_
  height, so `scrollHeight` is preserved to the pixel for any message rendered
  at least once, and mount/unmount inside the window changes total height by
  ~0. A message never yet rendered uses a `120px` fallback — the identical number
  the browser already guesses today via `contain-intrinsic-size: auto 120px`
  (`chat-transcript.component.css:41`). So the scrollbar-estimate behaviour for
  unvisited content is _unchanged_, not newly introduced. `overflow-anchor: none`
  (`:11`) stays, and the existing `ResizeObserver` (`:486-500`) already re-sticks a
  pinned transcript on any real height change.
- **The streaming tail is exempt.** The last message mutates continuously. The
  always-mounted tail (last N messages plus anything the tab is streaming) is
  never unmounted, so a growing message is never torn down mid-stream. This
  mirrors the existing per-bubble opt-out at `message-bubble.component.css:16-17`.
- **Jump-to-message.** No such feature exists today
  (`chat-transcript.component.ts:441-479` are the only scroll drivers). The
  design does not preclude one: placeholders sit at the correct offset in DOM
  order, so `scrollIntoView` on a placeholder lands correctly and the observer
  then mounts the real bubble on the next callback.
- **`Ctrl+F` / find-in-page — explicitly acceptable, because it does not work
  today.** Electron wires no `findInPage` anywhere in the repo (search: no
  matches), and VS Code webviews are created without `enableFindWidget`
  (`webview-manager.ts:112-113`, `angular-webview.provider.ts:126`), which
  defaults to off. Find-in-page over the transcript therefore finds nothing in
  either host **before** this change. Windowing removes no capability that
  exists. The constraint this creates for the future is recorded rather than
  designed around: **if find-in-page is ever wired, it must either mount the full
  window first or be backed by a message-index search, not by the DOM.** That
  belongs to whatever task adds find, and should be written into
  `libs/frontend/chat/CLAUDE.md` by this task's documentation step.

### Decision 2 — What "cap the retained execution tree" means

**The cap obeys `agent-output-retention.ts`'s rule verbatim: fold or mark, and
the marker is emitted whether or not the fold succeeded**
(`agent-output-retention.ts:8-19`).

What is capped, and why only this:

- `ExecutionNode.toolOutput` (`node.ts:101`) — the dominant term. A `Read` of a
  large file, a `Grep`, a `Bash` with long stdout: all land here verbatim via
  `tool-node.fn.ts:226` (`toolOutput: resultEvent?.output`).
- `ExecutionNode.toolInput` (`node.ts:99`) — second. A `Write` or `Edit` carries
  whole file contents in its arguments.
- **`ExecutionNode.content` is NOT capped.** For `text` and `thinking` nodes this
  is the assistant's prose — the thing the transcript exists to show, and the
  thing the user re-reads. Capping it would trade the product for the bytes.
  Recorded as a deliberate bound, not an oversight.
- **`agentPrompt` and `summaryContent` are NOT capped in this task.** They are
  smaller and their render path
  (`libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`,
  1136 lines) was not audited here. Named as measured-but-deferred so a later
  task has a starting point rather than a silent gap.

How the fold works, per node, once over budget:

1. **String payload** → keep a head slice and a tail slice, with one marker line
   naming the dropped character count between them. This diverges from
   `capBuffer`'s head-only truncation (`agent-output-retention.ts:64-76`)
   deliberately: `capBuffer` bounds a _live, growing_ stdout buffer where recency
   is everything, while a finalized tool result is static and its identity lives
   in its opening lines (which file, which command) and its conclusion in its
   last. The precedent constrains the rule (fold or mark), not the slice
   geometry — `capSegments` (`:209-244`) already uses a different geometry from
   `capBuffer` for the same reason.
2. **Non-string payload** → probe with `JSON.stringify`. Under budget: keep the
   object untouched. Over budget: replace with the head+tail **string** form plus
   the marker. Trade-off, stated: a non-string output that routes to a
   specialized renderer (`isTodoWriteToolInput` / `isEditToolInput`,
   `tool-output-display.component.ts:12-17`) falls back to
   `CodeOutputComponent`. A todo list or an edit-diff payload over the budget is
   not a todo list or a diff in any useful sense, so the fallback is the honest
   rendering.
3. **Serialization fails** (cycle, `BigInt`, thrown getter) → keep nothing, emit
   the marker with the reason. This is the "fold failed" branch the precedent
   requires to still be visible (`agent-output-retention.ts:12-15`).

Whole-tree budget: after per-node capping, a per-root-message total budget is
applied newest-node-first, so a single turn that ran two hundred small tools is
bounded too. Nodes dropped by the whole-tree budget get the same marker.

**Where the marker lives — a structured field, not a re-parsed regex.**
`agent-output-retention.ts` writes in-band markers and exports recognizers
(`isSegmentTruncationMarker`, `isOutputTruncationNotice`) because its subject is
a flat `string` and a flat `CliOutputSegment[]` with nowhere else to put the
fact. An `ExecutionNode` is a typed object, so the fact goes in a typed field:
`ExecutionNode.retention?: NodeRetentionNotice` (component 6). This gets, for
free, the two properties `capBuffer` had to work for — the marker cannot be
eaten by a later trim, and its counts are cumulative under re-application,
because re-applying the pass reads the previous notice as a number instead of
re-parsing its own prose. The in-band line is kept **as well**, so a user who
copies the tool output out of the transcript takes the fact with them.

### Decision 3 — Are dropped payloads re-readable?

**Answer: yes from disk, no on demand, and not per message. Design for
permanence within the life of a session view; offer "reload the session" as the
one recovery, and say so in the marker.**

Verified:

- The bytes are not destroyed. The SDK's own JSONL at
  `~/.claude/projects/<workspace>/<sessionId>.jsonl` holds tool inputs verbatim
  (`session-history-reader.service.ts:135`, `:169`;
  `jsonl-reader.service.ts:197-199`) and the backend can replay them to
  `FlatStreamEvent`s (`session-replay.service.ts:79`, `:402-412`).
- Exactly one RPC surfaces them: **`chat:resume`**
  (`libs/shared/src/lib/types/rpc.types.ts:629`;
  `rpc-chat.types.ts:210-288`), returning `events: FlatStreamEventUnion[]`.
  `session:load` is documented as always returning empty arrays
  (`rpc-session.types.ts:96-102`), and `SessionMetadataStore` holds no message
  content (`session-metadata-store.ts:1-31`).
- **It is not rangeable.** `ChatResumeParams` (`rpc-chat.types.ts:210-230`) has
  no offset, limit, `sinceMessageId` or byte-window field. The backend service
  _can_ window (`session-history-reader.service.ts:72-77` `tailBytes`), but that
  capability is reachable only from `readHistoryForCuration`, which has no
  handler. The one paginated transcript RPC in the repo, `subagent:transcript`
  (`libs/shared/src/lib/types/subagent-registry.types.ts:245-262`), is
  subagent-scoped and text-only with tool blocks stripped.
- **Recovery is lossy.** Everything before the last `compact_boundary` is dropped
  on every read path (`session-replay.service.ts:87-100`), and non-text blocks
  inside a `tool_result` are dropped on the way back
  (`agent-correlation.service.ts:266-282`). On the frontend, a replayed session
  then hits `STREAMING_EVENT_CAP = 5000` FIFO eviction
  (`chat-types.ts:191`, `:265-286`) before the tree is built.
- **Today's reload path re-fetches nothing.** On restore,
  `refreshResumableSubagentsForSession` calls `chat:resume` and reads only
  `resumableSubagents` + `cliSessions`
  (`session-loader.service.ts:817-871`); the transcript comes from
  `localStorage`, where the finalized tree is persisted verbatim on purpose
  (`tab-persistence.ts:24-31`).

So: an on-scroll-back re-read is **not possible** without a new RPC parameter,
and adding one would mean editing `libs/shared/src/lib/types/rpc/rpc.types.ts`,
`libs/backend/vscode-core/src/messaging/rpc-handler.ts` and
`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` — **all three owned
by TASK_2026_380** (`380/implementation-plan.md:1676`, `:1678`, `:1682`). It is
out of scope by coordination as well as by design.

Consequences carried into the design:

- Budgets are set generously, because a drop is durable for the life of the
  stored tab.
- The marker must name the recovery honestly: the full text is in the session's
  SDK transcript, and reopening the session reloads it — **not** "click to
  expand".
- Whether a "rangeable `chat:resume`" is worth building is recorded in
  _Future work_, for a task that can safely touch the RPC trio.

### Assumptions

| Assumption                                                                                                                                                                                                                                                                                                    | Check that resolves it                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The four numeric budgets (component 4) are the right magnitude. They are calibrated against `MAX_FRONTEND_BUFFER = 50 KB` (`agent-output-retention.ts:31`) and reasoning about a transcript of hundreds of nodes, **not measured on a real session.**                                                         | The Jest measurement in component 8 reports serialized bytes per finalized message before and after, on a fixture built from a real session dump. If the retained-payload total is still the dominant term, the budgets drop. Every one is a single exported constant, tuned in one place — the same discipline as `chat-types.ts:189` ("Tunable in one place"). |
| Clearing the tab's tree-memo entry at the end of `finalizeCurrentMessage` is safe (component 5). The next turn starts a fresh `streamingState` via `clearStreamingForLoaded` / `applyFinalizedTurn` (`message-finalization.service.ts:107`, `:151`), so the memo for the retired state should be dead weight. | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts` — the equivalence oracle plus every incremental-reuse assertion — must pass unchanged. If any reuse assertion depends on the memo surviving a finalize, the release moves to `TabManagerService`'s next-turn reset instead and the finding is recorded rather than acted on.       |
| `performance.memory.usedJSHeapSize` is populated in the Electron renderer under the e2e harness.                                                                                                                                                                                                              | The spec asserts `> 0` as an instrument-sanity bound (the same shape `startup-tti.spec.ts:74-80` uses for paint entries). If it is absent, the reported figure falls back to `document.querySelectorAll('*').length` alone and the spec says so.                                                                                                                 |
| No consumer parses `ExecutionNode` through Zod, so a new optional field survives every round trip.                                                                                                                                                                                                            | Verified: `ExecutionNodeSchema` (`schemas.ts:39-66`) has zero consumers outside its own file and already omits four interface fields. The schema is still updated in the same edit; if a consumer appears, it will already be correct.                                                                                                                           |

### Effect on existing code

**Replaced:**

- The eager `<ptah-message-bubble>` in the transcript `@for`
  (`chat-transcript.component.html:12-22`) is replaced by a gated mount plus a
  placeholder. The bubble component itself, its inputs, and `track msg.id` are
  unchanged — the streaming→finalized in-place swap described at
  `chat-transcript.component.ts:268-281` still holds, because the id is still the
  track key and a mounted bubble is never remounted by the id transition.
- The two `createExecutionChatMessage({ … streamingState: tree })` call sites in
  `MessageFinalizationService` (`:133`, `:265`) now pass a capped tree.

**Left alone, deliberately:**

- `content-visibility: auto` / `contain-intrinsic-size` at all three sites. They
  are complementary and their removal would regress paint cost.
- `TranscriptRetentionService` and `RETAINED_TRANSCRIPT_CAP = 8`. With a message
  window, each retained transcript holds a window rather than a whole history,
  so the tab cap needs no change.
- `STREAMING_EVENT_CAP`, `setStreamingEventCapped` and its cascade
  (`chat-types.ts:191-286`). The live state is already bounded.
- `ExecutionTreeBuilderService`'s incremental design, memo keys, fingerprints and
  `pruneNodeMaps`. The retention pass runs strictly **after** `buildTree`, on a
  copy-on-write rewrite, and never mutates a node the builder holds.
- `MessageFinalizationService`'s public method names and signatures (facade
  rule). Only the bodies of `finalizeCurrentMessage` and
  `finalizeSessionHistory` gain a call.
- The `libs/frontend/markdown` chokepoint and every markdown render path.
- Everything named out of scope in `context.md:81-105`.

**Nothing is left running beside its replacement.** There is no
`ChatTranscriptV2`, no feature flag, no "legacy eager mode". The render window
is the only mount path; the retention pass is the only finalization path.

---

## Component specifications

### 1. `TranscriptRenderWindow` — the mount decision

- **Purpose.** Decide which message ids are mounted, and remember each one's last
  measured height. Nothing else.
- **Responsibilities.**
  - Own one `IntersectionObserver` rooted on the transcript's scroll container,
    with `rootMargin` of `RENDER_WINDOW_MARGIN_PX` vertically.
  - Expose `isMounted(messageId): boolean` and `placeholderHeight(messageId):
number` as signal reads for the template.
  - Keep the always-mounted tail: the last `ALWAYS_MOUNTED_TAIL` ids of the
    current list, plus every id the tab is currently streaming.
  - Record a mounted element's `boundingClientRect.height` from the observer
    entry when it is greater than zero.
  - Evict height records for ids no longer in the message list, so the map cannot
    outlive the transcript's content (the `pruneNodeMaps` lesson,
    `execution-tree-builder.service.ts:428`, applied to a smaller map).
  - **Freeze while the transcript is inactive.** Under `display:none`
    (`chat-transcript.component.ts:83`) every element reports non-intersecting;
    processing that would unmount a hidden tab's whole window and defeat the
    keep-alive `TranscriptRetentionService` exists for. Callbacks are ignored
    while `!active()`, matching the frozen-`vm` discipline at `:315-340`.
- **Verified contracts and entry points.**
  - Provided in `ChatTranscriptComponent.providers`, **not** `providedIn: 'root'`
    — one window per transcript instance, exactly as
    `TranscriptRetentionService` is provided in `ChatViewComponent.providers`
    (`chat-view.component.ts:124`) and documented as component-scoped at
    `transcript-retention.service.ts:21-33`.
  - Reads nothing from `TabManagerService`; the component hands it the current
    id list and the active flag. This keeps it a pure policy object.
- **Dependencies.** `@angular/core` only. No outward edges. Direction: the
  component depends on the window, never the reverse.
- **Integration points.** `ChatTranscriptComponent` (component 3) and
  `TranscriptSlotDirective` (component 2). No other consumer, and it is not
  exported from `libs/frontend/chat/src/index.ts`.
- **Failure behaviour.** If `IntersectionObserver` is undefined (jsdom, SSR),
  the window degrades to **everything mounted** — the current behaviour. A
  memory optimization must never be able to blank the transcript. This is stated
  as a constructor branch, not an implicit `try/catch`.
- **Quality requirements.** The observer callback is O(entries), not O(messages).
  No per-frame loop, no `requestAnimationFrame` polling — the browser batches
  intersection callbacks, which is the whole reason for choosing this primitive
  over scroll-offset arithmetic.
- **Verification seam.** Unit spec against a stubbed `IntersectionObserver`:
  ids outside the margin unmount; ids in the tail never unmount; a frozen window
  processes no callback; height records are evicted with their ids; a missing
  `IntersectionObserver` mounts everything.
- **Files.**
  - `CREATE libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts`
  - `CREATE libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts`

  Placed inside the `transcript/` folder rather than `src/lib/services/` because
  it is the transcript's private machinery with exactly one consumer, and the
  folder already holds `transcript-filter.utils.ts` on the same principle.

### 2. `TranscriptSlotDirective` — element registration

- **Purpose.** Attach one element to the window's observer for the life of that
  element, and detach it on destroy.
- **Responsibilities.** Take the message id as an input; `observe()` the host
  `ElementRef` on init; `unobserve()` in `DestroyRef.onDestroy`. Nothing else —
  it holds no policy.
- **Verified contracts and entry points.** Standalone attribute directive,
  applied to the `@for` item element in
  `chat-transcript.component.html:12` (the one already carrying
  `class="block px-2 pb-3 chat-msg-cv"`). It resolves `TranscriptRenderWindow`
  from the component injector, which is populated because the window is in
  `ChatTranscriptComponent.providers`.
- **Dependencies.** `@angular/core`, and `TranscriptRenderWindow` by injection.
  One direction.
- **Integration points.** The transcript template only.
- **Failure behaviour.** A missing window injection is a programming error and
  throws at construction. There is no silent no-op path — a directive that
  quietly stopped registering would produce a transcript that mounts only its
  tail and looks like data loss.
- **Quality requirements.** No template, no change detection work, no inputs
  beyond the id.
- **Verification seam.** Unit spec: mounting registers exactly once; destroying
  unregisters; a changed id re-registers.
- **Files.**
  - `CREATE libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.ts`
  - `CREATE libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.spec.ts`

### 3. `ChatTranscriptComponent` — gated mount and placeholder

- **Purpose.** Render the window's decision. The component's existing
  responsibilities (scroll, pin, activation, freeze) are unchanged.
- **Responsibilities added.**
  - Provide `TranscriptRenderWindow` in `providers`.
  - Feed it the current id list from `vm().messages` and the `active()` flag, and
    the id of the streaming message (`vm().finalizedCount` already marks the
    boundary — `chat-transcript.component.html:17`).
  - Template: wrap `<ptah-message-bubble>` in the mount gate and add the
    `@else` placeholder carrying `[style.min-height.px]`.
  - Pass the scroll container element to the window once it exists — the
    `afterNextRender` hook that already sets up the `ResizeObserver`
    (`chat-transcript.component.ts:403-408`) is the correct place, so there is
    one post-render setup point, not two.
- **Verified contracts and entry points.**
  - `@for … track trackByMessageId($index, msg)` (`:9`) is unchanged, so the
    streaming→finalized in-place swap documented at `:268-281` still holds.
  - `vm()` (`:323-340`) remains the single template-facing read; the window is
    driven from it, never from `tabs()` directly, so the freeze gate keeps
    working.
  - `.chat-msg-cv` (`chat-transcript.component.css:39-42`) stays on the item
    element. Placeholders get their own class with `contain: strict` so an
    unmounted slot costs one box.
- **Dependencies.** Adds `TranscriptRenderWindow` and `TranscriptSlotDirective`;
  removes nothing.
- **Integration points.** `chat-view.component.html:74-82` instantiates it
  unchanged. Its `@Input`/`@Output` surface is unchanged, so
  `ChatViewComponent` is not modified and stays clear of 380.
- **Failure behaviour.** Placeholder height is `max(measured, 1)` so a slot is
  never zero-height (a zero-height run would let the observer's margin skip past
  a whole block of messages). With no measurement, `PLACEHOLDER_FALLBACK_PX =
120`, matching `contain-intrinsic-size: auto 120px`
  (`chat-transcript.component.css:41`).
- **Quality requirements.**
  - Accessibility: a placeholder is inert — `aria-hidden="true"`, no focusable
    content, no role. It must never be announced as a message.
  - `ChangeDetectionStrategy.OnPush` (`:81`) and the zoneless signal style are
    unchanged.
  - No markdown rendering changes. `[innerHTML]` is not introduced.
- **Verification seam.** Component spec extensions to
  `chat-transcript.component.spec.ts`:
  - N messages, small window → mounted `ptah-message-bubble` count ≤ window cap,
    while `@for` slot count is N.
  - The streaming message is always mounted.
  - Unmounting a mid-list message leaves `scrollHeight` within a pixel.
  - An inactive transcript processes no window callback.
  - The existing pin / activation-restore assertions still pass unchanged.
- **Files.**
  - `MODIFY libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
  - `MODIFY libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
  - `MODIFY libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css`
  - `MODIFY libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`

### 4. `execution-tree-retention.ts` — the payload bound

- **Purpose.** Given a finalized `ExecutionNode` tree, return a tree whose
  retained tool payloads are bounded, with every drop visible.
- **Responsibilities.**
  - `capFinalizedTree(root: ExecutionNode): ExecutionNode` — copy-on-write
    recursion returning `root` **by reference** when nothing is over budget,
    matching `markStreamingNodesAsInterrupted`
    (`message-finalization.service.ts:323-341`).
  - Per-node capping of `toolOutput` and `toolInput` per Decision 2.
  - The whole-message budget, spent newest-node-first.
  - Owning the four exported constants and nothing else.
- **Verified contracts and entry points.**
  - `ExecutionNode.toolInput?: Record<string, unknown>` (`node.ts:99`),
    `toolOutput?: unknown` (`node.ts:101`), `children: readonly ExecutionNode[]`
    (`node.ts:156`) — all `readonly`, so copy-on-write is the only legal shape.
  - `createExecutionNode` (`libs/shared/src/lib/types/execution/factories.ts:11`)
    is **not** used for the rewrite: it re-applies defaults for `status`,
    `content`, `children` and `isCollapsed`, which would silently reset a
    finalized node's state. Object spread of the existing node is correct.
  - The new `ExecutionNode.retention` field from component 6.
- **Dependencies.** `@ptah-extension/shared` (types only). No Angular, no DI —
  a pure module, exactly like its sibling `agent-output-retention.ts`
  (`chat-streaming/CLAUDE.md`, Internal Structure). This is why it is not an
  injectable collaborator: the facade rule applies to a class being split, and
  the nearest precedent for this concern in this lib is a pure module.
- **Integration points.** `MessageFinalizationService` only (component 5). Not
  exported from `libs/frontend/chat-streaming/src/index.ts` — **no barrel is
  edited anywhere in this plan.**
- **Failure behaviour.**
  - `JSON.stringify` throws (cycle, `BigInt`) → payload replaced by the marker
    alone, `retention.foldFailed = true`, node still returned. This is the
    precedent's "the marker is emitted whether or not the fold succeeded"
    (`agent-output-retention.ts:12-15`).
  - A node already carrying a `retention` notice (re-applied pass, e.g. history
    finalization over a restored tab) **accumulates** the counts and does not
    re-truncate the already-truncated payload. This is the property
    `capBuffer:64-76` works for by re-parsing its own notice; here it is a field
    read.
  - The pass never throws. A defect in capping must not be able to lose a turn.
- **Quality requirements.**
  - O(nodes + capped bytes) per finalized message, once per turn end. Not on the
    streaming path.
  - Never mutates an input node (identity-map safety, `execution-tree-builder.service.ts:81`).
  - Deterministic: same input → byte-identical output, so the Jest measurement is
    stable.
- **Verification seam.** Its own spec, mirroring
  `agent-output-retention`'s spec discipline:
  - Under budget → the exact same object reference is returned.
  - Over budget → head and tail both present, marker between them, character
    count correct.
  - Non-string over budget → string fallback, marker present.
  - Unserializable → marker present, `foldFailed` true, node intact.
  - Re-application → counts accumulate, payload does not shrink twice.
  - Whole-message budget → newest nodes survive, oldest are marked.
  - Serialized-size assertion: a fixture tree over the budget serializes below a
    stated ceiling after the pass. This is the deterministic gate for cause #2.
- **Files.**
  - `CREATE libs/frontend/chat-streaming/src/lib/execution-tree-retention.ts`
  - `CREATE libs/frontend/chat-streaming/src/lib/execution-tree-retention.spec.ts`

### 5. `MessageFinalizationService` — integration and memo release

- **Purpose.** Apply the cap at the two points a finalized tree is minted, and
  stop the builder's memo from holding the uncapped tree afterwards.
- **Responsibilities added.**
  - `finalizeCurrentMessage`: cap each tree before
    `createExecutionChatMessage({ … streamingState: tree })` at `:130-143`.
  - `finalizeSessionHistory`: cap inside the existing copy-on-write map at
    `:275-285`, which already has the "same reference when unchanged" shape.
  - After `applyFinalizedTurn` (`:151-154`), release the builder's cache entry
    for that tab so the memo does not keep the pre-cap nodes alive.
- **Verified contracts and entry points.**
  - `ExecutionTreeBuilderService.clearForTab(tabId)`
    (`execution-tree-builder.service.ts:729`) — already the release used by
    `TranscriptRetentionService.dispose` (`transcript-retention.service.ts:126`)
    and by `StreamRouter` on tab close
    (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:954`). Same
    method, third caller — no new API.
  - `treeBuilder` is already injected (`message-finalization.service.ts:32`), so
    no constructor growth and no facade-rule split is triggered.
  - `markLastAgentAsInterrupted` (`:382`) and
    `markAgentsAsInterruptedByToolCallIds` (`:448`) rewrite an
    **already-finalized** tree. They must not un-cap it: their copy-on-write
    walks preserve every field they do not touch, so `retention` and the capped
    payloads survive. Pin this with a spec case rather than assuming it.
- **Dependencies.** Adds `./execution-tree-retention` (same lib, relative
  import). No new injections. No lib-boundary change.
- **Integration points.** Callers of `finalizeCurrentMessage` /
  `finalizeSessionHistory` — `StreamingHandlerService`
  (`streaming-handler.service.ts:388`), `TurnStateApplier`,
  `SessionLoaderService` (`session-loader.service.ts:661`) — are unchanged. The
  method signatures and return types are unchanged (facade rule).
- **Failure behaviour.** The cap is applied inside the existing flow with no new
  early return. If `capFinalizedTree` were to return an unusable value, the turn
  would still be committed — but it cannot throw (component 4), so there is no
  new failure mode on the turn-commit path.
- **Quality requirements.** File stays under the 700-line `warn` ceiling
  (`eslint.config.mjs:340-343`): 568 lines today, plus one import and three call
  lines.
- **Verification seam.** `message-finalization.retention.spec.ts`:
  - A turn with an oversized tool output finalizes with a capped, marked tree.
  - The finalized message's serialized size is below a stated ceiling.
  - `clearForTab` is called exactly once per finalize, with the target tab id.
  - The interrupt-marking methods preserve `retention` and capped payloads.
  - Every existing assertion in `message-finalization.service.spec.ts` and
    `message-finalization.cross-workspace.spec.ts` passes unchanged.
  - `execution-tree-builder.service.spec.ts` — the equivalence oracle — passes
    unchanged. This is the gate on the memo release.
- **Files.**
  - `MODIFY libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`
  - `MODIFY libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts`
  - `CREATE libs/frontend/chat-streaming/src/lib/message-finalization.retention.spec.ts`

### 6. `ExecutionNode.retention` — the marker contract

- **Purpose.** Carry the truncation fact as typed data, from the capping module
  in `chat-streaming` to the renderers in `chat-ui`, across a lib boundary that
  forbids a direct import.
- **Responsibilities.** Define one optional interface field and its shape:
  which payloads were capped, how many characters were dropped in total across
  every application of the pass, and whether the fold failed.
- **Verified contracts and entry points.**
  - Added to `ExecutionNode` in
    `libs/shared/src/lib/types/execution/node.ts:85-163`. **No barrel change** —
    the interface is already exported through the existing chain, so
    `libs/shared/src/index.ts` (owned by 380, `380:1686`) is not touched.
  - `ExecutionNodeSchema` (`libs/shared/src/lib/types/execution/schemas.ts:39-66`)
    is updated in the same edit. It is a plain `z.object` behind an
    `as unknown as z.ZodType<ExecutionNode>` cast (`:66`) with **zero consumers**
    outside its own file, and it already omits `parentToolUseId`, `agentId`,
    `cost` and `model` — so this is a consistency fix, not a correctness
    requirement. Recorded so the implementer does not treat it as load-bearing.
  - The `localStorage` round trip is a plain spread through
    `sanitizeRestoredTab` (`tab-persistence.ts:152-170`) with no Zod parse, so
    the field survives a reload.
- **Dependencies.** None — `libs/shared` is the foundation layer
  (`libs/shared/CLAUDE.md`, Dependencies: none).
- **Integration points.** Written by component 4, read by component 7. This is
  the **only** legal route: `chat-ui` is `type:ui` and may depend on `type:ui` /
  `type:util` only (`eslint.config.mjs:241-244`), so it cannot import a predicate
  from `chat-streaming` (`type:feature`).
- **Failure behaviour.** The field is optional. Every existing node, every
  restored node from an older `localStorage` blob, and every node from a
  `chat:resume` replay reads `undefined` and renders exactly as today.
- **Quality requirements.** Field names must not collide with the four
  already-drifted schema omissions; the interface comment states where the field
  is written and where it is read, so a future reader does not have to search.
- **Verification seam.** A type-level spec is not meaningful; verification is by
  component 4's spec (written) and component 7's spec (read), plus the whole-repo
  `typecheck`.
- **Files.**
  - `MODIFY libs/shared/src/lib/types/execution/node.ts`
  - `MODIFY libs/shared/src/lib/types/execution/schemas.ts`

### 7. Truncation marker rendering

- **Purpose.** Make the cap visible where the user looks for the payload, so the
  cap is not indistinguishable from data corruption
  (`agent-output-retention.ts:10-12`).
- **Responsibilities.** One compact, visually distinct line inside the tool
  card's Output and Input sections when `node().retention` is present, stating:
  what was dropped, how much, and that the full text is in the session's
  transcript and returns when the session is reopened.
- **Verified contracts and entry points.**
  - `ToolOutputDisplayComponent` renders under `@if (node().toolOutput ||
editInput())` (`tool-output-display.component.ts:47-49`). The marker must
    render **outside** that guard, because a fold that preserved nothing leaves
    no `toolOutput` at all — and that is exactly the case the marker exists for.
  - `ToolInputDisplayComponent` — same treatment, same file neighbourhood.
  - Both already import `ExecutionNode` from `@ptah-extension/shared`
    (`tool-output-display.component.ts:12-17`), so no new dependency edge.
  - Both are inside `@if (!isCollapsed())` on the parent
    (`tool-call-item.component.ts:75`), so the marker costs zero DOM until the
    user expands the tool — the same trade the tool payload itself already makes.
- **Dependencies.** `@ptah-extension/shared` types, already present. No new
  imports, no new components.
- **Integration points.** None beyond these two components. **No component is
  added to `libs/frontend/chat-ui/src/index.ts`** — the barrel is contested by
  380 (`380:1607`, `380:1688`), and no export is needed because the marker is
  markup inside components that are already exported.
- **Failure behaviour.** `retention` absent → nothing renders, byte-identical to
  today. `retention.foldFailed` → the copy says the content could not be
  preserved at all, rather than implying a partial one is shown.
- **Quality requirements.**
  - Accessibility: the marker is real text in the document flow, not a
    `title`-only affordance or a decorative icon. It is readable by a screen
    reader in place.
  - DaisyUI/Tailwind classes only, per `chat-ui/CLAUDE.md` guideline 6. No new
    CSS file.
  - Copy must be specific about recovery: reopening the session reloads the
    transcript from the SDK JSONL, and that reload itself drops anything before
    the last compaction (`session-replay.service.ts:87-100`). Do not promise a
    complete restore.
- **Verification seam.** Component spec on both components: marker renders when
  `retention` is set (including with no `toolOutput` at all); absent otherwise;
  `foldFailed` changes the copy; the marker text contains the dropped-character
  count.
- **Files.**
  - `MODIFY libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts`
  - `MODIFY libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts`

### 8. Measurement harness

- **Purpose.** Make the reduction measurable and re-runnable by anyone, at three
  levels, so the claim is evidence rather than assertion.
- **Responsibilities.**
  - **Gate A (deterministic, e2e).** Seed N synthetic finalized turns into the
    active tab through the running renderer, then read from
    `page.evaluate`: the number of `ptah-message-bubble` elements versus the
    number of `@for` slots. Assert mounted ≪ total. This is the direct,
    non-statistical proof that cause #1 is bounded.
  - **Gate B (deterministic, Jest).** Component 4's serialized-size assertion —
    a fixture message over budget serializes below a stated ceiling after
    capping. This is the direct proof that cause #2 is bounded.
  - **Reported figure (informational, e2e).** `performance.memory.usedJSHeapSize`
    and total element count inside the transcript container, after the same N
    turns, logged with `console.log` and bounded only for instrument sanity —
    exactly the pattern `startup-tti.spec.ts:1-27`, `:60-80` establishes and
    explicitly labels as "not a regression gate".
  - **The acceptance measurement (human, out-of-CI).** The user's own instrument,
    re-run on a packaged build with the same session:
    `Get-CimInstance Win32_Process -Filter "Name='Ptah.exe'"`
    (`context.md:10`). The renderer's **2474 MB private** row
    (`context.md:14`) is the before. This is the number the task is judged on,
    and it is recorded in the batch report, not automated.
- **Verified contracts and entry points.**
  - `apps/ptah-electron-e2e/src/specs/perf/` already exists and holds exactly one
    spec of this shape (`startup-tti.spec.ts`).
  - The harness drives the real renderer and reads renderer-side observables
    (`apps/ptah-electron-e2e/src/specs/chat/streaming-message-handlers.spec.ts:1-60`),
    so seeding and DOM counting are existing capabilities.
- **Dependencies.** The existing `ui` fixture from
  `apps/ptah-electron-e2e/src/support/fixtures.ts`. No new support file.
- **Integration points.** None. It reads; it changes nothing.
- **Failure behaviour.** If `performance.memory` is unavailable, the spec logs
  that fact and still runs Gate A. An instrument that silently returns zero is
  worse than one that says it is missing — hence the sanity bounds.
- **Quality requirements.** Gate A must be deterministic across machines: assert
  a ratio and a hard ceiling derived from the window constants, never a wall-clock
  or byte threshold.
- **Verification seam.** The spec is the seam.
- **Files.**
  - `CREATE apps/ptah-electron-e2e/src/specs/perf/transcript-memory.spec.ts`

---

## Integration architecture

### Data flow, boundary to boundary

**Write path (a turn ends):**

```
SDK stream events
  → StreamingAccumulatorCore            (StreamingState, capped at 5 000 events)
  → ExecutionTreeBuilderService.buildTree(stateCopy, `tab-${tabId}`)
                                        (message-finalization.service.ts:68, :190)
  → capFinalizedTree(tree)              NEW — copy-on-write, bounded payloads,
                                        retention notice written
  → createExecutionChatMessage({ streamingState: cappedTree })
                                        (message-finalization.service.ts:133, :265)
  → TabManagerService.applyFinalizedTurn / applyFinalizedHistory   (:151, :286)
  → ExecutionTreeBuilderService.clearForTab(tabId)   NEW — releases the
                                        uncapped nodes still held by the memo
  → debounced projectTabForPersist → localStorage   (tab-persistence.ts:93-113)
```

The capped tree is what reaches `TabState.messages`, `localStorage`, and every
reader. There is no second, uncapped copy anywhere after `clearForTab`.

**Read path (rendering):**

```
TabManagerService.tabs()
  → ChatTranscriptComponent.vm()        (gated on active(), :323-340)
  → @for over vm().messages             (every message, every id, in order)
  → TranscriptRenderWindow.isMounted(id)
       true  → <ptah-message-bubble> → ExecutionNodeComponent tree
                → ToolCallItemComponent (@if !isCollapsed → input/output/marker)
       false → inert placeholder at the last measured height
```

### State and persistence

| State                                    | Owner                                                                     | Lifetime                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mounted-id set, height records, observer | `TranscriptRenderWindow`, provided in `ChatTranscriptComponent.providers` | Exactly the transcript instance. Destroyed with it, which is bounded by `RETAINED_TRANSCRIPT_CAP = 8` (`transcript-retention.service.ts:19`). |
| Capped `ExecutionNode` tree              | `TabState.messages[i].streamingState`                                     | Tab lifetime, plus `localStorage` (`tab-persistence.ts:24-31`). The capping is **durable** — see Decision 3.                                  |
| `retention` notice                       | The node it describes                                                     | Same as the tree, including across a reload.                                                                                                  |
| Builder memo for `tab-${tabId}`          | `ExecutionTreeBuilderService`                                             | Now released at turn end as well as on tab close.                                                                                             |

Nothing new is persisted. Nothing new is added to the RPC surface. No backend
lib is touched.

### External boundaries

None crossed. This work is entirely inside `scope:webview` frontend libs plus a
type addition in `libs/shared`. No HTTP, no IPC, no file I/O, no new AI tool
argument — so no new Zod validation boundary is created. The one data shape that
crosses a lib boundary (`ExecutionNode.retention`) travels through `libs/shared`,
which is the sanctioned bridge (`CLAUDE.md`, Frontend ↔ backend isolation).

### Failure and rollback

- **Observer unavailable** → everything mounts. Current behaviour. No blank
  transcript.
- **Height record missing** → 120 px fallback, identical to the browser's own
  current guess.
- **Fold fails** → marker still emitted; the node survives; the turn commits.
- **Capping defect** → cannot throw; the turn-commit path has no new failure
  mode.
- **Rollback**: each of the two bounds is independently revertable — the render
  window is one `@if` plus one provider, the payload cap is one function call at
  two sites. They share no state and no file.

### Observability

The three caps in `agent-output-retention.ts` are silent by design because their
marker _is_ the signal. The same applies here: a truncation is visible in the UI
(component 7) rather than in a log. Two exceptions where a log is warranted:

- A **one-shot** `console.warn` the first time the whole-message budget (not just
  a per-node budget) fires, following the one-shot precedent at
  `chat-types.ts:277-282`. That budget firing means a single turn is
  pathologically large and is worth knowing about once per window.
- The render window logs nothing. A mount decision that happens hundreds of times
  a scroll must not write to the console.

---

## Architecture-level quality requirements

**Functional**

- Every message the user has ever seen in a tab remains present, in order, at its
  correct scroll offset, and renders in full when scrolled to.
- The streaming message is never unmounted while it is streaming.
- Every dropped byte is visible as a marker naming the count and the recovery.
- A restored tab renders identically to a live one, marker included.
- Scroll position, pinning, activation restore and the finalize transition behave
  exactly as they do today.

**Performance**

- Mounted `ptah-message-bubble` instances per transcript ≤ a bound derived from
  the window constants, independent of message count. Deterministic gate A.
- Serialized bytes per finalized message ≤ the stated ceiling. Deterministic gate B.
- The render-window callback is O(entries) per intersection batch — no per-frame
  loop, no offset table, no estimator.
- The retention pass runs once per turn end, never on the streaming path.
- No regression in `startup-tti.spec.ts`'s reported numbers.

**Security**

- No new external input, no new parsing of untrusted data, no new sink. Markdown
  continues to reach the DOM only through the existing path; no `[innerHTML]` is
  introduced. The truncation marker is interpolated text, never markup.

**Maintainability**

- `chat-ui` gains no service and no barrel export (`chat-ui/CLAUDE.md` guidelines
  1 and 2 hold).
- `chat-streaming` never imports from `chat` (`chat-streaming/CLAUDE.md` guideline 1).
- `chat-execution-tree` builders stay pure and untouched (its guideline 2).
- `ExecutionTreeBuilderService`'s incremental design, memo keys, fingerprints and
  `pruneNodeMaps` are untouched; the equivalence oracle is a gate.
- `MessageFinalizationService` keeps its name, its token and every method
  signature (facade rule). No constructor parameter is added.
- **No barrel file is edited in this plan** — not `chat-ui/src/index.ts`, not
  `chat-streaming/src/index.ts`, not `shared/src/index.ts`, not
  `frontend/core/src/lib/services/index.ts`.

**Testability**

- Mount decisions are unit-testable against a stubbed `IntersectionObserver`,
  with no real layout.
- The capping module is a pure function: deterministic, no DI, no Angular.
- The two headline claims each have a deterministic gate, not a reported number.
- Coverage is expressed as behaviour — "an unmounted message returns intact when
  scrolled to", "a fold that preserves nothing still shows a marker" — not as a
  percentage.

---

## Coordination conflicts

**None.** Checked file by file against
`electron-cold-start-380/.ptah/specs/TASK_2026_380/implementation-plan.md:1618-1705`.

Specifically avoided, and how:

| 380-owned file                                                                                   | 380 ref                            | How this plan avoids it                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/frontend/chat-ui/src/index.ts`                                                             | `380:1607`, `380:1688`             | Component 7 adds **markup inside two already-exported components**. No new component, therefore no export.                                       |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`                    | `380:1690`                         | Not touched. The render window is internal to `ChatTranscriptComponent`; its input/output surface is unchanged, so no template above it changes. |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`                       | `380:1689`                         | Not touched, same reason.                                                                                                                        |
| `libs/frontend/core/src/lib/services/index.ts`                                                   | `380:1608`, `380:1687`             | No service is added to `frontend/core`.                                                                                                          |
| `libs/shared/src/index.ts`                                                                       | `380:1686`                         | Component 6 adds a field to an existing exported interface. No barrel change.                                                                    |
| `libs/shared/.../rpc.types.ts`, `vscode-core/.../rpc-handler.ts`, `rpc-handlers/.../manifest.ts` | `380:1676`, `380:1678`, `380:1682` | No RPC is added or changed. This is the direct reason a per-message payload re-read is out of scope (Decision 3).                                |
| `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`                                         | `380:1664`                         | Not touched. No backend lib is touched at all.                                                                                                   |
| `apps/ptah-extension-webview/src/app/app.config.ts`                                              | `380:1701`                         | Not touched.                                                                                                                                     |

Contact points, neither a conflict:

- Both tasks change the Nx project `@ptah-extension/chat`, at disjoint files
  (380: `templates/`; 381: `organisms/transcript/`). Separate worktrees; the
  merge is clean.
- Both change `@ptah-extension/chat-ui`, at disjoint files (380: `src/index.ts`
  and three new component folders; 381: two files under
  `molecules/tool-execution/`).
- Both change `libs/shared`, at disjoint files (380: `types/rpc/`,
  `types/messages/`, `src/index.ts`; 381: `types/execution/`).

One dependency worth restating to the 380 session, from `context.md:126-130`:
380's evidence row 83 concludes the renderer boot gate awaits no backend I/O, so
the freeze is entirely post-shell-paint. A renderer at 2474 MB garbage-collects
under pressure after that paint. 380 makes the wait legible; 381 makes it
shorter. **380's UX outcome is partly gated on 381 landing**, and it is safe for
381 to land first.

---

## Risks

| #   | Risk                                                                                                   | Why it is credible                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Scroll jumps when a placeholder's stored height is stale (font load, window resize, theme change)      | The height is measured once per mount and the panel is resizable (`PanelResizeService`, `chat-view.component.ts:124`)                                        | Height records are keyed per message and refreshed on **every** mount, so a stale record self-corrects the next time the message enters the window. `overflow-anchor: none` (`css:11`) plus the existing `ResizeObserver` re-stick (`ts:486-500`) already handle a height delta. Spec case: `scrollHeight` within a pixel across an unmount.                                   |
| R2  | The always-mounted tail is too small, and a long streaming turn's earlier nodes unmount under the user | The tail is counted in **messages**, but one message's execution tree can be screens tall                                                                    | The tail is `ALWAYS_MOUNTED_TAIL` messages **plus** the whole window margin, and the streaming message is exempt by id, not by position. If a turn is taller than the margin, the observer still keeps the visible part mounted — that is what an intersection window does. Spec case: a tall streaming message stays mounted through growth.                                  |
| R3  | The builder memo keeps the uncapped tree alive, defeating the cap                                      | `nodesById` / `fingerprintsById` hold the same node objects (`execution-tree-builder.service.ts:81`), and nothing released the tab's entry at turn end today | Component 5 calls `clearForTab` after `applyFinalizedTurn` — the same release `TranscriptRetentionService.dispose` (`:126`) and `StreamRouter` (`stream-router.service.ts:954`) already use. Gated on `execution-tree-builder.service.spec.ts` passing unchanged; recorded as an assumption with a named fallback.                                                             |
| R4  | Budgets are wrong, and either memory stays high or useful output is lost                               | They are calibrated, not measured (see Assumptions)                                                                                                          | Four constants in one module, one place to tune (`chat-types.ts:189` precedent). Gate B reports the before/after bytes on a real-session fixture, so the first batch report contains the number that resolves this.                                                                                                                                                            |
| R5  | Capping is permanent for a stored tab, and a user loses output they wanted                             | `tab-persistence.ts:24-31` — the capped tree _is_ the persisted transcript, and nothing re-fetches it (`session-loader.service.ts:817-871`)                  | The marker states the recovery honestly, and it is real: reopening the session runs `chat:resume` (`session-loader.service.ts:583`) and replays the SDK JSONL. The marker must not overstate it — that reload drops everything before the last compact boundary (`session-replay.service.ts:87-100`) and non-text tool-result blocks (`agent-correlation.service.ts:266-282`). |
| R6  | A future find-in-page finds nothing in unmounted messages                                              | Verified as a non-regression _today_ (no `findInPage`, no `enableFindWidget`), but it is a real constraint on the future                                     | Recorded in `libs/frontend/chat/CLAUDE.md` by this task, next to the render window, so the task that wires find reads it before it starts.                                                                                                                                                                                                                                     |
| R7  | Unmount/remount churn on a fast scroll costs more than it saves                                        | Angular component construction is not free, and a flick-scroll can cross many messages                                                                       | The `rootMargin` gives roughly two viewports of hysteresis in each direction, so a normal scroll never crosses the boundary twice. The reported figure in component 8 is taken after a scripted scroll sweep, not only at rest, so churn shows up in the number.                                                                                                               |
| R8  | An inactive transcript keeps its last window mounted, so 8 tabs still hold 8 windows                   | Deliberate: freezing on `!active()` is what preserves `TranscriptRetentionService`'s keep-alive intent                                                       | Accepted and stated. A window is bounded and small; 8 windows is bounded and small. If measurement shows otherwise, the follow-up is to unmount a transcript's window on deactivation — a one-line policy change in component 1, not a redesign.                                                                                                                               |

---

## Future work (recorded, not designed)

- **A rangeable `chat:resume`.** `ChatResumeParams` (`rpc-chat.types.ts:210-230`)
  has no offset/limit, and the backend already has the windowing primitive
  (`session-history-reader.service.ts:72-77` `tailBytes`,
  `jsonl-reader.service.ts:503`) reachable only from an RPC-less method. Adding a
  range parameter would turn Decision 3's "permanent" into "recoverable on
  demand". It requires the RPC trio owned by 380 and belongs to a later task.
- **`agentPrompt` / `summaryContent` retention** (`node.ts:122`, `:134`), pending
  an audit of `inline-agent-bubble.component.ts`.
- **The `ngx-markdown` vs `@ptah-extension/markdown` split.**
  `message-bubble.component.ts:11` and `execution-node.component.ts:12` render AI
  text through `ngx-markdown`, not through the `libs/frontend/markdown`
  chokepoint that `CLAUDE.md` names. Noted while reading; **not touched by this
  task** and not a memory concern. Worth its own look.
- **The main process's 1366 MB** (`context.md:74-79`) — out of scope here, per
  `context.md:83-105`. Nothing found in this investigation adds to that list.

---

## Team-leader handoff

- **Recommended executors.**
  - Components 1, 2, 3, 7 → `frontend-developer`. Angular components, a
    directive, a component-scoped service and two presentational edits.
  - Components 4, 5, 6 → `frontend-developer`. Pure TypeScript plus a service
    integration and a type addition; no UI. A different developer from the above
    can take it — the two sets share no file.
  - Component 8 → `senior-tester`. It is a measurement instrument whose value is
    its honesty about what it does and does not prove, which is that role's
    brief.

- **Complexity: HIGH.** Not because any single component is large, but because
  three of them sit on load-bearing invariants that are documented and specced:
  the incremental tree builder's identity and fingerprint state, the transcript's
  scroll/pin subsystem, and the retention rule that two prior tasks
  (TASK_2026_323 / 335) were spent establishing. The equivalence oracle in
  `execution-tree-builder.service.spec.ts` and the existing transcript specs are
  the things most likely to catch a mistake, and both must pass unchanged.

- **Dependencies and ordering (component-level only).**
  - 6 before 4 (the field must exist before it is written).
  - 4 before 5 (the function must exist before it is called).
  - 4 and 6 before 7 (the marker must be written before it is rendered).
  - 1 before 2 and 3 (the window must exist before it is registered against or
    rendered from).
  - 8 after both bounds land — it measures them.
  - The two chains (1→2→3) and (6→4→5→7) are independent of each other.

- **Parallel-safe work (file-disjoint).**
  - **Set A** — components 1, 2, 3. Files: `libs/frontend/chat/.../transcript/**`.
  - **Set B** — components 6, 4, 5, 7. Files:
    `libs/shared/.../types/execution/**`,
    `libs/frontend/chat-streaming/src/lib/**`,
    `libs/frontend/chat-ui/.../molecules/tool-execution/**`.
  - **Set C** — component 8. Files: `apps/ptah-electron-e2e/src/specs/perf/**`.
  - A and B share no file and no Nx project except that both are `scope:webview`.
    C depends on both landing.

- **Files affected.**

  **CREATE**

  ```
  libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts
  libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts
  libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.ts
  libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.spec.ts
  libs/frontend/chat-streaming/src/lib/execution-tree-retention.ts
  libs/frontend/chat-streaming/src/lib/execution-tree-retention.spec.ts
  libs/frontend/chat-streaming/src/lib/message-finalization.retention.spec.ts
  apps/ptah-electron-e2e/src/specs/perf/transcript-memory.spec.ts
  ```

  **MODIFY**

  ```
  libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts
  libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html
  libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css
  libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts
  libs/frontend/chat-streaming/src/lib/message-finalization.service.ts
  libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts
  libs/shared/src/lib/types/execution/node.ts
  libs/shared/src/lib/types/execution/schemas.ts
  libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts
  libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts
  libs/frontend/chat/CLAUDE.md
  libs/frontend/chat-streaming/CLAUDE.md
  ```

  **REWRITE**: none. No file is replaced and no code is deleted beyond the
  eager-mount line the gate supersedes.

  **NO BARREL IS EDITED.** This is a coordination requirement, not a style
  preference — see _Coordination conflicts_.

- **Verification points.**

  _References to confirm before writing code_
  - `ExecutionTreeBuilderService.clearForTab` (`execution-tree-builder.service.ts:729`)
    and its two existing callers.
  - `createExecutionNode`'s defaults (`factories.ts:11-21`) — do **not** use it
    for the copy-on-write rewrite.
  - `TranscriptRetentionService`'s provider placement
    (`chat-view.component.ts:124`) as the model for component 1.

  _Contracts to honour_
  - The equivalence oracle in
    `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts`
    passes unchanged. This is the gate on components 4 and 5.
  - `pruneNodeMaps`'s amortization (`execution-tree-builder.service.ts:428-458`)
    is not altered.
  - `MessageFinalizationService`'s public signatures are unchanged (facade rule).
  - `chat-ui` gains no service and no export (`chat-ui/CLAUDE.md` guidelines 1, 2).
  - `chat-streaming` does not import from `chat` (`chat-streaming/CLAUDE.md`
    guideline 1).
  - `ChangeDetectionStrategy.OnPush` on every touched component; signals and
    `inject()` only; no `[innerHTML]`.
  - `chat-transcript.component.ts`'s `active()` freeze discipline (`:315-340`)
    extends to the render window.

  _Data changes to apply_
  - `ExecutionNode.retention` added to the interface **and** to
    `ExecutionNodeSchema` in the same edit.
  - No migration. The field is optional; `PERSISTED_TAB_STATE_VERSION` stays at
    `2` (`tab-persistence.ts:60`) — bumping it would make every existing reader
    drop the user's restored tabs.

  _Commands that must pass_

  ```bash
  npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/shared
  npx nx run-many -t lint     -p @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/shared
  npx nx run-many -t test     -p @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/shared
  ```

  Read the `Running target test for 4 projects` header and confirm the count is
  4 — a misspelled project name is silently dropped from a `run-many` set
  (`CLAUDE.md`, Development Commands). Never `nx test projA projB`.

  For component 8:

  ```bash
  npx nx e2e ptah-electron-e2e --grep "transcript-memory"
  ```

  _Acceptance measurement (human, recorded in the batch report)_

  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='Ptah.exe'" |
    Select-Object ProcessId, WorkingSetSize, PrivatePageCount
  ```

  Before: renderer **2474 MB private** (`context.md:14`). The after-figure is
  taken on a packaged build with a comparable session and written into the batch
  report next to the two deterministic gates. Neither gate alone proves the
  2 GB; the gates prove the mechanisms are bounded, and this number proves the
  outcome.
