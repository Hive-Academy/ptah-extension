# PR #604 — Linux CI `main` job: root causes and fixes (TASK_2026_559)

Branch `fix/task-559-mcp-tool-contract`, HEAD `5f10aaae4`. All three failure
groups reproduce on `ubuntu-latest` only; each one traced to a named platform
assumption. No assertion was weakened anywhere.

---

## Failure 1 — `analysis-namespace.builders.spec.ts`: `discoverSourceFiles`

Failing tests: "asks for one past the census limit with the vendor excludes
inside the walk" and "is truncated at limit + 1 files and returns only limit
of them".

**Root cause (platform assumption).** The fixtures used the Windows-literal
root `'D:/ws'`. `toAbsoluteWorkspacePath`
(`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:347`)
gates the pass-through branch on host-scoped `path.isAbsolute`. On POSIX,
`path.posix.isAbsolute('D:/ws/src/a.ts')` is `false`, so the root is prefixed a
second time: `path.posix.join('D:/ws', 'D:/ws/src/a.ts')` yields
`'D:/ws/D:/ws/src/a.ts'`. The CI log shows exactly that doubled path in the
received value.

**Fix: the TESTS.** The product behavior is documented as intended. The spec's
own comment (lines 613–625 of the same file) records the repo decision: gating
on host-scoped `path.isAbsolute` is by design, and a `D:/...` literal is "a
property of the fixture, not of the builder". Fixtures must use roots that are
absolute on the host that runs the test. Both tests now build the root with
`path.join(path.sep, 'ws')` and derive every path from it. The pass-through
branch is still exercised: on POSIX the fixture is already absolute; on Windows
`\ws\src\a.ts` is absolute too, because `path.win32.isAbsolute('\ws')` is
`true`. Assertion structure and expected counts are unchanged — only the
fixture literal changed.

---

## Failure 2 — `export-disclosure.integration.spec.ts`: R5-01 (×2), R24d-01

Failing assertion: `expected failed: 1, got 2`; CI showed
`failedByReason: { read: N }` instead of `{ 'unsupported-syntax': 1 }`.

**Root cause (platform assumption).** Same assumption as failure 1. The spec
declared `const ROOT = 'D:/ws-24d'`. `buildGraph` passes every file through
`toAbsoluteWorkspacePath` (host-scoped `path.isAbsolute`), so on POSIX the root
is prefixed onto the already-absolute fixture path. The `files` map is keyed by
`${ROOT}/src/computed.js`, but the graph reads back the doubled path, every
`readFile` misses, and the coverage counts reads as failures — so the
`unsupported-syntax` disclosure the tests assert never appears.

**Fix: the TEST.** `ROOT` is now `'/ws-24d'`, rooted without a device: absolute
on POSIX and on Windows (drive-less rooted path,
`path.win32.isAbsolute('/ws-24d')` is `true`). Every key and assertion already
used `${ROOT}/...` templates, so nothing else changed. The real tree-sitter
WASM parser still runs against the same sources, and every assertion keeps its
original strength.

---

## Failure 3 — `translation-proxy.sdk.integration.spec.ts`: ESRCH kill failure

Failing test: "the timeout kill ends the whole child tree and verifies it
exited", with `Child process tree cleanup failed: tree kill reported an error
(Error: kill ESRCH)` at spec line 946.

**Root cause (platform assumption): a PRODUCT bug in
`platform-core/src/utils/process-tree-reaper.ts` — not a test race, and not
pre-existing flakiness.**

- `auth-providers` is unchanged by this PR (`git diff --name-only
origin/main...HEAD -- libs/backend/auth-providers` is empty). The failing
  path is `boundedTreeKill` → `killProcessTree(pid, 'SIGKILL', cb)`, and
  `killProcessTree` lives in `platform-core`, which this PR modified.
- The POSIX branch of `killProcessTree` reported kill errors via `onError`
  only when `!isEsrch(error)`. `isEsrch` gated its check on
  `error instanceof Error`. Under Jest, module code runs in a VM realm, but
  errors thrown by Node core APIs (`process.kill`) are created in Node's outer
  realm — so `instanceof Error` is `false` for a real ESRCH. Verified
  empirically with a temporary probe spec inside a Jest module:
  `process.kill(<exited-pid>, 0)` threw an error with
  `instanceof Error === false`, `code === 'ESRCH'`,
  `message === 'kill ESRCH'`.
- Two consequences on the Linux runner: (a) the poll's ESRCH fast path
  (`process.kill(-pid, 0)` → ESRCH → resolve) never fired — this is exactly
  what the translation-proxy spec's own `TREE_KILL_TIMEOUT_MS` comment
  documents for Linux CI; (b) an ESRCH for a process that had already exited
  reached `onError` as a kill failure, so `killChildTree` collected
  "tree kill reported an error (Error: kill ESRCH)". ESRCH during a kill means
  the target is already gone — the successful outcome — so reporting it is
  wrong.
- The `onError` reporting branch was introduced by this PR (commit `d9baaf969`);
  before it, every kill error was swallowed. So this failure is PR-related, not
  pre-existing flakiness.

**Fix: the PRODUCT.** `isEsrch` is now duck-typed — never `instanceof`:
`code === 'ESRCH' || String(message).includes('ESRCH')`. EPERM still counts as
"alive, keep polling" (its test is unchanged and still passes). A regression
test was appended to `process-tree-reaper.spec.ts`: it captures a REAL ESRCH
from `process.kill` against a `spawnSync` child that already exited, so the
error crosses the Jest realm boundary exactly as on CI, then asserts
`killProcessTree` does not report it to `onError`. Reverse verification: with
the pre-fix `instanceof`-gated predicate restored, this regression test FAILS
(onError was called); with the duck-typed fix it PASSES. The realm-local
`new Error` used by the earlier ESRCH tests cannot catch this — which is why
the bug shipped.

---

## Changed paths

- `libs/backend/platform-core/src/utils/process-tree-reaper.ts` — product:
  duck-typed `isEsrch` (documented; `instanceof` fails across the Jest VM
  realm for Node-core errors).
- `libs/backend/platform-core/src/utils/process-tree-reaper.spec.ts` — test:
  regression test "does not report a real cross-realm ESRCH from
  process.kill".
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`
  — test: host-scoped `path.join(path.sep, 'ws')` roots in the two
  `discoverSourceFiles` tests.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/export-disclosure.integration.spec.ts`
  — test: `ROOT` changed from `'D:/ws-24d'` to `'/ws-24d'`.

`git diff --stat`: 4 files changed, 78 insertions(+), 17 deletions(-).
No file owned by the parallel SonarCloud agent (scripts/, apps/*/scripts,
workspace-intelligence sort comparators) was touched. Nothing was committed,
pushed, stashed or checked out.

## Verification

Per-spec Jest (Windows host, the platform on which these tests already passed;
the fixtures are now host-neutral, and failure 3's regression test reproduces
the Linux realm behavior on any host):

```
npx jest -c libs/backend/vscode-lm-tools/jest.config.ts .../analysis-namespace.builders.spec.ts
  Tests: 104 passed, 104 total

npx jest -c libs/backend/vscode-lm-tools/jest.config.ts .../export-disclosure.integration.spec.ts
  Tests: 10 passed, 10 total

npx jest -c libs/backend/platform-core/jest.config.ts .../process-tree-reaper.spec.ts
  Tests: 9 passed, 9 total

npx jest -c libs/backend/auth-providers/jest.config.ts .../translation-proxy.sdk.integration.spec.ts
  Tests: 9 passed, 9 total  (79.79 s)
```

Nx targets for the three projects whose files changed (platform-core added
because it was modified):

```
node_modules/.bin/nx run-many -t=test,lint,typecheck \
  -p @ptah-extension/vscode-lm-tools @ptah-extension/auth-providers @ptah-extension/platform-core \
  --skip-nx-cache
  NX   Running targets test, lint, typecheck for 3 projects
  NX   Successfully ran targets test, lint, typecheck for 3 projects
  [exit 0]
```

Degradation-audit gate (an early `return` inside a `catch` would be flagged):

```
npx nx run degradation-audit:lint --skip-nx-cache
  degradation-audit: TOTAL 293 unsuppressed site(s)   [exit 0]
```

TOTAL 293 is at the allowed ceiling, not above it.

**POSIX simulation evidence.** Failure groups 1 and 2 were confirmed with
`path.posix` probes: `path.posix.isAbsolute('D:/ws/src/a.ts') === false` and
`path.posix.join('D:/ws', 'D:/ws/src/a.ts') === 'D:/ws/D:/ws/src/a.ts'`,
matching the doubled paths in the CI log. The ESRCH realm behavior was
confirmed by the probe spec run under Jest (results quoted above), then the
probe file was deleted.
