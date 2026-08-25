# Batch 5 — RPC + Push Surface (FR-8 + FR-7 backend)

**Status:** IMPLEMENTED. All verification gates green (typecheck, lint, test, di-lint, build-main:production).
**Scope:** 6 new provider-agnostic `voice:` RPC methods + the `voice:providerError` push channel + FR-7 cloud-failure broadcast. No frontend, no settings UI (Batch 6).

---

## Files modified

### Task 5.1 — shared types (append-only)

- `libs/shared/src/lib/types/rpc.types.ts`
  - 6 method-map entries appended after `voice:synthesize` in `RpcMethodRegistry`.
  - New param/result DTOs appended after `VoiceSynthesizeResult`: `VoiceProviderCapabilityDto`, `VoiceInfoDto`, `VoiceListProviders{Params,Result}`, `VoiceListVoices{Params,Result}`, `VoiceProviderConfig{Local,ElevenLabs,}Dto`, `VoiceGetProviderConfig{Params,Result}`, `VoiceSetProviderConfig{Params,Result}`, `VoiceSetApiKey{Params,Result}`, `VoiceTestConnection{Params,Result}`.
  - `VoiceSetConfigParams` extended with optional `modelSource?: 'curated'|'hf'|'dir'` + `customModel?: string` (FR-4).
  - `VoiceTranscribeResult` + `VoiceSynthesizeResult` error variants extended with optional `category?`/`providerId?` (FR-7 return shape — append-only optional fields).
  - 6 literal entries appended to `RPC_METHOD_ENTRIES` (`Record<RpcMethodName, true>`), which the compiler requires to be exhaustive.
- `libs/shared/src/lib/types/messages/message-constants.ts` — added `VOICE_PROVIDER_ERROR: 'voice:providerError'`.
- `libs/shared/src/lib/types/messages/voice.ts` — added `VoiceProviderErrorPayload` (`direction`, `providerId`, `category`, sanitized `message`).
- `libs/shared/src/lib/types/messages/payload-map.ts` — imported + mapped `'voice:providerError': VoiceProviderErrorPayload`.

### Task 5.2 — handler + schemas + broadcast

- `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.schema.ts` — extended `VoiceSetConfigParamsSchema` (`modelSource` enum + permissive `customModel`); added `VoiceListVoicesParamsSchema`, `VoiceListProvidersParamsSchema`, `VoiceGetProviderConfigParamsSchema`, `VoiceSetProviderConfigParamsSchema`, `VoiceSetApiKeyParamsSchema`, `VoiceTestConnectionParamsSchema`.
- `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts` — `METHODS` tuple → 14 entries; 6 new `registerMethod` calls; 6 new private methods; 2 new constructor injections (`VOICE_TOKENS.VOICE_SECRET_STORE`, `VOICE_TOKENS.ELEVENLABS_CLIENT`); reworked `mapVoiceError` + new `handleCallFailure`/`broadcastCloudError`; `setConfig` now persists `modelSource`/`customModel`.

### Task 5.3 — specs

- `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.spec.ts` — added secret-store/ElevenLabs-client fakes to the suite; new describes for the 6 methods, the FR-7 broadcast (fires on cloud, not local), the getProviderConfig security regression, and Zod rejections; explicit `METHODS.length === 14` assertion.

---

## Dual-registration touchpoints (all satisfied)

1. **Compile-time contract** — `rpc.types.ts` method map (`RpcMethodRegistry`) gained the 6 entries; `RpcMethodName` therefore includes them; `RPC_METHOD_ENTRIES` exhaustiveness satisfied.
2. **Handler coverage** — `VoiceRpcHandlers.METHODS` extended to 14; the compile-time coverage assertion in `register-all.ts` (`AllRegisteredMethodNames`) passes (typecheck green).
3. **Runtime allowlist** — `voice:` already present in `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:78`). **Verified, not edited** — all 6 new methods are `voice:`-prefixed.
4. **Message protocol** — new `voice:providerError` type added to `MESSAGE_TYPES` + `MessagePayloadMap` (append-only).

---

## The 6 methods — wire shapes

| Method                    | Params                                                                                              | Result                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice:listProviders`     | `{}`                                                                                                | `{ ok:true; providers: VoiceProviderCapabilityDto[]; active:{ tts:string; stt:string } } \| { ok:false; error }`                                                                                                                                                                    |
| `voice:listVoices`        | `{ providerId:'local'\|'elevenlabs' }`                                                              | `{ ok:true; voices: VoiceInfoDto[] } \| { ok:false; error; category? }`                                                                                                                                                                                                             |
| `voice:getProviderConfig` | `{}`                                                                                                | `{ ok:true; config:{ ttsProvider; sttProvider; local:{ whisperModel; modelSource; customModel?; sttDownloaded; ttsDownloaded; ttsVoice }; elevenlabs:{ apiKeyConfigured:boolean; voiceId?; ttsModelId; outputFormat; sttModelId } } } \| { ok:false; error }` — **no key material** |
| `voice:setProviderConfig` | `{ ttsProvider?; sttProvider?; elevenlabs?:{ voiceId?; ttsModelId?; outputFormat?; sttModelId? } }` | `{ ok:true } \| { ok:false; error }`                                                                                                                                                                                                                                                |
| `voice:setApiKey`         | `{ providerId:'elevenlabs'; apiKey:string (max 256, '' clears) }`                                   | `{ ok:true } \| { ok:false; error }`                                                                                                                                                                                                                                                |
| `voice:testConnection`    | `{ providerId:'elevenlabs'; apiKey?:string }`                                                       | `{ ok:true } \| { ok:false; error; category? }`                                                                                                                                                                                                                                     |

Routing: `listProviders` → `registry.listProviders()` + `selector.activeProviderId`; `listVoices` → `registry.getTts(providerId).listVoices()`; `getProviderConfig` → selector + settings + `secretStore.isConfigured`; `setProviderConfig` → `selector.setProvider` (+ non-secret elevenlabs config writes); `setApiKey` → `VoiceSecretStore.setKey`; `testConnection` → `ElevenLabsClient.testConnection(apiKey?)`.

---

## FR-7 broadcast trigger logic

`isCloudProviderFailure(error)` = `isVoiceProviderError(error)` **AND** `providerId !== 'local'` **AND** `category ∈ {auth, quota, network, provider-error}`.

- On a **cloud-category** transcribe/synthesize failure: `handleCallFailure` broadcasts `voice:providerError` via `webviewManager.broadcastMessage` **and** returns `{ ok:false, error, code:'VOICE_PROVIDER_ERROR', category, providerId, remediation? }` to the caller. **No retry, no substitution** — fallback is a user action in Batch 6.
- **Local** failures never broadcast: `assets-unavailable` keeps the historical `VOICE_ASSETS_UNAVAILABLE` code + remediation; `process-crashed`/`model-invalid`/plain errors return `{ ok:false, error }` unchanged. Verified by the two "does NOT broadcast for LOCAL …" specs.

---

## Security-regression evidence — `voice:getProviderConfig`

- The result carries **only** `elevenlabs.apiKeyConfigured: boolean` (from `secretStore.isConfigured`). The handler never reads `getKey`/the ciphertext for this method.
- Spec `returns config WITHOUT any key material (security regression)` serializes the whole response and asserts it does **not** match `/apiKey"\s*:/i`, `/cipher/i`, or `/apiKeyCipher/i`, and that `elevenlabs` has no `apiKey`/`apiKeyCipher` own-properties.
- `setApiKey`/`testConnection` never log the params object (the plaintext key); only `providerId` + a `cleared` boolean are logged.

---

## Verification outputs (all green)

- `npx nx run-many -t typecheck -p rpc-handlers shared` → **Successfully ran target typecheck for 2 projects** (register-all coverage + `RPC_METHOD_ENTRIES` exhaustiveness pass).
- `npx nx run-many -t lint -p rpc-handlers shared` → **Successfully ran** — 0 errors (9 pre-existing warnings unrelated to this batch: `TOKENS` unused, non-null assertions, `any` in register-all).
- `npx nx test rpc-handlers` → **62 suites, 1262 passed** (2 pre-existing skips). `npx nx test shared` → **23 suites, 403 passed**.
- `npx nx run di-lint:lint` → **`di-lint OK: 1217 @inject sites all resolve to a registered token (530 tokens)`** — the 2 new injections (`VOICE_SECRET_STORE`, `ELEVENLABS_CLIENT`) resolve (registered in `voice-providers/di/register.ts`).
- `npx nx run ptah-electron:build-main:production` → **Successfully ran target build-main for project ptah-electron and 22 tasks it depends on** (the lone `import.meta` warning is pre-existing in `workspace-intelligence`, unrelated).

---

## Notes / deviations

- `VoiceTranscribeResult`/`VoiceSynthesizeResult` error variants gained optional `category?`/`providerId?`. This was required to return the FR-7 cloud shape to the caller; it is append-only (optional fields) and does not affect existing callers. Batch 6 (`voice-config`, error-toast) will read `category`.
- `setApiKey`/`testConnection` are wired through the concrete `VOICE_TOKENS.VOICE_SECRET_STORE` + `VOICE_TOKENS.ELEVENLABS_CLIENT` (registered on every runtime that registers the voice services). The ports carry no `setKey`/`testConnection`, so this is the intended seam (task 5.2: "setApiKey → VoiceSecretStore.setKey; testConnection → provider key-test").
