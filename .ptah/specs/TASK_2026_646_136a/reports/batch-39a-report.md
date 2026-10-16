# Batch 39a report

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-39a-report.md`

Paths below are relative to the workspace root.

## Resolved assumptions and item evidence

1. **M-2:** Before: `agent-namespace.builder.ts:222-223,333-334,398-406` checked only effort and forwarded both metadata fields on the Ptah CLI and system CLI branches. The public constants are `libs/shared/src/lib/types/lane-outcome.types.ts:17-39`; the outcome write contract consumes the same constants at `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:19,21,46,56`. After: `agent-namespace.builder.ts:199-211,239-243` rejects unsupported values with the field name and allowed values before either branch can spawn. Valid values continue through both branches.
2. **M-6 / style M4:** Before: `outcome-report.tool.ts:112-130` used `checkLaneDeliverable`, a `Number.NaN` sentinel, and a second stat; all stat errors could become `exists: false`. The filesystem `stat` contract exposes `size` and `mtime` at `libs/backend/platform-core/src/types/platform.types.ts:41-47`, and the held report stores a string payload at `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:19-27`. After: `outcome-report.tool.ts:68-72,126-165` makes one stat call per valid path. ENOENT/ENOTDIR become missing facts; other stat errors return `{recorded:false, reason}` naming the path before submission. The stored check shape remains `exists`, `bytes`, `mtimeMs`.
3. **M-8:** Before: `outcome-report.tool.ts:107-110` accepted drive-relative `E:foo` and threw for rejected paths. After: `outcome-report.tool.ts:127-139` rejects drive-relative and UNC paths with `win32` checks, and rejects paths resolving outside the workspace using `relative`; it returns the standard failure result without stat or write.
4. **Style S1:** Before: `outcome-report.tool.ts:40-60` hand-wrote a loose JSON input schema. The source contract is the discriminated Zod union at `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:13-31`; the existing conversion pattern is `route-tools.ts:92-107`. After: `outcome-report.tool.ts:33-66,79-82` converts both Zod branches to JSON Schema and merges their properties and shared required fields. The tool publishes the source enum values and source path/ID constraints.

## Spec cases added

- `agent-namespace.builder.spec.ts:193`: `rejects invalid taskKind on %s before spawning and names allowed values` (system, ptahCliId).
- `agent-namespace.builder.spec.ts:214`: `rejects invalid routingSource on %s before spawning and names allowed values` (system, ptahCliId).
- `agent-namespace.builder.spec.ts:236`: `forwards valid taskKind and routingSource through the system CLI branch`. Existing `forwards taskKind and routingSource to the SDK handle spawn` at line 393 covers the Ptah CLI branch.
- `outcome-report.tool.spec.ts:118`: `publishes taskKind and routingSource enums from the outcome contract`.
- `outcome-report.tool.spec.ts:128`: `stores an ENOENT deliverable as missing`.
- `outcome-report.tool.spec.ts:142`: `returns recorded false for EACCES without storing a report`.
- `outcome-report.tool.spec.ts:340`: `rejects escaping deliverable path %s without a stat or write` (`../outside`, `E:foo`, UNC path).
- Renamed the valid-path privacy case to `does not persist source paths for valid deliverables` at `outcome-report.tool.spec.ts:360` after moving rejection into its own parameterized case.

## Decisions

- **Validate at the builder entry.** Options: builder validation or sanitizing later in the recorder. The batch assigns builder validation, and both spawn branches share the entry at `agent-namespace.builder.ts:237-243`. Reversible: yes.
- **Use one direct stat for report facts.** Options: expand the shared `checkLaneDeliverable` contract in another library or stat directly in the owned tool. The batch limits writes to vscode-lm-tools, while `checkLaneDeliverable` returns no mtime (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:113-139`). Direct stat preserves the stored fact shape. Reversible: yes.
- **Derive the MCP schema from each Zod union branch.** Options: maintain a manual schema, flatten a generated union, or merge generated branch schemas. `OutcomeReportArgsSchema` is a discriminated union (`lane-outcome.schema.ts:13-31`); MCP requires a top-level object (`mcp-protocol.types.ts:115-129`). Merging branch properties retains enum and bound details with shared `kind` and `target` requirements. Reversible: yes.

## Verification and remaining work

- Ran `npx prettier --write` on the four changed source/spec files; it exited 0.
- Did not run Nx, Jest, tsc, eslint, build, or `ptah_get_diagnostics`: batch rule 3/4/5 reserves verification for the orchestrator while a heavy build is in flight. Thus test pass status and typecheck status remain unverified here.
- No other source files or task state files were changed by this batch.
