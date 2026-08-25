---
id: TASK_2026_250
status: in_review
type: BUGFIX
title: >-
  The judge lane's inherit branch still falls back to a pinned Claude id, the
  one shape TASK_2026_159 removed from the curator
description: >-
  `resolveJudgeModel` falls back to `JUDGE_DEFAULT_MODEL_ID =
  'claude-haiku-4-5-20251001'` when nothing is configured. TASK_2026_159 removed
  exactly that shape from the memory curator and replaced it with a bare tier
  alias (`CURATOR_DEFAULT_MODEL_TIER = 'haiku'`), pinned by a spec whose name
  says "sends the bare haiku TIER ALIAS — not a pinned Claude id — when unset".
  `resolveLaneModel` already applies that lesson on its configured-provider
  branch, returning `cfg.defaultTier`, and its own docblock states the reason:
  a pinned dated Claude id reaches a non-Anthropic endpoint verbatim and 404s.
  The inherit branch does not. Since every lane ships `provider: ''`, inherit is
  the DEFAULT path, so a user who moved their main provider to Z.AI, Moonshot or
  Ollama and never configured a skill-synthesis lane gets a pinned Anthropic id
  sent at an endpoint that cannot serve it. This is filed rather than fixed
  because the current behaviour is deliberate and load-bearing, not an
  oversight — see context.
---

# The judge lane inherit branch still pins a Claude id

Machine-owned metadata carrier. Prose lives in `./context.md`.
