---
id: TASK_2026_599_8684
status: backlog
type: REFACTORING
title: Return fixed text for every unexpected RPC error in the dispatcher
depends_on: []
created: "2026-10-03T12:09:56.822Z"
updated: "2026-10-03T12:09:56.822Z"
description: "rpc-handler.ts forwards errorObj.message for any non-RpcUserError exception; make the dispatcher return a fixed fallback (option 2), migrate the specs that assert raw text, and clear the agent RPC raw-error sites."
executor: backend-developer
estimate: L
labels:
  - rpc
  - security
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

rpc-handler.ts forwards errorObj.message for any non-RpcUserError exception; make the dispatcher return a fixed fallback (option 2), migrate the specs that assert raw text, and clear the agent RPC raw-error sites.

Full context, plan and discussion live in [./context.md](./context.md).
