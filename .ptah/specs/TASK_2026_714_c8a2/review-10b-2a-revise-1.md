# Review 10b-2a revise 1 — native Codex App Server lane adapter

Verdict: REVISE
Score: 6/10
Review family: claude vs codex

## Defects

1. **Medium — the essential retry always fails on a resumed thread.**
   Location: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:296-298` (`retryConfig`, `openContext(previous?.identity ?? resume)`) with `libs/backend/codex-runtime/src/lib/codex-runtime.ts:76-80`.
   Scenario: a continuation run passes `resume` (the persisted identity with the original `profileFingerprint`). The first `open` is rejected by Codex. `essentialLaneSession` builds a new profile with fewer keys, so its `profileFingerprint` differs. The retry calls `runtime.open(profile, resume)`. Line 76 of the runtime sees the fingerprint mismatch and throws `CodexResumeProfileChangedError`. That error is not a `CodexPreTurnConfigRejectedError`, so `retryConfig` rejects and the run ends with "Codex rejected the essential lane configuration." The retry never opens a context on a resumed run. Only fresh runs (no `resume`) can recover.
   Fix: decide the contract before coding. Either (a) the essential profile must keep the original fingerprint for resumed threads, which needs a fingerprint rule in the runtime (out of scope for this lane, and it touches the profile fingerprint that main chat shares), or (b) on a resumed rejection, fail visibly with a specific message and do not claim a retry. Add a spec case for `resume` plus a config rejection. The current suite has no such case.

2. **Low — the notice text and the first-run retry path are not tested with a resume identity.**
   Location: `codex-app-server-lane.adapter.spec.ts` (retry cases at about lines 370-441).
   Scenario: the retry cases pass no `resume` identity, so defect 1 is not pinned. A regression in the resume branch passes the suite.
   Fix: add one case with a resume identity. Assert the visible error or the retry result that the fix in defect 1 chooses.

## Checked

- **Essential set** (`codex-app-server-lane-rejection.ts:20-49`, `codex-config-rejection.ts:53-60`): the retry keeps effort, the user-server disable entry (unless the rejection names a user server), Ptah MCP, developer instructions, approval policy and web search. Budgets, agents, plugins, apps and skill instructions are dropped. Matches the legacy set. The notice text matches the reduction.
- **User-server gate** (`codex-app-server-lane-rejection.ts:45-49`, `essentialLaneSession`): the user-server wording needs a non-empty `disabledUserMcpServers`, a non-Ptah `mcp_servers.<name>` key and a non-empty lane. Re-enabling only happens when the disable entry drops. The "no disabled servers" and "keep tool suppressions" cases match this.
- **Open-level retry** (`codex-app-server-lane.adapter.ts:252-284`, `:331-366`): one retry only. A second `CodexPreTurnConfigRejectedError` emits one visible error, closes, and throws. No third open. No turn-level retry remains. A turn-start failure emits one error and rejects.
- **Old context**: the runtime closes a failed open before it throws, so the retry has no live old context to close. Late-open guard (`:221-233`) still closes a straggler after abort.
- **Notice once**: `emit` and `configRejection.emit` run once per rejection, before the retry. No sticky state: the retry flags stay in the `runSdk` closure.
- **Identity checks on retry**: the identity guard compares against the new `profile`, so it passes when the runtime accepts the open. The persisted identity on a successful retry carries the new fingerprint. This is correct only for fresh runs (defect 1).
- **Rejected key** (`codex-runtime.ts:31-37`, `:153-159`): extracts only `[A-Za-z0-9_.-]{1,128}` from the `in \`...\`` headline. Raw stderr is never attached. Paths and secrets with `:`, `\` or spaces are dropped. The runtime error gains only an optional field. No profile fingerprint or other runtime path changed.
- **Model rejection** (`:349-362`, `codex-app-server-lane-rejection.ts:62-69`): advice only for a failed terminal event with an error. No substitution and no retry. Environment secrets are passed to the redactor.
- **Pump and done settling**: a single `resolve` or `reject` per turn. A failed model turn closes the context after reject.
- **Spec hygiene**: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` or `as any` in the four changed source and spec files. Grep only. Typecheck and tests were not run (lane rules).
- **Not checked**: deferred items (detect, listModels, binary path, credentials) and the 10b-2b wiring.
