# @ptah-extension/voice-contracts

[Back to Main](../../../CLAUDE.md)

## Purpose

Pure contracts (interfaces + types + error taxonomy + tokens) for the voice
subsystem (TASK_2026_VOICE_PROVIDERS, FR-1). Lets consumers (`rpc-handlers`,
`messaging-gateway`) and provider implementations (`voice-providers`, local +
ElevenLabs) decouple from concrete classes. Zero-dep, mirrors `memory-contracts`.

## Boundaries

**Belongs here**:

- Port interfaces (`ITextToSpeechProvider`, `ISpeechToTextProvider`,
  `IVoiceProviderRegistry`, `IVoiceProviderSelector`, `IVoiceDownloadEventSource`,
  `IVoiceTokenVault`) and the token registry
- Plain DTOs/value types used at port boundaries (`VoiceProviderCapability`,
  `VoiceModelSpec`, synth/transcribe req/result, `VoiceInfo`, `VoiceReadiness`,
  `VoiceDownloadEvent`)
- The `VoiceProviderError` class + `VoiceErrorCategory` + the
  `VOICE_ASSETS_UNAVAILABLE` / `VOICE_ASSETS_REMEDIATION` constants

**Does NOT belong**:

- Any concrete provider, worker, HTTP, or secret-storage logic (lives in
  `voice-providers`)
- The RPC surface (`voice-rpc.handlers.ts` in `rpc-handlers`)
- The vault implementation (`ElectronSafeStorageVault` in `apps/ptah-electron`)

## Public API

Types: `VoiceProviderId`, `VoiceDirection`, `VoiceProviderCapability`,
`VoiceModelSpec`, `SynthesizeRequest`, `SynthesizeResult`, `TranscribeRequest`,
`TranscribeResult`, `VoiceInfo`, `VoiceReadiness`, `VoiceDownloadEvent`,
`VoiceEventDisposable`, `VoiceErrorCategory`.
Interfaces: `ITextToSpeechProvider`, `ISpeechToTextProvider`,
`IVoiceProviderRegistry`, `IVoiceProviderSelector`, `IVoiceDownloadEventSource`,
`IVoiceTokenVault`.
Errors/consts: `VoiceProviderError`, `isVoiceProviderError`,
`VOICE_ASSETS_UNAVAILABLE`, `VOICE_ASSETS_REMEDIATION`.
Tokens: `VOICE_CONTRACT_TOKENS`.

## Internal Structure

- `src/lib/voice-provider.types.ts` — ids, capability, `VoiceModelSpec`, req/result DTOs
- `src/lib/tts-provider.port.ts` / `src/lib/stt-provider.port.ts` — provider ports
- `src/lib/voice-events.port.ts` — `VoiceDownloadEvent`, `IVoiceDownloadEventSource`
- `src/lib/voice-selector.port.ts` — `IVoiceProviderRegistry`, `IVoiceProviderSelector`
- `src/lib/voice-token-vault.port.ts` — `IVoiceTokenVault` (structural twin of `ITokenVault`, D4)
- `src/lib/voice-provider-error.ts` — `VoiceProviderError`, categories, moved `VOICE_ASSETS_*` constants
- `src/lib/tokens.ts` — `VOICE_CONTRACT_TOKENS`

## Dependencies

**Internal**: none
**External**: none (pure types + one dependency-free error class)

## Guidelines

- Stay zero-dep — adding runtime deps here forces them on every consumer.
- Do NOT import `ITokenVault` from messaging-gateway; `IVoiceTokenVault` is a
  deliberate structural twin (D4) — the host registers one vault instance under
  both tokens.
- All contracts use `readonly` and `Promise<...>` signatures.
- Bumps to interfaces are breaking — coordinate with `voice-providers`,
  `rpc-handlers`, `messaging-gateway`.

## Cross-Lib Rules

Imported by `voice-providers`, `rpc-handlers`, `messaging-gateway`, and
`apps/ptah-electron`. Imports nothing. Never imported by frontend libs.
