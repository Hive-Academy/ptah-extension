# Batch 3b executor report: TASK_2026_609_c495, Task 3.2

Executor: backend-developer (sub-agent). I ran no git commands and did not edit batches.md or task.md.

## Task 3.2: COMPLETE

### Files (all absolute, exactly these two)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`

### What changed in the service (current line numbers)

- **Imports.**
  - From `@ptah-extension/shared`: `isAgentModelEmittable`, `matchesAgentModelSyntax`, `resolveAgentModel`, and the type `AgentModelLayers`.
  - From `@ptah-extension/settings-core`: `SETTINGS_TOKENS`, and the type `AgentModelSettings`. This is the same import style as `content-generation.service.ts:38-39`.
- **:271 injection.** The constructor gets one more parameter, last in the list: `@inject(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS, { isOptional: true }) private readonly agentModelSettings?: AgentModelSettings`. No registration change is needed: tsyringe resolves the class, and only the spec calls `new`.
- **:771 one read per run.** `produceAgents` calls `readAgentModelLayers(options.workspacePath)` once, before the per-agent loop.
- **:828 one value per agent.** `const model = this.resolveClaudeModel(agentModelLayers, template)` is passed through `resolveAgentContent`, then to:
  - the generated path, `buildAgentFileContent(rawContent, template, model)` at :973 (the former ~:948);
  - the authored-fallback path, `renderStaticFallbackContent(…, model)` → `buildAgentFileContent(body, template, model)` at :1081 (the former ~:1054).

  Both callers get the same value.
- **:1090 `readAgentModelLayers`.**
  - Token absent: returns `null`.
  - `layersForPath` throws (for example on an empty path): logs `logger.warn('Could not read agentGeneration.models; using each template model', { error })` and returns `null`.
  - It never throws.
- **:1113 `resolveClaudeModel`.**
  - Calls `resolveAgentModel(layers, template.name, 'claude')?.value`. That function owns precedence and tolerance of malformed shapes.
  - The value is trimmed. The trimmed candidate is accepted only when both `isAgentModelEmittable('claude', c)` and `matchesAgentModelSyntax('claude', c)` return true, and the trimmed candidate is what gets emitted.
  - Otherwise it logs `logger.warn('Ignoring the Claude model override for <name>: expected opus, sonnet, haiku or inherit; using the template model', { value: JSON.stringify(raw), templateModel })` and returns `template.model?.trim() || undefined`.
  - With no override, the result is the template model, trimmed exactly as before.
- **:1193 `buildAgentFileContent`.** It now takes `model: string | undefined` and pushes `model: ${model}` when the value is set. The `disallowedTools` lines at :1195-1198 are unchanged and still come after `model:`.

## Evidence per spec case

All cases are in `describe('Claude model override from agentGeneration.models')` at spec :1559. They use the real shared `resolveAgentModel` and classifiers. `layersForPath` is a stub. settings-core is mocked at spec :67, as the sibling specs do (`content-generation.service.spec.ts:13`).

| Required case | Spec (line) | Asserts |
| --- | --- | --- |
| Workspace per-agent value | :1590 | `model: haiku` over the template `opus`; `layersForPath` called with the workspace path |
| Workspace `*` | :1600 | `model: sonnet` from `'*'` when only another agent has its own entry |
| Machine fallback when the workspace layer is empty | :1611 | `workspace: {}` and machine `inherit` → `model: inherit` |
| Workspace beats machine | :1620 | workspace `haiku` against machine `sonnet` → `haiku` only |
| Invalid value → template | :1638 (it.each ×3: `claude-sonnet-4-7`, `opus\nevil: true`, `son net`) | `model: opus`, exactly one `model:` line, no injected `evil`, and the warn carries the JSON-quoted value |
| Token absent → template | :1681 | `model: opus`, no warn |
| Template without a model + override → `model:` emitted | :1725 | machine `'*'` `sonnet` → `model: sonnet` |
| `disallowedTools` still present | :1739 | `code-logic-reviewer` with override `haiku` → the `disallowedTools:` line is present, after `model: haiku` |

Extra cases for the stated rules:

- :1630: a stored `'  sonnet \t'` emits `model: sonnet`, the trimmed form.
- :1659: an invalid override on a template with no model emits no `model:` line.
- :1673: a Codex-only value is never used for Claude.
- :1687: `layersForPath` throws → template model, agent still written, warn carries the error message.
- :1702 (it.each ×5): malformed layers (a string, `null`, array layers, a non-object slug entry, a non-string leaf) → template model, agent written.
- :1759: the authored-fallback path (generation fails) emits the same override.
- :1786: with two agents, `layersForPath` is called exactly once, and each agent resolves by its own name (`haiku` from its own entry, `sonnet` from `'*'`).

The existing #634 cases at spec :1447-1556 (template `model:`, no-model omission, `disallowedTools` order, single line on re-generation) pass unchanged.

## Checks (tails)

1. `npx prettier --write` on the two files.
2. `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --skip-nx-cache`
   ```
   √  nx run @ptah-extension/agent-generation:lint
   √  nx run @ptah-extension/agent-generation:typecheck
   NX  Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation
   ```
3. `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2 --skip-nx-cache --output-style=static`
   ```
   Test Suites: 36 passed, 36 total
   Tests:       1 skipped, 1240 passed, 1241 total
   NX  Successfully ran target test for project @ptah-extension/agent-generation
   ```
   - The baseline was 1219 passed (batches.md Batch 4 note). The +21 matches the new cases exactly.
   - Jest printed one warning, "Failed to load the ES module ... jest.config.ts". It is pre-existing and harmless.
   - No harness-sync failure appeared; that project is not in scope here.

## R8 handling

R8: an invalid `agentGeneration.models` value writes a `model:` line that Claude Code rejects.

- **Accepted values.** Only a value that, after trimming, passes both the shared `isAgentModelEmittable('claude', …)` (non-blank, no control or line-separator characters) and `matchesAgentModelSyntax('claude', …)` (`^(?:opus|sonnet|haiku|inherit)$`) is emitted.
- **Trimming.** The trimmed form is what gets written, never the raw stored string, so stray whitespace cannot reach the frontmatter.
- **Rejected values.** Anything else produces one `logger.warn` per agent, with the value JSON-quoted so control characters are visible, and falls back to `template.model`. No `model:` line is written when the template has none.
- **Injection.** Because the value is checked before interpolation, a value containing a newline cannot add frontmatter keys. The `opus\nevil: true` spec case pins this.
- **No failure path.** A missing token, a throwing read or malformed layers all degrade to `template.model` without throwing, so an agent is never lost to a settings problem.

## Plan deviations

None. The slug passed to `resolveAgentModel` is `template.name`, per batches.md Task 3.2. For the shipped templates `id === name`, the same kebab slug used in the `name:` frontmatter and by `formatDisallowedToolsFrontmatter`.

## Out-of-scope observations

None.
