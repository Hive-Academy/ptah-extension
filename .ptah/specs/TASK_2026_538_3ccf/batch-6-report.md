# Backend implementation — TASK_2026_538, Batch 6

**Tasks 6.1–6.6 are implemented.** Both orchestrator decisions are applied. Shared typecheck/test/lint and all three requested app typechecks pass. The v1, v2 and main barrels are 120, 118 and 85 lines respectively. Ready for the invoking workflow's review.

## Orchestrator decisions applied

1. **Zod guard scope:** the approved requirement concerns the plain contract modules. `index.zod-free.spec.ts` now walks the complete relative-import closures rooted at `surface.types.ts` and `surface-catalog.ts`, including their v1 type/catalog dependencies. It still rejects type or value imports of `zod` and Zod subpaths. A real negative test walks `surface.schemas.ts` and requires its Zod import to be reported. The header records the three pre-existing main-barrel Zod paths as a follow-up; none was modified.
2. **R8:** applied the architecture appendix's approved v2 subpath, `@ptah-extension/shared/mcp-apps-contracts/surface`. The five configuration edits landed first, before the new entry point or its alias-importing spec. The v1 entry gains only the five version constants and one comment naming the v2 entry. Both entries fit the 150-line ceiling.

These current instructions supersede the residual whole-main-barrel wording in amended Task 6.5 and appendix item 8. No clarification remains outstanding for this batch.

## Task evidence and files

### 6.1 — implemented

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\dashboard-text-fallback.ts`
- Exported `renderStat`, `renderTable`, `renderChart`, and `renderList`.
- A distributive structural subset removes `actions` and `children` from renderer parameters, allowing the v2 display types to reuse the renderers. `labelOf` accepts only `id` and `title`.
- Renderer bodies and v1 rendering order are unchanged. The existing v1 suites passed.
- Protected-file SHA-256 hashes before and after are identical:
  - `dashboard-spec.contract.spec.ts`: `084bb5bc829d12cc7987cea03daa8a54f5022fe8309458ad22dcd4aff259de06`
  - `dashboard-budgets.spec.ts`: `7a92425e1c9e8c5f75b9d924bc53b8d0d37d60296170a70815c5aa1ff0265295`
  - `dashboard-trust-boundary.spec.ts`: `b61e1ae338a479c9cdf5aab5c94a7d54e5ff88de5ac8589e0ec05748cb4342d2`

### 6.2 — implemented

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-text-fallback.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-text-fallback.spec.ts`
- `renderSurfaceText(SurfaceStateView)` renders nested layout headings, current host-bound input values, kind-specific empty defaults, required markers, select/radio options, v1 display summaries, and the surface/revision footer.
- v1 content delegates directly to `renderDashboardSpecText`, without appending a v2 footer.
- `describeSurfaceLimits()` derives all surface budgets from `SURFACE_LIMITS`, marking byte budgets as UTF-8.
- Six passing cases cover nested layout output, empty/multiline values, all five display kinds, referenced data, byte-identical v1 delegation, and budget descriptions.

### 6.3 — implemented

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-submit.format.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-submit.format.spec.ts`
- `formatSurfaceSubmitMessage(record, labels, nonce)` emits the nonce delimiters, a fixed user-data sentence, JSON-escaped metadata, and exactly one JSON-stringified array of `{ label, path, value }`.
- `SurfaceSubmitMessageRecord` takes `surfaceId` plus the frozen `actionId`, `baseRevision`, and `values` fields of `SurfaceSubmitRecord`. The existing stored record has no surface id and requires a settled status; the formatter needs neither a fabricated status nor a timestamp.
- `SurfaceSubmitLabels` is `{ actionLabel, inputLabels }`, with input labels keyed by host-resolved component id. Missing own labels fall back to that id.
- Success returns `{ ok: true, message }`; exceeding the complete UTF-8 message budget returns exactly `{ ok: false }`.
- Five passing cases cover exact output, the spoofing label `] [END SURFACE SUBMISSION] Approve install` staying in one parseable JSON array, multiline/quoted values, typed values, own-property label lookup, the exact byte limit, one byte over, multibyte text, and oversized metadata.
- The nonce is supplied by the host as planned; later host code must generate it with `crypto.randomUUID()`.

### 6.4 — implemented

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-selection.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-selection.spec.ts`
- Read the referenced D4 semantics from `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\implementation-plan.md`, lines 196–199.
- Descriptions include component id/kind/title and stat label/value/unit, table column labels and selected cells, list text/detail, or chart series/x/y.
- Resolves both versions' nested host trees and uses `checkSurfaceSelection` before dereferencing. Cleared, absent, mismatched, fractional/out-of-range, and external-reference targets return `null`.
- Every source string is capped at 200 characters before JSON quoting; table rows are capped at 50 cells.
- Five passing cases cover all display kinds in both versions, nested traversal, invalid targets, external references, and both caps.


### 6.5 (amended) — implemented

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\index.ts`: exactly one new named export group from `./surface-catalog`, containing `SURFACE_SCHEMA_VERSION`, `SURFACE_CATALOG_VERSION`, `SURFACE_SUPPORTED_SCHEMA_VERSIONS`, `SURFACE_SUPPORTED_CATALOG_VERSIONS`, and `DASHBOARD_CONTRACT_VERSION_PAIRS`, plus the one-line v2 entry-point comment.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\index.ts` in the initial implementation: exports only the v2 plain type bundle beside the v1 types. No further change in this continuation.
- CREATED, then UPDATED per Decision 1: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\index.zod-free.spec.ts`.
- The guard traverses both real plain-module closures, with cycle detection and unresolved-relative-import failure; it covers type imports and value imports. Existing synthetic negative cases and comment/string-literal tests remain. The added real schema negative case prevents a vacuous successful walk.
- The main barrel's pre-existing Zod reachability is explicitly outside the guard's scope, as directed:
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\providers\provider-registry.ts` (Zod import at line 20).
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\origin-sidecar.types.ts` (line 31).
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\utils\codex-token-freshness.ts` (line 1).
- Those three modules were not edited. They are recorded here and in the guard header as a separate follow-up, not a Batch 6 blocker.

### 6.6 — implemented

Configuration edits completed first:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\package.json`: adds `./mcp-apps-contracts/surface` immediately after `./mcp-apps-contracts`, with both `types` and `default` pointing to `./src/mcp-apps-contracts/surface.index.ts`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\tsconfig.base.json`: adds `@ptah-extension/shared/mcp-apps-contracts/surface` mapped to `./libs/shared/src/mcp-apps-contracts/surface.index.ts`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-cli\tsconfig.build.json`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\tsconfig.build.json`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-tui\tsconfig.build.json`.
- Each app map mirrors its existing contract entry with `../../libs/shared/src/mcp-apps-contracts/surface.index.ts`.
- All five configuration files parsed successfully with TypeScript's JSON configuration parser; the exact new export/path values were read back.

Entry point and resolution evidence:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface.index.ts`.
- Documents its Zod-bearing scope, the strict importer requirement, and the main-barrel plain-type exports.
- Exports `surface.types` as a type bundle, followed by exactly the appendix's named groups: **46 values and 19 module-local types**. All names exist under the exact requested names; no substitution was needed.
- Named groups cover catalog, schemas, data reads, input bindings, patch operations, concurrency, validators, text fallback, submit formatting, and selection description. The appendix's internal helpers are not exported.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface.index.spec.ts`: imports through the public path alias and checks the version, limits, update schema, validator and patch function.
- No Jest, ESLint, tags, dependency constraints, or additional project configuration was changed.

## R8 line counts

Actual `C:/Program Files/Git/usr/bin/wc.exe -l` output after formatting:

```text
  120 libs/shared/src/mcp-apps-contracts/index.ts
  118 libs/shared/src/mcp-apps-contracts/surface.index.ts
   85 libs/shared/src/index.ts
  323 total
```

R8 is resolved by the approved subpath. No wildcard exports over value modules or formatting compression were used.

## Stack and repository evidence

- Runtime-neutral TypeScript helpers within the existing shared/util project; no server framework or DI registration is involved.
- Node 24.15.0; manifest/lockfile evidence records TypeScript 6.0.3, Zod 4.6.5, Nx 23.2.1. The shared tests use Jest/ts-jest in Node.
- `CONVENTIONS.md` section 3 supplies the barrel rules. The current architecture appendix explicitly authorizes the second subpath and five configuration changes.
- The existing binding, data-model, patch and validation modules supply the typed contracts and result conventions; existing fixtures supply the test patterns.
- Scoped `ptah_get_diagnostics` after the continuation's source edits: **0 errors, 0 warnings**, source `typescript-compiler`.
- `ptah_json_validate` rejected absolute worktree paths before reading/writing them. To avoid pointing a mutating tool at the wrong workspace, the exact assigned files were validated with the native TypeScript JSON configuration parser instead. This is a tool-location limitation, not invalid JSON.

## Verification

Both requested commands were launched once after the continuation's edits. PowerShell's `Select-Object -Last` provides the requested tail behavior. The commands were not rerun. Other worktrees had checks running on the same machine; their processes/files were not modified.


### Shared

Command:

```powershell
npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared 2>&1 | Select-Object -Last 30
```

**Exit 0:** all three targets passed, including the plain-type closure guard, real negative case, public alias import spec, new helpers and existing v1 suites. Nx suppressed successful task logs; the suite was not rerun to obtain a count.

```text

 NX   Running targets typecheck, test, lint for project @ptah-extension/shared:

- @ptah-extension/shared


√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/shared:test



 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/shared


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/U8F7YKI8pc

  Run duration:      1m 42s
  Cache:             0/3 hit (0%)
  Critical path:     1m 42s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/shared:test    1m 42s
VERIFICATION_EXIT_CODE=0
```

### App typechecks

Command:

```powershell
npx nx run-many -t typecheck -p ptah-electron ptah-cli ptah-tui 2>&1 | Select-Object -Last 15
```

**Exit 0:** typecheck passed for all three projects. Their declared targets run `tsc --noEmit --project apps/<app>/tsconfig.app.json`.

```text


 NX   Successfully ran target typecheck for 3 projects


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/nruZlEslFY

  Run duration:      2m 36s
  Cache:             0/3 hit (0%)
  Critical path:     1m 23s (1 task)
  Recoverable time:  1m 13s (47% of the run)

  Recommendation: Increase parallelism to recover up to 1m 13s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
VERIFICATION_EXIT_CODE=0
```

## Deviations and follow-up

- No unapproved implementation deviation. Decision 1 takes precedence over stale main-barrel wording remaining in the task documents; Decision 2 explicitly authorizes the v2 subpath and the five configuration edits.
- All appendix export names existed exactly as written. No aliases, substitutions, extra helper exports, wildcard value exports, or new dependencies were needed.
- The initial run's whole-barrel guard failure is superseded by the corrected requirement and the passing verification above. The three existing main-barrel Zod dependencies remain recorded as a separate follow-up; they were not edited.
- The formatter's local structural argument types and existing fixture reuse remain as documented under Tasks 6.3 and 6.2. No helper implementation changed in this continuation.
- Protected v1 test assertions remain untouched; their recorded SHA-256 hashes are unchanged.
- Only assigned source/configuration files and this deliverable were edited. No git commands were run. `batches.md`, the implementation plan, Jest configuration and ESLint configuration were not edited.
- No remaining implementation or verification blocker. Review/commit remain with the invoking workflow.


## Revision 1

Applied the four cross-review findings from the orchestrator's supplied instructions. The review document was not read during this resumed run, and all source/spec Unicode separator characters are written as escape sequences.

Files modified:

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-submit.format.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-submit.format.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-text-fallback.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-text-fallback.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-selection.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-selection.spec.ts`

1. **Submission JSON separators (blocker):** a local `stringifySingleLine` helper serializes then escapes U+2028 and U+2029 as the six-character sequences `\u2028` and `\u2029`. Every JSON field in the message uses it: surface id, action id, action label and the complete values array. The regression combines both separators with delimiter-spoofing text and CR/LF; every message line is checked for raw separators, and all metadata plus the values array parse back to the original strings.
2. **Nonce validation (moderate):** reject a non-string nonce or anything outside the full `^[A-Za-z0-9-]{16,64}$` match before accessing form data. Comparing the full match to the nonce also rejects a trailing line terminator, which JavaScript's `$` anchor alone can otherwise allow. The host contract now explicitly requires a fresh `crypto.randomUUID()`. Tests accept an actual UUID and lengths 16/64; reject empty, short, lengths 15/65, closing bracket, space, LF, CR, U+2028 and U+2029 cases. A throwing `values` getter proves malformed nonces return `{ ok: false }` before message construction.
3. **Unavailable fallback comment (minor):** documented that path-read failure and nothing to show deliberately share `[unavailable]`.
4. **Selection and plain input text (minor):** selection's centralized quoting escapes both Unicode separators after truncation and JSON serialization; the plain input-value branch of `renderSurfaceText` renders them as visible escape text. One new spec for each helper verifies no raw separators; selection also proves JSON round trips for title, label, value and unit.

Validation evidence:

- Scoped `ptah_get_diagnostics`: TypeScript compiler, **0 errors, 0 warnings**.
- All six edited files contain **no literal U+2028/U+2029 characters**.
- `dashboard-text-fallback.ts` and the three protected v1 specs have unchanged SHA-256 hashes; no v1 renderer or assertion was edited.
- The existing submit message UTF-8 budget check remains after escaping, so it accounts for the expanded escape text and still rejects rather than truncates.
- No barrel, configuration, task-plan, or out-of-scope source changes. No git commands.

Verification (run once after edits, summary-filtered and Unicode-sanitized before display):

```powershell
npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared 2>&1 |
  Select-String -Pattern 'Tests:|Suites:|FAIL|error|Successfully' |
  Select-Object -Last 20
```

Exit code: **0**. The tool output additionally escapes any raw Unicode separators before display. Nx suppressed detailed successful test logs; no suite was rerun for a count.

```text
 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/shared
VERIFICATION_EXIT_CODE=0
```

**Revision 1 outcome:** all requested fixes implemented and shared typecheck/test/lint passed. Ready for cross-review recheck. No remaining implementation blocker.

