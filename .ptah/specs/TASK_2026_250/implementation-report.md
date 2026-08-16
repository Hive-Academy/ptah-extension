# TASK_2026_250 — implementation report

**Scope**: A (documentation: state the pinned default as a choice) and B (the
cross-family `llm.vscode.model` read). Both taken. Every file touched is inside
`libs/backend/skill-synthesis/**`. Nothing committed.

---

## Files changed

| File                                                                                                  | Part                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.ts`                   | A + B                               |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`      | A (docblock only)                   |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/CLAUDE.md`                                   | A                                   |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.spec.ts`              | **new** — pins B                    |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.spec.ts` | two seeds updated (justified below) |

`JUDGE_DEFAULT_MODEL_ID` is unchanged. The off-limits assertion is unchanged in
content — it moved from line 116 to line 122 because a comment was added above
its neighbouring test, and it still reads
`expect(out.ok && out.lane.model).toBe(JUDGE_DEFAULT_MODEL_ID)`.

---

## The finding that makes A coherent, and it is a code fact rather than a wording choice

The reason the CLAUDE.md bullet reads as a contradiction is that it stated both
halves without the thing that distinguishes them. That thing exists and is
mechanical: **the two branches of `resolveLaneModel` run under different auth
envs, and the auth env is what decides whether a pinned dated Claude id is
dangerous.**

`ModelResolver.resolve` (`libs/backend/auth-providers/src/lib/auth/model-resolver.ts`):

- lines 38–48 — a `claude-*` id has its tier detected and is **replaced** by
  `env[ANTHROPIC_DEFAULT_<TIER>_MODEL]` when that key is populated;
- lines 77–86 — a bare tier alias falls through to `getDefaultTiers(env)`,
  which is derived from the provider identified by the env's base URL;
- line 36 — `const env = envOverride ?? this.authEnv`, so with **no** override
  the ambient chat auth env is used.

Now put the two branches against that:

- **Line 2 (`cfg.provider` empty → `resolveJudgeModel`)**: the resolver returns
  `null` for a blank provider id, `auth` is `undefined`, so the call rides the
  ambient chat env — where the active provider's
  `ANTHROPIC_DEFAULT_<TIER>_MODEL` values _are_ populated. A pinned
  `claude-haiku-…` id is therefore remapped to the user's own haiku-tier model,
  not sent raw. The pinned default is safe **on this branch specifically**.
- **Line 3 (`cfg.provider` set)**: the lane gets an override env whose chat
  `ANTHROPIC_DEFAULT_*_MODEL` keys are blanked by design (R2 — pinned by
  `lane-resolver.providers.spec.ts:46-53,139-153`, which asserts those keys are
  present-with-`undefined`). There is no tier mapping left for a pinned id to
  travel through, so it _would_ reach a non-Anthropic endpoint verbatim and
  404, and only a bare alias resolves.

Both original sentences were true. Neither was falsifiable as written because
the clause that separates them was missing. All three A edits now carry that
clause, and each states the pinned default as a decision with its own reason
plus a "do not re-file this" marker citing Decision 1.

---

## B — the evidence trail

### What `llm.vscode.model` actually is

- `apps/ptah-extension-vscode/package.json` at `096930b51^`, line 272:
  `"ptah.llm.vscode.model"`, default `"copilot/gpt-4o"`, described as
  _"Default model for the VS Code Language Model provider (vendor/family format)."_
- Its consumer was `VsCodeLmAdapter`, which matched the value against
  `vscode.lm.selectChatModels()` results on `` `${m.vendor}/${m.family}` ``.
- `096930b51` (_"refactor(vscode): remove vscode-lm from agent orchestration
  pipeline"_, Feb 2026) deleted that adapter, its spec, and the
  `affectsConfiguration('ptah.llm.vscode.model')` cache invalidation.

So the value is a `vendor/family` selector for the VS Code Language Model API,
belonging to a subsystem deleted six months ago.

### What happens if such a value reaches the lane

`ModelResolver.resolve('some-vendor/some-family')` matches none of its branches
— not the `claude-` prefix, not `'default'`, not a tier alias — and returns the
string unchanged at line 87. It is then sent verbatim to an
Anthropic-Messages-shaped endpoint. Same defect the carrier describes, one
layer up, exactly as Decision 2 states.

### Reachability — the honest version

The carrier's Decision 2 says "key set → a `copilot/…`-shaped id is sent". The
shipped default alone does **not** produce that, and I verified why:
`PtahFileSettingsManager.get` (`file-settings-manager.ts:83-91`) prefers a
**caller-supplied** default over the registered `FILE_BASED_SETTINGS_DEFAULTS`
entry, and all three workspace providers route file keys through it identically
(`vscode-workspace-provider.ts:75-85`, `electron-workspace-provider.ts:90-102`,
`cli-workspace-provider.ts:84-96`). The old call passed `''`, which shadowed
`'copilot/gpt-4o'`. So on a clean install the old code returned
`JUDGE_DEFAULT_MODEL_ID` and the branch behaved.

The key is still reachable with a real value, by two routes:

1. It was a `package.json contributes.configuration` entry until `096930b51`, so
   any user who ever picked a VS Code LM model has a value persisted.
2. `agent-sdk/src/lib/types/settings-export.types.ts:68` still lists
   `llm.vscode.model` in `KNOWN_CONFIG_KEYS`, so settings **export/import**
   round-trips it onto new machines.

Verdict: latent-but-real, not "live on every install". I am recording that
rather than overstating it, because it changes what the fix buys — the fix's
main value is that the branch now reads a key which _has_ a live writer and
which belongs to the endpoint this branch actually rides.

### What the configured branch should read — and what I ruled out

The branch is only reached when the lane names **no** provider, i.e. the work
rides the user's **active chat provider**. The only model id known to be
servable there is the one that provider is already serving.

| Candidate                                             | Verdict                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm.vscode.model`                                    | **Rejected.** Wrong provider family; consumer deleted `096930b51`; no writer in the product.                                                                                                                                                                                  |
| `model.selected`                                      | **Rejected.** Deprecated and actively _deleted_ by `runV2Migration` (`settings-core/src/migrations/v2-migration.ts:42-57`), which moves it to `provider.<authKey>.selectedModel`. Reading it would return empty on every migrated install — a fix that silently does nothing. |
| `llm.defaultProvider`                                 | **Rejected.** A provider id, not a model, and it belongs to the `ptah.llm.*` MCP tools (`rpc-handlers/.../llm-rpc-app.handlers.ts:279,502,536`).                                                                                                                              |
| Drop the read, always return `JUDGE_DEFAULT_MODEL_ID` | **Rejected.** Contradicts Decision 1's _first_ half ("inherit the workspace-pinned model, else …") and would break `lane-resolver.service.spec.ts`'s workspace-pinned case, which the carrier explicitly wants preserved.                                                     |
| **`provider.<authKey>.selectedModel`**                | **Chosen.**                                                                                                                                                                                                                                                                   |

Why the chosen key is the right one, established from code:

- `settings-core/src/repositories/model-settings.ts:12-53` documents it as
  _"Model identifier for the currently-active provider. Empty = use provider
  default"_, and computes the key as
  `` `provider.${resolveAuthProviderKey(authMethod, anthropicProviderId)}.selectedModel` ``.
  My implementation composes it the same way, from the same
  `resolveAuthProviderKey` helper (`platform-core/src/settings-auth-key.ts:12`),
  so the two cannot disagree about which provider is active.
- It is file-routed for built-ins (`file-settings-keys.ts:363-366`) **and** for
  user-defined providers (`PROVIDER_AUTH_MODEL_PATTERN`, line 634), so the read
  works for custom entries too.
- Empty means "use provider default", which maps exactly onto Decision 1's
  hard constraint: empty ⇒ `JUDGE_DEFAULT_MODEL_ID`.

### The two constraints the task set, and how each is met

- **Nothing-configured still returns `JUDGE_DEFAULT_MODEL_ID`.** Held. Pinned by
  three tests in the new spec and by the untouched
  `lane-resolver.service.spec.ts:122`.
- **No named provider id introduced into this path.** Held. The new code
  contains zero provider-id literals — it reads `authMethod` and
  `anthropicProviderId` from settings and delegates key composition to
  `resolveAuthProviderKey`. The one literal added is `'apiKey'`, an auth
  **method**, restated from `AUTH_METHOD_DEF.default` and matching
  `runV2Migration`'s own `authMethod || 'apiKey'`. The
  `lane-resolver.providers.spec.ts` source scan (which reads
  `LaneResolverService.prototype.{resolve,readConfig,readConfigs}`) still passes.

### One subtlety the new code encodes deliberately

`readSetting` passes **no** `defaultValue`. Passing `''` would shadow the host's
registered `FILE_BASED_SETTINGS_DEFAULTS` value for `authMethod` /
`anthropicProviderId` (the `file-settings-manager.ts:83-91` precedence above) and
make this path disagree with the chat path about which provider is active. That
is the same trap that hid the old key's shipped default, so it is pinned by its
own test and documented in both the docblock and CLAUDE.md.

---

## Existing specs changed, and why the old assertions were wrong

Two seeds in `lane-resolver.service.spec.ts` (lines 99 and 134 pre-change):

- `makeWorkspace({ 'llm.vscode.model': 'workspace-pinned-model' })` →
  `{ 'provider.apiKey.selectedModel': 'workspace-pinned-model' }`
- `makeWorkspace({ 'llm.vscode.model': 'legacy-model' })` →
  `{ 'provider.apiKey.selectedModel': 'active-provider-model' }`

Both encoded the defect rather than a contract. The _contract_ is "a blank lane
inherits the workspace-pinned model"; the **key** those seeds named is a VS Code
Language Model `vendor/family` selector belonging to a deleted subsystem, so
they asserted that a value from one provider family flows through to another
family's endpoint. Both assertions survive semantically — the same value still
flows through — and only the key that carries it changed. Two test titles were
updated to say "active provider's model" instead of "legacy model", since
"legacy" was describing the dead key.

`lane-resolver.service.spec.ts:116` (now :122) was not touched.

---

## Mutation test — exact counts

Method: `git stash push -- .../model-resolver.ts` (reverting **only** the
production change, keeping all specs), run the two suites, restore, re-run.

**Reverted (old `llm.vscode.model` read), `model-resolver.spec.ts` + `lane-resolver.service.spec.ts`:**

```
Test Suites: 2 failed, 2 total
Tests:       18 failed, 26 passed, 44 total
```

The 18 failures:

| Count | Test                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `reads provider.apiKey.selectedModel under the default auth method`                                                                                                                                                                                                             |
| 1     | `reads the auth method the user actually configured`                                                                                                                                                                                                                            |
| 12    | `reads provider.thirdParty.<id>.selectedModel when that provider is active` — one per `ANTHROPIC_PROVIDERS` entry (`claude-cli`, `github-copilot`, `lm-studio`, `moonshot`, `ollama`, `ollama-cloud`, `openai-codex`, `openrouter`, `requesty`, `sakana`, `z-ai`, and one more) |
| 1     | `ignores llm.vscode.model entirely`                                                                                                                                                                                                                                             |
| 1     | `prefers the active provider's model over a stale llm.vscode.model`                                                                                                                                                                                                             |
| 1     | `passes NO defaultValue on any settings read`                                                                                                                                                                                                                                   |
| 1     | `LaneResolverService.resolve … resolves a fully blank lane to {auth: undefined} and the active provider's model`                                                                                                                                                                |
| 1     | `resolveLaneModel … inherits the ACTIVE PROVIDER's model when NEITHER provider nor model is set`                                                                                                                                                                                |

**Restored:**

```
Test Suites: 3 passed, 3 total
Tests:       146 passed, 146 total
```

(3 suites because the restored run's pattern also picked up
`lane-resolver.providers.spec.ts`, which passes in both states — it is
unaffected by this change, which is itself the point.)

Four tests in the new spec are regression guards rather than mutation-proved
ones, and I am naming them rather than implying otherwise: `returns the pinned
JUDGE_DEFAULT_MODEL_ID when nothing is configured`, `returns it for an empty
selected model`, `returns it rather than throwing when the settings read fails`,
and `returns any non-inherit value as-is`. They pass before _and_ after by
design — they exist to pin Decision 1's hard constraint against a future edit,
not to prove this one.

---

## Gate

`npx nx run-many -t test lint typecheck -p skill-synthesis` — **all three
targets succeeded.**

```
> nx run @ptah-extension/skill-synthesis:lint
✖ 30 problems (0 errors, 30 warnings)

> nx run @ptah-extension/skill-synthesis:typecheck
> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
(clean, no output)

> nx run @ptah-extension/skill-synthesis:test
Test Suites: 6 skipped, 62 passed, 62 of 68 total
Tests:       37 skipped, 1252 passed, 1289 total
Time:        33.821 s

NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/skill-synthesis
```

The 30 lint warnings are pre-existing (`no-explicit-any` and unused
`eslint-disable` directives in `queue/`, `gates/` and
`spec-harvester.concurrent-attribution.spec.ts`). Re-running lint filtered to
`model-resolver` / `lane-resolver` returns **zero** lines, so none of the 30 is
in a file I touched. Suite count rose 67 → 68 with the new spec; test count rose
by 20 (the new spec's 19 cases plus the registry-non-empty guard).

---

## Found, deliberately not fixed

1. **`llm.vscode.model` is now an entirely dead key** — no reader anywhere in
   the product after this change, no writer since `096930b51`. It still occupies
   `platform-core/src/file-settings-keys.ts:158` + `:386` (with the shipped
   `copilot/gpt-4o` default) and `agent-sdk/.../settings-export.types.ts:68`,
   so settings export/import keeps carrying it between machines. Removing it is
   a three-file change in `platform-core` and `agent-sdk` — outside this task's
   directory, and `platform-core` has unrelated in-flight work from another
   session. It is inert where it now sits; the only cost is that a stale value
   keeps propagating for no reason. Worth its own carrier.
2. **`FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId'] = 'openrouter'`
   (`file-settings-keys.ts:384`) disagrees with `ANTHROPIC_PROVIDER_ID_DEF.default = ''`
   (`settings-core/src/schema/auth-schema.ts:22`).** Harmless on this path — the
   value is only consulted when `authMethod === 'thirdParty'`, in which case the
   UI has set both — but the two stores answer differently for an install that
   set neither. Outside `skill-synthesis`, and not something this task's tests
   can pin.
3. **The `catch { }` in `resolveJudgeModel` stays unbound.** The repo rule is
   `catch (error: unknown)` narrowed with `instanceof Error`; here there is
   nothing to narrow _to_ — the fallback is unconditional and binding the error
   would trip `no-unused-vars`. Pre-existing shape, left alone.

---

# Follow-up — review findings

Applied on top of `8a578c124` as a new working-tree change; no history rewritten,
nothing committed. All three items were accuracy defects in prose I wrote. No
production logic changed — `model-resolver.ts`'s executable body is
byte-identical to what landed, and the fallback is untouched per Decision 1.

## Files changed in this follow-up

| File                                                                                             | Item                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.ts`              | 1 + 3 (docblock only)          |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts` | 3 (docblock only)              |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/CLAUDE.md`                              | 1 + 2 + 3                      |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts` | 2 (harness seam + 4 new cases) |

---

## Item 1 — the false reachability claim. Confirmed and corrected.

The review is right. `skill-enhancer.service.ts:690` calls `resolveJudgeModel`
directly and passes the result to `internalQuery.execute` at `:740-746` with no
`auth` field. It is not a lane, so "only reached on the branch where the lane
names NO provider" was false.

The docblock now names **both** callers and states what actually unites them —
the auth env, not the lane: `resolveLaneModel` carries no `auth` because the
resolver returns `null` for a blank provider id, and `generateCandidate` carries
no `auth` because it never sets one. Both therefore run under the ambient chat
env, which is the premise the rest of the docblock reasons from. That premise
survives; only the reachability claim was wrong, and the correction makes the
docblock's blast radius honest.

---

## Item 2 — the unnamed existing-install behaviour change, now named and pinned

Correct, and my original blast-radius section did scope the wrong symbol — it
traced `JUDGE_DEFAULT_MODEL_ID`'s consumers (from the carrier) rather than
`resolveJudgeModel`'s callers. Skill/agent/command **enhancement** read
`llm.vscode.model` before the change and reads
`provider.<authKey>.selectedModel` after it, so any install where the two
diverge sees enhancement calls change model. Now stated in `CLAUDE.md` as its
own bullet and in the `model-resolver.ts` docblock.

The spec is added. `makeHarness` gained one option —
`configSeed?: Record<string, string>`, with `getConfiguration` reading
`opts.configSeed?.[key] ?? ''` so every pre-existing case (which relied on a
flat `''`) is unchanged. Four cases in a new
`enhance: the model handed to InternalQuery (TASK_2026_250)` block.

### The mutation test caught my own spec being vacuous — worth recording

The first run of these cases against the pre-change resolver returned **1
failed, 2 passed** where I expected 2 failures. Rather than accept the count I
traced it, and the cause was a real defect in my test fixtures:

`makeSettings()` defaults `judgeModel` to the literal
`'claude-haiku-4-5-20251001'` (`skill-enhancer.service.spec.ts:50`). That is an
**explicit** model, so `resolveJudgeModel` returns it on its first line and
reads no setting at all — the inherit path was never entered. Worse, that
literal is **also** the value of `JUDGE_DEFAULT_MODEL_ID`, so two of my three
assertions compared the right string for entirely the wrong reason and would
have passed against any implementation, including one that read nothing.

Fixed by having the helper pass `makeSettings({ judgeModel: 'inherit' })`, and I
added a fourth case (`sends an EXPLICIT judgeModel verbatim, consulting no
setting`) so the `'inherit'` argument is load-bearing rather than decorative.
The trap is documented in a comment above the helper, because the coincidence
between the fixture default and `JUDGE_DEFAULT_MODEL_ID` will re-arm it for the
next person.

### Mutation result after the fixture fix

Method: `git show 8a578c124^:…/model-resolver.ts >` the working file (reverting
only the production change), run the block, restore.

**Against the pre-change resolver:**

```
Tests: 2 failed, 58 skipped, 2 passed, 62 total
```

| Test                                                                                | Reverted result                                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `passes resolveJudgeModel's output through unchanged — the active provider's model` | **FAIL** — expected `active-chat-model`, received `claude-haiku-4-5-20251001` (old code never reads `selectedModel`) |
| `does not read the dead VS Code LM key even when it holds a value`                  | **FAIL** — expected `claude-haiku-4-5-20251001`, received `some-vendor/some-family`                                  |
| `falls back to the shipped judge default when nothing is pinned`                    | passes both ways — regression guard                                                                                  |
| `sends an EXPLICIT judgeModel verbatim, consulting no setting`                      | passes both ways — guard for the fixture trap above                                                                  |

The second failure is the useful one: it demonstrates the cross-family defect
**live on the enhancer path**, with a `vendor/family` string reaching
`internalQuery.execute` as the model. That is the first evidence in this task
that the defect was reachable somewhere other than the lane.

---

## Item 3 — verified independently. The coordinator's reading is directionally right and materially wrong.

I checked both claims before writing, as instructed.

### `applyPersistedTiers`'s guard — CONFIRMED as described

`libs/backend/auth-providers/src/lib/provider-models.service.ts`:

```ts
effectiveTiers[tier] = userTiers[key] ?? providerDefaults[key];
// ...
const value = effectiveTiers[tier];
if (value) {
  this.authEnv[envKey] = value;
  process.env[envKey] = value;
```

No user override and no provider default ⇒ `ANTHROPIC_DEFAULT_HAIKU_MODEL` is
never written. And `ModelResolver.resolve`'s `claude-*` branch consults **only**
that env var — it does not fall through to `getDefaultTiers` — so the pinned id
is returned unchanged. The mechanism of the hole is exactly as stated.

### The registry — the coordinator's count is wrong, and the correction matters

> "`ANTHROPIC_PROVIDERS` has exactly three entries … only `moonshot` and `z-ai`
> define `defaultTiers` … still live for one provider in three"

That reads only the three **inline** entries at `:178-295`. Lines `:464-471` add
eight more by imported constant (`COPILOT_PROVIDER_ENTRY`,
`CODEX_PROVIDER_ENTRY`, `OLLAMA_PROVIDER_ENTRY`, `OLLAMA_CLOUD_PROVIDER_ENTRY`,
`LM_STUDIO_PROVIDER_ENTRY`, `CLAUDE_CLI_PROVIDER_ENTRY`, `SAKANA_PROVIDER_ENTRY`,
`REQUESTY_PROVIDER_ENTRY`), matching the 11-member `AnthropicProviderId` union at
`:478-489`. My own committed spec already generated 11 parameterized cases, which
is what flagged the discrepancy.

I enumerated `defaultTiers` at runtime rather than by grep (throwaway probe spec,
since deleted), because eight entries live in other files:

| Provider         | `defaultTiers.haiku`              |
| ---------------- | --------------------------------- |
| `openrouter`     | **absent**                        |
| `moonshot`       | `kimi-k2.5`                       |
| `z-ai`           | `glm-4.7-flashx`                  |
| `github-copilot` | `gpt-5-mini`                      |
| `openai-codex`   | `gpt-5.1-codex-mini`              |
| `ollama`         | `qwen3:8b`                        |
| `ollama-cloud`   | `ministral-3:cloud`               |
| `lm-studio`      | **absent**                        |
| `claude-cli`     | `claude-haiku-4-5` (`nativeAuth`) |
| `sakana`         | `fugu`                            |
| `requesty`       | **absent**                        |

So the exposure is **three of eleven** — `openrouter`, `lm-studio`, `requesty` —
not one of three. The conclusion holds and the finding is real; the arithmetic in
the brief does not.

Two refinements the coordinator's framing missed, both narrowing the hazard:

- **`claude-cli` and direct Anthropic (`authMethod: 'apiKey'`) are not exposed.**
  `claude-cli` is `nativeAuth`, which deliberately produces an _empty_ auth env —
  no tier overrides at all — but its endpoint **is** Anthropic, so
  `claude-haiku-4-5-20251001` verbatim is correct, not a 404. Listing every
  tier-env-less path as a hazard would have been the same overclaiming in
  reverse.
- **The second failure mode is orthogonal to the registry.** Even a provider that
  _does_ declare `defaultTiers` is exposed if `applyPersistedTiers` has not run
  for it. Its own doc says "call this during authentication setup when a provider
  is active"; whether every auth path invokes it is untraced, and I have recorded
  it as untraced rather than assumed either way.

`openrouter` being both `DEFAULT_PROVIDER_ID` (`provider-registry.ts:492`) and the
registered `FILE_BASED_SETTINGS_DEFAULTS` value for `anthropicProviderId` makes it
the likeliest configuration, not a corner — so the boundary is stated in that
tone.

### What I wrote, and what I did not do

Per instruction the fallback is **unchanged** — Decision 1 is the user's and I am
not authorised to switch to a tier alias. All three prose sites now state the
guarantee with its boundary attached:

- `model-resolver.ts` gained a section _"The boundary of that remapping — it does
  NOT cover every provider"_, naming the two failure modes, the three providers,
  and the two unaffected auth paths, and closing with the two options for closing
  the gap (give those entries a `defaultTiers`, or revisit Decision 1) marked as
  the user's call.
- `lane-resolver.service.ts`'s line-2 bullet now says the substitution holds
  "only where that provider's tier env is populated at all, which is not every
  provider" and points at the full statement.
- `CLAUDE.md` carries the same, with an explicit **"do not quote the previous
  sentence without this one"** — the failure mode being that the reassuring half
  travels and the caveat does not, which is how this bullet became misleading in
  the first place.

---

## Gate (re-run, `--skip-nx-cache`)

```
> nx run @ptah-extension/skill-synthesis:lint
✖ 30 problems (0 errors, 30 warnings)

> nx run @ptah-extension/skill-synthesis:typecheck
> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
(clean, no output)

> nx run @ptah-extension/skill-synthesis:test
Test Suites: 6 skipped, 62 passed, 62 of 68 total
Tests:       37 skipped, 1256 passed, 1293 total

NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/skill-synthesis
```

Tests went 1252 → 1256 passed (1289 → 1293 total): the four new enhancer cases.
Suite count unchanged at 68 — the cases joined an existing file. Lint holds at 0
errors / 30 warnings, the identical pre-existing set; filtering lint output to
`model-resolver`, `lane-resolver` and `skill-enhancer` returns nothing, so none
of the 30 is in a file this follow-up touched.

---

## Follow-up's own "found, not fixed"

1. **The residual hazard from item 3 is documented, not closed.** `openrouter`,
   `lm-studio` and `requesty` still send `claude-haiku-4-5-20251001` verbatim on
   the nothing-configured path. Closing it is a registry change in `libs/shared`
   (add `defaultTiers` to three entries) or a reversal of Decision 1 — the first
   is outside `skill-synthesis` and needs someone who knows the right model ids
   for those routers; the second is the user's. Worth its own carrier, and it is
   the single highest-value thing left in this area.
2. **`applyPersistedTiers` invocation coverage is untraced.** Whether every
   provider auth-setup path calls it decides whether failure mode 2 is
   theoretical or live. Not traced here — it is `auth-providers` territory and
   this task may not edit it.
3. **`makeSettings()`'s `judgeModel` default equals `JUDGE_DEFAULT_MODEL_ID`.**
   Left as-is (changing a shared fixture default would touch ~60 unrelated cases)
   but now commented at the one place it misleads. Any future test asserting on
   the enhancer's model must pass `judgeModel: 'inherit'` explicitly or it
   asserts nothing.
4. **The review's Finding 4 (`providerSelectedModelDef`'s Zod shape) — checked.**
   `provider-schema.ts:60-72` defines the key as
   `provider.<authKey>.selectedModel` with `default: ''` and
   `MODEL_SELECTED_SCHEMA`. It confirms the key template I compose and changes
   nothing; `readSetting`'s `typeof raw === 'string'` guard is defensive either
   way. No action.
5. **The review's Finding 5 (provider-literal scan does not cover free
   functions) — confirmed, unchanged.** `lane-resolver.providers.spec.ts` scans
   `LaneResolverService.prototype` methods only, so neither `resolveLaneModel`
   nor `resolveJudgeModel` is covered. Pre-existing and not a regression; both
   contain zero provider-id literals today. Widening the scan is a real
   improvement but is scope this task was told not to take.
