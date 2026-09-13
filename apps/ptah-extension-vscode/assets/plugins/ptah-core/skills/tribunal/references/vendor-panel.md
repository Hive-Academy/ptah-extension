# Vendor Panel — the tribunal spine

Every move runs on this loop:

```
panel (explicit or discovered) → announce → fan out → collect → [anonymized cross-examination] → synthesize
```

This file owns what makes a panel a panel: explicit UI panels, families, selection, anonymization and
synthesis. Running each lane — addressing, prompt contract, spawn/poll/read, resume, concurrency,
failures — is the [agent-lanes skill](../../agent-lanes/SKILL.md).

---

## 0. Explicit panel from the Tribunal UI

The prompt carries panelist lines:

```
[tribunal:<laneId>] <displayName> — ptah_agent_spawn({ <spawnArgs> }). <objective>
[tribunal:<laneId>] (<role>) <displayName> — ptah_agent_spawn({ <spawnArgs> }) with the objective below as the task.
[tribunal:<laneId>] (<role>) <displayName> — ptah_agent_spawn({ <spawnArgs> }). Phase: <role>. Deliverable: <specFolder>/<file>
```

The user defined this panel. Then:

- **Skip discovery and family spread.** Do not collapse duplicate vendors — several lanes of the same
  vendor on different models is deliberate.
- **Spawn exactly the lanes given with exactly the `spawnArgs` shown**, `model` included.
- **A `(<role>)` token is authoritative.** `executor` / `judge` → Crucible
  ([crucible.md](crucible.md)); `plan` / `architect` / `implement` / `review` → a Relay launch
  ([relay.md](relay.md)). Never infer a role from lane order, and do not ask the user to confirm it.
  A line with no token belongs to Council, Forge or Race.
- **A `Spec folder: TASK_… (already created by the Tribunal UI)` line** means use that folder; do not
  allocate another. No such line on a role move → allocate one per the move's reference.
- Keep `[tribunal:<laneId>]` as the literal first line of each lane's task.

Only when the prompt carries no panelist lines, build the panel below.

## 1. Panelists and families

```
Panelist := {
  id:        P1 | P2 | …          stable label, by panel order
  label:     the ptah_agent_list row's name
  family:    the cli value, or the ptah-cli row's provider   ← the diversity axis
  spawnArgs: { cli, model? } | { ptahCliId, modelTier: 'opus' } | { ptahCliId, model }
}
```

For a panel you assemble, ptah-cli panelists use `modelTier: 'opus'` so the provider's own mapping
picks the model. A UI panel's raw `model` is passed through.

## 2. Selection (deterministic)

1. Take the spawnable rows from `ptah_agent_list` (agent-lanes §1).
2. Bucket by family. Families come from the response — never from a list in these docs — so a newly
   installed adapter or configured provider joins with no edit here.
3. Take one panelist per family, in listed order.
4. Cap at the default concurrency. Council may widen with the user's consent; Forge and Race do not.
5. Assign `P1..Pn` in panel order.
6. Announce labels and names before spending. Fewer than 2 families → surface it and ask.

## 3. Anonymization

For every critique or review round:

1. Labels `P1..Pn` are fixed for the whole run.
2. For each `Pk`, build a packet of **all other** outputs as `Answer A / Answer B / …` in a fixed
   rotation, with self-identifying phrases stripped ("As GLM…", "I'm Claude…"). `Pk` never sees its
   own output labelled back to it.
3. The letter → panelist mapping is fixed for the run, so the same inputs produce the same packets.
4. Each panelist gets its own output, the anonymized others, and the round's rubric.
5. You map letters back for the synthesis. The user sees vendor names; panelists never did.
6. A message to a live lane never carries another lane's vendor name.

Anonymization is best-effort instruction plus stripping — a vendor may still self-identify. Say so;
do not claim it is airtight.

## 4. Synthesis

Produce a **cited verdict**: attribute each substantive claim to the panelist(s) who made it, state
consensus, state live disagreements and which side has the stronger evidence, and give a clear
recommendation. A panelist dropped after repeated failure is named in the verdict.

## 5. Rounds

One critique or review round roughly doubles the call count. Announce panel size × rounds before
spending. Add a round only when the previous one left a genuine, unresolved split.
