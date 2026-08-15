---
title: The Skills Tab
description: How Recommended, Sessions, and Library fit together — and what to do with old session captures.
---

import { Aside } from '@astrojs/starlight/components';

# The Skills Tab

<Aside type="note" title="Electron only, by design">
This tab lives inside the Thoth shell alongside Memory, Schedules, and Gateway — all four are desktop-only. The subsystem needs `better-sqlite3` and an embedder worker, neither of which the VS Code extension host has. There's no VS Code parity roadmap for it; the gap is structural, not a missing feature.
</Aside>

The Skills tab has five sub-views. Three of them are the lifecycle of a skill; two are supporting. The Library is fed from **two** different doors — only one of them stops for your review:

```text
 a session runs
      │
      ▼
 ┌──────────┐
 │ Sessions │
 │ (raw)    │
 └────┬─────┘
      │
      ├─ same trajectory succeeds 3× + judge & gates pass ─────────▶ Library
      │  (no review — see How It Works, Track 1)                     (active)
      │
      └─ clusters with ≥2 similar + judge passes  ┌─────────────┐   you Accept
         ────────────────────────────────────────▶│ Recommended │──────────────▶ Library
                                                    │ (distilled) │  (+ edits)     (active)
                                                    └─────────────┘
   candidates                                        suggestions                   clones
```

- **Sessions** — every session Ptah captured that cleared the prefilter, raw. The feedstock — and, for a repeated workflow, sometimes the last place you'll see it before it's already in your library.
- **Recommended** — workflows Ptah distilled from clusters of similar sessions and a quality judge passed. These stop and wait for you.
- **Library** — the skills, agents, and commands that are installed and run, plus the loop that improves them from usage.
- **Activity** — diagnostics: why sessions were eligible or skipped, when queue passes last ran, and how much of today's background-learning budget is spent.
- **Settings** — thresholds and caps (read-only here; edit from the Settings view).

---

## Sessions

Each row is one **candidate** — a single captured session boiled down to its trajectory (turns, tool calls, outcome). The name and description are taken straight from the session, so they read like whatever you happened to be doing — including subagent transcripts (e.g. Tribunal panelists), which is why you'll see clusters of near-identical machine-named rows.

| Status      | Meaning                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| `candidate` | Captured, awaiting review, clustering, or the direct-promotion threshold           |
| `promoted`  | In the Library — either you promoted it, or it hit `successesToPromote` on its own |
| `rejected`  | Dismissed — kept on record so the same trajectory isn't re-captured                |

**You rarely need to act here.** Sessions is the raw log everything else feeds from; it is not your skill library. The per-row **Promote** is an escape hatch for when you already know a single session is worth keeping _now_, without waiting for the threshold. **Reject** removes noise from the clustering pool.

---

## Recommended

This is the surface built for review. When **two or more similar sessions** cluster together, Ptah synthesizes them into **one** generalized, repo-agnostic skill, runs it past a quality judge (novelty, actionability, scope, generalization, trigger clarity), and only then proposes it here.

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
| `synth`    | Auto-promoted, or a Recommended skill you Accepted           |
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

**Activity** shows the eligibility histogram (how many recent sessions were accepted vs. skipped and why), when the last analyze/curator pass ran, and today's background-learning token spend against the daily budget — useful both when you expect a recommendation and don't see one, and when you're wondering why nothing seems to be happening in the background at all. See [Background Learning](/skill-synthesis/background-learning/) for what the gates behind that spend are.

**Settings** is a read-only mirror of the `skillSynthesis.*` keys (promotion threshold, judge minimum score, dedup thresholds, caps, and the per-stage provider lanes). Edit them from the main Settings view.

---

## Housekeeping: should I delete old sessions?

Short answer: **you can, but you don't have to — and they are not your skills.**

The rows in **Sessions** are raw candidates. Aside from the ones that auto-promoted themselves, they live entirely separately from your **Library** (the active skills). Deleting a candidate does **not** remove or affect anything that already runs. So a list full of `tribunal-…-panelist-…` captures is clutter, not corruption.

The one reason to clean them up: candidates **feed the clustering** that produces Recommended skills, and repeats of the same trajectory feed direct promotion. Lots of near-identical machine-generated captures (subagent transcripts especially) can cluster into low-value recommendations, or rack up successes toward a promotion you didn't want. Rejecting the obvious noise keeps both paths focused.

How to dispose of them:

- **Reject** transitions a candidate to `rejected`. There's no hard delete — the row is kept (without its body) so the same trajectory isn't re-captured later.
- Today this is **one row at a time**; there's no bulk "reject all". If you have a large backlog of generated noise, that's worth raising — a bulk cleanup is a reasonable enhancement.

:::note
Rejecting a candidate never touches the Library. If a skill has already been materialized (so it's `synth` in the Library, whether you Accepted it or it promoted itself), the source candidates are safe to reject.
:::
