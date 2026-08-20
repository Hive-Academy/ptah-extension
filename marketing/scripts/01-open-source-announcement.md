# Script 01 — Meet Ptah (Open Source)

**Mode:** `talking-head` — you on camera throughout, with graphics layered over the top
**Runs:** ~3:15 as written. The three blocks marked ✂ are optional cuts → ~2:35.
**Synopsis:** Why Ptah exists (your experience, encoded and installable), what it does, how it's built, and where a contributor lands their first PR.

---

## How to read this

- **`/`** — breathe. Don't stop the take, just let the sentence land.
- **`—— STOP ——`** — full stop. Drop your hands, reset, start the next block fresh. **These are cut points**: if you fluff a block, only re-record that block.
- Every block is 10–20 seconds. You never have to hold more than one idea in your head.
- The **bold line** under each block is the point of it. Hit that and the take is good, even if your words drift. Your words beat mine.
- The `[…]` markers are for the editor, not for you. Ignore them while recording — full plan in **Visual layer** below.

---

## THE NARRATION

### 1 — Open

> Hey. / I'm Abdallah. /
> I want to show you something I've been building for a while. /
> And I'll be honest with you up front — / it's big. /
> So let me walk you through it slowly.

**Point: give yourself permission to take your time. This block makes the rest easy.**

—— STOP ——

### 2 — What it is

> It's called Ptah. /
> It's an AI coding orchestra. /
> It's MIT licensed, / and all of it is on GitHub.

**Point: name, category, license.**

—— STOP ——

### 3 — Where it came from

> Here's where it came from. /
> I've spent years building Nx monorepos. /
> Angular on the front, / NestJS on the back. /
> Multi-tenant SaaS. / Domain-driven design. /
> And every coding agent I picked up was good at writing code — /
> but it knew nothing about how I actually build things. /
> I was explaining the same architecture / over / and over / and over.

**Point: the frustration. This is your story — tell it, don't recite it.**

—— STOP ——

### 4 — The turn

> So at some point I stopped explaining / and started encoding. /
> And that's really what Ptah is.

**Point: the hinge of the whole video. Slow down. Let it sit. Nothing covers your face here.**

—— STOP ——

### 5 — Skills that ship

> Ptah ships twenty-four skills / and fifteen agent templates. /
> You open the installer, / pick the ones you want, /
> and it pulls them down and wires them into your workspace. /
> And they're not prompts I found somewhere. / They're the way I work. /
> How to structure an Nx workspace. /
> How to lay out a NestJS backend. /
> How to model a domain properly. /
> How multi-tenancy actually behaves / once you have to ship it.

**Point: your expertise is a thing you can install. Show the modal here.**

—— STOP ——

### 6 — The wizard reads your codebase

> And it doesn't hand you generic agents. /
> There's a setup wizard, / and the first thing it does is read your codebase. /
> Four passes: / what the project is, / how it's built, /
> where it's weak, / and what to do about it. /
> Then it writes your subagents / against what it actually found. /
> So they know your architecture / before you've said a word.

**Point: this is the differentiator. Nobody else grounds the agents in a real scan.**

—— STOP ——

### 7 — A team with roles

> And those subagents orchestrate. /
> A team leader that breaks work into batches. /
> An architect. /
> Reviewers that check logic / and style / as separate passes. /
> It's not one assistant doing everything badly. / It's a team with roles.

**Point: "a team with roles" is the line. Land it.**

—— STOP ——

### 8 — Three runtimes

> All of that runs in three places / off one shared core. /
> A VS Code extension. /
> An Electron desktop app. /
> And a CLI — / which goes both ways: /
> headless when a script is driving it, /
> or a full terminal UI when you are.

**Point: one core, three surfaces.**

—— STOP ——

### 9 — The canvas

> On the canvas you can run nine agents at once / on the same codebase. /
> Different sessions. / Different models. / One workspace. /
> And you can put a different provider behind each one.

**Point: nine, in parallel, provider-switchable. The money shot — full-screen here.**

—— STOP ——

### 10 — Memory

> It has a memory that persists. /
> Not per session — / across all of them. /
> So the thing you explained on Tuesday / is still true on Friday.

**Point: memory survives sessions.**

—— STOP ——

### 11 — It learns from you

> And it learns from work you've already finished. /
> You complete a task, / it pulls out the trajectory, /
> and it writes the reusable version of what you just did. /
> So over time it gets more like you. / Not more like everybody.

**Point: best line in the script. Face only — no graphics. Land it, then stop.**

—— STOP ——

### 12 — Reach ✂ _(optional cut)_

> You can put agents on cron / and let them run overnight. /
> And you can drive the whole thing from Telegram, / Discord, / or Slack /
> when you're away from your machine.

**Point: it doesn't stop when you close the laptop.**

—— STOP ——

### 13 — Turn to the codebase

> Now — / the part I actually want to talk about. /
> The codebase itself.

**Point: a gear change. Pause before "the codebase itself."**

—— STOP ——

### 14 — The core

> It's an Nx monorepo. /
> Around fifty libraries. /
> TypeScript strict all the way through. /
> Built hexagonal. /
> And there's one library — / `platform-core` — /
> that defines twenty-two port interfaces / and nothing else. /
> Everything imports it. / It imports nothing.

**Point: "Everything imports it. It imports nothing." Two beats, not one sentence.**

—— STOP ——

### 15 — The adapters

> Then three adapter families implement those ports. /
> One for VS Code. / One for Electron. / One for the CLI. /
> That's why one feature lands in all three at once. /
> And it's why a fourth runtime / is a fourth adapter family — /
> not a pile of if-statements inside the existing three.

**Point: the payoff of hexagonal.**

—— STOP ——

### 16 — Doors in

> So if you want to contribute, /
> there are doors that don't ask you to learn all of it first. /
> Skills and agent templates are markdown. / Adding one is a file, / not an architecture change.

**Point: contributing isn't gated on understanding the whole system.**

—— STOP ——

### 17 — More doors ✂ _(optional cut)_

> The gateway speaks Telegram, Discord and Slack. /
> A fourth platform is an adapter / against an interface that already exists. /
> And if you use a coding agent we don't support yet, /
> the provider layer is one interface wide.

**Point: two more concrete entry points.**

—— STOP ——

### 18 — The easiest door

> The terminal UI is probably the easiest place to start. /
> It's Ink and React. / It only talks to two libraries. /
> And everything you change / shows up on screen immediately.

**Point: name the single best first contribution.**

—— STOP ——

### 19 — Close

> So — / clone it. / Run it. / Tell me where it breaks. /
> Issues and pull requests are both open. / Links are below.

**Point: warm, direct ask. Look straight down the lens.**

---

## Visual layer

**The rule:** graphics carry facts, your face carries feeling. Blocks **3, 4, 11 and 19** stay clean — nothing covers you there. Everywhere else, something is on screen.

`pip` keeps you visible in frame while the app plays in a corner. `full` replaces the frame — use it only where the visual _is_ the point, and keep it short.

| Block | Beat                                  | Asset              | Source  |
| ----- | ------------------------------------- | ------------------ | ------- |
| 1     | `lower-third` — name / title          | —                  | —       |
| 2     | `keyword` "MIT licensed"              | —                  | —       |
| 3     | **clean — face only**                 | —                  | —       |
| 4     | **clean — face only**                 | —                  | —       |
| 5     | `broll pip` + `stat` 24 / 15          | `skill-installer`  | capture |
| 6     | `broll pip` + `stat` 4 passes         | `wizard-scan`      | capture |
| 7     | `broll pip`                           | `subagent-roles`   | scene   |
| 8     | `broll full` ~3s                      | `runtime-trio`     | scene   |
| 9     | `broll full` ~5s + `stat` 9 agents    | `canvas-orchestra` | capture |
| 10    | `broll pip`                           | `memory-recall`    | capture |
| 11    | **clean — face only**                 | —                  | —       |
| 12    | `broll pip`                           | `gateway-tour`     | capture |
| 13    | `keyword` "codebase"                  | —                  | —       |
| 14    | `broll full` ~4s + `stat` 22 / 3      | `hexagon-core`     | scene   |
| 15    | `broll full` ~4s, `zoom` on cols      | `adapter-families` | scene   |
| 16    | `keyword` "contribute"                | —                  | —       |
| 17    | `keyword` "gateway"                   | —                  | —       |
| 18    | `broll pip` + `keyword` "Ink + React" | `tui-live`         | capture |
| 19    | `lower-third` repeat + end card       | —                  | —       |

### Assets to make

**Six screen captures** (real app, straightforward): `skill-installer` (the install modal, picking and installing), `wizard-scan` (the four phases streaming), `canvas-orchestra` (nine tiles working), `memory-recall`, `gateway-tour`, `tui-live`.

**Three authored Remotion scenes** (start from `src/concept/`): `subagent-roles` (team-leader → architect → reviewers, from `scene-kit`), `runtime-trio` (one core → three surfaces, from `GlassCoreScene`), `hexagon-core` + `adapter-families` (from `DyadArchitecture`).

> [!IMPORTANT]
> **`full` cutaways hide captions and chips.** `FullBrollLayer` renders above both (`src/selfshot/Shell.tsx:61-65`), so during a full-frame cutaway the word-timed captions and any `stat`/`keyword` chip disappear. That's why the table uses `pip` almost everywhere and keeps `full` to 3–5 second punches on blocks 8, 9, 14 and 15 — and why those four scenes need their numbers baked into the artwork.
>
> If you'd rather have captions across everything, move `<FullBrollLayer>` above `<LowerThird>` in `Shell.tsx`. One-line reorder, but it inverts a deliberate comment — decide it on purpose.

---

## Delivery notes

- **Blocks are cut points, not takes.** Roll continuously if it's going well — the stops exist so a fluff costs you fifteen seconds, not the video.
- **Your pace ran ~175 wpm last time.** Aim slower. Use every `/`.
- **Blocks 3, 4, 11 and 19 are the warm ones.** Don't rush them to get to the facts — the facts are the easy part, and those four are the only places your face is doing the work alone.
- **Numbers to say deliberately:** "twenty-four skills", "fifteen agent templates", "four passes", "nine agents", "around fifty libraries", "twenty-two port interfaces". Say "around" for the library count — it moves.
- Hold ~2s of silence before block 1 — the lower-third needs calm footage to land on.
- **Before rolling:** the mic sits dead centre under your chin and the boom cuts through the right third — re-rig it out of frame or use a lav. Your face is also dimmer than the orange wall behind you; add a key light or move off that background.

---

## Pipeline notes

Keyword chips anchor on the **first word** of the keyword at its **first occurrence in the whole transcript** (`scripts/selfshot-draft-beats.mjs:35-39, 86-92`), so anchors must be rare words.

| Keyword      | Anchors on   | Lands at                     | Fix                           |
| ------------ | ------------ | ---------------------------- | ----------------------------- |
| `MIT`        | "MIT"        | block 2                      | —                             |
| `codebase`   | "codebase"   | ⚠️ block 6 ("your codebase") | edit to `occurrence: 3`       |
| `hexagonal`  | "hexagonal"  | block 14                     | —                             |
| `contribute` | "contribute" | block 16                     | —                             |
| `gateway`    | "gateway"    | block 17                     | —                             |
| `Ink`        | "Ink"        | block 18                     | retitle chip to "Ink + React" |
| `pull`       | "pull"       | block 19                     | —                             |

```bash
npm run selfshot:draft -- --slug 01-open-source-announcement \
  --keywords "MIT,codebase,hexagonal,contribute,gateway,Ink,pull" \
  --title "Abdallah Khalil" --subtitle "Founder, Ptah"
```

- **`codebase` needs a hand-edit.** You now say it in block 6 ("read your codebase") and block 9 ("the same codebase") before block 13, where the chip belongs. Set `{ "word": "codebase", "occurrence": 3 }`.
- **`stat` and `broll` beats are hand-added** — the draft tool emits neither. Stats: `24 skills / 15 agent templates` (5), `4 passes / over your codebase` (6), `9 agents / in parallel` (9), `22 ports / 3 adapter families` (14).

---

## Fact check (verified 2026-08-08)

| Claim                               | Source                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIT licensed                        | `LICENSE.md`                                                                                                                                                                                                                                                                       |
| **Ptah ships + installs skills**    | Plugins download from GitHub → `~/.ptah/plugins/` (`libs/backend/platform-core/src/content-download.service.ts`); `SkillJunctionService` junctions each plugin's `skills/` into `{workspace}/.claude/skills/` (`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts`) |
| **Skills marketplace surface**      | `skillsSh:search / install / uninstall / listInstalled / getPopular / detectRecommended` (`libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`); install service at `harness/io/harness-skill-install.service.ts`                                                |
| **24 skills**                       | `.claude/skills/` — incl. `ddd-architecture`, `nestjs-backend-patterns`, `nx-workspace-architect`, `saas-platform-patterns`, `angular-frontend-patterns`                                                                                                                           |
| **15 agent templates**              | `libs/backend/agent-generation/templates/agents/*.template.md`                                                                                                                                                                                                                     |
| **Wizard scans the codebase**       | `MultiPhaseAnalysisService` — 4 sequential LLM phases: project profile, architecture assessment, quality audit, elevation plan; writes `.ptah/analysis/{slug}/` (`libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`)                          |
| **Subagents written from the scan** | `AgenticAnalysisService` → `AgentRecommendationService` → `AgentCustomizationService` → `AgentFileWriterService` (`libs/backend/agent-generation/src/lib/services/`)                                                                                                               |
| **Subagent roles named**            | `team-leader`, `software-architect`, `code-logic-reviewer`, `code-style-reviewer` templates                                                                                                                                                                                        |
| 3 runtimes off one core             | `libs/backend/platform-{vscode,electron,cli}`                                                                                                                                                                                                                                      |
| CLI is headless **and** a TUI       | `apps/ptah-cli/src/cli/router.ts:2292` (`ptah tui`); `apps/ptah-tui` builds to `tui.mjs` inside the published `@hive-academy/ptah-cli`                                                                                                                                             |
| TUI is Ink + React, 2 deps          | `apps/ptah-tui/package.json`; `scope:cli`, consumes `cli-engine` + `shared` only                                                                                                                                                                                                   |
| 9 agents on the canvas              | `libs/frontend/canvas/src/lib/canvas.store.ts:66` (`MAX_TILES = 9`)                                                                                                                                                                                                                |
| ~50 libraries                       | 25 under `libs/backend/`, 25 under `libs/frontend/`                                                                                                                                                                                                                                |
| 22 port interfaces                  | `libs/backend/platform-core/src/di/tokens.ts` (`PLATFORM_TOKENS`)                                                                                                                                                                                                                  |
| Telegram / Discord / Slack          | `libs/backend/messaging-gateway`                                                                                                                                                                                                                                                   |

> `CLAUDE.md` and `apps/ptah-video-studio/docs/feature-knowledge-base.md` still say **16 ports** and **16/21 libs** — stale. Counts above are from today's tree.

---

## YouTube metadata

**Title:** Ptah — an open source AI coding orchestra (and how it's built)

**Description:**

```
Ptah is an MIT-licensed AI coding orchestra that runs as a VS Code extension, an Electron desktop app, and a CLI that works headless over JSON-RPC or as a full interactive terminal UI — all off one shared core.

I spent years building Nx monorepos — Angular front, NestJS back, multi-tenant SaaS, domain-driven design — and got tired of explaining the same architecture to every coding agent I picked up. So I encoded it. Ptah ships 24 installable skills and 15 agent templates covering Nx workspace structure, NestJS backends, domain modelling and multi-tenancy — and its setup wizard reads your codebase in four passes before it writes your subagents, so they know your architecture before you've said a word.

In this video: where it came from, what it does (9 agents in parallel on one codebase, persistent memory, skills learned from finished work, cron-scheduled agents, and a Telegram/Discord/Slack gateway), how the codebase is structured (Nx monorepo, hexagonal, 22 ports and 3 adapter families), and where to land a first contribution.

⭐ Star the repo: https://github.com/Hive-Academy/ptah-extension
🐛 Open issues: https://github.com/Hive-Academy/ptah-extension/issues
📚 Docs: https://docs.ptah.live
▶ More Ptah tours: [PLAYLIST_LINK]
💬 Community: [DISCORD_LINK]
🌐 https://ptah.live
```

**Tags:** ptah, open source ai, ai coding orchestra, ai agents, hexagonal architecture, nx monorepo, nestjs, angular, domain driven design, typescript, open source contribution, ai coding assistant
