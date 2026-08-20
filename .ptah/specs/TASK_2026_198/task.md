---
id: TASK_2026_198
status: in_review
type: FEATURE
title: TUI visual + interaction overhaul — adopt the Claude Code / Copilot CLI design language
description: >-
  Redesign the Ptah TUI's chrome, typography usage, streaming rendering, and
  keymap to match the polish of modern Ink-based agent CLIs. User verdict after
  live testing was that the TUI "feels very basic and rocky, not professional"
  next to tools built on the same Ink + React stack. Replace heavy-bordered
  panel chrome with a minimal, content-first layout; render assistant output as
  terminal markdown with syntax-highlighted fenced code; unify shortcuts into
  one discoverable, conflict-free keymap registry with a `?` help overlay,
  slash commands, and @-file mentions. Terminal fonts are out of scope — glyph
  quality belongs to the user's terminal — so the work is layout, spacing,
  border discipline, palette, markdown rendering, motion, and interaction
  grammar. Scoped to `apps/ptah-tui`, with no backend or protocol change beyond
  wiring Esc-interrupt to the existing `agent:stop` RPC. Re-filed from
  TASK_2026_173, whose carrier this scope had overwritten.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
