---
title: Pinning & Forgetting
description: Make memories permanent — or make them go away.
---

# Pinning & Forgetting

Memory is opinionated by default: useful memories rank higher, while unused memories move through an age-based lifecycle. Sometimes you need to override that.

## Pinning

Pinning exempts a memory from lifecycle archival, deletion, and cap eviction. Tiers are otherwise set by the writer, and a recorded use restores any archival row — pinned or not — to `recall`. A restored pinned row remains exempt from every lifecycle removal path.

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

## Lifecycle

Stored salience is an immutable base in `[0,1]`; recency and recorded use affect query-time ranking instead of rewriting that value. An unpinned recall memory that remains unused for 30 days moves to archival. If it remains archival for another 60 days, counted from its `archived_at` stamp, Ptah deletes it with its chunks, FTS rows, and vector rows.

Recorded use restores an archival memory to recall. Use includes memories injected into a prompt, MCP memory-search hits, direct `memory:get` and `mem:getObservations` reads, and curator merges. The per-workspace cap is 25,000 evictable rows: archival rows are evicted first after a 7-day grace, then recall rows. Pinned, core, and corpus memories are exempt. Deletion pauses when sqlite-vec is unavailable and the `memory_chunks_vec_ad` cleanup trigger exists; without that trigger, deletion proceeds.
