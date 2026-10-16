# B1e — pinned workspace proposal saves

## Files changed

- `libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts` — adds an optional pinned workspace root to capture and save, preserving existing callers.
- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` — validates explicit roots and uses them for capture and persistence without consulting the active provider root. The existing provider fallback remains for calls without a root.
- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts` — covers saving under a caller root while the active provider points elsewhere, skipping provider reads, and rejecting invalid explicit roots before a write.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` — resolves the caller root once per proposal invocation, forwards it with the frozen turn to save, and warns once per namespace when no caller root resolves.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts` — checks the forwarded root and the single warning on fallback.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` — passes the pinned root to store capture and save; no longer discards attribution because the active root differs.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts` — checks root forwarding through both calls even after an active workspace switch.

## Decisions

- **Optional root parameter:** options were a required root everywhere or an optional final parameter. Existing store callers use the four-argument save contract and provider fallback; the optional final parameter preserves them. Reversible: yes, after all callers supply a root.
- **Invalid explicit root:** options were silent normalization or rejection. The design requires a normalized, absolute pinned root, so the store rejects empty, relative, unnormalized, padded, and NUL-containing roots before filesystem access. Reversible: yes.
- **Missing caller root:** options were failing proposals or preserving provider fallback with a warning. The batch explicitly requires today's behavior and one log; the namespace warns once and passes no root so the store uses the provider. Reversible: yes.

## Verification

- `ptah_ast_analyze` parsed all seven changed TypeScript files with zero syntax errors.
- Nx, Jest, TypeScript, diagnostics, build, serve, and e2e were not run, as directed; the orchestrator owns those checks.

## Not done

- No work outside B1e ownership. Proposal reads still use the provider root as specified.

## Orchestrator fix

- `harness-proposal-store.service.spec.ts:159-164`: the throwing `jest.fn` mock was typed `Mock<never>` and failed ts-jest (TS2352) when cast to `IWorkspaceProvider`. The mock now returns `string | undefined` and the provider wraps it in a plain function, as the other mocks in the spec do. Test-only.
