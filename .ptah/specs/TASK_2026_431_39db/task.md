---
status: in_review
type: refactoring
title: >-
  Give CLI-lane mechanics one home in a shared agent-lanes skill, and cut
  orchestration and tribunal down to what only they teach
description: >-
  A three-vendor tribunal (Codex, Ollama kimi-k3, Antigravity) found the same
  lane rules — discovery, cli/ptahCliId addressing, spawn-poll-read, resume,
  concurrency, the two-round revise cap, task-ID allocation and checkpoint
  ownership — authored three to five times across orchestration/SKILL.md,
  cli-agent-delegation.md, vendor-panel.md, relay.md and crucible.md, with
  drift already visible (unconditional resume in one copy, conditional in
  another). orchestration/SKILL.md loads ~24KB on every trigger, of which
  ~16-18KB restates its own references. Extract the lane contract into a new
  small skill both workflows load, make orchestration/SKILL.md a router, keep
  tribunal to panel policy and move protocols, and slim agent-catalog.md after
  relocating its few unique rules.
---

# Shared agent-lanes skill and orchestration/tribunal de-duplication

Machine-owned carrier. Prose in `./context.md`; tribunal evidence in `./tribunal/`.
