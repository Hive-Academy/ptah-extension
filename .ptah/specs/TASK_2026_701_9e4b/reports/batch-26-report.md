# Backend implementation — `TASK_2026_701_9e4b`, batch 26

**Tasks completed**: 26.1 Rules module, invocable plugin-skill gate, pinned rubric agreement

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\agent-generation\src\lib\services\`.

| Action | File | Lines | Purpose |
| --- | --- | --- | --- |
| CREATED | `generation-prompt-rules.ts` | 71 | `GENERATION_RUBRIC_RULES` (rules 2, 3, 5, 6, 7, 8: rule, title, instruction) and `formatRubricRulesBlock()` |
| CREATED | `generation-prompt-rules.spec.ts` | 145 | Hand-written pinned table and the two-sided agreement test |
| CREATED | `invocable-plugin-skills.ts` | 43 | `selectInvocablePluginSkills(agentType, skills, disabledSkillIds)` permission gate |
| CREATED | `invocable-plugin-skills.spec.ts` | 61 | Tests for unknown type, `Skill` disallowed, unknown policy, disabled skill, and keep-all |
| MODIFIED | `content-generation.service.ts` | 1266 (+90/-) | RUBRIC RULES block; rule-7 duplicates removed from FORBIDDEN; gated plugin-skill block with the new wording; optional injected skill-policy reader |
| MODIFIED | `content-generation.service.spec.ts` | 2583 (+343/-) | Fixture agent type; existing plugin-skill test updated; new describe block for rubric rules, the gate, the 6.7 case and the 6.5 check |
| MODIFIED | `subagent-tool-allowlist.ts` | +17/- | Exports `hasSubagentToolPolicy` (`:91`); `getSubagentDisallowedTools` now calls it |

Not touched: `generated-section-validator*`, `subagent-tool-allowlist.spec.ts`, `orchestrator.service.ts`, and anything under `libs/backend/rpc-handlers`.

## How each quality requirement is met

| Requirement | Evidence |
| --- | --- |
| Pinned table written by hand in the spec (title, body sha256, instruction sha256) | `generation-prompt-rules.spec.ts:22-76`. The table imports nothing from the module. Body hash = sha256 of the text under `## <n>. <title>` up to the next `## `, with whitespace collapsed. The rubric is read from the repo root (`:78`). A rubric-only edit fails the heading/body test (`:114`). A prompt-only edit fails the instruction hash test (`:123`). Rule set and order are pinned at `:108`. |
| Prompt contains every rubric instruction verbatim | The service inserts `${formatRubricRulesBlock()}` in the system prompt (`content-generation.service.ts:398`). The test that runs the real service builder is `content-generation.service.spec.ts:2416`, and the block format is tested at `generation-prompt-rules.spec.ts:132`. |
| Unknown type or `Skill` disallowed → no plugin-skill block | Gate: `invocable-plugin-skills.ts:31-43`. An unknown policy (`null`) also returns `[]`. In the service, the block is added only when the gated list is non-empty (`content-generation.service.ts:407-416`). Tests: `invocable-plugin-skills.spec.ts` covers all cases. `content-generation.service.spec.ts:2446` covers an unknown type, `:2458` a disabled skill, `:2475` an unreadable or absent policy, and `:2519` `Skill` disallowed. |
| Plugin-skill block wording (plan B14) | `content-generation.service.ts:413` reads "Reference only skills relevant to this agent's role; every skill listed here is one this agent may invoke." The old "where relevant" text is asserted absent in the updated test (about spec `:1015-1030`). |
| 6.7 representative case with its limits stated | `content-generation.service.spec.ts:2505-2563`. The limits are written in the doc comment at `:2512`. Fixture type `skill-less-fixture` denies `Skill`, added through `jest.mock('./subagent-tool-allowlist')`; real types keep their real policy. (a) The prompt and system prompt carry no block and no mention of the skill. (b) The real pipeline runs with the real default `GeneratedSectionValidator` and a stub LLM whose output cites every skill listed in the prompt's skill block. The section is accepted (`tailoredSections === 1`) and contains no reference. (c) The authored fallback contains no reference. A control case (`:2430`) shows the same stub does cite the skill for `backend-developer`, so the negative assertions can detect a mention. |
| No `TASK_\d{4}_\d+` or dates in generated output | `content-generation.service.spec.ts:2565` runs on representative stubbed output: no task id, no ISO date, no year. The rules block itself is checked at `generation-prompt-rules.spec.ts:140`. |
| `generated-section-validator` specs unchanged | Not in the diff (`git diff --stat -- libs/backend/agent-generation` lists only the 3 modified files above, plus the 4 new files). |
| Conventions | Injected `Logger` only, with `warn` on an unreadable policy. The catch carries a `degradation-audit: optional-capability` justification. Both new types use `import type`. `@inject(SDK_TOKENS.SDK_PLUGIN_LOADER, { isOptional: true })` uses an existing token, so no registration or `expected-resolvable` change is needed. No `any` and no `as unknown as` in production code. No new external boundary, so no new Zod schema: the policy comes from `PluginLoaderService`, which already validates it. |

## Handler (`wizard-generation-rpc.handlers.ts`): NOT touched

A-dis is false as written: `disabledSkillIds` does not reach the generator through the sdk config today. Routing it that way would need three edits:

- `wizard-generation-rpc.handlers.ts` (`resolveRuntime` / `buildOptions`)
- `orchestrator.service.ts`, which builds the `ContentGenerationSdkConfig` at about `:803`. The plan missed this file, and it is outside this batch.
- the orchestrator options type

Instead, `ContentGenerationService` reads the policy itself. It uses an optional injected `Pick<PluginLoaderService, 'getEffectivePluginConfig'>` and calls `getEffectivePluginConfig(context.rootPath)`. That is the workspace config layered over the global layer, the same config home the handler uses (`content-generation.service.ts:194, 560-615`). The handler is not edited, so there is no D34 flag for this batch.

## Verification

1. `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli`
   - Result: `NX   58 tasks: 57 succeeded, 26 cached, 1 failed` / `✖ nx run @ptah-extension/agent-generation:test`.
   - Cause: 6 negative assertions searched for `'Available Plugin Skills'`. The rule-8 instruction itself names that list, so the text was present even without the block. The assertions now target the block heading `'## Available Plugin Skills'`. This was a test-only fix with no production change.
   - All lint, typecheck and test tasks for ptah-electron, ptah-extension-vscode and ptah-cli passed in this run.
2. Re-ran the failing project only: `npm run verify -- -p @ptah-extension/agent-generation`
   - Result: `NX   3 tasks: 3 succeeded` (lint, test, typecheck); `lock released after 77.2s, exit code 0`.
3. `ptah_get_diagnostics` on the changed service and specs: 0 errors.
4. `@ptah-extension/rpc-handlers` was not run because the handler was not edited.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Get `disabledSkillIds` from an optional injected plugin-policy reader in `ContentGenerationService` | (a) sdk config through handler + orchestrator; (b) inject the reader | Today the sdk config is built in `orchestrator.service.ts:~803` from orchestrator options, and the handler only feeds those options. (a) needs 3 files outside the batch, including one not in the plan. (b) uses an existing token, `SDK_TOKENS.SDK_PLUGIN_LOADER`, registered in `agent-sdk/src/lib/di/register.ts:859` for every host. | yes |
| Unknown, unreadable or absent skill policy → no plugin-skill block | (a) list all skills; (b) list none | PM11 / req 6.6 conservative reading. `getEffectivePluginConfig` throws `CapabilityPolicyUnknownError` by design ("unknown is never answered as nothing is off"). | yes |
| Disabled skills are matched on the frontmatter `skillName` from `discoverPluginSkills` | match on directory id (needs a different discovery API) | `PluginSkillInfo` has no directory id. Ptah skills use name = directory. | yes |
| Remove the FORBIDDEN bullets for counts, versions and inventories; keep percentages and dates | keep all bullets | Plan B14: "existing FORBIDDEN/REQUIRED text stays where it does not duplicate rule 7". The rule-7 instruction now carries those specifics. No spec pinned the removed system-prompt lines; the user-prompt rules at `buildAllSectionsPrompt` are unchanged. | yes |
| The "built prompt contains every instruction" test lives in the service spec, not the rules spec | rules spec | Only the service spec has the SDK/fs mocks needed to build the real prompt. The rules spec still pins both hash sides. | yes |
| Fixture agent type through `jest.mock` of the allowlist module (spec only) | add a test-only entry to the production map | No shipped type denies `Skill`. Production policy stays unchanged. | yes |

## Open issues

1. **CI reach of a rubric-only edit.** CI runs `nx affected -t test` (`.github/workflows/ci.yml:233`). The rubric lives under `.claude/`, which belongs to no Nx project, so a PR that edits only the rubric does not mark `agent-generation` affected. The Nx cache may also hit. Today such an edit is caught by the nightly `run-many --all` (`nightly-coverage.yml:73`) or by any PR that touches agent-generation. Recommended fix (outside this batch): in `libs/backend/agent-generation/project.json`, add `{workspaceRoot}/.claude/skills/skill-creator/references/prompt-authoring-rubric.md` to the test target `inputs`, or add an implicit trigger.
2. `enhanced-prompts/enhanced-prompts.service.ts:985` still lists plugin skills with no gate. It is outside B14 scope.
3. Policy scope mismatch. The handler resolves `pluginPaths` from the active workspace config, while the gate reads the policy for `context.rootPath`. For a root the host has no storage for, the disabled list reads as empty.
4. The worktree has unrelated uncommitted changes that are not from this batch: `decisions.md` and three marketplace files plus a fixtures file. The coordinator should stage only the 7 files listed above.
