# Batch C1 integration report

## Fixes

1. **Scoped type errors.** `codex-history-projector.ts` now checks the defining fields of tolerant history variants before reading them; the existing translator records unknown items as skipped `unsupportedItem` events. `select-codex-executable.ts` uses bracket environment access. `provider-rpc.handlers.ts` checks whether `listModels` exists before invoking it.
2. **Omitted model.** `codex-execution-profile.ts`, `codex-runtime.types.ts`, and `codex-context.ts` accept an absent model and omit it from thread and turn requests. The CLI and Electron lane composition files and `codex-app-server-lane.adapter.ts` no longer turn absence into `''`. `codex-execution-profile.spec.ts` covers the absent model. `native-session-controls.ts` accepts an absent initial model and reports a failed rollback explicitly if there was no prior model.
3. **Electron lane fallback.** `apps/ptah-electron/src/di/codex-lane-composition.ts` adds `openFallback`, activating the selected snapshot's one-shot bundled fallback and opening with a pinned fallback snapshot, matching the CLI composition. Its spec covers one-shot snapshot activation. This spec does not exercise the whole adapter-to-host reopen path.
4. **Chat first-turn failure.** `codex-chat-turn-stream.ts` presents a specific actionable message when installed Codex rejects `turn/start` before a receipt. `codex-chat-turn-lifecycle.spec.ts` covers before-receipt messaging and confirms that a post-receipt failure does not replay the turn. Automatic chat reopen is **not implemented**; see Decisions.
5. **Malformed catalog entries.** `codex-app-server-process.ts` compares raw model/list data length with the tolerant validated result at the response boundary and emits a debug log with only a capped count and constant reason. It logs no raw model content.
6. **Type fixtures.** Updated executable-selection fixtures in `codex-lane-activation.spec.ts` and `codex-lane-parity.spec.ts`, mock adapter fixtures in `provider-rpc.handlers.spec.ts`, and logger fixtures in the CLI and Electron composition specs.

## TypeScript checks

Only `error TS` output was collected. Ten `npx tsc -p .../tsconfig.spec.json --noEmit` calls were used, one at a time, as permitted.

| Project | Last filtered result | Verification limit |
| --- | --- | --- |
| `libs/backend/codex-runtime` | No TS errors | `codex-context.ts` and profile spec changed afterward. |
| `libs/backend/agent-sdk` | No TS errors | Chat stream and lifecycle spec changed afterward. |
| `libs/backend/cli-agent-runtime` | Initial TS2322 in two selection fixtures; rerun had no TS errors. | Lane model omission changed afterward. |
| `libs/backend/cli-engine` | Initial TS2345 logger fixtures and TS2345 in native settings; rerun had no TS errors. | Lane model omission changed afterward. |
| `libs/backend/rpc-handlers` | TS2352 in three mock adapter fixtures; fixtures were corrected. | No rerun remained under the ten-call cap. |
| `libs/backend/auth-providers` | No TS errors. | No later edits in this project. |
| `apps/ptah-electron` | Initial TS2345 logger fixtures; final rerun had no TS errors. | Fallback spec and source were included in the final rerun. |

Scoped `ptah_get_diagnostics` was attempted after edits, but the TypeScript service returned unavailable after its 45-second timeout, including on a single file. No tests were run, per lane instruction.

## Decisions

- **Chat fallback:** A correct live reopen needs ownership changes across the chat session, approval sink, context, runtime, and executable snapshot. That exceeds the ~80-line limit in the instruction. I used the explicitly allowed clear error path: update installed Codex or remove it from PATH, then restart to select bundled Codex. Reversible: yes; a later session-level reopen can replace this message path.
- **Missing model:** Absence remains `undefined` through profile construction and is omitted from JSON requests, letting Codex choose its default. Existing explicit models remain validated as nonempty. Reversible: yes.
- **Catalog diagnostics:** A bounded count and fixed reason are sufficient evidence of tolerant filtering while keeping model payloads and account data out of logs. Reversible: yes.
- **Native settings rollback:** If a session started with Codex's implicit default, there is no previous model ID to restore after a failed save. The rollback now fails explicitly and preserves both errors in the existing `AggregateError`. Reversible: yes.

## Remaining issues

- Automatic bundled retry for chat's first `turn/start` is not implemented; the permitted user-facing error alternative is in place.
- The Electron fallback spec validates the one-shot selection but does not drive an adapter turn through `openFallback`.
- Final TypeScript state for the post-check edits in codex-runtime, agent-sdk, cli-agent-runtime, cli-engine and rpc-handlers remains unverified because the ten-call cap was reached and Ptah diagnostics timed out.
- No skill-loading tool was listed in this lane, so no optional skill could be loaded.
