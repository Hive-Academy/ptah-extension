# P1 fix report — TASK_2026_719_4f64

Responds to `code-logic-review-p1.md` (REVISE 7/10). Exported names and signatures in
`claude-certified-launch.ts` are unchanged; no exports were added. The digest encoding is
unchanged, so `claude-route-certifier.ts`, `claude-login-console.spec.ts` and the port doc in
`provider-account-admission.port.ts` ("sorted `key=value` lines") stay accurate.

## Finding 1 — env digest ambiguity (Serious)

The digest representation stays as it was. The fix adds direct entry checks at both boundaries.

`libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`:

- `isDigestEncodable` (:147): a key has no `=` or `\n`, and a value has no `\n`. Under that
  condition the sorted-line encoding is injective.
- `launchEnvCertified` (:156): every launch-env entry is an allowlisted key or one of the two
  Claude directory keys, and is digest-encodable.
- `sameCertifiedEntries` (:171): the actual env's non-run-policy, defined entries have exactly
  the launch env's key set and values.
- `buildCertifiedClaudeEnv` (:211): an allowlisted value that contains a line break is not
  copied. Such a value is never a valid path, proxy or locale, and copying it would produce a
  launch that always refuses.
- `certifiedNamedEnv` (:262): refuses `route-changed` when `launchEnvCertified` fails, in
  addition to the digest check.
- `assertCertifiedLaunch` (:365-367): refuses `route-changed` unless `launchEnvCertified`,
  `sameCertifiedEntries` and the digest check all pass.

Tests in `claude-certified-launch.spec.ts`:

- `buildCertifiedClaudeEnv` › "does not copy an allowlisted value carrying a line break": the
  reviewer's `ALL_PROXY` input and a `NO_PROXY` value carrying a parent-managed key are both
  dropped.
- `certifiedNamedEnv` › "refuses a self-consistent launch env carrying %s": four cases, each
  with a recomputed matching digest: an embedded line break, a credential selector, a
  parent-managed key, and a key containing `=`.
- `assertCertifiedLaunch` › `final`/`bootstrap` drift › "refuses an env that splits an
  embedded line break into a new selector". The test first asserts that the two digests really
  are equal (the reproduction), then refuses both the split env and the ambiguous env as-is.
- `assertCertifiedLaunch` › both modes › "refuses an actual env adding %s even with a matching
  digest": cases for a credential selector and a parent-managed key.

## Finding 2 — settings bypass (Serious)

`claude-certified-launch.ts`:

- `CERTIFIED_INPUT_FLAGS` = `managed-settings`, `settings`, `setting-sources` (:300).
- `extraArgFlagName` normalizes leading dashes, an inline `=value` and casing (:313).
- `replacesCertifiedInput` (:322) is applied in both modes (:351) and refuses
  `identity-unproved`.
- The flag-settings check now runs in **both** modes (:354-358), before the route checks.
  Malformed and override settings both refuse with `identity-unproved`.
- `mcp-config` is not restricted. It is not a certified input in the plan, so restricting it
  would be a new decision.

Tests, all under `assertCertifiedLaunch` › `final`/`bootstrap` drift, next to the existing
both-mode managed-settings cases:

- "refuses an extraArgs certified-input replacement: %s": 8 cases. They include `settings`
  carrying `apiKeyHelper`, empty `settings`, valueless `settings`, `--settings`, `settings={}`,
  `SETTINGS`, `setting-sources` and empty `setting-sources`.
- "refuses a flag settings tier: %s": 7 cases. They include `apiKeyHelper` (the bootstrap
  override), `forceLoginOrgUUID`, a selector env, plugins, malformed JSON, `[]` and a
  non-object env.
- "accepts a flag settings tier with no auth override" (both modes).
- "allows other extraArgs keys at both boundaries": includes `settings-note`, which proves the
  rule matches names exactly and not by prefix.
- The old final-only flag-settings test is replaced by the both-mode cases.

## Finding 3 — fallback doc (Minor)

`libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:196-204`: the doc comment for
`ProviderAccountSignInFallback` now says the script intentionally contains the login command,
the certified cwd, the profile config directory and the executable path, for the user's own
terminal. It also says the script never carries a credential, email, organization or inherited
environment value. Finally, it marks the script as user-facing content, distinct from sanitized
errors and logs, that must not be logged. This change is documentation only.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts`:
  1 suite passed, 103 of 103 tests passed.
- `ptah_get_diagnostics` on the 3 changed files: 0 errors, 0 warnings.
- `npx prettier --write` on the 3 files (formatting only).
- Not run, as instructed: `npm run verify` and the dependent auth-providers specs. The
  auth-providers launches are built through `buildCertifiedClaudeEnv`, so they satisfy
  `launchEnvCertified`. That should be confirmed in the batch verify.

## Decisions

- I kept the digest encoding and added direct entry checks. The other option was a JSON
  encoding. I chose this because the review allows it, the port doc and all producers stay
  valid, and Batch 6 is unaffected. The change is reversible.
- Line-broken allowlisted values are dropped during the build. The other option was refusing
  the build. Dropping avoids a launch that can never pass for a user with an odd environment.
  The change is reversible.
