# Implementation plan review — round 3

Verdict: REVISE

Score: 6/10. The identity rule and per-event byte cap now address the original unsafe fallback and escaped text. Two remaining steps can still leave the promised live tree duplicated or exceed the stated RPC response limit. This is above 5 because the round-one fidelity, cancellation, and serial-batch fixes remain specified; below 7 because both gaps affect central Phase B guarantees. No source was changed or executed.

## Round-two finding disposition

| Round-two finding | Result | Evidence |
| --- | --- | --- |
| 1 Serious — timestamp fallback aliases unrelated text-only messages | **Fixed for snapshot matching; completion cleanup still defective.** Plan 576–585 permits a snapshot match only by equal message id or shared tool id and keeps an unmatched text-only copy visible. The synthesized id is retained in `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:204-216`; stream text appends in `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:311-321`. Plan 602–615 adds later cleanup, but finding 1 below prevents it from working as written. |
| 2 Serious — escaped text defeats the 256 KB page cap | **Per-event fix, incomplete page fix.** Plan 440–458 measures serialized UTF-8 event bytes and clips to 96 KB; 459–470 advances even a one-event page, with escape-heavy fixtures at 490–495. The original converter emits raw block text at `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:531-542`. The single 96 KB event plus the stated <1 KB envelope stays below 256 KB. A full page can exceed the actual response budget because of finding 2 below. |
| 3 Moderate — all batches described as file-disjoint | **Fixed.** Plan 901–906 limits the file-disjoint claim to parallel-capable B1/B2/B3, and 922–938 gives serial ownership for recurring files. CLAUDE.md's one-heavy-check rule is repeated at plan 886–889 and 936–938. |

## New findings

| Severity | Plan and code evidence | Failure and required fix |
| --- | --- | --- |
| **Serious 1 — completion cleanup runs before its evidence exists** | Plan 602–615 triggers the alias when a `complete`-sourced `message_start` arrives and requires the full text/thinking content of that same message. The store processes events individually (plan 514–525). `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:354-363,413-430` emits `message_start`, then content deltas, then `message_complete`; `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:297-321` only puts text in the accumulator when a delta is processed. | At `message_start`, X has no accumulated complete text. A literal implementation fails the prefix/substring check and leaves the synthesized-id duplicate visible indefinitely, contrary to plan 674–675 and 1052–1055. Defer the check until X's `message_complete`, after all X deltas have been accumulated; retain S and the candidate X across those events, then rebuild once. Add a test that feeds the actual event order one event at a time. Also require a stream-to-complete identity signal or a strict same-context sequence guard before dropping S: matching text alone can describe two legitimately repeated messages. |
| **Serious 2 — page budget omits the correlation id present in the RPC envelope** | Plan 459–467 budgets and asserts `JSON.stringify({ success: true, data: result })` against 256 KB while claiming parity with `rpcOutputPageBytes`. The existing helper at `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:342-353` includes `correlationId: RPC_CORRELATION_ID_BUDGET`; its page code reserves and checks that full shape at 991–1005 and 1025–1027. | A multi-event page packed up to 256 KB by the proposed calculation can exceed 256 KB once the correlation id is added. The 96 KB per-event cap makes a one-event page safe but does not protect a full page. Budget and final-check the exact emitted response shape, including a conservative correlation-id reservation, and cut events with the cursor recomputed before return. Test a page whose event set nearly fills 256 KB. |

The same-text risk in finding 1 is a distinct data-loss boundary: `stream-event.transformer.ts:306-334` clears the active stream id at stream stop, while `assistant-message.transformer.ts:88,354-363` chooses the complete id independently. Plan A10 at 173–177 is an assumption to test, not an identity guarantee; a late complete for a different message with the same text would satisfy the substring condition and remove S. The fix must preserve both copies when identity remains uncertain.

## Round-one regressions and verification

- Historical thinking remains specified in content order at plan 425–439, with the mixed-block fixture at 483–489; the current converter still lacks that branch at `session-replay.service.ts:528-581`.
- The snapshot/live prefix fix remains at plan 569–601, with stable id/tool-id matching and retained live tail; the new late-alias defect above is the remaining text-only case.
- Oversized-event cursor progress and clipping remain at plan 440–470; the full-envelope defect above is the remaining byte-limit case.
- Optional `agentId`, correlation, and distinct `unresolved`/`not-found`/empty states remain at plan 400–424, 473–479, 558–568, and 641–649; the current record learns `agentId` only at `agent_start` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:531-545`).
- Retention and stale-load generation checks remain at plan 536–568 and have explicit abort cases at 660–667. The serial recurring-file handoff remains at 901–938. Seven DI guard specs and scoped commands remain at 1001–1020. Plan 1018–1020 matches CLAUDE.md's per-project Nx checks, `--parallel=1`, Jest `--maxWorkers=2`, and prohibition on build/serve/e2e/package; plan 886–889 and 936–938 enforce one heavy check at a time.

## Five logic questions

1. **Silent failure:** the duplicate can remain after an apparently successful history load because the cleanup reads X before its content arrives (plan 602–615; assistant transformer 426–430).
2. **User action:** opening saved output while a synthesized-id message streams can show two copies; the promised automatic cleanup may never occur (plan 581–585, 674–675).
3. **Wrong input:** two distinct same-text messages in one context can pass a content-only alias test and remove legitimate output (plan 605–612; stream transformer 330–334).
4. **Dependency failure or malformed shape:** a read/parse failure maps to a retryable error (plan 473–479, 641–649); a response wrapper with the normal correlation id can overrun the proposed page budget without an error (plan 461–467; `session-metadata-store.ts:342-353`).
5. **Unspecified requirement:** completion cleanup needs an explicit event-order point and an identity rule for equal-content distinct messages; the page cap needs the complete wire-envelope definition.

## Decisions

- **Verdict: REVISE.** Options: approve or revise. The two Serious findings above contradict Phase B's duplicate-free tree and 256 KB response promises. Reversible: yes, by revising the plan before implementation.
- **Do not infer identity from text alone.** Options: keep both copies until an SDK identity can be carried, or allow a content-only alias. Evidence: plan 605–612; independent complete id at `assistant-message.transformer.ts:88`; stream context reset at `stream-event.transformer.ts:330-334`. Recommend keeping both when identity is unproven. Reversible: yes.
- **Budget the emitted RPC shape.** Options: count only `{success,data}` or reserve and assert the wrapper including correlation id. Evidence: `session-metadata-store.ts:342-353,991-1005`. Recommend the latter. Reversible: yes.
- **P1–P4 and Clarifications 1–3 remain open user decisions.** Plan 814–825 and 1072–1085; this review selects none of their options.

Review scope: plan sections for Phase A/B, merge, paging, batches, risks and revision logs; task context; both earlier reviews; cited transformer, accumulator, replay, reader and byte-budget source. No tests, diagnostics/typecheck, lint, build, serve, e2e or git operations were run under the review instructions. The algorithms remain unimplemented, so runtime behavior cannot be observed here.
