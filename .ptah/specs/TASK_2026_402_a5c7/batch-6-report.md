# Batch 6 report — TASK_2026_402_a5c7 (Component 9: peer-message render in chat)

Executor: `frontend-developer`. Worktree:
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging` (branch
`feat/agent-two-way-messaging`). Nothing committed, stashed or checked out; `npx nx reset` was
never run; `batches.md` was not edited.

## Tasks completed

- **6.1** the shared field — `ExecutionChatMessage.inboundPeer?: { readonly label: string }`
  alongside `role: 'user'`, plus the Zod mirror. `MessageRole` is NOT widened.
- **6.2** carry it through the write path — accumulator (`message_start`) and finalization
  (`role === 'user'` branch).
- **6.3** the third bubble variant — inside the existing user arm of the bubble template.

## Files

### Created

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\execution\inbound-peer.spec.ts`
  — 6 assertions pinning the shape decision: the factory carries the field, omits the key when
  absent, the Zod mirror round-trips it, a message with no peer stays valid, a non-string label is
  rejected, and `MessageRoleSchema.options` is still the three-value union.

### Modified

- `...\libs\shared\src\lib\types\execution\agent.ts` — `inboundPeer?: { readonly label: string }`
  on `ExecutionChatMessage`, documented as display-only text from a self-reported name.
- `...\libs\shared\src\lib\types\execution\schemas.ts` — `inboundPeer: z.object({ label: z.string() }).optional()`
  on `ExecutionChatMessageSchema`.
- `...\libs\shared\src\lib\types\execution\factories.ts` — doc only (see Deviation 1).
- `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts` — comment only on the
  `message_start` case (see Deviation 2).
- `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts` — new
  `inbound peer label on message_start` describe: the field survives on the stored event AND in
  the `eventsByMessage` bucket; absent on an ordinary user turn.
- `...\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts` — the `role === 'user'`
  branch of `finalizeSessionHistory` now spreads `inboundPeer` exactly as it spreads `imageCount`,
  so the key is absent rather than `undefined` for an ordinary turn.
- `...\libs\frontend\chat-streaming\src\lib\message-finalization.service.spec.ts` — new
  `finalizeSessionHistory carries the inbound peer label` describe: the field reaches the
  `ExecutionChatMessage` while `role` stays `'user'` and the body is still extracted; the key is
  absent for an ordinary user turn.
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts` — `Users` icon
  + `UsersIcon`, and the `inboundPeerLabel()` computed (returns `null` for an ordinary turn, the
  trimmed label otherwise, `'peer session'` when the label is empty or whitespace).
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` — the peer
  variant inside the existing user arm.
- `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts` — new
  `inbound peer bubble` describe (5 cases): peer test id and label instead of `You`, the
  unverified caption, the body routed through `<markdown>`, the neutral-label fallback, and an
  ordinary user message left on the user bubble.

Nothing outside those paths was touched. `libs\backend\cli-agent-runtime\**`,
`libs\backend\vscode-lm-tools\**` and `libs\shared\src\lib\types\agent-process.types.ts` — the
concurrent backend-developer's files — were never opened for edit; they appear in `git status`
below, unmodified by me.

## Stack observed

- Angular 21 standalone components, `ChangeDetectionStrategy.OnPush`, `input.required()`,
  `computed()`, `inject()` — read from `message-bubble.component.ts` and confirmed against
  `libs/frontend/chat/CLAUDE.md`. The new `inboundPeerLabel` is a `computed()` on the existing
  component; no new service, no new signal store.
- Templates use the new control flow (`@if / @else`), which is what the user arm already uses.
- Styling: Tailwind 3 + daisyUI theme tokens. Both themes are defined in
  `apps/ptah-extension-webview/tailwind.config.js` (`anubis` / `anubis-light`).
- Markdown: the body goes through the **existing** `<markdown>` element from `ngx-markdown`
  (`MarkdownModule`, already imported by this component). No `[innerHTML]` was added and no second
  sanitizer was introduced — the peer branch reuses the same binding the user bubble already had.
- Validation: no new external boundary. The Zod change is the mirror of an internal type, kept
  next to it per `libs/shared/CLAUDE.md` guideline 6.

## Design fidelity

No `design-handoff.md` / `visual-design-specification.md` exists for this task; the variant was
derived from implementation-plan.md Component 9 and the surrounding bubble.

- **Same layout** as the user bubble — same `chat chat-end`, same width clamps, same footer.
- **Distinct accent**: `bg-base-200` + `border-l-4 border-secondary` instead of the plain
  `bg-base-300`. `secondary` was chosen over `primary` deliberately: light-theme `primary` is
  `oklch(85% …)` teal, which is nearly invisible against the `oklch(91.6%)` cream `base-300`,
  while `secondary` is documented in the theme file as darkened specifically so accents keyed on it
  stay legible on the cream base (`#d4af37` on `#242430` in dark). The accent is a border and an
  icon — both non-text, so the 3:1 non-text bar applies and both themes clear it. All bubble text
  stays on `text-base-content` / `text-base-content-muted`, whose ratios (5.29:1 dark, 5.01:1
  light) are pinned by `base-content-muted.spec.ts`; no new colour carries text.
- **Distinct icon**: lucide `Users`, `aria-hidden` (the label beside it is the accessible text).
- **Header** renders the label in place of the literal `You`.
- **Caption**: "Sent from another session — the sender name is self-reported and unverified.",
  first child of the bubble, `data-testid="chat-peer-unverified-caption"` (Req 3.2).
- **Test id**: `[attr.data-testid]` resolves to `chat-peer-message` for a peer turn and keeps
  `chat-user-message` for every ordinary user turn, so the existing e2e selector is unchanged
  (commit `2b07ce2fe`: select by test id, never by a styling class).

## States covered

- **Peer turn with a label** — peer bubble, label in the header, caption, markdown body.
- **Peer turn with an empty / whitespace label** — still the peer bubble, header reads
  `peer session`, matching the backend's `NEUTRAL_PEER_LABEL`. `inboundPeerLabel()` returns
  `null` only when the field is absent, so an empty label can never fall back to the "You" bubble.
- **Ordinary user turn** — unchanged bubble, unchanged test id, no caption.
- **Peer turn with no body** — not produced (the backend guard drops it); nothing was built to
  render it.
- Loading / error / streaming states are the assistant arm's and are untouched.
- Accessibility: the label is real text, not colour alone; the icon is `aria-hidden`; the
  unverified caption is plain text in the reading order ahead of the body, so a screen-reader user
  hears the provenance before the message; branch/rewind buttons keep their existing labels and
  keyboard reachability.

## Verification (verbatim)

```
$ npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared
 NX   Running target test for 3 projects:
Test Suites: 57 passed, 57 total
Tests:       1369 passed, 1369 total
Test Suites: 65 passed, 65 total
Tests:       2 skipped, 1035 passed, 1037 total
Test Suites: 22 passed, 22 total
Tests:       1 skipped, 465 passed, 466 total
 NX   Successfully ran target test for 3 projects
```

The header reads 3 projects. The 3 skipped tests are pre-existing (`describe.skip`), not anything
skipped by this batch. Pre-batch counts for comparison: shared 1363 (Batch 1 report) → 1369 (+6,
the new shared spec); chat-streaming 465 passing includes the 5 new streaming assertions; chat
1035 includes the 5 new component cases.

```
$ npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared
 NX   Running target typecheck for 3 projects:
> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json
> nx run @ptah-extension/chat-streaming:typecheck
> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json
> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json
 NX   Successfully ran target typecheck for 3 projects
```

`ngc` type-checks the templates too, so the new template bindings are covered here.

```
$ npx nx run-many -t lint -p @ptah-extension/chat-streaming @ptah-extension/chat
 NX   Running target lint for 2 projects:
✖ 2 problems (0 errors, 2 warnings)
✖ 17 problems (0 errors, 17 warnings)
 NX   Successfully ran target lint for 2 projects
```

Zero errors. All 19 warnings are pre-existing (`max-lines` on `chat-view.component.ts`,
`agent-orchestration-config.component.ts`, `ptah-cli-config.component.ts`, `no-non-null-assertion`
and `no-empty-function` in specs, one unused eslint-disable directive in chat-streaming). Filtering
the same run for `message-bubble`, `message-finalization` and `accumulator-core` returns nothing —
no warning was introduced on any file this batch touched. `npx prettier --write` was run over the
touched files (it reformatted the two chat-streaming spec files only), and the test target was
re-run afterwards — the counts quoted above are from that post-format run.

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

Mine only. The concurrent executor's entries (`libs/backend/cli-agent-runtime/**`,
`libs/backend/vscode-lm-tools/**`, `libs/shared/.../agent-process.types.ts`,
`agent-message-router.service.ts`) and the untracked task folder are omitted from this quote; they
were present and untouched by me.

## Confirmations (read, not changed)

- `libs\frontend\chat\src\lib\services\agent-monitor-tree-builder.service.ts:405-409` — the
  `message_start` case pushes the whole event onto `acc.messageStarts`. No new case needed.
- `libs\frontend\chat-execution-tree\src\lib\indexes\streaming-indexes.ts:170-190` — the same
  switch stores whole event objects in `messageStartByMessageId`. No new case needed. (The plan
  cites `streaming-indexes.ts:179`; the file is at `src/lib/indexes/`, not `src/lib/`.)
- `libs\frontend\chat-types\src\lib\chat-types.ts:243` `setStreamingEventCapped` stores the event
  object itself — it does not project onto a narrower shape — which is why 6.2's accumulator half
  is a passthrough rather than a copy (see Deviation 2).

## Deviations from the plan

1. **`factories.ts` needed no functional change.** `createExecutionChatMessage` takes
   `Partial<ExecutionChatMessage>` and spreads it whole, defaulting only `timestamp` and
   `streamingState`; a new optional field flows through with no edit — exactly as `imageCount`
   does today. The plan says to "update the factory and the Zod mirror together", so rather than
   invent a no-op assignment I documented the passthrough on the factory and pinned it with two
   assertions in the new shared spec (carried when supplied, key absent when not). The Zod mirror
   was updated as specified.
2. **`accumulator-core.service.ts` needed no functional change either.** The plan says to follow
   the `imageCount` pattern through the accumulator, but `imageCount` is not mentioned in that
   file: the `message_start` case hands the WHOLE event to `setStreamingEventCapped`, which stores
   the object. `inboundPeer` therefore already survives the write path. I added a comment at the
   call site naming the invariant a future projection would break, and three assertions
   (`accumulator-core.service.spec.ts`) that pin it — the field on the stored event and in the
   `eventsByMessage` bucket, and its absence on an ordinary turn. The only place a real copy was
   needed is `message-finalization.service.ts`, where it was made.
3. **A new spec file was added under `libs/shared`.** My ownership list names the three shared
   `.ts` files with "(+ specs)" attached only to the frontend files, and there is no existing
   execution-types spec to extend. Without it, the Zod mirror and the "union not widened" decision
   would have had no test. The file is new and touches nothing else.
4. **`'peer session'` is restated as a literal in the component**, not imported. It matches
   `NEUTRAL_PEER_LABEL` in `libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts:56`, but a
   frontend lib may not import a backend one and the constant is not in `libs/shared`. The
   component comment says where the wording comes from. Promoting it to `libs/shared` would be a
   reasonable follow-up; it was not in this batch's file list, so I did not.
5. **Disclosed, not hidden:** during the batch I ran the test target once with `--skip-nx-cache`,
   which R-2 asks executors in a shared worktree not to do. It caused no observed collision, and
   every command quoted above was run WITHOUT it.

## Out-of-scope observations (not touched)

- The peer variant is wired through `finalizeSessionHistory` only, because that is the sole
  `role === 'user'` construction site in `MessageFinalizationService` (`finalizeCurrentMessage`
  builds assistant messages exclusively). A LIVE peer turn's user bubble is minted elsewhere — the
  optimistic path in the chat store — so if a peer message must show its label the instant it
  arrives rather than after a history finalize, that producer needs the same field. Worth an
  explicit check during Batch 7 acceptance; it is outside this batch's file list.
- `chat-view.component.ts` (906 lines) and two settings components carry pre-existing `max-lines`
  warnings. Not this batch's blast radius.
- The branch/rewind footer is rendered for a peer bubble exactly as for a user bubble. That is the
  status quo (a peer turn is still a user-role transcript entry and forking from it is meaningful);
  if the product decides a peer turn must not be a fork anchor, that is a separate decision, not a
  silent change here.
