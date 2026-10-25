# Task Description Review — `TASK_2026_714_c8a2`

- Revision: round 2 of 2 (final bounded Gate 1 re-review)
- Author side: Grok CLI — requirements authoring
- Reviewer side: independent in-process reviewer
- Scope: only closure of the remaining same-account, same-`CODEX_HOME` effective-configuration isolation finding. Findings 1, 3, and 4 were not reopened.
- Verdict: **APPROVED**

## Basis reviewed

Read the prior round-1 review and the revised portions of `task-description.md` and `parity-inventory.md` relevant to the residual isolation finding. No application code, tests, or unrelated requirements were reviewed in this bounded re-review.

## Closure table

| Prior finding | Status | Evidence | Result |
| --- | --- | --- | --- |
| 1. Preserve selected permissions without silent escalation | CLOSED (not reopened) | Prior review recorded closure; round 2 did not change this requirement. | Outside this bounded re-review. |
| 2. Same-account, same-home effective configuration isolation | CLOSED | `task-description.md:177-187` requires same-home contexts not to change each other's effective MCP configuration, instructions, cwd, or selected approval/sandbox policy. Criterion 4.7 expressly covers two Electron workspaces in stage 1, a workspace and lane plus two lanes in stage 2, requires separate processes or an explicit tested compatibility predicate, prohibits untested sharing, and rejects a two-home-only test. `task-description.md:133-136` records the same architecture-neutral decision. `parity-inventory.md:10-12` independently states the concurrent same-home test and rejects a two-home proof. | The requirement now prevents the exact reload/turn crossover identified in round 1 without prescribing process-per-home. |
| 3. Legacy lane bypass is transitional, not future policy | CLOSED (not reopened) | Prior review recorded closure; round 2 did not change this requirement. | Outside this bounded re-review. |
| 4. Unsupported errors do not establish parity or authorize removal | CLOSED (not reopened) | Prior review recorded closure; round 2 did not change this requirement. | Outside this bounded re-review. |

## Remaining-isolation assessment

The revised criterion is explicit at both requirement and acceptance-test level. It covers all five requested effective configuration dimensions: MCP, instructions, cwd, approval, and sandbox policy. It defines the hostile concurrency case (one authenticated account and one `CODEX_HOME`, differing context inputs), the two operations that must not cause crossover (reload and turn), the stage-specific population to exercise, and the only permitted sharing rule (a separately stated and tested compatibility predicate). It correctly leaves the implementation mechanism to architecture: separate App Server processes are permitted but not required; process-per-home alone is expressly insufficient.

The independently maintained parity inventory corroborates rather than weakens the contract: `parity-inventory.md:12` requires distinct effective configuration through reload or turn for concurrent same-home workspaces or lanes, permits separate processes or a tested predicate, and rejects a two-home test as proof.

## Gate outcome

**APPROVED.** The sole residual finding from round 1 is closed with an enforceable contract and explicit test condition. The gate’s two-round cap is reached; no further Gate 1 review is needed. This approval is limited to task-description completeness for the stated isolation condition, not implementation correctness or runtime parity.
