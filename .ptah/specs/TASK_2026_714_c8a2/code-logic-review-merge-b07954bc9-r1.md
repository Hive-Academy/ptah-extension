# Code Logic Review — merge b07954bc9, revision 1

Review family: codex  
Implementer family: claude (coordinator)

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Findings | 0 blocking, 0 serious, 0 moderate, 0 minor |
| Scope | The revised native Codex follow-up admission, its focused spec, and the five earlier merge resolutions |

The prior 6/10 finding is fixed. The successful resumed Codex turn now reaches host routing once, after the adapter starts the turn and before the success result. This is in the sound 7–8 band because the control flow and assertion are direct; it is below 9–10 because runtime checks were expressly prohibited and the spec does not assert admission order.

## Findings

None in the requested merge-resolution scope. No additional successful early return after a dispatched turn skips admission.

## Five logic questions

1. **How does this fail silently?** The prior silent omission at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1663-1676` is closed by the new call at `:1668-1670`. The admission wrapper logs synchronous coordinator failures at `:971-983`; the coordinator observes its background scope-check rejection at `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts:224-240`.
2. **What user action produces unexpected behaviour?** The previously affected action was a plain follow-up to an inactive native Codex session. It now resumes the turn at `chat-session.service.ts:1614-1624`, admits it at `:1668-1670`, and returns the same `settled` or running result at `:1674-1676`.
3. **What input data produces a wrong answer?** None found in the reviewed success paths. A nonslash prompt is admitted; a slash prompt takes the separate slash branch (`chat-session.service.ts:1594-1613`). Empty attachment-only prompts reach the wrapper, but the coordinator deliberately ignores empty text (`host-routing.coordinator.ts:196-200`).
4. **What happens when a dependency fails?** The admission call is synchronous and unawaited (`chat-session.service.ts:971-983`), so its failure cannot alter the dispatched turn's result. A failure in post-resume slash routing or context injection before `:1668` instead reaches the outer error return (`:1636-1660`, `:1743-1768`); that exceptional path can omit admission after an adapter has started the turn. This is an error result, not another success-looking early return. The concrete filesystem transcript probe and metadata write failures are already downgraded or logged in `chat-ptah-cli.service.ts:411-425,453-476` and `chat-subagent-context-injector.service.ts:354-370`; no probable uncaught failure was established here.
5. **What is missing that the requirements never mentioned?** The new regression assertion checks admission count and payload but not invocation order (`chat-continue-codex-resume-once.spec.ts:373-400`). Source order establishes dispatch before admission (`chat-session.service.ts:2437-2467`, `:1663-1670`); a future order assertion would make that contract executable.

## Revised path and early returns

| Path | Result | Evidence |
| --- | --- | --- |
| Inactive native Codex, plain prompt | `resumeSession` starts the turn; `promptDelivered` reaches one admission after `injection.release()`; no second send; original running/settled return remains. | `chat-session.service.ts:1614-1624`, `:1661-1676`, `:2437-2467` |
| Active or Claude follow-up | One admission after `sendMessageToSession`; `promptDelivered` branch is not taken. | `chat-session.service.ts:1713-1742` |
| Slash prompt | No native auto-resume and no host-routing admission. Both admission sites guard slash commands. | `chat-session.service.ts:1594-1613`, `:1668-1670`, `:1726-1729` |
| Other normal early returns | CLI return precedes this dispatch (`:1542-1545`); resume error is returned before a successful resume outcome (`:1622`); slash result returns only for a slash action (`:1646-1650`; `chat-slash-command-router.service.ts:207-211`); stop-interrupt failure precedes send (`chat-session.service.ts:1701-1709`); native `settled` return follows admission (`:1726-1742`). No other successful post-dispatch early return found. | Cited lines |

The focused spec's `admitUserTurn` mock is bound in its harness (`chat-continue-codex-resume-once.spec.ts:93-96`, `:174-184`). Its `toHaveBeenCalledTimes(1)` and payload assertion at `:393-399` would fail if the new call at `chat-session.service.ts:1668-1670` were removed. The assertion does not itself prove ordering or slash exclusion; those were inspected in source and the existing host-routing spec.

## Earlier resolution checks

| Resolution | Result | Evidence |
| --- | --- | --- |
| Lane classifier alias, Codex factory, CLI runtime registration | Correct order: alias and factory precede runtime registration. | `apps/ptah-electron/src/di/phase-2-libraries.ts:294-312` |
| Smoke imports | Expected resolvable and both runtime token lists remain imported and used. | `apps/ptah-electron/src/di/container.smoke.spec.ts:101-112`, `:1433-1444` |
| Duplicate SDK import | One import remains. | `apps/ptah-electron/src/di/expected-resolvable.ts:1`, `:38-45` |
| Session constructor and both methods | Runtime profile and router precede host routing; session ID events remain last. Both `codexFailure` and `admitHostRoutingTurn` remain. | `chat-session.service.ts:363-380`, `:912-983` |
| Start and follow-up paths | Start admission remains after launch; ordinary send and native resume each admit one plain prompt. | `chat-session.service.ts:1096-1118`, `:1661-1676`, `:1713-1742` |
| Positional constructors | The host-routing spec puts `hostRouting` after two `undefined` runtime arguments. The previous review's constructor-site audit found no other specs in `libs/backend/rpc-handlers` or `apps` passing a shifted argument after `activeProvider`; current signatures and site still align. **Other shifted specs: none.** | `chat-session.host-routing.spec.ts:198-206`; `chat-session.service.ts:359-380` |

## Decisions and verification

- **Decision:** A native Codex resume that delivers a plain follow-up is a dispatched interactive turn and receives one host-routing admission. The alternative, omitting it, contradicts the ordinary post-send admission. Evidence: `chat-session.service.ts:1661-1676`, `:1717-1729`. Reversible by moving the admission point.
- **Verification:** Read-only inspection of staged diff, current source, focused spec, and earlier review. `ptah_code_search_symbols` returned an empty index; native text search was used for the relevant helper implementations. No tests, diagnostics, typecheck, lint, build, verify, or Nx command was run, as required. Runtime behavior remains unverified.

## Verdict

**APPROVED** — the specific merge defect is fixed and the new assertion detects its removal. Confidence: high for control flow, medium for runtime behavior without execution.
