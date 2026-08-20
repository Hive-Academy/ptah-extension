# Vendor Panel — the reusable spine

Every Tribunal move (Council, Forge, Race, Relay, Crucible) runs on this loop:

```
discover → select (family spread) → announce → fan-out spawn → poll → read → [cross-examine] → synthesize
```

This document is the single source for discovery, panelist construction, the spawn/poll/read loop, and the deterministic anonymization scheme. Load it for any move.

---

## 0. Explicit panel (launched from the Tribunal UI) — honor it verbatim

When the conductor prompt already contains explicit panelist lines of the form:

```
[tribunal:<laneId>] <displayName> — ptah_agent_spawn({ <spawnArgs> }). <objective>
```

or — for the **role moves** (Relay, Crucible) — the same line with an additive parenthesised role token:

```
[tribunal:<laneId>] (<role>) <displayName> — ptah_agent_spawn({ <spawnArgs> }) with the objective below as the task.
[tribunal:<laneId>] (<role>) <displayName> — ptah_agent_spawn({ <spawnArgs> }). Phase: <role>. Deliverable: <specFolder>/<file>
```

the panel was **defined by the user in the Tribunal UI**. In that case:

- **Skip §2 discovery/selection entirely.** Do NOT call `ptah_agent_list` to re-pick the panel, do NOT apply family-spread, and do NOT collapse duplicate vendors — the user may deliberately convene several lanes of the **same** vendor on **different models** (e.g. two `Ollama Cloud` lanes, one on `glm-5.2`, one on `kimi-k2.7-code`).
- **Spawn exactly the lanes given, with exactly the `spawnArgs` shown.** Pass the `model` field through to `ptah_agent_spawn` unchanged — for `ptahCliId` lanes a raw `model` overrides the agent's tier mapping, so never substitute a tier or a different model id.
- **When a `(<role>)` token is present it is AUTHORITATIVE.** The `[tribunal:<laneId>]` tag grammar is unchanged; the token is an addition to the human-readable remainder, sitting between the tag and the `<displayName>`, wrapped in round parentheses and lowercase. It is one of `plan` / `architect` / `implement` / `review` (Relay) or `executor` / `judge` (Crucible). Read each lane's role off its token — do **not** infer it from lane order, and do **not** spend a round-trip asking the user to confirm a role the token already states. The framing repeats this as a line of its own: "Each lane's ROLE is stated below and is authoritative — do not infer it from lane order." A lane line carrying **no** token belongs to a flat move (Council, Forge, Race), which has no roles.
- **A `Spec folder:` line means the folder already exists — do not allocate another.** Role moves carry `Spec folder: TASK_YYYY_NNN (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.` Take that task id as given, write every deliverable under `.ptah/specs/TASK_YYYY_NNN/`, and skip the folder-scan id allocation entirely. If the framing carries **no** `Spec folder:` line, the UI could not allocate one — then allocate per the move's own reference file.
- Keep the `[tribunal:<laneId>]` tag as the literal first line of each sub-agent task. Everything else on this page (the spawn/poll/read loop §3, anonymization §4, synthesis §5) still applies.

Only fall back to the discovery/selection algorithm below when the prompt does **not** carry explicit panelist lines (i.e. Tribunal was triggered conversationally, not from the UI).

---

## 1. The panelist model

A **panelist** is a distinct `(transport, addressing, tier)` tuple, chosen for maximum vendor-family spread (one per family):

```
Panelist := {
  id:        "P1" | "P2" | ...        # stable anonymized label (assigned by panel order)
  label:     human name, taken from the ptah_agent_list row
  family:    the CLI's name, or the ptah-cli entry's providerName   # the diversity axis
  spawnArgs: one of
     { cli: "<value from the live ptah_agent_spawn enum>", model?: "<id>" }   # an installed system CLI
     { ptahCliId: "pc-...", modelTier: "opus" }                               # a configured provider, tier-resolved
     { ptahCliId: "pc-...", model: "<id>" }                                   # an explicit raw model on that provider
}
```

> **The vendor list is discovered, never hardcoded.** New CLI adapters ship between releases and every machine has a different set of providers configured, so the authoritative list is whatever `ptah_agent_list` returns right now — plus the live `cli` enum on the `ptah_agent_spawn` tool schema. Any vendor named anywhere in these references is an illustration, not a roster. A family that is installed/available joins automatically; one that is not is simply absent, and neither case needs a doc change.
>
> Claude is not privileged and not excluded: where the user has configured a Claude provider it appears as an ordinary ptah-cli entry and is addressed by its `ptahCliId` like any other lane.

> For panels **you** assemble (conversational trigger, §2), panelists addressed by `ptahCliId` use `modelTier: 'opus'` and let the provider's tier mappings resolve the concrete model — don't hardcode a model id, so new models flow in through the registry. For panels defined in the **Tribunal UI** (§0), spawn args may instead carry a raw `model` per lane; pass it through unchanged. Resume support differs per adapter — check `ptah_agent_status` for a `CLI Session ID` rather than assuming.

## 2. Selection algorithm (deterministic family spread)

1. Call `ptah_agent_list`.
2. Keep entries with `installed: true` (CLIs) / `available` (ptah-cli).
3. **Bucket by family** — each system CLI is its own family (its `cli` value); each ptah-cli entry is its own family (its `providerName`). Take the families from the response, not from a list in this document. The panel is **data-driven**: a family joins automatically wherever its entry reports installed/available, and is simply absent elsewhere — that is what lets new adapters and newly configured providers participate with no edit here.
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

- **Resume support is per-adapter — test for it, don't memorize it.** Call `ptah_agent_status`: if it reports a `CLI Session ID`, re-spawn with `resume_session_id` set to it and the lane continues from where it left off. If it reports none, that adapter is ephemeral — respawn fresh with the context restated in the prompt.
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
