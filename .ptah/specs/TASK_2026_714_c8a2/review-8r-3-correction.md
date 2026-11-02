# Review 8r-3 correction

Verdict: REVISE
Score: 6/10
Review family: kimi-code (implementer: codex correction on grok batch)

## Prior findings status

| Prior finding | Status | Evidence |
| --- | --- | --- |
| 1. Explicit native Claude CLI resolution | Still open | The resolver branch is gone, but the replacement uses the ambient auth env for every explicit scope at `config-rpc.handlers.ts:695-709`. A different active provider can still rewrite the native workspace's saved Claude ID. The spec at `config-rpc.handlers.spec.ts:1384-1427` covers only an empty shared env. See defect 1. |
| 2. Models-list materializes session resources | Resolved | The correction removes the workspace profile resolver from this path. The scope capture now performs synchronous settings, cache, tier, and env reads. It does not call `ProviderProxyPool.acquire`, start watchers, or refresh credentials. |

## Defects

1. **Major — a current-scope reply can contain the previous workspace's auth resolution and catalog.**
   - **Locations:** `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:526-527,695-709`; `libs/frontend/core/src/lib/services/model-state.service.ts:274-275,302-317`; `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:280-286`.
   - **Failure scenario:** Workspace A is active, and its provider populates the shared auth env. The user switches to workspace B. The frontend scope changes to B immediately, but the auth refresh is still pending. A new tab calls `refreshModels()` at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1127` before that refresh finishes.
   - The handler reads B's provider and saved model. It then snapshots A's auth env and starts the ambient SDK catalog reads. For example, B is a native `claude-cli` workspace with saved `claude-haiku-4-5`. A's env contains `ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o`. `ModelResolver.resolve` rewrites B's saved ID to `gpt-4o` at `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:39-46`.
   - When auth finishes, the coordinator calls non-fresh `refreshModels()`. `ModelStateService` joins the existing B request instead of starting a corrected read. The reply echoes B, so the generation, scope, and path checks all pass. The frontend accepts the A-influenced selection and catalog.
   - The coordinator rationale covers replies from a scope that the user already left. It does not cover this request. This request names the current B scope from its start. The explicit-scope specs also use only a shared env that matches the requested provider. They do not exercise this mismatch.
   - **Required correction:** Make the resolution env and catalog reads belong to the requested scope without restoring proxy or credential side effects. Alternatively, prevent pre-auth model reads and force a fresh read after auth. Add a regression case where the explicit provider differs from the provider in the shared env.

## Notes

- The shallow env snapshot occurs before both catalog awaits. Later env writes cannot mutate the captured resolution values. The remaining defect is scope correctness, not mutation of that snapshot.
- The specs pin active-scope reads, explicit-scope provider and saved-model reads, pre-await snapshots, and echoed paths. They do not pin an accepted reply with mismatched ambient and requested providers.
- Zod validates the new RPC parameter. Invalid input and a missing scope resolver produce logged errors. I found no new silent error path in the correction.
- I found no new `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable` in the correction. The handler uses the injected logger.
- `config-rpc.handlers.ts:509-512` still mentions an explicit-scope workspace profile. That implementation no longer exists. This is a documentation nit.
- Read-only review only. I did not run tests, lint, typecheck, build, verify, or diagnostics, as instructed.
