# Script 01 — Meet Ptah (Open Source)

**Mode:** `talking-head`
**Target duration:** 120–140s
**Synopsis:** An introduction to Ptah as an open-source AI coding orchestra — what it does, how the codebase is built, and where a contributor can land their first PR. No license history, no pricing pitch.

---

Ptah is an AI coding orchestra. It's MIT licensed, the whole thing is on GitHub, and it runs in three places off one shared core: a VS Code extension, an Electron desktop app, and a CLI — and that CLI goes both ways, headless over JSON-RPC when a script is driving it, or a full interactive terminal UI when you are.

[lower-third: title="Abdallah Khalil", subtitle="Founder, Ptah"]
[keyword: MIT licensed]

Here's what it actually does. The orchestra canvas runs up to nine agents side by side on the same codebase — separate sessions, separate models if you want, one workspace.

[b-roll: canvas-orchestra — while saying "orchestra canvas"]
[stat-card: 9 agents / in parallel]

It has a persistent memory that survives every session, so the thing you explained on Tuesday is still true on Friday.

[b-roll: memory-recall — while saying "persistent memory"]

It learns skills from finished work — you complete a task, it extracts the trajectory and writes the reusable version. You can schedule agents to run overnight on cron, and drive all of it from Telegram, Discord, or Slack when you're away from the machine.

[b-roll: gateway-tour — while saying "Telegram, Discord, or Slack"]

Now the part I actually want to talk about, which is the codebase.

[keyword: codebase]

Ptah is an Nx monorepo — around fifty libraries, TypeScript strict throughout, built hexagonal. There's one library, `platform-core`, that defines twenty-two port interfaces and nothing else. Everything imports it; it imports nothing. Then three adapter families implement those ports — one for VS Code, one for Electron, one for the CLI.

[keyword: hexagonal]
[stat-card: 22 ports / 3 adapter families]

That's why the same feature lands in all three runtimes at once. And it means adding a fourth runtime is a fourth adapter family, not a pile of if-statements inside the existing three. If you've ever wanted to see that pattern at production scale instead of in a blog post diagram, the repo is a decent place to look.

[keyword: fourth runtime]

So if you want to contribute, there are a few doors that don't require you to learn the whole system first.

[keyword: contribute]

Skills and agent templates are markdown — there are fifteen agent templates in the repo right now, and adding one is a file, not an architecture change. The messaging gateway currently speaks Telegram, Discord, and Slack; a fourth platform is an adapter against an interface that already exists. And if you use a coding CLI we don't support yet, the provider layer is one interface wide.

[stat-card: 15 agent templates / on disk]

The terminal UI is probably the easiest place to start. It's Ink and React, it only talks to two libraries, and every change you make shows up on screen immediately.

[keyword: Ink + React]

Clone it, run it, and tell me where it breaks. Issues and pull requests are both open, links are below.

[keyword: pull requests]

---

## Recording notes

- **How anchoring actually works** — the draft tool takes the **first word** of each keyword and anchors the chip to that word's **first occurrence anywhere in the transcript**, always `occurrence: 1` (`scripts/selfshot-draft-beats.mjs:35-39, 86-92`). So a keyword starting with a common word ("the", "free", "open") lands minutes off. Every anchor below was picked to be rare — say them clearly:

  | Keyword passed | Anchors on   | Lands at                                | Post-draft fix                |
  | -------------- | ------------ | --------------------------------------- | ----------------------------- |
  | `MIT`          | "MIT"        | opening line                            | —                             |
  | `codebase`     | "codebase"   | ⚠️ "on the same codebase" (canvas para) | edit to `occurrence: 2`       |
  | `hexagonal`    | "hexagonal"  | "built hexagonal"                       | —                             |
  | `fourth`       | "fourth"     | "a fourth runtime"                      | —                             |
  | `contribute`   | "contribute" | "if you want to contribute"             | —                             |
  | `Ink`          | "Ink"        | "It's Ink and React"                    | retitle chip to "Ink + React" |
  | `pull`         | "pull"       | "pull requests are both open"           | —                             |

- ⚠️ **`codebase` needs a hand-edit.** You say it once in the canvas paragraph before the section it's meant to mark. After drafting, change that beat to `{ "word": "codebase", "occurrence": 2 }`.
- **Stat cards need hand-editing.** The `[stat-card: X / Y]` markers above are authoring shorthand; the schema wants split fields:
  `{ "type": "stat", "at": {...}, "value": "22 ports", "label": "3 adapter families" }`
  The draft tool does not emit these — add the three `stat` beats yourself.
- **Numbers to say deliberately**: "nine agents", "around fifty libraries", "twenty-two port interfaces", "fifteen agent templates". Say "around" for the library count — it moves.
- **Draft-beats command** (after recording camera + transcribing):
  ```bash
  npm run selfshot:draft -- --slug 01-open-source-announcement \
    --keywords "MIT,codebase,hexagonal,fourth,contribute,Ink,pull" \
    --title "Abdallah Khalil" --subtitle "Founder, Ptah"
  ```
- Hold the 2-second silence at the top before the first word — the lower-third needs calm footage to land on.

---

## Fact check (verified 2026-08-01)

| Claim                         | Source                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIT licensed                  | `LICENSE.md`                                                                                                                                                                |
| 3 runtimes off one core       | `libs/backend/platform-{vscode,electron,cli}`                                                                                                                               |
| CLI is headless **and** a TUI | `apps/ptah-cli/src/cli/router.ts:2292` (`ptah tui`); `apps/ptah-tui` builds to `tui.mjs` inside the published `@hive-academy/ptah-cli` (`apps/ptah-cli/package.json:32-40`) |
| TUI is Ink + React, 2 deps    | `apps/ptah-tui/package.json`; `scope:cli`, consumes `cli-engine` + `shared` only                                                                                            |
| 9 agents on the canvas        | `libs/frontend/canvas/src/lib/canvas.store.ts:66` (`MAX_TILES = 9`)                                                                                                         |
| ~50 libraries                 | 25 under `libs/backend/`, 25 under `libs/frontend/`                                                                                                                         |
| 22 port interfaces            | `libs/backend/platform-core/src/di/tokens.ts` (`PLATFORM_TOKENS`)                                                                                                           |
| 15 agent templates            | `libs/backend/agent-generation/templates/agents/*.template.md`                                                                                                              |
| Telegram / Discord / Slack    | `libs/backend/messaging-gateway`                                                                                                                                            |

> `CLAUDE.md` and `apps/ptah-video-studio/docs/feature-knowledge-base.md` both still say **16 ports** and **16/21 libs** — those are stale. The counts above are from today's tree.

---

## YouTube metadata

**Title:** Ptah — an open source AI coding orchestra (and how it's built)

**Description:**

```
Ptah is an MIT-licensed AI coding orchestra that runs as a VS Code extension, an Electron desktop app, and a CLI that works headless over JSON-RPC or as a full interactive terminal UI — all off one shared core.

In this video: what it does (9 agents in parallel on one codebase, persistent memory, self-authored skills, cron-scheduled agents, and a Telegram/Discord/Slack gateway), how the codebase is structured (Nx monorepo, hexagonal, 22 ports and 3 adapter families), and where to land a first contribution.

⭐ Star the repo: https://github.com/Hive-Academy/ptah-extension
🐛 Open issues: https://github.com/Hive-Academy/ptah-extension/issues
📚 Docs: https://docs.ptah.live
▶ More Ptah tours: [PLAYLIST_LINK]
💬 Community: [DISCORD_LINK]
🌐 https://ptah.live
```

**Tags:** ptah, open source ai, ai coding orchestra, ai agents, hexagonal architecture, nx monorepo, typescript, open source contribution, ai coding assistant
