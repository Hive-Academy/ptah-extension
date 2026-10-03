# Batch 55 logic re-check - TASK_2026_555

Same-side disclosure: this re-check was done by an in-process code-logic-reviewer subagent of the same orchestration that produced the fixes (the authors were in-process subagents too). It is not an independent or cross-side review. Read-only; the uncommitted rpc-handlers working-tree changes were not reviewed.

Verdict: **APPROVED WITH NOTES**. All seven findings are fixed; 0 new blocking or serious defects; 4 minor new notes.

Evidence run: `nx test` for core (36 suites / 1133 tests), rpc-handlers (132 suites / 3770 tests, 4 skipped) and platform-core (file-settings and migration specs) all green. The `--testPathPattern` flag was not applied by the target, so the whole projects ran; that is a wider check, not a narrower one.

## Status table

| Item | Status | File:line | Note |
| --- | --- | --- | --- |
| S-1 key text in logs/Sentry | FIXED | `ptah-cli-rpc.handlers.ts` `reportFailure` (end of file), all six catches call it; `agent-rpc.handlers.ts` setConfig catch (`{ errorType }`) and `writeCursorApiKey`; `auth-rpc.handlers.ts:1444-1451` deleteStoredKey | Logs and Sentry carry `error.name` and a fixed `new Error('<method> failed (<type>)')`. No `error.message` reaches either. |
| M-1 check/key-replace race | FIXED | `connection-check.ts:108-124` with `connection-check-recorder.ts:51-63,87` | Ticket is taken in `check()` before `run` starts (`begin` is synchronous, no await before it). A join happens only while `recorder.isCurrent(running.ticket)`; `clear()` takes a newer sequence, so a post-clear call starts a fresh check. The old run's `complete` is rejected, so no stale record is stored. The `finally` removes the map entry only if it is still its own (identity compare), so the old run cannot evict the new one. Joiners never get an old verdict. See N-1 for the original caller. |
| M-2 Cursor stream redaction | FIXED (not in the asked list, spot-checked) | `21060eff4` cursor-cli.adapter, 16 redaction call sites, spec added | Author documents the split-across-deltas limit. |
| M-3 legacy clear reports "not saved" | FIXED | `agent-rpc.handlers.ts` `writeCursorApiKey` | Store: secret written first, legacy clear is best-effort and logs `errorType` only, result is success. Delete: legacy clear first, a failure leaves the stored key and says "Could not remove the Cursor API key." (fixed text). Both directions now match the real state. |
| M-4 agy models parser | FIXED (spot-checked) | `21060eff4` antigravity-cli.adapter + spec | Tab lines only when any exist; status and error lines skipped in the old format. |
| M-5 backend guard | FIXED | `provider-rpc.handlers.ts:842-847`, `rpc-error-codes.types.ts` | Refuses before any removal with `RpcUserError(..., 'CONNECTION_IN_USE')`; the dispatcher forwards `errorCode` (`rpc-handler.ts:237`), `RpcResult` carries it (`claude-rpc.service.ts:176-181`). Nothing is removed, key is not touched. |
| M-5 UI | FIXED | `providers-connection-setup.service.ts:366-399` | Host returns the code, write resolves `false`, `settle` returns `unsaved` with no read-back, `run` still refreshes (the entry stays listed), then `block(...)` replaces the commit with the fixed "Switch the main agent first." synchronously in the same microtask continuation, so no render can occur between the intermediate `failed` commit and the block. `runDrawerWrite` copies `commit()` only after `write` resolves (`drawer-write.ts` end), so the drawer sees `blocked` and never `failed` or "Connection deleted." Host `error` text is never read. Other host errors still throw to `unconfirmed` (fixed alert). |
| M-6 backend | FIXED | `auth-rpc.handlers.ts:1523-1563` | `allSettled`; only an all-fail read throws the fixed error; a partial failure logs provider id and error type only and returns `hasApiKey:false, keyUnreadable:true`. |
| M-6 UI: never "Not set"/"Add API key" | FIXED | `provider-connection-card.component.ts:94-110`, `connection-detail-drawer.component.ts:207-208,220`, `credentials-tab.component.ts:186-207` | Card, subtitle, Overview and Credentials tab show the fixed text and Retry; Replace stays, labelled "Replace". Local-kind exception: N-2. |
| M-6 deleteStoredKey read-back | FIXED | `providers-connection-setup.service.ts:354-356` | An unreadable row after a delete reads back as not deleted (`unsaved`), never "Saved". Conservative: a delete that did succeed but whose re-read fails is reported unsaved, then the post-save refresh shows the truth. |
| M-6 Retry calls the refresh | FIXED | `providers-settings.component.ts:131-132,197`, `providers-settings-state.service.ts:304,701` | Card and drawer both call `state.refreshConnections()`. |
| M-6 other consumers | OK with notes | `providers-settings-state.service.ts:334-338` (maps the flag, `configured` true, `hasKey` false); `apps/ptah-cli/src/cli/commands/auth.ts:278` prints the raw row; `web-search-config.component.ts:402` uses `webSearch:getApiKeyStatus` (different RPC, unaffected) | Only the providers state service and `deleteStoredKey` read `auth:getApiKeyStatus` in the webview. The CLI JSON shows `hasApiKey:false` plus `keyUnreadable:true`, which is honest. Gaps: N-2, N-3. |
| 659242b4d temp names | FIXED | `file-settings-manager.ts:50,581` vs sweep regex `:538-541` | Module-level counter; name stays `<base>.<pid>.<n>.tmp`, matching `^<base>\.(\d+)\.\d+\.tmp$`. The `.flush.tmp` name is separate and unaffected. Specs now `await pendingWrite` at the end of TC-1, TC-1b and TC-2 (before the directory cleanup), so no unhandled rejection after teardown. Counter grows monotonically per process (numeric, no overflow concern in practice). |

## New defects

None blocking or serious. Minor notes:

- **N-1 (minor)** `connection-check.ts:108-124`: M-1 protects joiners, not the original caller. Click Check (run A), replace the key (clear), then A finishes: A's own caller still receives A's old-key verdict as the return value while nothing is recorded. If the calling UI renders the returned record instead of re-reading the route, it can briefly show a green check for the old key until the next route read. Fix: return nothing stale, or have the caller always re-read after a check.
- **N-2 (minor)** `credentials-tab.component.ts:178-181` and `connection-detail-drawer.component.ts:219`: a `local`-kind connection (for example Ollama) with an unreadable optional key shows "No key needed" / "Local server" in the drawer, with no unreadable signal (only the card shows it). Scenario: corrupt Ollama key, user opens the drawer and is told no key is involved while requests may be using or failing on it.
- **N-3 (minor)** `providers-settings.component.ts:270`: `wizardCredentialStored` is `hasKey === true`, so for an unreadable row the setup wizard behaves as "no stored credential". The user is not told a key may exist; overwrite still works, so no data loss.
- **N-4 (minor)** `credentials-tab.component.ts:209`: "Delete key" is shown only for `hasKey`, so a corrupt, unreadable key can be overwritten but not deleted from the UI.

## Residual limits

- No browser or Playwright run; the UI claims rest on code reading plus the green jest suites (the 55c specs for card, credentials tab, drawer, setup service and page were exercised through the full core and chat projects only for core; the chat project was not re-run here).
- Microtask ordering for M-5 (no flash of "failed" before `block`) is by reasoning about Angular effect timing, plus the author's spec at `providers-connection-setup.service.spec.ts:342`; not observed in a real render.
- M-2 and M-4 were spot-checked from the diff stat and commit message, not re-traced line by line.
- The uncommitted rpc-handlers working-tree edits were excluded as instructed, so S-1 and M-1..M-6 are verified at the committed state only.
