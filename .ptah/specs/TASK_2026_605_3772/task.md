---
id: TASK_2026_605_3772
status: backlog
type: DEVOPS
title: Type-check the chat, core and ui spec files in CI
depends_on: []
created: "2026-10-03T12:10:08.545Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  No target type-checks the spec files of libs/frontend chat, core and ui, so a spec can drift from
  the code it tests. Add a spec type-check and gate it in CI and in npm run verify.
executor: devops-engineer
estimate: S
labels:
  - ci
  - testing
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The `typecheck` target of `@ptah-extension/chat`, `@ptah-extension/core` and `@ptah-extension/ui`
uses the lib tsconfig only, so the `*.spec.ts` files under `tsconfig.spec.json` are not
type-checked. A spec can drift from the types it tests and still pass, or fail only at runtime.

1. Confirm the gap: add a deliberate type error to a spec and show that no current target fails.
2. Add a `typecheck-spec` target (or extend `typecheck`) that runs
   `tsc -p tsconfig.spec.json --noEmit` for these libs, in the same style as the existing targets.
3. Fix the type errors it finds (spec files only, unless a product type is wrong).
4. Gate it in CI and in `npm run verify` (which runs the `typecheck` target).
5. List the other frontend libs with the same gap.

Acceptance: a spec type error fails the new target and the CI job; the target is green on main for
chat, core and ui; the PR states the CI time increase.

## Current state (2026-11-07)

- Not started. `libs/frontend/chat/project.json:14-17`, `libs/frontend/core/project.json:14-17`
  and `libs/frontend/ui/project.json:36-39` run `npx ngc --noEmit --project .../tsconfig.lib.json`.
- No `typecheck-spec` target exists in `libs/frontend/*/project.json`, and no workflow under
  `.github/` runs `tsconfig.spec.json`.

Full context, plan and discussion live in [./context.md](./context.md).
