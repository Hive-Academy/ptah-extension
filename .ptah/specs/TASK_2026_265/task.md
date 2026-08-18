---
id: TASK_2026_265
status: in_review
type: BUGFIX
title: >-
  autoResolveDefaultTiers persists a guess into the user-choice slot and writes
  global tier env vars for a provider that may not be active
description: >-
  `ProviderModelsService.autoResolveDefaultTiers` runs on EVERY successful model
  fetch for ANY provider (`provider-models.service.ts:412`) and persists its
  regex guess through `setModelTier(..., 'mainAgent')`, which both writes the
  `provider.<id>.mainAgent.modelTier.<tier>` config key — the exact key
  `getPersistedTierValue` reads as the TOP of the precedence chain — and
  unconditionally assigns global `process.env[ANTHROPIC_DEFAULT_*_MODEL]` plus
  the shared `authEnv` (`:508-511`). Two defects fall out. First, a heuristic
  guess becomes indistinguishable from an explicit user pick and outranks any
  `defaultTiers` the registry gains later; a persisted guess is permanent where
  a read-time derivation would re-derive when the catalogue changes. Second,
  and suspected rather than proven, there is no provider-activeness guard —
  browsing a second provider's catalogue in the model picker may write that
  provider's ids into the tier env vars the ACTIVE session resolves through.
  TASK_2026_262 recorded the first half as a known violation and named deletion
  in favour of the read-time rule (`deriveTiersFromCatalog`) as the recommended
  fix. The reproduction of the second half is the gating question and comes
  first: a fix built on an unreproduced premise is what TASK_2026_250 got wrong.
---

# autoResolveDefaultTiers writes into the user-choice slot

Machine-owned metadata carrier. Prose lives in `./context.md`.
