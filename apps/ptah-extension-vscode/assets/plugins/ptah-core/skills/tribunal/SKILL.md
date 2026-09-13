---
name: tribunal
description: 'Runs multi-vendor ensemble workflows across whichever AI vendors the user has installed or configured, always DISCOVERED via ptah_agent_list and never hardcoded, treating disagreement and cross-vendor review as the signal rather than noise. Offers four moves — Council, Forge, Race and Crucible — for deliberation, competing implementations in isolated worktrees, judged attempts, and a cheap-executor/strong-judge revise loop. TRIGGER on: "tribunal", "convene a council", "council of models", "forge", "race the models", "crucible", "judge and mentor", "executor and judge", "second opinion", "multi-vendor", "ensemble", "panel of models", "cross-vendor review", "which vendor does this best", and a Tribunal UI launch of any move including "relay". Distinct from the orchestration skill, the hierarchical default dev workflow that also assigns phases to CLI lanes; this is a peer panel where vendor diversity is the product. Needs installed CLI vendors.'
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

1. **Explicit panel?** If the prompt lists `[tribunal:<laneId>] … ptah_agent_spawn({ … })` lines, the
   user built the panel in the Tribunal UI: spawn those lanes verbatim
   ([vendor-panel.md §0](references/vendor-panel.md#0-explicit-panel-from-the-tribunal-ui)).
2. **Otherwise discover** and build the panel by family spread
   ([vendor-panel.md §1–2](references/vendor-panel.md#1-panelists-and-families)).
3. **Announce** the panel, rounds and call count before spending.
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

**Relay** is no longer a tribunal move: running plan → architect → implement → review on CLI lanes is
orchestration with every phase assigned to a lane. A Relay launch from the Tribunal UI →
[references/relay.md](references/relay.md).

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
| [relay.md](references/relay.md) | A Relay launch from the Tribunal UI |

## Requires

- `agent-lanes` — every move. If it is not installed, tell the user to enable the `agent-lanes`
  skill; do not improvise lane rules.
- `orchestration` — Relay launches, and the task-folder rules Crucible writes into. If it is not
  installed, say which skill to enable before running either.
