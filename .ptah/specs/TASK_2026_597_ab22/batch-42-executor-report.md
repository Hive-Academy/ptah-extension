# Batch 42 executor report — N3 per-type tool allowlist policy

Verdict: COMPLETE. Gate 42.1 PASSES. Tasks 42.2 and 42.3 implemented; scoped typecheck, lint and test green.

## Task 42.1 — gate evidence (the frontmatter `disallowedTools` key is honoured)

Pinned runtime: `node_modules/@anthropic-ai/claude-agent-sdk` 0.3.278. Its `manifest.json` pins Claude Code 2.1.278.
The filesystem agent loader runs in the native CLI
`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (0.3.278). The evidence below is minified JS
extracted from that binary with `grep -aoE`.

1. Typings: `sdk.d.ts:47-50` `AgentDefinition.disallowedTools?: string[]`: "MCP server-level specs (mcp__server,
   mcp__server___, mcp___) remove every tool from the named server (or all MCP tools)."
2. Parsing `.claude/agents/*.md` frontmatter (the loader that emits "Agent file ${e} has invalid permissionMode"):
   `let _t=r.disallowedTools,Mt=_t!==void 0?aR(_t):void 0` next to `Pt=aR(r.tools)` and `Bn=r.mcpServers`.
   (Plugin agents parse it too. They ignore only `permissionMode`, `hooks` and `mcpServers`.)
   - `aR`/`kht`: the value can be a string or an array of strings, and `Cp` splits it on `,` and spaces. **If any
     entry is `*`, `aR` returns `undefined`, so the whole list is dropped.**
3. Application: `AE(agentDef, tools, …)` resolves a subagent's tool pool from the full parent pool, including MCP
   tools inherited from the parent. It applies `{isToolDisallowed:L}=cEe(T)` with `D=B.filter(F=>!L(F))`. Tools from
   the agent's own MCP servers are filtered as well: `{isToolDisallowed:go}=cEe(e.disallowedTools),yo=os.filter(v=>!go(v))`.
4. Matching (`cEe` with `Ls`): a rule matches when its exact name is in the set, or when it is server-level. A rule is
   server-level when `Ls(rule)` splits on `__` and gives `toolName===undefined || toolName==="*"`.
   - `mcp__firecrawl` gives `{serverName:"firecrawl", toolName:undefined}`. This is server-level and removes every
     firecrawl tool. **Supported.**
   - `mcp__firecrawl__*` and `mcp__*` are server-level too. **Supported.**
   - `mcp__ptah__ptah_browser_*` gives `toolName:"ptah_browser_*"`. That is not server-level and matches no exact name.
     **Not supported** (silently matches nothing). This is why the policy lists the browser tools by full name.
   - The server spelling must match the normalized server name exactly (the runtime's own spawn-refusal message says
     so: "deny entries must match the normalized server spelling exactly, mcp__ prefix and case included").

Conclusion: the gate passes, with these constraints: full tool names or a bare server prefix, no partial wildcards,
and never a `*` entry.

## Tasks 42.2 / 42.3 — files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-generation\src\lib\services\subagent-tool-allowlist.ts`.
  Contains `SUBAGENT_DISALLOWED_TOOLS` (one row for each of the 15 templates), `getSubagentDisallowedTools` (unknown
  type returns `[]`) and `formatDisallowedToolsFrontmatter` (returns one comma-separated line, or `undefined`). The
  Ptah server name comes from `PTAH_MCP_SERVER_NAME` (`@ptah-extension/shared`).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-generation\src\lib\services\subagent-tool-allowlist.spec.ts`.
  Pins every row. Checks that the table keys equal the shipped `templates/agents/*.template.md` names (15). Checks that
  no entry contains `*`, whitespace or `,`. Checks unknown and `toString` types, and the line format.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`.
  `buildAgentFileContent` pushes the `disallowedTools:` line after `model:`, and only when the row is non-empty. The
  file also gets one import.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`.
  Adds 3 tests:
  - a restricted type gets the line inside the frontmatter, after `model:`;
  - `visual-reviewer` gets no line;
  - re-generation with echoed frontmatter still gives exactly one line (idempotent).

### Policy table (for Batches 43/44)

| Agent type                                                                                                         | `disallowedTools`                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| code-logic-reviewer, code-style-reviewer, modernization-detector, project-manager, software-architect, team-leader | `mcp__firecrawl, mcp__ptah__ptah_web_search, mcp__ptah__ptah_browser_navigate, mcp__ptah__ptah_browser_screenshot, mcp__ptah__ptah_browser_evaluate, mcp__ptah__ptah_browser_click, mcp__ptah__ptah_browser_type, mcp__ptah__ptah_browser_content, mcp__ptah__ptah_browser_network, mcp__ptah__ptah_browser_close, mcp__ptah__ptah_browser_status, mcp__ptah__ptah_browser_record_start, mcp__ptah__ptah_browser_record_stop` |
| backend-developer, frontend-developer, devops-engineer, senior-tester, technical-content-writer, ui-ux-designer    | `mcp__firecrawl`                                                                                                                                                                                                                                                                                                                                                                                                              |
| visual-reviewer, researcher-expert, video-director                                                                 | none (no line written)                                                                                                                                                                                                                                                                                                                                                                                                        |
| any other / custom type                                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                                                          |

The 11 browser names come from `libs/backend/vscode-lm-tools/.../tool-description.builder.ts:1099-1391`.
`ptah_web_search` comes from `:940` in the same file.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation`: both targets succeeded.
- `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2 --skip-nx-cache`: **35/35 suites,
  1154/1154 tests passed**.
  - The first run reported `agent-customization.service.spec.ts` as FAIL with 0 failed tests, so the suite did not run
    at all. That suite does not touch these files. It passed alone (26/26), and the full rerun is green. This looks
    like a transient load failure while other batches were running.
- Nx Cloud 401 warnings: present and harmless.

## Deviations

1. **Task 42.3 file.** Neither listed file writes agent frontmatter. `content-generation.service.ts` produces the body,
   and `template-storage.service.ts` only reads template frontmatter. The writer is
   `orchestrator.service.ts` `buildAgentFileContent` (the `model:` emit at `:1110`), so that is the file I edited. The
   batch said "executor confirms which writes frontmatter; edit only that one".
2. **Mirrors.** `user-layer-mirror.service.ts` is unchanged and does no frontmatter rewriting. The Codex, OpenCode and
   Copilot transforms (`libs/backend/harness-sync/.../transform-rules.ts:257-283` `rewriteFrontmatter`) rebuild the
   frontmatter from `name` and `description` only. That means `disallowedTools` never reaches non-Claude targets, and
   no code change was needed.
3. **Scope choices inside the table.**
   - "Web-scrape / web-search servers" means `mcp__firecrawl` (server-level) plus `mcp__ptah__ptah_web_search`. These
     are the only ones with evidence in this repo.
   - Built-in `WebFetch`/`WebSearch` are not denied, because they are not servers and the scope guard says MCP
     allowlist only.
   - `ui-ux-designer` and `technical-content-writer` get the developer row. `visual-reviewer`, `researcher-expert` and
     `video-director` get no restriction, matching the Task 44.1 validation note and its expected six-file list.

## Out-of-scope observations

- A deny entry for a server that is not installed (for example `mcp__firecrawl` in a user workspace without
  firecrawl) is a no-op for filesystem agents. It is harmless.
- `technical-content-writer` / `ui-ux-designer` rows are a judgment call. The team-leader may want to confirm them
  before Batch 44 copies them.
