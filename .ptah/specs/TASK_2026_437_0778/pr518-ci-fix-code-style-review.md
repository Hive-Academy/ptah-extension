# Code Style Review — PR #518 CI fix (`TASK_2026_437_0778`)

## Summary

| Metric          | Value                    |
| --------------- | ------------------------ |
| Overall score   | 7/10                     |
| Assessment      | APPROVED                 |
| Blocking issues | 0                        |
| Serious issues  | 1                        |
| Minor issues    | 1                        |
| Files reviewed  | 1 (+ 1 generated, no-op) |

Scope: `apps/ptah-electron-e2e/src/support/ui-driver.ts:118-129`. `content-manifest.json` is
a regenerated build artifact (hash + `generatedAt` only) and carries no style content.

## Five style questions

### 1. What breaks in six months?

Nothing structural — the suppression is scoped to one `new Function` call that already had a
memoization guard (`ui-driver.ts:113-132`) predating this change. The risk is documentation
rot: the reasoning lives in two places (block comment `:118-125` and end-of-line NOSONAR
`:126`) that can drift independently the next time either is edited.

### 2. What would a new team member misread?

Nothing in the reasoning itself — it is clear and specific (source, direction of the
boundary, why it's safe). A reader scanning only trailing comments (common when skimming a
diff) gets the complete justification restated at `:126` without needing to look up, which
is more generous than the precedent's "see above" — but that generosity is exactly the
duplication the precedent review already flagged as a defect to fix, not a pattern to copy
forward.

### 3. What does this cost to maintain?

Two sentences of reasoning duplicated verbatim in different words at `:118-125` and `:126`.
A future edit to the justification (e.g. a new caller of `__uiMockFns`, or a change to how
`source` reaches this function) has two places to update, and nothing enforces they move
together.

### 4. Where is this inconsistent with the rest of the repository?

The direct precedent is `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts:98-103`
(committed `36a24f257`), which pairs a leading block comment with a **pointer** trailing
comment (`// NOSONAR typescript:S2245 — non-security jitter, see above`) rather than a second
full restatement. That precedent's own review (`batches.md:1622`, follow-up FU-SEC-c) already
flagged the split between block comment and NOSONAR trailer as duplication worth de-duplicating
— and it is still open there. `ui-driver.ts:126` reproduces the same two-homes-for-one-fact
shape and goes further: instead of a short pointer, the trailer restates the full argument
("test-authored resolver source only, deserialized across the Playwright→Electron IPC
boundary; never user or network input") in its own words, so the two comments are not
even textually aligned — a reader who half-remembers one version and looks for it in the
other will not find the same words. This is drift-in-training, not merely repetition.

Comment density is otherwise consistent: this file already carries several 4-9 line
explanatory blocks in the same discursive style (`ui-driver.ts:66-75`, `85-92`, `320-323`),
so the new block's length and register are not an outlier for this file.

### 5. What would you have done differently?

Follow the precedent's pointer form, tightened: `// NOSONAR typescript:S1523 — test-authored
resolver source only, see above.` The block above already carries the full argument; the
trailer's only job is to satisfy SonarQube's requirement that the suppression comment sit on
the flagged line. Restating the reasoning a second time buys nothing a pointer doesn't, and
it's the exact debt FU-SEC-c named.

## Blocking issues

None.

## Serious issues

### NOSONAR trailer duplicates the block comment instead of pointing to it

- File: `apps/ptah-electron-e2e/src/support/ui-driver.ts:118-126`
- Problem: The 8-line block comment at `:118-125` and the end-of-line comment at `:126` both
  carry the full justification, worded independently. The repo's one precedent for this exact
  pattern (`network-backoff.ts:98-103`) uses a short pointer ("see above") specifically to
  avoid this, and that precedent's own review already logged the split as unresolved
  duplication (FU-SEC-c, `batches.md:1622`).
- Tradeoff: A pointer costs nothing at the call site and keeps one source of truth; the
  current form costs nothing at review time but leaves two texts that can silently diverge on
  the next touch, and repeats a documented smell in a second file instead of converging on the
  precedent's (already-imperfect) resolution.
- Recommendation: Shorten `:126` to `// NOSONAR typescript:S1523 — test-authored resolver
source only, see above.` If the team decides FU-SEC-c's fix is to keep full text in both
  places instead, apply that decision to `network-backoff.ts` too so the two suppressions read
  the same way.

## Minor issues

- `apps/ptah-electron-e2e/src/support/ui-driver.ts:126` — the trailing comment is 193
  characters on one physical line. Neither eslint nor `prettier --check` flags it (prettier
  does not reflow comment text, and no `max-len` rule is configured for this file — both
  verified against this file), so it is not a gate failure, just a readability cost on top of
  the duplication above. Resolving the Serious finding above by shortening the trailer also
  resolves this.

## File-by-file

### apps/ptah-electron-e2e/src/support/ui-driver.ts

Score 7/10 — 0 blocking, 1 serious, 1 minor. The suppression is correctly scoped (one call
site, memoized, `NOSONAR typescript:S1523` matches the flagged rule), the reasoning is
accurate and specific, and the block-comment density matches the file's existing style
(`:66-75`, `85-92`, `320-323`). The one real defect is structural: it repeats, in a new file,
the exact block/trailer duplication the repo's only precedent for this pattern
(`network-backoff.ts`) was already told to fix and has not yet fixed.

## Pattern compliance

| Repository rule or nearby convention                                                                         | Status | Evidence                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------- |
| NOSONAR suppression carries a specific, non-generic justification (repo convention, not a written rule)      | PASS   | `ui-driver.ts:118-126`                                               |
| Suppression justification stated once, pointer used for the trailer (precedent: `network-backoff.ts:98-103`) | FAIL   | `ui-driver.ts:118-126` vs `network-backoff.ts:98-103`                |
| `catch (error: unknown)` narrowing / zod boundary validation (root CLAUDE.md)                                | N/A    | No error handling or external boundary in this hunk                  |
| File size / facade rule (root CLAUDE.md — 700-line soft ceiling)                                             | PASS   | File is 414 lines; hunk adds 9                                       |
| Prettier / eslint clean on the touched file                                                                  | PASS   | `npx prettier --check` and `npx eslint` both clean on `ui-driver.ts` |

## Maintenance debt

- Introduced: a second, independently-worded justification for the same suppression, in a
  second file, repeating a documented-but-unfixed duplication pattern (FU-SEC-c).
- Retired: nothing.
- Net: small negative — the fix is a one-line trailer edit, but left as-is it normalizes the
  duplicated form as "how we do NOSONAR here" for the next author who copies this site instead
  of the precedent's shorter one.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: The NOSONAR trailer at `ui-driver.ts:126` restates the block comment instead of
  pointing to it, reproducing the exact duplication FU-SEC-c already flagged as unresolved
  debt on the one prior precedent for this pattern. Not blocking for a CI fix, but should not
  be the version that gets copied next time.
- What a 10/10 version would do differently: replace `:126` with a "see above" pointer
  matching `network-backoff.ts:103`'s form, and resolve FU-SEC-c on both sites in the same
  pass so the repo has one converged shape for this suppression pattern rather than two
  diverging ones.
