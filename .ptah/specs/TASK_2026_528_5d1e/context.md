# Context

## Measured state

`tsconfig.base.json:229` sets `"strict": false`.

Twenty-nine libraries live under `libs/backend`. Twenty-five of them set
`"strict": true` in their own `tsconfig.json` or `tsconfig.lib.json` and are
unaffected. Four do not set it anywhere and therefore inherit the loose
setting:

| Library | Config chain |
| --- | --- |
| `libs/backend/auth-providers-tokens` | `tsconfig.json` extends `tsconfig.base.json`; `tsconfig.lib.json` extends `tsconfig.json` |
| `libs/backend/memory-contracts` | same |
| `libs/backend/settings-core` | same, plus `tsconfig.spec.json` |
| `libs/backend/voice-contracts` | same |

> An earlier session recorded this as "twenty backend libs". That number is
> wrong. The measured number is four. The blast radius is far smaller than the
> earlier note claimed, which makes this task cheap rather than large.

## Why it matters

Zod 4 infers a type from a schema. The inferred shape depends on strict null
checks. Under `"strict": false` the inference degrades and a consumer fails to
compile. Any Zod-inferred type exported from the `libs/shared` MAIN barrel is
therefore unusable in those four libraries, because importing the barrel pulls
the whole module graph.

TASK_2026_493 avoided this by splitting `dashboard-spec.types.ts` from
`dashboard-spec.schemas.ts` and keeping the inferred types out of the main
barrel. That split is sound on its own merits. It is not a cure: the next
contract that wants to export an inferred type from the main barrel hits the
same wall and pays the same structural tax.

## Scope

1. Add `"strict": true` to the four libraries listed above, matching the
   pattern the other twenty-five already use.
2. Fix whatever that surfaces. Do NOT silence it. No `as any`, no
   `@ts-ignore`. A `@ts-expect-error` is allowed only with a written reason.
3. Measure and record the real diagnostic count per library before and after.
4. Do NOT flip `"strict": true` in `tsconfig.base.json` as part of this task.
   That touches the frontend, the api and the web trees as well, and its blast
   radius has not been measured. File it separately if the four-library change
   makes it look cheap.

Out of scope: undoing the TASK_2026_493 types and schemas split. The split is
good structure and should stay whichever way this lands.

## Acceptance criteria

1. All four libraries compile with `"strict": true`.
2. `npx nx run-many -t lint -p auth-providers-tokens -p memory-contracts -p settings-core -p voice-contracts` passes. Confirm the "Running target ... for 4 projects" header.
3. `npx nx run-many -t test` over the same four projects passes, with the same
   header check.
4. No new suppression is introduced without a written reason.

## Open questions

- Does any of the four libraries have a dependent that ALSO needs strict for
  the fix to hold? Run `ptah_get_dependents` on each before starting.
- `libs/shared` itself: does it set strict? If it does not, the inferred types
  are loose at the source and turning strict on downstream will not be enough.
  Check this first — it may change the shape of the whole task.
