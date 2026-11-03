# Requirements - TASK_2026_853_897f

## Context

Every Ptah main session starts with a measured first-turn prefix of ~48.9k tokens (median of 11
sessions, min 47.8k, max 57.3k); subagents ~31.9k (27 transcripts). The handoff "spike" is this
prefix, not the handoff (context.md § measured evidence). About 30k is under Ptah's control:
built-in tool schemas 12.8k, skill listing 9.7k (of which claude.ai account-synced ~9.5k chars and
Claude Code built-in skills ~5.5k chars), Ptah system append 9.3k, agent listing 5.8k.

Today's behaviour is verified in context.md with file:line evidence. Main sessions have no
`disallowedTools` (`sdk-query-options-builder.ts:1281-1283,1405`). Flag-tier `skillOverrides`
already exist and fail closed (:480-512, ~:560-568). The core prompt
(`ptah-core-prompt.ts:110-265`) repeats the preset and the agent partials, and it contradicts a
workspace CLAUDE.md (:81-86, :241-247). skills.sh and MCP installs are global and get copied into
every reconciled workspace (`harness-manifest.builder.ts:276-289`).

The user decided (decisions.md, D-U1..D-U3): built-in tools Ptah does not need are off by default
and can be re-enabled in Ptah settings; every Ptah install surface defaults to the current
workspace with an explicit global option; existing global installs are removed. The orchestrator
added two points. A file or config entry may be deleted only with proof that Ptah wrote it
and that it is unchanged; unproven global roots are deactivated, not deleted. Account-synced claude.ai
skills are hidden by default with a toggle, because they cannot be moved into a workspace (the
user may overturn this).

## Classification

- Type: FEATURE. It adds new settings controls, a new install-scope option and a migration;
  phase C is a refactor inside the same feature.
- Estimate: XL. Four independently shippable phases cross agent-sdk, prompt-harness,
  agent-generation, harness-sync, rpc-handlers, the frontend settings and a one-time migration.
- Priority: not defined here.

## Scope

In scope:

- A. Built-in Claude Code tools disabled by default (main sessions and subagents), a settings
  section to re-enable each one, and skills that depend on a disabled tool hidden with it.
- B. Claude Code terminal-only built-in skills and claude.ai account-synced skills hidden by
  default in Ptah sessions, re-enabled from the same settings section.
- C. Removal of repeated or contradicting Ptah instructions, deletion of dead prompt code, and a
  shorter agent deny-list rendering.
- D. Workspace-scope default for every Ptah install surface, an explicit global option, and a
  one-time migration that retires existing global installs and deletes the copies Ptah can
  prove it wrote.

Out of scope:

- Headroom proxy integration. The user deferred it.
- TUI and VS Code UI polish. Electron is the priority host (CLAUDE.md). Other hosts only need to
  compile and keep working.
- Changes to shipped skill bodies. TASK_2026_435 already trimmed them.
- The content of enhanced-prompt generation. Only its duplication with the core prompt is
  touched, and only if phase C finds a copy at runtime.
- Repo-committed third-party skills (dataviz, impeccable, typesafe-ai, frontend-design). They are
  workspace content the user authored or committed, not a Ptah install.
- Agent template descriptions beyond the deny-list rendering (a later trimming task).

## Requirements

### 1. Phase A: built-in tools off by default

Requirement: an Electron Ptah session (main and subagent) starts without the Claude Code
built-in tools Ptah does not use. The user can re-enable any of them from Ptah settings, so
that the tool-schema prefix shrinks without removing anything Ptah depends on.

The architect owns the default-off list and records a one-line rationale per tool. The
candidates are Workflow, RemoteTrigger, PushNotification, ReportFindings, ListAgents,
DesignSync and EnterWorktree/ExitWorktree. Each needs evidence that no Ptah UI, backend state or
shipped skill depends on it.

Scheduling is an explicit architect decision recorded in the plan. Default: scheduling is a
supported Ptah flow, so ScheduleWakeup and CronCreate/CronDelete/CronList stay enabled and the
`/loop` and `/schedule` skills stay listed. They drive the `sleeping` state
(`session-turn-state.registry.ts:359-368,411-412`) and ScheduleWakeup has a renderer
(`schedule-wakeup-chip.component.ts`). Moving them to default-off needs evidence that no
supported flow uses them. Other dependencies: ReportFindings is used by `/code-review`;
ListAgents/SendMessage are documented in `ptah-cli-usage/references/internal-mcp.md:114`.

These tools stay enabled unless evidence says otherwise: Agent/Task, AskUserQuestion, Bash,
Read, Edit, Write, Skill, ToolSearch, TodoWrite, WebFetch, WebSearch and plan mode
(EnterPlanMode/ExitPlanMode). Ptah has handlers for them (`ask-user-question.service.ts`,
`exit-plan-mode.service.ts`, `permission-tool-classifier.ts`).

Acceptance criteria:

1. When a new main session starts with default settings, the system shall send every tool on the
   architect's default-off list in the SDK `disallowedTools`. The first-turn api-request-shape
   entry shall contain none of their schemas.
2. When a subagent starts with default settings, the system shall exclude the same tools from it.
   Each agent's own existing `disallowedTools` entries shall still be present.
3. When the user turns a listed tool on in the settings section and starts a new session, the
   system shall include that tool's schema in the first turn. The choice shall survive an app
   restart.
4. When a tool is off, every skill the architect records as depending on it shall be absent from
   the session's skill listing. Turning the tool on shall bring the skill back.
5. When default settings are used, Agent, AskUserQuestion, Bash, Read, Edit, Write, Skill,
   ToolSearch, TodoWrite, WebFetch, WebSearch and the plan-mode tools shall remain available.
   `canSpawnSubagents` (:457-460) shall still return true.
6. When a session transcript from before this change contains a now-disabled tool (for example
   ScheduleWakeup), the system shall still render it with its existing component on replay.
   This holds whatever the scheduling decision is.
7. The settings section shall list each default-off tool with its name, a one-line description
   and an on/off control, following the MCP namespace toggle pattern
   (`mcp-port-config.component.ts`).
8. When the scheduling tools and the `/loop` skill are enabled (by default, or turned on in
   settings if the scheduling decision disables them), running `/loop` with an interval shall
   move the session to `sleeping` and show the ScheduleWakeup chip.

### 2. Phase B: terminal-only and account-synced skills hidden

Requirement: an Electron Ptah session starts without the Claude Code built-in skills that only
make sense in the terminal CLI and without claude.ai account-synced `anthropic-skills:*`. The user
can re-enable each from the same settings section, so that the skill listing shrinks.

The architect owns the terminal-only list. The candidates are keybindings-help, update-config,
fewer-permission-prompts, init, run, plugin-authoring, workflow-authoring and
statusline-related skills. code-review, simplify, security-review and claude-api need a decision
with evidence. loop and schedule follow the Phase A scheduling decision (default: listed).

Acceptance criteria:

1. When a new main session starts with default settings, the system shall hide each default-off
   skill through the existing flag-tier `skillOverrides` mechanism. The first-turn skill listing
   shall not contain them.
2. When the user's `~/.claude/skills/synced/<account-id>/` contains account-synced skills, the
   system shall hide all of them by default. The settings section shall list each one found, with
   an on/off control, and a skill turned on shall appear in the next session.
3. When the capability policy cannot be verified, the system shall still fail closed
   (`skills: []`, `strictMcpConfig`) exactly as today. A re-enable toggle shall not bypass that.
4. When a session uses a localhost proxied provider or a named account (different
   `settingSources`), the system shall start the session without error. The hiding shall apply to
   whatever skills those sources load.
5. When no account-synced skills exist on the machine, the settings section shall show an empty
   state instead of a list, and the session shall start normally.
6. Ptah shipped skills, workspace `.claude/skills` and repo commands shall stay listed with
   default settings.
7. The settings section shall list every skill on the architect's terminal-only default-off
   list with an on/off control. When the user turns one on, it shall appear in the next new
   session's skill listing, the choice shall survive an app restart, and every other default-off
   skill shall stay hidden.

### 3. Phase C: repeated and contradicting instructions removed

Requirement: the Ptah system append and the agent listing state each rule once and never
contradict the workspace's own CLAUDE.md, so that the prefix shrinks and agents get consistent
instructions in every user workspace.

Acceptance criteria:

1. Before any deletion, the architect shall write a rule inventory in the plan. It lists every
   rule in the core prompt, `PTAH_MCP_SUBSTITUTION_SECTION`, MCP `server-instructions.ts`, and
   `_shared/tooling-precedence.md`, `cli-delegation.md`, `replacement-policy.md` and
   `clarification-protocol.md`. For each rule it records where the rule will live after the
   change. A reviewer can check that every rule found in only one place still exists in at least
   one place afterwards.
2. When a main session starts, the core prompt shall contain no hardcoded verification command
   (`nx test <project>`, `nx affected`). It shall tell the agent to follow the workspace's own
   CLAUDE.md or project instructions for verification.
3. When a main session starts, the core prompt shall not say "Only commit when explicitly asked"
   unconditionally. It shall defer commit and push authorization to the workspace's own
   instructions, and it shall keep a safe default when none exist.
4. `PTAH_MCP_MANDATE_PROMPT` and `_shared/engineering-hygiene.md` shall not exist in the tree
   after the change, and every host shall compile without them.
5. Rules that restate the `claude_code` preset (tone, objectivity, time estimates, code
   references; acknowledged at `sdk-query-options-builder.ts:313`) shall be removed from the core
   prompt. The ptah tool substitution table shall appear in the main session prefix once.
6. *(Revised before build, decisions.md #20.)* The 6 agents that share `NO_BROWSER_NO_WEB`
   (`subagent-tool-allowlist.ts:53-74`) keep their deny list and its rendering unchanged in this
   task. Claude Code prints frontmatter `disallowedTools` verbatim and partial wildcards do not
   match on the pinned runtime, so shortening it needs a public tool-name change or weaker least
   privilege; both are user-reserved and go to a follow-up task. The agents' effective
   `disallowedTools` shall be unchanged, as a test asserts.
7. When an internal one-shot query runs (`sdk-query-runner.service.ts:718`), it shall still get
   the trimmed core prompt and no other behaviour change.

### 4. Phase D: workspace-scoped installs

Requirement: every Ptah surface that installs a skill, subagent, MCP server or plugin installs
into the current workspace by default. An explicit option installs to global or converts an
install to global, so that an install in one workspace no longer appears in every workspace.

Surfaces to cover (the architect adds any others found):

- skills.sh install (`skills-sh-rpc.handlers.ts:316`)
- MCP directory install (`mcp-directory-browser.component.ts`)
- external plugin MCP servers (`plugin-rpc.handlers.ts:708-714,786`)
- `ptah_harness_create_skill` (default `scope:'user'`, `harness-namespace.builder.ts:734`)
- `ptah_harness_install_mcp_server` (:1057)
- subagent generation

The current workspace is the host's active workspace; in Electron that is
`activeFolder ?? folders[0]`.

Settled from context.md evidence (formerly open questions): generated agents are already
workspace-scoped (`{ws}/.claude/agents`, mirrored to `~/.ptah/user/agents/<label>-<hash>/`,
`orchestrator.service.ts:440-444`, `user-layer-mirror.service.ts:525-526`) and change only if
the delivery map finds a leak. Home-config MCP targets are global by nature, so a
workspace-scoped MCP install does not write them unless the user picks global (AC6).

Acceptance criteria:

0. Before any Phase D code, the plan shall contain a delivery map, one row per surface: bundled
   plugins, external plugins, skills.sh, MCP directory, harness create-skill/install-mcp, and
   generated agents with their per-workspace mirror. Each row gives where files and records are
   written, how they reach a session or another CLI (file:line), and a scope decision (change,
   or no change with the reason). Tests cover only the rows marked change.
1. When a user installs from any listed surface without choosing a scope, the system shall record
   the install against the current workspace only. The item shall be present after reconciling
   that workspace and absent after reconciling a different workspace.
2. When the user chooses global (at install time or by converting an existing workspace install),
   the system shall make the item available in every workspace it reconciles. The UI shall show
   the item's scope.
3. When `ptah_harness_create_skill` or `ptah_harness_install_mcp_server` is called without a
   scope argument, the system shall use workspace scope. A tool call that passes the global scope
   explicitly shall still install globally.
4. When no workspace is open, the system shall refuse a workspace-scoped install with a clear
   error and offer the global option. It shall not silently install globally.
5. When the MCP directory opens with workspace scope, it shall preselect only targets whose
   config lives in the workspace, not all 7 (`mcp-directory-browser.component.ts:37-45`), P-2.
6. When an MCP install has workspace scope, the system shall not write any home-config CLI file
   (`~/.codex/config.toml`, `~/.copilot/mcp-config.json`, antigravity), and the UI shall mark
   those targets as needing global scope. With global scope they are written as today.

### 5. Phase D: one-time migration of existing global installs

Requirement: on the first run after upgrade, Ptah removes existing global installs and their
reconciled per-workspace copies (user-approved removal, D-U2), so that they stop appearing in
every workspace. It deletes a file or config entry only with ownership proof (defined below).

Ownership proof, per file or config entry: an ownership record that names Ptah as the writer
(the reconciler managed manifest, `managed-manifest.ts:40-69`, or a record the architect
specifies) AND current content matching what that record holds. A matching name or an MCP
intent record alone is not proof: skills.sh roots can lack metadata and the metadata has no
content hash (`skills-sh-source-root.service.ts:243-253,381-399`), and `McpIntentStore` records
intent, not ownership of current config entries (`mcp-intent-store.ts:1-20,47-68`).

Acceptance criteria:

1. When the app first starts after upgrade, the system shall retire every legacy global
   skills.sh root (`~/.ptah/plugins/ptah-skillssh-*`) and every global MCP intent record: none is
   active by opt-out any longer, and none is reconciled into any workspace afterwards.
2. For each retired item, the system shall delete each reconciled per-workspace copy only when
   it has ownership proof. A copy that is git-tracked, has no ownership record, or whose content
   differs from the record shall stay in place and be logged as skipped. This covers the repo's
   `.claude/skills` impeccable, typesafe-ai and frontend-design.
3. The system shall delete a skills.sh root directory only when its metadata identifies Ptah as
   the writer and its files match. Otherwise the root stays on disk, inactive, and is reported in
   the log and the notice.
4. When a home-config CLI file contains a server entry from a retired intent record, the system
   shall remove that entry only with ownership proof for it, and preserve every other entry. An
   unproven entry stays and is logged. Preserving formatting is best effort and never overrides
   the proof rule (provisional, P-3).
5. When the migration fails partway (I/O error, locked file), the system shall log it and not
   block app start. Items are idempotent: the next start skips and does not recount items already
   removed or retired, and retries the rest. The completion marker is written only after every
   eligible item is removed, retired or safely skipped.
6. When the completion marker is written, the user shall see one notice (P-4) with the
   deduplicated counts removed and skipped/left on disk, and how to reinstall per workspace.
   Starts before completion show no notice.
7. Bundled Ptah plugins (`~/.ptah/plugins/` content downloads) and account-synced skills shall
   not be removed or retired by this migration.

## Non-functional requirements

- Measurement (one procedure for every phase): on the same workspace, with the same settings
  baseline (default settings, same account and provider, same installed content), start at least
  3 fresh main sessions and 3 fresh subagent sessions on each side. The "before" side is the
  state immediately preceding the phase (main for A, the merged previous phase after that). The
  figure per session is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  of the first assistant turn's usage in its transcript (`~/.claude/projects/*/*.jsonl`). The PR
  reports the medians and the raw per-session values. The sample size of 3 is P-5.
- Targets (provisional planning targets, P-1, inferred from the measured breakdown, not measured
  per phase):
  - A: main sessions at least 2.5k lower (revised from 5k before build, decisions.md #21).
  - B: main sessions at least 3k lower.
  - C: main sessions at least 1k lower; subagent sessions no regression (revised from 2k / 0.5k
    before build, decisions.md #21 and #20).
  - D: no regression, and fewer workspace skills listed on a workspace with no local installs.

  Lowering a target (for example because the scheduling decision keeps tools enabled) is a
  documented revision of this document, with evidence, made before implementation of that
  phase. Missing a target is never an automatic pass.
- Compatibility: Electron is primary. Each phase shall pass scoped `npm run verify -- -p A,B`
  over the changed projects and every host project that depends on them (Electron, VS Code, TUI
  and CLI where applicable). The PR records the project set used. No `build`, `serve`, `e2e`,
  `package` or workspace-wide targets. Named-account and proxied-provider sessions shall start
  and stream a turn without error.
- Security: the fail-closed capability policy keeps its current behaviour, and no toggle bypasses
  it. The migration never deletes a file or config entry without ownership proof.

## Provisional and product decisions

| Id | Item | Kind | Rationale |
| --- | --- | --- | --- |
| P-1 | Phase token targets | Provisional (lane-authored) | Inferred from the component breakdown in Context; revised only as stated above |
| P-2 | Workspace-scope MCP installs preselect only workspace-file targets | Orchestrator product decision | User asked for workspace scope (D-U1); preselecting home-config targets would write global files |
| P-3 | Best-effort home-config formatting preservation | Provisional (lane-authored) | Limits churn in user files; subordinate to the proof rule |
| P-4 | One migration notice | Provisional (lane-authored) | One notice per migration avoids repeat alerts across retries |
| P-5 | Sample of at least 3 + 3 sessions per side | Provisional (lane-authored) | Smallest sample with a usable median; observed spread is ~10k (47.8k to 57.3k) |

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Electron user | Cheaper, faster first turns; installs stay in the workspace they chose | Token drop in usage; an install in project X absent from project Y |
| User with global installs today | To understand why items vanished and how to get them back | The migration notice; a reinstall works per workspace |
| User of /code-review, /loop or scheduled wakeups | Those flows keep working, or a clear toggle restores them | The skill or tool appears after one toggle |
| Users of any workspace (not the Ptah repo) | The core prompt never imposes Ptah-repo rules | No `nx`/commit rule in the prefix contradicts their CLAUDE.md |
## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A tool disabled by default breaks a Ptah flow: ReportFindings breaks /code-review; disabling scheduling would break /loop and the `sleeping` state | HIGH | HIGH | Architect lists tool to skill/UI dependencies with evidence and records the scheduling decision. Phase A AC4 hides dependent skills. QA runs /code-review with defaults and with the tool on, and /loop only where its tools and skill are enabled (Phase A AC8) |
| The migration deletes a file or config entry the user committed, edited or wrote | MEDIUM | HIGH | Migration AC2 to AC4 (ownership proof per item). Senior-tester adds fixture tests with a git-tracked copy, an edited copy, a skills.sh root without metadata and a hand-added home-config entry |
| Users who relied on global installs lose them | HIGH | MEDIUM | The user approved the removal (D-U2). Migration AC6 shows a notice with reinstall steps |
| Phase C drops a rule that existed in one place only | MEDIUM | MEDIUM | Phase C AC1 rule inventory, reviewed by the cross-side reviewer (codex) before deletion |
| Different `settingSources` (proxy, named accounts) make the hiding a no-op or an error | MEDIUM | MEDIUM | Phase B AC4. QA starts one proxied session and one named-account session |
## Open questions

- None blocking. The two former questions (home-config MCP targets, generated agents) are
  settled in Phase D from context.md evidence; the delivery map (Phase D AC0) confirms them.
- If no ownership record exists for most legacy items, the migration may retire more than it
  deletes. The architect reports the expected removed/left counts in the plan.

## Handoff

- Next specialist: software-architect.
- Why: the default-off tool and skill lists, the rule inventory, the install-scope model across
  six surfaces and the migration's safety design are shape questions that need evidence-backed
  choices before any code.
