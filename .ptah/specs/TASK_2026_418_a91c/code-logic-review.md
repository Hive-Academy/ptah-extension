# Code Logic Review — `TASK_2026_418_a91c` Batch A

Scope: uncommitted `git diff` in the worktree (Batch A shared/backend files), reviewed
against `implementation-plan.md`, `batch-a-report.md`, and `TASK_2026_533_b7e1/context.md`.
Full contents of every changed production file were read (not only the diff hunks) for
`pricing.utils.ts`, `provider-models.service.ts`, `stream-transformer.ts`,
`session-query-executor.service.ts`, `session-history-reader.service.ts`,
`system-message.transformer.ts`, `session-registry.service.ts`,
`session-lifecycle-manager.ts`, `sdk-agent-adapter.ts`, plus the out-of-batch consumer
`provider-rpc.handlers.ts` that the diff's new contract silently affects.

> Status: this review covers Batch A **before Revision 1**. Revision 1
> (`batch-a-report.md`, "Revision 1") changed `provider-rpc.handlers.ts` and
> every dynamic fetcher, so the provenance defect below is a pre-revision
> assessment. Revision 1 resolved it: the generic stamping was removed, and
> `contextLengthSource: 'provider'` is now declared only by producers with
> provider-backed evidence. Static fallbacks and inferred lengths omit it, so
> they never report known capacity.

## Verdict

APPROVE, 8/10 — the two additive contracts (provider-qualified context capacity,
same-boundary compaction measurement) are implemented carefully and match the plan's
exact-match / no-fallback / frozen-route requirements, with strong regression coverage
for TASK_2026_533 accounting (untouched). One Serious provenance-honesty gap exists in a
narrow, already-scoped-out consumer (`provider-rpc.handlers.ts`'s Anthropic-direct/
claude-cli model listing) that the new "trust every dynamic fetcher's positive length"
wrapper in `provider-models.service.ts` mislabels as verified provider evidence. It does
not touch cost/token accounting and is masked in the common case, but it is a real,
traceable violation of Component 1's core contract and should be fixed or explicitly
deferred with a follow-up ticket before this batch is called done.

## Defects

### 1. (Serious) Bundled/family-regex context length gets mislabeled `contextLengthSource: 'provider'` for the Anthropic-direct and claude-cli virtual providers

- File: `libs/backend/auth-providers/src/lib/provider-models.service.ts:289-297`
- Also implicated (unchanged, out-of-batch consumer): `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:328-374,393-411`

`fetchModels`'s dynamic-fetcher branch now does:

```ts
const models = (await dynamicFetcher()).map((model) => ({
  ...model,
  contextLengthSource:
    typeof model.contextLength === 'number' &&
    Number.isFinite(model.contextLength) &&
    model.contextLength > 0
      ? ('provider' as const)
      : undefined,
}));
```

This treats *any* positive `contextLength` returned by *any* registered dynamic fetcher
as genuine provider evidence. But `registerAnthropicDirectFetcher()` in
`provider-rpc.handlers.ts` (registered for provider ids `'anthropic'` and `'claude-cli'`,
lines 380-411) builds its `ProviderModelInfo[]` like this:

```ts
return apiModels.map((m) => ({
  id: m.value,
  name: m.displayName,
  description: getModelPricingDescription(m.value),
  contextLength: getModelContextWindow(m.value),   // <-- bundled table / family regex
  supportsToolUse: true,
}));
```

`m` here is the SDK's `ModelInfo` (`{ value, displayName, description? }` — no context
field), and `getModelContextWindow` (still exported, `pricing.utils.ts:434`) is exactly
the bundled-pricing-table + Claude-family-regex fallback the whole task exists to stop
treating as authoritative. The value it returns is *not* a live provider response; it is
Ptah's own static guess.

**Scenario**: the extension starts, a user opens the model picker while authenticated
directly to Anthropic (or via `claude-cli`). `ProviderRpc` calls
`providerModels.fetchModels('anthropic', apiKey)`. The dynamic fetcher returns a
`gpt`-shaped `contextLength` sourced from `getModelContextWindow`; the generic wrapper at
`provider-models.service.ts:291-296` sees `contextLength > 0` and stamps
`contextLengthSource: 'provider'`. `recordContextWindows(models, 'anthropic')`
(`:212-218`) then filters *by that stamp* and registers the value into the qualified
`discoveredContextWindows` map under the exact key `['anthropic', modelId]` — the same
`providerId` string `resolveCapacityRoute` (`session-query-executor.service.ts:68-98`)
freezes onto every native-Anthropic query's `capacityRoute`.

Later, in `stream-transformer.ts:514-518`, `resolveContextCapacity({ route: {kind:
'native', providerId: 'anthropic'}, model, sdkContextWindow })` is called for a native
query. If `sdkContextWindow` for that model's result is ever `0`/missing/non-finite (the
plan itself calls this a real, anticipated case — "SDK reported nothing at all" was one
of the three ranked sources the old `resolveResultContextWindow` explicitly handled), the
resolver falls through to the catalog branch (`pricing.utils.ts:426-431`), finds the
poisoned `'anthropic'`-keyed entry, and returns
`{ source: 'provider-catalog', tokens: <bundled/regex value> }` — reporting a fabricated,
locally-guessed number as verified provider evidence. This is precisely the outcome
Component 1's contract forbids: *"No bundled family regex, static 128000, generic SDK
proxy 200000... Only genuine remote catalog/dynamic-fetcher evidence sets it"*
(`implementation-plan.md` Component 1 and the `provider-models.service.spec.ts` red spec
"does not promote static or legacy persisted context lengths into provider evidence").

**Why Serious, not Blocking**: it never touches cost/token accounting (533 is untouched);
for a native route the SDK almost always does report a real `contextWindow`, so the
`sdk-native` branch pre-empts the catalog branch in the common case; and the trigger
requires two independent conditions to align (model picker opened for that provider at
least once, AND a live result missing its own window for that exact model). It is not
observed to break TASK_2026_533 or 418's headline "no cross-provider borrowing" claim
(the isolation is still exact, since the poisoned value never crosses to a *different*
`providerId`) — but the underlying honesty guarantee for the `'anthropic'`/`'claude-cli'`
providers specifically is compromised, and the new evidence-provenance test suite does
not cover this dynamic-fetcher path (it only exercises the `mergeStaticMetadata`
enrichment and `moonshot`'s live-API path).

**Fix direction**: don't derive `contextLengthSource` generically from "did the fetcher
return a positive number." Either (a) have `registerAnthropicDirectFetcher`'s mapped
objects omit `contextLength` entirely (or set it to `0`) when the value came from
`getModelContextWindow` rather than a real API field, so the generic wrapper's `> 0`
check naturally excludes it; or (b) have each dynamic fetcher return its own
`contextLengthSource` alongside `contextLength` and have `provider-models.service.ts`
respect (not overwrite) an explicit `undefined`/`'provider'` the fetcher already set,
only defaulting when the fetcher is silent on the field.

## Verified OK

- **Exact provider+model isolation** (`pricing.utils.ts:350-432`): `contextWindowKey`
  scopes every registration/lookup to `[providerId, modelId]`; the spec
  ("does not borrow another provider's context capacity for the same model",
  `pricing.utils.spec.ts:29-72`) proves cross-provider borrowing is impossible and an
  unqualified legacy entry (`register([{...}])` with no providerId) cannot satisfy a
  qualified lookup (`pricing.utils.spec.ts:64-70`). `registerModelContextWindows` is only
  ever called from production code with an explicit `providerId`
  (`provider-models.service.ts:212-217,1038,1072`) — no other production call site
  exists.
- **No generic 200000 / static 128000 / fuzzy match**: `resolveContextCapacity`
  (`pricing.utils.ts:406-432`) has exactly the two ranked sources the plan specifies
  (native+finite-positive-SDK-window, or exact qualified catalog) and returns
  `{tokens:null, source:'unknown'}` otherwise — confirmed by
  `stream-transformer.spec.ts`'s "publishes unknown capacity for a proxy with only a
  generic SDK window" and "a proxied model that only FUZZY-matches the bundled table
  publishes unknown" (now asserting `contextWindow` is `0`, not `200_000`).
- **capacityRoute derivation and freezing** (`session-query-executor.service.ts:74-125`):
  `resolveCapacityRoute` is a new function, independent of `getActiveProviderId`'s
  hostname-substring match. It requires an exact `URL.href` match against
  `getAllAnthropicProviders()` or a known local-proxy auth-token placeholder
  (`COPILOT_/CODEX_/OPENROUTER_PROXY_TOKEN_PLACEHOLDER`), rejects impersonation via
  substring hostnames or non-root paths (spec: "rejects route substrings and remote
  proxy-token impersonation for capacity",
  `session-query-executor.service.spec.ts:230-256`), and is derived once from
  `effectiveAuthEnv = authEnvOverride ?? this.authEnv` (profile override honoured) at
  `:194-209`, frozen via `Object.freeze` on the `SessionRecord`
  (`session-registry.service.ts:229-242`). Active reuse in `sdk-agent-adapter.ts:906`
  passes `existingSession.capacityRoute` through unchanged — no re-derivation from
  mutable global state. `getActiveProviderId` remains used only for unrelated purposes
  (error messages, tier/pricing alias resolution) — confirmed by grep across the
  worktree; it never feeds `capacityRoute`.
- **provider-models.service evidence discipline** (`provider-models.service.ts:196-218,
  338,505-537`): `recordContextWindows` filters by `contextLengthSource === 'provider'`
  before registering; `mergeStaticMetadata` (`:505-537`) enriches the returned
  `contextLength` for *display* but never re-tags `contextLengthSource`, and its output is
  never re-fed into `recordContextWindows`; the static-only and legacy-persisted-without-
  the-field paths (`:373-387`, `:182-198`) are proven to leave capacity unknown while
  keeping the model selectable (`provider-models.service.spec.ts`'s three new/rewritten
  specs). OpenRouter prefetch is qualified `'openrouter'` at both call sites
  (`:1038,1072`), confirmed not to leak into `'openai-codex'`
  (`provider-models.prefetch-context-windows.spec.ts:117-121`).
- **Compaction measurement provenance** (`system-message.transformer.ts:87-118`):
  measurement is only attached when both `pre_tokens` and `post_tokens` are finite,
  non-negative numbers from the *same* `compact_metadata` object; `boundaryId` uses the
  SDK `uuid` when present, else the emitted event's own id — never a timestamp or
  half-filled pair. Verified against all eight pre/post combinations (both valid
  directions, missing, `NaN`, negative, `Infinity`) in
  `system-message.transformer.spec.ts:92-155`; completion is still emitted with no
  measurement for every invalid case (never blocks completion).
- **TASK_2026_533 accounting untouched**: `SessionStatsOwnerService` file itself has zero
  diff. The only change inside `stream-transformer.ts`'s `replaceRun` call site is
  whitespace/argument-wrapping (verified via a diff restricted to `+`/`-` lines matching
  `durationMs|replaceRun|usageCostSource` — only reformatting, no logic delta). New tests
  reuse the same replace-not-add semantics (duplicate `replaceRun` call with an identical
  contribution keeps `tokenCount` at `1108`, not `2216` —
  `sdk-agent-adapter.spec.ts:1424-1447`).
- **No throwing capacity lookup**: `resolveContextCapacity`, `getDiscoveredContextWindow`
  and `resolveCapacityRoute` are fully defensive (optional chaining, `typeof`/
  `Number.isFinite` guards, and `resolveCapacityRoute`'s URL parsing is wrapped in
  try/catch at both the outer route level and the per-provider match level) — none can
  throw into the streaming result-handling path and interrupt accounting.
- **No secrets logged**: the new `resolveCapacityRoute` code path never logs `authEnv`,
  `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_API_KEY`; only the derived `providerId`/`kind`
  travel on the record.
- **History reader honesty** (`session-history-reader.service.ts:1113-1126`):
  `knownContextWindow` unconditionally returns `{contextWindow: 0, contextCapacity:
  resolveContextCapacity({model})}` — no route is available from a transcript, so it can
  never resurrect a model-only fallback, confirmed by both rewritten specs
  (`session-history-reader.service.spec.ts:437-533`).
- **Off-batch flakiness note** (focus item 8): `off-thread-process-spawner.spec.ts:612`'s
  120s timeout and the Nx plugin-isolation workaround for the frontend typecheck are both
  outside this diff's file list (`git diff --stat` confirms neither file is touched) and
  are pre-existing infra flakiness unrelated to any logic in Batch A.

## Not verified

- Whether the batch-a-report's claimed test/typecheck/lint pass counts are reproducible
  was not independently re-run in full (out of scope per instructions: no full-suite
  execution). The specs that matter for the claims above were read in full and their
  assertions traced by hand against the corresponding production code, which is a
  stronger check than trusting the report's pass/fail table, but no `nx test` was
  executed by this review.
- Whether `resolvedModel`'s exact string casing always matches the exact casing of the
  corresponding provider catalog `id` in production (both are sourced from the same
  provider response in the paths inspected, so no concrete mismatch was found) — the new
  exact-match-only key format (`pricing.utils.ts:367-369`, no lowercase/alias
  normalization) is deliberate and pinned by
  `pricing.utils.spec.ts`'s "capacity ids remain exact without stripped, case or dotted
  aliases," but a live casing divergence between an SDK-reported model id and a provider's
  catalog id (if one ever exists for a given provider) would silently present as
  `unknown` rather than `provider-catalog`. This is the intended fail-safe direction
  (honest unknown over a wrong guess) so it is not filed as a defect, but it was not
  possible to rule out from static reading alone for every provider's actual API
  response shape.
- Batch B (frontend consumption of `contextCapacity`/`measurement`) is unmodified in this
  diff and was not reviewed — it is out of scope for Batch A.
