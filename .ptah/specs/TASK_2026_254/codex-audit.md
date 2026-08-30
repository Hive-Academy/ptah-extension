# Independent audit: subagent templates and shipped skills

Scope: the 15 files in `libs/backend/agent-generation/templates/agents/` and the four requested skill directories. Line counts are current working-tree counts. Targets are estimates for the source files, including generator metadata.

The template files intentionally contain two YAML-delimited regions: the first is parsed and removed by `template-storage.service.ts`; the second becomes the generated Claude agent frontmatter. The generated artifact therefore has one frontmatter block. This is a generator constraint, not itself a formatting defect. The inner descriptions are all under 1,024 characters and say what the agent does, but none states when to use it. No template declares `tools` or `model`; that is appropriate unless a role needs a restricted tool surface or non-default model.

## A. Agent-template verdicts

| Template                               | Verdict and target             | Description quality                                                                                                                           | Top three cuts                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend-developer.template.md`        | Restructure; target 180 lines. | Specific function; no usage triggers (`backend-developer.template.md:16`).                                                                    | Move task/clarification contracts to shared preamble (`:20-49`); replace the SOLID/DRY/YAGNI/KISS tutorial with six decision rules (`:53-209`); remove the repeated critical rules, anti-patterns, tips, and motivational ending (`:531-680`).                                                                                             |
| `code-logic-reviewer.template.md`      | Trim; target 210 lines.        | Clear review purpose; no trigger or scope boundary (`code-logic-reviewer.template.md:14`).                                                    | Collapse persona, anti-cheerleader examples, and scoring sermon (`:20-98`); reduce the 120-line fill-in report to a required-fields contract (`:301-421`); delete smell examples, anti-pattern examples, reminder, and final checklist that restate the review dimensions (`:425-539`).                                                    |
| `code-style-reviewer.template.md`      | Trim; target 170 lines.        | States subject; does not distinguish style review from logic review or say when to invoke (`code-style-reviewer.template.md:14`).             | Collapse persona/scoring material (`:20-98`); reduce the duplicated report template (`:275-380`); delete anti-pattern examples and motivational close (`:384-430`).                                                                                                                                                                        |
| `devops-engineer.template.md`          | Restructure; target 150 lines. | Good domain list; no triggers or production-change boundary (`devops-engineer.template.md:14`).                                               | Move task, clarification, and replacement policy to shared text (`:18-70`); move generic GitHub Actions, Docker, Kubernetes, Terraform, and publishing examples to on-demand references (`:118-430`); replace the return checklist with a short output contract (`:490-514`).                                                              |
| `frontend-developer.template.md`       | Restructure; target 190 lines. | Clear subject; no framework-specific trigger phrases (`frontend-developer.template.md:17`).                                                   | Move task/clarification contracts to shared preamble (`:21-50`); replace the UI SOLID/composition/DRY/YAGNI/KISS tutorial with concrete component rules (`:54-229`); remove repeated critical rules, anti-patterns, tips, and motivational ending (`:539-665`).                                                                            |
| `modernization-detector.template.md`   | Trim; target 135 lines.        | Too broad and omits use conditions and expected artifact (`modernization-detector.template.md:14`).                                           | Move clarification protocol (`:20-34`); replace the absolute compatibility polemic and good/bad mini-template with one replacement-policy rule (`:42-90`); compress the output specimen and technology lists to fields plus one example (`:179-299`).                                                                                      |
| `project-manager.template.md`          | Restructure; target 190 lines. | Names responsibilities but not when PM discovery is warranted (`project-manager.template.md:14`).                                             | Move task and clarification contracts (`:18-71`); remove the repeated compatibility mandate and canned good/bad stories (`:75-114`); collapse the long requirements template, SMART/BDD/stakeholder/risk matrices, delegation pseudocode, and tips into decision criteria plus one schema (`:318-545`).                                    |
| `researcher-expert.template.md`        | Restructure; target 150 lines. | Generic superlatives; neither trigger conditions nor evidence/source contract appear in the description (`researcher-expert.template.md:14`). | Move clarification and global repository policies (`:20-85`); delete pseudocode pretending to be a research method and the placeholder credibility form (`:96-167`); replace the 177-line “advanced” report plus second return template with one compact evidence table and decision record (`:178-354`).                                  |
| `senior-tester.template.md`            | Restructure; target 230 lines. | Generic; omits when to use, test levels, and implementation-versus-audit boundary (`senior-tester.template.md:14`).                           | Move clarification/replacement/document-discovery boilerplate (`:20-224`); merge repeated test-pattern discovery, mode detection, infrastructure assessment, and escalation flow (`:230-568`); move framework examples to references and replace three return templates with one adaptive contract (`:580-937`).                           |
| `software-architect.template.md`       | Restructure; target 210 lines. | Generic and triggerless (`software-architect.template.md:14`).                                                                                | Replace cross-cutting task, clarification, and compatibility blocks with shared includes (`:18-109`); reduce UI handoff and investigation tutorials to evidence rules and one input matrix (`:112-493`); delete the document-discovery walkthrough/checklist and the three overlapping implementation-plan/return templates (`:497-1074`). |
| `team-leader.template.md`              | Restructure; target 230 lines. | Names decomposition, but not the three modes or when to use them (`team-leader.template.md:14`).                                              | Move task/clarification contracts (`:18-41`); reduce plan-validation tutorial and sample report to five gates (`:133-255`); replace repeated batch prompt/return/failure templates and final restatement with one state-transition table and one batch schema (`:276-464`, `:539-719`, `:801-825`).                                        |
| `technical-content-writer.template.md` | Restructure; target 170 lines. | Lists outputs; no trigger phrases or evidence boundary (`technical-content-writer.template.md:14`).                                           | Move clarification protocol (`:20-34`); move the four long content templates and four checklists to per-content references (`:131-427`); merge the second landing/blog output templates and return checklist into a single artifact contract (`:479-567`).                                                                                 |
| `ui-ux-designer.template.md`           | Trim; target 105 lines.        | Specific function; no trigger phrases (`ui-ux-designer.template.md:15`).                                                                      | Move clarification protocol (`:19-35`); replace eager loading of every skill file with a routing table and load-on-demand rule (`:43-56`); deduplicate workflow rules, output paths, integration chain, and closing reminder (`:102-183`).                                                                                                 |
| `video-director.template.md`           | Trim; target 65 lines.         | Best of the set on function, but still lacks explicit “use when” triggers (`video-director.template.md:14`).                                  | Move generic Ptah-tool precedence to shared harness guidance (`:20-24`); load only `SKILL.md` first and route to one relevant reference instead of requiring all five (`:26-37`); move CLI delegation protocol to shared text (`:82-85`).                                                                                                  |
| `visual-reviewer.template.md`          | Restructure; target 210 lines. | Clear subject; no invocation conditions or evidence artifact in description (`visual-reviewer.template.md:14`).                               | Collapse persona, adversarial examples, and scoring sermon (`:20-98`); reduce exhaustive failure catalogs and forced six-viewport policy to risk-based test criteria (`:176-361`); replace the long report, anti-pattern examples, final checklist, and duplicated tool catalog with one evidence contract (`:374-577`).                   |

Cross-template defect: motivational labels such as “elite,” “paranoid production guardian,” “superpower,” and repeated all-caps failure language consume attention without changing behavior. The useful content is the decision rule, evidence requirement, stop condition, and artifact schema.

## B. Proposed rewrite: `software-architect.template.md`

This keeps the source-template metadata block because the generator parses it, and keeps the second block because that becomes the generated Claude agent frontmatter. The generated agent remains a valid single-frontmatter document.

````markdown
---
templateId: software-architect-v3
templateVersion: 3.0.0
applicabilityRules:
  projectTypes: [ALL]
  minimumRelevanceScore: 70
  alwaysInclude: false
dependencies: []
---

---

name: software-architect
description: Designs evidence-based software architecture and writes implementation-plan.md after investigating task documents, existing code, and UI/UX handoffs. Use for cross-component features, integrations, migrations, or refactors that need verified boundaries, APIs, data flow, quality requirements, and a team-leader handoff.

---

<!-- shared: task-spec-contract -->
<!-- shared: clarification-protocol -->
<!-- shared: replacement-policy -->
<!-- shared: cli-delegation -->

# Software Architect

Design the smallest architecture that satisfies the task and fits the repository. Produce an evidence-backed `implementation-plan.md`; do not implement code or decompose the plan into atomic tasks.

## Required inputs

Discover the task folder before reading named files. Apply this authority order:

1. User intent and formal requirements: `context.md`, `task-description.md`.
2. Explicit corrections and overrides.
3. Technical analysis, research, and approved decisions.
4. Existing plans, preferring the most specific applicable plan.
5. Reviews, validation results, and current task state.

Record missing inputs only when they affect a decision. Do not require a document merely because a template mentions it.

For UI work, read any available:

- `visual-design-specification.md`
- `design-assets-inventory.md`
- `design-handoff.md`

Extract layout, component contracts, responsive behavior, motion, asset handling, design tokens, and accessibility requirements. Match the handoff unless it conflicts with repository evidence or requirements; document any conflict and its resolution.

## Investigation rules

Before selecting a pattern:

1. Read repository and relevant library instructions.
2. Locate two or three comparable implementations when available.
3. Verify every named import, export, decorator, base class, interface, token, and integration API in source.
4. Trace boundaries, dependency direction, data flow, error paths, persistence, and security-sensitive inputs.
5. Prefer an established repository pattern when it satisfies the requirements. Introduce a new pattern only when evidence shows the existing one is insufficient.

Use repository source as primary evidence. External documentation may explain a dependency but cannot prove that this repository exports or configures it.

Every material decision needs at least one `file:line` citation. Mark unverified claims as assumptions and state how the implementer must resolve them. When a plan or design document conflicts with source, source wins unless the task explicitly requires changing that source.

## Architecture decisions

For each decision, state:

- requirement or constraint;
- chosen approach;
- repository evidence;
- rejected viable alternatives and why they lose here;
- assumptions or unresolved risks;
- migration or replacement effect, when applicable.

Keep the architecture cohesive:

- one responsibility per component or library;
- dependency direction consistent with repository boundaries;
- existing types and services reused rather than duplicated;
- no cross-library re-export used to hide an invalid dependency;
- strict types and validation at external boundaries;
- explicit failure, rollback, observability, and test seams where relevant.

Specify what must be built and why. Include a short pattern excerpt only when prose and citations cannot communicate the contract. Do not write step-by-step implementation instructions; the team-leader owns decomposition.

## Output contract

Write the deliverable to the absolute Windows path:

`.ptah/specs/TASK_[ID]/implementation-plan.md`

Use this structure:

```markdown
# Implementation Plan - TASK\_[ID]

## Inputs and constraints

- Requirements used: [paths]
- Overrides applied: [paths or none]
- Design handoff used: [paths or none]
- Missing decision-critical input: [item, impact, resolution or none]

## Codebase evidence

| Evidence        | Location    | Architectural implication        |
| --------------- | ----------- | -------------------------------- |
| [verified fact] | [file:line] | [constraint or reusable pattern] |

## Architecture decision

- Chosen approach: [approach]
- Rationale: [requirement fit plus evidence]
- Rejected alternatives: [alternative and reason]
- Assumptions: [assumption and validation step, or none]
- Replacement/migration effect: [effect or not applicable]

## Component specifications

### 1. [Component name]

- Purpose: [single responsibility]
- Responsibilities: [bounded list]
- Verified contracts: [interfaces, tokens, APIs with file:line]
- Dependencies: [direction and evidence]
- Integration points: [callers, consumers, protocol]
- Failure behavior: [errors, fallback, recovery]
- Quality requirements: [performance, security, maintainability, accessibility]
- Test seams: [unit/integration/e2e boundary]
- Files: [CREATE | MODIFY | REWRITE with paths]

[Repeat for each component.]

## Integration architecture

- Data flow: [ordered boundary-to-boundary flow]
- State and persistence: [ownership and lifecycle]
- External boundaries: [validation, authentication, authorization]
- Failure and rollback: [system behavior]
- Observability: [logs, metrics, traces where justified]

## Architecture-level quality requirements

- Functional: [measurable outcomes]
- Performance: [criteria or not applicable]
- Security: [criteria or not applicable]
- Maintainability: [boundary and pattern constraints]
- Testability: [required coverage by behavior, not arbitrary percentage]

## Team-leader handoff

- Recommended executors: [agent types by component]
- Complexity: [LOW | MEDIUM | HIGH with rationale]
- Dependencies and ordering: [component-level constraints]
- Parallel-safe work: [file-disjoint components or none]
- Files affected: [complete grouped list]
- Verification points: [imports, contracts, migrations, build/test gates]
```

Before writing, verify that every component has evidence, boundaries, quality requirements, files, and a test seam; all APIs are real; UI requirements are represented; and assumptions are visible.

After writing, reply only:

`WROTE: <absolute path> — <N> components`
````

Estimated rewrite length: approximately 165 lines, depending on wrapping.

## C. Skill audits

### `orchestration`

- Verdict: restructure. Current 433 lines; target 170-190 lines plus on-demand references.
- Description: under 1,024 characters and has strong trigger coverage, but uses shouting (“TRIGGER,” “ANY,” “DEFAULT”) and describes eight flows instead of stating the routing boundary (`orchestration/SKILL.md:3`).
- Files to delete: `examples/bugfix-trace.md`, `examples/creative-trace.md`, `examples/feature-trace.md`. They are 1,838 lines of trace fixtures, are not linked from `SKILL.md`, and do not belong in the shipped runtime skill.
- Top cuts: collapse role/tool constraints and “always delegate” into the shared preamble (`orchestration/SKILL.md:45-83`); move task creation, phase detection, deliverable mapping, and checkpoint specimens to `references/task-tracking.md` and `references/checkpoints.md` (`:125-251`); delete the duplicated CLI hierarchy/injection manual and keep one link to `references/cli-agent-delegation.md` (`:287-382`).
- Reference hygiene: references are correctly routed at `:406-423`, but several are themselves 300-880 lines. Split by decision, not by agent, and keep one concrete example per branch.

### `ptah-cli-usage`

- Verdict: restructure. Current 1,408 lines; target 150-180 lines plus `references/setup.md`, `auth.md`, `jsonrpc.md`, `agent-cli.md`, `licensing.md`, `harness.md`, `internal-mcp.md`, and `mcp-serve.md`.
- Description: good; specific headless use cases and literal triggers, third-person enough, 325 characters (`ptah-cli-usage/SKILL.md:3`).
- Files to delete: none. The defect is that the entire manual is in `SKILL.md` rather than routed references.
- Top cuts: move the 73-line setup walkthrough to `references/setup.md` and leave the readiness invariant plus link (`:27-99`); move tier mapping and the full NDJSON cookbook to references (`:277-383`); move the `agent-cli`, license, harness, internal MCP, capabilities, and `mcp-serve` manuals out of the always-loaded file (`:637-1408`).
- Keep in the entry file: when to use CLI, one-shot versus `interact`, the “stdout is NDJSON/stderr is logs” invariant, secret-handling rule, unattended approval rule, source-of-truth links, and a reference router.

### `tribunal`

- Verdict: trim. Current 91 lines; target 65-75 lines. Its progressive-disclosure structure is otherwise the strongest of the four.
- Description: function and triggers are excellent, but it is 1,948 characters and violates the 1,024-character limit (`tribunal/SKILL.md:3`). Replace it with: “Runs multi-vendor Council, Forge, Race, Relay, or Crucible workflows using agents discovered via `ptah_agent_list`. Use when the user asks for a tribunal, model council, second opinion, cross-vendor debate/review, model race, pinned vendor relay, or executor-judge loop. Do not use for ordinary implementation; use `orchestration` instead.”
- Files to delete: none. The six reference files are purpose-specific and routed on demand (`tribunal/SKILL.md:80-91`).
- Top cuts: shorten the comparison table to a two-sentence boundary (`:12-22`); reduce each move to trigger plus link rather than restating its full algorithm (`:33-58`); merge Conductor, concurrency, cost, and runtime notes into six rules (`:60-78`).

### `react-best-practices`

- Verdict: trim package; current `SKILL.md` is 134 lines, target 70-85 lines.
- Description: good; says what it covers and when to use it, under 1,024 characters (`react-best-practices/SKILL.md:3`).
- Files to delete: generated `AGENTS.md` (`AGENTS.md:1-2865`); build/contributor `README.md` (`README.md:1-127`); build metadata `metadata.json` (`metadata.json:1-15`); authoring-only `rules/_sections.md` (`rules/_sections.md:1-46`) and `rules/_template.md` (`rules/_template.md:1-28`). Keep the 57 individual rule files.
- Top cuts: remove “When to Apply,” which duplicates frontmatter (`SKILL.md:10-19`); combine the category table and 57-item quick reference into a compact prefix router (`:20-114`); remove the pointer to the generated compiled duplicate (`:132-134`).
- Progressive disclosure: load the one or two rule files matching the observed performance problem; do not load all 57 or ship a second 82 KB compilation.

## D. Canonical shared preamble

Proposed shared text: 49 lines including headings and blanks. Generate or inject it once; templates contain only include markers.

```markdown
## Shared operating contract

### Task files

- `task.md` is the machine-owned carrier. It contains only supported frontmatter and a short body.
- Put user intent in `context.md`; put team-leader batches in `tasks.md`.
- Discover the task folder before assuming any optional document exists.
- Change status by editing only the `status:` line in `task.md`.
- Allocate an ID from the highest current `.ptah/specs/TASK_YYYY_NNN` folder, never from `registry.md`.
- Write the assigned deliverable to the exact absolute path in the invocation prompt. Do not create substitute filenames.

### Clarification

- The main orchestrator owns user interaction. Subagents do not call interactive question tools.
- If a material choice would change scope, architecture, risk, or irreversible work, stop before mutation and return `## Clarifications Needed`.
- Ask one to three focused questions. Give two or three mutually exclusive options for each; put the recommended option first and explain its tradeoff in one sentence.
- Proceed without clarification when the prompt resolves the choice, the repository has one established answer, or the user explicitly delegates judgment.
- The orchestrator presents the questions, records the answers, and re-invokes the same specialist with a `## User Decisions` section.

### Replacement and compatibility

- Do not create parallel legacy/new implementations, version-suffixed copies, compatibility flags, or bridges unless the user or task explicitly requires compatibility.
- Prefer one authoritative implementation and remove superseded paths within the authorized scope.
- If compatibility is required, state its consumers, duration, removal condition, migration path, and test obligation; do not hide it as incidental architecture.

### Evidence and repository authority

- Repository instructions and current source outrank examples, plans, generated docs, and external conventions.
- Verify named files, exports, APIs, commands, and tools before relying on them.
- Cite material findings as `file:line`. Mark inference and unresolved assumptions explicitly.
- Preserve unrelated user changes. Do not broaden the write scope.

### CLI delegation

- Use CLI agents only when the orchestrator explicitly enables delegation for the task.
- Discover available lanes with `ptah_agent_list`; never hardcode installed vendors or models.
- The team-leader is advisory and never spawns. Other specialists may spawn only when their invocation explicitly grants that authority.
- Keep at most three CLI agents active. Give each a self-contained prompt, absolute paths, bounded ownership, and an output contract.
- CLI agents do not commit. Review shipping output with a different vendor family or line by line before accepting it.
- Resume a failed or timed-out resumable session before starting an unrelated replacement.
- The delegating specialist owns synthesis and remains accountable for the final artifact.

### Completion

- Do not claim success until the requested artifact exists and relevant verification has passed.
- Return the artifact path, verdict or result, and unresolved risks in the caller's required format.
```

Contradictions resolved by this preamble:

1. Clarification ownership: most templates say subagents must return questions (`software-architect.template.md:27-65`), while current generated frontend and DevOps agents still command direct `AskUserQuestion` calls (`.claude/agents/frontend-developer.md:62-77`, `.claude/agents/devops-engineer.md:18-33`). Use orchestrator-owned interaction.
2. CLI spawning: orchestration declares the main orchestrator the sole spawner (`orchestration/SKILL.md:287-321`) and then authorizes most subagents to spawn directly (`:333-380`). The preamble makes delegation an explicit per-invocation capability and keeps team-leader advisory.
3. Compatibility: architect/PM/tester copies prohibit compatibility without exception (`software-architect.template.md:95-108`), while researcher allows it when explicitly requested (`researcher-expert.template.md:46-50`). User/task requirements must remain authoritative; otherwise use direct replacement.
4. Git ownership: backend and frontend instructions say developers commit (`backend-developer.template.md:300-303`, `frontend-developer.template.md:322-325`) and later forbid all developer git operations (`backend-developer.template.md:433-441`, `frontend-developer.template.md:456-464`). Remove both generic commit statements from developer prompts; the invoking workflow owns git policy.
5. Registry authority: orchestration scores “recent patterns” from `registry.md` (`orchestration/SKILL.md:104-119`) but later calls it generated and stale (`:136-144`). Use live folder discovery for state; registry may be a non-authoritative browsing aid only.

## E. Verified stale or incorrect facts

1. `ptah-cli-usage/SKILL.md:1008-1106` documents a 35-tool internal MCP surface, 7 always-on tools, 4 harness tools, and no `code` namespace. Current registration has 12 always-on tools including five task tools (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:263-276`), 6 harness tools (`:317-325`), and 9 code tools (`:327-338`). The default surface is 48 tools without IDE capability or 51 with it, before namespace disabling. The cited source path at `ptah-cli-usage/SKILL.md:1013` no longer exists; `handleToolsList` is at `protocol-dispatcher.ts:257`.
2. `ptah-cli-usage/SKILL.md:1020-1022` calls `mcp-serve` future work, while the same file documents it at `:1176-1408` and the command is registered in `apps/ptah-cli/src/cli/router.ts:2774`. Delete the future-status note.
3. `ptah-cli-usage/SKILL.md:1143-1172` says the JSON-RPC schema is `0.1` and `schema_version` in `session.ready` is future work. It is `0.2` at `apps/ptah-cli/src/cli/jsonrpc/types.ts:32`, and `session.ready` emits `schema_version` at `apps/ptah-cli/src/cli/commands/interact.ts:414`.
4. `ui-ux-designer.template.md:90`, `:112`, and `:160` require `ptah_generate_image`. A repository-wide search finds no tool builder, dispatcher case, or implementation; the name appears only in this prompt material and `skills/ui-ux-designer/ASSET-GENERATION.md`. Remove the hard requirement or replace it with capability discovery and the actual installed image-generation tool.
5. `software-architect.template.md:225` contains malformed `.ptah/specs/TASK*[ID]/visual-design-specification.md`; the repository contract is `.ptah/specs/TASK_YYYY_NNN/` (`CLAUDE.md:161-167`). The rewrite uses the task folder supplied by the caller rather than a wildcard typo.
6. Browser tool names in `visual-reviewer.template.md:130-141` and code-search tool names in `video-director.template.md:22-24` are current: builders/dispatcher cases exist in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:336`, `:868`, `:926`, `:993`, `:1017`, `:1045`, `:1484`, and `:1591`. Do not “fix” these names.
7. The React package's `AGENTS.md` is generated and duplicates all 57 rules; `README.md:13-14` labels it and `test-cases.json` as generated. `test-cases.json` is not present in the shipped directory, but the 2,865-line `AGENTS.md` is. Delete the compiled artifact and retain rule-level progressive disclosure.

## Priority order

1. Correct the stale `ptah-cli-usage` tool/schema sections and remove `ptah_generate_image` as a required capability.
2. Introduce the shared preamble and delete contradictory copies.
3. Replace `software-architect.template.md` with the compact rewrite.
4. Split `ptah-cli-usage` and trim orchestration.
5. Remove shipped trace/build/generated artifacts and then trim the remaining templates.
