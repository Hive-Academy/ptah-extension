# P4 fix re-review — Batch 26, findings 1 and 2

Review family: Ollama Cloud (Glm), implementer Claude.

Scope: only the two findings this fix round targeted. Findings 3-5 from
`reviews/p4-code-logic-review.md` are deferred by the orchestrator and are not
re-raised. Read-only re-review of commit `39e3d59c3` (`reviews/p4-fix-diff.patch`),
the current worktree state of the changed files, `reports/p4-fix-report.md` and
the orchestrator's affected-project evidence. The worktree matches the commit;
no tracked file carries uncommitted task changes.

## Finding 1 — disabled-skill filter used the wrong id domain: RESOLVED

The gate now filters on the directory id, and every producer supplies it.

- `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts:44`
  returns `skills.filter((skill) => !disabled.has(skill.skillId))`. The JSDoc
  at `:26-27` names the id domain.
- `PluginSkillInfo` gained a required `skillId`
  (`libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:24`), and
  its only producer sets it to the directory name: `discoverPluginSkills`
  reads `skills/` with `readdirSync` (`:49`, `:54`) and pushes
  `skillId: entry` (`:69`).
- The gate now matches the policy on both ends. The save handler validates
  `disabledSkillIds` against `discoverSkillsForPlugins(...).skillId`
  (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:431-433`),
  and the loader sets the same `skillId: entry` there
  (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1746`).
  Gate, discovery producer and stored policy all use the directory id.
- Every producer sets the field. A workspace-wide search finds no constructor
  of `PluginSkillInfo` outside `discoverPluginSkills`
  (`plugin-skill-discovery.ts:67-72`). The only object literals typed as
  `PluginSkillInfo` are spec fixtures
  (`invocable-plugin-skills.spec.ts:26,42,48`;
  `content-generation.service.spec.ts:984` and `:2309`), and each carries
  `skillId`. The old partial fixture `{ name, description } as never` was
  replaced by a full object, so no fixture reaches the filter with
  `skillId === undefined`. No app or other package constructs the type.
- Regression tests cover `name != directory` in both directions:
  - `invocable-plugin-skills.spec.ts:80` — disabling directory id
    `code-review` excludes the skill named `Acme Code Review`.
  - `invocable-plugin-skills.spec.ts:88` — a skill whose frontmatter name
    equals another skill's disabled directory id is kept. This is the
    false-exclusion direction of the original bug.
  - `invocable-plugin-skills.spec.ts:98` — a frontmatter name in the
    disabled list does not exclude. This pins the id-domain contract.
  - The producer is pinned by the new
    `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.spec.ts:37`
    (directory `code-review`, frontmatter `name: Acme Code Review`, assertion
    at `:45`) and `:55` (the equal case, assertion at `:59`), against real
    `SKILL.md` files in a temp dir.
  - The service-level test now disables `ROLE_SKILL.skillId`
    (`content-generation.service.spec.ts:2467`), so the end-to-end gate test
    also exercises the id domain.

The original failure scenario no longer reproduces: a skill whose frontmatter
name differs from its directory is excluded when its directory id is disabled,
and a differently-id'd skill that merely shares the name is not excluded.

## Finding 2 — rubric-only edit did not mark agent-generation affected: RESOLVED

- `libs/backend/agent-generation/project.json:26-31` declares the `test`
  target `inputs`: `default`, `^production`, `jestRuntime`, plus
  `{workspaceRoot}/.claude/skills/skill-creator/references/prompt-authoring-rubric.md`.
- The three repeated entries match the `@nx/jest/plugin` targetDefaults list
  exactly (`nx.json:148`), so the project-level replacement drops nothing.
  `jestRuntime` is a defined named input (`nx.json:35`). The
  `{workspaceRoot}/` pattern follows the existing api-* precedent
  (`nx.json:134`).
- Orchestrator evidence: `npx nx show projects --affected --files=.claude/skills/skill-creator/references/prompt-authoring-rubric.md`
  now lists `@ptah-extension/agent-generation` first, followed by its
  dependents. A rubric-only PR therefore marks the project affected, and
  `nx affected -t test` in PR CI runs `generation-prompt-rules.spec.ts` — the
  test the batch exists to enforce.

Non-blocking note: the copied targetDefaults entries must be updated by hand
if `nx.json` changes later. The `"//"` comment at `project.json:25` records
this and the fix report discloses it as an open issue. Documented maintenance
risk, not a defect.

## New defects

No new Blocking or Serious defect.

- The interface change is additive with one required field. The only
  construction sites are the producer and updated spec fixtures. The
  implementer's scoped verify run (agent-generation, agent-sdk, ptah-electron,
  ptah-extension-vscode, ptah-cli — 60 tasks, the one failure being the
  pre-existing agent-sdk lint, D21) supports compilation across hosts.
- The `project.json` change affects only affected-detection and cache
  invalidation for one test target, which is its purpose.
- The gate logic is otherwise unchanged from the reviewed version.

Score rationale: the Serious id-domain defect and the CI-trigger hole are
closed, each with regression tests on both sides. Deferred findings 3-5 (one
Moderate, two Minor) and the documented manual-sync note on the inputs copy
remain.

Verdict: APPROVED — 8/10