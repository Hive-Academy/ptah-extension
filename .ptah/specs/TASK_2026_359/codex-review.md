# Codex Review — TASK_2026_359

Counts are actionable finding groups; repeated instances of the same defect are grouped, with every affected line cited.

| file                                   | verdict | violations count |
| -------------------------------------- | ------- | ---------------: |
| `backend-developer.template.md`        | fix     |                8 |
| `code-logic-reviewer.template.md`      | fix     |                5 |
| `code-style-reviewer.template.md`      | fix     |               12 |
| `devops-engineer.template.md`          | fix     |                7 |
| `frontend-developer.template.md`       | fix     |               10 |
| `modernization-detector.template.md`   | fix     |                5 |
| `project-manager.template.md`          | fix     |                5 |
| `researcher-expert.template.md`        | fix     |                2 |
| `senior-tester.template.md`            | fix     |                2 |
| `software-architect.template.md`       | fix     |                9 |
| `team-leader.template.md`              | fix     |               11 |
| `technical-content-writer.template.md` | fix     |                4 |
| `ui-ux-designer.template.md`           | fix     |                3 |
| `video-director.template.md`           | fix     |                5 |
| `visual-reviewer.template.md`          | fix     |                6 |
| `_shared/clarification-protocol.md`    | fix     |                1 |
| `_shared/cli-delegation.md`            | pass    |                0 |
| `_shared/replacement-policy.md`        | pass    |                0 |
| `_shared/reviewer-stance.md`           | fix     |                2 |
| `_shared/tooling-precedence.md`        | fix     |                2 |

## LLM-section audit

All 10 pairs are balanced. After trimming marker-adjacent blank lines, every fallback starts with `##` and is 10–15 lines: backend 14/12, logic 10, style 10, DevOps 14, frontend 15/13, tester 12, architect 12, visual 10. Placement is correct: developer conventions precede output, build/test sections follow discovery method, architect patterns precede the plan contract, and reviewer focus precedes the report contract.

No section should be added to the seven sectionless templates. `team-leader` and `project-manager` own task workflow, not repository conventions; `researcher-expert` and `modernization-detector` discover task-specific evidence at run time; `technical-content-writer`, `ui-ux-designer`, and `video-director` take variable direction from the prompt and their Ptah-bundled skills. Adding an LLM block would duplicate those inputs rather than capture a stable repository pattern.

## Per-file findings

### `backend-developer.template.md`

LLM sections: structurally valid and correctly placed. `ARCHITECTURE_PATTERNS` needs the generic wording correction below.

1. High — `backend-developer.template.md:52-55` assumes an architect and team-leader always ran first. Replace with: `Implement the assigned backend change and leave the repository in a verifiable state. When a plan or batch exists, follow its boundaries; otherwise derive scope from the request and repository instructions. Produce working code that follows local patterns, verify every referenced symbol against source, and do not perform git operations.`
2. High — `backend-developer.template.md:71-72` says source always wins over the requested change. Replace with: `When task documents and current source disagree, identify whether the source is the intended change target or the task is stale. Follow the explicit current requirement when the conflict is resolvable; otherwise return the discrepancy for clarification before making an irreversible choice.`
3. High — `backend-developer.template.md:94-97` mandates TypeScript's `unknown`-narrowing idiom. Replace with: `Follow the repository's error-handling conventions. Inspect failure details only after establishing their shape, preserve useful context internally, and do not expose internal diagnostics across a trust boundary. Explain any error-suppression mechanism where it is used.`
4. Medium — `backend-developer.template.md:98-100` assumes a configuration accessor exists. Replace with: `Use the repository's documented configuration mechanism when one exists; otherwise follow the nearest local precedent. Never place a credential in source, logs, fixtures, or generated documents.`
5. Medium — `backend-developer.template.md:101-103` imposes a language- and company-specific extraction rule. Replace with: `Follow the repository's own size and cohesion rules. When an extraction is justified, name each part by its responsibility and preserve any public contracts that consumers rely on.`
6. Medium — `backend-developer.template.md:115` assumes a logging facility and bans all direct output. Replace with: `Use the repository's established logging or diagnostic convention when one exists; do not introduce an ad hoc output mechanism beside it.`
7. High — `backend-developer.template.md:116-119`, `backend-developer.template.md:186`, and `backend-developer.template.md:204-205` require typecheck, lint, and tests in every stack. Replace the method text with: `Run every applicable verification command the repository declares, such as a build, static check, or test. Quote the command and observed result, and state when a check is unavailable or not applicable.` Replace the report field with: `**Verification**: [applicable commands and observed results; unavailable or not-applicable checks stated explicitly]`. Replace the refusal with: `No claim of completion while an applicable required verification check is failing.`
8. Medium — `backend-developer.template.md:151-153` makes “extend an existing module first” a universal architecture rule. Replace with: `Use repository evidence to decide whether to extend an existing unit or introduce a new one. Preserve established boundaries and abstractions unless the requirement and cited evidence justify changing them.`

### `code-logic-reviewer.template.md`

LLM section: valid, generic, 10 lines, correctly placed.

1. High — `code-logic-reviewer.template.md:67-69` assumes diagnostics and tests exist. Replace with: `6. Available diagnostics and verification evidence for the changed paths. A passing check that does not exercise the new behaviour is not evidence for that behaviour.`
2. Medium — `code-logic-reviewer.template.md:96-98` uses typed-language casts as a universal failure pattern. Replace with: `- **Unvalidated boundaries.** External input — for example a request, message, file, command argument, or webhook — consumed without the validation appropriate to this repository. An unchecked assumption about shape is not validation.`
3. Medium — `code-logic-reviewer.template.md:99-102` assumes framework registration and a two-place wiring rule. Replace with: `- **Partially wired behaviour.** A new handler, route, command, listener, migration, or provider exists but is not connected through every discovery, registration, or configuration step this repository requires. Compare its entry path with a nearby working unit.`
4. Critical — `code-logic-reviewer.template.md:184`, `code-logic-reviewer.template.md:237`, and `code-logic-reviewer.template.md:241-242` require three failure modes while also forbidding quota-filling. Replace line 184 with: `[List every supported failure mode; if none is found, state the reviewed scope, evidence, and residual uncertainty.]` Replace the two refusal bullets with: `- No verdict without file:line evidence for every material claim.` and `- Do not invent findings to meet a quota; a clean review must state what was examined and what remains uncertain.`
5. Medium — `code-logic-reviewer.template.md:139-142` names the non-product `Write` tool, which is absent from the cited Ptah tool registry and is not portable across harnesses. Replace with: `Write the review to the absolute path .ptah/specs/TASK_[ID]/code-logic-review.md using an available file-editing capability. Never use code-review.md or a name outside the recognised document set. Return only the required acknowledgement, and do not edit reviewed source.`

### `code-style-reviewer.template.md`

LLM section: structurally valid and correctly placed; its fallback needs the generic wording correction below.

1. Medium — `code-style-reviewer.template.md:48` assumes the repository has a formatter. Replace with: `Style here means structure and consistency, not whitespace already governed by repository tooling or documented conventions.`
2. High — `code-style-reviewer.template.md:67` assumes lint and type-check outputs exist. Replace with: `5. ptah_get_diagnostics and any applicable static-analysis or verification output available for the affected code.`
3. Critical — `code-style-reviewer.template.md:87-89` imports Ptah's separate-adapter architecture as a normal answer. Replace with: `- **Environment branching.** A host, platform, or runtime conditional placed where repository rules require independence. Judge it against this repository's stated boundary and nearby implementations; do not prescribe a particular isolation pattern.`
4. High — `code-style-reviewer.template.md:90-93` assumes tokens, providers, modules, constructors, and two-place framework registration. Replace with: `- **Wiring drift.** A new unit is made reachable differently from its nearest working siblings, or one required discovery or registration step is missing. A unit that accumulates unrelated responsibilities is also a finding.`
5. High — `code-style-reviewer.template.md:98-101` assumes a statically typed language. Replace with: `- **Contract looseness.** A change bypasses or weakens the repository's normal data-shape, nullability, interface, or validation guarantees, or suppresses a check without a stated reason.`
6. Medium — `code-style-reviewer.template.md:102-104` assumes one sanitizer already exists. Replace with: `- **Unsafe output paths.** Untrusted text is rendered, interpolated, or executed without the repository's required escaping or sanitising treatment. Internal diagnostics are exposed across a trust boundary.`
7. Medium — `code-style-reviewer.template.md:105-109` imposes class/token/signature and helper-name rules on every language. Replace with: `- **Split in the wrong place.** Code is divided by arbitrary size rather than responsibility, new pieces have vague names, or a refactor changes a public contract without need. Repository size limits are evidence to inspect, not proof by themselves.`
8. Medium — `code-style-reviewer.template.md:113-114` states the “third repetition” heuristic as truth. Replace with: `- **Duplication with drift.** Copied behaviour has diverged, or an abstraction was introduced without evidence that it improves the repeated cases present in this repository.`
9. High — `code-style-reviewer.template.md:128-132` assumes directories, imports, registration, and sanctioned abstractions in the no-SDK fallback. Replace with: `Take from repository instructions and nearby code the organisation boundaries, naming rules, public entry points, extension mechanisms, and maintenance constraints that actually apply. A rule with no local evidence is personal preference and belongs in the report only as a suggestion.`
10. Medium — `code-style-reviewer.template.md:203-209` makes framework and type conventions mandatory report rows and has no N/A state. Replace with: `| Repository rule or nearby convention | PASS / FAIL / NOT_APPLICABLE | Evidence |` followed by one row per applicable rule discovered during the review.
11. Critical — `code-style-reviewer.template.md:234` requires at least three findings, conflicting with `code-style-reviewer.template.md:237` and the shared no-invention rule. Replace with: `- No verdict without file:line evidence for every material claim; do not invent findings to meet a quota.`
12. Medium — `code-style-reviewer.template.md:138-141` names the non-product `Write` tool. Replace with: `Write the review to the absolute path .ptah/specs/TASK_[ID]/code-style-review.md using an available file-editing capability. Never use code-review.md or a name outside the recognised document set. Return only the required acknowledgement, and do not edit reviewed source.`

### `devops-engineer.template.md`

LLM section: valid, generic, 14 lines, correctly placed after surface discovery.

1. High — `devops-engineer.template.md:71-75` assumes every repository defines build, test, lint, package, and run targets. Replace with: `- **Targets.** Enumerate the applicable entry points the repository actually defines — for example build, verification, packaging, migration, or run commands — and use their exact names. Do not invent a command.`
2. Medium — `devops-engineer.template.md:76-80` assumes CI exists and is job-based. Replace with: `- **Automation.** When automation configuration exists, read the complete relevant workflow before changing it. Match local execution, caching, and trigger conventions, and confirm the change runs only under the intended conditions.`
3. Critical — `devops-engineer.template.md:85-88` assumes local services use compose/container files and repeats a Ptah-specific missing-env diagnosis as general truth. Replace with: `- **Services and data.** Discover how this repository defines local dependencies and migrations, if any, from its own configuration and documentation. Use the declared command and configuration source, and diagnose failures from evidence rather than from a presumed environment layout.`
4. High — `devops-engineer.template.md:91-93`, `devops-engineer.template.md:114-115`, and `devops-engineer.template.md:126` prohibit any new infrastructure even when the task explicitly requests it. Replace each rule with: `Do not introduce infrastructure technology unless the task explicitly requires it and the plan defines its ownership, verification, and rollback.`
5. Medium — `devops-engineer.template.md:94-96` requires local execution even when unsafe or impossible. Replace with: `- **Proof.** Run the safest applicable local check when one exists; otherwise use a dry run, configuration validator, or documented inspection and state the limitation. Run repository-owned checks relevant to the changed surface.`
6. High — `devops-engineer.template.md:105-109` assumes a fixed target census, task runner, and CI directory in the fallback. Replace with: `Discover the repository's actual delivery surface: the commands, automation, release triggers, publishing configuration, and local dependencies that exist. Until tailored, treat repository instructions and the configuration files they cite as the source of truth.`
7. Medium — `devops-engineer.template.md:129-130` makes a local merge-commit policy universal. Replace with: `- Follow the repository's documented branch and release rules. Do not perform merge or history-changing operations as part of this role.`

### `frontend-developer.template.md`

LLM sections: structurally valid and correctly placed. `ARCHITECTURE_PATTERNS` needs the generic wording correction below.

1. High — `frontend-developer.template.md:52-55` assumes an architect always ran first. Replace with: `Implement the assigned interface change and leave the affected surface verifiable. When a plan or design handoff exists, follow its boundaries; otherwise derive scope from the request and repository instructions. Produce accessible behaviour that follows local patterns, verify every referenced symbol or token against source, and do not perform git operations.`
2. High — `frontend-developer.template.md:75-76` says source always wins over the requested change. Replace with: `When task documents, design material, and current source disagree, identify which artifact is stale and whether the source is the intended change target. Follow the explicit current requirement when resolvable; otherwise return the conflict for clarification.`
3. High — `frontend-developer.template.md:88-91` assumes a sanitizer already exists. Replace with: `- **Untrusted and generated content.** Use the repository's established safe-rendering path when one exists. Otherwise use the platform's supported escaping or sanitising mechanism and record the missing repository convention. Never render untrusted markup without an explicit safety boundary.`
4. High — `frontend-developer.template.md:96-99` assumes a client wrapper and bans direct transport universally. Replace with: `- **External access.** Follow the repository's existing boundary between interface code and external services. Reuse its client or transport abstraction when present, and validate externally supplied data before placing it in view state.`
5. High — `frontend-developer.template.md:107-108` mandates TypeScript's caught-error idiom. Replace with: `- **Errors.** Follow the repository's error-handling convention, inspect failure details only after establishing their shape, and explain any suppression mechanism where it is used.`
6. Medium — `frontend-developer.template.md:109-111` assumes selectors, input APIs, collaborators, and forbidden helper names. Replace with: `- **Size and shape.** Follow repository cohesion and size rules. When extraction is justified, preserve public behaviour and name each new part by its responsibility.`
7. Medium — `frontend-developer.template.md:116-117` assumes framework-specific symbol kinds. Replace with: `2. Locate every symbol, asset, contract, and configuration value named by the plan, and confirm it exists before depending on it.`
8. High — `frontend-developer.template.md:125-128`, `frontend-developer.template.md:201`, and `frontend-developer.template.md:220` require typecheck, lint, and tests in every stack. Replace the method text with: `Run every applicable verification command the repository declares, such as a build, static check, or test. Quote the command and observed result, and state when a check is unavailable or not applicable.` Replace the report field with: `**Verification**: [applicable commands and observed results; unavailable or not-applicable checks stated explicitly]`. Replace the refusal with: `No claim of completion while an applicable required verification check is failing.`
9. Medium — `frontend-developer.template.md:162-164` makes extending an existing feature and reusing a shared primitive universal. Replace with: `Use repository evidence to decide whether to extend an existing area or introduce a new one. Reuse an existing primitive when it satisfies the requirement; otherwise justify the new one in the return value.`
10. Medium — `frontend-developer.template.md:170-171` assumes component/template/style/state/spec file categories. Replace with: `Interface source, presentation assets, state or interaction code, and verification files under the paths assigned by the task. Include only categories that exist in this repository.`

### `modernization-detector.template.md`

No LLM section is needed; stack and ecosystem facts are the subject of each scan, not a reusable convention block.

1. Medium — `modernization-detector.template.md:64-65` assumes dependency manifests, build configuration, imports, frameworks, and versioned dependencies. Replace with: `1. **Identify the environment.** Read the repository's own metadata, instructions, and source. Record versions only where the repository provides authoritative version evidence.`
2. High — `modernization-detector.template.md:77-79` says only widely adopted changes may be reported, which suppresses required security and compatibility work. Replace with: `Report the maturity, adoption evidence, compatibility risk, and project fit for every opportunity. Exclude unsupported speculation; do not exclude a necessary change merely because adoption is still limited.`
3. High — `modernization-detector.template.md:81-85` assumes UI, backend, build, and test frameworks exist. Replace with: `Look for modernization categories evidenced by the detected repository — for example obsolete interfaces, duplicated approaches, unsafe defaults, avoidable performance costs, or unsupported dependencies. Do not invent a framework category that is absent.`
4. Medium — `modernization-detector.template.md:105-110` hardcodes `//` comments and a language-tagged code comparison. Replace with: `**Current pattern**: [cited excerpt or precise description]` and `**Proposed pattern**: [equivalent excerpt or precise description]`. Use a fenced block only when the repository's language and syntax are known.
5. Medium — `modernization-detector.template.md:89-91` names the non-product `Write` tool. Replace with: `Write .ptah/specs/<TASK_FOLDER>/future-enhancements.md at its absolute path using an available file-editing capability. Open with the opportunity table, then add one evidence-backed entry per opportunity.`

### `project-manager.template.md`

No LLM section is needed; scope is task-specific and repository constraints are gathered from source during the method.

1. High — `project-manager.template.md:83-84` and `project-manager.template.md:111-116` impose P0–P3 and S–XL company taxonomies not present in the task contract. Replace the method step with: `4. Classify the task using the task types recognised by the task contract. Include priority or estimate only when the user or repository defines the scale, and cite that scale.` Replace the output section with: `- Type: [recognised task type]` and `- Repository-specific priority or estimate: [value and cited scale, or not defined]`.
2. High — `project-manager.template.md:85-87` makes user-story syntax mandatory and falsely labels ownerless internal requirements as implementation details. Replace with: `5. Describe each functional area in terms of an actor or affected system, the observable capability, and the outcome. Use user-story syntax only when it clarifies the requirement; internal reliability, security, and operational requirements may have no end-user actor.`
3. High — `project-manager.template.md:91-93` says every non-functional requirement needs a number. Replace with: `7. Include a non-functional requirement only when the request or repository establishes a real constraint. Make it objectively checkable; use a numerical threshold only when evidence or the user supplies one.`
4. Medium — `project-manager.template.md:176-178` and `project-manager.template.md:196-197` require a non-empty out-of-scope list even for already bounded work. Replace both with: `Confirm that the scope boundary is explicit. If no additional exclusions are needed, write “None identified” rather than inventing one.`
5. Medium — `project-manager.template.md:100-101` names the non-product `Write` tool. Replace with: `Write task-description.md at its absolute path in the task folder using an available file-editing capability.`

### `researcher-expert.template.md`

No LLM section is needed; the bounded question and current external evidence determine each report.

1. High — `researcher-expert.template.md:72-73` requires every source to be a URL and dated, contradicting the local `file:line` evidence allowed at line 103. Replace with: `4. Record each source as a URL or file:line citation. Include its publication or update date when available, and label undated material as such. Do not include an unattributed claim.`
2. Medium — `researcher-expert.template.md:82-84` names the non-product `Write` tool. Replace with: `Write research-report.md at its absolute path in the task folder using an available file-editing capability. Fill the schema without invented numbers, adoption statistics, or quotations, and remove unsupported rows.`

### `senior-tester.template.md`

LLM section: valid, generic, 12 lines, correctly placed before escalation.

1. Medium — `senior-tester.template.md:148-150` assumes a framework and runner are required. Replace with: `- Test approach and tooling: [what is missing]` and `- Verification structure: [the level or boundary needed]` and `- Fixtures or harness: [required resources, or none]`.
2. Medium — `senior-tester.template.md:168-169` names the non-product `Write` tool. Replace with: `Write tests in the repository's established locations, then write test-report.md at its absolute path in the task folder using an available file-editing capability.`

### `software-architect.template.md`

LLM section: structurally valid and correctly placed. Its “test seam” wording should be genericized as below.

1. High — `software-architect.template.md:74-79` assumes UI “prop contracts” and says source wins over a requested design change. Replace with: `When a design handoff exists, take its structure, public input/output contracts, responsive behaviour, motion, assets, tokens, and accessibility requirements. Where it conflicts with repository evidence or a stated requirement, identify which artifact is intended to change and record the resolution; do not give current source automatic priority.`
2. High — `software-architect.template.md:89-91` assumes decorators, classes, interfaces, DI tokens, RPC, and CLI. Replace with: `3. Verify every symbol, contract, configuration key, protocol operation, or command you intend to name by opening its definition. If you cannot cite it as file:line, describe it as an assumption instead of a verified contract.`
3. High — `software-architect.template.md:105-109` mandates strict types and services. Replace with: `8. Check cohesion before writing: one responsibility per component; dependency direction consistent with discovered boundaries; existing contracts reused where appropriate; no indirection used to hide a forbidden dependency; repository data-shape and validation conventions preserved; and an explicit failure path where one can occur.`
4. Medium — `software-architect.template.md:127-132` assumes wiring, dependency direction, validation edges, and a test seam in every repository. Replace with: `From nearby implementations, establish where a unit of this kind belongs, how it becomes reachable, which contracts and boundaries apply, how failures are represented, what input checks exist, and how behaviour is verified. Record only patterns supported by cited source.`
5. High — `software-architect.template.md:172-180` assumes interfaces, base classes, tokens, APIs, unit tests, and integration tests. Replace with: `- Verified contracts and entry points: [repository-native references, each with file:line]` and `- Verification seam: [smallest practical observable boundary and any broader checks required]`.
6. Medium — `software-architect.template.md:186-191` makes persistence, authentication, authorisation, logs, metrics, and traces implicit requirements. Replace with: `- State or persistence: [ownership and lifetime, or not applicable]` and `- External boundaries: [applicable trust and validation controls, or none]` and `- Observability: [repository-native evidence path for otherwise invisible failures, or not applicable]`.
7. High — `software-architect.template.md:208-209` requires migrations, build, and test commands. Replace with: `- Verification points: [references to confirm, contracts to honour, data changes to apply, and applicable repository commands that must pass]`.
8. High — `software-architect.template.md:240-242` states the second-consumer abstraction heuristic as universal truth. Replace with: `- Do not introduce a speculative abstraction without a requirement or repository precedent that justifies it. Record expected future cases as assumptions rather than designing for them silently.`
9. Medium — `software-architect.template.md:138-139` names the non-product `Write` tool. Replace with: `Write implementation-plan.md at its absolute path in the task folder using an available file-editing capability. Use this structure:`

### `team-leader.template.md`

No LLM section is needed; this role owns Ptah task orchestration, while repository-specific implementation conventions belong in the plan and developer sections.

1. Critical — `team-leader.template.md:11-18`, `team-leader.template.md:49-54`, `team-leader.template.md:89-93`, `team-leader.template.md:251`, `team-leader.template.md:272`, `team-leader.template.md:322`, `team-leader.template.md:340-360`, `team-leader.template.md:364-365`, `team-leader.template.md:372`, `team-leader.template.md:388`, `team-leader.template.md:396`, `team-leader.template.md:405-411`, `team-leader.template.md:418-433`, `team-leader.template.md:454`, and `team-leader.template.md:459-465` tell the agent to stage and commit, contrary to the requested workflow boundary. Replace the mode with: `Mode 2 — Verify and hand off. Verify files and obtain the applicable reviewer verdict. When approved, update the batch state to COMPLETE and return the exact changed paths plus a suggested commit subject. Do not stage, commit, branch, merge, or push; the invoking workflow owns git. Completion verifies batch state, files, risks, and review evidence, not commit SHAs.` Update the description and role to say `gates each batch behind applicable review and hands verified changes back to the invoking workflow` and `you own verification and batch state, not git`.
2. Critical — `team-leader.template.md:58-65` names `Task`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash`, none of which is a product-owned tool in the cited registry. Replace with: `The main orchestrator is the sole authority for starting agents. Return executor or reviewer recommendations; do not invoke agent tools. Use the file inspection and editing capabilities available in the current harness, and do not perform git operations.`
3. High — `team-leader.template.md:131-135` imposes three-to-five tasks, forbids mixed frontend/backend batches, and mandates layer/feature grouping. Replace with: `Choose the smallest coherent batch that can be verified independently. Group work by actual dependency, file ownership, and rollback boundary; do not impose layer or feature grouping when the repository uses another structure.`
4. High — `team-leader.template.md:146-149` and `team-leader.template.md:232-249` contradict each other: parallel lanes must not share a mutable file, yet every lane is told to edit `batches.md`. Replace executor step 5 with: `5. Report each task's completion and evidence; do not edit batches.md.` Add: `After synthesising all lane reports, the team-leader alone updates task states in batches.md.`
5. Medium — `team-leader.template.md:148-149` assumes barrel exports. Replace with: `no two tasks touch the same shared registry, public entry point, configuration, or other mutable integration file.`
6. High — `team-leader.template.md:204-209` assumes a build command and always requires code review. Replace with: `- Every listed artifact exists and contains the required work` and `- Every applicable repository verification command passes` and `- The reviewer appropriate to the batch returned an accepting verdict` and `- Listed edge cases are addressed`.
7. High — `team-leader.template.md:299-319` always requests `code-logic-reviewer`, even for style-only, visual, documentation, or pipeline batches. Replace with: `Request the reviewer whose scope matches the batch: logic for behavioural risk, style for structural consistency, visual for rendered interface work, or another explicitly assigned reviewer. State why that reviewer is applicable.`
8. Critical — `team-leader.template.md:326-338` handles only APPROVED and REJECTED, but reviewer contracts also return NEEDS_REVISION/REVISE. Replace with: `If the verdict is APPROVED or APPROVE, continue to completion handoff. If it is NEEDS_REVISION, REVISE, REJECTED, or REJECT, return the cited issues to the same executor and keep the batch IN_PROGRESS.`
9. Critical — `team-leader.template.md:439-442` tells a subagent to ask the user, contradicting the clarification partial. Replace with: `### Next action: orchestrator selects QA` followed by `Return the options tester, style review, logic review, visual review when applicable, all applicable reviews, or skip, with one recommended option and its reason. Do not ask the user directly.`
10. Medium — `team-leader.template.md:462-463` claims a particular file-count mismatch is “the most common failure” without general evidence. Replace with: `A report can misstate the files present; verify the on-disk paths directly.`
11. Medium — `team-leader.template.md:157`, `team-leader.template.md:216`, and `team-leader.template.md:364` name non-product `Write`/`Edit` tools. Replace with: `Create or update batches.md at its absolute path using an available file-editing capability, changing only the intended status fields and batch evidence.`

### `technical-content-writer.template.md`

No LLM section is needed; audience, voice, visual system, and format are task inputs or skill-owned direction.

1. High — `technical-content-writer.template.md:49-52` tells the subagent to ask another agent directly. Replace with: `When visual specifications are required and no design system exists, return a dependency on ui-ux-designer to the orchestrator rather than inventing one or invoking another agent directly.`
2. High — `technical-content-writer.template.md:53-55` assumes a project manifest, exported classes/interfaces, option types, tests, and benchmarks. Replace with: `Use repository instructions and public-facing entry points for framing; use the implementation, configuration surface, examples, and available verification evidence for feature claims and numeric claims.`
3. Critical — `technical-content-writer.template.md:203-250` hardcodes an HTTP/REST/JSON/Bearer-token API reference and status codes. Replace the entire fenced template with:

```markdown
# Interface Reference: [Name]

## Overview

[What this interface does and when to use it]

## Invocation

- Interface kind: [command / function / endpoint / event / file format / other]
- Identifier and location: [verified value]
- Preconditions: [authentication, setup, or none]

## Inputs

| Input  | Shape                     | Required | Description |
| ------ | ------------------------- | -------- | ----------- |
| [name] | [repository-native shape] | YES/NO   | [meaning]   |

## Outputs

[Repository-native result shape and observable side effects]

## Failure behaviour

| Condition   | Observable result    | Caller action |
| ----------- | -------------------- | ------------- |
| [condition] | [verified behaviour] | [response]    |

## Examples

[Runnable or directly verifiable example in the repository's own interface style]
```

4. Medium — `technical-content-writer.template.md:316-317` names the non-product `Write` tool. Replace with: `Write .ptah/specs/<TASK_FOLDER>/content-specification.md at its absolute path using an available file-editing capability. It contains, in order:`

### `ui-ux-designer.template.md`

No LLM section is needed; visual direction is supplied through discovery and the Ptah-bundled `ui-ux-designer` skill.

1. High — `ui-ux-designer.template.md:67-69` assumes utility-framework configuration, CSS custom properties, and a docs directory. Replace with: `- The project's own token and style sources, discovered rather than assumed: theme, token, style, or design-system configuration and documentation wherever this repository keeps them.`
2. Medium — `ui-ux-designer.template.md:85-87` fixes WCAG 2.1 as the universal target. Replace with: `Every specified value cites its token, project source, or skill pattern. Measure contrast against the accessibility standard the project requires; when none is stated, use the current WCAG AA recommendation and record the criterion and pairs measured.`
3. Medium — `ui-ux-designer.template.md:98-99` names the non-product `Write` tool. Replace with: `Write each deliverable at its absolute path using an available file-editing capability. Maintain one authoritative file per deliverable and revise it in place.`

### `video-director.template.md`

No LLM section is needed; runtime details are owned by the Ptah-bundled `video-showcase` skill and must be discovered from its installed version.

1. Critical — `video-director.template.md:10-15` assumes Playwright, Remotion, TypeScript scene files, and a specific brand filename. Replace with: `Operates the Ptah-bundled video-showcase skill to author, capture, narrate, render, brand, and port product demos. Use for demo or tour videos, scene authoring, camera behaviour, narration, captions, rendering, branding, or pipeline portability. Follow the installed skill rather than assuming its implementation technology or filenames.`
2. High — `video-director.template.md:43-48` assumes three Ptah repository units and names Remotion/web/Electron flatly. Replace with: `Read the video-showcase SKILL.md first and follow its routing to the one reference needed. Inspect the skill's installed assets and the host repository's own instructions; do not assume the capture runtime, renderer, package layout, or engine filenames.`
3. Critical — `video-director.template.md:52-73` hardcodes JSON/WebM manifests, normalized coordinates, a clock source, TypeScript/JavaScript filenames, npm, Playwright, Remotion, and package aliases. Replace the entire method with: `Follow the installed video-showcase workflow in order: discover the host runtime and brand configuration; author the scene and narration in the skill's current format; run the skill-defined capture and render commands; inspect the rendered result; tune camera or timing through the supported configuration surface; and verify one scene before a wider render. For porting, use the skill's installation procedure and adapt paths and commands to the target repository.`
4. High — `video-director.template.md:77-81` assumes an `out/` directory and MP4 output. Replace with: `Confirm every rendered artifact at the output path and format defined by the installed skill or task. Return WROTE lines with absolute artifact paths and list any failed scene with its observed error.`
5. High — `video-director.template.md:85-89` hardcodes capture behaviour, rectangle representation, brand config, and a particular bridge library. Replace with: `- Do not rerun an expensive stage when the installed skill identifies a later-stage fix.` `- Preserve the skill's manifest and coordinate contracts.` `- Keep brand values in the skill-designated configuration source.` `- Respect the host repository's boundaries when porting.` `- Do not report success until the rendered artifact exists.`

### `visual-reviewer.template.md`

LLM section: valid, generic, 10 lines, correctly placed before output.

1. High — `visual-reviewer.template.md:44` requires `file:line` for findings that may originate in runtime state, external assets, or network failures. Replace with: `Every finding carries a screenshot, viewport, and reproducible evidence. Cite file:line when traceable to source; otherwise cite the route, request, asset, or observed state that proves it.`
2. Critical — `visual-reviewer.template.md:46-47` says a clean result proves inadequate testing, conflicting with the shared no-invention rule. Replace with: `A clean review must state the viewports, content shapes, states, and evidence examined, plus any residual uncertainty; do not infer a defect merely to satisfy a quota.`
3. High — `visual-reviewer.template.md:84-96` makes six fixed viewport sizes universal. Replace with: `Use the repository's documented supported viewports and browsers. When none are documented, choose a small representative set around observed layout breakpoints, state that it is an audit sample rather than a support contract, and record every tested size.`
4. Critical — `visual-reviewer.template.md:111-114`, `visual-reviewer.template.md:118-121`, and `visual-reviewer.template.md:141-143` state 44x44 and 16px as universal WCAG AA minimums. Replace with: `Measure contrast and target size against the accessibility standard and support policy the repository declares. When none is declared, cite the current WCAG AA criterion used; do not present platform guidance or enhanced criteria as AA requirements.`
5. Medium — `visual-reviewer.template.md:131-134` names CSS without an example marker and assumes web-rendering performance causes. Replace with: `5. **Visual performance.** Look for layout movement, delayed assets or typography, janky motion, slow interaction, and visually expensive effects. Report only causes supported by browser evidence.`
6. Medium — `visual-reviewer.template.md:173-175` names the non-product `Write` tool. Replace with: `Write .ptah/specs/<TASK_FOLDER>/visual-review.md at its absolute path using an available file-editing capability. Return only the required acknowledgement. Store screenshots under the task folder and reference them from the report.`

### `_shared/clarification-protocol.md`

1. Critical — `_shared/clarification-protocol.md:3-4` names `AskUserQuestion`, which is absent from the cited Ptah tool registry, and makes a harness-specific claim about where it works. Replace with: `You are a subagent and do not contact the user directly. The main orchestrator owns user interaction.`

### `_shared/cli-delegation.md`

Clean. All named `ptah_agent_*` tools exist; the vendor name is explicitly marked as an illustration, and the reporting/no-git boundary is coherent.

### `_shared/replacement-policy.md`

Clean. It is stack-agnostic, scoped to authorised code or planned changes, and does not contradict reporter roles because they do not include this partial.

### `_shared/reviewer-stance.md`

1. High — `_shared/reviewer-stance.md:8-17` asserts an unevidenced universal score distribution and pressures reviewers toward predetermined outcomes. Replace with: `Score only from the evidence and severity definitions in the specialist template. Do not target a predetermined distribution; explain what evidence separates the chosen score from the adjacent bands.`
2. Critical — `_shared/reviewer-stance.md:19-23` requires three findings, then describes a valid no-finding review. Replace with: `Every material finding carries file:line evidence and an impact statement. Do not manufacture a minimum count. When no findings are supported, state the reviewed scope, checks performed, and residual uncertainty so the clean result is auditable.`

### `_shared/tooling-precedence.md`

1. High — `_shared/tooling-precedence.md:3-4`, `_shared/tooling-precedence.md:8`, `_shared/tooling-precedence.md:10`, and `_shared/tooling-precedence.md:19-20` name Grep, Glob, Read, and `find`, which are not product-owned tools in the cited registry and are not portable across harnesses. Replace with: `Reach for ptah_* tools first. Fall back to the current harness's native file search and reading capabilities only when the Ptah tool is unavailable or returns no useful result, and report that fallback.`
2. Medium — `_shared/tooling-precedence.md:15-16` says diagnostics must run after edits and never before, which prevents baseline comparison. Replace with: `- ptah_get_diagnostics — current diagnostic evidence. Run it before edits when a baseline matters and after edits to identify regressions.`

## Truth-contract summary

All referenced `ptah_*` tools exist in `tool-description.builder.ts`, including the complete browser set and agent resume flow. All instructed task-document filenames are in `DOC_FILES`; `code-review.md` is the only other task-folder Markdown name and is explicitly forbidden rather than written. The truth failures are the native/harness-specific tool names identified above and the general claims called out per file.
