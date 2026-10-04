# Code Logic Review: PR639 CI fix (uncommitted diff)

Verdict: APPROVED (0 blocking, 0 serious, 3 moderate/minor)

## Focus answers

1. removeTemp (session-handoff-writer.ts:196-212): safe. `fs.rm(..., {force:true})` already swallows ENOENT, so the ENOENT branch only matters for ENOTDIR (handoffs dir is a file). In both cases the temp file cannot exist, so no hidden failure. EACCES, EBUSY, EPERM and the rest are still logged. The caller keeps reporting the original write error. OK.

2. runBudgetAction (chat-view.component.ts:1196-1202): OK. A thrown RPC now gives `showActionError` and `null`. `finally` clears busy (spec asserts this). The return contract is unchanged: `SessionBudgetActionResult` on success, otherwise `null`. Callers that already handle `null` need no change. The error message is built from `error.message`, and the message format matches the existing non-throw branch.

3. session-budget-settings.component.ts
   - Revalidation (:436-441): no loop. Tighten commits handoff, and handoff commits tighten. The second step returns early because the first step's draft was cleared (`clearDraft` runs before the nested call) or because the partner has no draft. Recursion depth is at most 2.
   - Invalid saves: `commit` re-runs `validate` against the freshly saved partner value, so an invalid pair is never written. If the sibling is still invalid, its error stays shown.
   - Moderate: the nested `commit` writes the partner's pending draft even if the user has not blurred it and is mid-typing. This is the only race: the user focuses the sibling during the in-flight write, `busy()` is false again by then, and a partial value that happens to be valid gets auto-saved. It is narrow, because the write window is short and typing in the sibling normally blurs the first field. Nothing invalid is persisted.
   - Moderate/Minor: the sibling's `write` failure sets the sibling's error and status, which overwrites the first field's "Saved" status. That is accurate, but there are two sequential `settings:set` calls with no rollback of the first. This is acceptable because each is independently valid.
   - Timeout (:365, :35-36): `rpcCall` takes `timeoutMs` as its 4th argument, so this is wired correctly. Both a timeout rejection (caught at :384) and a `success:false` result lead to `load='error'`, which shows the role=alert Retry. `reload` sets 'loading' first, and every path ends in 'ready' or 'error', so it never stays loading. Minor: `settings:set` keeps the 30s default, so `busy` can last up to 30s on a dead host.

4. orchestration-settings.component.ts:85-90: acceptable. The `aria-busy` was on an empty div that is replaced when the card mounts. `ptah-session-budget-settings` exposes loading itself through `role=status aria-live=polite` (`:158-166`) and an error `role=alert`, which is stronger than `aria-busy` on a bare div. Gap: while the card is still deferred (not yet in view), the placeholder is silent. That is acceptable because it is off-screen. The sibling placeholders still carry `aria-busy`, which is a small inconsistency. Minor.

5. settings.fixtures.ts:169-190, 554: other `settings:get` calls fall through to the same `PTAH_CLI_AGENTS_SETTING_FIXTURE` object as before, so responses are unchanged. Minor: `key in SESSION_BUDGET_SETTINGS_FIXTURE` uses the prototype chain, so a key like `'toString'` or `'constructor'` would match and return `{success:true,value:<function>}`. No real key does this today. `Object.hasOwn` would be safer.

## Other

- session-budget-banner.component.ts:55: a class change only, with no logic impact.
- No other findings. Tests for the new behaviour were added: the timeout, the sibling revalidate-and-save case, and the rejected budget action. I did not run them.

## Issue counts

Blocking 0, Serious 0, Moderate 2 (auto-save of an unblurred sibling draft; 30s settings:set busy window), Minor 2 (fixture `in` check; placeholder aria inconsistency).
