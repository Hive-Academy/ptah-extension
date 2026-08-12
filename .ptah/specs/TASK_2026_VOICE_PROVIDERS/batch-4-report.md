# Batch 4 — ElevenLabs Adapters (FR-5) — Implementation Report

**Status**: IMPLEMENTED (all verification gates green). Not committed (team-leader owns git).
**Executor**: backend-developer (Task-tool sub-agent). CLI delegation disabled.
**Scope**: FR-5.1–5.7 — fetch-based ElevenLabs TTS + STT adapters behind the FR-1 ports, Zod-validated at the HTTP boundary, single sanitizing error chokepoint (R6). No native deps, no process isolation. Registered into the DI graph but UI-unreachable (selector still defaults to `local`). Plus the carry-over di-lint fix.

---

## Files Created

| File                                                                              | Purpose                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs.schema.ts`            | Zod `looseObject` schemas at the HTTP boundary (voices / Scribe / best-effort error body). Vendor drift on a consumed field fails loudly (R4).                                                                                                                     |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts`            | Shared fetch core (base `https://api.elevenlabs.io`, `xi-api-key` from `VoiceSecretStore`, `AbortSignal.timeout` 30s synth/transcribe, 10s list/test) + `mapElevenLabsError` (the single R6 chokepoint) + `synthesize`/`listVoices`/`transcribe`/`testConnection`. |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-tts-provider.ts`      | `ElevenLabsTtsProvider implements ITextToSpeechProvider`. `POST /v1/text-to-speech/{voiceId}?output_format=…`, mimeType from format, `listVoices` via `GET /v1/voices`, `downloadModel` no-op. Exports `mimeTypeForFormat`.                                        |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-stt-provider.ts`      | `ElevenLabsSttProvider implements ISpeechToTextProvider`. Scribe `POST /v1/speech-to-text` multipart (`FormData`+`Blob`), encoded recording uploaded as-is (no ffmpeg), `downloadModel` no-op.                                                                     |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.spec.ts`       | Client + `mapElevenLabsError` suite (URL/query/headers, voices parse, Scribe multipart, full error table, Zod drift, R6 no-leakage).                                                                                                                               |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-tts-provider.spec.ts` | TTS adapter suite (capability, settings/override/default resolution, mimeType mapping, voice-list mapping, no-op download).                                                                                                                                        |
| `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-stt-provider.spec.ts` | STT adapter suite (capability, file-read→multipart, model default, sanitized read-failure, no-op download).                                                                                                                                                        |

## Files Modified

| File                                                                | Change                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/voice-providers/src/lib/di/tokens.ts`                 | Added `ELEVENLABS_CLIENT: Symbol.for('PtahVoiceElevenLabsClient')` (shared HTTP core token).                                                                                                  |
| `libs/backend/voice-providers/src/lib/di/register.ts`               | Registered `ELEVENLABS_CLIENT`, `ELEVENLABS_TTS_PROVIDER`, `ELEVENLABS_STT_PROVIDER` (singletons) **and** the carry-over `VOICE_WORKER_IDLE_MS` via `registerInstance(..., DEFAULT_IDLE_MS)`. |
| `libs/backend/voice-providers/src/lib/local/voice-worker-client.ts` | Exported `DEFAULT_IDLE_MS` so `register.ts` can bind the token to the same default.                                                                                                           |
| `libs/backend/voice-providers/src/index.ts`                         | Barrel exports for `ElevenLabsClient`, `mapElevenLabsError`, `ElevenLabsTtsProvider`, `mimeTypeForFormat`, `ElevenLabsSttProvider`.                                                           |

**Note on `voice-provider-registry.ts`**: Task 4.2 listed it as MODIFY, but Batch 3 already wired the two `ELEVENLABS_TTS/STT_PROVIDER` optional injections + capability merge. No change was needed — the registry now resolves ElevenLabs because Batch 4 registers those tokens. `listProviders()` surfaces ElevenLabs with `available` reflecting key presence.

---

## Carry-over DI fix (mandatory)

Batch 3 left three `@inject` sites without a matching registration; `di-lint` (which does not honor `{ isOptional: true }`) failed:

```
di-lint FAIL: 3 unregistered @inject token(s)
ERROR: .../voice-provider-registry.ts:24 injects VOICE_TOKENS.ELEVENLABS_TTS_PROVIDER ...
ERROR: .../voice-provider-registry.ts:26 injects VOICE_TOKENS.ELEVENLABS_STT_PROVIDER ...
ERROR: .../local/voice-worker-client.ts:78 injects VOICE_TOKENS.VOICE_WORKER_IDLE_MS ...
```

All three are now registered in `di/register.ts`:

- `VOICE_WORKER_IDLE_MS` → `container.registerInstance(VOICE_TOKENS.VOICE_WORKER_IDLE_MS, DEFAULT_IDLE_MS)` (same 5-min default the optional injection already uses; explicit registration only makes the graph resolvable for di-lint).
- `ELEVENLABS_TTS_PROVIDER` / `ELEVENLABS_STT_PROVIDER` → singleton registrations of the new adapter classes.

---

## R6 — secret-leakage evidence (mandatory focus for the reviewer)

- **Single chokepoint**: `mapElevenLabsError` is the only failure-path error factory in the client. Every thrown `VoiceProviderError` message is a fixed generic string — never a response body, header, or key.
  - `401/403` → `auth` (`"ElevenLabs rejected the API key (authentication failed)."`), unless body `detail.status === 'quota_exceeded'` → `quota`.
  - `402/429` → `quota`.
  - fetch `TypeError` / `AbortError` / `TimeoutError` → `network`.
  - else → `provider-error`, message `"ElevenLabs request failed (HTTP <status>)."` (status only).
- **Body handling**: `toHttpError` parses the error body **only** to read `detail.status` for categorization (`ErrorBodySchema.safeParse`); the parsed value is never forwarded into a message/log/return.
- **Key handling**: `xi-api-key` is attached only to outbound request headers via `requireKey()`/`resolveKey()`. It is never logged (the one `logger.debug` logs `path` only) and never returned.
- **STT read failure**: `readFile` errors are wrapped in a sanitized `VoiceProviderError('provider-error', …)` — raw fs text (e.g. `ENOENT`) does not surface (asserted).
- **Regression tests**: `elevenlabs-client.spec.ts` → "R6 — xi-api-key never appears in a thrown message" drives the full failure surface (401/402/403/404/429/500 with a body that echoes the key back, plus a `TypeError` whose text embeds the key) and asserts `error.message` never contains the key value. STT spec asserts the read-failure path does not leak `ENOENT`.

Every `catch` path in the new code uses `catch (error: unknown)` + `instanceof` narrowing; the two non-forwarding catches (`toHttpError` body-parse, empty by design) carry explanatory comments (not empty blocks).

---

## Verification (all green)

**`npx nx typecheck voice-providers`** — PASS (`tsc --noEmit`, no output).

**`npx nx lint voice-providers`** — PASS (`✔ All files pass linting`).

**`npx nx test voice-providers`** — PASS:

```
Test Suites: 9 passed, 9 total
Tests:       124 passed, 124 total
```

(88 baseline + 36 new across the 3 ElevenLabs specs, incl. the R6 no-leakage and Zod-drift assertions. The "worker force exited" warning is the pre-existing baseline timer warning, unrelated to these tests.)

**`npx nx run di-lint:lint`** — PASS, ZERO unregistered tokens:

```
di-lint OK: 1215 @inject sites all resolve to a registered token (530 tokens)
```

---

## Reviewer focus / notes

- **R6 catch-path audit**: confirm no body/header/key reaches a message in `elevenlabs-client.ts` (`mapElevenLabsError`, `toHttpError`, `fetchOk`, `readBytes`) and `elevenlabs-stt-provider.ts` (`transcribe` read-failure wrap).
- **Zod boundary**: `parseJson` uses `schema.parse` (throws on drift) for successful responses; `ErrorBodySchema` uses `safeParse` (never throws) for error categorization only.
- **Scope discipline**: no new RPC methods, no shared-types edits, no settings UI. `testConnection` lives on the client (natural home for the `10s test` timeout) and is dormant until Batch 5 wires `voice:testConnection`. Selector still defaults to `local`; ElevenLabs is registered but UI-unreachable.
- **Default voice**: `synthesize` falls back to ElevenLabs' well-known public voice id `21m00Tcm4TlvDq8ikWAM` ("Rachel") when neither a request override nor `voice.elevenlabs.voiceId` is set, so the endpoint never 404s on an empty voice id.

```

```
