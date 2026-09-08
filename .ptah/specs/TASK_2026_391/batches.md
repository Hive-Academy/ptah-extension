# TASK_2026_391 — batch breakdown

Source of truth for the defects: `codex-compaction-ui-analysis.md`.

Executor for every batch is a **codex CLI agent**, spawned through
`ptah_agent_spawn`. The orchestrator verifies and commits each batch.

## Wave 1 — parallel, file-disjoint

### Batch 1 — Tab-targeted compaction reload (primary defect)

Make `(sessionId, tabId)` the load identity so the reload writes into the same
tabs the clear emptied. Also stop the zero-token `preloadedStats` snapshot.

Files:

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`applyCompactionComplete` only)
- The four matching `.spec.ts` files

### Batch 2 — Model selector tab-awareness (secondary defect)

A global `config:models-list` refresh must not rewrite the model shown for a
resumed tab. Resolve the model from the tab, not from global state alone.

Files:

- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.spec.ts` (new)

Constraint: read-only against `TabState`. Batch 2 must NOT edit
`tab-manager.service.ts` — Batch 1 owns that file.

## Wave 2 — sequential, after Batch 1 lands

### Batch 3 — Regression evidence and cleanup

- Electron e2e: two tiles on one conversation, `/compact` from the non-first
  tile, assert both transcripts, lifetime stats, compaction count and model.
- Remove the temporary `[compaction-diag]` logging from
  `compaction-lifecycle.service.ts` and `session-loader.service.ts`.

Files:

- `apps/ptah-electron-e2e/src/specs/chat/*`
- The two `[compaction-diag]` call sites

## Gate

Each batch is verified with `npx nx run-many -t test -p <projects>` and
`npx nx run-many -t typecheck -p <projects>` before it is committed. Never
`nx test projA projB` — that runs only the first project.
