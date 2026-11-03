---
id: TASK_2026_577_cbfb
status: backlog
type: FEATURE
title: 'Consolidate near-duplicate memories already in the corpus with a scheduled, reversible merge job'
depends_on:
  - TASK_2026_572_07c4
created: '2026-09-30T13:53:38.000Z'
updated: '2026-10-12T19:41:51.738Z'
description: 'Merge runs only when a new memory is written, so the 26.7K existing memories are never combined. Add an idle-gated job that clusters existing memories by subject and embedding, merges each cluster into one memory, and quarantines the originals so the merge can be undone'
labels:
  - memory-curator
  - P2
relates_to:
  - TASK_2026_566_9a50
  - TASK_2026_568_3933
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Merge runs only when a new memory is written, so the 26.7K existing memories are never combined. Add an idle-gated job that clusters existing memories by subject and embedding, merges each cluster into one memory, and quarantines the originals so the merge can be undone

Full context, plan and discussion live in [./context.md](./context.md).
