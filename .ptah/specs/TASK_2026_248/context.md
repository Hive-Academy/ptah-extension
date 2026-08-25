# TASK_2026_248 — the skill-synthesis docs describe a pipeline that no longer exists

Filed 2026-08-15, immediately after TASK_2026_180 Phase 3 closed. Two user
decisions were taken up front and must not be re-litigated:

1. **The code is right about auto-promotion.** Single-session skills promoting
   themselves is intended behaviour, and the empirical gates are the safety
   mechanism that makes it defensible. The docs describe the split honestly
   rather than the aspiration.
2. **Full section rewrite**, not a correctness pass. Every page predates the
   work.

## The two tracks — the thing the docs currently get wrong

**Track 1 — single-session, FULLY AUTOMATED. No human anywhere.**

```
session ends → prefilter (regex, free) → archaeology (LLM reads the transcript)
             → candidate registered → invocations counted
             → at `successesToPromote` (3) successes:
                 judge scored AND ≥ `minJudgeScore` (6.0)
                 AND (replayConfidence ≥ floor OR replayConfidence IS NULL)
             → mdGenerator.promoteToActive() writes ~/.ptah/skills/<slug>/SKILL.md
             → live
```

`skill-invocation-tracker.ts:73-84` → `skill-promotion.service.ts:252`. There is
no user gate on that path.

**Track 2 — cluster, HUMAN-IN-THE-LOOP.** The curator clusters candidates,
drafts one generalized skill from all but one held-back member, judges it, and
inserts a PENDING SUGGESTION. It appears under Skills → Recommended and ships
only on `acceptSuggestion`.

`index.md`'s "once you accept it" describes Track 2 and is false for Track 1.
That single sentence is the most misleading thing in the section, because it
tells a user that nothing reaches their skills library without their say-so.

## What Phase 0–3 added that is entirely undocumented

- **A durable SQLite queue** (`skill_synthesis_queue`) drained by cron in three
  tiers, replacing inline fire-and-forget session-end analysis. Work survives
  app close. Gates in order: `skillSynthesis.enabled` → daily token budget →
  battery → foreground backoff.
- **Lane routing.** Each stage (`archaeologist`, `synthesis`, `judge`, `replay`)
  gets its own provider + model, so background learning runs OFF the foreground
  Anthropic quota — Ollama, Z.AI, Moonshot, OpenRouter. This is the single most
  user-visible win in the whole task and no page mentions it.
- **The session archaeologist**, which replaced regex transcript reading with a
  multi-pass evidence-gathering analyzer producing intent/outcome/friction
  verdicts with turn citations.
- **A judge that never fabricates a score.** Three fail-OPEN paths used to return
  `{passed: true, score: 10}`. They now return `unscored`, which blocks nothing
  and invents nothing.
- **Empirical gates**: replay validation against a held-out cluster member, and
  a zero-LLM trigger retrieval eval. `null` means never measured; `0` means
  measured and failed. The UI says "not measured", never a digit.
- **A two-panellist judge panel** where the panellists are asked DIFFERENT
  questions — the second sees the library's nearest description neighbours and
  the gate results already measured — escalating to a third call on
  per-criterion disagreement.

## Honesty constraints — the docs must not oversell

- **The replay gate has a handler and NO producer.** It does not run in
  production yet (`TASK_2026_245`). Do not document it as a working gate. It may
  be described as designed/landed, clearly marked as not yet measuring.
- **The Skills tab is Electron-only BY DESIGN.** `SkillsSynthesisRpcHandlers` is
  in `EXPECTED_ABSENT_HANDLERS`; the whole backend needs better-sqlite3 plus the
  embedder worker. Do not promise VS Code parity. (This is settled —
  `TASK_2026_244` was filed on the wrong premise and closed.)
- **Background learning spends tokens by default.** `skillSynthesis.enabled`
  defaults to `true`. Say so, and say where the master switch is.

## Scope

`apps/ptah-docs/src/content/docs/skill-synthesis/` — all six pages, plus new
pages as the rewrite needs them, plus the curated sidebar in
`apps/ptah-docs/astro.config.mjs` (that section uses explicit `items`, not
`autogenerate` — do not mix the two).

Gate: `nx build ptah-docs` and `nx check ptah-docs` (astro check validates links).
