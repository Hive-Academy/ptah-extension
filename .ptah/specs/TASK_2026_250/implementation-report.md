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
