---
id: TASK_2026_292
status: backlog
type: bugfix
title: >-
  A conductor has no way to ask a finished CLI lane a follow-up — every
  relay follow-up starts a new thread and grows a second tile
description: >-
  `AgentProcessManager.continueConversation()` already continues a completed
  CLI agent in place — same `agentId`, same `SdkHandle`, same Codex thread —
  and Codex's adapter declares `supportsContinuation: () => true`. But that
  primitive is reachable only over the `agent:continue` RPC, which only the
  webview's "Send a follow-up…" input calls. The MCP agent surface exposes
  spawn / status / read / steer / stop / list and no continue, so a Tribunal
  RELAY conductor answering a checkpoint has exactly one move available:
  `ptah_agent_spawn`. That starts a fresh Codex thread with none of the plan
  context, and because `matchLaneToAgent` scans a newest-first roster the new
  agent takes over the phase lane while the old completed one falls through to
  `reconcileSlice` and becomes a second, closable "Codex CLI — DONE" tile.
  `ptah_agent_steer` is not a substitute (running-only, and it needs a live
  stdin no SDK adapter but Pi has), and `resume_session_id` is both a weaker
  fallback and undocumented for this case — relay.md tells the conductor to
  "re-spawn the same lane" and mentions resume only for timeouts.
---

# Relay follow-ups need a continuation verb, not a respawn

Machine-owned metadata carrier. Prose lives in `./context.md`.
