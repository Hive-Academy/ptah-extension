## Changes
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:191`: native resume checks the capability for the request consumer.
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:281`: native start and resume share the same capability mapping: chat uses `nativeCodex`, gateway uses `nativeCodexGateway === true`, and lane is refused.

## Specs added
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts:902`: table covers gateway resume with gateway-only capability (proceeds), gateway with chat-only capability (AuthRequiredError), chat with chat capability (proceeds), chat with gateway-only capability (AuthRequiredError), and lane with both capabilities (AuthRequiredError). Rejections assert the original error text.

## Decisions
- Kept `ExecutionProfileRequest.consumer` required and preserved the original `AuthRequiredError` message.
- Reused a private capability helper for both native start and resume while leaving the active provider check on start only.

## Not done
- Tests, typecheck, lint, build, Nx, and diagnostics were not run, as instructed.
- No matching backend skill was available in the local skill inventory; it listed only UI-focused `impeccable` and `typesafe-ai`.