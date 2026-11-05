# Hidden features analysis — PtahCode v2 desktop launch

Internal brief for the product owner. Use it to refresh the GitHub README, rebuild the landing page, and plan the Electron launch campaign.

**Audience:** the person deciding what v2 is allowed to say in public.  
**Outcome:** one inventory of what the three research lanes actually found, with stale README lines called out and unverified claims held back.  
**Sources (only):**

- A — `research-a-orchestration.md` (24 orchestration and runtime features)
- B — `research-b-intelligence-integrations.md` (18 intelligence, memory, MCP, integration, and Electron features)
- C — `research-c-frontend-ux.md` (27 frontend surfaces, plus the README / landing / docs gap)
- Current `README.md` (read in full on this pass)

**How to read maturity.** Every “Shipped” below is the source lane’s label for code in this repository. No lane ran the packaged PtahCode v2 installer (B, open question). Electron is the launch host. Where a surface is Electron-only, or voice, a key, a binding, or a provider window is required, that condition stays on the row.

**How IDs work.** `F01`–`F51` are stable. Overlaps called out in the brief (voice, messaging hand-off, the usage ledger, sessions and tasks, memory) are one row each. The map is under Decisions.

---

## Executive summary

- The desktop people will download is a command center the README does not describe: a **Voice** stage, an **Apps** stage where the agent publishes a form or chart, a **session rail** (20 tiles, 9 allowed to run), an attention bell, and a detachable display for sandboxed HTML. The marketed drag-and-resize Orchestra Canvas is stale (C).
- Main chat can sit on **Claude’s agent runtime or OpenAI’s native Codex app-server**, and a switch carries the last 16 messages across with secret-shaped strings redacted (A §3). Background work can run on eight named local CLIs, with four mid-turn delivery modes on ACP-capable agents (A §4).
- A **task router** classifies the turn and blends a 3-second `/v1/systemone` call with a local 90-day pass/fail record. Same-vendor self-reviews are excluded. Declared deliverables are checked on disk: the file exists, is non-empty, and was modified at or after the run started (A §1–2). Do not publish this as proven exclusivity.
- **Cache and quota math is in the product**, not only in a settings page. Cold lane resumes are blocked past 150,000 context tokens or 10 minutes idle. Idle time can compact a session while a background subagent is still running. Subagents are warned at 85% of a cost-weighted budget and can be stopped with a `.handoff.md` before a 500,000-token safety cap (A §5, §10, §11).
- People with more than one Claude account get an **8-step preflight** and a post-init check that the live subscription matches the account that was supposed to run, before billing continues (A §6). Live 5-hour and 7-day windows for Claude, Codex, Kimi, Antigravity, OpenCode, and Grok can mark a lane `AT LIMIT` and refuse the spawn (A §7). The session UI can show those windows when the provider reports them (C).
- **Memory and skills are a curator, not a slogan.** Search fuses BM25 and vectors and falls back to BM25 if vector search fails (B §5). Named corpora can be built and primed into a session (B §7). A skills screen previews a judged diff and writes only on Apply (C). Skills do not appear by themselves.
- **A live desktop session can move to Telegram, Discord, or Slack.** Pairing is required. Discord has five thread commands and they are not claimed for the other two apps. Hand-off makes the desktop tab read-only until the user takes it back, and only when a binding exists (B §11–12, C).
- The honest “while you sleep” line is local: scheduled runs catch up on boot and on laptop wake, inside a 24-hour window, with policies `none`, `last`, or `all`, and a claim so sleep/wake does not double-fire (A §22).
- **Trust mechanics are real and mostly unadvertised:** git-proved skill retirement, quarantine instead of delete, a 10-minute hashed consent token before a GitHub plugin install, and a fail-closed capability load when policy files are unreadable (A §15, §23, §24). Node `vm` for `execute_code` is not a security-grade sandbox (B §10).
- Treat the launch as **in-repo and Electron-first**. Tribunal still has docs and a README mention; the webview page was removed and the chat skill was not executed (C). “No account, no license key” matches the landing hero and was not checked against the auth flow. Competitor “only Ptah” lines in lane A are not a market audit.

---

## Positioning pillars

Six themes. Each claim is what this repository’s reports support. Competitor lines stay inside what the lanes wrote, and categorical absence is listed again under Claims to verify.

### 1. Multi-vendor orchestration

**Claim:** Ptah can run Claude’s agent runtime and the Codex app-server in one desktop session, and it can put other installed CLIs to work in the background with a local record of how those runs turned out.

**Proved by:** F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F19.

**Honest contrast:** Lane A describes Cursor, Windsurf, Copilot, and Cline as products where the person picks the model, and Claude Code and Codex as products that stay inside their own vendor. Lane A also says those subagents share one working tree. Lane B’s rule, adopted for this document, is that a distinctive workflow is not a proof that a competitor lacks an equivalent. Say “Ptah is built to mix installed CLIs and to check deliverables on disk.” Do not say “the only platform” until someone audits the others.

### 2. Cost and cache economics

**Claim:** Resumes, idle time, subagent length, and plan windows are gated with explicit token, cache-weight, and quota rules, and spend is stored across main chat, Codex app-server turns, and CLI lanes.

**Proved by:** F12, F13, F14, F15, F16, F17, F18.

**Honest contrast:** Lane A says other agent frameworks either resume blindly after a cache expiry or enforce a blunt tool-call ceiling. That dollar example in A ($1–$3) is illustrative, not a measured bill, and it is not used here. The publishable figures are the ones in code as reported: 0.1× cache-read weight, 150,000-token / 10-minute resume gate, 85% warning, 500,000-token safety cap, integer micro-USD. The “about 3,500 tokens” figure is a comment in the Claude built-in catalog (A §13), not a benchmark.

### 3. Desktop command center

**Claim:** The Electron title bar is a set of workplaces — chat rail, Voice, Apps, tasks, analytics, setup — and the chat transcript can hold live cards, artifacts, questions, and per-turn file lists.

**Proved by:** F20, F22, F23, F24, F25, F26, F27, F28, F29, F30, F31, F32, F33.

**Honest contrast:** Lane C says Cursor, Copilot, and Claude Code can dictate or read a reply, and that they keep questions and permissions in the focused thread. Lane C says Cursor can preview files you already have, and that Claude Code and Codex return markdown. Ptah’s Apps page and artifact window are a different surface in this repo. They are Electron-only. Apps uses a closed component catalog, not arbitrary HTML.

### 4. Memory and self-improvement

**Claim:** The desktop app stores project memory locally, can build a named corpus for a specialist session, and can propose a skill edit that the user accepts from a diff.

**Proved by:** F34, F35, F36, F37, F38.

**Honest contrast:** Lane B did not establish an exclusive advantage over Cursor or Claude Code memory. Lane C’s usable contrast is the screen: Claude Code’s memory is described there as a markdown file, and Cursor’s as a settings list, against Ptah’s timeline, corpus, and code-index maintenance on Electron. Skill files elsewhere are described as files you edit; Ptah’s Skills tab can refuse Enhance until a use threshold or cooldown clears, then write on Apply (C).

### 5. Remote control and voice

**Claim:** A paired phone chat can attach to a desktop session and workspace; Discord can list and switch sessions; the rail can hand the live session to a gateway and lock the desktop composer; the Voice tab can listen, speak, and barge in when speech engines are configured.

**Proved by:** F21, F39, F40.

**Honest contrast:** Lane C separates the Voice tab from documented gateway voice notes (inbound Whisper audio). Lane B will not call local speech offline: no end-to-end no-network check was run. Discord commands are Discord-only (B §12). Hand-off is Electron-only and stays disabled, with a reason, until a binding exists (C).

### 6. Code intelligence and workspace trust

**Claim:** Symbol search can report coverage and refresh in the background; impact and declaration summaries are explicit about what they did not analyze; harness writes and plugin installs prefer quarantine, git proof, and a hashed consent token over silent overwrite.

**Proved by:** F41, F42, F43, F44, F45, F46, F47, F48, F49, F50, F51.

**Honest contrast:** Lane B says Cursor, Codex, and Claude Code also navigate code, and that exclusivity of freshness, graphs, and context summaries was not established. The line to publish is the receipt: coverage, unsupported extensions, and a fallback reason when a file is not eligible for a declaration-only summary (B §1–4). Browser automation is something Cursor and Cline also do (B §15); the Electron CDP session with URL restrictions is the comparison, not a claim of sole ownership.

---

## Master feature inventory

### How to read this inventory

- **Docs status** follows lane C when it conflicts with lane A’s “zero mentions,” because C and the current README were read directly. See Decisions.
- **Wow** is the source lane’s 1–5 score. Merged rows keep the higher score and the stricter condition.
- The 25 `###` sections are every wow-5 row, plus seven wow-4 rows. The tie-break is in Decisions: correct a public falsehood, or show a hidden Electron or cost surface a launch reader can see.

### Inventory

| ID | Feature | Pillar | Docs status | Maturity | Wow | Source |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Task router (fast classifier + 90-day local scorecard) | Multi-vendor orchestration | Hidden | Shipped | 5 | A §1 |
| F02 | On-disk deliverable check and self-review block | Multi-vendor orchestration | Hidden | Shipped | 5 | A §2 |
| F03 | Native Claude runtime and Codex app-server, with redacted carry-over | Multi-vendor orchestration | Hidden | Shipped | 5 | A §3 |
| F04 | Parallel CLI lanes and mid-turn steering | Multi-vendor orchestration | Under-emphasized | Shipped | 5 | A §4 |
| F05 | Child chats in their own git worktrees | Multi-vendor orchestration | Documented in docs; hidden on README and landing | Shipped; max 3 children per parent | 5 | A §8 |
| F06 | New session that adopts live background work | Multi-vendor orchestration | Under-emphasized; the continuation tile is hidden in the UX write-up | Shipped; closing the old tab is conditional | 5 | A §9; C “Automatic session hand-off” |
| F07 | Phase-gated orchestration, fleet, and parity inventory | Multi-vendor orchestration | Under-emphasized | Shipped | 5 | A §19 |
| F08 | Tribunal: Council, Forge, Race, Crucible, Relay | Multi-vendor orchestration | Documented; Crucible’s cost split is under-emphasized; webview page removed | Skill run not verified this research | 5 | A §20; C docs-gap |
| F09 | Peer sessions across repos and worktrees | Multi-vendor orchestration | Hidden | Shipped | 4 | A §12 |
| F10 | Verdict card on a lane’s claimed files | Multi-vendor orchestration | Hidden | Shipped as a card; it does not decide the verdict | 3 | C “Lane result cards” |
| F11 | Background-agent strip and steer box | Multi-vendor orchestration | Under-emphasized | Shipped UI; whether every runtime accepts steer was not re-proved | 3 | C “Background-agent strip” |
| F12 | Cache-aware resume gate and repeated-call stop | Cost and cache economics | Hidden | Shipped | 5 | A §5 |
| F13 | Idle compaction and three session-budget stages | Cost and cache economics | Under-emphasized | Shipped | 5 | A §11 |
| F14 | Subagent budget warning and `.handoff.md` | Cost and cache economics | Hidden | Shipped | 4 | A §10 |
| F15 | Strip unused Claude built-in tools and account skills | Cost and cache economics | Hidden | Shipped | 4 | A §13 |
| F16 | Live plan windows and an at-limit spawn gate | Cost and cache economics | Under-emphasized; the in-session window tile is hidden in chat docs | Shipped when the provider reports a window | 4 | A §7; C “Provider plan limits” |
| F17 | Usage and cost ledger, including the analytics tab | Cost and cache economics | Documented at the analytics level; micro-USD and cost authority are hidden | Shipped; some contributions can be unpriced | 3 | A §21; B §18; C “Analytics tab” |
| F18 | Per-credential translation proxies with zero-drop rotation | Cost and cache economics | Hidden (providers themselves are documented) | Shipped | 4 | A §14 |
| F19 | Multi-account Claude isolation and billing tripwire | Multi-vendor orchestration | Hidden | Shipped | 5 | A §6 |
| F20 | Session rail (20 tiles, 9 running) | Desktop command center | Documented, and the copy is wrong | Shipped; a stored legacy grid renders as the rail | 4 | C “Session rail” |
| F21 | Voice stage, plus Whisper, Kokoro, and optional ElevenLabs | Remote control and voice | Voice tab hidden; Whisper under-emphasized; Kokoro and ElevenLabs hidden | Shipped on Electron; voice stays off until both STT and TTS exist; local models need assets; ElevenLabs needs a key; offline not verified | 5 | C “Voice stage”; B §13; B §14 |
| F22 | Apps: the agent publishes a UI beside a private chat | Desktop command center | Hidden | Shipped on Electron; closed catalog, not arbitrary HTML | 5 | C “Apps page” |
| F23 | Sandboxed HTML artifacts and a detachable window | Desktop command center | Hidden | Shipped in the Electron renderer | 4 | C “Sandboxed artifacts” |
| F24 | `ptah-ui` cards inside the transcript | Desktop command center | Hidden | Shipped; closed catalog; malformed atoms fail closed | 4 | C “ptah-ui blocks” |
| F25 | Attention bell across sessions and workspaces | Desktop command center | Hidden | Shipped | 4 | C “Attention bell” |
| F26 | Per-turn file change card and summary chip | Desktop command center | Hidden | Shipped; a turn that changes nothing has no change-set card | 4 | C “Turn change-sets” |
| F27 | Git review dock and nested worktree watcher | Desktop command center | Under-emphasized | Shipped Electron dock and watcher | 4 | C “Git review dock”; B §16 |
| F28 | Stepped question cards | Desktop command center | Hidden as UI | Shipped | 3 | C “Question cards” |
| F29 | Setup hub and first-run onboarding | Desktop command center | Documented | Shipped | 3 | C “Onboarding and setup hub” |
| F30 | Motion scenes (pyramid and temple glass) | Desktop command center | Under-emphasized | Shipped; do not call pyramid the printed default until the theme store is checked | 2 | C “Motion scenes” |
| F31 | Report an assistant reply by email | Desktop command center | Hidden | Shipped; nothing is sent until the mail client sends; excerpt capped at 1000 characters | 1 | C “Report an AI response” |
| F32 | Composer collapses to Stop while streaming | Desktop command center | Hidden | Shipped per commit messages; the fold component was not re-read | 1 | C “Composer folds” |
| F33 | Thoth hub (Memory, Skills, Schedules, Messaging) | Desktop command center | Documented | Shipped; Memory and Skills bodies are Electron-only | 2 | C “Thoth hub” |
| F34 | Hybrid memory, curator screens, and index states | Memory and self-improvement | Search documented; curator and the six index states under-emphasized | Shipped; curator is Electron-only; semantic recall degrades if sqlite-vec is unavailable | 3 | B §5; C “Memory curator”; C “Workspace indexing panel” |
| F35 | Named knowledge corpora | Memory and self-improvement | Hidden as a build / prime / query / rebuild workflow | Shipped; needs a workspace and an agent session | 5 | B §7 |
| F36 | Memory curation on compaction, and retention that keeps unprocessed notes | Memory and self-improvement | Under-emphasized | Shipped | 4 | B §6; B §8 |
| F37 | Skill synthesis with a judged diff and Apply | Memory and self-improvement | README and docs name it; archaeologist, scorecard, and enhancer internals are easy to miss | Shipped; enhancement is manual and can be paused; Electron for the tab | 5 | A §17; C “Skills library actions” |
| F38 | Clone mirror: rebase, keep, and orphan reap | Memory and self-improvement | Hidden | Shipped | 4 | A §16 |
| F39 | Pair, command, or hand a desktop session to chat apps | Remote control and voice | Pairing documented; Discord commands under-emphasized on README; the read-only hand-off is hidden | Shipped when configured and paired; five commands are Discord-only; hand-off is Electron and needs a binding | 5 | B §11; B §12; C “Hand a live session” |
| F40 | Scheduled local runs that catch up after sleep | Remote control and voice | Documented in docs; under-emphasized on README and landing | Shipped | 4 | A §22 |
| F41 | Symbol search with a freshness and coverage receipt | Code intelligence and workspace trust | Under-emphasized | Shipped; coverage can be unknown while the first index runs | 4 | B §1 |
| F42 | Language tools that count what they did not analyze | Code intelligence and workspace trust | Under-emphasized | Shipped | 3 | B §2 |
| F43 | Dependency graph, both directions, with coverage | Code intelligence and workspace trust | Under-emphasized | Shipped, subject to import-resolution coverage | 4 | B §3 |
| F44 | Declaration-only summaries, with a reason when refused | Code intelligence and workspace trust | Hidden | Shipped, only for eligible files | 4 | B §4 |
| F45 | Format-aware output shrinking, full text still retrievable | Code intelligence and workspace trust | Hidden | Shipped; a spool failure is reported | 4 | B §9 |
| F46 | One JavaScript script calling the local `ptah.*` tools | Code intelligence and workspace trust | Under-emphasized | Shipped inside VM and method-access limits; not a security boundary | 4 | B §10 |
| F47 | Electron browser: navigate, capture, record, stay on allowed URLs | Code intelligence and workspace trust | Documented; README only lists the idea | Shipped, with URL and root restrictions | 3 | B §15 |
| F48 | Plugin install: hashed consent, project-or-global scope, harness health | Code intelligence and workspace trust | Under-emphasized | Shipped | 3 | A §23; C “Marketplace install scope” |
| F49 | Harness sync with git-proved retirement and quarantine repair | Code intelligence and workspace trust | README names harness sync; the git proof and quarantine path are hidden | Shipped | 5 | A §15; C harness health |
| F50 | Fail-closed capability load and per-account output styles | Code intelligence and workspace trust | Hidden | Shipped | 3 | A §24 |
| F51 | Task board tied to sessions, plus collision-free IDs and Task Doctor | Code intelligence and workspace trust | Board documented; auto-link under-emphasized; Task Doctor and cross-worktree IDs hidden | Shipped; folders without `task.md` are not cards | 5 | B §17; C “Tasks board”; A §18 |

### Top 25

#### F01 — Task router

**What it does.** For a turn, Ptah classifies the task type and the scope (single step, multi-step, or full feature), then chooses in-process work or an external CLI lane. The classifier is a fast `/v1/systemone` call with a 3-second default timeout, blended with a local 90-day record of pass and fail in this workspace. The blend in the report is `round(100 * (s + k * prior / 100) / (n + k))` with prior strength 5. Cross-family review is a hard constraint. Lanes named in the router: `claude`, `codex`, `copilot`, `cursor`, `antigravity`, `opencode`.

**Why it matters.** The person does not have to guess which installed vendor should take the next kind of work. The score moves from outcomes in this repo, and a review lane can be forced onto a different vendor family.

**Evidence.** `libs/backend/lane-routing/src/lib/route-decide.service.ts:62-215`; `libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:30-45` and blend at `L67-83`; `libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts:11-16`, `L112-165`; `libs/backend/lane-routing/src/lib/ranking/hard-constraints.ts:53-56`, `L122-140`.

**Marketing hook.** “Ptah keeps a 90-day scorecard of which coding agent actually finishes work in your repo, and hands the next task to that record.”

**Say in public.** Shipped in the repo. Hidden in README, landing, and docs. Do not brand it “System-1” on the page until the owner picks a name (A’s open question). Do not say competitors have zero historical routing.

#### F02 — On-disk deliverable check and self-review block

**What it does.** Lane and subagent starts, completions, failures, stops, and timeouts are recorded to `~/.ptah/metrics/lane-outcomes.jsonl` and SQLite. When a verdict is reported, every declared deliverable is checked on disk: it exists, its size is greater than 0, and its mtime is at or after the run’s start. If the reviewer vendor is the same as the author vendor, that review does not count as a pass. Late reviews can join a closed run. Signals include pass rate, first-try verify rate, and mean duration.

**Why it matters.** A lane can claim it wrote a file. This path checks the filesystem before the scorecard believes it, and it keeps a model from grading its own family.

**Evidence.** `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:148-245`; `libs/backend/lane-outcomes/src/lib/write/report-effect.ts:51-56`, `L74-90`; `libs/backend/lane-outcomes/src/lib/agent-signals.ts:7-61`.

**Marketing hook.** “A pass counts when the file is on disk, non-empty, and newer than the run — and when someone else reviewed it.”

**Say in public.** Shipped. Hidden. The check is filesystem metadata, not a cryptographic signature. Lane A’s “cryptographically/filesystem-verifies” wording overshoots the evidence it cites. Use the filesystem wording.

#### F03 — Native Claude runtime and Codex app-server

**What it does.** Main chat can run on the Claude Agent SDK or on a Codex runtime that speaks the Codex app-server JSON-RPC protocol (`thread/start`, `thread/resume`, `turn/start`, `turn/steer`, and related methods including rate-limit reads). Switching runtimes projects the last 16 messages and redacts patterns for `sk-ant-*`, `sk-*`, `ghp_*`, `xox*`, and Bearer tokens. Lane A notes `@openai/codex-sdk` was retired in favor of this runtime (`bac9eb3c6`).

**Why it matters.** The desktop can use the two official agent protocols and keep the thread when the user changes runtime, without pasting secrets through in the carry-over.

**Evidence.** `libs/backend/codex-runtime/src/lib/codex-runtime.ts:88-178`, `L181-250`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:148-250`; `routing-agent-adapter.ts:38-137`; `codex-carry-over-projector.ts:15-52`.

**Marketing hook.** “Claude’s runtime and Codex’s app server in one desktop app. Switch mid-thread. Secrets in the carry-over are redacted.”

**Say in public.** Shipped. Hidden. The current README does not name `@openai/codex-sdk` (checked this pass). It also does not name the app-server. See README corrections.

#### F04 — Parallel CLI lanes and mid-turn steering

**What it does.** A process manager supervises background CLIs: `claude`, `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `grok`, and `pi`, plus `ptah-cli` API providers `kimi`, `glm`, `minimax`, `qwen`, `deepseek`, `openrouter`, and `ollama`. ACP sessions keep a JSON-RPC stdio connection. Mid-turn delivery has four modes: steer into the active turn, queue the next turn, interrupt and resume, or unsupported. A completion envelope goes back to the parent when the lane finishes, including a diff stat.

**Why it matters.** Installed rival CLIs become background workers the parent session can steer, instead of separate terminals the user polls.

**Evidence.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:62-245`; `acp-session-handle.ts:172-250`; `lane-completion-envelope.ts:57-100`; `.claude/skills/agent-lanes/SKILL.md:232-242`.

**Marketing hook.** “Spawn Claude, Codex, Copilot, Cursor, and the other CLIs you already installed. Steer a lane while it is still on the turn.”

**Say in public.** Shipped. README and docs mention lanes and do not explain ACP, the four modes, or the completion envelope. “Unsupported” is a real mode; do not imply every CLI accepts a steer. F11’s strip is the picture; this is the engine.

#### F05 — Child chats in their own git worktrees

**What it does.** From a parent session, Ptah can start up to three full child chat sessions. Each child gets its own git worktree and a `ptah-child/<id>` branch, opens as a real tab, inherits parent autopilot permissions, and can hold a completion envelope if the parent is briefly offline.

**Why it matters.** Parallel work does not have to share one git index. The user can open the child and intervene. This is separate from the rail’s “9 running” cap (F20) and from headless lanes (F04).

**Evidence.** `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:35`, `L155-250`; `session-children/index.ts:1-81`. Docs: `apps/ptah-docs/src/content/docs/agents/agent-sessions.md`.

**Marketing hook.** “A subagent with its own tab and its own worktree, so two builds don’t fight over the same checkout.”

**Say in public.** Shipped. Documented in the agents docs. Absent from README and landing. The cap is 3 children per parent, not 9.

#### F06 — New session that adopts live background work

**What it does.** When context fills, handoff writes a `HANDOFF.md` capped at 32 KiB, opens a new top-level chat seeded with the continuation, and re-parents in-flight CLI lanes and child sessions onto the new session id. Completions that land during the switch flush to the new session. On the canvas, an automatic handoff can close the source tab only after adoption succeeds. A 2026-11-03 fix does this for every open tab, not one. The close is behind `sessionBudget.closeSourceAfterAutoHandoff`.

**Why it matters.** Long work does not have to wait for every background lane to finish before the conversation gets a fresh window.

**Evidence.** `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:98-250`; `.claude/skills/session-handoff/SKILL.md:1-75`; `agent-session-adoption.service.ts:303-316`; commit `b660a7525`.

**Marketing hook.** “A fresh context window that keeps the agents already running.”

**Say in public.** Shipped. Do not say the old tab always closes. Do not say it is one click until a screenshot confirms the control (C).

#### F07 — Phase-gated orchestration

**What it does.** The `/orchestrate` skill runs a fixed phase sequence with gates. An opposite-side reviewer can approve a gate when findings are zero. A three-step ladder checks the repo, then a peer, and only then asks the user, for a reserved set of decisions. Fleet mode runs multiple tasks in waves of at most three lanes, then a cross-task judge for up to three repair rounds. A replacement task must list every existing capability as ported, intentionally dropped, or N/A before the gate passes.

**Why it matters.** This is the “staffed team” workflow with rules the README’s one paragraph does not contain: who may approve a gate, when the user is interrupted, and a parity list before a rewrite.

**Evidence.** `.claude/skills/orchestration/SKILL.md:63-126`; `.claude/skills/orchestration/references/checkpoints.md:32-155`; `.claude/skills/orchestration/references/fleet.md:1-54`.

**Marketing hook.** “Gates can be reviewed by the other side of the team. You are asked only for the decisions the ladder reserves.”

**Say in public.** Shipped as a skill. High-level orchestration is in the docs. Lane-review, the ladder, parity inventories, and fleet judges are missing from README and landing.

#### F08 — Tribunal

**What it does.** The skill, as documented, runs five moves in the main chat: Council (anonymized positions, critique, synthesis), Forge (competing implementations in worktrees, then a merge), Race (scored against a frozen rubric before names are revealed), Crucible (a cheaper executor edits in a worktree; a different-family judge returns PASS, ITERATE, or ESCALATE for 2–5 iterations and does not edit), and Relay (a sequential handoff across vendors).

**Why it matters.** It is the clearest “use a cheap model to write and a stronger, different family to judge” story in the repo.

**Evidence.** `.claude/skills/tribunal/SKILL.md:1-87`; `.claude/skills/tribunal/references/crucible.md:1-185`. README lines 68–72. Docs under `apps/ptah-docs/src/content/docs/tribunal/`. Page removal: `dea55817c` (2026-10-29).

**Marketing hook.** “Put a fast model on the edits and a different vendor on the verdict.”

**Say in public.** Do not feature Tribunal in the launch until someone runs the chat skill. The webview page is gone. README and docs still describe the skill. Lane C did not execute it. Crucible’s cheap-executor / frontier-judge split is the part the landing page underplays, if the skill still runs.

#### F12 — Cache-aware resume gate and repeated-call stop

**What it does.** Before a completed lane is resumed, the gate reads accumulated context (including Codex rollout token counts) and idle time. Above 150,000 tokens or 10 minutes idle, it refuses the resume and tells the caller to start a fresh lane with a short brief. The reason in the report: a warm cache read is priced at 0.1× input, and an expired cache re-bills the prefix at 1.0×–1.25×. Separately, identical non-edit tool calls are hashed and the lane stops at a repeated call count (default warn at 10, stop at 20) instead of a hard cap on how many tool calls a long edit may make.

**Why it matters.** The product encodes cache price and loop detection as runtime policy.

**Evidence.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46-50`, `L89-160`, `L165-210`; `lane-budget-guard.ts:28-33`, `L58-135`.

**Marketing hook.** “After ten quiet minutes, Ptah would rather start a short new brief than replay a cold cache.”

**Say in public.** Shipped. Hidden. Publish the 0.1× weight and the two thresholds. Do not publish a dollar savings or “10× your bill” as a measured result.

#### F13 — Idle compaction and session-budget stages

**What it does.** After an assistant turn goes idle, a per-session state machine can run compaction before the prompt-cache TTL expires, including while a background subagent is still running. A second service moves the session through tighten (lower the auto-compact window), handoff (prompt `/session-handoff`), and limit (automatic handoff when that setting is on).

**Why it matters.** Compaction can happen during the pause, while the cache is still warm, instead of only when the next message overflows.

**Evidence.** `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:64-250`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:145-250`. Recent commits cited by A: `6d80e33c4`, `9726ecab5`.

**Marketing hook.** “The session can compact while you are away, before the warm cache expires.”

**Say in public.** Shipped. Docs mention compaction settings. The idle-during-subagent behavior and the three stages are absent from README and landing. Do not claim a measured “90%” savings; that gloss in A is the 0.1× versus 1.0× price weight, not a study.

#### F16 — Live plan windows

**What it does.** A ledger tracks 5-hour and 7-day subscription windows, reset times, and credit-fallback status for Claude, Codex, Kimi Code, Antigravity, OpenCode, and Grok. Aliases that share one billing pool share one ledger entry. Spawn and list annotate remaining percentages and can refuse an `AT LIMIT` lane. In the session UI, a tile can show those windows, an owner, and a message. A provider with no window is not given a fake meter.

**Why it matters.** The limit that stops a long refactor is the vendor plan, not only the tokens this chat already spent (that spend is F17).

**Evidence.** `lane-limit-lookup.service.ts:62-97`, `L146-244`; `libs/backend/auth-providers/src/lib/quota/index.ts:1-58`; `agent-process-manager.service.ts:132-136`; `provider-lane-limit-tile.component.ts:10-35`.

**Marketing hook.** “See the plan window next to the session, and skip a vendor that is already at its limit.”

**Say in public.** Shipped where the provider reports a window. Provider docs mention quota briefly. The unified ledger, shared quota owner, and spawn gate are not on the README or landing. Chat cost docs cover tokens and USD, not these windows.

#### F19 — Multi-account Claude isolation

**What it does.** A named personal Claude account is certified before launch or resume: binary SHA-256 fingerprint, managed-policy scan (Windows registry, macOS MDM, Linux `/etc/claude-code`), a stripped environment allowlist, a per-account config directory, and a settings-override inspection. On the first SDK init message, the run aborts unless the API key source is none and the live subscription type is pro, max, team, or enterprise. Uncertified or cross-account resumes are blocked.

**Why it matters.** Personal and work Claude accounts can be bound to main chat or to a lane without relying on whatever `ANTHROPIC_API_KEY` happens to be in the environment.

**Evidence.** `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts:179-250`; `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:14-62`, `L69-105`, `L164-194`; `lane-resume-gate.ts:216-245`.

**Marketing hook.** “Personal Claude and work Claude, side by side, with a preflight and a subscription check before the wrong account is billed.”

**Say in public.** Shipped. Hidden. Lane A calls this unique against VS Code, Cursor, and raw Claude Code. That absence was not re-audited here. Publish the 8 steps and the tripwire as what Ptah does.

#### F20 — Session rail

**What it does.** Chat opens one rail board per workspace. A legacy grid layout is rendered as that rail. The board holds 20 sessions. Only 9 may be running at once. Density is comfortable or dense. Sort is recent or manual. Cards show compact state, attention actions, an agent dock, and the messaging hand-off (F39). Gridstack constants remain for old records.

**Why it matters.** This is the screen the README, the landing pillar, the canvas doc, the tier comparison, and first-launch still describe as a drag-and-resize grid of nine sessions. The number 9 is the running cap. The tile cap is 20.

**Evidence.** `orchestra-canvas.component.ts:45-59` (rail is the only board at lines 51–54); `canvas-layout-intent.ts:4-11`; `canvas-running-cap.ts:6-7`; `canvas-board-mode.ts:1-20`; `canvas-rail-card.component.ts:19-44`. Stale docs: `apps/ptah-docs/src/content/docs/canvas/index.md`; `reference/tier-comparison.mdx`; `getting-started/first-launch.md`; landing `pillars-spine.component.ts` lines 327–336; README line 67.

**Marketing hook.** “Twenty sessions on the rail. Nine working at once. You stay on one.”

**Say in public.** Shipped. Replace every grid and gridstack claim before launch. Film the rail.

#### F21 — Voice stage and speech engines

**What it does.** On Electron the title bar has a Voice tab that opens `/command-center`. The page is a stage: a scene of work nodes, captions, a work list, a live panel, and a display rail. Controls start, mute, stop, and interrupt. The loop captures audio, transcribes, sends a turn, speaks the reply, and can barge in. The persona asks for one or two spoken sentences and tells the model to delegate the rest. If STT or TTS is missing, the chip says “Voice unavailable.” VS Code does not get this route. Under the hood, a worker can run Whisper and Kokoro, and the registry can select ElevenLabs for either direction when a key is configured. Gateway voice notes are a different, documented feature: inbound audio on Telegram, Discord, or Slack.

**Why it matters.** It is a spoken view of delegated work, not a dictation button on the chat composer, and not the messaging voice notes the README already mentions.

**Evidence.** `electron-shell.component.ts:251-261`; `app.routes.ts:161-173`; `command-center-page.component.ts:152-168`; `command-center-persona.ts:4-5`; `command-voice-loop.ts:21-33`; `command-scene.component.ts:33-52`. Speech: `whisper-pipeline.ts:7`, `:21`; `kokoro-pipeline.ts:6`, `:20`; `voice-provider-registry.ts:24`, `:32`, `:34`, `:46`; `elevenlabs-stt-provider.ts:55`, `:60`.

**Marketing hook.** “Talk to the team. Watch the work.”

**Say in public.** Shipped on Electron, off until both a speech-to-text and a text-to-speech provider are configured. Local engines need model assets. ElevenLabs needs a key. Do not say offline or no-network. Do not conflate this tab with gateway voice messages. Kokoro and ElevenLabs have no match in the checked docs. Market the tab as Voice; Command Center is the internal name (C).

#### F22 — Apps the agent builds

**What it does.** The Electron title bar Apps tab opens `/apps`: a private transcript plus a surface panel. The page prompt tells the agent to build with `ptah_surface_update`, read selection with `ptah_surface_get_state`, and keep chat replies short. The catalog covers layout, inputs, charts, tables, lists, alerts, and a later set (accordion, avatar, stat trend, sparkline). A failed surface shows “This app could not be shown.” This conversation is not the coding chat.

**Why it matters.** The user can operate a small internal view — a form, a chart, a table — and the agent can read that state back.

**Evidence.** `electron-shell.component.ts:263-273`; `app.routes.ts:149-158`; `apps-page.component.ts:19-42`, `149-151`; `apps-system-prompt.ts:12-30`; `apps-surface-panel.component.ts:29-30`; `surface-catalog.ts:36-85`.

**Marketing hook.** “Ask for a dashboard. Use it. Don’t paste the numbers back.”

**Say in public.** Shipped on Electron. Hidden. Closed catalog, not arbitrary HTML.

#### F23 — Sandboxed artifacts and a detachable window

**What it does.** A reply can publish an artifact. The transcript shows a card with title, time, open, and fullscreen. The live iframe stays in the display panel. That panel can detach into its own window. Actions and links return to the main renderer. Links use an allowlist rather than `window.open`.

**Why it matters.** The agent can hand over a local HTML view beside the work, then pop it onto a second window.

**Evidence.** `artifact-card.component.ts:16-24`; `display-window.component.ts:28-37`. Commits `a1ebe203c`, `7aefb2bed` (2026-10-20), `affc0a33f` (2026-10-30).

**Marketing hook.** “The agent didn’t paste a screenshot. It handed you the page.”

**Say in public.** Shipped in the Electron renderer. Hidden. The card itself does not embed the iframe.

#### F24 — Live cards inside the transcript

**What it does.** Assistant text can include a `ptah-ui` fence. The transcript compiles it and can bind live `$agents` and `$limits`. The same renderer family draws Apps surfaces. A later catalog adds accordion, avatar, trend, and sparkline without widening the previous catalog. Malformed atoms fail closed.

**Why it matters.** A reply can be a stats card fed by the session’s own agents and limits.

**Evidence.** `ptah-ui.ts:1-24`; `surface-renderer.component.ts:1-36`; `surface-catalog.ts:15-19`, `68-71`. Commits `24e882f14`, `31904b890`, `cf913a15f`, `b66148f4c`.

**Marketing hook.** “The reply can be a card of your agents and their limits, not only a paragraph.”

**Say in public.** Shipped. Hidden. Closed grammar and catalog.

#### F25 — Attention bell

**What it does.** A title-bar notification button splits “Needs you” from “Recent notices.” A question, permission, failure, or warning names the session, provider, and workspace. Permission rows use the shared attention actions, so the user can allow or deny without opening that session. Sound can be muted. The same bell can answer a question card (F28).

**Why it matters.** With several sessions running, the human interrupt has one inbox.

**Evidence.** `notification-center.component.ts:24-70`, `113-115`. Commits `c6b32da8e`, `ef3a7ae7d`, `67ab166ba`.

**Marketing hook.** “Nine agents. One bell. Answer the one that’s stuck.”

**Say in public.** Shipped. Hidden. The “nine” in the hook is the running cap (F20), which is fair. Settings docs mention a save toast; that is a different notice.

#### F26 — Per-turn file list and bill

**What it does.** When a turn ends, the transcript can show files added, modified, deleted, renamed, or conflicted, with line counts and a reconciled state. A chip can summarize files, tests, tokens, cost, and duration. If the grace window ends with no file changes, no change-set card is pushed.

**Why it matters.** The turn carries its own trailer: what changed, what tests did, what it cost.

**Evidence.** `change-set-card.component.ts:13-23`; `change-set.store.ts:32-40`; `turn-recap.ts:1-18`; `turn-summary-chip.component.ts:1-30`. Cost docs (`chat/cost-and-tokens.md` lines 14–20) list a footer and an execution tree, not these cards.

**Marketing hook.** “Every reply that touches files can end with the list, the tests, and the cost.”

**Say in public.** Shipped. Hidden. Do not promise a card on every message.

#### F27 — Git review dock and nested worktree watcher

**What it does.** The git dock is a review shell with four tabs: Changes, Commit, Task, and History. Changes is a review canvas or a CodeMirror spot editor. If the turn ran in another worktree, Changes is read-only and offers Back and Open as workspace. Task shows branch, PR/CI, and worktrees. History shows stashes and the branch’s commits. A conflict banner appears during merge, rebase, or cherry-pick. On the Electron host, a watcher refreshes nested repository roots, prunes vanished agent worktrees, and pushes state to the renderer.

**Why it matters.** The user can review the agent’s worktree without making it the workspace, and the watcher follows nested repos and agent worktrees rather than only the top-level checkout.

**Evidence.** `review-shell.component.ts:51-57`, `75-108`; `spot-editor.component.ts:40`; `task-worktree-view.component.ts:1-35`; `apps/ptah-electron/src/services/git-watcher.service.ts:418`, `:883`, `:979`, `:1253`. Docs exist for git status, diffs, commits, and worktrees, and do not describe this dock. README line 95 says “Monaco diff view.”

**Marketing hook.** “Review the agent’s branch without leaving yours.”

**Say in public.** Shipped Electron dock. Under-emphasized. Call the dock editor CodeMirror. Whether Monaco still exists somewhere else is unverified (C).

#### F35 — Named knowledge corpora

**What it does.** A user can build a named corpus from memory, prime an agent session with it, query it, and rebuild membership. The service can reuse a live primed session. Docs mention corpus rows and do not walk build, prime, query, and rebuild.

**Why it matters.** Recurring domain knowledge can be handed to a specialist session as a unit, which is a sharper story than “we have memory.”

**Evidence.** `libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:76`, `:92`, `:106`, `:139`, `:176`. Docs glance: `apps/ptah-docs/src/content/docs/memory/how-it-works.md:54`.

**Marketing hook.** “Build a named body of project knowledge and prime a specialist with it.”

**Say in public.** Shipped service. Hidden as a workflow. Requires a workspace and an agent session. No claim that Codex or Cursor cannot do something equivalent (B).

#### F37 — Skill synthesis with Apply

**What it does.** Three backend pieces close a loop: a session archaeologist infers intent (it is forbidden to echo the first message), classifies evidence, and maps friction such as correction, retry, dead-end, workaround, and scope drift; a spec harvester turns completed task specs into per-skill and per-agent grades (first-pass rate, average tokens, average cost, top issues); an enhancer proposes a unified diff for an existing `SKILL.md`, a judge scores before and after, and the proposal token lasts 15 minutes. On Electron the Skills tab separates skills, agents, and commands. Enhance now is disabled under a use threshold or during cooldown. The user sees a Monaco diff and a judge verdict. The file is written only on Apply. Revert needs history. Rebase is hidden when there is no upstream. Agent cards can show a chip per provider copy, a model section, Sync, and a quarantined-agents panel.

**Why it matters.** The product can propose a better skill from real sessions and spec reviews. The user still accepts the diff.

**Evidence.** `session-verdict.types.ts:44-250`; `spec-harvester.service.ts:87-250`; `skill-scorecard.service.ts:41-250`; `skill-enhancer.service.ts:140-250`; `skill-clones-view.component.ts:1-32`; `skill-synthesis-tab.component.ts:30-45`. Docs: `skill-synthesis/the-skills-tab.mdx`, `how-it-works.mdx`. README line 69.

**Marketing hook.** “It drafts the skill change from real retries. You apply the diff.”

**Say in public.** Shipped. Do not say skills appear by themselves. README already claims skill synthesis in one sentence that skips the Apply step. Archaeologist, scorecard, and the 15-minute proposal token are not what the README describes. The tab is Electron-only. The diff preview uses Monaco; that does not settle the git-dock editor (F27).

#### F39 — Pair, command, or hand a session to a chat app

**What it does.** Gateway senders must pair before agent work. A binding can attach to a Ptah session and workspace, and an allowlist constrains where messages run. Discord has five commands to list or switch sessions and workspaces or start fresh. Mutating commands stop during an active turn, and targets are checked against a closed candidate set. Separately, each rail card can hand the live session to an approved binding. The desktop tab becomes read-only until the user resolves it. The control stays visible but disabled, with a reason, when no binding exists. This is not the same as starting a cron job or typing in a gateway chat. README already mentions gateways, voice input, and approval relay; it does not mention this hand-off.

**Why it matters.** The desktop session and the phone chat are the same conversation, with an explicit lock on the desktop composer when the user hands it over.

**Evidence.** `libs/backend/messaging-gateway/src/lib/gateway.service.ts:13`, `:256`, `:307`, `:486`; `gateway-command.service.ts:2`, `:9`, `:18`, `:102`; `send-to-messaging.component.ts:37-57`; `canvas-rail-card.component.ts:22`. Docs: `apps/ptah-docs/src/content/docs/automation/messaging/index.md`.

**Marketing hook.** “Start it on the desktop. Finish the approval on your phone.”

**Say in public.** Shipped when configured and paired. Five commands: Discord only. Hand-off: Electron only, and only with a binding. Do not imply Telegram and Slack have the same command set.

#### F49 — Harness sync that will not clobber a tracked skill

**What it does.** A reconciler writes skills, custom agents, slash commands, and MCP servers from `~/.ptah/user/` into seven harnesses: `claude`, `codex` (including `.codex/config.toml`), `copilot`, `cursor`, `antigravity`, `opencode`, and `pi`, with per-vendor frontmatter transforms. Retiring a skill refuses to delete a target copy unless the SHA-256 matches the last manifest and git shows the file is untracked. Otherwise it is kept. If a path is blocked by an unmanaged file or a broken symlink, a repair service checks an expected digest and moves the occupant to `.quarantine/<timestamp>-<uuid>/`. The marketplace UI exposes harness health as a badge, blocked paths, and a repair dialog.

**Why it matters.** One authoring place can feed several CLIs, and a hand-edited or git-tracked copy is not silently removed.

**Evidence.** `harness-reconciler.service.ts:113-250`; `retirement-proof.ts:75-210`; `blocked-repair.service.ts:121-250`; `harness-health-badge.component.ts:1-24`. README line 93 already says a reconciler writes agents, skills, and MCP intents into harness folders.

**Marketing hook.** “Write the skill once. Sync it to the CLIs you use. A git-tracked copy is kept, and a blocked file is quarantined.”

**Say in public.** Shipped. The README line is directionally true and incomplete. Publish the git proof and the quarantine. Lane A’s “zero mentions” does not match README line 93.

#### F51 — Tasks tied to sessions, and a Task Doctor

**What it does.** `/tasks` is a board over `.ptah/specs/` with six statuses: backlog, in progress, in review, blocked, done, and cancelled. The UI adds bulk actions, a command palette, relations, and filters. Folders without `task.md` are excluded. Session organization watches prompts and tool activity, links a session to a task id and a worktree, and turns TodoWrite activity into progress. Separately, task ids are allocated by scanning local git worktrees and `origin/main`, so parallel worktrees do not reuse a number. A Task Doctor audits structural problems (dangling parent, cycle, depth, status contradicted by artifacts, corrupt JSON, orphan folder) and writes a reversible `.doctor-journal.json` with base64 snapshots before repair, including undo of the last apply.

**Why it matters.** The task is a folder the user can commit. The live session can point at that folder and its worktree. Parallel branches do not have to collide on ids, and a broken spec graph has an undo journal.

**Evidence.** `task-spec.types.ts:8-20`; `tasks-ui/src/index.ts:15-34`; `session-auto-link.service.ts:225`, `:269`, `:446`; `session-todo-progress.service.ts:103`, `:119`; `git-task-folder-visibility.service.ts:158-250`; `task-doctor.service.ts:122-250`. Docs: `apps/ptah-docs/src/content/docs/tasks/index.md` covers the board and not the doctor.

**Marketing hook.** “The task is a folder. The session knows which one. A Task Doctor can undo its own repair.”

**Say in public.** The six-column board is shipped and already in the README. Auto-link is shipped and under-emphasized. The doctor, the journal, and the `origin/main` scan are shipped and hidden. Do not say every markdown file becomes a card. Do not imply the doctor runs itself in the launch film unless a screen shows it.

---

## README corrections

Verified against the current `README.md` and lane C’s gap baseline. Sibling docs that repeat a README error are listed so the same pass can fix them. They are not extra README claims.

### Wrong or stale

| README claim | Where | Fix |
| --- | --- | --- |
| “Orchestra Canvas — up to nine concurrent sessions in one drag-and-resize grid. Background agents continue while you review a single tile.” | Line 67 | Replace with the session rail: one board per workspace, up to 20 session tiles, 9 allowed to run, comfortable or dense density, recent or manual sort, per-card attention and an agent dock. A stored legacy grid renders as the rail. Background work continuing is still fair (F04, F06, F11). Drop “drag-and-resize” and gridstack. |
| Same grid story on the landing pillar | `pillars-spine.component.ts` lines 327–336 (“drag-and-resize grid”, “gridstack”) | Rewrite with the rail. C says the landing does not mention the rail. |
| Canvas doc still describes a drag-resize grid, a Single/Grid switch, a lock, and both “nine” and “twenty” | `apps/ptah-docs/src/content/docs/canvas/index.md` lines 1–37 | Rewrite to the rail. Nine is the running cap. Twenty is the tile cap. |
| “Orchestra Canvas (up to 9 concurrent tiles)” | `reference/tier-comparison.mdx` | Change “tiles” to the running cap, and name the rail. |
| First launch opens on “the multi-session grid” | `getting-started/first-launch.md` | Say the session rail. |
| “Angular 21 feature libraries” | Line 146 | Angular 22. Lane C read root `package.json`: `@angular/core` `~22.2.0`. The project brief in this task also says Angular 22. |
| “Monaco diff view, integrated terminal, file tree, git status, and a commit composer.” | Line 95 | The session git dock’s spot editor import is CodeMirror (`spot-editor.component.ts` line 40). Say CodeMirror for that dock. Keep terminal, file tree, git status, and commit composer only as the README’s existing claim; this research did not re-prove each one. Monaco is still used for the skill-enhancement diff (C, F37), so do not delete the word Monaco from the whole product. |
| Skill synthesis “extracts the trajectory, judges its quality, and promotes it to a permanent, shareable skill file.” | Line 69 | The loop proposes a diff and writes on Apply. Enhance can be disabled by a use threshold or a cooldown. Do not say promotion is automatic. |
| Tribunal: “ask in the main chat for Council, Forge, Race, Crucible, or Relay.” | Lines 68–72 | Keep only after the chat skill is executed. The webview Tribunal page was removed (`dea55817c`, 2026-10-29). Docs under `tribunal/` still exist. Until a run succeeds, move this out of the primary feature list or mark it as a skill that must be confirmed. |
| Messaging: “trigger and approve agent work from Telegram, Discord, or Slack, with voice input. Discord keeps a separate agent context per thread.” | Line 77 | Still a fair summary of documented gateways. Add the missing product fact: a rail action can hand the live desktop session to an approved binding and make that desktop tab read-only (Electron, binding required). Say the five list/switch commands are Discord commands. Say “voice input” here means gateway voice notes, not the Voice tab. |
| “Cost and token tracking — per session, per model, and per agent, with history and export.” | Line 96 | Keep. Add plan windows (F16) and, if the owner wants the precise ledger, integer micro-USD with a cost authority of provider-reported, model-priced, or unpriced (F17). Export was not re-checked in these reports; leave the word only if it is already on the docs page the README points at. |
| “Harness sync — one reconciler writes your agents, skills, and MCP intents into the harness folders of every supported AI tool.” | Line 93 | Directionally true. Name the seven targets if you list them (claude, codex, copilot, cursor, antigravity, opencode, pi) and the two safety rules: no delete of a git-tracked or hash-mismatched skill, quarantine instead of overwrite. |
| Get started step 5: “open Thoth to configure memory, schedules, and gateways.” | Line 125 | Thoth still has those four tabs (memory, skills, cron, gateway). Memory and Skills bodies are Electron-only; other hosts see a download prompt for those tabs. The title-bar strip C read was Chat, Voice, Apps, Tasks, Analytics, Setup. Which control opens Thoth was not in that strip. Do not invent a click path. |
| Tree-sitter “JavaScript, TypeScript, Python, and Go” | Lines 57–58 | Do not “fix” this from these reports. Lane C did not read the indexer. Lane B describes a capability registry and unsupported-extension counts, which is the better nearby sentence if the language list is later confirmed. |
| “PtahCode is free and open source under the MIT license. There is no trial and no credit card.” | Lines 131–133 | Leave the MIT sentence as the README’s current claim. Do not add “no account” or “no license key” from the landing hero until auth is checked. A license server exists in the monorepo and was outside these lanes. |

### Not a README error

- Lane A says the README still advertises `@openai/codex-sdk`. The README read for this document does not contain that string. The real gap is silence: native Codex app-server, dual runtime, and redacted carry-over are absent (F03).
- Hybrid BM25 and vector search is documented (B §5) and the README’s memory bullet matches that mechanism at a high level. Lane B does not use the words “Reciprocal Rank Fusion.” Do not delete the RRF phrase on this evidence, and do not add a new performance number to it.
- The six-column task board matches the six statuses lane C lists (F51).
- Setup wizard, new-project scaffolding, and the video clip table are documented and should stay. Lane C says onboarding is not hidden.

### Proposed README feature-section outline

Keep the title, the one-line promise, the video table, providers, get started, development, contributing, and license. Replace “Three pillars” and “More capabilities” with the sections below. Each bullet is a feature the reports support. Parenthetical IDs are for the editor, not for the README.

1. **What it is** — Electron desktop for Windows, macOS, and Linux; Angular webview; provider CLI lanes. One sentence. No Orchestra Canvas.
2. **The desktop** — session rail (F20); Voice tab when speech is configured (F21); Apps (F22); attention bell (F25); artifacts and detachable window (F23); git review dock (F27).
3. **A team of agents** — task router and on-disk checks (F01, F02); Claude runtime and Codex app-server (F03); CLI lanes and steer (F04); child worktree chats (F05); session handoff (F06); orchestration skill (F07). Tribunal only after F08 is verified.
4. **Cost, cache, and plan limits** — resume gate (F12); idle compaction (F13); subagent handoff file (F14); plan windows (F16); analytics (F17).
5. **Memory and skills** — hybrid search and the Memory tab (F34); named corpora (F35); skill diff you apply (F37). Drop “promotes it to a permanent skill” as an automatic act.
6. **From your phone, and on a schedule** — pairing and hand-off (F39); cron catch-up after sleep (F40). Keep approval relay only as the docs already state it; these reports did not re-audit that relay as its own feature.
7. **Your repo** — freshness and coverage on symbol search (F41); dependency graph including what depends on a file (F43); declaration summaries (F44); browser instrument (F47); `execute_code` without calling the VM a security sandbox (F46).
8. **Setup, tasks, and plugins** — setup hub (F29); task board and session link (F51); marketplace consent and install scope (F48); harness sync safety (F49).
9. **Providers** — keep the current provider section. Add multi-account Claude isolation (F19) only as a safety fact, not as an attack on other hosts.
10. **Get started** — keep the five steps. Point Voice and Apps at the title bar. Point the board at the rail, not a grid.

Development section: change “Angular 21” to “Angular 22.” Leave the rest of the tree comment alone; these reports did not audit “benchmark engine retained.”

---

## Landing page plan

Home today is `LandingPageComponent`, composed in this order (C): Hero, Problem, Pillars spine, Provider strip, Comparison tug meter, CTA. Other routes: `/download`, `/docs` (redirect to docs.ptah.live), `/terms-and-conditions`, `/privacy`.

### What to do with the current sections

| Current section | Action | Why |
| --- | --- | --- |
| Hero — “Free and open source.”, MIT desktop team, “No account, no license key, no credit card.” Captions about agents, models, sessions, parallel work. | **Rewrite** the story. **Hold** the MIT / no-credit-card line as existing copy. **Do not** repeat “no account, no license key” until Claims to verify is closed. | The launch story is the desktop command center and multi-vendor runtime. The account line is unverified. |
| Problem — architecture that stays consistent past feature five | **Keep**, with a light rewrite that points at memory and the task board | Still the memory pillar’s problem statement (F34, F35). |
| Pillars spine — memory + tree-sitter; skill curator + sub-agents + Orchestra Canvas + workflows; cron + gateways + approval relay. Canvas copy still says drag-and-resize and gridstack. | **Rewrite** | The canvas sentence is false (F20). Split this spine into the sections below so cost, voice, and the rail are visible. |
| Provider strip — Claude, GitHub Copilot, OpenAI Codex, OpenRouter (200+ models), Ollama, Kimi K2, GLM | **Keep** | Matches the landing chips C read. The “200+” figure is the strip’s own copy, not a new count from these reports. |
| Comparison tug meter — demo vs production on Multi-Tenant Isolation, Billing Correctness, Security Review, Architecture Consistency | **Drop** from the v2 narrative | C says this is not a Cursor / Claude Code / Codex matrix. These reports do not supply evidence for those four axes. Putting competitors on that meter would invent a comparison. |
| CTA — download and open-source trust | **Keep** | Still the action. Point it at the Electron download. |

Diagrams named by C (`memory-recall-diagram`, `orchestra-fanout-diagram`, `alwayson-loop-diagram`) need new stills. Do not reuse a gridstack screenshot.

### Proposed section order

**1. Hero**

- **Headline:** Your AI team, on one desktop rail
- **Subhead:** Voice, apps, and parallel sessions in an Electron app that can run Claude and Codex.
- **Features:** F20, F21, F03
- **Visual:** Pyramid or temple glass only as background if the theme default is confirmed (F30). Film the rail with one tile active. No fake grid.

**2. The command center**

- **Headline:** Twenty sessions. Nine at work. One bell.
- **Subhead:** Stay on a single tile while other sessions run, and answer a permission without opening that chat.
- **Features:** F20, F25, F26, F11
- **Visual:** Rail in dense mode, badge on the bell, Allow on a permission from another workspace, then a turn chip with files and cost.

**3. Talk, or hand it a screen**

- **Headline:** Speak the task. Use the app it builds.
- **Subhead:** A Voice stage maps delegated work, and an Apps page returns a form or chart you can operate.
- **Features:** F21, F22, F23, F24
- **Visual:** Split: Voice caption and a lit work node; then Apps with chat on the left and a chart on the right; then detach an artifact window. On-screen caption: voice requires speech setup.

**4. The problem you already state**

- **Headline:** Feature ten still knows feature one
- **Subhead:** Local memory, a timeline, and a named corpus you can hand to the next session.
- **Features:** F34, F35, F36
- **Visual:** Memory timeline, not a search box. Keep this section; it replaces the old pillar-1 diagram’s job.

**5. More than one vendor**

- **Headline:** Claude and Codex, then the CLIs you installed
- **Subhead:** Switch runtimes mid-thread, steer a background lane, and score a pass only when the file is on disk.
- **Features:** F03, F04, F01, F02, F05
- **Visual:** A runtime switch, a lane strip with a steer field, a verdict that fails when the file is missing. Do not use the word “only.”

**6. The bill and the plan window**

- **Headline:** Warm cache in. Cold resume out.
- **Subhead:** Idle compaction, a resume gate, and the vendor’s own plan window beside the session.
- **Features:** F12, F13, F16, F17
- **Visual:** A plan-limit tile next to session cost. A caption with the 10-minute / 150,000-token gate, labeled as product rules.

**7. Phone and morning catch-up**

- **Headline:** Leave the desktop. Take the session.
- **Subhead:** Hand a live chat to Telegram, Discord, or Slack, and catch up scheduled jobs when the laptop wakes.
- **Features:** F39, F40
- **Visual:** Rail menu, desktop composer going read-only, phone thread. Second beat: lid-open catch-up, not a cloud VM.

**8. Skills you accept**

- **Headline:** It drafts the skill. You apply the diff.
- **Subhead:** Retries and review findings become a proposal, a judge line, and an Apply button.
- **Features:** F37, F38, F49
- **Visual:** Proposal, judge line, Apply. A second frame for “kept because git tracks it.”

**9. Providers**

- **Keep** the current strip.
- **Headline:** Bring the vendors you already pay for
- **Subhead:** Frontier CLIs, OpenRouter, Ollama, and local or hosted speech when you turn voice on.
- **Features:** F18, F19, F21 (engines only)
- **Visual:** The existing chip row. Optional small line for multi-account Claude isolation.

**10. CTA**

- **Keep** download.
- **Headline:** Download the desktop app
- **Subhead:** Windows, macOS, and Linux. Open a folder and run setup.
- **Features:** F29
- **Visual:** Existing install clip is enough. A still of “Choose agents” after analysis, as C suggests. Do not present setup as undiscovered.

---

## Social campaign kit

Two weeks, one feature a day, Electron desktop as the subject. Post copy stays inside the hooks below. Each post needs the condition in the first comment or the last line when the feature has one. Skip F08 (Tribunal) until the skill is run. Skip F31 and F32 as campaigns. Use F30 only as the background of stills.

### 14-day sequence

| Day | Feature | Post idea | Condition to print |
| --- | --- | --- | --- |
| 1 | F20 Session rail | “The grid is gone. Here is the rail.” Film 20 tiles and say 9 can run. | Legacy grids render as the rail. |
| 2 | F25 Attention bell | Allow a permission from a session you did not open. | — |
| 3 | F21 Voice | Speak, caption, a node lights, a short reply is spoken. | Voice unavailable until STT and TTS are configured. Not the Telegram voice note. |
| 4 | F22 Apps | Ask for a chart, submit the form, the agent reads the state. | Electron. Closed catalog. |
| 5 | F23 Artifacts | Open the card, detach the window. | Iframe lives in the panel, not in the bubble. |
| 6 | F04 + F11 Lanes | Start a second CLI and type into the steer box. | Some CLIs report steer as unsupported. |
| 7 | F02 Disk check | Show a run that does not count until the file exists and is non-empty. | Filesystem check, not a crypto signature. |
| 8 | F03 Dual runtime | Switch Claude runtime and Codex app-server; mention the last 16 messages and redaction. | — |
| 9 | F01 Router | Show a task labeled with a type and a lane choice, plus the 90-day record in one sentence. | Do not say “the only router.” |
| 10 | F12 Resume gate | “Ten minutes idle or 150k tokens: start a fresh brief.” | Thresholds are product rules, not a savings study. |
| 11 | F39 Hand-off | Menu item, desktop goes read-only, phone continues. | Needs a paired binding. Discord’s five commands are Discord-only. |
| 12 | F35 Corpora | Build a named corpus and prime a session. | Needs a workspace and an agent session. |
| 13 | F37 Skills | Proposal, judge line, Apply. | It does not write the skill by itself. |
| 14 | F16 + F40 | Plan window beside the session, then a scheduled job that runs after the lid opens. | Windows appear only when the provider reports them. Catch-up is at most 24 hours. |

### Hooks

1. Twenty sessions on the rail. Nine of them can be working. You stay on one.
2. The permission prompt found you. You did not have to find the session.
3. Talk to the team. Watch the work. Voice stays off until speech is set up.
4. Ask for a dashboard. Use it. Don’t paste the numbers back.
5. The agent didn’t paste a screenshot. It handed you the page in its own window.
6. Your installed CLIs can sit in the background. Steer the one that is still on the turn.
7. A pass counts when the file is on disk, non-empty, and newer than the run.
8. Claude’s runtime and Codex’s app server, one thread. The carry-over redacts secret-shaped strings.
9. Ninety days of pass and fail in this repo, blended into the next lane choice.
10. After ten quiet minutes, Ptah would rather write a short new brief than replay a cold cache.
11. Start on the desktop. Hand the session to your phone. The desktop composer locks until you take it back.
12. Build a named body of project knowledge. Prime a specialist with it.
13. It drafts the skill from real retries. You apply the diff.
14. The plan window sits next to the session, so you see the limit before the vendor cuts you off.
15. Close the lid. Scheduled local jobs can catch up when the machine wakes, up to a day of missed slots.
16. Write a skill once. A git-tracked copy in another CLI’s folder is kept. A blocked file goes to quarantine.
17. Feature ten can still open the timeline from feature one. That screen is on the desktop, not only in a search box.
18. A child chat gets its own worktree and its own tab. The cap is three of those per parent.

### Demo videos

**Video 1 — “The rail is the product” (45–60 seconds)**

1. Open the Electron app on a workspace that already has several sessions.
2. Show the rail, say twenty tiles and nine running.
3. Trigger a permission on a session that is not focused. Open the bell. Allow it.
4. End on a turn chip: files, tests, cost.
5. Do not show a grid, a lock icon, or a Single/Grid toggle.

**Video 2 — “More than one vendor” (60–75 seconds)**

1. Main chat on one runtime. Switch to the other. One sentence on redacted carry-over of the last 16 messages.
2. Spawn a background CLI lane. Open the steer box and send a mid-turn note.
3. Cut to a completion where the deliverable check is visible: file present, non-empty.
4. Optional last card: a child session tab and its worktree path. Say the cap is three.
5. Do not claim a competitor cannot do any single shot.

**Video 3 — “Desktop, then phone” (45–60 seconds)**

1. Voice tab: speak one request, show the caption and a work node, hear a one- or two-sentence reply. Flash “Voice unavailable” only if you also show the unconfigured state.
2. Apps: a form and a chart, then a submit.
3. Detach the display window.
4. Rail menu: hand the session to a paired gateway. Show the desktop tab read-only.
5. End title: pairing required; Discord commands are the five thread commands, not a claim about every chat app.

### Threads

**Thread A — “Did you know the canvas is a rail?”**

1. The README still says a drag-and-resize grid of nine sessions.
2. The board is a rail. Twenty sessions fit. Nine may run.
3. Each card can take an attention action. The bell can take it for a workspace you are not looking at.
4. A legacy grid record is drawn as the rail. There is no grid to film.
5. Ask people to tell you if their docs still say gridstack.

**Thread B — “Did you know a pass can fail the filesystem?”**

1. Agents report that they wrote files.
2. Ptah can check that the path exists, the size is above zero, and the mtime is at or after the run started.
3. If the reviewer is the same vendor as the author, that review does not add a pass.
4. Those signals feed a 90-day local score used when the next task is routed.
5. Close: this is a desktop behavior in the repo, and the README does not mention it yet.

**Thread C — “Did you know you can leave the desk?”**

1. Gateways are not only a way to start a job. A live desktop session can be handed to a paired chat.
2. The desktop composer goes read-only until you take the session back.
3. Discord can list or switch sessions and workspaces, or start fresh. Those five commands are Discord’s.
4. Voice on the desktop is a separate stage. Gateway whisper notes are the other feature.
5. Scheduled jobs can catch up after sleep, inside 24 hours, without double-firing on a flappy lid.

---

## Claims to verify before publishing

Do not present these as shipped, exclusive, offline, or account-free. Where a feature above is shipped with a condition, the condition is the publishable form.

### Orchestrator spot-check (2026-11-04)

Confirmed in source:
- README line 67 (drag-and-resize grid) is stale, and `MAX_CANVAS_TILES = 20`
  (`libs/frontend/canvas/.../canvas-layout-intent.ts`).
- README line 146 says Angular 21. `package.json` pins `@angular/core ~22.2.0`.
- Cold-resume gate at 150,000 context tokens
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46`).
- Subagent warning at 85% (`NEAR_BUDGET_RATIO = 0.85`,
  `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:185`).
- Keyword presence for System-1 routing, outcome priors, the repeat-call stop, plugin consent and
  cron catch-up in their libs.

NOT confirmed. Check these before you put the numbers in public copy:
- "Carry-over of the last 16 messages with secret-shaped strings redacted" (Codex runtime switch).
  No 16-message constant or redaction was found in `codex-carry-over-projector.ts`.
- "500,000-token subagent safety cap". No such constant was found in `subagent-budget-monitor.ts`.

### Packaged v2

- No lane ran the packaged Electron app. “Shipped” means the source the lanes read. Confirm Voice, Apps, the rail, hand-off, plan-limit tiles, and Codex app-server in the build you will link from ptah.live/download (B open question; all three lanes).

### Competitor exclusivity

Lane A states these as things competitors do not do. No competitor product was audited in these reports. Lane B’s decision is the rule for this document: publish the Ptah workflow, not “the only platform.”

- “Only platform” with an empirical multi-vendor capability matrix and automated router (A §1).
- Cursor, Windsurf, Copilot, and Cline “have zero awareness of historical vendor pass rates” (A §1).
- Cursor and Windsurf “lose native Claude Code and Codex agentic harness capabilities” (A §3).
- “Only host” with the 8-step Claude certification and post-init tripwire (A §6).
- Competitors “only show usage for their own single subscription” (A §7).
- Subagents in Claude Code, Cline, and Cursor “share the same working tree” (A §8).
- Claude Code, Cursor, and Cline “orphan every running background agent” on a new session (A §9).
- “Only cross-vendor harness manager” with git-proved retirement (A §15). A also says other tools “blindly overwrite” skill files. Unverified.
- Cursor and Claude Code “have no structured adversarial cross-critique” or Crucible loop (A §20).
- Cloud background agents “require pushing unmerged code” and local cron “simply miss every job” while asleep (A §22). The catch-up behavior is real in Ptah’s code as reported; the competitor half is not audited.
- Marketplace competitors “run unverified npx/git scripts” (A §23).
- Lane B, feature by feature, marks exclusivity unverified for: symbol search, language coverage, dependency graphs, context summaries, hybrid memory, compaction curation, corpora, retention, output budgets, voice quality, ElevenLabs, browser automation (Cursor and Cline also automate browsers), task/session linkage, and usage ledgers.
- Lane C’s contrasts (dictation products, markdown-only replies, focused-thread questions, Cursor preview) are useful framing. They are still one lane’s reading, not a matrix you should print as fact.

### Numbers that are rules or comments, not studies

- 0.1× cache-read, 1.0×–1.25× cold prefix, 1.25× and 2.0× cache-write weights: code constants reported by A. Fine as “the gate uses these weights.” Not fine as “customers save 90%” or “$1–$3 a resume.”
- “About 3,500 tokens” saved by stripping Claude built-ins: a comment cited by A §13. Confirm the comment still matches the catalog before it is a headline number.
- OpenRouter “200+ models”: landing chip and README. Not re-counted here.
- Micro-USD avoids float drift: an implementation claim from A §21. Fine technically. Do not invent a reconciliation percentage against vendor invoices.

### Tribunal

- Webview Tribunal page removed `dea55817c` (2026-10-29).
- README lines 68–72 and `apps/ptah-docs/src/content/docs/tribunal/*` still describe Council, Forge, Race, Crucible, and Relay.
- Nobody in this research executed the skill. Do not put Tribunal in the hero, the day-1 post, or the launch film until a run succeeds in main chat.

### License, account, and pricing

- README: free, MIT, no trial, no credit card.
- Landing hero: “No account, no license key, no credit card” (`hero.component.ts` lines 56–73, via C).
- Docs include `getting-started/signing-in.md` and `troubleshooting/license-issues.mdx`.
- A license server exists in the monorepo and was out of scope.
- Whether the desktop app requires an account or a license was not verified. Do not add the hero’s “no account” line to the README, ads, or store listing until auth is walked.

### Tree-sitter language list

- README limits the list to JavaScript, TypeScript, Python, and Go.
- Lane C did not read the indexer and refused to confirm or refute it.
- Lane B’s registry counts unsupported extensions even when the language is generally supported (F42). Publish coverage honesty. Do not widen the language list from memory.

### Monaco

- README line 95 says Monaco diff view.
- The git dock spot editor imports CodeMirror.
- The skills Apply preview uses a Monaco diff (C).
- Confirm whether any Electron surface still mounts Monaco for git diffs before deleting the README phrase entirely.

### Voice and offline

- Do not say local Whisper or Kokoro is offline or air-gapped. Lane B did not verify an end-to-end no-network path.
- Do not show the Voice tab as always on. The chip is “Voice unavailable” without both STT and TTS.
- Do not illustrate Kokoro or ElevenLabs as documented. They had no match in the checked README, landing, and docs. ElevenLabs is key-dependent.

### Partial, conditional, or not re-read

Publish the condition in the same sentence as the feature.

| Item | Condition |
| --- | --- |
| F05 child sessions | Maximum 3 per parent |
| F06 auto-close after handoff | Only when `sessionBudget.closeSourceAfterAutoHandoff` is on, and only after adoption succeeds |
| F08 Tribunal | Skill not executed |
| F10 lane verdict card | Displays a verdict; does not decide it |
| F11 steer box | UI shipped; not every runtime was re-proved to accept steer |
| F16 plan tiles | Only windows the provider actually reports |
| F17 costs | Contributions can be unpriced; authority is provider-reported, model-priced, or unpriced |
| F20 rail | Not a grid |
| F21 voice | Electron; needs STT and TTS; local assets or an ElevenLabs key |
| F22 Apps | Electron; closed catalog |
| F24 ptah-ui | Closed catalog; bad atoms fail closed |
| F26 change-set | Omitted when the turn changes no files |
| F27 git dock | Electron; foreign worktree Changes tab is read-only |
| F32 composer fold | Commit messages only; component not re-read. Do not script a shot from it. |
| F34 semantic memory | Falls back or degrades without sqlite-vec |
| F35 corpora | Needs a workspace and an agent session |
| F37 Enhance | Manual Apply; threshold and cooldown can disable it |
| F39 messaging | Pairing required; Discord command set is not claimed for Telegram or Slack; hand-off needs a binding |
| F40 catch-up | Window clamped to 24 hours; policy may be `none` |
| F41 search | Coverage can be unknown during the first index |
| F42 parsing | Unanalyzed extensions stay unsupported |
| F43 graph | Limited by import-resolution coverage |
| F44 declarations | Ineligible files return full content with a reason |
| F45 output budgets | Spool failure is reported, not hidden |
| F46 execute_code | VM timeout and cancellation; not a security-grade sandbox |
| F47 browser | URL and root restrictions |
| F50 capabilities | Corrupt policy fails closed to unverified and strips skills and non-built-in MCP servers |
| F51 tasks | No `task.md`, no card |
| Composer, report-mail, motion | Shipped and weak as campaign claims. Report mail opens `mailto:help@ptah.live` and sends nothing by itself. |
| Thoth and Marketplace entry points | Routes exist. They were not in the title-bar strip C read (Chat, Voice, Apps, Tasks, Analytics, Setup). Confirm the control before a caption says “click Thoth.” |
| Pyramid as “the new look” | Commits made pyramid the default scene (`753bbc19c`). Confirm the theme store before printing that on a still that might be temple or a user override. |
| Skill-proposal UI in a launch video | The Apply screen exists (C). A asked whether the 15-minute proposal token UI is scheduled for the film. Use the Apply screen. Do not film a token countdown unless someone checks it is visible. |

### Docs that will contradict the launch if left up

- `apps/ptah-docs/src/content/docs/canvas/index.md`
- `reference/tier-comparison.mdx` (“9 concurrent tiles”)
- `getting-started/first-launch.md` (“multi-session grid”)
- Landing pillar copy in `pillars-spine.component.ts` (gridstack)
- README lines 67 and 146

---

## Decisions

1. **Decision:** This file is an internal owner brief, not public copy. Public headlines in the landing plan are proposals and inherit every condition in Claims to verify.  
   **Options:** Write launch-ready pages now, or write the brief the task named.  
   **Evidence:** The task’s deliverable sections are analysis, README corrections, a landing plan, and a campaign kit. Audience and tone for a public page were fixed by that contract: product owner, Electron v2, honest claims.  
   **Reversible:** Yes. A later creative pass can turn each landing section into page copy.

2. **Decision:** Deduplicate the named overlaps into single IDs, and keep neighbors that are different user actions.  
   **Options:** One row per source section (69 rows, triple-counting voice and cost), or merge only true duplicates.  
   **Evidence:** Voice tab (C) needs the engines (B §13–14) and is not the gateway voice note. Messaging pairing (B §11), Discord commands (B §12), and rail hand-off (C) are one remote-control story with different conditions. Micro-USD sink (A §21), workspace analytics (B §18), and the analytics tab (C) are one ledger; plan windows (A §7, C) are the vendor quota, so they stay F16. Session handoff (A §9) and canvas adoption (C) are F06. Hybrid search, the Memory tab, and index states are F34; named corpora stay F35 because the workflow is hidden and scored 5. Skill archaeologist (A §17) and the Skills tab (C) are F37. Nested git watcher (B §16) and the review dock (C) are F27. Task auto-link (B §17, C) and Task Doctor (A §18) share F51 because the owner’s “tasks” story is one section, with the doctor called out as the hidden half. Child worktree chats (A §8) stay separate from the rail (C) because the caps are 3 and 9/20.  
   **Reversible:** Yes. Split F51 or F21 if a later pass wants two URLs.

3. **Decision:** Top 25 deep sections are all 18 wow-5 rows plus seven wow-4 rows: F16, F20, F23, F24, F25, F26, F27.  
   **Options:** First 25 by ID, or all wow-4s, or only wow-5s.  
   **Evidence:** Wow-5 is the lanes’ own priority. The wow-4 tie-break prefers a feature that corrects a public falsehood (the rail) or is a hidden Electron or cost surface a launch reader can see (plan windows, artifacts, ptah-ui, bell, turn cards, git dock). Freshness search, output budgets, proxy pool, peer sessions, and the clone mirror stay in the table at wow 4 so they are not dropped.  
   **Reversible:** Yes.

4. **Decision:** Where lane A says “hidden / zero mentions” and the README or lane C shows a docs page, the master status follows the README and C.  
   **Options:** Trust A’s pattern search, or trust the README text read in this pass plus C’s file list.  
   **Evidence:** README line 69 names skill synthesis. README line 93 names harness sync. C lists `skill-synthesis/*` and says the Skills tab documents Enhance, preview, and revert. A §17 and A §15 say zero mentions. Those internals (archaeologist, scorecard, git retirement proof, quarantine) stay “hidden or easy to miss.” The features are not absent.  
   **Reversible:** Yes, if a docs delete removed those pages after C’s list (C listed them on 2026-11-04).

5. **Decision:** Do not file a README correction that the README “still lists `@openai/codex-sdk`.”  
   **Options:** Repeat A’s decision, or correct it from the file.  
   **Evidence:** This pass read `README.md` through the license section. That string is not in it. A’s underlying fact still holds: the native app-server and `RoutingAgentAdapter` are undocumented, and A cites `bac9eb3c6` as the retirement of the SDK. No source file was opened; the conflict is between A’s sentence and the README text.  
   **Reversible:** Yes, if another README copy outside this worktree still names the SDK.

6. **Decision:** Competitor sentences in pillars describe Ptah, and they quote lane contrasts only as unverified when they claim absence.  
   **Options:** Reprint A’s “only platform” lines, or follow B’s decision that code verifies Ptah and not the market.  
   **Evidence:** B, Decisions: treat “unique” as a distinctive workflow. The task says not to invent competitor facts.  
   **Reversible:** Yes, after a real competitor pass.

7. **Decision:** Public name for the router is “task router” inside this brief.  
   **Options:** “System-1 Router” or a Thoth-branded name (A’s open question).  
   **Evidence:** `/v1/systemone` is an internal path. C’s lesson on Voice versus Command Center is to use the words a user sees. The user does not see “System-1” in the README. Naming the public brand is an owner choice and does not block this brief.  
   **Reversible:** Yes.

8. **Decision:** Landing comparison meter is dropped from the v2 plan rather than recast as a Cursor matrix.  
   **Options:** Keep the four axes, or invent competitor scores.  
   **Evidence:** C: the meter is “demo vs production,” and these reports do not document those axes. Inventing scores would violate the source rule.  
   **Reversible:** Yes, if product has a separate proof for those axes.

9. **Decision:** Lead the campaign with the rail and the other visible Electron surfaces, then orchestration, then economics.  
   **Options:** Lead with corpora, auto-link, or freshness (B’s open question), or with the router.  
   **Evidence:** The README is factually wrong about the canvas (C). Voice, Apps, the bell, and hand-off are hidden and filmable. The router is the deepest story and has no UI in these reports. Day 1 should fix the picture people already believe.  
   **Reversible:** Yes.

10. **Decision:** Do not call local voice offline, do not script the composer fold, and do not print pyramid as the default look.  
    **Options:** Use B and C’s marketing lines as written.  
    **Evidence:** B open question on no-network; C says the fold component was not re-read; C says confirm the theme store before “the new look.”  
    **Reversible:** Yes, after those checks.

11. **Decision:** Angular 22 and the rail caps are accepted from lane C without re-opening `package.json` or the canvas sources.  
    **Options:** Re-read the cited files, or carry C’s citations.  
    **Evidence:** The task allows opening a cited file to resolve a conflict. README line 146 says Angular 21; C cites `@angular/core` `~22.2.0`. README line 67 says a grid of nine; C cites `orchestra-canvas.component.ts` lines 51–54, `canvas-layout-intent.ts` lines 6–11, and `canvas-running-cap.ts` lines 6–7. Those citations agree with the task’s own examples of the corrections. No conflict between C and A on the rail.  
    **Reversible:** Yes, if those lines have moved.

12. **Decision:** Approval relay, execution tree, OpenRouter “200+”, and RRF stay as existing README or docs claims. They do not get new IDs.  
    **Options:** Add them as researched features.  
    **Evidence:** C treats them as present and did not re-audit the backends. B confirms hybrid fusion and does not name RRF. Adding them as fresh findings would launder an old sentence into a new citation.  
    **Reversible:** Yes.

13. **Decision:** No design-system tokens in this brief.  
    **Options:** Specify colors and type for the landing rebuild, or stay in words and shot lists.  
    **Evidence:** The task asks for headlines, feature mapping, and demo ideas. It does not ask for a visual spec. Inventing tokens would conflict with the content role’s rule to use `docs/design-system/` or hand visual specification back.  
    **Reversible:** Yes. A ui-ux pass can skin the section order later.

14. **Decision:** Skill loading. No extra content skill was loaded.  
    **Options:** Load a docs or design skill and follow it, or follow the task contract and the technical-content-writer role.  
    **Evidence:** The task specifies the file, the eight sections, and the source limit. The role’s public-page templates were not needed to invent a new format. This pass read the role file’s working rules and the inputs.  
    **Reversible:** Yes.
