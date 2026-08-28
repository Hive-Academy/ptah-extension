---
id: TASK_2026_278
status: done
type: REFACTORING
title: >-
  Harness reconciler — one declarative, verified fan-out of skills, commands,
  agents and MCP to the Claude SDK and every connected CLI agent
description: >-
  Ptah's core promise is one shared harness across Claude, codex, copilot,
  cursor, antigravity and ptah-cli. Today that promise rests on two unrelated
  mechanisms with different lifecycles: NTFS junctions into `.claude/skills`
  (created only by the VS Code/Electron hosts, deleted on deactivate, never
  created for CLI/TUI/gateway/cron hosts) and a copy engine for rival CLIs whose
  cleanup is dead code and whose hash cache is never consulted. The SDK
  `plugins:` option is threaded through four services and dropped. Sessions can
  start before junctions exist, headless sessions never get them, promoted
  synthesized skills do not repropagate until restart, harness-builder skills
  never reach rival CLIs, deleted upstream skills live forever, and nothing
  verifies the result. Replace both mechanisms with a single
  `libs/backend/harness-sync` reconciler: desired-state manifest from
  `~/.ptah/user`, per-target adapters, hash-gated idempotent copies, no removal
  on deactivate, reconcile at every entry point plus a session-start preflight,
  and a `HarnessHealth` report surfaced as `ptah harness doctor` and in the UI.
updated: '2026-08-25T21:16:40.974Z'
---

# Harness reconciler

Machine-owned metadata carrier. Prose lives in `./context.md`, batch breakdown in `./tasks.md`.
