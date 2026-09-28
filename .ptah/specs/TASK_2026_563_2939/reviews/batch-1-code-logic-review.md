# Code Logic Review — `TASK_2026_563_2939`, Batch 1

## Summary

| Metric              | Value                   |
| ------------------- | ----------------------- |
| Overall score       | 8/10                    |
| Assessment          | APPROVED                |
| Blocking issues     | 0                       |
| Serious issues      | 0                       |
| Moderate issues     | 0                       |
| Failure modes found | 0 introduced by Batch 1 |

Scope: the five named agent-sdk files, read in full, and deletion of the memory-curator extract prompt. All paths below are relative to `D:/projects/ptah-extension-memory-quality-source`. Read the task context, Batch 1 requirements, implementation-plan r3 components 1–2 and Gate 2 decisions; traced the unchanged adapter and both schemas in full. No existing code-style review or test report was present. No applicable AGENTS.md, root HANDOFF.md, or CLAUDE.md was found inside the permitted worktree. The supplied project guidance was used.

8 rather than 9: contracts and wiring are auditable, but live-model adherence, durable-fact retention and merge-rate improvement remain unmeasured here. 8 rather than 7: no supported batch defect or missing prescribed assertion was found. Approval covers Batch 1 only, not the task's later evaluation gates or runtime merge guard.

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path is introduced by these string edits. The unchanged adapter does have an inherited limitation: nonempty malformed extraction text becomes `status: 'extracted', drafts: []` (`sdk-internal-query.curator-llm.ts:344`, `:533`), explicitly asserted by the existing spec at `sdk-internal-query.curator-llm.spec.ts:748`. Likewise, invalid individual resolved entries can be skipped while valid siblings survive (`sdk-internal-query.curator-llm.ts:558`). These are outside Batch 1, whose plan explicitly preserves parser/fallback behavior (`implementation-plan.md:292`, `:330`). They prevent promising that every model response will be parseable; they are not regressions attributed to this batch.

### 2. What user action produces unexpected behaviour?

A curation pass over two differently worded subjects is expressly allowed to merge when both memories state the same fact, decision or preference (`resolve-prompt.ts:22`). Different facts sharing a topic are expressly excluded (`:25`), and uncertainty produces null (`:27`). No deterministic new user-action failure was established.

**Specific judgment on lines 1–3:** “refers to the same subject” is ambiguous introductory wording, but it does not say subject keys must be equal. Read together with the explicit “even when the subjects are worded differently” rule and its two-key example (`:23`), it describes semantic subject matter. It therefore does **not** establish an equality restriction or a contradiction with approved D3. Rephrasing the opener as “states the same fact, decision or preference” would reduce ambiguity, but is optional hardening, not an evidenced blocking defect. The implementation follows the plan's exact replacement contract (`implementation-plan.md:320`).

### 3. What input data produces a wrong answer?

Same-topic/different-fact candidates are the principal over-merge risk, and the new text directly excludes them (`resolve-prompt.ts:25`). Candidate IDs discovered through tools but absent from Existing are disallowed twice (`:25`, `:35`). These instructions do not prove model compliance; the runtime guard belongs to a later batch.

For extraction, existing legacy subjects can create tension between exact reuse (`extract-prompt.ts:43`) and the ban on bare app/service names (`:46`). This tension is in the prescribed plan contract as well (`implementation-plan.md:259`–`:262`). Its actual effect on legacy-subject reuse remains a real-session evaluation question, not a demonstrated batch failure.

### 4. What happens when a dependency fails?

The unchanged adapter distinguishes quota and network stalls for extraction (`sdk-internal-query.curator-llm.ts:300`, `:309`), and preserves drafts unmerged for resolve (`:369`). Tool-only and silent extraction runs return no-output (`:327`, `:338`); other query failures throw CuratorLlmQueryError (`:513`). Both prompts retain the host-listed-tools restriction and final-JSON rule (`extract-prompt.ts:77`, `resolve-prompt.ts:36`). The rewrite adds no service, timer, mutable shared state, or network implementation.

### 5. What is missing that the requirements never mentioned?

No new prerequisite was found for the batch's text contract. Model compliance under conflicting legacy keys, empty tool results, and nearly identical but distinct facts needs empirical coverage. The task already assigns real-session extraction and merge replay to later testing (`task-description.md:144`, `:205`); these string assertions cannot substitute for it.

## Failure modes

No introduced failure mode was established. Numbered actionable Batch 1 findings: **none**.

Remaining uncertainty is explicitly limited to model behavior and downstream enforcement. Parser limitations above are inherited context, not counted in the batch verdict. The introductory subject wording merits optional clarification, but the explicit semantic rule resolves its meaning sufficiently to satisfy D3.

## Blocking issues

None in Batch 1.

## Serious issues

None in Batch 1.

## Moderate and minor issues

No new actionable issue established. Existing `sdk-internal-query.curator-llm.spec.ts:660` accesses `.resolves.not.toThrow` without invoking it; that particular assertion does nothing, but it is unchanged from base and adjacent awaited assertions cover the quota outcome (`:617`, `:666`). No existing assertion was weakened by this batch.

The new builder expectation at `resolve-prompt.spec.ts:82` resembles the implementation but still checks argument placement, labels and the JSON-only suffix. It is not self-comparison. The frozen block expectations are independent literal fixtures, verified separately against base (`extract-prompt.spec.ts:11`, `resolve-prompt.spec.ts:11`).

## Data flow

1. **OK:** DI registers SdkInternalQueryCuratorLlm (`libs/backend/agent-sdk/src/lib/di/register.ts:543`). Registration itself is not newly tested by Batch 1.
2. **OK:** extract passes EXTRACT_SYSTEM_PROMPT and the unchanged transcript wrapper to runQuery (`sdk-internal-query.curator-llm.ts:294`).
3. **OK:** resolve bypasses empty inputs, otherwise passes RESOLVE_SYSTEM_PROMPT and serialized drafts/Existing (`:359`, `:363`).
4. **OK:** runQuery forwards systemPromptAppend into execute (`:417`, `:421`). The mock captures the actual config property (`sdk-internal-query.curator-llm.spec.ts:172`); assertions compare it to the imported constants (`:358`, `:376`). Removing dispatch, removing the property, swapping constants, or passing the old prompt fails these assertions. This was traced statically; source was not mutated.
5. **OK with inherited parser limits:** last assistant text is collected (`sdk-internal-query.curator-llm.ts:484`), then parsed with unchanged schemas (`:533`, `:548`). JSON-only instructions remain intact (`extract-prompt.ts:80`, `resolve-prompt.ts:37`).
6. **Later-batch boundary:** the prompt permits only listed targets (`resolve-prompt.ts:25`); this review does not certify runtime candidate membership/workspace enforcement.

## Requirements fulfilment

| Requirement                                            | Status                 | Gap                                                                                                                                             |
| ------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M4.1 topic examples, no catch-all app/service examples | COMPLETE               | `extract-prompt.ts:38`                                                                                                                          |
| M4.2 exact reuse and memory-search guidance            | COMPLETE               | `extract-prompt.ts:43`, `:71`; model compliance unmeasured                                                                                      |
| M4.3 all three exclusion categories                    | COMPLETE               | `extract-prompt.ts:51`; lesson carve-out at `:61`                                                                                               |
| M4.4 one production extract prompt                     | COMPLETE               | One export at `extract-prompt.ts:1`; adapter import at `sdk-internal-query.curator-llm.ts:34`; deleted copy absent, no remaining importer found |
| M4.5 unchanged schema and draft shape                  | COMPLETE               | Both schemas and adapter unchanged against base; prompt block byte-identical                                                                    |
| D3 semantic merge with over-merge exclusion            | COMPLETE               | `resolve-prompt.ts:22`–`:27`                                                                                                                    |
| M3.7 candidate-list restriction, prompt contribution   | COMPLETE               | Both decision and tool sections restrict IDs; runtime enforcement intentionally assigned elsewhere                                              |
| Full M3.7 runtime guarantee                            | PARTIAL in this review | Later-batch guard and its specs not reviewed                                                                                                    |
| Prompt reachability assertions                         | COMPLETE               | `sdk-internal-query.curator-llm.spec.ts:354`, `:362`                                                                                            |
| Real model extraction/merge measurements               | MISSING here           | Later tester deliverable, not a Batch 1 acceptance substitution                                                                                 |

Implicit requirements not addressed: none newly identified within Batch 1.

## Edge cases

| Case                                    | Handled                               | How                                                          | Concern                                    |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| No durable transcript content           | YES                                   | Empty memories allowed, `extract-prompt.ts:51`               | Actual model selection needs evaluation    |
| Durable lesson embedded in task chatter | YES                                   | Carve-out, `extract-prompt.ts:61`                            | Retention measurement pending              |
| Same fact, differently worded subjects  | YES                                   | Explicit example, `resolve-prompt.ts:23`                     | No live-model proof here                   |
| Distinct facts, same topic              | YES                                   | Explicit no-merge instruction, `resolve-prompt.ts:25`        | Runtime guard alone cannot judge semantics |
| Tool-found ID outside Existing          | YES at prompt level                   | `resolve-prompt.ts:35`                                       | Runtime guard reviewed later               |
| Empty draft or Existing list            | YES                                   | Adapter `:359`                                               | Unchanged bypass                           |
| Null/omitted structured fields          | YES                                   | Unchanged schemas: extract.schema.ts:26, resolve.schema.ts:5 | No schema drift                            |
| Tool-only/provider failure              | YES                                   | Adapter `:327`, `:369`                                       | Existing fallback preserved                |
| Malformed final JSON                    | NO for extraction failure distinction | Adapter `:533`                                               | Inherited success-looking empty result     |

## Verification evidence and limits

- Compared both prompt JSON blocks directly to `ebfc73321`: byte-identical, without whitespace normalization of the blocks. Builders unchanged; extract.schema.ts, resolve.schema.ts and adapter unchanged after normalizing checkout line endings.
- Executed all **16 prompt assertion cases** in memory using the worktree's TypeScript transpiler and Node assertions. Passed. This was a small assertion harness, **not Jest or Nx**. The first harness invocation had a syntax error before any assertion; the corrected invocation passed. No harness file was written.
- Read the full adapter spec and diff: additions only, no removed or weakened assertions. Reachability failure proof is static, not a mutation-test run.
- Searched worktree source and non-Markdown files for extract-prompt imports/export: only agent-sdk prompt and its local importers remain. The deleted path is absent.
- `ptah_get_diagnostics` returned **Unavailable: None of the requested files are inside the workspace root**. It did not provide a clean diagnostic result. No workspace-wide fallback was run.
- No Nx/Jest, lint, typecheck or live-model run is claimed by this review. Full Batch 1 verification remains the team-leader/tester gate (`batches.md:160`). Only the requested review artifact was written.

## Verdict

- Recommendation: **APPROVE** Batch 1.
- Confidence: **MEDIUM** overall; high for static text/schema/wiring compliance.
- Top risk: string-level tests cannot establish real-model precision or durable-fact retention.
- What a robust implementation would add: optionally clarify the resolve opener; complete the already-planned same-fact/different-subject and distinct-fact replay, durable-loss audit, and downstream ID/workspace guard checks before approving the entire task.
