# Batch 3 report — `tools/degradation-audit` and its CI wiring

`TASK_2026_383`, working tree `D:/projects/ptah-extension/.claude-worktrees/task-383`,
branch `task/383-degradation-audit`. Not committed — team-leader commits after review.

## Revision 2 — response to "Batch 3 — Revision 1 re-review"

Revision 1 was NEEDS_REVISION again: `code-logic-review.md`'s "Batch 3 —
Revision 1 re-review" section (from line 622) scored 7/10 — 1 new blocking
(B-1), 1 new serious (S-3), 0 carried issues (both moderates and both
serious-1 items from the first round confirmed fixed by independent
re-verification). `eslint.config.mjs` and `.github/workflows/ci.yml` are
untouched again this pass (`git diff --stat` unchanged: 9 / 19 lines).

### B-1 (blocking): suppression placement contract too narrow — Batch 2's real sites silently unclassified

The review reproduced this live against `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts:156-171`
(Batch 2's actual code, not a synthetic fixture) and found BOTH of its
suppression comments invisible to the tool, with no `bare-suppression`
signal either, because the single line the old `checkSuppression` inspected
was never the marker line:

- Site 1 (`:156-159`): the marker is the FIRST line of a two-line wrapped
  comment above the flagged `.catch(...)` call; the tool only checked the
  line immediately adjacent (the second, continuation line).
- Site 2 (`:168-172`): the marker is the first line INSIDE a bare `catch {}`
  block, not above the `catch` keyword at all.

**Fix (per the orchestrator's explicit ruling — the tool widens its contract,
Batch 2's call sites are unchanged and not re-litigated):** `checkSuppression`
was replaced with a zone-based `resolveSuppression` that searches, in order:

1. **Zone 1** — the full contiguous run of `//` comment lines directly above
   the construct's own start line (any line of the run, not just the nearest
   one — `commentBlockAbove`, handles the wrapped-comment case).
2. **Zone 2** — the leading comment lines inside the construct's own body:
   right after `catch (...) {` / `catch {` opens (`commentBlockBelow` from
   the open-brace line), or right after a `.catch(fn)` handler's block body
   opens.
3. **Zone 3** (`.catch(...)` calls only) — the contiguous comment run above
   the STATEMENT containing the call (`nearestStatement`, walking up via
   `ts.isStatement`), for the case where the call's own leftmost token sits
   on a different line than the statement (e.g. a keyword-then-newline
   layout) — skipped when it would just duplicate Zone 1.

Every zone scan for every `CatchClause` and `.catch(...)` call now runs
regardless of whether that site is currently a violation, so a marker near a
non-violating site is still consumed (not orphaned) and a malformed marker
there is still flagged.

Fixtures added, one per zone: `__fixtures__/suppression-zone1-wrapped.ts`
(two-line wrapped comment above `catch`), `__fixtures__/suppression-zone2-inside-catch.ts`
(marker as first line inside a bare `catch {}`, mirrors site 2 exactly),
`__fixtures__/suppression-zone3-above-statement.ts` (`void` on its own line,
call on the next — marker above the statement, not above the call).

### S-3 (serious): "never silently drops" only holds if the marker is ever looked at — orphaned markers must not be silent either

Cited from the review's own framing: "Both are direct instances of the exact
defect class S-1 was supposed to close ... except here the marker line isn't
even _reached_, so the 'always surfaced as bare-suppression' guarantee never
engages" (`code-logic-review.md:767-770`). Widening the three zones (B-1)
closes the two reproduced cases, but a marker written somewhere NONE of the
three zones cover — e.g. left behind after a refactor deleted the catch it
annotated — would still be silently invisible with the old design, which
only ever inspected lines relative to an already-identified flagged node and
had no accounting for markers that attach to nothing.

**Fix**: `detectInFile` now pre-scans every physical line in the file for a
`degradation-audit:`-shaped marker (`allMarkerLines`) before the AST walk,
and every zone scan that finds a marker adds that line to a shared
`consumedMarkerLines` set. After the walk, any line in `allMarkerLines` not
in `consumedMarkerLines` is reported as a new violation kind,
`orphaned-suppression`, naming the line and quoting the comment. Fixture:
`__fixtures__/suppression-orphaned.ts` — a well-formed marker above a plain
function with no catch/`.catch()` nearby, correctly reported as orphaned.

### Acceptance check: `cli-master-key-provider.ts` (Batch 2's real site, not edited)

```
$ npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 \
    | grep -i "cli-master-key-provider"
(no output — grep exit code 1, zero matches)
```

Zero lines reference the file at all — not as `catch-return-sentinel`, not as
`promise-catch-sentinel`, not as `bare-suppression`, not as
`orphaned-suppression`. Both of Batch 2's suppression comments (`:156-159`
wrapped-above-`.catch()`, `:168-172` inside-bare-`catch{}`) are now correctly
recognised and suppress their sites, with zero orphans. This batch did not
edit that file: `git status --porcelain
libs/backend/platform-cli/src/settings/cli-master-key-provider.ts` shows it
`M` (modified) because it carries Batch 2's own pre-existing uncommitted work
in this shared worktree — the same content read at `:156-171` above — not
because anything in this revision touched it.

### Verification (Revision 2)

R-5 mutation check re-run: `detectInFile` patched to `return []`
unconditionally → `node run-self-test.js` exit 1 (`self-test BROKEN`,
`unexpected exit code 2`) → restored → exit 0, both checks PASS.

```
$ node tools/degradation-audit/run-self-test.js
degradation-audit self-test: 12 violation(s) detected in fixtures (expected)
  .../bare-suppression.ts:7 [bare-suppression] ...
  .../bare-suppression.ts:8 [catch-return-sentinel] ...
  .../catch-identifier-handler.ts:10 [promise-catch-sentinel] .catch(noop) ...
  .../catch-identifier-handler.ts:17 [promise-catch-sentinel] .catch(externalNoop) ...
  .../catch-return-sentinel.ts:7 [catch-return-sentinel] ...
  .../empty-catch.ts:6 [empty-catch] ...
  .../nested-catch-masking.ts:11 [catch-return-sentinel] ...
  .../promise-catch-sentinel.ts:4 [promise-catch-sentinel] ...
  .../promise-catch-sentinel.ts:8 [promise-catch-sentinel] ...
  .../suppression-malformed.ts:10 [bare-suppression] ...
  .../suppression-malformed.ts:11 [catch-return-sentinel] ...
  .../suppression-orphaned.ts:7 [orphaned-suppression] degradation-audit marker did not attach to any flagged catch/.catch() site: "..."
degradation-audit self-test PASS: fixture violations detected, exit code 1 as expected
degradation-audit parse-guard PASS: malformed fixture correctly raised a parse failure (...)
degradation-audit parse-guard self-test PASS: malformed fixture correctly raised a parse failure
EXIT=0
```

Note `suppression-separators.ts` (3 sites), `suppression-zone1-wrapped.ts`,
`suppression-zone2-inside-catch.ts`, and `suppression-zone3-above-statement.ts`
all produce ZERO rows above — all four correctly suppressed, proving every
placement zone works.

```
$ npx nx run degradation-audit:lint --skip-nx-cache
NX   Successfully ran target lint for project degradation-audit
EXIT=0

$ npx nx run degradation-audit:self-test
NX   Successfully ran target self-test for project degradation-audit
EXIT=0

$ npx nx run di-lint:lint --skip-nx-cache
di-lint OK: 1446 @inject sites all resolve to a registered token (660 tokens)
NX   Successfully ran target lint for project di-lint
EXIT=0
```

`npx nx reset` was NOT run, per the coordinator's explicit instruction (Batch
2 executing in this worktree).

### Baseline totals — old vs new, per detector

Both are live snapshots of a worktree other batches are concurrently
editing. The one delta directly attributable to this revision:
`libs/backend/platform-cli` dropped from 5 to 3 — the exact 2-site effect of
correctly suppressing `cli-master-key-provider.ts:156-159` and `:168-172` for
the first time. `orphaned-suppression` is a new kind, 0 in the live repo
(no stray markers exist there today; only the planted fixture exercises it).

| Detector                 | Old total (Revision 1) | New total (Revision 2) |
| ------------------------ | ---------------------- | ---------------------- |
| `catch-return-sentinel`  | 502                    | 501                    |
| `promise-catch-sentinel` | 61                     | 60                     |
| `floating-promise`       | 3                      | 3                      |
| `empty-catch`            | 0                      | 0                      |
| `bare-suppression`       | 0                      | 0                      |
| `orphaned-suppression`   | (kind did not exist)   | 0                      |
| **TOTAL**                | **566**                | **564**                |

`baseline.json` regenerated from a clean slate (`--update-baseline` against
an empty `{}`), same rationale as both prior revisions: the live repo state
moves between runs in this shared worktree. 57 directories, 564 sites.

---

## Revision 1 — response to review rejection

Original submission was REJECTED: `code-logic-review.md` (Batch 3 section)
scored 6/10 NEEDS_REVISION (2 serious, 3 moderate, 4 failure modes);
`code-style-review.md` scored 8/10 APPROVED with 1 serious. All findings below
are fixed in `tools/degradation-audit/check-degradation.ts` and
`run-self-test.js`. `eslint.config.mjs` and `.github/workflows/ci.yml` are
untouched in this revision (diff unchanged from the original submission,
confirmed with `git diff --stat`).

| Finding                                                                                                                                                  | Severity                       | Source       | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suppression regex requires a literal em dash; ASCII hyphen (or en dash) silently falls through as an unlabelled violation, no `bare-suppression` signal  | Serious S-1                    | logic review | `SUPPRESSION_BODY_RE` now accepts `-`, `–`, or `—` as the separator. More importantly, `checkSuppression` was restructured around a two-stage match: `SUPPRESSION_MARKER_RE` detects "is this a `degradation-audit:` comment at all", then `SUPPRESSION_BODY_RE` validates it. ANY marker-shaped comment that doesn't fully parse — wrong kind, no reason, or (previously) a non-em-dash separator — is now unconditionally reported as `bare-suppression`, never silently dropped. Fixtures: `__fixtures__/suppression-separators.ts` (all three separators, each correctly suppresses), `__fixtures__/suppression-malformed.ts` (unrecognised kind name, correctly reported as `bare-suppression` AND the underlying site stays counted). |
| A nested `try`/`catch`'s `.error(...)` call satisfies the OUTER catch's `hasErrorCall` check, masking a genuine outer swallow                            | Serious S-2                    | logic review | `scopedFind` now also stops at a nested `CatchClause` (in addition to a function boundary), so `hasThrow`, `hasErrorCall`, and `findLiteralReturn` are all scoped to the catch's OWN block depth and can no longer be satisfied by an unrelated nested catch's handling. Fixture: `__fixtures__/nested-catch-masking.ts` — outer catch returns `null` after a nested try/catch logs an unrelated cleanup failure; now correctly produces one `catch-return-sentinel` (previously zero).                                                                                                                                                                                                                                                     |
| `.catch(noop)` / any named-reference `.catch()` handler is invisible — a straightforward ratchet-evasion path                                            | Moderate (also a failure mode) | logic review | New `resolveCatchHandlerIdentifier`: resolves the identifier to a same-file function/arrow declaration via `findNamedFunctionLike`. If resolved and it calls `.error(...)` or throws (`functionHandlesError`), it's treated as properly handled and NOT flagged. If resolved but it does neither, OR if it cannot be resolved at all (imported, external, `this.` member) — flagged as `promise-catch-sentinel`, per the review's explicit "flag any `.catch(identifier)` unless it demonstrably handles the error" floor. Fixture: `__fixtures__/catch-identifier-handler.ts` — `noop` (same-file no-op, flagged), `externalNoop` (unresolved import, flagged), `realHandler` (same-file, calls `logger.error`, correctly NOT flagged).    |
| `floating-promise`'s name-based matching doesn't consider the receiver — a same-named sync/async pair in one file would misfire                          | Moderate                       | logic review | `collectAsyncNames` now tracks async and non-async declarations separately per name and returns only names that are async in EVERY same-file declaration found for them — a name colliding between an async and a non-async declaration is excluded rather than flagged. No new fixture (the review found no live collision to reproduce; this is a structural hardening against the described latent gap).                                                                                                                                                                                                                                                                                                                                 |
| Stale `baseline.json` entries for deleted/renamed directories report `0 ok (baseline N)` forever with nothing prompting cleanup                          | Moderate                       | logic review | `runLint` now detects `isStale = !counts.has(dir) && base > 0` and appends `— directory not found by this scan; run --update-baseline to prune` to that directory's output line. `--update-baseline` was also changed to actually `delete` the stale key (previously it only zeroed the value, which left the JSON key behind forever).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `sourceFile.parseDiagnostics` is an undeclared internal TypeScript field reached via an intersection cast, with no fixture proving the guard still fires | Serious (style review)         | style review | Took the cheaper of the two offered fixes (explicitly endorsed by the review as sufficient before this batch closes): kept the field, added a dedicated `--self-test-parse-guard` mode (`runParseGuardTest`) that runs `detectInFile` directly against a new deliberately-malformed fixture (`__fixtures__/__parse-failure__/malformed.ts`, excluded from the normal `--self-test` glob so it doesn't crash that pass) and asserts the guard still throws. `run-self-test.js` now runs both checks; a future TypeScript upgrade that silently drops the field fails `self-test` immediately instead of a malformed file in production scoring zero violations.                                                                              |

**Not changed / explicitly out of scope for this revision:**

- Style-review minor issues (uncommented `SCAN_IGNORE` divergence from di-lint's superset, `project.json`'s `baseline.json` cache-input divergence, `run-self-test.js`'s generic exit-code message) — these are minors and the coordinator's fix list scoped this pass to serious + moderate.
- No fixture was added proving `floating-promise` itself can be suppressed or exercising its cross-module false-negative boundary — the logic review lists this under "what is missing that requirements never mentioned," not as a serious/moderate finding, and it remains an accurate, documented limitation in the file header.

### Verification (Revision 1)

R-5 mutation check re-run: `detectInFile` patched to `return []` unconditionally
→ `node run-self-test.js` exit 1 (`self-test BROKEN: no violations detected`,
`unexpected exit code 2`) → restored → exit 0, both checks PASS.

```
$ node tools/degradation-audit/run-self-test.js
degradation-audit self-test: 11 violation(s) detected in fixtures (expected)
  .../bare-suppression.ts:7 [bare-suppression] ...
  .../bare-suppression.ts:8 [catch-return-sentinel] ...
  .../catch-identifier-handler.ts:10 [promise-catch-sentinel] .catch(noop) does not resolve to a handler that logs or rethrows
  .../catch-identifier-handler.ts:17 [promise-catch-sentinel] .catch(externalNoop) — identifier not declared in this file; flagged for triage, could not verify it logs or rethrows
  .../catch-return-sentinel.ts:7 [catch-return-sentinel] ...
  .../empty-catch.ts:6 [empty-catch] ...
  .../nested-catch-masking.ts:11 [catch-return-sentinel] catch swallows error and returns a literal
  .../promise-catch-sentinel.ts:4 [promise-catch-sentinel] ...
  .../promise-catch-sentinel.ts:8 [promise-catch-sentinel] ...
  .../suppression-malformed.ts:10 [bare-suppression] degradation-audit suppression comment does not match a known form: "// degradation-audit: not-a-real-kind — this kind does not exist"
  .../suppression-malformed.ts:11 [catch-return-sentinel] ...
degradation-audit self-test PASS: fixture violations detected, exit code 1 as expected
degradation-audit parse-guard PASS: malformed fixture correctly raised a parse failure (parse failure in .../malformed.ts: ':' expected.)
degradation-audit parse-guard self-test PASS: malformed fixture correctly raised a parse failure
EXIT=0
```

Note `suppression-separators.ts` (hyphen/en dash/em dash, all three sites)
produces NO rows above — correctly suppressed, proving S-1's fix.

```
$ npx nx run degradation-audit:lint --skip-nx-cache
NX   Successfully ran target lint for project degradation-audit
EXIT=0

$ npx nx run di-lint:lint --skip-nx-cache
di-lint OK: 1446 @inject sites all resolve to a registered token (660 tokens)
NX   Successfully ran target lint for project di-lint
EXIT=0
```

`npx nx reset` was NOT run (Batch 2 is executing in this worktree per the
coordinator's instruction); `nx run degradation-audit:lint`/`self-test`
picked up the revised `check-degradation.ts` without it, same as observed in
the original submission.

### Baseline totals — old vs new, per detector

Both measurements are live snapshots of a worktree three other batches are
concurrently editing, so some of the delta is repo churn, not this revision.
The detector-logic deltas that ARE attributable to this revision:
`promise-catch-sentinel` +3 to +4 (new `.catch(identifier)` detection finding
real same-shape sites in the tree) and a net-neutral-to-positive shift in
`catch-return-sentinel` from the nested-catch fix (some directories gained a
previously-masked site; repo churn removed others in the same window).

| Detector                 | Old total (original submission) | New total (Revision 1) |
| ------------------------ | ------------------------------- | ---------------------- |
| `catch-return-sentinel`  | 503                             | 502                    |
| `promise-catch-sentinel` | 58                              | 61                     |
| `floating-promise`       | 3                               | 3                      |
| `empty-catch`            | 0                               | 0                      |
| `bare-suppression`       | 0                               | 0                      |
| **TOTAL**                | **564**                         | **566**                |

`baseline.json` regenerated from a clean slate (`--update-baseline` against an
empty `{}`) rather than patched over the stale baseline, for the same reason
as the original submission: the live repo state moved between runs (other
batches editing `libs/backend/auth-providers`, `libs/backend/rpc-handlers`,
`libs/frontend/setup-wizard`, etc., in this shared worktree), and patching a
stale baseline in place would have mixed this revision's real detector deltas
with unrelated concurrent-batch drift. 57 directories, 566 sites.

---

## Files

CREATED

- `tools/degradation-audit/check-degradation.ts` — the detector (564 lines)
- `tools/degradation-audit/project.json` — `lint` (cached) + `self-test` Nx targets, modelled verbatim on `tools/di-lint/project.json`
- `tools/degradation-audit/tsconfig.json` — standalone CJS tsconfig (di-lint needs the same one; see Deviation 1)
- `tools/degradation-audit/run-self-test.js` — spawns `--self-test`, passes only on exit 1 (modelled on `tools/di-lint/run-self-test.js:1-27`)
- `tools/degradation-audit/baseline.json` — per-directory ratchet, 57 directories, 564 sites total
- `tools/degradation-audit/__fixtures__/catch-return-sentinel.ts`
- `tools/degradation-audit/__fixtures__/promise-catch-sentinel.ts`
- `tools/degradation-audit/__fixtures__/empty-catch.ts`
- `tools/degradation-audit/__fixtures__/suppressed-optional-capability.ts`
- `tools/degradation-audit/__fixtures__/bare-suppression.ts`

MODIFIED

- `.github/workflows/ci.yml` — added a `degradation-audit (swallowed-failure ratchet + self-test)` step beside `di-lint`'s (`:105-120` region), same two-line shape (`self-test` then `lint`)
- `eslint.config.mjs` — added `'no-empty': ['error', { allowEmptyCatch: false }]` to the existing `**/*.ts` rules block (`:291` area). The type-aware `no-floating-promises` block was NOT added — see Deviation 2. No `no-restricted-syntax` entry touched (verified: `:303` and `:369` both still carry `MESSAGE_LITERAL_SELECTORS`, byte-identical to `main`).

## Detector rules

| #   | Kind                     | AST shape                                                                                                                                                                                                                                                                                                                                                                                                                                    | Suppression-eligible |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | `catch-return-sentinel`  | `CatchClause` whose block (not crossing a nested function boundary) has no `throw`, no `.error(...)` member call, and contains a `return` of `null`/`true`/`false`/`undefined`/bare `return;`/`''`/`[]`/`{}`                                                                                                                                                                                                                                 | yes                  |
| 2   | `promise-catch-sentinel` | `.catch(fn)` where `fn`'s body is empty or returns one of the same literals                                                                                                                                                                                                                                                                                                                                                                  | yes                  |
| 3   | `empty-catch`            | `CatchClause` block with zero statements AND no comment between the braces (comment-only blocks are NOT flagged — matches ESLint's own `no-empty` semantics; see Deviation 3)                                                                                                                                                                                                                                                                | yes                  |
| 4   | `floating-promise`       | Fallback for the type-aware `no-floating-promises` block the plan authorized narrowing to (see Deviation 2). Bare `ExpressionStatement` call (not `await`ed, not `void`-marked, not `.catch`/`.then`/`.finally`-chained) whose callee name matches an `async` function/method/arrow **declared in the same file**. Scoped to `apps/ptah-electron/src/**`, `libs/backend/thoth-runtime/src/**`, `libs/backend/persistence-sqlite/src/**` only | yes                  |
| —   | `bare-suppression`       | A `// degradation-audit: <kind>` marker with no ` — <reason>` after it. Does NOT suppress the underlying site; is itself counted                                                                                                                                                                                                                                                                                                             | n/a                  |

Suppression syntax (as specified): `// degradation-audit: optional-capability — <why>` or
`// degradation-audit: reported — <CODE>` on the line immediately above the flagged node
(the `catch` keyword's line, the `.catch(` call's line, or the bare-call statement's line).

## Exclusions

`**/*.spec.ts`, `**/*.test.ts`, `**/node_modules/**`, `**/dist/**`, `apps/*-e2e/**`,
`libs/frontend/webview-e2e-harness/**` — exactly the batches.md list.

## Baseline (per directory, 57 dirs, 564 total)

By kind: `catch-return-sentinel` 503, `promise-catch-sentinel` 58, `floating-promise` 3,
`empty-catch` 0, `bare-suppression` 0.

```json
{
  "apps/ptah-cli": 29,
  "apps/ptah-electron": 29,
  "apps/ptah-extension-vscode": 10,
  "apps/ptah-tui": 1,
  "libs/api/admin": 1,
  "libs/api/community": 5,
  "libs/api/identity": 1,
  "libs/api/licensing": 2,
  "libs/api/marketing": 2,
  "libs/api/member-hub": 3,
  "libs/api/membership": 1,
  "libs/api/youtube": 2,
  "libs/backend/agent-generation": 31,
  "libs/backend/agent-sdk": 33,
  "libs/backend/auth-providers": 22,
  "libs/backend/cli-agent-runtime": 30,
  "libs/backend/cli-engine": 12,
  "libs/backend/cron-scheduler": 2,
  "libs/backend/gateway-chat-bridge": 4,
  "libs/backend/harness-sync": 29,
  "libs/backend/memory-curator": 20,
  "libs/backend/messaging-gateway": 6,
  "libs/backend/output-styles": 8,
  "libs/backend/persistence-sqlite": 6,
  "libs/backend/platform-cli": 5,
  "libs/backend/platform-core": 7,
  "libs/backend/platform-electron": 4,
  "libs/backend/platform-vscode": 1,
  "libs/backend/plugin-marketplace": 2,
  "libs/backend/rpc-handlers": 39,
  "libs/backend/settings-core": 5,
  "libs/backend/skill-synthesis": 40,
  "libs/backend/task-specs": 12,
  "libs/backend/voice-providers": 3,
  "libs/backend/vscode-core": 17,
  "libs/backend/vscode-lm-tools": 16,
  "libs/backend/workspace-intelligence": 14,
  "libs/frontend/chat": 12,
  "libs/frontend/chat-state": 2,
  "libs/frontend/chat-streaming": 2,
  "libs/frontend/chat-ui": 14,
  "libs/frontend/core": 3,
  "libs/frontend/cron-scheduler-ui": 6,
  "libs/frontend/editor": 2,
  "libs/frontend/harness-builder": 3,
  "libs/frontend/marketplace": 32,
  "libs/frontend/memory-curator-ui": 15,
  "libs/frontend/setup-wizard": 1,
  "libs/frontend/skill-synthesis-ui": 5,
  "libs/frontend/tasks-ui": 3,
  "libs/frontend/tribunal-panel": 1,
  "libs/frontend/ui": 1,
  "libs/frontend/workspace-indexing": 1,
  "libs/shared/src": 2,
  "libs/web/admin": 1,
  "libs/web/auth": 1,
  "libs/web/core": 3
}
```

**Caveat**: this worktree runs Batch 1 in parallel on `libs/shared` and
`libs/backend/vscode-core`. The baseline above is a live snapshot as of this
report; the team-leader should regenerate it (`--update-baseline`) once every
batch has landed, since concurrent edits already moved several counts between
runs during this session (e.g. `libs/backend/skill-synthesis` 48 → 40,
`apps/ptah-tui` 9 → 1). Nothing in this batch's own scope caused those moves.

## Mutation check (R-5)

1. Edited `detectInFile` to `return []` unconditionally (detector fully disabled).
2. Ran `node tools/degradation-audit/run-self-test.js` directly (bypassing Nx cache):
   exit code 1, output:
   ```
   degradation-audit self-test BROKEN: no violations detected in the planted fixtures (detector false-negative)
   degradation-audit self-test FAIL: unexpected exit code 2
   ```
3. Restored the original line, reran: exit code 0, `degradation-audit self-test PASS: fixture violations detected, exit code 1 as expected`.

Also ran the ratchet's own regression path (not part of self-test, run manually):
planted a `catch-return-sentinel` in a scratch file under
`libs/frontend/setup-wizard/src/lib/`, ran `degradation-audit:lint` — directory
went `2 FAIL (baseline 1)`, exit 1. Deleted the scratch file, reran — `1 ok
(baseline 1)`, exit 0. Scratch file was never committed.

## Wall time (di-lint vs degradation-audit)

| Target            | Command                                             | Wall time |
| ----------------- | --------------------------------------------------- | --------- |
| di-lint           | `npx nx run di-lint:self-test`                      | 3.8s      |
| di-lint           | `npx nx run di-lint:lint --skip-nx-cache`           | 5.5s      |
| degradation-audit | `npx nx run degradation-audit:self-test`            | ~1.7s     |
| degradation-audit | `npx nx run degradation-audit:lint --skip-nx-cache` | 6.2s      |

Comparable order of magnitude; degradation-audit walks the same `libs/**/src` +
`apps/**/src` population di-lint already walks in the same CI job.

## Verification output (tail)

```
$ npx nx reset
NX Failed to reset the Nx workspace: EPERM on .nx/workspace-data
```

`nx reset` failed with EPERM — a concurrent batch process in this shared
worktree holds the directory. `npx nx show project degradation-audit` confirmed
the new `project.json` was picked up without a hard reset (Nx recomputes the
graph on the next command once the daemon is stopped), so verification
proceeded without it. Root `CLAUDE.md`'s `npx nx reset` gotcha is about a
_stale_ graph after a `project.json` edit; here the graph was current.

```
$ npx nx run degradation-audit:self-test
degradation-audit self-test: 6 violation(s) detected in fixtures (expected)
  .../bare-suppression.ts:7 [bare-suppression] ...
  .../bare-suppression.ts:8 [catch-return-sentinel] ...
  .../catch-return-sentinel.ts:7 [catch-return-sentinel] ...
  .../empty-catch.ts:6 [empty-catch] ...
  .../promise-catch-sentinel.ts:4 [promise-catch-sentinel] ...
  .../promise-catch-sentinel.ts:8 [promise-catch-sentinel] ...
degradation-audit self-test PASS: fixture violations detected, exit code 1 as expected
NX   Successfully ran target self-test for project degradation-audit

$ npx nx run degradation-audit:lint --skip-nx-cache
degradation-audit: TOTAL 564 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit

$ npx nx run di-lint:self-test && npx nx run di-lint:lint --skip-nx-cache
di-lint self-test PASS: fixture violation detected, exit code 1 as expected
di-lint OK: 1446 @inject sites all resolve to a registered token (660 tokens)
NX   Successfully ran target lint for project di-lint

$ npx nx affected -t lint --base=origin/main
NX   Successfully ran target lint for 73 projects
✖ 125 problems (0 errors, 125 warnings)   <- pre-existing no-non-null-assertion warnings, unrelated
EXIT=0
```

All acceptance criteria hold: self-test exits 0 only via the linter's exit 1;
lint emits a sorted per-directory table; a planted violation above baseline
fails and is cleared by removing it; `--update-baseline` lowered dropped
counts during iteration; `di-lint` still passes, proving `eslint.config.mjs`
was not broken; `nx affected -t lint` is green (0 errors) across 73 projects.

## Deviations from batches.md, with reason

1. **Added `tools/degradation-audit/tsconfig.json`**, not listed in batches.md's
   file list. Required: `ts-node --transpile-only` against the repo root
   `tsconfig.base.json` (`module: esnext`, `moduleResolution: node16`) throws
   `TS5109` even under `--transpile-only`, because that diagnostic is a config
   validation, not a type check. `tools/di-lint/tsconfig.json` already carries
   its own standalone `module: commonjs` tsconfig for the same reason — this
   file is its exact twin, so di-lint's contract needed no change.

2. **Did not add the type-aware `@typescript-eslint/no-floating-promises`
   block to `eslint.config.mjs`.** The plan's own "Rejected alternatives"
   section (`implementation-plan.md:178-187`) names this exact contingency:
   _"If even that parse cost proves unacceptable in the pre-commit hook, the
   fallback is an AST selector in the audit tool instead; the executor
   measures before choosing."_ Measured: `projectService: true` scoped to the
   three named directories took ~70s to type-check `apps/ptah-electron/src`
   alone (`npx eslint apps/ptah-electron/src` with the rule inline), and
   failed outright — not just slowly — on every `*.spec.ts` under it
   ("was not found by the project service"), because
   `apps/ptah-electron/tsconfig.json` references only `tsconfig.app.json`,
   never `tsconfig.spec.json`. That is unacceptable for a target the
   pre-commit hook runs on every affected-project lint. Took the named
   fallback instead: a structural `floating-promise` pattern in
   `check-degradation.ts`, scoped to the same three directories
   (`apps/ptah-electron/src/**`, `libs/backend/thoth-runtime/src/**`,
   `libs/backend/persistence-sqlite/src/**`), detecting a bare unhandled call
   to a same-file `async` function/method. It found 3 real sites (2 in
   `electron-browser-capabilities.ts`, 1 in `ipc-bridge.ts`), cross-checked
   against the same-scope type-aware ESLint run before reverting it — same
   two lines it flagged (`:433`, `:513`) came back from the structural
   detector too. Known false negative: cross-module/library promise calls
   (e.g. `dialog.showMessageBox(...)`) aren't caught, since there is no type
   information; documented in the tool's own file header, not silent.
   `eslint.config.mjs` therefore carries only the `no-empty` change plus an
   explanatory comment pointing here instead of the rejected block.

3. **`empty-catch` treats a comment-only catch block as non-empty**, matching
   ESLint's own `no-empty` semantics (a `{ // reason }` block is not flagged
   by `no-empty` either). First implementation used
   `block.statements.length === 0` alone and produced 83 false positives —
   every deliberately-commented empty catch in the codebase (e.g.
   `apps/ptah-cli/src/cli/session/approval-bridge.ts:368`, whose comment reads
   "Never throws by contract; guarded anyway"). Fixed to also require the
   text between the braces to be blank. Confirmed against the plan's own
   evidence row: "9 empty catches repo-wide; 7 in specs, 2 are detector
   fixtures" — production count under this tool is correctly 0 (both
   production sites are inside `workspace-intelligence`'s own rule-fixture
   _string literals_, not real AST catches, so 0 is right, not a miss).

## Not done / out-of-scope observations

- Batch 5 (classification pass) has not run — none of the 564 sites carry a
  suppression comment yet. All 503+58+3 are currently "unclassified" by
  design; this baseline is exactly what a fresh ratchet should start from.
- The `floating-promise` pattern has no self-test fixture (fixtures live
  under `tools/degradation-audit/__fixtures__/`, which is outside the three
  scoped directories by construction, so a fixture there can never exercise
  it). Verified instead against real code (`electron-browser-capabilities.ts`)
  as recorded above.
