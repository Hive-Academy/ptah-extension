## Summary

The ptah MCP tools had silently degraded. The shipped prompts promise fewer tokens at the same quality, but the
TASK_2026_557 token audit measured the opposite. `ptah_context_enrich_file` returned the whole file (36/36).
`ptah_code_search_symbols` missed exact names (0/7). `ptah_get_diagnostics` was unfiltered (up to 1.08M chars).
`ptah_workspace_analyze` was 96% directory tree and misdetected the project. This PR brings every tool back to its
contract: honest, bounded, token-efficient answers. Regression guards now fail CI if the tools degrade again.

It also stops the tools from being tied to TypeScript (User Decision 18), with the graph scope reduced by Decision 27.
Tools no longer return an empty "complete" answer for files they cannot analyse; they say what they covered and what
they did not. The tree-sitter grammars now cover TS/JS, tsx, Python, Go, C#, Java, Rust, PHP, Ruby, C/C++ (`.c`/`.h`
through the C++ grammar) and Kotlin. Dependency graphs cover TS/JS, Python, Go and C#. Java, Rust, PHP, Ruby and C/C++
graphs are deferred to a follow-up; until then those files are reported as `unsupported`, never as a clean empty answer.

## What changed

**Result budget and reducers**

- New `tool-output-reducers` lib with deterministic reducers per content type: JSON compaction, a Markdown heading
  outline (on the `marked` lexer), log/test dedupe, plain-text HTML extraction, and a tree-sitter code outline.
- Every tool result goes through a token budget (2,000 tokens by default, 8,000-char ceiling). When the text is cut,
  the full output is spooled to `.ptah/tmp/mcp-out/` and the trailer names the file. The ceiling is declared in
  `tools/list` `_meta`. Telemetry is logged at debug level only.
- Caller identity is resolved for `tools/list` and `tools/call`. The server `instructions` are derived from the
  shipped mandate.

**Per-tool fixes**

- `get_diagnostics`: output cap that keeps the requested files first; scoped runs no longer queue behind an abandoned
  unscoped run.
- `code_search_symbols`: exact-name recall, index freshness, a lazy background reindex, and a new `ptah_code_reindex`
  tool.
- `context_enrich_file`: infers the language and names the reason for a full-file fallback. It refuses rather than
  return a lossy summary.
- `lsp_definitions` (Electron): an import-resolution fallback that does not depend on the index.
- `get_symbol_index`: `pathPrefix`/`limit`/`offset`. The dependency graph is built in the background through the
  governor and answers `building` instead of blocking.
- `workspace_analyze`: monorepo-first detection and a bounded tree.
- `search_files` (truncation notice), `relevance_rank_files` (deduped reasons).
- `agent_read` (last 200 lines + `offset`), `agent_status` (repeat throttle), `agent_spawn` resume (no resent role
  prefix).
- `task_list`/`task_check` (paged), `dashboard_propose_spec` (slim schema), `browser_screenshot` (jpeg q60, no
  duplicate re-encode), `browser_evaluate` (capped).

**Language support**

- `LanguageCoverage` contract and language registry; a compact coverage block on graph, index, AST, LSP and
  diagnostics answers.
- Grammar manifest with sha256 checks, lazy per-language loading, and a VSIX packed-grammar check. Kotlin is a vendored
  MIT WASM grammar with a recorded provenance (attestation, npm hash, ABI-14 load test).
- Import extraction contract, a resolver seam with bounded manifest reads, and Python, Go and C# resolvers. Anything
  uncertain is disclosed rather than guessed.
- Language-aware diagnostics in Electron and the CLI. `go vet` runs only with opt-in consent per workspace. Consent is
  stored under host user data and ends when the root or the Go binary changes. It is managed from a new Electron
  Settings card or `ptah config go-vet status|on|off`. Every other language reports "not checked".

**Regression harness**

- H1 service benchmarks (size and recall against native tools), H2 dispatcher contract sweep + mandate manifest, H3
  polyglot fixtures + honesty contract, and a Batch 38 gate: activated keys must equal the required keys exactly.
- Description-length pins for every tool; degradation audit held at TOTAL 300.

## Known gaps / follow-ups

- Java, Rust, PHP, Ruby and C/C++ dependency graphs are deferred (Decision 27). They are disclosed as `unsupported`,
  and the gate asserts it.
- `go-vet-hostile.integration.spec.ts` has never run against a real Go toolchain: Go is absent here and in CI. It skips
  visibly. A follow-up adds an `actions/setup-go` CI job (Decision 30(b)).
- `ptah_get_symbol_index` description is at 975/1000 chars; the deferred languages need a structural fix first.
- Known issues committed under user decisions (Markdown/HTML reducer edge cases, enrich-file summary limits) and all
  Minor/Moderate carries are listed in `.ptah/specs/TASK_2026_559_8ca9/batches.md`, section "Follow-up task", for
  TASK_2026_561.

## Test plan

- [x] Per batch: `nx run-many -t=test,lint,typecheck -p <owning projects> --skip-nx-cache` plus validate-deps and the
      degradation audit before each commit. All pass, except known flakes that pass when run alone.
- [x] `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`
      passes (Batch 38 gate).
- [x] After merging `origin/main` (54f173258): `nx run-many -t=test,lint,typecheck` over the 17 dependent projects:
      88 of 89 tasks pass, 3,383 tests pass. The 1 failure is the known environment flake (rpc-handlers
      `harness-skill-selection`, caused by an existing `%TEMP%/.ptah/harness/state.json`; this PR does not change
      that code). memory-contracts has no test target; its lint and typecheck pass.
- [x] `npx nx run degradation-audit:lint --skip-nx-cache`: TOTAL 293 after the merge (300 before it; main removed 7
      sites). No baseline raised.
- [x] `npx nx run ptah-electron:validate-deps --skip-nx-cache` passes.
- [x] `node scripts/copy-wasm.js --self-test` and the three packed-verifier self-tests pass.
- [x] Parity: all 52 MCP tools at the base commit are still served; `ptah_code_reindex` is added.
- [x] Visual review of the Electron go vet card, dark + light at 800/1280 px: r3 APPROVED (`visual-review-37b2.md`).
- [ ] `go-vet-hostile.integration.spec.ts` against real Go: not run (no Go here or in CI). 8 cases skip with a printed
      reason. See Known gaps.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
