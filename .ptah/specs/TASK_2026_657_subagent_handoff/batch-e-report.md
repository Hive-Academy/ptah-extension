# Batch E report - TASK_2026_657 (file-backed subagent handoff)

Status: COMPLETE (implementation-plan-e.md, components 1-7). Uncommitted in worktree
`D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice` (branch
`fix/subagent-handoff-notice`, base 74347fc75). Two implementers: the first did C1-C4, C6 and the
C5 source plus `register.ts`; the continuation did the C5 spec, the executor spec check, C7, the S5
check and the self-check (see `batch-e-progress.md`).

Paths below are relative to the worktree root; `C/` = `libs/backend/agent-sdk/src/lib/helpers/compaction/`.

## Files per component

| Component | Created | Modified |
| --- | --- | --- |
| 1 Record store | `C/subagent-handoff-record.ts`, `C/subagent-handoff-record.spec.ts` | - |
| 2 Index + pointer | `C/subagent-handoff-index.ts`, `C/subagent-handoff-index.spec.ts` | - |
| 3 Timeout helper + message | - | `C/subagent-handoff-files.ts` (+spec), `C/subagent-handoff-message.ts` |
| 4 Delivery (rewrite) | - | `C/subagent-handoff-delivery.ts` (+spec rewritten) |
| 5 Monitor | - | `C/subagent-budget-monitor.ts` (+spec), `libs/backend/agent-sdk/src/lib/di/register.ts`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` (constructor arity only) |
| 6 UserPromptSubmit pointer | - | `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts` (+spec) |
| 7 Convention text | - | `libs/shared/src/lib/types/task-spec.contract.ts` (+spec), the 15 `.claude/agents/*.md` files, `.claude/skills/orchestration/SKILL.md`, `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md` |

Deleted symbols (C4): `PENDING_HANDOFF_MAX_RETRIES`, `undeliveredHandoffNotice`, `PendingHandoff`,
`retryPending`, `release` (delivery), `sendDropped`, `retryRecord`, `retryIfMissed`, `pushRecord`,
`postUndeliveredNotice`, `Handoff.notesPath`. No file was deleted. `MainThreadNoticeQueue` is unchanged.

### C5 detail (continuation)
- Monitor source: the Guarantee 2 (B2) sentence now sits verbatim in the JSDoc directly above
  `export class SubagentBudgetMonitor` ("Safety-stop limit (user decision B2): ..."). The file header
  keeps a one-line pointer to it instead of a second copy.
- Monitor spec harness: an in-memory record store fake and an index fake (both `jest.fn`), passed as
  the two new constructor arguments, plus an `order` log of `writeOnce`, `markInvoked`,
  `stopSubagent`, `push` and `post`. Real `SubagentHandoffRecords`/`SubagentHandoffIndex` on a temp
  workspace are used where the file system matters (late write, rekey, pointer audience).
- Updated tests: the release-during-rejecting-stop test now releases after `stopSubagent` was
  called (with the new ordering, releasing earlier is the withdraw path) and asserts record kept +
  published + no delivery. Two notes-instruction expectations follow the new message (the resume
  instruction repeats the record sentence). The retry-pending test ("cleared fallback ... delivered
  on the next main-thread message") tested deleted behaviour. It is replaced by "a cleared fallback
  is not resent; the record stays the durable copy".

### C7 detail
- `SUBAGENT_HANDOFF_RULE` (new export, `task-spec.contract.ts`) holds the plan's rule word for word.
  Both audiences render it as a bullet. The specialist block puts it after the "Write only the
  deliverable" bullet. In the coordinator block the team-leader line gains "They do set the
  `status:` line of a subagent handoff record they continue (below)." and the rule bullet follows.
- The 15 `.claude/agents/*.md` "Task folder" lines end with the same rule text (one line each).
- In both SKILL.md copies, under `## Invoking agents`, a new bullet says: when you re-spawn an agent
  that Ptah stopped, put the pending record path (from the pointer line or the stub) in its prompt.
  The two copies are byte-identical (`cmp`).

## Fault-schedule tests

Monitor (`C/subagent-budget-monitor.spec.ts`, describe "SubagentBudgetMonitor handoff records" unless noted):

| Schedule | Test |
| --- | --- |
| Write precedes stop/push/post; markInvoked before stopSubagent; publish between stop and push; stub | "writes the record before the stop, marks it invoked, ..." and "a foreground handoff is posted only after ..." |
| Write error / timeout: no handoff stop, the same request's other blocks do not retry, the next request does | `it.each` "after a write error / the write timeout stops nothing; ..." |
| Late write after the 5 s timeout: unlinked, no stop (real store, gated `fs.promises.writeFile`, fake timers) | "a record write that completes after its timeout is unlinked and stops nothing" |
| 3 failed writes: one warn, no handoff stop; the later safety stop runs without a record (no markInvoked, no publish) | "after 3 failed writes: ..." |
| Safety stop whose write fails still stops and sends in memory (B2); warn carries errorType/errorCode only, no handoff text | "a safety stop whose record write fails still stops ..." |
| Release during write: withdraw, no markInvoked, no stop, no publish | "release while the record is written withdraws it ..." |
| Rejected stop: record kept + published; retry reuses it (one write) | "a rejected stop keeps and publishes its record; ..." |
| Rejects x3: one write, kept, one "giving up, record kept" warn, no handoff | "stops rejected 3 times: ..." |
| Release during a rejecting stop: kept, published, no delivery, no retry | top-level "a stop that rejects after release ..." |
| Two in-flight stops of one tool id reserved under different session ids, then rekeyed: one file, one index name, one handoff (real store) | "two in-flight stops of one tool id reserved under different sessions, then rekeyed, ..." |
| `handoffPointer`: live `a.b` / `a_b` each see only their own; released owner, foreign text; no record content | "live sessions `a.b` and `a_b` each see only their own record; ..." |
| `handoffPointer`: A rekeyed to A2 means A's record is own | "a record written under an id later rekeyed is the new id's own" |
| B2 sentence in the class doc comment | "states the safety-stop limit (B2) in the class doc comment" |
| Cleared fallback not resent; record not withdrawn | "background handoff whose fallback notice is cleared is not resent; ..." |

Record, index, files, delivery and hook schedules are covered in their own specs (first
implementer; see `batch-e-progress.md`). Shared: "carries the subagent handoff rule word for word
for %s" (both audiences contain `subagent-handoff`, `status: consumed`).

## S5 assumption

The assumption holds and the writer-map key stays the tool-use id alone.
- Tool-use ids are API-minted `ToolUseBlock.id` values (`@anthropic-ai/sdk` `messages.d.ts`).
- `SubagentRegistryService` is one process-wide `Map` keyed by `toolCallId` alone
  (`libs/backend/vscode-core/src/services/subagent-registry.service.ts:57-60`, `get(toolCallId)` at
  `:379`). Its comments at `:232` and `:774` say that `agentId`, unlike the tool-use id, is unique
  only within a session.
- The monitor's `rekey` merges subagent state by the same tool id.

## Deviations

1. **B2 sentence location.** It was in the file header, and the plan asks for the class doc comment.
   It now sits in the JSDoc directly above the class, and the header points to it. This avoids two
   copies.
2. **Specialist size test.** Adding the same ~640-character rule to both audiences broke "specialist
   block < 0.6 x coordinator" (997+R vs 1995+R). The test now compares the blocks without
   `SUBAGENT_HANDOFF_RULE`. That keeps its intent: the specialist block carries no allocation or
   carrier authoring.
3. **New export `SUBAGENT_HANDOFF_RULE`.** It gives the renderer and its spec one source for the
   rule text. The agent `.md` lines were generated from it (same text).

## Jest commands and results

All commands were run in the worktree, one at a time, in the foreground.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts --coverage=false --maxWorkers=2`: 81 passed, 81 total. The first run had 4 failing tests; they were updated as described above.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts --coverage=false --maxWorkers=2`: 49 passed, 49 total. No change needed.
- Combined agent-sdk run of the record, index, files, delivery, monitor, user-prompt-submit hook and executor specs (same flags): 7 suites, 205 passed, 205 total.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/task-spec.contract.spec.ts --coverage=false --maxWorkers=2`: 97 passed, 97 total.
- `npx jest -c libs/backend/agent-generation/jest.config.ts template-partial-resolver.spec template-sharing.guard.spec --coverage=false --maxWorkers=2`: 308 passed, 308 total.
- `ptah_get_diagnostics` on the monitor, its spec, the contract and its spec: 0 errors.
- Self-check `grep -rnE "retryPending|PENDING_HANDOFF_MAX_RETRIES|undeliveredHandoffNotice|noticeDue|\bmissed\b|handoff-ref|owner-session|notesPath|sendDropped|retryRecord|retryIfMissed|pushRecord|postUndeliveredNotice|PendingHandoff" libs/backend/agent-sdk/src libs/shared/src`
  found no removed symbols. The only hits are unrelated: "missed" in prose elsewhere, and
  `notesPath`, the near-budget warning parameter in `subagent-handoff-message.ts` that the plan keeps.
- Not run (per the rules, they are left to the orchestrator): nx typecheck/lint/test run-many for
  agent-sdk and shared.

## Left undone / observations

- **Guarantee 4 bound vs index rotation (C2, not changed).** `SubagentHandoffIndex.collect` visits
  from the first candidate after the cursor to the end of the list. It does not wrap within one
  prompt; the next prompt wraps to the start. This matches the plan's test schedule ("23 pending:
  10, 10, 3, then wrap"), and the index spec pins it. But when the cursor is mid-list, a record
  before the cursor waits one extra prompt. Example: two records, cursor on the first; the prompt
  names the second plus "1 more". The worst case is `ceil(C/10) + 1` prompts, not the `ceil(C/10)`
  that Guarantee 4 states. Choose one: wrap within a prompt (change the "10, 10, 3" schedule), or
  restate the guarantee as `ceil(C/10) + 1`. The monitor pointer test reads two prompts because of
  this.
- `libs/backend/task-specs` contract guard spec was not run. The plan names no check there; the
  rule text adds no per-task doc filename literal outside the contract module.
