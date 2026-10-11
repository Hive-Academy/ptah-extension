# Phase-1 correction review — commit 917c138ce

Commit `917c138ce75f84b66146e3c100ebceac9c8a5584` ("fix: task 620 phase 1 - pin
memory-curator barrel imports to host-only modules"). Changes under review:
new `tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts` (89 lines),
`baselines/retention-policy-defaults.ts:1-3` (header comment), and
`ground-truth/seeded-session-generator.ts:39-43` (header doc block).

## Defect closed?

**Yes.** The defect (r2 finding 1) was that the two bench modules value-import the
`@ptah-extension/memory-curator` barrel at module initialization, so they must never
load in the plain runner parent. The commit closes it by declaring and enforcing that
boundary instead of making the modules headless-safe (the constraint the defect
statement frames):

- **No live load path exists.** Repo-wide grep of every `.ts` file: the only importers
  of the two modules are their own specs — `baselines/retention-policies.spec.ts:20`
  (`./retention-policy-defaults`) and `ground-truth/seeded-session-generator.spec.ts:45`
  (`./seeded-session-generator`). No production module — host or otherwise — imports
  either. Repo-wide grep of `*.{ts,tsx,js,mjs,cjs}` for `mcp-bench/src/memory-skills`
  returns nothing, so no code outside the tree reaches into it. Both modules still
  need `reflect-metadata` + a vscode shim if loaded (that is unchanged and now a
  documented invariant, not a hidden trap): headers at
  `baselines/retention-policy-defaults.ts:1-3` and
  `ground-truth/seeded-session-generator.ts:39-43`.
- **The boundary is pinned forward.** `host-only-imports.spec.ts:18-21` whitelists
  exactly the two modules; `:63-73` (test 2) fails if any other non-spec file under the
  scan root value-imports the barrel; `:75-89` (test 3) fails if any non-`host/`
  non-spec module relatively imports either whitelisted module.
- The whitelist matches reality: the only non-spec value-imports of the barrel in the
  tree are the two whitelisted ones (`seeded-session-generator.ts:46-50`,
  `retention-policy-defaults.ts:4-7`); no `host/` file imports the barrel or either
  module, so test 2's stricter-than-design whitelist (even `host/` may not import the
  barrel directly) is consistent — the host gets the barrel transitively through the
  whitelisted modules, never directly.

## Findings

All findings are **minor**; none is major; none breaks the closure today.

1. **`IMPORT_PATTERN` is blind to `require()` — the form is real in this tree, the
   offending instance is not.** `host-only-imports.spec.ts:22-23` — the regex only
   recognizes `import`/`export` statements; a lazy
   `require('@ptah-extension/memory-curator')` or
   `require('./seeded-session-generator')` inside a function body is invisible to
   tests 2 and 3. This is not a foreign style: the scanned tree itself lazy-requires
   modules in non-spec production code — `memory-skills/data/candidate-row-diff.ts:58`
   (`require('better-sqlite3')`) and `memory-skills/runner/net-recorder.ts:151-153,316`
   (`require('node:fs'/'node:net'/'node:dns')`). A contributor copying that
   established in-tree pattern to defer barrel init would pass green while re-opening
   the exact defect. Today no `require` of the barrel or of a host-only module exists
   (repo-wide barrel grep: all references are static single-quote imports).
   **Severity: minor. Real form / theoretical instance.**

2. **No positive control — the suite passes vacuously if the regex stops matching.**
   `host-only-imports.spec.ts:76-89` — none of the three tests asserts that
   `readImports()` detects a known import (e.g. that the whitelisted
   `seeded-session-generator.ts:46-50` yields the barrel edge). Test 1 checks file
   existence only; tests 2 and 3 assert empty offender lists, so a catastrophic regex
   regression (e.g. a prettier switch to double quotes, which the single-quote-only
   pattern at `:23` cannot match at all) leaves every test green while the guard
   guards nothing. This is the silent-failure answer for this commit: the guard's own
   failure mode is a success-looking green run. Sensitivity today is by regex trace,
   not by assertion — the `[^;'"]` class at `:23` admits `\n`, so multi-line named
   imports (`seeded-session-generator.ts:46-50`, `retention-policy-defaults.ts:4-7`)
   and `export * from` / bare side-effect `import 'x'` forms are matched; the passing
   run proves no false positive and the existence checks, not detection.
   **Severity: minor. Real design gap / theoretical trigger.**

3. **Exact-specifier matching misses `.js`-suffix, `/index` and subpath forms.**
   `host-only-imports.spec.ts:64-69` — `e.specifier === BARREL`, so
   `'@ptah-extension/memory-curator/index'` or `'.../index.js'` bypasses rule 1; a
   deep subpath import that itself loads the barrel is likewise invisible.
   `resolveRelative` (`:41-43`) turns `./retention-policy-defaults.js` into the key
   `baselines/retention-policy-defaults.js.ts`, which never equals the whitelist key,
   so rule 2 misses `.js`-suffixed relative imports too. **Severity: minor.
   Theoretical** — every in-tree import is extensionless, exact and single-quoted
   (repo-wide greps: no `from "..."`, no `from '.*\.js'`, no barrel subpaths).

4. **The scan root is `src/memory-skills` only, and only `.ts`/`.spec.ts` files exist
   in it.** `host-only-imports.spec.ts:14` (`ROOT = __dirname`) with `listSourceFiles`
   (`:31-38`) — a module elsewhere (`tools/mcp-bench/src/transport/*`,
   `src/bench-data.ts`, any app) that value-imports the barrel or relatively imports a
   host-only module is never scanned; `entry.name.endsWith('.ts')` would also skip a
   hypothetical `.tsx`/`.js` file. **Severity: minor. Theoretical** — no file outside
   `memory-skills/` imports into it (repo-wide greps), and the scan root contains only
   `.ts` and `.spec.ts` files (glob of `src/**/*.{ts,tsx,js,mjs}`).

5. **Transitive case: covered for regex-visible static forms, with two holes.** A →
   B → host-only M is caught at B for any static relative import under the scan root
   (the load always goes through B's direct edge, and B's edge is exactly what test 3
   checks — hop count does not matter). For the barrel, test 2 checks every non-spec
   file's direct edge, so any in-tree intermediate is caught. The holes: (a) the B→M
   or B→barrel edge written in a form the regex misses (findings 1 and 3); (b) a
   non-host module importing a `host/` module, which may itself import M — test 3
   exempts `host/` files (`:77`) and never checks non-host → `host/` edges.
   **Severity: minor. Theoretical** — no host file imports M or the barrel today, and
   nothing imports anything under `host/` from outside it (greps of `host/` import
   specifiers and repo-wide path references).

6. **False-positive surface exists but fails loudly and nothing trips it today.**
   A block comment or multi-line template literal containing a line-start
   `import ... from '...'` (e.g. code-generating TS source) would be flagged as an
   edge and fail the suite visibly; `import { type X } from 'barrel'` (inline type
   modifier, `host-only-imports.spec.ts:24-27`) is counted as a value import —
   conservative, safe direction. No such text exists under the scan root; the header
   comments added by this very commit do not parse as imports. **Severity: minor.
   Theoretical.**

## Jest result

Scoped run (`npx jest -c tools/mcp-bench/jest.config.ts
tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts`):
`Test Suites: 1 passed, 1 total; Tests: 3 passed, 3 total; Time: 6.869 s` —
`finds the source tree and every host-only module`, `lets only host-only modules
value-import the memory-curator barrel`, `keeps host-only modules out of every
non-host module` all pass.

## Verdict

**APPROVED.** The defect is closed with repo-wide evidence: no production load path to
either module exists, the boundary is documented on both modules, and the new guard
enforces it for every import form this codebase actually uses — all five regex-miss
categories (`require`, dynamic `import()`, double quotes, `.js`/`/index` suffixes,
`import x = require()`) are theoretical today except the `require()` form (finding 1),
which has in-tree precedent but no offending instance, and every false-positive
direction fails visibly. Follow-up worth one line someday (not blocking): teach the
pattern `require(...)` and add a positive-control assertion that the whitelisted
modules' own barrel import is detected, so the guard cannot pass vacuously.
