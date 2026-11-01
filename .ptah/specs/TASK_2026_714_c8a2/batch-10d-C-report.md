# Batch 10d.C report

## Files and lines changed

- `libs/backend/cli-engine/src/lib/container.ts:113,769-770`: import and bind the CLI Codex lane factory before CLI agent runtime registration.
- `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:91-276` (new): gated CLI/TUI lane routing, shared home, lane identity store, pinned binary probe, child-owned runtime and cleanup.
- `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:1-338` (new): CLI/TUI selection, no-spawn detection, home/identity flow, pin refusal and scope lifecycle cases.
- `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:59,65,164-174`: verify the closed gate leaves the factory absent and does not alter surface composition.
- `apps/ptah-cli/src/di/container.smoke.spec.ts:499-519`: guard factory registration order and TUI reuse of cli-engine.
- `libs/backend/cli-engine/package.json:15`: declare the direct `@ptah-extension/codex-runtime` dependency.

## Spec cases

- Real `CliDetectionService` constructor: gate closed selects legacy Codex SDK adapter with no factory; admitted gate selects `CodexAppServerLaneAdapter`. TUI uses this same cli-engine registration.
- Adapter creation and detection do not use the process spawner. The CLI binary probe hashes the reviewed executable without running a version subprocess; a mismatched hash fails detection.
- Lane identity persistence writes the `lane` marker and resume recovers the context id. The selected `CODEX_HOME` reaches profile identity, credentials and catalog; the native adapter uses that same profile home for user MCP discovery.
- Empty `CODEX_HOME` warns once; queue messaging mode is retained; a missing reviewed pin refuses open.
- Open uses a child container; closing the owned context twice closes the runtime and disposes the child once. A failed open disposes the child.
- Surface composition stays usable when the lane gate is closed.

## Decisions

- **Gate-only CLI route.** Options: bind a factory by default or bind only when `CodexParityGate` admits `lane`. D28 in `task-10d-C.md` chooses the latter; this is reversible when parity evidence opens the gate.
- **Read-only CLI executable probe.** Options: reuse the adapter's default probe, which starts a version subprocess during detection, or hash the reviewed executable directly. The common rules require create/detect to spawn no process. The reviewed SHA-256 and pinned version identify the executable; this host-local probe is reversible.
- **Host-local runtime composition.** Options: import Electron app code or compose the runtime in cli-engine. The common rules forbid importing Electron into host-neutral libs; CLI reuses the public runtime and identity helpers. This is reversible.

## Not done

- No verify, tests, typecheck, lint, build, nx, npm or `ptah_get_diagnostics` were run, as explicitly prohibited by the batch rules. The coordinator owns validation.
- Skill discovery/loading was unavailable in this lane's listed tools; no skill instructions were inferred.

Verify projects: @ptah-extension/cli-engine, ptah-cli, ptah-tui, @ptah-extension/cli-agent-runtime, @ptah-extension/codex-runtime
