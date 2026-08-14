---
id: TASK_2026_180
status: in_progress
type: FEATURE
title: Agentic skill synthesis - queued execution, provider routing, session archaeologist, replay validation, proactive curator
description: Rebuild the Thoth skill-synthesis pipeline from a fixed heuristic pipeline into an agentic, evidence-based one. Phase 0 replaces inline fire-and-forget session-end analysis with a SQLite work queue drained by cron - slot-claim dedup across windows, stale-claim reaping, foreground/battery/token-budget gating, per-workspace fairness, and survival across app close (Tier A resume plus optional Electron tray). Phase 1 restores trust - judge fail-open no longer fabricates 10.0 scores, per-criterion scores persist, structured output replaces hand-rolled JSON parsing, raw first-message slugs never surface, and each stage gets its own provider and model lane with an auth override so background learning runs off the foreground Anthropic quota (Ollama, Ollama Cloud, Z.AI, Moonshot, OpenRouter). Phase 2 replaces regex session reading with a tool-equipped session-archaeologist subagent producing intent/outcome/friction verdicts with turn citations. Phase 3 adds empirical gates - validation-by-replay on a held-out cluster session, a retrieval-based trigger eval, and a two-judge panel with disagreement escalation. Phase 4 makes recommendations proactive - a gap-detection curator digest joining sessions, the skill library, invocation win-rates, and memory observations into ranked evidence-backed suggestions.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-04T00:00:00.000Z
updated: 2026-08-04T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
