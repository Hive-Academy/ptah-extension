# Batch 32b code-logic review — TASK_2026_559_8ca9, Lane G2

**Verdict: REVISE. Score: 4/10. Assessment: NEEDS_REVISION.**

| Metric | Count |
| --- | ---: |
| Blocking | 3 |
| Serious | 1 |
| Moderate | 2 |
| Minor | 0 |
| New failure modes | 6 |

Reviewed the uncommitted Batch 32b implementation against HEAD `a5632f1bb`, including new import-resolution files, graph linking and coverage, extraction changes, specs, executor reports, Batch 32b/common requirements, language-plan resolver and bounds sections, the 32a r1 review/fix report, and the 26b closing carry. No source, test, task-state or git state was changed. Only this report and the task-folder `code-logic-review.md` were written; probes and fixtures were created under the OS temp directory.

The seam, language dispatch, ordinary re-export chains, case rule and edge caps work in the exercised paths. However, common manifest inputs yield wrong dependency graphs reported as clean. Manifest containment and physical read bounds also fail under controlled adverse inputs. Those failures prevent acceptance despite the successful ordinary fixtures.

## Numbered findings

Source anchors below are relative to `libs/backend/workspace-intelligence/src/ast/`.

### R32B-01 — Blocking — Root tsconfig merging ignores effective inheritance

**Anchors:** `import-resolution/resolver-context.ts:249`, `:252`, `:412`; `import-resolution/ts-js-import-resolver.ts:49`.

**Failing scenario:** Root `tsconfig.base.json` declares `baseUrl: "."` and `paths: {"@x": ["old.ts"]}`. Root `tsconfig.json` extends it and overrides paths with `{"@x": ["new.ts"]}`. Both targets exist and `main.ts` imports `@x`.

**Observed:** The context appends both rules in manifest-name order, has no gaps, and resolution selects `old.ts`. The real graph makes `main.ts -> old.ts`, returns no dependents for `new.ts`, and reports `clean: true`. The installed TypeScript config parser and module resolver select `new.ts` on the same on-disk fixture. Checking that the extended filename was read does not apply inheritance. Unrelated root configs are likewise pooled without association to importing files.

**Impact:** A normal root config override silently changes the graph's meaning; downstream change-impact answers can omit the actual consumer while claiming completeness.

**Disposition: fix-now.** Construct effective options with override semantics and the applicable config, or disclose unsupported/ambiguous config combinations as partial instead of resolving from an arbitrary union. Cover inherited baseUrl plus child paths, conflicting overrides, and independent root configs. Do not call a successfully read extends chain successfully modeled.

### R32B-02 — Blocking — Declared local packages are certified external

**Anchors:** `import-resolution/resolver-context.ts:244`, `:451`; `import-resolution/ts-js-import-resolver.ts:72`.

**Failing scenario:** Root `package.json` has `dependencies: {"local": "file:./packages/local"}`; `packages/local/index.ts` exports `x`, and `main.ts` imports `{x}` from `local`. There is no workspaces field.

**Observed:** Dependency values are discarded by `Object.keys`. The resolver treats membership in declaredPackages as proof of externality. The real graph has no edge to the local file, its dependents are empty, and coverage is `clean: true`, `context: complete`. External is counted twice because the existing extractor produces detailed and bare-source records; that duplication is not introduced by this batch.

**Impact:** A manifest explicitly identifying an internal package suppresses the very uncertainty that should qualify the answer. The executor's declared-package exception is not a sound proof of externality.

**Disposition: fix-now.** Retain dependency specifications. Resolve supported local protocols or mark `file:`, `link:` and `workspace:` dependencies as unresolved/partial without certifying external completeness. Full package-entrypoint resolution may remain later work; honest coverage may not.

### R32B-03 — Blocking — Manifest containment validation is detached from the actual open

**Anchors:** `import-resolution/resolver-context.ts:313`, `:315`, `:325`.

**Failing scenario:** A manifest resolves inside the root and passes stat. Before readFile opens it, the root directory is renamed and replaced by a junction to an outside directory containing a different `tsconfig.json`.

**Observed:** A real Windows filesystem probe, wholly under OS temp, performed that swap after delegating the real stat. The subsequent actual readFile consumed the outside config, admitted its `@outside` path rule, and returned no gaps. The control with a stable outside-root realpath was correctly rejected with `manifest-outside-root`. Thus stable-link rejection works, but does not close the check/open race.

**Impact:** The promised realpath-inside-root boundary is bypassable. An outside manifest influences resolver output without partial-context disclosure.

**Disposition: fix-now.** Tie containment/identity validation to the object actually opened and read, including mutable ancestor links; reject an observed identity/root change. Use platform-appropriate handle validation rather than assuming a previously canonicalized pathname remains canonical. Add the real junction-swap regression alongside the existing stable-link test.

### R32B-04 — Serious — Manifest limits bound accepted text, not actual I/O

**Anchors:** `import-resolution/resolver-context.ts:229`, `:234`, `:325`, `:335`.

**Failing scenarios and observations:**

1. Twelve root tsconfig files, each 250 KiB and containing a NUL, cause 12 reads totaling **3,072,000 bytes**, exceeding the 2 MiB build budget. All return the not-text gap, so execution continues before totalBytes is charged. The result has only `manifest-not-text`, not the exhausted-total gap.
2. A file stats at 2 bytes but grows before read. The injected read returns an 8 MiB buffer, which is fully accepted by readFile before the post-read size check returns `manifest-too-large`. The implementation cannot bound allocation/I/O with its unbounded readFile operation.

**Impact:** Binary/invalid content evades aggregate accounting, and a changing file can exceed the per-file and total physical-read limits arbitrarily. Coverage is qualified after these cases, but qualification does not recover the resource bound.

**Disposition: fix-now.** Perform bounded reads using the lesser of the remaining build budget and per-file limit, with a small sentinel allowance if needed; account for consumed bytes even when decoding/parsing is rejected. Stop at aggregate exhaustion. Assert physical bytes read, not just accepted manifest counts or returned gap labels.

### R32B-05 — Moderate — Escaped re-export module specifiers are not decoded

**Anchors:** `ast-analysis.service.ts:55`, `:462`; existing export-source fallback is consumed by `dependency-graph.service.ts:318`.

**Failing scenario:** JavaScript `export {} from './\u006ceaf';` with a literal backslash-u escape and an existing `leaf.js`.

**Observed:** The real JavaScript grammar parses successfully. reExportSources contains `./\u006ceaf`, not the semantic `./leaf`. The graph has no dependency edge and returns no leaf dependents. Unlike R32B-01/02, this case correctly becomes unclean (`unresolvedInternal: 1`), so it is a missing supported edge rather than false clean coverage. Named/star forms use the same raw-spelling problem.

**Impact:** The new dependency-source channel closes plain empty clauses, but the claim that every static re-export is now an edge remains too broad for valid escaped module strings.

**Disposition: fix-now.** Decode JavaScript string-literal module requests without eval, consistently for the new channel and source-bearing ExportInfo fallback. Preserve the intended import-output parity by normalizing at a suitable resolver boundary if necessary. Test escaped named, star, namespace and empty clauses and ensure duplicate raw/decoded sources do not introduce a false unresolved count.

### R32B-06 — Moderate — Cancellation during manifest lookup still starts a new read

**Anchors:** `import-resolution/resolver-context.ts:221`, `:227`, `:313`, `:315`, `:325`.

**Failing scenario:** The build becomes obsolete while awaiting the manifest's stat.

**Observed:** A controlled filesystem probe changed isCurrent to false inside stat. readFile was subsequently called anyway; only after the whole readManifest completed did buildResolverContext return undefined. There is no stale graph publication, but the cancellation check surrounds a multi-await operation instead of guarding each subsequent expensive operation.

**Impact:** A superseded build starts avoidable I/O after cancellation; with R32B-04 this can be a large read. This is distinct from the multi-target expansion cancellation, which passed.

**Disposition: fix-now with the manifest reader changes.** Pass the generation guard/abort signal into the reader and recheck after awaited lookup/stat and before starting the read. Add a stat-gated cancellation fixture asserting no read occurs. Preserve the publication guard already present.

## Batch 32a r1 verification

Real shipped WASM grammars were exercised through TreeSitterParserService and AstAnalysisService, rather than synthetic query matches.

| Finding | Status | Evidence |
| --- | --- | --- |
| R32A-01, nested Rust comments | **CLOSED** | `languages/rust.language.ts:142` now tracks comment depth. Both `use a::{b, /* outer /* nested */ } */ c};` and the former phantom-token variant return exactly `a::b`, `a::c`, with clean grammar parsing. |
| R32A-02, Rust identifier bytes | **CLOSED** | `languages/rust.language.ts:172` slices original token text. The decomposed U+0301 fixture retains the combining character, and raw identifiers remain byte-exact in source paths. |
| R32A-03, C# static trait | **CLOSED** | `languages/csharp.language.ts:180` emits isStatic independently of global. Paired global/static versus global/nonstatic grammar fixtures are now distinguishable. Java static wildcard imports also carry isStatic (`languages/java.language.ts:95`). |
| R32A-04, Python member aliases | **STILL OPEN — carry-to-33** | `languages/python.language.ts:79` still returns original symbols only. Real `from ..p import A as B, C as D` returns A/C without B/D. This is the previously agreed deferred contract extension, not a new 32b blocker. |
| R32A-05, empty re-export clause | **CLOSED for the reported ordinary clause** | reExportSources captures `export {} from './side'` despite no exported symbols, and graph linking adds the edge. Forward/reverse real-grammar fixture succeeds. Escaped module literals are the separate R32B-05 extension failure. |

The 26b carried named/star re-export problem is also closed on ordinary inputs: a real graph with leaf -> named barrel -> star barrel -> namespace barrel -> consumer returns all those consumers from getDependents(leaf), plus the empty-clause barrel. These are graph-service probes at the MCP consumer boundary; no separate live MCP session was invoked.

## Data flow and requirements evidence

The language module provides importResolver; linking dispatches from the importing node's language. Extraction feeds imports plus a deduplicated re-export-source channel, and resolution returns kind/targets with optional disclosure flags. Linking builds forward/reverse sets, remembers re-exporters for barrel traversal, and publishes graph and coverage only for the current generation. Invalidation removes corresponding barrel markers. Resolver failures of meaning can still become clean successes at the context layer (R32B-01/02).

| Requirement | Review result |
| --- | --- |
| Pure `resolve(imp, fromFile, ctx)` seam and language dispatch | Implemented; no filesystem I/O in TS/JS resolver. |
| Relative TS/JS probes and ordinary graph parity | Baseline HEAD graph implementation and current graph, using the same actual analyzer, produced identical dependency/dependent sets, exports and coverage on a TS/JS/TSX fixture. Whole-array byte equality did not hold because async parse insertion order differed; this is not claimed as a new regression. |
| Root paths/baseUrl | Ordinary inputs work; effective config inheritance fails R32B-01. |
| Case rule | Independent probe: exact Foo wins even with foo present; unique folded foo -> Foo returns caseFolded; ambiguous FOO returns unresolved-internal. |
| Per-import 200; aggregate 250,000 | Injected 201-target resolver over 1,252 nodes stopped at exactly 250,000 edges, disclosed edgeCapHit and truncatedImports (1,251), with no fabricated unresolved count. |
| Mid-expansion cancellation | Independent controlled-clock/macrotask probe stopped after seven edges; current guard is rechecked inside the target loop. |
| Manifest generation and yields | Yield before reads and publication checks are present; lookup/stat cancellation gap is R32B-06. |
| 64-file, 256 KiB, 2 MiB manifest bounds | Candidate cap and static size checks present; physical read budget fails R32B-04. |
| Manifest text and containment | Invalid UTF-8/NUL are qualified. Stable outside-root links rejected. Junction race fails R32B-03. `extends: '../outside/tsconfig.json'` probe reads only the root manifest and reports extends-not-read. |
| Re-export forms and chains | Ordinary named/star/namespace/empty fixtures pass; escaped module source fails R32B-05. |
| Batch 27 benchmark | Existing bare/workspace-alias partial-coverage criterion remains in the benchmark. Executor reports it passes; no independent completed benchmark run is claimed. |

## Five logic questions

1. **How can this fail silently?** An overridden alias or explicitly local dependency creates the wrong/empty graph while clean remains true (R32B-01/02); an outside config can enter without a gap (R32B-03).
2. **What ordinary user action triggers unexpected behavior?** Overriding a root tsconfig path, or adding a file dependency, changes resolution differently from the workspace's intended module mapping.
3. **What input produces a wrong answer?** Conflicting inherited path rules, local dependency protocols and escaped re-export strings have concrete reproductions above.
4. **What happens when a dependency fails or work is cancelled?** Manifest read/parse/encoding failures become partial context; obsolete work is not published. Read bounds and cancellation before a newly started read still need correction (R32B-04/06).
5. **What does the next batch need that is not fully supplied?** Python member-binding aliases still need the agreed Batch 33 contract extension. Future namespace/type resolvers also need declaration/package indexes beyond today's knownFiles-only context; those later language capabilities were not independently validated here.

## Verification and limitations

Independent probes used a temporary CommonJS TypeScript loader, actual repository services and shipped WASM grammars, real shared Result, and inert logging/DI adapters. Real filesystem fixtures, including the junction race and the TypeScript compiler oracle, lived only under OS temp. Controlled filesystem/resolver injection was used explicitly for byte accounting, cancellation and high fanout; these are not presented as full integration tests.

Probe scripts: `%TEMP%/ptah-32b-context-probe.cjs`, `ptah-32b-graph-probe.cjs`, `ptah-32b-link-probe.cjs`, `ptah-32b-bounds-parity.cjs`, `ptah-32b-parity-details.cjs`, `ptah-32b-case-probe.cjs`. Scoped ptah diagnostics returned zero errors/warnings for the checked context/graph files; that does not establish runtime correctness.

The requested scoped Nx test command was launched once with PowerShell's `Select-Object -Last 40` tail equivalent. Its single completion check still reported an active process with no final output (session 98660). In accordance with the no-status-loop constraint, it was not polled repeatedly or rerun. **No independent whole-suite pass is asserted.** The executor reports 63 passing suites/1 skipped and 1,949 passing tests/10 skipped, plus scoped lint/typecheck and downstream checks; those remain executor-reported evidence. No full workspace verification, formatter or source modification was performed.

Acceptance requires fixing R32B-01 through R32B-06 and retaining the successful controls. Four 32a findings close; R32A-04 remains explicitly carried to 33.
