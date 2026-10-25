# P1-F finding 1 — scoped fix review

Verdict: APPROVED

Review family: codex (OpenAI) reviewing Claude (Anthropic) implementers

Reviewed commit `4688e76c37ac8769a03a9472a5c50b403ddbac99` using `git show 4688e76c3 -- libs`, plus `p1f-review-fix-round.md`. Approval applies only to finding 1 (dropped Grok/Antigravity effort settings). Other findings remain deferred under D40 and were not re-reviewed.

## Findings

No remaining defect identified in this scoped fix.

- `libs/frontend/core/src/lib/services/providers-commit.service.ts:161`: both `grokReasoningEffort` and `antigravityReasoningEffort` join the existing orchestration operation field list alongside Claude/Pi. They therefore use the same write/read-back mechanism; neither requires a separate persistence path. The supplied write-path notes describe the existing undefined-only omission check, which preserves `''` as an explicit inherit/default write.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:784`: both keys are projected directly from the configuration response, exactly like the neighboring Claude/Pi fields. Direct projection preserves explicit values, empty strings and absent/undefined values without introducing a fallback that masks stored state.
- `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts:816`: four success cases cover each key alone with explicit and empty values. Exact call assertions require one `agent:setConfig` write with the correct key/value, a read-back request, and the saved field identifier. Four negative cases require failure/unsaved status when an explicit requested value reads back differently or is absent. Without the field-list fix, the exact-write assertions fail; the negative assertions also require an unsaved field that an omitted operation cannot supply.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:2043`: refresh asserts Grok `'high'` and Antigravity `''` in the projected state. Without the projection fix, both asserted properties are missing, so the regression test fails. This test covers one value per provider rather than every provider/value combination; the direct symmetric assignments and commit tests cover the scoped behavior adequately.

## Coverage and validation limits

| Changed file | Diff reviewed |
| --- | --- |
| `libs/frontend/core/src/lib/services/providers-commit.service.ts` | Yes |
| `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts` | Yes |
| `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` | Yes |
| `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts` | Yes |

Static review only: no tests, builds, lint or type checks were run. Test failure sensitivity was assessed from the assertions, not by execution. Unchanged operation internals and backend persistence were not independently re-read in this intentionally diff-only round; the existing write-path description supplies that context. No source files were edited.
