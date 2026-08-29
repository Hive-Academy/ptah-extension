# @ptah-extension/agent-generation

[Back to Main](../../../CLAUDE.md)

## Purpose

Project-adaptive agent generation: analyzes a workspace, applies orchestration patterns, and synthesizes agent files into `{ws}/.claude/agents` plus skill prompts. Powers the setup wizard. Also owns `UserLayerMirrorService`, which publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/`.

**Per-CLI agent transformation is NOT here.** `MultiCliAgentWriterService` and the Codex/Copilot/Cursor transformers moved to `@ptah-extension/harness-sync` in TASK_2026_278 Batch 2. Generation writes ONE format; the reconciler fans it out to whichever CLIs are installed, so generation no longer has to detect them and a CLI installed afterwards is populated by the next reconcile instead of never.

The boundary in one sentence: **agent-generation decides what a skill is and mirrors it; harness-sync copies it outward.** `UserLayerMirrorService` publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/{skills,commands,agents}` — that IS the desired state `harness-sync` reconciles from into every CLI's harness dir. Nothing downstream of the mirror belongs in this lib.

## Boundaries

**Belongs here**:

- Template storage and Markdown content generation
- Analysis pipeline (`AgenticAnalysisService`, `MultiPhaseAnalysisService`)
- Output validation, agent selection/recommendation services
- `AgentFileWriterService` — writes ONE generated format to `.claude/agents/` /
  `.claude/commands/`, the source `harness-sync` mirrors from, never a rival
  CLI's target dir
- Setup wizard child services + analysis zod schema

**Does NOT belong**:

- RPC handlers (those live in `rpc-handlers`)
- Platform IO (use `platform-core` ports / `vscode-core` wrappers)
- LLM provider implementations (use `agent-sdk`)

## Public API

Services: `TemplateStorageService`, `ContentGenerationService`, `OutputValidationService`, `AgentFileWriterService`, `AgentSelectionService`, `AgentRecommendationService`, `SetupStatusService`, `AnalysisStorageService`, `WizardWebviewLifecycleService`, `AgenticAnalysisService`, `MultiPhaseAnalysisService`.
Types/schemas: `ProjectAnalysisZodSchema`, `ProjectAnalysisZodOutput`, `OrchestratorGenerationOptions`, `CustomMessageHandler`, `WizardPanelInitialData`.
Helpers: `normalizeAgentOutput`, `resolveProjectType`.
DI: tokens via `./lib/di`, interfaces via `./lib/interfaces`, errors via `./lib/errors`.
Plus content processor utilities and orchestration patterns.

## Internal Structure

- `src/lib/services/` — generation, validation, writer, selection, recommendation, analysis storage
- `src/lib/services/wizard/` — wizard lifecycle + analysis services
- `src/lib/services/user-layer/` — `UserLayerMirrorService` + fs ops + orphan reaper
- `src/lib/patterns/` — orchestration patterns
- `src/lib/utils/content-processor/` — Markdown/frontmatter helpers
- `src/lib/types/`, `interfaces/`, `errors/`, `di/`

## Shared partials

The 15 subagent templates carry their cross-cutting rules ONCE, in
`templates/agents/_shared/`, and reference them as marker pairs on their own
lines:

```
<!-- STATIC:CLARIFICATION_PROTOCOL -->
<!-- /STATIC:CLARIFICATION_PROTOCOL -->
```

`TemplatePartialResolver` (injected into `TemplateStorageService`, called from
`loadTemplateFromDisk` right after `matter()`) replaces whatever sits between a
pair with the partial, then fills `{{SLOT}}` placeholders from the template's
frontmatter `variables` map. Composition happens HERE, before generation, so the
LLM pass, the `.claude/agents` writer and every rival-CLI target `harness-sync`
fans out to all receive one already-expanded plain file. The markers survive
resolution and `OrchestratorService.buildAgentFileContent` strips them on emit.

The registered ids are closed (`SHARED_BLOCK_IDS`): `CLARIFICATION_PROTOCOL`,
`TASK_SPEC_CONTRACT`, `REPLACEMENT_POLICY`, `TOOLING_PRECEDENCE`,
`CLI_DELEGATION`, `REVIEWER_STANCE`. An id outside that set, an id that is not `/^[A-Z_]+$/`, an
unpaired or nested marker, or a slot the template did not declare each FAIL the
load — never a silent pass-through, because the failure being fixed is exactly a
marker nothing acted on, leaking verbatim into every deployed agent.

**A partial goes only where it applies.** `REPLACEMENT_POLICY` is carried by the
nine roles that write code or plan the change someone else writes — the three
developers, devops-engineer, senior-tester, team-leader, ui-ux-designer,
video-director, plus software-architect and project-manager, who plan
replacements and must plan them without a compatibility shim. It is NOT carried
by the pure reporters (modernization-detector, the three reviewers,
researcher-expert, technical-content-writer), whose own output contract forbids
editing source: telling an agent to delete unused code in the same file that
tells it never to touch code is an instruction it cannot follow, and the rules it
does contradict lose authority alongside it. Adoption is not asserted as a count
anywhere — a partial is added to or removed from a template on that judgment, not
to hit a number.

**`TASK_SPEC_CONTRACT` has no file.** It is rendered by
`renderTaskSpecAgentBlock()` in `libs/shared`, beside the constants it derives
from. A `_shared/task-spec-contract.md` would be one more copy of the block that
already went stale in nineteen places at once.

Templates carry ONE frontmatter block. `name`, `description` and `model` are
read from it; the second `---name/description---` block that nothing parsed is
gone. `template-sharing.guard.spec.ts` pins all of this, plus the rule that no
H2/H3 heading may appear in two templates outside a shared block (the section
SKELETON — `Role`, `Inputs`, `Method`, `Output contract`, `Return value`,
`Refusals` — is exempt by name, and a separate assertion stops identical prose
being filed under it).

Headings **inside a fenced code block are exempt**: a `## Summary` in a
` ```markdown ` fence is a section of the report the agent is told to WRITE, not
a section of its own instructions. Four reviewers end their report with
`## Verdict` and the reports are comparable only because they do. Outside a
fence the rule is unchanged — a repeated heading is either specialist-specific
and needs a specialist name (`Five logic questions` vs `Five style questions`),
or it is genuinely shared and belongs in `_shared/` (`REVIEWER_STANCE`, the one
anti-sycophancy stance and score distribution behind code-logic-reviewer,
code-style-reviewer and visual-reviewer, whose only per-file slot is
`{{REVIEW_SUBJECT}}`).

Adding a partial means: a file in `_shared/`, an id in `SHARED_BLOCK_IDS`, and a
path in `content-manifest.json` `templates.files` — the manifest is what ships
it to `~/.ptah/templates/agents/_shared/`.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-sdk`
**External**: `tsyringe`, `zod`, `gray-matter`

## Guidelines

- LLM calls go through `InternalQueryService` (agent-sdk), not raw SDK.
- All analysis outputs validated via `ProjectAnalysisZodSchema` before downstream consumption.
- File writes go through `IFileSystemProvider` (platform-core); never use `node:fs` directly.
- A new rival CLI needs NOTHING here. Add a target in `harness-sync`'s `rival-targets.ts`.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (wizard handlers). Should not import `rpc-handlers` (cycle).
