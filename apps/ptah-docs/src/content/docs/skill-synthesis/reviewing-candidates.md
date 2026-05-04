---
title: Reviewing Candidates
description: See what Ptah found, force-promote what you want, reject what you don't.
---

# Reviewing Candidates

Skill Synthesis is opinionated but not unilateral. The **Settings → Skill Synthesis** panel lists every trajectory Ptah has spotted, in any state.

## Statuses

| Status      | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `candidate` | Detected, counting invocations toward auto-promotion                     |
| `promoted`  | Materialised as `~/.ptah/skills/<slug>/SKILL.md` and live for all agents |
| `rejected`  | You said no. Won't be re-counted; identical trajectories stay suppressed |

Each row also shows **success count** and **failure count** — sessions where the trajectory ran but the user abandoned or retried push the failure number up. A high failure ratio is a hint that the candidate isn't actually a good skill.

## Manual actions

Three actions you can take from the panel:

- **Promote now** — force-elevate before the success threshold. Useful when you _know_ the workflow is worth abstracting and don't want to wait for two more repetitions.
- **Reject** — remove from candidate tracking. Optionally attach a reason; future identical trajectories won't recreate the candidate.
- **View source sessions** — jump to the sessions that produced the trajectory, so you can audit what Ptah noticed.

## RPC surface

For automation or A2A scenarios, the same actions are exposed as RPC methods:

| Method                          | What it does                                  |
| ------------------------------- | --------------------------------------------- |
| `skillSynthesis:listCandidates` | List all candidates with current state        |
| `skillSynthesis:promote`        | Manually promote a candidate to a skill       |
| `skillSynthesis:reject`         | Mark a candidate as rejected                  |
| `skillSynthesis:stats`          | Aggregate counts (candidates, promoted, etc.) |

:::tip
If a promoted skill is misbehaving, you can edit `SKILL.md` directly — the file is yours. Re-saving in place keeps it active without re-triggering the promotion pipeline.
:::
