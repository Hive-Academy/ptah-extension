---
id: TASK_2026_528_5d1e
status: backlog
type: REFACTORING
title: >-
  Four backend libraries inherit strict false, so a Zod-inferred type from the
  libs/shared barrel cannot compile in them
description: >-
  Four backend libs inherit strict false from tsconfig.base.json, so a Zod-inferred type from
  the libs/shared main barrel does not compile in them. Turn strict on in those four.
updated: 2026-11-07T00:00:00.000Z
---

# Four backend libraries inherit strict false

## Description

`tsconfig.base.json:306` sets `"strict": false`. 36 of the 40 libraries under `libs/backend` set
`"strict": true` in their own tsconfig. Four do not: `auth-providers-tokens`, `memory-contracts`,
`settings-core` and `voice-contracts`. Zod 4 needs strict null checks to infer a type, so a
Zod-inferred type exported from the `libs/shared` main barrel does not compile in those four.
TASK_2026_493 works around it with the `dashboard-spec.types.ts` / `dashboard-spec.schemas.ts` split
(`libs/shared/src/mcp-apps-contracts/`). Keep that split.

1. Add `"strict": true` to the four libraries.
2. Fix what that surfaces. No `as any` and no `@ts-ignore`. A `@ts-expect-error` needs a written
   reason.
3. Record the diagnostic count per library before and after.
4. Do not flip `strict` in `tsconfig.base.json` in this task.

Verify with `npm run verify -- -p auth-providers-tokens,memory-contracts,settings-core,voice-contracts`
and confirm the header says 4 projects. Do not use `nx run-many`.

## Current state (2026-11-07)

- Not done. None of the four libraries has a `"strict"` key in any `tsconfig*.json`.
- The counts in `context.md` ("twenty-five of twenty-nine", `tsconfig.base.json:229`) are old. The
  current counts are above.
