# Code Logic Review — `TASK_2026_884_sdk_queue`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 2 |
| Moderate issues | 1 |
| Failure modes found | 5 |

The backend now owns ordinary follow-up delivery, including hidden tabs, but its Stop and identity contracts have gaps that can acknowledge text without delivering it. The score is below the 5–6 band because acknowledged text can disappear or run after Stop; it is above the 1–2 band because the normal Claude and Codex next-turn paths are implemented and guarded by focused specs.

## Five logic questions

### 1. How does this fail silently?

A reused `clientMessageId` returns success without queuing a new message: Claude returns early at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:357-363`; Codex returns `false` at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:44-45`, which its caller treats as a successful send at `codex-chat-adapter.ts:806-822`. The RPC then reports `admitted` when no held item exists (`libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts:115-122`).

### 2. What user action produces unexpected behaviour?

Pressing Stop while a queued `chat:continue` is still doing asynchronous preparation can leave a new item behind the Stop snapshot. Stop only withdraws currently listed entries (`chat-follow-up-queue.service.ts:176-198`), while the send binds and submits later (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1738-1858,1923-1931`). Codex Stop keeps the native session open (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-session-controls.ts:140-165`), so that late item can start a turn afterward.

### 3. What input data produces a wrong answer?

Reusing a UUID with different prompt or attachments is accepted as a duplicate without comparing payloads (`session-stream-pump.service.ts:357-363`; `codex-chat-peer-queue.ts:44-45`), contrary to the duplicate-conflict rule in the implementation plan.

### 4. What happens when a dependency fails?

If Codex `turn/steer` fails after the remote side accepts it, the catch maps every error to `TURN_CHANGED` and leaves the item queued (`codex-chat-adapter.ts:895-922`; `codex-chat-peer-queue.ts:80-91`). The next idle turn can send the same text again. A definitive remote receipt or reconciliation is needed before retrying an ambiguous steer.

### 5. What is missing that the requirements never mentioned?

The new queued RPC path needs full runtime parsing of the prompt and attachments. `ChatContinueParamsSchema` validates IDs and queue intent but passes other fields through (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:86-119`); `continueSession` passes `files` and `images` into the adapter (`chat-session.service.ts:1917-1931`). This violates the repository's Zod-at-boundaries invariant, even though the existing general chat schema had the same weakness.

## Failure modes

1. **Acknowledged duplicate is dropped.** Trigger: retry an ID after withdrawal or reuse it with different text. Symptom: success/admitted and potentially a bubble, with no provider turn. Evidence: `session-stream-pump.service.ts:357-363`, `codex-chat-peer-queue.ts:44-45`, `chat-follow-up-queue.service.ts:115-122`. Fix: store immutable ID/payload/terminal receipt per session; reject conflicting reuse and return the actual prior state.
2. **Stop misses an in-flight submission.** Trigger: Stop while `chat:continue` awaits account, resume, or context work. Symptom: queued text can run after Stop on Codex. Evidence: `chat-session.service.ts:1738-1858,1923-1931,2301-2307`, `codex-chat-session-controls.ts:140-165`. Fix: per-session Stop epoch or admission fence checked immediately before enqueue; serialize Stop against admission and return rejected text.
3. **Ambiguous steer can deliver twice.** Trigger: server accepts steer but response rejects or times out. Symptom: item stays queued and later runs as its own turn. Evidence: `codex-chat-adapter.ts:895-922`, `codex-chat-peer-queue.ts:80-91`. Fix: reconcile the remote turn state before retrying or mark uncertain and require explicit recovery.
4. **Malformed queued payload crosses RPC boundary.** Trigger: client sends wrong `files`, `images`, or prompt shape. Symptom: runtime adapter failures after other side effects or an unhelpful generic error. Evidence: `chat-rpc.schema.ts:86-119`, `chat-session.service.ts:1917-1931`. Fix: parse complete queued payload with bounded Zod schemas before any work.
5. **Queued item identity can outlive a tab reset in the renderer.** Trigger: reset a tab while a backend item is held. Symptom: the backend can still deliver into the old session while the renderer drops the item's visible view; `onTabClosed` drafts only locally held entries. Evidence: `libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts:476-485`, `:458-473`. Fix: retain old-session status/draft visibility or withdraw backend-held items before resetting.

## Blocking issues

### Duplicate UUID can be acknowledged as a new send without delivery

- File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:357-363`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:44-45`; `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts:115-122`.
- Scenario: A retry uses the same ID after a withdrawal, or reuses it for changed text. Both providers suppress it, while the RPC may say `admitted`.
- Impact: The user can see an accepted message that the agent never receives.
- Fix: Keep an ID-to-payload-and-state receipt and reject conflicting content; never infer admission merely from absence in the held list.

### Stop can miss a send that has not reached the provider queue

- File: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1738-1858,1923-1931,2301-2307`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-session-controls.ts:140-165`.
- Scenario: Stop's one-time withdrawal happens while another `chat:continue` awaits preparation. Codex retains the session after interruption, and the late send can enter its peer queue.
- Impact: A message runs after Stop despite the user expecting it withdrawn.
- Fix: Gate admission against a Stop generation and coordinate Stop with all pending submissions for that session.

## Serious issues

### An uncertain steer can be retried as a next turn

- File: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:895-922`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:80-91`.
- Scenario: `turn/steer` is accepted remotely but its response fails locally.
- Impact: The item remains queued and can be sent twice.
- Fix: distinguish definite refusal from uncertain completion and reconcile before letting the peer queue advance it.

### Queued chat input is not fully validated at RPC entry

- File: `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:86-119`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1917-1931`.
- Scenario: A malformed renderer or MCP caller supplies non-array attachments or an invalid prompt.
- Impact: Unvalidated data reaches side-effecting preparation and provider calls.
- Fix: Zod-parse prompt, files, images, and bounds before starting the drive.

## Moderate and minor issues

- **Reset loses status for a backend-held item:** `libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts:476-485,458-473`. Reset drafts only local `held` entries; backend-held entries disappear from the new view, and a later delivered bubble is deliberately suppressed by session mismatch. The item remains in the old session, so expose its outcome or withdraw it as part of reset.
- **Regression coverage:** `git diff --stat main...HEAD` shows 1,209 lines removed across the `session-budget-actions*`, `message-sender*`, and `auto-handoff*` specs. This count alone does not prove a missing assertion; the focused new queue specs exercise the new paths. Keep explicit coverage of the still-existing failed-send bubble, automatic handoff cancellation during submission, and old-session reset behavior when fixing the issues above.

## Data flow

1. Renderer captures tab, session, UUID and sends `queueIntent` immediately (`follow-up-queue.service.ts:128-162,366-408`) — OK for ordinary messages.
2. RPC validates IDs but passes queued content and attachments through (`chat-rpc.schema.ts:86-119`) — gap.
3. RPC prepares the session, then binds and sends (`chat-session.service.ts:1738-1858,1923-1931`) — Stop admission race.
4. Claude holds until `turnInFlight` clears (`session-stream-pump.service.ts:145-211`); Codex holds in peer FIFO (`codex-chat-peer-queue.ts:34-56,153-178`) — hidden-tab delivery is backend-driven.
5. Provider state broadcasts outside viewport suppression (`chat-follow-up-queue.service.ts:201-230`) — OK; receipt inference is incorrect for duplicate IDs (`:115-122`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Backend delivers ordinary follow-up after turn, hidden or shown | PARTIAL | Normal path exists; Stop race and duplicate receipt undermine guarantee. |
| Claude/Codex FIFO | PARTIAL | Queues are FIFO; duplicate IDs are silently suppressed. |
| Stop withdraws before interrupt | PARTIAL | Withdraws listed items, not concurrent admissions. |
| Codex Send now | PARTIAL | Expected turn checked, but uncertain steer can retry. |
| Local slash commands | COMPLETE | `follow-up-queue.service.ts:331-352,411-438` holds behind earlier items until idle. |
| Session replacement and teardown | PARTIAL | Claude token check exists (`session-stream-pump.service.ts:154-170`); renderer reset loses old-session visibility. |
| Validated RPC boundary | PARTIAL | IDs validated; queued payload left as passthrough. |

Implicit requirement: acknowledged and terminal receipts must remain distinguishable across retries and UI resets.

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Hidden ordinary follow-up | YES | Provider releases independently of viewport. |
| Hidden local slash command | YES | Renderer uses status-only idle test (`follow-up-queue.service.ts:513-522`). |
| Stop during pending preparation | NO | Late queue admission remains possible. |
| Reused UUID with conflicting payload | NO | Suppressed without comparison. |
| Uncertain steer response | NO | Kept for later next-turn send. |

## Decisions

- **Scope:** Applied `contract.md` over the older implementation plan; queued edit and restart recovery are explicitly out of scope. Evidence: `.ptah/specs/TASK_2026_884_sdk_queue/contract.md:3-6`. Reversible: yes.
- **Tests:** Did not run Nx, build, e2e, or verification commands as requested. `ptah_get_diagnostics` was attempted on changed backend files, but the TypeScript check remained running after 45 seconds and returned unavailable. Reversible: yes.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: A queued message can be acknowledged without delivery, or admitted after Stop.
- What a robust implementation would add: durable in-session ID receipts with payload comparison, a Stop admission fence, and steer outcome reconciliation.
