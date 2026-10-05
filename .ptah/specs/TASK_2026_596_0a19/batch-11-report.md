# Batch 11 report: lane classifier, exit handling, lane owner and persistence

Task: TASK_2026_596_0a19. Executor: backend-developer. Scope: `libs/backend/cli-agent-runtime/**` only. No git.

## Verdict

All three tasks (11.1, 11.2, 11.3) are implemented and tested. The batch verification command passed.
Nothing outside `libs/backend/cli-agent-runtime` was edited. Nothing in auth-providers or agent-sdk
was touched or reverted.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\`.

| Change | Path | Purpose |
| --- | --- | --- |
| CREATED | `cli-agents\limits\lane-limit-classifier.ts` | Pure classifier with one pattern per wording. Holds `USAGE_LIMIT_REGEX` and `RETRY_AT_REGEX`. `laneLimitEvidence` turns a match into window or owner evidence. |
| CREATED | `cli-agents\limits\lane-limit-classifier.spec.ts` | F34-F40 and the evidence shapes |
| CREATED | `cli-agents\limits\lane-owner.resolver.ts` | `LaneOwnerResolver` (delegates to `ProviderOwnerResolver`) and the pure rule `upgradeQuotaOwner` |
| CREATED | `cli-agents\limits\lane-owner.resolver.spec.ts` | Owner per CLI, a lookup that throws, and the upgrade-only rule |
| MODIFIED | `cli-agents\cli-adapters\sdk-error-summary.ts` | Imports the two regexes from the classifier. Its output is unchanged and the existing spec passes untouched. |
| MODIFIED | `cli-agents\agent-process-manager.service.ts` | Changes are limited to: imports and constants, two constructor injections, the owner at spawn in `trackSdkHandle`, the new public `recordQuotaOwner`, `handleExit` classification, the owner carried on the deferred `agent:exited` emit, and the private `classifyLaneFailure` / `recordLaneLimits` |
| MODIFIED | `cli-agents\agent-process-manager.service.spec.ts` | Harness now includes `laneOwners` and `planLimits` stubs. New block "plan limits at spawn and exit" has 17 tests. |
| MODIFIED | `cli-agents\agent-process-manager.restore.spec.ts`, `cli-agents\agent-process-manager.workspace-scope.spec.ts`, `wiring\sdk-callbacks.spec.ts` | Pass the two new constructor stubs and nothing else |
| MODIFIED | `wiring\agent-events.ts` | The `CliSessionReference` gets `quotaOwner` (the full `QuotaOwnerRef`). New `agent:quota-owner` listener persists at once. |
| MODIFIED | `wiring\agent-events.spec.ts` | 5 G3 persistence tests |
| MODIFIED | `di\register.agent-process-manager.smoke.spec.ts` | Registers `PLATFORM_TOKENS.STATE_STORAGE`, which the ledger needs and every host's platform registration already provides. Asserts that the registered ledger and a `LaneOwnerResolver` are injected. |

## Stack observed

- DI is tsyringe: `@injectable` plus `@inject` by class or by token, registered in `di/register.ts`. Sibling
  pattern: `AgentOutputBuffer` and `LaneCompletionNotifier` are injected into the manager by class
  (`agent-process-manager.service.ts:163-175`).
- `LaneOwnerResolver` is injected by class and tsyringe builds it as an `@injectable`. No `register.ts`
  edit was needed (Task 13.3 owns tokens and registration). The ledger is injected through
  `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER` (`auth-providers-tokens/src/lib/tokens.ts:24`, registered at
  `auth-providers/src/lib/di/register.ts:215`).
- Committed APIs used (HEAD 48ddcb9f9): `ProviderOwnerResolver.ownerForCodexHome`, `ownerForCliStore`,
  `ownerForClaudeAccount`, `ownerForPtahCli`; `PlanLimitLedgerService.recordWindowEvidence`,
  `recordOwnerEvidence`, `recordSuccess`; types `PlanLimitBilling` and `ClaudeAccountInfo`, all from the
  `@ptah-extension/auth-providers` barrel (`lib/quota/index.ts`).
- Shared helpers come from `@ptah-extension/shared`: `resolveClockTimeReset`, `resolveRelativeReset`,
  `windowKindFromDuration` (`utils/plan-limits/instants.ts`).
- Logging uses `Logger` only. Match logs are `debug`. Ledger and lookup failures are `warn` and carry only
  the error name.

## Per-task evidence

### 11.1 Classifier and error-summary reuse

- `classifyLaneLimit({cliOrProvider, texts, observedAt, tz})` returns
  `{failureKind:'quota', windowKey?, modelScope?, resetsAt?, resetSource:'error-derived', pattern} | null`.
  The `pattern` field is extra and exists only for the caller's debug log.
- There is one regex per wording. Each CLI is checked only against its own wordings:
  - codex: Codex
  - antigravity: Antigravity
  - opencode: OpenCode
  - ptah-cli: Claude and Ollama, because the lane's provider is not known at exit
  - `anthropic`: Claude
  - `ollama-cloud`: Ollama
  - copilot, cursor and pi: no wordings, so the result is `null`
- Claude: the window comes from the words before "limit reached":
  - "5-hour" gives `five_hour`
  - "weekly" gives `weekly`
  - "Opus weekly" gives `weekly_model:opus`
  - An IANA zone in parentheses after the reset, such as `(Europe/Berlin)`, is honoured.
- Codex: a retry time that names a date ("Oct 9th, 2026 5:05 PM") leaves the reset unknown. Without this,
  the clock parser would put the reset on the wrong day.
- Text containing `MODEL_CAPACITY_EXHAUSTED` is skipped. `RESOURCE_EXHAUSTED` without "reset after
  <duration>" gives `null`. Ollama needs `429` next to a limit wording, so a bare 429 in output does not
  match.
- `sdk-error-summary.ts` now imports `USAGE_LIMIT_REGEX` and `RETRY_AT_REGEX`. Its body is unchanged and
  `sdk-error-summary.spec.ts` passes without edits.

### 11.2 `lane-owner.resolver.ts`

- `ownerForLane(cli)` is synchronous and never throws:
  - codex: `ownerForCodexHome()`, which is unknown (keyed by the home) before the first read
  - opencode and antigravity: `ownerForCliStore(cli)`
  - any other CLI, including ptah-cli at spawn: `undefined`
  - A throwing lookup logs `{cli, errorName}` and returns `undefined`.
- `ownerForClaudeLane(account, agentId)` calls `ownerForClaudeAccount(account, 'run:<agentId>')`.
  `ownerForPtahCliKey(id, provider)` calls `ownerForPtahCli`. These are the Component 10 ptah-cli rules
  that Batch 12 will call.
- All hashing is delegated. This file does no hashing and handles no credential material.
- `upgradeQuotaOwner(current, candidate)` applies these rules:
  - no owner: take the candidate
  - unknown owner: take the candidate only if it is known
  - known owner: never replace it
  - an unknown candidate never replaces an unknown owner

### 11.3 `handleExit` classification, S3 and owner persistence

- **Spawn.** `trackSdkHandle` sets `info.quotaOwner` from `ownerForLane` before `agent:spawned`, so the
  spawn-time reference already carries it. `doSpawnSdk` and the resume entry were not touched (R5).
- **Classify before discard.** `classifyLaneFailure` runs inside the `running`-to-`failed` branch, before
  `flushDelta` and `outputBuffer.discard`. It reads:
  - the newest 8 `error` segments, newest first, each capped at 4 KB
  - then the last 16 KB of `stdoutBuffer`
- **Timeouts.** A timeout or a stop is never classified, because its status is no longer `running` when
  `handleExit` runs. A spec covers a timed-out lane whose output contains quota wording.
- **Quota match.** It sets `info.failureKind = 'quota'`; a later non-quota exit clears it to `undefined`.
  The evidence is recorded as `recordWindowEvidence` when a window is named, otherwise as
  `recordOwnerEvidence` (source `error-derived`).
- **S3.** On `completed` it calls `recordSuccess({ownerKey, modelScopes:[lowercased info.model],
  billing, observedAt})`, with billing as follows:
  - antigravity: `'plan'`
  - codex and opencode: `'unknown'`
  - ptah-cli: none (S2 covers it)
  - The call is skipped when the owner is absent or `identityKind === 'unknown'` (F65).
- **Exit upgrade.** An owner that is still unknown or absent is looked up once more at exit. A Codex home
  may have been read during the run. The rule is upgrade-only.
- **Ledger failure.** Every ledger write is in `try/catch` and logs `warn` with `{agentId, cli, errorName}`.
  The status, completion signal, `agent:exited` emit, cleanup and pending flush are unchanged (spec:
  "keeps the exit handling intact when the ledger write throws").
- **Upgrade of a running lane (Gate 2 note).**
  - The new public `recordQuotaOwner(agentId, owner): boolean` applies `upgradeQuotaOwner` and emits
    `agent:quota-owner`.
  - `agent-events.ts` listens and calls `persistCliSessionReference` right away. That is the extra
    persist call.
  - The extra persist is skipped only for a running lane that has no `cliSessionId` yet: its reference
    would be keyed by `agentId` and never replaced, the same guard `agent:spawned` uses. The exit persist
    then carries the owner.
- **Grace-delay race.** The deferred `agent:exited` emit now takes the current `tracked.info.quotaOwner`.
  Without that, an owner recorded during the 3 s grace delay would be overwritten by the older exit
  snapshot.
- **Persisted shape.** `CliSessionReference.quotaOwner` holds the full `QuotaOwnerRef`
  `{key, providerId, identityKind, label}`. `quotaOwnerKey` is never written; a spec asserts that it is
  absent.

## Fixtures covered

| Fixture | Spec |
| --- | --- |
| F34 | `lane-limit-classifier.spec.ts`: Claude "5-hour limit reached ∙ resets 2am" gives `five_hour` and the next 2am UTC; weekly; `weekly_model:opus`; IANA zone; owner-level when no window is named |
| F35 | classifier: Codex "try again at 5:05 PM" gives 17:05; a dated retry gives an unknown reset; the `sdk-error-summary` line. Manager: a failed codex lane gets `failureKind:'quota'` plus owner evidence |
| F36 | classifier: "RESOURCE_EXHAUSTED … reset after 144h24m50s" gives a relative reset; without a duration it gives `null` |
| F37 | classifier: "Free usage exceeded" gives owner evidence (provisional) |
| F38 | classifier: `429` with a limit wording; reaches ptah-cli; a bare `:429:` in output gives `null` |
| F39 | classifier `it.each`: MODEL_CAPACITY_EXHAUSTED (alone and with RESOURCE_EXHAUSTED), two timeouts and three auth errors all give `null`. Manager: a timeout is never classified |
| F40 | classifier: a Codex `turn.completed` token-count event with no quota fields gives `null` |
| F65 | manager: antigravity `completed` gives `recordSuccess` with `billing:'plan'` and the model scope; codex and opencode give `'unknown'`; an unknown owner gives no `recordSuccess` |
| G3 + note | agent-events: the reference carries the full owner; no owner field when absent; immediate persist on `agent:quota-owner` (running with a session id, or finished); waits when running without a session id. Manager: upgrade unknown to known emits; never overwrites known; never replaces unknown with unknown; the owner survives the exit grace delay |

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` (no extra flags): exit 0,
  "Successfully ran targets typecheck, test, lint".
  - Tests: 86 of 86 suites; 1781 passed, 1 skipped, 1782 total.
  - Lint: 0 errors, 44 warnings across the lib. The only warnings in files I touched are the two that were
    already present in `agent-process-manager.service.ts`: `max-lines` and the `no-empty-function` at
    `acquireSpawnLock`. HEAD shows the same two. The `max-lines` count grew from 1219 to 1361.
- Prettier: all touched files were clean at HEAD and were formatted after editing.
- The new or changed specs are 2 new suites plus 4 edited suites. The new tests are 29 classifier, 15
  resolver, 17 manager and 5 agent-events.
- Flake: one earlier `--skip-nx-cache` run (typecheck, test and lint in parallel) reported "1 failed /
  1780 passed". Nx flagged the task as flaky. The failure did not reproduce in four later runs (two
  `--output-style=static` runs, one plain run and the final run), all 1781 passed. I could not capture
  which test failed. It may or may not be in my new specs.
- Concurrent-lane interference: during development, ts-jest diagnostics briefly failed with
  `auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts:8` TS2305 (`ProbeCommandRunner`
  not exported by agent-sdk). That file belongs to the in-progress codex lane (Batch 10), and I did not
  touch it. While it was failing I validated with a temporary out-of-repo jest config that had
  diagnostics off (`%TEMP%\b11-jest.config.js`): 86 suites passed. By the final run the lane's state
  type-checked, and the official command passed with diagnostics on. **Batch 10 commits after this
  batch, so this command must be re-run then** (batches.md carry-forward).

## Plan deviations

- Plan text says `quotaOwnerKey`. I implemented the Gate 2 G3 shape instead: `info.quotaOwner` and
  `CliSessionReference.quotaOwner` hold the full `QuotaOwnerRef`.
- ptah-cli lanes get no owner at spawn. `AgentProcessInfo` carries no provider id, and their owner comes
  from the lane's `accountInfo()` or stored key. The registry calls `recordQuotaOwner` with
  `LaneOwnerResolver.ownerForClaudeLane` / `ownerForPtahCliKey` in Task 12.2. In this batch, only
  codex/opencode/antigravity get an owner at spawn, and only codex can upgrade at exit.
- Antigravity's upgrade from `cli-store` to `account` when its reader returns one needs the Batch 10
  reader. The `recordQuotaOwner` path supports it, but nothing calls it yet.
- The classifier reads at most 16 KB of output plus at most 8 × 4 KB of error segments, so up to 48 KB.
  The plan's "at most 16 KB" refers to the output tail.
- Model scope for S3 is the lowercased `info.model`. I did not use agent-sdk's `claudeModelFamily`
  because the system CLI lanes in S3 are not Claude-family windows. With no model, the success clears
  only unscoped allowances.

## Risks and how they are handled

- **False positives from tool output** (a lane grepping this repo prints "usage limit"):
  - Wordings are per CLI.
  - Classification happens only on a `failed` exit.
  - Ollama needs `429` plus a limit wording.
  - Residual: a ptah-cli Claude lane failing with a 429 that says "Too Many Requests" (an API rate limit)
    would be read as Ollama quota owner evidence. The provider is not visible at exit. Batch 12 stream
    signals are the better source for ptah-cli.
- **R7 (unknown-owner leakage):** S3 is skipped for unknown owners. Quota failure evidence on an unknown
  owner goes under that owner's own non-shared key.
- **R4 (secrets):**
  - No credential material passes through this lib. Owners arrive pre-hashed from
    `ProviderOwnerResolver`.
  - Logs carry agentId, cli, pattern, providerId, identityKind and error names only. They never carry
    error messages or keys.
- **Ledger or owner-lookup failure:** caught and logged. The exit path is unchanged.
- **DI:** the manager now needs `PLATFORM_TOKENS.STATE_STORAGE` resolvable, through the ledger. All three
  hosts register it: `platform-vscode/src/registration.ts:63`, `platform-electron/src/registration.ts:115`,
  `platform-cli/src/registration.ts:68`. The Electron container smoke spec registers it (`:336`). The
  ptah-cli and VS Code app specs stub `AGENT_PROCESS_MANAGER`. I did not run app-level smoke specs
  because they are outside `-p`.

## Out-of-scope observations

- `restoreAgents` does not copy `ref.quotaOwner` into restored manager records. The frontend restore path
  (agent-monitor store, a later batch) is where G3 "Different owner" is shown. I did not touch it because
  it is outside the exit and spawn regions.
- `register.ts` does not register `LaneOwnerResolver` explicitly. tsyringe builds it as an `@injectable`
  class. Task 13.3 may add an explicit `registerSingleton(LaneOwnerResolver)` next to `AgentOutputBuffer`
  for consistency.
- `agent-process-manager.service.ts` is well over the `max-lines` limit (a pre-existing warning). A later
  humanize pass could move the plan-limit exit helpers into `limits/`.
