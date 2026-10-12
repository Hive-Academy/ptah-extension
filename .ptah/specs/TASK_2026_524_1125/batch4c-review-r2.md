# Batch 4c cross-side review — round 2

**Verdict: REVISE.** Static review only; no checks run in this lane.

## Round 1 disposition

1. **Restored `/chat/B` discarded before workspace tabs load — Resolved** (`libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:150-159,187-199`). A valid absent ID is held while Electron's workspace path is null, then checked against the loaded tabs. `TabManagerService` loads panel state synchronously (`tab-manager.service.ts:637-658`); `switchWorkspace` applies the workspace tab set synchronously after the partition sets the path (`tab-manager.service.ts:760-773`, `tab-workspace-partition.service.ts:193-226`). A settled `/chat/B` with B in the first workspace now selects B without an intervening correction.
2. **In-flight correction undoes a newer tab switch — Resolved for the reported sequence** (`chat-tab-route-sync.service.ts:129-166,169-181,238-249`). An own correction landing on A while B is active is treated as stale; a tab change observed while navigation is pending is carried into the landing. The two routed race specs at `chat-tab-route-sync.service.spec.ts:399-423` cover both effect timings.

## Defect

3. **The first-load exemption can swallow a real selection** — `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:170-180,187-199`. Start Electron with held `/chat/B`, legacy A active, and no workspace. In one synchronous turn, `switchWorkspace('/ws')` loads `[A,B,C]` with A active, then a caller selects C before Angular runs this effect. The effect observes `ready=true`, `active=C`, and `becameReady=true`; the held-ID branch switches back to B. If the URL navigation is still pending, line 180 likewise suppresses the only signal that C was picked, and `followUrl` selects B on landing. The specs separate workspace load from user selection with `await settle()` (`chat-tab-route-sync.service.spec.ts:317-319`), so neither variant is covered. Preserve a selection made after the workspace load even when both changes are coalesced into the first ready effect.

## Notes

- The `VSCodeService.isElectron` flag is read from the boot configuration (`vscode.service.ts:110-135,172-173`); VS Code needs no workspace wait. The Electron readiness claim is valid for the first synchronous workspace switch, although the path is set before `TabManagerService` applies the returned tabs; signal effects see the completed call.
- On a later Electron workspace switch, readiness stays true and an active-ID change replaces the old workspace URL; if navigation is pending, the in-flight flag makes the landing stale (`chat-tab-route-sync.service.ts:169-203`). No new loop or subscription leak is evident; `start()` is idempotent and the router subscription is released through `DestroyRef` (`chat-tab-route-sync.service.ts:101-125`).
- With no Electron workspace folder, an unknown but well-formed ID remains held and may be persisted. It cannot select a nonexistent tab; a later workspace load resolves it, and a tab selection drops it. This is a bounded restore ambiguity rather than a separate 4c defect.
