# Code Logic Review - TASK_2026_197

## Review Summary

| Metric              | Value                                             |
| ------------------- | ------------------------------------------------- |
| Overall Score       | 9/10                                              |
| Assessment          | APPROVED                                          |
| Critical Issues     | 0                                                 |
| Serious Issues      | 0                                                 |
| Moderate Issues     | 1                                                 |
| Minor / Nits        | 3                                                 |
| Failure Modes Found | 5 (all already mitigated in the code — see below) |

This is an unusually rigorous implementation. I went in assuming I would find at least one gap in the R3 invariant or the clobber guard, because those are exactly the kind of thing that looks proven on paper and isn't in code. I could not break either one. Findings below are the honest residue after trying.

## Scope note

Reviewed only the files listed in the task fence: the `libs/backend/output-styles` lib in full, the `rpc-output-style.types.ts` shared contract, the `output-style-rpc.{handlers,schema}.ts` + spec, `chat-output-style-activation.service.ts` + spec, `settings-core/src/schema/output-style-schema.ts`, the two `agent-sdk` output-style specs, and the frontend `settings/output-style/**` tree. For edited shared files (`sdk-query-options-builder.ts`, `constants.ts`, `chat-session.service.ts`, `chat/tokens.ts`, `chat/di.ts`, `rpc-handler.ts`, `rpc.types.ts`, `ai-provider.types.ts`, `settings.component.{ts,html}`) I diffed against `git diff` and reviewed only the output-style hunks, per instruction — did not review the concurrent Zod-extraction changes visible elsewhere in those diffs (e.g. `branded.schemas.ts`, `permission.schemas.ts` etc.), which are out of scope and not mine to judge.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The one place I looked hardest for a silent failure was the flag-tier absence guard: does `buildFlagSettings` ever emit `outputStyle: undefined` instead of omitting the key, which `JSON`/wire serialization could later normalize away, but which the SDK's `Options.settings` object (an in-process object, not JSON) would still see as a present key with `undefined` value? I checked `buildFlagSettings` (`sdk-query-options-builder.ts:298-306`): when no style is active it returns `PTAH_DISABLE_SDK_AUTO_MEMORY` **itself**, unmodified — not a spread with `outputStyle: undefined` — so the key is structurally absent, not present-with-undefined-value. `'outputStyle' in settings === false` is asserted directly (`sdk-query-options-builder.output-style.spec.ts:101`). No silent failure found here.

A more mundane fail-silent path exists by design and is documented as such: `ChatOutputStyleActivationService.resolveSessionFields` degrades every failure (settings-store throw, discovery throw, unreadable directory) to "no style" rather than surfacing an error to the user. That's a deliberate, correct choice per the class's own doc comment ("a cosmetic preference must not be able to stop a chat from starting") — I list it here because it's a real behavior a user could be confused by (their style silently stops applying with no visible signal), not because it's a bug.

### 2. What user action causes unexpected behaviour?

Clicking a _shadowed_ row in the list (e.g. a user-tier style shadowed by a same-named project-tier style) still calls `emitSelection(style.name)` with the shadowed entry's name. Since activation is name-keyed, this selects the _winner_ under the SDK merge order, not the row the user clicked — functionally correct (matches SDK behavior) but the row that shows the checkmark afterward is the _other_ row, not the one clicked. This is a UX surprise, not a logic bug: the collision banner explains the ambiguity, but nothing disables the shadowed row's selectability or clarifies in-row that clicking it selects the other entry. Filed as a nit below.

### 3. What data makes this produce wrong results?

I specifically hunted for an input that lands `outputStyleName` and `outputStyleBody` both set (breaking R3) or that gets a name-with-colon (`plugin:style`) written into a settings file. Both are structurally blocked: `resolveActivation` returns a discriminated union where `flag` carries no `body` field and `inject` carries no field the flag branch reads; `assertSingleOutputStylePath` throws defensively if a future regression ever sets both; and the RPC schema's `styleName` refinement rejects any name containing `:` before it reaches the settings writer, with a second (currently unreachable but intentional) guard in `runParity` for the same case. I could not construct an input that breaks either invariant.

### 4. What happens when dependencies fail?

- **Settings-store throw** during activation resolution → degrades to no style (`chat-output-style-activation.service.ts:139-147`), warned, not fatal.
- **Discovery throw** (bad FS) → same degrade.
- **Parity write throw** → caught in `runParity`, returned as a `WRITE_FAILED` outcome; never rethrown, never rolls back the already-persisted selection (`output-style-rpc.handlers.ts:390-410`).
- **Malformed `.claude/settings.json`** → `ClaudeSettingsWriter` aborts before `writeFile` is ever called; asserted directly with `expect(fs.writeFile).not.toHaveBeenCalled()` in `claude-settings.writer.spec.ts:269-270` and `:311-313`.
- **Concurrent external edit of a settings file** between snapshot and write → `SETTINGS_CONFLICT`, no write, backup discarded since it has no insurance value.

All handled, all tested with assertions that would actually fail if the behavior regressed (not just "does not throw").

### 5. What's missing that the requirements didn't mention?

Two things the implementation itself is honest about and that I verified are genuinely unreachable given current scope, not silently dropped:

- **Plugin tier (P5)** is modelled in the type system (`OutputStyleTier` includes `'plugin'`, the resolver and list renderer handle it) but nothing enumerates it — deliberately deferred per `context.md`'s G6 resolution note, and documented as such in the lib's `CLAUDE.md`. Correctly out of scope for this review per the task brief.
- **Invalid file body round-trip** (Req 7.5's "open to fix" case) cannot restore the original body text because discovery only returns parsed styles — documented as a known deviation in the lib's `CLAUDE.md` ("Batch 6 deviation 1"), and the editor UI correctly starts empty with a banner explaining why rather than pretending to show content it doesn't have.

Nothing found beyond what the implementation already discloses.

## R3 Invariant — Verdict: PROVEN, not merely asserted

This is the strongest part of the design. The reasons I consider it actually proven rather than just claimed:

1. **Type-level**: `ActivationDecision` is a 3-member discriminated union (`none` / `flag` / `inject`) where `flag` has no `body` field and `inject`'s `body` is required — TypeScript itself prevents a consumer from reading both off one decision object. There is no way to construct a decision object at the type level that carries both.
2. **Single computation site**: `resolveActivation` (`output-style-activation.resolver.ts`) is the only function that produces a decision; `ChatOutputStyleActivationService.toSessionFields` is an exhaustive switch over it (TypeScript would flag a missing case at compile time if a 4th member were ever added) and maps to at most one of `outputStyleName`/`outputStyleBody`.
3. **Structural test coverage**: the 8-row truth table in `output-style-activation.resolver.spec.ts` covers every tier × localhost combination and asserts, per row, that the branch taken has no stray field from the other branch (`'body' in decision === false` on the flag branch).
4. **Defense in depth at the SDK-facing boundary**: `assertSingleOutputStylePath` in `sdk-query-options-builder.ts` throws loudly if both fields were ever set on the same `AISessionConfig`, and this is itself exercised by both a direct unit test and by `buildFlagSettings` calling it internally — so even a future regression that broke invariant #1 or #2 would fail loud at session start rather than silently double-applying a style.
5. **Drift guards**: two separate specs read the _source text_ of `sdk-query-options-builder.ts` (not just its exported behavior) to assert `LOCALHOST_BASE_URL_RE` in the resolver and the builder's `settingSources` predicate stay byte-identical, and that `build()` actually calls `buildFlagSettings` rather than reverting to the bare constant. This closes the gap between "the helper is correct" and "the helper is actually wired in" that a unit test of the helper alone cannot see.

I tried to find an input where both a flag key and an injected body reach one session — shadowed style, missing file, empty body, absent base URL, built-in, project style on localhost — and could not construct one. The empty-body case is explicitly handled (`inject` with a blank body collapses to `NO_OUTPUT_STYLE`, not to a stray blank append). The "both set" case is unreachable by construction and additionally guarded at runtime.

## Clobber-guard Invariant — Verdict: PROVEN

Claim: the `outputStyle` key must be structurally absent when Ptah has no selection, not `undefined`, not `'default'`.

Verified: `buildFlagSettings` returns the _same object reference_ as `PTAH_DISABLE_SDK_AUTO_MEMORY` when no style is active (not a spread with an explicit `undefined`), so `'outputStyle' in settings` is `false` by construction — this is asserted directly and covers `undefined` sessionConfig, missing `outputStyleName`, explicitly-`undefined` name, empty string, and whitespace-only name, all five collapsing to "no key" (`sdk-query-options-builder.output-style.spec.ts:86-107`). The literal `'default'` value is normalized to `null` (no selection) at three independent points that all agree: `OutputStyleRpcHandlers.normalizeSelection`, `ChatOutputStyleActivationService`'s `CLEARING_STYLE_NAME` constant, and `ClaudeSettingsWriter`'s clear-branch (`styleName === null || styleName === DEFAULT_OUTPUT_STYLE_NAME`) — all three import or duplicate the same sentinel value consistently. I could not find a code path that would emit `outputStyle: 'default'` or `outputStyle: undefined` onto the wire.

## Shared-constant mutation (`PTAH_DISABLE_SDK_AUTO_MEMORY`)

`Object.freeze()`d at the definition site (`constants.ts`), so any accidental mutation attempt would throw in strict mode rather than silently succeed — this is stronger than "we promise not to mutate it." `buildFlagSettings` only ever spreads it into a fresh object when a style is active; the frozen original is returned unchanged otherwise. Verified with a snapshot-equality test plus `Object.keys(...).length === 2` plus an explicit "two builds with different styles don't contaminate each other" test. No issue found.

## Parity independence (§4.1)

Verified structurally, not just by convention: `OutputStyleRpcHandlers.registerActivate` calls `applySelection` (which persists the choice and can fail/reject) inside its own `try`, and only calls `runParity` **after** that has already succeeded and returned, **outside** any `try` whose `catch` could reject the whole RPC. `runParity` itself never rethrows — every internal throw is caught and converted to a `WRITE_FAILED` outcome object. On the frontend, `OutputStyleStore.activate`'s rollback branch reads only `result.data.success` and never inspects `result.data.parity`. I traced this on both sides and could not find a path where a parity failure touches the selection.

## Merge-preserving write / abort-before-write

Verified: `ClaudeSettingsWriter.setOutputStyle` parses before touching `writeFile` at all, and on any parse failure (malformed JSON, non-object root, array root, string root, null root, numeric root) returns `SETTINGS_MALFORMED` without ever calling `fs.writeFile` — this is the actual load-bearing assertion in the spec (`expect(fs.writeFile).not.toHaveBeenCalled()`), not just a returned error code. The merge is a plain object spread preserving key order for all pre-existing keys, tested directly (`Object.keys(after)` ordering assertion). Backup-then-delete lifecycle and pre-write re-read conflict detection are both present and tested, including the honest disclosure that this narrows rather than closes the TOCTOU window (no `rename` available on `IFileSystemProvider`).

## Vacuous-test hunt

The task flagged that two vacuously-passing tests were already found and fixed mid-build (a helper defaulting `undefined` back to a real value, silently passing a "no workspace" case for the wrong reason). I looked specifically for the same class of bug elsewhere and found the fix pattern already applied defensively in two more places, with the reasoning spelled out in comments:

- `OutputStyleDiscoveryService.spec.ts`'s `makeService` uses `root: string | null` (not `string | undefined`) specifically because a defaulted parameter re-applies its default on `undefined`, which would make a "no workspace" test silently get the workspace anyway. The "no workspace" case is additionally seeded with a real file that _would_ be discovered if the bug were present, so the test can actually fail (`output-style-discovery.service.spec.ts:105-116`).
- `ClaudeSettingsWriter.spec.ts`'s `makeWriter` uses the identical `string | null` pattern for the same reason (`claude-settings.writer.spec.ts:88-105`).

I did not find a third instance of this bug pattern in the files reviewed. Other places I checked for "test that cannot fail": the R3 truth table asserts both which branch was taken _and_ the absence of the other branch's field (not just presence of the expected field, which is the weaker and more common vacuous form); the "exactly once" system-prompt specs count occurrences via `split().length - 1` rather than `toContain`, which is exactly the right defense against a duplicate-append regression that `toContain` would miss.

## Must-Fix

None found.

## Should-Fix

None found. Everything in this batch that I could construct a failure scenario for was already handled and tested.

## Moderate

### M1: Shadowed-row click selects a different entry than the one clicked, with no in-row indication

- **File**: `libs/frontend/chat/src/lib/settings/output-style/output-style-list.component.ts:257` (`emitSelection(selectionValue(style))` on a row that may be `shadowed`)
- **Scenario**: A user has a user-tier style and a project-tier style both named "Learning" (or shadowing a built-in). Both rows render. Clicking the _shadowed_ (losing) row emits `activate({ name: 'Learning' })`, which correctly resolves server-side to the _winning_ entry under SDK merge order — so the behavior is correct, but the checkmark that appears afterward lands on the _other_ row from the one clicked. `isActive()` correctly returns `false` for the shadowed row even immediately after clicking it.
- **Impact**: Low-severity UX confusion, not a data-safety or activation-correctness issue — the collision banner does explain the ambiguity in general terms. A user could reasonably wonder why clicking a row didn't "check" that row.
- **Fix**: Either disable the button on shadowed rows (they can't independently be selected anyway) with a tooltip pointing at the winning row, or keep it clickable but visually confirm which row lit up after the click. Not required for approval; the underlying activation is correct.

## Nits

### N1: `resolveActive`'s `missing` reporting glosses over a specific edge case in `E5`

`OutputStyleDiscoveryService.resolveActive` reports `missing: true` whenever the active name isn't in the winners map — this correctly also catches the case where the previously-active style still has a file on disk but that file is now _invalid_ (e.g. someone hand-broke its frontmatter). The UI copy for the "missing" banner says "Its file was removed outside Ptah," which is inaccurate for the invalid-but-present case — the file exists, it just doesn't parse anymore. Cosmetic wording issue only; the invalid file is still separately listed and openable-to-fix elsewhere in the UI. Not required for approval.

### N2: `output-style-slug.ts`'s Unicode combining-mark strip only covers one Unicode block

`stripCombiningMarks` only strips U+0300–U+036F (Combining Diacritical Marks), which is the residue NFKD normalization leaves behind for the overwhelming majority of Latin-script accented input — correct for the stated purpose. Some rarer scripts have combining marks outside that block (e.g. Combining Diacritical Marks Extended, Supplement) that would fold to `-` instead of being cleanly dropped, producing an uglier but still-safe slug (extra hyphens, never a security issue since the security-relevant checks run pre-normalization on raw input). Not a correctness bug against the stated requirements; flagged only because the code's own comment implies broader Unicode coverage than it delivers.

### N3: `sanitizeDiagnostic`/`sanitizeDetail` path-stripping regexes are duplicated verbatim in two files

`output-style-frontmatter.ts` and `claude-settings.writer.ts` each define their own near-identical `sanitize*` function with the same three regex patterns for stripping host paths out of foreign error text. Not a bug — both are independently tested and both work — but it's the kind of duplication that could drift silently if one gets a fix the other doesn't (e.g. a new path pattern found later). Consider extracting to a shared helper in a future pass; not blocking.

## Requirements Fulfilment (spot-checked against the batch's own trace table)

All Requirement/Edge/Risk rows I spot-checked against actual code (R2, R3/Req5.3, R4/schema pin, R5/keep-coding-instructions default+copy, E1 name-vs-filename, E2 tier default, E3 localhost narrowing, E4 collision, E5 missing-active, E7 no force-for-plugin control, E8 mtime+byteLength guard) are implemented as the plan's §17 rev-2 gap closure claims, with test coverage that would catch a regression. I did not find evidence contradicting any of the "Known and Accepted" exclusions listed in the task brief (P5 deferral, Req 7.5 body round-trip gap, `keyTier`/`keyPath`/`inert` removal, the pre-existing `ANTHROPIC_AUTH_TOKEN=""` agent-sdk failure).

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top residual risk**: M1 (shadowed-row click UX) — cosmetic, not a correctness or safety issue. No must-fix or should-fix items were found after genuinely adversarial attempts to break the R3 invariant, the clobber guard, the shared-constant mutation guard, and the parity-independence guarantee — all four are proven by construction (type system + single-computation-site + exhaustive switch) and additionally covered by tests that assert the _absence_ of the wrong branch's fields, not merely the presence of the right ones, plus source-level drift guards tying the duplicated `agent-sdk` predicate to its origin.

## What Would Make This Even More Bulletproof

Nothing required for production readiness, but if this surface grows further: (1) a true compare-and-swap for `ClaudeSettingsWriter` if `IFileSystemProvider` ever grows a `rename` primitive — the current backup-based narrowing is honestly disclosed as non-closing; (2) resolving M1 by disabling shadowed rows; (3) consolidating the two duplicated diagnostic-sanitizer functions (N3) before a third copy appears somewhere else in this lib.
