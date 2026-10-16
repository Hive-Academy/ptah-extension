# Batch 38a report

Workspace: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-result-budget.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tool-handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tool-handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\agent-tool.dispatcher.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`

## Evidence

1. Logic S-1: `namespace-builders/agent-namespace.builder.ts:325-357` previously built Ptah CLI spawn metadata without routing fields while the system CLI path spread the request at `:393-404`. Now `:333-334` passes `taskKind` and `routingSource` to `spawnFromSdkHandle`. Spec `namespace-builders/agent-namespace.builder.spec.ts:328`: **forwards taskKind and routingSource to the SDK handle spawn**.
2. Logic S-2: `mcp-core/tool-result-budget.ts:90,128` previously capped route JSON at 24,000 chars and marked it preformatted, so the common budget step could cut it to an invalid prefix. Now `:83,92` shares the limit with `mcp-core/route-tool-handlers.ts:103-108`, which returns a short error before either transport budgets an oversized result. Spec `mcp-core/route-tool-handlers.spec.ts:114`: **returns a tool error for an over-budget 100-phase route result**. Its 100 chosen phase entries serialize to **54,375 UTF-16 characters**; the fixture is above the 24,000-character budget.
3. Logic S-3: `ptah-api-builder.service.ts:1216` previously supplied an empty root; `mcp-core/tools/outcome-report.tool.ts:101` then resolved it to process cwd. Now `outcome-report.tool.ts:73-74` rejects a missing session workspace before lookup or writing; `:103-104` rejects a missing filesystem only for deliverables. Spec `mcp-core/tools/outcome-report.tool.spec.ts:111`: **returns a tool error without writing when the session workspace is unavailable**. It checks the error reply, no pipeline submission, unchanged journal, and no store row.
4. Style S1: `mcp-core/protocol-dispatcher.ts:2803-2878` and `mcp-stdio/agent-tool.dispatcher.ts:215-263,397-419` previously carried separate outcome error formatting, fallback filesystem stubs, and logger adapters; the builder repeated the adapter at `ptah-api-builder.service.ts:1217-1222`. Now `mcp-core/tools/outcome-report.handler.ts:16-60` owns the reply, fallback dependencies, and logger adapter. HTTP delegates at `protocol-dispatcher.ts:2806-2815`, stdio at `agent-tool.dispatcher.ts:345-358`, and the builder uses the same adapter at `ptah-api-builder.service.ts:1217`. `route-tool-handlers.ts:44` exports the sole Zod issue formatter, reused by the handler and HTTP dispatcher. The fallback filesystem stub is removed because `OutcomeReportDependencies.fileSystem` is optional and the tool guards it on the deliverables path.

## Decisions

- **Oversized route result:** Chose a well-formed tool error over increasing the budget or returning a compact roster. The 100-phase fixture measures 54,375 characters (`route-tool-handlers.spec.ts:114-152`), over twice the previous 24,000-character limit (`tool-result-budget.ts:83,92`). The result schema also permits free-form reason text (`libs/backend/lane-routing/src/lib/contracts/route-decide-result.schema.ts:117,152`), so a fixed budget increase cannot guarantee all results fit. This is reversible by adding a documented compact response later.
- **No workspace:** Chose a tool error when collaborators exist but no session workspace resolves (`outcome-report.tool.ts:70-74`). Keeping the existing store-unavailable reply first preserves the no-store behavior (`:71-72`), while an available store cannot write against process cwd. Reversible by changing the reply policy without migration.
- **Shared outcome handler:** Chose a handler beside the tool, following `mcp-core/route-tool-handlers.ts:23-31,91-108`; both transports still render their own MCP envelopes. Optional filesystem replaces the unused 13-method fallback (`outcome-report.tool.ts:20,103-104`). This is a local, reversible refactor.

## Verification and outstanding work

- `npx prettier --write` completed for all 11 changed source/spec files; each reported unchanged after formatting.
- No Nx, Jest, tsc, eslint, build, serve, e2e, or package verification was run, per Batch 38a's serialized verification rule. The orchestrator owns those checks.
- Scoped `ptah_get_diagnostics` was requested after edits; its TypeScript source returned **unavailable** after 45 seconds with seven files unchecked. It did not report a clean pass. No retry was made.
- No known implementation items remain; automated verification remains with the orchestrator.
