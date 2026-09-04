# Council — deliberate (no code)

Fan one question to the panel, run an anonymized cross-critique round, and synthesize a cited verdict. **No file changes, no worktrees, no commits.** This is the safest move and the one to reach for on design decisions, research questions, "is this approach sound?", and second opinions.

Read [vendor-panel.md](vendor-panel.md) first — Council is that spine with a critique round in the middle.

---

## Flow

```
discover panel → announce → Round 1: ask everyone → Round 2: anonymized cross-critique → synthesize verdict
```

### Step 1 — Discover & announce

Build the panel (vendor-panel.md §1–2). Announce it and the plan (e.g. "5 vendors, 2 rounds ≈ 10 calls"). Get an implicit or explicit go-ahead before spending.

### Step 2 — Round 1: independent answers

Spawn every panelist with the **same self-contained question** and a fixed output contract, e.g.:

```
Question: <the user's question, fully restated>
Context: <all facts needed — paths, constraints, prior decisions>

Answer in this exact structure:
## Position    — your recommendation in 1–2 sentences
## Reasoning   — why, with concrete evidence
## Tradeoffs   — what you give up; when you'd choose otherwise
## Confidence  — high / medium / low + the biggest risk to your position
```

Poll and read all (vendor-panel.md §3). Tag each answer with its label `Pk`.

### Step 3 — Round 2: anonymized cross-critique

Build per-panelist packets (vendor-panel.md §4): each `Pk` sees the **other** answers as `Answer A / Answer B / …`, names stripped. Re-spawn each panelist:

```
Here are anonymized answers from other experts to the same question:

<Answer A …>
<Answer B …>

Your own earlier answer:
<Pk's answer>

Critique the others and pressure-test yourself:
## Strongest point   — which answer is most convincing, and why
## Flaws             — concrete errors, missed edge cases, unsupported claims (cite the letter)
## Revise?           — does any critique change your position? state your final position
```

Poll and read all critiques.

### Step 4 — Synthesize the verdict (you)

Map letters back to real vendors and write the cited verdict:

```
## Verdict
<the recommendation>

## Consensus
- <points all/most panelists agreed on> (P1, P3, …)

## Disagreements
- <the live splits> — <which side has stronger evidence and why>

## Panel
- P1 Codex — <one-line position>
- P2 Z.AI GLM-5.2 — <one-line position>
- …
```

Attribute substantive claims to the panelist(s) who made them. If the panel converged on something you believe is wrong, say so explicitly with your reasoning — you are a peer arbiter, not a vote-counter.

---

## Guidance

- **One round is usually enough.** Add a second critique round only when Round 2 revealed a genuine, unresolved split worth one more pass. Tell the user it costs another full panel of calls.
- **Keep questions decision-shaped.** Council shines on "X vs Y", "is this sound?", "what am I missing?" — not on open-ended generation.
- **Dropped panelists** (failed twice) are noted in the Panel section; the verdict proceeds with the survivors.
- **Never let a single loud vendor dominate** the synthesis — weigh evidence, not verbosity.
