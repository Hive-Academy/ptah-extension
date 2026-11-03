# Batch B2 report

## Files changed

- `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts`, `codex-lane-runtime-composition.spec.ts`, `codex-runtime-composition.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-binary.ts`, `codex-app-server-lane-binary.spec.ts`, `codex-app-server-lane.adapter.ts`, `codex-app-server-lane.adapter.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`, `cli-matrix-rows.spec.ts`, `cli-orchestration-matrix.component.ts`, `cli-orchestration-matrix.component.spec.ts`
- `libs/backend/lane-routing/src/lib/matrix/seed-matrix.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.settings-routing.spec.ts`, `agent-spawn-environment.service.spec.ts`, `agent-process-manager.service.spec.ts`

## Behavior

- CLI and TUI Codex lanes register on Linux, macOS, and Windows without parity or pinned-version admission. The CLI host registers one `CodexSelectionSnapshot` and uses it for lane detection, model listing, and runtime opens. The factory input retains `platform` with `{ readonly platform: string; readonly arch: string }`.
- Detection returns the selected path, version, `codexSource`, and `codexReason`. The lane adapter passes explicit model IDs unchanged and has no static model list, fallback list, or catalog cache. Catalog errors yield an empty list with a warning.
- An installed executable that rejects a required method before the first turn receipt triggers one bundled reopen through `activateFallback(selected, method)` in the CLI host. The old context is closed before retry.
- The existing CLI matrix shows one text line with selected Codex source/version and the bundled selection reason. RPC already forwarded detection results unchanged; its new spec covers provenance passthrough.
- Requested A3 assertions now use omitted/CLI-default model behavior or an explicit future model ID.

## Tests

- Specs were updated/added for platform registration, snapshot selection, detection provenance, dynamic catalogs, first-turn fallback, RPC forwarding, and the matrix line. Tests were not run because the lane instruction forbids tests and Nx.
- `ptah_get_diagnostics` on the three changed source areas returned unavailable after its 45-second timeout; coverage reported them unchecked.

## TypeScript check (filtered)

- Three permitted `npx tsc --noEmit` calls were used (two for `cli-agent-runtime`, one for `cli-engine`). The final `cli-agent-runtime` call reported **zero errors in B2-owned source files**. Its 16 errors were all in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts` (property narrowing and implicit parameters). The `cli-engine` call also reported an outside-scope optional-call error at `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:380`.
- Specs and Angular sources were not typechecked by those two lib configurations. The Ptah diagnostics service timed out, so their type status remains unverified.

## Decisions

- Reused the A1 snapshot contract in CLI composition, as B1 did for Electron; alternatives were a new lane selector or a separate detection probe. The shared snapshot is the existing repository pattern and can be replaced in one composition root.
- Kept `LaneModelSource` member `ptah-default` because `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/grok/grok-acp-profile.ts:63` still uses it. Removing it would break Grok; this is reversible when that adapter changes.
- Left `agent-rpc.handlers.ts` and `libs/shared/src/lib/types/rpc.types.ts` unchanged because the RPC handler already returns `CliDetectionResult` directly and the RPC type does not restate its fields.

## Open issues

- **Omitted-model startup remains blocked outside B2 scope.** `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:27` requires nonempty `model`; `libs/backend/codex-runtime/src/lib/codex-context.ts:139,262` forwards it as required. B2 can avoid a static default, but must currently project `undefined` to `''` at `codex-app-server-lane.adapter.ts:220` to meet the existing type; profile validation then rejects it. The CLI catalog likewise passes `model: undefined` at `codex-lane-runtime-composition.ts:173` and will fail until the core profile accepts an omitted model. Update that contract and add an omitted-model lane regression spec.
- Electron's `CodexLaneRuntimeProvider` in `apps/ptah-electron/src/di/codex-lane-composition.ts:161` has no `openFallback` implementation, so the adapter's first-turn method retry is presently CLI-only. B1 should mirror the CLI fallback composition.
- Outside-scope TypeScript errors remain in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:75` and `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:380` (see TypeScript check). No tests were run under the lane constraint.
- No skill-loading tool was listed for this lane, so no optional skill could be loaded.
