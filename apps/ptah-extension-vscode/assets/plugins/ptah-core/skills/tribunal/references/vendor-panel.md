# Vendor Panel — the reusable spine

Every Tribunal move (Council, Forge, Race) runs on this loop:

```
discover → select (family spread) → announce → fan-out spawn → poll → read → [cross-examine] → synthesize
```

This document is the single source for discovery, panelist construction, the spawn/poll/read loop, and the deterministic anonymization scheme. Load it for any move.

---

## 1. The panelist model

A **panelist** is a distinct `(transport, addressing, tier)` tuple, chosen for maximum vendor-family spread (one per family):

```
Panelist := {
  id:        "P1" | "P2" | ...        # stable anonymized label (assigned by panel order)
  label:     human name, e.g. "Z.AI GLM-5.2"
  family:    "codex" | "copilot" | "cursor" | "<providerName>"   # the diversity axis
  spawnArgs: one of
     { cli: "codex" }                                   # OpenAI GPT family (no resume — respawn on timeout)
     { cli: "copilot", model?: "claude-sonnet-4.6" }    # GitHub / Claude+GPT family
     { cli: "cursor" }                                  # Cursor CLI family (env-dependent install)
     { ptahCliId: "pc-...", modelTier: "opus" }         # a specific ptah-cli provider family
}
```

> Panelists addressed by `ptahCliId` use `modelTier: 'opus'` and let the provider's tier mappings resolve the concrete model (e.g. Moonshot → `kimi-k2.7-code`, Z.AI → `glm-5.2`). Never hardcode a model id here — new models flow in through the registry.

## 2. Selection algorithm (deterministic family spread)

1. Call `ptah_agent_list`.
2. Keep entries with `installed: true` (CLIs) / `available` (ptah-cli).
3. **Bucket by family** — native CLIs `codex`, `copilot`, `cursor`; then ptah-cli entries by `providerName` (`Moonshot`, `Z.AI`, `Ollama Cloud`, `OpenRouter`, …). The panel is **data-driven**: a family joins automatically wherever its entry reports installed, so `cursor` participates on machines where it is active and is simply absent elsewhere.
4. Take **one** panelist per family, ordered by `preferredRank`. ptah-cli entries carry their `ptahCliId` + `modelTier: 'opus'`.
5. Cap to the concurrency budget (default **3**; Council may widen with user consent — no worktrees, so cheap to grow).
6. Assign stable labels `P1..Pn` in panel order.
7. **Announce the chosen panel** (labels + human names) to the user before spending any calls.
8. If fewer than **2 families** remain, surface that and ask whether to proceed single-voice or stop.

## 3. Spawn → poll → read

Every prompt is **fully self-contained** — panelists share no context and have no memory of each other. Include absolute paths, all needed inputs, and an explicit output contract.

```
# fan out, ≤ MAX_CONCURRENT (default 3) in flight
for panelist Pk:
  agentId[Pk] = ptah_agent_spawn({
    task: <self-contained prompt + explicit output format>,
    ...Pk.spawnArgs,
    workingDirectory?,   # Forge/Race only — the panelist's worktree
    taskFolder?, files?
  })

# poll until settled
loop ptah_agent_status({ agentId }) every ~8s until status != "running"

# collect
ptah_agent_read({ agentId })   # capture full output, tag with Pk
```

**Failure / timeout handling:**

- `ptah-cli` and `copilot` support resume — re-spawn with `resume_session_id` (the `cliSessionId` from `ptah_agent_status`).
- `codex` is ephemeral (no resume) — respawn fresh.
- A panelist that fails twice is dropped from the panel with a note in the verdict; never block the whole tribunal on one vendor.

## 4. Deterministic anonymization (the cross-examination round)

To keep critique/review about **content, not brand**:

1. Labels `P1..Pn` are fixed by panel order (reproducible across a run).
2. For each panelist `Pk`, build a packet of **all other** outputs, presented only as `Answer A / Answer B / …` in a **fixed rotation**, with self-identifying phrases stripped (e.g. "As GLM…", "I'm Claude…", "As an OpenAI model…"). `Pk` never sees its own output labelled back to it.
3. The `letter → panelist` mapping is fixed for the whole run, so the same inputs always produce the same packets (auditable).
4. Re-spawn each panelist with: its own output + the anonymized others + a critique/review rubric.
5. **You** (the Conductor) map letters back to real panelists for the final synthesis. The user sees real vendor names in the verdict; the panelists never did during the round.

Anonymization is best-effort regex + instruction — a vendor may still self-identify in prose. Note that limitation; do not claim it is airtight.

## 5. Synthesis (your job)

Read all outputs + the cross-examination, then produce a **cited verdict**:

- attribute each substantive claim to the panelist(s) that made it,
- state points of **consensus**,
- state **live disagreements** (and which side has the stronger evidence),
- give a clear **recommendation**.

You are a peer arbiter. Do not replace the panel's reasoning with your own unexamined opinion — if you disagree with the whole panel, say so explicitly and explain why.

## 6. Cost & concurrency contract

- Default **3 concurrent** spawns; one critique/review round roughly doubles the call count (initial answers + cross-examination).
- Always announce **panel size × number of rounds** before spending.
- Prefer the cheapest tier that fits: Council on `opus` for reasoning-heavy questions; widen the panel only when the question warrants it.
