# Seed fixtures — TASK_2026_177 Task 8.7

Two fixtures are committed here; two more are **derived at test time** and that
difference is deliberate.

## Committed

| File                        | What it proves                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `malformed.json`            | Not valid JSON at all. MG-1.2: the seed aborts at the parse and never opens a transaction.                                                                                                                                      |
| `structurally-invalid.json` | Well-formed JSON, wrong shape — an empty `note`, one category instead of four, zero topics. Proves the schema rejects a file that _looks_ like an export, which is the failure a human reviewer is most likely to wave through. |

Both are tiny because neither needs to resemble the real export: they fail before
any content is examined.

## Derived at test time, not committed

The `raw: null` and U+FFFD fixtures are built inside `community-seed.spec.ts` by
copying `docs/community/discourse-export.json` and mutating exactly one field,
then writing the result to `os.tmpdir()`.

**They are not committed on purpose.** A hand-copied 42 KB fixture is a snapshot
of the export as it was on the day it was copied. The export has already been
re-captured once — `a22b03eb6` corrected `6614f9e92`, which is the very defect
these two fixtures exist to catch — and the next correction would leave the
committed copies asserting a stale shape while still passing. Deriving them means
the _only_ difference between the fixture and the real export is the single
mutation under test, and that stays true for every future export.

The trade is that these two tests read a file outside the project. That file is
committed, is the seed's declared single source of truth (MG-1.1), and is already
read by the count assertions in the same spec.
