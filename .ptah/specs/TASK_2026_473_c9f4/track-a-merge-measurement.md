# Track A merge-candidate measurement

> **These NEW figures are PRE-FINAL and are kept as the record of why the query changed again.**
> They measure the first version of `findMergeCandidates`, which applied the per-subject cap in
> TypeScript over one shared 200-row ranked scan. Section 1 below shows what that cost: nine busy
> subjects took 198 of the 200 scan positions and `ptah-tui` received 2 candidates instead of 5.
> The shipped query puts the cap inside the SQL with `ROW_NUMBER() OVER (PARTITION BY ...)` and has
> no internal scan horizon. It returns 5 candidates for every one of the ten subjects, 50 in total.
> See `track-a-merge-fairness.md` for the final query, its SQL and its measurement.
>
> The OLD column and sections 2 to 5 are unaffected by that change and still stand.

Measured at **2026-09-19 15:04:41.322 UTC** against `C:\Users\abdal\.ptah\state\ptah.sqlite`, opened with `better-sqlite3` using `{ readonly: true, fileMustExist: true }`.

The measured workspace root is **`D:\projects\ptah-extension`** because it is the Ptah repository root and, at 35,255 rows, is by far the largest relevant root in the live database. It contains 35,222 rows with a subject and 26,503 distinct subjects. Its rows span 2026-06-05 09:49:58.056 UTC through 2026-09-19 14:15:12.267 UTC. The database also contains other project and worktree roots, but they were excluded by the same `workspace_root IS ?` predicate used by both paths.

The figures below measure **candidate supply only**. They do not measure curator decisions or merge-rate improvement; that would require running the curator.

## 1. Ten subjects with the most rows

The OLD figures come from one 200-row ranked workspace read followed by exact, case-sensitive subject filtering. The NEW figures come from one `findMergeCandidates`-equivalent call containing these ten subjects, including its per-subject cap, total cap, and internal ranked scan limit.

| Subject | Total rows | OLD candidates | NEW candidates |
| --- | ---: | ---: | ---: |
| `ptah-video-studio` | 246 | 1 | 5 |
| `ptah-extension` | 165 | 0 | 5 |
| `skill-synthesis` | 111 | 0 | 5 |
| `tribunal-panel` | 98 | 0 | 5 |
| `ptah` | 73 | 0 | 5 |
| `ptah-landing-page` | 62 | 2 | 5 |
| `ptah-electron` | 58 | 0 | 5 |
| `commitlint-scope-enum` | 50 | 0 | 5 |
| `agent-sdk` | 49 | 1 | 5 |
| `ptah-tui` | 46 | 0 | 2 |
| **Total** | **958** | **4** | **47** |

All ten subjects have at least five matching rows. `ptah-tui` nevertheless supplied only two because the implementation scans the first 200 ranked matches for a ten-subject call before applying the five-per-subject selection; the other subjects occupied 198 of those scan positions. Thus the 50-row output cap did not bind in this measurement—the internal scan horizon did.

## 2. Zero OLD candidates to at least one NEW candidate

**7 of the 10** largest subjects went from zero OLD candidates to at least one NEW candidate.

| Transition | Subjects | Count |
| --- | --- | ---: |
| OLD = 0 and NEW >= 1 | `ptah-extension`, `skill-synthesis`, `tribunal-panel`, `ptah`, `ptah-electron`, `commitlint-scope-enum`, `ptah-tui` | 7 |
| OLD >= 1 | `ptah-video-studio`, `ptah-landing-page`, `agent-sdk` | 3 |

This is the directly relevant supply result: under the OLD path, seven busy subjects would have presented no possible merge target at all; the NEW path supplies at least one for every one of them.

## 3. Commitlint subject family

The forensic report's family definition is reproducible as subjects matching `LIKE '%commitlint%'`. In the current live snapshot that family still contains **81 distinct subjects**, holding **284 rows**.

| Draft subject | Rows with case-insensitive equality | OLD candidates | NEW candidates | Reachable family subjects |
| --- | ---: | ---: | ---: | ---: |
| `commitlint-scope-enum` | 50 | 0 | 5 | 1 of 81 |

The NEW path fixes the recency-window failure for `commitlint-scope-enum`: it supplies five ranked candidates where the OLD path supplied zero. It does **not** repair subject fragmentation. `LOWER(subject) = LOWER('commitlint-scope-enum')` reaches only the one subject spelling `commitlint-scope-enum`. The other 80 differently worded subjects—including `commitlint-scopes`, `ptah-commitlint`, and `commitlint-scope-mapping`—remain unreachable. This is equality after case folding, not prefix matching or similarity matching.

## 4. Random sample of 20 subjects older than 14 days

The cutoff was **2026-09-05 15:04:41.322 UTC**. The sample selected 20 distinct, non-null subjects at random from subjects having at least one row created before that cutoff. The twenty subjects were then supplied together to each path, matching the call site's batched-subject behavior.

| Subject | Rows older than 14 days | Total rows | OLD candidates | NEW candidates |
| --- | ---: | ---: | ---: | ---: |
| `tribunal-per-lane-models-feature` | 1 | 1 | 0 | 1 |
| `unrelated-unstaged-work-merge-blocking` | 1 | 1 | 0 | 1 |
| `coverage-threshold-maintenance` | 1 | 1 | 0 | 1 |
| `electron-build-tsconfig-paths` | 2 | 2 | 0 | 2 |
| `rewind-fork-testing-qa-checklist` | 1 | 1 | 0 | 1 |
| `stream-events incremental indexing` | 1 | 1 | 0 | 1 |
| `vercel-oidc-design` | 2 | 2 | 0 | 2 |
| `tool_result-landmark-fix` | 1 | 1 | 0 | 1 |
| `ptah-skill-telemetry` | 1 | 1 | 0 | 1 |
| `skill-synthesis-deletion` | 1 | 1 | 0 | 1 |
| `agent-generation-templates-location-correction` | 1 | 1 | 0 | 1 |
| `lockfile-regen-npm-version` | 1 | 1 | 0 | 1 |
| `gateway-chat-bridge-wip` | 1 | 1 | 0 | 1 |
| `internal-query-cwd-guard` | 2 | 2 | 0 | 2 |
| `pre-commit-hook-electron-cache-invalidation` | 1 | 1 | 0 | 1 |
| `voice-progress-push-pattern` | 1 | 1 | 0 | 1 |
| `wizard-streaming-fix-completed` | 1 | 1 | 0 | 1 |
| `native-module-testing` | 1 | 1 | 0 | 1 |
| `thoth-status-collapsible-pattern` | 1 | 1 | 0 | 1 |
| `agent-sdk-transform-layer` | 1 | 1 | 0 | 1 |
| **Total** | **23** | **23** | **0** | **23** |

The typical old-subject case is stark in this sample: none of the 23 matching rows appeared in the OLD top 200, while the NEW path supplied all 23. No sampled subject reached the five-row per-subject cap, and the 50-row total cap did not bind.

## 5. Judgement on the caps

| Cap | Measured evidence | Judgement |
| --- | --- | --- |
| 5 rows per subject | Only 352 of 26,503 case-folded subjects (1.33%) have more than five rows. None of the 20 randomly sampled old subjects was capped, while all ten busiest subjects have more than five rows. | **Looks right for candidate supply.** It leaves the typical case untouched and prevents a small set of very large buckets from dominating the resolve prompt. This measurement cannot determine whether the five candidates are semantically diverse enough. |
| 50 rows total | The ten-busiest-subject batch returned 47 rows and the random 20-subject batch returned 23. The total cap bound neither measurement. | **Does not look too small.** The observed constraint in the stress case was the internal 200-row ranked scan, not the 50-row return cap. There is no candidate-supply evidence here that increasing 50 would help. |

These judgements concern prompt input size and candidate availability only. They do not establish that the curator will choose a merge, nor support a percentage claim about future merge rate.

## SQL used

All parameters shown as `:workspace`, `:rank_now`, and `:cutoff` were bound values. For this run they were `D:\projects\ptah-extension`, `1789830281322`, and `1788620681322`, respectively.

```sql
-- Workspace scale.
SELECT
  COUNT(*) AS rows,
  COUNT(subject) AS rows_with_subject,
  COUNT(DISTINCT subject) AS distinct_subjects,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM memories
WHERE workspace_root IS :workspace;

-- Ten largest case-sensitive subjects.
SELECT subject, COUNT(*) AS total_rows
FROM memories
WHERE workspace_root IS :workspace
  AND subject IS NOT NULL
GROUP BY subject
ORDER BY total_rows DESC, subject ASC
LIMIT 10;

-- OLD ranked window. Candidate counts are exact, case-sensitive counts in this result.
SELECT m.id, m.subject, m.content
FROM memories m
WHERE m.workspace_root IS :workspace
ORDER BY
  (m.salience *
     (604800000.0 /
       (604800000.0 + MAX(0, :rank_now - m.last_used_at)))
   + 0.3 * m.hits / (m.hits + 3.0)
   + m.pinned) DESC,
  m.id DESC
LIMIT 200;

-- NEW ranked scan. The placeholders are the lower-cased, de-duplicated input
-- subjects. The implementation uses scan_limit =
-- min(500, max(50, input_subject_count * 20)), then selects at most five rows
-- per LOWER(subject) and stops after 50 selected rows.
SELECT m.id, m.subject, m.content
FROM memories m
WHERE m.workspace_root IS :workspace
  AND m.subject IS NOT NULL
  AND LOWER(m.subject) IN (:lower_subject_placeholders)
ORDER BY
  (m.salience *
     (604800000.0 /
       (604800000.0 + MAX(0, :rank_now - m.last_used_at)))
   + 0.3 * m.hits / (m.hits + 3.0)
   + m.pinned) DESC,
  m.id DESC
LIMIT :scan_limit;

-- Commitlint family and exact reachability from the requested draft subject.
SELECT COUNT(*) AS rows, COUNT(DISTINCT subject) AS subjects
FROM memories
WHERE workspace_root IS :workspace
  AND subject LIKE '%commitlint%';

SELECT subject, COUNT(*) AS rows
FROM memories
WHERE workspace_root IS :workspace
  AND LOWER(subject) = LOWER('commitlint-scope-enum')
GROUP BY subject
ORDER BY rows DESC;

SELECT COUNT(DISTINCT subject) AS reachable_family_subjects
FROM memories
WHERE workspace_root IS :workspace
  AND subject LIKE '%commitlint%'
  AND LOWER(subject) = LOWER('commitlint-scope-enum');

-- Random subject sample. The resulting 20 subjects are recorded in section 4,
-- so their candidate figures can be rechecked even though RANDOM() draws a new
-- sample on a new run.
SELECT
  subject,
  COUNT(*) AS eligible_old_rows,
  MIN(created_at) AS oldest_created_at,
  MAX(created_at) AS newest_eligible_created_at
FROM memories
WHERE workspace_root IS :workspace
  AND subject IS NOT NULL
  AND created_at < :cutoff
GROUP BY subject
ORDER BY RANDOM()
LIMIT 20;

-- Distribution used to judge the five-row cap.
SELECT COUNT(*) AS lower_subjects_over_five
FROM (
  SELECT LOWER(subject)
  FROM memories
  WHERE workspace_root IS :workspace
    AND subject IS NOT NULL
  GROUP BY LOWER(subject)
  HAVING COUNT(*) > 5
);
```
