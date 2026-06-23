---
name: tribunal
description: 'Multi-vendor ensemble workflows — a flat PANEL OF PEERS across different AI vendors (codex, copilot, cursor, and ptah-cli providers: Moonshot Kimi, Z.AI GLM, Ollama Cloud, OpenRouter) where disagreement and cross-vendor review are the SIGNAL, not noise. Three moves: COUNCIL (fan a question to N vendors, anonymized cross-critique, synthesize a cited verdict — no code), FORGE (same coding task per vendor in isolated git worktrees, round-robin cross-review of diffs, judge ranks, merge the winner), RACE (N attempts, judge-panel rubric, verify the winner before any commit). TRIGGER on: "tribunal", "convene a council", "council of models", "forge", "race the models", "second opinion", "multi-vendor", "ensemble", "panel of models", "have the models debate", "cross-vendor review", "which vendor does this best". DISTINCT from `orchestration` (that is the hierarchical default dev workflow where CLI agents are junior labor; this is a panel of peers where vendor diversity is the product). Electron/CLI-leaning — needs installed CLI vendors to form a panel.'
---

# Tribunal Skill

Convene a **panel of peer AI vendors**, make them deliberate or compete, and render a single cited verdict. **You are the Conductor** — a peer arbiter who synthesizes and judges, never a boss who hands out grunt work.

## What this is — and what it is NOT

|                     | `tribunal` (this skill)                                                          | `orchestration` (the other one)           |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| Topology            | Flat **panel of peers**                                                          | Hierarchy (you → team-leader → juniors)   |
| Why multiple agents | **Diversity is the signal** — disagreement surfaces blind spots                  | Throughput — parallel grunt work          |
| Vendor selection    | Deliberate **max spread** (one per family)                                       | Availability priority                     |
| Vendor output       | First-class evidence; cite it, don't overwrite                                   | Junior labor; review then absorb          |
| Use it for          | Second opinions, debates, cross-vendor code review, "which model does this best" | Default dev workflow (features, bugfixes) |

**Do NOT use Tribunal as the default development workflow.** For ordinary "implement X / fix Y" work, use `orchestration`. Tribunal triggers only on its own phrases (council / forge / race / second opinion / multi-vendor / ensemble).

## Preflight: discover the panel (ALWAYS run first)

**First check for an explicit panel.** If the prompt already lists panelists as `[tribunal:<laneId>] … ptah_agent_spawn({ … })` lines, the user assembled the panel in the Tribunal UI — skip discovery and spawn those lanes verbatim (including duplicate vendors and per-lane `model` overrides) per [references/vendor-panel.md §0](references/vendor-panel.md). Otherwise build the panel by discovery:

1. Call `ptah_agent_list`.
2. Build the panel per [references/vendor-panel.md](references/vendor-panel.md) — one panelist per vendor **family** (`codex`, `copilot`, `cursor`, and each ptah-cli `providerName`: Moonshot, Z.AI, Ollama Cloud, OpenRouter, …), keeping only `installed: true` entries.
3. **Announce the chosen panel to the user before spending any vendor calls** (each spawn is a real, paid call).
4. If fewer than **2** distinct families are available, say so and offer to proceed single-voice or stop. A tribunal of one is not a tribunal.

## The three moves

### Council — deliberate (no code) · available now

Fan one question to the whole panel, run an **anonymized cross-critique** round, then synthesize a **cited verdict**: consensus, live disagreements, and a recommendation. Use for design decisions, research, "is this approach sound?", and second opinions.
→ [references/council.md](references/council.md)

### Forge — build & cross-review · available now

Give each panelist its **own git worktree**, have them all implement the same task, run **round-robin cross-vendor review** of each other's diffs, then judge and **merge the winner** (never auto-merge to `main`). Use when you want the best implementation of a well-specified change.
→ [references/forge.md](references/forge.md)

### Race — compete & verify · available now

N attempts at one change, scored on a **fixed rubric**, with the top attempt **verified (tests/`/verify`) before any commit**. Losers are never committed. Use for high-stakes single changes.
→ [references/race.md](references/race.md)

## The shared spine

All three moves stand on the same discover → fan-out → poll → read → (cross-examine) → synthesize loop, plus the deterministic anonymization scheme. Read it once: [references/vendor-panel.md](references/vendor-panel.md).

## Your role (the Conductor)

- **Peer arbiter, not author.** Read every panelist's output as evidence. Cite who said what. Never silently overwrite a vendor's answer with your own.
- **Anonymize during critique** so the round is about content, not brand (P1..Pn / Answer A..N).
- **Fan out judging** with the `Agent`/`Task` tool when the panel is large (≥4) or the rubric is multi-criterion; sequential is fine and cheaper for ≤3.

## Concurrency & cost discipline

- Default **3 concurrent** spawns in flight. Council (no worktrees) may widen with the user's say-so; Forge/Race stay tight.
- Every spawn — and every critique/review round — is a **real paid vendor call**. Panel size × rounds multiplies cost. Announce the panel and the number of rounds before spending.

## Runtime note

The skill ships everywhere, but the panel only forms where CLI vendors are installed — realistically **Electron + the Ptah CLI**. On a VS Code box with no vendors, Tribunal degrades to a single-voice message rather than a panel.

## Reference index

| Reference                                                | Load when            | Status    |
| -------------------------------------------------------- | -------------------- | --------- |
| [references/vendor-panel.md](references/vendor-panel.md) | Any move (the spine) | Available |
| [references/council.md](references/council.md)           | Running a Council    | Available |
| [references/forge.md](references/forge.md)               | Running a Forge      | Available |
| [references/race.md](references/race.md)                 | Running a Race       | Available |

**Loading protocol:** this SKILL.md loads on trigger; load `vendor-panel.md` for every move; load the per-move reference on demand. Never preload all references.
