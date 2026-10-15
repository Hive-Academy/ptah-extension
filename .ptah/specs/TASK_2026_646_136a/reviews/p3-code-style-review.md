# Code Style Review — P3 routing engine — `TASK_2026_646_136a`

Review family: OpenAI. Scope: `5e5c9ffca..3f932ea7d`, `libs/backend/lane-routing` (51 changed files). This is a structure review; runtime failure modes belong to the separate logic review. I inspected the public barrel, DI wiring, route service, contracts, pipeline boundaries, project configuration, AST structure of the larger units, and the named plan and batch decisions. I compared the public surface and registration shape with `lane-outcomes` and `skill-synthesis`. The supplied verification was 17 suites / 377 tests passing, lint and typecheck passing, DI lint OK, and degradation audit TOTAL 296 with no FAIL. No Nx, Jest, build, or git write was run. Scoped `ptah_get_diagnostics` returned **unavailable** after its TypeScript check timed out; the supplied typecheck is the verification evidence.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | **6/10** |
| Assessment | **NEEDS_REVISION** |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Minor issues | 1 |
| Files reviewed | 51 in diff; structural inspection concentrated on the 37 non-spec source files and project configuration |

The library has the intended host-neutral direction: imports in `src/lib/di/register.ts:15-22` and `src/lib/pipeline/phase-plan.ts:5-16` stay on shared/platform contracts or local files; `project.json:6` carries both Nx tags. Zod owns the route boundary (`src/lib/contracts/route-decide-args.schema.ts:36-106`, `src/lib/contracts/route-decide-result.schema.ts:218-255`), and registration centralizes the lib-owned services (`src/lib/di/register.ts:51-139`). The score is below the 7–8 band because the new barrel publishes implementation details as a large public contract (Serious 1). It stays above the 3–4 band because no architectural boundary violation was found in the inspected code and the affected project passed the supplied checks.

## Five style questions

### 1. What breaks when requirements change in six months?

Changes to rotation persistence, scoring, or matrix internals can become public API changes because `src/index.ts:11-48,85-138` exports their constants, helper functions, and state types. A change to the two-pass planning inputs must also be reflected in seven-position calls at `src/lib/route-decide.service.ts:187-195,203-211`.

### 2. What would a new team member misread here?

`src/index.ts:109-138` makes `score`, `spread`, `rotationKey`, `withPick`, and rotation state look like supported extension points, although the service is the intended routing entry point (`src/index.ts:139-168`). `openSystemOne` in `src/lib/pipeline/model-refine.ts:101-107` looks like the chosen client factory, while the service builds the same client through `openSystemOneFrom` at `src/lib/route-decide.service.ts:314-323,399-403`.

### 3. What does this cost to maintain that a simpler shape would not?

The 190-line barrel (`src/index.ts:1-190`) gives future refactors a much larger compatibility surface. The seven-argument phase planner and gate assembler (`src/lib/pipeline/phase-plan.ts:110-118`; `src/lib/pipeline/assemble-gate.ts:52-60`) make changes to call context require positional edits in tandem. An input object would make the meaning of each argument visible at the call site.

### 4. Where is this inconsistent with how the same problem is solved elsewhere?

This pipeline already passes named objects into `gatherRouteCall` (`src/lib/route-decide.service.ts:169-177`) and `runLaneRequest` (`src/lib/route-decide.service.ts:255-263`), but phase planning and assembly use seven positional values. The adjacent `lane-outcomes/src/index.ts:1-63` is a smaller public barrel for another new domain library; the routing barrel exposes many internal ranking and persistence helpers at `src/index.ts:109-138`.

### 5. What would I have done differently, and why is that better rather than merely other?

Publish the consumer-facing DI, service, port, schema, and DTO contracts from `src/index.ts:6-10,139-168`, and keep ranking, rotation, seed, and diagnostic helpers local until a cross-library consumer needs them. This reduces supported surface while preserving the current host calls. Use one named `PlanRoutePhasesInput` at `src/lib/pipeline/phase-plan.ts:110-118` and one client factory at `src/lib/pipeline/model-refine.ts:90-107`; both remove choices that a maintainer must reconcile later.

## Blocking issues

None found in the inspected scope.

## Serious issues

### 1. The new public API exports implementation machinery

- File: `libs/backend/lane-routing/src/index.ts:11-48,85-138,178-190`.
- Problem: The barrel publishes scoring and spread algorithms, rotation document constants and mutation helpers, matrix diagnostic strings, test seams, and classifier payload builders alongside the actual host-facing service and contracts. Current external imports found in `apps/` and `libs/` use the registration/token pair, route service/args/result, decision-model settings/status, and structured-decision port (for examples, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:30`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tools.ts:9`, `libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts:25`). None of those production imports calls the exported `score`, `spread`, `withPick`, or `deriveLocalMatrix` helpers.
- Impact: Internal policy and storage refactors gain unnecessary compatibility obligations; newcomers may bypass `RouteDecideService` and couple another library to individual pipeline steps.
- Fix: Keep the host-facing tokens, registration, ports, service, schemas, and settings DTOs in the barrel. Remove unconsumed ranking/persistence helpers and test seams from the public entry point. Add any later cross-library export only with its actual consumer and contract.

## Moderate issues

### 1. Pipeline context is passed through long positional signatures

- File: `libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts:110-118`; call sites `libs/backend/lane-routing/src/lib/route-decide.service.ts:187-195,203-211`; companion `libs/backend/lane-routing/src/lib/pipeline/assemble-gate.ts:52-60`.
- Problem: Both exported pipeline functions take seven context values, including a boolean whose meaning is invisible in the service's `true`/`false` calls. The same service already uses named input objects for `gatherRouteCall` and `runLaneRequest` (`src/lib/route-decide.service.ts:169-177,255-263`).
- Impact: Adding a pass property or changing the planner's context requires coordinated positional edits and makes review of the two pass modes harder.
- Fix: Accept a readonly named input object for phase planning and gate assembly. Keep the two pass calls explicit with `deferReviewerFamily: true/false`.

## Minor issues

- `libs/backend/lane-routing/src/lib/pipeline/model-refine.ts:101-107` exports `openSystemOne`, but the service constructs the same client with `openSystemOneFrom` at `libs/backend/lane-routing/src/lib/route-decide.service.ts:314-323,399-403`. The symbol search index returned zero hits, so a native source search was used; only its definition appeared. Remove the unused factory and keep one construction path, or call the existing factory from the service. This avoids two places to update when client options change.

## File-by-file

- `src/index.ts`: 5/10. The necessary host contracts are present at `:139-168`; the ranking and persistence exports at `:109-138` make the surface materially wider than its observed consumers.
- `src/lib/di/tokens.ts`, `src/lib/di/register.ts`: 8/10. `Symbol.for` tokens are grouped (`tokens.ts:9-34`); lib-owned services are registered in one function (`register.ts:51-139`) and optional host ports are checked before resolution (`register.ts:43-49,69-72,102-109`).
- `src/lib/route-decide.service.ts` and `src/lib/pipeline/*`: 7/10. The service delegates gathering, planning, requests, resolution, assembly, and result validation (`route-decide.service.ts:169-232`), but the planner/assembler signatures are harder to maintain than their named-object neighbours; the duplicate client factory is minor.
- `src/lib/contracts/*` and decision-model ports: 8/10. The args schema validates the external shape and cross-field IDs (`route-decide-args.schema.ts:36-106`); result types come from their Zod schemas (`route-decide-result.schema.ts:246-255`).
- `src/lib/decision-model/decision-model.config.ts`: Size is tracked, not reopened as a new issue. It is 803 physical lines but 656 counted lines under the repository's 700-line rule; the accepted TL-24 note in `batches.md:692` names the planned extraction at `decision-model.config.ts:606-803` before this file grows.
- `project.json`, `eslint.config.mjs`, `tsconfig*.json`: 8/10. `project.json:6,20-33` defines tags and project-scoped checks; `tsconfig.lib.json:10-12` is strict. The named `package.json` does not exist in this project, so no claim is made about it.

## Pattern compliance

| Rule or convention | Status | Evidence |
| --- | --- | --- |
| `scope:*` and `type:*` project tags | PASS | `libs/backend/lane-routing/project.json:6` |
| Cross-library imports through public aliases and platform ports | PASS in inspected source | `src/lib/di/register.ts:15-22`; `src/lib/pipeline/phase-plan.ts:5-16` |
| `Symbol.for` tokens grouped and registration centralized | PASS | `src/lib/di/tokens.ts:9-34`; `src/lib/di/register.ts:51-139` |
| Zod on routing boundary, types inferred from schemas | PASS | `src/lib/contracts/route-decide-args.schema.ts:36-106`; `src/lib/contracts/route-decide-result.schema.ts:246-255` |
| Small, deliberate public API | FAIL | `src/index.ts:11-48,85-138,178-190` |
| Consistent named context at pipeline boundaries | FAIL | `src/lib/pipeline/phase-plan.ts:110-118`; `src/lib/pipeline/assemble-gate.ts:52-60` |

## Maintenance debt

- Introduced: a broad exported helper surface (`src/index.ts:11-48,85-138`), two seven-argument pipeline APIs (`phase-plan.ts:110-118`, `assemble-gate.ts:52-60`), and a duplicate System One factory (`model-refine.ts:101-107`).
- Retired: ad hoc host-side routing policy is replaced by the central `RouteDecideService` entry (`route-decide.service.ts:102-116`).
- Net: moderately up at the public boundary; the fixes are local to the barrel and pipeline call signatures.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the large configuration file as an accepted follow-up, not a fresh defect | Reopen size / respect TL-24 | `batches.md:692` records 656 counted lines and FE-12a; `decision-model.config.ts:606-803` is the named extraction | Yes |
| Limit the new barrel to observed host contracts | Keep all helpers public / trim unconsumed helpers | `src/index.ts:109-138`; external import examples cited in Serious 1 | Yes, before downstream consumers adopt them |

## Verdict

- Recommendation: **NEEDS_REVISION** (score **6/10**; 0 Blocking, 1 Serious, 1 Moderate, 1 Minor).
- Confidence: HIGH on the public surface and call-shape findings; MEDIUM on the remainder of the 51-file diff because the larger implementation files received structural and targeted inspection rather than a line-by-line audit.
- Key concern: the new public entry point commits callers to internal ranking and storage machinery.
- What a 10/10 version would do differently: publish only actual boundary contracts, use named inputs for multi-value pipeline calls, and keep one System One client factory.
