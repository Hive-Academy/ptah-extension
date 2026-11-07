---
id: TASK_2026_624_d671
status: backlog
type: FEATURE
title: "Memory bench: record extraction cassettes, add a provenance gate, first scored memory run"
depends_on: []
created: '2026-10-09T23:38:00.164Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Add a per-call provenance gate and a record-missing cassette mode to the tools/mcp-bench memory
  bench, then (after user approval for paid calls) record the memory suites and publish a scored run.
parent: TASK_2026_636_0add
estimate: L
labels:
  - memory-curator
  - skill-synthesis
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Follow-up to TASK_2026_620 (PR #686). Scope is memory only (rescope of 2026-10-14). The skill
funnel, namer and trigger suites were deleted in #788 (`7a4a307e7`), so their recordings are out.

1. **Per-call provenance gate** (code only): correlate model dispatches per call, not in
   aggregate.
2. **`record-missing` mode** (code only): serve the keys already in the local 229-entry extraction
   cassette and call the live model only for missing keys. Design the provenance contract for a
   cassette with entries from two runs (run id, corpus SHA, prompt SHA per entry; a changed prompt
   invalidates old keys; how acceptance treats a mixed cassette). Ask the user before you choose,
   and get a code-logic review of the design and the code before any recording. Never run the
   extraction plan in plain record mode: it replaces every key.
3. **Recordings, one at a time** (paid live calls; ask the user first): extraction
   (record-missing), dedup and scope-write. Copy accepted cassettes into the committed fixtures
   and replay once.
4. A CI run of the recorded suites, and the first scored memory scorecard. Update the "unscored"
   status in `docs/benchmarks/memory-skills-bench/`.

Never commit private bench data from the local bench folder; commit only accepted cassettes.

## Current state (2026-11-07)

- Not started. No `record-missing` mode exists in `tools/mcp-bench/src`.
- `--host-timeout-ms` already exists:
  `tools/mcp-bench/src/memory-skills/runner/run-memory-skills.args.ts:38-58`.
- The provenance sidecar is still aggregate: `tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts`
  (last change `3fc00d017`, 2026-10-09).
- Memory suites on main: `tools/mcp-bench/src/memory-skills/suites/memory/` (extraction, dedup,
  scope-write, read-side, update, retention, liveness).
- The TASK_2026_620 brief files are retired from `.ptah/specs`. Read them in git history:
  `git show ff531866f:.ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md`.

Full context, plan and discussion live in [./context.md](./context.md).
