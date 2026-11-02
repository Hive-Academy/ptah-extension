# Native Codex usage live defects: fix 1

## Findings and fixes

1. **Cost stayed unavailable.** The redacted live checkpoint had complete coverage and 40,249 tokens, but its root thread had no `modelId`; pricing had `knownCost: 0`, `complete: false`, and no provenance (`checkpoint-fields.json`). The pinned native `thread/start` and `thread/resume` response schema requires `model`, while usage notifications may omit it (`codex-protocol-schemas.ts:506`). `codex-chat-turn-stream.ts:231` prices only the evidence model. `codex-context.ts:257` now hands the validated thread response model to the translator. `codex-event-translator.ts:180,333-345` retains that model for model-less usage notifications and replaces it when a notification supplies a newer native model. This carries the native model into the usage checkpoint and exact pricing. Existing `calculateExactMessageCost` logic emits `covered-by-subscription` for subscription billing and `estimated` for API-key billing; no UI model inference was added. Focused spec: `codex-event-translator.spec.ts:390` uses a model-less notification with the live-shaped context window.

2. **Session Plan Limits said “Account not resolved.”** The live landing surface showed a 20% weekly Codex window, while the session tile had no owner, and the provider account tables had zero rows (`live-test-usage-4b257cc7b.md`, `db-metadata-fields.txt`). The plan snapshot previously copied ledger session owners and assigned null to every remaining requested session. A native Codex session can instead have a persisted `codexExecution` home with no ledger or provider-account link. `plan-limits-snapshot.service.ts:87-90,109,169,256-282` now reads that validated metadata and maps the session to `ownerForCodexHome(normalizedHome)` only when that owner is present among the discovered Codex snapshots. This uses the same native owner and usage reader as the selected provider surface and leaves Claude and other providers on their existing paths. Focused spec: `plan-limits-snapshot.service.spec.ts:108` checks a persisted native session and an unrelated Claude session. The native account client already has a 30-second cache and coalesces concurrent reads (`codex-account-usage-client.ts:22,266-347`); the observed slow calls can still occur on a cold App Server read. No extra spawn was introduced.

3. **Context and model vanished after reload.** The live turn showed 7.8% context and GPT 6 Luna; reload and restart preserved tokens but cleared context/model (`turn1.json`, `reload.json`, `app-restart-expanded.json`). `SessionHistoryReader` already restores `CodexSessionUsageOwner.snapshot()` from the checkpoint (`session-history-reader.service.ts:385-404`), but the checkpoint did not retain native context-window and last-request usage, and the owner snapshot did not project them back. `codex-runtime.types.ts:216-217`, `codex-event-translator.ts:342-345`, and `codex-session-usage-owner.ts:15-21,273-285,308-333` now persist native model/context evidence and rebuild the session context snapshot. `codex-chat-adapter.ts:327` records billing mode for a fresh or resumed checkpoint; `codex-session-usage-owner.ts:55,153-164,301-320` restores the price basis and complete price on history load. Focused specs: `codex-session-usage-owner.spec.ts:25-64` computes the exact native model price from live-shaped token counts, then round-trips context, model, subscription basis, and API-key estimate.

## Changed files

- `libs/backend/codex-runtime/src/lib/codex-context.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.spec.ts`
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts`
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts`
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-usage-live-fix1-report.md`

## Verification and limits

Read-only inspection confirmed the pinned native schema, the Codex rate-card entry for `gpt-6-luna`, the history restore path, and the shared Codex account reader. `git diff --check` passed. Per task instruction, no npm, Nx, Jest, lint, typecheck, build, verify, or live Electron run was performed. The new specs are written but unexecuted. Older checkpoints that never stored a native model or context window cannot reconstruct those fields until a subsequent native usage event; their prior unpriced turns remain incomplete. The existing unrelated change in `task-tracking/landing-live-demo/HANDOFF.md` was left untouched. Ptah dependency graph remained in `building` state, so source impact inspection used native read-only PowerShell after the index returned no usable result; `rg.exe` was unavailable in this workspace.
