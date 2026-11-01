# Batch 10d.L1 report

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:104`: added a live-writer contract and coded active-writer/close-failure errors.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:135`: adapters accept a shared registry keyed by the exact thread ID used by the identity store.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:304`: the single close path caches the close promise, marks the old handle closed, logs the original close error, and removes its registry entry only after a successful close.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:354`: registers the writer after identity persistence; the first turn remains busy during account binding and startup.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:392`: resume reserves the thread, refuses an active or starting turn, awaits an idle writer's close before runtime.open, and refuses a failed close. Failure paths clear only their own reservation.
- `apps/ptah-electron/src/di/codex-lane-composition.ts:231`, `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:273`, `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:242`: each host factory creates one registry and passes it to every adapter instance it creates.

## Decisions

- All three `CODEX_ADAPTER_FACTORY` registrations use `create: () => new CodexAppServerLaneAdapter(...)`; the adapter is per spawn, while the registered factory is host scoped. The registry therefore belongs to the host factory.
- The identity store reads and persists by the exact session/thread ID string, so the registry uses that same string as its key.
- A second resume sees a temporary busy reservation while the old writer closes or the new writer opens. The old handle loses continuation as soon as close begins. A failed close keeps the old registry entry so another writer cannot open.
- No resume gate, identity schema, MCP configuration, or turn mapper was changed.

## Specs added

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:348`: four fake-runtime cases cover close-before-open exactly once and old-handle continuation, active-turn refusal, different-thread isolation, and close-failure refusal with original-error logging.
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:181`, `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:110`, `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:218`: assert separate factory-created adapters share one registry.

## Verification and not done

- Tree-sitter parsed the changed adapter, its spec, and all three composition sources without errors. The Electron composition spec had three parser recovery nodes both before and after this edit; the other two composition specs parsed cleanly.
- Tests, typecheck, lint, build, Nx, npm, and `ptah_get_diagnostics` were not run, as required by the task's hard rules. No real Codex process or network model call was started.
- The local `agent-lanes` skill was read from `.claude/skills/agent-lanes/SKILL.md`; no native skill invocation tool was exposed, so filesystem reading was used.
