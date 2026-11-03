# Codex models, protocol, pricing, and dependency research

Scope: current source in the `codex-binary-unpin` worktree. This report maps code for the architect. It does not make the design decision.

Decision supported: remove release coupling without losing protocol or cost safety. The compared options are static versus dynamic model catalogs, strict versus tolerant protocol reads, zero versus unavailable cost, and manual versus grouped dependency updates.

## 1. Hardcoded model lists and rejection rules

### Native chat

- **Verified:** native chat reads `model/list` directly. `CodexContext.listModels` reads at most 100 pages and returns server model IDs without an ID allowlist (`libs/backend/codex-runtime/src/lib/codex-context.ts:1005-1040`). New model IDs therefore pass this path when the response satisfies the schema.
- **Verified:** `model/list` declares `id` and `model` as unrestricted strings (`libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:169-170`). Protocol validation does not reject an unknown model ID.
- **Verified:** failures collapse to `Codex model listing failed` (`libs/backend/codex-runtime/src/lib/codex-context.ts:1036-1039`). Unpinning needs no model-ID change here, but diagnostics cannot distinguish an unavailable method from an incompatible result schema.
- **Verified:** the shared provider entry still contains seven static models and default tier mappings (`libs/shared/src/lib/providers/entries/codex-provider-entry.ts:49-71`, `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:81-96`). This feeds provider configuration and fallback catalogs, not the native `model/list` result.
- **Verified:** provider discovery uses that static list as an allowlist for platform matches. Only platform IDs already in `CODEX_PROVIDER_ENTRY.staticModels` survive (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:369-390`). The same entry is the final fallback after account discovery fails (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:398-420`). Replacing it needs a native/account catalog source and an explicit empty-catalog policy.
- **Verified:** account discovery is not a fixed seven-ID allowlist. OAuth keeps server entries whose `visibility` is `list` (`libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:479-493`). API-key discovery does reject IDs outside `/codex|gpt-5/i` (`libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:496-504`). A future `gpt-6` ID without `codex` in its name would not pass this path.
- **Verified:** account discovery sends the newer of a hardcoded `0.162.0` floor and the local CLI cache version (`libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:226-245`, `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:841-858`). Unpinning does not require removal, but the floor remains a release-maintained discovery input.

### CLI lanes

- **Verified:** `CODEX_LANE_DEFAULT_MODEL` is `gpt-6-sol`, and `CODEX_LANE_FALLBACK_MODELS` contains seven IDs (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models.ts:5-15`). These are a default and picker fallback, not an execution allowlist.
- **Verified:** lane catalog reads use the app-server catalog and fall back to the seven entries on failure (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:183-207`). Model selection uses the request, restored model, then `CODEX_LANE_DEFAULT_MODEL` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:212-230`). No selected-model membership check occurs in this path.
- **Verified:** lane mapping uses `model.model` as the runnable ID and requires `id`, `model`, `displayName`, and `isDefault` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models.ts:17-27`). It labels only the hardcoded default (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models.ts:30-32`).
- **Verified:** spawn policy duplicates the `gpt-6-sol` default after request and setting precedence (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts:20`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts:53-64`). Replacing the default requires both definitions and their callers to agree.
- **Verified:** `BLOCKED_LANE_MODELS` contains only `mimo-v2.6-flash-free` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts:22-35`). It is not a Codex allowlist.
- **Verified:** model rejection handling classifies server-side model-not-found and unsupported-model messages (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.ts:21-22`). It then gives source-aware advice for request, setting, Ptah default, or CLI default (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.ts:46-72`). It runs after rejection and does not gate execution.
- **Verified:** the alternate `codex debug models` parser filters `visibility === 'list'`, sorts by priority, and maps server slugs (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-catalog.ts:30-52`). Its probe degrades to `undefined` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-catalog.ts:59-100`). Searches found only its specs as callers, so it is not the production lane catalog.

### Replacement requirements

- Keep `model/list` as the native chat and lane source. Do not replace one static list with another client-side ID filter.
- Derive the lane default from `isDefault`, or omit the model so Codex selects its own default. Define behavior when several or no entries have `isDefault`.
- Define one failure policy for an empty or failed catalog. A stale seven-ID fallback can show models the current binary or account does not support.
- Remove the static-ID platform filter and API-key `/codex|gpt-5/i` filter if those provider paths must also discover future models. Keep server visibility filtering.
- Decide whether legacy provider tier mappings remain. They cannot reliably infer tiers for arbitrary future IDs without a separate server capability mapping.

## 2. Protocol parsing strictness and required methods

### Current behavior

- **Verified:** ordinary `z.object` server envelopes and result objects strip unknown fields (`libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:315-343`). Most server schemas therefore tolerate additive fields already.
- **Verified:** strict schemas protect outgoing client data and selected policies (`libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:7-8`, `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:19-81`). These strict contracts do not reject new fields sent by the server unless a strict server object also uses them.
- **Verified:** failed schema parsing throws `CodexProtocolError` (`libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:165-178`). A known request with an invalid result rejects only that pending request (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:431-448`).
- **Verified:** the validator has a pinned set of server notifications that may carry unmodeled payloads (`libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:188-303`). Other unknown notification methods produce `unknownMethod` (`libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:355-387`).
- **Verified:** the process layer catches `unknownMethod` for notifications without an ID, logs a redacted method once within a bound, and returns (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:405-429`). Unknown notification methods are already ignored before and after initialization.
- **Verified:** the translator ignores pinned unmodeled notifications, but a direct call for another unknown method returns invalid/unsupported-notification evidence (`libs/backend/codex-runtime/src/lib/codex-event-translator.ts:476-478`). Normal process input filters those methods first.
- **Verified:** unknown server requests normally receive JSON-RPC `Method not found` (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:388-403`). The pre-check uses `strictObject` (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:379-387`). An additive field can make this pre-check fail and reach the throwing validator instead. Use a tolerant envelope for this classification.
- **Verified:** unknown model IDs remain strings, but `model/list` requires many fields on every model (`libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:160-207`). A missing newly optional field invalidates the whole response.
- **Verified:** `inputModalities` accepts only `text`, `image`, and `audio`. `multiAgentVersion` accepts only `disabled`, `v1`, and `v2` (`libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:185-189`). A new enum value invalidates the complete model list.
- **Verified:** item variants form a closed discriminated union (`libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:201-420`). Turn, thread, status, and history values also use closed enums (`libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:439-492`). New values can fail validation before translation.
- **Verified:** a recognizable unknown item can become safe unsupported-item evidence in the translator (`libs/backend/codex-runtime/src/lib/codex-event-translator.ts:298-309`). This fallback helps only if protocol validation lets the item reach the translator.

### Required methods and tolerant read policy

- **Source-based inference:** core native chat needs `initialize`, `thread/start` or `thread/resume`, and `turn/start`. Their contracts are registered in `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:40-75` and `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:119-145`.
- **Source-based inference:** dynamic catalogs need `model/list`. Full streaming also needs `initialized`, `turn/started`, `turn/completed`, modeled item notifications, and `thread/tokenUsage/updated` for usage. No runtime capability negotiation currently proves this grouping.
- **Source-based inference:** `turn/interrupt`, `turn/steer`, and `thread/compact/start` map to optional capabilities. `account/rateLimits/read` supports plan limits, not basic chat (`libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:155-159`, `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:209-218`).
- **Source-based inference:** thread read/list methods support history and session projection, not the minimum turn path. Treat them as required only for the features that call them.
- **Recommendation:** preserve strict validation for outbound client requests. Strip unknown inbound object fields and ignore unknown notification methods.
- **Recommendation:** make new enum values nonfatal. Preserve an unknown enum as an unsupported value or omit only that optional capability. Do not discard a complete model list for one unknown optional enum.
- **Recommendation:** validate required model identity fields per entry. Skip an unusable entry with bounded diagnostics rather than rejecting every entry. Keep required core-turn fields strict enough to prevent incorrect execution.
- **Recommendation:** detect missing required methods and unsupported versions at startup. Return a clear capability error. Do not treat every future notification or optional result field as a fatal protocol mismatch.

## 3. Pricing path for an unknown model

- **Verified:** the Codex rate card contains exact entries and states that absent IDs remain unavailable. It never substitutes another model's rate (`libs/shared/src/lib/utils/codex-rate-card.ts:31-34`, `libs/shared/src/lib/utils/codex-rate-card.ts:45-118`).
- **Verified:** pricing performs exact model lookup without provider-prefix or snapshot substitution (`libs/shared/src/lib/utils/pricing.utils.ts:472-485`). An absent rate returns `totalCost: null`, `costBasis: 'unknown'`, and `pricingCoverage: 'none'` (`libs/shared/src/lib/utils/pricing.utils.ts:512-524`). It does not throw and does not return zero cost.
- **Verified:** incomplete or ambiguous pricing also preserves null cost (`libs/shared/src/lib/utils/pricing.utils.ts:539-588`). A numeric total appears only when all used token classes are priced (`libs/shared/src/lib/utils/pricing.utils.ts:590-602`).
- **Verified:** native turn streaming calculates tokens independently from price (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:194-230`). It emits null turn/session cost with token statistics and model usage for an unpriced model (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:254-297`). The turn continues and tokens remain visible.
- **Verified:** a regression test uses `unpriced-native-model` and expects null costs, coverage `none`, and retained input tokens (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:385-405`). The backend unknown-rate behavior already exists.
- **Verified:** the shared badge displays `cost unavailable` for null cost and explains that per-token pricing is unknown (`libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:57-64`). Session summaries retain token output beside that badge (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html:82-120`).
- **Verified:** compact and accessibility surfaces also use `Cost unavailable` (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:34`).
- **Minimal change:** if `not priced` is the general null-cost label, change UI copy and its tests only. No backend pricing change is needed.
- **Caveat:** coverage `none` also covers unknown billing mode and incomplete or ambiguous cache pricing. If the UI must distinguish an absent rate-card row from those cases, add a reason code or equivalent metadata. A blanket wording change cannot make that distinction.

## 4. Automatic dependency bumps

### Current dependency and pin surface

- **Verified:** declarations exist in four manifests: root SDK `^0.165.0` (`package.json:95`), Electron SDK `^0.165.0` (`apps/ptah-electron/package.json:16`), agent-sdk CLI `^0.165.0` (`libs/backend/agent-sdk/package.json:19`), and auth-providers CLI `0.165.0` (`libs/backend/auth-providers/package.json:18`).
- **Verified:** the lockfile fixes SDK and CLI at `0.165.0`. The SDK depends on exact CLI `0.165.0`, and the CLI has six optional Darwin, Linux, and Windows platform aliases for x64 and ARM64 (`package-lock.json:10512-10644`). Update direct and indirect rows together.
- **Verified:** no Dependabot or Renovate configuration exists in the worktree.
- **Verified:** the protocol generator requires exactly `0.165.0`, regenerates schema/manifest artifacts, and writes that pinned version (`libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs:119`, `libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs:149-156`).
- **Verified:** the generated manifest records version, hashes, platform, architecture, and one win32/x64 artifact (`libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json:3-10`, `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json:229-235`). `codex-executable-pin-data.ts` duplicates the pin constants (`libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts:8-9`).
- **Verified:** the postinstall patch pins SDK version `0.165.0` and exact `dist/index.js` text (`scripts/windows-hide-patch/patch-windows-hide-deps.js:20-24`, `scripts/windows-hide-patch/patch-windows-hide-deps.js:45-61`). Its spec must change when the SDK text or version changes.

### Proposed automation

Add `.github/dependabot.yml` with one npm multi-directory update. Cover `/`, `/apps/ptah-electron`, `/libs/backend/agent-sdk`, and `/libs/backend/auth-providers`. Schedule it daily or weekly. Allow direct and indirect dependencies. Put `@openai/codex`, `@openai/codex-sdk`, and `@openai/codex-*` in one `codex` group so SDK, CLI, lockfile, and optional platform packages move in one pull request.

- **Before unpin removal:** the grouped pull request also needs the SDK patch and fixture update, protocol regeneration, generated schema/manifest, executable-pin data, and affected protocol fixtures. Dependency automation alone cannot safely merge the version bump while those exact pins remain.
- **After unpin removal:** delete obsolete pin and generation artifacts as part of unpinning. Routine bumps should then primarily change manifests, `package-lock.json`, and the SDK patch if the SDK remains.
- Keep the six platform aliases grouped. A partial update can make the installed CLI package and its platform binary disagree.
- Run the repository's scoped checks on the bump pull request. Require review for SDK patch drift because an exact-text patch can stop applying without a model or protocol failure.

## 5. Unit-test locations and patterns

- **Lane defaults and catalog:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:896-943` covers requested/default models. Lines 951-1054 cover fallback, timeout, cache, and dynamic mapping. Add server-default selection, empty/failure policy, and removal of stale fallback expectations here.
- **Lane precedence:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.spec.ts` covers request, setting, and default precedence. Add omitted-model/server-default behavior and keep both default definitions consistent.
- **Rejection and alternate catalog:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.spec.ts` covers source-aware messages and redaction. `codex-model-catalog.spec.ts` beside the parser covers visibility, ordering, and probe failures.
- **Provider discovery:** add cases near the provider RPC and auth service specs for future IDs, static-filter removal, API-key filtering, server visibility, and empty dynamic results. Existing Codex tests establish the catalog contracts to preserve.
- **Protocol validator:** `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts:249-530` covers extension stripping and strict client contracts. Lines 655-661 cover unknown notifications and modeled deltas. Lines 982-1038 cover malformed nested data and secret-free errors. Later cases cover pinned artifacts and item variants.
- **Process boundary:** `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts:204-238` covers unknown notifications before/after ready and bounded redacted logging. Lines 723-769 distinguish request-local invalid results from malformed envelopes. Line 783 covers `Method not found` for unsupported server requests. Add an unknown request with extra fields and unknown notification variants here.
- **Translator:** `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts:49-60` covers direct unknown-method behavior. Lines 471-495 cover malformed or ambiguous usage. Lines 1035-1048 cover unknown items and malformed notifications. Add new enum and unknown-item tolerance cases at the validator and translator layers.
- **Model-list parsing:** add one future model ID, unknown optional enum values, one malformed entry among valid entries, and missing required core fields. Assert which entries survive and which errors remain fatal.
- **Pricing:** `libs/shared/src/lib/utils/pricing.utils.spec.ts:516-721` covers exact rates and unknown models. Lines 781 onward cover the Codex rate card, and lines 1000-1003 cover discovered unpriced-model context. Keep the unknown-model case exact and assert null rather than zero.
- **Native usage:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:359-405` covers priced and unpriced usage with retained tokens. Extend this existing fake-turn pattern rather than adding a live Codex test.
- **UI:** `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.spec.ts:53-78` covers null-cost presentation. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts:285-323` covers null and partial coverage. `session-stats-view.spec.ts:71-106` covers compact and accessibility labels. Update all three if the copy changes.

## Decisions

- **Evidence scope:** use current source over the earlier pre-PR-#886 pricing audit. Current code and tests prove null cost with retained tokens. Options considered: historical report versus current source. Reversible: yes.
- **Classification:** treat static model lists as defaults/fallbacks unless code checks selected-model membership. Options considered: execution allowlist versus catalog fallback. Evidence: lane selection has no membership check. Reversible: yes.
- **Required-method grouping:** label the minimal chat and optional capability groups as source-based inference. Options considered: infer from call sites versus claim negotiated support. No negotiation evidence exists. Reversible: yes.
- **Pricing recommendation:** prefer UI-only `not priced` copy unless the product requires distinct null-cost reasons. Options considered: copy-only versus new reason metadata. Evidence: current backend already emits null and tokens. Reversible: yes.
- **Dependency automation:** propose one grouped Dependabot update across all four manifests. Options considered: grouped versus independent bumps. Evidence: SDK exact CLI dependency and six platform aliases require synchronization. Reversible: yes.

## Open questions

- Should an omitted model always let Codex choose its default, or should Ptah use `isDefault` from `model/list`?
- Should failed dynamic discovery show an empty catalog with an error, retain a last-known-good catalog, or keep a static fallback?
- Must legacy provider tier mappings and provider discovery support arbitrary future models, or does acceptance cover only native chat and CLI lanes?
- Does `not priced` describe every null-cost state, or must the UI distinguish an absent rate from incomplete or ambiguous usage pricing?
- Which thread history, interrupt, steering, compaction, and plan-limit methods are mandatory for the minimum supported Codex version?
- Will Dependabot pull requests receive a maintainer update for the exact SDK patch until that patch is removed?
