# Research Report - TASK_2026_609_c495 (Part A root cause)

## Question

- Decision this supports: which surgical fixes go into Part A (before the Part B Settings silo), and in what files, given PR #634 is unmerged.
- Question: why does the setup wizard in project X change subagents of project Y, how can `model:` be set per agent type and provider, which wizard analysis files are unused, and why do subagents lack the ptah tool prompt?
- Bounds: no code edited, no runtime reproduction (no access to the user's `~/.ptah/user/agents`), skills/commands layers and MCP config only noted. Checked at worktree HEAD 21c27d17f. Provider docs on `model:` formats were not consulted (repo comments only).

## Answer

TASK_2026_365 is in main (commit 534b4472e, ancestor of HEAD) and its keyed write path is intact; no later commit regressed it, so this is an INCOMPLETE fix, not a regression. The wizard itself writes only `{ws}/.claude/agents` and no user-global provider dir. The remaining cross-project vector is the 365 migration seed (`seedLegacyAgents`), which copies the machine-wide legacy clones (other projects' agents) into a workspace on its first consented pass, which is exactly when the wizard grants consent and propagates. The other three problems are separate small gaps, each with a one-file hook.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| 365 keyed `~/.ptah/user/agents/<label>-<hash>` per workspace; D4 "migration seeds, never reaps"; D5 legacy flat files stay on disk | `.ptah/specs/TASK_2026_365/context.md` (Decisions), `implementation-report.md` | 2026-08-31 | read |
| 365 commit is in main | `git merge-base --is-ancestor 534b4472e HEAD` -> in-main | 2026-08-31 | ran |
| Scope applied in ONE place; no-arg caller lands in the flat base | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:290-301` | undated | read |
| Reader side scoped too (`scopeAgentsRoot`) | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:117-124,172` | undated | read |
| Mirror source needs consent and carries `workspaceRoot` (both or neither) | `libs/backend/harness-sync/src/lib/state/agent-sync-gate.ts:181-192` | undated | read |
| Consent gate is per workspace (`stateStore.load(workspaceRoot)`) | `agent-sync-gate.ts:70-75,103-110` | undated | read |
| Later commits touching these dirs are not agent-scope changes (313112496 policy freeze, clone save-body) | `git log 534b4472e..HEAD -- <state, sources, user-layer, workspace>` | 2026-09-26 | ran; 313112496 stat read |
| Wizard generation writes only `{rootPath}/.claude/agents`; "no Phase 5", no CLI fan-out in generation | `orchestrator.service.ts:404-408,464-471` | undated | read |
| Wizard then grants consent for that workspace and calls `propagate(workspaceRoot, 'wizard:generation-complete')` | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:743-762,776-790` | undated | read |
| Mirror pass: if `agentSourceDir` present, `seedLegacyAgents` then `mirrorAgents` | `user-layer-mirror.service.ts:341-344` | undated | read |
| Seed copies EVERY `*.md` + sidecar from flat `~/.ptah/user/agents` into the scoped dir when the scoped dir does not exist; not filtered by this workspace's source | `user-layer-mirror.service.ts:1832-1880` (guard `:1837-1838`, loop `:1852-1867`) | undated | read |
| Flat base is the interleaved record of other workspaces (365: `figma-designer` present in history, absent from this repo) | `context.md` (Measured evidence); comment at `user-layer-mirror.service.ts:1826` | 2026-08-31 | read |
| Rival agent targets are workspace-relative (`{ws}/.codex/agents`, `.github/agents`, `.cursor/agents`, `.opencode/agent`); `.claude/agents` never written by reconcile | `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:6-16`, `claude-target.ts:12-17` | undated | read |
| Only user-global writes in harness-sync: MCP configs (`~/.codex/config.toml`, `~/.copilot/mcp-config.json`, `~/.gemini/config/mcp_config.json`) and a legacy `ptah-` reap in `~/.copilot/agents` | `rival-targets.ts:6-16,139-146`; `mcp/codex-home.ts:49-53`; `mcp/mcp-facet.registry.ts:51,69` | undated | read |
| No agent write to `~/.claude/agents` or `~/.codex/agents` found in agent-generation / harness-sync / rpc-handlers / agent-sdk | grep of `.claude/agents`, `homedir`, `'.codex'` across those libs | 2026-10-03 | ran grep (those libs only) |
| `FileWriterService` resolves a RELATIVE path against `homedir()` (would land in `~/.claude/...`); orchestrator passes absolute paths, so dormant | `file-writer.service.ts:318-326`; `orchestrator.service.ts:404` | undated | read |
| TASK_534 item 4 (connect wrote `provider.<id>.cliAgent.modelTier.*`) is fixed in main: "No `cliAgent` writes" | `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts:228`, `providers-settings-state.service.ts:228`; `.ptah/specs/TASK_2026_534/fix-report.md:73-79` | undated | read |
| `model:` is written only from `template.model`; templates ship 6x `opus`, 9x `sonnet` | `orchestrator.service.ts:1109-1111`; `template-storage.service.ts:446-448`; `grep ^model: templates/agents/*.md` | undated | read/ran |
| Codex and OpenCode transformers NEVER emit `model` (Claude tiers invalid there; OpenCode drops the whole agent on an unresolvable model) | `transformers/codex-agent-transformer.ts:10-11`; `opencode-agent-transformer.ts:24-29` | undated | read |
| Copilot/Cursor go through `rewriteFrontmatter`, which rebuilds frontmatter as name/description/source/target-cli only, so `model` is dropped | `transformers/transform-rules.ts:271-288`; `copilot-agent-transformer.ts:34-46` | undated | read |
| Analysis writes `01-project-profile.md` .. `04-elevation-plan.md` (+ `manifest.json`) into `{ws}/.ptah/analysis/<slug>/` | `types/multi-phase.types.ts:126-147`; `analysis-storage.service.ts:71,269-270`; `multi-phase-prompts.ts:38,120,211,338` | undated | read |
| `PTAH_CORE_SYSTEM_PROMPT` appended to main session only; MCP `instructions` capped at 512 chars (Codex read window) | `sdk-query-options-builder.ts:308`; `vscode-lm-tools/.../server-instructions.ts:2-9,31` (`MAX_SERVER_INSTRUCTIONS_CHARS = 512`) | undated | read |
| A `TOOLING_PRECEDENCE` shared block (one bullet) already exists, but no template under `templates/agents/*.md` references it (grep count 0) | `templates/agents/_shared/tooling-precedence.md`; `template-partial-resolver.ts:68-76` | undated | read/ran |
| #634 touches `orchestrator.service.ts`, `subagent-tool-allowlist.ts`, `enhanced-prompts.service.ts`, `sdk-query-options-builder.ts`, `templates/agents/team-leader.template.md`, `.claude/agents/*`, `content-manifest.json` | `git diff --name-only origin/main...origin/fix/task-597-lane-token-burn` | 2026-10-03 | ran |

## Findings by question

### 1. Cross-workspace leak: incomplete fix, not regression

Write chain today (all workspace-scoped): wizard -> `orchestrator.service.ts:404` `{ws}/.claude/agents` -> `grantAgentSyncConsent` + `propagate` (`wizard-generation-rpc.handlers.ts:756`) -> mirror into `~/.ptah/user/agents/<key>` -> reconciler reads scoped dir -> `{ws}/.codex|.github|.cursor|.opencode` agent dirs. Gate, manifests and state are per workspace.

Residual leak vectors, ranked:

1. **Legacy seed (strongest match).** `seedLegacyAgents` (`user-layer-mirror.service.ts:1832`) runs when consent exists and the scoped dir is missing, i.e. the first pass after the wizard completes in a workspace. It copies all flat-base clones, which hold whichever project wrote last (365 measured React vs Angular `frontend-developer` and a foreign `figma-designer`). Same-slug agents converge to this workspace's own source through fast-forward, but slugs this workspace does not own stay and the reconciler fans them into this workspace's rival CLI dirs. D4 chose this to avoid a reap; the cost is cross-project contamination. Inferred: I could not inspect the user's machine to confirm the flat base is non-empty.
2. **Machine-wide skills/commands** (`~/.ptah/user/skills`, `commands`) are still shared by design (`user-layer-mirror.service.ts:292,296`). Not subagents, same class; report only.
3. **User-global MCP configs** are written by design (`mcp-facet.registry.ts`); a wizard/propagate in X edits them for all projects. Not subagent files.
4. `FileWriterService` relative-path fallback to `homedir()` (`:318-326`) is dormant but a latent user-global write.
5. TASK_534 item 4 is closed in main; `cliAgent` tiers are machine settings read by `ptah-cli-registry.ts:~1479-1493`, and now only the CLI-agent editor writes them. It does not alter subagent files.

Not found: any watcher/startup loop iterating all workspaces (grep of `getAllWorkspace|allWorkspaces|workspaceFolders` in these libs only hit gateway/session code). The Electron coalescer is per workspace key (`plugin-activation.ts:91-120`).

### 2. Model per agent / per provider

Claude path: `buildAgentFileContent` (`orchestrator.service.ts:1070-1116`) emits `model:` from `template.model`, set by template frontmatter only. No settings key, RPC or UI sets it; the user edits `.claude/agents/*.md` by hand. Non-Claude targets drop `model` by design, because Claude tiers are not valid there. A per-provider model therefore needs new, provider-specific vocabulary, not a copy of the Claude value.

Smallest hook: one settings map, e.g. `agentGeneration.models = { "<agent-name>|*": { claude?: "opus|sonnet|haiku|inherit", codex?: string, opencode?: "provider/model", copilot?: string, cursor?: string } }`.
- Claude: resolve in `buildAgentFileContent` (override, else `template.model`). Same function #634 changes.
- Non-Claude: pass the map into each transformer (constructor deps in `rival-targets.ts`), emit `model` only when set. Codex/OpenCode must keep "omit unless explicit" (OpenCode drops the agent on a bad id: `opencode-agent-transformer.ts:24-29`). Needs validation of the id format before emit.
- Unknown (see below): whether a model change re-triggers a reconcile (is the transformed content in the desired-state hash).

### 3. Analysis files (read / unread)

| File | Readers | Status |
| --- | --- | --- |
| `01-project-profile.md` | `content-generation.service.ts:1064` (`readPhaseContextForRole`, per agent); `enhanced-prompts.service.ts:1011`; `setup-rpc.handlers.ts` project-profile/memory seed (`buildProjectProfile...`); wizard UI `analysis-results.component.ts` | read (during wizard only) |
| `02-architecture-assessment.md` | same three plus `setup-rpc.handlers.ts:1109-1125` (code conventions) | read (during wizard only) |
| `03-quality-audit.md` | same plus conventions at `setup-rpc.handlers.ts:1109` | read (during wizard only) |
| `04-elevation-plan.md` | `content-generation.service.ts:1080`, `enhanced-prompts.service.ts`, UI display | read (during wizard only) |
| `manifest.json` / `generation-manifest.json` | `analysis-storage.service.ts:283,369` (resume checkpoint) | read (resume only) |

None is read by a main session, subagent runtime, `PTAH_CORE_SYSTEM_PROMPT` or memory search after the wizard (grep of `.ptah/analysis`, `findLatestMultiPhaseAnalysis` found only the wizard/enhanced-prompt services). The user's "nobody uses them" is accurate for runtime, but they are inputs to agent generation (per-role context) and to memory seeding, so removing the analysis step would degrade tailoring unless replaced.

### 4. Subagent prompt gap (confirmed)

Main session gets `PTAH_CORE_SYSTEM_PROMPT` via `appendParts.push(...)` (`sdk-query-options-builder.ts:308`). A subagent gets its agent-file body plus MCP server `instructions`, which are capped at 512 chars (`server-instructions.ts:31`) because Codex reads only that much, so the full substitution table cannot ship there. The generated body carries at most one tooling bullet via the `TOOLING_PRECEDENCE` shared block, and no template currently references the block (verified by grep count 0).

Options:
- A: expand `templates/agents/_shared/tooling-precedence.md` into a compact table (8 key rows: workspace_analyze, search_files, code_search_symbols, ast_analyze, lsp_references, get_diagnostics, memory_search, relevance_rank_files + the "write/build/git stay native" line) and reference the block in all 15 templates. Estimated 200-300 tokens per agent body (inferred from 4 chars/token; full `PTAH_MCP_SUBSTITUTION_SECTION` is ~2.6 KB, about 650 tokens, measured by `wc -c`). Goes to every provider copy because it is body text.
- B: inject at generation time in `buildAgentFileContent`. Same effect, but couples to the #634 function.
- C: raise MCP `instructions` budget. Rejected: Codex read window.

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Restrict legacy seed to slugs this workspace's manifests already own | Keeps D4's no-reap intent; removes foreign slugs | edit `seedLegacyAgents` + spec (`user-layer-agent-scope.spec.ts`) | A workspace with owned agents but a deleted `.claude/agents` still needs its copies; covered by the ownership filter |
| Delete the seed entirely | Simplest | one function | First pass with empty source reaps manifest-owned rival copies (365 D4 reason) |
| Settings map for model, Claude only | One function | one settings key + `buildAgentFileContent` | Leaves Codex/OpenCode/Copilot/Cursor unaddressed |
| Settings map for model, all providers | Matches the user's request | transformers in `rival-targets.ts` get deps; id validation per provider | Bad OpenCode id hides the agent entirely |
| Compact tooling table via `_shared` block | Block mechanism exists, unused | 1 shared file + 15 template references + `content-manifest` regeneration | Extra tokens in every agent; stale if table changes (derive from the constant, as `server-instructions.ts` does) |

## Disagreements

- 365 report says the fix is complete and tests pass; the user still sees leaks. The seed (D4/D5) is the one place 365 deliberately keeps cross-workspace data, and it fires at wizard completion. Unverified against the user's machine.
- 534 task item 4 describes `cliAgent` tier writes on connect; main no longer writes them (`providers-connection-setup.service.ts:228`). The task text is stale.

## Local consequences

- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1832`: tighten the seed.
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:1109`: model override hook (collides with #634).
- `libs/backend/harness-sync/src/lib/targets/transformers/*` + `rival-targets.ts`: per-provider model emission.
- `libs/backend/agent-generation/templates/agents/_shared/tooling-precedence.md` + `templates/agents/*.template.md`: tooling table; `team-leader.template.md` collides with #634.
- Any template or agent change needs `npm run manifest:generate` and a commit (context.md).

## Unknowns

- Whether the user's `~/.ptah/user/agents` flat base is non-empty and whether the reported change is a foreign slug appearing (seed) or a same-slug overwrite. Smallest experiment: `ls ~/.ptah/user/agents` and the `.history` dir, then run the wizard in a scratch workspace and diff its `.codex/agents`.
- Whether a model setting change re-triggers a reconcile (desired-state hash input). Check `harness-reconciler.service.ts` hashing of transformed content.
- Whether wizard re-runs overwrite a hand-edited `model:` in `.claude/agents`; `FileWriter` skip/merge behaviour was not read.
- Exact token costs (estimates only; `ptah_count_tokens` not run).
- Not examined: skills/commands layer scoping, VS Code host differences beyond the shared `resolveAgentMirrorSource`, CLI-engine host.

## Proposed surgical fixes

| Fix | Files | Risk | Collides with #634 |
| --- | --- | --- | --- |
| F1 Restrict `seedLegacyAgents` to slugs owned by this workspace's manifests (or skip when `.claude/agents` has the slug), keep legacy files on disk | `user-layer-mirror.service.ts`, `user-layer-agent-scope.spec.ts` | Medium: a wrong filter can strand copies or reap | no |
| F2 Add `agentGeneration.models` settings key; Claude override in `buildAgentFileContent` | `file-settings-keys.ts`, `orchestrator.service.ts`, spec | Low | YES (`orchestrator.service.ts`) |
| F3 Per-provider model emission in transformers behind explicit-only validation (OpenCode `provider/model`) | `rival-targets.ts`, `transformers/*`, specs | Medium: OpenCode drops agents on bad id | no |
| F4 Expand `TOOLING_PRECEDENCE` block into compact table, reference it in the 15 templates, regenerate manifest | `templates/agents/_shared/tooling-precedence.md`, `templates/agents/*.template.md`, `content-manifest.json` | Low (token +200-300 per agent) | YES for `team-leader.template.md` and `content-manifest.json`; otherwise no |
| F5 Make `FileWriterService` reject relative paths instead of resolving to `homedir()` | `file-writer.service.ts`, spec | Low | no |
| F6 Leave analysis files alone for Part A; surface them in the Part B silo (they feed generation and memory seeding) | none | none | no |
