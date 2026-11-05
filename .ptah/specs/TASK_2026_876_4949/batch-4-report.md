# Batch 4 report — TASK_2026_876_4949 (frontend)

Components implemented: 2 (webview half), 3, 6. All edits are under `libs/frontend/**`. Nothing under `libs/backend`, `plugins`, `libs/shared` or `apps` was touched. No git command was run.

## Files changed

### Component 2 — lane reparent on the webview

- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` — new `reparentAgents(agentIds, parentSessionId)`. It moves only the listed `MonitoredAgent`s, and any `SubagentRecord` whose `agentId` is listed. Unknown ids and ownerless agents are not claimed. If nothing changed, the signal value stays the same reference. The existing `resolveParentSessionId` then moves the parent from the successor tab id to the successor SDK id.
- MODIFIED `libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts` — handles `MESSAGE_TYPES.AGENT_MONITOR_REPARENTED`. A hand-written `parseAgentMonitorReparented` (exported) accepts a non-empty `parentSessionId` and an `agentIds` array of non-empty strings. A rejected payload is dropped with a shape-only `describePayload` warning. No Zod import. The existing casts are unchanged.
- MODIFIED specs: `agent-monitor.store.spec.ts`, `agent-monitor-message-handler.service.spec.ts`.

### Component 3 — idle liveness when the caller ends

- MODIFIED `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` `handleSessionEnded` — after the existing retire/clear, it calls `liveness.markIdle(id, workspaceFor(id))` for each distinct non-empty string among `tabId` and `sessionId`. If the payload has no string `sessionId`, the handler returns early as it did before. `railStateValue`, `runningSessionKeys` and the grouping files are not edited.

### Component 6 — Linked sessions

- CREATED `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-linked-sessions.component.ts` — `InspectorLinkedSessionsComponent` (`ptah-inspector-linked-sessions`). Standalone, OnPush, `input()`/`output()`, no injection, no RPC, no `[innerHTML]`.
  - Inputs: `entries` (`InspectorLinkedSessionEntry[]`) and `currentSessionId`. Output: `openSession(id)`.
  - Markup and tokens follow design-spec §A exactly: `section` with `aria-labelledby` on the `h3` "Linked sessions" (`sec-label text-[10.5px] font-semibold`, no `uppercase`); `ul` with `mt-2 max-h-[10.5rem] overflow-y-auto`; native `button type="button"` rows (`min-h-8 w-full rounded-md px-1.5 py-1`, grid `minmax(0,1fr)` + `auto`).
  - Current row: `bg-surface-2`, a `w-0.5 bg-secondary` bar, `font-semibold`, `aria-current="true"`. Other rows: `font-medium`.
  - Title: `truncate text-[13px] leading-[18px]` with a `title` attribute. Relation: `text-[11px] leading-4 text-base-content-muted whitespace-nowrap shrink-0`.
  - Interaction: hover `hover:bg-base-content/5`; focus `outline-base-content` 2px with 2px offset; `scroll-margin-block: 4px`; `transition-colors duration-[120ms]` only.
  - Accessible names: `Current session, {label}` and `Open {label}, continued from|in`.
  - Missing name: `Session ` plus the first 8 characters of the id, in muted text, and the row is still a button.
  - Activating the current row emits nothing.
- CREATED `inspector-linked-sessions.component.spec.ts` (8 tests).
- MODIFIED `libs/frontend/chat-ui/src/index.ts` — exports the molecule and its two types next to `InspectorSessionStatsComponent`. No inspector organism was added to chat-ui.
- CREATED `libs/frontend/chat/src/lib/services/session-inspector/handoff-chain.client.ts` — `HandoffChainClient` (`providedIn: 'root'`).
  - It calls `session:handoffChain` only through `ClaudeRpcService`.
  - `parseHandoffChainResult` is hand-written and has no Zod. One bad entry refuses the whole chain, so a malformed record is never drawn.
  - `linkedSessionEntries` derives `from` / `current` / `in` in root-first order. If the open id is missing from the chain, no row is marked current and no row is invented.
  - Inspectors call `retain(id)` / `release(id)`: the first retain loads the chain, and the last release drops it. A per-id generation counter drops stale responses.
  - On RPC failure, a thrown call, or a refused result, the chain becomes `[]` and the section is absent. There is no spinner and no alert.
  - `onLinked(link)` reloads each shown session the edge touches. No poll and no timer.
- CREATED `handoff-chain.client.spec.ts`.
- MODIFIED `libs/frontend/chat/src/lib/services/session-inspector/index.ts` — barrel exports for the client and its two pure functions.
- MODIFIED `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` — `parseSessionHandoffLinkedPayload` placed next to `parseSessionHandoffOpenedPayload`. Both ids must be non-empty strings, otherwise it returns `null`.
- MODIFIED `chat-message-handler.service.ts` — handles `MESSAGE_TYPES.SESSION_HANDOFF_LINKED`. It parses the payload, logs `describePayload` and drops it on refusal, and on a hit calls `HandoffChainClient.onLinked`.
- MODIFIED live inspector `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts/.html`:
  - Injects `HandoffChainClient` and `SessionRowActionsService` with `inject()`.
  - `linkedSessionId` is `null` when `presentation() === 'rail'`, otherwise `model().sessionId`.
  - An effect retains and releases that id, using `onCleanup`.
  - `openLinkedSession` calls `SessionRowActionsService.openSession({ id, name })`, with a null label passed as `''`, after `SessionId.safeParse`.
  - Template: `@if (linkedSessions().length > 0)` mounts `<ptah-inspector-linked-sessions>` after the stats switch, outside `@if (s)`, and before `ptah-inspector-agents-section`. This sits inside the shared `#body`, so docked, embedded and sheet all get it.
  - The `w-14` rail template (the `@if (presentation() === 'rail')` branch) is untouched.
- MODIFIED `session-inspector.component.spec.ts` — the existing setup now also provides mocks for `ClaudeRpcService` and `SessionRowActionsService`. A new describe block covers linked sessions.
- MODIFIED `chat-message-handler.service.spec.ts` — provides a mock `HandoffChainClient` and adds the new cases.

Not edited, as the plan's "Leave unchanged" list requires: `session-inspector.store.ts`, `session-inspector.types.ts`, `canvas-inspector-dock.component.ts`, every list, rail, grouping and card file.

## Acceptance criteria covered by new tests

| Criterion | Spec / test |
| --- | --- |
| 3: an ended caller is idle on both ids | `chat-message-handler.service.spec.ts`: "chat:sessionEnded leaves both the tab id and the SDK id idle"; "clears awaiting-background on a rekeyed session"; "without a string sessionId marks nothing" |
| 4: kept lanes follow the successor (webview half) | `agent-monitor.store.spec.ts` `reparentAgents`: only listed lanes move, caller keeps the others, then `resolveParentSessionId` moves them to the successor's SDK id, and the lanes stay `running`; ownerless and unknown ids are not claimed; a SubagentRecord moves only when its `agentId` is listed. `agent-monitor-message-handler.service.spec.ts`: a valid payload reaches the store; 7 malformed shapes are dropped with a shape-only warning. |
| 6: chain shown in the expanded sidebar (docked, sheet, embedded); w-14 rail unchanged | `session-inspector.component.spec.ts` "linked sessions": `it.each(docked, sheet, embedded)` renders it between stats and agents with A from / B current / C in; rail neither renders nor loads; the chain shows even with no stats snapshot; an empty chain leaves the host out of the DOM; a malformed result leaves it out; collapsing to the rail releases the chain |
| 7: current marked; other entries open that session | molecule spec: current click does not emit, other clicks emit; inspector spec: an other-session click calls `SessionRowActionsService.openSession({id,name})`, a null label is passed as `''`, and the current row does not call it |
| Design states | molecule spec: heading/labelledby with no `uppercase`; chain of 3 relations, aria-current, bar, weights, accessible names; long label (truncate, min-w-0, title, full name, relation nowrap/shrink-0); missing name fallback `Session aaaaaaaa` with muted text and the row still a button; 7-row chain inside `max-h-[10.5rem] overflow-y-auto` with no "Show more"; open id absent means no row is current |
| Live reload and malformed RPC without Zod | `handoff-chain.client.spec.ts`: parser accepts and refuses (8 shapes); relation derivation; one RPC per retained id; malformed result, RPC error and thrown call give `[]`; a `sessionHandoff:linked` B→C reloads an inspector open on A; an unrelated link does not reload; a stale response is dropped; the last release drops the chain and ignores a late answer. `chat-message-handler.service.spec.ts`: the linked message routes to `onLinked`; 4 malformed shapes are dropped |

## Verification

Each run was one at a time, with output filtered (`grep -v "waiting for" | tail`).

- `npm run verify -- -p @ptah-extension/chat-ui` — exit 0. "3 tasks: 3 succeeded" (lint, test, typecheck). 0/3 cache hits, 4m 6s after a 206s lock and memory wait.
- `npm run verify -- -p @ptah-extension/chat` — exit 0. "3 tasks: 3 succeeded". 0/3 cache hits, 9m 9s.
- `npm run verify -- -p @ptah-extension/chat-streaming` — exit 0. "3 tasks: 3 succeeded". 0/3 cache hits, 2m 40s. I added this run because the plan places `AgentMonitorStore.reparentAgents` in chat-streaming.
- Nx hid per-task logs ("Re-run with --output-style=static"), so per-test Jest counts are not in the filtered output.
- `ptah_get_diagnostics` timed out on the chat files. On the chat-streaming store it listed pre-existing spec type errors (lines 315, 2051, 2332+). None are in the new code, and the project's typecheck target passed.
- Not run: build, serve and e2e (forbidden). Canvas specs stub the inspector (`InspectorStub`), so they do not touch the new injections. `webview-e2e-harness/.../plan-limits-visual.e2e.spec.ts` mounts the inspector and was not run. It may now need `ClaudeRpcService` to answer `session:handoffChain`, but `ClaudeRpcService` is root-provided in the harness app, so it should resolve.

## Notes for visual review (Electron)

- Where to look: the expanded inspector (docked aside, the canvas `embedded` expanded dock, and the compact `sheet`), between the SESSION stats and AGENTS.
- Data needed: a session with a handoff chain. Backend batches 2 and 3 must be live for `session:handoffChain` and `sessionHandoff:linked` to produce data.
- Compare with the prototype screenshots for: chain of 2 and 3, long chain (scrolls after 5 rows), long label truncation, missing-name fallback, focus ring (`outline-base-content`, not gold), and hover wash.
- On the `w-14` rail nothing new should appear. The canvas rail and the previous-sessions list must look unchanged. After a handoff the caller's dot should drop from Running or Waiting to idle once `chat:sessionEnded` arrives.
- The section has no entrance animation. It uses no stagger class (`st-r`), so it does not take part in the inspector's row entry stagger. That matches "no entrance travel" in the spec.

## Decisions

1. **The client is keyed by session with retain/release, not a single signal.**
   - Options: a single `entries` signal plus a generation counter (the plan's wording); a map keyed by session id with reference counts.
   - Evidence: `SessionInspectorComponent` can have several instances at once (canvas rail, embedded dock, sheet, and the chat view). A root singleton holding one signal would let one inspector overwrite another's chain. The ref count gives the cache a release path, as the runtime-cost rule requires. Each id still has its own generation counter.
   - Reversible: yes.
2. **`sessionHandoff:linked` also reloads a shown session whose loaded chain already contains either end.**
   - Options: reload only when the open id is `from` or `to` (the plan's wording); also reload when the open id's chain contains an end.
   - Evidence: criterion "A → B → C lists A, B, C on every session in the chain". An inspector open on A must pick up B→C. This is still one request per affected shown session, with no poll.
   - Reversible: yes.
3. **The chain key is `SessionInspectorModel.sessionId` (`tab.claudeSessionId`), read through `model()`.**
   - Options: look the tab up again; read the stats' `sessionId`; read the model.
   - Evidence: the model is already the inspector's session identity (`session-inspector.store.ts:273`). The stats snapshot can be null, but the chain must still show without it. Until the SDK id resolves, no request is sent.
   - Reversible: yes.
4. **Both liveness ids are marked through a de-duplicated `Set`.**
   - Evidence: when tab and SDK ids are equal, or already aliased, the result is a single `set`. `markIdle` on an id the registry does not know stores `idle`, which the plan accepts.
   - Reversible: yes.
5. **`describePayload` is duplicated in `agent-monitor-message-handler.service.ts` as a module function.**
   - Options: make `ChatMessageHandler.describePayload` public or shared; duplicate the five lines.
   - Evidence: in `ChatMessageHandler` it is a private static. Exporting it from there would make the agent-monitor handler depend on the chat handler. The plan asks for "`describePayload`-style shape only".
   - Reversible: yes. Extract it if a third caller appears.
6. **The `@if` for an empty chain lives in the parent.** The molecule always renders when mounted. "No host element" is enforced by `@if (linkedSessions().length > 0)`, as the plan says.

## Out-of-scope observations

- `webview-e2e-harness` plan-limits visual spec mounts the real inspector. It was not run under this batch's rules.
