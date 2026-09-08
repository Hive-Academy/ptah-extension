# Architecture review — TASK_2026_304

Canonical deliverable: [plan-review-codex.md](./plan-review-codex.md).

The full review is stored there. Verdict: reject the current 10-batch plan; replace session-key threading through the singleton adapter with a durable, fail-closed, in-process private-session runtime and owned provider-profile lease. A worker or Electron utility process is not justified without measured SDK static-state or crash-isolation requirements.
