# CI Fix Code Logic Review — `TASK_2026_575_fee7` (SonarCloud reliability fixes)

## Scope

Unstaged changes only (`git diff`, working tree vs. index) in the 11 named files:

- `libs/frontend/i18n/src/lib/i18n-scope.spec.ts`
- `libs/frontend/i18n/src/lib/i18n.service.spec.ts`
- `tools/i18n-check/src/lib/key-resolver.ts`
- `tools/i18n-check/src/lib/scope-map.ts`
- `tools/i18n-check/src/lib/template-keys.spec.ts`
- `tools/i18n-check/src/lib/translation-files.ts`
- `tools/i18n-check/src/lib/literal-offsets.ts`
- `tools/i18n-check/src/lib/rtl-patterns.ts`
- `tools/i18n-check/src/lib/ts-keys.ts`
- `tools/i18n-check/src/main.ts`
- `tools/i18n-check/src/review/review-tables.ts`

`tools/i18n-check/src/lib/report.ts` (defines `compareText`) is staged, not part of this
batch, and was read only as reference, not reviewed for new findings.

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 9/10                           |
| Assessment          | APPROVED                       |
| Blocking issues     | 0                              |
| Serious issues      | 0                              |
| Moderate issues     | 0                              |
| Failure modes found | 0 (none introduced; see below) |

## What changed, verified against intent

**(A) `.sort()` → `.sort(compareText)` / local `byCodeUnit`.** Every sort site touched in
this diff sorts a `string[]` or `Set<string>`, confirmed by tracing each value's static
type:

- `tools/i18n-check/src/lib/key-resolver.ts:95` — `TargetMap.of` sorts a `Set<Target>`
  spread, `Target = 'leaf' | 'object' | 'any'` (string literal union) —
  `tools/i18n-check/src/lib/key-resolver.ts:15`.
- `tools/i18n-check/src/lib/scope-map.ts:32-33` — `Object.keys(SCOPE_MAP)` — always
  `string[]`.
- `tools/i18n-check/src/lib/template-keys.spec.ts:81` — `scan.strings.map(s => s.value)`,
  `ScannedString.value: string` — `tools/i18n-check/src/lib/template-keys.ts:56`.
- `tools/i18n-check/src/lib/translation-files.ts:236,246` — `placeholdersOf`/`tagsOf`,
  both built from regex capture groups (`string`).
- `tools/i18n-check/src/main.ts:141,171,300` — `allowScopes` (`string[]`), the `fast-glob`
  result (`string[]`), and `structural.map(v => v.kind)` where `ViolationKind` is a
  string-literal union (`tools/i18n-check/src/lib/report.ts:9-26`).
- `libs/frontend/i18n/src/lib/i18n-scope.spec.ts:12-15,29` and
  `libs/frontend/i18n/src/lib/i18n.service.spec.ts:17-20` and 4 call sites — all sort
  `Object.keys(...)` or `string[]` arrays of language tags (`'ar'`, `'en'`).

No sorted array in this diff holds numbers or objects, so there is no case where
`compareText`/`byCodeUnit` changes result order or type versus the default
`Array.prototype.sort()` (which itself coerces to string and compares by UTF-16 code
unit — identical semantics to both comparators). `compareText`
(`tools/i18n-check/src/lib/report.ts:99-102`) and the two spec-local `byCodeUnit`
functions are structurally identical (`a === b ? 0 : a < b ? -1 : 1`), so behaviour is
unchanged for every array in scope.

**No import cycle.** `tools/i18n-check/src/lib/report.ts` has zero imports (confirmed:
`grep '^import'` returns nothing), so `scope-map.ts → report.ts` is a one-way edge with
no path back. `key-resolver.ts`, `translation-files.ts`, and `main.ts` also import
`compareText` from the same leaf module — no cycle possible.

**(B) `=== undefined` guards now use `as T | undefined`.** Confirmed at each site that
the assertion only widens a type TypeScript otherwise narrows too optimistically for a
runtime-unsafe access, and every guard immediately following the cast is preserved
unchanged:

- `literal-offsets.ts:63` — `raw[i + 1] as string | undefined`, followed by the existing
  `if (next === undefined) throw ...` — guard intact.
- `rtl-patterns.ts:271` — `RTL_CSS_PROPERTIES[property] as string | undefined`, guard
  `if (logical === undefined) return null;` intact.
- `ts-keys.ts:212` — `offsets[index] as number | undefined`, guard `if (offset ===
undefined) throw ...` intact.
- `ts-keys.ts:373` — `node.parent.parent as ts.Node | undefined`. The TS compiler types
  `Node.parent` as non-optional `Node`, but at runtime a node not yet fully bound (e.g.
  the top of a small in-memory AST in tests, or the outermost declaration) can have
  `parent` unset; the existing `call !== undefined` check depends on this. The cast
  restores the "possibly undefined" type the guard needs without touching the guard's
  logic — this does not silence a real type error, it corrects a false non-null
  inference from the TS AST types.
- `main.ts:96` (`parseArgs`) and `review-tables.ts:98` — `argv[i + 1] as string |
undefined`, both followed by unchanged `undefined`-checks (`main.ts` inline; review
  parser guard at `review-tables.ts:99`).

In every instance the assertion is a narrow, local widening (`T` → `T | undefined`) of an
index access already covered by an existing runtime guard — it cannot hide a genuine type
error because it makes the type _more_ permissive in the direction the guard already
handles, not less. No assertion suppresses an actual mismatch (e.g. no `as string` cast
over a genuinely non-string value was found).

**No other edits slipped in.** `git diff --stat` for the 11 files shows only the lines
attributable to (A) or (B); every hunk in the full diff was read and matches one of the
two categories. No renamed symbols, no logic changes, no new violation kinds, no test
assertion changes beyond replacing `.sort()` with `.sort(byCodeUnit)`.

## Five logic questions

### 1. How does this fail silently?

It doesn't — this is a mechanical linter-satisfying change. No return value, branch, or
error path changed. If a future array with non-string elements is passed into one of the
touched sort call sites, `compareText`/`byCodeUnit` would coerce via `<`/`>` (still no
worse than the bare `.sort()` it replaced, which also compares via string coercion after
Array.prototype.sort's default stringification — actually `compareText` does NOT
stringify non-strings, it compares them directly with `<`, so for numbers it would
happen to sort correctly since `<` on numbers is numeric, whereas the _old_ bare
`.sort()` on numbers would have sorted lexicographically). This is a latent behavioural
difference if a caller ever passes numbers, but no such call site exists in this diff (all
are `string`/string-literal-union arrays, confirmed above), so it is not a live finding —
noted for future callers of `compareText` on non-string data.

### 2. What user action produces unexpected behaviour?

None. These are internal test/tooling files; there is no end-user-facing behaviour change.

### 3. What input data produces a wrong answer?

None found within scope — see the type trace above; no array sorted here can contain
non-string values.

### 4. What happens when a dependency fails?

N/A for this batch — no dependency calls were touched.

### 5. What is missing that the requirements never mentioned?

Nothing material. One observation for future hygiene: `compareText`'s doc comment (in
`report.ts`, out of scope here) doesn't state it's unsafe for non-string arrays; if it
becomes a general-purpose sort helper later, a type constraint (`T extends string`) would
prevent silent misuse. Not a defect in this diff.

## Failure modes

None found. Scope reviewed: all 11 files' unstaged hunks, full surrounding function
context for every touched line, the `compareText` implementation, and the `Target` /
`ScannedString` / `ViolationKind` type definitions feeding the sorted arrays. Residual
uncertainty: none — every sorted array's element type was traced to its declaration.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None within scope. (Minor, non-blocking observation noted above under Q5 about
`compareText`'s generality — informational only, not a finding against this diff.)

## Data flow

1. Test specs (`i18n-scope.spec.ts`, `i18n.service.spec.ts`, `template-keys.spec.ts`) sort
   `string[]` fixtures for `toEqual` comparison — OK, comparator produces identical order
   to default sort for all-ASCII-lowercase language/URL/key strings used in fixtures.
2. `scope-map.ts` computes `KNOWN_SCOPES` once at module load from `Object.keys` — OK,
   no cycle, evaluated after `compareText` import resolves (leaf module, no cycle).
3. `key-resolver.ts` `TargetMap.of` sorts a 1-3 element `Target` set per call at report
   time — OK, low cardinality, no behaviour change.
4. `translation-files.ts` `placeholdersOf`/`tagsOf` sort dedup output before use in parity
   checks — OK, order was already only used for display/equality, not semantics.
5. `main.ts` sorts CLI-derived scope lists, glob results, and violation-kind sets for
   deterministic output/dedup — OK.
6. Guarded index accesses (`literal-offsets.ts`, `rtl-patterns.ts`, `ts-keys.ts`,
   `main.ts`, `review-tables.ts`) — each cast is immediately followed by the pre-existing
   `=== undefined` branch, so control flow and thrown/returned values are byte-for-byte
   identical to before — OK.

## Requirements fulfilment

| Requirement                                         | Status   | Gap                                                    |
| --------------------------------------------------- | -------- | ------------------------------------------------------ |
| (A) `.sort()` → `.sort(compareText)` in tool code   | COMPLETE | none                                                   |
| (A) local `byCodeUnit` comparator in i18n lib specs | COMPLETE | none                                                   |
| (B) S3403 guards via `as T \| undefined` assertions | COMPLETE | none                                                   |
| No behaviour change                                 | COMPLETE | confirmed via type trace + passing test/self-test runs |
| No import cycle                                     | COMPLETE | `report.ts` has zero imports                           |
| No other edits slipped in                           | COMPLETE | diff hunks all attributable to (A)/(B)                 |

Implicit requirements not addressed: none identified.

## Edge cases

| Case                                                                       | Handled | How                                                                 | Concern                                    |
| -------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Empty array passed to a touched sort call                                  | YES     | `.sort()` on `[]` is a no-op either way                             | none                                       |
| Sorted array contains only ASCII strings                                   | YES     | `compareText`/`byCodeUnit` produce same order as default sort       | none                                       |
| Out-of-bounds index access after cast (e.g. `argv[i+1]`, `offsets[index]`) | YES     | existing `=== undefined` guard still runs, throws/returns as before | none                                       |
| Non-string data passed to `compareText` in future code                     | NO      | not applicable to any site in this diff                             | flag for future callers, not a defect here |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none within scope; the only latent risk (`compareText` used on non-string
  data by some future caller) does not exist in the reviewed diff.
- What a robust implementation would add: nothing required for this fix; optionally
  constrain `compareText<T extends string>` if it is ever reused beyond string arrays.

## Verification performed

- `node_modules/.bin/nx run i18n-check:self-test --skip-nx-cache` — PASS (all planted
  violations still reported, fixture tables still up to date).
- `node_modules/.bin/nx run-many -t test -p i18n-check,@ptah-extension/i18n
--skip-nx-cache` — both projects PASS.
- Full `git diff` (working tree, unstaged) read for all 11 files, cross-checked hunk by
  hunk against the stated intent; `git diff --stat` confirms no additional lines beyond
  the (A)/(B) patterns.
