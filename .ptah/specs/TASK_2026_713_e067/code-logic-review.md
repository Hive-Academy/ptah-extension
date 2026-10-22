# Code Logic Review — `TASK_2026_713_e067`

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Failure modes found | 0                                    |

Batch 1 changes only the shared `TOOLING_PRECEDENCE` partial and its resolver guard. The implementation preserves the intended distinction between a catalogue candidate and an assignment, requires host loading rather than name recognition, permits supporting skills after a primary assignment, and separates denial, optional absence, and required absence without granting a bypass.

Evidence quality is **weaker than the preferred independent CLI-lane review**: Grok was the implementer family and this review was completed in-process by the OpenAI Codex family. That is still a different-family review. The normal alternative families were unavailable: Glm/Ollama Cloud returned 429 with an unknown reset, opencode was at limit until 2026-11-04, antigravity returned quota-exhausted 429 with a 103h54m reset, codex and copilot were disabled, and cursor/pi were absent. No delegation was used.

The score is below 10 because the proof is static/resolver-level and does not observe a real host skill invocation (Class L is deliberately out of scope). It is above the 7–8 band because the changed contract is present in all resolved roles, sources remain unduplicated, denial does not authorize the denied work, and the scoped verification evidence reports 286/286 tests passing with zero scoped diagnostics.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept the in-process different-family fallback review | Wait for a quota-blocked external review; review with available OpenAI Codex family | `context.md:29-31` records each unavailable alternative and explicitly permits the fallback; implementer was Grok | Yes |
| Treat host invocation as residual uncertainty, not a defect in Batch 1 | Claim runtime loading; report only static/resolver proof | `batches.md:13-19` defines observed invocation as Class L and out of scope | Yes |

## Five logic questions

### 1. How does this fail silently?

No silent success path was found in the changed contract. The partial explicitly distinguishes an unassigned catalogue candidate from an assignment and says a seen or repeated name is not a load (`tooling-precedence.md:21-23`). The resolver guard verifies all 15 resolved roles receive the key contract phrases while template sources do not duplicate them (`template-sharing.guard.spec.ts:1003-1026`).

Residual uncertainty: the review cannot prove a particular host actually invokes its loader; that is the expressly excluded Class L evidence, not a silent fallback introduced by this batch.

### 2. What user action produces unexpected behaviour?

No unexpected action was found for the batch contract. Assigning a primary skill may still load relevant permitted supporting skills (`tooling-precedence.md:21`), while an unassigned task only selects description- and repository-evidence-matched skills (`tooling-precedence.md:22`). The guard locks both the supporting-skill allowance and the unassigned-entry boundary (`template-sharing.guard.spec.ts:1146-1150`).

### 3. What input data produces a wrong answer?

No wrong-answer input was found. A catalogue listing, repository stack, or recognised name alone is rejected as a selection reason (`tooling-precedence.md:22`); raw placeholders are excluded from the new section (`tooling-precedence.md:19-27`) and asserted absent by the guard (`template-sharing.guard.spec.ts:1125-1142`).

### 4. What happens when a dependency fails?

The three required outcomes are explicit. A denied load or forbidden action is not a bypass and only independent permitted work may continue (`tooling-precedence.md:24`). Optional absence or non-denial load failure is reported and permits only independent allowed work (`tooling-precedence.md:25`). A required missing skill stops dependent work and reports the limitation through the existing blocked-step channel (`tooling-precedence.md:26`). The phrase locks cover denial, optional continuation, and required stop (`template-sharing.guard.spec.ts:904-916`, `1125-1152`).

### 5. What is missing that the requirements never mentioned?

No missing requirement that invalidates Batch 1 was found. Actual runtime loading telemetry remains unavailable, but `batches.md:17-19` explicitly classifies it as out of scope rather than a claimed guarantee. The requirements' relevant edge cases—catalogue versus assignment, supporting skills, host loading, no denial bypass, optional independence, required stop, placeholder preservation, and non-delegating roles—are covered by the partial and guard (`tooling-precedence.md:21-27`; `template-sharing.guard.spec.ts:1003-1026`, `1113-1153`).

## Failure modes

No implementation failure mode is supported by the reviewed diff.

Scope examined: the complete Batch 1 diff in `tooling-precedence.md` and `template-sharing.guard.spec.ts`; the Batch 1 report; the applicable task context, implementation-plan contract, batch requirements, and scoped diagnostics. The test evidence supplied for the completed verification is 286/286 passing; the scoped TypeScript diagnostics report zero errors. Remaining uncertainty is limited to Class L host-level observation, which this batch deliberately does not claim.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None. The review found no correctness issue with file-and-line evidence. Naming, formatting, and prose-style matters are outside this logic review.

## Data flow

1. **Entry — task or role instruction names a skill:** assignment is defined and restricted to the task, role instructions, or an already loaded skill. **OK** (`tooling-precedence.md:21`).
2. **Catalogue-only entry:** descriptions plus repository evidence select permitted candidates only when the task assigned none; listing/name/stack do not imply loading. **OK** (`tooling-precedence.md:22`).
3. **Load boundary:** a listed host skill-loading tool must load the selected skill; memory reconstruction is forbidden. **OK** (`tooling-precedence.md:23`).
4. **Denied/forbidden boundary:** denied load and forbidden action do not permit another path, reconstructed rules, or the denied action; report and continue only independent permitted work. **OK** (`tooling-precedence.md:24`).
5. **Optional failure boundary:** report optional absence/non-denial load failure; continue only independent already-permitted work. **OK** (`tooling-precedence.md:25`).
6. **Required failure boundary:** stop dependent work, report through the role's blocked-step channel, and do not improvise missing rules. **OK** (`tooling-precedence.md:26`).
7. **Expansion:** each template resolves the existing shared partial, fills its declared slots, and rejects unresolved placeholders. **OK** (`template-sharing.guard.spec.ts:926-951`, `1003-1026`).
8. **Non-delegating roles:** the shared contract is present without granting CLI delegation. **OK** (`template-sharing.guard.spec.ts:1113-1122`).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Generic task-based selection instead of name recognition | COMPLETE | None (`tooling-precedence.md:21-23`) |
| Catalogue candidate differs from assignment | COMPLETE | None (`tooling-precedence.md:21-22`) |
| Relevant permitted supporting skills may follow a primary skill | COMPLETE | None (`tooling-precedence.md:21`; `template-sharing.guard.spec.ts:1146-1149`) |
| Actual host loading, not reconstructed rules | COMPLETE | No observed Class L invocation; out of scope (`tooling-precedence.md:23`) |
| Denied load/action has no bypass | COMPLETE | None (`tooling-precedence.md:24`) |
| Optional absence permits only independent work | COMPLETE | None (`tooling-precedence.md:25`) |
| Required missing skill stops dependent work | COMPLETE | None (`tooling-precedence.md:26`) |
| Preserve wizard expansion and template regression coverage | COMPLETE | All-role resolution/placeholder/source-duplication checks (`template-sharing.guard.spec.ts:926-951`, `1003-1026`) |
| Preserve non-delegating role restrictions | COMPLETE | Explicit assertions (`template-sharing.guard.spec.ts:1113-1122`) |

Implicit requirements not addressed: real-world host invocation observation; intentionally Class L/out of scope (`batches.md:17-19`).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Catalogue lists a known skill but task does not assign it | YES | Catalogue/name/stack alone cannot load it | Matching remains judgment-based by design (`tooling-precedence.md:22`) |
| Primary assignment also needs supporting skills | YES | Explicit allowance through the same host mechanism | Supporting relevance is deliberately contextual (`tooling-precedence.md:21`) |
| Host denies a load | YES | No alternate path or denied action; report and limit continuation | Host-level invocation is not observed in this batch (`tooling-precedence.md:24`) |
| Optional skill absent or non-denial load failure | YES | Report; independent permitted work continues | None (`tooling-precedence.md:25`) |
| Required skill absent | YES | Dependent work stops and is reported | None (`tooling-precedence.md:26`) |
| New rule leaks a placeholder | YES | No `{{` in section; resolved bodies checked | None (`template-sharing.guard.spec.ts:1003-1026`, `1125-1142`) |
| Role without CLI delegation receives the rule | YES | Contract remains present without `ptah_agent_list` | None (`template-sharing.guard.spec.ts:1113-1122`) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for Batch 1's static contract and resolver wiring; MEDIUM for host-runtime loading because Class L observation is out of scope.
- Top risk: a host-specific loader could fail to invoke a listed skill despite the generated role instruction, which this static/resolver batch cannot observe.
- What a robust implementation would add: retain the existing guard; in a separately scoped host-integration task, add observed invocation/denial telemetry or deterministic host-harness tests that verify the loader is called and blocked work is surfaced.
