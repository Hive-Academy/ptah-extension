# Code Logic Review (backend core) - TASK_2026_LANE_CONTROL

Review family: claude (in-process subagent, reason above); Implementer families: codex (kimi-code partial Batch 1-2)

Reviewed: commit 6843d5d15 on feat/lane-control-model (committed state only; uncommitted codex edits ignored).
Method: static read of the scoped files and diffs; no builds, tests or git state changes were run.

Score: 5.5/10
Verdict: REVISE

Counts: blocking 0, major 9, minor 14.

The planner, the refusal-before-interrupt gate, fail-closed spawn policy, byte-identical default args and the
metadata-only persistence are sound. The defects cluster in the coordinator's receipt lifecycle, in the
parent-delivery wiring, and in the A7 classification. These are the paths where the happy-path specs pass
because they mock the seams that fail in production.

## Defects

### Major

1. Cold-resume receipts never settle (receipt stuck at `started`).
   - `messaging/agent-message-coordinator.service.ts:69-71` registers the receipt under `spawned.agentId` (a new
     agent, because `AgentProcessManager.spawn` always calls `AgentId.create()`, manager `:867`).
   - `onTurnSettled` (`:144-152`) then calls `receipts.get(info.agentId, id)` with the NEW agent id. The receipt
     is stored under the ORIGINAL agent id, so `AgentDeliveryReceiptStore.get`
     (`agent-delivery-receipt-store.service.ts:98-104`) fails its `found.agentId === agentId` check and returns a
     synthetic `expired` receipt. `current.state !== 'started'` is then true, so the loop `continue`s forever.
   - Result: the default Send on a released or stopped lane (the plan's "Resume fallback", rule 3) ends with a
     receipt that reads "Sending" indefinitely, and the renderer/MCP caller never sees `settled` or a
     `turnOutcome`. The spec at `agent-message-coordinator.service.spec.ts:107` mocks `resume()` and only
     asserts the id is kept.
   - Fix: record the replacement agent id on the receipt (the plan allows detail metadata), or key the
     `started` map by original agent id and look the receipt up by id only for settlement. Also bind the real
     `turnSeq` instead of the hardcoded `1` at `:70`. Add a spec that emits `agent:turn-settled` for the
     spawned agent id.

2. Parent envelopes for an unresolved parent (tab id) are never created, so "drain on session-id resolution" is
   dead code.
   - `agent-report-router.service.ts:308-315` and `lane-completion-notifier.service.ts:404-411` return
     `no-parent-recorded` when `SessionId.safeParse(info.parentSessionId)` fails, before any `enqueue`.
   - `ParentEnvelopeStoreService.resolveParentSessionId` (`parent-envelope-store.service.ts:36-42`), the drainer
     hook (`parent-delivery-drainer.service.ts:78-81`) and the manager call (`agent-process-manager.service.ts:2102`)
     only act on envelopes whose `parentSessionId` equals a tab id. No production path can create one. The drainer
     spec (`parent-delivery-drainer.service.spec.ts:11`) enqueues a tab-id envelope directly, which hides the gap.
   - A lane that finishes before the parent's tab resolves still gets a refused, non-recoverable completion
     (A2 and the "Parent inactive" row are met only for an already-resolved but inactive parent).
   - Fix: enqueue under the raw tab id when `parentSessionId` is a non-empty non-session string. Let the
     drainer's `SessionId.safeParse` guard keep it pending, and rewrite it on `resolveParentSessionId`. Add an
     integration test: notifier.signal with a tab id, then `resolveParentSessionId`, then a delivery.

3. A7 classification over-matches and now runs on successful exits.
   - `agent-process-manager.service.ts:2976-2987`: for `code === 0` the new code scans current-turn `error`
     segments with `/\b(?:HTTP\s*)?(?:402|429)\b|\bquota\b|usage balance exhausted|RESOURCE_EXHAUSTED/i`. For
     failed exits it scans the 16 KB stdout tail with the same regex.
   - `\b429\b` matches any line number or port (`foo.ts:429`, `(429,5)`). `\bquota\b` matches any tool error that
     mentions quota. This repo's lanes work on plan-limit and quota code.
   - A successful lane with such a tool error gets `stopReason: 'usage-limit'`. The notifier
     (`lane-completion-notifier.service.ts:746`) then forces verdict `failed` and the envelope gets `stop-reason`.
   - `classifyLaneFailure` is also now called for `code === 0` (`:2977`). When it matches, `recordLaneLimits`
     (`:3020`, body `~3163-3222`) records quota exhaustion evidence on the owner and skips `recordSuccess`. A
     healthy plan can then show "AT LIMIT" in `ptah_agent_list`.
   - `tracked.authMatched = authMatched` (`:3015`) is now set on completed lanes (it was `false`). It flows to
     lane outcome `authMatched` (`:3303`).
   - Fix: restrict the extra regex to anchored wordings (`HTTP 429`, `status 429`, `rate limit`, `usage limit`,
     provider phrases) that `classifyLaneLimit` / `matchesApiRateLimit` already use. Do not run
     `recordLaneLimits(limit)` for an exit-0 turn unless the match is a provider-specific quota wording. Keep
     `authMatched=false` for completed lanes unless the lane really stopped. Add negative tests (exit 0, error
     text "src/foo.ts:429").

4. Fire-and-forget async paths can raise unhandled rejections (host or cli-engine crash risk).
   - `agent-message-coordinator.service.ts:29-31`: `void this.onTurnStarted/onTurnSettled/onQueueUpdated(...)`
     have no `.catch`. These call `receipts.transition`, which can reject on `storage.update` failure, or throw
     the invariant errors at `agent-delivery-receipt-store.service.ts:87-90`. `onQueueUpdated` also calls
     `AgentId.from(agentId)` (`:159`), which throws on a non-uuid id.
   - `agent-delivery-receipt-store.service.ts:46`: `this.ready = this.restore()` is never observed at
     construction. If `restore()` rejects (its `persist()` at `:67`), `ready` is a permanently rejected promise.
     Every later `accept`/`transition`/`get` rejects, so ALL messaging is dead until restart.
   - `sink.changed(next)` (`:94`, `:77`) runs synchronously. The Electron sink resolves the container
     (`agent-events.ts` receipt sink) and can throw into the transition after state was already committed.
   - Fix: wrap each event handler in try/catch with the injected Logger (error name only). Make `restore()`
     catch and log, then continue with an empty map. Wrap `sink.changed` in try/catch. Iterate with per-item
     catch so one failed receipt does not abort the rest.

5. A persistence failure turns a delivered message into a thrown error or a false `failed`.
   - `agent-delivery-receipt-store.service.ts:76` (`accept`) awaits `persist()` and throws before the try in
     `send()` (`coordinator:65`). A full disk or lock failure rejects Send entirely with an uncoded plain Error,
     although persistence only exists to mark receipts failed after a restart (A1).
   - After a successful `sendToAgent`, a `persist()` failure inside `transition(started)` (`coordinator:88`) lands
     in the catch (`:91-99`). The catch tries `transition(failed)`, which persists again and throws out of
     `send()`. If persistence recovered, the receipt is marked `failed` although the lane did receive the message.
   - Fix: make persistence best-effort (log and keep the in-memory transition). Never convert a post-delivery
     bookkeeping error into `failed`.

6. "Send now" interrupt-resume races with the queue flush, so the consented message is lost.
   - `agent-message-router.service.ts:238-246` waits for the interrupted turn to settle. The manager's
     `handleExit` then synchronously starts `flushPending` (`agent-process-manager.service.ts:3061-3066`), whose
     `continueConversation` flips status back to `running` before its first await.
   - If a Send-queued message exists (now the default flow), the interrupt path's own `continueConversation`
     throws `busy`. That becomes `AgentInterruptedDeliveryError`, so the Send-now receipt reads
     `interrupted-undelivered`/`partialTurnLost` even though the older queued message started instead.
   - The user loses partial work and the intended message is not delivered ahead of the queue.
   - Fix: before `interrupt()`, hold the flush for that agent (a per-agent "interrupting" guard checked by
     `flushPending`), then deliver the Send-now message first. Add a spec: queue one, then Send-now on an
     interrupt-only handle.

7. Cancel can mark a delivered or in-flight message `cancelled-by-user`.
   - `agent-message-coordinator.service.ts:107-116`: the `accepted` check happens before `await`/splice. If
     the message was already `shift()`-ed by `flushPending` (in flight, `router.inFlight`), `index` is `-1`,
     nothing is removed, and the code still transitions to `failed` with reason `cancelled-by-user`. The message
     then starts a turn.
   - `transition` allows `started` to `failed`, so a `started` receipt can also be flipped by the same race.
   - Fix: only transition when the splice actually removed the entry. Otherwise re-read the receipt and throw
     "no longer cancellable". Never override a started receipt.

8. Raw error text is persisted, pushed to the renderer and returned to MCP callers, and the account refusal path
   is dead.
   - `agent-message-coordinator.service.ts:97` sets `reason: error.message`. The router builds details from
     `describeError` (`agent-message-router.service.ts:185, 232, 244, 299`), which can contain adapter or fs
     text (paths, tokens in CLI errors). The receipt `reason` is persisted
     (`agent-delivery-receipt-store.service.ts:121-123`), broadcast through the push sink and returned by RPC/MCP.
     This breaks the repository rule from `file-settings-errors.ts` (fixed text, no paths or secrets).
   - `agent-rpc.handlers.ts:1565-1567`: `agent:continue` returns `outcome.detail` as the user-facing `error`.
     The catch at `:1582-1596` (`laneAccountRefusalCode` / `account_refused`) can no longer fire, because
     `coordinator.send` swallows `LaneAccountResumeError` and `AgentContinueError` into `unsupported`. The
     structured codes `not_found`, `account_refused` and `unknown` are lost, and callers keyed on `code` get
     `unknown`.
   - Fix: map known error classes to fixed reason codes and text at the coordinator. Persist the code only.
     Keep `LaneAccountResumeError` distinguishable and return `account_refused` from the RPC.

9. Parent drain has a lost wake-up, so a completion can stay pending after the parent goes idle.
   - `parent-delivery-drainer.service.ts:69-76`: `drain()` returns the existing in-flight promise. `drainOnce`
     takes its `pending` snapshot once (`:89`). An envelope enqueued, or an activity event fired, while a drain is
     in flight is not picked up.
   - `enqueue()` (`:62`) and the activity callback (`:40`) both go through the same guard. The notifier then
     awaits the old drain, sees `pending`, and returns `pending: true`. Nothing re-triggers until the next parent
     activity, which may never come.
   - Fix: after `drainOnce` finishes, loop once more if a dirty flag was set during the run (no recursion).
     Re-read `pending()` after each send.

### Minor

10. `started` registration happens after an awaited persist, so a fast settle is missed.
    - `agent-message-coordinator.service.ts:140-141` and `:88-89`: `add(this.started, ...)` runs after
      `await transition(started)`. A turn that settles during that persist (for example an instant usage-limit
      exit) emits `agent:turn-settled` before the id is in `started`. The receipt then stays `started` forever.
    - Fix: register before awaiting, or on completion re-check the agent's current `turnSeq` and status.

11. A8 binding is incomplete.
    - `opencode-cli.adapter.ts:824-846`: on a first turn (no `expectedSessionId`) the first event's `sessionID`
      is bound without proof that it is this lane's creation event. If a foreign session's event arrives first,
      the lane binds to the foreign id (the A8 hypothesis).
    - Events with no `sessionID` are accepted unfiltered (`:828`).
    - The resume mismatch is only an `error` segment with text `session-mismatch` and exit code 1. There is no
      stable code or stop reason (`LaneStopReason` in `libs/shared/.../agent-process.types.ts:308` has none), so
      consumers cannot branch on it.
    - Fix: bind only from an event that is the lane's own creation event (for example `step_start` of the
      prompt just sent), and carry a typed `session-mismatch` failure.

12. A7 exemption is "any delivered report", not a completion claim.
    - `lane-completion-notifier.service.ts:746` requires `reportsDelivered === 0`. A mid-run progress report
      followed by a usage-limit stop keeps the verdict out of `failed`.
    - Fix: count only reports flagged as a completion claim, or mark the verdict `failed` regardless and show
      the report count.

13. Receipt `mode` records the preview plan, not the executed plan.
    - `agent-message-coordinator.service.ts:65` stores `preview.mode`. `transition` cannot patch `mode`, and the
      router may execute differently after the await (for example `queue-next-turn` becomes `start-turn`). The
      outcome's `mode` and the receipt's `mode` can disagree. The plan says "return the actual receipt mode".
    - Fix: add `mode` to the transition patch and set it from `result.mode`.

14. Unbounded per-agent maps.
    - `coordinator.ts:20-21, 125-134`: `queued`/`started` keep empty arrays per agent forever. `remove()` re-sets
      filtered arrays and never deletes the key.
    - `agent-message-router.service.ts:415` caps the `terminal` map at 64 entries globally. `onQueueUpdated`
      (`coordinator:158`) depends on it. When an entry is evicted (many lanes), a failed queued message reads
      `unknown`, and unless the agent is `stopped` its receipt stays `accepted`.
    - Fix: delete empty keys. Carry the failure reason on the queue-updated event instead of re-reading the
      terminal map.

15. `agent:continue` marks renderer messages as `sender: 'parent'`.
    - `agent-rpc.handlers.ts:1564` calls `send(...)` without the sender argument (default `'parent'`,
      `coordinator.ts:55`). A9 requires the renderer path to be `'user'`.
    - Fix: pass `'user'`.

16. Boundary hygiene.
    - `agent-message-rpc.handlers.ts:9-41`: `ZodError` is thrown raw instead of `RpcUserError('INVALID_PARAMS')`.
      `sendSchema.message` has no `.max`, while the MCP schema caps it. `.trim()` rewrites the message body.
    - `coordinator.ts:56, 109`: plain `Error` for empty message and not-cancellable, with no code from
      `rpc-error-codes.types.ts`.
    - `agent-namespace.builder.ts:520, 527-528`: `AgentId.from(agentId)` throws a `TypeError` that echoes the id
      for any non-uuid or short id. This replaces the old coded `AgentMessageError` `not_found`.
      `protocol-dispatcher.ts` rethrows it as a generic tool failure.
    - Fix: coded errors, a size cap, and map invalid ids to `not_found`.

17. Evicted or expired parent envelopes are invisible and ambiguous.
    - `parent-envelope-store.service.ts:55-58` marks `expired` and logs, but `agent-events.ts` skips `expired`
      in the push sink, so the renderer stays on "Waiting for parent".
    - Callers get `delivered:false, pending:false, recorded:true` with no reason (`lane-completion-notifier.service.ts:363-369`,
      `agent-report-router.service.ts:335-339`), which the lane contract cannot act on.
    - Fix: emit an `expired` state and return a refusal reason.

18. A throwing `onAccepted` or `sink.emit` aborts the whole drain and mislabels it as a send failure.
    - `parent-delivery-drainer.service.ts:84-98`: the callbacks run inside the same `try` as
      `sendMessageToSession`. A throw lands in the catch, which calls `markFailed` (the envelope is already
      `delivered`), logs "Parent send failed", and `break`s, stranding later envelopes.
    - Fix: isolate post-send callbacks in their own try/catch.

19. Silent restore data loss.
    - `agent-delivery-receipt-store.service.ts:55-56`: if any stored entry fails the strict schema, the entire
      array is dropped without a log. Non-terminal receipts then never become `host-restarted`.
    - Fix: validate per entry, log counts, and keep the valid ones.

20. Planner rule 1/3 deviation.
    - `agent-delivery-planner.ts:27` refuses `queue` for a live handle without `continuation`, even when
      `resume` is supported and a session id exists (for example an Antigravity lane without stream-json,
      `antigravity-cli.adapter.ts:440`). The plan says "continuation or resume".
    - Fix: fall through to the cold-resume plan (release then resume) when the handle is idle.

21. Codex manifest claims `plan` supports `network: 'allow'`.
    - `codex-app-server-lane.adapter.ts:171` plus `:249-258`: `plan` maps to `read-only`. The translation sets
      `networkAccess` only for `deny`, and the read-only sandbox is not network-open. The "allow" request is
      accepted but not enforced. Verify against Codex.
    - Fix: declare `networkModes: ['deny']` for `plan`, or refuse `allow` there.

22. Report burst control only counts delivered reports.
    - `agent-report-router.service.ts:340-352` consults `recentDeliveryCount` and `recentBodyEntries`, which are
      written only on delivery (`remember`). A lane can queue up to 32 distinct reports for an inactive parent
      that all flush in one burst on activity.
    - Fix: count enqueues toward the burst limit.

23. Cold-resume loses the effective policy.
    - `agent-lane-resume.service.ts:9-17` builds the resume request without `permission`/`network`. A lane
      spawned with `plan` or `network: deny` and resumed through Send comes back with adapter defaults. The
      record stores `effectivePolicy`; it is not replayed.
    - Fix: pass `info.effectivePolicy` through `resumeRequest`.

## Requirement coverage

Plan rules (`implementation-plan.md` Contracts and Failure behaviour):

| Rule | Status | Evidence |
| --- | --- | --- |
| Planner has no CLI-name branches | Met | `agent-delivery-planner.ts` uses only manifest/handle states. `agent-message-router.service.ts:313-336` uses handle caps. (The central `translateLaneSpawnPolicy` switch on `cli` is translation, not planning.) |
| Send queues while running | Met | `planner:27-28`, `router.park:257-285`, cap of 8 refuses with `unsupported`/`failed` |
| Send now = steer, else interrupt-resume only with `allowPartialTurnLoss`, refusal BEFORE interrupt | Met | `coordinator:62-63` refuses before `accept`; `router:188-191` re-checks; `planner:32-35` discloses loss. See defect 6 for the flush race |
| Legacy `steer` = true steer only | Met | `coordinator:57-60, 76`, `router:163-170` |
| Replan at execution | Partly | The coordinator replans, and the router re-resolves capabilities. The receipt keeps the preview mode (defect 13) |
| Receipt state machine and `turnSeq` binding | Partly | The store enforces invariants (`store:87-90`). The cold-resume path never settles (defect 1). One message per turn, so "coalescing" is not implemented. Each queued receipt binds its own `turnSeq` via `messageId` on `turn-started`, a defensible simplification |
| Cold resume keeps the receipt id | Partly | The id is kept (`coordinator:69-72`). Settlement is broken (defect 1) |
| `interrupted-undelivered` | Met | `router:243-245`, `coordinator:93-98` (`partialTurnLost`, `cliSessionId` retained) |
| Cancel only in `accepted` | Partly | State check present (`:109`). Race at defect 7 |
| Persisted receipts metadata-only (A1/A9) | Met | `store:121-123` strips `preview`. The schema is `.strict()` without `preview`/body. The preview is in memory and in the push only. Persistence failure handling is missing (defects 4, 5) |
| Host restart | Met | `store:53-68` marks every non-terminal receipt `failed`/`host-restarted`. All-or-nothing parse (defect 19) |
| Parent-delivery idempotency | Partly | The dedupe entry is `pending`, so a failed send is retried. `lane-delivery:<key>` is the `clientMessageId` (`drainer:92`). The delivered state is set only after a successful send. The key is looked up before enqueue |
| Bounded per-parent queue with eviction warning | Met | `parent-envelope-store.service.ts:49-59` (32, oldest-first, `logger.warn`). The evicted state is invisible (defect 17) |
| Drain on activity AND on tab-id to session-id resolution, no recursive drain | Partly | Activity (`drainer:40`) and the resolve hook exist. The tab-id path is dead (defect 2). There is no recursion, but a lost wake-up (defect 9) |
| Spawn policy fails closed before process creation | Met | `manager.spawn:487` runs before the working-dir check and account admission. `PtahCliRegistry.spawnAgent` resolves before `run`. Adapters re-translate (`runSdk`) |
| Omitted fields keep byte-identical args | Met | `applyLaneArgvPolicy:218-220` returns a copy when both lists are empty. The Claude/ptah branch is gated by `permissionMode` presence |
| Errors: no swallowed failures without the audit comment | Partly | `AgentMessageRouter` and the drainer log. The coordinator `catch` converts errors to `unsupported` and drops the typed codes (defect 8). Event handlers have no catch (defect 4) |
| Zod at RPC/MCP boundaries | Partly | RPC: Zod `.strict()` present, no coded errors or size cap (defect 16). MCP: `AgentMessageArgsSchema` strict, `.uuid()` on `messageId` |
| No `any`/`@ts-ignore`/`as unknown as`; injected Logger; no bodies or secrets in logs | Mostly met | No casts found in scope. The coordinator has no logger. Logs carry ids and enum values only. The event payload types are untyped `EventEmitter` args (`coordinator:29-31`) |

Binding amendments:

| Amendment | Status | Evidence |
| --- | --- | --- |
| A1 metadata-only persistence, restart makes non-terminal receipts failed | Met | See above |
| A2 in-memory map, bound 32, drain on activity and resolution, key remembered only after success | Partly | Defects 2, 9, 17 |
| A5 MCP schema/delivery/status and delegation only in the dispatcher | Met | `protocol-dispatcher.ts` delegates to `ptahAPI.agent.message/messageStatus`. `allowPartialTurnLoss` is validated. Gap: invalid-id behavior (defect 16) |
| A7 usage-limit/auth stop reason, verdict `failed`, limit and reset on envelope, test | Partly | Verdict, envelope attributes and the notifier test exist (`lane-completion-notifier.service.spec.ts` new case). Over-matching and ledger poisoning (defect 3), exemption too broad (defect 12) |
| A8 one session per OpenCode lane, ignore foreign events, resume mismatch fails | Partly | Interleave and mismatch tests exist. A first-turn foreign event is bound, there is no typed stop reason (defect 11) |
| A9 `sender`, `preview`, never persisted, never logged | Met | `store:70-74, 121-123`. The `agent:continue` sender is wrong (defect 15) |
| A3, A4, A6 | Out of scope | Frontend/UI, not reviewed here |

## Test gaps

- Cold resume: emit `agent:turn-settled` for the resumed (new) agent id and assert the original receipt settles
  (defect 1). Today the spec only checks the id and the mocked `resume()` call.
- Notifier/report router with a tab-id parent, then `resolveParentSessionId`, then delivery (defect 2). Add an
  integration test that goes through the router/notifier rather than calling `store.enqueue` with a tab id.
- A7 negatives: exit 0 with error text containing `:429` or "quota" must not produce `usage-limit`, `failed`,
  or plan-ledger evidence.
- Event-handler failures: a rejecting `storage.update` for `turn-started`, `turn-settled` and `queue-updated`
  must not raise an unhandled rejection. `restore()` failure must not poison `ready`. A persist failure after
  successful delivery must not produce `failed`.
- Send-now interrupt with one already-queued message (defect 6). Cancel against an in-flight message
  (defect 7).
- A drain that starts, then an envelope is enqueued mid-drain; assert it is delivered without a second trigger
  (defect 9). A throwing `onAccepted` must not strand later envelopes (defect 18).
- Fast-settle: a turn that settles while `transition(started)` is persisting (defect 10).
- OpenCode: a foreign `sessionID` on the very first event of a first turn, and events with no `sessionID`
  (defect 11).
- `agent:continue` returns `account_refused` and `not_found` codes through the coordinator (defect 8).
  `AgentId.from` with a non-uuid id on the MCP path (defect 16).
- Spawn policy: a cold-resume Send keeps `plan` and `network: deny` (defect 23). Codex `plan` + `network: allow`
  (defect 21).

## Re-review (round 1)

Scope: working tree on top of HEAD 41a27df54 (`git diff HEAD`), static read only. No builds, tests or git state
changes. Fix reports reviewed: review-fix-r1/r2/r3.md. Line numbers refer to the working tree.

### Per-defect status

| # | Status | Evidence (working tree) |
| --- | --- | --- |
| 1 Cold-resume receipt never settles | Fixed | Registers `started` under the spawned id and binds the spawned `turnSeq` (`messaging/agent-message-coordinator.service.ts:104-106`). Settlement looks the receipt up by id via the new `receipts.getById` (`coordinator:198`, `agent-delivery-receipt-store.service.ts:128-131`), so the agent-id mismatch is gone. Residual in N5 |
| 2 Tab-id parent envelopes dead | Fixed | Report router and notifier now fall back to the raw tab id (`agent-report-router.service.ts:308`, `lane-completion-notifier.service.ts:378,405`) and enqueue. The drainer keeps them pending (`drainOnce` SessionId guard). `resolveParentSessionId` re-keys (`parent-envelope-store.service.ts:40-46`) and drains the real session. The direct (no drainer) path still refuses tab ids, which is correct |
| 3 A7 over-match on exit 0 | Fixed | Exit 0 only considers `turnErrorTexts` lines matching the anchored `STRUCTURED_EXIT_ZERO_LIMIT_ERROR` (`agent-process-manager.service.ts:131`). `authMatched` is forced false on exit 0. `recordLaneLimits` gets `null` unless a structured line matched (`manager:~3045`). `:429` or "quota" mid-line no longer matches. Residual in N7 |
| 4 Unhandled rejections | Fixed | All four `events.on` handlers have `.catch` with the injected Logger (`coordinator:37-60`). `ready` is caught (`store:49-54`). The sink is wrapped (`store:91-95,112-116`). Manager fire-and-forget calls (`presentLaneFailure`, completion signal, expired release, flush) now catch. Minor residual: one failing id aborts the rest of that settle loop (`coordinator:197-203`) |
| 5 Persist failure misreports delivery | Fixed | `persist()` is best-effort and logs (`store:151-159`). `accept` and `transition` no longer throw on IO failure |
| 6 Send-now vs queue flush race | Fixed, new defect N6 | `interrupting` set blocks `flushPending` (`agent-message-router.service.ts:227,249,328`). The consented message is submitted first. See N6 for the stranded queue after a failed submit |
| 7 Cancel race | Fixed | `index < 0` throws "no longer cancellable" before any transition (`coordinator:150-151`). Check, splice and queue removal are synchronous, so atomic against `flushPending`'s `shift()` |
| 8 Raw error text persisted/pushed/returned | Fixed | Fixed reason codes only (`coordinator:114,130-132`). Router `describeError` is constant text (`router:~487`). Drainer `lastError` is `'delivery-failed'`. Report and notifier `detail` is `'parent-send-failed'`. `agent:continue` maps receipt reasons to fixed text and codes (`agent-rpc.handlers.ts:~1565-1575`), and `account_refused` is restored. Side effect in N2 |
| 9 Drain lost wake-up | Fixed | `dirty` flag plus do/while (`parent-delivery-drainer.service.ts:68-80`). A microtask-sized window remains (N8) |
| 10 `started` registered after await | Fixed (queue and steer paths) | `add(started)` precedes `transition` (`coordinator:124,191`). The resume path still registers after the awaited spawn (N5) |
| 11 A8 binding incomplete | Partly fixed | A first-turn lane now binds only from `step_start` (`opencode-cli.adapter.ts:835-837`). Events without `sessionID` are dropped (`:830`). Typed `session-mismatch` stop reason added (`manager:~3012`, `libs/shared/.../agent-process.types.ts:308`). Introduces N4 |
| 12 A7 exemption too broad | Fixed in structure, heuristic in N3 | Verdict depends on `reportClaimsCompletion` (`lane-completion-notifier.service.ts:~746`), not on the report count |
| 13 Receipt mode stale | Fixed | `mode` is in the transition patch and set from `result.mode` (`coordinator:106,114,118,125`, `store:99`) |
| 14 Unbounded maps and terminal eviction | Fixed | Empty keys deleted (`coordinator:171-177`). `forgetAgent` on expiry (`router:412-418`, manager cleanup). Queue failures travel on the `queue-updated` payload (manager stop, release and flush emitters) instead of the capped terminal map. Receipt terminal global cap of 256 (`store:26,146-148`) |
| 15 `agent:continue` sender | Fixed | `send(..., 'user')` (`agent-rpc.handlers.ts:~1564`) |
| 16 Boundary hygiene | Mostly fixed | `RpcUserError('INVALID_PARAMS')`, 32768 cap and no body trim (`agent-message-rpc.handlers.ts:9-20`). Invalid ids on the MCP namespace fail with a constant. Residual: plain `Error('not_found')` (`agent-namespace.builder.ts:519,528`) instead of `AgentMessageError`. `cancel` and `send` still throw uncoded fixed-text errors (`coordinator:90,148,151`) |
| 17 Expired envelope invisible | Fixed | `markExpired` emits through the expiration sink (`parent-envelope-store.service.ts:104-112`). The agent-events push no longer skips `expired`. Callers get `reason: 'delivery-failed'` |
| 18 Callback throw aborts drain | Fixed | `onAccepted` and `emit` are isolated (`drainer:98-108`) |
| 19 Silent restore data loss | Fixed | Per-entry `safeParse` with a warn that counts dropped receipts (`store:67-79`) |
| 20 Planner rule 1/3 | Fixed | Idle live handle without `continuation` falls through to `usesResume` (`messaging/agent-delivery-planner.ts:27-31`). `AgentLaneResumeService.resume` releases the idle handle first (`agent-lane-resume.service.ts:9-12`) |
| 21 Codex plan + network allow | Fixed | `plan` lists `networkModes: ['deny']` (`codex-app-server-lane.adapter.ts:171`) |
| 22 Burst control counts only delivered | Fixed | `remember` runs at enqueue (`agent-report-router.service.ts:~376`) |
| 23 Cold-resume drops policy | Fixed | `permission` and `network` replayed from `info.effectivePolicy` (`agent-lane-resume.service.ts:17-18`) |

All 23 original defects are fixed or substantially fixed. The remaining residue and the new defects follow.

### New defects introduced by the fixes

**Major**

N4. OpenCode error events before the first `step_start` are now silently dropped.
- `cli-adapters/opencode-cli.adapter.ts:830-838`: `if (!event.sessionID)` and `!launch.expectedSessionId &&
  event.type !== 'step_start'` both return false, so `handleLine` never reaches its `case 'error'` branch.
- A startup provider failure, auth error, usage-limit error or transport error that is the first thing OpenCode
  emits (or that carries no `sessionID`) produces no error segment and no `lastErrorMessage`. The lane then ends
  with no diagnosable text, and A7 `usage-limit`/`auth` classification cannot see it. The original A8 incident
  ended on `[Error] Transport`.
- The implementer edited about ten existing error specs to prepend `step_start`
  (`opencode-cli.adapter.spec.ts`), which hides the regression rather than covering it.
- Fix: bind the session only on `step_start`. Let `error` events through before binding and without
  `sessionID`: surface them as lane errors but never bind from them. Keep foreign-session filtering for text,
  tool and step events. Add specs for "error before step_start" and "error without sessionID".

**Minor**

N3. Completion-claim detection is a regex over free text (duck typing).
- `agent-report-router.service.ts:~365`: `/^(?:WROTE|COMPLETED|FINISHED)\b/im` on the summary or message.
  Case-insensitive and multi-line, so a progress report with a line "Completed step 2 of 5" counts as a
  completion claim and defeats the A7 `failed` verdict. This is the defect 12 failure mode in a new form.
- Fix: add an explicit optional `claimsCompletion` boolean (or a report `kind`) to `ptah_agent_report` and pass
  it through, instead of parsing prose.

N6. A failed Send-now resubmission strands the queue.
- `router:227-249,328`: `interrupting` suppresses the single settle-time `flushPending`. If the submit then
  fails (`AgentInterruptedDeliveryError`), `finally` only clears the flag. Queued messages stay `accepted` with
  no later settle to drain them, until idle release fails them with `subprocess_released`.
- Fix: in `finally`, when the submit failed, schedule `flushPending(agentId, tracked, dispatcher)` once.

N5. Cold-resume `started` registration races a fast settle.
- `coordinator:103-106`: `add(started, spawned.agentId, ...)` runs after `await resume()`, and
  `transition(started)` after that. A resumed lane that fails instantly (usage-limit at start) can emit
  `agent:turn-settled` before registration, leaving the receipt `started` forever.
- Fix: after registering, re-check `findAgentInfo(spawned.agentId)` and settle immediately if the status is
  already terminal.

N2. Diagnostic loss from blanket sanitising.
- `router:~487` returns `'operation failed'` for every `Error`. `coordinator:114` collapses all router refusals
  (queue full, no session, steer rejected, interrupt failed) to `'delivery-refused'`.
- Callers and the UI cannot tell "queue is full, wait" from "cannot deliver". The plan's cap-of-8 row says the
  receipt must say why.
- Fix: return a typed `reasonCode` from the router (`queue-full`, `no-session`, `steer-rejected`, ...) and
  persist the code only.

N7. Residual A7 over-match on exit 0.
- `manager:131`: the `m` flag with `^` accepts any error line starting with `rate limit exceeded`,
  `usage limit reached`, `balance exhausted` or `RESOURCE_EXHAUSTED`. Tool output from tests of quota or
  rate-limit code can still match. Much narrower than before.
- Exit-0 auth stops are never classified (`authMatched` forced false), so an exit-0 `auth` stop stays unflagged.
- The original kimi-code wording is not verified against the new pattern. Confirm with a live fixture.

N8. Microtask window in `drain()` (`parent-delivery-drainer.service.ts:68-80`). A `drain()` call between the
loop's last `dirty` check and the `.finally` that clears `draining` sets `dirty` on a finished task and is not
re-run. Fix: clear `draining` inside the task before returning and re-check `dirty` after clearing.

N9. `releaseIdleForResume` on restored records (`manager:~2851`, `agent-lane-resume.service.ts:9`). A restored
record has `subprocessReleased` unset, so the cold-resume path after a host restart calls `releaseSubprocess` for
a record that never held a process, emitting a spurious `agent:released`. Probably benign but unverified. Guard
on `tracked.restored`.

N10. Boundary leftovers. `agent-namespace.builder.ts:519,528` should throw
`AgentMessageError('not_found', ...)` so `protocol-dispatcher` renders the coded message. The per-parent cap of
32 is applied to the tab id before re-keying, so a re-key can exceed 32 (`parent-envelope-store.service.ts:40`).

### Specific checks you asked about

- Cold-resume receipt rebinding: correct for the normal path (id lookup, spawned `turnSeq`, receipt keeps the
  original `agentId`, so `getReceipt(originalAgentId, id)` works). Residual N5.
- Tab-id pending envelopes and re-key: correct. Enqueued under the tab id, ignored by the drainer until the
  session id resolves, then re-keyed and drained. Residual cap overshoot (N10).
- Narrowed A7: no false positive for mid-line numbers or the word "quota" on exit 0. Residual N7.
- Drain lost wake-up: fixed. N8 is a microtask-sized window.
- Send now vs queue flush: serialized, the consented message goes first. Defect N6.
- Cancel atomicity: correct.
- Sanitised error codes: no raw text reaches persistence, push, RPC or MCP from the coordinator, router,
  drainer, report router or notifier. Diagnostic cost in N2.
- Unhandled rejections: caught at every fire-and-forget site in scope.
- Bounded maps and eviction: `queued`/`started` pruned, router per-agent state forgotten on expiry, receipt
  terminal history bounded per agent (64) and globally (256), pending envelope eviction and expiry visible.

### Test gaps remaining

- OpenCode: `error` event before `step_start` and without `sessionID` (N4).
- Failed interrupt-resume with a queued message must re-flush (N6).
- Resumed lane that settles before registration (N5).
- Progress report with a line "Completed step 2" plus a usage-limit stop must stay `failed` (N3).
- Exit-0 tool error line "rate limit exceeded" from a quota test fixture (N7).
- `drain()` called between loop exit and `.finally` (N8).

### Final verdict

Verdict: REVISE
Score: 7.5/10

Open items: blocking 0, major 1 (N4), minor 9 (N2, N3, N5, N6, N7, N8, N9, N10, and the plain-`Error` leftovers
in defect 16). The original major set is closed. N4 is a real regression in OpenCode error visibility and
should be fixed before push. N6 and N3 are small local fixes worth taking in the same round.

## Final check (after round 2)

Scope: uncommitted backend working tree on top of HEAD 41a27df54 (frontend changes ignored). Static read of
`review-fix-round2.md` and the cited code. No builds, tests or git state changes were run.

### Status of N2-N10

| # | Status | Evidence |
| --- | --- | --- |
| N2 Typed refusal codes | Fixed | `AgentMessageOutcome.reasonCode` union (`libs/shared/src/lib/types/agent-process.types.ts:562-564`). The router returns a code on every refusal (`agent-message-router.service.ts:166,170,186,191,194,205,235,275,286,309`). The coordinator persists the code, not text (`messaging/agent-message-coordinator.service.ts:117`: `reason: result.reasonCode ?? 'delivery-refused'`). The caller-facing `detail` stays constant text |
| N3 No free-text completion exemption | Fixed | `agent-report-router.service.ts:365,402` call `markReportDelivered(agentId)` only. The regex is gone. A usage-limit or auth stop is always `failed`. Dead code remains (N13) |
| N4 OpenCode startup errors | Fixed | `cli-adapters/opencode-cli.adapter.ts:829-833`: an `error` event passes when unbound, when it has no `sessionID`, or when its id equals the bound id. A foreign-session error after binding is ignored. Non-error events still require `step_start` binding (`:838-841`), and resume mismatch still fails (`:845-848`). Specs added: `surfaces a startup error without a session id`, `ignores a foreign-session error after binding`. The earlier edits that prepend `step_start` to ~10 pre-existing error specs were not reverted, but they no longer hide the case because the dedicated no-`step_start` specs cover it. Startup errors reach the exit classifier as normal error segments |
| N5 Fast-settle race on resume | Fixed | `coordinator:104-110`: registers `started`, transitions, then re-reads the spawned lane and calls `onTurnSettled(current)` if it is no longer `running`. Covers an event emitted before `add` and one emitted between `add` and the transition. A settle event fired later finds the id already removed |
| N6 Flush guard released | Fixed | `router:243-254`: `resubmitted` flag, `finally` clears `interrupting` and awaits `flushPending` only when the resubmission failed. The error still propagates as `AgentInterruptedDeliveryError`. Residual in N11 |
| N7 Exit-0 classification | Fixed | Bare-line alternation removed. Limit lines must be provider-shaped (`manager:131`). A tool error "rate limit exceeded" no longer matches. Structured auth is recognised on exit 0 (`manager:132,3003-3005`). The Kimi wording is the repository fixture, not a live capture. New residual in N12 |
| N8 Drain window | Fixed | `drainer:64-74`: `draining.delete` and the late-dirty re-drain are in `finally` with no await between the last `dirty` check and the clear, so the window is closed |
| N9 Restored record release | Fixed | `manager:2853-2855`: `releaseIdleForResume` returns for `tracked.restored` |
| N10 Boundary leftovers | Fixed | Coded `AgentMessageError('not_found')` for invalid MCP ids (`agent-namespace.builder.ts:520,529`). Re-key enforces the 32 cap by evicting the oldest report or expiring the incoming envelope, with the expiry sink and a warn (`parent-envelope-store.service.ts:41-58`) |

### New defects found in this round

All minor; nothing blocking or major.

N11. A router-initiated flush emits no queue event (minor).
- `router:254` calls `flushPending` directly from `interruptAndResume`'s `finally`. Only the manager's settle
  path emits `agent:queue-updated` afterwards (`manager` flush `.then`). If that flush fails
  (`continuation_rejected`, likely, since the resubmit just failed), `failPending` records the terminal
  status but the coordinator is never notified. The queued receipts stay `accepted` until the next
  queue-updated event (idle release or stop).
- Fix: have `interruptAndResume` return or trigger a queue-updated notification after the flush, or let the
  manager wrap the call.

N12. Exit-0 auth patterns can match a handled tool error (minor).
- `manager:132`: `^Not logged in\b|^Authentication (?:failed|required)\b|^Invalid API key\b` with `/im` over
  every error segment of a successful turn. A lane that probes a CLI (`gh`, `claude`) and handles "Not logged
  in" still ends `stopReason: 'auth'` and verdict `failed`.
- Much narrower than before, but still prose-shaped. Fix: restrict to the provider-shaped forms
  (`API Error: Request rejected (401)`, `HTTP 401` lines) and drop the three bare phrases for exit 0.

N13. Dead completion-claim plumbing (cosmetic).
- `manager:1996-2000,3318` (`markReportDelivered(agentId, claimsCompletion)`, `completionClaims` set) and
  `lane-completion-notifier.service.ts:289` can no longer be set by any caller. Remove them, or note that the
  exemption is intentionally unreachable.

Observations, no defect: before binding, an OpenCode `error` event from a foreign session on a shared server
would be reported as this lane's error (`opencode:829`). That follows from the "startup errors before binding
are reported" requirement. Binding itself still requires the lane's own `step_start`.

### Verification caveat

`review-fix-round2.md` reports the test phase exited 1: cli-agent-runtime 7 failed tests (the report attributes
them to two environment suites, `mcp-install.service` and `ptah-cli-registry-auto-compact-argv`), and the
rpc-handlers test phase failed with its failure output not retained. I did not run anything, so I cannot
confirm that either is pre-existing. The rpc-handlers failure in particular should be shown to be unrelated
(`agent-rpc.handlers.spec.ts` and `agent-message-rpc.handlers.spec.ts` were modified) before push.

### Final verdict

Verdict: APPROVED (logic), conditional on the rpc-handlers test failure being shown pre-existing or fixed.
Score: 8.0/10

All 23 original defects and N2-N10 are closed in code. Open items are three minors (N11, N12, N13) that do not
need another review round.
