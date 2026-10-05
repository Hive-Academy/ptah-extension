# Batch 13 report: "Keep this session" survives banner rebuilds (D.5, Decision 3 option a)

## Changed files
- CREATED `libs/frontend/chat/src/lib/services/session-rotation-keep.service.ts`: root-scoped (`providedIn: 'root'`) signal store of `sessionId:threshold` keys. API: `kept` (readonly), `isKept`, `keep`, `forgetSession`. Named `.service.ts` to follow the services folder convention (no `.store.ts` siblings except chat.store.ts).
- CREATED `.../services/session-rotation-keep.service.spec.ts`: keep per session/threshold, forgetSession drops only that session, unknown session is a no-op.
- MODIFIED `.../components/molecules/notifications/session-budget-banner.component.ts`: removed the local `keptKeys` signal and `rotationKey`; injects the store. `stage` computed reads `isKept`; `keepSession()` calls `keep`; the clear-on-advisory-gone effect now calls `forgetSession`. No wording change. Banner stays in the chat lib, so no chat-ui/chat boundary crossing.
- MODIFIED `.../session-budget-banner.component.spec.ts`: regression test: keep, destroy and recreate the banner in the same TestBed, rotation stays hidden; advisory cleared drops the keys, and a later crossing shows it again.

## Checks (all exit 0)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat` exit 0
- `npx nx run di-lint:lint` exit 0
- `npx nx run degradation-audit:lint` exit 0

## Visual review (before/after, dark + light)
Screen: chat view with a session whose context is over the rotation threshold ("This session is getting large" banner with Rotate session / Keep this session). Steps:
1. Open two chat tabs; in tab A get the rotation advisory showing (large session, rotation threshold crossed).
2. Click "Keep this session": banner disappears.
3. Switch to tab B, then back to tab A.
4. Before (base commit): the rotation banner reappears. After: it stays hidden.
5. Optional: reload the webview; the banner returns (store is not persisted, per option a).
Capture step 1 and step 4 in dark and light themes.
