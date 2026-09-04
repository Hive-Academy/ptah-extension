# Context — TASK_2026_340

## Where this came from

Raised by the TASK_2026_308 implementer as a limit of their own fix, then sized
independently during that task's review on 2026-08-28. Verdict: **user-visible**.

The implementer declined to widen the prune unasked, which was correct. A
broader deletion rule over a user's session history is exactly the kind of change
that should not be added quietly as a side effect of a different fix.

## The gap

TASK_2026_308 fixed the producer: the importer no longer mints a phantom
`Session <date>` entry for a contentless file.

It did nothing for entries already on disk, and the existing sweep cannot reach
them.

`pruneTitleOnlySessions`
(`libs/backend/agent-sdk/src/lib/session-importer.service.ts:282-317`) delegates
to `isTitleOnlySidecar` (`:325-353`). That predicate returns true only when a
parsed `ai-title` line is present and no `system` or `user` line is.

A whitespace-only file has **zero parseable lines**. `sawAiTitle` never becomes
true, so the predicate returns false unconditionally, so the entry is never
pruned. It survives every future scan for the life of the store.

## What the user sees

A session in the list that opens to nothing, forever, with no affordance to
remove it. Only users who already hit the bug before TASK_2026_308 shipped are
affected, and only for the specific files that triggered it — but for those users
it does not age out.

## The cleanup, and the constraint that shapes it

**Positive re-classification only.** Open the entry's backing file, re-run the
corrected guard from TASK_2026_308, and delete the entry only when the file
definitely matches — the whole file in hand, no session content, nothing
parseable.

**Do not key on the entry's name.** `Session <date>` is a legitimate name for a
real session whose first user message produced no usable title text — see the
`sessionName || 'Session ${date}'` fallback at `:736`. A name heuristic would
delete real history.

This is the same principle `isTitleOnlySidecar` already documents in its own
comment: a truncated or unparseable real-session file must FAIL the positive test
rather than be misclassified. Preserve that. The cost of a false negative here is
one stale row. The cost of a false positive is a user losing a conversation.

## A dependency worth checking first

The TASK_2026_308 review found the corrected guard itself had to be revised: an
early version keyed on `parsedRecords`, which conflated "no session content" with
"could not parse", and would have dropped a real session whose only line failed
`JSON.parse` — a leading UTF-8 BOM is enough. The final discriminator is whether
the file held any non-whitespace bytes at all.

**Use the final version.** If this cleanup re-runs the earlier, wrong test
against stored entries, it will delete real sessions rather than merely fail to
import them. Read `session-importer.service.ts` as it stands rather than
reproducing the guard from memory.

Also note the bound: a whitespace-only file of exactly `METADATA_PREFIX_BYTES`
may or may not be covered depending on what TASK_2026_308 settled on for that
case. Check before assuming.

## Verification

- A stored entry whose backing file is whitespace-only is removed by the sweep.
- A stored entry whose backing file is a real session named `Session <date>`
  (because no title text was extractable) is **kept**. This is the test that
  matters — it is the one that fails if someone reaches for a name heuristic.
- A stored entry whose backing file is a real session that fails to parse is
  **kept**.
- A stored entry whose backing file no longer exists — decide deliberately and
  write the reason down. Deleting on absence is defensible; doing it by accident
  is not.
