---
title: Skill Synthesis Settings
description: Thresholds, caps, and where promoted skills land.
---

# Skill Synthesis Settings

All settings live in `~/.ptah/settings.json` under the `skillSynthesis.*` prefix. Edit through **Settings → Skill Synthesis**.

## Reference

| Key                                       | Default | What it does                                                                               |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `skillSynthesis.enabled`                  | `true`  | Master kill-switch — disables both detection and promotion                                 |
| `skillSynthesis.successesToPromote`       | `3`     | Successful repetitions before a single candidate is promoted directly                      |
| `skillSynthesis.suggestionMinClusterSize` | `2`     | Similar candidates required before a cluster is distilled into a Recommended skill         |
| `skillSynthesis.judgeEnabled`             | `true`  | Whether the quality judge gates promotion and recommendations                              |
| `skillSynthesis.minJudgeScore`            | `6.0`   | Minimum average judge score (of 10, across five criteria) for a skill to pass              |
| `skillSynthesis.dedupCosineThreshold`     | `0.85`  | Embedding similarity above which a trajectory is treated as a duplicate of an active skill |
| `skillSynthesis.maxActiveSkills`          | `200`   | Residency cap; the weakest resident is demoted to `dormant` (not deleted) when exceeded    |
| `skillSynthesis.curatorEnabled`           | `true`  | Whether the periodic Curator pass runs (clustering, recommendations, auto-enhancement)     |
| `skillSynthesis.curatorIntervalHours`     | `24`    | How often the Curator pass runs                                                            |
| `skillSynthesis.candidatesDir`            | `''`    | Override location for promoted skills; empty string means `~/.ptah/skills/`                |

## Tuning notes

- **Lowering `successesToPromote` to `2`** makes the direct-promotion path eager — more skills faster, including some you'd reject. Pair with active review.
- **Lowering `suggestionMinClusterSize`** would let single sessions become recommendations; the default `2` is deliberate so Recommended only shows genuinely repeated workflows.
- **Lowering `minJudgeScore`** lets weaker skills through; raising it makes Recommended stricter. The judge fails open, so an unavailable model never blocks the pipeline regardless of this value.
- **Raising `dedupCosineThreshold` to `0.92`** allows near-duplicates through — useful for fine-grained variations as separate skills; usually the default is what you want.
- **`maxActiveSkills`** is a soft governance cap. Demotion is to `dormant`, so nothing is lost when you exceed it.

:::tip
Want to keep candidates around forever for analysis without ever auto-promoting? Set `skillSynthesis.successesToPromote` to a very high number and use the **Promote now** button selectively.
:::
