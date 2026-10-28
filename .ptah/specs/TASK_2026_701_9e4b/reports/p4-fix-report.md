# P4 fix report — Batch 26, review findings 1 and 2

Scope: findings 1 (Serious) and 2 (Moderate) from `reviews/p4-code-logic-review.md`.
Findings 3-5 are deferred and were not touched. Nothing was committed (git is owned by
the coordinator). `wizard-generation-rpc.handlers.ts` and the setup-wizard were not touched.

## Finding 1 — disabled-skill filter used the wrong id domain (fixed)

- `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:24` — added the field
  `skillId: string` to `PluginSkillInfo`. This is an additive change. The doc comment says
  `skillId` is the directory id that `disabledSkillIds` and the plugin loader use, and
  that it can differ from `skillName`.
- `plugin-skill-discovery.ts:69` — `discoverPluginSkills` now sets `skillId: entry`, the
  directory name under `<plugin>/skills/`. This is the same value the loader uses
  (`plugin-loader.service.ts:1746`, `skillId: entry`).
- `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts:44` — the
  filter is now `!disabled.has(skill.skillId)`. The JSDoc at `:26-27` names the id domain.
- Other consumers: `PluginSkillInfo` is only built by `discoverPluginSkills`. Production
  readers (`content-generation.service.ts`, `enhanced-prompts.service.ts`,
  `multi-phase-analysis.service.ts`, `formatSkillsForPrompt`) only read the existing
  fields, so no production code changed. The only object literals typed as
  `PluginSkillInfo` are spec fixtures, updated below.
- Fixture and spec updates:
  - `content-generation.service.spec.ts:984` and `:2309` — fixtures now carry `skillId`.
  - `content-generation.service.spec.ts:2467` — the disabled-policy test now disables
    `ROLE_SKILL.skillId`, the id domain, instead of `skillName`.
  - `invocable-plugin-skills.spec.ts` — fixtures carry `skillId`. New regression tests:
    - `:80` a disabled directory id excludes a skill whose frontmatter name differs
      (`code-review` / `Acme Code Review`).
    - `:88` a skill whose frontmatter name equals another skill's disabled directory id
      is kept.
    - `:98` disabling by frontmatter name does not exclude the skill.
  - NEW `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.spec.ts` — no
    discovery spec existed before. It writes real `SKILL.md` files into a temp dir and
    asserts `skillId` = directory and `skillName` = frontmatter name. It covers both the
    case where they differ and the case where they are equal.

## Finding 2 — a rubric-only edit did not trigger the pinned spec (fixed)

- `libs/backend/agent-generation/project.json:24-32` — the `test` target now declares
  `inputs`: `["default", "^production", "jestRuntime",
  "{workspaceRoot}/.claude/skills/skill-creator/references/prompt-authoring-rubric.md"]`.
  The first three repeat the `@nx/jest/plugin` targetDefaults entry (`nx.json:148`),
  because project-level `inputs` replace the default list and do not add to it. A `"//"`
  comment records this, following the precedent in the `libs/api/*` project.json files.
  `nx.json` is unchanged.
- The `{workspaceRoot}/` input convention matches `tools/di-lint/project.json`,
  `tools/degradation-audit/project.json` and the nx.json test entry for `api-*`.
- Evidence:
  - `nx show project @ptah-extension/agent-generation --json` resolves the test inputs to
    the four entries above.
  - `nx show projects --affected --files=.claude/skills/skill-creator/references/prompt-authoring-rubric.md`
    returns `@ptah-extension/agent-generation` first, followed by its dependents. Before
    this change, `.claude/` belonged to no project.
  - Nx is 24.0.0 and `nx.json` has no `affected.legacy`.

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts`
- CREATED `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.spec.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.spec.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/content-generation.service.spec.ts`
  (spec fixtures only, needed to compile against the new field)
- MODIFIED `libs/backend/agent-generation/project.json`

## Verification

`npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/agent-sdk,ptah-electron,ptah-extension-vscode,ptah-cli`
was run once, in the foreground (it moved to the background on the tool timeout and was
awaited to completion). Filtered summary:

```
 NX   61 tasks: 60 succeeded, 19 cached, 1 failed
✖ nx run @ptah-extension/agent-sdk:lint
```

- The only failure is `@ptah-extension/agent-sdk:lint`, the accepted pre-existing failure
  (D21).
- To show this change did not add to it: `npx eslint` on
  `plugin-skill-discovery.ts` and `plugin-skill-discovery.spec.ts` exited 0 with no output.
- `ptah_get_diagnostics` on both new or changed spec files: 0 errors.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Add `skillId` to `PluginSkillInfo` instead of switching the gate to the loader's `discoverSkillsForPlugins` | (a) extend `PluginSkillInfo` (b) call the loader's scan from the gate | The brief preferred (a). It keeps one discovery call and is additive. Only spec fixtures needed updates. | yes |
| Make `skillId` required, not optional | required / optional | Its only producer always sets it. An optional field would let a fixture skip it and quietly bring back the wrong-domain bug. | yes |
| Repeat the default test inputs in project.json | repeat defaults / edit nx.json | The brief forbids editing nx.json. Project `inputs` replace the targetDefaults list, so `jestRuntime` must be repeated or the Jest config inputs would be lost. | yes |
| Add a new agent-sdk discovery spec | add / skip | No spec existed. Without one, nothing would pin that the producer sets the directory id. | yes |

## Open issues

- Findings 3-5 are deferred, as instructed.
- If the `@nx/jest/plugin` targetDefaults `inputs` in `nx.json` change later, the copy in
  `libs/backend/agent-generation/project.json` has to be updated by hand. The `"//"`
  comment records this.
