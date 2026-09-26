# M3 reach 8(a) and the locality proof — TASK_2026_563_2939 (Phase 2)

Measurement table row **M3 reach** (M3 criterion 8a). Raw output: `output/m3-reach-direct.json`,
`output/m3-reach-proxy.json`, `output/m3-copyB.json`. Script: `harness/merge-replay.ts reach <label>`.

## Method

- **Copy B:** `%TEMP%\mqs-563-eval\copyB-m3.sqlite`.
  - A backup-API working copy of the verified snapshot: started 2026-09-26T18:31:28.481Z, backup
    2,223 ms, `integrity_check` `ok` in 2,144 ms.
  - Migrated with the production runner to **48 only**: `appliedVersions: [48]`, `finalVersion: 48`.
    M5/0049 is off, so no row is quarantined.
  - Opened `readonly` with sqlite-vec loaded.
- **Code:** the BRANCH (HEAD `12252d5df`). The shipped `MergeCandidateCollector` is used
  **unmodified**, over the real `MemoryStore` and `MemorySearchService`.
  - The embedder is the REAL `EmbedderWorkerClient`, with the bundled worker and both ONNX models
    from the byte copy in `%TEMP%\mqs-563-eval\models`.
  - `VecStatus.available = true`.
  - The real reranker is in the path. It is inert; see below.
- **Draft:** `{ kind: 'fact', subject: 'commitlint-scope-enum', content: <verbatim> }`. The content
  is taken from the **newest** row whose `TRIM(LOWER(subject)) = 'commitlint-scope-enum'` in
  `D:\projects\ptah-extension`, by `created_at` and then id:
  - row `01M2XACB41R4V4RCQ33WZ6RTTY`, created 2026-09-19T17:10:47.681Z
  - content, verbatim: "New library names must be added to the allowed scope list in
    `.commitlintrc.json`; `notification-center` was registered beside the other frontend library
    scopes."
- **Before:** `MemoryStore.findMergeCandidates(['commitlint-scope-enum'], 'D:\projects\ptah-extension')`
  (tier 1 only).
- **After:** `MergeCandidateCollector.collect([draft], 'D:\projects\ptah-extension')`.
- **Counting:** distinct `TRIM(LOWER(subject))` values containing `commitlint` in each candidate set.

## The family on this copy

| Scope                        | Distinct family subjects | Family rows |
| ---------------------------- | -----------------------: | ----------: |
| `D:\projects\ptah-extension` |                   **49** |         171 |
| All scopes                   |                       49 |         171 |

This re-verifies the plan's "family of 49 subjects" on this snapshot. All 171 rows are in the one
workspace, which also matches `quarantine-rules.md` (171 rows, 49 subjects).

## Result

|                   |                                                     Candidates | Family rows |                                            **Distinct family subjects** |     Time |
| ----------------- | -------------------------------------------------------------: | ----------: | ----------------------------------------------------------------------: | -------: |
| Before (tier 1)   |                                                              5 |           5 |                                         **1** (`commitlint-scope-enum`) |  0.55 ms |
| After (collector) | 9 (tier 1: 5, tier 2: 4, 1 tier-2 query, `tier2Skipped: null`) |           8 | **3** (`commitlint`, `commitlint-scope-enum`, `ptah-commitlint-scopes`) | 1,024 ms |

The collector's after-set, in order:

| Tier | Id                           | Subject                        | Family                                                                                                        |
| ---: | ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
|    1 | `01M2XACB41R4V4RCQ33WZ6RTTY` | commitlint-scope-enum          | yes                                                                                                           |
|    1 | `01M1WAX4T4Y2JMZHY82KFCADT3` | commitlint-scope-enum          | yes                                                                                                           |
|    1 | `01M07ZDFTQG0TKBG9YDYZABM77` | commitlint-scope-enum          | yes                                                                                                           |
|    1 | `01KTK96P01FQ78DCKWJDEFG6FT` | commitlint-scope-enum          | yes                                                                                                           |
|    1 | `01M11Y8HRP8KSX9RRP5P486N0A` | commitlint-scope-enum          | yes                                                                                                           |
|    2 | `01M1WAX3W8BPR9RDT4887H8YKS` | commit scope registration ptah | no                                                                                                            |
|    2 | `01KWSSRW79PSQFHXWVAJSK3ST0` | ptah-commitlint-scopes         | yes                                                                                                           |
|    2 | `01KWCESJVSHHG93ME5HDFHBSJV` | commitlint-scope-enum          | yes (the workspace has 27 rows of this subject; tier 1 caps at 5 per subject, so this is one of the other 22) |
|    2 | `01KXCE4ZAAJBDY2VSZQ2ZZJJCD` | commitlint                     | yes                                                                                                           |

**Gate: after > before. 3 > 1: PASS.** The plan's baseline of 1 is confirmed on this copy.

- **The reach gain is modest.** Tier 2 adds 2 new family subjects of the 48 not reached by tier 1,
  plus 1 non-family row that is semantically on topic (`commit scope registration ptah`).
- **Tier 2 is bounded by design.** It returns at most `TIER2_PER_DRAFT_LIMIT = 5` hits per draft.
  Here only 4 were new: one of the 5 search hits was already in tier 1 and was deduplicated. Of the
  4, one is a same-subject row that tier 1's per-subject cap had excluded.
- **8(a)'s gate is "after > before", not "reaches the family".** The count is reported as measured.
- **The draft finds its own source row.** `01M2XACB…` is on copy B, because 8(a) does not delete
  it; the plan defines 8(a) on copy B, not on B′. That row takes one tier-1 slot. It does not change
  the distinct-subject count, because tier 1 already contributes `commitlint-scope-enum`.

## Locality proof (8(a) repeated with a dead proxy)

The same 8(a) call ran twice, in two fresh processes (`ELECTRON_RUN_AS_NODE=1 electron.cmd
merge-replay.cjs reach …`):

| Run                  | Env                                                                                       | After-set ids and order                | Before-set    | Family subjects | Network attempts recorded |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- | ------------- | --------------: | ------------------------: |
| `direct` (18:31:59Z) | no proxy vars                                                                             | (table above)                          | 5 ids         |           1 → 3 |                     **0** |
| `proxy` (18:32:02Z)  | `HTTPS_PROXY=http://127.0.0.1:9`, `HTTP_PROXY=http://127.0.0.1:9`, `NODE_USE_ENV_PROXY=1` | **identical** (same 9 ids, same order) | **identical** |           1 → 3 |                     **0** |

**Result: identical output with the proxy dead. 0 outbound attempts in either run. Locality holds.**

### Why a dead proxy alone is not enough, and what was added

- **The proxy variables cannot catch everything.** Node's built-in `fetch` ignores
  `HTTP(S)_PROXY` unless `NODE_USE_ENV_PROXY=1`, and a raw `net`/`tls` socket ignores them
  entirely. So "identical under a dead proxy" could hide a direct connection that simply succeeded.
- **The harness adds `lib/net-guard.ts`, a recorder that never blocks.**
  - It wraps `net.Socket.prototype.connect` (every TCP connection, including undici/`fetch`,
    `http`, `https` and `tls`), `dns.lookup`, `dns.promises.lookup` and `globalThis.fetch`.
  - It is installed in **both** the main thread and the **embedder worker thread**, through a
    generated wrapper that requires the guard and then the same `embedder-worker.cjs`.
  - Each run's log (`%TEMP%\mqs-563-eval\netguard-m3-reach-{direct,proxy}.log`) shows the two
    `installed` markers, `main` and `embedder-worker`, the second carrying the proxy env, and
    **nothing else**.
- **Positive control:** the same guard does record real attempts.
  - `netguard-positive-control.cjs`: `fetch('http://127.0.0.1:9/')` was logged as `fetch`, and
    `dns.lookup('localhost')` as `dns-lookup`. Fetch then refused port 9 as a "bad port" before
    opening a socket.
  - `netguard-positive-control2.cjs`: `http.get('http://127.0.0.1:9/')` was logged as
    `tcp-connect {"host":"127.0.0.1","port":9}` and failed `ECONNREFUSED`.
- **What the path touches:** the tier-2 path (one local embed, one sqlite-vec KNN, the SQL reads
  and one local ONNX rerank) opened no socket and resolved no host name. Model loading used the
  local `models/` cache.

## Reranker note

The collector's one `searchRich` call reached rerank (20 fused candidates). The reranker returned a
single distinct score, `1`, and its output order equals the first 5 of its RRF input order. So the
tier-2 rows above are in RRF order. This is the pre-existing `embedder-worker.ts` behaviour the
senior-tester diagnosed; this task did not touch it. 8(a) counts set membership, so ordering does
not affect the gate.
