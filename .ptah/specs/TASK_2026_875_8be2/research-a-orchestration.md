# Research Lane A — Agent Orchestration & Runtime Backend Hidden Features

## Summary

1. **Empirical System-1 Multi-Vendor Router & Self-Review Ledger (`lane-routing`, `lane-outcomes`)**: Ptah routes coding, architecture, and review turns across installed CLI vendors using a fast `/v1/systemone` decision model blended with a 90-day local Bayesian outcome ledger that verifies deliverables on disk and structurally blocks self-reviews.
2. **True Dual-Runtime Engine with Native Codex App Server & ACP Multi-CLI Lanes (`codex-runtime`, `agent-sdk`, `cli-agent-runtime`)**: Main chat runs natively on both Anthropic's Claude Agent SDK and OpenAI's JSON-RPC `codex app-server` protocol with sanitized cross-runtime transcript carry-over, while background lanes orchestrate 8+ CLI vendors over the Agent Client Protocol (`@agentclientprotocol/sdk`) with 4-mode mid-turn steering.
3. **Cache-Economics Lane Resume Gate, Idle Compaction, & Subagent Budget Guardrails (`cli-agent-runtime`, `agent-sdk`)**: Every lane continuation, idle session, and subagent turn is governed by prompt-cache TTL and cost-weighted token math—automatically choosing between 0.1x cache-read resumes vs fresh handoff briefs, compacting idle sessions before cache expiry, and writing `.handoff.md` continuity notes before subagents hit context walls.
4. **Zero-Downtime Session Handoff with Live Background Work Adoption & Worktree Child Sessions (`cli-agent-runtime`)**: When a main session approaches context limits, `/session-handoff` opens a fresh session tab and live-reparents all in-flight CLI lanes and git-worktree-isolated child sessions (`ptah_session_start`) so their completion envelopes route to the new session without dropping a beat.
5. **Closed-Loop Skill Archaeology, Multi-Target Harness Sync, & Certified Multi-Account Isolation (`skill-synthesis`, `harness-sync`, `auth-providers`)**: Ptah mines session transcripts and completed task specs into judge-scored skill upgrades, reconciles skills/agents/MCP across 7 vendor harnesses with git-proved retirement safety, and enforces 8-step pre-launch + post-init identity tripwires across multiple personal/API accounts.

---

## Feature inventory

### 1. System-1 Decision Model & Bayesian Prior-Blended Capability Matrix (`lane-routing`)
- **What it does**: `RouteDecideService` (`ptah_route_decide`) classifies each turn's task type (`architecture`, `review`, `debugging`, `refactor`, `implementation`, `frontend`, `investigation`, `planning`, `docs-ops`, `verification`), assesses scope (`single` vs `multi-step` vs `full-feature`), and selects whether to handle work in-process or delegate to an external CLI vendor lane (`claude`, `codex`, `copilot`, `cursor`, `antigravity`, `opencode`). It combines a fast 3-second `/v1/systemone` classifier (`SystemOneClient`) with a local 90-day empirical capability matrix that blends real workspace pass/fail outcomes with seed priors (`round(100 * (s + k * prior / 100) / (n + k))`). It also enforces hard constraints such as cross-family review diversity (`hard-constraints.ts`).
- **Why it is unique**: Cursor, Windsurf, Copilot, and Cline require the user to manually pick a model from a dropdown per turn and have zero awareness of historical vendor pass rates in the repo. Claude Code and Codex CLI only route within their own vendor models. Ptah is the only platform with an empirical, self-updating multi-vendor capability matrix and automated scope/delegation router.
- **Evidence**:
  - `libs/backend/lane-routing/src/lib/route-decide.service.ts:62-215`
  - `libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:30-45` (`PRIOR_STRENGTH = 5`, ` WINDOW_MS = 90 days`, `blend()` at `L67-83`)
  - `libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts:11-16` (`SYSTEM_ONE_PATH = '/v1/systemone'`, `DEFAULT_TIMEOUT_MS = 3000`, `L112-165`)
  - `libs/backend/lane-routing/src/lib/ranking/hard-constraints.ts:53-56` (`enforceCrossFamilyReview` at `L122-140`)
- **Docs status**: `hidden` — Zero mentions of `route_decide`, `systemone`, or the Bayesian capability matrix in `README.md`, `apps/ptah-landing-page`, `libs/web`, or `apps/ptah-docs`.
- **Recency**: New/heavily enhanced in the last 5 weeks (`7402fb558` SystemOne `/v1/systemone` client, `e60d665c3` structured decision model, `3d87596ac` local empirical matrix derivation, `d3ed06092` scope assessment, `899776384` `ptah_route_decide`).
- **Marketing angle**: *"Stop guessing which AI model is best for the job—Ptah benchmarks every agent on your actual repo over a rolling 90-day window and routes each task to the proven winner."* (Target: Staff/Principal engineers and multi-subscription power users).
- **Maturity**: `shipped`

### 2. Empirical Lane Outcome Ledger, Disk Deliverable Verifier, & Self-Review Guard (`lane-outcomes`)
- **What it does**: `LaneOutcomeRecorderService` automatically records every CLI lane and subagent lifecycle event (`started`, `completed`, `failed`, `stopped`, `timed-out`) into an append-only JSONL ledger (`~/.ptah/metrics/lane-outcomes.jsonl`) and SQLite store. When an orchestrator or reviewer records an explicit verdict via `ptah_outcome_report`, `applyOutcomeReport` verifies every declared deliverable file directly on disk (`exists`, `bytes > 0`, and `mtimeMs >= record.startedAt`) and detects self-reviews (`isSelfReview` when `reviewerVendor === record.vendor`), which are excluded from review-pass credit. It also joins delayed reviews that arrive after a run closes and aggregates per-role `AgentOutcomeSignals` (`passRate`, `verifyFirstTryRate`, `meanDurationMs`).
- **Why it is unique**: Competitors treat agent completions as fire-and-forget chat messages; an agent can claim it wrote a file or review its own code without any runtime check. Ptah cryptographically/filesystem-verifies deliverables against the run's start timestamp and structurally prevents same-vendor self-grading from polluting routing scores.
- **Evidence**:
  - `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:148-245`
  - `libs/backend/lane-outcomes/src/lib/write/report-effect.ts:51-56` (`isSelfReview`), `L74-90` (`verifyDeliverables` checking `stat.size > 0` and `stat.mtimeMs >= startedAt`)
  - `libs/backend/lane-outcomes/src/lib/agent-signals.ts:7-61` (`computeAgentOutcomeSignals`)
- **Docs status**: `hidden` — Not mentioned in `README.md`, `apps/ptah-landing-page`, `libs/web`, or `apps/ptah-docs`.
- **Recency**: Built in the last 5 weeks (`26780cb0c` JSONL outcome recorder, `45416c4f4` delayed review join, `4795efff9` `ptah_outcome_report`, `4f366911b` agent-level outcome signals, `ee54e55e8` SQLite storage).
- **Marketing angle**: *"Trust, but verify on disk: Ptah checks that every agent deliverable actually exists, is non-empty, and is reviewed by a different model family before counting it as a pass."* (Target: Engineering leads and autonomous workflow builders).
- **Maturity**: `shipped`

### 3. Native Codex App-Server Runtime & Dual-Runtime Chat Router with Carry-Over Projection (`codex-runtime`, `agent-sdk`)
- **What it does**: Instead of shimming OpenAI models through a lossy HTTP translation proxy or basic CLI wrapper, Ptah includes a dedicated `CodexRuntime` (`CodexAppServerProcess`) that speaks the native bidirectional JSON-RPC `codex app-server` protocol (`thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `command/exec`, `review/start`, `account/rateLimits/read`). `RoutingAgentAdapter` switches main-chat sessions seamlessly between the Claude Agent SDK and `CodexChatAdapter` based on the selected model's runtime tag, and `projectCarryOverTranscript` projects and sanitizes the last 16 messages (redacting `sk-ant-*`, `sk-*`, `ghp_*`, `xox*`, and Bearer tokens) when a user switches runtimes mid-conversation.
- **Why it is unique**: Cursor and Windsurf wrap models in proprietary cloud completions pipelines, losing native Claude Code and Codex agentic harness capabilities (native `/compact`, `/review`, sub-agent Collab tool calls, native sandbox approvals, live rate-limit windows). Ptah runs *both* official agent runtimes natively under one roof and carries sanitized context across them when you switch mid-thread.
- **Evidence**:
  - `libs/backend/codex-runtime/src/lib/codex-runtime.ts:88-178` (`RateLimitsObserver`), `L181-250` (`createCodexRuntime`)
  - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:148-250` (`CodexChatAdapter`)
  - `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:38-137` (`RoutingAgentAdapter`)
  - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.ts:15-52` (`projectCarryOverTranscript`, `SECRET_PATTERNS`)
- **Docs status**: `hidden` — `README.md` still lists `@openai/codex-sdk` generally, with zero mention of the native `codex app-server` JSON-RPC runtime, dual-runtime `RoutingAgentAdapter`, or secret-redacted cross-runtime carry-over projection.
- **Recency**: Major overhaul in the last 3 weeks (`bac9eb3c6` retire `@openai/codex-sdk`, `ff0530284` native `codex-runtime` lib, `e08327d13` `CodexChatAdapter` & `RoutingAgentAdapter`, `2a1411c86` cross-runtime carry-over, `b8d7c78f4` Codex Collab sub-agent cards).
- **Marketing angle**: *"Native Claude Code AND Native OpenAI Codex App Server in one IDE—switch between Anthropic and OpenAI mid-conversation without losing your thread or exposing secrets."* (Target: Developers paying for both Claude Max/Pro and ChatGPT Plus/Pro).
- **Maturity**: `shipped`

### 4. Multi-Vendor CLI Agent Lanes & Agent Client Protocol (ACP) Engine (`cli-agent-runtime`)
- **What it does**: `AgentProcessManagerService` spawns and supervises parallel background CLI lanes across 8 external CLIs (`claude`, `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `grok`, `pi`) plus `ptah-cli` API providers (`kimi`, `glm`, `minimax`, `qwen`, `deepseek`, `openrouter`, `ollama`). For ACP-capable agents, `AcpSessionHandle` maintains a persistent `@agentclientprotocol/sdk` JSON-RPC stdio connection supporting 4 live mid-turn delivery modes (`steer` into the active turn, `queue-next-turn`, `interrupt-resume`, or `unsupported`) and pushes structured `<agent-lane-completed>` verification envelopes back to the parent session the instant a lane finishes.
- **Why it is unique**: Claude Code subagents only run Claude; Codex subagents only run OpenAI; Cursor background agents run in Cursor's cloud. Ptah orchestrates every major vendor CLI locally on your machine over the standardized Agent Client Protocol, letting you steer a running lane mid-turn and pushing completion diffs (`git diff --stat`) back automatically without polling.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:62-245`
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp/acp-session-handle.ts:172-250` (`AcpSessionHandle`, `send` with `steer`/`interrupt-resume`/`queue-next-turn`)
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-envelope.ts:57-100` (`buildLaneCompletionEnvelope`)
  - `.claude/skills/agent-lanes/SKILL.md:232-242` (mid-turn delivery mode matrix)
- **Docs status**: `under-emphasized` — `apps/ptah-docs/src/content/docs/agents/cli-agents.md` and `README.md` mention CLI lanes conceptually, but neither `README.md` nor the landing page explains the ACP protocol engine, the 4 mid-turn steering modes, or automatic `<agent-lane-completed>` push envelopes.
- **Recency**: Enhanced in the last 5 weeks (`cd346800f` Antigravity CLI adapter & quota reader, `540a604d4` multi-account routing for lanes, `ddc17f633` Windows spawn hardening).
- **Marketing angle**: *"Turn rival AI CLIs into teammates: spawn Claude, Codex, Copilot, Cursor, and Gemini lanes in parallel and steer them mid-turn over the Agent Client Protocol."* (Target: Power users who install multiple AI CLIs).
- **Maturity**: `shipped`

### 5. Cache-Economics Lane Resume Gate & Repeat-Call Loop Breaker (`cli-agent-runtime`)
- **What it does**: Before resuming any completed CLI lane (`resumeAgentId`), `LaneResumeGate` inspects the lane's accumulated context tokens (reading Codex rollout JSONL `token_count` events or stream usage) and idle elapsed time against prompt-cache economics (`RESUME_GATE_MAX_CONTEXT_TOKENS = 150,000` and `RESUME_GATE_MAX_IDLE_MS = 10 min`). Because warm cache reads cost 0.1x input price while an expired cache re-bills the entire prefix at 1.0x–1.25x, the gate blocks wasteful resumes and instructs the caller to spawn a fresh lane with a compact handoff brief. During execution, `LaneBudgetGuard` avoids arbitrary tool-call ceilings (which cut off productive deep work) and instead hashes `(toolName, canonicalInput)` for non-edit tools (`Read`, `Grep`, `Glob`, `Bash`, etc.), auto-stopping a lane only when the exact same call repeats `repeatAt` (default 20) times.
- **Why it is unique**: Other agent frameworks either resume blindly (burning $1–$3 in uncached prefix re-ingestion after a 10-minute pause) or enforce blunt `maxSteps`/`maxToolCalls` limits that kill legitimate multi-file refactors while failing to catch infinite `grep` loops.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46-50` (`150_000` tokens, `10 * 60 * 1000` ms TTL), `L89-160` (`evaluateLaneResume`), `L165-210` (`readCodexRolloutContextTokens`)
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts:28-33` (`DEFAULT_REPEAT_WARN_AT = 10`, `DEFAULT_REPEAT_STOP_AT = 20`), `L58-135` (`onToolStart` with SHA-1 canonical input hashing)
- **Docs status**: `hidden` — Completely absent from `README.md`, `apps/ptah-landing-page`, `libs/web`, and `apps/ptah-docs`.
- **Recency**: Shipped in the last 3 weeks (`b18881c67` replace tool-call ceiling with repeat-call loop guard; `8e3522203` certified account check in `LaneResumeGate`).
- **Marketing angle**: *"Built for prompt-cache math: Ptah blocks cold-cache resumes that would 10x your token bill and kills infinite tool loops without capping deep multi-file refactors."* (Target: Cost-conscious developers and heavy agent users).
- **Maturity**: `shipped`

### 6. Certified Multi-Account Claude Isolation & Post-Init Subscription Tripwire (`auth-providers`, `agent-sdk`)
- **What it does**: Users with multiple Claude accounts (e.g., personal Pro/Max + team/work accounts or API keys) can bind specific accounts to main chat or background lanes. Before launching or resuming a named personal account, `ClaudeRouteCertifier` and `prepareCertifiedClaudeLaunch` execute an 8-step certification: binary SHA-256 fingerprint check, Windows Registry/macOS MDM/Linux `/etc/claude-code` managed-policy scan (`scanClaudeAuthPolicy`), stripped environment allowlist (`CLAUDE_CERTIFIED_ENV_KEYS`), per-account `CLAUDE_CONFIG_DIR` isolation, and settings override inspection. On the first SDK `system/init` message, `claudePersonalLoginCheck` runs a runtime tripwire verifying that `apiKeySource === 'none'` and the live `subscriptionType` matches `pro`/`max`/`team`/`enterprise`—aborting immediately before a single token is billed to the wrong account.
- **Why it is unique**: In VS Code, Cursor, or raw Claude Code CLI, ambient `ANTHROPIC_API_KEY` env vars, `~/.claude/settings.json` helpers, or corporate MDM profiles silently hijack personal OAuth sessions (or vice versa), causing surprise API bills or cross-account leakage. Ptah is the only host with cryptographic/policy pre-flight certification and a post-init subscription tripwire.
- **Evidence**:
  - `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts:179-250` (`ClaudeRouteCertifier.certify` steps 1–8)
  - `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:14-62` (`CLAUDE_CERTIFIED_ENV_KEYS`), `L69-105` (`claudePersonalLoginCheck`), `L164-194` (`prepareCertifiedClaudeLaunch`)
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:216-245` (blocks cross-account or uncertified lane resume)
- **Docs status**: `hidden` — Zero mentions of `ClaudeRouteCertifier`, 8-step route certification, or the post-init subscription tripwire in `README.md`, landing page, or docs.
- **Recency**: Shipped in the last 2 weeks (`8e3522203` harden multi-account isolation across main chat, CLI lanes, and output styles; `733ebc9b9` multi-account auth providers).
- **Marketing angle**: *"Run your personal Claude Max and work accounts side-by-side with zero cross-contamination—guaranteed by an 8-step pre-flight isolator and post-init billing tripwire."* (Target: Consultants, agencies, and devs juggling work + personal AI subscriptions).
- **Maturity**: `shipped`

### 7. Cross-Vendor Live Plan-Limit Ledger & Quota Owner Discovery (`auth-providers`, `cli-agent-runtime`)
- **What it does**: `PlanLimitLedgerService`, `PlanUsageService`, and `LaneLimitLookupService` track live 5-hour and 7-day subscription windows, reset timestamps, and credit-fallback status across Claude, Codex (`RateLimitsObserver`), Kimi Code (`fetchKimiUsages`), Antigravity (`fetchAntigravityQuota`), OpenCode (`createOpenCodeLocalUsageReader`), and Grok (`createGrokSessionUsageReader`). `AccountQuotaOwnerDiscoveryService` maps credentials to underlying quota owners so multiple aliases sharing one billing pool share the same ledger entry. When a user or orchestrator calls `ptah_agent_list` or `ptah_agent_spawn`, Ptah annotates each vendor with live remaining percentages (`5h: 12% left, resets 2026-...`), distinguishes `plan` vs `credit` fallback billing (`evaluateSpawnGate`), and refuses to spawn `AT LIMIT` lanes.
- **Why it is unique**: Competitors only show usage for their own single subscription (often hidden in a web dashboard). Ptah aggregates live subscription windows across 6+ external AI vendors in real time and feeds them directly into the agent router so tasks automatically route around rate-limited accounts.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:62-97` (`formatStatusTag`), `L146-244` (`LaneLimitLookupService.lookup`)
  - `libs/backend/auth-providers/src/lib/quota/index.ts:1-58` (`PlanLimitLedgerService`, `PlanUsageService`, `fetchKimiUsages`, `fetchAntigravityQuota`, `createOpenCodeLocalUsageReader`)
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:132-136` (`billingMode`: `'plan' | 'credit' | 'unknown'`)
- **Docs status**: `under-emphasized` — Provider docs (`apps/ptah-docs/src/content/docs/providers/kimi-code.md`) mention quota display briefly, but the unified cross-vendor `PlanLimitLedgerService`, quota-owner deduplication, and `AT LIMIT` spawn gate are undocumented on `README.md` and the landing page.
- **Recency**: Expanded in the last 4 weeks (`cafb70221` & `ddc7f4e5d` Kimi Code quota window mapping, `cd346800f` Antigravity quota reader, `ff0530284` Codex `RateLimitsObserver`).
- **Marketing angle**: *"One live fuel gauge for every AI subscription you own—Ptah tracks 5-hour and weekly rate limits across Claude, Codex, Kimi, and Gemini and routes around exhausted plans automatically."* (Target: Multi-subscription developers).
- **Maturity**: `shipped`

### 8. Worktree-Isolated Interactive Child Chat Sessions (`ptah_session_*`, `cli-agent-runtime`)
- **What it does**: Through `SessionSpawnerService` (`ptah_session_start`, `ptah_session_send`, `ptah_session_status`, `ptah_session_read`, `ptah_session_stop`), a main chat session can spawn up to 3 concurrent child *full Ptah chat sessions* (`MAX_CONCURRENT_CHILDREN_PER_PARENT = 3`). Unlike headless CLI lanes, each child session is automatically provisioned in its own isolated git worktree and `ptah-child/<id>` branch (`ChildWorktreeProvisioner`), opens as a real interactive tab in the UI where the user can watch or intervene, inherits parent autopilot permissions, and queues completion envelopes in `heldCompletions` if the parent session is temporarily offline.
- **Why it is unique**: Subagents in Claude Code, Cline, and Cursor are headless black boxes that share the same working tree—causing git index lock collisions when two agents edit or build simultaneously. Ptah spawns full interactive child sessions, each in a dedicated git worktree with its own UI tab.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:35` (`MAX_CONCURRENT_CHILDREN_PER_PARENT = 3`), `L155-250` (`start`, worktree provisioning, tab opening)
  - `libs/backend/cli-agent-runtime/src/lib/session-children/index.ts:1-81` (`ChildWorktreeProvisioner`, `ChildCompletionRouter`, `SessionLinkTaskService`)
- **Docs status**: `documented` in docs (`apps/ptah-docs/src/content/docs/agents/agent-sessions.md`), `hidden` on `README.md` and `apps/ptah-landing-page`.
- **Recency**: Enhanced in the last 4 weeks (`f80136b99` re-parent child sessions across handoff).
- **Marketing angle**: *"Subagents you can actually see and talk to—each spawned in its own git worktree and live UI tab so parallel builds never collide."* (Target: Full-stack engineers running parallel feature branches).
- **Maturity**: `shipped`

### 9. Zero-Downtime Session Handoff with Live Background Work Adoption (`cli-agent-runtime`, `.claude/skills/session-handoff`)
- **What it does**: When a long session's context fills up, `SessionHandoffService` (`ptah_session_handoff` / `/session-handoff`) writes a structured `HANDOFF.md` continuity file (`MAX_HANDOFF_BYTES = 32 KiB`), opens a brand-new top-level chat session tab seeded with the continuation prompt, and calls `adoptWork()` on both `AgentProcessManagerService` and `SessionSpawnerService`. Any CLI agent lanes or child sessions still running in the background are live-reparented to the new session ID—and any completions that arrived during the millisecond transition are immediately flushed to the new session.
- **Why it is unique**: In Claude Code, Cursor, or Cline, starting a new session orphans every running background agent or requires waiting for all background tasks to finish before compacting/resetting. Ptah hot-transfers live background processes to the successor session without interrupting them.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:98-250` (`initiateHandoff`, `adoptWork` at `L210-250`)
  - `.claude/skills/session-handoff/SKILL.md:1-75` (never waits or polls for in-flight lanes; `ptah_session_handoff` re-parents them automatically)
- **Docs status**: `under-emphasized` — Docs mention `handoff` in passing (`apps/ptah-docs/src/content/docs/agents/agent-orchestration.md`), but live background process adoption (`adoptWork`) is completely undocumented on `README.md`, landing page, and docs.
- **Recency**: Shipped in the last 3 weeks (`f80136b99` & `f73433376` session handoff work adoption and MCP tool).
- **Marketing angle**: *"Fresh context window, zero dropped threads: `/session-handoff` boots a clean session and live-transfers all running background agents to the new tab."* (Target: Developers running multi-hour autonomous tasks).
- **Maturity**: `shipped`

### 10. Cost-Weighted Subagent Budget Monitor & Automatic `.handoff.md` Continuity (`agent-sdk`)
- **What it does**: `SubagentBudgetMonitor` hooks into every in-process `Task`/`Agent` subagent turn (`onAssistantMessage`, `onPostToolUse`) and tracks both raw context window tokens and a TTL-aware **cost-weighted token budget** (`COST_WEIGHTS`: input `1x`, cacheRead `0.1x`, output `5x`, 5m cacheWrite `1.25x`, 1h cacheWrite `2.0x`). When a subagent reaches 85% (`NEAR_BUDGET_RATIO = 0.85`) of its context or cost budget, Ptah injects an `additionalContext` warning into the subagent's next tool result instructing it to save progress notes immediately. If it reaches the handoff/safety ceiling (`DEFAULT_SAFETY_CAP_TOKENS = 500,000`), Ptah writes a structured `.ptah/subagent-handoffs/<sessionId>/<toolUseId>.handoff.md` file, stops the subagent cleanly, and injects the handoff file path into the parent agent's stream.
- **Why it is unique**: In standard Claude Code or Cursor, a runaway subagent silently burns through millions of output/cache-write tokens or hits the hard context limit and crashes with an unrecoverable error, losing all intermediate findings. Ptah gives subagents a 15% early-warning runway and guarantees a persisted `.handoff.md` artifact for a successor subagent.
- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:48-61` (`DEFAULT_SAFETY_CAP_TOKENS = 500_000`, `NEAR_BUDGET_RATIO = 0.85`), `L171-177` (`COST_WEIGHTS` with 5m/1h cache TTL weights)
  - `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:1-45` (module architecture doc & `.ptah/subagent-handoffs/` flow)
- **Docs status**: `hidden` — Zero mentions of `SubagentBudgetMonitor`, cost-weighted token budgets, or `.ptah/subagent-handoffs/` in `README.md`, landing page, or docs.
- **Recency**: Enhanced in the last 5 weeks (`6d80e33c4` & `9726ecab5` compaction/subagent coordination).
- **Marketing angle**: *"Never lose a subagent's work to a context crash again: Ptah tracks cost-weighted tokens, warns subagents at 85% budget, and auto-saves a `.handoff.md` baton before stopping."* (Target: Heavy Claude Code subagent users).
- **Maturity**: `shipped`

### 11. Prompt-Cache-Aware Idle Compaction & Dynamic Session Budget Stage Machine (`agent-sdk`)
- **What it does**: `IdleCompactionService` runs a pure RxJS per-session state machine that monitors turn idle time after an assistant response and automatically triggers `/compact` *before* the Anthropic prompt cache TTL expires—paying 0.1x warm cache-read rates to summarize the conversation instead of 1.0x cold rates when the user returns later (and even fires while a background subagent is still running: `9726ecab5`). Alongside it, `SessionBudgetService` tracks session context growth through three escalating stages: `tighten` (dynamically lowers the SDK's `autoCompactWindow` ceiling via `applySessionAutoCompactWindow`), `handoff` (prompts `/session-handoff`), and `limit` (triggers automatic session handoff when `sessionBudgetAutoHandoff` is enabled).
- **Why it is unique**: Other tools only compact *after* you send a new message and overflow the context window—which means if you stepped away for 10 minutes, the prompt cache expired and compaction costs 10x more AND blocks your next prompt for 30+ seconds. Ptah compacts proactively during idle time while the cache is still warm.
- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:64-250` (`IdleCompactionService`)
  - `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:145-250` (`SessionBudgetService`, `applySessionAutoCompactWindow`, `triggerAutoHandoff`)
- **Docs status**: `under-emphasized` — `apps/ptah-docs/src/content/docs/memory/settings.md` mentions compaction settings, but cache-warm idle compaction during subagent runs and the 3-stage `SessionBudgetService` are absent from `README.md` and the landing page.
- **Recency**: Enhanced in the last 10 days (`6d80e33c4` allow idle compaction while background subagent is running, `9726ecab5` trigger idle compaction on main turn idle during subagent run).
- **Marketing angle**: *"Proactive warm-cache compaction: Ptah compacts your session while you grab coffee—before the 5-minute prompt cache expires—saving 90% on compaction tokens and eliminating next-turn lag."* (Target: All daily Claude users).
- **Maturity**: `shipped`

### 12. Cross-Workspace Peer Session Directory & OS Start-Time Liveness Probe (`agent-sdk`)
- **What it does**: `PeerSessionDirectory` and `PeerSessionMessenger` discover all live Claude CLI and Ptah sessions across every workspace and git worktree on the machine (`crossWorkspacePolicy: 'include-all-workspaces'`), joining `~/.claude/sessions/<pid>.json` with Ptah's own session store so sessions appear with human-readable titles. To defeat OS PID-reuse false positives without signalling foreign processes, `ProcessStartTimeProbe` verifies that the live OS process creation timestamp (`wmic`/`Get-Process` on Windows, `ps -o lstart=` on POSIX) matches the session's `startedAt` within OS clock-resolution tolerances (`WINDOWS_TOLERANCE_MS = 5000`, `POSIX_TOLERANCE_MS = 2000`).
- **Why it is unique**: IDE extensions are normally blind to terminal CLI sessions or other IDE windows running on different repositories/worktrees. Ptah discovers every active coding session across your entire workstation, verifies liveness via OS process start-time fingerprinting, and lets sessions message each other directly.
- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts:78-115` (`WINDOWS_TOLERANCE_MS`, `POSIX_TOLERANCE_MS`, `isStartTimeConsistent`), `L142-250` (`PeerSessionDirectory`)
  - `libs/backend/agent-sdk/src/lib/peer-sessions/index.ts:1-52` (`PeerSessionMessenger`, `ClaudeSessionRegistryReader`, `ProcessStartTimeProbe`)
- **Docs status**: `hidden` — Zero mentions of `PeerSessionDirectory` or cross-workspace peer session messaging in `README.md`, landing page, or docs.
- **Recency**: Shipped in the current architecture cycle (`peer-sessions` module in `libs/backend/agent-sdk`).
- **Marketing angle**: *"Cross-repo telepathy: Ptah discovers live sessions across all your open repositories and git worktrees so your frontend and backend agents can coordinate directly."* (Target: Microservices and multi-repo engineers).
- **Maturity**: `shipped`

### 13. Claude Built-In Tool & Account-Synced Skill Hygiene Catalog (`agent-sdk`)
- **What it does**: Claude Code's upstream CLI injects terminal-only built-in tools (`Workflow`, `ReportFindings`, `PushNotification`, `DesignSync`, `EnterWorktree`, `ExitWorktree`, `Monitor`) and built-in skills (`keybindings-help`, `update-config`, `loop`, `schedule`) plus every skill synced from the user's `claude.ai` web account (`anthropic-skills:<name>`), burning ~3,500+ system-prompt tokens per turn and risking uncoordinated worktree switches inside the host. `claude-builtin-catalog.ts` strips these by default via `--disallowedTools` across both main chat and CLI lanes (`computeDeniedClaudeBuiltinTools`, `computeDeniedClaudeBuiltinSkills`), while `guardClaudeBuiltinSkillDenials` checks local/user skill directories first so denying a built-in name never accidentally blocks a user's custom skill of the same name.
- **Why it is unique**: Vanilla Claude Code and thin IDE wrappers pay a ~3,500-token tax on every turn for terminal-only tools (`keybindings-help`, `PushNotification`) and cloud-synced `claude.ai` skills that pollute the context window. Ptah surgically prunes them while protecting user-defined skill names.
- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.ts:40-120` (`CLAUDE_BUILTIN_TOOL_CATALOG`, ~3,500 tokens saved comment at `L33-37`), `L159-250` (`CLAUDE_BUILTIN_SKILL_CATALOG`, `computeDeniedClaudeBuiltinSkills`)
  - `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts` (referenced at `claude-builtin-catalog.ts:24-28` for collision guarding)
- **Docs status**: `hidden` — Not mentioned in `README.md`, landing page, or docs.
- **Recency**: Shipped and expanded in the last 3 weeks (`ad4a69013` block claude.ai account-synced skills by default, `423d840a2` expand Claude built-in catalog with `Monitor` & `loop`, `4608842fe` collision guard for same-name custom skills).
- **Marketing angle**: *"Reclaim 3,500 tokens of context on every turn: Ptah strips bloated terminal-only tools and cloud-synced web skills from the system prompt automatically."* (Target: Token-efficiency and context-engineering enthusiasts).
- **Maturity**: `shipped`

### 14. Per-Configuration Provider Translation Proxy Pool with Zero-Drop Key Rotation (`auth-providers`)
- **What it does**: To run the Claude Code harness against non-Anthropic backends (GitHub Copilot, Kimi Code, OpenRouter, Sakana AI, LM Studio, OpenCode, or custom OpenAI-compatible endpoints), `ProviderProxyPool` spins up isolated local HTTP translation proxies (`AnthropicToOpenAiProxy`) keyed by a composite `${providerId}::${sha256(apiKey|baseUrl)}` key. Multiple workspaces can run different providers or credentials simultaneously without colliding. When a user rotates an API key or edits a base URL mid-session, `ensureRunning` moves the old proxy instance into a `retiredFor` holding pool instead of killing its socket, allowing in-flight streaming turns to finish cleanly.
- **Why it is unique**: External proxy scripts (like `claude-code-router` or LiteLLM) run on a single static port, breaking multi-window workflows and dropping active streams whenever credentials refresh. Ptah embeds a multi-tenant, zero-drop translation proxy pool directly inside the desktop/IDE host.
- **Evidence**:
  - `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:52-77` (`poolKey` with SHA-256 credential hash), `L161-250` (`ProviderProxyPool`, `retiredFor` zero-drop rotation at `L203-220`)
- **Docs status**: `hidden` — Providers are documented (`apps/ptah-docs/src/content/docs/providers/`), but the multi-tenant `ProviderProxyPool` and zero-drop `retiredFor` credential rotation architecture are completely hidden.
- **Recency**: Active core infrastructure in `libs/backend/auth-providers`.
- **Marketing angle**: *"Run Claude Code's agentic harness on Copilot, Kimi, OpenRouter, or local LM Studio models across multiple windows at once—with zero-drop key rotation."* (Target: Developers bringing their own keys or local models).
- **Maturity**: `shipped`

### 15. Multi-Target Declarative Harness Sync with Git-Proved Retirement & Digest-Checked Quarantine Repair (`harness-sync`)
- **What it does**: `HarnessReconcilerService` reconciles skills, custom agents, slash commands, and MCP servers from Ptah's canonical store (`~/.ptah/user/`) into 7 vendor harness directories (`claude`, `codex` including `.codex/config.toml` via `CodexTomlMcpFacet`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`), automatically transforming agent frontmatter per vendor (`CodexAgentTransformer`, `CopilotAgentTransformer`, `CursorAgentTransformer`, `OpencodeAgentTransformer`). When a skill is retired, `evaluateSkillDirectoryRetirement` (`retirement-proof.ts`) refuses to delete any target copy unless **both** its SHA-256 content hash matches the last manifest AND `git --literal-pathspecs ls-files --error-unmatch` proves the file is untracked by git (`kept-retired` otherwise). If a target path is blocked by an unmanaged file or broken symlink, `HarnessBlockedRepairService` verifies a cryptographic `expectedDigest` and moves the occupant to `.quarantine/<timestamp>-<uuid>/` rather than deleting it.
- **Why it is unique**: Other tools either lock your skills/MCP configs inside a proprietary database or blindly overwrite `~/.cursor` / `~/.claude` files on sync—risking data loss on hand-edited or git-tracked skills. Ptah is the only cross-vendor harness manager with git-proved retirement safety and non-destructive `.quarantine/` repair.
- **Evidence**:
  - `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:113-250` (`HarnessReconcilerService`)
  - `libs/backend/harness-sync/src/lib/targets/retirement-proof.ts:75-210` (`evaluateSkillDirectoryRetirement`, `isGitTracked` via `git --literal-pathspecs ls-files --error-unmatch`)
  - `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:121-250` (`HarnessBlockedRepairService`, `.quarantine/` move + `digest-mismatch` guard)
- **Docs status**: `hidden` — Zero mentions of `harness-sync`, `keptRetired` git-tracking proof, or `.quarantine/` digest-checked repair in `README.md`, landing page, or docs.
- **Recency**: Built in the last 3 weeks (`1f9bf8beb` & `d770661a6` retirement proof & `keptRetired`, `4809d01fe` & `a621f0323` `repairBlocked` quarantine service).
- **Marketing angle**: *"Author a skill, agent, or MCP config once and sync it to Claude, Codex, Cursor, Copilot, and OpenCode—with git-proved safety that never overwrites your hand-edited files."* (Target: Polyglot AI developers).
- **Maturity**: `shipped`

### 16. User-Layer Clone Mirror with 3-Way Divergence Tracking, Rebase/Keep, & Orphan Reaper (`agent-generation`)
- **What it does**: When plugins or built-in catalogs install skills, commands, or workspace-scoped agents into `~/.ptah/user/`, `UserLayerMirrorService` writes a `.ptah-origin.json` provenance sidecar recording `originHash` (upstream content hash at clone time) and `lastSeenUpstreamHash`. It continuously computes a 3-way divergence state (`clean`, `modified`, `upstream-updated`, `diverged`) so users can locally customize any plugin skill and later choose to `rebase` (which snapshots their local edits into `.history/<timestamp>.md` before applying upstream) or `keep` their fork. When a plugin is uninstalled, `UserLayerOrphanReaper` reaps only unmodified clones (`currentHash === originHash`), preserving any skill the user tweaked. Additionally, `AgentFileWriterService` enforces optimistic concurrency (`baselineHash` → `changed-since-preview`) when saving agent definitions.
- **Why it is unique**: In Claude Code plugins or Cursor rules, updating an upstream plugin either clobbers your local prompt tweaks or forces you to copy-paste and lose upstream updates forever. Ptah brings git-style 3-way divergence tracking, `.history/` rebase snapshots, and modification-aware orphan reaping to AI skills and agents.
- **Evidence**:
  - `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:98-250` (`UserLayerMirrorService`, `rebase`, `keep`, `UserLayerOrphanReaper`)
  - `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:101-250` (`AgentFileWriterService`, `changed-since-preview` baseline hash check at `L138-152`)
- **Docs status**: `hidden` — Completely undocumented in `README.md`, landing page, and docs.
- **Recency**: Shipped in the last 5 weeks (`a9b54d12d` user-layer clone mirror & orphan reaper).
- **Marketing angle**: *"Fork any marketplace skill without fear: Ptah tracks 3-way divergence between upstream plugins and your local prompt tweaks, complete with one-click rebase and history snapshots."* (Target: Teams customizing shared prompt/skill libraries).
- **Maturity**: `shipped`

### 17. Session Archaeologist, Spec Harvester, & Judge-Gated Skill Enhancer (`skill-synthesis`)
- **What it does**: `skill-synthesis` closes the loop between coding sessions and reusable skills through three services:
  1. **Session Archaeologist** (`session-verdict.types.ts`): Runs a multi-pass LLM analysis over completed sessions to infer true user `intent` (explicitly forbidden from echoing the first message), classify completion `evidenceClass` (`tests-green`, `user-accepted`, `explicit-confirmation`, `no-correction`, `unverified`), build a turn-indexed `frictionMap` (`correction`, `retry`, `dead-end`, `workaround`, `scope-drift`), and draft reusable `routine` steps with turn citations.
  2. **Spec Harvester & Scorecard** (`SpecHarvesterService`, `SkillScorecardService`): Parses completed `.ptah/specs/TASK_*` batch verdicts, review findings, and session token/cost usage into `SkillTaskGradeStore`, computing per-skill and per-agent win rates (`firstPassRate`, `avgTokens`, `avgCostUsd`, `topIssues`).
  3. **Judge-Gated Skill Enhancer** (`SkillEnhancerService`): Generates targeted unified diffs (`EnhancementProposal`) for existing `SKILL.md` files informed by real spec review failures, scores the before/after versions with `SkillJudgeService`, and issues a one-time redeemable proposal token (`PROPOSAL_TTL_MS = 15 min`).
- **Why it is unique**: Competitors treat past chat transcripts as dead history. Ptah mines completed sessions and task specs for friction points (`retry`, `dead-end`) and review failures, grades every skill's real-world win rate and token cost, and proposes judge-verified `SKILL.md` upgrades.
- **Evidence**:
  - `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.types.ts:44-250` (`SessionVerdict`, `FrictionEvent`, `SynthesizedRoutine`)
  - `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:87-250` (`SpecHarvesterService`)
  - `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:41-250` (`SkillScorecardService`)
  - `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:140-250` (`SkillEnhancerService`, `PROPOSAL_TTL_MS = 15 * 60 * 1000`)
- **Docs status**: `hidden` — Zero mentions of `Session Archaeologist`, `SpecHarvester`, `SkillScorecard`, or `SkillEnhancer` in `README.md`, landing page, or docs.
- **Recency**: Heavily built in the last 3–5 weeks (`81752ea54` per-agent metrics in scorecard, `bec208f1c` token/cost metrics in scorecard, `6ad21290a` enrich skill enhancer with spec review findings).
- **Marketing angle**: *"Your AI skills level up from your own sessions: Ptah's Session Archaeologist maps every retry and dead-end in your transcripts and drafts judge-scored upgrades to your `SKILL.md` library."* (Target: AI-native teams building internal engineering playbooks).
- **Maturity**: `shipped`

### 18. Cross-Worktree/Remote Task ID Allocator & Reversible Journaled Task Doctor (`task-specs`)
- **What it does**: `GitTaskFolderVisibility` (`git-task-folder-visibility.service.ts`) prevents `TASK_YYYY_NNN` sequence collisions when multiple engineers or worktree agents create specs concurrently by scanning all local git worktrees (`git worktree list --porcelain`) **and** querying `origin/main` (`git fetch --quiet origin main` + `git ls-tree -z origin/main .ptah/specs/`). Meanwhile, `TaskDoctorService` (`task-doctor.service.ts`) audits the entire `.ptah/specs/` hierarchy for structural corruption (`dangling_parent`, `parent_cycle`, `parent_depth_exceeded`, `status_contradicted_by_artifacts`, `corrupt_json`, `orphan_spec_folder`) and writes a reversible `.doctor-journal.json` undo log containing base64 snapshots of every touched file before applying any repair (`undoLastApply`).
- **Why it is unique**: Spec-driven tools (like Kiro or basic markdown task folders) suffer constant task-number collisions across branches and break when parent/child spec JSONs drift out of sync. Ptah allocates collision-free IDs across all local worktrees and `origin/main`, and repairs spec graphs with transactional undo journals.
- **Evidence**:
  - `libs/backend/task-specs/src/lib/git-task-folder-visibility.service.ts:158-250` (`listSiblingWorktreeTaskNames`, `listRemoteMainTaskNames`)
  - `libs/backend/task-specs/src/lib/task-doctor.service.ts:122-250` (`TaskDoctorService`, `.doctor-journal.json`, `undoLastApply`)
- **Docs status**: `hidden` — Tasks are mentioned in `apps/ptah-docs/src/content/docs/tasks/index.md`, but `TaskDoctorService`, `.doctor-journal.json` undo logs, and cross-worktree/`origin/main` ID collision prevention have zero mentions.
- **Recency**: Shipped in the current spec engine cycle (`libs/backend/task-specs`).
- **Marketing angle**: *"Spec-driven development built for parallel branches: collision-free task IDs across every git worktree and `origin/main`, backed by a transactional Task Doctor with one-click undo."* (Target: Teams using spec-driven development across feature branches).
- **Maturity**: `shipped`

### 19. Orchestration Skill: Cross-Side Gate Approvals, 3-Step Decision Ladder, Fleet Mode, & Parity Inventory (`.claude/skills/orchestration`)
- **What it does**: Ptah's flagship `/orchestrate` skill enforces an industrial phase-gated workflow (`Explore → Plan → Gate 1 → Red Tests → Gate 1.7 → Implement → Gate 2 → Verify → Close`) with four standout mechanisms:
  1. **Cross-Side `lane-review` Gate Mode** (`checkpoints.md:71-118`): Instead of interrupting the human at every gate, an independent reviewer from the *opposite execution side* (CLI lane reviewing in-process work, or vice versa) inspects the plan/red-tests/diff and auto-approves the gate when findings are zero.
  2. **3-Step Decision Ladder** (`SKILL.md:63-91`): Before asking the user any question, the orchestrator must check codebase/spec evidence (Step 1), consult a cross-side peer agent (Step 2), and interrupt the user *only* for 5 reserved categories (logged in `decisions.md`).
  3. **Fleet Mode** (`fleet.md:1-54`): `/orchestrate TASK_A TASK_B` runs multiple tasks in parallel waves (`max 3 lanes`), followed by an independent cross-task judge (`judge-round-N.json`, up to 3 repair rounds).
  4. **Mandatory Parity Inventory** (`SKILL.md:117-126`): Any task that replaces an existing UI or module must produce `parity-inventory.md` enumerating every existing capability (`ported | intentional-drop | N/A`) before Gate 1 or Gate 2 can pass.
- **Why it is unique**: Competitor "plan modes" (Cursor Plan, Claude Code Plan, Cline Plan/Act) stop at a single chat approval and constantly nag the user with trivial implementation questions or silently drop features during rewrites. Ptah uses cross-side AI gatekeepers, a strict 3-step Decision Ladder, mandatory parity inventories, and multi-task Fleet waves.
- **Evidence**:
  - `.claude/skills/orchestration/SKILL.md:63-126` (Decision Ladder, Parity Rule, Phase Sequence)
  - `.claude/skills/orchestration/references/checkpoints.md:32-155` (`gateMode: "lane-review"`, opposite execution-side rule)
  - `.claude/skills/orchestration/references/fleet.md:1-54` (Fleet Mode waves + `judge-round-N.json`)
- **Docs status**: `under-emphasized` — `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md` covers high-level orchestration, but `lane-review` opposite-side gate approval, the 3-step Decision Ladder, `parity-inventory.md`, and Fleet Mode (`judge-round-N.json`) are missing from `README.md` and the landing page.
- **Recency**: Continuously refined in the last 5 weeks alongside `lane-routing` and `lane-outcomes`.
- **Marketing angle**: *"Autonomous orchestration that doesn't nag you every 3 minutes: cross-vendor gate reviewers approve intermediate checkpoints and enforce zero-regression parity inventories."* (Target: Senior engineers delegating full features or multi-task backlogs).
- **Maturity**: `shipped`

### 20. Tribunal Multi-Vendor Peer Panel & Crucible Asymmetric Mentor Loop (`.claude/skills/tribunal`)
- **What it does**: `/tribunal` convenes multiple installed CLI vendors in the main chat session across 5 structured multi-agent moves:
  - **Council**: Anonymized parallel positions + cross-critique + synthesis for architecture decisions.
  - **Forge**: Competing vendors implement the same task in isolated git worktrees, review each other's diffs round-robin, and get merged into the best solution.
  - **Race**: N attempts scored against a frozen weighted rubric before revealing vendor identities.
  - **Crucible**: Pairs a **fast/cheap executor lane** (doing all file edits in a worktree) with a **strong different-family judge lane** in a bounded 2–5 iteration loop (`crucible.md`), where the judge emits structured JSON verdicts (`PASS` / `ITERATE` / `ESCALATE`) and file:line mentor notes without ever editing code itself.
  - **Relay**: Sequential multi-vendor handoff across phases (e.g., Codex specs → Claude implements → Gemini/Antigravity audits).
- **Why it is unique**: Cursor and Claude Code can run parallel subagents of the *same* model or compare completions in a split diff, but have no structured adversarial cross-critique, round-robin cross-vendor diff review, or asymmetric cheap-executor + frontier-judge Crucible loop.
- **Evidence**:
  - `.claude/skills/tribunal/SKILL.md:1-87` (5 moves: Council, Forge, Race, Crucible, Relay; main-chat execution rule)
  - `.claude/skills/tribunal/references/crucible.md:1-185` (Crucible asymmetric executor/judge loop, different-family constraint, JSON verdict schema)
- **Docs status**: `documented` in `apps/ptah-docs/src/content/docs/tribunal/` and listed in `README.md`, but **Crucible's cost-arbitrage angle** (cheap executor + frontier judge across model families) and main-chat orchestration (`3421fbb39`) are under-emphasized on the landing page.
- **Recency**: Updated in the last 3 weeks (`3421fbb39` run Tribunal in main chat instead of delegating to a subagent).
- **Marketing angle**: *"Frontier code quality at a fraction of the token cost: Crucible pairs a fast, cheap coding model with a frontier cross-vendor Judge that coaches it to a passing diff in a worktree."* (Target: All developers looking for frontier quality without frontier token burn).
- **Maturity**: `shipped`

### 21. Durable Micro-USD Live Session Usage Ledger (`agent-sdk/session-stats`)
- **What it does**: `SessionUsageSinkService` (`session-usage-sink.ts`) provides a single durable accounting boundary across all three execution runtimes (`sdk-owner` Claude turns, `codex-checkpoint` App Server turns, and `cli-lane` background runs). Every usage delta carries an idempotent `eventKey` and monotonic `revision`, is priced in integer **micro-USD** (`1 USD = 1,000,000 micro-USD`, avoiding IEEE-754 floating-point drift), and is tagged with an explicit `costAuthority` (`provider-reported` when the SDK reports exact cost, `model-priced` when computed from the catalog, or `unpriced`).
- **Why it is unique**: Most coding tools estimate cost with lossy floating-point math on the frontend or drop token counts when sessions crash or run in background CLI lanes. Ptah persists every turn and background lane delta idempotently in integer micro-USD with explicit cost provenance.
- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/session-stats/session-usage-sink.ts:51-125` (`SessionUsageDelta`, `CostAuthority`, `MicroUsd`), `L127-201` (`SessionUsageSinkService`)
- **Docs status**: `hidden` — `apps/ptah-docs/src/content/docs/chat/cost-and-tokens.md` discusses token display generally, but the cross-runtime `SessionUsageSinkService`, integer micro-USD accounting, and `costAuthority` provenance are undocumented.
- **Recency**: Built in the last 3 weeks (`4fa334e18` wire `SessionUsageSink` into Claude SDK, Codex App Server, and CLI lanes; `62ddec9e1` durable live session usage ledger).
- **Marketing angle**: *"Sub-cent accounting across every runtime: Ptah tracks exact micro-USD spend across main chat, Codex App Server, and background CLI lanes with zero floating-point drift."* (Target: Engineering managers and cost-tracking power users).
- **Maturity**: `shipped`

### 22. Laptop-Sleep-Aware Cron Catchup Coordinator (`cron-scheduler`)
- **What it does**: `CatchupCoordinator` (`catchup-coordinator.ts`) hooks into both cold-start boot and OS power-resume events (`IPowerMonitor.onResume` when a developer opens their laptop lid). It computes the offline window (clamped to `CATCHUP_WINDOW_MAX_MS = 24 hours`), evaluates every enabled cron job's `catchupPolicy` (`none`, `last`, or `all`), and claims missed execution slots in SQLite using atomic `SlotAlreadyClaimedError` guards so rapid sleep/wake cycles never double-fire a scheduled agent run.
- **Why it is unique**: Cloud background agents require pushing unmerged code to a remote repo and paying cloud VM rates; naive local cron schedulers (`node-cron` or Claude Code's in-session `/loop`) simply miss every job while your laptop is asleep. Ptah runs local scheduled agents that automatically catch up the moment you open your laptop.
- **Evidence**:
  - `libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:27` (`CATCHUP_WINDOW_MAX_MS = 24 * 60 * 60 * 1000`), `L41-158` (`CatchupCoordinator`, `onBoot`, `onPowerResume`, `SlotAlreadyClaimedError`)
- **Docs status**: `documented` in `apps/ptah-docs/src/content/docs/automation/cron/catchup-and-power.md`, `under-emphasized` on `README.md` and `apps/ptah-landing-page`.
- **Recency**: Shipped in `libs/backend/cron-scheduler`.
- **Marketing angle**: *"Scheduled local agents that survive laptop sleep: close your lid at night, and Ptah's Catchup Coordinator runs your missed morning triage jobs the second you wake your machine."* (Target: Solo founders and engineers automating daily repo maintenance).
- **Maturity**: `shipped`

### 23. Cryptographic Consent-Token External Plugin Marketplace (`plugin-marketplace`)
- **What it does**: `MarketplaceRegistryService` and `ExternalPluginInstallerService` let users install community skills, agents, commands, and MCP servers directly from curated or custom GitHub repositories (`github-subtree`). Installation is strictly two-phase: `planInstall` downloads the subtree into a staging directory, inspects every file and MCP declaration, and mints a SHA-256 `consentToken` (`mintConsentToken`, `CONSENT_TTL_MS = 10 min`) binding the exact plugin ID, resolved commit/version, and every file's relative path and byte hash. `confirmInstall` verifies the token before moving a single file into the user's harness.
- **Why it is unique**: Competitors either have no plugin marketplace or run unverified `npx`/git scripts directly on install. Ptah stages GitHub subtrees and enforces a cryptographic 10-minute consent token over the exact file manifest and MCP server declarations before installation.
- **Evidence**:
  - `libs/backend/plugin-marketplace/src/lib/registry/marketplace-registry.service.ts:60-250` (`MarketplaceRegistryService`)
  - `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts:140-207` (`planInstall`), `L280-361` (`confirmInstall`), `L632-648` (`mintConsentToken`)
- **Docs status**: `under-emphasized` — Marketplace UI is documented in `apps/ptah-docs/src/content/docs/plugins/marketplace.md`, but the two-phase SHA-256 `consentToken` verification architecture is hidden.
- **Recency**: Enhanced in the last 4 weeks (`da18f9abb` harden marketplace search and custom source validation).
- **Marketing angle**: *"Install community skills and MCP servers from GitHub with cryptographic peace of mind: every plugin install is staged, hashed, and bound to a verified consent token before touching your workspace."* (Target: Security-conscious developers and enterprise teams).
- **Maturity**: `shipped`

### 24. Fail-Closed Workspace Capability Resolver & Dual-Path Output Style Activator (`cli-agent-runtime`, `output-styles`)
- **What it does**: Before any session or CLI lane boots, `CapabilityResolverService` merges MCP server declarations, lock-free global/workspace skill toggles (`~/.ptah/config/skill-toggles.json`), one-time imported `.claude/settings.local.json` approvals, and exponential-backoff circuit breakers (`McpServerBackoffService`). If any policy file is corrupt or unreadable, it **fails closed** to `trustState: 'unverified'`, stripping all skills and non-built-in MCP servers. Simultaneously, `OutputStyleActivationResolver` activates built-in (`default`, `Explanatory`, `Learning`, `Proactive`) or custom markdown output styles (`~/.ptah/user/output-styles/`, `.ptah/output-styles/`) by dynamically switching between `--settings` flag activation and `--append-system-prompt` body injection depending on whether `'user'` is in `settingSources`—preventing double prompt injection while isolating styles per Claude account (`8e3522203`).
- **Why it is unique**: In other tools, a broken MCP server blocks session startup repeatedly, corrupt settings silently fall open, and custom output personas either get double-injected or leak across accounts. Ptah circuit-breaks failing MCP servers, fails closed on policy corruption, and routes output styles without token duplication.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts:154-250` (`CapabilityResolverService`, fail-closed `unverified` fallback at `L185-205`)
  - `libs/backend/output-styles/src/lib/output-style-activation.resolver.ts:44-83` (`resolveOutputStyleActivation`)
  - `libs/backend/output-styles/src/lib/built-in-output-styles.ts:35-89` (`BUILT_IN_OUTPUT_STYLES`, including Ptah-exclusive `Proactive` style)
- **Docs status**: `hidden` — Zero mentions of `output-styles` (`Explanatory`, `Learning`, `Proactive`), dual-path activation, or fail-closed `CapabilityResolverService` in `README.md`, landing page, or docs.
- **Recency**: Enhanced in the last 2 weeks (`8e3522203` per-account output style directory scoping).
- **Marketing angle**: *"Zero-trust capability resolution and per-account personas: Ptah circuit-breaks flaky MCP servers, fails closed on corrupt configs, and ships built-in Explanatory, Learning, and Proactive coding styles."* (Target: Developers customizing agent behavior per project/account).
- **Maturity**: `shipped`

---

## Table

| # | Feature | Docs status | Maturity | Wow score (1–5) |
|---|---|---|---|---|
| 1 | System-1 Decision Model & Bayesian Prior-Blended Capability Matrix (`lane-routing`) | `hidden` | `shipped` | 5 |
| 2 | Empirical Lane Outcome Ledger, Disk Deliverable Verifier & Self-Review Guard (`lane-outcomes`) | `hidden` | `shipped` | 5 |
| 3 | Native Codex App-Server Runtime & Dual-Runtime Chat Router with Carry-Over (`codex-runtime`, `agent-sdk`) | `hidden` | `shipped` | 5 |
| 4 | Multi-Vendor CLI Agent Lanes & Agent Client Protocol (ACP) Engine (`cli-agent-runtime`) | `under-emphasized` | `shipped` | 5 |
| 5 | Cache-Economics Lane Resume Gate & Repeat-Call Loop Breaker (`cli-agent-runtime`) | `hidden` | `shipped` | 5 |
| 6 | Certified Multi-Account Claude Isolation & Post-Init Subscription Tripwire (`auth-providers`, `agent-sdk`) | `hidden` | `shipped` | 5 |
| 7 | Cross-Vendor Live Plan-Limit Ledger & Quota Owner Discovery (`auth-providers`, `cli-agent-runtime`) | `under-emphasized` | `shipped` | 4 |
| 8 | Worktree-Isolated Interactive Child Chat Sessions (`ptah_session_*`, `cli-agent-runtime`) | `documented` (docs only; hidden on README/landing) | `shipped` | 5 |
| 9 | Zero-Downtime Session Handoff with Live Background Work Adoption (`cli-agent-runtime`) | `under-emphasized` | `shipped` | 5 |
| 10 | Cost-Weighted Subagent Budget Monitor & Automatic `.handoff.md` Continuity (`agent-sdk`) | `hidden` | `shipped` | 4 |
| 11 | Prompt-Cache-Aware Idle Compaction & Dynamic Session Budget Stage Machine (`agent-sdk`) | `under-emphasized` | `shipped` | 5 |
| 12 | Cross-Workspace Peer Session Directory & OS Start-Time Liveness Probe (`agent-sdk`) | `hidden` | `shipped` | 4 |
| 13 | Claude Built-In Tool & Account-Synced Skill Hygiene Catalog (~3.5k token savings) (`agent-sdk`) | `hidden` | `shipped` | 4 |
| 14 | Per-Configuration Provider Translation Proxy Pool with Zero-Drop Key Rotation (`auth-providers`) | `hidden` | `shipped` | 4 |
| 15 | Multi-Target Declarative Harness Sync with Git-Proved Retirement & Quarantine Repair (`harness-sync`) | `hidden` | `shipped` | 5 |
| 16 | User-Layer Clone Mirror with 3-Way Divergence Tracking, Rebase/Keep, & Orphan Reaper (`agent-generation`) | `hidden` | `shipped` | 4 |
| 17 | Session Archaeologist, Spec Harvester, & Judge-Gated Skill Enhancer (`skill-synthesis`) | `hidden` | `shipped` | 5 |
| 18 | Cross-Worktree/Remote Task ID Allocator & Reversible Journaled Task Doctor (`task-specs`) | `hidden` | `shipped` | 4 |
| 19 | Orchestration Skill: Cross-Side Gate Approvals, Decision Ladder, Fleet Mode & Parity Inventory (`.claude/skills/orchestration`) | `under-emphasized` | `shipped` | 5 |
| 20 | Tribunal Multi-Vendor Peer Panel & Crucible Asymmetric Mentor Loop (`.claude/skills/tribunal`) | `documented` (Crucible cost-arbitrage under-emphasized) | `shipped` | 5 |
| 21 | Durable Micro-USD Live Session Usage Ledger (`agent-sdk/session-stats`) | `hidden` | `shipped` | 3 |
| 22 | Laptop-Sleep-Aware Cron Catchup Coordinator (`cron-scheduler`) | `documented` (docs only; under-emphasized on landing) | `shipped` | 4 |
| 23 | Cryptographic Consent-Token External Plugin Marketplace (`plugin-marketplace`) | `under-emphasized` | `shipped` | 3 |
| 24 | Fail-Closed Workspace Capability Resolver & Dual-Path Output Style Activator (`cli-agent-runtime`, `output-styles`) | `hidden` | `shipped` | 3 |

---

## Decisions

1. **Grouped `libs/backend/auth-providers-tokens` with `auth-providers` (Feature #6) and `cli-engine` / `platform-cli` / `thoth-runtime` as host composition plumbing**: `auth-providers-tokens` is a pure DI-token leaf library avoiding circular imports, while `thoth-runtime`, `cli-engine`, and `platform-cli` wire the 24 user-facing orchestration features above into the Electron/VS Code/CLI hosts (`bootThothRuntime` in `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:118-250`). Focusing the 24 feature entries on user-visible runtime and orchestration mechanics yields stronger marketing hooks for PtahCode v2.
2. **Updated stale `README.md` claim regarding `@openai/codex-sdk`**: `README.md` still advertises `@openai/codex-sdk`, whereas commit `bac9eb3c6` retired `@openai/codex-sdk` in favor of the far more capable native JSON-RPC `codex app-server` runtime (`libs/backend/codex-runtime`). Feature #3 highlights this upgrade directly so marketing materials and `README.md` can be updated before launch.
3. **Strict Evidence Verification**: Every `Docs status` classification was verified against `README.md`, `apps/ptah-landing-page/src`, `libs/web`, and `apps/ptah-docs/src/content/docs` via pattern search; 15 of the 24 features have zero mentions across all documentation surfaces (`hidden`), 6 are `under-emphasized`, and 3 are `documented` in deep docs pages but absent from `README.md` and the landing page.

## Open questions

1. **System-1 Decision Model Branding (`lane-routing`)**: Should the `/v1/systemone` fast routing model (`system-one.client.ts:11-16`, `decision-model.catalog.ts:45-64` referencing `TypeSafe/Jev` on Ollama/cloud) be marketed under the name **"System-1 Router"** on the PtahCode v2 landing page, or under a product-branded name (e.g., *"Thoth Instant Router"*)?
2. **Headline Metric for Prompt-Cache Economics (Features #5, #10, #11, #13)**: Across `LaneResumeGate` (0.1x vs 1.0x cache-TTL gate), `IdleCompactionService` (warm-cache idle compaction), `SubagentBudgetMonitor` (cost-weighted subagent budgets), and `claude-builtin-catalog.ts` (~3,500 tokens saved per turn), Ptah has a cohesive **"Prompt-Cache-Native Engine"** story. Should these four features be bundled into a dedicated "Token & Cache Economics" pillar on the PtahCode v2 launch page?
3. **Self-Improving Skills Loop (Features #2 & #17)**: `Session Archaeologist` + `SpecHarvester` + `SkillEnhancer` + `LaneOutcomeRecorder` form a complete closed-loop learning system where Ptah grades its own runs and patches its own `SKILL.md` files. Is the UI surface for reviewing `EnhancementProposal` diffs (`PROPOSAL_TTL_MS = 15 min`) scheduled to be featured in the PtahCode v2 launch video?
