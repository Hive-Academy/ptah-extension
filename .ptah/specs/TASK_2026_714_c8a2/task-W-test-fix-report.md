# Unit test failure fixes

Workspace: `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`

All five failures came from stale test setup or expectations. Production behavior was
left intact, including the A3 native Codex launch gate and the reviewed refusal of
a stored Claude session when its workspace selects Codex.

## 1. Buffered native child frames

- **Root cause:** The test sent `item/started` and `item/completed` frames without
  their required timestamps. Its `thread/started` frame also omitted required
  thread fields, and the partial `RuntimeContext` fake lacked `knownChildParents`.
- **Decision:** Fix the spec fixtures. Keep the assertions for child admission,
  root settlement, and pruning.
- **Changed:** `libs/backend/codex-runtime/src/lib/codex-context.spec.ts:17`,
  `:27-35`, `:61-67`.

## 2. One-shot ambient token

- **Root cause:** The no-override fixture used the retired
  `codex-proxy-managed` placeholder as an ambient token. The A3 launch gate
  correctly refuses that token without the native Codex runtime.
- **Decision:** Fix the spec fixture to use an ordinary ambient Claude token.
  The inheritance assertion is unchanged in meaning.
- **Changed:**
  `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:898`,
  `:905`.

## 3. Live spawn/history parity

- **Root cause:** Live item frames lacked timestamps required by the protocol
  validator, so the translator dropped them before the parity assertion.
- **Decision:** Fix the live spec frames. Preserve the full event-contract
  comparison, including spawn, child completion, and finished wait mapping.
- **Changed:**
  `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts:208-234`.

## 4. Retired proxy integration S1-S5

- **Root cause:** These tests exercise direct SDK/CLI Codex translation proxy
  integration, which A3 now refuses and A4 is scheduled to delete. The failure
  excerpts also show Windows EPERM during temporary symlink cleanup.
- **Decision:** Skip the whole legacy integration describe with an explicit A4
  deletion reason. The tests remain in place for A4 removal; their assertions
  were not weakened. A3 refusal coverage lives in the current native-path specs.
- **Changed:**
  `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:915`.
- **Limit:** S1-S5 no longer execute in this branch.

## 5. Stored Claude session after workspace switches to Codex

- **Root cause:** Both native specs used a partial active-provider mock without
  `resolveActiveAuthWithDefault`, which the resolver now calls. Their old success
  expectations also conflicted with the approved A3 Round 2 provider-mismatch
  refusal.
- **Decision:** Fix the mock and assert `AUTH_REQUIRED` with the stored Claude
  provider, no SDK resume/slash relaunch, and no provider-profile build.
- **Changed:**
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:577-627`;
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts:323-369`.

## Verification

Read the relevant protocol schemas, resolver, runtime-profile and catch paths;
reviewed the edited assertions and line references. No test, typecheck, lint,
build, diagnostics, or other verification command was run, as required by the
task. The prior coordinator reported typecheck and lint passing before these
spec-only edits; that result was not rechecked here.
