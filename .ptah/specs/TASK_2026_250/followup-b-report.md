# TASK_2026_250 — follow-up track B report

Scope: items 1 and 2 of the implementation report's "Found, deliberately not
fixed". Built on top of `8a578c124` and `f1c4bebc3`. **Nothing committed** —
all changes are in the working tree.

**Outcome in one line:** item 1 done (dead key removed from all three sites);
item 2 **deliberately not changed**, because the trace showed the premise was
wrong and the change has real blast radius — pinned with a cross-lib contract
spec instead.

---

## Files changed

| File                                                                                                                     | Item | Kind                     |
| ------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------ |
| `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.ts`                                        | 1    | production — 2 deletions |
| `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`                               | 1    | production — 1 deletion  |
| `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.spec.ts`                                   | 1    | +5 tests                 |
| `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-manager.spec.ts`                                | 1    | +2 tests                 |
| `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/types/settings-export.types.spec.ts`                          | 1    | **new** — 4 tests        |
| `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/__contracts__/anthropic-provider-id-default.contract.spec.ts` | 2    | **new** — 3 tests        |

The entire production diff is three deleted lines:

```
libs/backend/platform-core/src/file-settings-keys.ts
-  'llm.vscode.model',                        (FILE_BASED_SETTINGS_KEYS)
-  'llm.vscode.model': 'copilot/gpt-4o',      (FILE_BASED_SETTINGS_DEFAULTS)

libs/backend/agent-sdk/src/lib/types/settings-export.types.ts
-  'llm.vscode.model',                        (KNOWN_CONFIG_KEYS)
```

No file in `libs/shared/src/lib/providers/**`, `libs/backend/auth-providers/**`
or `libs/backend/skill-synthesis/**` was touched. `provider-registry.ts` was
read only. `platform-core/src/content-download.service.ts` was not opened.

---

# Item 1 — remove the dead `llm.vscode.model` key

## The "no readers" claim — verified, and it holds

I ran a tracked-file search across every extension, not just `.ts`
(`git grep -n "llm\.vscode\.model" -- . ':!.ptah'`). Complete result set:

| Site                                                                           | Kind                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `libs/backend/platform-core/src/file-settings-keys.ts:158`                     | registry entry (removed)                        |
| `libs/backend/platform-core/src/file-settings-keys.ts:386`                     | registry default (removed)                      |
| `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:68`             | export key list (removed)                       |
| `libs/backend/skill-synthesis/src/lib/model-resolver.spec.ts:29,106,123`       | **negative** assertions — "ignores it entirely" |
| `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts:366,421`  | negative assertion + historical note            |
| `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.spec.ts:101` | comment                                         |
| `libs/backend/skill-synthesis/src/lib/model-resolver.ts:62`, `CLAUDE.md:78`    | prose                                           |

Zero production readers. Everything in `skill-synthesis` asserts the key is
**not** read — those specs are `8a578c124`'s own work and pass unchanged.

`package.json contributes.configuration` checked programmatically rather than by
grep, since the key could have been nested: `apps/ptah-extension-vscode/package.json`
declares 14 configuration keys, and `ptah.llm.vscode.model` is **not** among them
(the only `/vscode|llm|model/`-matching key is `ptah.model.selected`). Consistent
with `096930b51` having removed it along with `VsCodeLmAdapter`.

## Correction to the brief: export/import does **not** round-trip this value

The brief and the original report both state that `KNOWN_CONFIG_KEYS` membership
means settings export/import "keeps round-tripping a stale value between
machines". **The import half of that is false, and I am correcting it rather
than inheriting it.**

`SettingsImportService.importSettings`
(`libs/backend/agent-sdk/src/lib/settings-import.service.ts:111-119`) never
applies config at all:

```ts
if (data.config && Object.keys(data.config).length > 0) {
  const configKeys = Object.keys(data.config);
  for (const key of configKeys) {
    result.skipped.push(`config:${key} (config import not supported)`);
  }
```

Its file header says why: "Config values are not imported because
IWorkspaceProvider is read-only". It is the only import path — the CLI
(`apps/ptah-cli/src/cli/commands/settings.ts:164`) and the RPC handler
(`rpc-handlers/.../settings-rpc.handlers.ts:258`) both delegate to it.

So a stale `llm.vscode.model` **cannot** land on a new machine.

**What the key actually did is still real, and is the export half.**
`SettingsExportService.collectConfigValues`
(`libs/backend/agent-sdk/src/lib/settings-export.service.ts:140-148`) reads each
key with **no caller default**:

```ts
const value = this.workspaceProvider.getConfiguration<unknown>('ptah', key);
if (value !== undefined) {
  config[key] = value;
}
```

All three adapters forward that missing default straight into the file store —
e.g. `platform-vscode/src/implementations/vscode-workspace-provider.ts:80-82`:
`return this.fileSettings.get<T>(key, defaultValue);`. With `defaultValue`
undefined, `PtahFileSettingsManager.get` falls through to the registered default
(`file-settings-manager.ts:83-91`).

Net effect before this change: **every export file, including one taken from a
clean install by a user who never heard of the VS Code Language Model API,
contained `"llm.vscode.model": "copilot/gpt-4o"`.** The `if (value !== undefined)`
guard, whose stated intent is "only export explicitly set config", was defeated
by the registered default. That is a smaller claim than "round-trips between
machines" but it is a true one, and it is what the removal fixes.

## The migration question — answered: let it lapse. No migration needed.

`settings-core/src/migrations/` contains `v1`, `v2`, `v3`, `v4` plus a runner.
I read all four. **There is no precedent for a removal migration, and the
established pattern is that a key only gets touched when its value must be
MOVED:**

- `v2-migration.ts:53-63` — deletes `model.selected` / `reasoningEffort`, but
  only after `setNested(...)` has written them to
  `provider.<authKey>.selectedModel` / `.reasoningEffort`. The delete is the
  second half of a move, not a cleanup.
- `v3-migration.ts:79-84` — same shape: writes the four gateway token ciphers
  into `secrets.enc.json` via `secretsStore.write`, _then_ `deleteNestedKey`.
- `v4-migration.ts` — writes a marker key only; deletes nothing.
- Every migration early-returns when there is nothing to move
  (`v2:48-50`, `v3:73-75`).

No migration in the repo exists purely to delete an obsolete key. So dropping
`llm.vscode.model` silently **is** the established pattern, and inventing a
migration would be the deviation.

Why letting it lapse is safe, not just conventional: `~/.ptah/settings.json` is
a plain JSON document. `FILE_BASED_SETTINGS_KEYS` gates **routing**, not parsing
— an existing install that carries the key keeps it on disk and can still read
it back. I pinned that explicitly rather than asserting it in prose:
`file-settings-manager.spec.ts` → _"still reads back a stale llm.vscode.model
already on disk"_. Nothing is pruned or rewritten on upgrade; the value simply
becomes inert, which it already was.

The one behaviour that changes for an existing install is the intended one: a
read with no caller default now returns `undefined` instead of
`'copilot/gpt-4o'`, so the value stops being injected into exports.

## Consistency guard that made the removal safe

`file-settings-keys.spec.ts:163-167` already asserts _"every key in
FILE_BASED_SETTINGS_DEFAULTS is also in FILE_BASED_SETTINGS_KEYS"_. Removing from
only one table would have gone red. No spec anywhere hardcodes a count or size
for either table or for `KNOWN_CONFIG_KEYS` (checked:
the only assertions are `FILE_BASED_SETTINGS_KEYS.size > 0` at
`file-settings-keys.spec.ts:170` and `file-settings-manager.spec.ts:159`).

## One spec I wrote caught something and was narrowed rather than weakened

The guard _"leaves no vendor/family-shaped chat-model default behind"_ failed on
first run, flagging `memory.embeddingModel` = `'Xenova/bge-small-en-v1.5'`
(`file-settings-keys.ts:441`). That is a **HuggingFace repo id for a locally
executed embedding model**, not a provider-routed chat selector — different
namespace, no endpoint to mismatch. I allow-listed it by name with that
reasoning in the docblock rather than loosening the pattern, so the guard still
catches a re-pinned cross-vendor chat id.

---

# Item 2 — the `anthropicProviderId` default mismatch

## Decision: **leave it.** Both literals unchanged. Pinned with a contract spec.

## What the trace actually found — the brief's premise does not hold

The brief says "Two stores answer differently for an install that set neither."
They do not. **The `settings-core` default is unreachable in production.**

Every real read bottoms out in `PtahFileSettingsManager.get(key)` with **no
caller default**, because all three `ISettingsStore.readGlobal` adapters drop the
argument:

- `platform-cli/src/settings/file-settings-store.ts:42-44` — `readGlobal<T>(key) { return this.fileSettings.get<T>(key); }`
- `platform-electron/src/settings/file-settings-store.ts:36-38` — identical
- `platform-vscode/src/settings/vscode-settings-adapter.ts:70-75` — identical

and `WorkspaceScopeResolver.read` has **no `defaultValue` parameter at all**
(`settings-core/src/scope/workspace-scope-resolver.ts:109-116`). So the lookup
order in `file-settings-manager.ts:83-91` reaches
`FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId']` = `'openrouter'` every
time, and `ANTHROPIC_PROVIDER_ID_DEF.default = ''` (`auth-schema.ts:22`) never
speaks. Even `BaseRepository`'s `parsed.success ? parsed.data : def.default`
(`settings-core/src/repositories/base-repository.ts:34-38`) cannot reach it —
`'openrouter'` parses cleanly as `z.string()`.

**Consequence: every `?? ''` and `?? DEFAULT_PROVIDER_ID` guard downstream is
dead code on a real install** — `active-provider-resolver.ts:38-41` and `:66-73`,
`auth-rpc.handlers.ts:394-397` and `:920-922`,
`settings-core/src/repositories/model-settings.ts:37-41`, `reasoning-settings.ts:37-41`.

So the two stores are not in conflict; one of them is simply never asked.

## `provider-registry.ts:492` is not a third answer — it is the same answer

`DEFAULT_PROVIDER_ID: AnthropicProviderId = 'openrouter'`
(`libs/shared/src/lib/providers/provider-registry.ts:491-492`) — **identical
value** to the file-settings default. The brief's suggestion that it "may be the
intended single source of truth for both" is right in spirit, and the two agree
today. But they agree **by coincidence of two independent literals**, not by
construction, and the file default is consulted **first**. That is the real
latent defect, and it is not the one the brief named.

## Why changing the literal to `''` is riskier than the inconsistency

This is the load-bearing finding. **The consumers use `??` (nullish), not `||`
(falsy).** `'' ?? DEFAULT_PROVIDER_ID` is `''`, not `'openrouter'`. So flipping
`FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId']` to `''` is **not** a no-op
that merely aligns two tables — it changes runtime behaviour in two places:

1. **`ActiveProviderResolver.resolveThirdPartyProviderId()`**
   (`auth-providers/src/lib/auth/active-provider-resolver.ts:37-42`) starts
   returning `''` instead of `'openrouter'` for any `thirdParty` install with no
   provider id set. Downstream, `effective-route.ts:109-120` normalises `''` to
   `null` → blocker `'no provider selected'`.
2. **`resolveAuthProviderKey('thirdParty', '')`**
   (`platform-core/src/settings-auth-key.ts:16-21`) returns
   `thirdParty.unknown` instead of `thirdParty.openrouter`, moving the
   per-provider settings bucket. Any stored
   `provider.thirdParty.openrouter.selectedModel` / `.reasoningEffort` for such
   an install would be **orphaned** — read from a key nothing ever wrote.

That is precisely the "repoints which provider's credentials and selected model
are read" hazard the brief warned about, and the trace confirms it is real
rather than theoretical. Meanwhile the _cost_ of leaving it is nil for a default
install: `FILE_BASED_SETTINGS_DEFAULTS['authMethod']` is `'apiKey'`
(`file-settings-keys.ts:383`), so `resolveAuthProviderKey` returns `'apiKey'`
verbatim and never consults the provider id at all;
`ActiveProviderResolver` short-circuits to `ANTHROPIC_DIRECT_PROVIDER_ID`
(`'anthropic'`) at `active-provider-resolver.ts:30-32`. The mismatch is latent,
reachable only via `authMethod === 'thirdParty'` **and** an unset provider id —
a state the auth UI does not produce, since it writes both together
(`auth-rpc.handlers.ts:409-421`).

**Risk of changing ≫ cost of leaving. Left unchanged.**

## Prior art the brief did not mention — and where this decision belongs

`docs/handoff-cli-tooluse-dispatch-bug.md:189` led me to commit **`2cf4390e0`**
on branch **`fix/claude-cli-default-model`** — _"fix(cli): default
anthropicProviderId to '' not 'openrouter'"_. It is **exactly this change**, a
one-line edit to `file-settings-keys.ts`, dated 2026-06-14. I verified with
`git merge-base --is-ancestor`: it is **not** in `HEAD`, and `git branch
--contains` shows it exists only on that branch. The handoff doc records its PR
as pending.

Its commit message argues from convention and from `doctor` noise, and asserts
"the runtime `DEFAULT_PROVIDER_ID` fallback still covers cases that need a
concrete provider." **That last clause is the part my trace contradicts** — the
`??` fallbacks do not fire for `''`. So the branch as it stands would change
`thirdParty` behaviour without the accompanying consumer changes.

I have deliberately **not** duplicated, cherry-picked, or pre-empted that
branch. The decision belongs on that PR, with this trace attached.

## What I did instead — a coupling contract with zero behaviour change

New file:
`D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/__contracts__/anthropic-provider-id-default.contract.spec.ts`

It asserts `FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId'] === DEFAULT_PROVIDER_ID`,
that the value is a non-empty string (the `??`-vs-`||` trap), and that
`authMethod` still ships `'apiKey'` (which is what keeps the mismatch latent).

**Why `agent-sdk` and not `platform-core`:** `platform-core` is the leaf every
backend lib depends on — its CLAUDE.md says _"Never import other backend libs
from here"_ — so it cannot import `@ptah-extension/shared` to see
`DEFAULT_PROVIDER_ID`. That is the same constraint that forced the
literal-restatement tables at `file-settings-keys.spec.ts:334-357`. `agent-sdk`
depends on both sides and already re-exports `DEFAULT_PROVIDER_ID`
(`agent-sdk/src/index.ts:146`), so it is the nearest lib that may legally hold
both — mirroring how `rpc-handlers` owns the cross-lib equality for the
skill-synthesis lane keys. It also sits inside the required gate.

This converts "two literals that agree by luck" into "two literals pinned to
agree", closes the real hazard, and changes no behaviour. The trace found this
coupling is **completely untested today in both directions**: no spec anywhere
asserts `FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId']`, and the two
closest tests
(`active-provider-resolver.spec.ts:54-60`, `auth-manager.spec.ts:424-443`) both
use stubbed scope resolvers returning `undefined`, so they exercise the
`?? DEFAULT_PROVIDER_ID` branch production never reaches.

---

# Mutation tests — exact counts

Method: revert **only** the production change (keeping every spec), run, restore,
re-run. Production files were restored from a byte copy and the diff re-verified
afterwards.

## Item 1 — `platform-core` (revert both deletions)

```
Test Suites: 2 failed, 27 passed, 29 total
Tests:       5 failed, 4 todo, 509 passed, 518 total
```

The 5 failures — all 5 are the assertions the change exists for:

| Spec                            | Test                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `file-settings-keys.spec.ts`    | is absent from `FILE_BASED_SETTINGS_KEYS`                              |
| `file-settings-keys.spec.ts`    | declares no default, so an unset read yields undefined not a model id  |
| `file-settings-keys.spec.ts`    | no longer routes to file-based storage                                 |
| `file-settings-keys.spec.ts`    | leaves no vendor/family-shaped chat-model default behind               |
| `file-settings-manager.spec.ts` | yields undefined for the removed `llm.vscode.model` on a clean install |

**2 of the 7 added `platform-core` tests pass both ways and I am naming them
rather than implying otherwise**: _"leaves the live llm.defaultProvider key
untouched"_ (a scope guard — proves the sibling `ptah.llm.*` key was not swept
up) and _"still reads back a stale llm.vscode.model already on disk"_ (the
migration-story guard — it must pass in both states, that is its point).

## Item 1 — `agent-sdk` (revert the `KNOWN_CONFIG_KEYS` deletion)

```
Test Suites: 1 failed, 68 passed, 69 total
Tests:       2 failed, 905 passed, 907 total
```

| Test                                                          | Result reverted                  |
| ------------------------------------------------------------- | -------------------------------- |
| no longer enumerates the dead VS Code Language Model key      | **FAIL**                         |
| keeps exactly one `llm.*` key, the live `llm.defaultProvider` | **FAIL**                         |
| contains no duplicate keys                                    | passes both ways — hygiene guard |
| still carries the auth routing pair                           | passes both ways — hygiene guard |

## Item 2 — two mutations of the literal I chose **not** to change

Since item 2 has no production change, I mutated the literal in both plausible
directions to prove the contract spec is load-bearing rather than decorative.

**Mutation A — `'openrouter'` → `''` (a naive application of `2cf4390e0`):**

```
Test Suites: 1 failed, 69 passed, 70 total
Tests:       2 failed, 908 passed, 910 total
```

Failing: _"keeps the file-settings default and DEFAULT_PROVIDER_ID in
agreement"_ and _"declares a non-empty provider id, so the ?? fallbacks stay
consistent"_.

**Mutation B — `'openrouter'` → `'moonshot'` (silent divergence from the registry):**

```
Test Suites: 1 failed, 69 passed, 70 total
Tests:       1 failed, 909 passed, 910 total
```

Failing: _"keeps the file-settings default and DEFAULT_PROVIDER_ID in
agreement"_ only — which is the correct discrimination between the two failure
modes.

The third test (_"ships authMethod=apiKey"_) passes both ways by design; it
guards the different literal that keeps the whole mismatch latent.

---

# Gate

`npx nx run-many -t test lint typecheck -p platform-core agent-sdk settings-core --skip-nx-cache`

```
NX   Successfully ran targets test, lint, typecheck for 3 projects
```

| Project         | Test suites    | Tests                             | Lint                  | Typecheck |
| --------------- | -------------- | --------------------------------- | --------------------- | --------- |
| `platform-core` | 29 passed / 29 | 514 passed, 4 todo, **518 total** | 0 errors, 7 warnings  | clean     |
| `agent-sdk`     | 70 passed / 70 | **910 passed / 910**              | 0 errors, 32 warnings | clean     |
| `settings-core` | 7 passed / 7   | **163 passed / 163**              | 0 errors, 0 warnings  | clean     |

**Nothing fails.**

Deltas vs baseline (verified by counting `it(` in the diff, not by arithmetic
alone: 7 added to existing `platform-core` specs, 4 + 3 in the two new
`agent-sdk` spec files):

- `platform-core` 511 → 518 tests (+7), suites unchanged at 29.
- `agent-sdk` 903 → 910 tests (+7), 68 → 70 suites (+2 new files).
- `settings-core` unchanged at 163 / 7 — it was read, never edited.

**All 39 lint warnings are pre-existing and none is in a file I touched.**
`platform-core`'s 7 are in `cross-process-child.ts`, `file-settings-manager.ts`
and `file-settings-manager.spec.ts` lines 815/828/829 — my additions to that
spec are at ~165-200 and contain no non-null assertions. `agent-sdk`'s 32 are in
`sdk-model-service.ts`, `session-lifecycle-manager.spec.ts`,
`ask-user-question.service.spec.ts`, `exit-plan-mode.service.spec.ts` and
`sdk-permission-handler.spec.ts`.

## Downstream verification beyond the required gate

Because item 1 removes a key from a registry that other libs route through, I
ran the consumers too:

```
skill-synthesis    62 passed / 68 (6 skipped) — 1256 passed, 37 skipped, 1293 total
platform-cli       15 passed / 15 — 241 passed, 3 todo, 244 total
platform-electron  12 passed / 12 — 197 passed, 3 todo, 200 total
platform-vscode    14 passed / 14 — 144 passed, 3 todo, 147 total
NX   Successfully ran target test for 4 projects
```

`skill-synthesis` at 1256/1293 matches the follow-up numbers in
`implementation-report.md` exactly, so the other session's in-flight work there
is undisturbed.

---

# Open / not fixed

1. **Pre-existing `ptah-cli` suite breakage, unrelated to me — but worth
   flagging.** Four suites (`session.spec.ts`, `session.headless.spec.ts`,
   `interact.spec.ts`, `mcp-serve.spec.ts`) fail to _run_ with
   `TypeError: agent_sdk_1.ALL_TIER_ENV_KEYS is not iterable` at
   `auth-providers/src/lib/auth/provider-auth-resolver.ts:62`, via
   `auth-providers/src/di/register.ts:30` → `cli-engine/src/lib/container.ts:71`.
   **I confirmed this is not mine** by reverting both production files to `HEAD`
   and re-running: identical failure (`4 failed, 807 passed, 810 total`). It is a
   module-init cycle in `auth-providers` — one of the paths another agent is
   working in — so I left it entirely alone. Whoever owns that tree should know.

2. **`runV2Migration` disagrees with every runtime reader about the auth key,
   and this is a genuine one-caller divergence.** `v2-migration.ts:46-52` reads
   `anthropicProviderId` from **raw parsed JSON**
   (`readNested(data, 'anthropicProviderId') ?? ''`), not through
   `PtahFileSettingsManager` — so it is the only caller that actually sees `''`
   and computes `thirdParty.unknown`, while every runtime reader computes
   `thirdParty.openrouter`. For a `thirdParty` install with no provider id, the
   migration would write `provider.thirdParty.unknown.selectedModel` and every
   reader would look at `provider.thirdParty.openrouter.selectedModel`. Mostly
   historical (v2 has already run on existing installs), but it is the sharpest
   concrete expression of the item-2 mismatch and deserves its own carrier.

3. **`AUTH_SETTINGS.anthropicProviderId` has DI registrations but no production
   consumer** (`settings-core/src/repositories/auth-settings.ts:27`). It is the
   one handle that would surface `ANTHROPIC_PROVIDER_ID_DEF.default`, and
   nothing calls it. Either wire it or drop it — leaving it is what makes the
   `''` default look live when it is not.

4. **Item 2's decision needs a human on branch `fix/claude-cli-default-model`.**
   Commit `2cf4390e0` makes the change this task considered, its message
   contains a claim my trace contradicts (the `??` fallbacks do not cover `''`),
   and its PR is pending. If that branch lands as-is, `thirdParty` installs with
   an unset provider id change behaviour and the new contract spec added here
   goes red — which is the intended alarm, not a false positive.

5. **`llm.vscode.model` may still sit in real `~/.ptah/settings.json` files.**
   By design, per the migration analysis above — it is inert and readable, and
   no migration prunes it. Recorded so nobody later reads its presence on disk
   as evidence the key is still live.
