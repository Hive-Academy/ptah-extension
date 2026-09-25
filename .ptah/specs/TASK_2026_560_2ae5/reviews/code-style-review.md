# Code Style Review — `TASK_2026_560_2ae5` (Batch 1)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 6/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 0                                    |
| Serious issues  | 3                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 8                                    |

Scope: the 8 files listed in `batches.md` Batch 1 — `libs/shared/src/lib/types/capability-toggle.types.ts`
(+ `.spec.ts`), `libs/shared/src/index.ts`, `harness-sync.types.ts`, `rpc/rpc-misc.types.ts`,
`mcp-directory.types.ts`, and `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
(+ `.spec.ts`). Read in full. Compared against `libs/shared/src/lib/types/harness-sync.types.ts` (620 lines,
the plan's own named pattern), `libs/shared/src/lib/types/user-layer-agents.ts` (123 lines, the plan's own
named precedent for a dependency-free hash), `CONVENTIONS.md`, and `implementation-plan.md` C1. Verified with
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2`
(passes) and `npx nx run @ptah-extension/shared:typecheck` in isolation (passes — a workspace-diagnostics
BigInt/ES2020 warning against this file did not reproduce under the project's real `tsconfig.lib.json`,
target `ES2022`; treated as a tool artifact, not a finding).

## Five style questions

### 1. What breaks in six months?

`libs/shared/src/lib/types/capability-toggle.types.ts` is 1107 lines and already carries five unrelated
concerns: the domain contract, the resolution rules, the approval-import planner, a TOML key escaper, a
hand-rolled FNV-1a fingerprint, and a hand-rolled FIPS 180-4 SHA-256 implementation (`capability-toggle.types.ts:1031-1107`,
the `SHA256_K`/`SHA256_INITIAL` tables and `sha256Hex`). The next person who needs to touch the id codec (D2)
or add a sixth capability concern has to read past a cryptographic primitive to find the ~40 lines that matter
to them, and a future change to any one concern risks merge conflicts with every other one landing in the same
PR. This is exactly the growth pattern `CONVENTIONS.md:51-52` warns about for barrels ("If you exceed it, the
library is doing too much; split before adding more") — the file has no such guard rail.

### 2. What would a new team member misread?

A newcomer skimming `libs/shared/src/index.ts:47` (`export * from './lib/types/capability-toggle.types'`)
would reasonably assume, from the filename and the sibling barrel entries around it (`harness-sync.types`,
`origin-sidecar.types`, `user-layer-agents`), that this file is types-plus-a-reducer like its stated pattern.
They would not expect to find a full SHA-256 block cipher-style implementation 900 lines in
(`capability-toggle.types.ts:1031-1107`) — nothing in the file name, the module doc comment (`:1-23`), or the
export list signals "this file also implements a hash primitive." The doc comment at `:14-15` even points to
`user-layer-agents.ts` as the reason no Node import is used, but that file never needed SHA-256 — its FNV-1a is
23 lines, not a cryptographic primitive; the analogy undersells what was actually added.

### 3. What does this cost to maintain?

The SHA-256 block adds ~75 lines of un-reused, security-adjacent code that nothing else in `libs/shared`
exercises. It has to be kept correct against the FIPS 180-4 spec by hand, with no shared review anchor (no
other file in the repo implements a NIST hash), and it duplicates a facility every JS runtime already has
(`crypto.subtle.digest`/`node:crypto`) — the constraint that forced it (`libs/shared` ships to the browser
bundle) is real, but the fixed D2 vectors in the spec (`capability-toggle.types.spec.ts:1,40-42`) are verified
against `node:crypto`'s `createHash('sha256')` directly, which is itself only importable because the spec runs
under Node. A synchronous `Uint8Array -> hex` hasher used only by the codec is a natural single-purpose file
(`capability-id-codec.ts` per the plan's own suggested split), not part of the growing types barrel.

### 4. Where is this inconsistent with the rest of the repository?

- `libs/shared/src/lib/types/harness-sync.types.ts` (620 lines, the explicitly named pattern for this task,
  `batches.md:215`) holds types plus ONE pure reducer (`summarizeHarnessHealth`) and stays under 700 lines.
  `capability-toggle.types.ts` holds types plus six functional facets (defaults, resolution, plugin-config
  layering, MCP scope/definition rules, approval-import planning, TOML escaping, a fingerprint hasher, AND a
  codec with its own SHA-256) at 1107 lines — a materially different shape from the file it was told to
  follow, not a proportional extension of it.
- `mcp-directory.types.ts` (diff) now does `import type { CapabilityScope } from './capability-toggle.types'`
  (`mcp-directory.types.ts:10`), while `capability-toggle.types.ts` does
  `import type { McpServerOrigin, McpInstallTarget } from './mcp-directory.types'` (`capability-toggle.types.ts:26`).
  These two files now import from each other. TypeScript erases both at compile time (`import type`), so it
  does not break the build, but it is a real cycle in the dependency graph between two files in the same
  `types/` folder, which no other pair in `libs/shared/src/lib/types/` does (`harness-sync.types.ts` and
  `user-layer-agents.ts` are read by `capability-toggle.types.ts` one-way only). `CapabilityScope` describes an
  MCP-declaration property just as much as a capability-toggle one (`InstalledMcpServer.scope?`,
  `mcp-directory.types.ts:300-306`); it either belongs in whichever file is the lower layer, or in a primitives
  file both can import one-way.
- `CONVENTIONS.md:31` names `src/lib/utils/` as the home for "pure functions only" inside a library, and this
  task's own review instructions explicitly ask whether a facet-named split (not a generic `utils.ts`) fits —
  the file currently does neither: it is not split, and everything lives in a `types/` file named for the
  domain contract alone.

### 5. What would you have done differently, and why is that better rather than merely other?

Split by facet, matching the naming this codebase already uses for adjacent concerns (compare
`libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts`, `task-spec.contract.ts` next to `task-graph.ts`
— related but separately named files, not one megafile):

- `capability-toggle.types.ts` — identity, stored values, resolution types, `EffectiveCapabilitySet`,
  `ICapabilityResolver`/`ICapabilityGlobalLayer`, `CAPABILITY_ENFORCEMENT`, and the resolution-rule functions
  (`defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`, `classifyMcpScope`,
  `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`) — the part that is genuinely "types +
  reducer," matching `harness-sync.types.ts`'s shape and size.
  `harnessPolicyFingerprint`/`isHarnessPassAcknowledged`/`tomlKeySegment` are a defensible stay here too if kept
  small, since they participate directly in the resolution story.
- `capability-id-codec.ts` (+ `.spec.ts` split out of the current spec) — `encodeCapabilityId`,
  `decodeCapabilityId`, `canonicalFilename`, `parseCapabilityFilename`, the UTF-8 helpers, and the SHA-256
  block. This isolates the one piece of genuinely novel, security-adjacent code behind a name that tells a
  reader exactly what they are opening, and it can be reviewed and vector-tested on its own.

This is better than the current shape because it makes the file someone opens match what they came to change:
a reviewer diffing the resolution rules for a future AC never has to scroll past a hash implementation, and a
reviewer double-checking the SHA-256 block against FIPS 180-4 does not have to first read 900 lines of
unrelated domain rules. It also brings the primary file back under the 620-line precedent instead of nearly
doubling it, with no loss of the "types + pure rules only, no runtime deps" boundary — both new files keep
that same constraint.

## Blocking issues

None. The check command passes, no `as any` was introduced, no `catch (error)` without `: unknown` appears in
the reviewed files, and the marketplace component change is a single, exhaustively-typed switch case that
matches its siblings exactly.

## Serious issues

### One `.types.ts` file holds a domain contract, a resolution engine, an import planner, a TOML escaper, and a hand-rolled SHA-256

- File: `libs/shared/src/lib/types/capability-toggle.types.ts:1-1107`
- Problem: the file is 1107 lines against the pattern it was told to follow
  (`harness-sync.types.ts`, 620 lines, `batches.md:215`), and it mixes a cryptographic primitive
  (`:1031-1107`, `SHA256_K`, `SHA256_INITIAL`, `sha256Hex`) into a file whose name and header promise "TYPES
  and the PURE RULES only" (`:5`). Nothing about the filename or the barrel export signals that a FIPS 180-4
  implementation lives inside it.
- Tradeoff: keeping it as one file avoids the ceremony of a second export and a second spec file, but it
  trades that for a file a reviewer cannot safely skim, a higher chance of accidental coupling between
  unrelated changes (e.g., a resolution-rule tweak and a codec tweak landing in the same diff hunk region), and
  a file that no longer matches the size or shape of its own named precedent.
- Recommendation: split into `capability-toggle.types.ts` (contract + resolution rules) and
  `capability-id-codec.ts` (+ `.spec.ts`) for the encode/decode/canonical-filename/UTF-8/SHA-256 code, per the
  Five Style Questions answer above. Re-export the codec's public surface from
  `capability-toggle.types.ts` or directly from `libs/shared/src/index.ts` so `TASK_2026_559` and the store
  (Batch 6) see no import-path change.

### `mcp-directory.types.ts` and `capability-toggle.types.ts` import from each other

- File: `libs/shared/src/lib/types/mcp-directory.types.ts:10` (`import type { CapabilityScope } from
  './capability-toggle.types'`) and `libs/shared/src/lib/types/capability-toggle.types.ts:26`
  (`import type { McpServerOrigin, McpInstallTarget } from './mcp-directory.types'`)
- Problem: this is a cycle between two files in `libs/shared/src/lib/types/`. Both imports are `import type`,
  so it is erased before it can become a runtime cycle, but it is still a structural inconsistency: no other
  pair of files in this `types/` folder imports each other, and the dependency graph the barrel implies
  (leaf types feeding into composed types) does not hold for these two.
- Tradeoff: leaving it as-is works today because both sides stay type-only, but it is one accidental value
  import away (e.g., someone adding a runtime helper that needs `CapabilityScope` as a value, or a `satisfies`
  check) from becoming a real circular dependency that `tsc`/bundlers resolve inconsistently.
- Recommendation: either move `CapabilityScope` to `mcp-directory.types.ts` (it already describes
  `InstalledMcpServer.scope?`, a declaration-scope concept that predates capability toggles) and have
  `capability-toggle.types.ts` import it from there one-way, or lift `CapabilityScope` into a primitives file
  both can import one-way (no existing candidate; only worth it if a third consumer appears).

### File length trending well past the repository's stated "split before adding more" signal

- File: `libs/shared/src/lib/types/capability-toggle.types.ts` (1107 lines), spec at
  `libs/shared/src/lib/types/capability-toggle.types.spec.ts` (738 lines)
- Problem: `CONVENTIONS.md:51-52` states the barrel size ceiling exists because "the library is doing too much;
  split before adding more." The types file under review is not a barrel, but the same signal applies: at
  1107 lines it is the single largest file in `libs/shared/src/lib/types/` by a wide margin (next-largest is
  `rpc.types.ts` at 3903 lines, which is itself an outlier the repo already tolerates as a grab-bag RPC
  registry, not a comparable "types + rules" file; the next comparable file, `harness-sync.types.ts`, is 620).
  Batch 2 (RPC types) and later batches that touch `CAPABILITY_ENFORCEMENT` (PR 2's enforcement flip,
  `implementation-plan.md:516-518`) will both edit this same file, compounding the merge-conflict risk of one
  megafile.
- Tradeoff: the file compiles and tests pass today, so this is not urgent, but every subsequent batch that
  touches capability types adds to a file that is already outside this repo's demonstrated norm for this shape
  of file.
- Recommendation: apply the split from the "Blocking issues" entry above before Batch 2 lands more content in
  the same file.

## Minor issues

- `libs/shared/src/lib/types/capability-toggle.types.ts:14-15` — the doc comment credits `user-layer-agents.ts`
  for the "no Node import" precedent, but that file's hash is a 23-line FNV-1a, not a SHA-256 implementation.
  The comment should say the SHA-256 requirement comes from the D2 fixed test vectors (which are pinned against
  real SHA-256 output), not imply the existing precedent already covered this scope of code.
- `libs/shared/src/lib/types/capability-toggle.types.ts:1043-1048` (`SHA256_INITIAL`) and the `SHA256_K` table
  above it are unavoidably "magic numbers" for a hash implementation, but as written they carry no inline
  citation of the spec section (FIPS 180-4 §5.3.3) a future maintainer would need to re-verify them against;
  a one-line comment would remove the need to search externally to audit the constants.
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts:469-476` — the new test
  only asserts the badge's tone class and the panel note text; every neighbouring case in the same `describe`
  block (e.g., the "names collisions as unreconcilable" case just below it, `harness-health-badge.component.spec.ts:479+`)
  follows the identical two-assertion shape, so this is consistent, not a defect — noted only because it is the
  thinnest of the sibling cases and could also assert the badge's accessible label, as a couple of the other
  cases in the file do. Not required for this batch.

## File-by-file

### `capability-toggle.types.ts`

Score 5/10 — 0 blocking, 2 serious, 2 minor. The resolution rules, defaults and RPC contracts are precise and
well-documented (every non-obvious branch carries a "why," e.g. `nextWorkspaceValue`'s inherit-vs-imported
distinction at `:232-243`), and the pure-functions-only boundary is honestly held (no `as any`, no ambient
`Error` catches). The file's size and the embedded SHA-256 are the two Serious findings above; everything else
in it is sound.

### `capability-toggle.types.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Covers every named Resolution rule, the D2 fixed vectors verbatim
(`:46-51`), fingerprint stability under reordering, and the acknowledgement predicate's negative cases. It
imports `node:crypto` (`:1`) purely for test oracles, which is correct for a Jest spec and does not violate the
"shared ships to the browser" constraint (specs never ship). Would follow the codec split above 1:1 if that
split happens; no change needed on its own merits.

### `libs/shared/src/index.ts`

Score 10/10 — one explicit `export *` line added in the existing alphabetically-loose grouping next to
`harness-sync.types`, matching the file's established pattern exactly.

### `harness-sync.types.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (folded into the note above only as context, not double-counted).
The `'policy-unknown'` union member, its doc-comment rationale (`:69-73`), the `policyFingerprint?` field and
its reducer branch (`:314-315`) all match this file's existing documentation density and structure precisely.

### `mcp-directory.types.ts`

Score 7/10 — 0 blocking, 1 serious (the cross-import above), 0 minor. The `scope?` field addition and its doc
comment match the file's existing style; the only issue is the new import direction.

### `rpc/rpc-misc.types.ts`

Score 10/10 — `enabledSkillIds?` is documented with the same "optional for backward compatibility" rationale
as its sibling `disabledPluginIds` field it explicitly cross-references (`:512-521`), and its interaction with
`disabledSkillIds` (deny wins) is stated inline.

### `harness-health-badge.component.ts` / `.spec.ts`

Score 9/10 — the new `'policy-unknown'` case is textually and structurally identical to its neighbours in the
exhaustive switch (`:265-266`), keeps the component `OnPush` with no new state, and the spec case matches the
file's established `render` → `openPanel` → assert two-line shape. This resolves the plan's P1 finding
(`batches.md:24`) exactly as scoped — no other component behaviour was touched.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `libs/shared` holds types + pure functions only, no runtime deps | PASS | No `node:crypto`/`node:*` import in `capability-toggle.types.ts`; hand-rolled UTF-8/SHA-256/FNV-1a instead (`:963-1107`) |
| Barrel export style (`export * from` for a type bundle) | PASS | `libs/shared/src/index.ts:47` |
| File shape matches its named pattern (`harness-sync.types.ts`) | FAIL | 1107 lines vs. 620-line pattern; six unrelated facets in one file (see Serious #1) |
| No import cycle within `libs/shared/src/lib/types/` | FAIL | `mcp-directory.types.ts:10` ↔ `capability-toggle.types.ts:26` (see Serious #2) |
| Exhaustive switch stays exhaustive on a new union member | PASS | `harness-health-badge.component.ts:265-266`, no `default` added, compiler-enforced |
| Angular OnPush / signals for the touched component | PASS | Component already `ChangeDetectionStrategy.OnPush`; no state model changed |
| No new `as any` / untyped `catch` | PASS | None found in the reviewed files |
| Spec style matches neighbouring specs | PASS | Both new spec cases follow their file's established `describe`/assertion shape |
| Naming: kebab-case files, UPPER_SNAKE constants | PASS | `capability-toggle.types.ts`, `CAPABILITY_ENFORCEMENT`, `CAPABILITY_POLICY_UNKNOWN_ERROR_NAME`, etc. |

## Maintenance debt

- Introduced: one 1107-line shared types file carrying a domain contract, a resolution engine, an approval
  planner, a TOML escaper, and a hand-rolled SHA-256/UTF-8 codec; one type-only import cycle between
  `mcp-directory.types.ts` and `capability-toggle.types.ts`.
- Retired: nothing — this batch is additive (new file, optional-field extensions, one new switch case).
- Net: negative on file cohesion (one file now does materially more than its named pattern), neutral on
  behaviour and test coverage (both are strong).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `capability-toggle.types.ts` has outgrown the "types + pure rules" shape it was explicitly
  told to follow, most concretely by embedding a full SHA-256 implementation; splitting the codec out before
  Batch 2 adds more content to the same file is the cheapest point to fix it.
- What a 10/10 version would do differently: split into `capability-toggle.types.ts` (contract + resolution
  rules, ~650-750 lines) and `capability-id-codec.ts` + `.spec.ts` (codec + UTF-8 + SHA-256, ~350 lines); give
  `CapabilityScope` a single-direction home so `mcp-directory.types.ts` and the toggle types file are not
  mutually importing; and correct the `user-layer-agents.ts` doc-comment citation to name the actual reason
  (D2's SHA-256-verified vectors) SHA-256 rather than FNV-1a was required.

---

## Re-review round 1

Re-read in full: `capability-toggle.types.ts` (now 694 lines), `capability-id-codec.ts` (new, 435 lines) +
`.spec.ts` (285 lines), `capability-toggle.types.spec.ts` (now 456 lines), `mcp-directory.types.ts` (863 lines,
diffed against the prior read), and the badge spec split. Re-ran
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2 --skip-nx-cache`
(fresh, no cache) — all six tasks pass.

### Prior findings

1. **Serious — one file holds contract, resolution engine, import planner, TOML escaper and SHA-256.**
   RESOLVED. `capability-toggle.types.ts` is now 694 lines and holds only the domain contract and the
   resolution-rule functions (`defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`,
   `classifyMcpScope`, `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`,
   `CAPABILITY_ENFORCEMENT`) — the shape this task named as the pattern (`harness-sync.types.ts`, 620 lines).
   The byte-level code (id codec, TOML key segment, SHA-256, FNV-1a fingerprint) moved to
   `capability-id-codec.ts`. Both files are now under the 700-line reference point raised in the original
   review, and each reads as what its header promises to a first-time reader.
2. **Serious — `mcp-directory.types.ts` and `capability-toggle.types.ts` import each other.**
   RESOLVED. `CapabilityScope` now lives in `mcp-directory.types.ts:18` with no import statement in that file
   at all (verified: `grep -n "^import" mcp-directory.types.ts` returns nothing). `capability-toggle.types.ts:30-34`
   imports `CapabilityScope` from `mcp-directory.types.ts` one-way, and imports `CapabilityKind`/
   `CapabilityFingerprintEntry` from `capability-id-codec.ts` one-way (`:26-29`). `capability-id-codec.ts`
   imports only `HarnessHealth` (type) from `harness-sync.types.ts` and `PluginConfigState` (type) from
   `rpc/rpc-misc.types.ts` — neither of which imports back. The dependency graph among the four files is now a
   DAG with no cycle.
3. **Serious — file length trending past the repository's "split before adding more" signal.**
   RESOLVED as a consequence of #1. `capability-toggle.types.ts` (694) and `capability-id-codec.ts` (435) both
   land comfortably under the `harness-sync.types.ts` (620-line) reference, and Batch 2's RPC additions
   (`rpc-capability.types.ts`, a new file) will not compound either file further.
4. **Minor — `user-layer-agents.ts` doc-comment citation overclaims precedent.**
   RESOLVED. `capability-id-codec.ts:13-18` now states its own reason for SHA-256 directly ("pinned to real
   SHA-256 output by the D2 fixed vectors... a weaker hash cannot stand in for it") instead of leaning on the
   `user-layer-agents.ts` analogy; `capability-toggle.types.ts:11-16`'s header now says only that byte-level
   encodings "live beside this file," with no overclaim.
5. **Minor — SHA-256 constants carry no inline spec citation.**
   RESOLVED. `capability-id-codec.ts:351-354` and `:369-372` cite FIPS 180-4 §4.2.2 and §5.3.3 by name for the
   round-constant and initial-hash tables, and the `sha256Hex` doc comment (`:382`) cites §5.1.1 and §6.2.2 for
   padding and computation.
6. **Minor — thinnest badge spec case vs. its siblings.**
   RESOLVED. The `policy-unknown` badge-tone case moved next to its `sources-missing` sibling
   (`harness-health-badge.component.spec.ts:244-252`) and now asserts tone class AND the badge's own text
   content, matching the two-and-three-assertion shape of the surrounding cases in that `describe` block; the
   separate panel-note case at `:479-489` is unchanged and still correct on its own.

### New: is `capability-id-codec.ts` a coherent single concern?

Mostly, with one soft edge. The file's header (`:1-19`) states its own scope precisely — "this file only turns
values into bytes, names and digests" — and three of its four exported groups fit that exactly: the item-file
codec (`encodeCapabilityId`/`decodeCapabilityId`/`canonicalFilename`/`parseCapabilityFilename`), the TOML key
escaper (`tomlKeySegment`), and the fingerprint hasher (`harnessPolicyFingerprint`, plus the UTF-8 and SHA-256
primitives beneath it). `isHarnessPassAcknowledged` (`:218-226`) is the soft edge: it is a boolean predicate
over a `HarnessHealth` and an expected fingerprint string — comparison and business-rule logic ("was this pass
acknowledged"), not an encoding of a value into bytes. It does not turn anything into bytes, names or digests;
it consumes the digest `harnessPolicyFingerprint` produces. Placing it immediately below the function whose
output it compares is a defensible locality call (a reader who asks "how would I check this fingerprint"
finds the answer one function down), and splitting it into a fourth file for one five-line predicate would
trade a real coherence gain for a file too thin to justify its own existence — the task guidance against
"tiny files just to split" cuts against that. This is a Minor, not a Serious, finding: the file name
"capability-id-codec" undersells the TOML and fingerprint content it already carries (it is not just an "id"
codec), so a name such as `capability-policy-codec.ts` would fit its actual contents more precisely, but this
does not block approval — the header's own explanation is honest about what is inside, even where the name is
not perfectly matched. Not required for this batch; worth doing opportunistically if the file is touched again
for an unrelated reason.

### New: is `enforcementRows` nameable and justified?

Yes. `capability-toggle.types.ts:641-694` replaces what was 15 near-identical `CapabilityEnforcementRow`
object literals with a small named helper (`enforcementRows(provider, label, byKind)`) plus two named,
self-documenting constants (`EVERY_KIND_ENFORCED`, `MCP_NOT_ENFORCED`) that read as domain facts, not
mechanism. This is exactly the kind of table-construction helper this codebase already tolerates locally
(compare `USER_SCOPE_TARGETS`/`CLAUDE_DEFINITION_PRECEDENCE` a few hundred lines above it in the same file) —
a private, single-file, single-purpose function, not a generic `utils.ts` export. `ENFORCEMENT_KIND_ORDER`
correctly pins iteration order so the table's row order stays stable and matches the CAPABILITY_ENFORCEMENT
spec's assumptions (`capability-toggle.types.spec.ts` still asserts one row per provider/kind pair and the
specific not-enforced set — both pass). No issue.

### Any new style issue

None found beyond the Minor naming note on `capability-id-codec.ts` above (which was already weighed and does
not block). No new `as any`, no new untyped catches, no new cycles, no regression in the Angular component
pattern, and the check command passes cold (no cache).

### Verdict

- **Recommendation: APPROVE**
- Confidence: HIGH
- All three Serious findings from the first round are resolved with evidence (line counts re-measured, import
  graph re-traced by hand, checks re-run without cache). The one new observation — `capability-id-codec.ts`'s
  name being slightly narrower than its contents — is Minor and does not gate this batch.
