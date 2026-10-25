# Batch 10 implementation report

Implemented the empty-until-commit prompt primitive for P1-B.

## Files changed

- Created `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts` (104 lines, below the approximately 250-line limit).
- Created `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.spec.ts`.
- Added one export line to `libs/backend/agent-sdk/src/lib/helpers/index.ts`.
- Added one export line to `libs/backend/agent-sdk/src/index.ts`.
- Created this report. No other files were modified by this lane; the native `createPromptMailbox` reference was read only.

## Public API

`createNamedAccountPromptGate(signal?: AbortSignal): NamedAccountPromptGate`

- `prompt: AsyncIterable<SDKUserMessage>`: shared iterator, initially empty. Uses the existing type from `types/sdk-types/claude-sdk.types.ts`.
- `state: NamedAccountPromptGateState`: readonly `held | committed | closed`.
- `push(message: SDKUserMessage): boolean`: retains input only while held; otherwise returns false.
- `commit(): boolean`: one-shot admission of held input; returns false after commit or closure.
- `reject(): void`, `close(): void`: idempotently discard undelivered input and settle all pending readers with completion.
- Optional signal abort and iterator return close the gate. Natural exhaustion closes it and removes the signal listener.

The caller owns approval, persistence and binding. This primitive has no runtime bypass flag, identity checker, timer, DI registration or runtime wiring. Each follow-up admission requires a fresh instance; commit is never permission for future pushes. Committed messages are delivered once in FIFO order; after that this admission's iterable ends. Already delivered messages cannot be recalled.

## State diagram

```text
create -> held (empty)
held --push--> held (retained, invisible to readers)
held --commit--> committed (fixed admitted queue)
committed --next--> committed (one message delivered)
committed --next with empty queue--> closed
held/committed --reject / close / abort / iterator return--> closed
closed --next--> done
committed/closed --push or commit--> refused
```

Early readers wait while held. Closing clears the queue before waking readers. A close immediately after commit, before suspended readers resume, wins and drops the queue.

## Acceptance specs

1. Zero content before commit:
   - `starts empty and yields no held input before explicit commit`
   - `releases pre-commit input in FIFO order exactly once across readers`
   - `committing an empty gate finishes pending readers and cannot preapprove input`
2. Closure/abort before and after waiting, without hung waiters or double settlement:
   - `%s before reading drops held input and refuses late commit` (close/reject/abort)
   - `%s wakes every waiting reader exactly once without draining input` (close/reject/abort)
   - `starts closed when the signal is already aborted`
   - `iterator return wakes pending readers and removes the abort listener`
   - `natural exhaustion removes the abort listener`
3. Late commit refused: both parameterized closure specs, already-aborted signal spec and iterator-return spec assert refusal.
4. Queued content dropped:
   - Both parameterized closure specs above
   - `%s after commit drops all remaining queued content` (close/reject/abort)
   - `close wins over a commit whose waiting readers have not resumed`
5. Follow-up approval:
   - `refuses follow-up pushes and requires a fresh gate and admission`
   - `committing an empty gate finishes pending readers and cannot preapprove input`
6. Native mailbox untouched and no runtime wiring: changes are confined to the assigned new helper/spec, two export lines and this report. No runtime imports or registrations added.

## Decisions

- **One finite admission per gate.** Options: reopen the existing gate, add reusable approval tokens, or require a fresh gate. Chose a fresh gate because Batch 10 and implementation-plan line 185 explicitly require a single admission/lifecycle and fresh follow-up approval. Push and repeated commit return false once admitted. This is additive and reversible before runtime integration; Batches 17/20 must supply a fresh gate for each subsequent admission.
- **Custom shared iterator with waiter set.** Options: async generator or explicit iterator. The mailbox reference at `cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-prompt-mailbox.ts:22-69` establishes the async input style, but its draining queue and single notifier do not meet failure closure. An explicit iterator lets return close immediately while next calls are pending, clears retained content before wakeup, and settles concurrent reads without polling. Internal implementation is reversible without changing the API.
- **Existing SDK message type and caller-provided messages.** The existing factory reexports `SDKUserMessage` from `types/sdk-types/claude-sdk.types.ts`; this helper imports that type directly and preserves messages without reconstructing conversation metadata. No alternate message schema or mocked SDK dependency is introduced. Specs use the existing Jest globals and `jest.fn`/`jest.spyOn` conventions seen in adjacent helper specs.

## Verification and remaining work

- `ptah_get_diagnostics` scoped to all four changed TypeScript files returned source `typescript-compiler`, clean coverage, zero errors and zero warnings, including no sibling diagnostics.
- No nx, jest, tsc, lint, build or Git commands were run. Specs are authored but not executed; CI must run them.
- Runtime integration is intentionally outside this batch and belongs to Batches 17/20. No other implementation work remains within this batch.
