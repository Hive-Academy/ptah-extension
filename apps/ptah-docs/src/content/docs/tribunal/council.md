---
title: Council
description: Fan one question to your installed vendor panel, run an anonymized cross-critique round, and converge on a cited verdict.
---

# Council

Council is the first and currently available Tribunal move. It takes one question and fans it across your installed vendor panel — each vendor answers independently, then each vendor critiques the others' answers (without knowing who wrote them), and a judge synthesizes a single cited verdict from the debate.

No code is written. No git changes happen. Council is for decisions, not implementations.

## When to use Council

- **Design decisions** — "Should we use event sourcing or a state machine for this workflow?"
- **Architecture tradeoffs** — "REST vs GraphQL for this API surface?"
- **Second opinions** — "Is this approach sound, or am I missing something?"
- **Research synthesis** — "What are the failure modes of this pattern at scale?"
- **Disagreement resolution** — "We're split on this. What do the models say?"

:::tip
Council shines when there's no obviously correct answer and the value is in understanding the tradeoffs. For tasks that have a right answer determinable by testing, prefer [Forge](/tribunal/forge/) or [Race](/tribunal/race/).
:::

## How it runs

### Phase 1 — Independent answers

Ptah fans your question to every vendor in the panel. Each vendor answers independently, with no visibility into what the others are producing. This prevents bandwagon agreement and surfaces genuine divergence.

Answers are collected in parallel. A Council over a 4-vendor panel takes roughly the same wall-clock time as a single vendor query.

### Phase 2 — Anonymized cross-critique

Each vendor receives the other answers in anonymized form — labeled "Vendor A", "Vendor B", etc. — and is asked to:

- Identify claims they agree with
- Identify claims they dispute, with reasons
- Identify what the other answers missed

Vendor identity is hidden during critique to prevent deference effects ("Well, if it's from Claude…").

### Phase 3 — Synthesis

A synthesis pass reads all original answers and all critiques. It produces a single **verdict** structured as:

- **Consensus** — claims all vendors agreed on
- **Disputed points** — claims that divided the panel, with each side's reasoning
- **Recommended position** — the synthesizer's call, with citations back to the vendor answers
- **Dissent (if any)** — minority positions worth preserving

The verdict identifies which vendor(s) supported each position, so you can trace every claim back to its source.

## Reading the verdict

The verdict appears inline in chat as a structured markdown document — consensus, disputed points, the recommended position, and any preserved dissent, with each claim attributed back to the vendor(s) that made it.

To go deeper, ask a follow-up (for example, "go deeper on the disputed point about transaction isolation"). A follow-up runs a fresh Council on the narrower question.

## Example flow

```text
You:  "Convene a council — should our background job processor use Redis queues
       or a Postgres-backed table?"

Phase 1  (parallel)
  Vendor A answers → Redis case + caveats
  Vendor B answers → Postgres case + caveats
  Vendor C answers → "it depends" + 4 criteria

Phase 2  (parallel)
  A critiques B and C (anonymized)
  B critiques A and C (anonymized)
  C critiques A and B (anonymized)

Phase 3  (synthesis)
  Consensus: Postgres is lower-ops overhead for most teams
  Disputed: at-least-once vs at-most-once guarantees differ
  Recommended: Postgres-backed queue unless throughput > 500 jobs/sec
  Dissent: Vendor C still argues the "it depends" position needs a throughput benchmark first

Panel size: 3 vendors
```

## Invoking Council

**Natural language triggers** (any of these start a Council):

- "Convene a council on this"
- "Second opinion from the panel"
- "Have the models debate this"
- "Multi-vendor review"
- "What do the other vendors think about this approach?"

**Explicit harness**: select **Tribunal Conductor** from the harness picker, then choose **Council** when prompted.

## Limitations

- **No code output** — Council produces a verdict document, not implementation. If the discussion produces a clear path, hand the verdict to an Orchestration run to build it.
- **Context length** — very long questions (>2000 tokens) can produce oversized answers in each phase. Break large context into a summary first.
- **Panel diversity** — a 2-vendor panel can reach a verdict but may not surface genuine disagreement. 3+ vendors are recommended for high-stakes decisions.
- **Synthesis is opinionated** — the synthesizer makes a call. If you want the raw debate without an imposed conclusion, ask for "the full debate without synthesis" in your prompt.

## Panel size & cost

Council discovers your installed vendors and uses one per family, defaulting to **3 concurrent** panelists. You can ask to widen or narrow the panel for a given run (for example, "use just two vendors" or "bring in every vendor"). Each panelist answer and each critique is a real, paid vendor call, so a Council costs roughly `panel size × 2` calls — Ptah announces the chosen panel before it spends anything.
