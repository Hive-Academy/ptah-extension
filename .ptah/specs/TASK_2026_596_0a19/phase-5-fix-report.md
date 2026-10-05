# Phase 5 fix report: TASK_2026_596_0a19

This round fixes the two Moderate findings in `phase-5-code-review.md`. The three Minor findings are untouched, as instructed. I edited only `libs/backend/vscode-lm-tools/**`.

## Finding 1: empty roster appended a "Plan limits" table with no rows

- **Change.** `formatAgentList` in `mcp-core/mcp-response-formatter.ts` now leaves out `### Plan limits` when `agents.length === 0`. With limits present, an empty roster now gives exactly what design-spec.md §5.1 lists: the existing "No agents found…" text, then the roles line, then the full alternatives section ("No lanes are available to list…" and all four `none` groups). Without `limits` the output is the same byte for byte as before.
- **Spec.** In `mcp-core/mcp-response-formatter.spec.ts`, the test "formatAgentList keeps an empty roster to the design §5.1 text, with and without limits" checks two cases:
  - Without limits: no Plan limits section and no alternatives section.
  - With `[]`: the exact full string, compared with `toBe`.

## Finding 2: `ptah_agent_list` called `agent.limits` without a guard

- **Change.** Both transports now send the list call through the same helper that already guards the spawn path. That helper is `lookupAgentLimits` in two places:
  - `mcp-core/protocol-dispatcher.ts`: a module function.
  - `mcp-stdio/agent-tool.dispatcher.ts`: a private method.

  The helper now takes optional `rows`. The list tool passes in the roster it already has. The spawn tool passes nothing, so the helper fetches a fresh roster inside the same `try`. Any throw, whether a rejected promise or a synchronous throw, gives `undefined`. That means the list falls back to the existing no-limits output, which is the same fallback the spawn path uses.
- **Side effect.** If `agent.limits` is not wired, the spawn path no longer calls `agent.list()` at all. Optional-call short-circuiting skips the argument. Before, that roster result was fetched and then thrown away. The spawn output does not change.
- **Spec.** I added a `ptah_agent_list when the limit lookup throws` block to `mcp-core/agent-spawn-limits.transport.spec.ts`. It covers protocol and stdio, each with a rejecting and a synchronously throwing `agent.limits`. In all four cases the result is not an error and its text equals `formatAgentList(rows, roles)` exactly, with no `Limit state` column.

## Constraints kept

- **R8:** the new text and specs add no brand names.
- **No `limits`:** output is unchanged; both changes apply only when `limits` is present.
- **Guard specs:** the existing guard specs still pass, including the 19/19 run of `agent-limit.formatter.spec`, the vendor-roster drift spec and the contract sweep.
- **Prettier:** all five changed files are already formatted ("unchanged").

## Verification

- Focused run: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts agent-spawn-limits.transport mcp-response-formatter.spec` gave 2 suites and 179/179 tests passed.
- Full run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools` gave "Successfully ran targets typecheck, test, lint" with all three targets passing. Nx Cloud printed a 401 warning that its org is disabled; it does not affect the local result.

## Files changed

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts`
