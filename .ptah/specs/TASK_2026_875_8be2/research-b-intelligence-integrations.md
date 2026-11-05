## Summary

- Agent code search reports index coverage and starts background freshness checks.
- Named memory corpora can prime reusable agent sessions.
- Tool output reduction preserves a path to oversized full results.
- Discord commands bind threads to sessions and workspaces.
- Electron watches nested Git repositories and agent worktrees.

## Feature inventory

### 1. Freshness-aware symbol search
**What it does.** Agents search code symbols using natural language. Search can start a background index refresh and returns live coverage, so stale or incomplete results need not appear authoritative.
**Why it is unique.** Cursor, Codex and Claude Code navigate code too; the explicit freshness/coverage contract is the distinctive claim, not exclusive search.
**Evidence.** Verified: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts:2`, `:9`, `:13`, `:362`, `:453`.
**Docs status.** Under-emphasized: README.md:58 describes symbol search, but the checked README and site source omit coverage. **Recency.** Enhanced: `ce290b460` (one census per root). **Marketing angle.** “Code answers with a freshness receipt” for large refactors. **Maturity.** Shipped; coverage can be unknown during initial indexing.

### 2. Capability-aware multilingual parsing
**What it does.** A central registry supplies each language tool's supported-language claim. Unanalyzed extensions are counted as unsupported even if their language is generally supported.
**Why it is unique.** This is a more honest “understands your repo” claim than an undifferentiated language list; no accuracy comparison with Copilot or Windsurf was run.
**Evidence.** Verified: `libs/backend/workspace-intelligence/src/ast/language-registry.ts:2`, `:18`, `:179`, `:198`, `:205`.
**Docs status.** Under-emphasized: README.md:57 lists Tree-sitter languages but not capability coverage. **Recency.** No file-specific commit in the five-week window. **Marketing angle.** “Know which files were actually analyzed” for polyglot teams. **Maturity.** Shipped infrastructure.

### 3. Dependency and reverse-impact graph
**What it does.** Ptah builds a file dependency graph and answers both what a file imports and what depends on it. The graph has a coverage readout.
**Why it is unique.** The reusable graph with coverage is specific; other agents can reason about imports, so exclusivity is unverified.
**Evidence.** Verified: `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:471`, `:992`, `:1025`, `:1316`.
**Docs status.** Under-emphasized: README.md:90 lists dependency graphs, and apps/ptah-docs/src/content/docs/workspace/project-analysis.md:57 mentions one; reverse impact is not prominent. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Trace the blast radius before an edit” for maintainers. **Maturity.** Shipped, subject to import-resolution coverage.

### 4. Declaration-only context summaries
**What it does.** Eligible files yield declarations and signatures with bodies removed. Ineligible files return full content with a reason rather than a misleading partial summary.
**Why it is unique.** Cursor and Claude Code also optimize context; the explicit structural mode and fallback reason are concrete differentiators.
**Evidence.** Verified: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:6`, `:40`, `:126`, `:185`.
**Docs status.** Hidden: no “structural summary” match in checked docs/site; README.md:57 describes parsing only. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Read a module’s shape without every body” for large files. **Maturity.** Shipped, limited to eligible declaration-only files.

### 5. Hybrid memory retrieval
**What it does.** Search fuses BM25 and vector ranks, weights short queries differently, and falls back to BM25 if vector search fails.
**Why it is unique.** Useful local retrieval, but no exclusive advantage over Cursor or Claude Code memory is established.
**Evidence.** Verified: `libs/backend/memory-curator/src/lib/memory-search.service.ts:2`, `:350`, `:367`, `:369`, `:358`.
**Docs status.** Documented: README.md:56 and apps/ptah-docs/src/content/docs/memory/searching.md:14-27 cover the mechanism. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Recall exact names and related ideas locally” for long projects. **Maturity.** Shipped; semantic recall degrades if sqlite-vec is unavailable.

### 6. Compaction-triggered memory curation
**What it does.** Pre-compaction events can enqueue a curation pass; repeated triggers are coalesced. Created memories can trigger corpus rebuilding.
**Why it is unique.** This ties automatic extraction to reusable knowledge, a more specific story than generic persistent memory; competitor parity was not audited.
**Evidence.** Verified: `libs/backend/memory-curator/src/lib/memory-curator.service.ts:273`, `:348`, `:472`, `:923`.
**Docs status.** Under-emphasized: apps/ptah-docs/src/content/docs/memory/how-it-works.md:16 names pre-compact but not coalescing or corpus refresh. **Recency.** Enhanced: `539fed084` coalesced pre-compact curation. **Marketing angle.** “Memory survives a compressed chat” for long sessions. **Maturity.** Shipped background service.

### 7. Named knowledge corpora
**What it does.** Users can build a named corpus from memory, prime an agent session with it, query it, and rebuild membership. The service can reuse a live primed session.
**Why it is unique.** A specialized reusable knowledge agent is a stronger angle than memory alone; no claim that Codex or Cursor cannot do equivalent work.
**Evidence.** Verified: `libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:76`, `:92`, `:106`, `:139`, `:176`.
**Docs status.** Hidden as a workflow: apps/ptah-docs/src/content/docs/memory/how-it-works.md:54 mentions corpus rows, but not build/prime/query/rebuild. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Give a specialist agent reusable project knowledge” for recurring domains. **Maturity.** Shipped service; requires a workspace and agent session.

### 8. Retention that protects unprocessed observations
**What it does.** Memory retention purges processed records while preserving observations extraction has not handled. It tracks stuck work instead of deleting it.
**Why it is unique.** This is a trust and reliability detail; no measured comparison against Cline or Copilot exists.
**Evidence.** Verified: `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:23`, `:30`, `:193`; `libs/backend/memory-curator/src/lib/memory-curator.service.ts:472`.
**Docs status.** Under-emphasized: apps/ptah-docs/src/content/docs/memory/how-it-works.md:52 covers retention, but not this safeguard. **Recency.** Enhanced: `53a334969` preserves unprocessed observations; `905ef3201` pauses background jobs. **Marketing angle.** “Cleanup waits until learning is done” for memory users. **Maturity.** Shipped.

### 9. Content-aware tool output budgets
**What it does.** Oversized output is detected by content kind and reduced for logs, HTML, JSON, Markdown, or code. The budget engine can spool the full text and return a locator.
**Why it is unique.** Recoverable full output plus format-aware reduction is a concrete comparison point against Claude Code and Codex truncation behavior; parity needs external validation.
**Evidence.** Verified: `libs/backend/tool-output-reducers/src/lib/reduce-output.ts:102`, `:123`, `:235`; `libs/backend/tool-output-reducers/src/lib/output-budget/apply-output-budget.ts:6`, `:17`.
**Docs status.** Hidden: no “reducer” or “spool” match in checked README, landing, or docs. **Recency.** Enhanced: `7099066f3` moved the budget engine; `0a622909d` improved spool reporting. **Marketing angle.** “Smaller context, full evidence retrievable” for noisy tools. **Maturity.** Shipped; spool failure is reported.

### 10. Composable execute_code API
**What it does.** Agent JavaScript composes `ptah.*` calls through a marshaled bridge in a fresh VM context with timeout and cancellation.
**Why it is unique.** Other agents run scripts; one composable Ptah tool API is the specific distinction. Node VM should not be marketed as a security-grade isolation guarantee.
**Evidence.** Verified: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.ts:5`, `:23`, `:30`, `:295`.
**Docs status.** Under-emphasized: apps/ptah-docs/src/content/docs/mcp-and-skills/ptah-tools.md:169 has a single row. **Recency.** Enhanced: `3fe7a030e` propagated cancellation. **Marketing angle.** “One script coordinates the local toolset” for power users. **Maturity.** Shipped, within VM and method-access limits.

### 11. Paired remote chat attached to desktop sessions
**What it does.** Gateway senders require pairing before agent work, and a binding can attach to a Ptah session and workspace. Allowlisted access constrains where messages may run.
**Why it is unique.** The continuity between a desktop coding session and remote chat is the angle versus editor-centered competitors.
**Evidence.** Verified: `libs/backend/messaging-gateway/src/lib/gateway.service.ts:13`, `:256`, `:307`, `:486`.
**Docs status.** Documented: README.md:77 and apps/ptah-docs/src/content/docs/automation/messaging/index.md:20. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Reach your desktop agent from chat” for mobile developers. **Maturity.** Shipped when configured and paired.

### 12. Discord thread control commands
**What it does.** Five Discord commands list or switch sessions/workspaces or start fresh. Mutating commands stop during an active turn, and selected targets are validated against closed candidate sets.
**Why it is unique.** This is a guarded remote control plane, beyond a simple notification bot; no categorical competitor-absence claim is made.
**Evidence.** Verified: `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.ts:2`, `:9`, `:18`, `:102`.
**Docs status.** Under-emphasized on landing/README.md:77, although apps/ptah-docs/src/content/docs/automation/messaging/index.md:28 documents commands. **Recency.** No file-specific commit in five weeks. **Marketing angle.** “Switch workspaces from Discord” for remote-first users. **Maturity.** Shipped for Discord; command parity with Telegram/Slack is not claimed.

### 13. Local Whisper and Kokoro voice
**What it does.** A worker runs Whisper speech recognition and Kokoro speech synthesis. The registry exposes local speech in both directions.
**Why it is unique.** Local model choice may appeal to privacy-conscious users, but an end-to-end no-network guarantee was not verified.
**Evidence.** Verified: `libs/backend/voice-providers/src/lib/worker/whisper-pipeline.ts:7`, `:21`; `libs/backend/voice-providers/src/lib/worker/kokoro-pipeline.ts:6`, `:20`; `libs/backend/voice-providers/src/lib/voice-provider-registry.ts:32`.
**Docs status.** Under-emphasized: voice-messages.md covers Whisper; “Kokoro” has no match in checked docs/site. **Recency.** No worker-file commit in five weeks. **Marketing angle.** “Talk to your coding agent with local models” for voice users. **Maturity.** Shipped provider implementation, conditional on model assets.

### 14. Optional ElevenLabs voice
**What it does.** The registry can select hosted ElevenLabs STT/TTS as an alternative to local providers. STT checks secret configuration before transcribing.
**Why it is unique.** Choice across both speech directions is useful; superiority to competitors’ voice tools is unverified.
**Evidence.** Verified: `libs/backend/voice-providers/src/lib/voice-provider-registry.ts:24`, `:34`, `:46`; `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-stt-provider.ts:55`, `:60`.
**Docs status.** Hidden: no “ElevenLabs” match in checked README, landing, or docs source. **Recency.** Enhanced: `defdf3dc8` and `ac76046f1` fixed key handling. **Marketing angle.** “Choose local or hosted speech” for voice users. **Maturity.** Shipped optional integration, conditional on key.

### 15. Electron CDP browser instrument
**What it does.** Electron provides CDP navigation, screenshot, evaluation, interaction, network capture and GIF recording. It checks that the current page remains within allowed destinations.
**Why it is unique.** Cursor and Cline automate browsers too; the Electron-integrated session and capture set is the meaningful comparison.
**Evidence.** Verified: `apps/ptah-electron/src/services/electron-browser-capabilities.ts:122`, `:191`, `:374`, `:758`, `:825`.
**Docs status.** Documented: apps/ptah-docs/src/content/docs/browser-automation/index.md:29 and recording.mdx; README.md:90 only lists browser automation. **Recency.** Enhanced: `952cdbbe3` fixed cleanup failures. **Marketing angle.** “Inspect and record the page the agent changes” for frontend developers. **Maturity.** Shipped, with URL/root restrictions.

### 16. Nested Git and agent-worktree watcher
**What it does.** Electron watches workspace and Git events, refreshes nested repository roots, prunes vanished agent worktrees and pushes fresh state to the renderer.
**Why it is unique.** Git status is common; nested repository and agent-worktree awareness is the stronger desktop angle.
**Evidence.** Verified: `apps/ptah-electron/src/services/git-watcher.service.ts:418`, `:883`, `:979`, `:1253`.
**Docs status.** Under-emphasized: apps/ptah-docs/src/content/docs/git/git-status.md:8 documents native watching, but not nested-root/worktree cleanup. **Recency.** Enhanced: `e983d5b5f` scoped the Git dock to active sessions. **Marketing angle.** “Git follows the agent’s actual worktree” for parallel teams. **Maturity.** Shipped Electron service.

### 17. Automatic task/session/worktree linkage
**What it does.** Session organization observes prompts and tool activity to connect sessions to task IDs and worktrees. TodoWrite activity becomes progress state.
**Why it is unique.** This bridges agent work and project organization; competitor parity was not audited.
**Evidence.** Verified: `libs/backend/session-organization/src/lib/session-auto-link.service.ts:225`, `:269`, `:446`; `libs/backend/session-organization/src/lib/session-todo-progress.service.ts:103`, `:119`.
**Docs status.** Hidden: no “auto-link” or “session organization” match in checked README/site/docs source. **Recency.** Enhanced: `bce1f3acc`, `20a685364`. **Marketing angle.** “Every session finds its task and worktree” for multi-agent teams. **Maturity.** Shipped, dependent on recognizable task IDs/events.

### 18. Cross-session usage and cost ledger
**What it does.** Analytics aggregates token and cost contributions by provider, model, day and session, using persisted stats where present. Pricing can be derived from model contributions.
**Why it is unique.** Competitors expose usage in different forms; the workspace-wide local ledger is the product-specific value, not guaranteed pricing completeness.
**Evidence.** Verified: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:32`, `:37`, `:49`, `:125`; `libs/backend/usage-analytics/src/lib/usage-pricing.service.ts:10`.
**Docs status.** Documented: README.md:96 and apps/ptah-docs/src/content/docs/sessions/analytics.md:8-25. **Recency.** Enhanced: `62ddec9e1` finalized session stats. **Marketing angle.** “Know what each coding session costs” for model-mixing teams. **Maturity.** Shipped, with unpriced contributions possible.

## Table

| Feature | Docs status | Maturity | Wow score |
| --- | --- | --- | --- |
| Freshness-aware symbol search | Under-emphasized | Shipped | 4 |
| Capability-aware parsing | Under-emphasized | Shipped | 3 |
| Dependency graph | Under-emphasized | Shipped | 4 |
| Declaration summaries | Hidden | Shipped, limited inputs | 4 |
| Hybrid memory retrieval | Documented | Shipped | 3 |
| Compaction curation | Under-emphasized | Shipped | 4 |
| Named knowledge corpora | Hidden | Shipped | 5 |
| Safe memory retention | Under-emphasized | Shipped | 3 |
| Output budgets | Hidden | Shipped | 4 |
| Composable execute_code | Under-emphasized | Shipped | 4 |
| Paired remote chat | Documented | Shipped | 3 |
| Discord controls | Under-emphasized | Discord only | 4 |
| Local voice | Under-emphasized | Model-dependent | 4 |
| ElevenLabs voice | Hidden | Key-dependent | 3 |
| Electron browser | Documented | Shipped | 3 |
| Nested Git watcher | Under-emphasized | Shipped | 4 |
| Task/session/worktree linkage | Hidden | Shipped | 5 |
| Usage ledger | Documented | Shipped | 3 |

## Decisions

- **Decision:** Treat “unique” as a distinctive integrated workflow, not a market-exclusivity claim. **Options:** claim competitor absence or qualify comparisons. **Evidence:** code verifies Ptah, not competitors. **Reversible:** yes.
- **Decision:** Classify as documented when any checked docs page explains the core capability, even if the README and landing page omit it. **Options:** any-source versus all-surface coverage. **Evidence:** memory search and browser recording have detailed docs. **Reversible:** yes.
- **Decision:** Use file-specific five-week git history for recency; no hit means no path-specific commit found, not that a feature is old. **Options:** infer from adjacent commits or leave unconfirmed. **Evidence:** scoped log returned uneven file coverage. **Reversible:** yes.

## Open questions

- Which source-visible capabilities are present in the current packaged PtahCode v2 release? This research did not run the packaged app.
- Which launch story leads after product validation: knowledge corpora, task/session/worktree linkage, or freshness-aware code search?
- Should local voice be called offline only after an end-to-end no-network setup check?
