# TASK_2026_393 — a dependency guard for ptah-license-server

## Why

The 2026-09-04 outage (TASK_2026_392) had two causes. The version drift was
fixed there. This task closes the second one: **nothing checks that the license
server's runtime imports are actually declared.**

`ptah-electron` has that check and passes it on every commit:

```
✅ All external imports are covered by package.json dependencies.
```

`apps/ptah-electron/scripts/validate-deps.js` builds the main bundle, scans it
for external imports with `scripts/lib/bundle-imports.js`
(`collectExternalImports`, `RUNTIME_PROVIDED`), and exits non-zero on anything
undeclared. It is wired as the `validate-deps` target and runs from the
pre-commit hook.

`ptah-license-server` has no equivalent. That is the whole reason the same
defect class reached production there and not in Electron.

## What to build

A `validate-deps` target on `ptah-license-server` that fails when an external
`require()` in `dist/apps/ptah-license-server/main.cjs` is not present in the
generated `dist/apps/ptah-license-server/package.json`.

Reuse `apps/ptah-electron/scripts/lib/bundle-imports.js` rather than writing a
second scanner. It already handles scoped names, subpath imports, `node:`
builtins and the runtime-provided allowlist. If sharing it means lifting it to a
neutral location, do that — two divergent scanners is worse than one moved file.

Note the format difference: Electron's bundle is ESM (`main.mjs`, `import`),
the license server's is CJS (`main.cjs`, `require`). Confirm the helper handles
both before assuming it does.

### Where it must run

The pre-commit hook is the wrong place — it would build the server on every
commit. Put it in CI, on the path that already builds this app, and make it
blocking. A guard that only warns would not have prevented the outage.

## Acceptance criteria

1. `nx validate-deps ptah-license-server` exits non-zero when a runtime import
   is missing from the generated manifest, and zero when the set is complete.
2. Proven against the real defect: temporarily move `@nestjs/config` back to
   root `devDependencies`, confirm the target fails, then restore it. Record the
   failure output in the task's test report.
3. The check runs in CI on any change that affects this app, and blocks the
   merge.
4. One scanner exists in the repository, not two.

## Small item to fold in

`marked` is declared in **both** `dependencies` (line 170) and `devDependencies`
(line 262) of the root `package.json`. Harmless today, because npm takes the
`dependencies` entry, but it is the same classification sloppiness that caused
the outage. Remove the `devDependencies` copy and regenerate the lockfile with
`npm install --package-lock-only`.

## Out of scope

- The CLI's undeclared imports — that is TASK_2026_394.
- Moving migrations out of the container CMD — that is TASK_2026_395.
