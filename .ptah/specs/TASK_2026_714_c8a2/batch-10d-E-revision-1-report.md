# Batch 10d.E revision 1 report

## 1. Composition coverage

- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:1,59-395`: added a host composition fixture with a fake process spawner and runtime contexts. It covers lazy create/detect, chat and lane profile isolation across both open orders and a second lane, selected home flow through credentials/catalog/MCP, non-lane rejection, one scope disposal after repeated owned-context close, and disposal after failed open. The request-user-input and empty-home cases also live here.

## 2. Lane thread isolation

- `apps/ptah-electron/src/di/codex-lane-composition.ts:105-125`: selects a lane-only identity store and refuses resume from a row without the lane marker.
- `libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts:42-49,66-141`: stores `consumer: 'lane'`, rejects cross-consumer updates, and limits reads and inactive transitions to the requested consumer.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:124,1167-1170,1570-1591`: validates the marker, marks lane rows as children, and excludes them from workspace listings even when children are requested.
- `libs/backend/agent-sdk/src/lib/wiring/session-runtime-identity-cache.ts:52-57`: drops lane rows from the chat resume lookup.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:350-379`: regression for persisted lane identity remaining readable by the lane store while absent from chat listings, chat identity reads, and chat resume lookup.

## 3. Gate routing and D27

- `apps/ptah-electron/src/di/codex-lane-composition.ts:217-250`: every lane open passes through `resolveElectronCodexLaneRuntime`. An admitted gate resolves the gated runtime. An unpackaged host defaults to the raw scoped runtime. A packaged host with the gate closed registers no native factory, leaving legacy Codex lane selection in place. The chat development override is not consulted for lane selection.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:165-208`: asserts unpackaged raw routing, packaged closed rejection, and packaged admitted gated routing.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:1168-1200,1335-1348`: resolves the actual phase-2 detector and checks native selection when unpackaged and legacy selection when packaged with the gate closed.

## 4. CODEX_HOME handling

- `apps/ptah-electron/src/di/codex-lane-composition.ts:108-113`: HOME and USERPROFILE now use nonempty fallback; explicit empty CODEX_HOME is rejected before path resolution.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:139-142`: detection emits one fixed visible warning for that empty home.
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:379-395`: checks unavailable detection, one warning, and no process spawn.

## 5. Request user input

- `apps/ptah-electron/src/di/codex-lane-composition.ts:214-217`: the runtime port delegates to the lane approval sink, which emits the kind-only decline line, then returns an empty response.
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:346-378`: checks the decline response and exact `userInput` line without the question text.

## 6. Catalog profile

- `apps/ptah-electron/src/di/codex-lane-composition.ts:166-179`: catalog uses the lane model constant and a canonical temporary directory for workspace/cwd, independent of CODEX_HOME.
- `libs/backend/cli-agent-runtime/src/index.ts:51`: exposes the existing lane model constant through the library public API.
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:255-285`: checks the selected home, default model, neutral cwd, and selected home MCP names despite a different process environment home.

## 7. Smoke test

- `apps/ptah-electron/src/di/container.smoke.spec.ts:1168-1200,1335-1348`: replaced source-text ordering with resolution of the real `CliDetectionService` Codex adapter after phase-2 composition. The packaged case also verifies that no native factory was bound.

## Decisions

- **Lane identity marker:** Use `consumer: 'lane'` on the existing Codex thread record. Alternatives were a second storage key space or a separate store. The existing atomic thread updater and metadata listing path already carry this record, so a marker plus filtering is the smallest reversible change. Chat rows without the marker retain their current interpretation.
- **Packaged lane routing:** Bind the native adapter only after lane parity admission; keep the legacy adapter when the gate is closed. The reviewed D27 decision explicitly reserves the raw runtime for the unpackaged default. This is reversible when parity evidence admits the lane.

## Verification and limits

- Reviewed the touched source, port signatures, metadata projections, adapter lifecycle, and composition call sites manually. No verify, test, typecheck, lint, build, nx, npm, or `ptah_get_diagnostics` command was run because the task forbids them; the coordinator owns those checks.
- No skill-loading tool was available to this lane. No source change depends on a skill-specific workflow.

