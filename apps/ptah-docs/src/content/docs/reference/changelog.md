---
title: Changelog
description: Release notes for the Ptah desktop app.
---

## Hermes Release

- **[Memory](/memory/)** — Letta-style tiered memory (`core` / `recall` / `archival`) with hybrid BM25 + vector search, an LLM curator on PreCompact, and salience-driven decay
- **[Skill Synthesis](/skill-synthesis/)** — auto-promotes repeated successful workflows to durable `~/.ptah/skills/<slug>/SKILL.md` after 3 successes; cosine dedup against active skills
- **[Cron Scheduler](/automation/cron/)** — recurring AI tasks via croner, persisted in SQLite; catchup policy (`none` / `last` / `all`) handles sleep/wake cleanly
- **[Messaging Gateway](/automation/messaging/)** — drive Ptah from Telegram, Discord, or Slack; voice messages via ffmpeg + whisper; stream coalescing keeps chats from flapping
- **CLI A2A bridge** — JSON-RPC stdio surface for cron, memory, gateway, and skill-synthesis (advanced / scripted use)
- **Embedded Anthropic-compatible proxy** — `ptah interact --proxy-start` boots an in-process HTTP proxy with optional workspace-tool re-export

All four Hermes tracks share `~/.ptah/ptah.db` and live under their respective `memory.*`, `skillSynthesis.*`, `cron.*`, `gateway.*` settings prefixes in `~/.ptah/settings.json`.

---

Full, versioned release notes live on GitHub:

[https://github.com/ptah-extensions/ptah-extension/releases](https://github.com/ptah-extensions/ptah-extension/releases)

Each release includes:

- **What's new** — user-visible features and improvements
- **Fixes** — bug fixes grouped by area
- **Breaking changes** — migration notes, if any
- **Known issues** — open bugs we're tracking

The in-app **Help → What's new** dialog surfaces the same content for the version you have installed.
