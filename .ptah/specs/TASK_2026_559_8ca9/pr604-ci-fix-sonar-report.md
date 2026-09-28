# PR #604 — SonarCloud new-code issues and content manifest (TASK_2026_559)

Branch `fix/task-559-mcp-tool-contract`, HEAD `5f10aaae4`. Every issue in the
list was fixed at its source. The degradation-audit gate stays at TOTAL 293.

## Issue table

| Rule  | Location                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S2871 | `scripts/copy-wasm.js:456` (and `:448`, the same bare sort in the same `assert.deepEqual`)              | Added `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`. Both arrays hold file names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S2871 | `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-consent-store.ts:113`     | Added the same comparator. The array holds `Object.keys` strings; `RECORD_KEYS` compares positions, so the code-unit order is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S2871 | `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts:139`              | Added the same comparator. The array holds `<capability>:<language>` keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S2871 | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-contract-help.ts:296` | Added the same comparator. The array holds unhandled keyword strings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S2871 | `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts:186`             | Added the same comparator. The array holds rendered diagnostic strings. The `localeCompare` sort at `:189` was not in the issue list and was left alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S2871 | `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts:74`                    | Added the same comparator. The array holds framework names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S2871 | `libs/backend/workspace-intelligence/src/project-analysis/monorepo-member-discovery.ts:186`             | Added the same comparator. The array holds directory names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S2871 | `.../monorepo-member-discovery.ts:300`                                                                  | Added the same comparator. The array holds relative paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S2871 | `.../monorepo-member-discovery.ts:332`                                                                  | Added the same comparator. The array holds relative paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S8707 | `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:83, :84, :249`                               | Product fix. Added `resolveCliVsixPath(argument)`: it calls `path.resolve`, then accepts the path only inside `DIST_DIR` or as an existing `.vsix` file. Any other argument prints a clear message to stderr and exits 1. The CLI branch now routes through it, so the `statSync`, the `AdmZip` read and the size in the success message all see a validated path. The self-test archive (`.wasm-vsix-test-*/fixture.vsix`) is an existing `.vsix` file, so the self-test path stays valid.                                                                                                                        |
| S5443 | `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts:332`             | The seeded label `'/tmp/d.ts'` named a publicly writable directory. The test now creates `fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-diag-floor-'))`, seeds `path.join(seededRoot, 'd.ts')`, and removes the directory in a `finally`. The seeded `file` value is only a label for `seed()`, so the assertion is unchanged.                                                                                                                                                                                                                                                                                       |
| S4036 | `apps/ptah-cli/scripts/verify-packed-wasm.cjs:94, :105, :180, :231`                                     | Kept the behaviour with `// NOSONAR` and a one-line reason on each flagged line. Reasons: `tar` is an external binary with no JS entry, so `process.execPath` cannot run it; the file's own comments record that PATH lookup is required (MSYS `tar` on Windows, `npm` as a `.cmd` wrapper), so an env-limited PATH would break resolution; and no user input reaches these commands. The options objects were hoisted to consts so each `// NOSONAR` trails its flagged call line, which is the pattern this repo already uses (`network-backoff.ts:103`, `native-addon.js:131`) and which prettier keeps stable. |

All nine S2871 sites hold string arrays, so the code-unit comparator keeps the
current order exactly. No `localeCompare` was introduced.

## Content manifest

```
npm run manifest:generate
  Manifest written to: content-manifest.json
  Content hash: sha256:245ed00f27f3344e0669582dcde2b002dcad842a287aaae7dcec25fa79f55256
  Total files: 226

git diff --stat (manifest run)
  content-manifest.json | 4 +-
  (- / + on contentHash and generatedAt only)
```

The manifest run changed only `content-manifest.json`. The hand check of the
diff confirms it: the two changed lines are `contentHash` and `generatedAt`.
The manifest was never hand-edited.

```
npm run manifest:check
  content-manifest.json is up to date (sha256:245ed00f..., 226 files).  [exit 0]
```

## Changed paths

- `scripts/copy-wasm.js` — S2871: comparator on both self-test sorts.
- `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-consent-store.ts` — S2871.
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts` — S2871.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-contract-help.ts` — S2871.
- `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts` — S2871 and S5443.
- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts` — S2871.
- `libs/backend/workspace-intelligence/src/project-analysis/monorepo-member-discovery.ts` — S2871 (three sites).
- `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs` — S8707: `resolveCliVsixPath`.
- `apps/ptah-cli/scripts/verify-packed-wasm.cjs` — S4036: four `// NOSONAR` lines with reasons.
- `content-manifest.json` — regenerated by `npm run manifest:generate` only.

Prettier was run only on the files above, by explicit path.

## Verification

All commands ran in the foreground in the worktree:

```
node scripts/copy-wasm.js --self-test
  copy-wasm self-test PASS: ...  [exit 0]

node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test
  CLI WASM self-test PASS: ...  [exit 0]

node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test
  Electron WASM self-test PASS: ...  [exit 0]
  (the electron script is verify-packed-wasm.js, not .cjs)

node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test
  VSIX WASM self-test PASS: ...  [exit 0]

node_modules/.bin/nx run-many -t=test,lint,typecheck \
  -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core \
     @ptah-extension/vscode-lm-tools --skip-nx-cache
  NX   Successfully ran targets test, lint, typecheck for 3 projects  [exit 0]

npx nx run degradation-audit:lint --skip-nx-cache
  degradation-audit: TOTAL 293 unsuppressed site(s)  [exit 0]
```

TOTAL 293 is at the allowed ceiling, not above it. No git commit, push, stash,
reset, restore, checkout or clean was run. `code-logic-review.md` and
`research/diagnostics-worktree-repro.ts` were not touched.
