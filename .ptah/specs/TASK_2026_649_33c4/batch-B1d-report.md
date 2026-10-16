# B1d report — context-only Configure preamble

## Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts`: accepts either the existing nonempty-intent Configure request or an explicit `contextOnly: true` request with no intent. Rejects ambiguous or empty-intent requests.
- `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`: wires the workflow-prompt handler to accept the additional request form and pass its parsed data to the composer. The New Project handler and its seed, plugin, and toolchain result were left intact.
- `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts`: composes the same workspace, agent, skill, tool, Apply, and empty-workspace planning context for both forms; omits the User's Intent section for context-only requests. It returns the preamble without sending a visible message.
- `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.spec.ts`: covers old valid and invalid intent forms, context-only acceptance, and ambiguous request rejection.
- `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.spec.ts`: covers context-only delegation while retaining old prompt and New Project coverage.
- `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.spec.ts`: covers context-only preambles for both populated and effectively empty workspaces.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `contextOnly: true` with no `intent` as the new form | Explicit discriminator; empty intent; sentinel intent | `implementation-plan.md:26,33` requires a context-only preamble and retention of nonempty-intent validation. The existing schema required `intent.min(1)` at `harness-rpc.schema.ts:88-91`. | Yes |
| Keep New Project behavior unchanged | Reuse workflow-prompt flow; retain start-new-project handler | `design-spec.md` section 4 specifies a visible New Project intake turn, while Configure waits for a first typed message. Existing `registerStartNewProject` returns seed, plugins, and toolchain. | Yes |

## Verification and remaining work

- No Nx, Jest, TypeScript command, build, serve, or e2e command was run, as instructed. Existing `harness-llm-runner.service.spec.ts` is unchanged and awaits the orchestrator's project test run.
- Scoped `ptah_get_diagnostics` was requested twice for the six changed source/spec files; both requests reported the TypeScript check still running after 45 seconds and returned no diagnostics. Typecheck, lint, and tests remain for the orchestrator.
- The public `HarnessWorkflowPromptParams` in `libs/shared/src/lib/types/rpc/rpc-harness.types.ts` still requires `intent`. That file is outside B1d ownership. A typed frontend caller of the new context-only form needs a shared contract extension in a later owned batch before integration can compile.
