# CLI lane communication investigation

Read-only source review, 2026-11-06. Paths below are relative to the workspace root. **Verified** labels direct source evidence; **inferred** labels consequences. The Ptah symbol index returned zero symbols, so native text search supplied line citations. No tests or builds ran.

## Flow map

### Parent to lane: spawn and resume

1. The MCP agent namespace branches on `ptahCliId` and passes ordinary CLI requests to the process manager (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:338-388,423`). The manager checks `resumeSessionId` before constructing a handle (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:501-519`).
2. Role delivery and declared deliverables are passed to the adapter (`agent-process-manager.service.ts:872-882,976`). `buildTaskPrompt` supplies `PTAH_LANE_POLICY`, conditional `TWO_WAY_MESSAGING_GUIDANCE`, and the completion contract (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:572-629`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts:33-44`). A restored-context resume can omit policy and messaging blocks already delivered (`cli-adapter.utils.ts:550-576`).
3. The resume gate uses the previous context figure and idle duration. Above 150,000 tokens or 10 minutes, it creates a fresh handoff instead (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:38-48,98-118,248-266,308-317`). The rationale is thread resend and cold cache cost (`lane-resume-gate.ts:4-7,40-42`). Unknown context alone does not bar resume (`lane-resume-gate.ts:140,248-266`). Warm live-handle continuation bypasses the gate; SDK idle release is five minutes (`agent-process-manager.service.ts:2283-2289`).

### Parent to lane: message, message status, stop

1. MCP namespace calls `sendToAgent(agentId,message,delivery)` (`agent-namespace.builder.ts:511`); the manager delegates to the message router (`agent-process-manager.service.ts:2221-2260`). The router trusts live handle methods ahead of adapter declarations (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:403-425`).
2. Explicit `steer` requires a running Codex turn (`agent-message-router.service.ts:151-165`). Default Send interrupts and resumes when the handle supports it, otherwise queues for continuation or starts an idle turn (`:167-185,195-277`). Queued messages are bound to the CLI session ID and flushed after turn settle (`:319-361`). Status reads terminal, in-flight, or pending state (`:378-393`; `agent-process-manager.service.ts:2260`). Stop tears down the tracked agent; pending messages fail as `agent_stopped` (`agent-process-manager.service.ts:2468`; `agent-message-router.service.ts:364-375`).
3. A queued `delivered` receipt means the continuation call started, not that the lane acted on it (`agent-message-router.service.ts:333-339`). Receipt history is bounded in memory (`:391-393`).

### Lane to parent: report, completion, read/status/wait

1. MCP request context takes caller session and agent identity from URL-derived request metadata, not tool arguments (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts:5-13,24-40,71-93`). The report router returns `delivered:false` for unattributed caller, missing parent, inactive parent, rate limit, duplicate, or send failure (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:275-350,538`). Success uses `sendMessageToSession` and increments report count (`:341-379`; `agent-process-manager.service.ts:1966-1969`).
2. The manager signals terminal exit with report count, usage, tool calls, and dropped queued message count (`agent-process-manager.service.ts:3206-3247`). The notifier checks declared files for existence, nonzero size, and freshness, then computes `failed`, `unverified`, `no-deliverable`, or `delivered` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:647-715`). A live parent gets the `<agent-lane-completed>` envelope via `sendMessageToSession` (`:413-444`). Inactive or unresolved parents get `delivered:false`, while the outcome recorder is still enqueued (`:367-410`). Manager holds a completion while parent adoption is unsettled (`agent-process-manager.service.ts:2090-2149,3206-3212`).
3. Parent prompt says wait for push, then read; status is one-off recovery (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:79-86,111-122`). Stdio explicitly lacks push (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:591-616`). The skill permits bounded status/read fallback (`.claude/skills/agent-lanes/SKILL.md:140-154`). `ptah_agent_wait` is exposed in the MCP tool contract (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:70`).

### Capability declaration and probes

`CliAdapter.capabilities()` declares steer, interrupt, continuation; the `SdkHandle` exposes live methods and support probes (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:156-283`). List `messagingMode` derives from detection-time adapter capabilities (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:243`); Ptah CLI provider rows are hard-coded `queue` (`agent-namespace.builder.ts:559-560`). The router evaluates the live handle, which can disagree with the list (`agent-message-router.service.ts:403-425`).

## Capability matrix

`?` means not established in this pass; it does not mean absent. “Resume” means a new spawn with session ID.

| Adapter | Declared messaging mode | Actual behaviour | Steer | Interrupt | Continue/resume | Permission flags used today | Network | Limit reader exists | Evidence file:line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex | steer | App-server steer or queued next turn | yes | no | yes / yes | ? | app-server | ? | `cli-adapters/codex/codex-app-server-lane.adapter.ts:156,585-607` |
| Copilot | queue | Captured session permits next turn | no | no | conditional / `--resume` | ? | CLI/provider | ? | `cli-adapters/copilot-sdk.adapter.ts:235-236,328-340,480-491` |
| Cursor | interrupt | SDK continuation; default Send interrupts running turn | no | yes | yes / SDK resume | ? | SDK/provider | ? | `cli-adapters/cursor-cli.adapter.ts:274-275,409-410,525-536` |
| Antigravity | queue when stream JSON input detected; else none | stdin continuation while open | no | no | conditional / `--conversation` | `--dangerously-skip-permissions` | CLI/provider | ? | `cli-adapters/antigravity-cli.adapter.ts:304,321-322,434-439,1124-1125` |
| OpenCode | queue | next turn after resumable session ID | no | no | conditional / resume ID | `--auto` | CLI/provider | ? | `cli-adapters/opencode-cli.adapter.ts:23-25,352-353,721-735` |
| Pi | steer | handle has steer; public explicit steer rejected | handle yes; public no | no | conditional / `--session` | `-a` / `--approve` | CLI/provider | ? | `cli-adapters/pi-cli.adapter.ts:48,238-239,409-411,553-561`; `agent-message-router.service.ts:151-153` |
| Grok / ACP | queue | next `session/prompt`; no mid-turn steer | no | no | yes / ACP session | ACP permission policy | ACP/provider | ? | `cli-adapters/grok-cli.adapter.ts:12-13,181-182`; `cli-adapters/acp/acp-session-handle.ts:854-896` |
| Claude | queue | SDK session continuation | no | no | yes / yes | SDK/account permission | SDK/provider | ? | `cli-adapters/claude-cli.adapter.ts:92-93,168,196,222` |
| Other ACP adapters | ? | shared ACP session handle; vendor declaration unknown | ? | ? | conditional / ACP session | ACP permission policy | ACP/provider | ? | `cli-adapters/acp/acp-session-handle.ts:854-896`; `cli-adapters/acp/acp-permission-policy.ts:67-142` |
| Ptah CLI providers | queue | separate provider session, not `CliAdapter` | no declared steer | ? | provider session / resume ID | Claude route: `bypassPermissions` | provider API | plan-limit helper exists | `agent-namespace.builder.ts:338-388,559-560`; `ptah-cli/ptah-cli-registry.ts:624,809-868`; `ptah-cli/helpers/ptah-cli-lane-plan-limits.ts:77-163` |

## Defects

1. **High — Pi steer unreachable.** Pi advertises and implements steer (`pi-cli.adapter.ts:238-239,553-560`), but router hard-codes Codex for explicit steer (`agent-message-router.service.ts:151-153`). **Fix:** route by effective handle capability, with adapter-specific validation.
2. **High — completion push can be lost permanently.** Notifier remembers duplicate key before delivery (`lane-completion-notifier.service.ts:354-361`); inactive parent or send failure returns `delivered:false` (`:406-430`), but retry hits `already-signalled` (`:356-357`). **Fix:** separate computed/recorded from delivered state; retain an idempotent pending envelope and retry on parent activity.
3. **Medium — report is best-effort only.** Inactive parent or send error returns `delivered:false` with no retry branch (`agent-report-router.service.ts:318-350`). **Fix:** retain bounded attributed reports for later drain, or explicitly require parent read fallback.
4. **Medium — interrupted work can be lost without new-message delivery.** Router interrupts before attempting continuation; continuation failure returns `unsupported` though partial work is gone (`agent-message-router.service.ts:201-223`). **Fix:** distinct `interrupted-undelivered` outcome and recovery guidance with session ID.
5. **Medium — queued “delivered” overstates receipt.** Router marks delivered immediately after `continueConversation` resolves (`agent-message-router.service.ts:333-339`), before turn completion. **Fix:** distinguish accepted, started, settled, failed.
6. **Medium — list and live capability diverge.** List uses adapter declaration (`cli-detection.service.ts:243`); routing uses handle probes and process-release state (`agent-message-router.service.ts:403-425`). **Fix:** expose both potential and effective per-agent capabilities.
7. **Low — message status expires silently.** Terminal receipts live only in a bounded map (`agent-message-router.service.ts:108,378-393`). **Fix:** persist bounded receipts or return explicit `expired`.

## Inconsistencies (docs vs code)

1. `README.md:95` says ACP-capable lanes can steer or interrupt. Grok ACP explicitly has neither (`grok-cli.adapter.ts:12-13,181-182`), and explicit public steer is Codex-only (`agent-message-router.service.ts:151-153`). Describe capabilities by adapter, not transport.
2. `.claude/skills/agent-lanes/SKILL.md:243-244` says list messaging is probed per run. The list is derived from adapter capabilities at detection (`cli-detection.service.ts:243`); the handle is probed at message time (`agent-message-router.service.ts:403-425`). Clarify potential versus effective mode.
3. `ptah-core-prompt.ts:84` and `SKILL.md:121-124` present push as the wake. Push can be refused without retry (`lane-completion-notifier.service.ts:354-357,406-410`). The skill fallback at `:140-149` belongs in the short parent prompt too.
4. `SKILL.md:253-255` says policy and contract go to every lane, while messaging is conditional. The implementation confirms this for a first turn but deliberately omits previously delivered policy/messaging blocks on restored-context resume (`cli-adapter.utils.ts:572-629`). Clarify resume wording.

## Proposed unified control model

Define one adapter manifest with potential `steer`, `interrupt`, `continue`, `resume`, policy delivery channel, permission mode, network dependence, and limit reader. Each live handle returns an effective manifest after session setup. Keep list-level potential and per-agent effective capabilities separate. Derive Send / Send now / Stop / Resume UI state from the effective manifest. Send queues by default. Send now prefers true steer; an interrupt-plus-resume fallback must disclose loss of partial turn work and return its actual result. Track message receipts through accepted, started, settled, failed. Retain completion envelopes until delivered or acknowledged by read. Give Ptah CLI providers the same manifest shape at their registry boundary.

Minimal file set: `cli-adapter.interface.ts`, `cli-detection.service.ts`, `agent-message-router.service.ts`, `agent-process-manager.service.ts`, `lane-completion-notifier.service.ts`, `agent-report-router.service.ts`, `agent-namespace.builder.ts`, MCP schemas/dispatcher, `ptah-cli-registry.ts`, affected UI controls, `ptah-core-prompt.ts`, `agent-lanes/SKILL.md`, `README.md`. Preserve Electron's shared backend route and status/read fallback.

## Decisions

- **Investigation framing:** compare declared with effective live capability; they differ for Pi and conditional continuation. Options were to use list only or inspect handles; the latter is supported by `cli-detection.service.ts:243` and `agent-message-router.service.ts:403-425`. Reversible: yes. No product choice made.
- **Proposal:** call interrupt-plus-resume lossy and return a distinct result; `agent-message-router.service.ts:195-234` proves partial work can be discarded. Reversible: yes.

## Clarifications Needed

- May Send now discard a running turn when true steer is absent? **Require explicit user confirmation (recommended)** / always interrupt / never offer fallback. Evidence: `agent-message-router.service.ts:195-234`.
- Should inactive-parent completion/report be pushed on session resume? **Push once and retain read fallback (recommended)** / read fallback only. Evidence: `lane-completion-notifier.service.ts:354-410`; `agent-report-router.service.ts:318-350`.

## Investigation limits

Permission flags, network details, and limit readers marked `?` need adapter-by-adapter confirmation. This report does not claim runtime probes or a complete inventory for those columns. No source file was edited.
