# TASK_2026_534 — Batch 2: verify a stored key, save "Connect only" tiers safely

Added after batch 1 (items 1-12). Closes the two limits reported in
`fix-report.md` (items 4 and 6). User context: people usually add or edit a
provider while a chat session is running, so neither action may change the
running main agent.

## B2-1 Verify a stored key without re-entry, isolated from the running session

Today `auth:verifyDraftConnection` already probes in isolation:
`DraftVerificationService` (`libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:8-22`)
builds a per-call override via `ProviderAuthResolver.buildDraftOverride` and runs
ONE inference call through `InternalQueryService.execute` with `auth` as a
read-only per-call snapshot (Claude SDK query = its own subprocess). Nothing is
written to settings, secrets or `process.env`. The only blocker is the credential
check at `:444-453` (`credential.kind !== 'apiKey'` → error).

Change:
- Shared type (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts`): credential
  becomes a union `{ kind: 'apiKey'; value: string } | { kind: 'stored' }`.
- Backend: for `kind: 'stored'`, read the key server-side
  (`AuthSecretsService.getProviderKey(providerId)`, or the Anthropic key for
  `anthropic`) and feed it to `buildDraftOverride` exactly like a typed draft.
  The secret never crosses the RPC boundary, is never logged, never echoed in
  `detail`. No stored key → a typed `no-stored-credential` result, not a throw.
- Prove isolation in a spec: `process.env` snapshot, settings writes and secret
  writes are identical before/after a stored-key probe; the active route
  (`auth:getEffectiveRoute`) is unchanged.
- Frontend wizard: when `existingCredentialPresent` is true, Manage / Edit
  offers "Verify stored key" (uses `kind:'stored'`) and "Replace key" (typed).
  Do not force key re-entry to change models.

## B2-2 "Connect only" saves tiers without touching the running session

Root cause: `ProviderModelsService.setModelTier` with `scope: 'mainAgent'`
writes `this.authEnv` and `process.env` for ANY provider
(`libs/backend/auth-providers/src/lib/provider-models.service.ts:540-550`),
not only the active one. So persisting main-agent tiers for a provider that is
not in use still changes the running main agent's
`ANTHROPIC_DEFAULT_*_MODEL`.

Change:
- Backend: persist `provider.<id>.mainAgent.modelTier.*` always; mutate
  `authEnv` / `process.env` ONLY when `providerId` is the currently active
  main-agent provider (resolve with the same resolver the runtime uses —
  `ActiveProviderResolver` / effective route; honour workspace scope). Check the
  activation path: when a provider becomes active, its persisted mainAgent tiers
  must be applied to the env (verify the existing auth reset / adapter init
  already does this; if not, add it). Write-path trace required.
- Frontend: "Connect only" saves the wizard's model choices as that provider's
  `mainAgent` tiers (no `cliAgent` writes — keep batch-1 item 4). Show
  "Saved — applies when you use this provider for the main agent".
- Specs: tier write for a non-active provider leaves `process.env` untouched;
  for the active provider it updates env; activating a provider applies its
  saved tiers; CLI-agent tier resolution (`ptah-cli-registry.ts:~1484`) unchanged.

## Verification
Scoped: `npx nx run-many -t typecheck,test,lint -p auth-providers rpc-handlers shared chat core`
(only the projects you changed). Tail output only. No commits.
Append results to `fix-report.md` under `## Batch 2`.
