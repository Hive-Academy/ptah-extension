# Batch 2 Report — voice-contracts Lib (FR-1)

**Status**: IMPLEMENTED — all verification gates green.
**Executor**: backend-developer (Task-tool sub-agent). No commit (deferred to team-leader).

## Files Created

`libs/backend/voice-contracts/`:

| File                                | Task | Purpose                                                                                                                                                  |
| ----------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.json`                      | 2.1  | Nx lib config, cloned from memory-contracts (`build` esbuild cjs + `typecheck` tsc). Tags `["scope:extension","type:core"]`.                             |
| `tsconfig.json`                     | 2.1  | Solution-style, references `tsconfig.lib.json` (identical to memory-contracts).                                                                          |
| `tsconfig.lib.json`                 | 2.1  | Compile config (`types:["node"]`, `module:preserve`, excludes specs).                                                                                    |
| `package.json`                      | 2.1  | `@ptah-extension/voice-contracts`, private, commonjs.                                                                                                    |
| `src/index.ts`                      | 2.4  | Barrel — types via `export type`, runtime values (`VoiceProviderError`, `isVoiceProviderError`, `VOICE_ASSETS_*`, `VOICE_CONTRACT_TOKENS`) via `export`. |
| `src/lib/voice-provider.types.ts`   | 2.2  | `VoiceProviderId`, `VoiceDirection`, `VoiceProviderCapability`, `VoiceModelSpec`, `Synthesize`/`Transcribe` req/result, `VoiceInfo`, `VoiceReadiness`.   |
| `src/lib/tts-provider.port.ts`      | 2.2  | `ITextToSpeechProvider`.                                                                                                                                 |
| `src/lib/stt-provider.port.ts`      | 2.2  | `ISpeechToTextProvider`.                                                                                                                                 |
| `src/lib/voice-events.port.ts`      | 2.2  | `VoiceDownloadEvent`, `VoiceEventDisposable`, `IVoiceDownloadEventSource`.                                                                               |
| `src/lib/voice-selector.port.ts`    | 2.2  | `IVoiceProviderRegistry`, `IVoiceProviderSelector`.                                                                                                      |
| `src/lib/voice-token-vault.port.ts` | 2.2  | `IVoiceTokenVault` (structural twin of `ITokenVault`, D4 — no messaging-gateway import).                                                                 |
| `src/lib/voice-provider-error.ts`   | 2.3  | `VoiceErrorCategory`, `VoiceProviderError`, `isVoiceProviderError`, relocated `VOICE_ASSETS_UNAVAILABLE`/`VOICE_ASSETS_REMEDIATION`.                     |
| `src/lib/tokens.ts`                 | 2.3  | `VOICE_CONTRACT_TOKENS` (3 `Symbol.for('Ptah…')` tokens).                                                                                                |
| `CLAUDE.md`                         | 2.4  | Purpose/Boundaries/Public API/Internal Structure/Dependencies/Guidelines/Cross-Lib, following memory-contracts template.                                 |

**Modified**: `tsconfig.base.json` — added `@ptah-extension/voice-contracts` path entry (memory-contracts is registered the same way; required for consumers in later batches to resolve the barrel).

## Fidelity to Plan §2

All contract shapes implemented byte-faithfully to plan §2 (VoiceProviderCapability, VoiceModelSpec union, synth/transcribe req+result, VoiceInfo, VoiceReadiness, both provider ports, VoiceDownloadEvent 4-variant union + IVoiceDownloadEventSource returning a Disposable, IVoiceProviderRegistry/Selector, IVoiceTokenVault 3-method twin, VoiceProviderError with `code='VOICE_PROVIDER_ERROR'` + cause handling, VOICE*CONTRACT_TOKENS). `VOICE_ASSETS*\*`constant values copied verbatim from`messaging-gateway/src/lib/voice/voice-assets-error.ts` (originals left in place — their deletion is Batch 3).

## Verification Outputs

- `npx nx build @ptah-extension/voice-contracts` → **Successfully ran target build** (esbuild cjs bundle emitted to `dist/libs/backend/voice-contracts`).
- `npx nx typecheck @ptah-extension/voice-contracts` → **Successfully ran target typecheck**.
- `npx nx eslint:lint @ptah-extension/voice-contracts` → **Successfully ran target eslint:lint** (module-boundary rules clean).
- `nx graph` outbound dependencies for `@ptah-extension/voice-contracts` → **`[]`** (zero workspace edges).
- Grep for `@ptah-extension/`, relative `../..`, `electron`, `worker_threads`, `messaging-gateway` imports in `src/` → **only comment-prose mentions** of messaging-gateway (D4/relocation notes); zero real imports.
- `nx show project` targets → `['eslint:lint', 'build', 'typecheck']` — identical to memory-contracts.

## Deviations from the Task Brief (with rationale)

1. **No `jest.config.ts` and no per-project eslint config file created.** The authoritative clone target `libs/backend/memory-contracts` has neither — it carries only `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `package.json`, `CLAUDE.md`, `src/`. Linting is provided by the inferred `eslint:lint` target from the root flat `eslint.config.mjs` (nx `@nx/eslint/plugin`, `targetName: 'eslint:lint'`), which already covers the new lib. Adding a jest config + test target to a zero-test contracts lib would be dead scaffolding (YAGNI) and would diverge from the "clone memory-contracts exactly" instruction, which the plan §2 marks authoritative. Result: lib is lint-clean and typechecks with no jest surface, matching the sibling contracts lib.
2. **Lint target is `eslint:lint`, not `lint`.** Consequence of the nx plugin `targetName` above; the Batch 2 verification command `npx nx lint …` maps to `npx nx eslint:lint …` in this workspace (same as every other lib here). No functional change.

No plan-§2 contract shape was altered.
