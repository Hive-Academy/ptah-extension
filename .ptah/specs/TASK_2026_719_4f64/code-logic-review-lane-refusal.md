# Code logic review — lane refusal diagnostics

Verdict: **REVISE**
Score: **6/10**
Counts: 0 Blocking, 0 Serious, 2 Moderate, 0 Minor; 2 failure modes.

## Findings

1. **Moderate — diagnostic logging can replace the original refusal.**
   Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:283`, called before throwing at lines 302, 310, 415 and 268; `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:191`.
   Both helpers invoke `warn()` without isolating exceptions. A valid injected logger whose sink throws makes the service reject instead of returning its original coded refusal. In the adapter, the new calls outside the launch try or inside its catch let the logger's exception escape instead of the fixed lane refusal. For example, a logger throwing `Error('private sink failure')` when persistence is unavailable replaces `unavailable-storage` and its safe message. If service logging throws, the adapter instead normalizes that exception to `identity-unproved`, losing the service's original code.
   This is a dependency-failure regression introduced by this diff, not a claim that ordinary logging currently fails. Electron's adapter also forwards output synchronously without an exception boundary (`apps/ptah-electron/src/di/electron-adapters.ts:358`, output forwarding at line 60); the injected `Pick<Logger, 'warn'>` contract supplies no no-throw guarantee.
   **Fix:** make refusal diagnostics best-effort, preserve the original refusal independently of logging, and add throwing-logger cases for the service and adapter. Any added catch needs a `// degradation-audit:` marker. Never log the logging exception.

2. **Moderate — the new unsupported-store message diagnoses the wrong cause for filesystem failures.**
   Evidence: `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:320` says the installed CLI version is unsupported. However, `libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts:38` returns that code for a non-directory or unusable filesystem identity, and line 46 returns it for failed realpath/stat operations. Admission calls this resolver at `provider-account.service.ts:123` and preserves the code at line 128; the adapter then selects the misleading message.
   A user whose stored account directory was deleted or became unreadable is therefore told to address the CLI version. This recreates the diagnostic defect this bugfix is intended to remove.
   **Fix:** use fixed wording covering unsupported/unavailable account storage and CLI support, or use a broader fixed description without claiming a unique cause. Add a regression assertion for the route-resolution failure. The code itself should remain unchanged.

The score reflects real failures in two explicit goals: preserving the original refusal under dependency failure and replacing misleading diagnostics. It is below the sound 7–8 band because both require changes; above 3–4 because the normal refusal flow, fixed payload construction, exhaustive mapping, and optional DI wiring are otherwise coherent.

## Checked

1. **Sensitive values:** normal new warning payloads contain only literal prefixes, literal stages and typed refusal codes (`claude-cli.adapter.ts:279`, `provider-account.service.ts:189`). The map contains fixed strings only (`claude-sdk-lane-runner.ts:313`). Returned summaries and foreign SDK exception messages are not copied into those payloads. Finding 1 prevents an unconditional safe-error guarantee. These are trusted in-process ports: arbitrary malformed runtime `code` values are not validated by these helpers, so static typing alone is not a guarantee against a contract-violating dependency (`claude-cli.adapter.ts:365`).
2. **Code preservation:** the diff retains store/certifier/settlement branches and the `refusalCode ?? claudeLaneRefusalCode(error)` precedence (`provider-account.service.ts:110`, `:128`, `:145`, `:147`; `claude-cli.adapter.ts:414`). No catches were added or errors deliberately swallowed. Finding 1 is the new exception-path gap. Timeout remains its previous `identity-unproved` code, not a newly introduced `timeout` conversion (`claude-cli.adapter.ts:409`).
3. **Optional DI:** additive fourth parameter defaults to null (`provider-account.service.ts:64`). Installed tsyringe forwards `isOptional` and returns undefined for an absent normal token (`node_modules/tsyringe/dist/cjs/decorators/inject.js:8`, `dependency-container.js:105`), activating that default. Three-argument fixtures remain valid (`provider-account.store.spec.ts:78`). Service useClass registration remains intact (`libs/backend/auth-providers/src/lib/di/register.ts:189`). Electron binds the token at `apps/ptah-electron/src/di/phase-0-platform.ts:59`; VS Code binds it at its corresponding file, line 50. No new required registration was introduced.
4. **Map and override:** all fourteen non-ok codes in `libs/shared/src/lib/types/provider-account.types.ts:38` are represented by the typed Record (`claude-sdk-lane-runner.ts:313`); the port excludes ok (`libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:248`). The explicit missing-admission override remains at `claude-cli.adapter.ts:305`. Meaning of one mapped message fails finding 2.
5. **Tests:** new assertions exercise admission code/message/log redaction (`claude-cli.adapter.spec.ts:677`), request logging (line 663), launch refusal logging (line 1086), and service certify/request/store payloads (`provider-account.store.spec.ts:774`). The missing-port test still checks the override (`claude-cli.adapter.spec.ts:404`). No process.cwd() or new namespace spies appear in the changed specs. Tests do not cover throwing loggers or the misleading filesystem case; settle/timeout log payloads also lack new direct assertions.
6. **Catch markers:** the supplied diff adds no catch blocks; the marker requirement is not triggered by this change. Existing certification degradation has a marker (`provider-account.service.ts:136`).

## Five logic questions

1. **How does this fail silently?** No new success-looking admission result was identified: service refusal branches still return non-ok and the adapter throws (`provider-account.service.ts:147`, `claude-cli.adapter.ts:364`). An absent optional logger produces no warning by design (`provider-account.service.ts:191`).
2. **What user action produces unexpected behavior?** Removing or losing access to an existing account directory produces CLI-version advice: finding 2.
3. **What input produces a wrong answer rather than an error?** A stored route resolving to a non-directory gets the wrong explanatory text for its otherwise correct code: finding 2. The record is exhaustive but does not prove semantic accuracy.
4. **What happens when a dependency fails, times out, or returns an invalid shape?** Existing foreign errors normalize to identity-unproved (`claude-sdk-lane-runner.ts:361`); the admission deadline aborts and refuses (`claude-cli.adapter.ts:406`). New logger failures escape this protection: finding 1. Returned refusal codes remain a trusted-port assumption, as noted in Checked 1.
5. **What requirement is missing?** Diagnostic-only logging needs an explicit no-throw boundary, and per-code text must cover every producer of a code, including filesystem errors. Both are necessary to honor the stated behavior-preservation and accurate-message goals.

## Scope, evidence and limitations

Reviewed the supplied diff, implementer report, three production files, relevant test fixtures and changed assertions, account-route refusal producers, port/result types, tsyringe optional resolution, and Electron logging/registration. This is a focused bugfix review, not approval of the surrounding feature or all existing tests. Root instructions and task intent were consulted; long task-plan output was truncated, so no claim is made to exhaustive plan verification.

No source was modified and no git commands, builds, or test suites were run. The required scoped ptah diagnostics request returned **unavailable**: TypeScript was still running after 45 seconds, all three production files unchecked. That is not a passing result. The implementer's report claims changed-project typechecks and cli-agent-runtime checks passed, with auth-providers integration/lint failures; those are reported evidence, not independently reproduced results.

## Decisions

- Keep D62 account-override behavior and certification policy unchanged. These are explicitly outside this bugfix's scope; no capability change is requested by this review.
- Treat logger exceptions as a behavior-preservation finding, rather than assuming a no-throw contract absent from the injected interface. A local best-effort boundary is reversible and does not change refusal codes.

