# Batch 6: rich quota DTO and shared mapping

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-account-usage.types.ts:13-54` adds typed rate windows, ordered buckets, allowance data, and safe reset-credit/upsell availability flags.
- `libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts:74-180` maps the validated native response into all buckets, keeping `codex` first and sorting other native IDs lexically. Other IDs become stable hashes; bucket labels are generic. Numeric strings and code-like fields are constrained before leaving the client. Raw account IDs, limit names, reset-credit objects and upsell payloads are omitted.
- `libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts:314-394` updates the active-bucket fixture and adds ordered-bucket, allowance, reset-credit/upsell and redaction cases.
- `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:70-174` maps each bucket's primary then secondary window with bucket-qualified keys, reached cause, spend-control flag, reset and allowance fields. Older single-quota responses retain their previous keys and shape.
- `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts:152-200` covers multi-bucket ordering, distinct keys, reached cause, reset instants, credits and individual allowance.
- `libs/shared/src/lib/types/plan-limit.types.ts:80-120,221-260` adds provider-neutral optional bucket and allowance fields to the plan-limit contract.
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch6-report.md` is this report.

The batch row's six source/spec files are the only product files changed. No frontend or runtime notification wiring was edited.

## Design decisions and scope

The existing `quota` field remains as a compatibility view of the active Codex bucket. New `buckets` carries every native bucket; a response without meaningful quota evidence leaves it absent. The client does not forward raw native `limitId` or `limitName`, because either could contain account-specific text. A hashed bucket key is stable across refreshes, and generic labels avoid disclosing a display name. The `codex` bucket stays first; other buckets use ordinal lexical ordering of their native keys. Windows receive `other:<bucket>:primary|secondary` keys so equal durations in different buckets cannot collide. Unknown values remain absent. An unlimited credit bucket has no numeric balance.

The pinned native schema parses reset-credit data only as an object and upsell data as arbitrary JSON. Their typed DTO representation is an availability flag; raw content is withheld until a documented, safe field schema is available. Reset timestamps on windows and individual allowances are normalized from native seconds to milliseconds without inventing an absent value.

The batch-6 reader returns owner-level allowances and availability flags, but `plan-usage.service.ts:446-470` currently assembles only selected reading fields. A separate follow-up batch must pass those optional fields through the service and ledger/RPC path before batch 8 renders credit or individual-allowance tiles. This file is outside the exact batch-6 row. The existing `plan-limit-tiles.ts` model also needs review in that follow-up under the implementation plan's provider-neutral DTO note.

## Coordinator verification scope

Affected Nx projects: `@ptah-extension/codex-runtime`, `@ptah-extension/auth-providers`, `@ptah-extension/shared`. Scoped dependent projects: `@ptah-extension/rpc-handlers`, `ptah-electron`, plus `ptah-extension-vscode`, `ptah-extension-webview`, `ptah-cli` and `ptah-tui` where the shared plan-limit type is consumed. Focused spec name patterns: `codex-account-usage-client` and `codex-plan-usage.reader`.

The batch-row gate is typecheck/lint for `@ptah-extension/codex-runtime,@ptah-extension/auth-providers,@ptah-extension/shared,@ptah-extension/rpc-handlers,ptah-electron` with `--parallel=1`, then focused tests for `@ptah-extension/codex-runtime,@ptah-extension/auth-providers` with `--coverage=false --maxWorkers=2`. The coordinator should include the dependent hosts above when applicable. No test, lint, typecheck, build, Nx, npm, verify, diagnostics, installation, or app launch command was run in this lane. Source and diff were inspected; the changed source/spec files have LF line endings without BOM. The Ptah dependency graph was still building, so direct source inspection was the fallback. The connected skill inventory exposed no matching backend skill loader; the supplied project rules were applied directly.

## Follow-ups outside batch 6

- Batch 4 review R3: a throwing stats callback in `finally` can replace the result error.
- Batch 4 review R4: lifetime pricing across mixed billing modes.
- Batch 3 review D4: `isOptional` validation for `costBasis`, `pricingCoverage`, and `priceProvenance` in `isValidSessionStatsSnapshot`.
- Batch 5 minors: comment the terminal-only publish invariant in `codex-chat-turn-stream.ts`; key the tooltip branch on `SessionCostBasis` rather than label text.
- Batch 7: unify default and explicit-home reads and wire validated live notifications into the same cache and ledger.
- A separate provider-neutral propagation batch is needed for `plan-usage.service.ts` and any necessary plan-limit presentation DTO work before batch 8. This exceeds the exact six-file batch-6 row.

The unrelated `task-tracking/landing-live-demo/HANDOFF.md` change was not touched.

## Revision 1

- **S1:** `libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts:188-221` now prepends a sanitized `codex` bucket from default `rateLimits` when the ID map lacks `codex`; `:220-237` keeps the compatibility `quota` in sync. `codex-account-usage-client.spec.ts:388-405` covers default primary and secondary windows alongside another bucket.
- **M1:** `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:139-148` retains duration-derived keys for `codex` and qualifies only other buckets. `codex-plan-usage.reader.spec.ts:176-179,202-214` covers both unknown and known durations.
- **M2:** `codex-account-usage-client.ts:203-215` derives a stable generic label from the sanitized bucket hash, independent of lexical position. `codex-account-usage-client.spec.ts:371-377,407-416` checks its shape and stability after insertion. Neither native ID nor native display name is copied.
- **M3:** `codex-account-usage-client.ts:72-187,188-249` uses Zod to parse the DTO input and each window, individual limit, credit object, decimal and safe code. Invalid subfields are omitted while valid neighboring fields survive; empty malformed buckets are omitted. `codex-account-usage-client.spec.ts:418-445` covers malformed partial mapper input and redaction. **Upstream limitation:** `CodexAppServerProcess.request` validates the entire native response with `codex-protocol-methods.ts` before this client receives it. A malformed wire field still rejects the whole response there. Field-level wire recovery needs a separate change to that protocol/process boundary, outside this six-file batch; the direct mapper spec does not prove wire-level recovery.
- **M4:** `libs/shared/src/lib/types/plan-limit.types.ts:103-120` adds optional bucket-level reached and spend-control evidence; `codex-plan-usage.reader.ts:98-110` carries it in an allowance even with no windows. `codex-plan-usage.reader.spec.ts:216-226` covers this. The separate plan-usage service propagation follow-up in the original report remains necessary.
- **Minors:** `codex-plan-usage.reader.ts:88-120` normalizes each individual reset once and reuses the mapped allowance. Reset-credit and upsell remain boolean availability because the pinned protocol gives an object and arbitrary JSON respectively, without a documented enabled flag. No raw payload is exposed.

Revision 1 affected Nx projects remain `@ptah-extension/codex-runtime`, `@ptah-extension/auth-providers`, and `@ptah-extension/shared`, with the dependent gates and focused spec patterns listed above. No test, lint, typecheck, build, Nx, npm, verify or diagnostics command was run in this revision. The coordinator reported that the earlier batch passed typecheck and focused tests; this revision has not been verified. No matching CLI skill loader was available in the connected tool list, so the supplied project rules were applied directly.
