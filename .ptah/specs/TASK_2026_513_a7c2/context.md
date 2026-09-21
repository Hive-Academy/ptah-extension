# Context

## Observation (2026-09-21)

A session tile titled `lane b` in the Ptah Orchestra shows this header:

```
MODEL gpt-5.6-sol   TOKENS 3.8M   COST $2.55   TIME 6m 1s
```

The session itself runs on **Claude CLI** with an **Opus** model. The status bar
of the same tile reads `Claude CLI` at the bottom right. The model badge
therefore names a vendor and a model that the session does not use.

The last assistant message of that session carries its own footer:

```
3.1k tokens   $1.44   1m 7s
```

That footer disagrees with the header on every shared field.

During this session, background CLI agents were spawned through
`ptah_agent_spawn`. Several of them ran on a `codex` lane. The model string in
the header matches the family of that lane, not the family of the session.

## Hypotheses to test, in order

1. The header reads the model identity from the most recently spawned CLI agent,
   or from the last agent process that wrote into the session record, instead of
   from the session's own provider and model selection.
2. The token and cost totals aggregate the usage of spawned CLI agents into the
   owning session, so a session that orchestrates lanes accumulates their spend.
3. The cost figure is computed with a price table selected by the wrong model
   id. A wrong model id gives a wrong rate, so the cost is wrong even when the
   token count is right.
4. `TIME` measures a different interval from the per-message timer, for example
   the wall clock of the whole tile against the duration of one turn.

The four header fields may have four different sources. Do not assume one root
cause explains all of them.

## Questions the investigation must answer

1. For each of the four header fields (`MODEL`, `TOKENS`, `COST`, `TIME`), name
   the exact producer, with `file:line`: which service writes the value, which
   store holds it, and which component renders it.
2. Is the value written per session, per turn, or per spawned agent? Name the
   record and the key.
3. Where does a spawned CLI agent's usage enter that record? Is that deliberate
   (a roll-up of a lane's cost onto its orchestrator) or accidental?
4. Which price table produces the cost, and which model id selects the row?
5. Does the defect also appear without any spawned agent? Reproduce with a plain
   Claude CLI session that spawns nothing, and record the result.
6. Is the per-message footer correct? If the footer is right and the header is
   wrong, the two read different sources. Name both.

## Boundary note

If the intended product behaviour is that an orchestrator tile SHOWS the total
spend of the lanes it started, then the defect is only the model badge and the
missing attribution, not the total. Decide which behaviour is intended, and say
so before proposing a fix. Do not change the aggregation until that decision is
recorded.

## Acceptance criteria for the later fix

1. A session tile names the model that the session actually uses.
2. Token count and cost either belong to the session alone, or state plainly
   that they include the spawned lanes. One of the two, chosen deliberately.
3. The header and the per-message footer agree on their shared fields, or the
   difference between them is labelled in the interface.
4. Tests pin each of the four fields for: a session with no spawned agent, and a
   session that spawned an agent of a different vendor family.

## Evidence to attach

The investigation writes `investigation.md` in this folder with a table of the
four fields, their producers and the verdict for each hypothesis.
