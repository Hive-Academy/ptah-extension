---
title: How Skill Synthesis Works
description: From a captured session to a distilled skill — and the two different roads a skill can take to get there.
---

import { Aside } from '@astrojs/starlight/components';

# How Skill Synthesis Works

A skill goes through three stages: **capture**, **distillation**, and **a living library**. The [Skills tab](/skill-synthesis/the-skills-tab/) surfaces each stage (Sessions → Recommended / auto-promoted → Library).

The stage that matters most for what you should expect is distillation, because it splits into **two tracks with very different levels of human involvement**. Read that section closely before the rest.

## Stage 1 — Capture (Sessions)

Every session-end, idle gap, subagent stop, completed turn, and boot scan writes a cheap regex-only row into a durable queue — nothing is read by a model yet. A background drain later picks the row up and runs the real capture:

```text
session ends / idle / subagent stops / turn completes / boot scan
        ↓
Trajectory extractor   → normalized turns + tool sequence + success signal
        ↓
Prefilter (regex, free) → drop sessions with no signal at all
        ↓
Trajectory-hash dedup  → skip if this exact trajectory was already captured
        ↓
Candidate row (Sessions, status: candidate)
        ↓
Session archaeologist  → reads the transcript, writes an intent/outcome/friction verdict
```

The prefilter is deliberately generous: a candidate passes if it edited code, used tools, ran a test command, **or** simply sustained a long back-and-forth — any one of those is "there's something here." That's a deliberate widening: a debugging session that took three failed attempts and a correction is exactly the material worth capturing, and it's often short on edits but dense with friction. See [Background Learning](/skill-synthesis/background-learning/#the-session-archaeologist) for what the archaeologist does with that friction once it runs.

For each captured session, an LLM distills a first-pass `{ name, description, body }` following skill-authoring best practices (a trigger-oriented description, an imperative body, no workspace-specific paths). On boot scans, or when no model is available, a template is used instead.

## Stage 2 — Distillation: two tracks, one library

<Aside type="danger" title="Track 1 has no accept step">
A candidate that succeeds `skillSynthesis.successesToPromote` (default **3**) times promotes itself. Nobody reviews it, nobody clicks Accept — once it clears the judge and the safety gates below, Ptah writes `~/.ptah/skills/<slug>/SKILL.md` and it's live for every agent to use. This is intended: the empirical gates exist so unattended promotion is defensible, not so it can be avoided.
</Aside>

### Track 1 — direct promotion (fully automated)

The "I did the exact same thing enough times" path. Once a candidate's recorded success count reaches the threshold, promotion runs automatically:

```text
successesToPromote reached
        ↓
duplicate-of-active-skill check (cosine dedup)
        ↓
judge scores the candidate — must be 'scored' and ≥ minJudgeScore
        ↓
replay confidence check — blocks only if MEASURED below the floor
        ↓
residency cap check (may demote the weakest active skill to dormant)
        ↓
SKILL.md written, candidate → promoted
```

There is no "recommend it to the user" step anywhere in that chain. The **Promote** button in [Sessions](/skill-synthesis/the-skills-tab/#sessions) still exists, but it's a manual override for jumping the threshold — not the only door in.

### Track 2 — cluster → Recommended (human-in-the-loop)

The path for workflows that are _similar but not identical_ — no single session repeats often enough to hit the threshold on its own, but several sessions cluster together. The **Curator** pass:

1. Clusters candidates that look alike (at least `skillSynthesis.suggestionMinClusterSize`, default **2**)
2. Holds one cluster member back so nothing is judged against a session that trained it — see the replay note below
3. Synthesizes **one** generalized, repo-agnostic skill from the rest
4. Runs it past the same quality judge
5. If it passes, proposes it in **Recommended** for you to review, edit, and Accept

Nothing here reaches your library without `acceptSuggestion`. This is the track the phrase "review your recommendations" has always correctly described — it just isn't the only track.

## The judge

Before anything is promoted or recommended, the **judge** scores it 1–10 on five criteria and averages them:

| Criterion      | Asks                                                                |
| -------------- | ------------------------------------------------------------------- |
| novelty        | Is this non-obvious versus what an agent already knows?             |
| actionability  | Are the steps concrete and ordered?                                 |
| scope          | Is it one well-defined workflow, not a trivial one-off?             |
| generalization | Repo-agnostic and transferable, with no session-specific leftovers? |
| triggerClarity | Does the description clearly say _when_ to use the skill?           |

The average is compared against `skillSynthesis.minJudgeScore` (default **6.0**).

<Aside type="note" title="It never invents a passing score">
Earlier versions of this pipeline had three failure paths — no JSON in the reply, a reply with values that weren't scores, and a thrown call — that all quietly returned a fabricated `score: 10` and let the candidate through. They don't anymore. All three now report **`unscored`**: not a pass, not a rejection. The candidate stays at `status: candidate` and the next background pass re-judges it. Only a genuine `'scored'` verdict below the minimum rejects a candidate; `unscored` never does.
</Aside>

### The judge panel (weekly, deeper)

Once a week, candidates that reached the judge get a second, independent opinion — and the two panellists are asked **different questions**, which is the entire reason it's worth a second call. Panellist A judges the artifact cold, same as the capture-time judge. Panellist B judges the _same_ artifact but is also shown the candidate's nearest description-neighbours among your active skills and whatever the empirical gates below have already measured for it. If the two disagree by more than `skillSynthesis.judgePanel.disagreementThreshold` on any single criterion, a third call reads both rationales and adjudicates.

This doesn't gate the capture-time promotion decision — Track 1 can promote before its weekly panel ever runs. It's what backs the scorecard you see for a candidate, and the foundation later gates build on.

## The empirical gates — measuring instead of asking

Two gates replace a model's _opinion_ with a _measurement_. Both run weekly.

**Trigger eval** asks: given prompts this skill should answer and prompts it shouldn't, how often does its description actually come back from retrieval? One cheap LLM call generates the test prompts; everything after that — embedding, ranking, precision, recall — is local vector math, never a second model opinion. The result replaces the judge's `triggerClarity` guess with a measured number wherever a candidate has one.

**Replay validation** asks something a rubric can't: hold one session out of the cluster a skill was drafted from, hand the skill plus that session's opening ask to a fresh model, and see whether the plan it produces resembles what that session actually did.

<Aside type="caution" title="Replay is designed, not running yet">
The replay gate has a working handler, but nothing in production enqueues work for it today — there's no producer wired up. Until that lands, `replayConfidence` stays `null` for every candidate, which means the replay check in the promotion chain above is a no-op: promotion proceeds on the judge score alone. This page describes it because it's real, tested code — just not yet a gate you'll see fire.
</Aside>

Both gates share the same rule for missing data: **`null` means never measured, `0` means measured and got nothing.** A skill nobody has replayed reads as "not measured," never as a zero — the UI never turns an absent measurement into a number that looks like a bad score.

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
