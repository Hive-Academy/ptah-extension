---
title: Reviewing Candidates
description: What the raw session captures are, and how to promote or reject them before Ptah does it for you.
---

import { Aside } from '@astrojs/starlight/components';

# Reviewing Candidates

Candidates are the raw per-session captures in the **Skills tab → Sessions** sub-view. Some are feedstock for [Recommended](/skill-synthesis/the-skills-tab/#recommended); others are on a countdown to promoting themselves. For the full picture of how the tabs fit together — and which candidates take which road — see [How It Works](/skill-synthesis/how-it-works/) and [The Skills Tab](/skill-synthesis/the-skills-tab/).

<Aside type="caution" title="A candidate row can disappear on its own">
If the same trajectory keeps recurring, its success count climbs every time it's captured again. Once that count reaches `skillSynthesis.successesToPromote` (default 3) *and* the candidate clears the judge and the safety gates, it promotes itself — no click required. The row moves to `promoted` whether or not you ever opened it. Reviewing here is how you get ahead of that, not a gate that's waiting on you.
</Aside>

## Statuses

| Status      | Meaning                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| `candidate` | Captured, awaiting review, clustering, or the direct-promotion threshold        |
| `promoted`  | Live in the Library as `~/.ptah/skills/<slug>/SKILL.md` — by you, or on its own |
| `rejected`  | Dismissed — kept on record so identical trajectories aren't re-captured         |

Each row also shows **success** and **failure** counts — a high failure ratio is a hint that the capture isn't actually a good skill, and it's also the counter direct promotion watches.

## Manual actions

From a Sessions row:

- **Promote** — force-elevate a single candidate straight to the Library right now, without waiting for the success threshold. Runs through the same judge and gates as automatic promotion — it just skips the wait.
- **Reject** — remove it from the clustering pool _and_ stop it accumulating toward direct promotion (optionally with a reason). There's no hard delete — the row is kept without its body so the same trajectory won't be re-captured.
- **Select a row** — drills into the invocation history that produced it, so you can audit what Ptah noticed.

:::tip
If you want to see something before it can reach your library unattended, **Reject** obvious noise early (e.g. subagent transcripts) rather than waiting for it to either cluster into a low-value recommendation or quietly cross the promotion threshold.
:::

## RPC surface

For automation or A2A scenarios, the same actions are exposed as RPC methods:

| Method                            | What it does                                   |
| --------------------------------- | ---------------------------------------------- |
| `skillSynthesis:listCandidates`   | List candidates with current state             |
| `skillSynthesis:promote`          | Manually promote a candidate to a skill        |
| `skillSynthesis:reject`           | Mark a candidate as rejected                   |
| `skillSynthesis:listSuggestions`  | List the cluster-distilled Recommended skills  |
| `skillSynthesis:getSuggestion`    | Fetch one recommendation's full body           |
| `skillSynthesis:updateSuggestion` | Edit a pending recommendation before accepting |
| `skillSynthesis:acceptSuggestion` | Accept a recommendation into the Library       |
| `skillSynthesis:stats`            | Aggregate counts (candidates, promoted, etc.)  |

:::tip
If a promoted skill is misbehaving, you can edit `SKILL.md` directly — the file is yours. Re-saving in place keeps it active without re-triggering the promotion pipeline.
:::
