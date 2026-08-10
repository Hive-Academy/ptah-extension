# Report — Defects 3 & 4 + Codex environment note (TASK_2026_199)

## Defect 3 — the model-identity prompt announced the wrong model

### Root cause

`buildModelIdentityPrompt` derived the model name as
`OPUS || SONNET || HAIKU` — the first tier that happens to be **defined**, not
the tier the session runs on. Since the block ends with "This clarification
takes precedence over any other identity instructions", a `modelTier: 'sonnet'`
spawn on a provider whose tiers differ was ordered to authoritatively report the
opus model.

The resolved model was already sitting one stack frame away:
`sdk-query-options-builder.ts:568` computes
`const model = this.modelService.resolveModelId(sessionConfig.model, authEnvOverride)`
and assigns it to `Options.model` — but never threaded it into
`buildSystemPrompt` → `assembleSystemPrompt` → `buildModelIdentityPrompt`.

### Fix

**1. Thread the real model.** The signature is now
`buildModelIdentityPrompt(providerId, resolvedModel)`. `AuthEnv` is gone from
the function and from `AssembleSystemPromptInput` — `authEnv` was used for
nothing else there, so it was replaced by `resolvedModel` rather than left as a
dead field. `resolvedModel` is **required** (not optional) on the input
interface, so the compiler now forces every call site to supply it.

`build()` passes its own `model` local down through `buildSystemPrompt`, so the
identity block and `Options.model` are the same value by construction, not by
coincidence.

**2. De-duplicated.** `sdk-query-runner.service.ts` carried a copy-pasted
template and the same fallback in a private `buildOneShotIdentityPrompt`. That
method is deleted; the one-shot path now calls the shared
`buildModelIdentityPrompt(getActiveProviderId(authEnv), resolvedModel)`.

Two side effects of routing through the shared helper, both improvements:

- The one-shot detected providers by base-URL hostname only.
  `getActiveProviderId` also recognises the Copilot / Codex / OpenRouter proxy
  token placeholders, so those one-shot sessions get a correct identity block
  too instead of none.
- `resolvedModel` in the one-shot is now resolved as
  `resolveModelId(input.model, input.auth?.env)`. It previously ignored the
  per-call auth override and resolved against the **global** `this.authEnv`,
  while `options.env` was built from the override — so a one-shot with an
  override could send the global provider's tier model to the override's
  provider. One value now feeds `options.model`, `options.env` and the identity
  block. This is a behaviour change slightly beyond the literal defect; it is
  the same class of bug and leaving it would have let the two disagree again.

**3. Omit rather than lie.** `ModelResolver.resolve()` can hand back a bare tier
name (`'sonnet'`) or `'default'` when nothing maps. Those name a slot, not a
model, so `UNRESOLVED_MODEL_IDS` (derived from `TIER_ENV_VAR_MAP`, not a second
hard-coded list) short-circuits and the block is omitted entirely.

### Tests — `model-identity-prompt.spec.ts` (new, 19 tests)

Moonshot is the fixture because its three registry tiers really are distinct
(`kimi-k2.7-code` / `kimi-k2.6` / `kimi-k2.5`) — and the spec asserts that
distinctness first, so the per-tier cases cannot silently degenerate.

- `it.each` over opus/sonnet/haiku: each tier's prompt names its own model.
- The reported defect specifically: a sonnet session's prompt contains the
  sonnet model and **not** the opus or haiku one.
- Omission cases: `undefined`, `''`, `'   '`, `'default'`, `'opus'`, `'sonnet'`,
  `'haiku'`, `'OPUS'`; plus null provider and unknown provider id.
- End-to-end through `build()`: for each tier, `options.model` and the
  identity block agree.

`sdk-query-runner.service.spec.ts` needed one harness change. Its
`resolveModelId` stub was a pass-through `(m) => m`, which made
"builds the override identity prompt from the override env" fail — the test's
intent (the override env must drive identity) is still right, but a
pass-through stub cannot express it now that identity keys off the resolved
model. The stub now mirrors the one `ModelResolver` branch these specs use
(`claude-<tier>-*` → the tier's env override). That test passing is also what
proves the `input.auth?.env` threading works.

## Defect 4 — `disabledClis` docs contradicted its behaviour

### Chosen semantics: (a) HARD DISABLE

Reasons:

1. **Three independent code paths already implement hard disable, consistently**
   — the spawn guard (`agent-namespace.builder.ts:182`), the `preferredOrder`
   loop and the auto-detect filter (`agent-process-manager.service.ts:1254`,
   `:1277`). This is a correctly-built feature with wrong docs, not a
   half-built one. Option (b) would mean weakening three call sites.
2. **A privacy guarantee already depends on it.**
   `providers/ollama.md:69` tells users to "restrict sub-agent spawning to
   `ollama`-only by disabling the others in `agentOrchestration.disabledClis`",
   on a page whose selling point is "your prompts and code never leave your
   machine". Under (b) an explicit `cli` request would still reach a cloud CLI,
   silently converting a stated privacy property into a false one. That is the
   expensive direction to get wrong.
3. A control labelled "disable" that still permits the thing is the more
   surprising of the two readings.

### Third finding: the ptah-cli doc was wrong on a second count

`disabledClis` is only ever compared against `c.cli` — a `CliType`. Putting a
**ptah-cli agent id** in it does nothing anywhere:

- `list()` filtered on `c.cli`, and ptah-cli entries were appended _after_ the
  filter;
- `getPreferredCli()`'s preferred-order loop requires `SYSTEM_CLI_TYPES.has(entry)`,
  which an id is not, and its auto-detect filter also matches on `c.cli`;
- `spawn()`'s `ptahCliId` branch returns before the disabled check is reached;
- the settings UI is explicit about it —
  `agent-orchestration-config.component.ts:829`:
  `const isDisabled = !cli.ptahCliId && disabledClis.has(cli.cli);`

So `providers/ptah-cli.md:60` documented a mechanism that has no effect on the
thing it was documenting. Ptah CLI agents are switched off with their own
`enabled: false` field — documented in the table one line above the wrong
paragraph.

### Changes

- `CliDetectionResult.disabled?: boolean` added in `libs/shared`, documented as
  a hard disable and as never set for `ptah-cli`.
- `agent-namespace.builder.ts` `list()` now **marks** disabled CLIs instead of
  dropping them, so the restriction is discoverable before a spawn fails.
- `formatAgentList` renders `disabled (installed)` / `disabled`, with `disabled`
  outranking `installed` — the binary being present is not the fact the caller
  needs.
- `chat/autopilot.md` — states hard disable, quotes the actual error string,
  and notes disabled CLIs still appear in `ptah_agent_list`.
- `providers/ptah-cli.md` — corrected on both counts: `disabledClis` takes CLI
  _types_ (with a correct example), does not apply to ptah-cli agents, and
  `enabled: false` is the way to switch one off. There is no Autopilot-only
  opt-out for these agents.
- `providers/codex.md:60` and `providers/ollama.md:69` were checked and are
  already consistent with hard-disable semantics. Unchanged.

**The user's `~/.ptah/settings.json` was not touched.**

### Tests

`agent-namespace.builder.spec.ts` — the old "filters out disabled CLIs before
merging" is replaced by "reports disabled CLIs with `disabled: true` instead of
omitting them" (asserts both entries present, only the disabled one marked),
plus a new case proving a ptah-cli id in `disabledClis` leaves the agent
unmarked. `mcp-response-formatter.spec.ts` — a disabled-but-installed agent
renders as `disabled (installed)`.

## Environment note — Codex CLI 0.133.0 (report only, no code changed)

### The premise is partly wrong: 0.133.0 is not dead

Run against `node_modules/.bin/codex` (0.133.0) in this repo:

```
$ codex exec --skip-git-repo-check -m gpt-5.5 "reply with exactly: OK"
...
ERROR codex_models_manager::manager: failed to refresh available models: ...
      unknown variant `max`, expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
codex
OK
tokens used 11,326
REAL_EXIT=0
```

**It completes successfully.** The `max` enum error is a non-fatal warning on
the model-refresh path, not a startup abort.

### What actually blocks it

Model selection. With no `-m`, the account default resolves to a model the
server refuses for this CLI version:

```
$ codex exec --skip-git-repo-check "say OK"
ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error",
  "message":"The 'gpt-5.6-luna' model requires a newer version of Codex.
             Please upgrade to the latest app or CLI and try again."}}
REAL_EXIT=1
```

`gpt-5.1-codex` fails differently and for an unrelated reason —
`"not supported when using Codex with a ChatGPT account"` — i.e. an
entitlement issue, not a version issue.

The two failures compound: refresh dies on the enum, so the CLI cannot discover
which models this version can actually serve, and falls back to a default the
API then rejects.

### The `max` variant is the server's, not Ptah's

Confirmed by grepping the captured response body: `max` appears inside the
server's `supported_reasoning_levels` list, not in anything Ptah sends. Ptah's
`AgentProcessManager.mapEffortToCli` already coerces `max` → `xhigh` for Codex,
so no Ptah-originated request carries it. Nothing to change on our side.

### Version pins

| package             | pinned                        | installed | npm latest  |
| ------------------- | ----------------------------- | --------- | ----------- |
| `@openai/codex-sdk` | `^0.133.0` (package.json:111) | 0.133.0   | **0.147.0** |
| `@openai/codex`     | not a direct dep              | 0.133.0   | **0.147.0** |

`@openai/codex` is pulled in transitively — `@openai/codex-sdk@0.133.0` declares
an exact `"@openai/codex": "0.133.0"`. So the CLI version is not independently
selectable: bumping the SDK is what bumps the binary.

The `^0.133.0` range already permits 0.147.0; **the lockfile is what is holding
it back**. See "Codex SDK bump" below — this was subsequently done on request
and it fixes the issue outright.

### Does the adapter surface it clearly? Yes — no silent hang

`codex-cli.adapter.ts` has three separate paths that turn this into a visible
`error` segment:

- `catch (error: unknown)` around the run (`:542-556`) → `[Codex SDK Error] …`
- `turn.failed` events (`:848-857`) → `[Turn Failed] …`
- stream-level `error` events (`:861-868`) → the message verbatim

The 400 arrives on one of these, and the CLI exits non-zero promptly
(`REAL_EXIT=1`, no hang), so `AgentProcessManager`'s 1-hour cap is never
reached.

One gap worth noting: the `codex_models_manager` warning goes to the child's
stderr, which the Codex SDK owns — the adapter never sees it, so that
diagnostic breadcrumb is invisible in Ptah. Harmless today (it is non-fatal),
but it means a user hitting the 400 sees the rejection without the "your model
list is stale" context that explains why.

## Verification

### Lint

```
> nx run-many -t lint -p shared agent-sdk vscode-lm-tools --skip-nx-cache

Linting "@ptah-extension/shared"...
Linting "@ptah-extension/vscode-lm-tools"...   ✖ 17 problems (0 errors, 17 warnings)
Linting "@ptah-extension/agent-sdk"...         ✖ 31 problems (0 errors, 31 warnings)

 NX   Successfully ran target lint for 3 projects
```

Zero errors. All warnings are pre-existing `no-explicit-any` /
`no-empty-function` hits in files this task did not touch.

### Unit tests

```
> nx run-many -t test -p shared agent-sdk vscode-lm-tools cli-agent-runtime tribunal-panel --skip-nx-cache

cli-agent-runtime  Test Suites: 30 passed, 30 total   Tests: 690 passed, 690 total
shared             Test Suites: 33 passed, 33 total   Tests: 444 passed, 444 total
agent-sdk          Test Suites:  1 failed, 67 passed, 68 total
                   Tests:        1 failed, 892 passed, 893 total
vscode-lm-tools    Test Suites: 38 passed, 38 total   Tests: 748 passed, 748 total
tribunal-panel     Test Suites:  7 passed,  7 total   Tests: 104 passed, 104 total
```

**One test still fails**, the same pre-existing one reported in the Defect 1/2
verification:

```
● SdkQueryRunner › runOneShot — one-shot auth override (input.auth)
  › derives env / settingSources / beta flag from the override, not this.authEnv

  expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
  Received: ""
```

Re-confirmed as pre-existing by stashing **all** of `libs/backend/agent-sdk`
and running it at HEAD: `Tests: 1 failed, 14 skipped, 15 total`, same
`Received: ""`. It concerns auth-token propagation, not model identity.

---

# Follow-up — build repair + Codex SDK bump

## Fourth call site found by the build (Defect 3)

`nx run-many -t typecheck --all` surfaced a call site the earlier grep missed:
`ptah-cli-spawn-options.service.ts:86` also calls `assembleSystemPrompt`. This
is the **ptah-cli spawn path — the exact path in the original repro** (Ollama
Cloud provider, `modelTier: sonnet`), so the fix would have been incomplete
without it. Making `resolvedModel` a _required_ field is what turned it into a
compile error instead of a silent miss.

The tier is already resolved a few lines above the call, at
`ptah-cli-registry.ts:545-553`:

```ts
const tier: ModelTier = options?.modelTier ?? 'sonnet';
const spawnFromTiers = this.resolveEffectiveTiers(agentConfig, provider)?.[tier];
const model = modelOverride || agentConfig.selectedModel?.trim() || spawnFromTiers || '';
```

`assembleSpawnOptions` gained a `resolvedModel` parameter and the registry now
passes `model || undefined`. That is the answer to Defect 3 requirement 1
("trace where `modelTier` is resolved to a concrete model for ptah-cli spawns
and use THAT value") — this is that value.

## Build repair — `ptah-tui`

`nx run-many -t build` failed on `ptah-tui:build:production`:

```
X [ERROR] Could not resolve "@ptah-extension/output-styles"   (×5)
```

**Pre-existing**, confirmed by stashing all `libs`/`apps` changes and rebuilding
at HEAD — same five errors. `apps/ptah-cli/tsconfig.build.json` has the
`@ptah-extension/output-styles` path alias; the parallel map in
`apps/ptah-tui/tsconfig.build.json` was never given one when the lib landed in
TASK_2026_197. Added at the same position (after `task-specs`) so the two maps
stay readable side by side.

## Codex SDK bump — 0.133.0 → 0.147.0

`npm install @openai/codex-sdk@0.147.0`. Three workspace manifests still pinned
`^0.133.0` and had to be aligned or Nx's pruned-lockfile step fails
(`Pruned lock file creation failed. The following package was not found in the
root lock file: @openai/codex-sdk@^0.133.0`):

- `package.json:111`
- `apps/ptah-cli/package.json:52`
- `apps/ptah-electron/package.json:15`
- `libs/backend/cli-agent-runtime/package.json:20`

`@openai/codex` follows automatically (the SDK declares an exact dependency on
it) — 0.147.0, and `@openai/codex-win32-x64@0.147.0-win32-x64` resolves for
`CODEX_PLATFORM_PACKAGES`, so `resolveCodexNativeBinary` still finds its target.

### It fixes the issue completely

```
$ codex exec --skip-git-repo-check "reply with exactly: OK"
codex
OK
tokens used 2,491
REAL_EXIT=0

$ grep -c ERROR  → 0
```

Zero ERROR lines: the `unknown variant \`max\``model-cache failure is gone
(0.147.0's enum knows the variant), and with the model list refreshing normally
the **default model now resolves to something the API accepts** — no more`The 'gpt-5.6-luna' model requires a newer version of Codex`. Both symptoms
were downstream of the same version skew.

**`codex-cli.adapter.ts` was not touched.** The bump needed no adapter change:
the SDK is still ESM-only with the same `{ Codex, Thread }` export shape the
lazy `import('@openai/codex-sdk')` expects, `cli-agent-runtime` and `agent-sdk`
typecheck clean, and all 444 `cli-agent-runtime` tests pass.

## Verification after all of the above

```
> nx run-many -t typecheck --all --skip-nx-cache
 NX   Successfully ran target typecheck for 90 projects

> nx run-many -t build --skip-nx-cache
 NX   Successfully ran target build for 37 projects and 6 tasks they depend on
```

Both green — no errors, no failed tasks.

```
> nx run-many -t test -p shared agent-sdk vscode-lm-tools cli-agent-runtime tribunal-panel rpc-handlers cli-engine

shared             30 suites,  690 passed
agent-sdk           1 failed, 67 passed  |  1 failed, 892 passed, 893 total
vscode-lm-tools    38 suites,  748 passed
cli-agent-runtime  33 suites,  444 passed
tribunal-panel      7 suites,  104 passed
rpc-handlers        1 failed, 73 passed  |  1 failed, 31 skipped, 1741 passed, 1773 total
```

**Two failures, both pre-existing, both re-confirmed at HEAD by stashing every
change in `libs`/`apps`:**

1. `SdkQueryRunner › derives env / settingSources / beta flag from the override`
   — `expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()`, received `""`.
2. `ChatSessionService — resumeSession activate:true (TS-04) › reports
activated:true when the session is already live` — `Expected: true,
Received: false`. At HEAD: `Tests: 1 failed, 1753 skipped, 1754 total`.

One further flake seen once and not reproducible: `Workspace skill installers
(decision #4) › overwrites our own previously-written entry` failed in a full
`cli-agent-runtime` run, then passed both in isolation and on a clean re-run of
the same suite (444/444). Order/parallelism dependent, unrelated to the bump.
