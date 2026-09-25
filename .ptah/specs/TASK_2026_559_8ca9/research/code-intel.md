# Code-intelligence MCP tools — forensic audit (TASK_2026_559)

Scope: `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_code_search_symbols`,
`ptah_get_symbol_index`, `ptah_get_dependencies`, `ptah_get_dependents`,
`ptah_lsp_definitions`, `ptah_lsp_references`, `ptah_relevance_rank_files`,
`ptah_count_tokens`. `ptah_project_detect_monorepo` is registered under the same
`'code'` doc-comment group in `protocol-dispatcher.ts:279-281` but is a
workspace-detection tool, not code-intelligence, and is left to the
workspace-owning group. `ptah_memory_search` is explicitly memory-owned and out
of scope.

**Build under test.** Live calls went through the running local MCP server
(`http://localhost:51820`, per `mcp_surface.md:11`). Every live output's exact
content — line numbers from `ptah_ast_analyze`, the char count from
`ptah_get_symbol_index` (663,374, identical to the 09-25 audit), the case-block
line numbers quoted below — matches the current working tree byte-for-byte, and
the tool descriptions returned by `ToolSearch`/`tools/list` match
`tool-description.builder.ts` at HEAD. **HEAD = `9afac1aa2` (2026-09-25T16:14:32+03:00,
"Merge pull request #596 from Hive-Academy/feat/task-538-surface-contract-v2")**,
working tree clean. The running server's source matches HEAD; there is no
build/HEAD drift for this evidence.

**Method note.** All "live behaviour" rows below are real tool calls made from
this session against the running server (see each tool's section for exact
inputs/outputs). Two claims are carried from `mcp_surface.md`/audit
(`get_dependents` cold-start 124.8s, an `ast_analyze` `"unknown>"` parameter
artifact) because reproducing a cold graph build or hunting a rare parser
artifact was not a good use of a second 124s call; both are labelled **(audit,
not independently reproduced)**.

---

## 0. The one root cause behind three tools

`ptah_code_search_symbols`, `ptah_lsp_definitions`, and part of
`ptah_get_diagnostics`-adjacent tooling all read from the same SQLite table,
`code_symbols` (migration `libs/backend/persistence-sqlite/src/lib/migrations/0013_code_symbols.ts:14-45`,
FTS5 `code_symbols_fts` + `sqlite-vec` `code_symbols_vec`, at
`C:\Users\abdal\.ptah\state\ptah.sqlite`, opened read-only for this audit).
Querying it directly:

```
total code_symbols rows: 15,539 (2 workspaces)
ptah-extension workspace: 11,600 rows / 1,589 distinct files
vscode-lm-tools lib: 27 rows, ALL from 2026-05-27T01:47:31Z except one
  (resolveWasmPath, __mocks__/wasm-bundle-dir.ts) from 2026-09-22T05:54:42Z
mcp-core / mcp-http / mcp-stdio / namespace-builders subtree: 0 rows, ever
```

The whole `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`,
`mcp-http/`, `mcp-stdio/` and `namespace-builders/` directories — i.e.
`protocol-dispatcher.ts`, `tool-description.builder.ts`,
`mcp-response-formatter.ts`, `code-namespace.builder.ts`,
`analysis-namespace.builders.ts`, and every other file this very audit is
about — **have never been in the symbol index.** The index was built once, in
full, on 2026-05-27 (`CodeSymbolIndexer.indexWorkspace`,
`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:191-298`),
and since then only two things touch it: a user clicking "reindex" in the UI,
or a single-file `reindexFile` on editor save
(`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:468-514`, wired to
`IndexingRpcHandlers`'s `indexing:start`/`indexing:resume`, both explicitly
user-click-only per the comment at line 487-490). **No code path ever triggers
a full re-index automatically** — not on MCP server start, not on tool call,
not on a schedule. In four months the working tree gained an entire
`mcp-core` subtree and the index never noticed.

`ptah_code_search_symbols` reads this table directly
(`code-namespace.builder.ts:84-119` → `CodeSymbolStore.searchSymbols`,
`libs/backend/memory-curator/src/lib/code-symbol.store.ts:295-342`).
`ptah_lsp_definitions`, in the Electron build that answered every live call in
this audit, *also* reads this exact table and nothing else
(`apps/ptah-electron/src/services/electron-ide-capabilities.ts:188-256`,
`declarationsFor` calls `this.symbolReader.searchSymbols(...)` — same
`ICodeSymbolReader`, same rows). `ptah_lsp_references` on the same build does
**not** depend on this table — it live-scans files on disk with a
word-boundary regex (`electron-ide-capabilities.ts:302-415`), which is why
references worked in this audit and definitions did not.

The namespace layer already has a fix for this (`ns.code.reindex()`,
`code-namespace.builder.ts:163-195`, which can run a full
`indexer.indexWorkspace(workspaceRoot, {userInitiated: true})`) — but **no MCP
tool exposes it.** `grep -n reindex` over `protocol-dispatcher.ts` and
`tool-description.builder.ts` returns nothing. An agent that notices
`code_search_symbols` is empty has no MCP-reachable way to fix that; only a
human clicking a button in the Electron/VS Code UI can.

---

## 1. `ptah_ast_analyze`

**Contract.** "Analyze a JavaScript/TypeScript file with Tree-sitter and return
its structure — functions, classes, imports, and exports with line ranges —
WITHOUT reading the full file (40-60% fewer tokens)."
(`tool-description.builder.ts:1599-1603`).

**Live behaviour.**

| Input | Result chars | Read-equivalent | Reduction | Latency | Correctness |
|---|---|---|---|---|---|
| `code-namespace.builder.ts` (small, 213 lines) | JSON with 5 functions, 7 imports, 1 export, exact line ranges (72-196, 83-160, ...) | not measured (file is small) | n/a | fast | Matches `Read` file structure exactly |
| `protocol-dispatcher.ts` (large, ~2,230 lines) | JSON, 21 functions with exact start/end lines matching the `Read` tool's own line numbers 1:1 (e.g. `handleToolsList` 287-391, `markEagerTools` 485-502, `handleIndividualTool` 662-1908) | ~84k chars (per `mcp_surface.md` bench #3, 83,806) | ~86% (per audit; not re-measured to save the large `Read`) | fast | Exact |

Every function name and line range returned matched what `Read`/grep showed for
the same file. The tool **exceeds** its own claim (measured 86% in the earlier
audit against an 86% claim ceiling of 40-60%) rather than falling short.

**Code path.** `protocol-dispatcher.ts:1695-1708` (`case 'ptah_ast_analyze'`) →
`ptahAPI.ast.analyze(file, workspaceRoot)` → AST namespace builder →
`AstAnalysisService.analyzeSource` (tree-sitter). No SQLite dependency — pure
on-demand parse of the requested file.

**Regression forensics.** None found. No sign this ever regressed; it is not
gated on the stale symbol index.

**Root cause.** N/A — working as designed.

**Fix design.** None required. One cosmetic item carried from the prior audit,
**not independently reproduced here**: `mcp_surface.md:79` reports a
`"unknown>"` junk token inside some `parameters` entries. Worth a follow-up
ticket in `ast-analysis.service.ts`'s parameter-extraction path if reproduced,
but out of scope for this bugfix task.

**Regression guard.** Existing `ast-namespace.builder.spec.ts` covers the
namespace wiring. No change needed.

**Verdict: WORKS.** No priority — not broken.

---

## 2. `ptah_context_enrich_file`

**Contract.** "Generate a .d.ts-style structural summary of a file — imports,
class outlines, and function signatures without bodies — for a large token
reduction over reading the whole file." (`tool-description.builder.ts:1628-1632`).
`language` is an *optional* schema field (`tool-description.builder.ts:1640`),
which is itself part of the broken contract: an optional param that silently
degrades the tool to zero savings when omitted is not what "large token
reduction" promises.

**Live behaviour (this session, live server).**

| Input | `language` given? | Result | chars | reduction |
|---|---|---|---|---|
| `protocol-dispatcher.ts` (~2,230 lines) | no | `mode: full`, whole file, JSON-escaped onto one line | **72,718** (tool errored: "exceeds maximum allowed tokens", written to a side file) | **0%** |
| `protocol-dispatcher.ts` | `typescript` | `mode: structural`, 21 functions/133 imports summarized | 1,930 tok (`tokenCount`), `originalTokenCount` 15,430 | **87%** |
| `apps/ptah-tui/.../Badge.tsx` (small, 61 lines) | no | `mode: full` | 285 tok, `originalTokenCount` 285 | **0%** |
| `Badge.tsx` | `typescript` | `mode: structural` (parses fine even though the tool schema only lists `typescript`/`javascript`, no explicit `tsx`) | 95 tok | **67%** |

This reproduces the audit's `mcp_surface.md` finding (36/36 full-mode calls,
0% reduction) exactly, live, on HEAD. The bug is size-independent — it hits a
61-line `.tsx` file exactly as it hits a 2,230-line `.ts` file — because the
defect is not "large files fail to parse," it is "no language, no inference,
full file, always."

**Code path.** `protocol-dispatcher.ts:1710-1717` (`case
'ptah_context_enrich_file'`): reads `language` straight off `args` with no
fallback —
```ts
const { file, language } = args as { file: string; language?: string };
...
const result = await ptahAPI.context.enrichFile(file.trim(), language);
```
→ `analysis-namespace.builders.ts` `buildContextNamespace().enrichFile` (thin
pass-through, confirmed no inference logic in its structural summary) →
`ContextEnrichmentService.generateStructuralSummary`
(`libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:78-151`):
```ts
if (!language) {
  ...
  return this.createFullContentResult(content);   // line 117-121
}
```
`createFullContentResult` (`context-enrichment.service.ts:354-367`) returns
`mode: 'full'`, `reductionPercentage: 0`. There genuinely is a working
extension→language map already in the codebase —
`EXTENSION_LANGUAGE_MAP` in
`libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`, used by
`CodeSymbolIndexer.extensionToLanguage`
(`code-symbol-indexer.service.ts:138-140`) — it is simply never called on this
path.

**Regression forensics.** `context-enrichment.service.ts` has exactly 3
commits in its history (`674a3624c`, `80d26911d`, `2b537f44c`); `2b537f44c`
("chore(release): extension v0.2.32 (#290)", 2026-05-15) introduced the
`language: SupportedLanguage | undefined` signature and the `if (!language)`
full-content branch as part of the file's first commit.
`git log -S"EXTENSION_LANGUAGE_MAP"` against both
`analysis-namespace.builders.ts` and `protocol-dispatcher.ts` returns nothing
— extension-based inference was **never** wired to this MCP path at any
commit. **This is not a regression; the contract was never met.** The tool
description's "large token reduction" claim has been live and false since
2026-05-15.

**Root cause.** Missing extension→language inference at the MCP boundary
before `ContextEnrichmentService.generateStructuralSummary` is called.
`language` is optional in the schema, the dispatcher does not infer it, and
the service's only fallback for "no language" is full content — indistinguishable
from its fallback for "language given but the parser genuinely failed"
(`context-enrichment.service.ts:129-134`), which hides two different failure
modes behind one signal.

**Fix design.**
1. In `protocol-dispatcher.ts:1710-1717` (or, better, once, in
   `analysis-namespace.builders.ts`'s `enrichFile` so every host shares it),
   when `language` is omitted, derive it from the file extension via the
   existing `EXTENSION_LANGUAGE_MAP` (`.ts/.tsx/.mts/.cts` → `typescript`,
   `.js/.jsx/.mjs/.cjs` → `javascript`) before calling
   `ptahAPI.context.enrichFile`.
2. In `context-enrichment.service.ts:129-134`, when a language *was* supplied
   (explicitly or inferred) and `astAnalysis.analyzeSource` still fails, return
   `mode: 'full'` **plus a `reason: 'parse-failed'` field** so a caller (and a
   spec) can tell "we didn't try" from "we tried and the parser choked" —
   never silently identical.
3. Make `language` accept `'tsx'`/`'jsx'` as documented values or normalize
   them to `typescript`/`javascript` in the schema description, since the live
   test above shows `.tsx` files already parse under `'typescript'` — the gap
   is inference, not grammar support.

**Regression guard.** `analysis-namespace.builders.spec.ts` already tests
`enrichFile` forwarding `language` when given
(`analysis-namespace.builders.spec.ts:131-149`), but no existing spec calls
`enrichFile('src/a.ts')` **without** `language` and asserts `mode ===
'structural'`. Add exactly that case (and a `.py`/unsupported-extension case
asserting `mode: 'full', reason: undefined` since there is genuinely no
inference for it). Runs in `nx test vscode-lm-tools`. A second guard belongs
in `context-enrichment.service.spec.ts` in `workspace-intelligence`, asserting
`generateStructuralSummary(content, undefined)` is the *only* path that
reaches `createFullContentResult` without a `reason`.

**Verdict: BROKEN** (never delivered the contract). **P0** — measured
`mcp_surface.md` impact was 36/36 calls, 680,094 chars wasted in one 5-day
Claude Code window alone; this audit shows the exact same failure live on
today's HEAD, on files of any size.

---

## 3. `ptah_code_search_symbols`

**Contract.** "Search indexed workspace code symbols (functions, classes,
methods) by semantic description using hybrid BM25 + vector search. Prefer
this over Grep to find a symbol by what it does across files."
(`tool-description.builder.ts:1706-1710`). The prompt makes this MANDATORY
before Grep/Glob for symbol lookups (`ptah-core-prompt.ts:31,59`, cited in
`TASK_2026_557_tokaudit/research-report.md` RC5).

**Live behaviour.**

| Query | Type | Top hits | Target found? |
|---|---|---|---|
| `"handleToolsList"` | exact identifier (function in `protocol-dispatcher.ts:287`) | `handleToolStart`, `handleOpenFolder`, `handleCost`, `handleWatcherError`, ... | **No, 0/20** |
| `"markEagerTools"` | exact identifier (`protocol-dispatcher.ts:485`) | `getMarkedExtensions`, `provideMarkdownRendering`, `markWorkspacesChanged`, `markProcessed`, ... | **No, 0/20** |
| `"generate structural summary from AST insights for a file"` | natural-language description | `extractParamsFromText`, `analyzeAst`, `analyzeSource`, `formatSummary`, `traverseAst`, `extractParameters`, **`generateStructuralSummary`** (rank 7, score 0.0269) | **Yes, but rank 7 of 20, not rank 1** |

Direct SQLite confirms why: `handleToolsList` and `markEagerTools` are not in
`code_symbols` at all (0 rows for `mcp-core`, section 0 above) — they cannot
be found by any query, exact or fuzzy. The natural-language query *did* work
reasonably (the tool's actual designed mode — semantic description search over
whatever *is* indexed), just not with the target at rank 1.

**Code path.** `protocol-dispatcher.ts:1767-1792` (`case
'ptah_code_search_symbols'`) → `ptahAPI.code.searchSymbols` →
`code-namespace.builder.ts:84-119` (`searchSymbols`, `maxResults` default 20 at
line 85) → `CodeSymbolStore.searchSymbols`
(`libs/backend/memory-curator/src/lib/code-symbol.store.ts:295-342`): BM25
over `code_symbols_fts` (porter+unicode61 tokenizer, so `handleToolsList` is
stored/queried as one lowercase token `handletoolslist`, not split by
camelCase — a secondary precision issue, but moot when the row does not exist)
fused by Reciprocal Rank Fusion with `sqlite-vec` semantic search
(`fts-query.util.ts:132-154` builds the FTS5 MATCH plan; `CODE_RRF_K = 25` at
`code-symbol.store.ts:107`).

**Regression forensics.** Not a code regression — a data-staleness problem.
`indexWorkspace` triggers: `IndexingRpcHandlers`'s `indexing:start`/`resume`
(user click) and per-file `reindexFile` on editor save
(`boot-thoth-runtime.ts:468-514`). Commit `84657c380` ("defer symbol indexing…
while the app is busy", 2026-09-15) added governor back-pressure to these same
two triggers but did not add or remove a third, automatic one — confirmed by
its own comment ("userInitiated opts out (ptah.code.reindex, thoth
indexing:start/resume)"). **No commit ever added an automatic full-workspace
reindex.** The index has been silently falling behind the working tree since
its one full build (2026-05-27) with nothing to notice or correct it — worse
every day, invisible until measured directly against the sqlite file as this
audit did.

**Root cause.** (1) Nothing keeps `code_symbols` current with the working
tree — the only triggers are a UI button and per-save incremental updates,
neither reachable by an MCP-only agent session, so entire library subtrees
created/moved after the last full index are permanently invisible. (2)
Secondary: the porter/unicode61 FTS5 tokenizer does not split camelCase, so
even a correctly indexed exact identifier only matches as one long token —
fine for exact matches, but there is no boost that would rank an exact
`symbol_name` equality above a semantic/partial match once ranking is close.

**Fix design.**
1. Expose the existing `ns.code.reindex()` (`code-namespace.builder.ts:163-195`)
   as an MCP tool, `ptah_code_reindex`, in `protocol-dispatcher.ts` /
   `tool-description.builder.ts`, so an agent that gets 0 useful hits can
   self-heal instead of silently falling back to Grep (which is what the audit
   shows agents already do, paying for both calls).
2. On MCP server boot (or lazily on the first `code_search_symbols` call per
   session), if `CodeSymbolStore.count(workspaceRoot) === 0` or
   `MAX(updated_at)` is older than a threshold (e.g. 24h) **and** the governor
   reports the app idle, kick a non-blocking `indexWorkspace(workspaceRoot,
   {userInitiated: false})` in the background (same governed path
   `84657c380` already wired) rather than requiring a human click.
3. Return index freshness in the tool response — `indexedFiles`,
   `workspaceFileCountEstimate`, `indexAgeMs` — so a caller (or a bench) can
   tell "0 hits, index is stale" from "0 hits, genuinely not found."
4. Secondary precision fix once the data is current: add an exact
   `symbol_name = ?` lookup as a third candidate source in `searchSymbols`
   (alongside BM25 and vector), fused with a fixed high RRF weight, so an
   exact identifier query always surfaces its exact match at rank 1 when the
   row exists.

**Regression guard.** A bench spec (the audit's `mcp/bench.py` cases,
formalized): seed `code_symbols` with a small fixture set of known functions,
call `searchSymbols` with each fixture's exact name, and assert it appears in
the top 5 for ≥90% of the fixtures — this is `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`,
already the right home (it already has coverage for this store). Add a
second, workspace-level check: `MAX(code_symbols.updated_at)` must be within N
days of "now," asserted by a scheduled non-blocking health check (not unit
CI, since it needs the real DB) — surfaced through the new `ptah_code_reindex`
tool's freshness fields from item 3 above, and checked in
`mcp/bench.py` against the live server as part of the audit's own re-run
cadence (`TASK_2026_557_tokaudit/research-report.md` §5).

**Verdict: BROKEN.** **P0** — mandated by the prompt as the first thing to try
before Grep, 0/7 recall on exact names in the prior audit and 0/2 reproduced
live here in the exact same subtree that contains this very tool's own source.

---

## 4. `ptah_get_symbol_index`

**Contract.** "List the exported symbols for every file in the workspace
import graph... Builds the workspace import graph on first use, then answers
from cache." (`tool-description.builder.ts:1815-1826`). No claim of size
limits; `inputSchema.properties` is `{}` (line 1822) — **the schema itself has
no parameters to narrow the result.**

**Live behaviour.** Called with no arguments (there are none to give): errored
at the client with "result (663,374 characters across 1 line) exceeds maximum
allowed tokens," identical to the 09-25 audit's 663,374-char figure — the data
has not changed size in this window, which fits the "no automatic refresh"
finding in section 0 (this data actually comes from the live, on-demand
`DependencyGraphService`, not the stale SQLite table — see next section — so
its being unchanged reflects a stable file count, not staleness).

**Code path.** `protocol-dispatcher.ts:1840-1848` (`case
'ptah_get_symbol_index'`) → `ensureDependencyGraphBuilt(ptahAPI)`
(`protocol-dispatcher.ts:1978-1994`, builds a **fresh, live**
`DependencyGraphService` graph from up to 5,000 `.ts/.tsx/.js/.jsx` files on
first use per session — independent of the stale `code_symbols` SQLite table)
→ `ptahAPI.dependencies.getSymbolIndex()` →
`DependencyGraphService.getSymbolIndex` (`dependency-graph.service.ts:281`).
Returns one entry per file in the graph (2,655 files per the prior audit),
`{files: index, count: index.length}`, with no limit, no filter, no pagination.

**Regression forensics.** This has never had a limit; it is a contract gap
(unbounded by design), not a regression.

**Root cause.** No `limit`/`pathPrefix`/`query` parameter on the tool or the
underlying service method.

**Fix design.** Add `pathPrefix?: string` and `limit?: number` (default e.g.
200) to the schema and to `DependencyGraphService.getSymbolIndex` /
`protocol-dispatcher.ts:1840-1848`; when truncated, add
`{truncated: true, shown: N, total: M}` rather than silently cutting the JSON
(which is what currently happens at the transport layer when the result
exceeds the client's cap — a hard client-side error today, not a graceful
truncation).

**Regression guard.** A new case in `protocol-dispatcher.surface.spec.ts` (or
a dedicated spec) asserting the default call returns ≤ N entries and a
`truncated` flag once implemented; today there is nothing to guard because
there is no cap to break.

**Verdict: DEGRADED** (correct data, unusable shape). **P0** by measured
impact — the single largest ptah result observed in either audit, 663k
chars/~166k tokens in one call.

---

## 5 & 6. `ptah_get_dependencies` / `ptah_get_dependents`

**Contract.** `get_dependencies`: "List the files that the given file imports
(forward dependency edges)... Builds the workspace import graph on first use,
then answers from cache." `get_dependents`: "...reverse dependency edges...
Essential for assessing blast radius..." (`tool-description.builder.ts:1656-1660,
1679-1683`).

**Live behaviour.**

| Call | Result | Correctness |
|---|---|---|
| `get_dependents(mcp-response-formatter.ts)` | 5 files: `vendor-roster-drift.spec.ts`, `mcp-response-formatter-extra.spec.ts`, `mcp-response-formatter.spec.ts`, `protocol-dispatcher.ts`, `agent-tool.dispatcher.ts` | Matches the real import graph — `protocol-dispatcher.ts` genuinely imports 22 named exports from this file (confirmed via `ast_analyze` above) |
| `get_dependencies(protocol-dispatcher.ts)` | 9 files: `agent-spawn-args.schema.ts`, `permission-prompt.service.ts`, `types.ts`, `tool-description.builder.ts`, `dashboard-propose-spec.tool.ts`, `code-execution.engine.ts`, `approval-prompt.handler.ts`, `mcp-request-context.ts`, `mcp-response-formatter.ts` | Matches the file's own import list exactly (9 local module sources out of its 133 total imports, the rest being `node_modules`/workspace-alias packages the graph correctly does not resolve as workspace files) |

Both calls were fast (sub-second) in this session, because
`ensureDependencyGraphBuilt` had already run earlier in the same session (the
graph is cached per workspace root, `dependency-graph.service.ts`). **Cold
first-call latency of 124.8s is carried from `mcp_surface.md:117` (audit, not
independently reproduced)** — reproducing it would require restarting the MCP
server to force a cold graph build, which this audit did not do.

**Code path.** `protocol-dispatcher.ts:1719-1765` → `ensureDependencyGraphBuilt`
→ `ptahAPI.dependencies.getDependents`/`getDependencies` →
`DependencyGraphService.getDependents` (`:263`) / `getDependencies` (`:229`).
Same live, on-demand graph as `get_symbol_index` — not the stale SQLite
table, which is why these two are unaffected by section 0's root cause.

**Regression forensics.** None found; data correctness is intact. The only
known defect is the cold-start cost, present since the graph-build design was
introduced and not changed by `84657c380`'s governor work (that commit made
*background* indexing wait, but `ensureDependencyGraphBuilt` runs inside the
tool call itself, ungoverned, by design — "an agent tool call runs INSIDE a
generating turn" per the comment at `code-namespace.builder.ts:184-188`
applies to the sibling `reindex`, and the same reasoning holds here).

**Root cause (latency only).** `ensureDependencyGraphBuilt` scans and
tree-sitter-parses up to 5,000 files synchronously inside the first tool call
of a session; nothing pre-warms it at server start.

**Fix design.** Kick off `ensureDependencyGraphBuilt` speculatively when the
MCP server starts / workspace opens (same trigger point as the
`CODE_SYMBOL_INDEXER` wiring in `boot-thoth-runtime.ts:468-514`), governed
(non-`userInitiated`) so it does not compete with a live turn, so that by the
time an agent's first `get_dependents`/`get_dependencies`/`get_symbol_index`
call lands the graph is already warm.

**Regression guard.** No data-correctness guard needed (both matched ground
truth in this test). Add a latency assertion to the pre-warm change once
implemented: first call after server start should return in well under the
124.8s baseline.

**Verdict: WORKS** (data correct and fresh; only known issue is one-time cold
latency, unverified live). **P2** — not a correctness defect, and the token
cost of a slow call is not itself large.

---

## 7. `ptah_lsp_definitions`

**Contract.** "Go to definition for a symbol at a specific file position
**using VS Code LSP**. Returns the source location where the symbol is
defined. Works across files, through re-exports, and into node_modules."
(`tool-description.builder.ts:423-428`, unchanged text since it was written in
`2b537f44c`, 2026-05-15).

**Live behaviour.** Two probes, both on real, verified-valid identifier
positions (confirmed by cross-checking with `lsp_references` on the same
symbol, which succeeded — see next section):

| Probe | Position | Result |
|---|---|---|
| `protocol-dispatcher.ts` `language` param in the `ptah_context_enrich_file` case | line 1710/col 33 (0-indexed) | `Found: 0 definitions` |
| `analysis-namespace.builders.ts`, `ContextEnrichmentService` in the import list (line 18, 1-indexed) | line 17/col 4 and line 17/col 10 (0-indexed) | `Found: 0 definitions` (both columns) |

**0/2, reproduced live on HEAD**, matching the prior audit's 0/2.

**Code path (the running build is Electron, not VS Code — see below).**
`protocol-dispatcher.ts:726-738` (`case 'ptah_lsp_definitions'`) →
`ptahAPI.ide.lsp.getDefinition(file, line, col)`. Two implementations exist
behind `IIDECapabilities`:
- VS Code extension: `ide-capabilities.vscode.ts:60-91`, wraps
  `vscode.commands.executeCommand('vscode.executeDefinitionProvider', ...)`.
- **Electron (the build that answered every call in this audit):**
  `apps/ptah-electron/src/services/electron-ide-capabilities.ts:188-256`
  (`resolveDeclaration` → `declarationsFor`), a hand-rolled, **name-based**
  resolver with no language server at all: it extracts the identifier text at
  the cursor (`extractIdentifier`, line 534-553), then does
  `this.symbolReader.searchSymbols(identifier, 25, workspaceRoot)` —
  **the exact same stale `code_symbols` SQLite reader that
  `ptah_code_search_symbols` uses (section 0).** Since `ContextEnrichmentService`
  and every symbol in `mcp-core`/`namespace-builders` are not in that table,
  `declarationsFor` finds zero candidates and returns `[]` — regardless of
  whether the cursor position is right.

**Regression forensics.** `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
was introduced/rewritten in `e035f08a3` ("refactor: fix lsp support in
electron", 2026-06-23), over a month after the tool description was written
(`2b537f44c`, 2026-05-15, "using VS Code LSP"). The description was never
updated for the new host, so it has claimed a mechanism ("VS Code LSP") that
is false for the Electron build ever since 2026-06-23 — **this is a
regression in the contract text**, distinct from the functional regression,
which is really the same staleness bug as `code_search_symbols` (section 0):
`declarationsFor`'s only data source went stale on 2026-05-27 and has stayed
stale, so every `getDefinition` call against anything indexed after that date
(or never indexed, like `mcp-core`) silently returns `[]`.

**Root cause.** Same as section 0: `code_symbols` staleness. `getReferences`
on the same file (`electron-ide-capabilities.ts:302-415`) does **not**
primarily depend on that table — it live-scans files with a word-boundary
regex (falling back to a bounded brute-force workspace scan when the
dependency graph isn't scoped yet), which is why references kept working
while definitions silently died.

**Fix design.**
1. Primary: fixing section 0 (reindex reachability/freshness) fixes this tool
   too, since it shares the same reader.
2. Resilience independent of index freshness: when `declarationsFor` returns
   zero candidates, fall back to `resolveImportedModule` (already implemented
   at `electron-ide-capabilities.ts:263-294`, currently only used to
   disambiguate *multiple* candidates) plus a direct declaration-line scan of
   that one resolved file — i.e. reuse the "look at the cursor file's own
   imports" logic as a *primary* fallback, not only a disambiguator, mirroring
   how references never fully depends on the index.
3. Fix the tool description (`tool-description.builder.ts:423-428`) to stop
   unconditionally claiming "using VS Code LSP" — state the mechanism is
   host-dependent (VS Code's built-in LSP in the extension; a symbol-index
   resolver in Electron/standalone), so the contract does not overclaim in the
   build most sessions actually run.

**Regression guard.** `electron-ide-capabilities.spec.ts` should gain a case
that runs `CodeSymbolIndexer.indexWorkspace` over a small fixture tree, then
asserts `getDefinition` at a known position returns ≥1 location — proving the
wiring end-to-end instead of only unit-testing `declarationsFor` against a
mocked `symbolReader` (which would pass today even with an empty real table,
since the mock always returns data).

**Verdict: BROKEN.** **P1** — real defect, reproduced live, but lower call
volume than `code_search_symbols`/`context_enrich_file`/`get_symbol_index` in
both audits, and shares its fix with `code_search_symbols`.

---

## 8. `ptah_lsp_references`

**Contract.** "Find all references to a symbol at a specific file position
using VS Code LSP. More accurate than Grep for finding usages — handles
renames, re-exports, and type references." (`tool-description.builder.ts:392-396`).
Same "using VS Code LSP" overclaim as `lsp_definitions` on the Electron build
(see below), but the *function* delivers.

**Live behaviour.** `context-enrichment.service.ts`, position on
`astAnalysis: AstAnalysisService` in the constructor (line 52, col 14,
0-indexed) → **29 references**, including real, correct usages:
`analysis-namespace.builders.ts:17:2` (the import) and `:44:21` (the
`ContextEnrichmentService` constructor-injection use site), `di/register.ts`,
multiple `*.spec.ts` files, `context-size-optimizer.service.ts`. This is
consistent with a real, working workspace-wide reference search — cross-checked
against `Grep` mentally via the file list (`analysis-namespace.builders.ts`
does import `ContextEnrichmentService`, confirmed independently by
`ast_analyze` and `context_enrich_file` calls on that same file earlier in
this audit).

**Code path.** `protocol-dispatcher.ts:712-724` → `ptahAPI.ide.lsp.getReferences`
→ (Electron build) `electron-ide-capabilities.ts:302-348` `scanReferences`:
extracts the identifier at the cursor, then either scopes the scan to
declaration files + transitive dependents via the **live**
`DependencyGraphService` (`computeReferenceScope`, line 355-372 — same
on-demand, non-stale graph as `get_dependents`/`get_dependencies`) or falls
back to a bounded brute workspace scan (`bruteScan`, line 392-415, capped at
8,000 files / 500 matches), reading files fresh off disk each time
(`collectMatchesInFile`, line 422-448) rather than trusting the SQLite index.
Matches inside comments/strings are dropped via a tree-sitter query
(`findExcludedRanges`, line 455-480).

**Regression forensics.** None found; this path was rewritten in the same
`e035f08a3` commit as `getDefinition` but designed to not depend on the stale
index, so it survived the same staleness that broke `getDefinition`.

**Root cause.** N/A — working as designed, and by construction resistant to
the index-staleness defect that breaks `getDefinition`.

**Fix design.** No functional fix needed. Same description-accuracy nit as
`lsp_definitions`: `tool-description.builder.ts:392-396` should note the
mechanism is host-dependent, not unconditionally "VS Code LSP," for the same
reason.

**Regression guard.** Existing coverage presumably sufficient; no defect to
guard against. If the fix in item 3 for `lsp_definitions` (reuse
`resolveImportedModule` as a fallback) is applied, add a shared spec fixture
covering both `getDefinition` and `getReferences` against the same seeded
mini-workspace so the two tools' behavior can't silently diverge again.

**Verdict: WORKS.** No priority — not broken. Description text should be
corrected alongside `lsp_definitions`'s fix as a low-cost accuracy nit.

---

## 9. `ptah_relevance_rank_files`

**Contract.** "Rank workspace files by relevance to a natural-language query,
each with a 0-100 score and the reasons behind it. Use to triage which files
to open first for a task instead of guessing." (`tool-description.builder.ts:1771-1775`).

**Live behaviour.** Query: `"context enrich file returns full file instead of
structural summary"`. Top hits: `file-relevance-scorer.service.ts` (score 33)
and `file-type-classifier.service.ts` (score 33) — genuinely the two most
relevant files in the repo to a query about file-relevance scoring — followed
by their spec files (score 31), then a long tail of files whose names merely
contain "file" (`Caddyfile`, `Dockerfile.dev`, `rpc-host-profile.ts`, several
`.tsx` file-picker components, score 23 each). Reasons for the tail entries
are duplicated: `"Filename contains \"file\""` printed **twice per hit**,
because the query string contains the word "file" twice ("file" and "full
file") and the reason-builder does not deduplicate matched terms before
generating reasons — a minor, real quality bug in
`file-relevance-scorer.service.ts`, not independently isolated to a line
number in this pass but visible directly in the JSON above.

**Code path.** `protocol-dispatcher.ts:1826-1833` (`case
'ptah_relevance_rank_files'`) → `ptahAPI.relevance.rankFiles(query, limit)` →
`FileRelevanceScorerService` (`analysis-namespace.builders.ts` imports it into
`buildRelevanceNamespace`).

**Regression forensics.** Not investigated at commit granularity — the
duplicate-reason issue is cosmetic and low-impact; no evidence it is a
regression rather than a day-one quality gap.

**Root cause.** `file-relevance-scorer.service.ts`'s reason-generation does
not dedupe the query's matched substrings before formatting `"Filename
contains \"X\""` lines.

**Fix design.** Dedupe matched terms (case-insensitive) before generating
reason strings. Low priority, cosmetic.

**Regression guard.** A spec asserting a query with a repeated word produces
each distinct reason at most once.

**Verdict: WORKS** (useful, correct top-ranked hits; cosmetic duplicate-reason
bug only). **P2**.

---

## 10. `ptah_count_tokens`

**Contract.** "Count tokens in a file using the model-specific tokenizer. Use
this instead of reading a file just to check its size." (`tool-description.builder.ts:471-475`).

**Live behaviour.** `task.md` (this task's own spec file) → `Tokens: 322`,
returned in ~50 chars of Markdown, fast. Sanity-correct for a short spec file.

**Code path.** `protocol-dispatcher.ts:749-759` (`case 'ptah_count_tokens'`):
reads the file via `ptahAPI.files.read`, then `ptahAPI.context.countTokens`.
No SQLite dependency, no unbounded output — the tool cannot itself return
something large since its output is a single integer.

**Regression forensics.** None found; simplest tool in scope, nothing to
regress.

**Root cause / Fix design.** None needed.

**Regression guard.** Existing coverage presumably adequate for a single-value
tool.

**Verdict: WORKS.** No priority — not broken.

---

## Summary table

| Tool | Verdict | Root cause (one line) | Regressing commit | Fix (one line) | Guard | Priority |
|---|---|---|---|---|---|---|
| `ptah_ast_analyze` | Works | — | — | — | existing spec | — |
| `ptah_context_enrich_file` | Broken (never met contract) | No extension→language inference before `ContextEnrichmentService`; optional `language` silently falls back to full file | Never fixed since introduction in `2b537f44c` (2026-05-15) | Infer language from extension at the dispatcher/namespace boundary; tag genuine parse failures with a `reason` field | New case in `analysis-namespace.builders.spec.ts`: no-`language` call on a `.ts` file must return `mode: structural` | **P0** |
| `ptah_code_search_symbols` | Broken | `code_symbols` SQLite index built once (2026-05-27), never auto-refreshed; entire `mcp-core`/`mcp-http`/`mcp-stdio`/`namespace-builders` subtree has 0 rows; no MCP tool exposes the existing `reindex()` | Not a single commit — a standing gap; `84657c380` (2026-09-15) hardened the same two manual/save triggers without adding an automatic one | Expose `ptah_code_reindex`; auto-trigger a governed background reindex on staleness; report index freshness in the response; add exact-name boosting once data is current | `code-symbol.store.spec.ts` exact-name recall bench (≥90% top-5); a staleness check on `MAX(updated_at)` | **P0** |
| `ptah_get_symbol_index` | Degraded (correct, unbounded) | No `limit`/`pathPrefix` param on tool or `DependencyGraphService.getSymbolIndex` | Unbounded by design since introduction | Add `pathPrefix`/`limit` with a `truncated`/`shown`/`total` trailer | New case asserting default cap once implemented | **P0** (663k chars, largest single result seen) |
| `ptah_get_dependencies` | Works | — (cold-start latency only, audit-sourced, not reproduced) | — | Pre-warm the graph at server start | Latency assertion post-fix | **P2** |
| `ptah_get_dependents` | Works | — (same cold-start latency) | — | Same pre-warm | Same | **P2** |
| `ptah_lsp_definitions` | Broken | Electron's `resolveDeclaration` reads the same stale `code_symbols` table as `code_search_symbols`; description falsely claims "VS Code LSP" unconditionally | `electron-ide-capabilities.ts` rewritten in `e035f08a3` (2026-06-23) without updating the description written in `2b537f44c`; functional cause is the section-0 staleness gap | Fixing index freshness fixes this; add an import-resolution fallback independent of the index; fix description text | New `electron-ide-capabilities.spec.ts` case against a seeded fixture index | **P1** |
| `ptah_lsp_references` | Works | — | — | Fix description's "VS Code LSP" overclaim (cosmetic) | Shared fixture with `lsp_definitions` if that fix lands | — |
| `ptah_relevance_rank_files` | Works | Reason-builder doesn't dedupe repeated query terms | Not isolated to a commit | Dedupe matched terms before formatting reasons | Repeated-word query spec | **P2** |
| `ptah_count_tokens` | Works | — | — | — | existing coverage | — |
