# TASK_2026_623 measurement

Measured in Batch 31 on branch `feat/task-623-display-panel` at HEAD `d7a69fbd0`, against the merge base with `main`,
`70f995a56fefa1197f4ce8915fb33289a102761d`. The tokenizer is `gpt-tokenizer` 4.0.0, called as `encode(text).length`
(the default encoding), the same call that `ptah-ui-hint.spec.ts` and both compactness specs use. Every number below
was produced by the command printed beside it. None was carried over from an earlier batch or review.

## 1. `PTAH_UI_HINT` (R8.1, Req 5.11)

Source: `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`.

Text at HEAD:

```text
Use ```ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; ```ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself. Load the ptah-surface-authoring skill for grammar and examples.
```

| Version                                   | Characters (UTF-16) | UTF-8 bytes | Tokens |
| ----------------------------------------- | ------------------: | ----------: | -----: |
| HEAD                                      |                 371 |         373 |     87 |
| HEAD without ` $limits` (R8.1 fallback)   |                 363 |           — |     85 |
| Merge base (610 hint, for reference)      |                 320 |         322 |     74 |

- The hint is within the 100-token cap at 87 tokens, so `$limits` stays in the hint. The without-`$limits` row is
  recorded because R8.1 asks for both counts. It is not shipped.
- The hint contains no example fence. R8.1 does not require one, and R8.3 assigns every worked example to the
  `ptah-surface-authoring` skill (decision #140, which amends #136).
- `ptah-ui-hint.spec.ts` pins the budget (`toBeLessThanOrEqual(100)`). Its two grammar cases are titled as what they
  check (decision #140): a future-fence guard that matches zero fences today, and component syntax coverage for the
  `display [id]` opener and the listed sources. Neither proves that the hint contains an example.

Command (throwaway script outside the repository; it evaluates the template literal from the source file, then
counts):

```bash
NODE_PATH=D:/projects/ptah-extension/node_modules node D:/tmp/b31/hint-count.js \
  libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts
# the merge-base row: same script on `git show 70f995a56:libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`
```

```js
// D:/tmp/b31/hint-count.js
const fs = require('fs');
const { encode } = require('gpt-tokenizer');
const src = fs.readFileSync(process.argv[2], 'utf8');
const m = /export const PTAH_UI_HINT = (`(?:\\[\s\S]|[^`\\])*`);/.exec(src);
const hint = new Function('return ' + m[1])();
console.log('chars=' + hint.length + ' utf8Bytes=' + Buffer.byteLength(hint) + ' tokens=' + encode(hint).length);
const noLimits = hint.replace(' $limits', '');
console.log('withoutLimits chars=' + noLimits.length + ' tokens=' + encode(noLimits).length);
```

Observed output (HEAD): `chars=371 utf8Bytes=373 tokens=87`, `withoutLimits chars=363 tokens=85`.
Observed output (merge base): `chars=320 utf8Bytes=322 tokens=74`.

## 2. Corpus fence vs canonical JSON (R8.4)

Source: `libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts` over `ptah-ui.corpus.ts`. The spec asserts that
the fence is smaller for every case and puts both counts in the test title.

| Corpus case                     | Fence tokens | JSON tokens |
| ------------------------------- | -----------: | ----------: |
| turn-summary-sources-crlf       |           39 |         193 |
| literal-table-escapes-unicode   |           41 |         123 |
| changed-files-columns           |           19 |         129 |
| test-run-list                   |            8 |          81 |
| coverage-trend-chart            |           35 |         109 |
| release-checklist-mixed         |           70 |         218 |
| container-row-badges            |           24 |         131 |
| container-col-note-progress     |           19 |         113 |
| container-grid-stats            |           46 |         244 |
| container-card-avatar           |           30 |         121 |
| container-section-table         |           18 |         150 |
| container-accordion-tests       |            9 |         104 |
| atom-note-tones                 |           26 |         117 |
| atom-progress-tones             |           28 |         121 |
| atom-badge-tones                |           14 |         104 |
| atom-avatar                     |           12 |          78 |
| stat-trend-spark                |           73 |         184 |
| mixed-nested-release            |          114 |         486 |
| skill-subagent-usage-dashboard  |           59 |         344 |
| skill-id-update-first           |           30 |         153 |
| skill-id-update-second          |           37 |         175 |
| skill-cli-tools-usage-context   |           27 |         266 |

The fence is smaller than the JSON in all 22 cases.

## 3. `$agents` fence vs GitHub-markdown table (R8.5)

Source: `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-compactness.spec.ts` (five agents with name, status, tokens,
cost and duration). The spec first asserts that the fence renders exactly the values that the markdown table types out.

| Form                                   | Tokens |
| -------------------------------------- | -----: |
| (a) display fence using `$agents`      |     25 |
| (b) equivalent GitHub-markdown table   |    127 |

No ratio target is set (R8.5).

Command for sections 2 and 3 (the counts are read from the test titles in the Jest JSON report):

```bash
npx jest -c libs/shared/jest.config.ts \
  libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts \
  libs/shared/src/mcp-apps-contracts/ptah-ui-agents-compactness.spec.ts \
  --json --outputFile=D:/tmp/b31/compact.json \
  --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}' \
  --coverage=false --maxWorkers=2
```

Result: 2 suites passed, 40 of 40 tests passed.

## 4. `tools/list` at HEAD vs merge base (NFR Req 5.10 coding parity, A8 Apps delta)

Method: `git archive` of HEAD and of the merge base, each into its own directory outside the repository
(`D:/tmp/b31/head`, `D:/tmp/b31/base`) with a junction to the shared `node_modules`. The same throwaway spec runs in
each tree. It calls `handleMCPRequest({ method: 'tools/list' })` from
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` for both host kinds and both
profiles, and records the count, the `JSON.stringify(tools)` character count and short sha256 hashes of the
serialised list and of the ordered tool names. Host kinds:

- VS Code: `hasIDECapabilities: true`, `hasSqliteLayer: false`.
- Electron: `hasIDECapabilities: false`, `hasSqliteLayer: true`.

The Apps profile is requested with `_callerToolProfile: 'apps'`. Coding is the default.

```bash
cd D:/tmp/b31/<base|head>
B31_DUMP=D:/tmp/b31/<base|head>-tools.json npx jest -c libs/backend/vscode-lm-tools/jest.config.ts \
  libs/backend/vscode-lm-tools/src/zz-measure.spec.ts \
  --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","(^|/)wasm-bundle-dir([.]js)?$":"<rootDir>/__mocks__/wasm-bundle-dir.ts"}' \
  --coverage=false --maxWorkers=2
```

| Host     | Profile | Tools (base / HEAD) | Characters (base / HEAD) | List sha (base / HEAD)                | Names sha (base / HEAD)               |
| -------- | ------- | ------------------: | -----------------------: | ------------------------------------- | ------------------------------------- |
| VS Code  | coding  |             61 / 61 |          64815 / 64815   | e4a729c18c9f956c / e4a729c18c9f956c   | 7acad02633236c9d / 7acad02633236c9d   |
| Electron | coding  |             58 / 58 |          62510 / 62510   | 45a484cd8ea72987 / 45a484cd8ea72987   | 3f20aa1b2b0019e1 / 3f20aa1b2b0019e1   |
| VS Code  | apps    |             64 / 64 |        138323 / 138323   | b77bf9892a7c6ba3 / b77bf9892a7c6ba3   | 30dc87bf5ab49d12 / 30dc87bf5ab49d12   |
| Electron | apps    |             61 / 61 |        136018 / 136018   | bc26f9efb1c6d26c / bc26f9efb1c6d26c   | 06ce95142206ace3 / 06ce95142206ace3   |

Apps-only tools, per tool (`JSON.stringify(tool).length`, the same on both hosts and at base and HEAD):
`ptah_dashboard_propose_spec` 1613, `ptah_surface_update` 69675, `ptah_surface_get_state` 2217.

The two full dumps (`base-tools.json`, `head-tools.json`) were byte-identical (`cmp`).

- **NFR Req 5.10 (coding parity): holds.** The coding-profile `tools/list` has the same tool names and the same
  character count at HEAD and at the merge base, on both host kinds. The serialised lists are byte-identical.
- **A8 (Apps delta): 0 characters.** `/4` does not change the Apps-profile `tools/list`. `ptah_surface_update`
  builds its text from the `/3` constants (`SURFACE_CATALOG_VERSION`, `SURFACE_LAYOUT_KINDS`, `SURFACE_INPUT_KINDS`,
  `SURFACE_DISPLAY_KINDS` in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`).
  `surface-catalog.ts` keeps the `/4` additions in separate `SURFACE_CATALOG_4_*` lists, and the `/3` lists never
  grow.
- **A8 (spec): no change.** `surface-catalog-reference.spec.ts` does not derive the Apps tool text from `catalog.md`.
  It only pins that `catalog.md` has exactly one JSON example per `/3` `SURFACE_COMPONENT_KINDS` kind and that each
  example validates. It passes unchanged against the Batch 30 `catalog.md` (4 of 4 tests).

## 5. Eager closure (R9, 610 Req 5.1)

### Eager closure (Batch 33)

Builds (one each, approved by decisions #17 and #116), run from the worktree on 2026-10-11:

- `npx nx copy-renderer ptah-electron --parallel=1 --skip-nx-cache`: runs the one production
  `ptah-extension-webview:build` with `statsJson: true`. Output: `dist/apps/ptah-extension-webview/stats.json`
  (4,019,078 bytes).
  - Environment note: the first attempt failed because the worktree's `node_modules` is empty, and `project.json`
    resolves `node_modules/daisyui`, `node_modules/prismjs` and `node_modules/@pierre/diffs` from the workspace root.
    Directory junctions to the shared `D:\projects\ptah-extension\node_modules` packages were added (git-ignored,
    environment only, no source change).
- `npx nx build-dev ptah-electron --parallel=1`: `dist/apps/ptah-electron/main.mjs` (9,451,679 bytes).

Gate result: `node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json` returned
**PASS, exit code 0**, with output `eager inputs: 781; initial chunk bytes: 3025398`. No forbidden input
(display-panel, display-dock organism, `ptah-ui-agents-source.ts`) is in the static closure of `main.js`.

Growth check not run (single build, decisions.md #17).

Added eager inputs: these are inputs in the static `main.js` closure that also appear in
`git diff --diff-filter=A --name-only 70f995a56...HEAD`, which lists 60 files. Bytes are `bytesInOutput` from the
metafile.

| Input | Bytes | On allow-list |
| --- | ---: | --- |
| `libs/frontend/chat-ui/src/lib/atoms/copy-text-button.component.ts` | 1758 | **no** |
| `libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts` | 154 | yes (#59) |
| `libs/frontend/chat-ui/src/lib/services/ptah-ui-host-sources.ts` | 48 | yes |
| `libs/frontend/chat-ui/src/lib/utils/tool-language.utils.ts` | 1327 | **no** |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts` | 1242 | yes |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.ts` | 1255 | yes |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-feed.ts` | 1151 | yes (#107) |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.ts` | 531 | yes |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-recap-loader.ts` | 283 | yes (#107) |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-summaries.ts` | 2713 | yes (#107) |
| `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts` | 4806 | yes |

Total added eager bytes: 15,268.

Required allow-listed files (all present in the eager closure): `transcript-display-feed.ts`,
`transcript-turn-summaries.ts`, `transcript-turn-recap-loader.ts`, `ptah-ui-display-dock.ts`.

Decision #143(b) watch list:

- `copy-text-button.component.ts`: **in the eager closure (1,758 bytes). Unlisted eager growth, ruling needed.**
- `tool-language.utils.ts`: **in the eager closure (1,327 bytes). Unlisted eager growth, ruling needed.**
- `rpc-lane-plan-limits.types.ts`: absent (types only).
- `dashboard-avatar.component.ts`: absent.
- `dashboard-sparkline.component.ts`: absent.

Both flagged files are Phase 6 tool-execution additions (Batch 26). The eager tool-call components import them, so they
load at startup. Neither file is a display-panel input.

Measurement command: `node D:/tmp_b33/measure.js <worktree> <added-file-list>` (throwaway script outside the repo,
deleted after the run). It uses the gate's own exported `eagerInputs()`.
