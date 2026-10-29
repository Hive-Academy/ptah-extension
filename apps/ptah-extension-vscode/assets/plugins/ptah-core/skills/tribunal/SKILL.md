---
name: tribunal
description: 'Multi-vendor peer panel (Council, Forge, Race, Crucible) across installed CLI vendors. Use for second opinions, cross-vendor review, model debates, competing implementations, judged attempts, or a named Tribunal mode (Council, Forge, Race, Crucible, Relay) in main chat. Not the default build workflow — use orchestration.'
---

# Tribunal

Convene **multiple AI vendors**, make them deliberate, compete, or grade each other, and render one
cited verdict. **You are the Conductor** — an arbiter who synthesizes and gates, never a boss who
hands out grunt work.

|                     | `tribunal`                                                          | `orchestration`                                 |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Topology            | Flat panel of peers (Crucible: an unequal executor/judge pair)      | Hierarchy; phases on subagents or CLI lanes     |
| Why several agents  | **Diversity is the signal** (Crucible: independence of the judge)   | Throughput and specialization                   |
| Vendor selection    | Max family spread (Crucible: by role fit; the user may pin lanes)   | By task fit, or the user's roster               |
| Vendor output       | First-class evidence; cite it, don't overwrite                      | Work product; verify, then absorb               |
| Use it for          | Second opinions, debates, competing implementations, judged loops   | Default dev work, including all-CLI pipelines   |

Do not use Tribunal as the default development workflow.

## Preflight (always first)

1. **Read the user's mode and pins in main chat.** If the user names lanes, models or roles in plain text,
   resolve each pin against `ptah_agent_list` in the given order, including duplicates
   ([vendor-panel.md section 0](references/vendor-panel.md#0-explicit-panel-from-the-user)).
2. **Otherwise discover** and build the panel by family spread
   ([vendor-panel.md sections 1-2](references/vendor-panel.md#1-panelists-and-families)).
3. **Present** the resolved panel, rounds and expected paid call count; get the user's confirmation
   before any `ptah_agent_spawn`. Report unavailable or AT LIMIT pins without substitution.
4. **Fewer than 2 families** → say so; offer single-voice or stop. A tribunal of one is not a tribunal.

## The four moves

**Council — deliberate, no code.** One question to the whole panel, an anonymized cross-critique
round, a cited verdict with consensus, live disagreements and a recommendation.
→ [references/council.md](references/council.md)

**Forge — build and cross-review.** Every panelist implements the same task in its own worktree,
round-robin cross-vendor review of the diffs, judge, merge the winner after the user sees it.
→ [references/forge.md](references/forge.md)

**Race — compete and verify.** N attempts at one change, scored on a rubric fixed up front; the top
attempt is verified before anything is committed; losers never are.
→ [references/race.md](references/race.md)

**Crucible — cheap executor, strong judge.** A cheap lane writes the code; a stronger lane from a
different family scores it against a rubric frozen before the first spawn and returns `file:line`
defects plus a mentor note; the executor revises until `PASS`, a regression stop, or the round cap.
→ [references/crucible.md](references/crucible.md)

**Relay — phased lane workflow.** Invoke Relay through the `tribunal` skill in main chat.
Orchestration owns plan → architect → implement → review, with each phase assigned to a lane.
→ [references/relay.md](references/relay.md).

## The Conductor

- **Peer arbiter, not author.** Cite who said what. Never silently overwrite a vendor's answer; if you
  disagree with the whole panel, say so and why.
- **Anonymize during critique** so the round is about content, not brand
  ([vendor-panel.md §3](references/vendor-panel.md#3-anonymization)).
- **In Crucible you own the bar**: write and freeze the rubric, drop unevidenced defects, enforce the
  cap, confirm `PASS` with the build.
- **Fan out judging** with the `Agent`/`Task` tool for large panels (≥4) or multi-criterion rubrics.

Lane mechanics — spawning, polling, resume, concurrency, messaging, cost — are the
[agent-lanes skill](../agent-lanes/SKILL.md). Tribunal adds only: Council may widen past the default
concurrency with the user's consent (no worktrees); Forge and Race stay at the default; Crucible runs
rounds sequentially.

The panel forms only where CLI vendors are installed. With none, Tribunal degrades to a single-voice
answer and says so.

## References

| Reference | Load when |
| --- | --- |
| [vendor-panel.md](references/vendor-panel.md) | Every move |
| [council.md](references/council.md) · [forge.md](references/forge.md) · [race.md](references/race.md) · [crucible.md](references/crucible.md) | Running that move |
| [relay.md](references/relay.md) | Running Relay from main chat |

## Requires

- `agent-lanes` — every move. If it is not installed, tell the user to enable the `agent-lanes`
  skill; do not improvise lane rules.
- `orchestration` — Relay runs, and the task-folder rules Crucible writes into. If it is not
  installed, say which skill to enable before running either.
