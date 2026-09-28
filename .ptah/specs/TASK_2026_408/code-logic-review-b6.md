# Code Logic Review — `TASK_2026_408`

Verdict: APPROVED
Score: 8/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found in Batch 6 | 0 |

Scope: Batch 6 in `D:/projects/ptah-extension-task-408`. All six named files were read in full, along with the two request translators, downgrade, name guard, all seven direct provider subclasses, the LM Studio subclass, and OpenCode route table. Read context, Batch 6 requirements, component 7, prior Batch 5 review, CONVENTIONS.md and CONTRIBUTING.md. No applicable AGENTS.md/CLAUDE.md, task-description.md, or Batch 6 code-style-review.md was found. The existing style review concerns Batches 7–8.

Locations below are relative to `libs/backend/auth-providers/src/lib/` unless otherwise stated. `base` means `translation/translation-proxy-base.ts`; `translator` means `translation/responses-request-translator.ts`; `downgrade` means `translation/responses-tool-output-images.ts`.

The 8/10 score reflects complete capability wiring, conservative inheritance, and HTTP regression evidence (`base:567`, `base:726`, `providers/codex/codex-stream-parity.spec.ts:267`, `providers/opencode/opencode-translation-proxy.spec.ts:472`). No demonstrated runtime defect justifies the 5–6 band. The minor byte-parity coverage gap and unverified live compatibility prevent a 9–10 score.

## Five logic questions

### 1. How does this fail silently?

No new silent failure was found in the capability gate. Non-Codex image loss is disclosed in the output placeholder (`downgrade:17`, `downgrade:32`), while Codex retains the translated array (`base:567`; `providers/codex/codex-translation-proxy.ts:148`). The downgrade changes only function outputs, leaving user-message images intact (`downgrade:25`). “No input_image” in the HTTP fixture applies to its tool-only image payload, not every possible request.

Existing residuals remain: unsupported nested block types are skipped (`translator:409`, `translator:451`), and an empty failed result loses its error marker because the string is falsy (`translator:458`). Batch 6 explicitly pins these semantics instead of changing them (`translation/responses-request-translator.spec.ts:569`). They are not counted as new Batch 6 defects.

### 2. What user action produces unexpected behaviour?

Switching the same screenshot-producing tool from Codex to OpenCode deliberately changes an image array into explanatory text (`base:567`). This is the requested capability policy. Returning a document-only result or an empty failed result retains the residual behavior above. Chat Completions tool results still discard nested images and emit a text-only `role: 'tool'` message (`translation/request-translator.ts:289`, `:300`); they never construct Responses `function_call_output` arrays and never execute this hook (`base:598`). That limitation is outside the requested change.

### 3. What input data produces a wrong answer?

No supported image/text input was found to bypass the gate. Image arrays with unsupported-media placeholders become strings for non-Codex providers (`downgrade:32`); empty arrays become empty strings and text arrays join with newlines (`translation/responses-tool-output-images.spec.ts:83`). Call IDs and item order survive because the downgrade maps in place order and replaces only `output` on a copied item (`downgrade:24`, `:37`). Malformed nested input, such as an image without `source`, can still throw during translation (`translator:414`); the outer request handler sends a 500 before headers (`base:305`). This existing validation limitation does not produce a success-looking downgraded request.

### 4. What happens when a dependency fails?

The gate/post-pass is synchronous and introduces no external dependency or persistent state (`base:567`; `downgrade:21`). A first 401 invokes recovery; successful recovery retries once, retaining the already-selected `responsesRequest` and reverse name map (`base:873`, `base:1046`). Failed recovery returns an authentication error (`base:1057`); a second 401 follows the upstream-error path (`base:1110`). Timeout sends 504 before headers or terminates the active response (`base:1188`). No image fallback is silently applied after an upstream rejection.

Serialization is repeated by the forwarding method, but the image representation is not recomputed (`base:791`, `base:875`). Codex's stream flag can be recalculated if its auth service changes endpoints between attempts (`base:784`); unchanged-endpoint retries retain the same body, and capability selection remains unchanged either way.

### 5. What is missing that the requirements never mentioned?

Live endpoint acceptance is not established by local HTTP captures. The override documents pinned Codex 0.155.1 evidence and removal of the override as rollback (`providers/codex/codex-translation-proxy.ts:141`); component 7 explicitly accepts that evidence level (`.ptah/specs/TASK_2026_408/implementation-plan.md:303`, worktree-relative). General document support and empty-error semantics remain outside the image-only contract (`translator:409`, `:458`). The new pass adds one traversal/allocation per non-Codex Responses request, including text-only requests, but retains no session-growing state (`downgrade:24`, `:39`).

## Failure modes

No new failure mode was demonstrated within Batch 6. Reviewed request entry, protocol selection, translation, collision rejection, capability selection, serialization, authentication retry, and provider HTTP fixtures. Residual content omission and live compatibility uncertainty are identified above, not relabelled as new defects.

## Blocking issues

None found in Batch 6.

## Serious issues

None found in Batch 6.

## Moderate and minor issues

1. **Minor — exact byte-preservation coverage is narrower than the contract.** File: `providers/codex/codex-stream-parity.spec.ts:255` and `:292`; `providers/opencode/opencode-translation-proxy.spec.ts:491`. Codex captures raw upstream strings but parses them before returning them to the retry assertion, proving structural equality rather than byte equality. Its text-only assertion checks one result inside a mixed-image request (`:281`), not a complete text-only request. OpenCode's full text-only byte comparison covers Zen only, while its retry byte comparison covers Go (`:527`). Impact: a future serialization-only change could escape these specific assertions. Recommendation: retain raw Codex bodies and compare them directly; parameterize the full text-only HTTP parity case across both OpenCode subscriptions and add Codex. This is non-blocking coverage advice: current source preserves field order and untouched strings (`downgrade:28`, `:39`; `base:791`).

## Data flow

1. **OK:** validate the Messages envelope, normalize the model, and choose the provider's protocol (`base:441`, `:476`, `:482`). Unknown routes return 400 before forwarding (`base:483`).
2. **OK:** native Messages returns before translation; Chat Completions uses its separate translator (`base:498`, `:547`, `:598`).
3. **OK:** Responses translation emits image-bearing tool outputs as arrays and text-only outputs as strings (`translator:404`, `:447`).
4. **OK:** guard tool definitions/function-call names and reject collisions before any upstream call (`base:554`, `:560`). Name guarding touches function calls; image downgrade touches function outputs, so ordering is safe (`translation/responses-tool-names.ts:77`; `downgrade:25`). The reverse map remains paired with the request (`base:574`).
5. **OK:** the base defaults to false; Codex alone opts in (`base:726`; `providers/codex/codex-translation-proxy.ts:148`). Selection occurs once before forwarding (`base:567`).
6. **OK:** downgrade preserves IDs, other input items, tools, and request fields; the pass is pure and repeat-safe (`downgrade:28`, `:37`, `:39`). No shared mutation between concurrent requests is introduced.
7. **OK:** forwarding serializes the selected request and retries with the same object and name map (`base:791`, `:873`).

### Complete provider inventory

| Provider class | Responses reachability | Image policy / evidence |
| --- | --- | --- |
| CodexTranslationProxy | All models | Arrays; `providers/codex/codex-translation-proxy.ts:130`, `:148` |
| OpenCodeTranslationProxy (Zen and Go) | Catalog Responses routes | Inherited false; `providers/opencode/opencode-translation-proxy.ts:68`, `base:726` |
| CopilotTranslationProxy | None | Always Chat; `providers/copilot/copilot-translation-proxy.ts:108` |
| OpenRouterTranslationProxy | None | Always Chat; `providers/openrouter/openrouter-translation-proxy.ts:102` |
| SakanaTranslationProxy | None | Always Chat; `providers/sakana/sakana-translation-proxy.ts:107` |
| CustomOpenAiTranslationProxy | None | Inherits Chat; `providers/custom/custom-openai-translation-proxy.ts:89`, `base:643` |
| LocalModelTranslationProxy / LmStudioTranslationProxy | None | Inherits Chat; `providers/local/local-model-translation-proxy.ts:37`, `:189`, `base:643` |

OpenCode policy applies to all catalog Responses models, not only GPT. Both `gpt-5.6-luna` entries select Responses (`libs/shared/src/lib/providers/entries/opencode-model-routes.ts:79`, `:139`, worktree-relative). No other production override of the capability hook was found under providers.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Default false and Codex-only true | COMPLETE | `base:726`; Codex `:148` |
| Guard before downgrade, downgrade before forwarding | COMPLETE | `base:554`, `:567`, `:572` |
| Non-Codex Responses arrays become placeholders | COMPLETE | `downgrade:24`; OpenCode HTTP spec `:472` |
| Retry retains chosen representation | COMPLETE | `base:873`; Codex spec `:289`; OpenCode spec `:511` |
| Text-only request bytes preserved | COMPLETE by source inspection | HTTP coverage gap in finding 1; no baseline diff performed |
| Pinned-evidence comment and rollback | COMPLETE | Codex `:141` |
| Edge fixtures carried from Batch 5 | COMPLETE | Translator spec `:569`; downgrade spec `:83` |
| Chat/native lanes unaffected by hook | COMPLETE | `base:498`, `:598` |

Implicit requirements not addressed: live Codex acceptance and general nested-content support, as scoped above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing/empty result and empty error | YES, preserved | Translator spec `:569` | Empty error remains unmarked |
| Unknown nested blocks, with/without image | YES, pinned | Translator spec `:580`, `:592` | Unknown content is omitted |
| Unsupported image or text-only array | YES | Downgrade spec `:83` | Placeholder text preserved |
| Multiple images and call IDs | YES | Downgrade spec `:45`, `:150` | Order preserved |
| Name collision before image processing | YES | `base:560` | 400, no forwarding |
| Repeated/concurrent requests | YES | Request-local copies, `downgrade:24` | No new shared mutable state |
| Very large valid input | YES, linear pass | `downgrade:24` | Additional per-request allocation; no new size policy |
| 401 with recovery | YES | `base:1046`, `:873` | OpenCode recovery enabled only by test subclass |

## Verification

- Ran once from the requested worktree: `nx run-many -t test -p @ptah-extension/auth-providers --outputStyle=static`, using the installed local Nx binary, daemon/cache/cloud disabled. **52 suites, 1,271 tests, 2 snapshots passed; exit 0.** Output was tailed. An ES-module configuration warning appeared, but the test target completed successfully.
- HTTP specs use a real Codex proxy with fake auth and a loopback upstream (`providers/codex/codex-stream-parity.spec.ts:225`, `:243`). OpenCode uses a subclass of the real proxy, retaining actual routing and capability behavior while substituting a loopback origin (`providers/opencode/opencode-translation-proxy.spec.ts:21`, `:35`, `:257`). Both capture actual HTTP request bodies.
- OpenCode's successful retry is synthetic: `authRecovers = true` enables base retry mechanics (`providers/opencode/opencode-translation-proxy.spec.ts:524`), while production `onAuthFailure()` returns false (`providers/opencode/opencode-translation-proxy.ts:55`). The test does not prove real OpenCode credential refresh.
- Scoped `ptah_get_diagnostics` returned **Unavailable: None of the requested files are inside the workspace root**. No clean diagnostics claim; no separate lint/typecheck run.
- No live provider calls, external network requests, git operations, or source edits. No baseline diff was inspected. Only this deliverable was intentionally written.

## Verdict

- Recommendation: APPROVE Batch 6.
- Confidence: HIGH for capability routing and retry representation; MEDIUM for actual provider compatibility.
- Top risk: live Codex acceptance of the image-array wire format remains unproven (`providers/codex/codex-translation-proxy.ts:141`).
- What a robust implementation would add: the raw-byte HTTP coverage in finding 1; a separately authorized provider compatibility probe. No production correction is required by this review.
