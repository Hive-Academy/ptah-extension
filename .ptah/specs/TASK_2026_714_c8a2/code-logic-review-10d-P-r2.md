# Code Logic Review - TASK_2026_714_c8a2 / Batch 10d.P, round 2

Review family: claude (in-process subagent)
Implementer family: codex (coordinator two-line correction: claude)

Scope: read in full `codex-lane-parity.spec.ts` (P, 443 lines; harness, same-home, approval, MCP and SDK-scan cases), `codex-lane-activation.spec.ts` (A, 482 lines; native adapter fixture and all four cases), the git diff of `codex-app-server-lane.adapter.ts` and its `.spec.ts`, the adapter `openContext`/`close` section (:236-372), `claude-cli.adapter.ts:326-336`, `agent-process-manager.service.ts:870-905`, `p10-lane-parity-proof.md` and the C1 report. Nothing was executed. I rely on the coordinator's statement that the whole cli-agent-runtime test target passes on Windows. I did not re-read the 43-row preserve table beyond the rows that cite P/A lines, and I did not check the P:42-65 reference for row 31.

## D1-D7 and C1 status

| Item | Status | Evidence (file:line) |
| --- | --- | --- |
| D1 same-home row proves nothing | Fixed | P:309-384 now uses one `harness()` (P:169-220): one adapter, one runtime, one identity store, two lane fixtures. It interleaves A and B, then runs an A follow-up (P:362-367) and a B resume reopen (P:375-383). It asserts the `open` args per lane (P:331-355) and that no Beta text reaches A (P:368). Proof row 32 now says "interleaves both lanes through one adapter, runtime provider and identity store". The runtime is still a mock, so bleed inside the real App Server is covered only by the PENDING-LIVE note. The proof says "live effective config pending". |
| D2 activation rows adapter-agnostic | Fixed | A:289-338 drives the real `CodexAppServerLaneAdapter` through the real `AgentProcessManager`. Native terminal usage (200k) reaches `lastRequestContext` (A:312), the ledger `recordSuccess` (A:313-315), the rollout resume gate (A:322-328), and a router report (A:301-307). The proof labels A:340-481 "shared manager contract (adapter-agnostic)" (proof rows for usage, ledger, report). |
| D3 stale line references | Fixed | Proof cites P:223-255, 257-277, 279-307, 309-384, 386-406, 408-428, 430-442 and A:289-338, 340-386, 388-440, 442-481. The `it(` lines are at P:223/257/279/309/386/408/430 and A:289/340/388/442. All match. |
| D4 approval cases call the sink directly | Honestly downgraded | P:386-406 still calls `h.approvals.request`. The proof now says "direct sink decline" and "runtime delivery pending live observation" (proof rows 22, 25 and the approval section). Row 22 and row 25 are PASS only for "sink decline", which is accurate. |
| D5 MCP filter not exercised | Fixed | P:408-428 supplies `['user-server','ptah']` (P:319) and asserts that `user-server` is disabled and `ptah` is not (P:331-332). The proof's row 41 says "supplies ptah among user MCP names". |
| D6 rollout provenance | Fixed | A:350-372 asserts `contextTokens: 20_000, source: 'rollout'` for resumed and a 160k rollout giving `fresh` with `resumeSessionId: undefined`. |
| D7 ledger gaps | Fixed | A:388-440 has a completed run with usage (A:397-401), a quota failure (A:408-411), a stopped run, and a known owner without usage (A:420-425). A separate unknown-owner run (A:428-433) is a separate case now. `recordWindowEvidence` is asserted not called (A:412, A:437). |
| C1 production fix | Verified | See below. |

## C1 checks

1. Rule match with Claude. `claude-cli.adapter.ts:326-336` returns undefined (default account) when no admission request and no binding field, and refuses when any binding field is present without admission. The native `:318-325` skips when both fields are absent, throws on a partial binding (`!binding || !id` after the OR guard), and calls the callback when both are present. Default-account and partial-binding behavior match. A difference remains, see N1.
2. Still refuses a partial binding. Yes. The guard is `!== undefined` on either field. A partial binding is refused whether or not the callback exists (stronger than the old code, which depended on the callback).
3. Real production defect confirmed. The manager always passes `onAccountBinding` (`agent-process-manager.service.ts:875-900`), so before C1 every default-account native lane threw at the old `if (options.onAccountBinding)` guard. That was a blocking activation bug and the right thing to fix.
4. The specs can fail on their target bug. The default-account case (`...adapter.spec.ts:246-255`) supplies a callback and no fields. The old code threw `Codex lane account binding is incomplete`, so `runSdk` would reject and the test would fail. It also asserts the callback is not called. The complete-binding case now asserts the exact callback args and thread id `thread-1`. The partial case would not catch the original bug (it passed on the old code too) but it guards against an over-broad skip such as `&&` on the fields. It runs both partial variants and uses a fresh harness each time.
5. Context closed once on partial-binding refusal. The throw is inside `openContext`, caught by the non-config branch at :361-364, which awaits `close()`. `closeContext` memoizes in a WeakMap (:236, :266-272), and the abort listener at :292 calls the same memoized close. The spec asserts `close` called once and zero prompt inputs (`...adapter.spec.ts:296-303`). The throw is raised before the first input, so no event stream has started.

## New defects

### N1 (moderate) A full binding with no callback silently proceeds

`codex-app-server-lane.adapter.ts:318-325` uses `options.onAccountBinding?.(...)`. When both fields are present and the callback is missing, the run starts with a named account that is never persisted. Claude refuses a direct caller with a binding it cannot honor (`claude-cli.adapter.ts:327-334`). The manager always supplies the callback, so this is reachable only for a direct caller, but it is a silent downgrade of a bound context and the C1 report's own stated rule ("a bound context never downgrades silently") does not hold for it. Fix: throw the incomplete/unavailable error when the fields are present and the callback is absent. Add one spec.

### N2 (moderate) Proof is silent on the account-binding finding and its header is stale

`p10-lane-parity-proof.md` has no row for account binding or default-account start. The A:289-338 integration case found a real FAIL (every default-account native lane failed at start), which C1 fixed. A signer reading the proof cannot see that the parity gate caught a launch-blocking defect, or that a named-account run through the manager into the native adapter is untested (no spec drives `accountBinding` plus the manager's `persistReference` path with the native adapter). The proof header (line 3) and Decision 4 still say no case was executed under the task's rules, while the coordinator has now run the target. Fix: add a row "Account binding / default-account start: FAIL (found by A:289-338), fixed by 10d.P-C1, spec `...adapter.spec.ts:246-255,257-273,294-304`; PASS static + coordinator run; named-account manager path PENDING-LIVE". Update the header and Decision 4 to record that the cli-agent-runtime target now passes on Windows (and not on Linux).

### N3 (minor) Partial binding refusal leaves a persisted identity

`:317` persists the thread identity before the binding check at :318-321, so a refused partial binding leaves an identity record for a thread that never ran a turn. The existing spec order (`open, persist, binding`) pins this order. Low impact (the record is resumable only with the same home/context). Consider a note rather than a change.

### N4 (minor) Partial refusal without a callback is untested

The new partial spec always passes a callback (`...adapter.spec.ts:294-303`). The C1 report claims a partial binding is rejected even when the callback is absent. That path has no spec.

No `any`, `as unknown as`, `@ts-ignore` or `eslint-disable` appear in either new spec or the changed adapter (grep). The only hits are `expect.anything()` / `expect.any(String)` matchers. Paths use `resolve`, `join`, `tmpdir` and `realpathSync`, with `process.platform` for the path snapshot (A:`nativeAdapter`), so Windows and Linux both work. The `'/alpha.md'` source path is an inert string. The coordinator correction `workingDirectory: workDirectory` is in place (A:299, A:319). MCP is not stripped: the `ptah` server stays and only the user server is disabled (P:331-332).

## Other answers

| Question | Answer |
| --- | --- |
| Proof PASS labels honest? | Yes, with the N2 gap. Rows are "static and spec-backed; live pending" and shared-manager scope is stated. |
| Windows-only risk | The parity pin is win32/x64 only (proof "Host and binary identity"); on Linux the specs use fakes, so they do not depend on the pin. I could not run them there. |

## Score

8/10. Verdict: REVISE (narrow). Six of the seven earlier defects are fixed with matching line references, D4 is honestly downgraded, and C1 is a correct fix to a real blocker. Two moderate items remain: N1 (a silent downgrade of a bound context, in code that this batch changed) and N2 (the proof does not record the account-binding FAIL or the refreshed execution status). Neither is blocking. Blocking: 0. Moderate: 2. Minor: 2.

## Decisions

1. Treat N1 as a fix before activation. The decision follows the Claude adapter's refusal rule and the C1 report's own rule. Evidence: `claude-cli.adapter.ts:327-334`, adapter `:318-325`. Reversible.
2. Add the account-binding row (FAIL fixed by C1) to the proof and refresh its header and Decision 4. Evidence: A:289-338 and the C1 report. The edit is a doc change and reversible.
3. Keep N3 and N4 as follow-ups. They do not change a user-visible outcome on the manager path.
4. Approve the C1 source change as is. A re-review of N1 can be a read of two lines plus one spec.
