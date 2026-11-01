# Task 10d.fix-r2 — revise round 2 of 2 for 10d.C / 10d.V and the shared inspection helper (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Also apply every rule in T\task-10d-common-rules.md (section HARD RULES).
- Do not convert line endings. Edit only the lines you must change. UTF-8 without BOM.
- Two codex lanes run at the same time: lane H (helper) and lane S (host specs). Touch ONLY the files of YOUR part.

## Inputs

- Review: T\code-logic-review-10d-CV-r1.md (section "New defects and residual gaps", items 1-4).
- Earlier tasks and reports: T\task-10d-fix-A.md, T\task-10d-fix-C.md, T\task-10d-fix-V.md,
  T\batch-10d-fix-A-report.md, T\batch-10d-C-fix-1-report.md, T\batch-10d-V-fix-2-report.md.

## Part H — shared helper (lane H only)

Files: W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts and its .spec.ts. Nothing else.

H1. Test failure: spec `codex-executable-inspection.spec.ts:120-123` expects `cause: expect.any(Error)`. A Node fs
    error is created in another realm, so Jest's `expect.any(Error)` fails (the received object has no matching
    `cause`). Assert the cause in a realm-safe way, for example `expect.objectContaining({ code: 'ENOENT' })` on
    `error.cause`. First confirm the helper really sets `cause` (constructor passes `{ cause }` to `super`); if the
    compiled target drops `ErrorOptions`, set `cause` explicitly in the constructor.
H2. Review item 1 (moderate): `readVersion` mode collides in the cache. Cache the digest result separately from the
    version output. Default mode returns `codex-cli ${pin.pinnedVersion}` and never calls a callback. With
    `readVersion`, call it at most once per (file identity key, callback identity) and never return a cached
    callback result to a default-mode caller or the reverse. Add spec cases for both orders.
H3. Review item 2 (minor): bound the cache. Keep at most a small fixed number of realpaths (for example 8, evict the
    oldest by Map insertion order). Add a spec case.
H4. Review item 4 (helper part): the `void promise.catch(...)` eviction handler needs the comment
    `// degradation-audit: reported - <reason>` (the returned promise still rejects to the caller).
H5. Keep every existing behavior of task-10d-fix-A.md rules 1-7.

Deliverable H: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-fix-r2-H-report.md

## Part S — host specs and CLI comment (lane S only)

Files: W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts,
W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.spec.ts,
W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.spec.ts. Nothing else.

S1. Test failure (does not compile): `cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:430-432`
    `mockImplementation(async function (profile) { expect(this['options'].binary.sha256)... })` gives TS2683
    ('this' implicitly has type 'any'). Do not read the private `options` through `this`. Instead assert the
    measured digest through a type-safe seam, for example `jest.spyOn` on the exported `registerCodexRuntime` call's
    ports argument is NOT possible for a named import, so prefer: resolve the ports / binary identity that the child
    scope registered (look at W\libs\backend\codex-runtime\src\lib\di\registration.ts for the token that holds the
    ports or binary), or give the function an explicit `this: CodexRuntime` parameter and read a public or
    bracket-accessible member that tsc accepts without `any`. No `any`, no `as unknown as`, no ts-ignore.
    Keep the assertion that the measured digest differs from the pin and reaches the binary identity.
S2. Review item 4 (CLI part): the failed-open cleanup catch at `cli-engine/.../codex-lane-runtime-composition.ts`
    about :262-269 logs and rethrows the original error. Add `// degradation-audit: reported - <reason>` at the
    catch, like VS Code `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:235`.
S3. Review item 3: the VS Code spec fixture gives the inspector and the pin the same digest
    (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:71-80`, assertion `:213-223`). Make
    the measured digest deliberately different from the pinned digest in the port assertion case (for example mock
    `inspectCodexExecutable` for that case, as the CLI spec does), so a pin substitution in `open()` fails the case.

Deliverable S: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-fix-r2-S-report.md

## Report content (both)

Write the report early as a skeleton. Per item: what changed (file:line); `## Decisions`; anything not done.
Reply `WROTE: <path>` plus one headline line.
