# Code Logic Review - 8o-3 (GAP-E) and 8o-5 (D21 UI hint)

Scope: uncommitted diff read in full for the listed files. No tests, builds or diagnostics were run (per instruction).

| Batch | Score | Verdict |
| --- | --- | --- |
| 8o-3 | 6.5/10 | NEEDS_REVISION (0 blocking, 2 serious, 3 moderate, 2 minor) |
| 8o-5 | 9/10 | APPROVED (0 blocking, 0 serious, 1 moderate, 1 minor) |

## 8o-3

### Checked and sound
- (2) `turnController` is per turn: re-created at turn start (`codex-runtime.ts:637`), aborted on terminal (`:547`) and on interrupt (`:816`). `askAsyncUserInput` captures the signal at event time, guards `activeTurn === event.turnId` (`:707`), and `deliverDenialFeedback` re-checks `activeTurn === turnId` and `terminalTurns` inside `serialize` (`:675`). An answer from turn N cannot steer turn N+1, and nothing calls `turn/start`.
- (1) Process death and stream loss still surface. The turn stream throws `runtime-failed` when the stream ends without a terminal (`codex-chat-turn-stream.ts:260-262`), and the runtime synthesizes a failed terminal on timeout or failure. `codexSubscriberOverflow` releases the subscriber, so it ends the same way. `turnError` is followed by a server `turn/completed(failed)`. `terminal` raises exactly one CHAT_ERROR (`codex-chat-events.ts:262`, `errorEmitted` latch). The spec checks the double terminal.
- (6) The warn calls log only `code` and `cause`. The runtime spec asserts the answer text is absent from the logs. `request.message` and the questions go only to the existing port.
- (3) `toolUseID` and `requestId` equal `itemId`. Codex item ids are unique per thread, and the bridge's own ids are JSON-RPC request ids, so I found no realistic collision.
- (5) The lane and gateway changes are one case label each. The lane maps to a text segment. The gateway reuses the `textFinal` prefix-diff, so there is no duplicate text.
- Degradation audit: `tools/degradation-audit` flags swallowed `catch` and `.catch` sites. The new `.catch` in `askAsyncUserInput` logs through `warnDenialFeedback`, so it is the existing pattern. The `case 'error': return []` is not a catch site.

### Findings

1. **Serious - `codexFollowUpRejected` is now silent in chat.** `codex-runtime.ts:301-309` emits a retryable `error` when Codex rejects a steered follow-up that the user sent (the approval-feedback or "stop and tell Codex" path). Before the change this raised CHAT_ERROR. Now `case 'error': return []` (`codex-chat-events.ts:257`) drops it, and the turn carries on as if the instruction was delivered. This is the one real mid-turn failure that has no terminal after it. Fix: in `CodexChatEvents`, still call `this.error()` for `error.code === 'codexFollowUpRejected'`. Alternatively log a warn through the callbacks. Add a spec case. The current spec loop at `codex-chat-events.spec.ts:~258` puts `codexFollowUpRejected` in the list that must not raise an error, which pins the regression.

2. **Serious - the question can disappear with no fallback.** The agentMessage delta is suppressed (`codex-event-translator.ts:137`), `userInputAsync` maps to `[]` in chat (`codex-chat-events.ts:168`), and the card only appears when `askAsyncUserInput` runs. It returns silently if `options.requestUserInput` is undefined, if state is not `running`, or if the turn id differs (`codex-runtime.ts:705-708`). It also does nothing for a non-`chat` consumer. In those cases the user sees neither the question nor any card, with no log. Fix: when the ask is skipped, log a warn with a code. Better, let the chat projection render `event.text` as text when no ask port is registered (for example a callback flag, or emit `textFinal` from the runtime instead).

3. **Moderate - product risk: the turn may end right after the async question.** The card is cancelled on terminal (by design), and the item markdown is hidden. If Codex ends the turn right after `request_user_input_async`, which is the usual shape for an "async" ask, the user gets a card that is aborted at once and no visible question. The code is correct to the stated spec, but the live tester should confirm that the turn stays open. If it does not, the answer path needs a new-turn fallback, and the cancelled-card case needs a visible text fallback (same fix as finding 2).

4. **Moderate - delta suppression depends on `item/started` carrying `delivery`.** `codex-event-translator.ts:195-197` adds to `asyncMessageItems` only on `item/started` with `delivery === 'async'`. If Codex sends `item/started` without it, or sends only `item/completed`, the deltas reach chat as visible text. Completion then emits `userInputAsync`, which chat ignores, so the question text is shown AND a card opens. Fix: also suppress deltas, or reconcile, when a completed item turns out to be async. A small spec case for started-without-delivery would pin the behaviour.

5. **Moderate - no de-duplication of `userInputAsync`.** A repeated `item/completed` for the same item id (a replay, or a resume that replays history) opens a second card with the same `requestId`/`toolUseID` and steers a second answer. The translator deletes the key on completion, so no state remains to detect it. Fix: keep a bounded per-turn set of answered item ids in `RuntimeContext`, cleared on terminal, and skip repeats.

6. **Minor - lost answers are only partly logged.** When the user dismisses the card or the answer map is empty, `if (!pairs.length) return;` (`codex-runtime.ts:~736`) is silent. A debug log with a code would help support. Free-text "Other" answers are fine because `answers[id]` is a single string.

7. **Minor - spec gaps.** There are no specs for the following:
   - an `item/started` without `delivery` (finding 4);
   - a duplicate completion (finding 5);
   - no `requestUserInput` port (finding 2);
   - several questions in one item. The mixed pair join, with quoting through `JSON.stringify`, differs slightly from Claude's `"q"="a"` form when a question contains a quote or newline. Say so in the report, or use a plain template.

### Five logic questions
1. Silent failure: finding 1 (a follow-up rejection is dropped) and finding 2 (the question is lost).
2. Unexpected user action: dismissing the card does nothing visible (finding 6). Answering after the turn ended logs a warn only, and the user is not told that their answer was not delivered.
3. Wrong answer from data: started-without-delivery duplicates the question text (finding 4).
4. Dependency failure: a rejected steer is logged as `refused` or `failed`, which is fine. The `ask` rejection is caught.
5. Missing: a fallback render of the question text, and idempotency per item.

## 8o-5

- `PTAH_UI_HINT` is byte-identical to HEAD. `git show HEAD` and the working copy were compared with `cat -A`: the shared sentence is the same up to `...never type them yourself.`, including the UTF-8 em dash, and the template concatenation adds ` Load the ptah-surface-authoring skill for grammar and examples.`.
- Every Claude use is unchanged. The only runtime consumer is `sdk-query-options-builder.ts:338` (`PTAH_UI_HINT`), and `sdk-query-options-builder.ptah-ui-hint.spec.ts` is untouched. The export lists in `index.ts` and `prompt-harness/index.ts` only add `PTAH_UI_HINT_CODEX`.
- Only `codex-chat-host-ports.ts` uses `PTAH_UI_HINT_CODEX`. The two Codex specs were updated, including the jest.mock of agent-sdk. No other spec mocks `PTAH_UI_HINT` for the Codex ports.
- M1 (Moderate): the Codex `developerPrompt` text changes, because the skill sentence is gone. If the resume path fingerprints `developerPrompt`, old Codex threads will see a different fingerprint at the next resume. Under the 8m/8n design this may cause a profile-mismatch rejection or a new thread config, or a harmless restart. Confirm what the resume path does with the fingerprint, and mention it in the report. I did not trace that code, so this is not verified as a defect.
- m1 (Minor): the doc comment references `{@link PTAH_UI_HINT}` and says Codex "must not use" it, but nothing enforces this. A lint or spec check that Codex ports never import `PTAH_UI_HINT` would stop a regression.

## Verdict
- 8o-3: NEEDS_REVISION. Fix findings 1 and 2 (and add the specs from 7). Findings 3 to 5 should be fixed or recorded with a decision.
- 8o-5: APPROVED. Record the resume fingerprint effect (M1).

## Re-review (8o-3 fix round)

Scope: "## Fix round" in batch-8o-3-report.md plus the current diff of the translator, runtime, types, chat-events and their specs. Nothing was run.

### Confirmed fixed
- Serious 1: `codex-chat-events.ts` `case 'error'` now calls the latched `this.error()` only for `codexFollowUpRejected`, so one CHAT_ERROR is raised and a later failed terminal adds none. Other mid-turn errors stay silent. The spec covers both.
- Serious 2: `codex-runtime.ts:567-575` emits `presentation: 'card'` only when `askAsyncUserInput` returns true (`:716`, which returns false for no port, state not `running`, turn mismatch, an aborted signal or a synchronous throw). Otherwise it emits `'text'` with a title fallback for empty text, and `codex-chat-events.ts:170-173` renders it through `textFinal`. A question can no longer vanish, and each fallback logs `codex-user-input-text-fallback`. Gateway and lane consumers take the unchanged `else this.emit(event)` branch and render text. A spec covers that.
- Moderate 4: the translator tracks `streamedMessageItems`. A late async marker after visible deltas gives `presentation: 'text'`, and the prefix-diff adds only the remainder, so card and duplicated text never appear together. If nothing was streamed, the result is a card only.
- Moderate 5: `asyncQuestionItems` (`codex-runtime.ts:562-566`) drops a repeated completion before the ask and before the emit. It is cleared on the active turn's terminal. A spec covers one request and one steer.
- Minor 6: a dismissed or empty answer logs `dismissed` and sends no steer. Minor 7: the listed specs were added.
- Card-only events: `codex-chat-events.ts:105` returns before `message_start`, so no empty assistant message opens, and a spec covers it. Claude's AskUserQuestion likewise opens none.
- The answer text is not logged.
- Moderate 3 is a live-test open item by decision.

### Remaining findings (none blocking)
- Minor R1: `codex-runtime.ts:~745` logs `dismissed` for an empty map even when the cause was a turn-end abort, because the user-question port returns `{}` when aborted. Check `signal.aborted` first and log `turn-ended`. This affects log accuracy only.
- Minor R2: a rejected follow-up raises CHAT_ERROR (`codex-chat-events.ts:257-259`) while the turn can still complete. The error latch then hides any later failure of that turn. This matches the required "exactly one" behaviour, so just keep it in mind for the live test.
- Minor R3: `codex-runtime.ts:567` dedups by `itemId` only per active turn, so a replay after the terminal is blocked only by `terminalTurns`. That is acceptable.

Verdict 8o-3: **APPROVED** (live-test open item: Moderate 3).
