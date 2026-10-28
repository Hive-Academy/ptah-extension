# Bugfix: settings `env` allowlist for named Claude accounts (D63)

## Verdict

Fixed. A settings file whose `env` block holds only certified names and the 18 settings-safe
names below now classifies `none`. The fix covers `ENABLE_TOOL_SEARCH` in
`.claude/settings.local.json`, the case that refused the property-hub lane. Every
auth, endpoint, provider, config-dir and unknown key still classifies `override`. The scan
then refuses with `unsupported-source`. The process env passed to the child is unchanged.

## Design choice: a separate constant, process env not widened

`CLAUDE_CERTIFIED_ENV_KEYS` (47 OS and proxy names) serves several purposes:

- (a) It judges settings `env` keys in `claudeSettingsOverride`.
- (b) It filters the host env in `buildCertifiedClaudeEnv`.
- (c) It drives `launchEnvCertified`, `sameCertifiedEntries` and the digest used by
  `assertCertifiedLaunch`.
- (d) It drives the ambient login env (`claude-ambient-login-status.ts`).
- (e) It drives the PowerShell login console allowlist (`claude-login-console.ts`).

Only (a) needed to change. The Claude CLI applies a settings `env` block inside the child
after launch. These values never travel in the SDK `env` option, so the child-env contract
(b-e) does not have to admit them for the setting to work. I added:

- `CLAUDE_SETTINGS_SAFE_ENV_KEYS`: an exported `as const` list of exact names, with no
  prefixes or patterns.
- `isClaudeSettingsEnvKeyAllowed(name)`: returns certified names plus settings-safe names,
  matched case-insensitively like the existing check.

Only `claudeSettingsOverride` uses the new function. A host-env `ENABLE_TOOL_SEARCH` is still
dropped by `buildCertifiedClaudeEnv`, and a spec pins that.

## Allowlist (all 18 kept, with a non-auth reason for each)

| Key | Why it is non-auth |
| --- | --- |
| ENABLE_TOOL_SEARCH | Turns MCP tool search (deferred tool loading) on or off. It only affects tool presentation. |
| MAX_THINKING_TOKENS | Sets the extended-thinking budget on the same model and account. |
| CLAUDE_CODE_MAX_OUTPUT_TOKENS | Caps output tokens per response. It is a request size limit. |
| BASH_DEFAULT_TIMEOUT_MS | Sets the default timeout of the local Bash tool. |
| BASH_MAX_TIMEOUT_MS | Sets the upper bound on Bash tool timeouts. |
| BASH_MAX_OUTPUT_LENGTH | Sets the character cap before Bash output is truncated. |
| MCP_TIMEOUT | Sets the MCP server startup timeout. It is local tooling. |
| MCP_TOOL_TIMEOUT | Sets the MCP tool execution timeout. |
| MAX_MCP_OUTPUT_TOKENS | Caps the size of MCP tool responses. |
| DISABLE_TELEMETRY | Opts out of Statsig telemetry. It only reduces traffic. |
| DISABLE_ERROR_REPORTING | Opts out of Sentry error reporting. It only reduces traffic. |
| DISABLE_AUTOUPDATER | Stops self-update. The executable is still version-checked by the certifier. |
| DISABLE_COST_WARNINGS | Hides cost warning UI. |
| DISABLE_NON_ESSENTIAL_MODEL_CALLS | Skips flavor-text model calls. It only reduces calls on the same route. |
| CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC | Turns off the autoupdater, telemetry and error reporting as a group. It only reduces traffic. |
| CLAUDE_CODE_DISABLE_TERMINAL_TITLE | Stops terminal title updates. It is cosmetic. |
| USE_BUILTIN_RIPGREP | Chooses the bundled or the system `rg` for search. It is local tooling. |
| CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR | Returns Bash to the project cwd after each command. It is local tooling. |

No key was dropped. None of them selects an account, a credential, an endpoint, a provider,
model routing to another backend, or the config directory.

## Files changed (5)

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`: adds the
  `CLAUDE_SETTINGS_SAFE_ENV_KEYS` list and the `isClaudeSettingsEnvKeyAllowed` function, and
  `claudeSettingsOverride` now uses that function. The doc comments are updated.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/index.ts`: barrel export.
- MODIFIED `libs/backend/agent-sdk/src/index.ts`: public barrel export.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts`: new tests.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.spec.ts`:
  S3 local-file tests.

None of the 5 files reserved for the other batch was touched.

## Tests added

- `claude-certified-launch.spec.ts`:
  - A deny-regex test checks that no allowlisted key matches any of these patterns:
    `ANTHROPIC`, `API_KEY`, `_TOKEN$`, `AUTH`, `BASE_URL`, `BEDROCK|VERTEX`, `^AWS_`,
    `^GOOGLE_`, `^CLOUD_ML`, `CONFIG_DIR`, `OAUTH`, `HELPER`, `PROXY`, `CREDENTIAL`,
    `PROVIDER`, `MODEL$`. `_TOKEN$` is end-anchored so that the `*_TOKENS` size caps pass and
    any `*_TOKEN` credential name fails.
  - Every safe key is allowed in settings in both upper and lower case. None is certified for
    the child env. `PATH` is still allowed. `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`,
    `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CONFIG_DIR` and `ENABLE_TOOL_SEARCH_X` are refused.
    `buildCertifiedClaudeEnv` drops a host-env `ENABLE_TOOL_SEARCH` and `MCP_TIMEOUT`.
  - New `claudeSettingsOverride` cases:
    - Classify `none`: a safe key alone, and safe keys mixed with certified keys.
    - Classify `override`: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`,
      `CLAUDE_CODE_USE_BEDROCK`, an unknown key, and a safe key mixed with
      `ANTHROPIC_BASE_URL`. The existing `CLAUDE_CONFIG_DIR` case still classifies `override`.
- `claude-auth-settings-scan.spec.ts` (S3, `<cwd>/.claude/settings.local.json`):
  - `{env:{ENABLE_TOOL_SEARCH}}` now scans `ok: true`.
  - `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CONFIG_DIR`,
    an unknown key, and a safe key mixed with an unsafe one each return `unsupported-source`.

## Main chat and lane consistency

Both paths go through one function chain, so their verdicts cannot diverge:

1. `ClaudeRouteCertifier.scan` (`claude-route-certifier.ts:325`)
2. `scanClaudeAuthPolicy` (`claude-auth-settings-scan.ts`)
3. `claudeSettingsOverride` (`claude-auth-settings-scan.ts:262`)

The certifier is the only caller of the scan. The flag-settings tier check in
`assertCertifiedLaunch` (`claude-certified-launch.ts`) uses the same `claudeSettingsOverride`.

## Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/agent-sdk,@ptah-extension/auth-providers`
  reported `NX 6 tasks: 4 succeeded, 2 failed`.
  - All 3 agent-sdk targets passed, and auth-providers typecheck passed.
  - auth-providers test: `Tests: 4 failed, 10 skipped, 2270 passed`. All 4 failures are in
    `translation-proxy.sdk.integration.spec.ts`, which is the known flaky suite. The scan spec
    passed. `git diff --quiet 396f0135b` on that spec exited 0, so this failure was already
    there before this change.
  - auth-providers lint: 1 error, `@nx/dependency-checks` at `package.json:9`, which is the
    known failure. `package.json` is unchanged since 396f0135b.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0. No
  catch blocks were added.

## Decisions

- Decision: a separate settings-only list, with the process-env contract left as is.
  - Options: (a) widen `CLAUDE_CERTIFIED_ENV_KEYS`, (b) add a separate settings list.
  - Evidence: settings `env` is applied by the CLI inside the child. The certified list also
    feeds the env digest, the launch re-check, the ambient login and the login console.
  - Reversible: yes.
- Decision: match names case-insensitively.
  - Options: exact-case only, or case-insensitive.
  - Evidence: this matches `isCertifiedClaudeEnvKey`. A lowercase spelling can only reach the
    same feature variable on Windows, so it cannot reach an auth variable.
  - Reversible: yes.
- Decision: the new list also applies to the flag-settings tier and the managed tiers.
  - Options: settings files only (S1-S3), or every tier that `claudeSettingsOverride` judges.
  - Evidence: `claudeSettingsOverride` is the single classifier for all tiers. The keys carry
    no auth on any tier.
  - Reversible: yes.
- Decision: all 18 proposed keys are kept.
  - Evidence: each one is documented by Claude Code as a feature, tuning or traffic-reduction
    variable, and none matches the deny patterns.
  - Reversible: yes.
- Follow-up: D63 asks for a codex code-logic security review of this allowlist diff. That
  review has not been run yet.
