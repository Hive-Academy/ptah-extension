# B04 workspace tab launcher and generic chat hooks

Status: Complete. No generator start or visible UI was added.

## Files changed

Physical line counts at completion (paths relative to workspace root):

| File                                                                                    | Lines |
| --------------------------------------------------------------------------------------- | ----: |
| libs/frontend/chat-state/src/lib/tab-manager.service.ts                                 |  3243 |
| libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts                     |   692 |
| libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts                            |  1093 |
| libs/frontend/chat-state/src/lib/tab-workspace-partition.service.spec.ts                |   359 |
| libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts          |    65 |
| libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.spec.ts     |    85 |
| libs/frontend/chat-ui/src/index.ts                                                      |   209 |
| libs/frontend/chat/src/lib/tokens/session-context.token.ts                              |    74 |
| libs/frontend/chat/src/lib/components/templates/session-embed.component.ts              |   140 |
| libs/frontend/chat/src/lib/components/templates/session-embed.component.spec.ts         |   227 |
| libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts      |  1842 |
| libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts |  1613 |
| libs/frontend/chat/src/index.ts                                                         |    65 |
| libs/frontend/core/src/lib/routing/surface-routes.ts                                    |    65 |
| libs/frontend/core/src/lib/routing/surface-router.service.ts                            |   298 |
| libs/frontend/core/src/lib/routing/surface-router.service.spec.ts                       |  1113 |
| libs/frontend/core/src/lib/routing/surface-route-persistence.ts                         |   140 |
| libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts                    |   402 |

## Acceptance evidence

- Launcher results and same-workspace deduplication: generation-workflow-launcher.service.ts:25-63. Its four-spec suite covers landed, cancelled, failed, existing owner focus, and background focus preservation. tab-manager.service.ts:964-1015 supplies partition-scoped lookup and creation; tab-manager.service.spec.ts:77-130 covers active and loaded background creation.
- Unloaded partition or missing anchor: tab-manager.service.ts:992-995 and tab-workspace-partition.service.ts:428-430 refuse creation. The TabWorkspacePartitionService spec “refuses a missing anchor without mutating the background partition” and launcher failed-creation spec verify failure without a wrong-workspace insertion.
- Synchronous Stop: session-context.token.ts:55-59 defines the handled/not-handled hook; session-embed.component.ts:68-69,95-98 forwards it; chat-input.component.ts:1722-1727 checks it before ordinary abort. SessionEmbedComponent and ChatInputComponent specs cover handled and fallback behavior.
- Existing Send guard: chat-input.component.ts:1645-1646 checks before queueing. ChatInputComponent spec “keeps the canvas draft and attachments when nine other sessions run” asserts no sendOrQueueMessage call; null-guard cases assert ordinary Send.
- Route and restore: surface-routes.ts:44-64 parses the child path using existing setup-wizard ID; launcher service:55-58 navigates to generation/workflow/tabId. surface-router.service.ts:185-196 rejects unvalidated restored bindings; surface-route-persistence.ts:76-85 preserves the last valid route. SurfaceRouterService spec “rejects a generation route whose tab identity is absent or invalid” and SurfaceRoutePersistence spec “keeps the last route when a generation tab no longer belongs to the workspace” cover failure.
- Module boundary: generation-workflow-launcher.service.ts:1-4 imports chat-state, core, and shared only; no setup-wizard dependency.

## Checks

- Focused Jest passed: chat-state 2 suites / 90 tests; chat-ui 1 / 4; chat 2 / 92; core 2 / 84. After the final background-creation spec, tab-manager focused suite passed 63 / 63.
- Nx typecheck and lint passed for all 7 requested projects, serially.
- Nx test header confirmed “Running target test for 4 projects”; all four passed, serially with maxWorkers=2.
- ptah_get_diagnostics found no diagnostics in the requested changed core files. It reported errors in unrelated sibling specs; the scoped Nx typecheck gate passed.
- Prettier applied to changed source, specs, and report.

## Notes for B05

- Public launcher: GenerationWorkflowLauncherService.open(request: GenerationWorkflowOpenRequest): Promise<GenerationWorkflowOpenResult>. Request fields: workspacePath: string; workflow: SetupGenerationWorkflow; origin: string; focus?: boolean; afterTabId?: string. Result: { outcome: 'landed'; tabId: string } or { outcome: 'cancelled' | 'failed' }. Focus defaults to true.
- Public tab methods: findWorkflowTab(workspacePath: string, workflow: WorkflowKind): TabState | null; createWorkflowTabForWorkspace(workspacePath: string, workflow: WorkflowKind, title: string, afterTabId?: string): string | null. createTab gained optional third argument activate = true.
- Public Stop token: SESSION_STOP_HANDLER: InjectionToken<SessionStopHandler>; SessionStopHandler = (tabId: string) => 'handled' | 'not-handled'. The embed input is stopHandler. Return handled synchronously for a bound run and dispatch cancellation asynchronously. The absent handler returns not-handled. Existing SESSION_START_GUARD/startGuard remains the Send gate.
- Child path: /setup-wizard/generation/:workflow/:tabId. The workflow is setup-agent-generation or setup-project-prompt. Before boot restore, main app must provide { provide: SurfaceRouterService.generationRouteTabValidatorToken, useFactory: ... }. The callback receives (tabId, workflow) and must check that the tab exists in the current workspace with the exact workflow tag. Missing or false validation rejects a restored generation route; the normal boot fallback applies. The route shell must validate again on direct open and workspace changes.

## Decisions

| Decision                                                 | Options                                                        | Evidence                                                                            | Reversible |
| -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| Fail on missing background anchor or unloaded partition. | Append elsewhere; fail.                                        | B04 acceptance, batches plan issue 7, existing partition API.                       | Yes.       |
| Add optional activate parameter to createTab.            | Create and switch back; leave focus untouched during creation. | Existing createTab always selected its new tab; background requests preserve focus. | Yes.       |
| Let main app provide a route-tab validator through DI.   | Core imports chat state; callback from app.                    | Core owns routing, chat state owns tab identity, B05 owns app wiring.               | Yes.       |

## Deviations

The B04 file list did not include core/src/lib/routing/index.ts, so the validator token is exposed through the already public SurfaceRouterService.generationRouteTabValidatorToken static member. B05 must provide it before restoration. No new file outside the assigned list was retained.

## Proposed Removals

None.
