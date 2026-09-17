# TASK_2026_411 — Ollama review resolution

Review source: `architecture-review-ollama.md`
Resolution method: independent read-only verification against repository source, pinned installed packages in the main checkout, the lockfile-resolved Codex executable, and official public OpenAI documentation. No live profile, credential, authenticated request, provider inference, source implementation, install, restart, commit, or push was performed.

## Resolution summary

| Finding | Resolution | Plan effect |
|---|---|---|
| F1 compaction seam | Confirmed | Replace `compactionControl` with existing `settings` builder; prove effective argv |
| F2 metadata remains large | Confirmed and expanded | Mandatory output-first domain split, per-session records, bounded worker/IPC reads and writes |
| F3 source/identity/params | Mixed: identity and params confirmed; domain objection rejected | One Codex-home resolver; omit params; packaged-version schemas; retain official docs citation |
| F4 recovery/readiness | Confirmed, readiness recommendation revised | Drop journal; fail closed after v2 mutation; precise Windows claim; throw before readiness |
| F5 stream usage | Confirmed | Keep actual SDK-consumer test; remove unnecessary transformer typing change |
| F6 analytics | Confirmed | Retain stats-only reader/cache/page design and make mechanism gates primary |

## F1 — `compactionControl` is inert on Ptah’s process path

Resolution: **confirmed**.

Evidence:

- `sdk.d.ts` in pinned `@anthropic-ai/claude-agent-sdk` 0.3.150 contains no `Options.compactionControl` declaration.
- `ptah-cli-registry.ts:750-753` only compiles the field because the whole literal is asserted `as Options`.
- The pinned runtime destructures and consumes `compactionControl` in the in-process `BetaToolRunner`, emits a deprecation warning, and removes it before direct Messages calls. In the process-query setup, the supported options are destructured and passed into `ProcessTransport`; `settings` is serialized, while `compactionControl` is absent.
- `sdk.d.ts:1709-1718` states `Options.settings` is equivalent to `--settings`. The types expose `autoCompactWindow` (`:5180-5183`) and `autoCompactEnabled` (`:5370-5373`). The bundled validation schema is `integer().min(100000).max(1000000)` for the window.
- Ptah’s interactive builder currently logs compaction at `sdk-query-options-builder.ts:762-795` but does not pass it. The CLI-agent path builds the inert field at `ptah-cli-spawn-options.service.ts:221-227` and asserts it into options at `ptah-cli-registry.ts:750-753`.

Correction:

- Use the one existing `buildFlagSettings` source and merge `autoCompactEnabled`/`autoCompactWindow` on both paths.
- Assert the real SDK-generated `SpawnOptions.args` `--settings` payload, not the input options object.
- Remove all production `compactionControl` use/claims.
- Align the advertised 50,000 minimum (`apps/ptah-extension-vscode/package.json:223-228`) with the pinned validator’s 100,000 minimum.

Unit/semantics verification: the pinned Claude 2.1.150 executable’s own command text accepts “100k–1M tokens,” and runtime paths compare estimated context tokens through a model/window-derived limit. The configured value is therefore a token window, but its raw value is not promised as the exact effective first-compaction counter for every model. Threshold control affects when compaction starts; it does not establish a reduction in the observed 213–216 s upstream summary latency.

## F2 — Sharding alone leaves a large metadata aggregate

Resolution: **confirmed and expanded**.

Evidence:

- `session-metadata-store.ts:20-30,124` explicitly documents one all-session key and whole-array serialization.
- `_saveInternal()` reads/replaces within the full array and `flush()` writes the full snapshot (`:305-324,445-464`).
- The existing safe precedent is valid: `leanCliSessions()` calls `migrateRefOutput()` first, and failure retains the fat reference (`:349-431`).
- Existing per-agent keys still live inside the same physical Electron JSON file, so current logical extraction does not prevent whole-profile main-thread serialization.
- `getCliSessionsForRestore()` rehydrates all output arrays (`:594-616`) and both `chat:resume` and `session:cli-sessions` return them, creating another unbounded parse/clone path (`chat-session.service.ts:818-838`; `session-rpc.handlers.ts:739-762`).

Correction:

- Make output-first durable extraction part of the v1→v2 commit, using a generic declarative worker migration supplied by `agent-sdk` through the Electron composition root.
- Keep only a lean session index at `ptah.sessionMetadata`; write one detail key per session and chunked manifests/sequences per agent output.
- Perform migration parse, serialization, hashing, and verification entirely in the worker; never return the historical aggregate to main.
- Bound main↔worker messages to 256 KiB, including structured-clone cost. Split long strings into transferable slices without truncation.
- Restore lean agent records, then page output through a bounded RPC. Do not carry complete output in startup/resume payloads.
- Gate both reads and writes, not only constructor reads/full-state stringify.

This is a required incident repair, not optional optimization.

## F3 — App Server source, request shape, and identity

Resolution: **mixed**.

### Domain/source objection — rejected

The statement that `learn.chatgpt.com` “is not an OpenAI domain” is incorrect: it is a subdomain of `chatgpt.com`, not an unrelated domain. More importantly, the OpenAI documentation workflow identifies `learn.chatgpt.com` as an official allowed source for Codex/ChatGPT documentation. The fetched [Codex App Server documentation](https://learn.chatgpt.com/es-419/docs/app-server) explicitly documents:

- version-matched `generate-ts`/`generate-json-schema` output;
- `account/rateLimits/read` and `account/usage/read`;
- request examples with no `params` for both reads;
- ChatGPT/external-token/agent-identity/personal-access-token support and API-key-only/Bedrock exclusion for usage.

The plan retains that official citation. The reviewer’s linked open-source protocol/commit may be useful corroboration, but it is not necessary to replace a valid official documentation source.

### Omitted params — confirmed

Both documented calls omit `params`. The revised plan requires `{method,id}` only and puts Zod validation on responses. It does not send `{}` to a no-params method.

### Version support — confirmed for the pinned executable, still gated

- `package-lock.json` resolves `@openai/codex-sdk`, `@openai/codex`, and the platform package to 0.147.0.
- The bundled executable reports `codex-cli 0.147.0`, supports `app-server generate-json-schema`, and contains both account method names.
- Because web documentation may move independently, the implementation batch must generate/check schemas from packaged 0.147.0 and surface `cli-version-unsupported` for an incompatible executable. It must not guess fields.

### Identity mismatch — confirmed

`CodexAuthService` currently hardcodes `join(homedir(), '.codex', 'auth.json')` (`codex-auth.service.ts:23-43`). The repository already verifies that `CODEX_HOME` relocates the directory (`harness-sync/.../codex-home.ts:43-53`). A spawned App Server can therefore use a different account from the proxy.

Correction: add one resolver inside `auth-providers`, use it for both auth read/watch and App Server spawn `CODEX_HOME`, and test with injected disposable paths. A custom non-native proxy endpoint yields `unsupported-config`; App Server results are not presented as that proxy’s account.

## F4 — Storage recovery, journal, Windows durability, readiness

Resolution: **confirmed, with a safer readiness policy than recommended**.

### Stale fallback — confirmed

Automatic v1 fallback is allowed only before any v2 mutation commits (`mutationEpoch === 0`). After that, current-v2 corruption enters a recovery-required state. An older generation may be retained for diagnostics but is not silently served as current.

### Journal — confirmed and removed

A value-free journal cannot reconstruct values, while committed blobs already describe the final state. Retaining old blobs to make the journal useful would undermine reclamation and add unbounded write amplification. The revised design removes the journal. Explicit `materialize-v1` reconstructs from a valid current v2 generation.

### Windows durability — confirmed

The plan now claims process-crash-identifiable commit states, not unconditional power-loss durability. File flush plus same-directory rename and commit ordering prevent partial mixed generations, but Node’s Windows rename does not expose `MOVEFILE_WRITE_THROUGH` for the final directory entry.

### Pre-readiness behavior — finding confirmed, recommendation revised

The old plan was underspecified. Returning `undefined`/defaults, as the review recommends, is unsafe because a consumer can persist those defaults over recovered state. The revised contract throws a typed `StateStorageNotReadyError` from sync reads/keys and rejects updates. The Electron boot/workspace switch gate ensures normal consumers never encounter it. `WorkspaceAwareStateStorage` forwards readiness to the exact selected delegate and never activates an unready workspace.

This is a safety correction, not a new product choice.

## F5 — Stream usage is a translator-only production gap

Resolution: **confirmed**.

Evidence:

- `responses-stream-translator.ts:454-498` records terminal input/output but emits only output.
- `responses-stream-collector.ts:191-197` already has the correct uncached/cache mapping.
- `stream-event.transformer.ts:258-303` already accepts input/output/cache-read/cache-creation on `message_delta` and sends them to the live tracker.

Correction: share the mapper, retain cached details in the translator, and emit complete final usage. Remove the plan’s unnecessary production transformer-typing change unless the real SDK-consumer test proves a concrete gap. Keep the end-to-end consumer test unchanged.

## F6 — Stats-only analytics design

Resolution: **confirmed**.

The stats projection, range/current-context semantics, exact file/directory/rate-card validity, bounded LRU/in-flight coalescing, generation/abort handling, and progressive 20-id pages remain. Concurrency and event-loop-yield assertions are primary CI gates; reference-host wall-clock is secondary.

## Product-choice audit

No genuinely new discretionary product choice was introduced beyond approved safety corrections.

- Raising the effective minimum compaction window to 100,000 is dictated by the pinned validator; continuing to advertise 50,000 would expose an inert/invalid setting.
- Failing closed after post-mutation v2 corruption prevents silent data loss.
- Throwing before readiness prevents default data from overwriting recovered data.
- Removing the journal eliminates a non-reconstructive, unbounded mechanism.

Choices remain blocked only if scope expands to seamless giant-v1 dual-write downgrade, automatic lossy corruption recovery, or an account “remaining messages” metric not provided by the documented activity/quota methods.

## Approval result

The revised architecture resolves F1–F4, preserves F5/F6, and is ready for user review. Batch B1 has no unresolved technical or product blocker, but developer execution remains prohibited until the user approves `implementation-plan.md` and `batches.md`.
