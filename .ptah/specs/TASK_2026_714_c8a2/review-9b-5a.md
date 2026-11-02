## Verdict

APPROVE — 9/10

The resume guard and `shouldStartNativeCodex` share `hasNativeCodexCapability`. Chat still keys off `nativeCodex`, gateway off `nativeCodexGateway === true`, and lane always returns false. The `AuthRequiredError` message is unchanged. The active-provider read stays on the start path and still runs only after the capability check is true.

## Findings

No defects.

## Checked

1. Shared mapping. `resolveExecutionProfile` (`workspace-provider-profile-resolver.ts:191`) refuses a `codex-app-server` identity when `hasNativeCodexCapability` is false. That helper (`:289-301`) is the same switch `shouldStartNativeCodex` (`:281-286`) uses: chat returns `hostCapabilities.nativeCodex`, gateway returns `hostCapabilities.nativeCodexGateway === true`, lane returns `false`, and the `never` default is unchanged from the previous start switch. `&&` still skips `resolveActiveAuthForPath` when the capability is false, so the provider is still resolved only for a native start.

2. Chat start and chat resume. A chat start with `nativeCodex: true` still requires `providerId === 'openai-codex'` and does not read the provider when the flag is false (existing start table at `workspace-provider-profile-resolver.spec.ts:959-1018`). A chat resume with `nativeCodex: true` still proceeds without reading the active provider (`:1021-1036`). A chat resume with only `nativeCodexGateway: true` throws `AuthRequiredError` (`:923-926`, `:951-955`).

3. Lane cannot resume native. `hasNativeCodexCapability` returns false for `lane` before the home, workspace, or provider work. The spec resumes a native identity with both flags set and expects `AuthRequiredError` and the original text (`:927-931`, `:951-955`).

4. Spec matrix at `:902-957` matches the required cases: gateway + `nativeCodexGateway` only proceeds; gateway + `nativeCodex` only (flag absent, so not `=== true`) is refused; chat + `nativeCodex` proceeds; chat + gateway flag only is refused; lane with both flags is refused. Rejections check `AuthRequiredError` and `This session requires a host with native Codex support.`

5. Callers of `resolveExecutionProfile` in `libs/` and `apps/`. The only production call is `ChatRuntimeProfileService.prepare` (`chat-runtime-profile.service.ts:129`), which passes `config.consumer ?? 'chat'` and the injected host capabilities. `AgentSessionStartConfig` / `AgentSessionResumeConfig.consumer` is `'chat' | 'gateway'` only (`agent-adapter.types.ts:184` and `:242`), so this service cannot send `lane`. Resume call sites pass an identity and omit `consumer`, so they stay on the chat gate and their outcome does not change:
   - `chat-session.service.ts:1904` (`prepare(config, identity, modelIsStored)`)
   - `chat-slash-command-router.service.ts:332` (same shape)
   Start-only calls pass no identity, so this resume change does not apply:
   - `chat-session.service.ts:1096` (`prepare(config, undefined, ...)`)
   - `codex-chat-host-ports.ts:234` (`prepare(config)`)
   Other `resolveExecutionProfile` mentions are types or test doubles (`codex-chat-host-ports.ts:52`, composition and contract specs). No caller in `libs/` or `apps/` passes a resume identity with `consumer: 'gateway'` or `consumer: 'lane'`. A gateway or lane outcome changes only when a caller supplies that consumer; none do today. `git diff -- libs/backend/auth-providers` is limited to the helper extraction, the resume guard, and the new table. The batch report matches that diff.

Not run, per the review contract: tests, typecheck, lint, build, Nx, and diagnostics. Ptah symbol and dependency tools were not available in this session; search used ripgrep and `git diff`.
