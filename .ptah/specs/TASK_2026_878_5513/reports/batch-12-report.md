# Batch 12 report: Boot runtime wrap and indexing RPC handler

- Task: TASK_2026_878_5513, Batch 12
- Commit: b8606532c
- Executor: indexing-backend subagent (session 3).

## Files

- libs/backend/thoth-runtime/src/lib/boot-thoth-runtime{,.spec}.ts
- libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers{,.spec}.ts

## Verification

Pre-merge verification (session 4, coordinator, worktree at 530250423 + uncommitted batches):
- `npm run verify -- -p @ptah-extension/memory-curator,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/thoth-runtime,@ptah-extension/skill-synthesis,mcp-bench`:
  lint + typecheck 12/12 succeeded. Tests: rpc-handlers, shared, thoth-runtime passed. Failures were
  (a) skill-trigger.integration.spec.ts expected `harvest('/ws')` without the Batch 17 origin
  argument (fixed, committed in Batch 17); (b) mcp-bench extraction cassette-miss test read raw
  event text that Batch 3 replaced with a fixed sentence (fixed, committed in Batch 3);
  (c) 5 s timeouts under load in memory-retention.integration, spec-harvester.service and
  snapshot-audits. Targeted re-runs (`-t test` with `--testPathPatterns`): skill-synthesis,
  memory-curator and the mcp-bench cassette-miss test passed. snapshot-audits still timed out on the
  branch; on main it passes (see the merged-state run below).
- `npm run verify -- -p @ptah-extension/ui,@ptah-extension/chat,@ptah-extension/core,@ptah-extension/webview-e2e-harness,@ptah-extension/memory-curator-ui`:
  lint + typecheck 10/10. Tests 3/4 + 1 cached; the one chat failure was a 5 s timeout in the
  unrelated chat-transcript.change-set.spec.ts, which passed on a targeted re-run.

Merged-state verification: after merging origin/main 0abc5e54c (bd83117de, migration renumbered to 0070), `npm run verify` over 14 projects (persistence-sqlite, memory-curator, shared, rpc-handlers, thoth-runtime, skill-synthesis, mcp-bench, ui, chat, core, webview-e2e-harness, memory-curator-ui, ptah-electron, ptah-extension-webview): lint+typecheck 26/28; the 2 lint failures (persistence-sqlite no-restricted-syntax in 0057/0058, webview 'Static imports of lazy-loaded libraries' in unchanged app files) also fail on main. Tests 15/19; every failure was environmental and passed on a targeted re-run: harness-root tests in rpc-handlers and ptah-electron saw a stray /tmp/.ptah (MCP spill folder, not ours) as the root and passed with TMPDIR=/var/tmp/b878, except plugin-rpc.handlers.session-notice.spec.ts which hard-codes /tmp paths; BootScanRunner given_up (unchanged file) and mcp-bench launchBenchHost/snapshot-audits passed on re-run.

## Review

Phase review by a codex lane (different family): see ../code-logic-review-phase-bc.md.
