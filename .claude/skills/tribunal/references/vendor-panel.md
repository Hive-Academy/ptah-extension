# Vendor Panel — the tribunal spine

Every move runs on this loop:

```
panel (explicit or discovered) → announce → fan out → collect → [anonymized cross-examination] → synthesize
```

This file owns what makes a panel a panel: explicit user panels, families, selection, anonymization and
synthesis. Running each lane — addressing, prompt contract, spawn/poll/read, resume, concurrency,
failures — is the [agent-lanes skill](../../agent-lanes/SKILL.md).

---

## 0. Explicit panel from the user

The user may name lanes, models and roles in plain text. Keep every requested panelist in
the stated order, including duplicate vendors or lanes. A role such as executor or judge
pins a Crucible lane; plan, architect, implement and review pin Relay phases. Do not infer
an omitted role from lane order. A task folder the user names in chat is used as given.

Call `ptah_agent_list` and resolve each pin against a live, spawnable row. Keep the
requested model and role. Report an unavailable or AT LIMIT pin and ask the user to
revise it; never silently substitute another lane or model. If no panel is pinned, use
the discovery rules below.

Present the resolved panel with roles and models, the round count and expected paid
call count. Get the user's confirmation before any `ptah_agent_spawn`.

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
picks the model. For explicit pins, use the resolved lane and the requested model.

## 2. Selection (deterministic)

1. Take the spawnable rows from `ptah_agent_list` (agent-lanes §1).
2. Bucket by family. Families come from the response — never from a list in these docs — so a newly
   installed adapter or configured provider joins with no edit here.
3. Take one panelist per family, in listed order.
4. Cap at the default concurrency. Council may widen with the user's consent; Forge and Race do not.
5. Assign `P1..Pn` in panel order.
6. Present labels, names, rounds and expected paid call count; confirm before spawning.
   Fewer than 2 families require asking the user.

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

One critique or review round roughly doubles the call count. Present the planned rounds and
expected paid call count, then get confirmation before spawning. Add a round only when the
previous one left a genuine, unresolved split.
