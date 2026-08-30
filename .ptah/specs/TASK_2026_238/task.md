---
id: TASK_2026_238
status: done
type: BUGFIX
title: Fix codex and opencode native binary path resolution
description: >-
  resolveCodexNativeBinary() builds every candidate with a hardcoded
  vendor/<triple>/codex/ segment, but @openai/codex-sdk 0.147 ships the binary
  at vendor/<triple>/bin/. Every candidate misses, codexPathOverride is never
  set, and the SDK falls back to self-resolution — which works against a real
  node_modules tree but fails from a packaged asar build with ENOENT. The same
  shape of bug is in the opencode adapter fallback.
updated: '2026-08-25T21:11:02.618Z'
---

# Fix codex and opencode native binary path resolution

Blocks every codex lane in the packaged app, including Tribunal moves launched
from the panel and any `ptah_agent_spawn { cli: "codex" }` call. Prerequisite for
the codex-only CLI delegation mode chosen for TASK_2026_237.

Prose lives in `context.md`.
