# Bugfix: personal-login tripwire vocabulary (TASK_2026_719_4f64)

## Root cause

The post-init tripwire compared the running child's `accountInfo()` with the
`claude auth status --json` vocabulary: `tokenSource === 'claude.ai'` and
`subscriptionType` in `CLAUDE_PERSONAL_SUBSCRIPTIONS = ['pro','max']`. The
bundled Claude Code 2.1.278 CLI that the Agent SDK spawns reports a claude.ai
subscriber with **no** `tokenSource` and a **display** subscription name
(`Claude Max` / `Claude Pro`, see `WAn()` in the brief). As a result every
named run failed both checks and was refused with `identity-unproved`. The
live log showed `tokenSource:false` and `subscription:"other"`.

The main-chat named path had the same bug in a second copy:
`namedIdentity()` in `session-query-executor.service.ts` used the same
comparison, so named main-chat sessions were refused too.

## Fix

One shared predicate now lives in agent-sdk
`libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`, next to
the constants:

- `CLAUDE_PERSONAL_ACCOUNT_INFO_SUBSCRIPTIONS = ['Claude Pro','Claude Max']`
  is a new constant for the accountInfo display vocabulary.
  `CLAUDE_PERSONAL_SUBSCRIPTIONS` is unchanged. The auth-status certifier
  (`auth-providers/.../claude-account-status.ts`) still uses it with its raw
  `pro`/`max` meaning.
- `claudePersonalLoginCheck(info)` returns a frozen, loggable check with these
  fields:
  - `tokenSource`: passes when the field is undefined or `'claude.ai'`.
  - `apiKeySource`: passes when undefined or `'none'`.
  - `apiProvider`: passes when undefined or `'firstParty'`.
  - `subscription`: a fixed word (`pro|max|team|enterprise|api|other|absent`), mapped from the known raw and display values.
  - `personalSubscription`: true only for `pro`, `max`, `Claude Pro` or `Claude Max`.
- `claudePersonalLoginPassed(check)` returns true only when all four checks pass.
- New exports from `@ptah-extension/agent-sdk`: the predicate, the constant, and the types `ClaudePersonalLoginCheck`, `ClaudeRunningLoginInfo` and `ClaudeLoginSubscriptionClass`.

Who uses it:

- `cli-agent-runtime/.../claude-sdk-lane-runner.ts`: `readIdentity` now calls the shared predicate. The local `personalClaudeLogin`, `personalLoginPassed`, `SUBSCRIPTION_WORDS` and the local `ClaudePersonalLoginCheck` interface are deleted. The `personalLogin` diagnostic now carries the fixed subscription word and `personalSubscription`. It never carries email, organization or raw values.
- `agent-sdk/.../session-query-executor.service.ts`: `namedIdentity` uses the same predicate. The identity compare is unchanged.
- Dependency direction: cli-agent-runtime already imported `@ptah-extension/agent-sdk` (assertCertifiedLaunch and others), so no new edge and no cycle.

Still refused:

- `tokenSource` `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, or any other defined value.
- Any defined `apiKeySource` other than `none`.
- Any `apiProvider` other than `firstParty` (bedrock, vertex, gateway, ...).
- `subscriptionType` of `Claude Team`, `Claude Enterprise`, `Claude API`, `team`, `enterprise`, an unknown word, a lower-case display name, or none.

Allowing an undefined `tokenSource` is safe because of how the bundled CLI
builds this object. It leaves `tokenSource` out only for a claude.ai
subscriber (`mt()` true, and then `subscriptionType` is set) or for the
`profile` source (then `subscriptionType` stays unset, so the run is still
refused). An OAuth env or file-descriptor token always sets `tokenSource`
explicitly.

## Tests

- `agent-sdk/.../claude-certified-launch.spec.ts`: a new `claudePersonalLoginCheck` describe block.
  - The bundled shape `{subscriptionType:'Claude Max', apiProvider:'firstParty'}` passes. Before this change it failed.
  - These also pass: `Claude Pro`, `apiKeySource:'none'`, `tokenSource:'claude.ai'`, and the raw `pro`/`max` words.
  - 16 refusal cases, covering every item listed above.
  - A word-to-class mapping table, including an email-shaped value mapped to `other`.
  - A check that the result contains only fixed booleans.
- `cli-agent-runtime/.../claude-sdk-lane-runner.spec.ts`:
  - A new "passes the personal-login tripwire" `it.each` with 4 shapes, among them the bundled `Claude Max` and `Claude Pro` shapes. Each run reaches `identity-compare`, which means the tripwire passed.
  - The tripwire refusal table grew from 6 to 14 cases: OAuth env and fd tokens, an env API key, `Claude Team`, `Claude Enterprise`, `Claude API`, a missing subscription and token source, and vertex.
  - The diagnostic leak regex now also rejects `Claude`, `CLAUDE_CODE`, `ANTHROPIC` and `vertex`.
- The existing `session-query-executor.accounts.spec.ts` tripwire cases (`tokenSource:'none'`, apiKeyHelper, team, unknown, no subscription, bedrock) still refuse under the shared predicate. I did not change that spec because of the 6-file cap.

## Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk`: NX ran 6 tasks, 5 succeeded and 1 failed.
  - The only failure was the agent-sdk test `subagent-handoff-index.spec.ts > forgets a resolved name when it disappears from a rescan`. It waits on a timer and the filesystem (`setTimeout 50` followed by a rescan). Agent-sdk overall: 4115 passed, 1 failed, 3 skipped.
  - That spec's folder is unchanged against 396f0135b (`git diff --quiet 396f0135b -- libs/backend/agent-sdk/src/lib/helpers/compaction/` exited 0).
  - Re-running it alone (`-t test -p @ptah-extension/agent-sdk -- --testPathPatterns=subagent-handoff-index`) succeeded (1 task). So it is a flake under load, not caused by this change.
  - Lint and typecheck passed for both projects. cli-agent-runtime tests passed.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit code 0 (captured directly). No catch blocks were added.
- Not run: build, serve and e2e, per the rules. auth-providers was not run because it only consumes `CLAUDE_PERSONAL_SUBSCRIPTIONS`, which is unchanged.

## Files changed (this batch, 6)

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`: adds the display-vocabulary constant, the subscription classes, `claudePersonalLoginCheck` and `claudePersonalLoginPassed`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts`: predicate tests.
- MODIFIED `libs/backend/agent-sdk/src/index.ts`: barrel exports.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`: `namedIdentity` uses the shared predicate.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`: uses the shared predicate; the local copy is removed. The earlier diagnostics changes are kept.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`: pass and refusal tables updated. The earlier batch's changes are kept.

## Decisions

- **The shared predicate lives in agent-sdk `claude-certified-launch.ts`.** The alternatives were two local copies, or a new shared lib. The evidence: both tripwires had the same bug, and cli-agent-runtime already imports agent-sdk. Reversible.
- **Undefined `tokenSource` is accepted.** The alternative was to require `'claude.ai'`. The evidence is the decompiled `Ece()`: the bundled CLI never sets `tokenSource` for a claude.ai subscriber, and it always sets it for an OAuth env or fd token. Reversible.
- **Display names are matched exactly and are case-sensitive** (`Claude Pro`/`Claude Max`). The alternative was case-insensitive matching. The evidence is `WAn()`, which returns these exact strings, and a strict match keeps the allowlist tight. Reversible.
- **The diagnostic `subscription` field changed from `personal|organization|absent|other` to `pro|max|team|enterprise|api|other|absent`, and a `personalSubscription` boolean was added.** The brief asks for these words. Every field is still a fixed word or boolean. Nothing outside the lane runner and its spec read the old values. Reversible.

## Out-of-scope observations

- `subagent-handoff-index.spec.ts` (agent-sdk compaction) is flaky under load because it depends on a timer and the filesystem.
- `session-query-executor.accounts.spec.ts` could use a positive case for the bundled `Claude Max` shape on the main-chat path. The shared predicate's spec covers it, but the 6-file cap kept me from adding it there.
