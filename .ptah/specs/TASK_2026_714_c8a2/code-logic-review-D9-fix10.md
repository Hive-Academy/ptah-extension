# Code Logic Review — TASK_2026_714_c8a2 / D9 fix10

Scope: `git diff -- libs/frontend/chat` (replayer service + spec, session-loader service), CI log `ci-chat-failures-cc151f659.txt`, report `task-D9-fix10-report.md`. Static read; no tests or git writes.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE |
| Blocking / Serious | 0 / 0 |
| Moderate | 1 |

## providerId fallback correctness
- Full replay (`session-loader.service.ts:1133`): `resumeResult.data?.providerId ?? session?.providerId ?? existingTab?.providerId`. `session` (declared at L958, the session-list entry) and `existingTab` (L874) are both in scope inside the same method, so the expression compiles and reads sensibly: freshest source (resume reply) first, then list metadata, then the pre-await tab snapshot. `existingTab` may be stale, but it is only the last fallback, and the native-marker check in the replayer still covers a missing provider.
- Cached-tab path (`~L1860`): `result.data?.providerId ?? restoredTab.providerId`. `restoredTab` is re-read after the await and after the ownership check, so it is current. This is equivalent to what the removed in-replayer tab lookup did. The call is now inside its own try/catch (the fix9 M1 point is addressed: the failure is logged and the tail/stats/CLI updates below still run).
- `restoreNativeCompletedChildren` (`session-history-replayer.service.ts:576-589`) now gates on `resumeProviderId !== 'openai-codex' && !hasNativeCodexAgent`. It no longer touches `tabManager`, so a missing or throwing tab mock cannot break replay.

## Claude gating intact
Yes. A Claude replay passes `anthropic` or `undefined` and its ids are not projector-shaped JSON arrays, so the method returns before any store access. The only way into recovery for a Claude session is a wrong `openai-codex` provider value, which no source in the fallback chain produces for Claude.

## Do the removed tab lookup explain the 5 SessionLoaderService failures?
Largely yes, consistent with the log. The log's top error for each of UICS-010 and the four `switchSession` guard cases is `streamingHandler.clearPendingUpdates is not a function` thrown from the replay failure branch (`session-loader.service.ts:1142`). That branch is reached only when `replay` threw. These tests drive a one-event replay through a hand-built `TabManagerService` mock; the only new thing on that path from this branch was `restoreNativeCompletedChildren`'s `findTabByIdAcrossWorkspaces` call, which a small mock would not implement. The failure handler's own incomplete mock then masked the first TypeError. The report's claim that `origin/main` has the same test bodies without the recovery call is a plausible, consistent explanation. I could not run the tests or read the mocks' full shape, so "fully explained" is high-confidence inference rather than proof; also, the replayer yield-semantics failure (four lookups vs three claim checks) is directly explained by the same lookup being counted.

## Specs — assertions not weakened
- `session-history-replayer.service.spec.ts:214-249`: the Codex positive test now passes `'openai-codex'` as the explicit argument instead of mutating the tab; the same assertions (`onAgentStart`, `onTaskToolResult`, `restoreHistoryChild` args) remain. A new test covers Codex history with no native marker, supplied provider only. The Claude-negative test now passes `'anthropic'` explicitly and asserts no store calls. This is stronger on the new contract and equivalent otherwise.
- Gap (moderate): nothing asserts the three-way fallback in the loader (`resume ?? session ?? existingTab`, and `resume ?? restoredTab` on the cached path); the existing loader spec only checks that the reply provider reaches recovery. A bug in either `??` chain would not be caught.
- Minor: the Claude-negative test still sets `tabs[0].providerId = 'anthropic'`, which is now irrelevant to the code under test; harmless.

## Verdict
APPROVE, 8/10. Correct, minimal, and keeps Claude gated. Optionally add a loader spec asserting the provider argument for the fallback chain.
