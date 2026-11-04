# Frontend UX — hidden and under-marketed features

Scope: Angular renderer (`apps/ptah-extension-webview`) and `libs/frontend/*`, plus the ptah-ui / surface contract in `libs/shared/src/mcp-apps-contracts`. Backend orchestration and integrations are out of scope. Citations are files this pass read. Dates are commit dates from `git log --since="2026-09-30"` (and a few `--diff-filter=A` lookups). Today in this session is 2026-11-04.

Skill note: no research skill was assigned for this lane, and none in the host catalogue matched a frontend feature inventory. Ptah symbol search returned an empty index (`symbolCount: 0`), so structure came from `ptah_ast_analyze`, `ptah_search_files`, and targeted file reads. Native `git log` was read-only.

## Summary

- The desktop title bar ships a **Voice** tab (internal name Command Center): a spoken head-of-engineering stage with a live agent scene, barge-in, and spoken replies — absent from the README, landing page, and docs.
- The same bar ships an **Apps** tab where the agent builds interactive surfaces (forms, charts, tables) beside a private conversation — also undocumented.
- The marketed **Orchestra Canvas drag-and-resize grid** is stale: the only board is a session rail (up to 20 tiles, 9 running), with an agent dock, inline permissions, and a hand-off that makes the desktop tab read-only while Telegram, Discord, or Slack drives the session.
- Agent replies can publish **sandboxed HTML artifacts** and **ptah-ui** blocks into a display panel that detaches into its own window — not in the README or landing story.
- A title-bar **notification bell** answers permissions and questions for any workspace without opening that session; turn **change-set cards** and **turn-summary chips** show what a turn actually changed.

## Docs gap baseline

### What README.md claims today

Verified against `README.md` (read through the license section) on 2026-11-04.

| Claim | Where | Verdict |
| --- | --- | --- |
| Desktop app, Angular webview, persistent memory, staffed agents, cron, Telegram/Discord/Slack with voice, approval relay, setup wizard, new-project scaffold, MCP `ptah_*` tools, marketplace, harness sync, six-column tasks board, Monaco/terminal/git, cost tracking, provider mix (OpenRouter 200+, Ollama, installed CLIs), MIT, no trial | `README.md` lines 7–133 | Present in product docs and, for the UI pieces, in frontend code. Not re-audited against backends. |
| Orchestra Canvas: “up to nine concurrent sessions in one drag-and-resize grid” | `README.md` line 67 | **Stale.** The canvas component says the rail is the only board and a stored legacy grid renders as rail (`orchestra-canvas.component.ts` lines 51–54). Tile cap is 20 (`canvas-layout-intent.ts` lines 6–11). The number 9 is the **running** cap, not the tile cap (`canvas-running-cap.ts` lines 6–7). |
| “Angular 21 feature libraries” | `README.md` line 146 | **Wrong.** Root `package.json` depends on `@angular/core` `~22.2.0`. |
| Tribunal as a main-chat skill (Council, Forge, Race, Crucible, Relay) | `README.md` lines 68–72 | Docs still have `apps/ptah-docs/src/content/docs/tribunal/*`. The **Tribunal page** in the webview was removed (`dea55817c`, 2026-10-29, “retire the Tribunal page”). This lane did not verify the chat skill still runs. |
| Tree-sitter “JavaScript, TypeScript, Python, and Go” | `README.md` lines 57–58 | Not checked here (backend indexer). Do not treat the language list as confirmed or refuted. |
| “free and open source … no trial and no credit card” | `README.md` lines 131–133 | Matches the landing hero. A license server exists in the monorepo but was outside this lane. Signing-in is a docs page; whether an account is required was not verified. |

README does **not** name: Voice / Command Center, Apps, ptah-ui fences, detached display window, HTML artifacts, the notification bell, turn change-sets, turn-summary chips, provider plan-limit windows, motion scenes, session hand-off to a gateway, or the git review dock’s spot editor.

### Landing sections

Home route is `LandingPageComponent` (`apps/ptah-landing-page/src/app/app.routes.ts` lines 6–8). Other routes: `/download`, `/docs` (hard redirect to `https://docs.ptah.live`), `/terms-and-conditions`, `/privacy`.

`libs/web/landing/src/lib/landing-page.component.ts` composes, in order:

1. `HeroComponent` — cinematic story, headline “Free and open source.”, lead about a MIT desktop team, “No account, no license key, no credit card” (`hero.component.ts` lines 56–73). Captions: agents coordinate, models review, every session in one view, parallel agents (`hero.component.ts` lines 21–26).
2. `ProblemSectionComponent` — “architecture that stays consistent past feature five” (`problem-section.component.ts` lines 33–36).
3. `PillarsSpineComponent` — three pillars: persistent memory + tree-sitter + symbol search; skill curator + sub-agents + Orchestra Canvas + workflows; cron + messaging gateways + approval relay (`pillars-spine.component.ts` lines 277–363). Canvas copy still says “drag-and-resize grid” and “gridstack” (lines 327–336). Diagrams: `memory-recall-diagram`, `orchestra-fanout-diagram`, `alwayson-loop-diagram`.
4. `ProviderStripComponent` — chips: Claude, GitHub Copilot, OpenAI Codex, OpenRouter (200+ models), Ollama (local), Kimi K2, GLM (`provider-strip.component.ts` lines 81–89).
5. `ComparisonSectionComponent` → tug meter. Axes: Multi-Tenant Isolation, Billing Correctness, Security Review, Architecture Consistency (`comparison-tug-meter.component.ts` lines 225–242, located by search). Framing is “demo vs production,” not a Cursor/Claude Code/Codex feature matrix.
6. `CTASectionComponent` — download and open-source trust row.

Landing does not mention Voice, Apps, the rail, artifacts, the bell, the git review dock, or Thoth’s curator screens.

### Docs pages

151 content files under `apps/ptah-docs/src/content/docs` (listed 2026-11-04). Grouped by folder:

- `agents/`: agent-orchestration, agent-sessions, built-in-agents, cli-agents, custom-agents, importing-history, index, syncing-to-cli
- `automation/cron/`: catchup-and-power, creating-a-job, cron-expressions, index, run-history, settings
- `automation/messaging/`: discord, index, pairing-and-approvals, settings, slack, stream-coalescing, telegram, voice-messages
- `automation/index.mdx`
- `browser-automation/`: index, interacting, launching-a-browser, navigation, network-monitoring, reading-content, recording, screenshots
- `canvas/index.md` — **stale** (see feature 3)
- `chat/`: autopilot, cost-and-tokens, effort-levels, execution-tree, file-attachments, index, sending-messages, switching-models
- `getting-started/`: first-launch, index, installation, signing-in
- `git/`: branch-awareness, commits, diffs, git-status, index, worktrees
- `marketplace/`: connected-apps, connectors, index, mcp-registry, smithery
- `mcp-and-skills/`: built-in-mcp-server, creating-skills, index, popular-skills, ptah-tools, skills, third-party-mcp
- `memory/`: how-it-works, index, pinning-and-forgetting, searching, settings
- `plugins/`: creating-plugins, harness-plugins, index, installing, managing, marketplace, plugin-storage, skill-selection, skill-toggles
- `providers/`: claude, codex, copilot, index, kimi-code, lm-studio, ollama, openrouter, ptah-cli, requesty, sakana, switching, web-search, z-ai
- `reference/`: changelog, file-locations, glossary, index, keyboard-shortcuts, tier-comparison
- `sessions/`: analytics, auto-import, cost-summary, index, managing-sessions, metadata, session-history
- `settings/`: api-keys, autopilot, global-settings, import-export, index, theme, why-not-package-json, workspace-settings
- `setup/`: ai-team-builder, index, new-project, setup-wizard
- `skill-synthesis/`: background-learning, how-it-works, index, reviewing-candidates, settings, skill-md-anatomy, the-skills-tab
- `tasks/index.md`
- `templates/`: creating-templates, index, template-storage, using-templates
- `tribunal/`: council, crucible, forge, index, race, relay
- `troubleshooting/`: cli-agent-not-detected, filing-bugs, index, installation-issues, license-issues, logs-and-diagnostics, mcp-port-conflicts, provider-errors, session-import-problems, workspace-analysis-failures
- `workspace/`: index, opening-a-workspace, project-analysis, switching-workspaces, workspace-config, workspace-intelligence, workspace-restoration
- `index.mdx`

No docs page is titled Voice, Command Center, Apps, ptah-ui, artifacts, or notification center. `chat/index.md` uses “command center” only as a metaphor for chat. Messaging “voice” is inbound Whisper notes, not the Voice tab.

`reference/tier-comparison.mdx` still says “Orchestra Canvas (up to 9 concurrent tiles).” `getting-started/first-launch.md` still says the app opens on “the multi-session grid.”

## Feature inventory

### Voice stage (Command Center)

What it does. On Electron, the title bar has a **Voice** tab (`electron-shell.component.ts` lines 251–261) that routes to `/command-center` (`app.routes.ts` lines 161–173). The page is a stage: a canvas scene of work nodes, a caption strip, a work list, a live panel, and a rail with a Display tab. Voice controls start, mute, stop, and interrupt speech (`command-voice-hud` is covered by `accessibility-list.spec.ts`). The loop captures PCM, transcribes, sends the transcript as a turn, speaks the reply, and can barge in (`command-voice-loop.ts` lines 21–33). The session persona tells the model to answer in one or two spoken sentences and delegate the rest (`command-center-persona.ts` lines 4–5). If STT or TTS is missing, the chip says “Voice unavailable” (`command-center-page.component.ts` lines 152–168).

Why it is unique. Cursor, Copilot, and Claude Code can take dictation or read a reply. They do not ship a separate spoken “head of engineering” surface that keeps a visual map of delegated work and talks back. Gateway voice notes (documented) are a different feature: inbound audio on Telegram/Discord/Slack.

Evidence. `electron-shell.component.ts` 251–261; `app.routes.ts` 161–173; `command-center-page.component.ts` 152–168; `command-center-persona.ts` 4–5; `command-voice-loop.ts` 21–33; `command-scene.component.ts` 33–52 (themed sprite palettes).

Docs status. **Hidden.** No README, landing, or docs hit for this surface. Chat docs use the words only as a metaphor.

Recency. Page added `0d2b4d91a` (2026-10-15). Live rail and glass stream: `d9fe941d0` (2026-10-28). Display tab: `217b93e97` (2026-10-28). Neutral root logo: `cdd5e28ac` (2026-11-02).

Marketing angle. “Talk to the team. Watch the work.” Screen recording of the Voice tab: user speaks, caption appears, a node lights up, the reply is spoken.

Maturity. **Shipped** on Electron. Voice itself is off until both a speech-to-text and a text-to-speech provider are configured. VS Code cannot match the route (`app.routes.ts` 160–162).

### Apps page (agent-built UI)

What it does. The title bar **Apps** tab (`electron-shell.component.ts` lines 263–273) opens `/apps`, Electron-only (`app.routes.ts` lines 149–158). Layout is a private transcript plus a surface panel. The page prompt tells the agent to build UIs with `ptah_surface_update`, read the user’s selection with `ptah_surface_get_state`, and keep chat replies short (`apps-system-prompt.ts` lines 12–30). The panel renders those surfaces and falls back to “This app could not be shown.” (`apps-surface-panel.component.ts` lines 29–30). The conversation is not the coding chat (`apps-page.component.ts` lines 149–151).

Why it is unique. Claude Code and Codex return markdown. Cursor can show a preview of files you already have. This page lets the agent publish a live form, chart, or table the user operates, then reads that state back. That is closer to a mini internal tool than to a chat transcript.

Evidence. `electron-shell.component.ts` 263–273; `apps-page.component.ts` 19–42 and 149–151; `apps-system-prompt.ts` 12–30; `surface-catalog.ts` 36–70.

Docs status. **Hidden.**

Recency. Last Apps-page layout commit in this log is `e77fa691f` (2026-09-26), just outside five weeks. Catalog `/4` (accordion, avatar, stat trend, sparkline) landed `51a6aa3a9` and `cf913a15f` (2026-10-10). Focus routing: `2d36a60e9` (2026-10-20).

Marketing angle. “Ask for a dashboard. Use it. Don’t paste the numbers back.” Split screen: chat on the left, a form and chart on the right, then a submit.

Maturity. **Shipped** on Electron. Component vocabulary is a closed catalog (layout, inputs, charts, tables, lists, alerts, and `/4` extras in `surface-catalog.ts` lines 36–85), not arbitrary HTML.

### Session rail (what “Orchestra Canvas” actually is)

What it does. Chat opens a rail board, one per workspace. A legacy grid layout is rendered as a rail (`orchestra-canvas.component.ts` lines 51–54). The board holds 20 sessions (`MAX_CANVAS_TILES`, `canvas-layout-intent.ts` lines 6–11). Only 9 may be running at once (`canvas-running-cap.ts` lines 6–7). Density is comfortable or dense; sort is recent or manual (`canvas-board-mode.ts` lines 1–20). Cards show compact session state, attention actions, and an agent dock. Recent work grouped the dock and added a background rail state (`89510cb0f`, `6396aeb4b`, `82e5cd438`, all 2026-11-03).

Why it is unique. Competitors use tabs or a sidebar of chats. A rail of live sessions with a hard running cap, per-card permissions, and an agent dock is a real difference — but it is **not** the drag-resize grid the README, landing page, and canvas doc still sell. Cursor’s agents window and Codex’s tasks are closer cousins than a Gridstack mosaic, and the mosaic is gone.

Evidence. `orchestra-canvas.component.ts` 45–59; `canvas-board-mode.ts` 1–20; `canvas-layout-intent.ts` 4–11; `canvas-running-cap.ts` 6–7; `canvas-rail-card.component.ts` 19–44 (attention actions and `SendToMessagingComponent`).

Docs status. **Documented, and the documentation is wrong.** `apps/ptah-docs/src/content/docs/canvas/index.md` lines 1–37 still describe a drag-resize grid, a Single/Grid mode switch, a lock control, and both “nine” (frontmatter) and “twenty” (body). README line 67 and the landing pillar (lines 327–336) repeat the grid. `reference/tier-comparison.mdx` says “9 concurrent tiles.”

Recency. Rail sort persistence `222fd6d56` (2026-11-03). Live tile status `4e02c8a63` (2026-11-03). Dock grouping `82e5cd438` and `89510cb0f` (2026-11-02/03).

Marketing angle. “Twenty sessions on the rail. Nine working at once. You stay on one.” Film the rail, not a fake grid. Retire gridstack screenshots.

Maturity. **Shipped.** Gridstack constants remain in `canvas-layout-intent.ts` for legacy records; the rendered board is the rail.

### Hand a live session to Telegram, Discord, or Slack

What it does. Each rail card’s session menu can hand the live session to an approved messaging binding. The desktop tab becomes read-only until the user resolves it back (`send-to-messaging.component.ts` lines 37–57). Electron only (line 57). This is separate from starting a cron job or typing in a gateway chat.

Why it is unique. Claude Code, Cursor, and Copilot do not let you pick up a desktop session on your phone and lock the desktop composer while you do it. The README mentions gateways and approval relay, not this hand-off.

Evidence. `send-to-messaging.component.ts` 37–57; `canvas-rail-card.component.ts` 22 (import on the card).

Docs status. **Hidden** as a UI action. Gateway setup is documented under `automation/messaging/`.

Recency. The component is wired on the current rail card. This pass did not isolate the hand-off’s first commit. Treat recency of the control as **not dated here**; the rail that hosts it moved on 2026-11-02/03.

Marketing angle. “Start it on the desktop. Finish the approval on your phone.” Show the menu item, then the tab going read-only.

Maturity. **Shipped** on Electron, and only when a gateway binding exists (the control stays visible but disabled with a reason, lines 47–50).

### Sandboxed artifacts and a detachable display window

What it does. An agent reply can publish an artifact. The transcript shows a metadata card (title, time, open, fullscreen). The live iframe stays in the display panel, not in the transcript (`artifact-card.component.ts` lines 16–24). The panel can detach into its own window; actions and links go back to the main renderer, and links use an allowlist rather than `window.open` (`display-window.component.ts` lines 28–37).

Why it is unique. ChatGPT and Claude.ai artifacts are in the browser. A local coding agent that publishes a sandboxed HTML view beside the diff, then pops it into a second window, is not what Cursor’s editor preview or Copilot’s markdown do.

Evidence. `artifact-card.component.ts` 16–24; `display-window.component.ts` 28–37; commits `a1ebe203c` and `7aefb2bed` (2026-10-20, sandboxed artifacts) and `affc0a33f` (2026-10-30, detachable display sidebar).

Docs status. **Hidden.**

Recency. 2026-10-20 and 2026-10-30, inside the window.

Marketing angle. “The agent didn’t paste a screenshot. It handed you the page.” Open an artifact card, then detach the window.

Maturity. **Shipped** in the Electron renderer. The card does not embed the iframe itself; a broken surface stays in the panel.

### ptah-ui blocks inside chat

What it does. Assistant text can contain a `ptah-ui` fence. The transcript compiles it once and can bind live `$agents` and `$limits` (`ptah-ui.ts` lines 1–24; commit `24e882f14`, 2026-10-10). The same renderer family draws the Apps surfaces (`declarative-dashboard` `SurfaceRendererComponent`, `surface-renderer.component.ts` lines 1–36). Catalog `/4` adds accordion, avatar, trend, and sparkline without widening `/3` (`surface-catalog.ts` lines 15–19 and 68–71).

Why it is unique. Other coding chats render Markdown, Mermaid, and diffs. A fenced block that becomes a live stats card fed by the session’s own agents and limits is a product surface, not a diagram.

Evidence. `ptah-ui.ts` 1–24; `surface-catalog.ts` 15–19; `24e882f14`, `31904b890`, `cf913a15f` (all 2026-10-10).

Docs status. **Hidden.**

Recency. 2026-10-10 through follow-up display-panel fixes the same day (`b95078c73`).

Marketing angle. “The reply is a card you can read, not a wall of tokens.” Crop one fence that shows agent rows and a limit sparkline.

Maturity. **Shipped**, behind the fence grammar and the catalog. Malformed `/4` atoms fail closed (`b66148f4c`).

### Attention bell

What it does. The title bar has a notification button. The panel splits “Needs you” from “Recent notices.” A question, a permission, a failure, or a warning names the session, provider, and workspace. Permission rows use the shared attention actions, so the user can allow or deny without opening the session (`notification-center.component.ts` lines 24–70 and 113–115). Sound can be muted.

Why it is unique. IDE chat products toast inside the active thread. This bell is a cross-session, cross-workspace inbox for the moments an agent is stuck on a human. Cursor’s background agents notify, but they do not present a permission dialog for a session you are not looking at, in this form.

Evidence. `notification-center.component.ts` 24–70, 113–115. Introduced `c6b32da8e` (2026-10-19). Redesign `ef3a7ae7d` (2026-10-21). Tabless answers `67ab166ba` (2026-10-21).

Docs status. **Hidden.** Settings docs mention a save toast, which is a different notice.

Recency. 2026-10-19 to 2026-10-21.

Marketing angle. “Nine agents. One bell. Answer the one that’s stuck.” Show the badge, then Allow on a permission from another workspace.

Maturity. **Shipped.**

### Turn change-sets and turn summaries

What it does. When a turn ends, the transcript can show a change-set card: files added, modified, deleted, renamed, or conflicted, with line counts, and a reconciled state (`change-set-card.component.ts` lines 13–23). A separate chip summarizes the turn (files, tests, tokens, cost, duration) and can expand (`turn-recap.ts` lines 1–18; `turn-summary-chip.component.ts` lines 1–30).

Why it is unique. Everyone shows a diff if you open the editor. Pinning “this turn changed these files, tests did this, it cost this” on the message is closer to a commit trailer than to a token footer. Copilot and Cursor show edits in the editor, not as a per-turn card in the agent transcript.

Evidence. `change-set-card.component.ts` 13–23; `change-set.store.ts` 32–40 (silence after the grace window means no files); `turn-recap.ts` 1–18. Added `937fb4e91` (2026-10-02) and `4229545e1` (2026-10-10).

Docs status. **Hidden.** Cost docs list a per-message footer and an execution tree (`chat/cost-and-tokens.md` lines 14–20), not these cards.

Recency. Inside the five-week window.

Marketing angle. “Every reply ends with the diff, the tests, and the bill.” One expanded chip next to the file list.

Maturity. **Shipped.** A turn that changes nothing pushes no change-set (`change-set.store.ts` lines 33–36). Do not advertise a card on every message.

### Git review dock

What it does. Opening the git dock loads a review shell with four tabs: Changes, Commit, Task, History (`review-shell.component.ts` lines 51–57 and 93–108). Changes is a review canvas or a CodeMirror spot editor. If the turn ran in another worktree, the Changes tab is explicitly read-only and offers Back and Open as workspace (lines 97–101). Task shows branch, PR/CI, and worktrees (lines 104–106). History shows stashes and the branch’s commits (lines 107–108). A conflict banner sits above the tabs during merge, rebase, or cherry-pick (lines 86–87).

Why it is unique. The worktree story is the differentiator, and it is partly documented. The undocumented part is the dock itself: review a session’s worktree without switching the workspace, edit a file in place, and see PR state on a Task tab. Cursor’s source control and GitHub’s PR view are separate products; this dock is scoped to the agent session (`e983d5b5f`, 2026-10-30).

Evidence. `review-shell.component.ts` 75–108; `task-worktree-view.component.ts` 1–35 (PR status and worktree types). Session scope commit `e983d5b5f`. Auto-link of worktrees and tasks `bce1f3acc` (2026-11-03).

Docs status. **Under-emphasized.** `git/worktrees.md`, `git/diffs.md`, and `git/commits.md` exist. They do not describe the four-tab dock, the read-only foreign-worktree bar, or the spot editor. README line 95 says “Monaco diff view,” while this shell’s editor import is CodeMirror (`spot-editor.component.ts` line 40). Treat the Monaco claim as **likely stale** for this dock.

Recency. 2026-10-30 and 2026-11-03.

Marketing angle. “Review the agent’s branch without leaving yours.” Show the worktree scope bar and the Task tab’s PR row.

Maturity. **Shipped** as an Electron dock (dynamic import, `review-shell.component.ts` lines 78–79).

### Memory curator (Thoth → Memory)

What it does. Thoth’s Memory tab is Electron-only. VS Code and other hosts see a download prompt (`memory-curator-tab.component.ts` lines 73–92). On desktop the views are memories, timeline, corpus, code, and maintenance (lines 43–44). Code view can purge junk symbols from build folders and rebuild the index (lines 118–147). Copy says “Facts, events, and code Thoth has learned across sessions” (lines 113–115).

Why it is unique. Claude Code’s memory is a markdown file. Cursor’s memories are a settings list. A timeline plus a corpus you build, plus a code index you can clean, is a curator, not a bullet list. The landing page sells the search algorithm and skips this screen.

Evidence. `memory-curator-tab.component.ts` 43–44, 73–92, 113–147; `corpus-list.component.ts` 12–24 (corpus build and suggestions).

Docs status. **Under-emphasized.** `memory/*` documents search, pinning, and eviction, including corpus as a tier. It does not walk the five curator views.

Recency. The tab is older than five weeks (file history reaches the 2026-05 release squash). Clock-label polish `7c49d3345` (2026-10-30). Do not market it as new this month.

Marketing angle. “Feature ten still knows why feature one shipped.” Film the timeline, not a search box.

Maturity. **Shipped** on Electron. Absent on other hosts by design.

### Skills library actions (Thoth → Skills)

What it does. The Skills tab separates skills, agents, and commands into cards. Enhance now is disabled under a use threshold or during cooldown, previews a Monaco diff and a judge verdict, and writes only on Apply. Revert needs history. Rebase is hidden when there is no upstream. On desktop, agent cards show a chip per provider copy, a model section, Sync, and a quarantined-agents panel (`skill-clones-view.component.ts` lines 1–32). The tab is desktop-only in the same way Memory is (`skill-synthesis-tab.component.ts` lines 30–45).

Why it is unique. Claude Code skills are files you edit. This UI proposes an enhancement, shows the diff, and can refuse until the skill has been used enough. That loop is the product. Competitors do not judge a skill and offer Apply.

Evidence. `skill-clones-view.component.ts` 1–32; `skill-synthesis-tab.component.ts` 30–45.

Docs status. **Documented, lightly.** `skill-synthesis/the-skills-tab.mdx` and `how-it-works.mdx` describe Enhance now, preview, and revert. They are easy to miss next to the landing line “Auto-Learning Skills Curator.” Per-provider agent chips and quarantine are not in the README.

Recency. Full-width Thoth panels `ce95da1bf` (2026-10-19). The clones behavior comment is current source; this pass did not date the first clones commit.

Marketing angle. “It writes the skill only after you accept the diff.” Show the proposal, the judge line, and Apply.

Maturity. **Shipped** on Electron. Enhancement is manual and can be paused. Do not say skills appear by themselves.

### Provider plan limits in the session

What it does. Session stats can show a provider’s plan windows (for example Codex usage), with more than one window, an owner, and a message (`provider-lane-limit-tile.component.ts` lines 10–35). Agent run details were split from those limits (`e9269c529`, 2026-11-03). Codex limits specifically: `ad4a69013` (2026-11-02).

Why it is unique. Cost tracking is common. Showing the vendor’s own plan window (what the account has left, not what this chat spent) inside the coding session is how you avoid a surprise cutoff mid-refactor. Copilot shows a quota in its own account UI, not beside the agent that is about to spend it.

Evidence. `provider-lane-limit-tile.component.ts` 10–35; commits `ad4a69013`, `e9269c529`, `705fdef46` (2026-10-30, “steady stats tiles and plan limits”).

Docs status. **Hidden** relative to plan windows. `chat/cost-and-tokens.md` documents tokens and USD, not vendor plan windows.

Recency. 2026-10-30 through 2026-11-03.

Marketing angle. “See the plan run out before the agent does.” Crop a Codex window tile next to the session cost.

Maturity. **Shipped** where the provider reports a window. A provider with no window should not be drawn as a fake meter; the component renders `provider().message` and only the tiles it is given.

### Question cards

What it does. When an agent asks the user a structured question, the transcript shows one step at a time, single- or multi-select, with a countdown (`question-card.component.ts` lines 26–38). The bell can answer the same kind of item (`notification-center.component.ts` lines 113–115).

Why it is unique. Claude Code’s question tool is a terminal prompt. A stepped card plus a bell that works while you are on another session is a desktop pattern. Cursor’s questions stay in the chat you have focused.

Evidence. `question-card.component.ts` 26–38; `notification-center.component.ts` 113–115.

Docs status. **Hidden** as UI. Setup docs mention answering questions in the team-builder transcript.

Recency. Countdown moved onto the shared wall clock `58b2b997d` (2026-10-30). The card itself is older than that commit message implies; treat the clock change as the dated enhancement.

Marketing angle. “It asks one question, with a clock, and you can answer from the bell.”

Maturity. **Shipped.**

### Lane result cards

What it does. When an agent message reports files it wrote, the transcript renders a card with a verdict pill (approved, revision, rejected, or neutral). Color is never the only signal (`lane-result-card.component.ts` lines 24–34).

Why it is unique. A visible verdict on the files a delegated lane claims to have written matches Ptah’s multi-model review pitch. A normal coding chat shows the text and, if you are lucky, a diff. It does not stamp the lane’s own verdict on the card.

Evidence. `lane-result-card.component.ts` 24–34.

Docs status. **Hidden.**

Recency. Not isolated to a first-add commit in this pass. Present in the current chat-ui barrel (`chat-ui/src/index.ts` lines 44–51).

Marketing angle. “The reviewer lane doesn’t bury the verdict in prose.” Show an approved pill and a file list.

Maturity. **Shipped** as a presentational card. It parses a lane result; it does not itself decide the verdict.

### Background-agent strip and steer

What it does. A strip lists background agents as running, background, completed, error, or stopped, and can open a steer box (`background-agent-strip.component.ts` lines 26–40, importing `AgentSteerInputComponent`). The rail and Command Center also surface child work.

Why it is unique. Steering a running sub-agent from the desktop, without opening its whole transcript, is the UI for the orchestration README already claims. The strip is the picture; the README only has the sentence.

Evidence. `background-agent-strip.component.ts` 26–40; `chat-ui/src/index.ts` 54–61.

Docs status. **Under-emphasized.** Agent docs describe `steer` as a tool mode. They do not show this strip.

Recency. Not dated to a single commit here. The rail that hosts related agent UI was updated 2026-11-02/03.

Marketing angle. “Type into the agent that’s already running.” One strip row expanding into the steer field.

Maturity. **Shipped** as UI. Whether every runtime accepts a steer is a backend question this lane did not re-prove.

### Automatic session hand-off when context fills

What it does. A session can hand off to a continuation tab. The new tab is adopted onto the canvas, and an automatic hand-off can close the source only after adoption succeeds (`agent-session-adoption.service.ts` lines 303–316). A 2026-11-03 fix fires that hand-off for every open tab, not one (`b660a7525`).

Why it is unique. Long-context products either truncate or start a fresh chat you must re-brief. Opening the continuation as a real session tile, and only then closing the source, is a desktop behavior. Confirm the user-facing switch in a screenshot before a campaign claims it is one click.

Evidence. `agent-session-adoption.service.ts` 303–316; commit `b660a7525` (2026-11-03).

Docs status. **Hidden** in the UX sense. This pass did not find a docs page for the continuation tile.

Recency. 2026-11-03 for the all-tabs fix. The adoption path cites TASK_2026_655 and TASK_2026_863 in comments.

Marketing angle. “The chat continues in a new session instead of forgetting the first half.” Show two rail cards, source then continuation.

Maturity. **Shipped** as adoption logic. The setting `sessionBudget.closeSourceAfterAutoHandoff` means the close is conditional. Do not say every full context always closes the old tab.

### Onboarding and setup hub

What it does. First Electron launch can redirect to `/onboarding/ready` (`app.routes.ts` lines 86–88). The flow covers connection, settings, workspace analysis, choosing and generating agents, project guidance, a new-project intake, and a team builder (`onboarding.routes.ts` lines 31–100). The title bar Setup tab opens that hub (`electron-shell.component.ts` lines 300–320). A 2026-11-01 change lets onboarding pick the workspace folder (`ccf65a321`). Legacy setup surfaces were removed the same day (`247d11464`).

Why it is unique. The “scan the repo, then generate the team” story is already the README’s setup section and has docs plus video clips. It is not hidden. It is the onboarding the landing page never shows as screens.

Evidence. `app.routes.ts` 86–88 and 98–104; `onboarding.routes.ts` 31–100; `electron-shell.component.ts` 300–320.

Docs status. **Documented** (`setup/*`, README lines 88–89 and 124). Landing does not show the steps.

Recency. Cutover `01f9f88c8` (2026-10-31), first-run route `7afaad78b` (2026-10-29), folder picker `ccf65a321` (2026-11-01).

Marketing angle. Already has clips in the README table. A still of “Choose agents” after analysis is enough. Do not present it as undiscovered.

Maturity. **Shipped.**

### Tasks board, with sessions linked to tasks

What it does. `/tasks` is a board over `.ptah/specs/` with statuses backlog, in progress, in review, blocked, done, and cancelled (`task-spec.types.ts` lines 13–20). The UI adds bulk actions, a command palette, relations, and filters (`tasks-ui/src/index.ts` lines 15–34). Sessions can auto-link to tasks (`20a685364`, 2026-10-30; `bce1f3acc`, 2026-11-03).

Why it is unique. A Kanban whose cards are markdown folders you can commit is unusual next to Jira-shaped agent UIs. The docs already say this. The new part is the link from a live session to that folder.

Evidence. `task-spec.types.ts` 13–20; `tasks/index.md` lines 1–8; `tasks-ui/src/index.ts` 15–34; commits above.

Docs status. **Documented** for the board (`tasks/index.md`). Auto-link is **under-emphasized** (not in that page’s opening).

Recency. Auto-link commits 2026-10-30 and 2026-11-03. The board itself is older.

Marketing angle. “The task is a folder. The session knows which one.” Show a rail card and the task id together.

Maturity. **Shipped.** Folders without `task.md` are excluded (`task-spec.types.ts` lines 8–10). Do not imply every markdown file becomes a card.

### Marketplace install scope and harness health

What it does. Installing a skill or MCP server asks for a scope (project vs global) (`0ed598683`, `b2ebf0953`, `088341e3b`, all 2026-11-01). Marketplace routes cover overview, connectors, Smithery, the MCP registry, a custom URL, installed servers, and skills from Ptah plugins, community, or marketplaces (`marketplace.routes.ts` lines 5–20). Harness health is a badge with blocked paths and a repair dialog (`marketplace/src/index.ts` lines 16–28; `harness-health-badge.component.ts` lines 1–24).

Why it is unique. Scope-on-install plus a harness that reconciles agents into other tools’ folders is the “one config, many CLIs” pitch. README line 93 already says harness sync. The scope field and the blocked-path repair dialog are the screens that pitch lacks.

Evidence. `marketplace.routes.ts` 5–20; `marketplace/src/index.ts` 16–28; commits `0ed598683`, `b2ebf0953`.

Docs status. **Under-emphasized.** `marketplace/*` and `plugins/*` exist. Install scope is new relative to those pages (this pass did not re-read every marketplace page for the word “scope”).

Recency. 2026-11-01.

Marketing angle. “Install it for this repo, or for every repo. See when a harness file is blocked.” Show the scope control and a blocked-path row.

Maturity. **Shipped.**

### Motion scenes

What it does. Electron has motion presets (fade, rise, slide, scale, direction-aware) with a live preview chip (`motion-style-picker.component.ts` lines 4–11). The same week dropped the dark theme and added pyramid and temple glass scenes, then made pyramid the default (`1d8f10e2e`, `753bbc19c`, 2026-11-01). Command Center glass rail: `d9fe941d0` (2026-10-28).

Why it is unique. This is brand, not capability. Cursor and Copilot themes do not ship a “pyramid” glass scene as the product default. Useful in a launch film, weak as a feature claim.

Evidence. `motion-style-picker.component.ts` 4–11; commits `f8023a2b8`, `cb494d5ff`, `1d8f10e2e`, `753bbc19c`.

Docs status. **Under-emphasized.** `settings/theme.md` exists; this pass did not re-read it for pyramid/temple. README and landing do not name the scenes.

Recency. 2026-11-01.

Marketing angle. Use pyramid glass as the background of every screenshot. Do not lead a post with “we added transitions.”

Maturity. **Shipped.**

### Report an AI response

What it does. A flag on an assistant message opens a `mailto:help@ptah.live` draft. The user reviews it before send. Excerpt is capped at 1000 characters (`report-response-button.component.ts` lines 11–27). Comment cites Microsoft Store policy 11.16.

Why it is unique. It is a store-compliance control, not a differentiator versus Cursor. Mention only if the campaign needs a trust line.

Evidence. `report-response-button.component.ts` 11–27. Added `c5d039d4e` (2026-10-19).

Docs status. **Hidden.**

Recency. 2026-10-19.

Marketing angle. Skip, unless a store listing needs “report a bad answer.”

Maturity. **Shipped.** Nothing is sent until the mail client sends.

### Composer folds while the agent streams

What it does. While a turn streams, the composer collapses to a bar and a single Stop control (`798182b41`, `5f48cfa17`, 2026-11-01).

Why it is unique. It is polish. Claude.ai and ChatGPT do similar things. Not a campaign feature.

Evidence. Commit messages only, plus the chat-ui composer exports. This pass did not re-read the fold component.

Docs status. **Hidden.**

Recency. 2026-11-01.

Marketing angle. None as a headline.

Maturity. **Shipped** per the commit messages. Behavior was not re-read in the component, so do not script a shot from this line alone.

### Workspace indexing panel

What it does. A panel inside Memory’s code area shows indexing states: never-indexed, indexing, paused, indexed, stale, error, plus loading and no-workspace, and per-pipeline toggles (`workspace-indexing.component.ts` lines 1–14).

Why it is unique. The README already claims indexing. The panel is how a user sees that the index is stale instead of guessing. Competitors hide this behind a status bar.

Evidence. `workspace-indexing.component.ts` 1–14; imported by `memory-curator-tab.component.ts` lines 18–20.

Docs status. **Under-emphasized.** `workspace/workspace-intelligence.md` exists. The six states are not in the README.

Recency. Clock refactor `9b524f5d7` (2026-10-30). The panel is older.

Marketing angle. Optional B-roll: “Indexed” versus “Stale” before a question. Do not lead with it.

Maturity. **Shipped.**

### Analytics tab

What it does. The title bar **Analytics** tab (`electron-shell.component.ts` lines 287–297) mounts `DashboardGridComponent` on `/analytics` (`app.routes.ts` lines 113–118). The dashboard library exports usage, builders, skill selection, and provider account cards (`dashboard/src/index.ts` lines 1–25).

Why it is unique. Cost docs already cover session totals. A full analytics surface is table stakes next to Cursor’s usage page. Include it so marketing does not rediscover it as new.

Evidence. `electron-shell.component.ts` 287–297; `app.routes.ts` 113–118; `dashboard/src/index.ts` 1–25.

Docs status. **Documented** (`sessions/analytics.md`, `sessions/cost-summary.md`, README line 96).

Recency. Not treated as new. Plugin notices in a panel landed `4deb82d0c` (2026-10-31), which is a small addition.

Marketing angle. Already covered by “cost and token tracking.” Pair it with plan-limit tiles (feature above) if you need a fresh frame.

Maturity. **Shipped.**

### Thoth hub (Memory, Skills, Schedules, Messaging)

What it does. `/thoth/:tab` hosts four tabs: memory, skills, cron, gateway (`thoth-shell.component.ts` lines 46–47 and 71–75). README line 125 already tells the user to open Thoth. Each tab has its own docs tree.

Why it is unique. The hub is the container. The hidden value is inside Memory, Skills, and the Voice/Apps tabs, not the word Thoth.

Evidence. `thoth-shell.component.ts` 46–75; `app.routes.ts` 120–129.

Docs status. **Documented** as the place to configure memory, schedules, and gateways (README line 125; `automation/*`, `memory/*`, `skill-synthesis/*`).

Recency. Panel layout `ce95da1bf` (2026-10-19).

Marketing angle. Use “Thoth” only if the brand wants the name. Otherwise say Memory, Skills, Schedules, and Messaging.

Maturity. **Shipped.** Memory and Skills bodies refuse non-Electron hosts (see those features).

## Table

| Feature | Docs status | Maturity | Wow |
| --- | --- | --- | --- |
| Voice stage (Command Center) | hidden | shipped; voice needs STT and TTS | 5 |
| Apps page (agent-built surfaces) | hidden | shipped, Electron only | 5 |
| Hand session to a messaging app | hidden | shipped, Electron, needs a binding | 5 |
| Session rail (replaces the grid) | documented, copy is wrong | shipped | 4 |
| Detachable display and HTML artifacts | hidden | shipped | 4 |
| ptah-ui fences in chat | hidden | shipped, closed catalog | 4 |
| Attention bell | hidden | shipped | 4 |
| Turn change-set and turn summary | hidden | shipped; empty turns have no change-set | 4 |
| Git review dock and worktree scope | under-emphasized | shipped, Electron dock | 4 |
| Memory curator views | under-emphasized | shipped, Electron only | 3 |
| Skills enhance / diff / quarantine | documented, easy to miss | shipped, Electron only | 3 |
| Provider plan-limit windows | hidden | shipped when the provider reports one | 3 |
| Question cards | hidden | shipped | 3 |
| Lane result verdict cards | hidden | shipped | 3 |
| Background-agent strip and steer | under-emphasized | shipped UI | 3 |
| Auto continuation when context fills | hidden | shipped; source close is conditional | 3 |
| Onboarding / setup hub | documented | shipped | 3 |
| Tasks board and session auto-link | documented; auto-link under-emphasized | shipped | 3 |
| Marketplace install scope and harness health | under-emphasized | shipped | 3 |
| Motion scenes (pyramid / temple) | under-emphasized | shipped | 2 |
| Report an AI response | hidden | shipped | 1 |
| Composer fold while streaming | hidden | shipped (commit-level; component not re-read) | 1 |
| Workspace indexing states | under-emphasized | shipped | 2 |
| Analytics tab | documented | shipped | 2 |
| Thoth hub shell | documented | shipped | 2 |

## Decisions

- Decision: treat the drag-and-resize Orchestra Canvas as a stale claim, and describe the rail as the product. Options: (a) trust README and canvas docs, (b) trust `orchestra-canvas.component.ts`. Evidence: that file says the rail is the only board and a legacy grid renders as rail (lines 51–54), while docs still say drag and resize. Reversible: yes, if a grid mode is reintroduced later.
- Decision: call a feature **hidden** only when README, landing sections, and docs pages do not name the user-facing surface. Features with a docs page but no landing or README emphasis are **under-emphasized**. Options: hide anything absent from the landing page, including cron and memory. Evidence: the task asked for undocumented or weakly mentioned features, and cron, memory, tribunal, and tasks already have docs. Reversible: yes.
- Decision: market the Voice tab by its title-bar label, and mention Command Center as the internal name. Options: lead with “Command Center.” Evidence: the button’s accessible name is “Voice” (`electron-shell.component.ts` lines 256–261). Reversible: yes.
- Decision: not to flag the tree-sitter language list or the MIT/no-account pricing line as false. Options: mark both stale because a license server and extra grammars exist somewhere in the repo. Evidence: this lane did not read the indexer or the license UI. Reversible: yes, after those lanes report.
- Decision: keep Tribunal in the docs-gap as a risk, not as a deleted product. Options: say Tribunal is gone because the page was retired. Evidence: `dea55817c` retires a page; README and `docs/tribunal/*` still describe a chat skill. Reversible: yes.

## Open questions

- Does the chat Tribunal skill still run after `dea55817c` removed the Tribunal page? The frontend page is gone; the skill was not executed here.
- Is an account or license required for the desktop app? The landing hero says no account and no license key (`hero.component.ts` lines 56–73). Docs include `getting-started/signing-in.md` and `troubleshooting/license-issues.mdx`. This lane did not open the auth flow.
- Is the README’s “Monaco diff view” (`README.md` line 95) still true anywhere, or has the Electron dock fully moved to CodeMirror (`spot-editor.component.ts` line 40)?
- Which title-bar or menu control opens Thoth and Marketplace? They are routed (`app.routes.ts` lines 120–139) but were not in the title-bar tab strip that was read (Chat, Voice, Apps, Tasks, Analytics, Setup).
- Should campaigns show pyramid glass as the default scene (`753bbc19c`)? Confirm the setting default in the theme store before printing “the new look” on a still that might be temple or a user override.
