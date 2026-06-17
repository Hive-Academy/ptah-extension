---
title: Forge
description: Each vendor implements the same coding task in an isolated git worktree, vendors cross-review each other's diffs, and a judge merges the winner.
---

# Forge

Forge takes a **coding task** and runs it across your installed vendor panel — each vendor working in its **own isolated git worktree**. After everyone has implemented, vendors cross-review each other's diffs as peers, a judge ranks the implementations, and the winner is merged.

Where [Council](/tribunal/council/) debates an approach, Forge produces the best _implementation_ of a well-specified change — and the cross-vendor review tends to catch real bugs, because a peer reviewing real code finds concrete problems, not hypotheticals.

## When to use Forge

- **A well-specified change** with clear acceptance criteria, where the best implementation isn't obvious.
- **High-value code** worth getting multiple independent attempts at.
- **Cross-vendor review** — you want a Codex-family reviewer and a Claude-family reviewer to find different classes of problem.

:::tip
Forge needs a clear task. The implementations are only as comparable as the brief — spell out the acceptance criteria before you start. For open-ended "which approach?" questions, use [Council](/tribunal/council/) instead.
:::

## How it runs

### Phase 1 — Isolated implementation

Each vendor receives the same task brief and a clean git worktree branched from your current `HEAD`. They implement independently — no vendor sees what the others are producing. Worktree isolation is what lets them all touch the same files at once without colliding.

### Phase 2 — Round-robin cross-review

Each vendor reviews another vendor's diff (round-robin, so every implementation gets exactly one peer reviewer and no one reviews their own work). Reviews are anonymized — the reviewer sees "Implementation A", not the author's brand — and structured around correctness, test coverage, and risk.

### Phase 3 — Judge & merge

A judge reads every implementation plus its cross-review and ranks them against the acceptance criteria. You're shown the ranked verdict and each implementation's diff **before anything is merged**. On your confirmation, the winning branch is merged onto your active branch.

## Safety

- **Never merges to `main`** — the winner lands on your active working branch, and only after you've seen the diffs.
- **Worktrees are cleaned up** at the end (winners and losers), leaving your repo clean.
- **You see the ranking and diffs first** — nothing is merged silently.

## Invoking Forge

**Natural language triggers:**

- "Forge this across the panel"
- "Have each vendor implement this and pick the best"
- "Cross-vendor build of X"

**Explicit harness**: select **Tribunal Conductor** from the harness picker, then describe the coding task.

## Limitations

- **Needs a clear task and acceptance criteria** — vague briefs produce incomparable diffs.
- **Overlapping-file work** — Forge assumes vendors touch the same files (hence worktrees). For genuinely file-disjoint work, a standard [Orchestration](/agents/agent-orchestration/) run with parallel CLI delegation is cheaper.
- **Cost** — each vendor implements and reviews, so a Forge costs roughly `panel size × 2` vendor calls. Ptah announces the panel and cost before spending.
