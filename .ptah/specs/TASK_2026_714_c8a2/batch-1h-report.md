# Batch 1h report

## Summary

Implemented the two observed usage bounds and the ask-command-edit evidence flow in the existing development harness. Added fake-process regression specs, retained runtime TURN_CAP enforcement, and recorded steer response, turn identity, new-turn notifications and post-steer usage evidence.

## Files changed

Paths relative to the supplied worktree. Line ranges describe the affected areas, including supporting existing code.

- `libs/backend/codex-runtime/tools/evidence-harness.ts`: 43?44 (limits), 64?76 (observed turn accounting), 318?365 (decision/result shapes), 435?461 (usage accounting), 1100?1607 (edit flow and usage observations), 1649?1871 (candidate scheduling and reports).
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`: 1?49 (imports), 1156?1181 (usage regressions), 1352?1514 (fake-process edit and bound specs).
- `libs/backend/codex-runtime/tools/evidence-cases.json`: 27?35 (new case), 89?94 (compaction bounds description).
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts`: 18?20 (allowlisted bound failures and missing-steer label).
- `.ptah/specs/TASK_2026_714_c8a2/batch-1h-report.md`: this deliverable.

## TurnSteerParams shape used

Quoted from `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`, definition `v2.TurnSteerParams`, starting at line 25233:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "clientUserMessageId": {
      "type": [
        "string",
        "null"
      ]
    },
    "expectedTurnId": {
      "description": "Required active turn id precondition. The request fails when it does not match the currently active turn.",
      "type": "string"
    },
    "input": {
      "items": {
        "$ref": "#/definitions/v2/UserInput"
      },
      "type": "array"
    },
    "threadId": {
      "type": "string"
    }
  },
  "required": [
    "expectedTurnId",
    "input",
    "threadId"
  ],
  "title": "TurnSteerParams",
  "type": "object"
}
```

The request sends `threadId`, `expectedTurnId`, and `input: [{ type: 'text', text, text_elements: [] }]`. It omits optional `clientUserMessageId`. The adjacent `TurnSteerResponse` requires a string `turnId`; the harness parses that response with Zod. `turn/steer` is present in the pinned manifest's client requests (line 118), and the case also checks the supplied manifest before starting its child.

## Behavior of the edit case step by step

1. Use the existing ask policy: read-only sandbox, granular approvals, user reviewer, and experimentalApi initialization opt-in. Generate original and replacement commands with the same markerCommand helper and confined marker writer.
2. Start one charged turn requesting the original command. Validate the first approval against that exact command, its thread and cwd, and preserve the approval hold and marker-absence checks.
3. Decline the original. Do not count this decline as success or interrupt. Immediately send turn/steer with the active turn ID as its precondition and a prompt naming only the replacement command.
4. Parse the response and record success, same/new response turn, and any newly started turn notification. A bounded RPC error is recorded as `turn/steer refused: RPC error <code>`, followed by interrupt/abort without another model request.
5. Require the second approval to match only the replacement command. Repeated-original and unrelated commands fail with Unexpected command and existing sanitized command-shape evidence. Accept only after the replacement remains absent during the approval hold.
6. Permit up to two tool items for this case. Edited command item notifications are permitted only after steer was sent. Original and outside marker effects always fail; replacement effects fail until the second acceptance.
7. Observe replacement present and original absent, interrupt, and require two approvals plus successful steer for the observed outcome. Retain the case deadline, child cleanup and path checks.
8. Record usageByTurn and usageAfter snapshots. Charge a newly observed turn once, whether first seen in the steer response or notification. Report whether steer stayed in the same turn or started a new one.

## Specs added (names)

- per-turn bound stops subsequent observations with a distinct message
- cumulative bound stops subsequent observations with a distinct message
- attributes thread cumulative increments to separate turns without double counting
- declines, steers with schema params, accepts replacement and observes only its marker
- rejects a second approval repeating the original command
- fails cleanly with the RPC code when turn/steer is refused
- inspect rejects the original marker even after replacement approval
- charges a new steer turn once and records its separate usage
- %s usage bound fails the active case and latches the run stop gate (per-turn and cumulative)
- keeps observed steer turns in the count even when they exceed the cap
- declares ask-command-edit with one planned turn

## Decisions

- **Strict greater-than bounds.** Exactly 15000 per turn and 100000 cumulative remain allowed; crossing either stops further inference. Alternative: greater-than-or-equal. Evidence: user wording ?more than? and ?passes.? Reversible constants/comparisons.
- **Thread totals with turn attribution.** Preserve monotonic thread cumulative usage and assign its increments to the notification's required turnId, rather than summing repeated cumulative snapshots or treating each model-request `last` breakdown as a whole turn. Evidence: pinned ThreadTokenUsage/ThreadTokenUsageUpdatedNotification schema and existing cumulative usageSummary. Reversible accounting implementation; delayed/missing provider usage remains an evidence limitation.
- **Candidate list may exceed TURN_CAP.** Remove the planned-sum rejection, keep the eight-turn runtime gate, and mark later candidates not run. Alternative: reject the entire default run or increase TURN_CAP. Evidence: existing list had eight planned turns; this required case adds one, and steer may itself consume another slot. The explicit cap must remain. Reversible preflight decision.
- **Charge observed unexpected turns honestly.** An already-started ninth turn is counted as nine and fails the cap gate rather than being hidden from accounting. New requests still cannot claim beyond eight. Alternative: suppress the observed charge. Evidence: user requirement to keep accounting honest; a response/notification arrives after the server has acted. Reversible accounting method.
- **Retain original command item identity for completion events.** Both expected original item notifications and, after steering, edited item notifications can pass identity checks; the second approval accepts only the edited command. Evidence: declined original items can finish after steer; original marker effects remain forbidden. Alternative: reject every original completion after steer. Reversible predicate.
- **Direct runCase test seam.** Export the existing harness function for fake-child specs rather than extract a parallel state machine. Evidence: existing RpcChild fixtures and the requirement to exercise actual approval/inspect behavior. Reversible export; no production registration or module changes.

## Not done / risks

- Tests, lint, prettier, build, package installation and live App Server/model runs were not executed. The orchestrator must run the scoped specs; their outcomes are not claimed.
- The backend role explicitly required ptah_get_diagnostics after edits, overriding the requested no-checks restriction for that tool. It reported source `typescript-compiler`, initially identified a fixture cast issue that was corrected, and the final scoped result was zero errors and zero warnings. No standalone typecheck command was run.
- Usage tests exercise active-case failure and the sticky run-stop budget; they do not perform an end-to-end artifact-producing runHarness execution with later-case assertions.
- Usage is observed after the turn and may lag provider billing. One turn can overshoot; these are not provider-enforced spending limits. A server-created extra turn can only be stopped after it is observed.
- No git commands were run. No files outside the authorized sources/spec and named report were written.
