# @ptah-extension/agent-generation

[Back to Main](../../../CLAUDE.md)

## Purpose

Project-adaptive agent generation: analyzes a workspace, applies orchestration patterns, and synthesizes agent files into `{ws}/.claude/agents` plus skill prompts. Powers the setup wizard. Also owns `UserLayerMirrorService`, which publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/`.

**Per-CLI agent transformation is NOT here.** `MultiCliAgentWriterService` and the Codex/Copilot/Cursor transformers moved to `@ptah-extension/harness-sync` in TASK_2026_278 Batch 2. Generation writes ONE format; the reconciler fans it out to whichever CLIs are installed, so generation no longer has to detect them and a CLI installed afterwards is populated by the next reconcile instead of never.

The boundary in one sentence: **agent-generation decides what a skill is and mirrors it; harness-sync copies it outward.** `UserLayerMirrorService` publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/{skills,commands}` and `~/.ptah/user/agents/<workspace-key>` — that IS the desired state `harness-sync` reconciles from into every CLI's harness dir. Nothing downstream of the mirror belongs in this lib.

**The agent root is per WORKSPACE, and the key comes from `libs/shared`** (`userLayerAgentDirName`, TASK_2026_365). Skills and commands are per-machine content; an agent is not, because the setup wizard tailors it to one project's stack and names it after the ROLE, so two projects write two different `backend-developer.md`. With a flat root they had one destination and `reconcileFileClone`'s fast-forward flipped it on every activation, with `harness-sync` rewriting each project's `.codex/agents` and `.github/agents` behind it. `getUserLayerRoots(workspaceRoot)` is the ONE place the scope is applied; every method reads its agent root from there, so a caller that forgets the argument lands in the unscoped base rather than in another project's directory. `seedLegacyAgents` carries the pre-key clones in once — agents are manifest-owned downstream, so introducing the key without a seed would have reaped every propagated copy on the first pass.

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

## Tailoring

A template body is a PRODUCT. It ships to a Django service, a Rails monolith or
a plain npm package, and every sentence in it has to be true there. The one place
this repository's — or any repository's — specifics belong is an `LLM:` section,
which `ContentGenerationService` rewrites from that user's own analysis at wizard
time:

```
<!-- LLM:FRAMEWORK_CONVENTIONS -->
## Framework conventions

<generic stack-agnostic fallback, 6-15 lines>
<!-- /LLM:FRAMEWORK_CONVENTIONS -->
```

Six ids, assigned by role: `FRAMEWORK_CONVENTIONS` and `ARCHITECTURE_PATTERNS`
(the two developers), `BUILD_AND_DEPLOY_SURFACE` (devops-engineer),
`TEST_INFRASTRUCTURE` (senior-tester), `EXISTING_PATTERNS` (software-architect),
`REVIEW_FOCUS` (the three reviewers). `sectionIdToTopic` maps each to the
sentence the prompt uses to say what a section of that name should contain — left
to a de-kebabbed id, "Framework Conventions" invited exactly the lib census this
mechanism was once deleted for.

**The no-numbers rule.** Generated sections carry conventions and patterns: no
counts, no version numbers, no percentages, no dates, no directory inventories,
and every bullet cites a path in backticks. This is enforced twice, because a
prompt alone never held it:

1. `formatAnalysisData` no longer shows the model a number it could copy —
   pattern confidence, language distribution, coverage estimate and the
   error/warning tally are dropped at the source. What survives is names, paths
   and conventions.
2. `GeneratedSectionValidator` reads what came back and rejects it for a
   version-like string outside a path, a numeric census ("15 libs"), a
   percentage, a date, a cited path that neither the analysis nor the workspace
   knows, or a dropped or renamed `## ` heading. On reject the authored fallback between the markers
   ships instead, a warn is logged, and a line lands in the generation summary's
   `warnings`. VAR sections are NOT gated — a VAR slot exists to carry data.

The allowed-path set is mined from the SAME analysis text the prompt shows the
model, plus `context.relevantFiles`, plus every ancestor directory. **The index
is not the only way a citation passes.** Each cited path is checked against the
index and, when that misses, against `IFileSystemProvider.exists()` — per path,
not one check instead of the other. The prompt lets the model open a file to
confirm a convention, so a file it really read that the analysis happened not to
list is a legitimate citation, and gating the disk probe on an empty index made
that ordinary case ship the fallback. A path fails only when the index does not
hold it AND the workspace does not contain it; when there is no port either,
path checking stands down rather than failing every section. The probe stays
inside `rootPath`: a `..` escape or an absolute path outside the root is
rejected without ever reaching the port, because the string being resolved was
written by the model.

**An empty section is an answer, not a failure.** The prompt tells the model to
return an empty string for a section whose evidence cannot carry it — fewer than
about six distinct path-backed claims — rather than pad to the 8-15 line target
with general advice. `fillDynamicSections` ships the authored fallback for it,
logs at DEBUG, and pushes NO warning: the outcome is identical to the one the
rejection path produces expensively, so surfacing it in the generation summary
would ask the user to act on the model behaving correctly. A rejection still
warns; an abstention does not.

**The prompt matches what is wired.** The call goes out with MCP tools
(`resolveMcpSessionWiring`), so the prompt says the model MAY open a file to
confirm a convention, and may cite only paths it actually opened or that the
analysis lists. The earlier "you have NO tools" sentence contradicted the wiring
and taught the model to guess where it could have checked.

**The fallback is not filler.** It is what ships when the SDK is unavailable,
when the validator discards the model's output, when the model abstains, or when
generation is skipped — four paths that all end with that text inside a user's
agent file.
`stripCompositionMarkers` (orchestrator) removes `STATIC`, `LLM` and `VAR` marker
LINES on emit and keeps everything between them. `TemplatePartialResolver` never
sees an `LLM` marker: it matches `STATIC:` only, and its residual-`{{…}}` scan is
scoped to an expanded partial's body, so authored fallback text cannot fail a
load.

**The description is authored, and only authored.** `buildAgentFileContent` uses
`template.description`, and when a template declares none it uses
`` `${humanizeName(template.name)} agent` `` — deterministic, stack-agnostic, no
analysis label in it. The authored description is the sentence every harness
selects an agent by: it carries the triggers AND the exclusions, written knowing
which sibling agents it must be distinguishable from. A generated summary knows
neither, and it was overwriting all fifteen. Once the template won that contest
the generated one-liner had no reachable success path — every shipped template
declares a description — so it is gone rather than kept as a fallback:
`ContentGenerationService` no longer asks for a `description` in the output
schema or the prompt, and `generateContent` returns `{ content, warnings }`.

**The Ptah-term guard.** `template-sharing.guard.spec.ts` carries a denylist with
a `why` per entry — `tsyringe`, `platform-core`, `libs/backend`, `daisyui`,
`manifest:check`, `run-many`, the rest — applied to every template body, every
frontmatter `description`, and every `_shared/` partial. Generic technology names
(`Prisma`, `Angular`, `NestJS`, `Nx`) are allowed only on a line that marks
itself illustrative (`e.g.`, `for example`, `such as`). Frontmatter
`projectTypes` / `techStack` are exempt: they are the applicability rules
`AgentSelectionService` scores against, a list of alternatives by construction.
When this duty fails, the fix is to delete the sentence, restate it generically,
or move it into an `LLM:` section — never to widen the list.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-sdk`
**External**: `tsyringe`, `zod`, `gray-matter`

## Guidelines

- LLM calls go through `InternalQueryService` (agent-sdk), not raw SDK.
- All analysis outputs validated via `ProjectAnalysisZodSchema` before downstream consumption.
- File writes go through `IFileSystemProvider` (platform-core); never use `node:fs` directly.
- A new rival CLI needs NOTHING here. Add a target in `harness-sync`'s `rival-targets.ts`.
- Anything that touches the AGENT root goes through `getUserLayerRoots(workspaceRoot)`. Never join `~/.ptah/user/agents` by hand: the reader in `harness-sync` derives the same key from `resolveHarnessWorkspaceRoot`, and a second spelling is a directory the other side never reads.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (wizard handlers). Should not import `rpc-handlers` (cycle).
