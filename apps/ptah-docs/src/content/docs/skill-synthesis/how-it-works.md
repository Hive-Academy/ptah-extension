---
title: How Skill Synthesis Works
description: Trajectory extraction, dedup, and the path from candidate to promoted skill.
---

# How Skill Synthesis Works

## The pipeline

```text
Session ends or compacts
        ↓
Trajectory extractor   → records (turn count, tool sequence, outcome) for the session
        ↓
Cosine dedup           → embed the trajectory, compare against active skills;
                         skip if similarity ≥ skillSynthesis.dedupCosineThreshold
        ↓
Candidate row          → insert (status: candidate) or update existing match
        ↓
Invocation tracker     → on each subsequent successful repetition, increment count
        ↓
Promotion service      → on the 3rd success (skillSynthesis.successesToPromote),
                         materialise ~/.ptah/skills/<slug>/SKILL.md and
                         flip status to "promoted"
```

## What counts as a trajectory

A trajectory is the **shape** of a successful session, not its literal content. The extractor records:

- Number of turns
- Tool-call sequence (which MCP tools fired, in what order)
- Outcome signal (did the user accept the result, hit retry, abandon?)

Trajectories shorter than the minimum threshold are ignored — single-turn answers aren't workflows.

## Dedup

Before a candidate is created or counted, its embedding is compared against the active skill set. If cosine similarity to any active skill is ≥ `skillSynthesis.dedupCosineThreshold` (default `0.85`), the trajectory is treated as **already represented** — its invocation count rolls up against the matching skill instead of creating a duplicate.

## Promotion

On the 3rd successful invocation of a candidate (configurable via `skillSynthesis.successesToPromote`), the **SkillPromotionService**:

1. Generates a slug from the trajectory summary
2. Writes `~/.ptah/skills/<slug>/SKILL.md` with frontmatter and prose
3. Updates the candidate row's status to `promoted`
4. Records the promotion timestamp

From that moment the skill is discoverable by every agent in Ptah, just like a hand-authored one.

## LRU eviction

When the active skill count exceeds `skillSynthesis.maxActiveSkills` (default `50`), the least-recently-invoked skill is archived. Archived skills aren't deleted — they stay on disk and can be re-promoted manually if their pattern returns.
