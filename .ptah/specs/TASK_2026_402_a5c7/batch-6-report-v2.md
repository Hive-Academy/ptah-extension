# Batch 6 report (v2 — restoration) — TASK_2026_402_a5c7 (Component 9: peer-message render in chat)

Executor: `frontend-developer`. Worktree:
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging` (branch `feat/agent-two-way-messaging`,
HEAD `f2ca3f1db`). Nothing committed, stashed or checked out; `npx nx reset` was never run;
`batches.md` was not edited; `batch-6-report.md` was not edited.

This is a re-implementation. The original Batch 6 was completed and lost before it was committed;
`batch-6-report.md` survived and was treated as the specification. Every claim in it was re-verified
against the current source rather than assumed. Drift is itemised under **What had moved** below.

## Tasks completed

- **6.1** the shared field — `ExecutionChatMessage.inboundPeer?: { readonly label: string }`
  alongside `role: 'user'`, plus the Zod mirror. `MessageRole` is NOT widened.
- **6.2** carry it through the write path — accumulator (`message_start`) and finalization
  (`role === 'user'` branch of `finalizeSessionHistory`).
- **6.3** the third bubble variant — inside the existing user arm of the bubble template.

## Files

### Created

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\execution\inbound-peer.spec.ts`
  — 6 assertions pinning the shape decision: the factory carries the field, omits the key when
  absent, the Zod mirror round-trips it, a message with no peer stays valid, a non-string label is
  rejected, and `MessageRoleSchema.options` is still the three-value union.

### Modified

- `...\libs\shared\src\lib\types\execution\agent.ts` — `inboundPeer?: { readonly label: string }`
  on `ExecutionChatMessage`, documented as display-only text from a self-reported name, explicitly
  not a verified identity.
- `...\libs\shared\src\lib\types\execution\schemas.ts` —
  `inboundPeer: z.object({ label: z.string() }).optional()` on `ExecutionChatMessageSchema`.
- `...\libs\shared\src\lib\types\execution\factories.ts` — doc only (Deviation 1).
- `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts` — comment only at the
  `setStreamingEventCapped` call in the `message_start` case (Deviation 2).
- `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts` — new
  `inbound peer label on message_start` describe (3 cases): the field survives on the stored event
  AND in the `eventsByMessage` bucket; absent on an ordinary user turn.
- `...\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts` — the `role === 'user'`
  branch of `finalizeSessionHistory` now spreads `inboundPeer` exactly as it spreads `imageCount`,
  so the key is ABSENT rather than `undefined` for an ordinary turn.
- `...\libs\frontend\chat-streaming\src\lib\message-finalization.service.spec.ts` — new
  `finalizeSessionHistory carries the inbound peer label` describe (2 cases): the field reaches the
  `ExecutionChatMessage` while `role` stays `'user'` and the body is still extracted; key absent for
  an ordinary user turn.
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts` — `Users` icon +
  `UsersIcon`, and the `inboundPeerLabel()` computed (`null` for an ordinary turn, the trimmed label
  otherwise, `'peer session'` when the label is empty or whitespace).
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` — the peer
  variant inside the existing user arm.
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts` — new
  `inbound peer bubble` describe (5 cases): peer test id and label instead of `You`, the unverified
  caption, the body routed through `<markdown>`, the neutral-label fallback, and an ordinary user
  message left on the user bubble.

Nothing outside those paths was touched — `git status --short` lists exactly the ten modified files
and the one new spec.

## What had moved since the original report

Everything the original report specified still existed; nothing was contradicted. What changed:

1. **Line anchors in the plan and in the original report are stale.** The finalization `role ===
   'user'` branch that the plan cites at `message-finalization.service.ts:266-280` is now at
   `:337-356`, and the accumulator's `message_start` case is at `:246`, not `:245`. Both were
   located by content (`imageCount` spread; `switch (event.eventType)`), not by line. The template
   anchors did still match: `You` at `:199`, `data-testid="chat-user-message"` at `:205`.
2. **Batch 1's `MessageStartEvent.inboundPeer` is present** at
   `libs\shared\src\lib\types\execution\stream.ts:112`, and Batch 3's backend work has since landed
   too (`sdk-message-transformer.ts:57` `NEUTRAL_PEER_LABEL`, `user-message.transformer.ts:134`
   spreading `inboundPeer`). So 6.2 had a real producer to read from, and the neutral label the
   component restates is confirmed still to be the string `'peer session'`.
3. **The worktree is now clean.** The original run shared the tree with a concurrent
   backend-developer and had to quote around their `git status` entries. Their work is committed;
   this run's `git status` is mine alone.
4. **Test counts have grown substantially** since the original report, because Batches 2-5 landed
   in between. Original: shared 1369, chat-streaming 466, chat 1037 total. Now: shared 1381,
   chat-streaming 485, chat 1118. The counts are therefore NOT comparable to the historical report;
   what is comparable is that all three projects are green and the 3 skipped tests are the same
   pre-existing `describe.skip`s.
5. **The chat spec file grew.** `message-bubble.component.spec.ts` is unchanged in structure (same
   `setMessage` helper, same `ngx-markdown` jest mock) but the new describe is appended after the
   session-active rewind test, which did not exist in the ordering the original report implies.
6. **One assertion was tightened relative to the original description.** The original report says
   the peer case asserts "peer test id and label instead of `You`". Asserting `not.toContain('You')`
   on the whole fixture is fragile (button titles and aria-labels are not textContent today, but
   they could be). The assertion is scoped to `.chat-header`, which is the element the requirement
   is actually about.

## Stack observed

- Angular 21 standalone, `ChangeDetectionStrategy.OnPush`, `input.required()`, `computed()`,
  `inject()` — read from `message-bubble.component.ts`, confirmed against `libs/frontend/chat/CLAUDE.md`.
  `inboundPeerLabel` is a `computed()` on the existing component; no new service, no new signal store.
- Templates use the new control flow (`@if / @else`) — what the user arm already uses.
- Styling: Tailwind 3 + daisyUI theme tokens (`apps/ptah-extension-webview/tailwind.config.js`,
  themes `anubis` / `anubis-light`).
- Markdown: the body goes through the **existing** `<markdown>` element from `ngx-markdown`
  (`MarkdownModule`, already imported by this component). No `[innerHTML]` added, no second
  sanitizer introduced — the peer branch reuses the binding the user bubble already had.
- Validation: no new external boundary. The Zod change mirrors an internal type and sits next to it,
  per `libs/shared/CLAUDE.md` guideline 6.

## Design fidelity

No `design-handoff.md` / `visual-design-specification.md` exists for this task; the variant follows
implementation-plan.md Component 9 and the surrounding bubble, and reproduces the original report's
recorded choices.

- **Same layout** as the user bubble — same `chat chat-end`, same width clamps, same footer.
- **Distinct accent**: `bg-base-200` + `border-l-4 border-secondary` instead of the plain
  `bg-base-300`. `secondary` over `primary` deliberately: light-theme `primary` is `oklch(85% …)`
  teal, nearly invisible against the `oklch(91.6%)` cream `base-300`, while `secondary` is darkened
  in the theme file precisely so accents keyed on it stay legible on the cream base. The accent is a
  border and an icon — both non-text, so the 3:1 non-text bar applies and both themes clear it. All
  bubble text stays on `text-base-content` / `text-base-content-muted`; no new colour carries text.
- **Distinct icon**: lucide `Users`, `aria-hidden` (the label beside it is the accessible text).
- **Header** renders the label in place of the literal `You`, inside `data-testid="chat-peer-label"`.
- **Caption**: "Sent from another session — the sender name is self-reported and unverified.", first
  child of the bubble, `data-testid="chat-peer-unverified-caption"` (Req 3.2).
- **Test id**: `[attr.data-testid]` resolves to `chat-peer-message` for a peer turn and keeps
  `chat-user-message` for every ordinary user turn, so the existing e2e selector is unchanged
  (commit `2b07ce2fe`: select by test id, never by a styling class).

## States covered

- **Peer turn with a label** — peer bubble, label in the header, caption, markdown body.
- **Peer turn with an empty / whitespace label** — still the peer bubble, header reads
  `peer session`, matching the backend's `NEUTRAL_PEER_LABEL`. `inboundPeerLabel()` returns `null`
  only when the field is ABSENT, so an empty label can never fall back to the "You" bubble
  (Req 3.3).
- **Ordinary user turn** — unchanged bubble, unchanged test id, no caption.
- **Peer turn with no body** — not produced (the backend guard drops it); nothing built to render it.
- Loading / error / streaming states belong to the assistant arm and are untouched.
- Accessibility: the label is real text, not colour alone; the icon is `aria-hidden`; the unverified
  caption is plain text ahead of the body in reading order, so a screen-reader user hears the
  provenance before the message; branch/rewind buttons keep their existing labels and keyboard
  reachability.

## Verification (verbatim, exit codes read directly — no pipes)

```
$ npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/chat-streaming @ptah-extension/chat --parallel=1
EXIT=0
 NX   Running target test for 3 projects:
- @ptah-extension/shared
- @ptah-extension/chat-streaming
- @ptah-extension/chat

Test Suites: 57 passed, 57 total
Tests:       1381 passed, 1381 total          (shared)
Test Suites: 22 passed, 22 total
Tests:       1 skipped, 484 passed, 485 total (chat-streaming)
Test Suites: 69 passed, 69 total
Tests:       2 skipped, 1116 passed, 1118 total (chat)
 NX   Successfully ran target test for 3 projects
```

The header reads **3 projects** and names all three. The 3 skipped tests are pre-existing
`describe.skip`s, not anything skipped by this batch. One `A worker process has failed to exit
gracefully` notice appeared after the shared suite; it is a teardown warning, not a failure — the
suite reported 1381/1381 passed and the target exited 0.

```
$ npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/chat-streaming @ptah-extension/chat --parallel=1
EXIT=0
 NX   Running target typecheck for 3 projects:
 NX   Successfully ran target typecheck for 3 projects
```

`ngc` type-checks templates, so the new template bindings are covered here.

```
$ npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/chat-streaming @ptah-extension/chat --parallel=1
EXIT=0
 NX   Running target lint for 3 projects:
✖ 2 problems (0 errors, 2 warnings)    (shared)
✖ 2 problems (0 errors, 2 warnings)    (chat-streaming)
✖ 18 problems (0 errors, 18 warnings)  (chat)
 NX   Successfully ran target lint for 3 projects
```

Zero errors. Filtering the lint output for `message-bubble`, `message-finalization`,
`accumulator-core`, `inbound-peer` and `execution/{agent,schemas,factories}` returns **nothing** — no
warning exists on any file this batch touched. The 22 warnings are pre-existing `max-lines`,
`no-non-null-assertion`, `no-empty-function`, two unused-var warnings and one unused eslint-disable
directive, all on files outside this batch.

`npx prettier --write` was run over the eleven touched files (it reformatted the two spec files
only) BEFORE the runs quoted above.

`nx test ptah-cli` was NOT run: it cannot run in this worktree (TASK_2026_427_f669 —
`scripts/copy-wasm.js` resolves `node_modules` against the worktree root, which has none). It does
not cover any project this batch touches. No raw `jest` fallback was attempted at any point.

```
$ git status --short
 M libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts
 M libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts
 M libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts
 M libs/frontend/chat-streaming/src/lib/message-finalization.service.ts
 M libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html
 M libs/frontend/chat/src/lib/components/organisms/message-bubble.component.spec.ts
 M libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts
 M libs/shared/src/lib/types/execution/agent.ts
 M libs/shared/src/lib/types/execution/factories.ts
 M libs/shared/src/lib/types/execution/schemas.ts
?? libs/shared/src/lib/types/execution/inbound-peer.spec.ts
```

Nothing is committed. The work is left in the tree.

## Confirmations (read, not changed)

- `libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts` — the `message_start`
  case pushes the whole event onto `acc.messageStarts`. No new case needed.
- `libs\frontend\chat-execution-tree\src\lib\indexes\streaming-indexes.ts` — the same switch stores
  whole event objects in `messageStartByMessageId`. No new case needed. (The plan cites
  `streaming-indexes.ts:179`; the file is under `src/lib/indexes/`, not `src/lib/`.)
- `setStreamingEventCapped` stores the event object itself and does not project it onto a narrower
  shape — which is why 6.2's accumulator half is a passthrough rather than a copy (Deviation 2).

## Deviations from the plan

Deviations 1-4 are the original executor's, independently re-verified and reproduced. Deviation 5 in
the original report (a `--skip-nx-cache` run) does not apply here; no such run was made.

1. **`factories.ts` needed no functional change.** `createExecutionChatMessage` takes
   `Partial<ExecutionChatMessage>` and spreads it whole, defaulting only `timestamp` and
   `streamingState`; a new optional field flows through with no edit — exactly as `imageCount` does.
   Rather than invent a no-op assignment, the passthrough is documented on the factory and pinned by
   two assertions in the new shared spec (carried when supplied, key absent when not). The Zod mirror
   was updated as specified.
2. **`accumulator-core.service.ts` needed no functional change either.** The plan says to follow the
   `imageCount` pattern through the accumulator, but `imageCount` is not mentioned in that file: the
   `message_start` case hands the WHOLE event to `setStreamingEventCapped`, which stores the object.
   `inboundPeer` therefore already survives the write path. A comment at the call site names the
   invariant a future projection would break, and three assertions pin it. The only place a real copy
   was needed is `message-finalization.service.ts`, where it was made.
3. **A new spec file was added under `libs/shared`.** The batch's ownership list attaches "(+ specs)"
   only to the frontend files, and there is no existing execution-types spec to extend. Without it
   the Zod mirror and the "union not widened" decision would have had no test. The file is new and
   touches nothing else.
4. **`'peer session'` is restated as a literal in the component**, not imported. It matches
   `NEUTRAL_PEER_LABEL` (`libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts:57` — the line
   moved from `:56`), but a frontend lib may not import a backend one and the constant is not in
   `libs/shared`. The component comment records where the wording comes from. Promoting it to
   `libs/shared` is a reasonable follow-up; it is not in this batch's file list.

## Out-of-scope observations (not touched)

- The peer variant is wired through `finalizeSessionHistory` only, because that is the sole
  `role === 'user'` construction site in `MessageFinalizationService` (`finalizeCurrentMessage`
  builds assistant messages exclusively). A LIVE peer turn's user bubble is minted elsewhere — the
  optimistic path in the chat store — so if a peer message must show its label the instant it arrives
  rather than after a history finalize, that producer needs the same field. Worth an explicit check
  during Batch 7 acceptance; outside this batch's file list.
- Pre-existing `max-lines` warnings on `chat-view.component.ts` and several settings/spec files. Not
  this batch's blast radius.
- The branch/rewind footer renders for a peer bubble exactly as for a user bubble. That is the status
  quo (a peer turn is still a user-role transcript entry and forking from it is meaningful); if the
  product decides a peer turn must not be a fork anchor, that is a separate decision, not a silent
  change here.
