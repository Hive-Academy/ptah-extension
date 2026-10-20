# Implementation plan revision 2 — TASK_2026_593_7c2e

Gate 2 Round 1 re-review findings are resolved in `implementation-plan.md`. Line numbers refer to that file. User decision #21 supersedes #18 and `design-spec.md:56` (title clause); decisions #16–#17 remain unchanged. This was a document pass; no code or tests were run.

| Finding | Change made | Plan line(s) |
| --- | --- | --- |
| N1 | Split B1 into B1a ports and B1b settings; B1b owns both settings guard specs and runs their scoped checks. Removed B7 because its remaining surface composition specs test lazy push and RPC round trips, not attention. | 96–97, 113 |
| N2 | Normalize ask-user questions at host ingress; include the question producer and type in the ingress census and B3b check. | 56, 59, 101–102 |
| N3 | Electron phase 2 only registers SDK services; bootstrap attaches the coordinator immediately after binding the actual webview manager and detaches on shutdown. B4b no longer owns phase 2. | 56, 103–104, 113 |
| N4 | Add optional focus and reveal closures to `ElectronPlatformOptions`, supplied by bootstrap from the real BrowserWindow; test focus, restore, show/focus, and missing-capability fallback. | 63, 103 |
| n1 | B3b broadcast observes once, then uses an unobserved private per-panel send path. | 101 |
| n2 | Census asserts current attention producers do not wrap request events in `BATCH`. | 59, 101 |
| n3 | B3c now owns the existing `agent-events.spec.ts`; eight files total. | 102 |
| n4 | B5a names its vscode-core manager dependency and lazy `TOKENS.WEBVIEW_MANAGER` resolution; B3b precedes B5a. | 105, 113 |
| n5 | B4b pins the Electron coordinator as a separate exported constant, outside the handler-only `EXPECTED_RESOLVABLE` array. | 104, 113 |
| n6 | B3a and the first host adapter B4a must integrate before any push so di-lint sees the injected token's registration. | 113 |
| User decision #21 | Host notices for Electron, VS Code and any supported CLI notification include the session title without an opt-in setting. The host text builder truncates long titles and uses a generic label when absent. B3a tests inclusion, truncation, fallback and exclusion of other sensitive fields; the shared port contract and Electron/VS Code adapter tests check title propagation. Decision #21 supersedes #18 and `design-spec.md:56` (title clause). | 7, 55, 65, 96, 100, 103, 105, 120, 131 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Drop B7 | Retain and expand three surface composition specs, or drop unrelated row; drop it | Their existing assertions cover lazy push and RPC round trips (`apps/ptah-electron/src/di/surface-composition.spec.ts:126-178,239-293`, `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:155-271`, `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:157-243`). Attention has direct host ingress, adapter and DI specs. | Yes |
| Assert no batched request producers | Observe unwrapped CLI members or assert current producers never batch requests; use census assertion | CLI unwraps `BATCH` during dispatch (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:71-81`); review n2 says permission/question producers are not batched today. | Yes; change observer if batching is introduced |
| Inject separate Electron window capabilities | Extend `getWindow` or add optional focus/reveal closures; use closures | Existing `ElectronBrowserWindowApi` exposes only `webContents.send` (`libs/backend/platform-electron/src/implementations/electron-user-interaction.ts:53-58`); bootstrap has `getMainWindow()` (`apps/ptah-electron/src/activation/bootstrap.ts:253-262`). | Yes |
| Pair B3a with B4a before push | Use `isOptional` injection or forbid an intermediate push; pair rows | Review n6 identifies di-lint's unregistered injected token; B4a is the first registration. | Yes |
| Include session title in host notices | Always show title or require opt-in; always show title, with truncation and generic fallback | User decision #21: users need to link a notification to a session. It supersedes #18 and the title clause in `design-spec.md:56`. No title setting key is added. | Yes |
