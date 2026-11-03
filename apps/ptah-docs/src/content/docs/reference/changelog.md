---
title: Changelog
description: Release notes for the PtahCode desktop app.
---

## Memory lifecycle update

- Stored salience is now an immutable base used by query-time ranking rather than a value rewritten by decay maintenance.
- Unused recall memories become archival after 30 days; archival memories are deleted 60 days after their `archived_at` stamp, including their chunks, FTS rows, and vector rows.
- A recorded use restores an archival memory to recall. Each workspace is capped at 25,000 evictable rows, with archival-first eviction and a 7-day archival grace; pinned, core, and corpus memories are exempt.
- Destructive lifecycle work pauses when sqlite-vec is unavailable and the `memory_chunks_vec_ad` cleanup trigger exists; without that trigger, deletion proceeds.

## Hermes Release

- **[Memory](/memory/)** — Letta-style tiered memory (`core` / `recall` / `archival`) with hybrid BM25 + vector search, an LLM curator on PreCompact, and salience-driven decay
- **[Skill Synthesis](/skill-synthesis/)** — auto-promotes repeated successful workflows to durable `~/.ptah/skills/<slug>/SKILL.md` after 3 successes; cosine dedup against active skills
- **[Cron Scheduler](/automation/cron/)** — recurring AI tasks via croner, persisted in SQLite; catchup policy (`none` / `last` / `all`) handles sleep/wake cleanly
- **[Messaging Gateway](/automation/messaging/)** — drive Ptah from Telegram, Discord, or Slack; voice messages via ffmpeg + whisper; stream coalescing keeps chats from flapping

The former headless CLI's A2A bridge, `ptah interact` proxy, and `ptah mcp-serve` were retired with the standalone CLI app.

All four Hermes tracks share `~/.ptah/ptah.db` and live under their respective `memory.*`, `skillSynthesis.*`, `cron.*`, `gateway.*` settings prefixes in `~/.ptah/settings.json`.

---

Full, versioned release notes live on GitHub:

[https://github.com/Hive-Academy/PtahCode/releases](https://github.com/Hive-Academy/PtahCode/releases)

Each release includes:

- **What's new** — user-visible features and improvements
- **Fixes** — bug fixes grouped by area
- **Breaking changes** — migration notes, if any
- **Known issues** — open bugs we're tracking

The in-app **Help → What's new** dialog surfaces the same content for the version you have installed.
