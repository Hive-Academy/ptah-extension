# Batch 26a executor report — LSP report contract + forwarding (Lane H)

Base: HEAD 4c9a8aefa (Batches 25a + 25b). Working tree left dirty; no git state changes.

## Files

All under `libs/backend/vscode-lm-tools/src/`:

- MODIFIED `lib/code-execution/types.ts` — `LspMechanism` (`provider-defined | symbol-index | declaration-scan |
  graph-scoped-scan | text-scan | none`) and `LspLocationReport { locations, mechanism, language, languageSupported,
  approximations, truncated? }`; `LSPNamespace` gains `getDefinitionReport` / `getReferencesReport`. `approximations` is
  the platform-core `Approximation` vocabulary.
- MODIFIED `lib/code-execution/namespace-builders/ide-namespace.builder.ts` — optional
  `IIDECapabilities.lsp.getDefinitionReport?` / `getReferencesReport?`. The capability-backed namespace validates input,
  runs `onDefinitionLookup` (definition report only), and prefers the host report. When there is none, it wraps the array
  API as `mechanism:'provider-defined'`, `languageSupported:null`. With no host, both answer `mechanism:'none'`,
  `languageSupported:false`, `locations:[]`. `language` comes from the WI registry (`languageForExtension`), or `null`.
  The array APIs are unchanged.
- MODIFIED `lib/code-execution/mcp-core/protocol-dispatcher.ts` — `ptah_lsp_definitions` / `ptah_lsp_references` call
  the report methods.
- MODIFIED `lib/code-execution/mcp-core/mcp-response-formatter.ts` — the two duplicated LSP formatters now share one
  renderer, which accepts a report or a plain array (the array path is unchanged, so the existing formatter specs still
  pass).
  - `mechanism:'none'` renders "Not available on this host (mechanism: none; language: X). No <noun> lookup ran, so
    this is not an empty result; …", with no `Found:` line.
  - Other mechanisms render in this order: `Mechanism: … ; language: …` (plus "(not supported by this mechanism)" or
    "(support decided by the host)"), then `Approximations:`, then `Truncated:`, then `Found: N`, then the locations.
  - An empty qualified answer (unsupported language, approximations, or truncated) appends "(qualified as above; not
    proof that none exist)".
- MODIFIED `lib/code-execution/namespace-builders/ide-namespace.builder.spec.ts` — 5 new cases: report preferred,
  provider-defined wrap, validation, `onDefinitionLookup`, and the no-host FB. Adds `import 'reflect-metadata'`, the
  builder-spec pattern, because the builder now imports a WI value.
- MODIFIED `lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` — new describe "LSP reports (Batch 26a)":
  - FB `it.each` for both tools: "no-host definitions are not Found: 0";
  - ordering (mechanism, approximations, cap, count, then locations);
  - qualified empty answer for an unsupported language;
  - an array-only host is provider-defined and unqualified.
- MODIFIED `index.ts` (lib barrel) — type-only export of `LspLocationReport` and `LspMechanism` (see Deviations).

## FB evidence

- Behavioural: with HEAD `protocol-dispatcher.ts` and `mcp-response-formatter.ts` swapped back in, `jest
  protocol-dispatcher.spec -t "no-host definitions are not Found"` → **2 failed**. Expected "Not available on this
  host"; received "## LSP Definitions / Found: 0 …" (and the same for References).
- Full HEAD production sources (all 5 files) → the suite fails to compile (TS2305 `LspLocationReport` missing; unknown
  `getDefinitionReport`), because there is no report contract on the base.
- After: the same tests plus the builder no-host case → 3 passed. Sources were restored from a temp backup; the diff
  stat is identical before and after the swap.

## Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache` (1 project, as the header
  shows) → typecheck √, lint √, test √.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → both √.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json
  dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300; vscode-lm-tools 2 (baseline 2).
- `ptah-core-prompt.ts` is unchanged (`git diff --quiet`). No changed file references `NATIVE_AGENT_TOOL_POLICY`.
- No added line contains `from "`, `import("`, `import "` or `require("`.

## Deviations

1. The `src/index.ts` barrel (outside the listed files) gets 2 type-only exports. 26b's Electron capability imports
   from `@ptah-extension/vscode-lm-tools` and needs `LspLocationReport` to implement the report methods.
2. `languageSupported` is `boolean | null`. `null` is only used for the wrapped array API (`provider-defined`, the
   VS Code path today), where the host does not say, which follows the 25b diagnostics `provider-defined` precedent.
3. There is no `language-server` mechanism value. No host reports one yet, and VS Code (whose capability file is not
   in 26a) is `provider-defined` through the wrap. The Electron mechanisms 26b needs (`symbol-index`,
   `declaration-scan`, `graph-scoped-scan`, `text-scan`) are in the union.

## Out-of-scope observations

- The pre-existing location item renderer drops a line or column equal to `0` (a falsy check), so a location at line 0
  prints only the file. This is unchanged here because `mcp-response-formatter-extra.spec.ts` pins the current shapes.
- `system-namespace.builders.ts:253` (execute_code help) and the LSP tool descriptions (24c) do not mention the report
  methods or the no-host wording yet.

## Fix round (review r1)

Findings fixed: R26A-M1 and R26A-M2 from `reviews/batch-26a-code-logic-review-r1.md`. R26A-m1 (execute_code help
text) is carried to 24c and is not fixed here.

Files: `mcp-core/mcp-response-formatter.ts`, `mcp-core/protocol-dispatcher.spec.ts`.

### R26A-M1: unknown language support now qualifies an empty count

- An empty count is now qualified whenever `languageSupported !== true`, so `null` counts as unknown. Such an answer
  ends with "Found: 0 … (qualified as above; not proof that none exist)".
- `null` support now renders as "(support unknown: not reported by the host)". The previous wording was "(support
  decided by the host)".
- A legacy bare location array given straight to `formatLspDefinitions` / `formatLspReferences` is now rendered as a
  `provider-defined` report with unknown support. That removes the separate array branch. The existing formatter specs
  still pass, because their regexes match the qualified text.

### R26A-M2: zero-based line and column 0 are rendered

- The shared location renderer now checks whether a coordinate is present (`isCoordinate`: a finite number or a
  non-empty string) instead of testing truthiness. Line 0 and column 0 now render. A missing line prints only the
  file; a missing column prints `file:line`.
- Values are rendered as given, zero-based, as the LSP tools take them. The existing convention is unchanged.

### Regression specs

These are in `protocol-dispatcher.spec.ts`, inside the Batch 26a describe:

- For both tools, an empty answer from an array-only host is qualified and names the unknown support (M1).
- For both tools, a report with `{line:0,column:4}` and `{line:3,column:0}` renders `a.ts:0:4` and `b.ts:3:0` (M2).
- A legacy array keeps `a.ts:0:0`, `b.ts:5` and `c.ts`, and `formatLspReferences([])` is qualified (M1 + M2).

The existing array-host assertion was updated to the new support wording.

### FB evidence

- The pre-fix-round formatter was recreated temporarily with a revert script, which was then deleted. With it, the 5
  new tests ran and **all 5 failed**. The file was then restored from a backup.
- After the fix, the LSP, formatter and builder specs give 91 passed and 0 failed.

### Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache` → typecheck √, lint √,
  test √.
- `nx run ptah-electron:validate-deps` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint` → TOTAL 300; vscode-lm-tools 2 (baseline 2).
