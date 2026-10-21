# TASK_2026_711_3377 — context

Worktree: `D:/projects/ptah-extension/.claude-worktrees/lane-system-prompt` (branch `fix/lane-system-prompt`).
Task folder: `<worktree>/.ptah/specs/TASK_2026_711_3377`.

## User request (verbatim)

### Why (evidence from a live session, 2026-10-21)

CLI lanes (codex, antigravity, …) see every ptah_* MCP tool and every workspace skill, but they
almost never use them. A live probe confirmed codex and antigravity list all 11 ptah_browser_* tools
and can see the `impeccable` skill. In two design rounds neither lane loaded `impeccable` or checked
its output in a browser. Two root causes:

1. Lanes do not get the Ptah system prompt.
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:540`
     `buildTaskPrompt` builds the lane prompt from: `projectGuidance`, optional role block,
     `NATIVE_AGENT_TOOL_POLICY` (line 416), task, files, task folder, completion contract.
   - `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:920`
     excludes `PTAH_CORE_SYSTEM_PROMPT` and `PTAH_SYSTEM_PROMPT`; line 75 caps
     `PROJECT_GUIDANCE_MAX_BYTES = 4000`.
   - The cap exists because several adapters pass the prompt on argv:
     `WIN32_CMD_SHIM_COMMAND_LINE_LIMIT = 8_191` (`cli-adapter.utils.ts:168`),
     `assertCommandLineWithinLimit` (line 227).
2. The browser tool cannot open files the lane wrote.
   - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts:156`
     `validateBrowserUrl` allows only http/https, blocks localhost unless `ptah.browser.allowLocalhost`.
     `file:` always blocked (spec `browser-namespace.builder.spec.ts:64`).

Related, report only: `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts:66`
`SUBAGENT_DISALLOWED_TOOLS` strips browser/web tools from 6 Claude subagent roles, Firecrawl from 6 more.
Tool listing is identical for every MCP caller (`protocol-dispatcher.ts:478` `handleToolsList`); do not change that.

### Goal

Every lane, on every installed CLI, receives one vendor-neutral Ptah lane system prompt through the
strongest instruction channel that CLI officially supports, and follows it. The browser tool can open
`file://` pages inside a workspace root, and only those.

### Part A — lane system prompt
1. ONE vendor-neutral constant in `cli-agent-runtime` next to `NATIVE_AGENT_TOOL_POLICY` (replaces or
   absorbs it), derived from `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`:
   ~10-row tool substitution table (ptah_code_search_symbols / ptah_ast_analyze before Grep,
   ptah_lsp_references, ptah_get_diagnostics after edits, ptah_memory_search on "last time/previously",
   ptah_search_files, ptah_context_enrich_file, ptah_get_dependents before edits, ptah_web_search,
   ptah_browser_* for rendered checks); skill rule (load a matching workspace skill first via the CLI's
   own skill mechanism, e.g. impeccable / ui-ux-designer / angular-frontend-patterns for UI); verification
   rule (render UI output with ptah_browser_navigate + ptah_browser_screenshot before reporting);
   keep cost policy + memory-safe verification rules. NO vendor names (`vendor-roster-drift.spec.ts`);
   describe no messaging mode as available (`TWO_WAY_MESSAGING_GUIDANCE` comment near line 424).
2. Per CLI (codex, copilot, cursor, antigravity, opencode, pi, grok, ptah-cli) research CURRENT official
   docs (cite URL + version): system/developer channels; auto-read instruction files and per-run path
   support; skill discovery; MCP tool allow/deny; the channel used today. Choose the strongest:
   native system/developer channel → per-run instruction file under workspace `.ptah/` (git-ignored)
   → argv preamble (compact, inside `assertCommandLineWithinLimit`). Never write user-global CLI config.
3. Keep `projectGuidance`; raise/remove the 4000-byte cap on non-argv channels.
4. Resume must not resend delivered blocks (`resumeDeliveredPreambles`, TASK_2026_597 F6); extend it.
5. Keep in sync (or reduce to one): `cli-adapter.utils.ts` constants, `ptah-system-prompt.constant.ts`,
   `.claude/skills/agent-lanes/SKILL.md` §3/§7.

### Part B — browser loads workspace files
1. `validateBrowserUrl` accepts `file:` only when the resolved path is inside a workspace root (reuse
   `isInsideRoot`): realpath (no symlink/junction escape); percent-decode first; reject `..` escape after
   normalisation; Windows drive letters + case; reject UNC and any non-empty host; keep blocking other
   schemes; localhost rule + `ptah.browser.allowLocalhost` unchanged; a file:// page must not read files
   outside the root (check CDP launch flags, e.g. `--allow-file-access-from-files` stays off; document).
2. Update `tool-description.builder.ts` and MCP tool schema text.
3. Specs: inside, outside, symlink escape, `..`, UNC, encoded traversal, uppercase drive, other schemes.

### Part C — docs
1. agent-lanes SKILL.md §3: UI deliverables → load design skill, render and check with ptah_browser_*.
2. Tribunal and orchestration references that brief UI lanes: same line.
3. Report only: should `SUBAGENT_DISALLOWED_TOOLS` keep denying browser tools to 6 roles; token cost per spawn.

### Acceptance
1. `lane-channels.md` matrix. 2. Live adherence test per installed CLI → `adherence-report.md`
(canary "lane policy id" token only in the lane prompt; ptah_* code tool use; skill load; browser
navigate file:// + screenshot; ≤3 probes at a time, ≤15 tool calls, 10-min inactivity timeout).
3. Unit specs (channel per adapter, argv under limit, resume no duplicate, browser). 4. No vendor names.
5. Guards pass: container.smoke, rpc-surface (if touched), mcp-contract.sweep, protocol-dispatcher.
6. Different-family code review → `code-logic-review.md`, with Part B security review.

### Constraints
Memory-safe verification only (`npx nx test <project> --parallel=1` or Jest on changed specs with
`--coverage=false --maxWorkers=2`; never workspace-wide; never build/serve/e2e/package; one heavy check
at a time). Electron first; keep VS Code/CLI/TUI compiling. No `any`/`@ts-ignore`/`as unknown as`;
injected Logger; Zod at boundaries. Do not raise `tools/degradation-audit` baselines.

## Run log

- 2026-10-21 Gate 0.1 lanes: codex (room 15%), grok (room 21%), antigravity (unknown), opencode
  (unknown), copilot disabled, cursor/pi not installed, Glm (ptah-cli) AT LIMIT reset unknown — skip.
- 2026-10-21 Research lanes delivered: code-inventory.md (codex), research-channels-a.md (grok),
  research-channels-b.md (opencode). Architect (codex) delivered implementation-plan.md + lane-channels.md.
- 2026-10-21 Orchestrator review of the plan (in-process, opposite side): no blocking defect.
  USER APPROVED the plan with these amendments (binding, they override the plan text):
  1. Probe task text is neutral: "Build a small static HTML status card in <path> and confirm it
     looks right. State your lane policy id in your report." No "follow the instructions" or
     "inspect visually" hints.
  2. Channel choice is static per adapter. "Probe first" channels are probed ONCE at implementation
     time (`--help` + a canary run where possible); the result is hard-coded (channel or fallback).
     No per-spawn probing.
  3. Canary line: `Lane policy id: ptah-lane-policy-v1`.
  4. Batches: B (browser, grok) ∥ A1 (constant, utils, interface, file store, process manager,
     guidance cap, codex, ptah-cli, cursor; codex) → A2 (copilot, antigravity, opencode, pi, grok
     adapters + probes; codex) ; C (docs + sync spec + vendor guard + ptah-system-prompt; grok).
  Checks: lanes run no nx/jest/tsc; the orchestrator runs scoped tests one at a time.
  Review: grok reviews A, codex reviews B (incl. security) → code-logic-review.md.
