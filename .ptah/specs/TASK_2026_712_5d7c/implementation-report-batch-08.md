# Batch 08 implementation report

Implemented final child-environment routing in both SDK option constructors. Only the six assigned source/spec/barrel files and this report were written. No git operation was run.

## Files changed and insertion points

- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts:5` ? `const CONFLICTING_SELECTORS`.
- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts:44` ? `export function applyClaudeAccountRouteEnv`.
- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts:177` ? `describe('applyClaudeAccountRouteEnv'`.
- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts:261` ? `describe.each`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:50` ? `type ClaudeAccountRoute`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:740` ? `accountRoute?:`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1337` ? `env: applyClaudeAccountRouteEnv`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:57` ? `type ClaudeAccountRoute`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:165` ? `accountRoute?:`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:606` ? `env: applyClaudeAccountRouteEnv`.
- `libs/backend/agent-sdk/src/lib/helpers/index.ts:263` ? `export { applyClaudeAccountRouteEnv }`.
- `libs/backend/agent-sdk/src/index.ts:452` ? `export { applyClaudeAccountRouteEnv }`.

Both constructor input interfaces now accept optional `accountRoute?: ClaudeAccountRoute`, imported through the public auth-providers-tokens alias. Each final `env` object is wrapped by `applyClaudeAccountRouteEnv` after all existing spreads. Other launch, settings, tool and permission behavior is unchanged. Each barrel has one added export line.

## Acceptance coverage

All specs are in `claude-account-route-env.spec.ts`; these are authored coverage, not executed results.

1. Polluted base env cannot override a named route: `clears certified conflicting selector %s for a named route` enumerates all 35 conflicting selectors; `clears Windows selector casing without clearing unrelated keys` covers Windows casing. Both constructor suites run `applies the named route after all env spreads and preserves permission policy` to catch selectors reintroduced by tier/auth spreads and a preexisting config directory.
2. Ambient/omitted equivalence: `returns ambient or omitted env by identity including preconfigured directory`; both `main completed child env` and `one-shot completed child env` run `keeps ambient/omitted env byte-equivalent to the existing constructor`. These assert exact objects and serialized bytes against each constructor's existing assembly, including a preconfigured directory and main workflow flag.
3. Native/permission preservation: `preserves the native safe allowlist and does not invent an ambient directory` calls the existing `buildSafeEnv`; its source was not edited. The constructor named-route cases compare permission mode, dangerous-skip option and tools with the baseline. The one-shot case uses `toolAccess: 'none'`; no autoapproval substitute was introduced.
4. Closed admission contract: `accepts only the admitted route and has no extra env or deletion options` includes compile-time equality checks for the route parameter and two-parameter maximum arity, and rejection checks for strings/unadmitted route shapes. The only routing input is the public branded admission union.
5. Immutability: `does not mutate process.env or AuthEnv`, frozen-base selector cases, and both named constructor cases check parent/input preservation. HOME, USERPROFILE and XDG keys are retained; ambient returns the original reference.

## Decisions

- **Selector ownership:** mirrored the finite selector enumeration from `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:29` locally, excluding CLAUDE_CONFIG_DIR because it is replaced with the admitted directory. Options were importing the implementation, moving the list into a shared contract, or keeping this bounded local list. The auth-providers implementation already imports agent-sdk, and shared-contract edits are outside Batch 8 ownership. Local enumeration avoids a cycle and deep import; independently enumerated specs pin it. Reversible: consolidate via a public contract in a separately owned change. Admission/source certification remains the admission service's job; this helper does not certify new routes.
- **Windows casing:** compare only finite enumerated selector names case-insensitively and remove alternative spellings of CLAUDE_CONFIG_DIR. Windows is the task's working/priority-host environment; leaving duplicate case spellings could let an inherited directory or token win at spawn. Unknown unrelated keys remain intact; no wildcard prefix deletion. Reversible local implementation choice.
- **Input seam:** added optional `accountRoute` fields to the existing builder/one-shot inputs, following the plan's admitted-route-only contract. Omitted values preserve existing callers. Route admission and upstream propagation belong to later batches.
- **Constructor specs:** use the real main builder and the one-shot option-construction method with stubbed dependencies, without loading a vendor SDK or launching a child. Reflect.construct supplies the repository's existing positional test stubs without forbidden double casts. Branded route assertions appear only in explicitly documented already-admitted test fixtures.

## Verification and anything not done

- Scoped `ptah_get_diagnostics` on all six assigned files: final result **0 errors, 0 warnings**, coverage clean. Initial strict index-access errors in the new spec were fixed before the final check.
- Only the new helper/spec were formatted using the installed Prettier API. Constructor edits were limited to imports, optional route input and final env wrapper.
- Per instruction, no nx, Jest, tsc, lint, build, real vendor binary, network or git command was run. Specs have **not** been executed; CI owns runtime verification.
- No files outside ownership were repaired or reverted. No task state was changed. Admission, real account certification and native lane application are outside this batch.
