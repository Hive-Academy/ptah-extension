---
title: Skill Synthesis Settings
description: Thresholds, caps, and where promoted skills land.
---

# Skill Synthesis Settings

All settings live in `~/.ptah/settings.json` under the `skillSynthesis.*` prefix. Edit through **Settings → Skill Synthesis**.

## Reference

| Key                                   | Default | What it does                                                                               |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `skillSynthesis.enabled`              | `true`  | Master kill-switch — disables both detection and promotion                                 |
| `skillSynthesis.successesToPromote`   | `3`     | Successful repetitions required before a candidate auto-promotes                           |
| `skillSynthesis.dedupCosineThreshold` | `0.85`  | Embedding similarity above which a trajectory is treated as a duplicate of an active skill |
| `skillSynthesis.maxActiveSkills`      | `50`    | LRU cap on active skills; oldest unused is archived when full                              |
| `skillSynthesis.candidatesDir`        | `''`    | Override location for promoted skills; empty string means `~/.ptah/skills/`                |

## Tuning notes

- **Lowering `successesToPromote` to `2`** makes Ptah eager — you'll get more skills faster, including some you'd reject. Pair with active review.
- **Raising `dedupCosineThreshold` to `0.92`** allows near-duplicates through. Useful if you want fine-grained variations of a workflow as separate skills; usually the default is what you want.
- **`maxActiveSkills`** is a soft governance cap. Going much above 100 makes the orchestrator's skill-matching slower without obviously improving outcomes.

:::tip
Want to keep candidates around forever for analysis without ever auto-promoting? Set `skillSynthesis.successesToPromote` to a very high number and use the **Promote now** button selectively.
:::
