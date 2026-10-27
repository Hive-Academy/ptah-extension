# Bugfix report: named Claude lane refused in ~21 ms (TASK_2026_719)

## Verdict

Root cause found. The refusal is the policy scan's `unsupported-source` (stage `certify`). It is
**not** a wiring defect. The run's working directory `D:\projects\property-hub` has
`.claude/settings.local.json` with an `env` block. Its single key is not on the certified env
allowlist, so the scan refuses source S3 before any `reg.exe` or Claude child starts. The real
defects were diagnostic. No refusal code was logged, and every caller got the same misleading
default message ("... prompt gate is not available"). Both are fixed.

## Candidate refusal paths reachable in under ~50 ms (fresh lane, no resume)

| # | Path | file:line | Code | Status |
|---|------|-----------|------|--------|
| 1 | `deps.admission()` null | `claude-cli.adapter.ts` prepareNamed, first guard | `unavailable-storage` with custom message | Ruled out: the message differs, and Electron binds `SDK_PROVIDER_ACCOUNT_ADMISSION` (`auth-providers/src/lib/di/register.ts:211`) |
| 2 | `accountPersistence()` null or unavailable | prepareNamed, second guard | `unavailable-storage` | Ruled out: Electron binds `CLAUDE_LANE_ACCOUNT_PERSISTENCE` (`apps/ptah-electron/src/di/claude-named-account-bindings.ts:39`), smoke-tested in `container.smoke.spec.ts:459`. The guard also throws outside the final catch, and the stack named the final catch. |
| 3 | Resume or selection checks inside `pending` | prepareNamed, the lookup and selection checks | `identity-unproved` / `conflict` | Ruled out: fresh spawn, explicit named selection from `laneAccountAdmission` (`agent-process-manager.service.ts:565-604`) |
| 4 | Admission schema parse (`.strict()`) | `provider-account.service.ts:110-114` | `conflict` | Ruled out: `laneAccountAdmission` sends exactly provider/scope/selection/operationId/runId/workingDirectory (UUIDs, absolute cwd) |
| 5 | `store.get` / `acquireRunLease` | `provider-account.service.ts:118-126` | `missing-profile` / `busy` / `release-held` / `conflict` | Unlikely: profile live at revision 17, no leases |
| 6 | **Certifier policy scan S1-S6 (files only, no child)** | `claude-route-certifier.ts:194,265-271` -> `claude-auth-settings-scan.ts:225-263,376-388` | **`unsupported-source`** | **Proved for S3** (below) |
| 7 | Scan S7 `reg.exe` queries, `--version`, `auth status` children | `claude-auth-settings-scan.ts:310-367`, `claude-route-certifier.ts:274,201` | various | Too slow for 21 ms (each needs a child process) and later in the sequence than S3 |

## Proof (path 6, source S3)

- `ProviderAccountService.admitClaudeRoute` certifies with `cwd: workingDirectory` (the lane's
  other workspace) and `RUN_SETTING_SOURCES = ['user','project','local']`
  (`provider-account.service.ts:28,131-132`).
- `scanClaudeAuthPolicy` resolves S1, S2, then S3 = `<cwd>/.claude/settings.local.json`
  (`claude-auth-settings-scan.ts:232-233`). The file is read and parsed in memory, and no child
  starts.
- `claudeSettingsOverride` (`agent-sdk/src/lib/helpers/claude-certified-launch.ts:407-431`)
  returns `override` for any `env` key that is not on `CLAUDE_CERTIFIED_ENV_KEYS`, which is an OS
  and proxy allowlist of 47 keys.
- I checked the file without printing any name or value, reporting counts and booleans only:
  `property-hub/.claude/settings.local.json` has `envKeys 1 | offAllowlist 1`. Its
  `.claude/settings.json` has no `env` and no `enabledPlugins`, so S2 passes.
- The result is `unsupported-source` with `terminated: true`. The lease is released
  (`provider-account.service.ts:139`), the port returns the refusal, and the adapter sets
  `refusalCode` and rethrows through the final catch using the then-default message. This fits the
  21 ms timing, a "live" profile, and the empty refusal record.

S1 (the profile's own `settings.json`) comes before S3 and also gives `unsupported-source` if it
refuses. I did not read it because it sits in the account's config directory. Either way the code
is `unsupported-source`, and S3 is enough on its own to refuse.

## Fixes

1. **Refusal diagnostics, fixed text with only the code and a stage word**
   - `ClaudeCliAdapter.logRefusal(stage, code)` logs
     `this.logger.warn('[ClaudeCliAdapter] Named lane refused', { stage, code })`. The stages are:
     - `request`: the two up-front `unavailable-storage` guards, plus the pre-admission checks
       inside `pending`.
     - `admission`: a non-ok `admitClaudeRoute` result.
     - `prepare`: after admission, for a non-named resource or a route mismatch.
     - `timeout`: the 15 s timer fired.
     - `launch`: the `runSdk` catch after admission, for example a `checkLaunchBoundary` refusal.
   - `ProviderAccountService.admissionRefusal(stage, code)` logs
     `[ProviderAccountService] Claude route admission refused` with `{ stage, code }`. The stages
     are `request` (disposed, wrong provider, schema parse, not named), `store` (get/lease),
     `certify` (certifier refusal) and `settle` (release/retain failure). The logger is
     `@inject(TOKENS.LOGGER, { isOptional: true })` and typed `Pick<Logger,'warn'> | null`.
2. **Message per refusal code (coordinator request).** `claudeLaneRefusal()` now defaults to
   `CLAUDE_LANE_REFUSAL_MESSAGES[code]`. This is an exhaustive, type-checked
   `Record<ClaudeLaneRefusalCode, string>` of fixed, path-free texts, each in the form
   `Claude account refused (<code>): <plain words>`. The explicit
   `'Claude account admission is not available'` override is kept.
3. As instructed by D62, I did not change the agent account override behaviour.

## Decisions

- **The logger in `ProviderAccountService` is optional.** The options were a required inject,
  which breaks the 3-arg spec constructions and any test container without `TOKENS.LOGGER`, or an
  optional inject. Logging is diagnostics only, and `isOptional` is already used in this repo
  (`sdk-query-runner.service.ts:307`). The change is reversible.
- **The S3 env-allowlist refusal is kept as is.** It is designed security policy (Component 7):
  project `env` could inject `ANTHROPIC_*` credentials. Relaxing it, for example by allowing
  harmless keys, is a user-reserved security decision. See Open item.

## Tests

- `claude-cli.adapter.spec.ts`:
  - New test: an admission refusal (`unsupported-source`) logs `{ stage: 'admission', code }`,
    the message matches `^Claude account refused \(unsupported-source\): `, and no summary or path
    is logged.
  - The unavailable-persistence test now asserts `{ stage: 'request', code: 'unavailable-storage' }`.
  - The launch-boundary refusal test asserts `{ stage: 'launch', code: 'unsupported-source' }`.
  - The old "prompt gate is not available" assertion was replaced with the new per-code text.
- `provider-account.store.spec.ts`: new test. A certifier `unsupported-source` (cwd in another
  workspace), a non-named selection and a missing profile log `certify` / `request` / `store`
  with their codes, in order. It also asserts that no profile ID, run ID or path reaches the log.

## Verification

Command:
`node scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime,@ptah-extension/auth-providers`

Result: `NX 6 tasks: 4 succeeded, 1 cached, 2 failed`.

- cli-agent-runtime: lint, test and typecheck pass. The first run caught a fixture typing error
  in my new spec. It is fixed, and the suite now passes.
- auth-providers typecheck passes.
- auth-providers test: 2262 passed, 5 failed. Every failure is in
  `src/lib/translation/translation-proxy.sdk.integration.spec.ts` (TASK_2026_408, real SDK/CLI
  integration, S1-S4 and S6). I did not touch that file, and the failures are flaky: the count
  changed from 4 to 5 between runs. My new `provider-account.store.spec.ts` test passes.
- auth-providers lint: 1 error, `@nx/dependency-checks` in `libs/backend/auth-providers/package.json:9`
  ("persistence-sqlite not used"). The error was already there before this change:
  `git diff --quiet 396f0135b -- libs/backend/auth-providers/package.json` reports no change. The
  rest are warnings only.
- Degradation audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  exits 0 (TOTAL 277). I added no new catch blocks.
- The Electron and VS Code hosts were not typechecked separately. The constructor change is
  additive and optional, and only the default message text changed.

## Files changed (5 source + this report)

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`

## Open item for the coordinator / user

The certified env allowlist refuses **any** project or local `env` key outside the OS and proxy
list. That includes harmless tuning keys such as `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. As a result,
named lane accounts cannot run in any workspace whose `.claude/settings*.json` sets `env`. The
options are:

- **(Recommended)** Keep the policy, and surface the new `unsupported-source` text in the UI and
  the lane result.
- Add an allowlist of non-auth tuning keys, which needs a security review.
- Ignore project and local `env` for named lanes, which needs a CLI behaviour check.

This is a security-policy decision for the user.
