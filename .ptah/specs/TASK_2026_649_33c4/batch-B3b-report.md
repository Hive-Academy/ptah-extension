# B3b implementation report

## Files changed

- `libs/frontend/harness-builder/src/lib/services/harness-helper.service.ts` (new): serial typed RPC requests for all eight assigned helpers; busy/result/scoped-error signals; explicit `addToPreview` commit callback; field-preserving agent, skill and MCP merges; generated document remains separate until Add. Search/create-skill are intentionally absent.
- `libs/frontend/harness-builder/src/lib/services/harness-helper.service.spec.ts` (new): covers one request at a time, explicit Add, document Add, scoped RPC error and failed commit retention.
- `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts`: accepts an explicit config/document for the new builder while preserving the old no-input state path; renders empty, restoring, unavailable, failed and restored states; card checkbox aria-labels; document viewer and Copy.
- `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.spec.ts` (new): covers empty and populated content, legacy fallback, new-input document isolation, card labels, copy and restore Retry.

## Verification

- Ptah AST analysis of all four changed TypeScript files returned `parseStatus: ok`, zero error nodes.
- Nx, Jest, TypeScript, build and diagnostics were not run, as instructed. The orchestrator owns those checks.

## Decisions

1. **Addition ownership:** helper `addToPreview` accepts a caller commit callback, rather than injecting the legacy builder state. Evidence: B3b is additive, B3a owns tab-keyed records, B4c owns old state/stream changes. The callback lets the owning store persist the selected result before the helper clears it. Reversible: yes.
2. **MCP suggestions:** `suggest-config` and `analyze-intent` return query-only `McpServerSuggestion` entries as addition metadata, rather than inventing server URLs. `discover-mcp` returns installable `McpServerEntry` values for the MCP preview. Evidence: `rpc-harness.types.ts` defines suggestions with query/displayName/reason and server entries with name/url. Reversible: yes.
3. **Document treatment:** generated documents remain in a viewer with Copy; the helper's explicit Add passes the document to the owning preview store. Evidence: B3b acceptance requires explicit Add and Copy, while design-spec.md §5.5 requires a viewer. Reversible: yes.
4. **Preview compatibility:** absent new inputs use the legacy state; once an explicit config input is supplied, the legacy document cannot leak into that preview. Evidence: B3b requires compatibility until B4c and tab isolation. Reversible: yes.

## Not done

- Sidebar wiring, tab-keyed persistence of additions/documents, and new builder integration are owned by B3a/B4c. The caller must pass additions to its preview store and pass the resulting config/document to this component.
- Typecheck, lint and Jest results are pending orchestrator verification.
