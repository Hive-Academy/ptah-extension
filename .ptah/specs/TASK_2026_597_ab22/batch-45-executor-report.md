# Backend implementation — `TASK_2026_597_ab22`, batch 45

**Verdict**: `NO-OP: deferred` (AS-N4 STOP rule). No Ptah-owned memory, symbol or orchestration text reaches a Claude subagent. The only Ptah-owned text that does reach a subagent (MCP server `instructions` and the `ptah_*` tool schemas) is the same text the parent session gets, on the same MCP connection. Trimming it would also trim the parent session. No code was changed.

**Tasks completed**: 45.1 (static attribution). 45.2 not started, as the STOP rule requires.

## Task 45.1 — attribution

### How Ptah-owned text gets into a Claude session

1. **System-prompt append (main session only).** `SdkQueryOptionsBuilder.buildSystemPrompt`
   (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1675-1763`) joins `sessionStartBlock`,
   `corpusPrimeBlock`, `memoryBlock`, `codeSymbolBlock` and `assembleSystemPrompt(...)` (`:295-329`). That last part holds the
   identity prompt, `PTAH_CORE_SYSTEM_PROMPT` (`:310`), the user system prompt, the output-style body and the enhanced prompts.
   The whole string is returned as `{ type: 'preset', preset: 'claude_code', append }` (`:1758-1762`) and becomes
   `Options.systemPrompt` (`:1203`). This is the parent thread's `--append-system-prompt`. A Claude Code subagent builds its
   own system prompt from its agent definition body plus environment details. It does not inherit the parent's
   append. Ptah adds no other route: there is no `agents:` option in the builder (grep found only `settingSources` at
   `:1254`) and no `additionalContext` anywhere in `libs/backend/agent-sdk` (grep, non-spec). The only `SubagentStart` hook is
   registry bookkeeping (`subagent-hook-handler.ts:135-300`) and injects no text.
2. **MCP handshake and tool list (shared).** `handleInitialize` returns one byte-stable `instructions` string for every
   caller (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:325-346`, `:343`).
   `handleToolsList` (`:385`) varies only by `resolveMcpToolProfile(request)` (`mcp-tool-profile.ts:16-24`, from
   `_callerToolProfile`, which is set per session config). It does not vary by thread. Subagents use the parent CLI
   process's MCP client, so they get exactly the same `instructions` and `tools/list` as the parent. The server has nothing
   that tells a subagent request apart from a parent request.

### Table

Sizes were measured with `ptah_count_tokens` on the built strings. A temporary jest spec in vscode-lm-tools wrote them to
disk; the spec and its output were deleted afterwards, and `git status` shows no code change.

| Part of the first request                                                    | Source (file:line)                                                                                           | Ptah-owned               | Tokens                                                                    | Reaches subagent?              | Reaches main?             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------- | ------------------------------ | ------------------------- |
| Claude Code built-in prompt / subagent env block                             | Claude Code (`claude_code` preset)                                                                           | no                       | not measured (not Ptah's)                                                 | yes (subagent variant)         | yes                       |
| `.claude/agents/<type>.md` body (the role)                                   | repo agent files                                                                                             | repo content, kept by N4 | per agent                                                                 | yes                            | no                        |
| CLAUDE.md (project rules)                                                    | loaded by Claude Code via `settingSources` (`sdk-query-options-builder.ts:1254`)                             | repo content, kept by N4 | per repo                                                                  | yes                            | yes                       |
| `PTAH_CORE_SYSTEM_PROMPT` (orchestration tables, MCP mandates)               | `prompt-harness/ptah-core-prompt.ts:109`; appended at `sdk-query-options-builder.ts:310`                     | yes                      | **3,660**                                                                 | **no** (append is parent-only) | yes                       |
| Workspace Memory Snapshot (SessionStart listing)                             | `memory-prompt-injector.ts:239`; joined at `sdk-query-options-builder.ts:1704-1708`                          | yes                      | variable (≤50 observations + ≤50 corpora)                                 | **no**                         | yes                       |
| Corpus prime block                                                           | `memory-prompt-injector.ts` (budget 0.9 × 50k default, `:76-78`); `sdk-query-options-builder.ts:1709-1714`   | yes                      | variable (≤45k)                                                           | **no**                         | yes, when a corpus is set |
| Memory recall block                                                          | `memory-prompt-injector.ts` (5 hits × 400 chars, `:59-60`); `sdk-query-options-builder.ts:1715-1721`         | yes                      | ≈ ≤600                                                                    | **no**                         | yes, on first query       |
| Relevant Workspace Symbols                                                   | `code-symbol-prompt-injector.ts:70` (8 hits × 240 chars, `:27-29`); `sdk-query-options-builder.ts:1722-1728` | yes                      | ≈ ≤600                                                                    | **no**                         | yes, on first query       |
| Identity / user system prompt / output style / enhanced prompts              | `sdk-query-options-builder.ts:306-323`                                                                       | yes                      | variable                                                                  | **no**                         | yes                       |
| MCP server `instructions`                                                    | `server-instructions.ts:119-122` → `protocol-dispatcher.ts:343`                                              | yes                      | **126** (509 chars, ≤512 cap)                                             | yes                            | yes (same bytes)          |
| `ptah_*` tool schemas (all 53 zero-arg builders, coding profile upper bound) | `tool-description.builder.ts` (builders `:95-2015`), listed by `protocol-dispatcher.ts:385`                  | yes                      | **12,313** (54,630 chars JSON; profile and namespace toggles reduce this) | yes                            | yes (same list)           |
| Skills listing (incl. ptah-core plugin skills)                               | Claude Code                                                                                                  | listing is Claude Code's | not measured                                                              | yes                            | yes                       |

### Conclusion against AS-N4

- None of the memory snapshot, symbol list or orchestration tables reaches a subagent today. N4's goal ("no memory
  snapshot, symbol list or orchestration tables in a subagent prompt; keep the role and the project rules") is already
  met by how the code is built. A subagent gets the role (agent body) and the project rules (CLAUDE.md), plus shared tool
  schemas.
- The Ptah-owned text a subagent does get (126 + up to 12,313 tokens) is shared with the parent through a single MCP
  connection and a byte-stable handshake. Ptah cannot trim it for subagents alone without also changing what the parent
  receives. Task 45.2 forbids that ("the parent session's text is unchanged").
- So the STOP rule applies. The team-leader should record N4 as deferred. Expected token saving per subagent start from
  Batch 45: **0** (nothing subagent-only can be trimmed). Any reduction of the shared tool schemas belongs to N3
  (Batches 42-44: per-agent `tools` allowlists in frontmatter). That is the mechanism that removes `ptah_*` schemas from a
  restricted subagent's request.

## Files

- none changed. A temporary spec `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/zz-n4-attribution-dump.spec.ts`
  and its output folder `tmp-n4/` were created to measure the strings and then deleted.

**Stack observed**: Claude Agent SDK options built in `sdk-query-options-builder.ts`; the system prompt is always
`preset: 'claude_code'` plus `append`. The MCP server is Ptah's HTTP JSON-RPC dispatcher (`protocol-dispatcher.ts`) with
a per-caller tool profile. tsyringe DI (`agent-sdk/src/lib/di/register.ts:562-567` registers both injectors).

**Verification**: no code changed, so the scoped `typecheck,lint,test` run does not apply. The measurement spec ran
green once (`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <spec>`: 1 suite, 1 test passed) and was then deleted.

**Plan deviations**: none. The STOP rule was applied as written.

**Out-of-scope observations**: the subagent-side claim depends on Claude Code's documented behaviour (subagents get
their own system prompt, not the parent's `--append-system-prompt`). QA can confirm it at no extra cost with tool M on an
existing subagent transcript: check that `## Workspace Memory Snapshot` / `# Ptah Extension` are absent from the
subagent's first request.
