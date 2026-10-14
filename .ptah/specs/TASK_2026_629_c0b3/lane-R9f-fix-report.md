# R9f fix round report

## Findings

| Finding | Fix | File:line | Spec case | Result |
| --- | --- | --- | --- | --- |
| S1 | Visible-tab registration follows parentActive; covered state only freezes rendering. | canvas-detail-transcript.component.ts:50,74 | keeps the parent tab registered while a sub lane covers the transcript and unregisters when parent deactivates | PASS |
| S2 | Real ChatView mounted through the Rail child injector, with context, retention and card actions. An id:chart surface opens and updates in one dock/panel. HIDE_AGENT_SIDEBAR is absent. This mirrors the chat dock spec's surface-store feed, without parsing literal markdown. | canvas-detail-transcript.component.spec.ts:59 | fenced display opens and updates in place in Rail host | PASS |
| S3 | Real transcript and stub ChatView instances persist across orchestrator, subagent and Back; draft and visibility state persist. Transcript spec also verifies real ChatView identity. | canvas-lane-view.component.spec.ts:293; canvas-detail-transcript.component.spec.ts:59,315 | keeps one transcript and draft while covering it, and focuses Back then restores the opener | PASS |
| S4 | Back receives focus after render. Back/Escape restore a connected opener or composer/transcript; editable and orchestrator Escape are ignored. | canvas-lane-view.component.ts:267,357; canvas-detail-transcript.component.ts:35 | keeps one transcript and draft while covering it, and focuses Back then restores the opener | PASS |
| S5a,b,d,e | Real ExecutionNode receives node and tile mode false. Rendered inline controls route Stop, message/steer, background and permission. Backgrounding keeps same sub lane. | canvas-lane-view.component.ts:150,202; canvas-lane-view.component.spec.ts:354 | mounts the real execution node in full mode and routes Stop through its inline bubble | PASS |
| S5c | Opened full lane renders a real ExecutionNode with a tool child and output; expanding its nested tool card renders the existing Copy output control. | canvas-lane-view.component.spec.ts:407 | renders nested Copy controls in the full lane | PASS |
| S5f | Nested sub:nested lane resolves and renders the nested agent node. | canvas-lane-view.component.spec.ts:273 | resolves a nested depth-2 agent by its own lane key | PASS |
| S5g | Rendered stub tile under real Rail child injector calls SESSION_CARD_ACTIONS; no single subagent view mounts. | canvas-detail-transcript.component.spec.ts:150 | Rail tile click selects sub lane through the real child injector without mounting the single view | PASS |
| M1 | Deleted duplicate sub lane Stop and permission group; inline bubble owns both. CLI lane permission controls remain separate. | canvas-lane-view.component.ts:145-155 | mounts the real execution node in full mode and routes Stop through its inline bubble | PASS |
| M2 | Match the same owned subagent after status changes to background. | canvas-lane-view.component.ts:202-212 | keeps the same sub-agent lane open when its record becomes backgrounded | PASS |
| M5 | Deleted unused lane stop() with duplicate header button. | canvas-lane-view.component.ts:357 | mounts the real execution node in full mode and routes Stop through its inline bubble | PASS |

## Checks

- node .ptah/tmp/check-run.mjs r9f-fix-18 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 failed, 1 total; Tests: 1 failed, 11 passed, 12 total. Test fixture used invalid execution status `completed`; corrected to `complete`.
- node .ptah/tmp/check-run.mjs r9f-fix-19 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 failed, 1 total; Tests: 1 failed, 11 passed, 12 total. Tool body was collapsed; test now opens it.
- node .ptah/tmp/check-run.mjs r9f-fix-20 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 failed, 1 total; Tests: 1 failed, 11 passed, 12 total. Expanding output needed the standard `provideMarkdown()` test provider.
- node .ptah/tmp/check-run.mjs r9f-fix-21 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 passed, 1 total; Tests: 12 passed, 12 total.
- node .ptah/tmp/check-run.mjs r9f-fix-15 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 passed, 1 total; Tests: 11 passed, 11 total.
- node .ptah/tmp/check-run.mjs r9f-fix-17 -- npx nx test @ptah-extension/canvas --testFile=canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache — Test Suites: 1 passed, 1 total; Tests: 8 passed, 8 total.
- Scoped ptah_get_diagnostics: no errors in four edited files; seven existing sibling-file errors. Transcript spec logs a SessionLoaderService mock RPC restore error while passing. Lane spec emits the existing NG0956 warning.
- No full suite, typecheck, lint, build or e2e run, per round instructions.

## Decisions

| Point | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| Visibility | Gate registration on parentActive, not cover. | Parent signal or covered signal. | Review S1 and visible-set test. | Yes, transcript component. |
| Background | Match owned subagent regardless of background status. | Match both statuses or migrate key to bg:. | Review M2 and transition test. | Yes, lane selector. |
| Focus | Capture opener, focus Back after render, restore opener or composer/transcript. | Local focus or board Escape. | Single-view focus pattern and lane focus test. | Yes, lane/transcript. |
| Stop and permission | Inline bubble owns subagent controls; remove duplicates and stop(). | Bubble or lane header. | Decision 93 and rendered-control test. | Yes, lane component. |
| Display | Feed DisplayDockState as chat-view.dock.spec.ts:927-951 does, under real Rail injector. | Store feed or markdown parser test. | Decision 93 and passing named spec. | Yes, spec only. |
| Copy | Exercise the existing nested Copy output control under the real ExecutionNode. | Nested tool output Copy or a new bubble control. | Decision row 97 and passing named lane spec. | Yes, spec only. |

## Not fixed

- M3, M4, M6, m1-m3: explicitly excluded by this round; NG0956 is recorded m3.

## Files changed

- libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts
- libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts
- libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts
- libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts
- .ptah/specs/TASK_2026_629_c0b3/lane-R9f-fix-report.md
