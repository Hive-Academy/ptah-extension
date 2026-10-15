# Fix: composer send guard (PR #730, fix round 1)

Source: `codex-review-coderabbit-chat.md` findings 1 and 2. Builds on the previous fix
for comment 4277283912 (`coderabbit-fix-chat-report.md`): the rules for which tab and
which draft get cleared are unchanged.

Paths are relative to `libs/frontend/chat/src/lib/components/molecules/chat-input/`.

| Finding | Fix (file:line) | Test (spec:line) | Result |
| --- | --- | --- | --- |
| 1 Blocking: a rejected send clears the draft | `chat-input.component.ts:1514` keeps the `SendOutcome`. `:1524` returns before either clear when `!outcome.success`. | `chat-input.component.spec.ts:447-475` `it.each` covers both rejection paths: an unavailable slash command (`/context`, the dispatcher's `{success:false, error}`) and an unsuccessful sender outcome. Each one keeps the visible composer and the tab's stored draft, and a retry dispatches again. `:1288` replaces the old `clears the draft after a failed send` test with `keeps the draft after a failed send`. | pass |
| 2 Serious: two Send actions dispatch the same draft | `chat-input.component.ts:695-699` adds a per-instance `sendsInFlight` set of `{tabId, draft}`. `:1495-1506` returns early when the composer still holds the exact draft (text plus file and image list references, via `isSubmittedDraft`) that the same tab has in flight, and registers otherwise. `:1552-1553` releases the entry in `finally`. | `chat-input.component.spec.ts:388` covers two overlapping `handleSend` calls: one dispatch, the composer is cleared, and the next draft sends. `:417` covers an edited follow-up typed while the first send is pending: it still dispatches (the queued follow-up case). | pass |

## Decisions

- **The guard keys on the draft, not a single boolean.** A plain `sending` flag would
  silently drop two legitimate sends while the first one is pending. One is a follow-up
  the user edits and sends (`sendOrQueueMessage` queues it while the tab streams). The
  other is a draft sent from a different tab after the composer switches tabs (the
  canvas/tab composer is shared). Matching on `{sendingTabId, draft}` blocks only a
  re-submit of the unchanged draft, which is what a double click or Enter-then-click
  produces. A `Set` rather than a single field keeps overlapping distinct sends from
  overwriting each other's guard entry.
- **The guard sits after the session-start guard.** That ordering kept the diff
  minimal. A blocked double click can show the same composer error twice, but it never
  dispatches.
- **No `showComposerError` on failure.** `sendOrQueueMessage` is declared
  `Promise<SendOutcome>` (`chat.store.ts:261-266`, `message-dispatch.service.ts:151-154`).
  `SendOutcome` has an `error?` field (`message-sender.service.ts:64-66`). The dispatcher
  already shows the user a reason on both rejection paths. A blocked slash command gets
  a user bubble plus a provider warning (`message-dispatch.service.ts:155-160`, `:371`).
  An unsuccessful sender outcome gets a "Message delivery failed. <error>" transcript
  message (`:202-205`, `:332-344`). A second composer error would duplicate it. Other
  callers (`chat-agent-feedback-sender.service.ts:50-52`,
  `session-budget-actions.service.ts:192`) branch on `outcome.success` the same way.
- **`outcome.success` is read directly**, without `?.`, because the declared return
  type is non-nullable. A thrown error still goes to the existing `catch` and keeps the
  draft. The spec's default `sendOrQueueMessage` mock now resolves `{ success: true }`
  (spec:104). The two pending-promise tests from the previous fix now resolve a typed
  `SendOutcome` instead of `undefined`. The spec imports `SendOutcome` as a type
  (spec:68).
- **Conflict noted.** The existing spec test `clears the draft after a failed send`
  (added in `bb617ab6f`, streaming phase 5) pinned the behaviour the review rates
  Blocking. It now asserts the opposite, as the round-1 brief directs.
- Only `chat-input.component.ts` and its spec were changed. `libs/frontend/canvas` and
  the e2e specs were not touched.

## Checks

All checks were run through `node .ptah/tmp/check-run.mjs <label> -- ...`, one at a time:

- `npx nx test chat --testFile=chat-input.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  printed `Test Suites: 1 passed, 1 total` and `Tests: 84 passed, 84 total`, then
  `Successfully ran target test for project @ptah-extension/chat`.
- `npx nx typecheck chat --parallel=1 --skip-nx-cache` printed `Successfully ran target
  typecheck for project @ptah-extension/chat`, with no `error TS`.
- `npx nx lint chat --parallel=1 --skip-nx-cache` reported `0 errors, 51 warnings` and
  `Successfully ran target lint`. The warnings in the changed files were all there
  before this change. One is `max-lines` on `chat-input.component.ts`, which is already
  over the limit and is now about 20 lines longer. The other two are `no-explicit-any`
  at spec:493-494, the existing `restores attachments` test, whose line numbers shifted.
