---
title: The Skills Tab
description: How Recommended, Sessions, and Library fit together — and what to do with old session captures.
---

# The Skills Tab

The Skills tab has five sub-views. Three of them are the lifecycle of a skill; two are supporting. Read them left to right as a pipeline:

```text
 a session runs
      │
      ▼
 ┌──────────┐   cluster of ≥2 similar    ┌─────────────┐   you Accept    ┌──────────┐
 │ Sessions │ ─────────────────────────▶ │ Recommended │ ──────────────▶ │ Library  │
 │ (raw)    │   + quality judge          │ (distilled) │   (+ edits)     │ (active) │
 └──────────┘                            └─────────────┘                 └──────────┘
   candidates                              suggestions                     clones
```

- **Sessions** — every successful session Ptah captured, raw. The feedstock.
- **Recommended** — workflows Ptah distilled from clusters of similar sessions and a quality judge passed. The skills actually worth adding.
- **Library** — the skills, agents, and commands that are installed and run, plus the loop that improves them from usage.
- **Activity** — diagnostics: why sessions were eligible or skipped, when the last pass ran.
- **Settings** — thresholds and caps (read-only here; edit from the Settings view).

---

## Sessions

Each row is one **candidate** — a single successful session boiled down to its trajectory (turns, tool calls, outcome). The name and description are taken straight from the session, so they read like whatever you happened to be doing — including subagent transcripts (e.g. Tribunal panelists), which is why you'll see clusters of near-identical machine-named rows.

| Status      | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| `candidate` | Captured, awaiting review or clustering                             |
| `promoted`  | You force-promoted it straight to the Library                       |
| `rejected`  | Dismissed — kept on record so the same trajectory isn't re-captured |

**You rarely need to act here.** Sessions is the raw log that _feeds_ Recommended; it is not your skill library. The per-row **Promote** is an escape hatch for when you already know a single session is worth keeping. **Reject** removes noise from the clustering pool.

---

## Recommended

This is the surface that matters. When **two or more similar sessions** cluster together, Ptah synthesizes them into **one** generalized, repo-agnostic skill, runs it past a quality judge (novelty, actionability, scope, generalization, trigger clarity), and only then proposes it here.

For each recommendation you can:

- **Review** — opens the rendered `SKILL.md` so you can read the actual instructions, not just a title.
- **Edit** — change the title, the description (the "when to use" trigger), and the body **before** accepting. Your edits are what get saved.
- **Accept** — materializes it into the Library as a real skill on disk.
- **Dismiss** — drop it (optionally with a reason); the cluster won't be re-proposed.

Recommendations are produced by the **Curator** pass — it runs on a schedule, or immediately when you click **Run Curator** in the header. A fresh install with few sessions will show an empty state until enough similar sessions accumulate.

:::tip
The synthesized name, description, and body all follow skill-authoring best practices, but they're a starting point. Skim the body and tighten the trigger before you Accept — a sharp description is what makes the skill fire at the right time.
:::

---

## Library

Your **active** skills, agents, and commands — the ones that actually load and run. Each row is a local copy in `~/.ptah/…` that Ptah can improve over time.

| Status     | Where it came from                                           |
| ---------- | ------------------------------------------------------------ |
| `authored` | Built-in or hand-written by you (e.g. the specialist agents) |
| `clone`    | Copied from an installed plugin/template                     |
| `synth`    | From a Recommended skill you Accepted                        |
| `diverged` | A clone whose upstream changed after you locally enhanced it |

**Invocations** and **Success** are usage-derived and stay blank (`—`) until the skill is actually used in a tracked run. The eligibility tag next to each row tells you where it is in the auto-enhance loop:

- `N/M runs` — needs more usage before it auto-enhances
- `cooldown Xh` — recently enhanced; on cooldown
- `ready` — eligible on the next Curator pass

**Auto-enhancement**: once a skill/agent/command has enough recorded runs, the Curator rewrites it against its recent usage (judge-gated), snapshots the previous version to **History**, and re-propagates it. Controls:

- **Enhance now** — run it manually, regardless of the usage threshold or cooldown.
- **Revert** — roll back to any History snapshot.
- **Rebase to upstream / Keep mine** — only on `diverged` rows, to resolve an upstream change.

---

## Activity & Settings

**Activity** shows the eligibility histogram (how many recent sessions were accepted vs. skipped and why) and when the last analyze/curator pass ran — useful when you expect a recommendation and don't see one.

**Settings** is a read-only mirror of the `skillSynthesis.*` keys (promotion threshold, judge minimum score, dedup thresholds, caps). Edit them from the main Settings view.

---

## Housekeeping: should I delete old sessions?

Short answer: **you can, but you don't have to — and they are not your skills.**

The rows in **Sessions** are raw candidates. They live entirely separately from your **Library** (the active skills). Deleting them does **not** remove or affect anything that runs. So a list full of `tribunal-…-panelist-…` captures is clutter, not corruption.

The one reason to clean them up: candidates **feed the clustering** that produces Recommended skills. Lots of near-identical machine-generated captures (subagent transcripts especially) can cluster into low-value recommendations. Rejecting the obvious noise keeps Recommended focused.

How to dispose of them:

- **Reject** transitions a candidate to `rejected`. There's no hard delete — the row is kept (without its body) so the same trajectory isn't re-captured later.
- Today this is **one row at a time**; there's no bulk "reject all". If you have a large backlog of generated noise, that's worth raising — a bulk cleanup is a reasonable enhancement.

:::note
Rejecting a candidate never touches the Library. If you've already **Accepted** a skill (so it's `synth` in the Library), the source candidates are safe to reject.
:::
