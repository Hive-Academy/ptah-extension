---
title: Reviewing Candidates
description: What the raw session captures are, and how to promote or reject them.
---

# Reviewing Candidates

Candidates are the raw per-session captures in the **Skills tab → Sessions** sub-view. They're the feedstock for [Recommended](/skill-synthesis/the-skills-tab/#recommended) — not your finished skills. For the full picture of how the tabs fit together, see [The Skills Tab](/skill-synthesis/the-skills-tab/).

## Statuses

| Status      | Meaning                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `candidate` | Captured, awaiting review or clustering                                      |
| `promoted`  | Force-promoted straight to the Library as a `~/.ptah/skills/<slug>/SKILL.md` |
| `rejected`  | Dismissed — kept on record so identical trajectories aren't re-captured      |

Each row also shows **success** and **failure** counts — a high failure ratio is a hint that the capture isn't actually a good skill.

## Manual actions

From a Sessions row:

- **Promote** — force-elevate a single candidate straight to the Library, before it clusters or hits the success threshold. Use it when you already know one session is worth keeping.
- **Reject** — remove it from the clustering pool (optionally with a reason). There's no hard delete — the row is kept without its body so the same trajectory won't be re-captured.
- **Select a row** — drills into the invocation history that produced it, so you can audit what Ptah noticed.

:::tip
You rarely need to act in Sessions. The curated review surface is **Recommended**, where clusters of similar sessions have already been distilled and judged. Sessions is mostly useful for rejecting obvious noise (e.g. subagent transcripts) so it doesn't cluster into low-value recommendations.
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
