# Code Logic Review — `TASK_2026_563_2939`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

Scope: the four named PR #601 fix-up files, read in full, plus migration 0048, RPC validation and targeted caller/handler inspection. Approval covers inspected logic only, not the entire PR or outstanding evaluation gates. Paths below are relative to D:/projects/ptah-extension-memory-quality-source.

## Five logic questions

### 1. How does this fail silently?

No new silent failure established. The fixture now supplies both columns referenced by quarantine-aware readers (apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:119). Its pre-existing native-module availability guard can skip the suite (:308), so a successful test command alone would not prove execution.

### 2. What user action produces unexpected behaviour?

None established in the fix-up. A search returning a legacy key such as "ptah" now explicitly requires a specific topic key instead; valid keys remain reusable (libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:47). TOOLS applies the same restriction (:74). Suppressing already-remembered content is distinct from choosing a subject for new content.

### 3. What input data produces a wrong answer?

No new case established. An explicit false selector is excluded by the wire type (libs/shared/src/lib/types/rpc/rpc-memory.types.ts:176) and rejected by z.literal(true) (libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts:145). Missing or multiple selectors still fail the runtime refinement (:147).

### 4. What happens when a dependency fails?

Restore validation produces INVALID_PARAMS before accessing the store; store exceptions produce PERSISTENCE_UNAVAILABLE rather than a fabricated restored count (libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:828, :858). Native SQLite load failure skips the existing integration suite (apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:316). Prompt text cannot guarantee model compliance; its spec checks wording, not live-model behaviour (extract-prompt.spec.ts:99 in the agent-sdk adapter directory).

### 5. What is missing that the requirements never mentioned?

No additional fix-up requirement established. Ongoing handwritten fixture drift remains possible because bookkeeping marks every migration applied without validating its schema (apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:173). This is a residual fixture limitation, not a defect introduced by adding the two correct columns.

## Failure modes

No supported new failure mode. Current schema/prompt/type code was inspected; caller references were searched throughout apps and libs. Read existing task requirements, relevant plan sections, context, verification evidence and prior style review. No AGENTS.md or applicable CLAUDE.md was found; CONVENTIONS.md was read.

Verification limitations: no git operations were performed because the reviewer role prohibits them. Consequently the uncommitted diff and direct ebfc73321 comparison were not inspected. A native read-only string comparison confirmed the current schema block equals the frozen BASE_SCHEMA_BLOCK, but does not independently authenticate that fixture against the commit. Scoped ptah_get_diagnostics returned unavailable because the files are outside its workspace. No tests, build or compiler run was executed; prior task results do not validate these current edits.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

No numbered defect findings. Numbered verification observations:

1. Fixture types/nullability/defaults match exactly: nullable INTEGER and TEXT without defaults at wizard-seed.integration.spec.ts:119, matching libs/backend/persistence-sqlite/src/lib/migrations/0048_memory_quarantine.ts:19. New rows therefore remain active.
2. SUBJECTS and TOOLS consistently restrict reuse to permitted keys at extract-prompt.ts:47 and :74. Regression assertions cover both statements and ordering at extract-prompt.spec.ts:90 and :99.
3. all?: true agrees with runtime validation and the handler's literal selector construction at rpc-memory.types.ts:176, memory-rpc.schema.ts:145 and memory-rpc.handlers.ts:856. Repository search found no production caller passing a general boolean; this is static inspection, not compiler proof.

## Data flow

1. OK: fixture creates columns before seeding migration bookkeeping (wizard-seed.integration.spec.ts:253).
2. OK: resolved writer/store exercise inserts, listings and stats (:263, :358, :379).
3. OK: production extraction references this prompt (libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:295); valid existing subjects can be reused, forbidden ones replaced (extract-prompt.ts:47).
4. OK: restore params undergo schema validation, workspace authorization, selector construction and error-wrapped store invocation (memory-rpc.handlers.ts:828, :844, :851, :858).

## Requirements fulfilment

| Requirement                                 | Status   | Gap                                                                           |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Fixture matches 0048 columns                | COMPLETE | Static comparison; integration not run                                        |
| Consistent conditional subject reuse        | COMPLETE | Wording checked; model compliance not evaluated                               |
| Schema byte-identical to ebfc73321          | PARTIAL  | Current block equals frozen spec fixture; direct commit comparison prohibited |
| all narrowing matches Zod, no broken caller | PARTIAL  | Matches inspected references; compiler unavailable                            |

Implicit requirements not addressed: none within this bounded fix-up.

## Edge cases

| Case                                       | Handled | How                                                      | Concern                                            |
| ------------------------------------------ | ------- | -------------------------------------------------------- | -------------------------------------------------- |
| Existing forbidden subject                 | YES     | Explicit replacement rule, extract-prompt.ts:50          | Model compliance not deterministic                 |
| Existing valid subject                     | YES     | Exact reuse, extract-prompt.ts:49                        | None established                                   |
| all false / missing / conflicting selector | YES     | Literal and refinement, memory-rpc.schema.ts:145         | Wire interface still relies on runtime exclusivity |
| Native SQLite absent                       | YES     | Explicit suite skip, wizard-seed.integration.spec.ts:319 | Must inspect skip counts                           |
| Store failure                              | YES     | Typed RPC error, memory-rpc.handlers.ts:864              | No new failure introduced                          |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: historical schema identity and current executable verification remain unconfirmed.
- What a robust implementation would add: independent base-commit comparison and scoped execution with evidence that the native integration suite actually ran.
- Score rationale: 8/10 because the three fixes agree with their inspected contracts and no defect was established; 9–10 is unsupported without historical and executable verification. No evidenced functional gap warrants the 5–6 band.

Artifact note: the role mandates this task-root code-logic-review.md; the requested reviews/pr601-fixes-code-logic-review.md was not written. No source, git state, main checkout or live state directory was modified.
