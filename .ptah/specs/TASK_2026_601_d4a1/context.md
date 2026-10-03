# TASK_2026_601 — Cursor split-key redaction and agy status lines

Two known limits left by TASK_2026_555 Batch 55a (`TASK_2026_555/batch-55a-report.md`, M-2 and M-4), both in
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.

## 1. Cursor: a key split across two assistant text deltas

`cursor-cli.adapter.ts` redacts the stored Cursor key (`redactSecrets(…, secretRedactions)`) on every emitted path.
Assistant text is redacted **per delta**. If the SDK splits the key across two text deltas, neither piece matches, so
the key reaches the stream and the UI. Every other path emits whole messages.

Fix direction: hold back the last `maxSecretLength - 1` characters of assistant text between deltas (a sliding
window), redact the joined text, and flush the tail at turn end, on abort and on error. Keep the latency small.

## 2. agy: a status line in the old tab-less format is listed as a model

`antigravity-cli.adapter.ts` `parseAgyModels`: when no stdout line has a tab (older agy), each non-empty line is a
model unless it ends in `...`, `…` or `:` or starts with `error|warning|fetching|loading|usage|failed`. A line such
as "Please sign in" is still listed and can be saved and passed as `--model`.

Fix direction: also require the command's exit code 0 for the old format, and/or reject lines with spaces that do
not look like a known label shape. Keep the old format working (it was restored on purpose).

## Acceptance criteria

1. Spec: a key split across 2 and 3 deltas never appears in output or segments; the full assistant text is still
   emitted once, in order.
2. Spec: "Please sign in" and similar lines are not models; the existing old-format label case still lists models.
3. Typecheck, lint, tests for `cli-agent-runtime` green.

## Out of scope

Other adapters.
