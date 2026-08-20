# Data-reality checks D1–D7 — actual results

**Run**: 2026-08-01 · **Environment**: local dev (`ptah_postgres` container, `-U ptah -d ptah_db`)
**Executed by**: orchestrator, concurrently with B0, per implementation-plan.md §4.

```bash
docker exec -i ptah_postgres psql -U ptah -d ptah_db -tAc "<SQL>"
```

| ID     | Gates                                                                  | Pass condition | **Actual**                          | Verdict                            |
| ------ | ---------------------------------------------------------------------- | -------------- | ----------------------------------- | ---------------------------------- |
| **D1** | 🔴 B2 (`VerifyLicenseDto`) — blocking                                  | `0`            | **0** (of **3** total licence rows) | ✅ PASS — but see the caveat below |
| **D2** | B7 (`BulkEmailDto`), B8 (`SendCampaignDto`) — `@IsUUID('4')`           | `0`            | **0** (of **3** total user rows)    | ✅ PASS                            |
| **D3** | B8 (`SendCampaignDto.templateId`)                                      | `0`            | **0**                               | ✅ PASS                            |
| **D4** | B8 (`SaveTemplateDto.htmlBody` ≤ 50 000)                               | `≤ 50000`      | **1258**                            | ✅ PASS — 40× headroom             |
| **D5** | B1 (`JoinWaitlistDto.source` ≤ 50)                                     | `≤ 50`         | **13**                              | ✅ PASS                            |
| **D6** | B5 (`SessionRequestDto.additionalNotes` ≤ 2000)                        | `≤ 2000`       | **0**                               | ⚠️ VACUOUS — table is empty        |
| **D7** | B7 (`IssueComplimentaryLicenseDto.email` `@Transform`) — informational | empty          | **empty**                           | ✅ No case-duplicate users         |

---

## ⚠️ Caveat that must not be lost: D1 is satisfied against a 3-row dev corpus

Plan §3.2 gates the highest-exposure batch in this task (`VerifyLicenseDto`, on the **public,
unauthenticated** endpoint every installed extension calls) on D1 returning `0`. It returned `0` —
**over three rows in a local dev database.**

That is a pass against the letter of the gate and weak evidence against its intent. The concern F2
raises is whether the legacy `PTAH-XXXX-XXXX-XXXX` format documented at `license.service.ts:216`
exists **in production**. A dev database that has only ever been populated by the current generator
(`license.service.ts:354-362`, which only emits `ptah_lic_`) cannot answer that question — it is
structurally incapable of containing a legacy row.

**Therefore:** D1 as run clears B2 for local development only. Before this task's B2 commit reaches
production, the same query must be run against the **production** database:

```sql
SELECT count(*) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$';
-- if > 0:
SELECT left(license_key, 20) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$' LIMIT 5;
```

If that returns `> 0`, the resolution is **not** to weaken the regex to `@IsString()`. It is to widen
it to a union matching the two documented formats, or to migrate the legacy rows — per plan §3.2 and
§6.4. Escalate the choice rather than deciding it in a commit.

This caveat is recorded as a release gate on the task, not a blocker on B2 landing locally.

## Secondary note: D6 is vacuous

`session_requests` is empty (`max(length(additional_notes))` = 0), so D6 proves nothing about whether
real notes can exceed the DTO's `@MaxLength(2000)`. Plan §3.9 asks the B5 developer to confirm the
notes textarea caps at ≤ 2000 client-side; with D6 vacuous, **that client-side check is now the only
evidence available** and must actually be performed rather than treated as a formality.

## D2 note

TASK_2026_169 checked 3 rows; this counted all rows — which also happens to be 3. The `users` table
is equally thin. `@IsUUID('4')` is asserted by `@db.Uuid` columns at the schema level, so the risk
here was always lower than for D1, but the same production-corpus caveat applies in principle.
