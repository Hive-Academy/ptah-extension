# Test Report - TASK_2026_441_7825 (Batch 8: lanes-first walkthrough)

Date: 2026-10-13. Executor: orchestrator in-process (batches.md Batch 8 `Subagent reason`: the
walkthrough needs the live Gate 0.1 tools in the session that owns Gate 0.1).

Method: every row cites a live tool response or a recorded run event from session 1 (Phase 1) or
session 2 (Phases 2-3). A rule that exists only as prose is marked NOT EXERCISED, never PASS.

## Static checks (run in session 2)

| Check | Result |
| --- | --- |
| `npm run validate-skill` | PASSED, 9 files, 0 errors, 0 warnings |
| `npm run manifest:check` | up to date, 230 files, `sha256:ac5814cf…` |
| mcp-bench Jest (5 specs) | 5 suites, 72 tests passed |
| `nx typecheck chat-ui`, `nx typecheck mcp-bench` | success |
| `team-leader-template.policy.spec.ts` | 4/4 pass (session 1, unchanged since) |

## Walkthrough

### AC1 - No pin: batches and reviews go to lanes; every subagent executor has a reason - PASS

Input: Gate 0.1 mode `enabled`, no pinned roster (decisions.md #1, #24).

| Work | Executor | Reason when not a lane |
| --- | --- | --- |
| Plan, plan revision 2 | codex lane | - |
| Batches 1-4, 4F | codex lanes | - |
| Batches 5, 5F, 6, 6F | codex lanes 93144bc3, 91d7415a, e281eeb4, 7ffb65c6 | - |
| Phase 1 review and re-reviews | Glm lane (Ollama Cloud) | - |
| Phase 2 review and re-review | antigravity lane 8c3e55b1 / d9841568 | - |
| Team-leader | subagent | Owns `batches.md` state and commits; lanes never commit (decisions.md #11) |
| Batch 7 | in-process | One version string and one script run (decisions.md #31) |
| Batch 8 | in-process | Needs live Gate 0.1 tools (batches.md Batch 8) |
| Plan document review | Claude subagent | Cross-side review of a codex-written plan (decisions.md #2) |

### AC2 - No same-family code review without a stated reason - PASS (same-family case NOT EXERCISED)

- Phase 1: implementers codex; reviewer Glm (decisions.md #14). Phase 2: implementers codex;
  reviewers opencode (stopped), then antigravity (decisions.md #24, #28).
- Orchestrator post-cap correction R1 (Claude): reviewed by Glm, a non-Claude family (decisions.md #20, #22).
- In-process case with reason and label: Batch 7 and Batch 8 (table above).
- A same-family review never ran in this task, so the "weaker evidence" label path was not exercised live.

### AC3 - Gate 0.1 reads memory first - PASS for hit and conflict; unavailable NOT EXERCISED

`ptah_memory_search {query: "user preference CLI agent lanes vs subagents execution"}` (session 2), sanitized:

| memoryId (ULID order = age) | Subject | Preference |
| --- | --- | --- |
| `01M1MBZ6…` (oldest) | ptah-execution-mode | lanes (Ptah CLI) |
| `01M40WPH…` | cli-lane-token-burn | disable lanes when they burn a large share of Codex quota |
| `01M4S61P…` (newest) | implementation-lane-preference | lanes by default, cross-family review, subagents only as fallback |

- Hit: lanes preference found before the mode was set.
- Conflict: `cli-lane-token-burn` contradicts the others. Rule (`checkpoints.md:169-171`): current
  explicit instruction wins, else the most recent unambiguous preference. The user's current
  instruction ("Lanes-first, Gate 0.1 = enabled") and the newest memory agree -> `enabled`. The notice
  names the conflict (this row). Result: `enabled`, as expected.
- Unavailable: memory was available in both sessions; the `preference unknown` path was not run.

### AC4 - Usage limit -> fallback -> later batches skip the lane - PARTIAL

- AT LIMIT row with a reset time (session 1, live): `ptah_agent_list` showed
  `grok | AT LIMIT (Weekly 100%, resets 2026-10-13 17:40 UTC)` (context.md CLI Lanes).
- Skip: grok was excluded for the whole run (decisions.md #3) and was never spawned in any batch.
- Not exercised: no lane hit a limit mid-run, so the fallback order (`other family same capability`
  -> `same family other provider/model` -> `subagent`) never ran on a real limit reply, and no
  "reset unknown" row appeared. Session 2's list showed every lane as `unknown` limit state.
- Related non-limit path, exercised live:
  - Glm Phase 1 review stopped by the runtime (`repeat-call`, non-limit failure 1 of 2) -> resumed once
    on the same lane, then delivered (decisions.md #15, #16).
  - opencode Phase 2 review: 46 min, no deliverable, stopped on the user's instruction -> next eligible
    non-codex family (antigravity) delivered in 1m 12s (decisions.md #28).

### AC5 - A queued message runs as a second turn after `delivered` - PASS

Session 1, lane 03b5aa15 (plan revision 2): a context message queued with `ptah_agent_message` ran as a
second lane turn after the first `delivered` signal and edited the plan again. The orchestrator told
the round-2 reviewer to re-read the plan (decisions.md #9). The rule is now in agent-lanes §4. Session
2 put all instructions in each spawn and queued no follow-ups.

### AC6 - Fleet: two disjoint tasks, a resumed artifact, a read-only judge - NOT EXERCISED

No fleet run took place. Static evidence only: `references/fleet.md` (plugin), `fleet-fix.js` resume
checkpoints (`implementation.json`, `judge-round-N.json`) and the read-only judge prompt, reviewed and
APPROVED (`code-logic-review-phase2.md` Round 2). A live fleet run needs a real two-task fleet and is
outside this task's budget.

## Verdict

| AC | Result |
| --- | --- |
| 1 | PASS |
| 2 | PASS (same-family label path not exercised) |
| 3 | PASS (hit, conflict); unavailable not exercised |
| 4 | PARTIAL (AT LIMIT + skip live; limit fallback order not exercised) |
| 5 | PASS |
| 6 | NOT EXERCISED (static review only) |

No FAIL. No code fix batch is needed. The NOT EXERCISED and PARTIAL items need live conditions (a lane
that hits a limit mid-run, memory down, a real fleet). They are user-visible gaps, not defects.
