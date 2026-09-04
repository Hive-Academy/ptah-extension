# Context — TASK_2026_376

Source: one live Electron dev session on 2026-09-03. Two artifacts.

1. A DevTools console capture from the webview.
2. The Electron main-process log, covering a memory-curator drain, several
   skill-synthesis drains and the shutdown sequence.

Session under observation: `50653b50-a03b-45a5-937b-b4944ab2e9f1`, one
compaction, a background `team-leader` subagent, workspace
`D:\projects\property-hub`.

Every finding below was traced to source before it was written down. Two
candidate findings were rejected during that trace and are recorded at the end
so nobody re-files them.

---

## F1 — A background agent never reaches a terminal state

**Severity: high. UI-visible. Confirmed.**

The chain, with evidence:

1. `libs/backend/agent-sdk/src/lib/message-transform/background-started-event.ts:64`
   sets `agentId: record?.agentId`, read from `SubagentRegistryService` by
   `toolCallId`. That record exists only after the `SubagentStart` hook fires.
   The file header at lines 12-14 documents that the hook can fire **after**
   the placeholder tool_result. So `agentId` is frequently undefined.
2. `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:217`
   (`resolveKey`) then keys the entry by `toolCallId` and sets
   `hasRealAgentId: false`. It emits the console warning observed in the
   capture: `[BackgroundAgentStore] background_agent event missing agentId;
falling back to toolCallId as storage key: toolu_01XJafA4f3zy645GaBXbwZ7F`.
3. The only terminal signal is
   `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:137`,
   which calls `findByAgentId(payload.agentId)`. That is an O(1) `Map.get` on
   the real SDK agent id. A `toolCallId`-keyed entry can never match it.
4. `knownEntry` is null, `onStopped` never runs, the entry stays
   `status: 'running'` for the life of the process.
5. Nothing back-fills the real agent id afterwards. There is no repair path.

Two secondary facts found during the trace:

- `background_agent_completed` has **no producer anywhere in the repository**.
  Only the type (`libs/shared/src/lib/types/execution/stream-background.ts:65`),
  the accumulator case (`accumulator-core.service.ts:571`) and
  `BackgroundAgentStore.onCompleted` exist. On the live path that method is
  dead code. The synthetic `background_agent_stopped` built at
  `turn-end-handler.service.ts:141` is the single live terminal path.
- `SdkSubagentEndedPayload` (`libs/shared/src/lib/types/sdk-hook.types.ts:135`)
  carries no `toolCallId`, so the webview cannot bridge the two identity
  spaces from that payload alone.

## F2 — The inline agent card terminalises before the agent finishes

**Severity: high. UI-visible. Confirmed.**

`libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:433` guards
early terminalisation with `isBackgroundAgent(toolCallId) ||
isBackgroundedToolResult(output)`. Both halves fail.

- `isBackgroundAgent` is false **by construction**.
  `assistant-message.transformer.ts:287` pushes the `tool_result` event, and
  `:300` pushes `background_agent_started` after it, into the same events array
  for one message. The accumulator consumes them in order, so the store is
  still empty when the `tool_result` is processed.
- That leaves only `isBackgroundedToolResult`, a substring match for the
  literal `'running in the background'` at `accumulator-core.service.ts:172`.
  It matches another vendor's placeholder wording.

When the marker misses, `onTaskToolResult` fires and the card shows
`completed` while the agent keeps working. Observed: a `team-leader` card
reading `completed` / `last: Read`, with the same agent later running Bash.

The ordering is the durable fault. A substring match against an external
product's wording is fragile whatever it says today.

## F3 — Empty assistant bubbles

**Severity: medium. UI-visible. Confirmed.**

The log line `[SdkMessageTransformer] Skipping assistant message without
renderable events` is **not** the cause. That guard
(`assistant-message.transformer.ts:331`) handles the zero-block case and it
works.

The visible bubbles come from a text block whose `text` is the empty string:

- `assistant-message.transformer.ts:135-147` pushes a `text_delta`
  **unconditionally**. The thinking branch directly above it at `:121` is
  guarded by `if (block.thinking)`. The text branch has no equivalent guard.
- `events.length` is therefore 1, the skip does not apply, and
  `message_start` plus `message_complete` are emitted.
- The webview does not filter it either: `accumulator-core.service.ts:303`
  writes the empty string into the block accumulator.
- The message tree then holds one text node with empty content and no tools,
  so `libs/frontend/chat/src/lib/utils/message-summary.utils.ts:105` falls back
  to the title `Assistant response`.

Observed as several consecutive empty bubbles, each showing 5 tokens and
`$0.0001` — the real usage of an empty completion.

## F4 — The memory curator loses a curation window silently

**Severity: medium. Data loss. Confirmed.**

Log evidence:

```
[memory-curator] transcript split into curation windows: {"windows":3,"originalChars":72824}
[InternalQueryService] one-shot query waiting for a concurrency slot:
  {"lane":"memory-curator","limit":2,"perLaneLimit":1,"inFlight":1,"laneInFlight":1,"blockedBy":"lane"}
[memory-curator] curator LLM query failed: {"error":"Internal query waited longer than 60000ms for a concurrency slot."}
[memory-curator] curator LLM run failed: {"stage":"extract","extracted":0}
```

The curator splits one transcript into three windows and submits each as a
separate one-shot query on the `memory-curator` lane. `perLaneLimit` is 1, so
window two queues behind window one. The wait budget is
`DEFAULT_QUEUE_TIMEOUT_MS = 60_000`
(`libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:93`).
When the predecessor runs longer than that, the waiter throws
`InternalQueryQueueTimeoutError` and the curator reports `extracted: 0`.

The queue budget is being applied to a wait between two windows of **one
logical job**, and the loser is dropped with a warning rather than retried.
Two sessions lost their curation in the captured window
(`ff10bd1d-edae-4a5d-b0ea-0ba2312e8df4`,
`83aca9e8-f179-4d40-b279-29d6d30229a3`).

Do **not** fix this by raising `ptah.internalQuery.maxConcurrentPerLane`. The
per-lane ceiling is the load-bearing half of that design (TASK_2026_352,
documented in `libs/backend/agent-sdk/CLAUDE.md`). Raising it lets the curator
claim both global slots and starve skill-synthesis, which is the exact
coupling the lanes exist to remove.

## F5 — Internal one-shot queries run ungated over untrusted content

**Status: RAISED AND ACCEPTED. Closed as by-design on 2026-09-03 by the
maintainer. Do not re-open it as a defect.**

The maintainer's decision: the curator keeps full automatic permissions and
unrestricted tool access, because reaching every tool it needs is a
requirement of the job it does. The concern below is recorded so the
trade-off is documented, not so it is re-litigated. See F8, which is the
follow-on work that decision creates.

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
`buildOneShotOptions` sets, on every internal query:

- `permissionMode: 'bypassPermissions'` (`:403`)
- `allowDangerouslySkipPermissions: true` (`:404`)
- `tools: { type: 'preset', preset: 'claude_code' }` (`:398-401`) — the full
  preset, including Bash, Write and Edit
- `mcpServers` from `buildOneShotMcpServers` (`:380-383`), and the log
  confirms the Ptah MCP attaches and lists its tools on every run
- no `canUseTool` callback

The two callers of this path are the memory curator and skill-synthesis. Both
feed it **transcript text**, which is untrusted: it contains whatever the user
pasted, whatever a web search returned and whatever a tool printed. A model
asked to summarise that text has unrestricted local tool access with no gate.

This is a design decision with real consequences either way, so it is filed
for a human call rather than assigned for an automatic fix. The narrow
options are: restrict the tool preset for internal queries, drop the MCP
attachment where the caller does not need it, or add a `canUseTool` that
denies by default on this path.

## F6 — Compaction hooks are wired on a query that cannot compact

**Severity: low. Confirmed.**

`buildOneShotHooks` (`sdk-query-runner.service.ts:505-520`) wires the
compaction handler for every one-shot query. The log shows the result:

```
[CompactionHookHandler] Creating hooks for session: {"sessionId":"internal-query-...","hasCallback":false}
[SdkQueryRunner] Compaction config: enabled=true, threshold=100000
[SdkQueryRunner] SDK options built: {"maxTurns":1,...}
```

`maxTurns` is 1 and `hasCallback` is false. The query cannot reach a
compaction boundary and nothing is subscribed to the fan-out. This is setup
cost on every background query, and it keeps a PreCompact path alive on a
query that has no use for it — the same path TASK_2026_293 had to repair.

## F7 — skill-synthesis appears to redo an unchanged candidate every drain

**Severity: unknown. INVESTIGATE — do not treat as a confirmed defect.**

Across two consecutive `frequent` drains in the log, the same candidate
`01M1H5VBHEJA8EAPCQKB33QR5F` was claimed and re-processed:

```
drain 1: turnCount 385, outcome "unchanged", claimed 1, done 1, durationMs 7623
drain 2: turnCount 412, outcome "unchanged", claimed 1, done 1, durationMs 4932
```

Every stage — archaeology, judge-panel, trigger-eval — reported `unchanged`,
and each drain still cost several seconds. It is possible the enqueue is
correct and only the logging is loud. The source was **not** read before this
was written, so it must be verified before any change.

## F8 — `maxTurns: 1` defeats the curator's tool access

**Severity: high. Confirmed. Follows directly from the F5 decision.**

The curator is already wired for tools.
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:283-285`
carries the comment: "Was hard-coded false (defect 13). The curator reads and
writes memory through Ptah tools when they are reachable", and calls
`resolveMcpSessionWiring(this.mcpServerStatus)` to attach the Ptah MCP.

Twelve lines below that, `:286` sets `maxTurns: 1`.

With a single turn the model may emit tool_use blocks, but the turn ends
before any tool_result returns. It never observes what the tool produced and
never writes a follow-up. The tool wiring is present and unusable.

The collector makes it worse. `:296-300` gathers assistant TEXT only. A turn
the model spends on a tool call therefore contributes nothing to `collected`,
and the curator reports `extracted: 0` — the same outcome as a model that said
nothing. There is no signal distinguishing the two.

Fix direction: raise the curator's turn budget to a bounded value that allows
at least one tool-use / observe / respond cycle, and make the collector
tolerate a run whose useful work happened in tool calls rather than in text.
Keep a bound — an unbounded background pipeline is not acceptable.

Verify the `maxTurns` semantics against the installed
`@anthropic-ai/claude-agent-sdk` before choosing the number. Do not guess it.

---

## Rejected during the trace — do not re-file

- **`internal-query-${Date.now()}` is not a violation of the "never mint a
  session id" rule.** It is deliberate and documented at
  `sdk-query-runner.service.ts:508-512`. A one-shot query has no Ptah session
  id, and passing none left every subagent it spawned unregistered
  (TASK_2026_295).
- **The bare MCP origin `ptah=http://localhost:51821` is not the TASK_2026_295
  defect.** That rule binds `SdkQueryOptionsBuilder.buildMcpServers` on the
  interactive path. Internal one-shot queries use
  `SdkQueryRunner.buildOneShotMcpServers`, which has no session segment by
  construction. See the doc comment at
  `sdk-query-options-builder.ts:1231-1241`.

---

## Batches

Batches are file-disjoint so they can run concurrently.

| Batch | Findings | Files                                                                                                                                                                                                     | Assigned                                               |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| B1    | F1       | `sdk-hook.types.ts`, `sdk-hook.parsers.ts`, `subagent-stop-hook-handler.ts`, `sdk-adapter-events.service.ts`, `session-lifecycle-notifier.ts`, `background-agent.store.ts`, `turn-end-handler.service.ts` | CLI agent `81ff293d` (claude cli, opus)                |
| B2    | F2, F3   | `message-transform/assistant-message.transformer.ts` + spec                                                                                                                                               | reassigned — codex hit its usage limit and did no work |
| B3    | F4       | `libs/backend/memory-curator/**`, `internal-query.service.ts`                                                                                                                                             | CLI agent                                              |
| B4    | F7       | read-only investigation of `libs/backend/skill-synthesis/**`                                                                                                                                              | CLI agent                                              |
| B5    | F8       | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/**`                                                                                                                                                   | CLI agent                                              |
| —     | F5       | accepted by the maintainer; no code change                                                                                                                                                                | closed                                                 |
| —     | F6       | fold into B3 only if it does not widen that batch                                                                                                                                                         | unassigned                                             |

## Outcomes — verified independently on 2026-09-03

Every batch reported success. The claims below were re-checked against the
source and the test runner by the orchestrator, not taken from the reports.

- **B1 (F1) — landed.** Approach (a): `toolCallId` is now an OPTIONAL field on
  `SdkSubagentEndedPayload`. The producer is
  `subagent-stop-hook-handler.ts:93-103`, which reads the SDK hook's
  `toolUseID`. Its comment records a constraint the batch discovered: the
  registry cannot serve as a second source, because the `SubagentHookHandler`
  twin runs on the same hook and deletes the record first. The consumer at
  `turn-end-handler.service.ts:146-153` resolves `findByAgentId` first and
  falls back to `adoptRealAgentId(toolCallId, agentId)`.
- **B2 (F2, F3) — landed.** `assistant-message.transformer.ts:136` now guards
  the text branch with `if (block.text)`. The background_agent_started event is
  pushed at `:288`, ahead of the tool_result event at `:301`, so
  `isBackgroundAgent` is true when the webview reads the guard.
- **B3 (F4) — landed.** New `curator-job-queue.ts` and `queue-slot-timeout.ts`
  under `memory-curator/src/lib/curator-llm/`.
- **B5 (F8) — landed.** `CURATOR_MAX_TURNS = 6`, replacing `maxTurns: 1`. The
  batch verified the semantics against the installed SDK rather than assuming
  them, citing `sdk.d.ts:1527-1530` and `:73-75`, and tied the ceiling back to
  F4: every turn this run spends is a turn the next curation window waits.

**Verification run by the orchestrator:**

```
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator \
  @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat \
  @ptah-extension/shared
NX   Successfully ran target test for 6 projects

npx nx run-many -t typecheck -p <same six>
NX   Successfully ran target typecheck for 6 projects
```

The header reported 6 projects in both runs, which is the number requested.

## Review round — after commit `eca2c155b`

Two reviewers read the commit. Both returned APPROVE WITH FIXES.

| Review | Score    | File                                |
| ------ | -------- | ----------------------------------- |
| Logic  | 6.5 / 10 | `code-logic-review.md` — 6 findings |
| Style  | 7.5 / 10 | `code-style-review.md` — 4 findings |

**The review earned its keep.** The F8 fix — raising the curator from
`maxTurns: 1` to 6 — was correct in isolation and shipped a regression. The
response collector was never adapted to a multi-turn run: `collected +=
block.text` concatenated every assistant message while `extractJsonObject`
returned the FIRST balanced object, although both prompts tell the model its
FINAL message carries the JSON. The reviewer reproduced a wrong-but-valid parse
and a parse failure against the real function body. Either one ends with
`markProcessed` consuming the observations, so the session could never be
curated again — the same silent data-loss class F4 had just closed, on a new
path. Shipping F8 without this review would have traded one data-loss path for
another.

A second finding is a genuine cross-batch interaction. B6 guarded the
compaction hooks on `maxTurns > 1`, and B5 raised the curator to 6 in the same
task, so the curator moved from inside that guard to outside it — onto the
pipeline B6's own comment names as the hazard. Neither agent could see the
other's work.

### Fix batches

- **R1 — landed.** Logic 1, 2, 3, 4 (consumer half), style 2 and 4.
  `runQuery` now ASSIGNS `lastAssistantText` per message instead of
  concatenating (`sdk-internal-query.curator-llm.ts:444`), a `no-output` arm was
  added to `CuratorExtraction` and mapped to the input-preserving outcome, the
  job queue gained a wait ceiling and an abort check, and the hand-rolled
  `as unknown as` narrowing was replaced with the library's own
  `isAssistantMessage` / `isResultMessage` / `isTextBlock` guards. R1 recorded
  one deliberate trade-off: it takes the last assistant message rather than the
  last message CONTAINING text, so a run that answers and then emits a
  tool-only message defers instead of parsing. Deferring costs one re-curation;
  parsing the wrong object costs the session's memories permanently.
- **R3 — landed.** Logic 4, producer half. It found that `maxTurns` was the
  wrong axis entirely: `buildOneShotHooks` mints the synthetic
  `internal-query-<epoch>` id for EVERY one-shot query, and the only subscriber
  to `CompactionCallbackRegistry` resolves a real session's JSONL transcript, so
  a `PreCompact` on any one-shot query is spurious at every turn budget. It
  verified the hook is a notification path and not a participation API — the SDK
  decides to compact through `autoCompactEnabled` and its threshold, which are
  separate from `Options.hooks` — then removed the compaction hooks from the
  one-shot path entirely, along with B6's now-dead `maxTurns` parameter and the
  unused `CompactionHookHandler` injection.
- **R2 — landed.** Style 1, logic 5 and 6. The first agent assigned to it
  returned nothing at all — no report and no edits — so it was reassigned.
  R2 found that findings 1 and 5 pull in opposite directions and named the
  conflict rather than picking a side: finding 1 wants the Zod schema to define
  `toolCallId`, finding 5 wants an invalid value not to reject the payload, and
  a plain `z.string().min(1).optional()` satisfies the first while violating the
  second. It resolved with `.catch(undefined)`, verified the combinator against
  the installed zod 4.3.6 rather than assuming it, and also verified that Zod
  emits output keys in SHAPE order — which is why the field sits between
  `agentType` and `lastAssistantMessage`, so the equivalence proof's key-order
  assertion still holds. Logic 6 was deliberately NOT implemented, with evidence
  recorded in `r2-report.md`.
- **Style 3 — closed by the orchestrator.** A WHY comment now sits beside the
  `background_agent_started` push in `assistant-message.transformer.ts`,
  recording that the order is load-bearing and why reversing it recreates F2.

### Verification performed, and the one gate still open

After the review fixes landed (`d5dca6ca7`):

```
nx run-many -t test      — 6 projects, all green
nx run-many -t typecheck — 7 projects, all green
nx run-many -t lint      — 6 projects, 0 errors, 17 warnings (all pre-existing
                           categories: max-lines, non-null assertion, empty
                           function — none introduced by this task)
nx build ptah-extension-webview — bundle generated
ptah-electron main bundle + validate-deps — built and passed in the pre-commit hook
```

**The task stays at `in_review`, not `done`, and the reason is specific.**
Every one of these defects was found by WATCHING A LIVE SESSION, not by a
failing test. The suites now prove the new logic behaves as written; they do not
prove the observed symptoms are gone. Four behaviours still need one real
session to confirm:

1. The `[BackgroundAgentStore] background_agent event missing agentId` warning
   stops, or the agent still reaches a terminal state when it appears.
2. A background subagent's card tracks its real state instead of showing
   `completed` while the agent keeps working.
3. No empty `Assistant response` bubbles appear.
4. A multi-window curation completes without a `extracted: 0` on a window that
   timed out against its own sibling.

That session needs a background subagent and a compaction — the shape of the
original capture. Until someone runs it, this task is code-complete and
unverified in the product.

### F7 is closed as NOT A DEFECT

B4's read-only trace overturned the finding, and the correction was verified
at `skill-drain.service.ts:371-408`. My reading of the log was wrong on two
counts:

1. `archaeology`, `judge-panel` and `trigger-eval` never ran. `archaeology` is
   in `NIGHTLY_ONLY_STAGES` and the other two are in `WEEKLY_ONLY_STAGES`,
   while `DRAIN_TIER_STAGES.frequent` admits only `FREQUENT_STAGES`. The
   `... enqueued: {"outcome":"unchanged"}` lines report the outcome of a queue
   `enqueue` call, not the execution of a stage.
2. The two drains were not repeating identical work. The session grew from 385
   to 412 turns, and under TASK_2026_351 new turns legitimately re-open
   `prefilter` so a candidate can be superseded in place.

No LLM call was made in either drain. The several seconds went to JSONL
parsing, local embedding inference and SQLite work. F7 needs no change.

---

B5's write boundary is deliberately narrow. B3 owns
`libs/backend/memory-curator/**` and
`libs/backend/agent-sdk/src/lib/internal-query/**`, and B5 owns
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/**`. The two sets do not
intersect, so both may run at once.
