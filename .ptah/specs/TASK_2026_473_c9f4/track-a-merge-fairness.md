# Track A merge-candidate fairness

## Approach and SQLite support

`MemoryStore.findMergeCandidates` now executes one window-function query. The
query first calculates the existing salience score, then applies
`ROW_NUMBER() OVER (PARTITION BY subject_key ORDER BY rank_score DESC, id DESC)`
and retains rows whose per-subject rank is at most `perSubjectLimit`. Only after
that independent per-subject cap does the outer query apply the existing global
rank order and `totalLimit`.

The shipped native dependency was confirmed directly from the worktree with
`require('better-sqlite3')`: installed `better-sqlite3` is **13.0.3**, its
embedded SQLite reports **3.53.4**, and this probe returned row numbers 1 and 2
without error:

```sql
SELECT value,
       ROW_NUMBER() OVER (ORDER BY value) AS row_number
FROM (SELECT 2 AS value UNION ALL SELECT 1);
```

SQLite 3.53.4 therefore supports the required window function. The live
measurement script opened
`C:\Users\abdal\.ptah\state\ptah.sqlite` with
`{ readonly: true, fileMustExist: true }`.

The salience arithmetic remains in one place. The new exported
`salienceRankExpression` helper in `salience-ranking.ts` supplies the expression
to this query, and the existing `salienceRankOrderBy` delegates to the same
helper without changing its output.

## Final SQL

The following is the final generated SQL for the measured ten-subject call.
The `IN` list contains one positional placeholder for each trimmed,
case-folded, deduplicated input subject.

```sql
WITH candidates AS (
  SELECT m.id AS id,
         m.subject AS subject,
         m.content AS content,
         LOWER(m.subject) AS subject_key,
         (m.salience *
            (604800000.0 /
              (604800000.0 + MAX(0, ? - m.last_used_at)))
          + 0.3 * m.hits / (m.hits + 3.0)
          + m.pinned) AS rank_score
  FROM memories m
  WHERE m.workspace_root IS ?
    AND m.subject IS NOT NULL
    AND LOWER(m.subject) IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
), ranked AS (
  SELECT id,
         subject,
         content,
         rank_score,
         ROW_NUMBER() OVER (
           PARTITION BY subject_key
           ORDER BY rank_score DESC, id DESC
         ) AS subject_rank
  FROM candidates
)
SELECT id, subject, content
FROM ranked
WHERE subject_rank <= ?
ORDER BY rank_score DESC, id DESC
LIMIT ?;
```

The bindings are, in order: ranking timestamp, workspace root, deduplicated
lowercase subjects, per-subject limit, total limit.

## Regression spec

The added spec is:

> `gives a quiet subject its full quota when busy subjects fill the shared scan horizon`

It seeds nine busy subjects with 25 rows each and one quiet subject with six
lower-ranked rows. That shape puts the quiet rows beyond the former shared
200-row scan horizon. The assertion proves the quiet subject still receives
five candidates after the query-level per-subject cap. The comment above the
fixture cites the measured `ptah-tui` case, where nine other subjects occupied
198 of 200 scan positions.

## Live ten-subject measurement

The after measurement reused the same workspace, ten subjects, ranking
timestamp (`1789830281322`), per-subject limit (5), and total limit (50) from
section 1 of `track-a-merge-measurement.md`.

| Subject                 | Matching rows in recorded snapshot | Before candidates | After candidates |
| ----------------------- | ---------------------------------: | ----------------: | ---------------: |
| `ptah-video-studio`     |                                246 |                 5 |                5 |
| `ptah-extension`        |                                165 |                 5 |                5 |
| `skill-synthesis`       |                                111 |                 5 |                5 |
| `tribunal-panel`        |                                 98 |                 5 |                5 |
| `ptah`                  |                                 73 |                 5 |                5 |
| `ptah-landing-page`     |                                 62 |                 5 |                5 |
| `ptah-electron`         |                                 58 |                 5 |                5 |
| `commitlint-scope-enum` |                                 50 |                 5 |                5 |
| `agent-sdk`             |                                 49 |                 5 |                5 |
| `ptah-tui`              |                                 46 |                 2 |                5 |
| **Total**               |                            **958** |            **47** |           **50** |

The former internal scan horizon no longer starves `ptah-tui`; every measured
subject independently reaches its five-row cap before the 50-row outer cap is
applied.

## Verification

Final test run:

```text
Test Suites: 42 passed, 42 total
Tests:       721 passed, 721 total
Snapshots:   0 total
Time:        26.775 s, estimated 29 s
Ran all test suites.
```

This is the verbatim tail, with terminal color escape sequences omitted, from:

```text
npx nx test @ptah-extension/memory-curator --skip-nx-cache
```

An earlier run hit the existing retention integration spec's 5-second timeout;
the final run above passed without a retry inside Jest.

Final typecheck run:

```text
> nx run @ptah-extension/memory-curator:typecheck

> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json




 NX   Successfully ran target typecheck for project @ptah-extension/memory-curator


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

This is the verbatim tail from:

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
```

## Cost

A normal non-empty call executes **one prepared SQL statement**, regardless of
subject count. A call with no usable subjects, a non-positive per-subject limit,
or a non-positive total limit executes zero statements. The statement returns
at most 50 rows. In the worst case it must rank every row in the selected
workspace whose case-folded subject equals one of the requested keys; there is
no longer an internal 200/500-row scan shortcut that can make the result
unfair. The alternative fallback of one statement per subject was not needed.
