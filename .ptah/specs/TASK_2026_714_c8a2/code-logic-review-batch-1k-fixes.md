# Code Logic Review - Batch 1k fix round (TASK_2026_714_c8a2)

Scope: fix round for S1, S2, M1, M2, M3 in `libs/backend/codex-runtime/tools/evidence-harness.ts` and `evidence-harness.spec.ts`, plus `spike-runner.ts`. I ran the spec once: 166 pass, 1 fails. I did not run the real binary.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | REVISE (one spec assertion bug; the harness logic is sound) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 1 |

## Finding closure

- **S1 closed.**
  - The identity check at `evidence-harness.ts:1469` compares only top-level `tool`, `toolName` and `_meta.toolName`, and only when present.
  - `tool_title` and `_meta.tool` no longer take part in the comparison. A value that is present and not `write_marker` is still rejected.
  - The thread, server and `approvalRounds` checks stay in place.
- **S2 closed.**
  - `turnId` and `_meta` use `.nullish()` (`:357`, `:366`).
  - The turn check at `:1470` is `params.turnId != null && params.turnId !== turnId`. A non-matching non-null id is still rejected, and the check is not loosened beyond null.
  - The null turn id is recorded as a note (`:1481`).
  - The local `!turnId` guard still rejects the request if the harness has no turn id yet. That is the same as before.
- **M1 closed.**
  - Each required name must be an own property of `requestedSchema.properties` with `{type:'boolean'}` (`:1474-1478`). Any other required type, such as a string, throws and the catch declines.
  - The accept content is `Object.fromEntries(required.map(n => [n, true]))`. Optional fields are omitted.
  - This matches the schema's free-form `content` object.
  - Required names are sanitized and capped at 80 characters in the note.
  - Order of operations: all validation runs before `approvalRounds += 1` and before the hold, so a rejected request leaves no state change.
- **M2 closed.** `mode: z.literal('form')` (`:359`) rejects `url`, `openai/form` and `openaiForm`. The rejection is a schema-correct `{action:'decline'}`, because the id is in the `elicitations` set (`:652`, `:750`).
- **M3 closed.**
  - `config.mcp_servers.marker` is parsed with `safeParse`, so an absent or differently shaped config yields `{}` and only a note (`:1844-1850`).
  - A throw happens only when the key is present and not `'prompt'` (`:1851`).
  - The check runs before `thread/start`.

Safety not loosened, traced by code path:

| Case | Result |
| --- | --- |
| Another server | Rejected by the `serverName` literal. |
| Second elicitation | Rejected by `approvalRounds !== 0`. |
| Elicitation in a non-mcp case | Rejected by `item.kind !== 'mcp'`. |
| Non-matching non-null turn id | Rejected. |
| Required non-boolean field | Rejected. |
| URL or openai form modes | Rejected. |
| Each of the above | Throws inside the try, and the catch answers with a schema-correct decline. |

## Findings

### Moderate: the new config-wrong spec fails (`evidence-harness.spec.ts:2287`)

- The test asserts `result.notes` contains `'Effective config differs from bounded profile'`.
- `result.notes` actually holds only `["Initialize: experimentalApi=true ..."]`.
- `failure` is defined and no `thread/start` was sent, so the harness behaves correctly. The throw message goes to the failure channel, not `notes`.
- This is a spec bug. The case is not green, so the gate would block, and the claim "fixed and verified" is unproven.
- Fix: assert on the failure (its message or its sanitized form), not on `notes`. Keep the `thread/start` and writes assertions.

### Minor: the report says "not execution-verified"

That was accurate. The one failing spec above is the result of that gap.

## Runner consistency

- `spike-runner.ts` selects `schema-handshake` (0), `modified-input-schema` (0), `mcp-approval` (1), `ask-command-edit` (1) and `ask-read-rule` (1). Planned turns are 3 and the cap is 4.
- The runner requires `cost < CAP`. `runHarness` (`:2056-2062`) requires `plannedTurns <= cap` and computes `worstCaseTurns` as planned plus one for each command case with `decision === 'edit'`. That is 3 + 1 = 4, within the cap.
- The runner sets `--turn-cap` itself and rejects a user-supplied one, so the preflight and the runner agree.
- The case ids all exist in `evidence-cases.json`.
- `mcp-approval` carries `kind` `mcp`, so the elicitation path applies to it.

## Verdict

REVISE. Fix the one assertion at `evidence-harness.spec.ts:2287`, rerun the spec once, and the batch is APPROVED. No harness or runner change is needed.
