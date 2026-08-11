---
name: tribunal
description: 'Multi-vendor ensemble workflows across whichever AI vendors the user has installed or configured — every installed CLI adapter plus every configured ptah-cli provider (Claude, Moonshot, Z.AI, Ollama Cloud, OpenRouter, …), always DISCOVERED via ptah_agent_list and never hardcoded — where disagreement and cross-vendor review are the SIGNAL, not noise. Five moves: COUNCIL (fan a question to N vendors, anonymized cross-critique, synthesize a cited verdict — no code), FORGE (same coding task per vendor in isolated git worktrees, round-robin cross-review of diffs, judge ranks, merge the winner), RACE (N attempts, judge-panel rubric, verify the winner before any commit), RELAY (one task through a plan→architect→implement→review pipeline, each phase run on a CLI vendor lane instead of a subagent, persisted to .ptah/specs; the phase→lane roster is PINNABLE — the user can name who plans, who architects, who implements and who judges, including the same vendor family twice on different models), CRUCIBLE (role-asymmetric loop — a cheap fast EXECUTOR lane writes the code, a stronger JUDGE lane from a different vendor family scores it against a frozen rubric and returns numbered defects plus a mentor note, executor revises, repeat until PASS or the round cap). TRIGGER on: "tribunal", "convene a council", "council of models", "forge", "race the models", "relay", "crucible", "judge and mentor", "executor and judge", "have a strong model review the cheap one", "X plans, Y implements, Z reviews", "second opinion", "multi-vendor", "ensemble", "panel of models", "have the models debate", "cross-vendor review", "which vendor does this best". DISTINCT from `orchestration` (that is the hierarchical default dev workflow where CLI agents are junior labor; this is a peer panel — or, in Crucible, a deliberately unequal pair — where vendor diversity is the product). Electron/CLI-leaning — needs installed CLI vendors.'
---

# Tribunal Skill

Convene **multiple AI vendors**, make them deliberate, compete, or grade each other, and render a single cited verdict. **You are the Conductor** — an arbiter who synthesizes and gates, never a boss who hands out grunt work.

Four of the five moves are a flat **panel of peers**. The fifth, Crucible, is deliberately **unequal**: a cheap executor lane and a strong judge lane from a different family, looping until the work clears a frozen rubric.

## What this is — and what it is NOT

|                     | `tribunal` (this skill)                                                                                                        | `orchestration` (the other one)           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Topology            | Flat **panel of peers** (Crucible: an unequal executor/judge pair)                                                             | Hierarchy (you → team-leader → juniors)   |
| Why multiple agents | **Diversity is the signal** — disagreement surfaces blind spots (Crucible: independence — a judge that did not write the code) | Throughput — parallel grunt work          |
| Vendor selection    | Deliberate **max spread**, one per family (Crucible/Relay: by **role fit**, and the user may pin lanes)                        | By task fit, from discovery               |
| Vendor output       | First-class evidence; cite it, don't overwrite                                                                                 | Junior labor; review then absorb          |
| Use it for          | Second opinions, debates, cross-vendor code review, "which model does this best"                                               | Default dev workflow (features, bugfixes) |

**Do NOT use Tribunal as the default development workflow.** For ordinary "implement X / fix Y" work, use `orchestration`. Tribunal triggers only on its own phrases (council / forge / race / relay / crucible / second opinion / multi-vendor / ensemble).

## Preflight: discover the panel (ALWAYS run first)

**First check for an explicit panel.** If the prompt already lists panelists as `[tribunal:<laneId>] … ptah_agent_spawn({ … })` lines, the user assembled the panel in the Tribunal UI — skip discovery and spawn those lanes verbatim (including duplicate vendors and per-lane `model` overrides) per [references/vendor-panel.md §0](references/vendor-panel.md). Otherwise build the panel by discovery:

1. Call `ptah_agent_list`.
2. Build the panel per [references/vendor-panel.md](references/vendor-panel.md) — one panelist per vendor **family**, where a family is each installed system CLI (its `cli` value) or each configured ptah-cli entry (its `providerName`). Take the families from the response; keep only entries reporting installed/available. Never filter against a vendor list written in these docs — new adapters and newly configured providers must join with no edit here.
3. **Announce the chosen panel to the user before spending any vendor calls** (each spawn is a real, paid call).
4. If fewer than **2** distinct families are available, say so and offer to proceed single-voice or stop. A tribunal of one is not a tribunal.

## The five moves

### Council — deliberate (no code) · available now

Fan one question to the whole panel, run an **anonymized cross-critique** round, then synthesize a **cited verdict**: consensus, live disagreements, and a recommendation. Use for design decisions, research, "is this approach sound?", and second opinions.
→ [references/council.md](references/council.md)

### Forge — build & cross-review · available now

Give each panelist its **own git worktree**, have them all implement the same task, run **round-robin cross-vendor review** of each other's diffs, then judge and **merge the winner** (never auto-merge to `main`). Use when you want the best implementation of a well-specified change.
→ [references/forge.md](references/forge.md)

### Race — compete & verify · available now

N attempts at one change, scored on a **fixed rubric**, with the top attempt **verified (tests/`/verify`) before any commit**. Losers are never committed. Use for high-stakes single changes.
→ [references/race.md](references/race.md)

### Relay — orchestrate one task across CLI lanes (no subagents) · available now

Run a **single task** through a phased pipeline — plan → architect → implement → review — with each phase executed by a **CLI vendor lane** instead of a `Task`-tool subagent. The Conductor is the sole spawner; each phase's output is persisted to `.ptah/specs/TASK_[ID]/`. Unlike the moves above, lanes get **different** prompts (one per phase) and run **sequentially**, with the cross-vendor review phase as the tribunal signal. The **roster is pinnable** — the user can name a lane per phase ("codex plans, Claude architects, Ollama GLM implements, codex on another model judges"), including the same family twice on different models; honor it verbatim rather than re-picking by family spread. Reach for it when you want orchestration's structured, auditable delivery but want the work done by external vendors.
→ [references/relay.md](references/relay.md)

### Crucible — cheap executor, strong judge, bounded revise loop · available now

A deliberately **unequal pair**: a cheap, fast **executor** lane writes the code; a stronger **judge** lane from a **different vendor family** scores it against a rubric frozen before the first spawn, and returns numbered defects (each citing `file:line`) plus a **mentor note** naming the pattern behind them. The executor revises; the loop repeats until `PASS`, a regression stop, or **2 revise rounds** — a 3rd only if the user asks, never a 4th. The judge never edits code, and its `PASS` is confirmed by the build before anything is presented. Use it when the quality bar can be written down in advance and you want strong-model quality at cheap-model cost.
→ [references/crucible.md](references/crucible.md)

## The shared spine

All five moves stand on the same discover → fan-out → poll → read → (cross-examine) → synthesize loop, plus the deterministic anonymization scheme. Read it once: [references/vendor-panel.md](references/vendor-panel.md).

## Your role (the Conductor)

- **Peer arbiter, not author.** Read every panelist's output as evidence. Cite who said what. Never silently overwrite a vendor's answer with your own.
- **In Crucible you also own the bar.** You write the rubric before the first spawn, freeze it, drop unevidenced defects, enforce the round cap, and verify a `PASS` against the build.
- **Anonymize during critique** so the round is about content, not brand (P1..Pn / Answer A..N).
- **Fan out judging** with the `Agent`/`Task` tool when the panel is large (≥4) or the rubric is multi-criterion; sequential is fine and cheaper for ≤3.

## Concurrency & cost discipline

- Default **3 concurrent** spawns in flight. Council (no worktrees) may widen with the user's say-so; Forge/Race stay tight. Crucible is **sequential round over round** — the judge cannot score work that is still being written — though a single round's executors may fan out (see Crucible-fanned), which needs the same announce-before-widening treatment.
- Every spawn — and every critique/review round — is a **real paid vendor call**. Panel size × rounds multiplies cost. Announce the panel and the number of rounds before spending. Crucible costs **2 calls per round**; announce the round cap up front and stop at it.

## Runtime note

The skill ships everywhere, but the panel only forms where CLI vendors are installed — realistically **Electron + the Ptah CLI**. On a VS Code box with no vendors, Tribunal degrades to a single-voice message rather than a panel.

## Reference index

| Reference                                                | Load when            | Status    |
| -------------------------------------------------------- | -------------------- | --------- |
| [references/vendor-panel.md](references/vendor-panel.md) | Any move (the spine) | Available |
| [references/council.md](references/council.md)           | Running a Council    | Available |
| [references/forge.md](references/forge.md)               | Running a Forge      | Available |
| [references/race.md](references/race.md)                 | Running a Race       | Available |
| [references/relay.md](references/relay.md)               | Running a Relay      | Available |
| [references/crucible.md](references/crucible.md)         | Running a Crucible   | Available |

**Loading protocol:** this SKILL.md loads on trigger; load `vendor-panel.md` for every move; load the per-move reference on demand. Never preload all references.
