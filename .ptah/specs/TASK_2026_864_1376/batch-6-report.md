# Batch 6 report

## Files written

- `libs/backend/auth-providers-tokens/src/lib/tokens.ts`: added `SDK_CODEX_LOGIN` and `SDK_CODEX_READINESS` symbols.
- `libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts`: added the unregistered Codex readiness RPC collaborator.
- `libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.spec.ts`: covers option validation, unknown trigger dropping, and absent reader.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`: accepts the three ambient status triggers while retaining strict rejection of extra keys.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`: logs sanitized Claude readiness fields.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`: covers accepted triggers, unknown trigger and extra-key rejection, and path-free log data.
- `.ptah/specs/TASK_2026_864_1376/batch-6-report.md`: this report.

## Method contract

`CodexReadinessMethod.register()` registers `auth:getCodexReadiness` with the RPC handler. It accepts absent params or an object, requires `refresh` to be boolean when present, forwards only `mount`, `follow-up`, or `recheck` as `trigger`, and drops unknown trigger values. It forwards the sanitized options to `ICodexReadinessReader.read()` and returns its `AuthGetCodexReadinessResponse`. With no reader, it returns `{ binary: { state: 'unknown', reason: 'local' }, signIn: { outcome: 'unreadable' }, checkedAt: <current ISO timestamp> }`.

## Log format

Successful ambient Claude reads log `logger.info('[readiness] claude', { state, reason, trigger })`. The object contains no path, token, raw output, or provider error.

## Decisions

- Decision: reject invalid `refresh` and malformed top-level params with `RpcUserError('INVALID_PARAMS')`; options were coercion or rejection. Evidence: plan says validate `refresh` as a boolean and nearby RPC boundaries reject invalid params. Reversible: yes.
- Decision: drop unknown Codex `trigger` values while forwarding recognized values; options were dropping or rejecting. Evidence: explicit Batch 6 requirement. Reversible: yes.
- Decision: keep this collaborator unregistered in `AuthRpcHandlers`; options were immediate registration or Batch 7 ownership. Evidence: explicit Batch 6 scope and plan. Reversible: yes.

## Risks and limitations

- No tests, builds, Nx, Jest, TypeScript CLI, git, or `npm run verify` were run, per caller instructions. The orchestrator owns the scoped verify.
- `ptah_get_diagnostics` was attempted twice on all six scoped TypeScript files. Both attempts reported TypeScript compiler unavailable because its check was still running after 45 seconds; no clean diagnostic result was available.
- Two existing manifest specs remain expected to fail until Batch 7 registers `auth:codexLoginCancel` and `auth:getCodexReadiness`.
