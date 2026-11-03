# Task Context - TASK_2026_853_897f

## User Request

Investigation started from: "why when I call the session handoff there is a huge spike in tokens".
Finding: the spike is the fixed first-turn prefix every Ptah session pays (~48.9k tokens main,
~32k subagent), not the handoff. The user then asked to focus on:

1. The tools and skills shipped inside Claude Code: disable what Ptah does not need by default and
   let users re-add them from Ptah settings (like the existing Ptah MCP namespace toggles).
2. Our repeated instructions.
3. Avoid installing marketplace items through all active workspaces. User rule (verbatim intent):
   "the default in all of our interfaces that install skills or subagents or anything [should be]
   not at user level" — install into the current workspace by default; show a setting/option to
   convert to a global install. "Those globally installed ones should be removed, then when user
   installs again we should default to per workspace and allow users to change that."
4. Understand how our plugins (`apps/ptah-extension-vscode/assets/plugins`) and subagent templates
   (`libs/backend/agent-generation/templates/agents`) work.

## Continuation — Gate 2 approved (2026-10-29)

- User resumed with "continue please". Existing lanes enabled / lane-review approval mode retained.
- In-process software-architect revised the plan in final round 2; independent opposite-side
  codex lane 144db841-565e-42fb-b15e-73897869ead5 APPROVED the reviewed revision in
  `implementation-plan-review-round2.md`. No unresolved round-two items or escalation.
- Decision #27 records the approval and accepted exact consent wording; next: team-leader decomposition.
- Live discovery: codex installed, queue messaging, confirmed room; other confirmed-room option
  Ollama Code (`ollama-cloud`). Existing reviewer pin retained. Memory confirms workspace-default
  installs and shared context-handoff direction.
- Separate lane-budget child could not be resumed: session_send returned unknown-child and
  session_status lists no children on this host. No duplicate writer started.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full: PM → architect (inventory + plan) → [designer → prototype → Gate 1.7 for the new
settings controls] → team-leader → QA. Phases ship as separate PRs where independent:
A built-in tools, B built-in/account skills, C repeated instructions, D workspace-scoped installs.
Worktree: /home/amun/ptah-extension/.claude-worktrees/session-prefix-diet
(branch feat/session-prefix-diet, base origin/main 2bccac73f).

## CLI Lanes

Gate 0.1: no stored execution preference found (memory search) → default `enabled`.
Approval mode: `lane-review` (spawnable lanes with room).
Roster (ptah_agent_list, 2026-10-29): codex installed, confirmed room (weekly 27%, reset
2026-11-04); Ollama Code ptah-cli pc-f3384f72-a556-4ab4-b2b1-7e1e028f22cb available, weekly 72%;
copilot and claude disabled; cursor, antigravity, opencode, pi, grok not installed.
Cross-side document and code reviewer: codex (different family from the Claude subagents).

## Conversation Summary — measured evidence

### Prefix size (from `~/.claude/projects/-home-amun-ptah-extension/*.jsonl` api-request-shape)

- First-turn context: main sessions min 47.8k / median 48.9k / max 57.3k (11 sessions);
  subagents 28.8k / 31.9k / 33.9k (27 transcripts). Handoff sessions are identical to normal ones.
- Breakdown of a 48.9k main session (approx., chars scaled to the measured token total):
  built-in tool schemas 12.8k (12 tools; Workflow 5.5k chars, Agent 5.4k, ScheduleWakeup 4.8k,
  AskUserQuestion 4.7k, Bash 3.8k, ReportFindings 2.3k); skill listing 9.7k (46 skills, 25.6k
  chars); Ptah system append 9.3k (25.4k chars: core ~16k, enhanced prompts 6k, code symbols 2.2k,
  memory 0.4k); agent listing + deferred tool names 5.8k; CLAUDE.md + reminders 3.9k; Ptah MCP
  tools (10 eager) 3.4k; Claude Code base prompt 1.8k; MCP instructions/env/prompt ~2k.
- Skill listing by source: claude.ai account-synced `anthropic-skills:*` ~9.5k chars
  (`~/.claude/skills/synced/<account-id>/`: built-in-browser, chrome-browser, computer-use,
  deep-research, docs, docx, google-workspace, import-memory, morning, pdf, pptx, skill-creator,
  xlsx); Claude Code built-in skills ~5.5k (code-review 1.2k, claude-api 1.1k, update-config,
  schedule, loop, run, plugin-authoring, workflow-authoring, keybindings-help,
  fewer-permission-prompts, simplify, security-review, init); repo-committed third-party skills
  ~3.2k (dataviz, impeccable, typesafe-ai, frontend-design in this repo's `.claude/skills`);
  Ptah shipped + repo commands ~7.4k (already trimmed by TASK_2026_435, 13.7k → 6.6k chars).

### Built-in tools and skills (verified by Explore)

- Main session `tools: {type:'preset', preset:'claude_code'}`, no `disallowedTools`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1281-1283, 1405`).
  `canSpawnSubagents` (:457-460) reads disallowedTools only.
- `settingSources: ['user','project','local']` for normal sessions; `['project','local']` on a
  localhost proxy base URL (:1431-1436); named accounts use the certified launch's sources (:1438).
  The `user` source is what loads the account-synced skills into every session.
- Flag-tier skill denial exists: `deniedSkillNames` → `skillOverrides {name:'off'}` (:480-512),
  policy from `capability-policy-model.ts:394,406-422`; fails closed (`skills: []`,
  `strictMcpConfig`) when the policy cannot be verified (~:560-568).
- Settings pattern to copy: MCP namespace toggles in
  `libs/frontend/chat/src/lib/settings/pro-features/mcp-port-config.component.ts`.

### Repeated instructions (verified by Explore)

- `PTAH_CORE_SYSTEM_PROMPT` (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`
  :110-265, ~10.9k chars) embeds `PTAH_MCP_SUBSTITUTION_SECTION` (:31-87, ~5.2k).
- Overlaps: substitution table also in MCP server instructions (`server-instructions.ts:120`,
  ≤512 chars) and `templates/agents/_shared/tooling-precedence.md` (~1.1k, in all 15 agents);
  memory trigger :71 repeats table row :50; CLI delegation core :98-104 + :141-147 (~1.4k) vs
  `_shared/cli-delegation.md`; replacement policy core :187 vs `_shared/replacement-policy.md`;
  simplicity core :186 vs `_shared/engineering-hygiene.md` (unused by any template);
  clarification core :161-176 vs `_shared/clarification-protocol.md`; tone/objectivity/time
  estimates/code references restate the claude_code preset (admitted at
  `sdk-query-options-builder.ts:313`).
- Contradictions with CLAUDE.md: core :81-86 says `nx test <project>` / `nx affected` (CLAUDE.md
  requires `npm run verify`, forbids positional `nx test A B`); core :241-247 says "Only commit
  when explicitly asked" (CLAUDE.md grants standing commit/push/PR authorization).
- Dead: `PTAH_MCP_MANDATE_PROMPT` (:280, only exported), `_shared/engineering-hygiene.md`.
- Enhanced prompts are not prefixed with the core at runtime (`chat-sdk-context.service.ts:58`);
  only the preview/export RPC prepends it (`enhanced-prompts.service.ts:900`). Old stored prompts
  may still contain a core copy (comment at :919) — inference.
- Internal one-shot queries also append the core (`sdk-query-runner.service.ts:718`).
- Subagents get no Ptah append (`subagent-hook-handler.ts:216+` returns only `{continue:true}`).

### Agent templates (verified by Explore)

- `TemplateStorageService` reads `~/.ptah/templates/agents/*.template.md`
  (`template-storage.service.ts:112-114`), `TemplatePartialResolver` expands
  `<!-- STATIC:ID -->` from `_shared/<kebab-id>.md` (TASK_SPEC_CONTRACT is generated),
  `ContentGenerationService` fills LLM/VAR sections, `OrchestratorService.buildAgentFileContent`
  (`orchestrator.service.ts:1231-1282`) writes frontmatter name/description(≤1024)/model/
  disallowedTools into `{outputRoot ?? workspaceRoot}/.claude/agents` (:440-444).
- The 411-char browser/web deny list is defined once (`subagent-tool-allowlist.ts:53-57`,
  `NO_BROWSER_NO_WEB`, 13 entries) and assigned to 6 agents (:69-74); the agent listing prints it
  6 times (~2.5k chars). Descriptions total ~8.6k chars across 15 templates.
- Generated agents are mirrored per workspace to `~/.ptah/user/agents/<label>-<hash>/`
  (`user-layer-mirror.service.ts:525-526`) and fanned out to other CLIs; no agent leak found.

### Plugin delivery (verified by Explore)

- No SDK `plugins` option (deliberate, avoids double listing; `ptah-cli-spawn-options.service.ts:8-15`).
- Plugins download from the content manifest to `~/.ptah/plugins/`
  (`platform-core/src/content-download.service.ts:95,99,208`); `UserLayerMirrorService` copies
  enabled plugin skills to `~/.ptah/user/skills`; `HarnessReconcilerService.reconcile(ws)`
  (`harness-reconciler.service.ts:170`) copies into `{ws}/.claude/skills`, `.agents/skills`,
  `.github/skills`, `.cursor/skills` (`claude-target.ts:72`, `rival-targets.ts`).
- Each reconcile writes one workspace (active root / session cwd), triggered at boot, folder
  switch (`apps/ptah-electron/src/activation/wire-runtime.ts:486`), plugin/harness RPCs, every
  session start (`session-query-executor.service.ts:1676-1690`) and CLI spawns.
- Bundled plugins opt-in per workspace (`enabledPluginIds` empty by default,
  `plugin-config-home.ts:62`); harness and skills.sh roots opt-out (`plugin-loader.service.ts:11-23`).

### Marketplace scope — root causes (verified by Explore)

1. No install scope: skills.sh RPC takes only `{source, skillId}` (`skills-sh-rpc.handlers.ts:316`),
   files go to `~/.ptah/plugins/ptah-skillssh-*` (`skills-sh-source-root.service.ts:89-91,116`),
   opt-out ⇒ active everywhere. MCP installs record `~/.ptah/mcp-installed.json` keyed by
   server+target with no workspace (`harness-sync/src/lib/sources/mcp-intent-store.ts:1-20,65-67`);
   UI preselects all 7 targets (`mcp-directory-browser.component.ts:37-45,356,492`).
2. Reconciler copies global records into every workspace it reconciles: `buildMcp` has no
   workspace filter (`harness-manifest.builder.ts:276-289`); skills gate migrates existing
   workspaces to `'all'` (`state/skill-sync-gate.ts:34-35,108-111`).
3. Permissive defaults: skills default ON, opt-out roots ON, user-scope MCP ON
   (`capability-toggle.types.ts:146-167,305-309`).
4. `ptah_harness_create_skill` defaults to `scope:'user'` (`harness-namespace.builder.ts:734`,
   `system-namespace.builders.ts:230-233`); `ptah_harness_install_mcp_server` defaults to
   `['claude','vscode']` (`harness-namespace.builder.ts:1057`).
- External plugins: files global (`~/.ptah/plugins/external/`), enablement only in the active
  workspace (`plugin-rpc.handlers.ts:908-929`), but their MCP servers go into the global intent
  store (:708-714,786).
- Home-config targets (`~/.codex/config.toml`, `~/.copilot/mcp-config.json`, antigravity) are
  global by nature.
- Electron current workspace = `activeFolder ?? folders[0]`
  (`electron-workspace-provider.ts:86-87`).

## User decisions (this conversation)

- D-U1 Install default: every Ptah interface that installs skills, subagents, MCP servers or
  anything else installs into the current workspace by default, never user level; an explicit
  option converts an install to global.
- D-U2 Migration: existing global installs are removed; reinstalling defaults to per-workspace.
  Constraint (orchestrator): never delete files Ptah did not write (only manifest-tracked copies).
- D-U3 Claude Code built-in tools Ptah does not need are disabled by default and re-enabled from
  Ptah settings.
- Account-synced claude.ai skills are not a Ptah install and cannot be moved into a workspace;
  under D-U1 they are hidden by default in Ptah sessions with a toggle to re-enable
  (orchestrator interpretation, logged in decisions.md — user may overturn).
- Headroom proxy integration: out of scope (discussed; deferred).
