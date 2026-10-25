# P1-B fixes — lane A

Implemented finding 1 with the orchestrator-authorized canonical secure-storage overwrite. Both production named child-environment writers now pin the secure-storage namespace to the same canonical directory as CLAUDE_CONFIG_DIR. This supersedes the initial removal-only implementation and report.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts`: reject empty/whitespace-only named directories with an explicit Error; remove all casing variants of the secure-storage key through the existing selector scrub, then set the canonical uppercase key to route.canonicalConfigDir. Keep ANTHROPIC_CONFIG_DIR / ANTHROPIC_PROFILE removal and ambient/omitted identity behavior.
- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts`: polluted base environment includes uppercase, lowercase and mixed-case secure-storage keys. Regression assertions require exactly one canonical secure-storage key with the named directory, preserve the base env, exercise the SDK nullish fallback precedence, reject empty/space/tab/newline directories, and retain ambient identity checks. Main and one-shot option tests assert the canonical secure-storage directory and absence of alternate casing. Other selectors remain independently enumerated.
- `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`: keep all three namespace keys in CLAUDE_ACCOUNT_SELECTOR_KEYS; certifyClaudeAccountEnvironment now sets both directory keys to route.canonicalPath when constructing the child environment. Existing refusal of populated conflicting selectors remains unchanged.
- `libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts`: expect both canonical directories after certification, assert exactly one secure-storage key, cover empty/cased namespace cleanup, foreign namespace rejection, and parent immutability.

## Consumer audit

The initial ptah_code_search_symbols lookup returned zero hits (empty index), so targeted rg checked all CLAUDE_ACCOUNT_SELECTOR_KEYS references across libs/apps. Consumers are the local SELECTORS set in claude-account-command.ts and parameterized tests in provider-account-auth-env.spec.ts. Certification rejects populated conflicting selectors before clearing them and writes the canonical keys after filtering.

The follow-up free-text search for CLAUDE_CONFIG_DIR across all production TypeScript in libs/apps found only the route helper and certification helper as child-env writers; both are within scope and now set the secure-storage key. No production writer outside the four-file scope was found. Out-of-scope provider-account.store.spec.ts and provider-account-actions.service.spec.ts mock the command environment with only CLAUDE_CONFIG_DIR; these are test doubles, not production writers, and were left untouched.

## Diagnostics result

After the final source edits, ptah_get_diagnostics was called with exactly the four changed absolute TypeScript paths. Result: typescript-compiler unavailable; clean=false; unchecked=4. Reason: TypeScript check still running after 45 seconds; not cancelled. This is not a passing diagnostics result. No Nx, Jest, tsc, lint, build, serve, e2e, package or git command was run. CI must execute the updated regression specs.

## Decisions

1. **Authorized by the orchestrator: pin the secure-storage namespace after removing every casing.** Options were removal only versus canonical overwrite. Installed node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:209, J9, uses CLAUDE_SECURESTORAGE_CONFIG_DIR when defined instead of CLAUDE_CONFIG_DIR to derive the credential namespace. Lines 228–229 use child secure-storage value ?? process.env secure-storage value ?? child config directory. The orchestrator explicitly chose overwrite so the host fallback cannot win. Both child-env writers now emit the canonical value. Reversible through scoped source/spec edits; no parent env mutation.
2. **Authorized by the orchestrator: refuse blank named directories.** Empty or whitespace-only values throw an explicit Error with a fixed message; nonblank canonical paths are preserved verbatim. Options were pass-through or rejection; rejection is required by the updated instruction. The file had no existing error subtype to reuse. Reversible local validation change.
3. **Keep ANTHROPIC_CONFIG_DIR removal.** SDK bundle grep at line 29 shows Rv reading Me("ANTHROPIC_CONFIG_DIR") as the config root, PU reading configs/<profile>.json under that root, and IU deriving the credentials path from it. Options were retain or remove this proven root override; remove in both selector lists as authorized. Reversible local list/spec change.
4. **Keep ANTHROPIC_PROFILE removal.** SDK bundle grep at line 29 shows DU reading Me("ANTHROPIC_PROFILE") before active_config, with PU and IU consuming the profile for config and credential paths. Options were retain or remove this proven profile selector; remove in both lists. Reversible local list/spec change.
5. **Defer broad prefix removal to Batch 17 certification, as instructed.** Do not expand the route helper to remove all CLAUDE*/ANTHROPIC*/AWS_/GOOGLE_/AZURE_/CLOUD_/BEDROCK/VERTEX keys in this round. Other names found only in bundle exports/forwarding lists, including CLAUDE_CODE_FEDERATION_CACHE_DIR and host/managed-settings names, did not by themselves prove another namespace override implementation. Future certification can evaluate broader filtering; no speculative selectors were added.

## Anything not done

Tests were not executed under the explicit CI-only verification rule. Scoped diagnostics did not complete within the tool's 45-second window, so type correctness is not claimed as verified. No live SDK/authentication or Electron launch was performed. No other lane files, host surfaces, task states, release gates or files outside the four-source-file scope and this deliverable were modified.
