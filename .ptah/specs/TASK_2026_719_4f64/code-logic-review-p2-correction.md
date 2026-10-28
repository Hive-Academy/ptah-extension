# P2 correction review

Verdict: **APPROVED**  
Score: **9/10**  
Review family: **reviewer codex, implementer Claude**

Scope: the uncommitted `git diff HEAD -- libs/backend/auth-providers`, limited to the two requested corrections and defects they could introduce. Compared against the specified residual finding and ownerless-receipt finding in `code-logic-review-p2-rereview.md` and the claims in `p2-fix-5-report.md`. Source and git state were not changed.

Evidence paths in this review are relative to `libs/backend/auth-providers/src/lib/accounts/`.

| Item | Status | File:line evidence |
| --- | --- | --- |
| 1. Status reservation retains all registry receipts and releases only after all children close | closed | `provider-account-actions.service.ts:483` records an unproved result with prior state and retains the receipt array; `:497` applies this to preparation and coverage refusals, including the post-status check at `:513`. `:508` uses the same mechanism for an unproved status child. `:527` registers every receipt and releases only when the open count reaches zero; the release preserves prior state (`:492`). Status returns immediately when its own child is unproved (`:512`), so later registry probes cannot start while that child is outstanding. Disposal aborts recovery and disposes retained receipts (`:228`, `:246`, `:534`). The former gap-pinning test is replaced at `provider-account-actions.service.spec.ts:543` with two-child late-close recovery, identity preservation and duplicate-close assertions; `:570` tests never-close retention after elapsed time and listener cleanup on disposal. |
| 2. Executable and run-certification receipts have owners on every return path | closed | `claude-account-command.ts:291` propagates the executable receipt on cancellation, timeout and other unproved refusals; other executable returns have no outstanding child. `claude-route-certifier.ts:286` transfers this receipt through preparation to auth callers; `provider-account-actions.service.ts:94` owns refusal receipts in the auth ledger, while status uses the retention path above. Run certification disposes preparation receipts via `claude-route-certifier.ts:195` / `:160`. It disposes status receipts at `:204`, before the route-changed and unproved branches, retaining `terminated:false`. `claude-route-certifier.spec.ts:386`, `:398`, and `:406` cover disposal, transfer and both status refusal branches. `provider-account-auth-env.spec.ts:199` and `:220` assert actual child listener removal, single late-close notification, and no notification after disposal. |

## New defects

None found in the bounded correction.

The counter relies on the production receipt's one-shot notification contract: `claude-account-command.ts:154` handles already-closed receipts synchronously, and `:168` guards duplicate close/disposal and detaches listeners before notifying. Registering all receipts before subscribing also handles receipts that close before subscription. No new double release or double settlement was found. No receipt is reclaimed merely by elapsed time or a live PID. Missing proof without a receipt remains held. Recording failures dispose retained receipts (`provider-account-actions.service.ts:488`). No logging of secrets or paths was added; the changed specs contain no `process.cwd()` or module-namespace `jest.spyOn`. The new spy targets a store instance.

Validation: ran one Jest command with `--maxWorkers=2` and `--runTestsByPath` for `provider-account-actions.service.spec.ts` and `claude-route-certifier.spec.ts`: **2 suites passed, 92 tests passed**, exit 0. Node emitted a Jest-config module-loading warning; execution succeeded. Output is saved in `p2-correction-jest.log` beside this review.

## Not checked

- Concurrent agent-sdk changes, other task findings, and unrelated product behavior.
- `provider-account-auth-env.spec.ts` was inspected but not executed, respecting the two-spec limit. Its real-listener assertions supplement the fake-receipt assertions in the executed certifier spec.
- Builds, installs, full suites, typechecking, lint, `npm run verify`, Electron integration, and real Claude/registry process behavior were not run. The developer's broader validation claims were not independently repeated.
