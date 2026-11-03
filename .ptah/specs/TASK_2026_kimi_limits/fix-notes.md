# Kimi plan usage review fixes

## Finding 1 — proxy session owner

- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:749-750`: Kimi proxy main sessions now resolve through `ownerForKimiCode()`. The Codex branch still uses `ownerForCodexHome()`.
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:818,832`: `Kimi OAuth proxy: resolves the CLI login owner without a provider key`; `Kimi API-key proxy: resolves the shared provider key owner`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts:967`: `discovers a Kimi OAuth main session and reads its plan usage` discovers a session target, passes it to the real `PlanUsageService`, and verifies an available result, two recorded windows, and one HTTP request. The discovery owner source is mocked; the owner-resolver specs separately exercise the real Kimi proxy branch.

## Finding 2 — legacy usage contradiction

- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:127`: Positive legacy usage contradicts a zero weekly ratio only. A zero monthly-code window no longer rejects the response.
- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.spec.ts:99,108`: `rejects positive legacy usage with a contradictory zero weekly ratio`; `accepts positive legacy usage with an unrelated zero monthly-code window`.

## Finding 3 — numeric input parsing

- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:11-15,27`: The shared strict schema accepts finite numbers and nonempty numeric strings converted with `Number`. It rejects null, booleans, empty or whitespace strings, and nonfinite results. Ratios retain the 0–1 range; legacy used values remain nonnegative.
- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.spec.ts:86-95,120,126`: `rejects malformed or contradictory usage` covers malformed ratio values; `rejects malformed numeric value %p` covers legacy values; `accepts fractional and exponent numeric ratio strings` covers `.5` and `1e-1`.

## Verification

Final passing commands, run one at a time:

```text
npm run verify -- -t test -p auth-providers -- --testPathPatterns='provider-owner.resolver.spec|kimi-code-plan-usage.reader.spec' --output-style=static
```

101 tests and 2 suites passed; 0 failed.

```text
npm run verify -- -t test -p cli-agent-runtime -- --testPathPatterns=plan-limit-owner-discovery.service.spec --output-style=static
```

39 tests and 1 suite passed; 0 failed.

```text
npm run verify -- -t typecheck -p auth-providers,cli-agent-runtime -- --output-style=static
```

2 project targets passed; 0 failed.

Earlier verification during test development:

- `npm run verify -- -t test -p auth-providers -- --testPathPatterns='provider-owner.resolver.spec|kimi-code-plan-usage.reader.spec'`: 1 Nx target passed, 0 failed; Jest counts were not emitted.
- `npm run verify -- -t test -p cli-agent-runtime -- --testPathPatterns=plan-limit-owner-discovery.service.spec --output-style=static`: 0 tests passed, 1 suite failed because a test-only `Logger` cast failed TypeScript compilation; removed.
- Same CLI discovery command after that fix: 38 tests passed, 1 failed because the test ledger did not retain snapshot windows; the assertion now checks recorded evidence.
- Same auth-provider command with `--output-style=static` before final test additions: 96 tests and 2 suites passed, 0 failed (Nx cache).
- Same auth-provider command after malformed-value additions, before naming the weekly test: 101 tests and 2 suites passed, 0 failed.

`git diff --check` reported no whitespace errors. No workspace-wide checks or lint ran. Known pre-existing failures remain: four Windows EPERM temp-cleanup failures in `translation-proxy.sdk.integration.spec.ts`, and auth-providers lint on unchanged `package.json:9`. Neither was changed or reproduced by these scoped checks.
