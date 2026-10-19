# B01 shared generation contracts

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts` — optional bindings on five existing RPC params; accepted/rejection metadata, source/lifecycle/result facts, and types for three future RPCs.
- `libs/shared/src/lib/types/wizard/phase.ts` — optional bound generation stream/progress/complete/error metadata, including guidance streams; analysis phase shapes retained.
- `libs/shared/src/lib/types/messages/message-constants.ts` — `SETUP_GENERATION_OPEN` constant.
- `libs/shared/src/lib/types/messages/message-type.ts` — strict message literal.
- `libs/shared/src/lib/types/messages/payload-map.ts` — typed host push payload and map entry.
- `libs/shared/src/lib/types/webview-surface.types.spec.ts` — asserts the unchanged `setup-wizard` route ID.
- `libs/shared/src/lib/types/messages/setup-generation-open.contract.spec.ts` — compile-time payload registration and runtime value check.
- `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts` — tabless and bound RPC/envelope compatibility assertions.

Reviewed `webview-surface.types.ts`; its `setup-wizard` surface ID is unchanged. No message registry beyond the named files required an edit. `rpc.types.ts` was not edited and the three new RPC names are not registered.

## New type names

`SetupGenerationWorkflow`, `SetupGenerationTabBinding`, `SetupGenerationRunBinding`, `GenerationContextSource`, `SetupGenerationRunLifecycle`, `SetupGenerationTerminalStatus`, `SetupGenerationAccepted`, `SetupGenerationRejection`, `SetupGenerationResultFacts`, `SetupGenerationRunState`, `EnhancedPromptsCancelParams`, `EnhancedPromptsCancelResponse`, `EnhancedPromptsGetRunStateParams`, `EnhancedPromptsGetRunStateResponse`, `WizardGetGenerationRunStateParams`, `WizardGetGenerationRunStateResponse`, `EnhancedGenerationStreamPayload`, `SetupGenerationOpenPayload`.

## Checks

- Required 13-project `typecheck,lint` run: `NX Successfully ran targets typecheck, lint for 13 projects`; exit 0. Nx Cloud subsequently reported a disabled organization (401), without failing local targets.
- Required shared test run: `Test Suites: 116 passed, 116 total`; `Tests: 3610 passed, 3610 total`; `NX Successfully ran target test for project @ptah-extension/shared`; exit 0. Jest printed an existing worker teardown warning and Nx Cloud printed the same 401 warning.
- After the final spec/envelope edit, scoped `ptah_get_diagnostics`: `Errors: 0 | Warnings: 0 — No issues found`.
- PowerShell has no `tail`, so both commands used `Select-Object -Last 40` for equivalent bounded output. The first literal `| tail -40` attempt failed before Nx executed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep `tabBinding` optional on the five existing methods, with `runId` only for cancel/retry | Required binding or optional binding | Plan D10 and B01 preserve tabless awaited semantics; existing callers typecheck | Yes |
| Use `analysis-result-continue` and `independent-start` as push origins | Combined or independent origin values | Plan decisions and integration flow distinguish analysis Continue from independent starts | Yes |
| Model bound guidance streams separately from analysis streams | Extend analysis stream or use a generation-specific subtype | Plan requires analysis event types intact; guidance uses `setup-wizard:enhance-stream` | Yes |
| Keep a lookup's `runId` optional while requiring tab/workspace identity | Require run ID or allow current tab-run discovery | Plan requires reload recovery and safe no-active-run result; tab/workspace identity is mandatory | Yes |

## Open point

The new RPC names remain intentionally unregistered for B03. The host push has a shared typed payload only; host-to-`ptah.main` targeting belongs to the later host batch.
