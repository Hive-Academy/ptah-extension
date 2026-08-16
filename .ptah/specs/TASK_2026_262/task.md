---
id: TASK_2026_262
status: in_review
type: bugfix
title: >-
  Dynamic-catalogue providers get an unresolvable model string whenever nothing
  is selected, on the chat path as well as the background lanes
description: >-
  `openrouter`, `lm-studio` and `requesty` declare no `defaultTiers` and ship no
  `staticModels` — all three deliberately, because their catalogues are fetched
  live. `ModelResolver.resolve` has no live-list step, so every path that hands
  it a tier-shaped value when the user has selected no model falls out at
  `model-resolver.ts:85` and sends that string verbatim: the chat path
  substitutes `'default'`, which recurses to the bare `'opus'`
  (`chat-session.service.ts:418,1009`); the skill-synthesis lanes send the bare
  tier alias or the pinned `claude-haiku-4-5-20251001`; the per-workspace
  profile resolver has the identical empty fallback chain. OpenRouter's
  translation proxy passes it through unchanged (`normalizeModelId` is the
  identity function), so the endpoint answers 404 and, before TASK_2026_250's
  diagnostic warn, nothing appeared in Ptah's own logs. `openrouter` is
  `DEFAULT_PROVIDER_ID` and the registered file-settings default for
  `anthropicProviderId`, so this is the likeliest configuration rather than a
  corner. The fix is one live-model-list resolution step that serves every
  caller; it cannot be closed in any single caller.
---

# Dynamic-catalogue providers get an unresolvable model string

Machine-owned metadata carrier. Prose lives in `./context.md`.
