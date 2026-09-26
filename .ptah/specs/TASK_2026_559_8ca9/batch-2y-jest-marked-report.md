# Batch 2y — Jest/`marked` ESM fix report

## Problem

Batch 2e made `libs/backend/vscode-lm-tools` import `libs/backend/tool-output-reducers`,
which imports `marked` (v18: `package.json` `"exports": {".": "./lib/marked.esm.js"}`,
`"type": "module"`, no default CJS export — confirmed via
`node -e "console.log(require('marked/package.json').exports)"`). Every Jest project
whose graph reaches `vscode-lm-tools` or `tool-output-reducers` failed with
`Must use import to load ES Module: node_modules/marked/lib/marked.esm.js`.

## Chosen fix

Root `jest.preset.js` (`D:\...\task-559-mcp-tool-contract\jest.preset.js`) now adds:

```js
moduleNameMapper: {
  '^marked$': path.resolve(__dirname, 'node_modules/marked/lib/marked.umd.js'),
},
```

`marked` ships a CommonJS UMD build (`lib/marked.umd.js`) alongside the ESM entry
point even though `package.json`'s `exports` map hides it from `require()`.
Redirecting the bare specifier to that file sidesteps ESM parsing entirely — no
project needs a `marked`-specific `transformIgnorePatterns` + `allowJs` workaround.

**Verified assumption**: Jest 30 (`package.json` `"jest": "^30.0.2"`) merges a
project's own `moduleNameMapper` with the preset's rather than replacing it —
confirmed empirically: `apps/ptah-extension-vscode/jest.config.ts` declares its own
`moduleNameMapper` (`vscode`, `wasm-bundle-dir`) with no `marked` entry, and after
adding only the preset mapper, `nx run ptah-extension-vscode:test` passed (9/9 suites,
101/101 tests) — the preset's `marked` mapping applied even though the project config
never redeclares it, and the project's own two mappings still work as before.

### Compared against per-project `transformIgnorePatterns`

Batch 2e's own `vscode-lm-tools`/`tool-output-reducers` jest configs, and the
orchestrator's uncommitted `apps/ptah-electron/jest.config.ts` fix, use
`transformIgnorePatterns: ['node_modules/(?!marked/)']` + `"allowJs": true` in
`tsconfig.spec.json` to let ts-jest transpile `marked.esm.js` to CommonJS per spec run.
That approach only helps the project that declares it — three more failing projects
(`ptah-extension-vscode`, `ptah-tui`, `ptah-cli`) would each need the same
`transformIgnorePatterns` line and an `allowJs: true` added to their
`tsconfig.spec.json`, and any future project that starts depending on
`vscode-lm-tools`/`tool-output-reducers` would silently reproduce the failure again.
The preset mapper fixes every current and future consumer in one place — smallest
blast radius that is still complete.

### Redundant per-project workarounds: kept, not removed

`libs/backend/vscode-lm-tools/jest.config.ts`, `libs/backend/tool-output-reducers/jest.config.ts`,
and the orchestrator's uncommitted `apps/ptah-electron/jest.config.ts` +
`apps/ptah-electron/tsconfig.spec.json` still carry the `transformIgnorePatterns`/`allowJs`
workaround. It is now inert for the `marked` concern — `moduleNameMapper` resolves the
`marked` specifier to the already-CommonJS UMD file before Jest's transform step ever
sees `marked.esm.js`, so nothing forces that file through ts-jest anymore. I left these
in place rather than removing them:

- The electron files are explicitly out of scope for this batch (task instructions:
  "do not modify" the Batch 8 in-progress files, and the electron jest/tsconfig edits are
  another agent's uncommitted work in the same tree — editing them risks a conflicting
  concurrent edit for zero behavioural gain).
- The two lib-level configs' `transformIgnorePatterns` is harmless dead configuration
  now (verified: `tool-output-reducers` and `vscode-lm-tools` both pass with the preset
  mapper active — see Verification), and removing it buys nothing but a slightly smaller
  diff, at the cost of re-touching files another batch owns.

## Frontend consumers of `marked` — unaffected, verified

`libs/frontend/markdown` (`src/lib/marked-extensions.ts`, `provide-markdown-rendering.ts`)
imports only types (`MarkedExtension`, `Tokens`) from `marked` at the type level; nothing
there calls into the `marked` runtime the mapper redirects. `@ptah-extension/markdown:test`
passed unchanged. The UMD build is the same published `marked` release (`marked@18.0.13`,
`lib/marked.umd.js` next to `lib/marked.esm.js` in the same package, same `lib/marked.d.ts`
types file) — it is not a different major version or a shim, so no behaviour change is
possible for any consumer, frontend or backend.

## Affected projects (transitive dependents of `tool-output-reducers` / `vscode-lm-tools`,

via `nx graph`) and results

| Project                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ptah-extension/tool-output-reducers`                             | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/vscode-lm-tools`                                  | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/cli-engine`                                       | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/gateway-chat-bridge`                              | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/rpc-handlers`                                     | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/thoth-runtime`                                    | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ptah-extension/markdown` (frontend, direct `marked` type import) | pass                                                                                                                                                                                                                                                                                                                                                                                               |
| `ptah-tui`                                                         | pass (848→ see below; flaky _build_ task noted, tests unaffected)                                                                                                                                                                                                                                                                                                                                  |
| `ptah-cli`                                                         | pass — 68/69 suites (1 pre-existing skip), 1100/1103 tests (3 skipped), after clearing a stale `dist/libs/backend/agent-generation` directory that made one _build_ task (`@ptah-extension/agent-generation:build`, `ENOTEMPTY`) flaky on the first two attempts; Nx's own flaky-task retry, and a clean rerun, both confirm this is a stale local build-cache artifact unrelated to `marked`/Jest |
| `ptah-electron`                                                    | pass — 54/55 suites (1 pre-existing skip), 848/851 tests                                                                                                                                                                                                                                                                                                                                           |
| `ptah-extension-vscode`                                            | pass — 9/9 suites, 101/101 tests                                                                                                                                                                                                                                                                                                                                                                   |

`node_modules/.bin/nx run-many -t=test -p ptah-cli ptah-extension-vscode ptah-tui ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers --skip-nx-cache`
→ `Successfully ran target test for 6 projects and 42 tasks they depend on` (exit 0).

`node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → `✅ All external
imports are covered by package.json dependencies.` (exit 0).

## `@ptah-extension/cli-agent-runtime:test` — separate investigation

**Finding: environmental, not caused by this branch.** `git diff main...HEAD --stat --
libs/backend/cli-agent-runtime` returns no output — this branch has not touched that
library at all, so the failure exists identically on `main`.

Root cause: `agent-role-resolver.service.spec.ts` creates its fake workspace with
`mkdtempSync(join(tmpdir(), 'ptah-role-resolver-'))` and a `.git` marker inside it, then
expects `resolveHarnessWorkspaceRoot` (`libs/backend/harness-sync/src/lib/workspace/workspace-root.ts`)
to resolve that temp directory as the harness root. That function ascends looking for a
`.ptah` marker (checked before `.git`, across the _whole_ path from the temp dir up to
the user's home directory) and stops only when it finds one or reaches home. On this
machine, `C:\Users\abdal\AppData\Local\Temp\.ptah` exists (confirmed:
`Test-Path 'C:\Users\abdal\AppData\Local\Temp\.ptah'` → `True`) — a stray directory left
in the OS temp folder, above the spec's `mkdtemp`-created workspace. The ascent finds
that `.ptah` first and returns the whole Temp folder as the harness root instead of the
test's own temp workspace, so `agentsDir` becomes `...\Temp\.claude\agents` (empty), and
every `resolve()`/`listRoles()` call in the spec gets `no_roles` instead of the role/error
it expected — all 17 failures are this same one root cause, not 17 independent bugs.

This is a dirty-machine-state issue (leftover `.ptah` directory in `%TEMP%`, presumably
from an earlier unrelated run of a Ptah CLI/tool), not a defect in this branch's code and
not a test-infrastructure gap in the Jest/`marked` sense this batch owns. Per the batch
instructions, it is reported rather than fixed: fixing it would mean either deleting
state outside the repository (not a "configuration or script file" this role may touch)
or changing `resolveHarnessWorkspaceRoot`'s marker-walk semantics, which is application
source, not test infrastructure, and is explicitly out of this role's contract.

## Files changed

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/jest.preset.js`
  — added `moduleNameMapper: { '^marked$': <abs path to node_modules/marked/lib/marked.umd.js> }`.

No other files were changed. `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
(+spec) and `libs/backend/vscode-lm-tools/.../tool-description.builder.ts` (+spec) were
not touched, as instructed.

## Verification commands run

- `node_modules/.bin/nx run ptah-extension-vscode:test --skip-nx-cache` → pass (9/9, 101/101)
- `node_modules/.bin/nx run @ptah-extension/cli-agent-runtime:test --skip-nx-cache -t agent-role-resolver` → 1 suite / 17 tests fail (environmental, see above; 63 other suites / 1028 other tests in that project pass)
- `node_modules/.bin/nx run-many -t=test -p @ptah-extension/cli-engine @ptah-extension/gateway-chat-bridge @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/tool-output-reducers @ptah-extension/markdown --skip-nx-cache` → pass
- `node_modules/.bin/nx run ptah-tui:test --skip-nx-cache` → pass
- `node_modules/.bin/nx run ptah-cli:test --skip-nx-cache` (rerun after clearing a stale `dist/libs/backend/agent-generation`) → pass, 68/69 suites, 1100/1103 tests
- `node_modules/.bin/nx run ptah-electron:test --skip-nx-cache` → pass, 54/55 suites, 848/851 tests
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → pass
- `node_modules/.bin/nx run-many -t=test -p ptah-cli ptah-extension-vscode ptah-tui ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers --skip-nx-cache` → pass (6 projects, 42 dependent tasks)

## Rollback

Revert the `moduleNameMapper` block added to `jest.preset.js` (single hunk, no other
files touched). The three pre-existing per-project `transformIgnorePatterns`/`allowJs`
workarounds are untouched and would resume being load-bearing again immediately.
