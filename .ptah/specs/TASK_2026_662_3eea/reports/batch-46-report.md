# Batch 46 report

## Files deleted

All under `tools/mcp-bench/src/memory-skills/suites/skills/`:

- `funnel.suite.ts`, `funnel.suite.spec.ts`, `funnel-backlog.ts`, `funnel-di.test-support.ts`, `funnel-fixture.ts`, `funnel-host-graph.ts`, `funnel-host-port.ts`, `funnel-lifecycle.ts`, `funnel-lifecycle.spec.ts`, `funnel-port.ts`, `funnel-report.ts`, `funnel-stages.ts`
- `judge-agreement.suite.ts`, `judge-agreement.suite.spec.ts`, `judge-agreement-ports.ts`, `judge-corpus.ts`, `judge-lane-tap.ts`

## Files changed

- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`: removed both suite registrations and imports.
- `tools/mcp-bench/src/memory-skills/runner/runner-plan.ts`, `runner/runner-plan.spec.ts`, `host/plan.schema.ts`: removed the deleted funnel suite's shared-pass validation and its spec.
- `tools/mcp-bench/src/memory-skills/host/suite-placement.ts`, `host/suite-placement.spec.ts`: removed placement entries and assertions for deleted suites, including `skill.backlog.drain`.
- `tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts`: removed deleted host-only modules from the allowlist.
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.ts`: updated the obsolete judge-agreement comment.

## Funnel-kind decision

Kept `memory-skills-suite-kinds.ts` and its spec unchanged. `suites/audits/snapshot-audits.suite.ts:725` still produces a `funnel` result, with its schema and spec references still required. Batch 47 owns that audit.

## Acceptance rg result

Ran `rg -n "funnel|judge-agreement|judge-corpus|judge-lane-tap|registerSkillSynthesisServices|SkillJudgeService|SkillMdGenerator" tools/mcp-bench/src`. Remaining hits are solely the retained `funnel` kind in `memory-skills-suite-kinds.ts`, its spec, and `suites/audits/snapshot-audits.suite.ts` and its spec. No hits remain for the deleted suite names or service symbols. A targeted import search found no importers of deleted modules outside the edited files.

## Decisions

- Kept the lane doubles, their specs, `merge-update.test-support.ts`, the rubric-agreement family, and all retained lane services untouched.
- Did not run tests, typecheck, lint, build, serve, or e2e, as instructed.

## Clarifications Needed

none
