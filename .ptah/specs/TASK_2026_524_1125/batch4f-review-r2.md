# Batch 4f review (round 2)

Verdict: APPROVE

## Defects

None at blocker or major severity.

## Verified OK

- `app-state.service.ts:1109-1120`: the guard precedes all work. Each deep link gets an object token; `failed` and `cancelled` clear only that token, while `navigated` and `already-there` retain it. The identity check preserves a newer request when an older navigation finishes later.
- `app-state.service.ts:609-620,640-651`: `requestSurface` returns the existing navigation promise and still attaches `recordSettledSurface` with the same generation, workspace, surface, and result. Its other call sites (`:965,1021,1037,1069,1077,1183`) ignore the return as before.
- `app-state.service.ts:1128-1133`: consumption remains a one-shot boolean bound to the active workspace. `skill-synthesis-tab.component.ts:755-762` and `thoth-shell.component.spec.ts:186-209` use that unchanged API.
- `app-state.service.spec.ts:435-499`: tests cover failed/cancelled outcomes, `already-there`, a real Router supersede, and an older cancelled request resolving after a newer one. The latter test would fail if the older result cleared the current token.
- `app-state.service.spec.ts:408-412`: the comment correctly limits that test to the URL/request contract. The component-less route in `surface-router-testing.ts:17-27` cannot mount the shell; separate shell and Skills component specs cover tab settlement and filter activation.

## Notes

- The mocked `already-there` and delayed-result tests isolate request handling; they do not prove those Router outcomes. The real Router supersede test and the component specs provide the complementary coverage. No test appears to pass for a wrong reason that warrants revision.
- Read-only review. No tests, builds, lint, or typecheck were run in this round.
