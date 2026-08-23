# Context

## Where this came from

Recorded as a follow-up by TASK_2026_306. That task modified this file twice for
two unrelated reasons in a single pass — the stalled-curation-pass input loss
around `:744`, and boot-scan stall handling. Two unrelated edits to one file in
one task is the ordinary symptom of too many concerns in one class.

## The measurement

`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` —
**1088 raw lines**, 913 by the ESLint count.

The project's guidance is a soft 700-line ceiling at warn level, with past 1000
meaning _"a deliberate look, not an alarm"_. This is the deliberate look. Note
the rest of that guidance too: **line count alone is not the signal.** A
contract barrel or an exhaustive type union can be long and correct. What makes
this one a real split candidate is the concern count.

## The six concerns

1. Trigger wiring and subscription lifecycle
2. Episode buffer lifecycle
3. Curate invocation
4. Boot-scan mapping
5. Coalescing
6. Rate limiting

Six reasons to change. Each of the last three has already produced its own
defect in a recent task.

## The precedent, in the same directory

```
libs/backend/memory-curator/src/lib/triggers/
  episode-tracker.ts          ← already extracted, has its own spec
  boot-scan-runner.ts         ← already extracted, has its own spec
  memory-trigger-config.ts    ← already extracted, has its own spec
  memory-trigger.service.ts   ← 1088 lines, the remainder
```

Three collaborators have already been pulled out of this class successfully.
This task continues that, it does not invent an approach.

## The facade rule

From the project standards, and the worked example is
`SkillSynthesisService` / `StageHandlersService` (TASK_2026_256):

> The public class keeps its name, DI token and method signatures; the extracted
> concern becomes a collaborator injected into it.

So `MemoryTriggerService` stays `MemoryTriggerService`, keeps its token, and
keeps every public signature. Nothing outside this file learns that the split
happened.

## The guardrails, which are the hard part

These exist to stop the split becoming fragment sprawl, and they should be
treated as acceptance criteria, not advice:

| Guardrail         | Test                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Nameability       | No `helpers`, `utils`, `common`, `misc`. If it cannot be named for what it owns, the cut is wrong |
| Minimum size      | No file under roughly 150 lines created purely to satisfy the cap                                 |
| Constructor width | A split pushing the constructor past roughly 8 injected deps was cut in the wrong place           |
| Fragment count    | Prefer 2–3 collaborators over 6 fragments                                                         |

Six concerns does not mean six files. Two or three well-named collaborators that
each own a cohesive group is the target.

## Verification

This is behaviour-preserving. The verification is that the existing specs pass
**unchanged**:

- `memory-trigger.service.spec.ts`
- `memory-trigger.coalesce.spec.ts`
- `memory-trigger.integration.spec.ts`

Rewriting a spec to match the new structure defeats the point. If a spec has to
change, the split changed behaviour and the split is wrong.

Extracted collaborators should gain their own specs on top, in the shape
`episode-tracker.spec.ts` and `boot-scan-runner.spec.ts` already have.

## Ordering with TASK_2026_311

TASK_2026_311 fixes the un-refunded rate-limit token, which lives in concern 6.
Either order works, but doing 311 first is cheaper: it is a small behavioural
fix in the current structure, whereas doing it after means rebasing a
behavioural change onto a moved file. If 310 goes first, land it before starting
311 rather than running both at once.
