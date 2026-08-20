# TASK_2026_283 — implementation report

The seed prompt now names a profile's Stage A skill only when skill discovery
has actually seen it. When it has not, the prompt hands the agent the generic
Stage A contract instead of a dangling skill name.

## What changed

### `libs/backend/rpc-handlers/src/lib/harness/harness-constants.ts`

- **`:43-52`** — new optional field on `NewProjectPromptContext`:
  `readonly availableSkillIds?: readonly string[]`. Bare directory-name slugs,
  the same vocabulary `StackProfile.skills` uses. Absent is documented as
  meaning "we could not find out" and is treated identically to empty.
- **`:160-215`** — `buildProcedureSteps(profile, availableSkillIds)` takes the
  set as a second parameter. It resolves `initializer` and `architect`
  independently (`:184-191`); each is `null` unless the live set contains the
  profile's name for it. The function stays pure — no DI, no discovery call.
- **`:196-206`** — new middle branch for "profile resolved, its initializer is
  not installed". It does **not** reuse the `other`-platform prose verbatim:
  that prose asks the user which language and runtime the project targets,
  which is incoherent when the intake block two sections above already says
  `**Platform:** Python`. The new branch carries the same generic Stage A
  contract wording ("discovery, then domain model, then roadmap, then a
  foundation-only scaffold") without the platform question, and without naming
  the absent skill.
- **`:242-244`** — `architectClause` now keys off the resolved `architect`
  rather than `profile`, so the pre-existing else-branch prose ("then derive the
  library layout from them using the conventions of the platform we settled on")
  is reused verbatim as the architect fallback.
- **`:284-291`** — `buildNewProjectSeedPrompt` builds `new Set(context.availableSkillIds ?? [])`
  and passes it down. `?? []` is where "unknown" collapses into "absent".

`profile.skills.domain` (`ddd-architecture`) is deliberately not gated — it is
not a per-platform preset and already has its own `?? 'ddd-architecture'`
default. The `other`-platform branch is untouched.

### `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`

- **`:740-767`** — new private `resolveAvailableSkillIds()`. Calls
  `this.workspaceContext.discoverAvailableSkills()` (the same accessor used at
  `:350`, `:371`, `:388`, `:656`), keeps only `isActive` skills, and returns
  their `id`s. Wrapped in `catch (error: unknown)` → `logger.debug` → `[]`,
  matching the fail-closed posture documented on `partitionRequiredPlugins`
  (`:690-692`). Note `discoverAvailableSkills()` already catches internally and
  returns `[]`; the wrapper is belt-and-braces for a host with no skill surface
  at all, and is exercised by a test.
- **`:825`** — the call site at `harness:start-new-project` passes
  `availableSkillIds: this.resolveAvailableSkillIds()`.

**Ordering matters and is asserted.** The call sits _after_ the bundled-plugin
enable + `reconcileHarness()` at `:820-822`, so a plugin enabled by this very
request counts as present. Without that ordering the first project on a fresh
machine would always fall back.

**Why `isActive`.** A skill in `disabledSkillIds` never enters the desired
state and is never written to any harness dir (pinned by
`harness-manifest.builder.spec.ts:95` and
`harness-reconciler.overlay-and-disabled.spec.ts:88`). From the agent's side a
disabled skill is not there, so it is not named.

**Skill-name shape, verified not assumed.** `discoverAvailableSkills()`
(`harness-workspace-context.service.ts:342-364`) maps `PluginSkillEntry.skillId`
onto `SkillSummary.id`, and `skillId` is the skill's directory name
(`plugin-loader.service.ts:748`, `:798`) — bare, unnamespaced, e.g.
`saas-workspace-initializer`. That is exactly what `StackProfile.skills` holds,
so the match is a direct `Set.has`, no normalisation.

**Forward compatibility.** The gate reads the live discovery result, so when
TASK_2026_276 ships `ptah-python`, `python-workspace-initializer` and
`python-workspace-architect` become discoverable and the fallback stops firing
with no edit to either file. Asserted directly by the test
`stops falling back the moment the named skills become discoverable`.

### Tests

`libs/backend/rpc-handlers/src/lib/harness/harness-constants.spec.ts`

- **`:10-25`** — `skillsOf(...profileIds)` reads the skill names back out of the
  registry via `getStackProfile`, so a renamed skill fails these tests instead
  of leaving them asserting a dead name. `ALL_INSTALLED` is the healthy machine.
- **`:262-386`** — new `describe('buildNewProjectSeedPrompt — skills that are not installed')`
  with 7 cases: both installed (unchanged prompt); shipped Node/TS + .NET
  regression guard; initializer missing / architect present; architect missing /
  initializer present; neither installed (fully generic, still 6 numbered steps,
  still states `**Platform:** Python`, and explicitly does _not_ emit the
  `other`-branch "which language, runtime and package manager" question);
  unknown and empty availability both generic; the forward-compat flip; and
  `ddd-architecture` plus the `other` branch staying out of it.
- Three pre-existing tests that assert profile skill names (`:147`, `:201`,
  `:216`) now pass `ALL_INSTALLED` — they were previously relying on the
  ungated behaviour.

`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.spec.ts`

- **`:71-88`** — `installedSkills(...ids): SkillSummary[]` helper and
  `NODE_TS_SKILLS`.
- **`:632-645`** — the existing "enables the SaaS plugin …" test now stubs
  discovery with `NODE_TS_SKILLS`, which is what its
  `stringContaining('saas-workspace-initializer')` assertion has always meant.
  The suite-wide default mock stays `[]` (changing it broke two unrelated
  `suggest-config` / `analyze-intent` assertions).
- **`:936-1022`** — four new handler-level cases: discovery is read after the
  plugin save _and_ the propagate (via `invocationCallOrder`); an unrelated
  skill set falls back; a disabled initializer falls back while the still-active
  architect is named (independence, end to end); and discovery throwing still
  yields `{ success: true }` with a generic prompt.

## Verification — verbatim

```
$ npx nx test rpc-handlers

> nx run @ptah-extension/rpc-handlers:test

(node:25532) Warning: Failed to load the ES module: D:\projects\ptah-extension\libs\backend\rpc-handlers\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 81 passed, 81 total
Tests:       31 skipped, 2261 passed, 2292 total
Snapshots:   0 total
Time:        22.028 s, estimated 61 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

```
$ npx nx typecheck rpc-handlers

> nx run @ptah-extension/rpc-handlers:typecheck

> tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json


 NX   Successfully ran target typecheck for project @ptah-extension/rpc-handlers
```

```
$ npx nx lint rpc-handlers

D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.handlers.ts
  899:1  warning  File has too many lines (734). Maximum allowed is 700  max-lines

✖ 20 problems (0 errors, 20 warnings)

 NX   Successfully ran target lint for project @ptah-extension/rpc-handlers
```

Lint passes: **0 errors**, 20 warnings, all pre-existing in kind.

### Pre-existing, not introduced

`max-lines` on `harness-rpc.handlers.ts` already fired before this change.
Measured by stripping the two hunks from the working copy and re-running eslint:

```
$ npx eslint libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts   # with this change's hunks removed
  892:1  warning  File has too many lines (719). Maximum allowed is 700  max-lines
```

719 → 734, both over the 700 soft ceiling. Per CLAUDE.md this is warn-level and
"past 1000 means a deliberate look" — not addressed here, and the 15 lines added
are one cohesive private method that belongs on this class.

The other 19 warnings are in files this task did not touch
(`skills-sh-rpc.handlers.ts`, `skills-synthesis-rpc.handlers.ts`,
`tasks-rpc.handlers.ts`, `voice-rpc.handlers.ts`,
`wizard-generation-rpc.handlers.ts`, three `harness/ai/*.service.ts` unused
`TOKENS` imports, `harness-stream-broadcaster.service.spec.ts`).

## Scope kept

`StackProfile`, `PYTHON_PROFILE` and the Python plugin are untouched — that
remains TASK_2026_276. Nothing was committed; all changes are in the working
tree.
