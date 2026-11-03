# Batch A2 report

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
- `libs/backend/codex-runtime/tools/evidence-harness.ts`
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`
- `scripts/codex-start-probe.ts`
- `.ptah/specs/TASK_2026_862_bf84/batch-A2-report.md`

## Files deleted

- `libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs`
- `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json`

The frozen `codex-app-server-protocol.schema.json` remains as offline protocol evidence.

## Behavior changes

- Inbound objects strip unknown fields. Outbound request and response schemas remain strict.
- Unknown optional enum values are omitted. Unknown values in optional enum arrays are filtered.
- Unknown item variants retain only `id` and `type`, then emit payload-free `unsupportedItem` evidence.
- A malformed known item variant cannot use the unknown-item fallback. Required fields still fail validation.
- Unknown methods still produce `unknownMethod` at the validator boundary. The process boundary can ignore a notification or answer a server request with `-32601`.
- Direct translator calls ignore unknown notifications without changing the event sequence.
- `model/list` accepts arbitrary model IDs. It requires nonempty `id` and `model` fields and skips malformed entries without rejecting valid siblings.
- The evidence harness derives method evidence from the frozen schema. It no longer reads or verifies a binary/schema SHA manifest.
- The evidence harness selects an explicit real-run executable through `selectCodexExecutable` and records its source, version, and reason.
- The startup probe uses `CodexSelectionSnapshot` and `createNodeCodexExecutableProbes`. It no longer checks an exact version, binary digest, or launch digest guard.

## Tests added

- Future model IDs, unknown model modalities, unknown `multiAgentVersion`, unknown fields, missing/empty required model fields, and valid siblings after malformed entries.
- Unknown item variants, malformed known items, unknown optional item enums, and missing required item data.
- Unknown approval, rate-limit, startup, and active-flag enum values.
- Unknown notification behavior at the validator and translator boundaries.
- Agent-message completion with an unknown optional `phase`.
- Method evidence derived from the frozen schema.
- Existing harness fixtures now use method-only evidence instead of the deleted manifest.

## Verification

- `ptah_get_diagnostics`: clean for the eight owned protocol/translator/harness TypeScript files and `evidence-cases-round.spec.ts`; 0 errors and 0 warnings.
- The separate `scripts/codex-start-probe.ts` diagnostic run is not clean. It reports an unresolved library alias, script `rootDir` errors, and related script configuration errors.
- Tests, `tsc`, build, Nx, and `npm run verify` were not run. Lane instructions prohibit them.

## Decisions

- Kept `unknownMethod` in the validator. The process boundary must distinguish an ignorable notification from a server request that needs `-32601`.
- Added a guarded unknown-item union arm. Known discriminators cannot fall through after a required-field failure.
- Reparse a validated item with `knownItem` in the translator. This preserves TypeScript discriminator narrowing and gives unknown items only `unsupportedItem` evidence.
- Made array element schemas optional before `.catch(undefined)`. This matches Zod's catch input type and permits filtering.
- Kept the frozen schema as the only protocol artifact loaded by the harness. The legacy `Manifest` type accepts historical extra fixture metadata, but the loader emits only method lists.
- Treated an explicit `--codex` path as the first installed candidate. The shared selector retains bundled fallback and fresh selection on each runtime open.

## Open issues for other lanes

- Malformed model entries are filtered inside the Zod result schema, which has no injected logger. Batch 2 or the coordinator must add bounded, redacted debug evidence at the response-validation boundary for these skipped entries. No raw model payload is logged.
- Run the startup probe with its documented TypeScript configuration after integration. The Ptah diagnostic project currently reports the script alias and `rootDir` errors listed above.
