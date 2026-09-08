# TASK_2026_376 — Independent review gate

Reviewer: Claude (gate) + Codex CLI (agent `274a8357`, session `01a07db4-ab0b-7182-8adc-ed9f6cbae7dd`).
Tree reviewed: branch `fix/empty-assistant-bubbles`, clean, task commits `eca2c155b` and `d5dca6ca7`.
Review is read-only. No source file and no `task.md` was modified.

---

## 1. Acceptance criteria

Extracted from `task.md` + `context.md` (F1–F8, the batch outcomes, and the four
runtime behaviours the task itself named as its open gate).

| # | Criterion | Verdict | Evidence (current tree) |
| --- | --- | --- | --- |
| AC1 | F1 — a background agent reaches a terminal state even when `background_agent_started` carried no real SDK agentId | SATISFIED (one plausible residual, see O3) | Optional field `libs/shared/src/lib/types/sdk-hook.types.ts:161`; Zod preserves it `libs/shared/src/lib/types/sdk-hook.schemas.ts:109`; hand parser mirrors it `libs/shared/src/lib/types/sdk-hook.parsers.ts:244`; producer reads `toolUseID` `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-hook-handler.ts:88-105`; adapter event carries it `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:59-73`; broadcast forwards `parsed.data` `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:180-182`; consumer falls back `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:145-153`; re-key `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:301-331` |
| AC2 | F2 — the inline card no longer terminalises before the agent finishes | SATISFIED | `background_agent_started` pushed at `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:288`, `tool_result` after it at `:312-324`; guard read `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:440-446`; store write is a synchronous `signal.update` `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:195-206` — not deferred through a batched frame, so the guard is true by construction now |
| AC3 | F3 — no empty assistant bubbles | SATISFIED | Text branch guarded `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:136`; zero-event skip still fires `:344` |
| AC4 | F4 — the curator no longer silently loses a curation window | SATISFIED | Pass serialised `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:118-159`; bounded ceiling `:60` (`CURATOR_QUEUE_WAIT_CEILING_MS = 180_000`); slot-timeout recognition `libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts:38-47`; retry budget `:57-96`; windows awaited sequentially and deferral returned `libs/backend/memory-curator/src/lib/curator-window-runner.ts:184-210`; mapped to `outcome: 'stalled'` `libs/backend/memory-curator/src/lib/memory-curator.service.ts:360-367`, `:918-938`; input preserved — the trigger returns BEFORE `markProcessed` `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:814-825`. Forbidden fix NOT taken: `DEFAULT_MAX_CONCURRENT_PER_LANE = 1` `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:82` |
| AC5 | F8 — `maxTurns: 1` no longer defeats the curator's tool access, without reintroducing data loss | **PARTIAL — see Blocker 1** | `CURATOR_MAX_TURNS = 6` `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:186`; collector ASSIGNS per message `:444`, so no earlier valid object can be parsed; `tools-only` and `silent` map to the input-preserving `no-output` arm `:297-313`. The third arm is not covered: a final message that is non-JSON PROSE still lands on `extracted` with zero drafts `:315` |
| AC6 | F6/R3 — compaction hooks removed from the one-shot path | SATISFIED | `buildOneShotHooks` returns subagent hooks only `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:506-545`; no `maxTurns` parameter, no `CompactionHookHandler` injection; the interactive path is untouched (documented `:22-29`) |
| AC7 | R2 — `toolCallId` is `.catch(undefined)` and sits in shape order | SATISFIED | `libs/shared/src/lib/types/sdk-hook.schemas.ts:109` between `agentType` (`:108`) and `lastAssistantMessage` (`:110`); hand parser mirror `libs/shared/src/lib/types/sdk-hook.parsers.ts:238-247`; equivalence corpus covers `''`, `undefined`, `42` `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts:450-453`; installed zod is 4.3.6 |
| AC8 | F7 — closed as NOT A DEFECT, reasoning holds | SATISFIED | `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:371-388` — `archaeology` in `NIGHTLY_ONLY_STAGES`, `judge-panel` and `trigger-eval` in `WEEKLY_ONLY_STAGES`; tier sets composed `:397-408`; frequent tier admits `FREQUENT_STAGES` only `:401` |
| AC9 | F5 — accepted by the maintainer, no code change, no regression | SATISFIED | One-shot options unchanged `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:399-405`; blame attributes those lines to a pre-task commit |
| AC10 | The task's OWN gate: four behaviours confirmed in one live Electron session with a background subagent and a compaction (`context.md:385-401`) | **NOT SATISFIED — nothing in the tree can satisfy it** | No evidence anywhere in the task folder that this session was run. `context.md:400-401` states it outright: "code-complete and unverified in the product" |

Verification I ran myself:

- `nx run-many -t typecheck -p agent-sdk memory-curator chat-streaming chat shared rpc-handlers` — **6 projects, green.**
- `nx run-many -t lint -p agent-sdk memory-curator chat-streaming chat shared` — **5 projects, green.**
- `nx run-many -t test -p agent-sdk memory-curator chat-streaming chat shared` — **agent-sdk FAILED** on the first run (3 tests in `jsonl-reader.streaming.spec.ts`), **passed** on two subsequent runs. See O4 — flaky, pre-existing, unrelated to this task.

---

## 2. Codex raw verdict

`VERDICT: NEEDS_WORK`, with four blockers:

1. Final non-JSON assistant output permanently consumes uncurated observations.
2. Other curator failures (`recordCuratorError`, per-draft persistence failures) return a success-shaped result and consume input.
3. AC1 has a stop-before-start terminal race — `adoptRealAgentId` returns null when no entry exists yet.
4. The `agent-sdk` test target is flaky because `internal-query.service.spec.ts` leaks rejected 60 s queue waiters.

Codex also returned AC1 as PARTIAL and AC6/AC7/AC8/AC9/AC2/AC3/AC4 as SATISFIED, and confirmed the requested test coverage exists.

---

## 3. My adjudication

I opened every file Codex named and checked every line before carrying a claim forward.

**Blocker 1 — CONFIRMED, carried.** Verified end to end. Full detail below.

**Blocker 2 — CONFIRMED as fact, DEMOTED to an observation.** Both halves are real
(`memory-curator.service.ts:950-960` and `:721-742`), but neither is in this task's
scope and one is explicitly documented as a deliberate carry-over:
`memory-curator.service.ts:952-958` states "`'ran'`, not `'stalled'`: the call was
dispatched and failed … deliberately left at its pre-existing behaviour here."
Blocking 376 on a decision it deliberately declined to make is not a fair gate. See O1.

**Blocker 3 — mechanism CONFIRMED, severity DOWNGRADED to an observation.** The
transport asymmetry Codex asserts is real and I verified it: chat events go through a
16 ms coalescing buffer with a 4-batch in-flight window
(`libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts:45-63`,
backpressure awaited at `chat-stream-broadcaster.service.ts:236-240`), while
`session:subagentEnded` is broadcast directly with no buffer
(`session-lifecycle-notifier.ts:180-182`). So a stop CAN in principle overtake a start.
But the gap being raced is a single 16 ms frame against the entire lifetime of a
background subagent — the `SubagentStop` hook fires when the agent finishes, seconds to
minutes after the placeholder `tool_result` that carries the start. This needs a
saturated transport AND a near-instantaneous subagent. Plausible, not demonstrated. See O3.

**Blocker 4 — CONFIRMED independently, NOT a blocker on this task.** I hit this failure
myself before Codex reported it, which is the strongest form of corroboration available
here. `git log` on `jsonl-reader.streaming.spec.ts` and `internal-query.service.spec.ts`
shows neither was touched by `eca2c155b` or `d5dca6ca7`; their last changes are
`b61d50798` and `3326e77b8`. It is pre-existing. It does mean the verification gate this
task cites is not reliably green. See O4.

**Blockers Codex missed that I add: none.** I independently traced AC1 through the RPC
notifier, AC2 through the accumulator's synchronicity (the one thing that could have made
the F2 fix cosmetic — it is not, `signal.update` is synchronous), AC4 through every
outcome arm to `markProcessed`, and AC8 through the stage tier sets. All hold. Test
coverage for the new logic is genuinely present and specific:
`turn-end-handler.rekey.spec.ts` (7 cases, including "does not adopt an entry belonging to
a different Task tool call"), `assistant-message.transformer.spec.ts:198` and `:624`
(empty-text suppression, event ordering), `curator-job-queue.spec.ts` (7 cases including
the ceiling), `sdk-internal-query.curator-llm.spec.ts:710-779` (turn budget, tool-only
distinctness). This is well-tested work.

---

## 4. Blockers

### Blocker 1 — a curator run whose final message is prose, not JSON, permanently consumes the session's observations

**Severity: high. Silent data loss. CONFIRMED.**

Chain, each link verified in the current tree:

1. `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:315`
   — the fall-through arm:
   ```ts
   return { status: 'extracted', drafts: this.parseDrafts(outcome.text) };
   ```
2. `:477-481` — `parseDrafts` returns `[]` for BOTH "no balanced JSON object found" and
   "Zod parse failed". A parse failure is indistinguishable from an honest empty result.
3. `libs/backend/memory-curator/src/lib/memory-curator.service.ts:582-599` — the
   `drafts.length === 0` arm returns `outcome: 'ran'`.
4. `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:814-825` — the
   `'stalled'` early return does not fire, so `this.observationQueue.markProcessed(ids)`
   runs. The rows are gone.

Failure scenario: the curator spends four of its six turns reading memory through the
Ptah MCP, then ends with `"I reviewed the transcript and found nothing worth storing."`
→ `extractJsonObject` finds no object → `drafts: []` → `outcome: 'ran'` → the session's
queued observations are marked processed → that session can never be curated again.
Identical outcome for a JSON object the model truncated or wrapped wrongly.

**Provenance, stated honestly.** This is NOT a regression introduced by TASK_2026_376.
`git blame` puts line `:315` on `5dfedc09c` (2026-08-23), and the test that pins the
behaviour — `sdk-internal-query.curator-llm.spec.ts:695`, *"returns an EXTRACTED status
with no drafts when model output is non-JSON garbage"* — comes from the same commit. It
is a pre-existing, deliberately asserted design.

**Why it still belongs on this gate.** The task's own review round
(`context.md:314-324`) set the standard: the F8 fix "would have traded one data-loss path
for another," and R1 was accepted specifically because it closed that trade. R1 closed two
of the three ways a run can end without JSON — `tools-only` and `silent` — and left the
third open. And raising `maxTurns` from 1 to 6 is exactly the change that makes the third
one common: a single-turn model either emits the JSON or emits nothing, whereas a
six-turn model that has just finished a sequence of tool calls is far more likely to close
with a natural-language wrap-up. The task widened the mouth of a hole it had just
documented as the thing it must not widen. `curator-window-runner.ts:151-157` already
states the correct rule for the sibling case — *"Returning the arm makes the caller keep
the input"* — so the fix direction is the existing one, extended: treat "text present but
no parseable JSON" as `no-output` rather than as `extracted: []`.

### Blocker 2 — the task's own acceptance gate has not been run

**Severity: procedural, and decisive for `done`. CONFIRMED by the task's own words.**

`context.md:385-401` is unambiguous:

> **The task stays at `in_review`, not `done`, and the reason is specific.** Every one of
> these defects was found by WATCHING A LIVE SESSION, not by a failing test. The suites now
> prove the new logic behaves as written; they do not prove the observed symptoms are gone.

Four behaviours are listed (`context.md:391-397`) and require one Electron session with a
background subagent and a compaction. Nothing in the task folder records that session
having been run — the newest artefacts are the R1/R2/R3 reports, and none of them claims
it. Moving to `done` while the author's own stated precondition is unmet is precisely the
dishonesty this gate exists to catch.

---

## 5. Non-blocking observations

- **O1 — two other curator paths return a success-shaped result and consume input.**
  `memory-curator.service.ts:950-960` (`recordCuratorError` returns `outcome: 'ran'` for a
  dispatched-and-failed call — documented as a deliberate carry-over) and `:721-742` (every
  per-draft persist can fail into `skipped` at `:709-716` and the aggregate still reports
  `'ran'`, so a totally failed persistence run consumes its input). Same class as Blocker 1,
  outside this task's scope. Worth its own task.
- **O2 — `CompactionConfigProvider` is now a log-only dependency of the one-shot runner.**
  Injected at `sdk-query-runner.service.ts:169`, used only at `:388-391`, and the log text
  says "managed via hooks" although R3 removed those hooks. Misleading, not wrong.
- **O3 — `adoptRealAgentId` has five early returns that each leave an entry `running`.**
  `background-agent.store.ts:305,309,313(false branch),316,319`. The reachable one is
  `:309` (no entry yet), via the buffered-start / unbuffered-stop asymmetry described in §3.
  Narrow, but it is the same identity-race family as F1 and a `pendingTerminal` note would
  close it.
- **O4 — the `agent-sdk` test target is not reliably green.** `jsonl-reader.streaming.spec.ts`
  failed 3 tests on one run and passed on two others on this machine; Nx separately flagged
  `chat-streaming:test` flaky. Codex traces the cause to leaked 60 s queue waiters in
  `internal-query.service.spec.ts:405-418` (and `:438-488`, `:549-562`, `:631-643`), which
  matches the `InternalQueryQueueTimeoutError` text that surfaced in my own run. Pre-existing
  (`3326e77b8`, `b61d50798`) and unrelated to TASK_2026_376, but it undermines the
  "6 projects, all green" evidence this task rests on.
- **O5 — `CURATOR_MAX_TURNS` and the runner's test constant can drift.**
  `sdk-query-runner.service.spec.ts` hard-codes a `maxTurns: 6` case rather than importing
  the constant. Cosmetic.

---

## 6. Final verdict

**NEEDS_WORK.**

The engineering is strong and most of it is done properly: AC1–AC4 and AC6–AC9 are
satisfied with real evidence, typecheck and lint are green, and the new logic carries
specific, well-named tests rather than decorative ones. Two things stop it short of `done`:

1. **Blocker 1** — a confirmed silent-data-loss path in the exact function F8 touched. It
   is pre-existing rather than a regression, and it is pinned by an older test, but this
   task's `maxTurns: 1 → 6` change is what makes it likely, and closing exactly this class
   of hole was the stated justification for accepting R1.
2. **Blocker 2** — the task's own author wrote down four runtime behaviours that must be
   confirmed in one live Electron session before `done`, and there is no record of that
   session. That condition is not mine; it is the task's.

Recommended: keep at `in_review`. Extend the `no-output` arm to cover "text present, no
parseable JSON" (one arm, in the file that already documents the rule), then run the one
Electron session `context.md:399` describes.
