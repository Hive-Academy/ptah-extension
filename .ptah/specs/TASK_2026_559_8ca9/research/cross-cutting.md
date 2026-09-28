# Research Report - TASK_2026_559 (cross-cutting: shared MCP layers)

## Question

- Decision this supports: which shared-layer fixes (response pipeline, server
  `instructions`, per-caller tool profiles, eager set, regression harness) the
  team should build so the ptah MCP tools stop silently degrading, without
  weakening any claim in the shipped prompts (`ptah-core-prompt.ts`).
- Question: across every ptah_* tool, what do the tools/list and tools/call
  paths do today, why did the RC5/RC6 degradation go undetected, and what
  shared fix closes each gap with no information loss?
- Bounds: does not judge any single tool's own logic (code-intel, workspace,
  agent/harness and browser tools are covered by four sibling researchers);
  does not re-run the live token audit (no server was started for this
  report — sizes for the 2 tools added after the 2026-09-25 audit are
  estimated from source, labelled as such).

## Answer

The shared layer has three unconditional gaps, each with one obvious fix
point already used by every tool: (1) `handleInitialize` returns no
`instructions` and no code path builds one from `PTAH_MCP_SUBSTITUTION_SECTION`
(protocol-dispatcher.ts:235-253; ptah-core-prompt.ts:31), so every non-Ptah-SDK
caller gets zero guidance; (2) `createToolSuccessResponse`
(protocol-dispatcher.ts:2019-2032) is the single choke point through which
every text tool response already passes, so it is the one place a global
result budget can be added without touching 30+ call sites individually; (3)
`handleToolsList` (protocol-dispatcher.ts:288-392) and the `McpRequestContext`
it would need (mcp-request-context.ts:21-32) are wired for **session and
workspace** identity but not **agent** identity or **tool-list** requests at
all — `tools/list` is dispatched at line 197 outside
`runWithMcpRequestContext`, and `_callerAgentId` is parsed off the URL
(http-server.handler.ts:271-275,380) but never threaded anywhere — so
per-caller profiles have no attachment point today and must be built, not
just enabled. Since the 2026-09-25 audit, two more always-on, non-eager tools
(`ptah_surface_update`, `ptah_surface_get_state`, TASK_2026_538, merged
2026-09-24) added an estimated 3-4k more description chars to the fixed
prefix every caller pays, confirming RC6 bloat is still growing.

## Evidence

| Claim | Source | Date | Verified how |
|---|---|---|---|
| `handleInitialize` returns `{protocolVersion, capabilities, serverInfo}`, no `instructions` key | protocol-dispatcher.ts:235-253 | read 2026-09-25 | read the source |
| `handleToolsList` builds one array for every caller; the only branches are `disabledMcpNamespaces`, `hasIDECapabilities`, `hasSqliteLayer` — none derived from the URL/caller | protocol-dispatcher.ts:288-392 | read 2026-09-25 | read the source |
| Eager set is `ptah_search_files, ptah_ast_analyze, ptah_context_enrich_file, ptah_get_diagnostics, ptah_workspace_analyze` always, plus `lsp_references/lsp_definitions/get_dirty_files` when `hasIDECapabilities`, plus `code_search_symbols/memory_search` when `hasSqliteLayer` | protocol-dispatcher.ts:398-417, 486-503 | read 2026-09-25 | read the source; matches mcp_surface.md `10 of 53 eager` at the time of the audit |
| `ptah_surface_update` and `ptah_surface_get_state` are always-on (no namespace guard), added by TASK_2026_538 | protocol-dispatcher.ts:315-318; git `cbdf37543`/`0277e328e` | 2026-09-22/24 | read the source + `git log` |
| Those two tools were not in the 2026-09-25 audit's 53-tool/62,996-char `tools/list` baseline | mcp_surface.md:11-14 (headline table) | 2026-09-25 | read the prior report; current handler enumerates 55 build* calls when every namespace is enabled (counted by hand from protocol-dispatcher.ts:294-383) |
| `ptah_surface_update` description text is a single template-literal concatenation of roughly 2.5-3k rendered chars (3,782 chars of source including the JS concatenation syntax); `ptah_surface_get_state` roughly 1.2-1.4k rendered chars (1,573 chars of source) | surface-tools.ts:160-238 | read 2026-09-25 | read the source; length measured with a throwaway `node -e` slice of the source between `description:` and `inputSchema:` — this over-counts by the `+`/quote/newline syntax, so treat as an upper-bound estimate, not a live measurement |
| Every text-returning tool response funnels through one function, `createToolSuccessResponse(request, text, deps)`, which wraps `text` in `content:[{type:'text', text}]` with no size cap, no `structuredContent`, no `outputSchema`, no `_meta` size hint | protocol-dispatcher.ts:2019-2032; confirmed by 30 call sites (e.g. :675,685,705,962,1000,1707,1716,1791,1823,1832,1837,1858,1863,1868,1873,1878) including `get_symbol_index`, `task_list`, `get_diagnostics` | read 2026-09-25 | read the source; grepped every `createToolSuccessResponse(` call site in the file |
| The only other response shapes are `toolErrorResponse` (protocol-dispatcher.ts:1921-1930, `isError:true` + prose), `harnessUnavailableResponse` (:1940-1954, JSON error text) and 4 inline ad-hoc error literals for missing-arg cases (:1022-1034, :1059-1071, :1090-1102, :1123-1136) that duplicate `missingStringArgResponse` (:1956-1973) instead of calling it | protocol-dispatcher.ts (line refs above) | read 2026-09-25 | read the source |
| `formatBrowserContent` is the only formatter with any output cap (`MAX_TEXT_LENGTH = 32 * 1024`, `.substring(0, MAX_TEXT_LENGTH) + '\n\n[...truncated]'`) | mcp-response-formatter.ts:1142,1144-1150 | read 2026-09-25 | read the source; matches mcp_surface.md §2 |
| Fallback formatter is pretty JSON (`JSON.stringify(data, null, 2)`), used whenever a `try` formatter throws | mcp-response-formatter.ts:1333-1344 | read 2026-09-25 | read the source |
| `ptah_get_diagnostics` scopes which **projects** get compiled (walks up from each `files` entry to its owning tsconfig directory) but does not filter the **output** to those files — every diagnostic in the owning project is returned, by design ("The scope is a floor, not a filter") | core-namespace.builders.ts:207-252 (`getPayload`, filters only by `severityFilter`, never by file); TypeScript provider CLAUDE.md addition in commit `e70130bf5` | 2026-08-30 | read the source; read the commit's own CLAUDE.md diff, which states the floor-not-filter rule explicitly as intentional |
| `ptah_get_diagnostics` has no per-file post-filter and no error-count cap anywhere in the MCP layer | protocol-dispatcher.ts:692-710 (dispatch), core-namespace.builders.ts:207-252 (payload), mcp-response-formatter.ts `formatDiagnostics` (no length guard found) | read 2026-09-25 | read the source; matches mcp_surface.md's live measurement of a 1,037,965-char / 17,501-error call |
| `PTAH_MCP_SUBSTITUTION_SECTION` (the MANDATORY-substitution table shipped in every Ptah-SDK system prompt) is one exported constant, imported by `PTAH_CORE_SYSTEM_PROMPT` and `PTAH_MCP_MANDATE_PROMPT`, so there is exactly one place to keep the substitution table honest and in sync with `instructions` if `instructions` is generated from it | ptah-core-prompt.ts:31-86 (constant), :138 (used in `PTAH_CORE_SYSTEM_PROMPT`), :279 (used in `PTAH_MCP_MANDATE_PROMPT`) | read 2026-09-25 | read the source |
| `_callerAgentId` is parsed from the URL (`/agent/{id}`) and attached to the raw `MCPRequest`, but is never read by `runWithMcpRequestContext`, which only carries `callerSessionId` and `callerWorkspaceRoot` | http-server.handler.ts:271-275,373-380 (parse + attach); protocol-dispatcher.ts:200-206 (context built for `tools/call` only, agent id dropped); mcp-request-context.ts:21-32 (`McpRequestContext` interface has no `callerAgentId` field) | read 2026-09-25 | read the source across all three files |
| `tools/list` is dispatched outside `runWithMcpRequestContext` entirely — `handleToolsList(request, deps)` is called directly, so no caller-identity context exists at the point a per-caller profile would need to branch | protocol-dispatcher.ts:196-197 (`case 'tools/list': return handleToolsList(request, deps);`) vs. :199-206 (`case 'tools/call': return await runWithMcpRequestContext(...)`) | read 2026-09-25 | read the source |
| `ptah_agent_spawn` for Codex explicitly disables MCP tool-search deferral (`tool_search_always_defer_mcp_tools: false`) because codex-cli 0.150.1 hides every MCP tool behind a deferred search otherwise, and an agent asked to list `ptah` tools "answers NONE and does the whole task with shell commands instead" | codex-cli.adapter.ts:605-627 (comment at :618-626) | read 2026-09-25 | read the source; matches RC5's "Codex deferral must stay off" and D.3's classification |
| The eager-set commit is `ecc8927f5`, 2026-06-04, "mark a curated eager MCP tool set via alwaysLoad"; the code-intel tools were promoted to first-class MCP tools the same day in `28e1b373e` | `git log --format="%h %ad %s" -- protocol-dispatcher.ts` | 2026-06-04 | ran `git log` |
| No spec in `mcp-core` or `mcp-http` asserts a tool's output size, a recall rate against a native tool, or a token budget; the only size-shaped assertion found is one tool description length check (`expect(description.length).toBeLessThan(1_000)`) in `tool-description.builder.spec.ts:25` | Grep over 18 spec files under `mcp-core`/`mcp-http` (listed by `find`) for `chars\|size\|budget\|truncat\|token`; only hit was `tool-description.builder.spec.ts:25` | read 2026-09-25 | ran `find` + `Grep` across every existing spec file in the two directories |
| CI runs `nx affected -t test --coverage --parallel=3 --maxWorkers=2` (Jest) and `nx affected -t build` on every PR; `@ptah-extension/vscode-lm-tools`'s `project.json` declares a `test` target wired to `jest.config.ts` and a separate `typecheck` target | .github/workflows/ci.yml:182,192; libs/backend/vscode-lm-tools/project.json | read 2026-09-25 | read the workflow file and the project.json |
| The prior audit's own live `tools/list` measurement (53 tools, 62,996 chars, ~15.7k tokens; 10 eager; largest single tool `ptah_dashboard_propose_spec` at 15,208 chars) predates the surface tools merge | mcp_surface.md:11-14, §1 | 2026-09-25 (audit date, taken before commit `cbdf37543` on 2026-09-24 — note: audit ran on the 25th but its window/HEAD predates the surface-tools merge per the file inventory it lists, which has 53 tools, not 55) | read the prior report; cross-checked tool count against the current source's `handleToolsList` build-call list (55 when every namespace is enabled) |

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
|---|---|---|---|
| Add `instructions` to `handleInitialize`, generated from `PTAH_MCP_SUBSTITUTION_SECTION` (or a ≤512-char head of it) rather than a hand-written third copy | Single source of truth already exists (ptah-core-prompt.ts:31); `handleInitialize` has no dependency on `deps.ptahAPI` today so it is a pure string build | Small: one new export + one field in the `initialize` result | Codex truncates at 512 chars (measured in the prior audit), so a naive full 10.7k-char dump would silently lose the back half; the generator must produce a short head, not paste the whole constant |
| Global result budget as a wrapper around `createToolSuccessResponse` | One choke point, already used by every text response including the worst offenders (`get_symbol_index`, `task_list`, `get_diagnostics`) | Medium: the "no information loss" constraint means a bare truncation is not enough for tools with no filter/offset param today (`get_symbol_index`, `task_list` — both confirmed to take **no arguments** in mcp_surface.md §2); those need either a new pagination param or a spooled full-output file before the cap can be zero-loss | Truncating `get_diagnostics`'s 1.08M-char worktree case without fixing the file/project scoping in `core-namespace.builders.ts` first hides the 17,501-error signal instead of explaining it — the cap and the diagnostics fix are not independent (see Local consequences) |
| Per-caller tool profiles keyed off `/agent/{id}` vs `/session/{id}` vs `/workspace/{root}` | The URL already carries this distinction and `_callerAgentId`/`_callerSessionId`/`_callerWorkspaceRoot` are already parsed per-request | Medium-high: requires (a) adding `callerAgentId` to `McpRequestContext`, (b) moving `tools/list` inside `runWithMcpRequestContext` (or passing caller identity into `handleToolsList` directly, since a `tools/list` request carries the same URL), (c) a profile table analogous to `SLOT_SPECS` in ptah-mcp-slots.ts | `tools/list` responses must stay **byte-stable** per profile for prompt caching (explicit requirement in this task); a profile keyed on a per-request timestamp or ordering that isn't deterministic would defeat that. `ptah-mcp-slots.ts` is the closest existing precedent for a stable, ordered, per-target list and should be the pattern to copy, not a fresh design |
| Verify/keep the eager set as-is (`ecc8927f5`) rather than re-deriving it | Confirmed still applies for Claude SDK (`hasIDECapabilities`/`hasSqliteLayer` gating unchanged) and for Codex (deferral explicitly forced off, codex-cli.adapter.ts:618-627) | Low: no code change, just confirmation | None found; the risk this item exists to catch (someone re-enabling Codex deferral) has not happened, per source read |
| Regression harness as a new Jest spec in `@ptah-extension/vscode-lm-tools`'s existing `test` target | No new Nx target or CI workflow needed — `nx affected -t test` already runs this project's specs on every PR | Medium: needs a fixture workspace (small, checked-in) and a benchmark per tool named in `PTAH_MCP_SUBSTITUTION_SECTION`, comparing ptah output to the native equivalent on size and recall, the same axes the prior audit's manual `mcp/bench.py` used | A fixture repo that doesn't reproduce the 297-tsconfig or symbol-index-miss conditions the live audit found won't catch what actually broke; the harness must ship at least one "large/adversarial" fixture case per tool class, not just a happy path |

## Disagreements

- None found between sources on the shared-layer facts: mcp_surface.md's
  claims about `handleInitialize`, the eager set, and `formatBrowserContent`'s
  cap all matched the current source read line-for-line (the file has not
  changed there since the audit). The one place source and the two reports
  differ is **tool count**: mcp_surface.md's live measurement says 53 tools;
  reading the current `handleToolsList` build-call list by hand gives 55
  (adding `ptah_surface_update`/`ptah_surface_get_state`). This is not a
  disagreement about method, just a time gap — the audit's live capture ran
  against a build that predates the TASK_2026_538 merge (`cbdf37543`,
  2026-09-24). Re-run `mcp/toolslist.py` against HEAD to get a verified count
  and byte size for the current 55.

## Local consequences

- `protocol-dispatcher.ts:2019-2032` (`createToolSuccessResponse`): the one
  place to hook a global result budget. Any wrapper here automatically covers
  every tool in scope for all four sibling researchers' tools, so this file
  is the shared dependency they should NOT each patch independently — one
  change here, one set of tests, not five.
- `protocol-dispatcher.ts:235-253` (`handleInitialize`) and
  `ptah-core-prompt.ts:31-86` (`PTAH_MCP_SUBSTITUTION_SECTION`): generating
  `instructions` from this constant (rather than writing new prose) is the
  only way to satisfy "single source of truth" and "matches the shipped
  prompts exactly" simultaneously — a hand-authored `instructions` string
  would drift from the prompt the same way `PTAH_SYSTEM_PROMPT` (dead code,
  per the prior audit) already did.
- `core-namespace.builders.ts:207-252` (`getPayload`): this is upstream of
  the response-budget work. The 1.08M-char diagnostics tail is not purely a
  response-formatting problem — it is a project-scoping problem (a worktree
  resolving to a tsconfig that covers far more than the caller's `files`).
  Any global truncation of `get_diagnostics` output without also filtering
  `getPayload`'s `diagnostics` array to the requested files will silently
  hide the very signal (17,501 errors from what is probably a bad
  tsconfig resolution) that needs surfacing, not truncating.
- `mcp-request-context.ts:21-32` and `protocol-dispatcher.ts:196-206`: any
  per-caller profile design must first add `callerAgentId` to
  `McpRequestContext` and move (or duplicate) the URL-parsing that already
  happens for `tools/call` so it also runs for `tools/list`. This is new
  plumbing, not a toggle — today there is no code path where `handleToolsList`
  can see which URL slot the request came in on.
- `ptah-mcp-slots.ts:158-175` (`SLOT_SPECS`): the closest existing pattern
  for "one stable, ordered table describing what a caller gets," but it
  describes **registration** (which config file gets a `{type, url}` entry),
  not **tool content** (which tools a URL slot should return). A per-caller
  tool profile is a sibling table, not a reuse of this one — same shape,
  different domain.
- `libs/backend/vscode-lm-tools/project.json` (`test` target) and
  `.github/workflows/ci.yml:182`: the regression harness has a ready-made
  home — a new spec file under `mcp-core` runs in CI with zero new wiring.
  The gap is content, not infrastructure: today's 18 specs in this area
  assert shape and error text, never a byte budget or a recall rate against
  the native tool it claims to beat.
- `surface-tools.ts:160-238`: two more never-disabled, non-eager tools were
  added after the audit's baseline. Whatever profile/budget design gets
  built must treat `ptah_dashboard_propose_spec`,
  `ptah_surface_update` and `ptah_surface_get_state` as one class ("always-on,
  large, rarely used by most callers") rather than assume the audit's
  53-tool inventory is still current.

## Unknowns

- Exact live byte size of the current 55-tool `tools/list` payload, and of
  the two new surface tools specifically. Not measured here because doing so
  requires starting the Electron/VS Code host and hitting the live HTTP MCP
  port, which this report's rules (no production-code changes, small tool
  output only) did not license as a read-only, side-effect-free action the
  way source reading is. Smallest experiment: re-run
  `C:/Users/abdal/.ptah-token-audit/mcp/toolslist.py` against a running
  build built from current HEAD.
- Whether `formatDiagnostics` (mcp-response-formatter.ts) has any length
  guard that the earlier grep for `truncat|cap|MAX_` missed under a
  different name — the code path was traced through `getPayload`'s data
  shape (unfiltered), but the formatter function body itself was not fully
  read line-by-line in this pass. Smallest experiment: `Read` the
  `formatDiagnostics` function body directly.
- Whether `git status` `.ptah/specs/TASK_2026_560_2ae5/` (per-workspace MCP
  on/off, referenced in the task prompt as a consumer of this area) has
  already specified a shape for `McpRequestContext`/`callerAgentId` that this
  report's design should match instead of inventing a new one. Not read here
  because it is a sibling task's folder, not an input this report was told
  to load. Smallest check: read that task's `task.md`/`context.md` before
  building the per-caller profile.

## Inventory (authoritative, `tools/list`, as read from `handleToolsList`, protocol-dispatcher.ts:288-392)

Sizes/eager/clients columns for the 53 tools present at the 2026-09-25 audit
are copied from mcp_surface.md's live measurement (verified there against
the running server). The 2 tools added since (`surface_update`,
`surface_get_state`) are marked `unmeasured (source-estimated)` because no
live capture has run against them. "Owner group" is this report's best-effort
split among the four sibling researchers (code-intel, workspace/files,
agent/task/harness, browser); each sibling should correct their own rows if
this split doesn't match their scope.

| Tool | Owner group | desc chars | schema chars | eager | Clients (per mcp_surface.md §1 "Registration and exposure by client") |
|---|---|---|---|---|---|
| ptah_dashboard_propose_spec | workspace/files | 2470 | 12567 | no | all (always-on, no namespace toggle) |
| ptah_surface_update | workspace/files | ~2.5-3k (unmeasured live) | not measured | no | all (always-on, TASK_2026_538) |
| ptah_surface_get_state | workspace/files | ~1.2-1.4k (unmeasured live) | not measured | no | all (always-on, TASK_2026_538) |
| ptah_agent_spawn | agent/task/harness | 1416 | 3506 | no | Claude SDK (deferred), Codex/lane clients (un-deferred), external Claude Code (deferred) |
| ptah_harness_search_skills | agent/task/harness | 2131 | 408 | no | same as above, namespace `harness` |
| ptah_harness_search_mcp_registry | agent/task/harness | 2218 | 273 | no | namespace `harness` |
| ptah_harness_propose_config | agent/task/harness | 1872 | 352 | no | namespace `harness` |
| ptah_harness_create_skill | agent/task/harness | 1361 | 713 | no | namespace `harness` |
| ptah_task_create | agent/task/harness | 444 | 1499 | no | all (always-on) |
| ptah_task_update | agent/task/harness | 568 | 1339 | no | all (always-on) |
| ptah_harness_install_mcp_server | agent/task/harness | 700 | 1044 | no | namespace `harness` |
| execute_code | agent/task/harness | 506 | 763 | no | all |
| ptah_browser_navigate | browser | 340 | 919 | no | namespace `browser` |
| ptah_web_search | workspace/files | 451 | 650 | no | all |
| ptah_get_diagnostics | code-intel | 477 | 552 | **yes** | all (core, always-on) |
| ptah_ast_analyze | code-intel | 448 | 481 | **yes** | namespace `code` |
| ptah_agent_report | agent/task/harness | 717 | 265 | no | namespace `agent` |
| ptah_browser_screenshot | browser | 241 | 657 | no | namespace `browser` |
| ptah_code_search_symbols | code-intel | 426 | 362 | yes, if `hasSqliteLayer` | namespace `code` |
| ptah_memory_search | code-intel | 389 | 350 | yes, if `hasSqliteLayer` | namespace `code` |
| ptah_agent_message | agent/task/harness | 528 | 234 | no | namespace `agent` |
| ptah_json_validate | workspace/files | 350 | 387 | no | namespace `json` |
| ptah_task_list | agent/task/harness | 328 | 394 | no | all (always-on) |
| ptah_context_enrich_file | code-intel | 240 | 247 | **yes** | namespace `code` |
| ptah_lsp_references | code-intel | 203 | 288 | yes, if `hasIDECapabilities` | namespace `ide` |
| ptah_lsp_definitions | code-intel | 196 | 288 | yes, if `hasIDECapabilities` | namespace `ide` |
| ptah_search_files | workspace/files | 198 | 243 | **yes** | all (core, always-on) |
| ptah_workspace_analyze | workspace/files | 188 | 33 | **yes** | all (core, always-on) |
| ptah_get_dirty_files | workspace/files | 149 | 33 | yes, if `hasIDECapabilities` | namespace `ide` |
| ptah_task_get, ptah_task_check | agent/task/harness | (in "other 29" bucket, ~≤300 each) | | no | all (always-on) |
| ptah_agent_status, ptah_agent_read, ptah_agent_stop, ptah_agent_list | agent/task/harness | (in "other 29" bucket) | | no | namespace `agent` |
| ptah_git_worktree_list/add/remove | agent/task/harness | (in "other 29" bucket) | | no | namespace `git` |
| ptah_get_dependents, ptah_get_dependencies | code-intel | (in "other 29" bucket) | | no | namespace `code` |
| ptah_get_symbol_index | code-intel | (in "other 29" bucket) | | no | namespace `code` |
| ptah_relevance_rank_files | code-intel | (in "other 29" bucket) | | no | namespace `code` |
| ptah_project_detect_monorepo | code-intel | (in "other 29" bucket) | | no | namespace `code` |
| ptah_count_tokens | workspace/files | (in "other 29" bucket) | | no | all (core, always-on) |
| approval_prompt | agent/task/harness | (in "other 29" bucket) | | no | all (core, always-on) |
| ptah_browser_evaluate/click/type/content/network/close/status/record_start/record_stop (9 more) | browser | (in "other 29" bucket, ~9.9k tokens total for the 18 harness+browser+dashboard tools per RC5) | | no | namespace `browser` |

Client-registration mechanism, by client (unchanged since the audit, verified
against current source):
- **Claude SDK sessions / one-shot queries** (`/session/{id}`, no URL
  segment): `sdk-query-options-builder.ts` `mcpServers.ptah`; SDK honours
  `_meta['anthropic/alwaysLoad']`, so only the eager set above loads without a
  ToolSearch round trip.
- **Codex lanes** (`/agent/{id}`): `codex-cli.adapter.ts:605-627` sets
  `tool_search_always_defer_mcp_tools: false`, so **all** tools in the list
  (55 now) are in context from turn one, whatever the eager flag says —
  `_meta['anthropic/alwaysLoad']` has no effect on Codex.
- **Interactive user Codex** (bare root URL, `~/.codex/config.toml`): no
  `features` override, so codex-cli defers every MCP tool until the model
  runs a tool search (mcp_surface.md §1, `codex-cli.adapter.ts:618-626`
  comment describes exactly this mechanism for the lane case it turns off).
- **External Claude Code** (`{ws}/.mcp.json`, `/workspace/{root}`): same SDK
  deferral behaviour as Ptah's own SDK sessions.
- **Cursor / Antigravity / Copilot / OpenCode lanes** (`/agent/{id}` via
  their respective adapters): full list, client-specific deferral not
  measured here (out of this report's bounds — a sibling researcher's tool
  may cover it).
- None of these paths currently branches `handleToolsList`'s tool **set** on
  which of the above the caller is — the only branches are the two
  process-wide capability flags and the namespace-toggle setting (see
  Evidence and Local consequences).

## Shared fixes (files, order dependencies, guards)

1. **Server `instructions`** — generate from `PTAH_MCP_SUBSTITUTION_SECTION`
   (ptah-core-prompt.ts:31), truncated/summarised to fit Codex's ~512-char
   read window, returned from `handleInitialize`
   (protocol-dispatcher.ts:235-253). *No order dependency on the others.*
   *Guard:* a spec pinning that `instructions.length` for the Codex-targeted
   variant stays under 512 chars (mirror `tool-description.builder.spec.ts:25`'s
   pattern), and that its content is derived from (not a copy of) the
   constant, so a change to the substitution table cannot leave
   `instructions` stale.

2. **Fix `get_diagnostics`'s project-to-output filter before capping its
   response** — `core-namespace.builders.ts:207-252` must filter
   `diagnostics` to the requested `files` (or clearly document the "floor,
   not filter" choice as the default with an explicit `includeProject: true`
   opt-in, per the prior audit's Wave 1.3 proposal), *before* any global
   truncation is applied to its formatted text. *Order dependency:* do this
   before item 3 for this tool specifically, or the global cap will hide the
   17,501-error signal instead of explaining it.

3. **Global result budget** — wrap `createToolSuccessResponse`
   (protocol-dispatcher.ts:2019-2032): cap at a default (e.g. 8k chars),
   cut at the last newline before the cap, append a trailer. Because several
   tools in scope have no offset/limit parameter today (`get_symbol_index`,
   `task_list` per mcp_surface.md §2), "loses no information" requires either
   (a) adding a minimal offset/cursor param to those tools first, or (b)
   spooling the untruncated text to `.ptah/tmp/mcp-out/<toolCallId>.txt` and
   naming that path in the trailer, mirroring the pattern the prior audit's
   Wave 3.3 already proposes for the Claude-side PostToolUse hook. Declare
   the budget in `tools/list` via `_meta['anthropic/maxResultSizeChars']` on
   each tool definition (`tool-description.builder.ts`, `surface-tools.ts`,
   `dashboard-propose-spec.tool.ts`) so a client that reads `_meta` can size
   its own buffer. *Guard:* a spec asserting every
   `createToolSuccessResponse` call site returns text at or under the
   declared budget, or a trailer explaining exactly where the rest is.

4. **Per-caller tool profiles** — add `callerAgentId` to `McpRequestContext`
   (mcp-request-context.ts:21-32); parse and thread it the same way
   `_callerSessionId`/`_callerWorkspaceRoot` already are
   (http-server.handler.ts:373-381 already extracts it — it only needs to be
   read, not newly parsed); move `tools/list` inside
   `runWithMcpRequestContext` or otherwise expose caller identity to
   `handleToolsList` (protocol-dispatcher.ts:196-197). Build a stable, ordered
   profile table analogous to `SLOT_SPECS` in `ptah-mcp-slots.ts:158-175`
   (same file convenient for cross-reference, not for reuse — it answers
   registration, not tool content). *Order dependency:* depends on nothing
   above, but TASK_2026_560 (per-workspace MCP on/off) is a stated consumer
   of the same plumbing — read its task/context files before finalizing the
   `McpRequestContext` shape, since a second consumer choosing an
   incompatible shape here would mean redoing this twice. *Guard:* a spec
   pinning tools/list's byte-for-byte output order per profile (prompt-cache
   stability), and a spec proving an unrecognized/malformed URL still returns
   the safest (most restrictive, not most permissive) profile.

5. **Deferral/eager set** — no code change; this report confirms
   `ALWAYS_EAGER_TOOLS`/`IDE_EAGER_TOOLS`/`SQLITE_EAGER_TOOLS`
   (protocol-dispatcher.ts:398-417) and the Codex forced-un-defer
   (codex-cli.adapter.ts:618-627) both still match their intended state.
   *Guard:* a spec (or a comment pointing at this report) that fails loudly
   if `tool_search_always_defer_mcp_tools` is ever flipped back to default
   for the Codex lane path, since that regression has a documented, measured
   cause (RC5's "Codex deferral must stay off").

6. **Regression harness** — new spec(s) under
   `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`, run by
   the existing `test` target (`project.json`) and therefore already covered
   by `nx affected -t test` in `.github/workflows/ci.yml:182`. Needs: a
   fixture workspace (checked in, small) reproducing at least one adversarial
   case per tool class (a multi-tsconfig diagnostics case, an exact-symbol-name
   lookup, a large directory tree for `workspace_analyze`); a benchmark
   comparing each `PTAH_MCP_SUBSTITUTION_SECTION`-named tool's result size and
   recall against its native counterpart, per the design already specified in
   the prior audit's Wave 1.5 ("fails if a tool ... loses to its native
   counterpart on size or recall"). *Order dependency:* write this after items
   1-4 land, or the harness will pin today's broken behaviour as the
   baseline. *Guard:* the harness must fail CI (not just warn), since a spec
   that only logs a delta is exactly the gap that let RC5 go unnoticed for
   this long — none of the 18 existing specs in this area assert size or
   recall today.

7. **Runtime telemetry** — log per-tool result size, latency and
   error/success at the same point item 3's wrapper sits
   (protocol-dispatcher.ts:2019-2032 for success, :1921-1930 for error), so a
   silent regression shows up in aggregate without needing another manual
   audit. *Order dependency:* natural to land together with item 3, since
   both need the same choke point instrumented once. *Guard:* keep the log at
   `debug` or a dedicated metrics channel, not `info` — the file's own
   comment at protocol-dispatcher.ts:181-184 already documents that an
   `info`-level per-request log became "the highest-volume writer" in this
   exact file's history and had to be demoted; a new per-tool-call log must
   not repeat that mistake.
