# Lane research — Antigravity (agy) and Cursor

> **Conductor correction (see `../research-report.md`, "Live probes", and `../implementation-plan.md`).**
> This is raw lane output. The Antigravity native-selection claims below (the
> `.agents/agents/<name>/agent.md` path, `mainAgent: true`, root-session behavior) are
> **unverified**: `agy --agent probe -p "Say hello"` ignored the definition and `agy agents`
> listed nothing. Native selection is deferred; v1 delivers the role as a preamble. The role is
> passed as `CliCommandOptions.role` and rendered by `buildTaskPrompt(options, cli)`, not folded
> into `options.systemPrompt`.

## Antigravity

- **1. Native selection (unverified — probe ignored it):** Upstream CLI documents native agent selection via `agy --agent <name> --print "<prompt>"` (`agy --help` lists `--agent Agent for the current CLI session` and `agy agents`). Custom agents are discovered at `.agents/agents/<name>/agent.md` (or `_agents/`, `.agent/`) in workspace or `~/.gemini/config/agents/<name>/agent.md` globally, or declared in `agents.json`. The file format is Markdown with YAML frontmatter and an `# System Prompt` header. Required frontmatter fields are `name` and `description`; running as the root CLI session requires `mainAgent: true` (v1.1.6 changelog: *Custom Agents (Markdown Format)*; frontmatter fields include `mainAgent`, `subagent`, `model`, `inheritMcp`, and `commandExecutionPolicy`).
- **2. Semantics (unverified, as documented by the lane):** When configured with `mainAgent: true`, the `# System Prompt` replaces the default assistant persona while directory-level rules (`GEMINI.md`/`AGENTS.md`) and built-in tool protocols remain appended. The frontmatter `model` (`flash` | `pro` | `inherit`) and `commandExecutionPolicy` restrict model and permissions per agent unless overridden by CLI `--model`/`--sandbox`. However, in headless print mode (`--print`), passing `--agent` with an unindexed or missing agent silently falls back to the default persona without an error code.
- **3. Fallback injection:** Best injection point is a prompt prefix / preamble via Ptah's [`buildTaskPrompt(options)`](D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts#L357) prepended to the task prompt. `agy` provides no CLI flag for ad-hoc system prompts (`antigravity-cli.adapter.ts:453` notes no `GEMINI_SYSTEM_MD` support in `agy`). Standalone `AGENTS.md` / `GEMINI.md` files apply workspace-wide to all sessions. Command-line argv transport under Windows `CreateProcess` limits `--print` to 32,767 characters; larger payloads require `--input-format stream-json` over stdin.
- **4. Current adapter / change:** [`antigravity-cli.adapter.ts:455-481`](D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L455-L481) calls `taskPrompt = buildTaskPrompt(options)`, builds argv `['--output-format', 'stream-json', '--dangerously-skip-permissions', ..., '--print', taskPrompt]`, and spawns `agy` at line 493. For preamble delivery, prepend `options.role` into `options.systemPrompt` before line 455. For native delivery, insert `if (options.role) args.splice(args.indexOf('--print'), 0, '--agent', options.role);`.
- **5. Harness compatibility:** **Coverage gap.** Ptah explicitly marks Antigravity agents as unsupported in [`rival-targets.ts:16, 28-32`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/rival-targets.ts#L16-L32) (*"`agy` documents no subagent format... the facet reports unsupported"*), writing zero agent files for `agy`. While `agy` v1.1.6 supports `.agents/agents/<name>/agent.md`, Ptah has no transformer to generate them.
- **6. Confidence / experiment:** High on CLI flags, schema, and adapter mechanics; medium-high on headless root replacement. Experiment: Write a test `.agents/agents/reviewer/agent.md` with `mainAgent: true` and prompt `Reply ONLY with ROLE_ACKNOWLEDGED`, run `agy --agent reviewer -p "ping"`, and verify that `ROLE_ACKNOWLEDGED` appears in output.

---

## Cursor

- **1. Native selection:** **No.** Ptah does not run an external `cursor-agent` executable; it executes in-process via `@cursor/sdk` (v1.0.13) [`Agent.create()`](D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-adapters/cursor-cli.adapter.ts#L346). [`AgentOptions`](D:/projects/ptah-extension/node_modules/@cursor/sdk/dist/esm/options.d.ts#L122-L144) accepts `agents?: Record<string, AgentDefinition>`, and Cursor discovers filesystem subagents at `.cursor/agents/**/*.md` (YAML frontmatter: `name`, `description`, optional `model`, `tools`). However, neither the SDK nor any headless CLI flag allows selecting a subagent to run **as** the root session agent.
- **2. Semantics:** Defined agents are converted by [`convertAgentDefinitionsToCustomSubagents`](D:/projects/ptah-extension/node_modules/@cursor/sdk/dist/esm/subagent-conversion.d.ts#L15) into delegated subagents (`RuntimeCustomSubagentDefinition[]`). They do not replace or append to the root system prompt; they are exposed as delegated tools (e.g. `Task`) that the root model may or may not invoke. Child tool and model restrictions apply only when delegated.
- **3. Fallback injection:** Best injection point is prompt prefix / preamble injected into the first turn `prompt` passed to `agent.send(prompt)` via [`buildTaskPrompt(options)`](D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts#L285). Workspace `.cursorrules` or `AGENTS.md` affects all runs and lacks per-spawn scoping. Because `@cursor/sdk` communicates in-memory / over IPC, there are no OS argv limits; prompt size is bounded only by LLM context.
- **4. Current adapter / change:** [`cursor-cli.adapter.ts:285-354`](D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts#L285-L354) builds `taskPrompt = buildTaskPrompt(options)`, creates the agent with `sdk.Agent.create({ apiKey, model, local: { cwd }, mcpServers })`, and runs turn 1 via `agent.send(prompt)` at line 354 (`startTurn(taskPrompt)` at line 440). Change: fold the resolved role body into `options.systemPrompt` before `buildTaskPrompt(options)` at line 285.
- **5. Harness compatibility:** Matches documented format for delegated subagents. [`cursor-agent-transformer.ts:24-28`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/transformers/cursor-agent-transformer.ts#L24-L28) emits `{ws}/.cursor/agents/<id>.md` with `name`, `description`, and body. While valid for delegation, it cannot be targeted natively as the root runner persona.
- **6. Confidence / experiment:** High (verified against `@cursor/sdk` TypeScript definitions and adapter source). Experiment: Run `@cursor/sdk` `Agent.create({ agents: { testRole: { description: 'test', prompt: 'Echo ROLE_VERIFIED' } } })` and send a greeting without preamble to confirm it does not adopt the role without explicit delegation.

---

## Recommendation

- **Antigravity:** `roleDelivery: preamble` — deliver the role through `CliCommandOptions.role`, rendered into the task prompt by `buildTaskPrompt(options, 'antigravity')` (corrected: the lane originally proposed injecting it into `options.systemPrompt`). Native selection stays deferred until a probe returns the marker.
- **Cursor:** `roleDelivery: preamble` — deliver the role through `CliCommandOptions.role`, rendered into the first-turn prompt by `buildTaskPrompt(options, 'cursor')` (corrected: the lane originally proposed injecting it into `options.systemPrompt`).

---

## Open questions

- The spec file referenced in the prompt (`.ptah/specs/TASK_2026_433_d22a/context.md`) is absent from this repository checkout.
- For Antigravity, should `harness-sync` add an `AntigravityAgentTransformer` writing `.agents/agents/<id>/agent.md` with `mainAgent: true` to unlock native `--agent <role>` execution once upstream stabilizes headless verification?
- For Cursor, when `roleDelivery: preamble` is used, should `options.role` also register into `AgentOptions.agents` so self-delegation remains available if the role delegates to itself or peers?
