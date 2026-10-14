# R9u bounded correction report

| Finding | Fix | File:line | Spec case | Result |
| --- | --- | --- | --- | --- |
| N1 late pane registration leaves A's cached exclusion stale | `active` is a signal of an immutable host map; register and release update it so `liveElsewhere` tracks membership. | `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts:9,21,28,56` | `late-registered pane with the same active tab excludes it at once` (`rail-transcript-retention-coordinator.service.spec.ts:86`): A initially renders X; B registers X; A excludes X before B's active-tab effect; rendered view excludes X after detectChanges; unregister restores X. | PASS |
| N2 combined retention and eviction case | Split into distinct-count transfer and fifth-tab eviction cases with concrete assertions. | `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts:110,122` | `count <= 4 counts distinct tab trees`; `fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab` | PASS |
| Lint: non-null assertion | Guard the owner lookup before release. | `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts:75` | Coordinator spec | PASS |
| Lint: unused import | Removed `DisplayDockState` import. | `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:86` (former line) | Keepalive spec | PASS |

## Verification

- `node .ptah/tmp/check-run.mjs r9u-corr-2 -- npx nx test @ptah-extension/chat --testFile=rail-transcript-retention-coordinator.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 8 passed, 8 total`.
- `node .ptah/tmp/check-run.mjs r9u-corr-3 -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 9 passed, 9 total`.
- Scoped diagnostics: no diagnostics in requested files; the tool reported pre-existing errors in unrelated sibling files.
- Keepalive run logged recursive Angular tick and session restore console errors while all nine tests passed.

## Decisions

- Test N1 at the coordinator boundary with a registered pane stub. This keeps B's asynchronous active-tab effect from transferring X while the test checks registration and unregister invalidation. The test also renders A's computed list through a minimal component and checks it after each detectChanges.
- No `chat-view.component.ts` change; no canvas import or no-coordinator behavior change.

## Changed files

- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts`
- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- `.ptah/specs/TASK_2026_629_c0b3/lane-R9u-correction-report.md`
