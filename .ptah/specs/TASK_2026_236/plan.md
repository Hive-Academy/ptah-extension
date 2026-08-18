# Implementation Plan — TASK_2026_236

Branch `ak/task-236-custom-providers`, worktree
`D:\projects\ptah-extension\.claude-worktrees\task236`.
Read `./research.md` before touching code — it carries verified `file:line`
citations for every seam below.

## Decisions (locked — do not re-litigate)

1. **All four research defaults adopted.**
   - Pricing: custom entries show "cost unavailable" by default; the add-entry
     form accepts an OPTIONAL manual per-1M input/output price pair.
   - Security copy: the unconditional "no proxies, no Ptah servers" line stays
     on the 8 built-in tiles; custom-entry cards get their own line naming the
     host the user typed.
   - Save & Test: for custom entries ONLY, perform one real round-trip with a
     trivial tool definition through the entry's declared lane, ~10s timeout.
     Built-in providers keep today's local-health behaviour (fixing that latent
     gap is out of scope here).
   - Base-URL validation: reuse the existing `http:`/`https:` scheme check.
     No loopback restriction (LAN vLLM/LiteLLM boxes are a stated use case).
     No redirect-chain/SSRF hardening in v1 — known gap, documented not built.
2. **TokenRouter preset is OUT of scope.** Its REST shape could not be verified
   from primary docs (three domains, 403 on the doc site, a `model:policy` slug
   that may not be OpenAI-standard). Shipping a preset we cannot verify would
   put our name on a broken tile. The generic custom path serves any TokenRouter
   user who has an account. Revisit when someone can confirm against a live key.
3. **Requesty preset is IN, lane 1** (Anthropic-compatible passthrough,
   `requiresProxy: false`, `baseUrl: https://router.requesty.ai`) — verified at
   `docs.requesty.ai/integrations/claude-code`. `keyPrefix: ''` — Requesty's own
   docs disagree on the prefix, so do not encode one.
4. **`AnthropicProviderId` stays as-is** (research option 1). It has 3
   references repo-wide, constrains nothing at runtime, and `AnthropicProvider.id`
   is already `string`. Provider ids cross boundaries as plain `string`, which is
   already the convention everywhere else.
5. **No new RPC prefix.** New methods land under the existing allowlisted
   `provider:` prefix, so only the compile-time `RpcMethodName` union changes.
   The dual-registration rule does not bite here.

## The shared-leaf constraint (read this before designing the merge)

`libs/shared` is a leaf with no file I/O — it cannot read
`~/.ptah/settings.json` itself. So the merge is a **module-level cache with a
setter**, not a read:

- `libs/shared/.../provider-registry.ts` gains an in-module
  `customProviderEntries` array, a `setCustomProviderEntries(entries)` mutator,
  and a `getAllAnthropicProviders()` accessor returning
  `[...ANTHROPIC_PROVIDERS, ...customProviderEntries]`.
- `getAnthropicProvider(id)` checks the static array first, then the custom
  cache.
- The **backend** owns population: read `provider.custom.entries` from settings
  at auth bootstrap and on config change, validate with the Zod schema, call
  the setter. Never call the setter from frontend code.

## Storage

`provider.custom.entries` — one JSON array in `~/.ptah/settings.json`, shape per
`research.md`. Non-secret metadata ONLY. API keys stay in
`AuthSecretsService.getProviderKey/setProviderKey`, which is already
`providerId: string`-keyed and needs no change. `lane: 'anthropic' | 'openai'`
is stored explicitly and maps to `requiresProxy` false/true — never re-derive
the lane from the URL shape.

## Batches

- **A — registry core.** `getAllAnthropicProviders()` + merge-aware
  `getAnthropicProvider` + Zod entry schema; fix the Zod-enum blocker at
  `auth-rpc.schema.ts:41`; convert the 7 direct `ANTHROPIC_PROVIDERS`
  enumerations (research Seam 1b) to the new accessor; generalize
  `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` + the `settings-core` sibling list so
  `thirdParty.<custom-id>` keys persist.
- **B — proxy lane.** Generic `CustomOpenAiTranslationProxy`; per-id proxy
  instance resolution in `ApiKeyStrategy` (replacing the hardcoded two-entry
  `proxyProviders` array). Read the Sakana subclass first — research flagged it
  as unread.
- **C — RPC + persistence.** `provider:{list,add,update,remove}CustomEntry`,
  the settings-backed store, the setter wiring, and the custom-entry
  test-connection probe.
- **D — webview.** Add/edit/delete form, `AuthStateService` CRUD, security copy.
- **E — Requesty preset.** Data-only registry entry.
- **F — TUI + CLI.** Ink add-custom flow; `provider custom add/remove/list`.
- **G — tests + verification.**

## Rules for every agent

- Work ONLY inside the task236 worktree. Never touch
  `D:\projects\ptah-extension\libs\...` (that is the other working tree).
- Do NOT run `npm install` — it is already running in this worktree.
- Do NOT commit. Leave changes in the working tree.
- `catch (error: unknown)`, narrow with `instanceof Error`. No `any`.
  No `@ts-ignore`. Zod at every external boundary.
- Angular: `ChangeDetectionStrategy.OnPush`, signals + `inject()`.
- Do not add backwards-compatibility shims for code you delete.
