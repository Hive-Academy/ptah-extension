---
id: TASK_2026_423_bc0d
status: backlog
type: BUGFIX
title: Codex long-lived PowerShell child survives the codex.exe kill on Windows
description: >-
  When a Codex turn ends, the SDK kills only codex.exe. Its long-lived
  powershell.exe child, the Rust command-safety AST parser, can stay alive as
  an orphan because the SDK does not kill the process tree.
---

Follow-up from TASK_2026_421. See `context.md`.
