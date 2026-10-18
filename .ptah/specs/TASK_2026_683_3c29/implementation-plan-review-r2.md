REVISE

## Round-1 findings

| # | Status | Evidence |
| --- | --- | --- |
| 1 | RESOLVED | The deferred correction now requires an unchanged navigation/correction generation, an idle router, and a current chat URL before replacing it; rapid exits are explicit cases (`implementation-plan.md:369-405`). This addresses the original unconditional `replaceChatUrl` navigation (`libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:273-281`) and uses the existing in-flight intent exposed by `SurfaceRouterService.pendingSurface()` (`libs/frontend/core/src/lib/routing/surface-router.service.ts:91-107`). |
| 2 | RESOLVED | The snapshot is now scheduled for the first after-render write pass, checks `workActive()` and replay state, and freezes its marked IDs after one pass (`implementation-plan.md:424-451`). Real-transcript cases cover retained, empty, rapid, streaming, and resync paths (`implementation-plan.md:492-511`). This is a testable answer to the frozen vm (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:558-570`) and parent active binding (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:102-115`). The same-tick timing remains an implementation assertion for those tests to prove. |
| 3 | RESOLVED | U2 expressly assigns render-caused excess to TASK_2026_629, while motion-caused tasks over 50 ms fail; the overall maximum is still reported (`implementation-plan.md:668-684, 760-765`). This matches the stated user decision and retains measurement against the original 50 ms target (`context.md:9-13`). |
| 4 | RESOLVED | The rule now reads the first consumed primary URL segment, covers redirects, matrix parameters, children and rapid cancellation, and describes `skipTransition()` as occurring after creation (`implementation-plan.md:234-283`). Top-level route shapes and redirects match the argument (`apps/ptah-extension-webview/src/app/app.routes.ts:78-95, 141-160, 190-194`); the installed router passes root snapshots after calling `startViewTransition` (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:3685-3713, 3971-3977`). |
| 5 | RESOLVED | S7 specifies click receipt, keyboard navigation and focus samples in both hosts, plus rapid navigation and an interaction fallback (`implementation-plan.md:164-170, 635-646, 678-680`). The Electron remount focus path it names does read and restore `document.activeElement` (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:440-462`). The VS Code harness run still needs separate authorization under U4 (`implementation-plan.md:606-610, 958-962`); this is an execution gate, not an omitted plan case. |
| 6 | RESOLVED | F1 now separates DOM-order indexing from the inferred visible effect; F6/F7 remain measurement-gated assumptions (`implementation-plan.md:50-64, 78-86, 176-177`). It correctly calls the tail *trailing* and says it may be offscreen (`implementation-plan.md:108`). The source indeed mounts six trailing IDs irrespective of viewport (`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:20-25, 192-205`). This correction exposes new finding 1 below. |
| 7 | PARTIALLY | B1/B2 were divided into exclusive B1-B5 ownership and B0 now requires a recorded M0 fixture, not typecheck alone (`implementation-plan.md:837-936`). The reusable trace and session helpers exist (`apps/ptah-electron-e2e/src/support/perf-page-capture.ts:139-181`; `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:443-459`). Revised B0 adds a second host and S1-S8 to one lane, and B4 may absorb both conditional F6/F7 fixes (`implementation-plan.md:839-854, 902-919`); see new finding 2. |
| 8 | RESOLVED | B6 calls the jsdom assertion binding-only and requires M1 S8 frames with and without reduced motion (`implementation-plan.md:555-562, 944-955`). The pane is created under `@if (paneTab(side); as id)` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:157-165`), while installed Angular bypasses native enter animation without `getAnimations` (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14023-14038`). |

## New findings

1. **Medium — Session entrance selects mounted messages, not the newest visible messages.** U1 calls for a cascade of the newest visible messages (`implementation-plan.md:760-763`), but the proposed pass chooses up to six trailing `vm().slots` using `renderWindow.isMounted(id)` (`implementation-plan.md:210, 442-445`). The plan itself acknowledges that these may be above the viewport (`implementation-plan.md:108`). `isMounted` returns true for every tail ID and for IDs within a 2000 px observer margin, so it is not a visibility test (`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:3-10, 192-205, 245-252`). An offscreen predecessor can consume a stagger index and hold the actual visible bubble up to 140 ms; this preserves a smaller version of F1. **Required change:** specify an actual viewport-visible selection at the settled render boundary, assign indices only among those slots, and add a pinned long-thread case with fewer than six visible slots. Keep the six-item cap and avoid a forced layout by using known geometry or measured visibility state; if that cannot be done within the motion budget, make the tail-only behavior an explicit user decision.

2. **Medium — Revised B0 exceeds the one-lane budget and B4 has unbounded conditional work.** B0 now owns an Electron recorder covering eight scenarios, long tasks, trace, screencast, focus, memory and reduced motion, plus a separate VS Code interaction harness (`implementation-plan.md:591-613, 628-667, 837-854`). Existing helpers provide CDP trace and a Canvas session fixture, but not the full S1-S8 recorder or the VS Code interaction scenario (`apps/ptah-electron-e2e/src/support/perf-page-capture.ts:139-181`; `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:443-459`; `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/switch-view-navigation.e2e.spec.ts:16-47`). B4 also owns seven real-transcript cases and, if M0 confirms them, scroll and empty-state fixes (`implementation-plan.md:455-463, 492-511, 902-919`). These are unlikely to fit the stated <=40 tool calls per lane. **Required change:** split B0 into file-disjoint Electron and VS Code recorder lanes, with the orchestrator's M0 run as a separate gate; place confirmed F6/F7 fixes in separately owned follow-up batches after M0, leaving B4 the entrance and its focused spec. Preserve the U4 authorization boundary for running the VS Code harness.

## Batch check

| Batch | Exclusive file ownership | <=40 calls | Assessment |
| --- | --- | --- | --- |
| B0 | Yes: two new harness specs (`implementation-plan.md:839-841`) | No | Split as finding 2; recorded M0 remains an orchestrator gate. |
| B1 | Yes: core routing and webview wiring (`implementation-plan.md:856-872`) | Likely | Route feature, tracker and targeted specs are bounded. |
| B2 | Yes: global CSS and Electron shell (`implementation-plan.md:874-887`) | Likely | Three files, with a named-host spec. |
| B3 | Yes: URL sync service and spec (`implementation-plan.md:889-900`) | Yes | Focused guard and rapid-navigation cases. |
| B4 | Yes: transcript files and one spec (`implementation-plan.md:902-919`) | At risk | Core entrance is bounded; conditional F6/F7 work should move after M0. |
| B5 | Yes: ChatView, message-bubble template and spec (`implementation-plan.md:921-936`) | Likely | Focused switch edge and removal. |
| B6 | Yes within this plan: Canvas files and spec (`implementation-plan.md:938-956`) | Likely | External rail-board conflict is acknowledged and assigned a rebase gate. |

No B0-B6 file is assigned to two batches. B0's measurement outputs are an orchestrator artifact, not production file ownership (`implementation-plan.md:685-686`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Verdict: REVISE for the two Medium findings | Approve; revise | New findings 1-2; user U1 (`implementation-plan.md:760-763`); batch lists (`implementation-plan.md:837-919`) | Yes |
| Keep the after-render transcript snapshot contract | Immediate edge read; first active render write | `implementation-plan.md:429-451, 493-511`; frozen vm at `chat-transcript.component.ts:558-570` | Yes |
| Honor U2 and U4 without reopening them | Motion-caused excess fails here; render-caused excess follows TASK_2026_629; Electron measurement approved, VS Code run separately gated | `implementation-plan.md:681-684, 760-765, 958-962` | Yes |
| Select visible slots for the cascade and split the measurement lane | Mounted tail; viewport-visible set. One B0; separate harness lanes | `implementation-plan.md:108, 442-445, 837-854`; `transcript-render-window.ts:245-252` | Yes |

Read-only review. No plan or source edits, and no Nx, build, test, e2e, Electron or git commands were run.
