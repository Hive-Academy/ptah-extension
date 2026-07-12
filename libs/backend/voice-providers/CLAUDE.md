# @ptah-extension/voice-providers

[Back to Main](../../../CLAUDE.md)

## Purpose

Concrete voice-provider implementations behind the `voice-contracts` ports
(TASK_2026_VOICE_PROVIDERS, FR-2/FR-4). Hosts the local Whisper/Kokoro path with
process isolation (Electron `utilityProcess`), the registry/selector, and the
vault-backed secret store. ElevenLabs cloud adapters land in a later batch.

## Boundaries

**Belongs here**:

- `worker/` — the `voice-worker.ts` utilityProcess entry (bundled separately to
  `voice-worker.mjs`), the pure `VoiceWorkerCore` dispatcher, the id-correlated
  protocol, and the moved/de-DI'd Whisper/Kokoro pipelines + ffmpeg decode
- `local/` — `VoiceWorkerClient` (main-side proxy, respawn/idle-teardown/
  crash-loop), the host `IVoiceWorkerProcessFactory` port, the local TTS/STT
  provider adapters, `model-paths` (fs presence checks), `model-settings`
  (settings → `VoiceModelSpec`)
- `VoiceProviderRegistry`, `VoiceProviderSelector`, `VoiceSecretStore`
- `di/{tokens,register}.ts`

**Does NOT belong**:

- Electron `utilityProcess.fork` (host-implemented via `IVoiceWorkerProcessFactory`)
- The vault implementation (`ElectronSafeStorageVault` in apps/ptah-electron)
- The RPC surface (`voice-rpc.handlers.ts` in rpc-handlers)
- Port/type/error definitions (in `voice-contracts`)

## Public API

Classes: `VoiceProviderRegistry`, `VoiceProviderSelector`, `VoiceSecretStore`,
`LocalSttProvider`, `LocalTtsProvider`, `VoiceWorkerClient`.
Ports: `IVoiceWorkerProcess`, `IVoiceWorkerProcessFactory`.
Protocol types + settings helpers (`resolveWhisperModel`, `resolveTtsVoice`,
`resolveSttModelSpec`, `resolveTtsModelSpec`, key constants).
DI: `VOICE_TOKENS`, `registerVoiceProviderServices`.

## Worker isolation (D1/D2)

- The worker is a separate OS process (`utilityProcess`), so a native ONNX
  `abort()` kills only the child; the client rejects in-flight requests with
  `VoiceProviderError('process-crashed')` and respawns on the next request — no
  permanent failed flag.
- STT input crosses IPC as a temp-file path (ffmpeg decode runs in the worker);
  TTS output crosses as structured-clone `Uint8Array`.
- Config (ffmpeg path + model cache dir) arrives only via the `init` message.

## Dependencies

**Internal**: `@ptah-extension/voice-contracts`, `@ptah-extension/platform-core`,
`@ptah-extension/vscode-core`
**External**: `tsyringe`, `zod`; dynamic-imported at runtime in the worker:
`@huggingface/transformers`, `kokoro-js`, `ffmpeg-static` (never in the esbuild
graph — the host runtime provides them, the CLI surfaces assets-unavailable).

## Guidelines

- Backend-lib purity: never `import 'electron'`. The worker entry uses the
  `process.parentPort` global; spawning is behind `IVoiceWorkerProcessFactory`.
- `catch (error: unknown)` + `instanceof` narrowing; every thrown message is
  sanitized (`VoiceProviderError`) — no raw bodies/headers/key material.
- Plaintext API keys are NEVER logged and NEVER returned by an RPC-reachable
  getter (`VoiceSecretStore` returns ciphertext-derived state only).
- Worker logic lives in `VoiceWorkerCore` (unit-testable) — keep the entry thin.

## Cross-Lib Rules

Imported by `rpc-handlers` (selector/registry), `apps/ptah-electron` (factory +
DI + worker path), and `libs/backend/cli-engine` (degraded). No frontend imports.
