# Context — TASK_2026_518

## Why this exists

TASK_2026_511 ran diagnostics over the frontend while adding a required field
to a shared DTO. Four errors came back that had nothing to do with that change
and predate it. They were left untouched under that task's scope rule, and they
are recorded here so they are not lost.

## The errors

| File | Problem |
| --- | --- |
| `libs/frontend/memory-curator-ui/src/lib/components/corpus-build-dialog.component.spec.ts` | Three errors: casts and index-signature access |
| `libs/frontend/memory-curator-ui/src/lib/services/memory-rpc.service.spec.ts` | One error: an invalid tier literal |

Paths are as reported by diagnostics during TASK_2026_511. Confirm each before
editing, because a file may have moved.

## Why the suite stays green

The `memory-curator-ui` Jest configuration uses `isolatedModules`. Each file is
transpiled without cross-file type checking, so a spec can hold a type error and
still run and pass. The production `typecheck` target excludes specs, so it does
not catch them either.

The result is a gap where neither gate looks. A spec that does not type-check is
not proving what its author thinks it proves, and a wrong tier literal is exactly
the kind of error a type system exists to catch.

## Scope

In scope:

- Fix the four errors. Prefer correcting the test to match the real type over
  widening the type or adding a cast. A cast that silences the error puts the
  gap back.
- Decide whether the `memory-curator-ui` spec files should be type-checked at
  all, and by what. If a cheap way exists to bring specs under a checking gate
  without slowing the suite, propose it in the implementation plan before
  building it.

Out of scope:

- Turning `isolatedModules` off across the repository. That is a build-wide
  decision with its own cost, and it is not this task.
- Any change to production code, unless a spec error reveals a genuine defect in
  the code under test. If that happens, say so plainly rather than adjusting the
  test until it passes.

## Acceptance

- Diagnostics over the two named files report zero errors.
- The `memory-curator-ui` test target still passes.
- No new cast or `@ts-expect-error` was added without an adjacent reason comment.
