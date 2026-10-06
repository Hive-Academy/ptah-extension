# Review — `2290819ad`

## Summary

| Metric                           | Value     |
| -------------------------------- | --------- |
| Score                            | 7.0/10    |
| Verdict                          | REVISE    |
| Blocking / Major / Minor defects | 0 / 1 / 0 |
| Failure modes found              | 1         |

The commit closes six of the seven requested follow-ups. It is not ready to approve because a `binding: true` model is still silently skipped when ACP does not advertise its config ID. That contradicts the binding contract and can run a turn on the agent default instead of the selected model.

This is above the 5–6 band because the matcher, parser, auth discrimination, model-setting writes, and help derivation all meet their stated contracts and both affected project suites pass. It is below the 8 band because the remaining gap silently defeats a core model-selection invariant at an external-protocol boundary.

## Required checks

| #   | Check                                                                                                   | Result   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Binding config entries fail on rejection; hints downgrade; runner has no vendor-specific ID             | **FAIL** | Rejected advertised binding entries do fail (`acp-session-handle.ts:475,504-523`), and a non-binding rejection becomes info (`:519-522`; spec `acp-session-handle.spec.ts:665-683`). However, a missing advertised option is skipped for both kinds (`acp-session-handle.ts:475-481`), despite the binding contract saying it is sent even when unadvertised (`acp-vendor-profile.ts:28-30`) and Grok marking its model binding (`grok-acp-profile.ts:132-138`). No vendor-specific ID remains in the runner. |
| 2   | Grok free-usage limit matcher is narrow and has no fabricated reset time                                | PASS     | The matcher recognizes `subscription:free-usage-exhausted` and the stable portion of the live wording, independent of apostrophe form (`lane-limit-classifier.ts:62-63,156-158`). It is registered only for `grok` (`:167-175`) and returns no `resetsAt`.                                                                                                                                                                                                                                                    |
| 3   | `parseGrokModels` rejects prose/footer rows but accepts normal Grok rows                                | PASS     | The row boundary requires end, a recognized separator, or a column gap (`grok-cli.adapter.ts:47-54`); IDs must be model-shaped and not labels (`:56-80`). Parsing remains limited to indented rows under `Available models:` (`:105-135`), accepting `grok-4.7` and `grok-4.7 - frontier model`.                                                                                                                                                                                                              |
| 4   | Grok auth wording recognizes the two auth messages and leaves unrelated `-32000` errors generic         | PASS     | `AUTH_WORDING` matches `Authentication` and `auth method` only (`grok-acp-profile.ts:53-54`); it is additionally gated by `-32000` (`:82-90`), after which non-matches fall through (`:105-107`).                                                                                                                                                                                                                                                                                                             |
| 5   | Shared model validation/trim preserves every key, write order, non-string rejection, and empty clearing | PASS     | All seven `AgentSetConfigParams` model fields are represented in source order (`agent-rpc.handlers.ts:74-83`; contract `rpc-agents.types.ts:227-240`), pre-write validation rejects any non-string (`:85-92,483-493`), and the same ordered loop trims every present value (`:541-545`). `''.trim()` remains `''`, preserving clear semantics.                                                                                                                                                                |
| 6   | Router help derives the same text from `CLI_AGENT_SELECTORS`, including Grok                            | PASS     | Help targets filter only the separately-described `glm` alias from `CLI_AGENT_SELECTORS` (`router.ts:156-162`); both help strings use that result (`:741-744,779-782`). The selector list derives from `SYSTEM_CLI_TYPES` plus `ptah-cli`/`glm` (`agent-cli.ts:91-95`), so it includes Grok and preserves the prior displayed order.                                                                                                                                                                          |
| 7   | No env/argv logging; no `as any` or `@ts-ignore`; type-only imports are type imports                    | PASS     | The commit diff adds no logging sites and contains no added `as any` or `@ts-ignore` (diff scan). Changed type-only imports use `import type`, e.g. `acp-vendor-profile.ts:13-15`, `acp-session-handle.ts:22-34,39-55`, and `agent-rpc.handlers.ts:19-23,28-31,49-64`.                                                                                                                                                                                                                                        |

## Defects

1. **Binding model can be silently ignored when the agent omits the option — Major**

   - Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp/acp-vendor-profile.ts:28-30` defines binding as sent even for an unadvertised value. But `acp-session-handle.ts:475-481` emits an info and `continue`s before the request for every absent option, including `binding: true`. Grok supplies exactly such a binding model entry at `grok/grok-acp-profile.ts:132-138`.
   - Impact: A user selecting a model can receive a successful turn from Grok's retained/default model, with only an informational segment. The runner neither verifies the requested model nor fails the turn, so model choice is silently violated.
   - Fix: Branch on `binding` before the absent-option `continue`: send the binding `session/set_config_option` request even without advertised metadata, and propagate its rejection through the existing failure path. Add a regression test with no advertised `model` option that asserts the request is sent and a rejection produces exit code 1 with no `session/prompt`.

## Five logic questions

1. **How does this fail silently?** An unadvertised binding model is treated as a hint and the prompt proceeds after an info (`acp-session-handle.ts:475-481`), potentially on the wrong model.
2. **What user action produces unexpected behaviour?** Configure/request a Grok model when a CLI/ACP version does not advertise `model`; the lane succeeds rather than refusing the unhonoured selection (`grok-acp-profile.ts:132-138`, `acp-session-handle.ts:477-481`).
3. **What input data produces a wrong answer?** An ACP `configOptions` array missing `{ id: 'model' }` produces a normal prompt rather than a failed bound-model setup (`acp-session-handle.ts:476-481`).
4. **What happens when a dependency fails, times out, or returns an unexpected shape?** A rejected advertised binding fails through `AcpTurnFailure` (`acp-session-handle.ts:504-523`); a rejected hint is safely downgraded. The missing-option shape is the exceptional unhandled boundary above. The Grok quota matcher otherwise returns owner evidence without inventing a reset (`lane-limit-classifier.ts:156-158,222-245`).
5. **What is missing that the requirements never mentioned?** A test for an unadvertised binding option. Existing tests cover a rejected advertised binding and missing non-binding option, but not the binding-specific missing-option boundary (`acp-session-handle.spec.ts:598-663,694-710`).

## Verification and residual uncertainty

- Read the full commit diff plus the requested fix and phase-2 re-review reports; traced the changed ACP, Grok, classifier, parser, RPC, router, and shared configuration contracts.
- `npx nx test @ptah-extension/cli-agent-runtime`: PASS, 104 suites / 2,164 tests passed (Nx cache result).
- `npx nx test @ptah-extension/rpc-handlers`: PASS, 145 suites / 4,270 tests passed (Nx cache result).
- Targeted TypeScript diagnostics for `acp-session-handle.ts`, `agent-rpc.handlers.ts`, and `router.ts` remained unavailable after two scoped checks because the compiler service did not finish; this is not evidence of clean diagnostics.

## Verdict

**REVISE.** Fix the binding/missing-advertisement branch and add its regression test. No blocking defect was found; the other six requested checks pass with the cited evidence.
