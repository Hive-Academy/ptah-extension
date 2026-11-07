# implementation-plan.md — review

Reviewer: orchestrator (in-process, Claude family). Author: kimi-code CLI lane (opposite side).
Verdict: **APPROVED WITH AMENDMENTS**. The amendments below are binding for every batch and
override the plan where they conflict.

## What is approved as written
- Contracts §1-§4 (manifest via widened `capabilities()`, effective capabilities, preview/send,
  receipts, RPC methods, push event).
- One pure planner used for preview and again at execution; planning rules 1-8.
- Default Send queues while running; Send now = steer, else interrupt-resume only with
  `allowPartialTurnLoss`, else `unsupported`. Legacy MCP `delivery: 'steer'` = true-steer only.
- Failure-behaviour table. Fail-closed policy translation. `no-reliable-source` limit rows.
- Preserve list (all items). Batch 8 doc edits.

## Amendments

### A1 — No message bodies in durable storage (simplify persistence)
Receipts are persisted (bounded, TTL) as metadata only: id, agentId, state, mode, delivery,
timestamps, turnSeq, cliSessionId, reason, partialTurnLost, turnOutcome. Message bodies are NOT
persisted. Accepted (queued) bodies stay in memory with the live process record. On host restart,
every non-terminal receipt becomes `failed` with reason `host-restarted`. The renderer keeps the
draft text (existing `undelivered` behaviour) so the user can resend. Rationale: lanes do not
survive a host restart, so restoring queued bodies has no consumer, and it removes the sensitive
data risk. Keep the store behind a port so persistence can grow later.

### A2 — Parent envelopes: in-memory pending map first
`parent-envelope-store` keeps pending completion/report envelopes in memory, bounded per parent
(e.g. 32, oldest-first eviction with a logger warning), drained on `SessionActivityRegistry`
activity and session-id resolution, with stable `clientMessageId` (`lane-delivery:<key>`) for
idempotency. The dedupe key is remembered only AFTER a successful send (fixes defect 2). Keep
it behind a store interface; durable persistence is out of scope for this PR.

### A3 — Add the CLI tools management view (missing batch)
The user asked for deep CLI-tool management. Add **Batch 9 — CLI tools management view**
(frontend + a thin RPC read): one Electron settings table of every adapter's potential manifest
(messaging steer/interrupt/continue/resume, permission modes, network modes, MCP, limit-reader
state, status, enable/disable using the existing enable setting), with an expandable row that
explains each capability and the unsupported reasons. Data from `agent:detectClis` extended with
the manifest (Batch 1 adds the DTO field; Batch 5 fills it). Find the existing CLI agent settings
component under `libs/frontend/chat/src/lib/settings/` and extend or replace it per the preserve
rule (no capability removed).

### A4 — Add the parent ↔ lane communication thread (missing from Batch 7)
Batch 7 also renders one readable thread on the lane transcript surface
(`libs/frontend/chat/src/lib/components/organisms/transcript/lane-transcript.component.ts`,
`libs/frontend/chat/src/lib/components/molecules/lane-event/lane-event-row.component.ts`):
user messages, parent-agent messages (with inline receipt state), lane reports and the completion
verdict, plus "Waiting for parent" / "Sent to parent" for the completion signal. Batch 5 must push
the parent-delivery state (`pending` / `delivered`) on the agent-monitor channel so the renderer
can render it.

### A5 — Wiring completeness for Batch 5
Batch 5 also owns: the MCP `ptah_agent_message` schema and description (`delivery: 'queue' | 'now'
| 'steer'`, `allowPartialTurnLoss?: boolean`), `ptah_agent_message_status` returning the new
receipt states, the four DI guard specs for Electron and VS Code roots (`container.smoke.spec.ts`,
`expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`) and the
`cli-engine` container if it resolves the new services. Keep `protocol-dispatcher.ts` changes to
delegation only.

### A6 — UI copy follows design-spec.md
Receipt labels in the UI are the design vocabulary, mapped from backend states:
accepted → "Queued", started → "Sending", settled → "Received"/"Done", failed → "Failed",
expired → "Expired", interrupted-undelivered → "Interrupted — not sent". Completion verdicts:
"Deliverables written" / "No deliverable" / "Failed" / "Unverified". Parent signal: "Waiting for
parent" / "Sent to parent". Backend type names do not change.

## Execution order (orchestrator)
1. Lane A: Batches 1 + 2 (shared contracts + adapter manifests/policy).
2. Lanes B and C in parallel: Batch 3 (delivery/receipts) and Batch 4 (parent delivery).
3. Lane D: Batch 5 (RPC/MCP/DI/push).
4. Lane E: Batch 6 (renderer store); then Lanes F and G in parallel: Batch 7 (+A4) and Batch 9.
5. Lane H: Batch 8 (docs).
6. Independent review by a different family per batch group; visual review in Electron.

### A7 — Completion signal must report a usage-limit stop (new defect, observed live)
Observed 2026-11-06 03:16 UTC: a kimi-code ptah-cli lane stopped at its 5-hour usage limit after
writing only a skeleton deliverable. The completion signal said `status=completed`, exit code 0,
verdict `delivered`, with no stop reason and 0 reports, while `ptah_agent_list` already showed the
lane "at limit [error-derived]". A parent cannot tell this from finished work.
Batch 4 (and Batch 3 where the exit classification lives) must:
- Classify a lane that ended on a usage-limit / auth / rate-limit error as `stopReason:
  'usage-limit'` (or `'auth'`), with the reset time when known, and set the verdict to `failed`
  (not `delivered`) even when a deliverable exists, unless the lane called `ptah_agent_report`
  with a completion claim.
- Put the limit and reset time on the `<agent-lane-completed>` envelope line.
- Add a test: limit error after a skeleton deliverable => verdict `failed`, stopReason
  `usage-limit`.

### A8 — OpenCode lane session identity can attach to another lane's conversation (observed live)
Observed 2026-11-06 04:27 UTC. OpenCode lane `f2d289fe` (routing review) ran 72 min, printed only
`[Tool] shell/read` lines, wrote no deliverable and ended on `[Error] Transport`. Ptah recorded its
CLI Session ID as `ses_e5125ac32ffelvlZuYK6Fsd5IB`. Resuming that id (lane `adf8dffa`) returned a
full report for a DIFFERENT task (TASK_2026_883, Codex sandbox ACL, owned by another session) and
that lane wrote files into the other task's folder in the main checkout.
Evidence: `opencode-cli.adapter.ts:796-800` captures the first `event.sessionID` seen on stdout and
never checks that later events or the resumed session belong to this lane. Hypothesis to verify:
`opencode run` streams events from a shared local OpenCode server, so another lane's session id can
arrive first.
Required (Batch 2 follow-up, cli-agent-runtime):
- Bind a lane to exactly one OpenCode session: capture the id from the lane's own creation event
  only, ignore and log events whose `sessionID` differs, and never let a later id overwrite it.
- On resume, verify the resumed session's first event id equals the requested id; else stop the
  lane and fail with `session-mismatch` (do not run the task in a foreign conversation).
- Tests: interleaved events from two session ids; resume mismatch => failed `session-mismatch`.

### A9 — Thread correlation data (found by the A4 lane)
The single chronological parent <-> lane thread needs to know who sent each message and what it
said. Receipts carry neither, and `LaneTranscriptComponent` is not given the lane events.
Decision:
- Add `sender: 'user' | 'parent'` and `preview?: string` (first 160 characters, whitespace
  collapsed) to the receipt push payload and the in-memory receipt record. `preview` is never
  persisted (A1 still holds) and never logged. The MCP path sets `sender: 'parent'`, the renderer
  RPC path sets `sender: 'user'`.
- The renderer store keeps the thread items per agent (bounded) from receipts, reports and the
  completion signal; `LaneTranscriptComponent` receives the lane events it needs as inputs.
- A failed completion row uses the error tone (accent + icon), not the success tone.
Runs after Batch 7 (it edits the renderer store too).
