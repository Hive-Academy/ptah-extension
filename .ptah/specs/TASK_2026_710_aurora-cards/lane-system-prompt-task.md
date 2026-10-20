# Follow-up task prompt: lanes adhere to the Ptah system prompt + browser loads workspace files

Separate task (not TASK_2026_710). Paste this into a new session (for example after `/orchestrate`).
Facts were verified on 2026-10-21 against `main` at 0fc0c3a09.

````markdown
# TASK: Lanes adhere to the Ptah system prompt + the browser tool can load workspace files

## Why (evidence from a live session, 2026-10-21)

CLI lanes (codex, antigravity, …) see every ptah_* MCP tool and every workspace skill, but they
almost never use them. Only the main agent (and sometimes codex) does. A live capability probe
confirmed both codex and antigravity list all 11 ptah_browser_* tools, ptah_browser_status works,
and both can see the `impeccable` skill. In two design rounds neither lane loaded `impeccable` or
checked its output in a browser. Two root causes:

1. **Lanes do not get the Ptah system prompt.**
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:540`
     `buildTaskPrompt` builds the whole lane prompt from: `projectGuidance`, an optional role block,
     `NATIVE_AGENT_TOOL_POLICY` (one paragraph, line 416), the task, files, task folder, completion
     contract. Nothing else.
   - `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:920`
     deliberately excludes `PTAH_CORE_SYSTEM_PROMPT` and `PTAH_SYSTEM_PROMPT` ("Claude-specific and
     not applicable to CLI agents"), and line 75 caps `PROJECT_GUIDANCE_MAX_BYTES = 4000`.
   - The size limit exists because several adapters pass the prompt on argv:
     `WIN32_CMD_SHIM_COMMAND_LINE_LIMIT = 8_191` (`cli-adapter.utils.ts:168`),
     `assertCommandLineWithinLimit` (line 227).
   - Result: lanes have no tool-substitution table, no "load the matching skill first" rule, no
     memory trigger, and no "verify rendered UI" rule.
2. **The browser tool cannot open files the lane wrote.**
   - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts:156`
     `validateBrowserUrl` allows only http/https and blocks localhost unless
     `ptah.browser.allowLocalhost` is set. `file:` is always blocked (spec at
     `browser-namespace.builder.spec.ts:64`). So a lane cannot screenshot its own prototype.

Related:
- `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts:66`
  `SUBAGENT_DISALLOWED_TOOLS` strips browser and web tools from 6 Claude subagent roles and
  Firecrawl from 6 more (TASK_2026_597, token cost). Report only; change needs user approval.
- Tool listing is identical for every MCP caller: `protocol-dispatcher.ts:478` `handleToolsList`;
  only `disabledMcpNamespaces` gates groups. Do not change that.
- Doc/schema drift: `.claude/skills/agent-lanes/SKILL.md` §2 documents `taskKind` and
  `routingSource` for `ptah_agent_spawn`, but the live tool schema rejects `taskKind`
  ("Unrecognized key"). Fix one side.

## Goal

Every lane, on every installed CLI, receives one vendor-neutral **Ptah lane system prompt**
through the **strongest instruction channel that CLI officially supports**, and follows it.
The browser tool can open `file://` pages that are inside a workspace root, and only those.

## Scope

### Part A — Ptah lane system prompt (single source of truth)

1. Write ONE vendor-neutral lane system prompt constant (in `cli-agent-runtime`, next to
   `NATIVE_AGENT_TOOL_POLICY`, which it replaces or absorbs). Derive it from the parts of
   `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` that apply
   to a lane. Contents, compact:
   - Tool substitutions (about 10 rows): ptah_code_search_symbols / ptah_ast_analyze before Grep,
     ptah_lsp_references, ptah_get_diagnostics after edits, ptah_memory_search on "last time /
     previously", ptah_search_files, ptah_context_enrich_file, ptah_get_dependents before edits,
     ptah_web_search, ptah_browser_* for rendered checks.
   - Skill rule: when a workspace skill matches the task (e.g. `impeccable`, `ui-ux-designer`,
     `angular-frontend-patterns` for UI work), load it before starting, using that CLI's own skill
     mechanism.
   - Verification rule: UI output (HTML, components, styles) must be rendered and checked with
     ptah_browser_navigate + ptah_browser_screenshot before reporting; state what was checked.
   - Keep the existing cost policy and the memory-safe verification rules.
   - Rules that bind the wording (existing guards): NO vendor names
     (`vendor-roster-drift.spec.ts`); describe no messaging mode as available (see the
     `TWO_WAY_MESSAGING_GUIDANCE` comment near `cli-adapter.utils.ts:424`).
2. **Deliver it per CLI through its supported channel, not argv, where possible.** For EACH
   adapter in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/` (codex, copilot,
   cursor, antigravity, opencode, pi, grok, ptah-cli), research the CLI's CURRENT official
   documentation (cite URL + version) and record in a matrix: system/developer instruction
   channels; instruction files the CLI reads automatically (AGENTS.md, vendor rules files) and
   whether a per-run path can be passed; how it discovers and loads skills; MCP tool allow/deny
   support; the channel the adapter uses TODAY (`roleChannel` / `roleDelivery` in
   `ptah_agent_list`). Choose per CLI the strongest supported channel: native system/developer
   channel → per-run instruction file under the workspace `.ptah/` folder (git-ignored) → argv
   preamble as last fallback, compact and inside `assertCommandLineWithinLimit`. Never write to the
   user's global CLI config.
3. Re-check the 4000-byte `projectGuidance` cap: raise it or send the full section when the
   channel is not argv; keep the cap only on argv paths.
4. Resume must not resend blocks already delivered (`resumeDeliveredPreambles`, TASK_2026_597 F6);
   extend that bookkeeping to the new block.
5. Keep the three copies in sync, or reduce them to one: `cli-adapter.utils.ts` constants,
   `ptah-system-prompt.constant.ts` (parent-side table), `.claude/skills/agent-lanes/SKILL.md`.

### Part B — Browser tool loads workspace files

1. `validateBrowserUrl` accepts `file:` URLs only when the resolved path is inside a workspace root
   (reuse the existing `isInsideRoot` helper). Resolve with realpath (no symlink/junction escape);
   percent-decode first; reject `..` after normalisation; handle Windows drive letters and case;
   reject UNC and any non-empty host; keep blocking every other scheme; keep the localhost rule and
   `ptah.browser.allowLocalhost` unchanged; confirm a `file://` page cannot read files outside the
   root through CDP (e.g. `--allow-file-access-from-files` stays off) and document it.
2. Update the tool description (`tool-description.builder.ts`) and schema text.
3. Specs: inside root, outside root, symlink escape, `..` escape, UNC, encoded traversal,
   uppercase drive, non-file schemes still blocked.

### Part C — Docs and briefs

1. `.claude/skills/agent-lanes/SKILL.md` §3: for UI deliverables the lane loads the matching design
   skill and renders/checks its output with ptah_browser_*.
2. Tribunal and orchestration references that brief UI lanes: same line.
3. Report (no change without approval) on `SUBAGENT_DISALLOWED_TOOLS` with token cost per spawn.

## Acceptance criteria

1. `lane-channels.md`: one row per CLI with researched channels (cited), chosen channel, fallback.
2. Live adherence test on every installed, non-AT-LIMIT lane: a neutral probe task that does NOT
   mention tools or skills ("Build a small static HTML status card in <path> and confirm it looks
   right"). Pass when the lane, unprompted: (a) repeats a canary "lane policy id" that exists only
   in the lane system prompt; (b) uses a ptah_* code tool instead of grep/find for code lookup;
   (c) loads `impeccable` or `ui-ux-designer`; (d) opens its own file via `file://` with
   ptah_browser_navigate and takes ptah_browser_screenshot. Record evidence in
   `adherence-report.md`. At most 3 probes at a time, ≤ 15 tool calls each, 10-min timeout.
3. Unit specs: each adapter sends the lane prompt on its chosen channel; argv stays under limit;
   resume sends no duplicate block; browser specs per Part B.
4. No vendor name in prompt text; `vendor-roster-drift.spec.ts` passes.
5. Existing guards pass: `container.smoke.spec.ts`, `mcp-contract.sweep.spec.ts`,
   `protocol-dispatcher.spec.ts`, `rpc-surface.spec.ts` if touched.
6. Independent review by a different model family than the implementer in
   `code-logic-review.md`, with a security review of Part B.

## Constraints (repeat in every lane brief)

- New worktree: `git worktree add -b fix/lane-system-prompt .claude-worktrees/lane-system-prompt main`.
- Memory-safe checks only: `npx nx test <project> --parallel=1` for changed projects, or Jest on
  changed specs with `--coverage=false --maxWorkers=2`. Never workspace-wide; never
  build/serve/e2e/package. One heavy check at a time.
- Electron first; keep VS Code, CLI and TUI compiling. No `any`, `@ts-ignore`, `as unknown as`;
  injected Logger; Zod at boundaries. Do not raise `tools/degradation-audit` baselines.
- Commit in the foreground; push + `gh pr create` in the background. Read `.commitlintrc.json`;
  subject ≤ 72 chars, body lines ≤ 100.

## Workflow

Full orchestration: research (channel matrix) → plan → user approval → implement Part B and Part A
as separate file-disjoint batches → live adherence test → review → PR.
````
