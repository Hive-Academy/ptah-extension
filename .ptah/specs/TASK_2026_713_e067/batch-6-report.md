# Batch 6 report — TASK_2026_713_e067

Task 6.1 only. Static phrase locks in the existing description-shape spec. No skill, template, runtime, manifest, or task-carrier edits.

## Scope

- User request: route shipped skills by description, keep compositional boundaries, and lock the edited text without a model eval.
- Criteria tested, extracted from `implementation-plan.md` Component 3 (lines 179–184) and Batch 6 Task 6.1:
  - Each of the eight revised descriptions keeps `name` equal to its directory and contains its primary WHEN subject.
  - Where Component 1 names a sibling, that sibling `name` is in the description.
  - `angular-frontend-patterns` names both scene siblings and does not exclude animation as a class.
  - `angular-3d-scene-crafter` keeps in-scene animation and treats `angular-frontend-patterns` as component-structure support, not a load for every scene.
  - `agent-lanes` does not describe `orchestration` or `tribunal` as skills that must not apply to a lane task.
  - `ptah-cli-usage` has no heading whose normalised text is "when to use this skill". The body still contains "exits when stdin closes", the NDJSON hard-rule heading, and the command table. The description has a headless/CI trigger that does not depend on the user mentioning a command.
  - `session-handoff` still limits its WHEN to `/session-handoff`.
  - Existing shape caps stay: one line, ≤ 400 characters, ≤ 4 double-quoted phrases, no numbered list, no block scalar.
- Regressions covered: mention-only CLI selection, a when-to-use heading, dropping the stdin-lifetime sentence or the NDJSON heading, an exclusive lane rejection, and an unconditional 3D-to-frontend mandate.
- Review findings covered: Class R caution 1 (3D "also load" is conditional on component structure). The .NET new-solution row stays ambiguous and has no exclusive assertion. No `code-style-review.md` or `code-logic-review.md` was in the task folder for this batch.
- Deliberately not tested:
  - Class R routing matrix as a selector. A pass there is a human reading, not a Jest score.
  - Class L, observed skill loading or discovery at runtime.
  - Byte-exact copies of the twenty retained descriptions.
  - A required "Not for" on `video-showcase` or `nestjs-deployment`.
  - Role-template clauses. Those belong to the guard spec, which this batch must not edit.
  - `content-manifest.json` (Batch 7).

## Suites

### shipped skill descriptions stay short trigger text — unit

- Requirement: discovery still receives one short trigger line.
- Cases: corpus present, nonempty, not a block scalar, ≤ 400 characters, no numbered list, ≤ 4 double-quoted phrases. Caps unchanged.
- Files: `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`

### revised skill descriptions keep their static routing contract — unit

- Requirement: the text discovery would read still states the approved WHEN, sibling, and boundary. It does not prove a model selected the skill.
- Cases: directory name equality for every shipped skill; the eight edited paths exist; Angular sibling phrases and the animation/conditional-support boundaries; agent-lanes spawn/resume mechanic without a sibling rejection; Nest, DDD, and surface primary subjects with siblings still allowed; CLI heading, stdin lifetime, NDJSON heading, and command table; session-handoff command gate.
- Files: same spec.

## Exact changes

- Edited only `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`.
- Added helpers `skillFile`, `descriptionOf`, `skillText`, `skillName`, `atxHeadings`, `normaliseHeading`, and `rejectsSibling`.
- Left the first describe and `MAX_DESCRIPTION_CHARS` / `MAX_QUOTED_PHRASES` as they were (six tests).
- Added a second describe with seven tests. Thirteen `it` blocks in the file. None assert a full retained description string.
- Wrote this report. Did not edit `batches.md`, skills, partials, or the manifest.

## Execution

- Command run: none.
- Result: not observed. The supplied pre-lock result remains 6 passed / 0 failed for the old six tests. That run did not execute these seven new tests.
- Failures: none observed, because the suite was not run.
- Not executed: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts --coverage=false --maxWorkers=2` from the worktree root. Batch 6 forbids the author check. The orchestrator runs that one command. No Nx, lint, tsc, diagnostics, manifest, build, serve, or e2e was run. `ptah_get_diagnostics` was not called.

## Decisions

- Phrase presence, not full-line equality, for the eight edited descriptions. Options were a snapshot of each line, or the Component 3 substrings. Evidence: plan lines 173–184 and the "do not freeze retained bytes" decision. Reversible: the assertions can be narrowed later.
- Corpus-wide `name` equals directory, which does not pin description bytes. Options were eight skills only, or every shipped skill the walker already opens. Evidence: plan failure behaviour, "a name change is a failed edit", and the current 28 frontmatter names. Reversible.
- CLI heading lock is the absence of normalised "when to use this skill", not a requirement that the title stay "Which surface". Evidence: Component 3 line 181. The example title in Component 1 is illustrative. Reversible.
- Headless/CI trigger is `headless`, `CI`, and "no clickable UI", plus the absence of "mention". Evidence: the relocated selection prose and the current description. Reversible if a later line uses "mention" for a non-gate reason.
- 3D frontend support is locked as "angular-frontend-patterns for component structure", and the GSAP sibling as "when the task has both". The spec does not require "always load". Evidence: Class R caution 1 in `batches.md`. Reversible.
- `ddd-architecture` must not contain "nestjs". Evidence: Component 1 says the Nest module boundary was unevidenced. Reversible if a later overlap is evidenced.
- `rejectsSibling` treats "not for", "must not", and "do not load/use" as exclusion, and does not treat "not a substitute" as exclusion. Evidence: agent-lanes must stay the mechanic those two skills load, without saying they reject a lane. Reversible.
- No automated winner for the ambiguous .NET solution-layout row. Evidence: Class R row 10. Reversible only by a product decision, which this batch does not have.
- No `test-report.md`. The spawn allows this report and the spec only.

## Verdict

- Criteria encoded in the spec: the eight WHEN/sibling/boundary locks, name stability, CLI operating facts, and the session-handoff command gate, beside the existing caps.
- Criteria not proven: every new assertion, until the orchestrator Jest command runs. No content defect was seen while reading the eight current descriptions against those phrases. That reading is not a test result.
- Risks: Angular descriptions have little room under 400 characters, so a future wording change must shorten rather than raise the cap. `rejectsSibling` can miss a novel exclusion phrasing. The command-table check requires `init` and `session` rows, not every command. These tests read repository files; they do not load a skill.

## Checks the orchestrator still runs

```
npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts --coverage=false --maxWorkers=2
```

Worktree: `D:/projects/ptah-extension/.claude-worktrees/skill-routing`. One heavy job. Do not rerun the old 6/6 command as a separate proof.
