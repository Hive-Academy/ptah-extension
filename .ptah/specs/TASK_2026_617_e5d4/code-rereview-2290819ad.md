# Re-review — `2290819ad` working-tree correction

## Summary

| Metric                           | Value     |
| -------------------------------- | --------- |
| Score                            | 9.0/10    |
| Verdict                          | APPROVED  |
| Blocking / Major / Minor defects | 0 / 0 / 0 |
| Failure modes found              | 0         |

The correction closes the previously reported Major defect without weakening the non-binding/hint path. It restores the documented binding invariant: a binding configuration entry is sent whether or not the ACP agent advertised that option, and a refusal prevents any prompt.

## Verification

| Check                                                       | Result          | Evidence                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unadvertised binding is sent                                | PASS            | The missing-option skip now requires `!binding` (`acp-session-handle.ts:475-483`); the request is consequently built and issued with `advertisedValues: []` (`:495-513`). The regression test asserts the config request and subsequent prompt (`acp-session-handle.spec.ts:686-703`). |
| Unadvertised binding rejection fails the turn               | PASS            | Binding errors are rethrown rather than downgraded (`acp-session-handle.ts:518-523`). The new test proves exit 1, no prompt, one error, and process kill (`acp-session-handle.spec.ts:705-724`).                                                                                       |
| Non-binding behavior remains a hint                         | PASS            | An absent non-binding option still emits info and continues (`acp-session-handle.ts:477-481`); invalid advertised string values remain skipped only when non-binding (`:484-493`); rejected non-binding requests remain info-only (`:518-522`).                                        |
| Grok error for an unadvertised rejected model is actionable | PASS            | Empty advertised values select the existing `grok models` guidance (`grok-acp-profile.ts:91-101`).                                                                                                                                                                                     |
| Static validation                                           | PASS            | Scoped TypeScript diagnostics for `acp-session-handle.ts` and its spec: 0 errors, 0 warnings.                                                                                                                                                                                          |
| Project verification                                        | PASS (reported) | The orchestrator reported `typecheck,test,lint` passing for `@ptah-extension/cli-agent-runtime`, with 2,166 tests. This re-review did not rerun the suite.                                                                                                                             |

## Five logic questions

1. **Silent failure:** Closed. The previous unconditional absent-option skip is now limited to hints (`acp-session-handle.ts:477-481`).
2. **Unexpected user action:** Selecting a model against an ACP version that does not advertise `model` now sends the bound selection rather than silently using a default (`:475-513`).
3. **Wrong-answer input:** An empty/missing `configOptions` array now produces either an acknowledged model setting or a failed lane, not a success-looking wrong-model prompt (`:483,518-523`).
4. **Dependency failure or malformed response:** A binding rejection propagates through the existing turn-failure path; a Grok invalid-params response with no advertised list gives a concrete recovery command (`grok-acp-profile.ts:91-101`).
5. **Missing requirement:** None found in the correction scope. Both previously absent boundary cases are now explicitly covered (`acp-session-handle.spec.ts:686-724`).

## Defects

None located.

## Verdict

**APPROVED.** The working-tree correction closes Major defect 1 and introduces no evidenced new defect. The 9.0 score reflects focused, behavior-level regression coverage and clean scoped diagnostics; it is not a 10 because this re-review did not independently execute the full project suite.
