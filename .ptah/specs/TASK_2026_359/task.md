---
id: TASK_2026_359
status: done
type: bugfix
title: >-
  Restore stack tailoring in the subagent templates: LLM sections back,
  Ptah-specific guidance out
description: >-
  TASK_2026_254 removed the last three LLM sections from the templates and
  hardcoded Ptah's own stack (tsyringe, platform-core, electron-builder, the
  Sync Release Branch rule) into devops-engineer, backend-developer,
  frontend-developer and the two code reviewers. Templates ship to every
  user's repository, so that guidance is wrong everywhere except here. Put
  the tailoring back where it belongs: stack-agnostic template bodies, one or
  two LLM sections per role that the wizard fills from the project analysis
  with conventions and patterns only (no counts, no versions), a generation
  prompt and validator that enforce that, and a guard that fails when a
  template body names a Ptah-only concept.
---

# Restore stack tailoring in the subagent templates

Machine-owned carrier. Prose in `./context.md`.
