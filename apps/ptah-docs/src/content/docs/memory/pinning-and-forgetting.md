---
title: Pinning & Forgetting
description: Make memories permanent — or make them go away.
---

# Pinning & Forgetting

Memory is opinionated by default: salient stuff stays, stale stuff fades. Sometimes you need to override that.

## Pinning

Pinning a memory does two things:

1. **Exempts it from decay.** Half-life math doesn't apply.
2. **Locks its tier.** Pinned `core` memories stay in `core`; pinned `archival` memories stay searchable forever.

Use it for:

- Project invariants ("this codebase uses pnpm, not npm")
- User preferences you don't want to re-learn ("always use semicolons")
- Decisions you keep relitigating ("we settled on Clerk for auth in March")

In the **Memory** panel, click the pin icon on any row.

## Forgetting

"Forget" is a soft-delete. The row stays in `~/.ptah/ptah.db` for audit, but it's removed from search results and won't be surfaced to agents again.

Use it for:

- Stale facts you actively want gone
- Memories that landed wrong (curator hallucinations are rare but happen)
- Anything sensitive you'd rather not have re-injected into a future session

:::caution
Forgetting is not the same as deleting the underlying conversation. Session transcripts live in `<workspace>/.ptah/sessions/` and are independent of the memory store.
:::

## Decay

Unpinned memories decay exponentially. The half-life is `memory.decayHalflifeDays` (default `14`). After several half-lives without retrieval hits, a memory's salience drops below the cutoff and it's pruned from the active store.

Salience increases every time a memory is **retrieved and actually used** by the agent — so things you reference often stick around naturally.
