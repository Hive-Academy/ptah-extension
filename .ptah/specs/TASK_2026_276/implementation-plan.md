# Implementation Plan — TASK_2026_276: ship the Python half of the StackProfile registry

Scope: author the `ptah-python` glue plugin (3 skills), fill `PYTHON_PROFILE.requiredPlugins`,
flip the profile to `monorepoDecision: 'ask'`, and register on all four surfaces.

Binding inputs: `context.md` "Decisions taken (user, 2026-08-18)" and "Registration surface";
`research-report.md` Q1/Q2/Q3. Neither is relitigated here.

---

## A. The `'ask'` consequence — traced, not assumed

### A1. There is exactly ONE runtime consumer, and it is fully profile-driven

`D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\harness\harness-constants.ts:187-199`

```ts
if (profile && profile.workspace.monorepoDecision === 'ask') {
  const plugins = profile.workspace.nxPlugins;
  const pluginNote = plugins.length > 0 ? ` (via \`${plugins.join('`, `')}\`)` : '';
  steps.push(
    'In that same discovery, ask me whether this workspace should be ' +
      `managed by \`${profile.workspace.monorepoTool}\`${pluginNote} or stay ` +
      `on plain \`${profile.workspace.scaffoldCommands.join('`, `')}\`. ` + ...
```

Called from `buildProcedureSteps` (`harness-constants.ts:157`) via `buildNewProjectSeedPrompt`
(`:241-248`), which resolves the profile only through `resolveStackProfileForPlatform(intake.platform)`
(`:245`). Tool name, plugin list and scaffold commands are all interpolated from the profile.

**No hardcoded `id === 'dotnet'` branch exists anywhere in production code.** Every `'dotnet'`
literal outside `stack-profiles.ts` is a `getStackProfile('dotnet')` _lookup_ pulling registry data
(`project-detector.service.ts:11`, `monorepo-detector.service.ts:11`,
`framework-detector.service.ts:12`), an unrelated `ProjectType.DotNet` enum
(`libs\backend\workspace-intelligence\src\types\workspace.types.ts:23`), or a marketplace id.
The only id-branches in production are on `'node-ts'`:
`harness-workspace-context.service.ts:192-202` and
`harness-rpc.handlers.ts:137` (`RUNTIME_PROVIDED_PROFILE_IDS = ['node-ts']`, a list-membership test
that Python already falls through correctly — it gets a toolchain probe, which is right).

`harness-rpc.handlers.ts` and `new-project-intake.ts` read **none** of the three fields.
`new-project-intake.ts:41-44` maps `STACK_PROFILES` wholesale; `setup-hub.component.ts:1214` uses
`stackOptionsForPlatform()`. The Stage A detectors read only `detect.*` and `toolchain`.

### A2. `nxPlugins: ['@nxlv/python']` flows safely — no `@nx/` scope assumption

`nxPlugins` is read at exactly one site (`harness-constants.ts:188`) and used only as opaque strings
joined into markdown backticks. Repo-wide there is no `.replace('@nx/', …)`, no `.startsWith('@nx')`,
no `` `@nx/${…}` `` construction, and no install command built from the field — the only thing Ptah
installs from a profile is the separate `requiredPlugins` (`harness-rpc.handlers.ts:640-673`).
`'@nxlv/python'` renders unchanged.

### A3. THE ONE REAL CONSEQUENCE — `monorepoTool` must also flip to `'nx'`

The user's decision fixed `monorepoDecision: 'ask'` and `nxPlugins`, but not `monorepoTool`.
Leaving it `'none'` is broken two ways:

1. **Rendered prose becomes nonsense.** `harness-constants.ts:193` interpolates it verbatim:
   the seed prompt would read _"ask me whether this workspace should be managed by `none`
   (via `@nxlv/python`) or stay on plain `uv init`"_.
2. **It violates a pinned invariant.** `libs\shared\src\lib\constants\stack-profiles.spec.ts:83-89`
   asserts `monorepoTool === 'none'` implies `monorepoDecision === 'given'`. The test would fail.

The type doc is explicit that this is legal and intended: `monorepoTool` under `'ask'` is
_"the DEFAULT the agent should carry into that question, not the outcome"_
(`libs\shared\src\lib\types\stack-profile.types.ts:82-87`). So Python takes the same
`monorepoTool: 'nx'` + `monorepoDecision: 'ask'` pair .NET has (`stack-profiles.ts:110-115`).

**Verdict on section A: zero production-code changes required.** The machinery is already
profile-driven. The work is data (`stack-profiles.ts`) plus two spec updates (§E).

---

## B. Skill set and split

Three skills, `ptah-dotnet` scale (its files run 11 / 175 / 178 / 116 / 72 / 83 = 635 lines).
Target ~655 lines total. All well under the 700-line soft ceiling per file.

Cross-plugin links use the `ptah-dotnet` convention — relative `../<skill>/SKILL.md` paths, which
resolve because skills flatten into one runtime `.claude/skills/` namespace
(stated at `ptah-nx-saas\skills\saas-workspace-initializer\references\roadmap-format.md:5`).
Do not "fix" these into plugin-qualified paths.

### B1. `python-workspace-initializer` — Stage A (name FIXED by `stack-profiles.ts:183`)

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-python\skills\python-workspace-initializer\SKILL.md`
**Target**: ~180 lines. **References**: none of its own (defers to the shared roadmap schema).
**Model**: mirror `dotnet-solution-initializer\SKILL.md` section-for-section.

Frontmatter:

```yaml
name: python-workspace-initializer
description: Stage A bootstrap for Python workspaces. Specializes the shared Stage A contract from saas-workspace-initializer (mandatory two-round AskUserQuestion discovery, roadmap to `.ptah/roadmap.md`, foundation-only scaffold, then stop) with Python-specific Round 2 questions -- package manager, project shape, src vs flat layout, dependency groups, test framework, and whether the workspace should be Nx-managed. Names bounded contexts and package layout via ddd-architecture and python-workspace-architect, then hands off uv/ruff/ty execution mechanics to the astral plugin. Use when starting a new Python project, or adding Python to an existing workspace, from the New Project flow. Do not use to implement features end-to-end in one session.
```

Sections (same headings as the .NET initializer): `# Python Workspace Initializer` /
Trigger Keywords / Division of labour / Contract (a, a2, b, c, d, e) / Step a Discovery
(Round 1 = reference `saas-workspace-initializer` Step a Round 1 verbatim, do not restate;
Round 2 below) / Step a2 Domain + Package Layout Design / Step b Roadmap /
Step c Foundation Scaffold / Step d Handoff / Step e STOP / References.

Round 2 questions (each an `AskUserQuestion`, 2-4 options):

1. **Package manager** — uv / Poetry / Recommend for me → uv (matches
   `PYTHON_PROFILE.scaffoldCommands: ['uv init']`, `stack-profiles.ts:180`)
2. **Project shape** — FastAPI / Django / Flask / Library / Recommend for me (mirrors
   `stackOptions`, `stack-profiles.ts:188-194`)
3. **Layout** — src-layout / flat-layout / Recommend for me → src-layout; full table in
   `python-workspace-architect`
4. **Dependency groups** — dev+test+lint / dev only / Recommend for me (PEP 735)
5. **Test framework** — pytest / unittest / Recommend for me → pytest
6. **Nx-managed workspace?** — Yes / No / Recommend for me. Delegate the logic to
   `nx-python-workspace`; do not re-derive it here. **This question exists because of
   `monorepoDecision: 'ask'` (§A3) and is the Round 2 item the seed prompt now instructs.**

Foundation phase items: `workspace-init` (`uv init` + `pyproject.toml`), `layout-baseline`
(package tree from the architect), `lint-baseline` (ruff/mypy config — hand execution to `ruff`),
`test-baseline` (pytest layout), and only when Round 2 chose Yes: `nx-integration`.

### B2. `python-workspace-architect` (name FIXED by `stack-profiles.ts:184`)

**File**: `…\assets\plugins\ptah-python\skills\python-workspace-architect\SKILL.md`
**Target**: ~175 lines. **Model**: `dotnet-solution-architect\SKILL.md`.

```yaml
name: python-workspace-architect
description: Python package and workspace layout from bounded contexts -- src-layout vs flat-layout, package boundaries, pyproject.toml `[project]` shape, PEP 735 dependency groups, uv workspace members, ruff and mypy config placement, and pytest test layout. Use when deriving the package structure for a new Python workspace or a new bounded context, or when an import graph has grown tangled and needs a boundary decision. Does not run uv, ruff, ty or pytest -- hand execution off to the astral plugin's uv/ruff/ty skills.
```

Sections: Activation scope (twice — initializer Step a2, then per-module in Stage B) /
Core Principle: Bounded Context → Package, Not Folder / **Decision: src-layout vs flat-layout**
(decision table mirroring the Clean-Architecture-vs-vertical-slices table, both layout trees shown) /
Package Naming / Import Direction Rules (the `ProjectReference`-rules analogue: no cycles, core
package has zero outward imports, cross-context via a contracts package) / `pyproject.toml` shape /
PEP 735 `[dependency-groups]` / uv workspace members (`[tool.uv.workspace]`) / ruff + mypy config
placement / Framework shape (Django → hand off to its own `django-admin startproject`; FastAPI and
Flask have no official scaffolding, so this skill's guidance _is_ the opinion) /
Test layout / Handoff boundary / References.

**References** (2 files, mirroring the .NET architect's 2):

- `references\pyproject-baseline.md` (~90 lines) — the complete `[project]` + `[dependency-groups]`
  - `[tool.ruff]` + `[tool.mypy]` + `[tool.pytest.ini_options]` baseline in one file, plus the
    per-package override escape hatch. **Point at `docs.astral.sh/uv/concepts/projects/dependencies`
    for current PEP 735 tool support rather than hardcoding a support matrix** (research-report Q3
    churn flag).
- `references\src-layout-vs-flat.md` (~80 lines) — full worked comparison, where a shared
  contracts package lives in each shape, and the import-path/editable-install failure mode that
  makes src-layout the safer default.

### B3. `nx-python-workspace` — the third skill (name is ours to choose)

**File**: `…\assets\plugins\ptah-python\skills\nx-python-workspace\SKILL.md`
**Target**: ~120 lines. **References**: none. **Model**: `nx-dotnet-workspace\SKILL.md` (116 lines).

Name chosen for symmetry with `nx-dotnet-workspace`, the skill it structurally mirrors. It is a
**real decision skill**, not documentation — given `monorepoDecision: 'ask'` it supplies the
recommendation logic the initializer's Round 2 question consumes, exactly as `nx-dotnet-workspace`
does at `dotnet-solution-initializer\SKILL.md:69-71`.

```yaml
name: nx-python-workspace
description: The Nx-or-not decision for Python workspaces -- uv's native `[tool.uv.workspace]` members as the default for a single-language repo, and the third-party @nxlv/python plugin as the named option for a repo genuinely spanning Python and TypeScript under one Nx graph. Covers why no official @nx-scoped Python plugin exists, @nxlv/python's uv-project generator and run-commands executor pattern, its maintenance and bus-factor profile, and when NOT to use Nx at all. Use when python-workspace-initializer's Round 2 asks whether the workspace should be Nx-managed, or when adding Nx to an existing Python repo.
```

Sections: `## The decision: ask, default to uv` (decision table — Yes for mixed Python+TypeScript
under one graph or multiple deployables needing `nx affected`; No for a single service, a team with
no Node tooling, or no mixed-workspace ambition) / Prerequisites (Nx >= 22.0.0; `@nxlv/python` peer
`@nx/devkit >=22.0.0`, no upper bound, so this repo's 22.6.5 satisfies it) / Installation
(`nx add @nxlv/python`, `npx nx generate @nxlv/python:uv-project`) / The plain-uv alternative
(`uv init`, `uv add`, `uv sync`, `[tool.uv.workspace]` members) / **Standing of `@nxlv/python`** /
When NOT to use Nx / References.

The "standing" section is the honest analogue of `nx-dotnet-workspace`'s "Experimental status" +
"`@nx-dotnet/core` is archived" sections, and must say plainly:

- No official `@nx`-scoped Python plugin exists at all — unlike .NET, which has an official-but-
  experimental `@nx/dotnet`. So this is "no official path vs. one healthy third-party path," **not**
  the `@nx-dotnet/core` abandonware story.
- `@nxlv/python` verified 2026-08-18: MIT, v23.0.0, 150 stars, pushed 2026-07-28,
  264,774 weekly npm downloads, **single maintainer** (real bus-factor risk).
- Instruct the reader to re-check the npm page for current numbers rather than trusting these
  figures as permanent — same defensive framing the research report used on itself.

### B4. Hand-off boundary to the `astral` plugin

Mirrors how `ptah-dotnet` defers to Microsoft (`dotnet-solution-initializer\SKILL.md:19-21`).

**Ptah owns**: discovery, bounded contexts, layout, dependency-group _design_, the Nx decision,
the `.ptah/roadmap.md` contract.
**Astral owns** (marketplace `astral-sh/claude-code-plugins`, plugin `astral`, skills `uv` / `ruff`
/ `ty`): uv CLI mechanics and lockfile behaviour, ruff rule-level lint/format config, ty type
checking. These are invoked at `uvx` runtime as external processes — the plugin bundles no MCP
server.

Reference them **by skill name in prose**, never by relative path (they are a different
marketplace). Each authored skill gets an `### External skills` block under `## References` listing
`uv`, `ruff`, `ty` (astral-sh/claude-code-plugins marketplace) alongside `ddd-architecture` and
`orchestration` (ptah-core), matching `dotnet-solution-initializer\SKILL.md:169-179`.

**Freshness disclosure (required)**: the astral repo was last pushed 2026-02-27 (~5.5 months stale,
9 total commits). State that date plainly wherever the astral skills are named, the way
`nx-dotnet-workspace` flags `@nx/dotnet`'s experimental status. Do not re-teach uv/ruff CLI
mechanics as a hedge against staleness — that is the duplication the division of labour exists to
prevent.

---

## C. Registration wiring — exact diffs

### C1. Plugin tree (CREATE, 6 files, ~655 lines)

`D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-python\`

| File                                                                 | Lines |
| -------------------------------------------------------------------- | ----- |
| `.claude-plugin\plugin.json`                                         | ~11   |
| `skills\python-workspace-initializer\SKILL.md`                       | ~180  |
| `skills\python-workspace-architect\SKILL.md`                         | ~175  |
| `skills\python-workspace-architect\references\pyproject-baseline.md` | ~90   |
| `skills\python-workspace-architect\references\src-layout-vs-flat.md` | ~80   |
| `skills\nx-python-workspace\SKILL.md`                                | ~120  |

`plugin.json` — mirror `ptah-dotnet\.claude-plugin\plugin.json` exactly (same keys, same order,
`version: "1.0.0"`, author `Ptah`, repository/homepage `https://github.com/Hive-Academy/ptah-extension`,
`license: "MIT"`), with:

```json
"name": "ptah-python",
"description": "Python workspace discovery, domain modelling, package layout, and the Nx integration decision -- hands off uv, ruff and ty execution mechanics to Astral's own marketplace plugin"
```

### C2. `AVAILABLE_PLUGINS` (MODIFY)

`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.ts` —
insert a new object literal after the `ptah-dotnet` entry (ends `:124`), before `ptah-angular`
(`:125`). Shape matches the existing entries exactly (`id`, `name`, `description`, `category`,
`skillCount`, `commandCount`, `isDefault`, `keywords`); `source` is deliberately omitted and stamped
`'bundled'` by `getAvailablePlugins()` (`:54-56`).

```ts
{
  id: 'ptah-python',
  name: 'Ptah Python',
  description:
    'Discovery, domain modelling, package layout and the Nx decision for Python workspaces — execution mechanics (uv, ruff, ty) come from Astral’s own marketplace plugin',
  category: 'backend-tools',
  skillCount: 3,
  commandCount: 0,
  isDefault: false,
  keywords: [
    'python', 'uv', 'ruff', 'fastapi', 'django', 'flask', 'pytest', 'backend',
  ],
},
```

Note the curly apostrophe in `Astral’s` — the `ptah-dotnet` entry at `:109` uses the same
character. `KNOWN_PLUGIN_IDS` (`:185`) is derived by `.map()` from this array, so the security
allowlist picks up `ptah-python` with **no second edit**.

### C3. `PYTHON_PROFILE` (MODIFY)

`D:\projects\ptah-extension\libs\shared\src\lib\constants\stack-profiles.ts`

- `:174` `monorepoTool: 'none'` → `'nx'` (**required — see §A3**)
- `:175-177` delete the `given` justification comment; replace per §D
- `:178` `monorepoDecision: 'given'` → `'ask'`
- `:179` `nxPlugins: []` → `['@nxlv/python']`
- `:187` `requiredPlugins: []` →
  ```ts
  requiredPlugins: [
    'ptah-python',
    { marketplace: 'astral-sh/claude-code-plugins', plugin: 'astral' },
  ],
  ```
  (manifest-verified: marketplace name `astral-sh`, single plugin `astral`, source `./plugins/astral`)
- `:184` `architect: 'python-workspace-architect'` and `:183` `initializer:` — **unchanged**; the
  authored skill names are chosen to match what the profile already declares.

**Second comment fix, outside §D's scope**: `stack-profiles.ts:111` calls .NET _"The one `ask` in
the registry."_ That becomes false. Reword to note .NET and Python now share the pattern for the
same reason — the workspace tool layers on top of native scaffolding rather than being it.

**Optional**: `libs\shared\src\lib\types\stack-profile.types.ts:84-87` describes `'ask'` as
"the .NET case". Still true, now incomplete. A one-line touch is welcome, not required.

### C4. Content manifest (GENERATED — do not hand-edit)

`D:\projects\ptah-extension\content-manifest.json` is produced by
`node scripts/generate-content-manifest.js`. Run `npm run manifest:generate` after C1 lands. It
appends the six `ptah-python/**` paths into the sorted `plugins.files` array (they sort between
`ptah-nx-saas/…` and `ptah-react/…`) and recomputes `contentHash` (`:4`) and `generatedAt` (`:5`).

**Marketplace note — no new constraint.** `apps\ptah-extension-vscode\.vscodeignore:52,55` already
excludes `**/*.py` and `**/assets/plugins/**` from the VSIX, and plugins ship from GitHub at runtime
via `ContentDownloadService`. Python code fences inside the SKILL.md files are safe. Do not add
`ptah-python` as a build asset in `project.json`.

---

## D. Profile comment rewrite (`stack-profiles.ts:141-149`)

Both claims in the current comment are now wrong: the `'none'`/`'given'` reasoning, and
_"until that plugin exists `requiredPlugins` is empty"_. Replacement prose:

```
/**
 * Python.
 *
 * `monorepoDecision: 'ask'` for the same reason .NET asks: `uv init` stands on
 * its own and an Nx layer goes on top of it, so whether it should is a property
 * of the project, not of the language. `monorepoTool: 'nx'` is the default the
 * agent carries into that question, not the outcome.
 *
 * The honest caveat belongs in `nx-python-workspace`, not here: there is no
 * official, `@nx`-scoped Python package at all — unlike .NET, which has the
 * official-but-experimental `@nx/dotnet`. `@nxlv/python` is third-party but
 * healthy (MIT, actively published, peer-compatible with this repo's Nx), which
 * is why it is offered as a named option rather than assumed as the default.
 */
```

Keep it at this length. The verified numbers (stars, downloads, push date) belong in the skill,
where they can be re-checked at read time — not pinned in a source comment that will age silently.

---

## E. Verification

Commands, in order:

```bash
npm run manifest:generate          # after the plugin tree lands
npm run manifest:check             # scripts/generate-content-manifest.js --check
npx nx typecheck @ptah-extension/shared
npx nx test @ptah-extension/shared
npx nx test @ptah-extension/rpc-handlers
npx nx test @ptah-extension/agent-sdk
npm run lint:all
```

Nx project names verified from `project.json` (`libs\shared\project.json` →
`@ptah-extension/shared`, targets `build,test,lint,typecheck`; same for the other two).

### Specs that WILL break and must be updated

1. **`D:\projects\ptah-extension\libs\shared\src\lib\constants\stack-profiles.spec.ts:71-81`** —
   exact-order assertion `[['node-ts','given'],['dotnet','ask'],['python','given']]`. Change the
   third tuple to `['python','ask']` and rewrite the comment at `:69-70` ("Only .NET is the latter").
2. **`stack-profiles.spec.ts:83-89`** — the `monorepoTool === 'none' ⟹ 'given'` invariant. **Do not
   weaken this test.** It is precisely the guard that forces §A3; flipping `monorepoTool` to `'nx'`
   satisfies it as written.
3. **`D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\harness\harness-constants.spec.ts:257-267`**
   — `'asks nothing where the tool is settled by the stack itself'` currently covers python
   (`platform: 'python', stack: 'django'`) with the comment _"python: there is no Nx plugin."_ and
   asserts the prompt does **not** contain `'In that same discovery, ask me whether'`. Move python
   out of that case and add a positive assertion that a python intake's seed prompt contains
   `@nxlv/python` and `` `uv init` ``, mirroring the `.NET` case at `:238-245`.
   (`:197-205`, which asserts the prompt names `` `python-workspace-initializer` ``, keeps passing —
   the authored skill names match what the profile already declares.)

### Specs that must GAIN coverage (currently untested wiring)

4. **`D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.handlers.spec.ts:712-714`**
   asserts `.NET`'s `requiredPlugins` becomes `enabledPluginIds: ['ptah-dotnet']`, and `:553-557`
   does the same for node-ts. **There is no python equivalent.** Add a `PYTHON_INTAKE` case
   asserting `enabledPluginIds: ['ptah-python']`, plus — mirroring `:717-732` — that the external
   `astral` ref is reported missing and never silently enabled (`not.toContain('astral')`,
   `not.toContain('external:astral-sh/claude-code-plugins/astral')`). Without this, §C3's most
   security-relevant edit ships untested.
5. **`stack-profiles.spec.ts:229-233`** asserts `requiredPlugins` for node-ts only. Add the python
   assertion in the same shape, covering both the bundled id and the external `PluginRef` object.

### Specs verified as NOT breaking

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.spec.ts`
  — asserts ids with `toContain` and builds its own fixture `bundledDirs`; no `AVAILABLE_PLUGINS`
  length or exact-membership assertion.
- **`KNOWN_PLUGIN_IDS` has no spec asserting its exact contents** — it is derived by `.map()` at
  `plugin-loader.service.ts:185`, so no update is needed.
- `stack-profiles.spec.ts:229-233` asserts `requiredPlugins` for `node-ts` only; nothing asserts
  the dotnet or python plugin lists.
- `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\harness\new-project-dotnet.spec.ts`
  — `.NET`-only prompt snapshot; its `PLATFORM_LABELS` map (`:55`) hand-mirrors the registry but
  `python.label` is unchanged.
- `setup-hub.component.spec.ts:163-166` and `harness-rpc.schema.spec.ts:57-64` are registry-derived
  and self-healing; `toolchain-probe.spec.ts:128-132` reads `toolchain.probe` dynamically.
- `plugin-rpc.handlers.spec.ts:370,789` use `toHaveLength(2)` against a **stubbed**
  `getAvailablePlugins` returning `['alpha','beta']` — not the real catalogue.
- No Jest spec asserts `content-manifest.json` is in sync.

### CI gate — do not skip C4

`D:\projects\ptah-extension\.github\workflows\content-manifest.yml` runs `npm run manifest:self-test`
then `npm run manifest:check` on **any** change under `apps/ptah-extension-vscode/assets/plugins/**`.
Batch 1 therefore **fails CI on its own** until Batch 3 regenerates and commits
`content-manifest.json`. Land Batch 3 in the same PR.

### Untested surface to eyeball manually

`D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-browser-modal.component.ts:36-40`
carries a hand-maintained ordered category list commented _"MUST match categories defined in
plugin-loader.service.ts AVAILABLE_PLUGINS"_, with no spec guarding it. §C2 uses
`category: 'backend-tools'`, which is already in that list (`ptah-dotnet` and `ptah-nx-saas` use it),
so **no edit is needed** — but confirm the plugin renders rather than assuming it.

### Manual smoke

Electron New Project flow → platform `Python` → confirm the seed prompt now contains
_"ask me whether this workspace should be managed by `nx` (via `@nxlv/python`) or stay on plain
`uv init`"_, and that `ptah-python` appears in the plugin browser with 3 skills.

---

## Batching — 3 units

**Batch 1 — plugin content** (CREATE only, 6 files, §C1 + §B).
No dependency on Batch 2. Author `python-workspace-architect` first (the initializer and
`nx-python-workspace` both link to it), then the initializer, then `nx-python-workspace`.
Recommended: technical-content-writer or a developer working from the `ptah-dotnet` files.

**Batch 2 — registry + wiring** (MODIFY, §C2 + §C3 + §D + §E spec work).
Touches `plugin-loader.service.ts`, `stack-profiles.ts`, and four spec files —
`stack-profiles.spec.ts` (2 breaks + 1 new assertion), `harness-constants.spec.ts` (1 break),
`harness-rpc.handlers.spec.ts` (new python case). Independent of Batch 1 on disk.
Recommended: backend-developer.

**Batches 1 and 2 can run in PARALLEL** — disjoint file sets, no shared symbols. The only coupling
is agreed constants already fixed here: plugin id `ptah-python`, `skillCount: 3`, `commandCount: 0`,
and the three skill names.

**Batch 3 — manifest + verification** (§C4 + §E). **Depends on BOTH 1 and 2.**
`manifest:generate` needs the files on disk; the test run needs the registry edits. Must ship in
the same PR as Batch 1 or the `content-manifest` CI job fails.

### Developer type

`backend-developer` for Batches 2 and 3 (TypeScript data + Jest specs). Batch 1 is markdown
authoring — no frontend work anywhere in this task.

**Complexity: MEDIUM. Estimated effort: 6-9 hours** (Batch 1 ~4-5h of careful authoring;
Batch 2 ~2-3h including the two new spec cases; Batch 3 ~30m).
