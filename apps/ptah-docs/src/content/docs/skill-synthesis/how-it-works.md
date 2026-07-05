---
title: How Skill Synthesis Works
description: From a captured session to a distilled, judged, and auto-improving skill.
---

# How Skill Synthesis Works

A skill goes through three stages: **capture**, **distillation**, and **a living library**. The [Skills tab](/skill-synthesis/the-skills-tab/) surfaces each stage (Sessions → Recommended → Library).

## Stage 1 — Capture (Sessions)

```text
session ends / idle / subagent stops / turn completes / boot scan
        ↓
Trajectory extractor   → normalized turns + tool sequence + success signal
        ↓
Prefilter              → drop the thin stuff (needs edits, or tools + length, or a test run)
        ↓
Trajectory-hash dedup  → skip if this exact trajectory was already captured
        ↓
Candidate row (Sessions, status: candidate)
```

For each captured session, an LLM distills a first-pass `{ name, description, body }` following skill-authoring best practices (a trigger-oriented description, an imperative body, no workspace-specific paths). On boot scans, or when no model is available, a template is used instead and the row keeps a raw name until it's distilled.

## Stage 2 — Distillation (two paths to a skill)

### Cluster → Recommended (the main path)

The **Curator** pass clusters candidates that look alike. When at least `skillSynthesis.suggestionMinClusterSize` (default `2`) similar candidates cluster, it:

1. Synthesizes **one** generalized, repo-agnostic skill from the whole cluster
2. Runs it past the **quality judge**
3. If it passes, proposes it in **Recommended** for you to review, edit, and Accept

Accepting materializes it to `~/.ptah/skills/<slug>/SKILL.md` and registers it in the Library.

### Direct promotion

A single candidate that succeeds `skillSynthesis.successesToPromote` (default `3`) times is promoted directly — also judge-gated — and materialized the same way. This is the "I did the exact same thing three times" path.

## The judge

Before anything is promoted or recommended, the **judge** scores it 1–10 on five criteria and compares the average to `skillSynthesis.minJudgeScore` (default `6.0`):

| Criterion      | Asks                                                                |
| -------------- | ------------------------------------------------------------------- |
| novelty        | Is this non-obvious versus what an agent already knows?             |
| actionability  | Are the steps concrete and ordered?                                 |
| scope          | Is it one well-defined workflow, not a trivial one-off?             |
| generalization | Repo-agnostic and transferable, with no session-specific leftovers? |
| triggerClarity | Does the description clearly say _when_ to use the skill?           |

The judge **fails open** — if the model is unavailable it lets the skill through rather than blocking the pipeline.

## Dedup

Before a candidate is created or counted, its embedding is compared against the active skill set. If cosine similarity to any active skill is ≥ `skillSynthesis.dedupCosineThreshold` (default `0.85`), the trajectory is treated as **already represented** rather than creating a duplicate.

## Stage 3 — A living library

Materialized skills, plus cloned agents and commands, live in the **Library**. Ptah records when each one is actually used — the `Skill` tool, slash-command/skill expansion, and **subagent runs** (by `subagent_type`). That usage signal drives auto-enhancement:

```text
≥ 5 recorded runs and not in cooldown
        ↓
Curator rewrites the skill against its recent usage (judge-gated)
        ↓
previous version snapshotted to History → re-propagated
        ↓
24h cooldown
```

You can also **Enhance now** to run it manually, or **Revert** to any History snapshot.

## Residency

Active skills are capped at `skillSynthesis.maxActiveSkills` (default `200`). When the cap is exceeded, the weakest resident is demoted to **`dormant`** — it stays on disk and in the database but is skipped when skills are loaded into a session. Dormant skills are never deleted, and **authored** skills are exempt from demotion entirely.
