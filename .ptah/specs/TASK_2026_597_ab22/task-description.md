# Requirements - TASK_2026_597_ab22

Revision: 2 (answers review round 1, `task-description-review.md`: F1-F12 resolved or carried as open notes; uses
`research-report.md` and context.md § User Decisions item 6)

## Context

Background CLI lanes use far more plan quota than the main Claude session. In the same window, the user used about 5%
of a weekly Claude allowance and about 12% of a weekly Codex allowance. In the Codex rollouts the weekly
`used_percent` went from 1 to 12 between 13:07 and 14:06 (research-report.md, Evidence).

Codex rollout logs (`~/.codex/sessions`, 2026-10-03) show 9 lanes (`originator=codex_sdk_ts`, `source=exec`,
`cli_version 0.155.1`):

- Together they sent about 22M input tokens, ~95% cached, and output was under 0.5%.
- All 9 ran `gpt-6-astra`, the frontier default, because no model was configured.
- The longest lane (74 turns) sent 9.59M input tokens. Its per-request input grew from 27,464 to 183,759 tokens.
- Six lanes ran in parallel.

OpenCode lanes start at 12.2k-23.6k input tokens and grow to 130k-220k, with zero compactions in all sampled sessions.
Ptah reaches Ollama Cloud only as a Claude-side provider (`local-native` strategy, Anthropic-compatible endpoint). That
endpoint reports no cache fields, so every request pays for the full context.

Verified causes on `main`:

- **No default model.** `resolveModel` (`cli-agent-runtime/.../agent-spawn-environment.service.ts:165-178`) sends
  nothing when `codexModel` is empty.
- **Effort precedence is reversed.** The in-chat effort beats `codexReasoningEffort` (`:139-152`).
- **`runSdk` (`codex-cli.adapter.ts:597-676`) leaves out the prefix and budget keys:**
  - It sets no `model_auto_compact_token_limit`, `tool_output_token_limit` or `tool_timeout_sec`.
  - It sets `features.tool_search_always_defer_mcp_tools=false` (`:632`). That flag is removed and a no-op on Codex
    0.155.1; GPT-6 lanes reach MCP tools through code-mode `exec` / `ALL_TOOLS`.
  - It leaves Codex multi-agent, plugins, apps and skills instructions on. They add about 25k chars to the first
    request: `<skills_instructions>` 21,070, `<multi_agent_*>` ~2,700, `<recommended_plugins>` 876.
  - It sends the role block as `developer_instructions` on every spawn, resume included (`:635-641`, `:672-676`). The
    block was 12,173 chars in the sampled lane; context.md cites 34,608 for `backend-developer`.
- **Guidance may be sent twice.** Project guidance (12.4k chars) is added to every spawn
  (`agent-namespace.builder.ts:198`, `ptah-api-builder.service.ts:684`). It may appear twice in one first request.
- **Codex usage hides cached tokens.** `handleTurnCompleted` (`:1113-1134`) reports input that includes cached tokens
  and no cached field.
- **The Codex SDK breaks on some output.** Its readline splits on U+2028, U+2029 and U+0085, which produces
  "Failed to parse item".
- **Ollama Cloud windows are made up.** Its metadata falls back to a fabricated 128k window
  (`ollama-cloud-metadata.service.ts:71,382,404,426`).
- **The Claude SDK is newer than 406 assumed.** It is 0.3.278 (runtime 2.1.278), not 0.3.150, and its runtime reads
  `autoCompactWindow`.

Scope is final (context.md § Scope, § User Decisions 1-6). PR #602 (TASK_2026_408 phase 1) is merged.

## Classification

- Type: BUGFIX (urgent), per `task.md`. It includes the Ptah compaction layer (561 Track A).
- Estimate: XL. It spans five backend libraries (`cli-agent-runtime`, `agent-sdk`, `auth-providers`, `vscode-lm-tools`,
  `memory-curator`), a settings UI, three hosts and about 30 source items, plus gated live checks.
- Priority: "very urgent" (the user's words). The repository defines no priority scale.

## Scope

In scope:

- D1-D6.
- 561 Track A (A0-A9).
- 562 Wave 2.1-2.6.
- 562 Wave 4.2, 4.3, 4.4 (steer at 40, stop at 60) and 4.6.
- 561 B7 resume gap.
- Codex, OpenCode and Ollama Cloud, in the VS Code, Electron and CLI hosts.
- Shortening the role block as rendered for a lane (R3.6).

Out of scope:

- 561 Track B (B1-B6, B8, B9, the rest of B7). It stays in the TASK_2026_561 backlog.
- 562 Wave 4.1 (lane brief / spec format) and 4.5: agent frontmatter (`tools`, `disallowedTools`, `maxTurns`), opus pins,
  reviewer output contract, review mandate. Not approved. R3.6 changes only what a lane receives. It does not touch
  these fields, and it does not change how the main Claude session loads agent definitions.
- The `.claude/settings.local.json` MCP allowlist (Wave 0.5). It belongs to TASK_2026_560_2ae5.
- Cancel or edit of a running compaction, history replacement, and Codex compaction parity. These are not buildable
  (406 §4.3).
- An isolated `CODEX_HOME` with a copied `auth.json`. Research rejected it: it would copy a ChatGPT-mode refresh token
  and risk logging the user out.
- Edits by agents to user-owned files (decision 5).

## Verification method

- **M (offline, no quota).** M reads per-request usage records:
  - Codex: rollout `token_count` events;
  - OpenCode: `opencode.db` `session_message.data.tokens` and `session_v2`;
  - Claude-side: SDK usage.

  For each lane it reports model and effort, first-request input, peak per-request input, total input, cached input,
  output, request count, the largest single tool output, and compaction events. For the Codex prefix, M also uses
  `codex debug prompt-input`, which renders the prompt locally and makes no model call.

- **L (live proof, decision 6).** L runs only at QA and its owner is the **senior-tester**. The tester runs short
  scripted runs directly: `codex exec`, `opencode run`, or a headless Claude-side session against Ollama Cloud. Each run
  uses a cheap model, a fixed small task and a hard turn cap.
  - Each run uses the exact config, `developer_instructions` and prompt that Ptah's adapter generates, captured from
    the adapter, not hand-written.
  - The budget is at most 5 runs per runtime, before and after combined.
  - The Codex "before" figures come from the 2026-10-03 rollouts.
  - `ptah_agent_spawn` is never used.
  - Each L requirement below names what its run must show, and one run may satisfy several requirements.

## Requirements

### 1. Measurement and experiments

1. **R1.1** When M runs on the 2026-10-03 rollouts, it shall reproduce exactly, for the 74-turn lane:
   - first-request input 27,464;
   - peak 183,759;
   - total input 9.59M (±0.01M).
2. **R1.2** When a Codex lane runs, its rollout shall stay discoverable by M in the user's `CODEX_HOME/sessions`, and
   M shall identify it as a Ptah lane (by `originator` and session metadata). The location shall be documented.
3. **R1.3 (D5)** The task folder shall record a baseline for OpenCode and for Ollama Cloud.
   - OpenCode, offline, from `opencode.db`:
     - first-request input;
     - growth;
     - cache reads;
     - compactions;
     - which user MCP servers and plugins from the OpenCode config directory a Ptah lane loads.
   - Ollama Cloud, via L, owner senior-tester:
     - first-request input;
     - growth;
     - whether any cache field is reported;
     - the context window the provider applies.

   No OpenCode or Ollama Cloud fix shall merge before its baseline is recorded.

4. **R1.4 (A0)** `research-report.md` shall hold the source-level answers to E2-E5 and the six Remaining Questions.
   It already holds most of them. Any experiment still open after source analysis shall be run once at QA by the
   senior-tester, on a disposable session, and its result appended. That covers the E2 confirmation (R5.1), E3, and E4
   if fork/resume rollback is to ship. E5 is optional.
5. **R1.5 (A0)** When Ollama Cloud metadata has no verified context window for a model, the system shall report the
   window as unknown, with provenance, and never 128,000. When a true window is available from Ollama, that window
   shall be used.

### 2. Lane model and effort (D1, Wave 2.3)

1. **R2.1** When `codexModel` is empty and the spawn request names no model, the lane's `turn_context.model` shall be
   the default proposed at Gate 2 and accepted by the user (research recommends `gpt-6-sol`). The setting description
   shall name that default.
2. **R2.2** When the request or the setting names a model, the lane shall use it unchanged.
3. **R2.3 (precedence)** For every CLI whose effort Ptah resolves, the effective effort shall be the first match in
   this order:
   1. the `effort` argument on `ptah_agent_spawn`;
   2. `agentOrchestration.<cli>ReasoningEffort`, when set to a concrete level;
   3. the in-chat effort, when that setting is `inherit`;
   4. `medium`, when that setting is empty and the spawn is a reviewer or tester;
   5. the in-chat effort, when that setting is empty;
   6. none, so the CLI default applies.
4. **R2.4 (identification)** A spawn counts as a reviewer or tester when its resolved role name ends in `-reviewer` or
   equals `senior-tester`. A spawn with no role is neither. A unit test shall cover each step of R2.3, including both
   identification cases.
5. **R2.5** At every spawn, the system shall log the effective model and effort, and the R2.3 step or model source
   that produced each.

### 3. Codex lane fixed prefix (D3, D4, Wave 2.2, B7)

1. **R3.1** When a Codex lane starts, the `ptah` MCP tools shall be reachable on turn one.
   - Check: in an L run (senior-tester), the model's first action can list and call a `ptah_*` tool.
   - The user's other MCP servers (for example `node_repl`) and plugin-provided servers (`codex_app`, `cua_repl`)
     shall be disabled for the lane. Check offline: `codex mcp list --json` with the lane's config overrides.
   - The dead `features.tool_search_always_defer_mcp_tools` line and its stale 0.150.1 comment shall be removed.
   - `mcp_servers.ptah.enabled_tools`: verify first, in the same L run, whether it takes effect inside code-mode
     `ALL_TOOLS`. Fallback: if it has no effect, leave it unset. The server-level disables satisfy this requirement.
2. **R3.2** Every Codex lane, with or without a Ptah MCP port, shall start with `agents.enabled=false`,
   `features.plugins=false`, `features.apps=false` and `skills.include_instructions=false` in its Codex config.
   - A unit test shall pin these keys.
   - With those overrides on Codex 0.155.1, `codex debug prompt-input` shall render at most 7,000 chars. That is the
     measured 6,416 plus a margin for environment text, against a baseline of 31,874. The render shall contain no
     `<skills_instructions>`, `<multi_agent_role>`, `<multi_agent_mode>` or `<recommended_plugins>` block.
   - The check shall be re-run on each Codex version bump.
3. **R3.3 (CODEX_HOME)** Lanes shall use the user's own `CODEX_HOME`, with no copy of `auth.json`. Ptah shall create,
   modify or delete no config, auth, plugin or skill file under it.
   - Rollouts and caches that the Codex runtime writes itself are allowed.
   - Check: `config.toml` stays byte-identical, and the plugin and skills directories are unchanged, before and after
     an L run.
4. **R3.4 (Wave 2.6)** Project guidance shall appear at most once in a lane's first request. Check: offline unit test
   on the adapter's generated `developer_instructions` plus task prompt, and M on an L run.
   - Skill listing, agent listing delta, the duplicated Ptah-CLI guidance (`ptah-cli-registry.ts`, around `:822`) and
     lane preambles shall each be absent from the lane prefix or reduced.
   - Before and after char counts shall be recorded for each.
5. **R3.5 (B7, F6)** When a Codex lane is resumed, M on the resumed request of an L run (senior-tester) shall show the
   role text present at most once in that request's input.
   - If Codex unavoidably holds it twice, the task folder and the adapter's resume-site comment shall record the
     measured extra chars and tokens per resume and the reason. A unit test shall pin the shipped behaviour.
   - The 559 Batch 14 skip of systemPrompt and guidance on resume shall still hold.
6. **R3.6 (D3, F2)** The rendered lane role block shall be at most **10,000 chars** for every role a lane can be
   spawned with, on every adapter that renders roles (Codex `developer_instructions`, and `buildTaskPrompt` for
   OpenCode and others).
   - Why 10,000: the R3.4 budget arithmetic. At about 0.38 tokens per char (27,464 tokens over ~72k chars measured),
     18k tokens is ~47k chars. Codex base instructions (21.4k) plus guidance (12.4k) plus permissions and environment
     (~2k) leave ~11k for the role and the task.
   - A table of before and after chars for every role shall be recorded.
   - Agent definition files keep their frontmatter, model pins and review rules (Wave 4.5 OUT).
7. **R3.7** In an L run on the cheap model, with the adapter-generated config and the `backend-developer` role, M shall
   show a first-request input **under 18,000 tokens** (562 W2.2 target). Baseline: 27,464. Owner: senior-tester.

### 4. Codex context growth (D2, A2, A4, A9)

1. **R4.1 (A2)** When `agentOrchestration.codexAutoCompactTokens` is N > 0, the lane shall start with
   `model_auto_compact_token_limit = N`, on resume too. When it is 0, the runtime default applies. The default shall be
   named in the setting description (suggestion: 120000).
2. **R4.2 (A4)** When a tool-output limit L is set (suggestion: 2500), the lane shall start with
   `tool_output_token_limit = L`.
   - Verify first, in one L run with a deliberately large file read (senior-tester), whether the limit caps code-mode
     `exec_command` output and MCP tool output.
   - If it does, M shall show no single tool output above L.
   - Fallback: if it does not, record the measured largest output and state the gap in the setting description. R4.3
     is then the binding outcome.
3. **R4.3** In an L run with `codexAutoCompactTokens` set to a low test value T (at most 40,000), whose context passes
   T, M shall show at least one compaction and per-request input falling below T after it. Owner: senior-tester.
4. **R4.4 (A9)** In Ptah settings (VS Code and Electron), each of the following shall be an editable control showing
   its suggested default:
   - Codex auto-compact tokens;
   - tool-output limit;
   - reasoning effort and web search (optional controls);
   - a hint for the curator provider (0.6).

   Web search defaults to on, and turning it off is a user choice, not a regression. Lanes shall receive these values
   without any change to `~/.codex/config.toml`.

5. **R4.5 (A9)** When the user opts in to "write to Codex config", the system shall:
   - show a diff preview;
   - back up the file;
   - write only the keys the user set, and remove a key whose value is empty;
   - keep every other key and comment byte-identical.

   Without an explicit opt-in, the file shall be unchanged.

### 5. Claude-side compaction layer (A1, A3, A5-A8)

1. **R5.1 (A1, gated on E2)** Source analysis shows the 2.1.278 runtime reads `autoCompactWindow` (bounds 100,000 to
   1,000,000; values outside them are dropped silently), and that `CLAUDE_CODE_AUTO_COMPACT_WINDOW` overrides it. E2
   (senior-tester, one tiny request per case, using `getContextUsage({detail:'summary'})`) must still confirm three
   things:
   - (a) `autoCompactThreshold` follows the configured window for a Claude model;
   - (b) it does the same for a proxied non-Claude id (Codex proxy, Ollama Cloud), or falls back to the 200k
     "unrecognized model" default;
   - (c) the env var wins when set.

   Then:
   - If E2 passes for a model class, sessions of that class with no user window shall get the default the architect
     proposes. The effective window and its source (setting, env, default) shall be logged at session start.
   - A value outside 100k-1M shall be rejected visibly, not dropped.
   - When `ptah.compaction.threshold` changes, `autoCompactThreshold` shall change according to the mapping the
     architect documents.
   - The 88/88 `autoCompact {}` audit result shall no longer reproduce.
   - If E2 fails for a class, no default is wired for that class, and the setting descriptions stop implying that the
     value is forwarded.

2. **R5.2 (A3)** When a built-in Bash, PowerShell, Grep, MCP or Read result exceeds the budget, the same turn shall
   see the reduced form from `libs/backend/tool-output-reducers` (no second capper), plus the full-output path. An
   oversized whole-file Read shall return an outline that points to the full file.
3. **R5.3 (A5)** This applies to Claude SDK subagents (Task tool) in a Ptah session, not CLI lanes. When a subagent's
   context reaches a setting whose default is 150,000 tokens, the system shall hand off and spawn fresh. Selective
   `subagentPromptCacheTtl: '1h'` shall apply only to sessions that use resumable subagents.
4. **R5.4 (A6)** When session context passes a setting whose default is 300,000 tokens, the user shall be offered
   "rotate session from spec + summary". Declining leaves the session unchanged.
5. **R5.5 (A7)** When compactions repeat in one session, the curator PreCompact trigger
   (`memory-trigger-config.ts:74-76`) shall fire at most once per watermark interval. The curator PreCompact reactor
   shall keep running (F12).
6. **R5.6 (A8)** The coordinator shall:
   - move through IDLE, ARMED, TRIGGERED, COMPACTING, COOLDOWN, BACKOFF and OBSERVE_ONLY, with unit tests on synthetic
     SDK messages for each transition;
   - deduplicate auto and manual triggers;
   - run `/compact` without ending the session first, then rebind to the new session id;
   - bound the `no-activity-watchdog.ts arm()` dwell to 180 s;
   - report context usage with provenance;
   - detect completion from `compact_boundary` (`pre_tokens`/`post_tokens`; `PostCompact` carries `session_id` on
     0.3.278);
   - emit telemetry.

   Fork/resume rollback ships only if E4 passes. The Codex path is observe-only.

### 6. Proxied sessions and the Responses translator (Wave 2.1, 2.4)

1. **R6.1** When a Claude-side session runs against a localhost, Ollama (Ollama Cloud included) or Moonshot base URL,
   only the `ptah` MCP server shall be connected.
   - Check: a unit test on the generated options.
   - Check: M on an Ollama Cloud L run (senior-tester), with first-request input recorded before and after.
2. **R6.2** When a request goes through the Responses translator, the system prompt shall be sent once, with
   `prompt_cache_key` = session id. Terminal input and cached tokens shall be logged at INFO. Where PR #602 already
   fixed a part, a unit test verifies it.

### 7. Usage accounting and display (D6, Wave 2.5)

1. **R7.1 (D6)** When a Codex turn completes, usage shall carry non-cached input (input minus cached), cached input
   and output as separate fields, in the shape the Claude path uses. The ledger shall not count cached tokens twice.
2. **R7.2** Repeated subagent metric lines with the same `message.id` shall count once, with the last line winning.
3. **R7.3 (F4)** `skill-budget.store` shall include cache tokens. `session-usage-ledger` shall record a per-request
   cost computed from the existing pricing source, `findModelPricing` (`libs/shared/src/lib/utils/pricing.utils.ts`),
   using that model's `inputCostPerToken`, `outputCostPerToken`, `cacheReadCostPerToken` and
   `cacheCreationCostPerToken`. When a model has no pricing entry, the ledger shall record the tokens with cost
   "unknown", never a guessed figure.
4. **R7.4** When a runtime reports no cache fields (Ollama Cloud), the display shall say "not reported", never 0.

### 8. OpenCode and Ollama Cloud lanes (D5)

1. **R8.1** OpenCode lanes shall run with auto-compaction effective, set through the existing
   `OPENCODE_CONFIG_CONTENT`.
   - Check: in an L run (senior-tester) whose context passes the configured reserve, `opencode.db` shall show a
     compaction. The baseline is zero compactions.
   - `compaction.prune`: verify first. Fallback: leave it off if the L run shows a regression.
2. **R8.2** If R1.3 finds that OpenCode lanes load user MCP servers or plugins besides `ptah`, they shall be disabled
   for the lane through documented `mcp.<name>.enabled` / `tools` keys.
   - Glob support in `tools`: verify first. Fallback: list explicit names.
   - R3.4 and R3.6 apply to OpenCode prompts. Before and after first-request input shall be recorded.
3. **R8.3** For Ollama Cloud, the before and after first-request and peak per-request input shall be recorded (R1.3,
   R6.1, R5.1). No absolute target is set, because no evidence supports one.

### 9. Lane orchestration guards (D4, Wave 4.2, 4.3, 4.4, 4.6)

1. **R9.1 (4.2)** When a resume is requested for a lane whose last per-request context is over 60k tokens, or that has
   been idle more than 10 minutes, the system shall spawn fresh with a handoff instead.
   - The SDK stream gives only the turn aggregate. Verify first that the last per-request figure can be read from the
     lane's rollout `token_count` (Codex) or `opencode.db` (OpenCode).
   - Fallback: a conservative estimate, labelled "estimate" in the log.
   - The figure shall never be the raw `turn.completed` sum.
2. **R9.2 (4.3)** `ptah_agent_wait` and `ptah_run_check` shall block until done or until a timeout of at most 900 s.
   They shall return a summary within the size bound the architect states (open note), with full logs under
   `.ptah/tmp`. Codex lanes shall set `mcp_servers.ptah.tool_timeout_sec` at or above that timeout; research verified
   the key reaches the config.
3. **R9.3 (4.4)** When a lane reaches 40 tool calls, it shall get one steer. At 60 it shall stop, with the reason shown.
   - Mid-turn injection into `codex exec` / `opencode run` is unverified, so verify it first.
   - Fallback: deliver the steer at the next turn boundary or resume.
   - Both thresholds shall be settings.
4. **R9.4 (4.4)** When a lane makes 20 identical tool+arguments calls, it shall stop. The threshold comes from tokaudit
   W4.4 (`research-report.md:319`) and shall be a setting.
5. **R9.5 (4.4)** A spawn that requests a blocked looping model (at least `mimo-v2.6-flash-free`) shall be refused with
   a message naming the model.
6. **R9.6 (4.4)** Nested Codex `spawn_agent` shall be unavailable to lanes.
   - `agents.enabled=false` (R3.2) removes the multi-agent blocks; that is verified.
   - Verify first, in the R3.1 L run (senior-tester), that the tool itself is absent.
   - Fallback: also set `agents.max_depth=1`. If the tool is still callable, stop the lane on a nested-agent item in
     the event stream.
7. **R9.7 (D4)** When N lanes run in parallel, each lane's prefix shall meet R3.2 and R3.6 on its own.
8. **R9.8 (4.6)** When a `command_execution` output contains U+2028, U+2029 or U+0085, the lane shall not fail with
   "Failed to parse item".
   - A unit test with that fixture shall pass.
   - An unparseable stdout line shall be logged and skipped, not end the lane.
   - The fix mechanism is the architect's (research lists three options).

## Non-functional requirements

- **Compatibility.** Changes in the five libraries shall work in VS Code, Electron and `ptah-cli`. The settings UI
  shall work in VS Code and Electron.
- **Platform boundary (F10).** File paths (`.ptah/tmp` logs, rollout and `opencode.db` locations, `~/.codex/config.toml`
  for R4.5) and settings shall resolve through the platform adapters (`platform-vscode`, `platform-electron`,
  `platform-cli`, behind `platform-core` ports). They shall not be hard-coded in `cli-agent-runtime` (CONVENTIONS.md
  layer table).
- **No capability regression.** On Codex, OpenCode and Ollama Cloud, all of the following shall still work: `ptah_*`
  tools reachable on turn one, web search on by default, resume, and the MCP URL scoped per workspace and agent
  (TASK_2026_364).
- **User-owned files.** No agent edits `~/.codex/config.toml` or files under `CODEX_HOME`. Ptah writes the config only
  through R4.5.
- **Quota.** `ptah_agent_spawn` is not used in any phase. Live runs follow L: QA only, senior-tester, at most 5 per
  runtime.

## Stakeholders

| Stakeholder                       | What they need                                | How they will judge it                                                 |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| The user (Claude and Codex plans) | Codex weekly usage proportionate to the work  | M on the next comparable orchestration; weekly `used_percent` per task |
| Other Ptah users                  | The same savings with no setup                | The defaults apply with empty settings                                 |
| Orchestrator agents               | Lanes keep their tools, web search and resume | No-regression checks in L                                              |

## Risks

| Risk                                                                     | Likelihood | Impact | Mitigation                                                                                                                   |
| ------------------------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| A future Codex renames the R3.2 keys, and the prefix silently grows back | MEDIUM     | HIGH   | Developer: a unit test pins the keys. Tester: re-run `codex debug prompt-input` on each Codex bump (R3.2).                   |
| Disabling plugins or agents hides `ptah` tools                           | LOW        | HIGH   | R3.1 L run lists and calls a `ptah_*` tool on turn one.                                                                      |
| A cheaper default model lowers lane quality                              | MEDIUM     | MEDIUM | User: approves the default at Gate 2. R2.2 keeps overrides. Researcher's suggested `used_percent` A/B, if the user funds it. |
| The role cap drops guidance a lane needs                                 | MEDIUM     | MEDIUM | Architect: say what the lane rendering keeps. Tester: the R3.7 L run completes the fixed task.                               |
| `tool_output_token_limit` does not cap code-mode output                  | MEDIUM     | MEDIUM | R4.2 fallback. R4.3 auto-compact is the binding outcome.                                                                     |
| The L budget (5 per runtime) is too small for every verify-first item    | MEDIUM     | MEDIUM | Senior-tester: plan the runs so one Codex run covers R3.1, R3.5 (by resuming it), R3.7, R4.2 and R9.6.                       |
| A user `CLAUDE_CODE_AUTO_COMPACT_WINDOW` silently overrides Ptah         | LOW        | LOW    | R5.1 logs the effective source.                                                                                              |

## Open notes for the architect

- R9.2: state the summary size bound (F7). The reviewer asked for a number. None exists in the sources, so the plan
  sets it, with a unit test.
- The tool-list token size of code-mode `ALL_TOOLS` is not visible in rollouts or `debug prompt-input`. Record it as an
  unknown; no requirement depends on it.
- Research Option C, spawning `codex exec` directly instead of through the SDK, would fix R9.8. It is a design choice,
  not required.
- Ollama Cloud billing basis (plan or token) is unverified; it affects only how R7.3 labels cost.

## Traceability

| Source item                                        | Requirement(s)                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 no default model                                | R2.1, R2.2, R2.5                                                                                                                                                                                                         |
| D2 whole-file reads persist                        | R4.2, R4.3, R5.2                                                                                                                                                                                                         |
| D3 fixed prefix                                    | R3.1, R3.2, R3.4, R3.6, R3.7                                                                                                                                                                                             |
| D4 parallel multiplication                         | R9.7, R3.7, R4.3                                                                                                                                                                                                         |
| D5 OpenCode / Ollama Cloud                         | R1.3, R1.5, R6.1, R7.4, R8.1, R8.2, R8.3                                                                                                                                                                                 |
| D6 usage display / ledger                          | R7.1, R7.3                                                                                                                                                                                                               |
| A0 experiments + Ollama 128k                       | R1.4, R1.5                                                                                                                                                                                                               |
| A1 Claude budget resolver (gated on E2)            | R5.1                                                                                                                                                                                                                     |
| A2 Codex auto-compact                              | R4.1, R4.3                                                                                                                                                                                                               |
| A3 Claude entry-time capper                        | R5.2                                                                                                                                                                                                                     |
| A4 Codex tool-output limit                         | R4.2                                                                                                                                                                                                                     |
| A5 subagent budget                                 | R5.3                                                                                                                                                                                                                     |
| A6 session rotation                                | R5.4                                                                                                                                                                                                                     |
| A7 curator guardrail                               | R5.5                                                                                                                                                                                                                     |
| A8 coordinator (incl. keep the PreCompact reactor) | R5.6, R5.5                                                                                                                                                                                                               |
| A9 Wave 0 as settings + TOML write                 | R4.4, R4.5                                                                                                                                                                                                               |
| Wave 2.1 proxied sessions ptah-only                | R6.1                                                                                                                                                                                                                     |
| Wave 2.2 Codex lane prefix                         | R3.1, R3.2, R3.3, R3.5, R3.7                                                                                                                                                                                             |
| Wave 2.3 effort precedence                         | R2.3, R2.4, R2.5                                                                                                                                                                                                         |
| Wave 2.4 Responses translator                      | R6.2                                                                                                                                                                                                                     |
| Wave 2.5 usage accounting                          | R7.1, R7.2, R7.3                                                                                                                                                                                                         |
| Wave 2.6 trim injected text                        | R3.4                                                                                                                                                                                                                     |
| Wave 4.2 resume gate                               | R9.1                                                                                                                                                                                                                     |
| Wave 4.3 blocking waits + `tool_timeout_sec`       | R9.2                                                                                                                                                                                                                     |
| Wave 4.4 lane budgets                              | R9.3, R9.4, R9.5, R9.6                                                                                                                                                                                                   |
| Wave 4.6 defensive parse                           | R9.8                                                                                                                                                                                                                     |
| B7 resume resends role                             | R3.5                                                                                                                                                                                                                     |
| Decision 6 live proof                              | Verification method L; every requirement that names a senior-tester owner                                                                                                                                                |
| Review F1-F12                                      | F1 L / R1.3-R9.6 owners; F2 R3.6; F3 R3.1-R3.3, R4.2, R9.1, R9.3, R9.6; F4 R7.3; F5 R2.3-R2.4; F6 R3.5; F7 R1.1, R5.1, R5.3, R5.4 (R9.2 bound carried as an open note); F8 R9.4; F9 R4.4; F10 NFR; F11 Context; F12 R5.5 |

## Handoff

- Next specialist: software-architect, after Gate 1.
- Why: the external facts are now in `research-report.md`. What remains is design shape: role rendering for lanes,
  the coordinator, settings placement, the parse fix and the steer mechanism.
