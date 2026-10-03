# Backend implementation — TASK_2026_609_c495, batch B-5e

Task B-5e.1 completed. All four rival transformers emit a non-empty explicit model; absent/empty models retain prior output. No source files beyond the six assigned files were edited. No git commands were run.

## Files changed

Base: `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\transformers\`

- MODIFIED `codex-agent-transformer.ts` — optional TOML model, using the existing basic-string helper with full control escaping for models. Legacy name/description escaping stays unchanged.
- MODIFIED `copilot-agent-transformer.ts` — optional quoted YAML model after the existing content transformation.
- MODIFIED `cursor-agent-transformer.ts` — optional quoted YAML model after the existing content transformation.
- MODIFIED `opencode-agent-transformer.ts` — optional quoted YAML provider/model field in the rebuilt frontmatter.
- MODIFIED `agent-transformers.spec.ts` — Codex/Copilot/Cursor exact absent/empty output, replacement and parser round-trip regressions; markdown sources without frontmatter and model vocabulary preservation.
- MODIFIED `opencode-agent-transformer.spec.ts` — exact absent/empty output and escaped provider/model replacement round-trip.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b5e-executor-report.md` — this report.

## Syntax and existing-model findings

| Provider | Emitted syntax | Prior treatment of source `model: opus` | With explicit target model |
| --- | --- | --- | --- |
| Codex | `model = "value"` in `.codex/agents/<id>.toml` | `transformAgentBody` strips the source frontmatter; TOML metadata is rebuilt without model | One TOML model key; backslashes/quotes escaped, U+0000–001F and U+007F encoded as `\uXXXX` |
| Copilot | `model: "value"` in `.github/agents/<id>.agent.md` | `rewriteFrontmatter` reconstructs a fixed set of fields, discarding the source model | One YAML model key inserted after transformation, using `yamlDoubleQuoted` |
| Cursor | `model: "value"` in `.cursor/agents/<id>.md` | Same `rewriteFrontmatter` behavior as Copilot | One YAML model key inserted after transformation, using `yamlDoubleQuoted` |
| OpenCode | `model: "provider/model"` in `.opencode/agent/<id>.md` | `transformAgentBody` strips source frontmatter; transformer rebuilds description/mode/ownership fields | One YAML model key in the rebuilt frontmatter, using `yamlDoubleQuoted` |

All four continue discarding the source model when the explicit input model is undefined or empty. Full-string expected-output tests cover both cases per format; existing tests and assertions were retained unchanged. Model insertion after vocabulary rewriting prevents model identifiers from being rewritten as instruction text. Replacement callbacks preserve literal `$&` sequences.

The port states that model input has already passed `isAgentModelEmittable`; YAML reuses the existing helper within that contract (controls/newlines rejected upstream). Codex additionally round-trips every C0 control and DEL in its serializer test, as requested. Parsers `smol-toml` and `yaml` already exist in the lockfile and installed dependencies; no dependency or manifest changes were needed.

## A-2 provider support for B-5g

**Supported: codex, copilot, cursor, opencode. Unsupported for B-5g: none.** These are format confirmations from official documentation, not claims that arbitrary model identifiers are available to a particular account. No paid/live CLI inference was performed.

- Codex: official documentation describes project `.codex/agents/*.toml` files and shows a top-level model field in custom-agent examples. Verified using the OpenAI Docs skill. [Official custom agents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents).
- Copilot: the YAML property table explicitly applies to Copilot CLI and lists the model string property. [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration#yaml-frontmatter-properties).
- Cursor: the page explicitly includes CLI support and documents the model frontmatter field. Plan/admin restrictions may cause provider-side fallback. [Subagents](https://cursor.com/docs/subagents).
- OpenCode: the Markdown example includes `mode: subagent` and a provider/model field. The existing transformer documents a v2.0.12 live probe confirming singular `.opencode/agent` discovery as well as plural discovery; this batch retains that path. [Agents Markdown format](https://opencode.ai/docs/agents/#markdown).

## Stack and boundaries observed

- TypeScript 6.0.3 from root `package.json` and `package-lock.json`; pure TypeScript transformers with no server framework, I/O, logging or DI additions. Construction and the typed input contract follow `agent-transformer.port.ts` and the four existing implementations.
- `project.json` identifies `@ptah-extension/harness-sync` as `scope:extension`, `type:feature`, with Nx Jest, ESLint and TypeScript targets. `eslint.config.mjs` supplies the scope/type import boundaries; changes use existing shared aliases and local transformer imports only.
- Input model resolution/validation stays upstream per `HarnessAgentSource.model` and the B-5d contract. No provider-list classification added.
- Read task context, B-5e batch, relevant implementation-plan contracts, root README and CONTRIBUTING. No applicable AGENTS/CLAUDE files were found in the touched hierarchy. Direct ptah AST/search/diagnostics were used; a direct file-content reader was not listed, so native reads supplied implementation text.

## Verification

Commands used PowerShell `Select-Object -Last` as the equivalent of the requested `tail`.

`npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync 2>&1 | Select-Object -Last 30`

Final output excerpt:

```text
√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck
NX   Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
Run duration:      5.0s
Cache:             0/2 hit (0%)
```

`npx nx test @ptah-extension/harness-sync --maxWorkers=2 --testPathPatterns=transformers 2>&1 | Select-Object -Last 40`

Final output excerpt (exit 0):

```text
Test Suites: 4 passed, 4 total
Tests:       67 passed, 67 total
Snapshots:   0 total
Time:        4.384 s
Ran all test suites matching transformers.
NX   Successfully ran target test for project @ptah-extension/harness-sync
Run duration:      5.3s
Cache:             0/1 hit (0%)
```

- `ptah_get_diagnostics`, scoped to all six changed source/spec paths: TypeScript compiler, clean coverage, 0 errors, 0 warnings.
- `npx prettier --check` on exactly the six files: all matched files use Prettier code style; exit 0.
- Initial checks exposed callback narrowing errors and `no-control-regex`. Fixed by capturing the model in a local constant and encoding controls by character code, without lint suppression. Final checks above were run after those fixes.
- Nx emitted its existing executor-deprecation and cloud-quota messages: `This Nx Cloud organization has been disabled due to exceeding the FREE plan` (401). Local targets passed. Lint's five warnings were in unrelated existing files (gitignore writer, preflight service/spec, Codex project trust, workspace target); none was in the six edited files.
- No workspace-wide tests/build were run. The reported unrelated baseline failures were outside the requested transformer filter.

## Plan deviations / limitations

None in implementation scope. No edits to the port, transform-rules, registrations, dependencies, task state or other batch files. B-5g may enable all four provider rows based on the format evidence above while retaining its planned model validation and provenance rules.
